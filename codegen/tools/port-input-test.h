#pragma once
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

namespace port_test
{
    void require(bool condition, const char* message)
    {
        if (!condition) throw std::runtime_error(message);
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
                bits = {0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1}; // $FA, odd parity, stop
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

    struct InputMachine
    {
        std::unique_ptr<VM> vm = std::make_unique<VM>(false);
        SDCard sd;
        CPU* cpu = vm->GetCPU();
        uint64_t cycles = 0, diskCycle = 0;
        KeyboardPeer keyboard{*vm, cycles};
        uint32_t period, hold;
        uint16_t nmiReturn, statePending;
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

        InputMachine(const char* romPath, const char* diskPath, uint32_t bitPeriod, uint32_t dataHold,
            uint16_t returnPC, uint16_t pendingPC)
            : period(bitPeriod), hold(dataHold), nmiReturn(returnPC), statePending(pendingPC)
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
                    if (frame.basic != vm->IsROMVisible(0x9000))
                        throw std::runtime_error("NMI BASIC overlay mismatch: interrupted PC="
                            + std::to_string(frame.pc) + ", return PC=" + std::to_string(cpu->PC)
                            + ", CAFE=" + std::to_string(vm->PeekData(0xcafe))
                            + ", frames=" + std::to_string(frames.size())
                            + ", checked=" + std::to_string(checkedInterrupts));
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
            const uint32_t dataHold = checking ? hold : period;
            for (int i = 0; i < 11; ++i)
            {
                const uint64_t edge = start + uint64_t(i) * period;
                while (cycles < edge) step();
                vm->GetVIA1()->SetPortAInputBits(0xc0, bits[i] << 7);
                vm->SignalVIA1Pin(VIA::CA2);
                while (cycles < edge + period / 2) step();
                vm->GetVIA1()->SetPortAInputBits(0x40, 0x40);
                while (cycles < edge + dataHold) step();
                vm->GetVIA1()->SetPortAInputBits(0xc0, (bits[i + 1] << 7) | 0x40);
                while (cycles < edge + period) step();
            }
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

    };
}
