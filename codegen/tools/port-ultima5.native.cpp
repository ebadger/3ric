// Native PS/2 timing test for the Ultima V resident NMI path.
// Built and run by codegen/tools/port-ultima5.native.ps1.
//
// A small 6502 program keeps language-card RAM mapped (like Ultima V), points
// the RAM NMI/IRQ vectors at the resident, alternates bank 1/bank 2 between
// keystrokes and collects $C000 characters. Caps Lock must complete the ROM's
// LED command exchange, and a $C010 strobe on a stop-bit edge must not be lost. Scan codes arrive as real PS/2
// frames on VIA1 CA2/PA7 at a given bit period with DATA changing a given
// number of cycles after each falling clock edge. Every NMI must return with
// A/X/Y, flags, stack, language-card bank and BASIC overlay unchanged.
//
// Also used by codegen/tools/patch-fs2.native.ps1 with its own resident and
// program. An optional last argument lists resume PCs (hex, comma-separated)
// where the program has recorded a bank but not yet selected it; an NMI that
// resumes exactly there may return with that recorded bank already mapped.
#include "SDCard.h"
#include "vm.h"
#include <algorithm>
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

    struct Machine
    {
        std::unique_ptr<VM> vm = std::make_unique<VM>(false);
        CPU* cpu = vm->GetCPU();
        uint64_t cycles = 0;
        KeyboardPeer keyboard{*vm, cycles};
        uint32_t period, hold;
        uint16_t nmiEntry;
        bool checking = false;
        unsigned checkedInterrupts = 0;
        std::vector<uint16_t> bankWindows;
        unsigned windowInterrupts = 0;
        struct Frame
        {
            uint16_t pc;
            uint8_t a, x, y, sp, p;
            MemoryReadMapping bank;
            bool basic;
        };
        std::vector<Frame> frames;

        Machine(const char* romPath, uint32_t bitPeriod, uint32_t dataHold, uint16_t entry)
            : period(bitPeriod), hold(dataHold), nmiEntry(entry)
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
            const Frame before{cpu->PC, cpu->A, cpu->X, cpu->Y, cpu->SP, cpu->flags.reg,
                vm->GetMemoryReadMapping(0xd000), vm->IsROMVisible(0x9000)};
            cycles += vm->Step();
            if (!checking) return;
            if (!executing && cpu->PC == nmiEntry && cpu->SP == uint8_t(before.sp - 3))
            {
                frames.push_back(before);
                return;
            }
            if (!frames.empty() && cpu->PC == frames.back().pc && cpu->SP == frames.back().sp)
            {
                const Frame& f = frames.back();
                require(f.a == cpu->A && f.x == cpu->X && f.y == cpu->Y, "NMI corrupted A/X/Y");
                require((f.p & 0xcf) == (cpu->flags.reg & 0xcf), "NMI corrupted CPU flags");
                if (f.bank != vm->GetMemoryReadMapping(0xd000))
                {
                    require(std::find(bankWindows.begin(), bankWindows.end(), f.pc) != bankWindows.end(),
                        "NMI restored the wrong language-card bank");
                    ++windowInterrupts;
                }
                require(f.basic == vm->IsROMVisible(0x9000), "NMI changed the BASIC overlay");
                frames.pop_back();
                ++checkedInterrupts;
            }
        }

        void run(uint64_t budget)
        {
            const uint64_t end = cycles + budget;
            while (cycles < end) step();
        }

        void scan(uint8_t code, bool strobeAtStop = false)
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
                if (strobeAtStop && i == 10) vm->SignalVIA1Pin(VIA::CB1); // $C010 on the same edge
                while (cycles < edge + period / 2) step();
                vm->GetVIA1()->SetPortAInputBits(0x40, 0x40);
                while (cycles < edge + hold) step();
                vm->GetVIA1()->SetPortAInputBits(0xc0, (bits[i + 1] << 7) | 0x40);
                while (cycles < edge + period) step();
            }
            run(160);
        }

        void key(uint8_t code)
        {
            scan(code);
            run(20000);
            scan(0xf0);
            scan(code);
            run(40000);
        }
    };
}

int main(int argc, char** argv)
{
    try
    {
        require(argc == 7 || argc == 8,
            "Usage: u5-native <rom> <resident.bin> <program.bin> <nmi-entry-hex> <period> <hold> [window-pcs-hex]");
        const auto resident = readFile(argv[2]);
        const auto program = readFile(argv[3]);
        const uint16_t entry = uint16_t(std::stoul(argv[4], nullptr, 16));
        const uint32_t period = uint32_t(std::stoul(argv[5]));
        const uint32_t hold = uint32_t(std::stoul(argv[6]));
        require(hold >= period / 2 && hold <= period, "Invalid PS/2 timing");
        Machine m(argv[1], period, hold, entry);
        if (argc == 8)
        {
            std::string list = argv[7];
            for (size_t pos = 0; pos < list.size(); )
            {
                const size_t comma = (std::min)(list.find(',', pos), list.size());
                m.bankWindows.push_back(uint16_t(std::stoul(list.substr(pos, comma - pos), nullptr, 16)));
                pos = comma + 1;
            }
        }
        for (size_t i = 0; i < resident.size(); ++i) m.vm->WriteData(uint16_t(0xcf00 + i), resident[i]);
        for (size_t i = 0; i < program.size(); ++i) m.vm->WriteData(uint16_t(0x0800 + i), program[i]);
        for (uint16_t a = 0x0300; a < 0x0400; ++a) m.vm->WriteData(a, 0);
        m.cpu->PC = 0x0800;
        m.run(200000);
        require(m.vm->PeekData(0x03fd) == 1, "Test program did not reach its key loop");
        m.checking = true;
        // Caps Lock: the ROM answers with an LED command (ED <mask>) that the
        // keyboard clocks back in, all while language-card RAM stays mapped.
        m.key(0x58);
        for (uint64_t end = m.cycles + 400000;
             m.keyboard.phase != KeyboardPeer::Phase::Idle || !m.frames.empty()
             || m.keyboard.commands.size() < 2; )
        {
            if (m.cycles >= end)
            {
                std::string s;
                for (auto c : m.keyboard.commands) s += " " + std::to_string(c);
                throw std::runtime_error("Caps Lock LED exchange timed out: phase " + std::to_string(int(m.keyboard.phase))
                    + " frames " + std::to_string(m.frames.size()) + " cmds" + s + " PC " + std::to_string(m.cpu->PC)
                    + " KBSTATE " + std::to_string(m.vm->PeekData(0xce00)) + " LEDS " + std::to_string(m.vm->PeekData(0xce18)));
            }
            m.step();
        }
        const auto& cmd = m.keyboard.commands;
        bool ledsOn = false;
        for (size_t i = 0; i + 1 < cmd.size(); ++i) ledsOn |= cmd[i] == 0xed && (cmd[i + 1] & 0x04);
        require(ledsOn, "Caps Lock did not produce an ED command with the Caps LED bit");
        m.run(100000);
        // U L T I M A 5
        const std::array<uint8_t, 7> codes{0x3c, 0x4b, 0x2c, 0x43, 0x3a, 0x1c, 0x2e};
        const std::string expected = "ULTIMA5";
        for (uint8_t code : codes) m.key(code);
        m.run(100000);
        std::string got;
        for (uint16_t a = 0x0300; a < 0x0300 + expected.size(); ++a)
        {
            const char c = char(m.vm->PeekData(a) & 0x7f);
            got += char(c >= 'a' && c <= 'z' ? c - 32 : c);
        }
        require(m.vm->PeekData(0x03fe) != 0xee, "Language-card bank marker changed after a keystroke");
        require(got == expected, "Typed ULTIMA5 but the program received '" + got + "'");
        require(m.checkedInterrupts > 200, "Too few NMIs were checked");
        // The program has stopped polling. A $C010 strobe that lands on a
        // stop-bit edge must still clear $C000 (the ROM's exit writes $7F to IFR).
        m.vm->WriteData(0xc000, 0xc1);
        m.scan(0xf0, true);
        m.run(20000);
        require(!(m.vm->PeekData(0xc000) & 0x80), "A $C010 strobe on a PS/2 stop bit was lost");
        m.scan(0x1c);
        m.run(40000);
        std::cout << "PASS native PS/2 " << period << "/" << hold << ": Caps Lock LEDs, " << got
                  << ", strobe on stop bit, " << m.checkedInterrupts
                  << " NMIs preserved registers, flags, bank and overlay";
        if (!m.bankWindows.empty())
            std::cout << " (" << m.windowInterrupts << " in a recorded-bank window)";
        std::cout << "\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << "FAIL: " << e.what() << "\n";
        return 1;
    }
}
