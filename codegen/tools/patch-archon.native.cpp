#include "SDCard.h"
#include "vm.h"
#include "ps2-test-peer.h"
#include <algorithm>
#include <array>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
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
        KeyboardPeer keyboard{*vm, cycles};
        uint32_t period, hold;
        uint16_t nmiReturn, statePending, menuPad, gamePad, gamePadDone;
        bool checking = false, executing = false;
        unsigned checkedInterrupts = 0, transitionInterrupts = 0;
        std::array<unsigned, 256> characters{};
        struct Frame
        {
            uint16_t target, pc;
            uint8_t a, x, y, sp, p;
            MemoryReadMapping bank;
            bool basic;
        };
        std::vector<Frame> frames;
        std::string serial;

        Machine(const char* romPath, const char* diskPath, uint32_t bitPeriod, uint32_t dataHold,
            uint16_t returnPC, uint16_t pendingPC, uint16_t menuPC, uint16_t gamePC, uint16_t gameDone)
            : period(bitPeriod), hold(dataHold), nmiReturn(returnPC), statePending(pendingPC),
              menuPad(menuPC), gamePad(gamePC), gamePadDone(gameDone)
        {
            std::ifstream rom(romPath, std::ios::binary);
            require(bool(rom.read(reinterpret_cast<char*>(vm->GetData()), 65536)), "Cannot read ROM");
            std::copy_n(vm->GetData() + 0x9000, 0x3000, vm->GetBasicRom());
            vm->CallbackReceiveChar = [&](uint8_t value) { serial += char(value); };
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
                if (checking && address == 0xc000 && (value & 0x80)) ++characters[value];
            };
            vm->CallbackReadMemory = [&](uint16_t address) {
                if (checking && executing && !vm->IsROMVisible(0xfffa)
                    && (address == 0xfffa || address == 0xfffb))
                    throw std::runtime_error("Game reads the adapter's reserved NMI-vector bytes");
            };
            vm->Reset();
            run(5000000);
            require(vm->GetDriveEmulator()->GetDisk(0)->InsertDisk(diskPath), "Cannot insert disk");
            ascii("MON\r");
            require(serial.find('*') != std::string::npos, "Monitor entry failed");
            ascii("C600G\r");
            run(50000000);
            for (int i = 0; i < 5; ++i)
            {
                key(0x29);
                run(10000000);
            }
            seek(menuPad, 2000000);
            require(vm->PeekData(0xcf00) == 0x48, "Disk did not install its NMI adapter");
            require(!vm->IsROMVisible(0xfffa), "Menu did not retain its bank-safe vector");
            checking = true;
        }

        void step()
        {
            keyboard.tick();
            executing = vm->WillExecuteCurrentInstruction();
            const Frame before{0, cpu->PC, cpu->A, cpu->X, cpu->Y, cpu->SP, cpu->flags.reg,
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
                        "Input NMI corrupted A/X/Y");
                    require(frame.bank == vm->GetMemoryReadMapping(0xd000), "NMI restored the wrong RAM bank");
                    require(frame.basic == vm->IsROMVisible(0x9000), "NMI restored the wrong BASIC overlay");
                }
            }
            cycles += vm->Step();
            if (returning)
            {
                require(cpu->PC == frames.back().pc && cpu->SP == frames.back().sp, "Bad NMI return stack");
                require((cpu->flags.reg & 0xcf) == (frames.back().p & 0xcf), "NMI corrupted CPU flags");
                frames.pop_back();
                ++checkedInterrupts;
            }
            if (checking && !executing && (cpu->PC == 0xcf00 || cpu->PC == 0xf1bb)
                && cpu->SP == uint8_t(before.sp - 3))
            {
                Frame frame = before;
                frame.target = cpu->PC;
                frames.push_back(frame);
                if (before.pc == statePending) ++transitionInterrupts;
            }
            if (checking && !vm->IsROMVisible(0xfffa))
                require((vm->PeekData(0xfffa) | vm->PeekData(0xfffb) << 8) == 0xcf00,
                    "Mapped RAM lost the NMI vector");
        }

        void run(uint64_t budget)
        {
            const uint64_t end = cycles + budget;
            while (cycles < end) step();
        }

        void seek(uint16_t target, uint64_t budget)
        {
            const uint64_t end = cycles + budget;
            while ((cpu->PC != target || !vm->WillExecuteCurrentInstruction()) && cycles < end) step();
            if (cycles >= end)
                throw std::runtime_error("Timed out at " + std::to_string(cpu->PC) + ", waiting for " + std::to_string(target));
        }

        void ascii(const std::string& text)
        {
            for (uint8_t ch : text)
            {
                require(!(vm->PeekData(0xc000) & 0x80), "Previous boot key not consumed");
                vm->WriteData(0xc000, ch | 0x80);
                run(300000);
            }
        }

        void scan(uint8_t code)
        {
            const uint32_t dataHold = checking ? hold : period;
            keyboard.scan(code, period, dataHold, [&] { step(); });
            run(160);
        }

        void key(uint8_t code)
        {
            scan(code);
            run(20000);
            scan(0xf0);
            scan(code);
            run(20000);
        }

        void lock(uint8_t code, uint8_t leds)
        {
            const size_t before = keyboard.commands.size();
            key(code);
            const uint64_t end = cycles + 300000;
            while (keyboard.commands.size() < before + 5
                || keyboard.phase != KeyboardPeer::Phase::Idle || !frames.empty())
            {
                require(cycles < end, "PS/2 LED exchange timed out");
                step();
            }
            const std::vector<uint8_t> expected{0xf0, 2, 0xed, leds, 0xf4};
            require(std::vector<uint8_t>(keyboard.commands.begin() + before, keyboard.commands.end()) == expected,
                "Wrong PS/2 lock-key command sequence");
            require(keyboard.leds == leds && vm->PeekData(0xce00) == 0, "Wrong LED state or lost PS/2 framing");
        }

        void moveMenu(uint8_t x, uint8_t y)
        {
            const uint64_t end = cycles + 30000000;
            while (std::abs(int(vm->PeekData(0xa8)) - x) > 2 || std::abs(int(vm->PeekData(0xa9)) - y) > 2)
            {
                unsigned mask = 0;
                if (vm->PeekData(0xa8) < x - 2) mask |= 1 << 7;
                if (vm->PeekData(0xa8) > x + 2) mask |= 1 << 6;
                if (vm->PeekData(0xa9) < y - 2) mask |= 1 << 5;
                if (vm->PeekData(0xa9) > y + 2) mask |= 1 << 4;
                vm->SetGamepadState(0, uint16_t(mask));
                run(5000);
                require(cycles < end, "Menu cursor did not reach its target");
            }
            vm->SetGamepadState(0, 0);
            run(100000);
        }

        void stress(unsigned count)
        {
            for (unsigned i = 0; i < count; ++i)
            {
                vm->SetGamepadState(0, uint16_t(1 << (4 + (i & 3))));
                run(i * 19 + 1);
                const auto before = characters[0xc9];
                key(0x43);
                require(characters[0xc9] == before + 1, "Physical I key was lost or duplicated");
                require(vm->PeekData(0xce00) == 0 && vm->PeekData(0xce01) == 0x43
                    && vm->PeekData(0xcb43) == 0, "Make/break pair lost PS/2 framing");
            }
            vm->SetGamepadState(0, 0);
            run(100000);
        }
    };
}

int main(int argc, char** argv)
{
    try
    {
        require(argc == 10, "Usage: native-test <rom> <patched.woz> <period> <hold> <nmi-return> <state-pending> <menu-pad> <game-pad> <game-done>");
        const auto number = [&](int i) { return uint16_t(std::stoul(argv[i], nullptr, 16)); };
        const uint32_t period = uint32_t(std::stoul(argv[3]));
        const uint32_t hold = uint32_t(std::stoul(argv[4]));
        require(hold >= period / 2 && hold <= period, "Invalid PS/2 timing");
        Machine m(argv[1], argv[2], period, hold, number(5), number(6), number(7), number(8), number(9));
        m.stress(160);
        m.vm->SetGamepadState(0, 1 << 7);
        m.lock(0x58, 4);
        m.lock(0x77, 6);
        m.lock(0x58, 2);
        m.lock(0x77, 0);
        m.vm->SetGamepadState(0, 0);
        m.moveMenu(120, 185);
        m.vm->SetGamepadState(0, 1);
        m.seek(0xc800, 80000000);
        m.vm->SetGamepadState(0, 0);
        m.step();
        m.seek(m.gamePad, 30000000);
        m.stress(80);
        m.vm->SetGamepadState(0, 1 << 6);
        m.lock(0x58, 4);
        m.lock(0x58, 0);
        m.lock(0x77, 2);
        m.lock(0x77, 0);
        m.vm->SetGamepadState(0, 0);
        m.seek(m.gamePadDone, 20000000);
        require(m.vm->PeekData(0xcafe) == 0 && m.frames.empty(), "An input interrupt remained active");
        std::cout << "PASS native PS/2 " << period << "/" << hold
            << ": 240 mixed-input make/break pairs, eight LED exchanges, "
            << m.checkedInterrupts << " register/bank-preserving NMIs, "
            << m.transitionInterrupts << " interrupted bank transitions; actual disk menu and board\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL native Archon: " << error.what() << "\n";
        return 1;
    }
}
