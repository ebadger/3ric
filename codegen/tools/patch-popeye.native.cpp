#include "SDCard.h"
#include "vm.h"
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
        CPU* cpu = vm->GetCPU();
        SDCard sd;
        uint64_t cycles = 0, diskCycle = 0;
        uint32_t bitPeriod;
        uint16_t title, gameCall, gameEvent, readFire, inputReady, level, keyX, keyFire;
        bool checking = false;
        unsigned interrupts = 0, characters = 0;
        bool motorEnabled = false, spinupPending = false;
        uint64_t motorStarted = 0, lastSpinupRead = 0;
        unsigned spinupReads = 0, checkedRestarts = 0;
        std::string serial;
        struct Frame
        {
            uint16_t pc;
            uint8_t a, x, y, sp, flags;
            MemoryReadMapping mapping;
        };
        std::vector<Frame> frames;

        Machine(const char* romPath, const char* diskPath, uint32_t period, const uint16_t* symbols)
            : bitPeriod(period), title(symbols[0]), gameCall(symbols[1]), gameEvent(symbols[2]),
              readFire(symbols[3]), inputReady(symbols[4]), level(symbols[5]),
              keyX(symbols[6]), keyFire(symbols[7])
        {
            std::ifstream rom(romPath, std::ios::binary);
            require(bool(rom.read(reinterpret_cast<char*>(vm->GetData()), 65536)), "Cannot read ROM");
            std::copy_n(vm->GetData() + 0x9000, 0x3000, vm->GetBasicRom());
            vm->CallbackDebugString = [](char* message) { throw std::runtime_error(message); };
            vm->CallbackReceiveChar = [&](uint8_t value) { serial += char(value); };
            vm->CallbackSetSoftSwitches = [&](uint16_t address, bool, bool, bool, bool) {
                if (address >= 0xc0e0 && address <= 0xc0ef)
                {
                    diskAccess(address & 15);
                    vm->GetDriveEmulator()->AddCycles(uint32_t(cycles - diskCycle));
                    diskCycle = cycles;
                }
            };
            vm->CallbackWriteMemory = [&](uint16_t address, uint8_t value) {
                if (address == 0xc201 || address == 0xc20f)
                {
                    const uint8_t port = vm->GetVIA1()->GetPortAOutput();
                    sd.SetCS(port & 0x10);
                    sd.SetMOSI(port & 0x04);
                    sd.SetSCK(port & 0x08);
                    vm->GetVIA1()->SetPortAInputBits(2, sd.GetMISO() ? 2 : 0);
                }
                if (checking && address == 0xc000 && (value & 0x80)) ++characters;
            };
            vm->Reset();
            run(5000000);
            require(vm->GetDriveEmulator()->GetDisk(0)->InsertDisk(diskPath), "Cannot insert WOZ");
            ascii("MON\rC600G\r");
            seek(title, 80000000);
            checking = true;
            run(5000000);
            require(!motorEnabled, "Title should leave the disk motor switched off");
        }

        void diskAccess(uint8_t reg)
        {
            if (reg == 8)
            {
                motorEnabled = false;
                spinupPending = false;
            }
            else if (reg == 9)
            {
                if (checking) require(!motorEnabled, "Loader reissued motor-on while already enabled");
                motorEnabled = true;
                motorStarted = lastSpinupRead = cycles;
                spinupReads = 0;
                spinupPending = checking;
            }
            else if (spinupPending && reg == 12)
            {
                require(cycles - lastSpinupRead <= 250000, "Pico motor-start clock was not serviced");
                lastSpinupRead = cycles;
                ++spinupReads;
            }
            else if (checking && reg < 8)
            {
                require(motorEnabled, "Loader changed head phase while motor was disabled");
                if (spinupPending)
                {
                    require(cycles - motorStarted >= 1573438, "Head phase changed before motor spin-up completed");
                    require(spinupReads >= 8, "Spin-up did not clock the Pico through data-latch reads");
                    spinupPending = false;
                    ++checkedRestarts;
                }
            }
        }

        void step()
        {
            const bool executing = vm->WillExecuteCurrentInstruction();
            const Frame before{cpu->PC, cpu->A, cpu->X, cpu->Y, cpu->SP, cpu->flags.reg,
                vm->GetMemoryReadMapping(0xa000)};
            const bool returning = checking && executing && cpu->PC == 0xf1d5 && !frames.empty();
            if (returning)
            {
                const auto& frame = frames.back();
                require(frame.a == cpu->A && frame.x == cpu->X && frame.y == cpu->Y,
                    "ROM NMI corrupted A/X/Y");
                require(frame.mapping == vm->GetMemoryReadMapping(0xa000),
                    "ROM NMI did not restore supervisor RAM");
            }
            cycles += vm->Step();
            if (returning)
            {
                require(cpu->PC == frames.back().pc && cpu->SP == frames.back().sp,
                    "ROM NMI corrupted the return stack");
                require((cpu->flags.reg & 0xcf) == (frames.back().flags & 0xcf),
                    "ROM NMI corrupted flags");
                frames.pop_back();
                ++interrupts;
            }
            if (checking && !executing && cpu->PC == 0xf1bb && cpu->SP == uint8_t(before.sp - 3))
                frames.push_back(before);
            if (checking) require(vm->IsROMVisible(0xfffa), "Game hid the physical keyboard NMI vector");
        }

        void run(uint64_t budget)
        {
            const uint64_t end = cycles + budget;
            while (cycles < end) step();
        }

        void seek(uint16_t address, uint64_t budget = 5000000)
        {
            const uint64_t end = cycles + budget;
            while (cpu->PC != address || !vm->WillExecuteCurrentInstruction())
            {
                if (cycles >= end)
                    throw std::runtime_error("Timed out at " + std::to_string(cpu->PC) +
                        ", waiting for " + std::to_string(address));
                step();
            }
        }

        void ascii(const std::string& text)
        {
            for (uint8_t ch : text)
            {
                require(!(vm->PeekData(0xc000) & 0x80), "Previous boot character not consumed");
                vm->WriteData(0xc000, ch | 0x80);
                run(300000);
            }
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
            for (int i = 0; i < 11; ++i)
            {
                const uint64_t edge = cycles;
                vm->GetVIA1()->SetPortAInputBits(0xc0, bits[i] << 7);
                vm->SignalVIA1Pin(VIA::CA2);
                while (cycles < edge + bitPeriod / 2) step();
                vm->GetVIA1()->SetPortAInputBits(0x40, 0x40);
                while (cycles < edge + 80) step();
                vm->GetVIA1()->SetPortAInputBits(0xc0, (bits[i + 1] << 7) | 0x40);
                while (cycles < edge + bitPeriod) step();
            }
            run(3000);
        }

        void key(uint8_t code)
        {
            const unsigned before = characters;
            scan(code);
            scan(0xf0);
            scan(code);
            require(characters == before + 1, "Physical PS/2 character was lost or duplicated");
            require(vm->PeekData(0xce00) == 0, "PS/2 receiver did not finish a frame");
            run(30000);
        }

        int position() const
        {
            return vm->PeekData(0x94a0) * 7 + vm->PeekData(0x94a1);
        }

        void frame(uint16_t mask)
        {
            if (cpu->PC != readFire) seek(readFire);
            require(vm->SetGamepadState(0, mask), "Controller input rejected");
            step();
            seek(inputReady);
            step();
            seek(readFire);
        }
    };
}

int main(int argc, char** argv)
{
    try
    {
        require(argc == 12, "Usage: popeye-test ROM WOZ bit-period title game-call game-event fire ready level key-x key-fire");
        uint16_t symbols[8];
        for (int i = 0; i < 8; ++i) symbols[i] = uint16_t(std::stoul(argv[4 + i], nullptr, 16));
        Machine m(argv[1], argv[2], std::stoul(argv[3]), symbols);
        m.key(0x29);
        m.seek(m.gameCall, 80000000);
        require(!m.vm->IsROMVisible(0x9000), "Game RAM still resolves to BASIC ROM");
        require(m.vm->PeekData(m.level) == 1, "First level did not load");
        m.step();
        m.seek(m.readFire);
        for (int level = 1; level <= 3; ++level)
        {
            const int before = m.position();
            for (int i = 0; i < 6; ++i) m.frame(1 << 7);
            require(m.position() > before, "SNES did not move Popeye right");
            m.frame(0);
            const int stopped = m.position();
            for (int i = 0; i < 3; ++i) m.frame(0);
            require(m.position() == stopped, "Released controller did not stop Popeye");
            m.key(0x1c); // A
            m.seek(m.inputReady);
            require(m.vm->PeekData(m.keyX) == 127, "Physical A did not select left");
            m.step();
            for (int i = 0; i < 3; ++i) m.frame(0);
            require(m.position() < stopped, "Physical keyboard did not move Popeye left");
            m.key(0x22); // X
            m.seek(m.inputReady);
            require(m.vm->PeekData(m.keyX) == 105, "Physical X did not stop keyboard movement");
            m.step();
            m.key(0x29);
            m.seek(m.readFire);
            require(m.vm->PeekData(m.keyFire) > 0 ||
                m.vm->PeekData(0x9400) == 10 || m.vm->PeekData(0x9400) == 11,
                "Physical Space did not punch");
            for (int i = 0; i < 24; ++i)
            {
                m.vm->SetGamepadState(0, (i & 1) ? 1 << 6 : 1 << 7);
                m.key(0x22);
            }
            m.vm->SetGamepadState(0, 0);
            if (level == 3) break;
            m.vm->WriteData(0xea, 0);
            m.seek(m.gameEvent);
            require(m.vm->PeekData(0xfd) == 2, "Engine did not return the level-complete event");
            m.step();
            m.seek(m.gameCall, 80000000);
            require(m.vm->PeekData(m.level) == level + 1, "Native level loading failed");
            m.step();
            m.seek(m.readFire);
        }
        require(m.frames.empty() && m.vm->PeekData(0xcafe) == 0, "An NMI remained active");
        require(m.interrupts >= 2500, "Insufficient physical keyboard stress coverage");
        require(m.checkedRestarts == 3, "Did not check disk restart timing on all three levels");
        std::cout << "PASS native PS/2 period " << m.bitPeriod << ", data hold 80: cold disk boot, "
            << "three levels, SNES movement/release, " << m.characters << " make/break characters, "
            << m.interrupts << " register/flags/stack/bank-preserving NMIs, "
            << m.checkedRestarts << " timed/Pico-clocked motor restarts after delayed Start\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL " << error.what() << '\n';
        return 1;
    }
}
