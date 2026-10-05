#include "SDCard.h"
#include "vm.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>

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
        unsigned packets = 0;
        std::string serial;
        std::array<unsigned, 256> characters{};

        Machine(const char* romPath, const char* diskPath)
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
                if (address == 0xc000 && (value & 0x80)) ++characters[value];
                if (address == 0xc201 || address == 0xc20f)
                {
                    const uint8_t reg = vm->GetVIA1()->GetPortAOutput();
                    sd.SetCS(reg & 0x10);
                    sd.SetMOSI(reg & 0x04);
                    sd.SetSCK(reg & 0x08);
                    vm->GetVIA1()->SetPortAInputBits(2, sd.GetMISO() ? 2 : 0);
                }
            };
            vm->Reset();
            run(5000000);
            require(serial.find("3RIC 6502") != std::string::npos, "ROM did not cold-boot");
            require(vm->GetDriveEmulator()->GetDisk(0)->InsertDisk(diskPath), "Cannot insert disk");
            for (uint8_t ch : std::string("MON\rC600G\r"))
            {
                require(!(peek(0xc000) & 0x80), "Previous boot key not consumed");
                vm->WriteData(0xc000, ch | 0x80);
                run(300000);
            }
            seek(0x0c44);
        }

        uint8_t peek(uint16_t address) { return vm->PeekData(address); }
        void step() { cycles += vm->Step(); }

        void expect(uint16_t address, uint8_t value, const char* message)
        {
            if (peek(address) != value)
            {
                std::cerr << message << ": PC=" << std::hex << cpu->PC << " [$" << address
                    << "]=" << unsigned(peek(address)) << ", keyboard=" << unsigned(peek(0xc000))
                    << ", decoded keys";
                for (size_t i = 0; i < characters.size(); ++i)
                    if (characters[i]) std::cerr << " " << i << ":" << characters[i];
                std::cerr << std::dec << '\n';
                throw std::runtime_error(message);
            }
        }

        void run(uint64_t budget)
        {
            const uint64_t end = cycles + budget;
            while (cycles < end) step();
        }

        void seek(uint16_t address, uint64_t budget = 50000000)
        {
            const uint64_t end = cycles + budget;
            while (cpu->PC != address || !vm->WillExecuteCurrentInstruction())
            {
                require(cycles < end, "Execution checkpoint timed out");
                step();
            }
        }

        void scan(uint8_t code)
        {
            std::array<uint8_t, 11> bits{};
            uint8_t parity = 1;
            for (int i = 0; i < 8; ++i)
            {
                bits[i + 1] = (code >> i) & 1;
                parity ^= bits[i + 1];
            }
            bits[9] = parity;
            bits[10] = 1;
            for (uint8_t bit : bits)
            {
                vm->GetVIA1()->SetPortAInputBits(0xc0, bit << 7);
                vm->SignalVIA1Pin(VIA::CA2);
                run(80);
                vm->GetVIA1()->SetPortAInputBits(0x40, 0x40);
                run(80);
            }
            run(1000);
            ++packets;
        }

        void key(uint8_t code)
        {
            require(!(peek(0xc000) & 0x80), "Previous physical key not consumed");
            scan(code);
            run(20000);
            scan(0xf0);
            scan(code);
            run(20000);
        }

        void settleKey()
        {
            const uint64_t end = cycles + 5000000;
            while (peek(0xc000) & 0x80)
            {
                require(cycles < end, "Game did not consume the physical key");
                step();
            }
            run(10000);
        }

        std::string text()
        {
            std::string result;
            for (int row = 0; row < 24; ++row)
            {
                for (int col = 0; col < 40; ++col)
                {
                    const uint8_t ch = peek(uint16_t(0x400 + (row & 7) * 128 + (row >> 3) * 40 + col)) & 127;
                    result += ch >= 32 ? char(ch) : ' ';
                }
                result += '\n';
            }
            return result;
        }
    };
}

int main(int argc, char** argv)
{
    try
    {
        require(argc == 3, "Usage: wolf-native-test <rom> <patched.woz>");
        Machine m(argv[1], argv[2]);
        m.key(0x5a); // Return
        m.seek(0x0a4a);
        require(m.text().find("TAPER K --> CLAVIER") != std::string::npos, "Keyboard menu missing");
        m.step();
        m.run(10000);
        m.key(0x42); // K
        m.seek(0x119c);
        require(m.peek(0x4347) == 10, "Castle inventory did not load");
        const uint8_t tile = m.peek(0x4343);
        m.key(0x1c); // A: move left
        m.settleKey();
        m.run(100000);
        m.expect(0x4341, 4, "PS/2 movement key was not decoded");
        m.key(0x1b); // S: stop
        m.settleKey();
        m.run(100000);
        m.expect(0x4341, 0, "PS/2 stop key was not decoded");
        require(m.peek(0x4343) != tile, "Player did not move");
        m.key(0x4c); // Semicolon: aim right
        m.settleKey();
        m.run(100000);
        m.expect(0x4342, 8, "PS/2 aim key was not decoded");
        require(m.vm->EnableAudio(44100), "Audio could not be enabled");
        m.key(0x4b); // L: fire
        float peak = 0;
        const uint64_t shotDeadline = m.cycles + 3000000;
        do
        {
            m.run(10000);
            for (float sample : m.vm->DrainAudio())
            {
                require(std::isfinite(sample), "Invalid speaker PCM");
                peak = (std::max)(peak, std::abs(sample));
            }
        } while (m.peek(0x4347) == 10 && m.cycles < shotDeadline);
        require(m.peek(0x4347) == 9, "PS/2 fire did not consume a bullet");
        require(peak > 0.01f, "No speaker PCM");
        m.vm->DisableAudio();
        require(m.vm->IsROMVisible(0xfffa), "Game hid the input NMI vector");

        m.key(0x44); // O: aim away from the guard
        m.settleKey();
        m.key(0x22); // X: walk down into the guard
        m.seek(0x08ae);
        require(m.peek(0x436f) == 0x40, "Guard capture did not occur");
        m.key(0x5a);
        m.seek(0x0a4a);
        m.step();
        m.run(10000);
        m.key(0x42);
        m.seek(0x119c);
        require(m.peek(0x4347) == 10, "Restart did not reload the supplied castle");
        m.key(0x76); // Escape: leave the game's nonpersistent save path
        m.seek(0xff59);
        require(!(m.peek(0xc000) & 0x80), "Escape leaked into the monitor");
        m.step();
        m.run(1000000);
        for (uint8_t code : {0x25, 0x26, 0x25, 0x26, 0x5a}) m.key(code); // 4343 + Return
        require(m.text().find("4343-") != std::string::npos, "Monitor lost the first physical key");
        require(!m.vm->IsROMVisible(0x9d00), "ROM input corrupted DOS banking");
        std::cout << "PASS native Disk II boot, " << m.packets
            << " PS/2 packets, move/stop/aim/fire, PCM, capture/restart and monitor return\n"
            << "Save persistence and physical-board approval are not claimed.\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL Castle Wolfenstein native check: " << error.what() << '\n';
        return 1;
    }
}
