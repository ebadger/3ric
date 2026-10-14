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
        uint16_t nmiReturn, statePending;
        uint32_t period;
        bool checking = false;
        unsigned interrupts = 0, transitions = 0;
        std::array<unsigned, 256> characters{};
        std::array<bool, 5> banks{};
        std::string serial;
        struct Frame
        {
            uint16_t target, pc;
            uint8_t a, x, y, sp, p;
            MemoryReadMapping bank;
            bool basic;
        };
        std::vector<Frame> frames;

        Machine(const char* romPath, const char* diskPath, uint32_t bitPeriod,
            uint16_t returnPC, uint16_t pendingPC)
            : nmiReturn(returnPC), statePending(pendingPC), period(bitPeriod)
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
                    const auto port = vm->GetVIA1()->GetPortAOutput();
                    sd.SetCS(port & 0x10);
                    sd.SetMOSI(port & 0x04);
                    sd.SetSCK(port & 0x08);
                    vm->GetVIA1()->SetPortAInputBits(2, sd.GetMISO() ? 2 : 0);
                }
                if (checking && address == 0xc000 && (value & 0x80)) ++characters[value];
            };
            vm->Reset();
            run(5000000);
            require(vm->GetDriveEmulator()->GetDisk(0)->InsertDisk(diskPath), "Cannot insert disk");
            ascii("MON\rC600G\r");
            run(50000000);
            require(text().find("USE MOCKINGBOARD") != std::string::npos, "Disk did not reach sound prompt");
            require(vm->PeekData(0xcf00) == 0x48, "Disk did not load the input adapter");
            checking = true;
        }

        void step()
        {
            keyboard.tick();
            const bool executing = vm->WillExecuteCurrentInstruction();
            if (checking && executing && (cpu->PC == 0x1224 || vm->PeekData(cpu->PC) == 0))
                throw std::runtime_error("Unexpected BRK or NEXT stack underflow at " + std::to_string(cpu->PC));
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
                    if (frame.a != cpu->A || frame.x != cpu->X || frame.y != cpu->Y)
                        throw std::runtime_error("Input NMI corrupted A/X/Y; interrupted PC="
                            + std::to_string(frame.pc) + " target=" + std::to_string(frame.target)
                            + " expected=" + std::to_string(frame.a) + "," + std::to_string(frame.x)
                            + "," + std::to_string(frame.y) + " actual=" + std::to_string(cpu->A)
                            + "," + std::to_string(cpu->X) + "," + std::to_string(cpu->Y)
                            + " nesting=" + std::to_string(frames.size()));
                    require(frame.bank == vm->GetMemoryReadMapping(0xd000), "NMI restored the wrong RAM bank");
                    if (frame.basic != vm->IsROMVisible(0x9000))
                        throw std::runtime_error("NMI restored the wrong BASIC overlay; interrupted PC="
                            + std::to_string(frame.pc) + " target=" + std::to_string(frame.target)
                            + " CAFE=" + std::to_string(vm->PeekData(0xcafe))
                            + " nesting=" + std::to_string(frames.size()));
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
                banks[size_t(before.bank)] = true;
                if (before.pc == statePending) ++transitions;
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

        void seek(uint16_t pc, uint64_t budget)
        {
            const uint64_t end = cycles + budget;
            while ((cpu->PC != pc || !vm->WillExecuteCurrentInstruction()) && cycles < end) step();
            if (cycles >= end)
                throw std::runtime_error("Timed out at " + std::to_string(cpu->PC)
                    + ", waiting for " + std::to_string(pc));
        }

        std::string text()
        {
            std::string result;
            for (int row = 0; row < 24; ++row)
            {
                const unsigned base = 0x400 + (row & 7) * 128 + (row >> 3) * 40;
                for (int col = 0; col < 40; ++col) result += char(vm->PeekData(uint16_t(base + col)) & 0x7f);
                result += '\n';
            }
            return result;
        }

        void ascii(const std::string& value)
        {
            for (uint8_t ch : value)
            {
                require(!(vm->PeekData(0xc000) & 0x80), "Previous boot key not consumed");
                vm->WriteData(0xc000, ch | 0x80);
                run(300000);
            }
        }

        void scan(uint8_t value)
        {
            keyboard.scan(value, period, 80, [&] { step(); });
            run(160);
        }

        void key(uint8_t scanCode, uint8_t asciiCode)
        {
            const auto before = characters[asciiCode | 0x80];
            scan(scanCode);
            run(20000);
            scan(0xf0);
            scan(scanCode);
            run(20000);
            require(characters[asciiCode | 0x80] == before + 1, "Physical key was lost or duplicated");
            require(vm->PeekData(0xce00) == 0 && vm->PeekData(0xcb00 + scanCode) == 0,
                "PS/2 make/break framing did not return idle");
        }

        void lock(uint8_t scanCode, uint8_t leds)
        {
            const size_t before = keyboard.commands.size();
            scan(scanCode);
            run(300000);
            scan(0xf0);
            scan(scanCode);
            run(300000);
            const std::vector<uint8_t> expected{0xf0, 2, 0xed, leds, 0xf4};
            require(std::vector<uint8_t>(keyboard.commands.begin() + before, keyboard.commands.end()) == expected,
                "Wrong PS/2 lock-key command sequence");
            require(keyboard.leds == leds && vm->PeekData(0xce00) == 0
                && keyboard.phase == KeyboardPeer::Phase::Idle, "LED exchange or PS/2 framing stalled");
        }
    };
}

int main(int argc, char** argv)
{
    try
    {
        require(argc == 6, "Usage: native-test <rom> <patched.woz> <period> <nmi-return> <state-pending>");
        Machine m(argv[1], argv[2], uint32_t(std::stoul(argv[3])),
            uint16_t(std::stoul(argv[4], nullptr, 16)), uint16_t(std::stoul(argv[5], nullptr, 16)));
        m.key(0x35, 'Y');
        m.run(60000000);
        m.key(0x16, '1');
        m.run(40000000);
        m.lock(0x58, 4);
        m.lock(0x77, 6);
        m.lock(0x58, 2);
        m.lock(0x77, 0);
        m.key(0x5a, '\r');
        m.run(120000000);
        m.seek(0xaea2, 5000000);
        require(m.vm->PeekData(0x3a6) == 0x20, "Game overlay did not retain the bank wrapper");
        require(m.vm->PeekData(0xbf4b) == 0xcc, "DOS self-modifying bank trampoline was lost");
        for (unsigned i = 0; i < 80; ++i)
        {
            m.vm->SetGamepadState(0, uint16_t(1 << (4 + (i & 3))));
            m.run(i * 23 + 1);
            m.key(0x43, 'I');
        }
        m.vm->SetGamepadState(0, 0);
        m.run(100000);
        m.lock(0x58, 4);
        m.lock(0x58, 0);
        m.lock(0x77, 2);
        m.lock(0x77, 0);
        m.vm->SetGamepadState(0, 1);
        m.run(1000000);
        m.vm->SetGamepadState(0, 0);
        m.run(15000000);
        m.key(0x5a, '\r');
        m.run(5000000);
        require(m.vm->PeekData(0xcafe) == 0 && m.frames.empty(), "An input interrupt remained active");
        require(m.banks[2] && m.banks[3], "Input did not exercise both language-card banks");
        require(m.serial.find("3RIC", m.serial.find("C600G")) == std::string::npos,
            "Game reset into the system ROM");
        std::cout << "PASS native Silent Service PS/2 " << m.period << "/80: actual disk boot, "
            << "physical menu keys, 80 mixed-input make/break pairs, eight LED exchanges, "
            << m.interrupts << " preserving NMIs, " << m.transitions << " interrupted bank transitions\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL native Silent Service: " << error.what() << "\n";
        return 1;
    }
}
