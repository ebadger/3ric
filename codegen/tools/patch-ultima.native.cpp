#include "SDCard.h"
#include "vm.h"
#include "ps2-test-peer.h"
#include <algorithm>
#include <array>
#include <fstream>
#include <iostream>
#include <memory>
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
        uint64_t cycles = 0, diskCycle = 0, holdStart = 0, shortestHold = UINT64_MAX;
        KeyboardPeer keyboard{*vm, cycles};
        uint16_t ioDepth, saveValid, mli, mliReturn;
        unsigned period, inputCount = 0, diskWrites = 0, mliCalls = 0, heldFrames = 0;
        bool installed = false, wasInhibited = false;
        std::string serial;

        Machine(const char* romPath, const char* diskPath, unsigned bitPeriod,
            uint16_t depth, uint16_t valid, uint16_t entry, uint16_t returned)
            : ioDepth(depth), saveValid(valid), mli(entry), mliReturn(returned), period(bitPeriod)
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
                if (address == 0xc000 && (value & 0x80)) ++inputCount;
                if (address == 0xc0ed || address == 0xc0ef) ++diskWrites;
                if (installed && ((address >= 0xc800 && address < 0xca00)
                    || (address >= 0xcc00 && address < 0xce00)))
                    require(cpu->PC >= 0xcc00 && cpu->PC < 0xce00,
                        "Game or ROM overwrote the adapter's reserved RAM");
            };
            vm->Reset();
            run(5000000);
            require(vm->GetDriveEmulator()->GetDisk(0)->InsertDisk(diskPath), "Cannot insert disk");
            ascii("MON\r");
            require(serial.find('*') != std::string::npos, "Monitor entry failed");
            ascii("C600G\r");
            run(30000000);
            key(0x29);
            run(60000000);
            require(installed, "Disk did not install its adapter");
            key(0x29);
            run(60000000);
            require(vm->PeekData(ioDepth) == 0, "Boot did not release input");
            require(vm->IsROMVisible(0xffff) && !vm->IsROMVisible(0x9000), "Wrong interactive banking");
        }

        bool inhibited() const
        {
            return (vm->GetVIA1()->ReadRegister(VIA::DDRA) & 0x40)
                && !(vm->GetVIA1()->GetPortAOutput() & 0x40);
        }

        void step()
        {
            keyboard.tick();
            const bool held = inhibited();
            if (held && !wasInhibited) holdStart = cycles;
            if (!held && wasInhibited && installed)
                shortestHold = (std::min)(shortestHold, cycles - holdStart);
            wasInhibited = held;
            if (cpu->PC == mli)
            {
                installed = true;
                ++mliCalls;
            }
            if (installed && !vm->IsROMVisible(0xffff))
            {
                require((vm->GetVIA1()->ReadRegister(VIA::IER) & 0x7f) == 0,
                    "VIA interrupts enabled with ROM hidden");
                require(inhibited(), "PS/2 clock was released with ROM hidden");
            }
            if (installed && cpu->PC == mliReturn && vm->PeekData(ioDepth) == 1)
                require(vm->IsROMVisible(0xffff), "MLI did not restore ROM before input release");
            cycles += vm->Step();
        }

        void run(uint64_t budget)
        {
            const uint64_t end = cycles + budget;
            while (cycles < end) step();
        }

        void seek(uint16_t target, uint64_t budget = 30000000)
        {
            const uint64_t end = cycles + budget;
            while ((cpu->PC != target || !vm->WillExecuteCurrentInstruction()) && cycles < end) step();
            require(cycles < end, "Did not reach the requested disk-entry boundary");
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
            std::array<uint8_t, 11> bits{};
            uint8_t parity = 1;
            for (int i = 0; i < 8; ++i)
            {
                bits[i + 1] = (code >> i) & 1;
                parity ^= bits[i + 1];
            }
            bits[9] = parity;
            bits[10] = 1;
            const uint64_t deadline = cycles + 80000000;
            for (unsigned bit = 0; bit < bits.size();)
            {
                require(cycles < deadline, "PS/2 clock never released");
                if (inhibited())
                {
                    ++heldFrames;
                    while (inhibited() && cycles < deadline) step();
                    require(cycles < deadline, "PS/2 clock never released");
                    keyboard.pins(true, true);
                    run(320);
                    bit = 0;
                    continue;
                }
                keyboard.pins(bits[bit] != 0, false);
                run(period / 2);
                keyboard.pins(bits[bit] != 0, true);
                run(80 - period / 2);
                keyboard.pins(bit + 1 < bits.size() ? bits[bit + 1] != 0 : true, true);
                run(period - 80);
                ++bit;
            }
            run(3000);
        }

        void key(uint8_t code, bool extended = false)
        {
            if (extended) scan(0xe0);
            scan(code);
            run(300000);
            if (extended) scan(0xe0);
            scan(0xf0);
            scan(code);
            run(300000);
        }

        void lock(uint8_t code, uint8_t leds)
        {
            const size_t before = keyboard.commands.size();
            key(code);
            require(keyboard.phase == KeyboardPeer::Phase::Idle, "LED exchange did not finish");
            const std::vector<uint8_t> expected{0xf0, 2, 0xed, leds, 0xf4};
            require(std::vector<uint8_t>(keyboard.commands.begin() + before, keyboard.commands.end()) == expected,
                "Wrong PS/2 lock-key command sequence");
            require(keyboard.leds == leds && vm->PeekData(0xce00) == 0, "LED state or PS/2 framing lost");
        }
    };
}

int main(int argc, char** argv)
{
    try
    {
        require(argc == 8, "Usage: native-test <rom> <patched.woz> <period> <io-depth> <save-valid> <mli> <mli-return>");
        const auto number = [&](int i) { return uint16_t(std::stoul(argv[i], nullptr, 16)); };
        const unsigned period = unsigned(std::stoul(argv[3]));
        require(period >= 80 && period <= 160, "PS/2 timing must support the 80-cycle DATA hold");
        Machine m(argv[1], argv[2], period, number(4), number(5), number(6), number(7));
        m.key(0x32); // Continue before creating a character.
        require(m.vm->PeekData(m.saveValid) == 0, "An empty checkpoint became valid");
        m.key(0x1c);
        for (int stat = 0; stat < 3; ++stat)
        {
            for (int point = 0; point < 10; ++point) m.key(0x74, true);
            if (stat < 2) m.key(0x5a);
        }
        m.key(0x29);
        for (int i = 0; i < 3; ++i) m.key(0x1c);
        for (uint8_t code : {0x24, 0x2d, 0x43, 0x21, 0x5a}) m.key(code);
        m.key(0x35);
        require(m.vm->PeekData(m.saveValid) == 1, "Physical keyboard did not create a character");
        require(m.vm->PeekData(0xc84b) == 'E', "Character name was not saved");
        m.key(0x32);
        m.run(20000000);
        require(m.vm->PeekData(0x7eb8) == 'E', "Continue did not restore the character");
        const auto x = m.vm->PeekData(0);
        m.key(0x74, true);
        require(m.vm->PeekData(0) == uint8_t(x + 1), "Physical Right key did not move east");
        m.key(0x6b, true);
        require(m.vm->PeekData(0) == x, "Physical Left key did not move west");
        m.scan(0x15);
        m.seek(0xcc00);
        m.scan(0xf0);
        m.scan(0x15);
        m.run(10000000);
        require(m.vm->PeekData(0xcb15) == 0, "Break frame crossing disk entry left Q held");
        require(m.vm->PeekData(0xc806) == x, "Q did not update the RAM checkpoint position");
        m.key(0x32);
        m.run(20000000);
        require(m.vm->PeekData(0) == x, "Continue did not restore the saved world position");
        m.lock(0x58, 4);
        m.lock(0x77, 6);
        m.lock(0x58, 2);
        m.lock(0x77, 0);
        require(m.vm->PeekData(m.ioDepth) == 0 && !m.inhibited(), "Input remained locked");
        require(m.vm->PeekData(0xcafe) == 0, "ROM input bank nesting leaked");
        require(m.diskWrites == 0, "Session-only save attempted a floppy write");
        require(m.shortestHold >= 200, "PS/2 inhibit was shorter than its frame-restart threshold");
        std::cout << "PASS native Ultima PS/2 " << m.period << ": character creation, Continue, movement, RAM save, "
            << "four LED exchanges, " << m.mliCalls << " bank-safe MLI calls, "
            << m.heldFrames << " clock-inhibited frames, minimum hold " << m.shortestHold
            << " cycles; no floppy writes\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL native Ultima: " << error.what() << "\n";
        return 1;
    }
}
