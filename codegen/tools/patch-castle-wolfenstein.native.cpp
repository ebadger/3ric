#include "SDCard.h"
#include "vm.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
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
        uint16_t titleKey;
        unsigned useCalls = 0;
        std::string serial;
        std::array<unsigned, 256> characters{};

        Machine(const char* romPath, const char* diskPath, uint16_t titlePoll)
            : titleKey(titlePoll)
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
            seek(titleKey);
        }

        uint8_t peek(uint16_t address) { return vm->PeekData(address); }
        void step()
        {
            if (cpu->PC == 0x5a58 && vm->WillExecuteCurrentInstruction()) ++useCalls;
            cycles += vm->Step();
        }

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

        void seek(uint16_t address, uint64_t budget = 0)
        {
            if (budget == 0) budget = titleKey == 0x0c56 ? 1000000000 : 50000000;
            const uint64_t end = cycles + budget;
            while (cpu->PC != address || !vm->WillExecuteCurrentInstruction())
            {
                if (cycles >= end)
                {
                    std::ostringstream message;
                    message << "Timed out waiting for $" << std::hex << address << " at $" << cpu->PC;
                    throw std::runtime_error(message.str());
                }
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

        void pad(uint16_t mask)
        {
            require(vm->SetGamepadState(0, mask), "Could not set pad 1 state");
        }

        template<typename Predicate>
        void until(Predicate ready, const char* message, uint64_t budget = 10000000)
        {
            const uint64_t end = cycles + budget;
            while (!ready())
            {
                require(cycles < end, message);
                run(1000);
            }
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

    void startPadMenu(Machine& m)
    {
        m.step();
        const uint64_t end = m.cycles + 100000;
        while (m.cycles < end)
        {
            require(m.cpu->PC != 0x0a4d, "Held Start skipped the options screen");
            m.step();
        }
        m.pad(0);
        m.run(20000);
        m.pad(1 << 3);
        m.seek(0x0810);
        m.pad(0);
        m.seek(0x119c);
    }

    void checkMixedInput(Machine& m)
    {
        constexpr std::array<uint8_t, 14> loop{0x08, 0x48, 0xda, 0x5a, 0x20, 0, 0x1f,
            0x7a, 0xfa, 0x68, 0x28, 0x4c, 0, 3};
        std::array<uint8_t, loop.size()> saved{};
        std::array<uint8_t, 256> keyState{};
        std::copy_n(m.vm->GetData() + 0x300, saved.size(), saved.begin());
        std::copy_n(m.vm->GetData() + 0xcb00, keyState.size(), keyState.begin());
        const uint16_t pc = m.cpu->PC;
        const uint8_t a = m.cpu->A, x = m.cpu->X, y = m.cpu->Y, sp = m.cpu->SP, flags = m.cpu->flags.reg;
        const uint8_t bankMode = m.peek(0xcafe);
        std::copy(loop.begin(), loop.end(), m.vm->GetData() + 0x300);
        m.cpu->PC = 0x300;
        for (unsigned i = 0; i < 64; ++i)
        {
            m.pad((1 << 6) | (1 << 7) | (i & 1 ? 1 << 9 : 1 << 8));
            const unsigned count = m.characters[0xc9];
            m.key(0x43); // I, while the disk-installed resident clocks the SNES pad
            m.settleKey();
            require(m.characters[0xc9] == count + 1, "Mixed SNES traffic lost or duplicated a PS/2 key");
        }
        m.pad(0);
        m.run(20000);
        m.seek(0x300);
        require(m.cpu->A == a && m.cpu->X == x && m.cpu->Y == y && m.cpu->SP == sp
            && (m.cpu->flags.reg & 0xcf) == (flags & 0xcf), "Mixed input corrupted saved CPU context");
        require(m.peek(0xcafe) == bankMode, "Resident corrupted the ROM banking state");
        require(std::equal(keyState.begin(), keyState.end(), m.vm->GetData() + 0xcb00),
            "Released PS/2 keys or the ROM key-state table were corrupted");
        require(m.vm->IsROMVisible(0xfffa) && !m.vm->IsROMVisible(0x9d00), "Mixed input changed ROM/DOS mapping");
        std::copy(saved.begin(), saved.end(), m.vm->GetData() + 0x300);
        m.cpu->PC = pc;
        m.cpu->flags.reg = flags;
    }

    void sampleDriver(Machine& m)
    {
        m.seek(0x1f00);
        const uint16_t returnPC = uint16_t((m.peek(0x100 | uint8_t(m.cpu->SP + 1))
            | m.peek(0x100 | uint8_t(m.cpu->SP + 2)) << 8) + 1);
        m.step();
        m.seek(returnPC);
    }

    void checkController(const char* rom, const char* disk, uint16_t titleKey)
    {
        constexpr uint16_t start = 1 << 3, select = 1 << 2, left = 1 << 6;
        constexpr uint16_t down = 1 << 5, aimUp = 1 << 9, aimRight = 1 << 8, fire = 1 << 10;
        Machine m(rom, disk, titleKey);
        require(m.vm->SetGamepadState(1, start), "Could not set pad 2 state");
        m.run(100000);
        require(m.peek(0x1f00) != 0x4c, "Controller 2 selected controls");
        m.vm->SetGamepadState(1, 0);
        m.pad(start);
        m.seek(0x0a4a);
        startPadMenu(m);
        checkMixedInput(m);
        const uint8_t tile = m.peek(0x4343);
        m.pad(left | aimRight | fire);
        m.seek(0x1489);
        m.expect(0x4341, 4, "Pad did not move left");
        m.expect(0x4342, 8, "Pad did not independently aim right");
        m.step();
        m.until([&] { return m.peek(0x4347) < 10; }, "Pad fire did not consume ammunition");
        m.pad(left | aimRight);
        m.until([&] { return m.peek(0x4343) != tile; }, "Pad did not move the player");
        m.pad(0);
        m.until([&] { return m.peek(0x4341) == 0; }, "Released D-pad left movement latched");
        m.expect(0x4342, 8, "Released face buttons lost the aim");
        m.pad(start | select);
        m.seek(0xff59);
        require(!(m.peek(0xc000) & 0x80), "Controller Escape leaked into the monitor");
        m.pad(0);
        m.step();
        m.run(1000000);
        for (uint8_t code : {0x21, 0x36, 0x45, 0x45, 0x34, 0x5a}) m.key(code); // C600G + Return
        m.seek(titleKey);
        m.pad(start);
        m.seek(0x0a4a);
        startPadMenu(m);
        m.pad(down | aimUp);
        m.seek(0x08ae);
        m.expect(0x436f, 0x40, "Pad-driven guard capture did not occur");
        m.pad(start);
        m.step();
        m.seek(0x0a4a);
        startPadMenu(m);
        m.pad(select);
        sampleDriver(m);
        m.pad(0);
        m.seek(0x1e49);
        m.step();
        m.seek(0x1301);
        m.pad(start | select);
        m.step();
        m.seek(0xff59);
        require(!(m.peek(0xc000) & 0x80), "Controller Escape leaked into the monitor");
        m.pad(0);
        m.step();
        m.run(1000000);
        for (uint8_t code : {0x25, 0x26, 0x25, 0x26, 0x5a}) m.key(code);
        require(m.text().find("4343-") != std::string::npos, "Controller exit damaged physical keyboard input");
        std::cout << "PASS native SNES start, move/aim/fire, capture/restart, inventory and quit; "
            << m.packets << " PS/2 packets including 64 mixed-input make/break pairs\n";
    }

    void checkKeyboardUse(const char* rom, const char* disk, uint16_t titleKey)
    {
        const bool english = titleKey == 0x0c56;
        const uint16_t aim = english ? 1 << 8 : 1 << 1;
        const uint16_t itemFlag = english ? 0x436c : 0x4349;
        Machine m(rom, disk, titleKey);
        m.pad(1 << 3);
        m.seek(0x0a4a);
        startPadMenu(m);
        // Use the real chest's contents; shorten only its opening wait and position the player beside it.
        m.vm->WriteData(0x4343, english ? 58 : 1);
        m.pad(aim | (1 << 11));
        m.seek(0x1343);
        require(m.cpu->A == 0xa0, "Open-chest fixture did not target the real chest");
        m.step();
        m.seek(0x59d7);
        m.expect(0x5879, english ? 15 : 11, "Unexpected chest contents");
        require(m.peek(0x587a) > 0, "Chest is empty");
        m.vm->WriteData(0x587b, 0);
        m.step();
        m.seek(0x1301);
        m.step();
        m.expect(itemFlag, 0, "Item was already in inventory");
        m.pad(aim | (1 << 7));
        const unsigned before = m.useCalls;
        m.key(0x3c); // Physical U, not keyboard-latch injection
        m.until([&] { return m.peek(itemFlag) == 1; }, "Physical U did not complete the chest action", 50000000);
        require(m.useCalls > before, "Physical U did not reach the use handler");
        m.expect(0x4341, 0, "Held D-pad cancelled the timed use action");
        m.pad(0);
        sampleDriver(m);
        m.pad(1 << 7);
        m.until([&] { return m.peek(0x4341) == 8; }, "Releasing the D-pad did not rearm movement");
        std::cout << "PASS physical PS/2 U with held D-pad "
            << (english ? "collects the plans" : "equips a uniform") << " from an open-chest fixture\n";
    }
}

int main(int argc, char** argv)
{
    try
    {
        require(argc == 4, "Usage: wolf-native-test <rom> <patched.woz> <french|english>");
        const std::string profile = argv[3];
        require(profile == "english" || profile == "french", "Unknown disk profile");
        const uint16_t titleKey = profile == "english" ? 0x0c56 : 0x0c44;
        Machine m(argv[1], argv[2], titleKey);
        m.key(0x5a); // Return
        m.seek(0x0a4a);
        require(m.text().find("START/K") != std::string::npos, "Keyboard/SNES menu missing");
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
        checkController(argv[1], argv[2], titleKey);
        checkKeyboardUse(argv[1], argv[2], titleKey);
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL Castle Wolfenstein native check: " << error.what() << '\n';
        return 1;
    }
}
