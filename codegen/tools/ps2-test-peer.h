#pragma once
#include "vm.h"
#include <array>
#include <cstdint>
#include <stdexcept>
#include <vector>

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
                if (bits[0] != 0 || bits[10] != 1) throw std::runtime_error("Bad PS/2 host command frame");
                uint8_t value = 0, parity = bits[9];
                for (int i = 0; i < 8; ++i)
                {
                    value |= bits[i + 1] << i;
                    parity ^= bits[i + 1];
                }
                if (parity != 1) throw std::runtime_error("Bad PS/2 host command parity");
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
