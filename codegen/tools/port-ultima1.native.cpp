// Native PS/2 timing test for the Ultima I SNES pad glue (pad.s).
// Built and run by codegen/tools/port-ultima1.native.ps1.
//
// A small 6502 program polls the pad glue the way STUPH's patched keyboard
// read does (JSR $0300, store a ready key, touch $C010), so the glue clocks
// both SNES pads on every poll while real PS/2 frames arrive on VIA1
// CA2/PA7 at a given bit period, with DATA changing a given number of cycles
// after each falling clock edge. Caps Lock must complete the ROM's LED command
// exchange, every typed key must arrive, and every NMI must return with A/X/Y,
// flags and the BASIC overlay unchanged - including NMIs taken during a scan.
// A second phase types while buttons are pressed and released on both pads.
#include "SDCard.h"
#include "vm.h"
#include <array>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <iterator>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{
    void require(bool condition, const std::string& message)
    {
        if (!condition) throw std::runtime_error(message);
    }

    // Answers host-to-keyboard commands (LED updates) with $FA, like a keyboard.
    struct KeyboardPeer
    {
        VM& vm;
        uint64_t& cycles;
        enum class Phase { Idle, TxHigh, TxLow, HostRelease, Ack, ReplyLow, ReplyHigh, ReplyDone };
        Phase phase = Phase::Idle;
        uint64_t next = 0;
        unsigned bitIndex = 0;
        std::array<uint8_t, 11> bits{};
        std::vector<uint8_t> commands;
        bool clockHigh = true;

        void pins(bool data, bool clock)
        {
            vm.GetVIA1()->SetPortAInputBits(0xc0, (data ? 0x80 : 0) | (clock ? 0x40 : 0));
            if (clockHigh && !clock) vm.SignalVIA1Pin(VIA::CA2);
            clockHigh = clock;
        }

        void tick()
        {
            const auto ddr = vm.GetVIA1()->ReadRegister(VIA::DDRA);
            if (phase == Phase::Idle)
            {
                if ((ddr & 0xc0) != 0x80 || (vm.GetVIA1()->GetPortAOutput() & 0x80)) return;
                bitIndex = 0;
                pins(true, false);
                phase = Phase::TxHigh;
                next = cycles + 80;
            }
            if (cycles < next) return;
            switch (phase)
            {
            case Phase::TxHigh: pins(true, true); phase = Phase::TxLow; next += 80; break;
            case Phase::TxLow:
                pins(true, false);
                bits[bitIndex++] = (vm.GetVIA1()->GetPortAOutput() >> 7) & 1;
                if (bitIndex == bits.size())
                {
                    require(bits[0] == 0 && bits[10] == 1, "Bad PS/2 host command frame");
                    uint8_t value = 0, parity = bits[9];
                    for (int i = 0; i < 8; ++i)
                    {
                        value |= bits[i + 1] << i;
                        parity ^= bits[i + 1];
                    }
                    require(parity == 1, "Bad PS/2 host command parity");
                    commands.push_back(value);
                }
                phase = bitIndex == bits.size() ? Phase::HostRelease : Phase::TxHigh;
                next += 80;
                break;
            case Phase::HostRelease:
                if (ddr & 0x80) break;
                pins(false, false); phase = Phase::Ack; next = cycles + 80;
                break;
            case Phase::Ack:
                pins(true, true);
                bits = {0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1}; // $FA, odd parity, stop
                bitIndex = 0; phase = Phase::ReplyLow; next = cycles + 320;
                break;
            case Phase::ReplyLow: pins(bits[bitIndex] != 0, false); phase = Phase::ReplyHigh; next += 80; break;
            case Phase::ReplyHigh:
                pins(bits[bitIndex] != 0, true);
                phase = ++bitIndex == bits.size() ? Phase::ReplyDone : Phase::ReplyLow;
                next += 80;
                break;
            case Phase::ReplyDone: pins(true, true); phase = Phase::Idle; break;
            case Phase::Idle: break;
            }
        }
    };

    std::vector<uint8_t> readFile(const char* path)
    {
        std::ifstream f(path, std::ios::binary);
        require(bool(f), std::string("Cannot read ") + path);
        return std::vector<uint8_t>(std::istreambuf_iterator<char>(f), {});
    }

    constexpr uint16_t NMI_ENTRY = 0xf1bb; // ROM NMI proxy (the game keeps ROM visible)

    struct Machine
    {
        std::unique_ptr<VM> vm = std::make_unique<VM>(false);
        CPU* cpu = vm->GetCPU();
        uint64_t cycles = 0;
        KeyboardPeer keyboard{*vm, cycles};
        uint32_t period, hold;
        bool checking = false;
        unsigned checkedInterrupts = 0, scans = 0, nmisInScan = 0, ledYChanges = 0;
        uint16_t scanStart = 0, scanEnd = 0;
        struct Frame
        {
            uint16_t pc;
            uint8_t a, x, y, sp, p;
            bool basic;
            size_t commands;
        };
        std::vector<Frame> frames;
        std::array<uint32_t, 96> trace{};
        unsigned traceAt = 0;
        std::string dumpTrace() const
        {
            std::string s;
            char buf[32];
            for (unsigned i = 0; i < trace.size(); ++i)
            {
                const uint32_t t = trace[(traceAt + i) % trace.size()];
                snprintf(buf, sizeof buf, " %04X%s%s", t & 0xffff, (t >> 16) & 1 ? "b" : "", (t >> 17) & 1 ? "!" : "");
                s += buf;
            }
            return s;
        }

        Machine(const char* romPath, uint32_t bitPeriod, uint32_t dataHold)
            : period(bitPeriod), hold(dataHold)
        {
            const auto rom = readFile(romPath);
            require(rom.size() >= 65536, "ROM too small");
            std::copy_n(rom.begin(), 65536, vm->GetData());
            std::copy_n(vm->GetData() + 0x9000, 0x3000, vm->GetBasicRom());
            vm->CallbackDebugString = [](char* text) { throw std::runtime_error(text); };
            vm->Reset();
            run(5000000);
        }

        void step()
        {
            keyboard.tick();
            const bool executing = vm->WillExecuteCurrentInstruction();
            const Frame before{cpu->PC, cpu->A, cpu->X, cpu->Y, cpu->SP, cpu->flags.reg, vm->IsROMVisible(0x9000), keyboard.commands.size()};
            cycles += vm->Step();
            trace[traceAt++ % trace.size()] = before.pc | (before.basic ? 0x10000 : 0) | (!executing ? 0x20000 : 0);
            if (!checking) return;
            require(cpu->PC >= 0x0300 && cpu->PC < 0x03c0 || cpu->PC >= 0x0800 && cpu->PC < 0x0900 || cpu->PC >= 0x9000, "CPU left the test code: PC " + std::to_string(cpu->PC) + dumpTrace());
            if (executing && before.pc == scanStart) ++scans;
            if (!executing && cpu->PC == NMI_ENTRY && cpu->SP == uint8_t(before.sp - 3))
            {
                frames.push_back(before);
                if (before.pc >= scanStart && before.pc < scanEnd) ++nmisInScan;
                return;
            }
            if (!frames.empty() && cpu->PC == frames.back().pc && cpu->SP == frames.back().sp)
            {
                const Frame& f = frames.back();
                // The ROM's LED-command path (Caps/Num Lock) uses Y in its delay
                // loops and does not restore it - for every program on this ROM.
                const bool led = keyboard.commands.size() != f.commands;
                if (led && f.y != cpu->Y) ++ledYChanges;
                require(f.a == cpu->A && f.x == cpu->X && (led || f.y == cpu->Y), "NMI corrupted A/X/Y at PC $" + std::to_string(f.pc) + " A " + std::to_string(f.a) + "->" + std::to_string(cpu->A) + " X " + std::to_string(f.x) + "->" + std::to_string(cpu->X) + " Y " + std::to_string(f.y) + "->" + std::to_string(cpu->Y) + (f.pc >= scanStart && f.pc < scanEnd ? " (in scan)" : "") + dumpTrace());
                require((f.p & 0xcf) == (cpu->flags.reg & 0xcf), "NMI corrupted CPU flags");
                // A new edge can nest inside the ROM's own NMI exit, between its
                // DEC $CAFE and BIT $C007; it returns with BASIC already out, which
                // the interrupted exit selects next anyway.
                const bool window = f.pc >= 0xf1c6 && f.pc <= 0xf1cd;
                require(f.basic == vm->IsROMVisible(0x9000) || window, "NMI changed the BASIC overlay: interrupted PC " + std::to_string(f.pc) + " before " + std::to_string(f.basic) + dumpTrace());
                frames.pop_back();
                ++checkedInterrupts;
            }
        }

        void run(uint64_t budget)
        {
            const uint64_t end = cycles + budget;
            while (cycles < end) step();
        }

        void scan(uint8_t code)
        {
            std::array<uint8_t, 12> bits{};
            uint8_t parity = 1;
            for (int i = 0; i < 8; ++i)
            {
                bits[i + 1] = (code >> i) & 1;
                parity ^= bits[i + 1];
            }
            bits[9] = parity;
            bits[10] = bits[11] = 1;
            const uint64_t start = cycles;
            for (int i = 0; i < 11; ++i)
            {
                const uint64_t edge = start + uint64_t(i) * period;
                while (cycles < edge) step();
                vm->GetVIA1()->SetPortAInputBits(0xc0, bits[i] << 7);
                vm->SignalVIA1Pin(VIA::CA2);
                while (cycles < edge + period / 2) step();
                vm->GetVIA1()->SetPortAInputBits(0x40, 0x40);
                while (cycles < edge + hold) step();
                vm->GetVIA1()->SetPortAInputBits(0xc0, (bits[i + 1] << 7) | 0x40);
                while (cycles < edge + period) step();
            }
            run(160);
        }

        // Keys are spaced by an odd, drifting gap so their frames land at
        // every phase of the glue's poll/scan cycle.
        void key(uint8_t code, unsigned n)
        {
            scan(code);
            run(9001 + 977 * (n % 13));
            scan(0xf0);
            scan(code);
            run(15013 + 1531 * (n % 7));
        }
    };
}

int main(int argc, char** argv)
{
    try
    {
        require(argc == 8, "Usage: u1-native <rom> <pad.bin> <program.bin> <period> <hold> <scan-start-hex> <scan-end-hex>");
        const auto pad = readFile(argv[2]);
        const auto program = readFile(argv[3]);
        const uint32_t period = uint32_t(std::stoul(argv[4]));
        const uint32_t hold = uint32_t(std::stoul(argv[5]));
        require(hold >= period / 2 && hold <= period, "Invalid PS/2 timing");
        Machine m(argv[1], period, hold);
        m.scanStart = uint16_t(std::stoul(argv[6], nullptr, 16));
        m.scanEnd = uint16_t(std::stoul(argv[7], nullptr, 16));
        for (size_t i = 0; i < pad.size(); ++i) m.vm->WriteData(uint16_t(0x0300 + i), pad[i]);
        for (size_t i = 0; i < program.size(); ++i) m.vm->WriteData(uint16_t(0x0800 + i), program[i]);
        for (uint16_t a = 0x0400; a < 0x0500; ++a) m.vm->WriteData(a, 0);
        m.cpu->PC = 0x0800;
        m.run(200000);
        require(m.vm->PeekData(0x03fd) == 1, "Test program did not reach its poll loop");
        m.checking = true;
        // Caps Lock: the ROM answers with an LED command (ED <mask>) that the
        // keyboard clocks back in while the glue keeps scanning the pads.
        m.key(0x58, 0);
        for (uint64_t end = m.cycles + 400000;
             m.keyboard.phase != KeyboardPeer::Phase::Idle || !m.frames.empty()
             || m.keyboard.commands.size() < 2; )
        {
            require(m.cycles < end, "Caps Lock LED exchange timed out");
            m.step();
        }
        const auto& cmd = m.keyboard.commands;
        bool ledsOn = false;
        for (size_t i = 0; i + 1 < cmd.size(); ++i) ledsOn |= cmd[i] == 0xed && (cmd[i + 1] & 0x04);
        require(ledsOn, "Caps Lock did not produce an ED command with the Caps LED bit");
        m.run(100000);
        // "BRITISH ULTIMA" (space = $29), typed twice
        const std::array<uint8_t, 14> codes{0x32, 0x2d, 0x43, 0x2c, 0x43, 0x1b, 0x33, 0x29,
                                            0x3c, 0x4b, 0x2c, 0x43, 0x3a, 0x1c};
        const std::string word = "BRITISH ULTIMA";
        const std::string expected = word + word;
        unsigned n = 1;
        for (int pass = 0; pass < 2; ++pass)
            for (uint8_t code : codes) m.key(code, n++);
        m.run(100000);
        std::string got;
        for (uint16_t a = 0x0400; a < 0x0400 + 0x100 && m.vm->PeekData(a); ++a)
        {
            const char c = char(m.vm->PeekData(a) & 0x7f);
            got += char(c >= 'a' && c <= 'z' ? c - 32 : c);
        }
        require(got == expected, "Typed '" + expected + "' but the game received '" + got + "'");
        require(m.scans > 100, "The pad glue did not scan while keys arrived");
        require(m.nmisInScan > 0, "No keyboard NMI landed inside a pad scan (test too weak)");
        require(m.ledYChanges > 0, "The Caps Lock LED path never ran with a visible Y (test too weak)");

        // Phase 2: type while buttons are pressed and released on both pads.
        // Right (pad 1) on even letters, Start (pad 2) on odd ones; the game's
        // type-ahead count stays non-zero, so only presses send (no repeats).
        m.vm->WriteData(0x78, 1);
        const size_t start = got.size();
        const std::array<uint8_t, 7> word2{0x32, 0x2d, 0x43, 0x2c, 0x43, 0x1b, 0x33}; // BRITISH
        for (size_t i = 0; i < word2.size(); ++i)
        {
            m.vm->SetGamepadState(0, i % 2 == 0 ? 1u << 7 : 0);
            m.vm->SetGamepadState(1, i % 2 == 1 ? 1u << 3 : 0);
            m.key(word2[i], n++);
        }
        m.vm->SetGamepadState(0, 0);
        m.vm->SetGamepadState(1, 0);
        m.run(100000);
        std::string letters;
        unsigned rights = 0, starts = 0;
        for (uint16_t a = uint16_t(0x0400 + start); a < 0x0500 && m.vm->PeekData(a); ++a)
        {
            const uint8_t c = m.vm->PeekData(a) & 0x7f;
            if (c == 0x15) ++rights;
            else if (c == ' ') ++starts;
            else letters += char(c >= 'a' && c <= 'z' ? c - 32 : c);
        }
        require(letters == "BRITISH", "Typed BRITISH with the pads in use but the game received '" + letters + "'");
        require(rights == 4 && starts == 3, "Expected 4 Right and 3 Start presses, got " + std::to_string(rights)
            + " and " + std::to_string(starts));
        require(m.vm->PeekData(0xcafe) == 0, "ROM NMI nest count not back to zero");
        require(!m.vm->IsROMVisible(0x9000), "BASIC ROM left in after the scans");
        std::cout << "PASS native PS/2 " << period << "/" << hold << " with pad scans: Caps Lock LEDs, "
                  << got << ", " << m.scans << " scans, " << m.nmisInScan << " NMIs inside scans, "
                  << m.checkedInterrupts << " NMIs preserved registers, flags and overlay (Y excepted on "
                  << m.ledYChanges << " ROM LED-command NMIs); BRITISH typed with 4 Right + 3 Start presses on two pads\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << "FAIL: " << e.what() << "\n";
        return 1;
    }
}
