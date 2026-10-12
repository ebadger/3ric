// msbasic-woz.native.cpp — native check that the MS-BASIC boot disk accepts real PS/2
// typing on the physical 3ric's disk path. Built and run by msbasic-woz.test.ps1.
//
// Keys travel through the ROM's own decoder: each PS/2 clock falling edge is a VIA1 CA2
// edge (NMI) and data is sampled on PA7, changing `hold` cycles after the edge. The
// picodisk Disk II emulator is modelled too: while its drive model runs (from 1,023,000
// cycles after motor-on until 1,023,000 cycles after motor-off) it freezes the CPU through
// READY, for `stall` cycles, whenever 500 cycles pass without a disk access. The VIA keeps
// counting meanwhile. Typing C600G releases Enter mid-boot, inside those stalls.
//
// Usage: msbasic-native <rom> <woz> <period> <hold> <stall> <release-delay>
#include "SDCard.h"
#include "vm.h"
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iostream>
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

    const uint16_t kTextRows[24] = {
        0x000, 0x080, 0x100, 0x180, 0x200, 0x280, 0x300, 0x380, 0x028, 0x0a8, 0x128, 0x1a8,
        0x228, 0x2a8, 0x328, 0x3a8, 0x050, 0x0d0, 0x150, 0x1d0, 0x250, 0x2d0, 0x350, 0x3d0 };
    const uint64_t kPicodiskSecond = 1023000;
    const uint16_t kKbState = 0xce00;

    struct Machine
    {
        std::unique_ptr<VM> vm = std::make_unique<VM>(false);
        SDCard sd;
        uint64_t cycles = 0, diskCycle = 0;
        uint64_t lastDiskAccess = 0, lastStall = 0, motorOnAt = 0, motorOffAt = 0, stalls = 0;
        uint32_t period, hold, stall;

        Machine(const char* romPath, uint32_t bitPeriod, uint32_t dataHold, uint32_t stallCycles)
            : period(bitPeriod), hold(dataHold), stall(stallCycles)
        {
            std::ifstream rom(romPath, std::ios::binary);
            require(bool(rom.read(reinterpret_cast<char*>(vm->GetData()), 65536)), "Cannot read ROM");
            std::copy_n(vm->GetData() + 0x9000, 0x3000, vm->GetBasicRom());
            // Physical RAM is not seeded with BASIC at power-on.
            for (int address = 0x0800; address < 0xc000; ++address)
                vm->GetData()[address] = uint8_t(address * 151 + 77);
            vm->CallbackReceiveChar = [](uint8_t) {};
            vm->CallbackDebugString = [](char* text) { throw std::runtime_error(text); };
            vm->CallbackSetSoftSwitches = [&](uint16_t address, bool, bool, bool, bool) {
                if (address < 0xc0e0 || address > 0xc0ef) return;
                vm->GetDriveEmulator()->AddCycles(uint32_t(cycles - diskCycle));
                diskCycle = lastDiskAccess = cycles;
                if (address == 0xc0e9 && (!motorOnAt || motorOffAt > motorOnAt)) motorOnAt = cycles;
                if (address == 0xc0e8 && motorOnAt && motorOffAt <= motorOnAt) motorOffAt = cycles;
            };
            vm->CallbackWriteMemory = [&](uint16_t address, uint8_t) {
                if (address != 0xc201 && address != 0xc20f) return;
                const uint8_t reg = vm->GetVIA1()->GetPortAOutput();
                sd.SetCS(reg & 0x10);
                sd.SetMOSI(reg & 0x04);
                sd.SetSCK(reg & 0x08);
                vm->GetVIA1()->SetPortAInputBits(2, sd.GetMISO() ? 2 : 0);
            };
            vm->Reset();
        }

        bool driveRunning() const
        {
            if (!motorOnAt || cycles - motorOnAt < kPicodiskSecond) return false;
            return !(motorOffAt > motorOnAt && cycles - motorOffAt >= kPicodiskSecond);
        }

        void step()
        {
            const uint64_t quietSince = lastDiskAccess > lastStall ? lastDiskAccess : lastStall;
            if (stall && driveRunning() && cycles - quietSince >= 500)
            {
                vm->TickDevices(stall); // CPU frozen by READY; PHI2 still clocks the VIA
                cycles += stall;
                lastStall = cycles;
                ++stalls;
            }
            cycles += vm->Step();
        }

        void run(uint64_t budget)
        {
            const uint64_t end = cycles + budget;
            while (cycles < end) step();
        }

        std::vector<std::string> rows()
        {
            std::vector<std::string> out;
            for (uint16_t base : kTextRows)
            {
                std::string line;
                for (int column = 0; column < 40; ++column)
                {
                    const uint8_t value = vm->GetData()[0x400 + base + column] & 0x7f;
                    line += value >= 0x20 && value < 0x7f ? char(value) : ' ';
                }
                line.erase(line.find_last_not_of(' ') + 1);
                out.push_back(line);
            }
            return out;
        }

        std::string screen()
        {
            std::string text;
            for (const auto& line : rows())
                if (!line.empty()) text += "  | " + line + "\n";
            return text;
        }

        bool waitFor(const std::string& needle, uint64_t budget, bool wholeRow = false)
        {
            const uint64_t end = cycles + budget;
            while (cycles < end)
            {
                run(100000);
                for (const auto& line : rows())
                    if (wholeRow ? line == needle : line.find(needle) != std::string::npos) return true;
            }
            return false;
        }

        // One device-to-host PS/2 frame: start, 8 data bits LSB first, odd parity, stop.
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

        void press(uint8_t code) { scan(code); run(20000); }
        void releaseKey(uint8_t code) { scan(0xf0); scan(code); run(20000); }
        void key(uint8_t code) { press(code); releaseKey(code); }
        void keys(const std::vector<uint8_t>& codes) { for (uint8_t code : codes) key(code); }
    };

    const uint8_t kEnter = 0x5a;
}

int main(int argc, char** argv)
{
    if (argc != 7)
    {
        std::cerr << "usage: msbasic-native <rom> <woz> <period> <hold> <stall> <release-delay>\n";
        return 2;
    }
    const uint32_t period = uint32_t(std::stoul(argv[3])), hold = uint32_t(std::stoul(argv[4]));
    const uint32_t stall = uint32_t(std::stoul(argv[5]));
    const uint64_t releaseDelay = std::stoull(argv[6]);
    Machine m(argv[1], period, hold, stall);
    try
    {
        m.run(5000000);
        m.keys({0x3a, 0x44, 0x31, kEnter}); // MON at the DOS shell
        require(m.waitFor("*", 2000000), "PS/2 MON did not reach the monitor");
        require(m.vm->GetDriveEmulator()->GetDisk(0)->InsertDisk(argv[2]), "Cannot insert disk");
        m.keys({0x21, 0x36, 0x45, 0x45, 0x34}); // C600G
        m.press(kEnter);                        // starts the boot
        m.run(releaseDelay);                    // Enter held while the disk loads
        m.releaseKey(kEnter);                   // release frames arrive mid-boot
        require(m.waitFor("MEMORY SIZE?", 80000000), "no MEMORY SIZE? prompt");
        m.run(300000);
        require(m.vm->GetData()[kKbState] == 0, "PS/2 decoder is not at a frame boundary at the prompt");
        m.key(kEnter);
        require(m.waitFor(" 34815 BYTES FREE", 5000000), "Return at MEMORY SIZE? was not accepted");
        m.keys({0x4d, 0x2d, 0x43, 0x31, 0x2c, 0x29, 0x3d, 0x4e, 0x1e, kEnter}); // PRINT 7-2
        require(m.waitFor(" 5", 5000000, true), "PRINT 7-2 did not print 5");
        std::cout << "PASS period " << period << " hold " << hold << " stall " << stall
                  << " release +" << releaseDelay << " (" << m.stalls << " READY stalls)\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL period " << period << " hold " << hold << " stall " << stall
                  << " release +" << releaseDelay << ": " << error.what() << "\n" << m.screen();
        return 1;
    }
}
