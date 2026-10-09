#include "SDCard.h"
#include "vm.h"
#include <algorithm>
#include <array>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace
{
    void require(bool condition, const char* message)
    {
        if (!condition) throw std::runtime_error(message);
    }

    struct Machine
    {
        std::unique_ptr<VM> vm = std::make_unique<VM>(false);
        SDCard sd;
        CPU* cpu = vm->GetCPU();
        uint64_t cycles = 0, diskCycle = 0;
        uint32_t period, hold;
        uint16_t nmiReturn, statePending;
        bool checking = false, executing = false;
        unsigned interrupts = 0, transitions = 0, epilogueTransitions = 0;
        std::array<unsigned, 256> characters{};
        std::string translated;
        std::string operation = "boot";
        struct Frame
        {
            uint16_t target, pc;
            uint8_t a, x, y, sp, p, bankingDepth;
            MemoryReadMapping bank;
            bool basic;
        };
        std::vector<Frame> frames;

        Machine(const char* romPath, const char* diskPath, uint32_t bitPeriod,
            uint32_t dataHold, uint16_t returnPC, uint16_t pendingPC)
            : period(bitPeriod), hold(dataHold), nmiReturn(returnPC), statePending(pendingPC)
        {
            std::ifstream rom(romPath, std::ios::binary);
            require(bool(rom.read(reinterpret_cast<char*>(vm->GetData()), 65536)), "Cannot read ROM");
            std::copy_n(vm->GetData() + 0x9000, 0x3000, vm->GetBasicRom());
            vm->CallbackReceiveChar = [](uint8_t) {};
            vm->CallbackDebugString = [](char* text) { throw std::runtime_error(text); };
            vm->CallbackSetSoftSwitches = [&](uint16_t address, bool, bool, bool, bool) {
                if (address >= 0xc0e0 && address <= 0xc0ef)
                {
                    vm->GetDriveEmulator()->AddCycles(uint32_t(cycles - diskCycle));
                    diskCycle = cycles;
                }
            };
            vm->CallbackWriteMemory = [&](uint16_t address, uint8_t value) {
                if (address == 0xc201 || address == 0xc20f)
                {
                    const uint8_t reg = vm->GetVIA1()->GetPortAOutput();
                    sd.SetCS(reg & 0x10);
                    sd.SetMOSI(reg & 0x04);
                    sd.SetSCK(reg & 0x08);
                    vm->GetVIA1()->SetPortAInputBits(2, sd.GetMISO() ? 2 : 0);
                }
                if (checking && address == 0xc000 && (value & 0x80))
                {
                    ++characters[value];
                    translated += char(value & 127);
                }
                require(!checking || (address != 0xfffa && address != 0xfffb),
                    "VisiCalc overwrote the reserved NMI vector");
            };
            vm->CallbackReadMemory = [&](uint16_t address) {
                require(!checking || !executing || vm->IsROMVisible(address)
                    || (address != 0xfffa && address != 0xfffb),
                    "VisiCalc used its reserved NMI vector as data");
            };
            vm->Reset();
            run(5000000);
            require(vm->GetDriveEmulator()->GetDisk(0)->InsertDisk(diskPath), "Cannot insert disk");
            for (uint8_t ch : std::string("MON\rC600G\r"))
            {
                require(!(vm->PeekData(0xc000) & 0x80), "Boot key not consumed");
                vm->WriteData(0xc000, ch | 0x80);
                run(300000);
            }
            waitFor("VC-208B0-AP2");
            run(1000000);
            require(!vm->IsROMVisible(0xfffa) && vm->PeekData(0xfffb) == 0xcf,
                "Disk did not install the RAM NMI adapter");
            checking = true;
        }

        void step()
        {
            executing = vm->WillExecuteCurrentInstruction();
            const Frame before{0, cpu->PC, cpu->A, cpu->X, cpu->Y, cpu->SP, cpu->flags.reg, vm->PeekData(0xcafe),
                vm->GetMemoryReadMapping(0xd000), vm->IsROMVisible(0x9000)};
            bool returning = false;
            if (checking && executing && !frames.empty())
            {
                const auto& frame = frames.back();
                returning = (frame.target == 0xcf00 && cpu->PC == uint16_t(nmiReturn + 1))
                    || (frame.target == 0xf1bb && cpu->PC == 0xf1d5);
                if (returning)
                {
                    require(frame.a == cpu->A && frame.x == cpu->X && frame.y == cpu->Y,
                        "NMI corrupted A/X/Y");
                    require(frame.bank == vm->GetMemoryReadMapping(0xd000), "NMI restored the wrong RAM bank");
                    require(frame.bankingDepth == vm->PeekData(0xcafe), "NMI corrupted the ROM banking depth");
                    // Nested ROM NMIs can complete the outer epilogue's pending C007
                    // after its DEC CAFE reaches zero. Its next BNE/BIT still runs in upper ROM.
                    const bool romEpilogue = frame.target == 0xf1bb
                        && (frame.pc == 0xf1c9 || frame.pc == 0xf1cb)
                        && frame.bankingDepth == 0 && (frame.p & 2)
                        && frame.basic && !vm->IsROMVisible(0x9000);
                    if (romEpilogue) ++epilogueTransitions;
                    if (frame.basic != vm->IsROMVisible(0x9000) && !romEpilogue)
                        throw std::runtime_error("NMI BASIC overlay mismatch: interrupted PC="
                            + std::to_string(frame.pc) + " entry=" + std::to_string(frame.target)
                            + " return=" + std::to_string(cpu->PC) + " before=" + std::to_string(frame.basic)
                            + " after=" + std::to_string(vm->IsROMVisible(0x9000))
                            + " CAFE=" + std::to_string(vm->PeekData(0xcafe))
                            + " depth=" + std::to_string(frames.size()) + " operation=" + operation
                            + "\n" + screen());
                }
            }
            cycles += vm->Step();
            if (returning)
            {
                require(cpu->PC == frames.back().pc && cpu->SP == frames.back().sp, "Bad NMI return stack");
                require((cpu->flags.reg & 0xcf) == (frames.back().p & 0xcf), "NMI corrupted CPU flags");
                frames.pop_back();
                ++interrupts;
            }
            if (checking && !executing && (cpu->PC == 0xcf00 || cpu->PC == 0xf1bb)
                && cpu->SP == uint8_t(before.sp - 3))
            {
                Frame frame = before;
                frame.target = cpu->PC;
                frames.push_back(frame);
                if (before.pc == statePending) ++transitions;
            }
            if (checking && !vm->IsROMVisible(0xfffa))
                require((vm->PeekData(0xfffa) | vm->PeekData(0xfffb) << 8) == 0xcf00,
                    "RAM lost its NMI vector");
        }

        void run(uint64_t budget)
        {
            const uint64_t end = cycles + budget;
            while (cycles < end) step();
        }

        std::string row(unsigned r)
        {
            std::string text;
            for (unsigned col = 0; col < 40; ++col)
            {
                const uint8_t b = vm->PeekData(uint16_t(0x400 + (r & 7) * 128 + (r >> 3) * 40 + col)) & 127;
                text += char(b < 32 ? b + 64 : b);
            }
            return text;
        }

        std::string screen()
        {
            std::string text;
            for (unsigned r = 0; r < 24; ++r) text += row(r) + "\n";
            return text;
        }

        void expectRow(unsigned r, const std::string& text)
        {
            if (row(r).find(text) == std::string::npos)
                throw std::runtime_error("Expected row " + std::to_string(r) + " to contain " + text + "\n" + screen());
        }

        void waitFor(const std::string& text)
        {
            const uint64_t end = cycles + 80000000;
            while (screen().find(text) == std::string::npos && cycles < end) run(1000000);
            if (screen().find(text) == std::string::npos)
                throw std::runtime_error("Timed out waiting for " + text + "\n" + screen());
        }

        void scan(uint8_t code, int bankAtStop = -1)
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
                uint64_t edge = start + uint64_t(i) * period;
                while (cycles < edge) step();
                if (i == 10 && bankAtStop >= 0)
                {
                    // Hold the stop bit until the exact bank-selection boundary.
                    const uint64_t end = cycles + 100000;
                    while ((cpu->PC != statePending || cpu->X != bankAtStop
                        || !vm->WillExecuteCurrentInstruction()) && cycles < end) step();
                    require(cycles < end, "Bank transition not reached");
                    edge = cycles;
                }
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

        void release(uint8_t code) { scan(0xf0); scan(code); }

        void key(uint8_t code)
        {
            scan(code);
            run(120000);
            release(code);
            run(120000);
            require(vm->PeekData(0xce00) == 0 && vm->PeekData(0xcb00 + code) == 0,
                "PS/2 make/break framing or release failed");
        }

        std::pair<uint8_t, bool> stroke(char c)
        {
            static constexpr uint8_t letters[]{
                0x1c, 0x32, 0x21, 0x23, 0x24, 0x2b, 0x34, 0x33, 0x43,
                0x3b, 0x42, 0x4b, 0x3a, 0x31, 0x44, 0x4d, 0x15, 0x2d,
                0x1b, 0x2c, 0x3c, 0x2a, 0x1d, 0x22, 0x35, 0x1a};
            static constexpr uint8_t digits[]{0x45, 0x16, 0x1e, 0x26, 0x25, 0x2e, 0x36, 0x3d, 0x3e, 0x46};
            if (c >= 'A' && c <= 'Z') return {letters[c - 'A'], false};
            if (c >= '0' && c <= '9') return {digits[c - '0'], false};
            switch (c)
            {
            case '\r': return {0x5a, false};
            case '\x1b': return {0x76, false};
            case '/': return {0x4a, false};
            case '.': return {0x49, false};
            case ' ': return {0x29, false};
            case '>': return {0x49, true};
            case '+': return {0x55, true};
            case '=': return {0x55, false};
            case '*': return {0x3e, true};
            case '"': return {0x52, true};
            case '@': return {0x1e, true};
            case '(': return {0x46, true};
            case ')': return {0x45, true};
            default: throw std::runtime_error("Unmapped test key");
            }
        }

        void type(const std::string& text)
        {
            for (char c : text)
            {
                operation = "typing " + std::to_string(uint8_t(c)) + " in " + text;
                require(!(vm->PeekData(0xc000) & 0x80), "Previous application key not consumed");
                const auto [code, shift] = stroke(c);
                const size_t before = translated.size();
                if (shift) { scan(0x12); run(20000); }
                key(code);
                if (shift) { release(0x12); run(20000); }
                const std::string expected = c == '+' ? "=+" : std::string(1, c);
                if (translated.substr(before) != expected)
                    throw std::runtime_error("PS/2 translation for " + std::to_string(uint8_t(c))
                        + ": received " + translated.substr(before) + "\n" + screen());
            }
        }

        void bankStress()
        {
            operation = "bank stress";
            require(frames.empty(), "Application left an unfinished interrupt");
            // A separate synthetic caller exercises the application's real bank selector.
            const uint8_t driver[]{0x20, 0xc3, 0x08, 0x20, 0xc8, 0x08, 0xad, 0, 0xc0,
                0x10, 3, 0x2c, 0x10, 0xc0, 0x4c, 0, 2};
            std::copy(std::begin(driver), std::end(driver), vm->GetData() + 0x200);
            cpu->PC = 0x200;
            for (int i = 0; i < 2; ++i)
            {
                scan(0x43, i == 0 ? 3 : 11);
                run(20000);
                release(0x43);
                run(20000);
            }
            for (int i = 0; i < 160; ++i)
            {
                run(i * 19 + 1);
                const unsigned before = characters[0xc9];
                key(0x43);
                require(characters[0xc9] == before + 1, "Physical I key lost or duplicated during banking");
            }
            type("=+");
            const size_t before = translated.size();
            scan(0x59);
            run(20000);
            key(0x55);
            release(0x59);
            run(20000);
            require(translated.substr(before) == "=+", "Right Shift+= did not produce plus");
            require(transitions >= 2, "Switch/state-store boundary was not interrupted");
            require(frames.empty() && vm->PeekData(0xcafe) == 0, "Input interrupt did not finish");
        }
    };
}

int main(int argc, char** argv)
{
    try
    {
        require(argc == 7, "Usage: native-test <rom> <patched.woz> <period> <hold> <nmi-return> <state-pending>");
        const auto number = [&](int i) { return uint16_t(std::stoul(argv[i], nullptr, 16)); };
        const uint32_t period = uint32_t(std::stoul(argv[3])), hold = uint32_t(std::stoul(argv[4]));
        require(hold >= period / 2 && hold <= period, "Invalid PS/2 timing");
        Machine m(argv[1], argv[2], period, hold, number(5), number(6));
        m.type("123\r>B1\r+A1*2\r>A1\r456\r");
        m.expectRow(4, "456      912");
        m.type(">C1\r1.25\r>D1\r+C1*2\r>A2\r\"3RIC\r>B2\r@SUM(A1...B1)\r");
        m.expectRow(4, "1.25      2.5");
        require(m.row(5).find("3RIC") != std::string::npos && m.row(5).find("1368") != std::string::npos,
            "Native label/range formula failed");
        m.type("/CY");
        m.run(3000000);
        m.type("/SLBUDGET.VC\r");
        m.waitFor("HOME BUDGET MODEL");
        m.run(3000000);
        m.type(">B3\r600\r>B12\r");
        require(m.screen().find("407") != std::string::npos, "Native budget loading/recalculation failed");
        m.type("/SS3RICTEST\r");
        m.waitFor("ERROR: WRITE PROTECTED");
        m.type("\x1b");
        m.bankStress();
        std::cout << "PASS native PS/2 " << period << "/" << hold
            << ": actual disk boot, spreadsheet edits, formulas, budget loading and save rejection; "
            << "160 synthetic bank-stress make/break pairs, " << m.interrupts
            << " register/flags/stack/bank-preserving NMIs, " << m.transitions << " interrupted bank transitions, "
            << m.epilogueTransitions << " safe nested ROM-epilogue transitions\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL native VisiCalc: " << error.what() << "\n";
        return 1;
    }
}
