#include "SDCard.h"
#include "vm.h"
#include "ps2-keyboard-peer.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <initializer_list>
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
        PS2KeyboardPeer keyboard{*vm, cycles};
        unsigned packets = 0;
        uint16_t titleKey;
        uint16_t padAddress;
        unsigned useCalls = 0;
        unsigned checkedInterrupts = 0, scanInterrupts = 0, ledExchanges = 0;
        uint32_t bitPeriod = 160, dataHold = 80, minLatency = 0xffffffff, maxLatency = 0;
        uint64_t lastEdge = 0;
        uint32_t strobeLead = 0;
        bool receiving = false, checking = false;
        bool capturePackets = false;
        std::vector<uint8_t> completedPackets;
        struct InterruptFrame
        {
            uint16_t pc;
            uint8_t a, x, y, sp, flags;
            MemoryReadMapping bank;
            bool basic;
        };
        std::vector<InterruptFrame> interrupts;
        std::string serial;
        std::array<unsigned, 256> characters{};

        Machine(const char* romPath, const char* diskPath, uint16_t titlePoll, uint16_t padTable)
            : titleKey(titlePoll), padAddress(padTable)
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
                if (checking && address == 0xc010 && !vm->IsROMVisible(0xfffa))
                    throw std::runtime_error("Game still writes the interrupt-based keyboard strobe");
                if (capturePackets && address == 0xce01) completedPackets.push_back(value);
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
            vm->CallbackReadMemory = [&](uint16_t address) {
                if (checking && address == 0xc010 && !vm->IsROMVisible(0xfffa))
                    throw std::runtime_error("Game still reads the interrupt-based keyboard strobe");
                if (receiving && address == 0xc20f && peek(0xce00) == 1 && !vm->IsROMVisible(0xfffa))
                {
                    const auto latency = uint32_t(cycles - lastEdge);
                    minLatency = (std::min)(minLatency, latency);
                    maxLatency = (std::max)(maxLatency, latency);
                    require(latency < dataHold, "PS/2 DATA was sampled after it changed");
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
            require(!vm->IsROMVisible(0xfffa), "Fast input ROM shadow was not installed");
            checking = true;
            const std::array<uint8_t, 4> startupRandom{peek(0x4a), peek(0x4b), peek(0x4e), peek(0x4f)};
            for (uint32_t period : {94u, 120u, 160u})
            {
                timing(period, period / 2);
                lock(0x58, 4);
                lock(0x58, 0);
                lock(0x77, 2);
                lock(0x77, 0);
                const unsigned beforeA = characters[0xc1], beforeG = characters[0xc7];
                scanPackets({0x1c, 0xf0, 0x1c, 0x34, 0xf0, 0x34});
                require(characters[0xc1] == beforeA + 1 && characters[0xc7] == beforeG + 1,
                    "Back-to-back A/G frames produced the wrong ASCII keys");
                require(peek(0xce01) == 0x34 && peek(0xc000) == 0xc7,
                    "The completed raw byte and ASCII latch disagree");
                vm->WriteData(0xc000, 0);
                scanPackets({0xe0, 0x75, 0xe0, 0xf0, 0x75});
                require(peek(0xce03) == 0 && peek(0xce04) == 0 && peek(0xcb75) == 0,
                    "Consecutive extended-key frames left stale prefix or held-key state");
                vm->WriteData(0xc000, 0);
            }
            timing(160, 80);
            // Keep the gameplay fixture independent of time spent exercising title LEDs.
            for (unsigned i = 0; i < 2; ++i)
            {
                vm->WriteData(uint16_t(0x4a + i), startupRandom[i]);
                vm->WriteData(uint16_t(0x4e + i), startupRandom[i + 2]);
            }
        }

        uint8_t peek(uint16_t address) { return vm->PeekData(address); }
        void step()
        {
            keyboard.tick();
            if (!checking)
            {
                cycles += vm->Step();
                return;
            }
            const bool executing = vm->WillExecuteCurrentInstruction();
            InterruptFrame before{};
            uint16_t vector = 0;
            if (!executing)
            {
                before = {cpu->PC, cpu->A, cpu->X, cpu->Y, cpu->SP, cpu->flags.reg,
                    vm->GetMemoryReadMapping(0xd000), vm->IsROMVisible(0x9000)};
                vector = uint16_t(peek(0xfffa) | peek(0xfffb) << 8);
            }
            const bool returning = checking && executing && !interrupts.empty()
                && peek(cpu->PC) == 0x40 && cpu->SP == uint8_t(interrupts.back().sp - 3);
            if (returning)
            {
                const auto& frame = interrupts.back();
                require(cpu->A == frame.a && cpu->X == frame.x && cpu->Y == frame.y,
                    "Input interrupt corrupted A/X/Y");
                require(vm->GetMemoryReadMapping(0xd000) == frame.bank
                    && vm->IsROMVisible(0x9000) == frame.basic, "Input interrupt corrupted banking");
            }
            if (cpu->PC == 0x5a58 && executing) ++useCalls;
            cycles += vm->Step();
            if (returning)
            {
                const auto& frame = interrupts.back();
                require(cpu->PC == frame.pc && cpu->SP == frame.sp
                    && (cpu->flags.reg & 0xcf) == (frame.flags & 0xcf), "Input interrupt corrupted return context");
                interrupts.pop_back();
                ++checkedInterrupts;
            }
            if (checking && !executing && cpu->PC == vector && cpu->SP == uint8_t(before.sp - 3))
            {
                interrupts.push_back(before);
                if (before.pc >= 0xc800 && before.pc < 0xc900) ++scanInterrupts;
            }
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

        void scanPackets(std::initializer_list<uint8_t> codes)
        {
            waitKeyboard();
            completedPackets.clear();
            capturePackets = !vm->IsROMVisible(0xfffa);
            const uint64_t start = cycles + strobeLead;
            unsigned frame = 0;
            receiving = true;
            if (strobeLead) vm->SignalVIA1Pin(VIA::CB1);
            for (uint8_t code : codes)
            {
                std::array<uint8_t, 12> bits{};
                uint8_t parity = 1;
                for (unsigned i = 0; i < 8; ++i)
                {
                    bits[i + 1] = (code >> i) & 1;
                    parity ^= bits[i + 1];
                }
                bits[9] = parity;
                bits[10] = bits[11] = 1;
                for (unsigned i = 0; i < 11; ++i)
                {
                    const uint64_t edge = start + uint64_t(frame * 11 + i) * bitPeriod;
                    while (cycles < edge) step();
                    lastEdge = cycles;
                    keyboard.pins(bits[i] != 0, false);
                    while (cycles < edge + bitPeriod / 2) step();
                    keyboard.pins(bits[i] != 0, true);
                    while (cycles < edge + dataHold) step();
                    keyboard.pins(bits[i + 1] != 0, true);
                    if (strobeLead)
                    {
                        while (cycles < edge + bitPeriod - strobeLead) step();
                        vm->SignalVIA1Pin(VIA::CB1);
                    }
                    while (cycles < edge + bitPeriod) step();
                }
                ++frame;
            }
            receiving = false;
            run(1000);
            waitKeyboard();
            if (capturePackets)
                require(completedPackets == std::vector<uint8_t>(codes),
                    "Consecutive PS/2 packets were corrupted, lost or duplicated");
            capturePackets = false;
            packets += unsigned(codes.size());
        }

        void waitKeyboard()
        {
            const uint64_t end = cycles + 1000000;
            while (keyboard.phase != PS2KeyboardPeer::Phase::Idle || !interrupts.empty() || peek(0xce00) != 0)
            {
                require(cycles < end, "PS/2 command/receive did not finish");
                step();
            }
        }

        void timing(uint32_t period, uint32_t hold)
        {
            waitKeyboard();
            require(period >= 94 && hold >= period / 2 && hold <= period, "Invalid PS/2 timing case");
            bitPeriod = period;
            dataHold = hold;
            keyboard.halfPeriod = period / 2;
            keyboard.replyDataOnRise = hold < period;
        }

        void lock(uint8_t code, uint8_t leds)
        {
            const size_t before = keyboard.commands.size();
            scanPackets({code, 0xf0, code});
            run(20000);
            waitKeyboard();
            const std::vector<uint8_t> expected{0xf0, 2, 0xed, leds, 0xf4};
            require(std::vector<uint8_t>(keyboard.commands.begin() + before, keyboard.commands.end()) == expected,
                "Wrong PS/2 lock-key command sequence");
            require(keyboard.leds == leds, "Keyboard did not receive the expected LED state");
            if (!vm->IsROMVisible(0xfffa))
                require(!(vm->GetVIA1()->ReadRegister(VIA::IER) & 0x10),
                    "LED setup re-enabled redundant keyboard-strobe NMIs");
            ++ledExchanges;
        }

        void expectPad(uint16_t mask)
        {
            for (unsigned bit = 0; bit < 16; ++bit)
            {
                const auto actual = peek(uint16_t(padAddress + bit));
                if (actual != ((mask >> bit) & 1))
                {
                    std::cerr << "pad mismatch: bit " << bit << " value " << unsigned(actual)
                        << " expected mask " << mask << " PC " << std::hex << cpu->PC << std::dec << '\n';
                    throw std::runtime_error("PS/2 traffic lost or duplicated an SNES serial bit");
                }
            }
        }

        void key(uint8_t code)
        {
            require(!(peek(0xc000) & 0x80), "Previous physical key not consumed");
            scanPackets({code});
            run(20000);
            scanPackets({0xf0, code});
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
                if (cycles >= end)
                {
                    std::ostringstream error;
                    error << message << ": PC=$" << std::hex << cpu->PC
                        << ", room=" << unsigned(peek(0x4340)) << ", tile=" << unsigned(peek(0x4343))
                        << ", move=" << unsigned(peek(0x4341)) << ", aim=" << unsigned(peek(0x4342))
                        << ", key=$" << unsigned(peek(0xc000));
                    throw std::runtime_error(error.str());
                }
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
            const uint32_t period = std::array<uint32_t, 3>{94, 120, 160}[i % 3];
            m.timing(period, period / 2);
            const uint16_t mask = (1 << 6) | (1 << 7) | (i & 1 ? 1 << 9 : 1 << 8);
            m.pad(mask);
            const unsigned count = m.characters[0xc9];
            m.key(0x43); // I, while the disk-installed resident clocks the SNES pad
            m.settleKey();
            require(m.characters[0xc9] == count + 1, "Mixed SNES traffic lost or duplicated a PS/2 key");
            if (i % 8 == 0)
            {
                m.lock(0x58, 4);
                m.lock(0x58, 0);
                m.lock(0x77, 2);
                m.lock(0x77, 0);
            }
            m.seek(0x300);
            m.expectPad(mask);
        }
        m.pad(0);
        m.run(20000);
        m.seek(0x300);
        require(m.cpu->A == a && m.cpu->X == x && m.cpu->Y == y && m.cpu->SP == sp
            && (m.cpu->flags.reg & 0xcf) == (flags & 0xcf), "Mixed input corrupted saved CPU context");
        require(m.peek(0xcafe) == bankMode, "Resident corrupted the ROM banking state");
        require(std::equal(keyState.begin(), keyState.end(), m.vm->GetData() + 0xcb00),
            "Released PS/2 keys or the ROM key-state table were corrupted");
        require(!m.vm->IsROMVisible(0xfffa) && !m.vm->IsROMVisible(0x9d00), "Mixed input changed ROM/DOS mapping");
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

    void checkController(const char* rom, const char* disk, uint16_t titleKey, uint16_t padAddress)
    {
        constexpr uint16_t start = 1 << 3, select = 1 << 2, left = 1 << 6;
        constexpr uint16_t down = 1 << 5, aimUp = 1 << 9, aimRight = 1 << 8, fire = 1 << 10;
        Machine m(rom, disk, titleKey, padAddress);
        require(m.vm->SetGamepadState(1, start), "Could not set pad 2 state");
        m.run(100000);
        require(m.peek(0x1f00) != 0x4c, "Controller 2 selected controls");
        m.vm->SetGamepadState(1, 0);
        m.pad(start);
        m.seek(0x0a4a);
        startPadMenu(m);
        checkMixedInput(m);
        m.pad(aimRight);
        m.until([&] { return m.peek(0x4342) == 8; }, "Initial aim did not raise the gun");
        m.pad(start | aimRight | fire);
        m.until([&] { return m.peek(0x4342) == 0; }, "Start did not holster");
        m.run(10000);
        m.expect(0x4342, 0, "Held face buttons raised the holstered gun");
        m.expect(0x4347, 10, "Gun fired while holstered");
        m.pad(aimRight);
        m.run(5000);
        m.expect(0x4342, 0, "Releasing Start alone rearmed aim");
        m.pad(0);
        sampleDriver(m);
        m.pad(aimUp);
        m.until([&] { return m.peek(0x4342) == 2; }, "Fresh aim did not rearm after Start");
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
        require(m.vm->IsROMVisible(0xfffa), "Game exit did not restore the original ROM");
        m.timing(160, 160); // The original monitor is outside the game's fast receiver.
        for (uint8_t code : {0x21, 0x36, 0x45, 0x45, 0x34, 0x5a}) m.key(code); // C600G + Return
        m.seek(titleKey);
        m.pad(start);
        m.seek(0x0a4a);
        startPadMenu(m);
        m.timing(94, 47);
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
        require(m.vm->IsROMVisible(0xfffa), "Game exit did not restore the original ROM");
        m.timing(160, 160);
        for (uint8_t code : {0x25, 0x26, 0x25, 0x26, 0x5a}) m.key(code);
        require(m.text().find("4343-") != std::string::npos, "Controller exit damaged physical keyboard input");
        require(m.scanInterrupts > 0, "Mixed input did not interrupt resident input code");
        std::cout << "PASS native SNES start, move/aim/fire, capture/restart, inventory and quit; "
            << m.packets << " PS/2 packets including 64 mixed-input make/break pairs, "
            << m.ledExchanges << " LED exchanges; DATA latency " << m.minLatency << '-' << m.maxLatency
            << " cycles; " << m.checkedInterrupts << " preserved NMIs, "
            << m.scanInterrupts << " in resident input code; 64 exact pad samples\n";
    }

    void checkKeyboardUse(const char* rom, const char* disk, uint16_t titleKey, uint16_t padAddress)
    {
        const bool english = titleKey == 0x0c56;
        const uint16_t aim = english ? 1 << 8 : 1 << 1;
        const uint16_t itemFlag = english ? 0x436c : 0x4349;
        Machine m(rom, disk, titleKey, padAddress);
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
        m.timing(94, 47);
        m.strobeLead = 4;
        const unsigned before = m.useCalls;
        m.key(0x3c); // Physical U, not keyboard-latch injection
        m.strobeLead = 0;
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
        require(argc == 5, "Usage: wolf-native-test <rom> <patched.woz> <french|english> <pad-table-hex>");
        const std::string profile = argv[3];
        require(profile == "english" || profile == "french", "Unknown disk profile");
        const uint16_t titleKey = profile == "english" ? 0x0c56 : 0x0c44;
        const unsigned padTable = unsigned(std::stoul(argv[4], nullptr, 16));
        require(padTable >= 0xc800 && padTable <= 0xcaee, "Invalid resident pad table");
        const uint16_t padAddress = uint16_t(padTable);
        Machine m(argv[1], argv[2], titleKey, padAddress);
        m.timing(94, 47);
        for (uint32_t lead : {4u, 8u, 12u, 16u, 24u, 32u, 40u})
        {
            std::cout << "Checking simultaneous strobe lead " << lead << '\n';
            m.strobeLead = lead;
            m.scanPackets({0x1c, 0xf0, 0x1c});
            m.expect(0xce01, 0x1c, "Overlapping strobes corrupted the raw A scan code");
            m.expect(0xc000, 0xc1, "Overlapping strobes corrupted the decoded A key");
            m.vm->WriteData(0xc000, 0);
            m.scanPackets({0x3c, 0xf0, 0x3c});
            m.expect(0xce01, 0x3c, "Overlapping strobes corrupted the raw U scan code");
            m.expect(0xc000, 0xd5, "Overlapping strobes corrupted the decoded U key");
            m.vm->WriteData(0xc000, 0);
        }
        m.strobeLead = 0;
        m.key(0x5a); // Return
        m.expect(0xce01, 0x5a, "Physical Return raw scan code was corrupted");
        m.seek(0x0a4a);
        require(m.text().find("START/K") != std::string::npos, "Keyboard/SNES menu missing");
        m.step();
        m.run(10000);
        m.key(0x42); // K
        m.seek(0x0810);
        m.seek(0x119c);
        require(m.peek(0x4347) == 10, "Castle inventory did not load");
        const uint8_t tile = m.peek(0x4343);
        m.key(0x1c); // A: move left
        m.settleKey();
        m.expect(0x4341, 4, "PS/2 movement key was not decoded");
        m.until([&] { return m.peek(0x4343) != tile; }, "Player did not move");
        m.key(0x1b); // S: stop
        m.settleKey();
        m.until([&] { return m.peek(0x4341) == 0; }, "PS/2 stop was not applied");
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
        require(!m.vm->IsROMVisible(0xfffa), "Game lost the fast input NMI vector");

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
        m.seek(0x0810);
        m.seek(0x119c);
        require(m.peek(0x4347) == 10, "Restart did not reload the supplied castle");
        m.key(0x76); // Escape: leave the game's nonpersistent save path
        m.seek(0xff59);
        require(!(m.peek(0xc000) & 0x80), "Escape leaked into the monitor");
        m.step();
        m.run(1000000);
        require(m.vm->IsROMVisible(0xfffa), "Exit did not restore the original monitor");
        m.timing(160, 160);
        for (uint8_t code : {0x25, 0x26, 0x25, 0x26, 0x5a}) m.key(code); // 4343 + Return
        require(m.text().find("4343-") != std::string::npos, "Monitor lost the first physical key");
        require(!m.vm->IsROMVisible(0x9d00), "ROM input corrupted DOS banking");
        std::cout << "PASS native Disk II boot and overlapping strobe/U/A clock cases, " << m.packets
            << " PS/2 packets with back-to-back make/break/extended bytes, raw/ASCII codes, "
            << "move/stop/aim/fire, PCM, capture/restart and monitor return\n"
            << "Save persistence and physical-board approval are not claimed.\n";
        checkController(argv[1], argv[2], titleKey, padAddress);
        checkKeyboardUse(argv[1], argv[2], titleKey, padAddress);
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL Castle Wolfenstein native check: " << error.what() << '\n';
        return 1;
    }
}
