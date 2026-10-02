#include "vm.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{
    void require(bool condition, const std::string& message)
    {
        if (!condition) throw std::runtime_error(message);
    }

    std::vector<uint8_t> readFile(const char* path)
    {
        std::ifstream file(path, std::ios::binary);
        require(file.good(), std::string("Cannot read ") + path);
        return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
    }

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
        uint8_t leds = 0;
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
            case Phase::TxHigh:
                pins(true, true);
                phase = Phase::TxLow;
                next += 80;
                break;
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
                    if (!commands.empty() && commands.back() == 0xed) leds = value;
                    commands.push_back(value);
                    phase = Phase::HostRelease;
                }
                else phase = Phase::TxHigh;
                next += 80;
                break;
            case Phase::HostRelease:
                if (ddr & 0x80) break;
                pins(false, false);
                phase = Phase::Ack;
                next = cycles + 80;
                break;
            case Phase::Ack:
                pins(true, true);
                bits = {0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1};
                bitIndex = 0;
                phase = Phase::ReplyLow;
                next = cycles + 320;
                break;
            case Phase::ReplyLow:
                pins(bits[bitIndex] != 0, false);
                phase = Phase::ReplyHigh;
                next += 80;
                break;
            case Phase::ReplyHigh:
                pins(bits[bitIndex] != 0, true);
                phase = ++bitIndex == bits.size() ? Phase::ReplyDone : Phase::ReplyLow;
                next += 80;
                break;
            case Phase::ReplyDone:
                pins(true, true);
                phase = Phase::Idle;
                break;
            case Phase::Idle:
                break;
            }
        }
    };

    struct Machine
    {
        VM vm{false};
        CPU* cpu = vm.GetCPU();
        uint64_t cycles = 0, diskCycle = 0;
        KeyboardPeer keyboard{vm, cycles};
        bool checking = false;
        unsigned decoded = 0;
        unsigned romVIAWrites = 0;
        uint32_t bitPeriod = 160, dataHold = 80;
        unsigned discardedClockEdges = 0;
        uint8_t scanCode = 0;
        unsigned scanBit = 0;
        bool tracingInput = false;

        Machine(const std::vector<uint8_t>& rom, const char* disk)
        {
            require(rom.size() >= 65536, "Short ROM");
            std::copy_n(rom.data(), 65536, vm.GetData());
            std::copy_n(rom.data() + 0x9000, 0x3000, vm.GetBasicRom());
            vm.CallbackSetSoftSwitches = [&](uint16_t address, bool, bool, bool, bool) {
                if (address >= 0xc0e0 && address <= 0xc0ef)
                {
                    vm.GetDriveEmulator()->AddCycles(static_cast<uint32_t>(cycles - diskCycle));
                    diskCycle = cycles;
                }
            };
            const auto checkAddress = [&](uint16_t address) {
                if (!checking) return;
                require(address != 0xc010 || vm.IsROMVisible(cpu->PC),
                    "Guest raised the racy keyboard strobe NMI");
                switch (address)
                {
                case 0xc002: case 0xc003: case 0xc004: case 0xc005:
                case 0xc008: case 0xc009: case 0xc00d: case 0xc05e: case 0xc05f:
                    throw std::runtime_error("Port accessed an Apple IIe-only soft switch");
                default:
                    break;
                }
            };
            vm.CallbackReadMemory = checkAddress;
            vm.CallbackWriteMemory = [&, checkAddress](uint16_t address, uint8_t value) {
                checkAddress(address);
                if (checking && address >= 0xc200 && address <= 0xc2ff)
                {
                    require(vm.IsROMVisible(cpu->PC), "Guest wrote input VIA at PC "
                        + std::to_string(cpu->PC) + ", address " + std::to_string(address));
                    ++romVIAWrites;
                }
                if (checking && address == 0xc000 && (value & 0x80)) ++decoded;
            };
            vm.Reset();
            seek(0xe0ff, 100000);
            // This host has no SD peer: finish ROM/VIA init, then enter the real monitor.
            cpu->PC = 0xff69;
            run(100000);
            require(vm.GetDriveEmulator()->GetDisk(0)->InsertDisk(disk), "Disk insertion failed");
            for (uint8_t code : {0x21, 0x36, 0x45, 0x45, 0x34, 0x5a}) key(code);
        }

        void step()
        {
            keyboard.tick();
            if (tracingInput && cpu->PC == 0xf1d0 && vm.WillExecuteCurrentInstruction()
                && (vm.GetVIA1()->ReadRegister(VIA::IFR) & 1))
            {
                ++discardedClockEdges;
                std::cerr << "ROM blanket IFR clear with pending PS/2 clock: cycle=" << cycles
                    << " scan=" << unsigned(scanCode) << " bit=" << scanBit
                    << " CE00=" << unsigned(vm.PeekData(0xce00))
                    << " CE01=" << unsigned(vm.PeekData(0xce01))
                    << " IFR=" << unsigned(vm.GetVIA1()->ReadRegister(VIA::IFR)) << "\n";
            }
            if (checking)
                require(vm.IsROMVisible(0xfffa), "Guest hid the physical keyboard's ROM interrupt handler");
            cycles += vm.Step();
        }

        void run(uint64_t count)
        {
            const auto end = cycles + count;
            while (cycles < end) step();
        }

        void seek(uint16_t target, uint64_t budget)
        {
            const auto end = cycles + budget;
            while ((cpu->PC != target || !vm.WillExecuteCurrentInstruction()) && cycles < end) step();
            require(cpu->PC == target, "Timed out at PC " + std::to_string(cpu->PC)
                + ", waiting for " + std::to_string(target));
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
            const auto start = cycles;
            for (unsigned i = 0; i < 11; ++i)
            {
                const auto edge = start + i * bitPeriod;
                while (cycles < edge) step();
                scanCode = code;
                scanBit = i;
                keyboard.pins(bits[i] != 0, false);
                while (cycles < edge + bitPeriod / 2) step();
                keyboard.pins(bits[i] != 0, true);
                while (cycles < edge + dataHold) step();
                keyboard.pins(bits[i + 1] != 0, true);
                while (cycles < edge + bitPeriod) step();
            }
            run(160);
        }

        void key(uint8_t code)
        {
            scan(code); run(20000);
            scan(0xf0); scan(code); run(20000);
        }

        void extended(uint8_t code)
        {
            scan(0xe0); scan(code); run(20000);
            scan(0xe0); scan(0xf0); scan(code); run(20000);
        }

        void keyboardStress(uint16_t menuPC)
        {
            tracingInput = true;
            const auto ddra = vm.GetVIA1()->ReadRegister(VIA::DDRA);
            const auto ier = vm.GetVIA1()->ReadRegister(VIA::IER);
            for (const uint32_t hold : {80u, 88u, 100u})
            {
                bitPeriod = hold == 100 ? 200 : 160;
                dataHold = hold;
                for (unsigned phase = 0; phase < 256; ++phase)
                {
                    seek(menuPC, 2000000);
                    run((25642 - cycles % 25642) % 25642 + phase);
                    const auto before = decoded;
                    extended(0x72);
                    run(50000);
                    require(decoded == before + 1, "PS/2 scan lost with period/hold/phase "
                        + std::to_string(bitPeriod) + "/" + std::to_string(hold) + "/"
                        + std::to_string(phase) + "; CE00=" + std::to_string(vm.PeekData(0xce00))
                        + " CE01=" + std::to_string(vm.PeekData(0xce01)));
                    require(vm.PeekData(0xce00) == 0 && vm.PeekData(0xce04) == 0,
                        "PS/2 receiver remained inside a frame/release at period/hold/phase "
                        + std::to_string(bitPeriod) + "/" + std::to_string(hold) + "/"
                        + std::to_string(phase) + "; CE00=" + std::to_string(vm.PeekData(0xce00))
                        + " CE01=" + std::to_string(vm.PeekData(0xce01))
                        + " CE04=" + std::to_string(vm.PeekData(0xce04))
                        + " PC=" + std::to_string(cpu->PC)
                        + " discarded clock edges=" + std::to_string(discardedClockEdges));
                    require(vm.GetVIA1()->ReadRegister(VIA::DDRA) == ddra
                        && vm.GetVIA1()->ReadRegister(VIA::IER) == ier,
                        "Keyboard VIA configuration changed during title music");
                }
            }
            bitPeriod = 160;
            dataHold = 80;
            require(discardedClockEdges == 0, "ROM discarded a pending PS/2 clock edge");
            std::cout << "PASS 768 phase-shifted PS/2 keys; "
                << romVIAWrites << " input-VIA writes, all from visible ROM\n";
        }
    };
}

int main(int argc, char** argv)
{
    try
    {
        require(argc == 6 || argc == 7,
            "Usage: quarx-native <rom> <ported.woz> <init-hex> <notice-key-hex> <menu-key-hex> [--keyboard-stress|--keyboard-stress-silent]");
        const bool silent = argc == 7 && std::string(argv[6]) == "--keyboard-stress-silent";
        Machine machine(readFile(argv[1]), argv[2]);
        machine.seek(static_cast<uint16_t>(std::stoul(argv[3], nullptr, 16)), 100000000);
        machine.checking = true;
        machine.seek(static_cast<uint16_t>(std::stoul(argv[4], nullptr, 16)), 20000000);
        machine.key(silent ? 0x76 : 0x29);
        const auto menuPC = static_cast<uint16_t>(std::stoul(argv[5], nullptr, 16));
        machine.seek(menuPC, 5000000);
        if (argc == 7)
        {
            require(std::string(argv[6]) == "--keyboard-stress" || silent, "Unknown native test option");
            machine.keyboardStress(menuPC);
            if (silent) return 0;
            machine.seek(menuPC, 2000000);
            require(machine.vm.PeekData(0xe8) < 3, "Invalid menu selection after keyboard timing sweep");
            for (unsigned attempt = 0; attempt < 3 && machine.vm.PeekData(0xe8) != 0; ++attempt)
            {
                machine.extended(0x72);
                machine.run(200000);
                machine.seek(menuPC, 2000000);
            }
            require(machine.vm.PeekData(0xe8) == 0, "Could not select Start Game after keyboard timing sweep");
        }
        machine.key(0x5a);
        machine.seek(0x118d, 5000000);
        require(machine.vm.EnableAudio(44100), "Could not enable native PCM collection");
        require(machine.vm.PeekData(0x142e) == 2, "Game did not start with its center column");
        machine.extended(0x74);
        machine.seek(0x118d, 5000000);
        require(machine.vm.PeekData(0x142e) == 3, "Physical right-arrow input did not move the pieces");
        machine.extended(0x6b);
        machine.seek(0x118d, 5000000);
        require(machine.vm.PeekData(0x142e) == 2, "Physical left-arrow input did not move the pieces");
        std::array<uint8_t, 3> before{};
        for (int i = 0; i < 3; ++i) before[i] = machine.vm.PeekData(0x136b + i);
        machine.key(0x1a);
        machine.seek(0x118d, 5000000);
        require(machine.vm.PeekData(0x136b) == before[2]
            && machine.vm.PeekData(0x136c) == before[0]
            && machine.vm.PeekData(0x136d) == before[1], "Physical Z key did not rotate");
        machine.key(0x76);
        machine.seek(0x1215, 5000000);
        const auto row = machine.vm.PeekData(0x142f);
        machine.run(1000000);
        require(machine.vm.PeekData(0x142f) == row, "Pieces moved during pause");
        machine.key(0x76);
        machine.seek(0x118d, 5000000);
        const auto commands = machine.keyboard.commands.size();
        machine.key(0x58);
        machine.run(200000);
        require(machine.keyboard.commands.size() >= commands + 5, "Caps Lock command exchange missing");
        require(machine.keyboard.phase == KeyboardPeer::Phase::Idle, "PS/2 command exchange did not finish");
        require(machine.vm.PeekData(0xce00) == 0 && machine.vm.PeekData(0xcafe) == 0,
            "Physical PS/2 receiver lost frame/bank state");
        require(machine.decoded >= 7, "No physical keyboard decoding observed");
        const auto audio = machine.vm.DrainAudio();
        double energy[2] = {0, 0};
        for (size_t i = 0; i < audio.size(); ++i)
        {
            require(std::isfinite(audio[i]) && std::abs(audio[i]) < 1, "Invalid/clipping native PCM");
            energy[i & 1] += audio[i] * audio[i];
        }
        require(energy[0] > 0.1 && energy[1] > 0.1, "Mockingboard soundtrack was silent during physical-keyboard input");
        std::cout << "PASS native Disk II boot, physical PS/2 arrows/rotation/pause/Caps Lock with stereo music, "
            "ROM visibility, and no Apple IIe-only accesses (" << machine.cycles << " cycles)\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL native Quarx: " << error.what() << "\n";
        return 1;
    }
}
