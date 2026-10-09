#include "port-input-test.h"

using namespace port_test;

namespace
{
    struct PadTiming
    {
        uint8_t previous = 0;
        uint64_t latchRaised = 0, clockEdge = 0;
        uint64_t minLatch = UINT64_MAX, minLow = UINT64_MAX, minHigh = UINT64_MAX;
        unsigned bits = 0, scans = 0;
        bool scanning = false;

        void write(uint8_t pins, uint64_t cycles)
        {
            if ((pins & 0x40) && !(previous & 0x40))
            {
                require(!scanning, "SNES relatch interrupted a scan");
                latchRaised = cycles;
            }
            if (!(pins & 0x40) && (previous & 0x40))
            {
                const uint64_t width = cycles - latchRaised;
                require(width >= 19, "SNES latch pulse is shorter than 12 us at 3ric's clock");
                minLatch = (std::min)(minLatch, width);
                clockEdge = cycles;
                bits = 0;
                scanning = true;
            }
            if (scanning && ((pins ^ previous) & 0x80))
            {
                const uint64_t width = cycles - clockEdge;
                require(width >= 10, "SNES clock phase is shorter than 6 us at 3ric's clock");
                if (pins & 0x80)
                {
                    minLow = (std::min)(minLow, width);
                    ++bits;
                }
                else
                {
                    minHigh = (std::min)(minHigh, width);
                    if (bits == 16)
                    {
                        scanning = false;
                        ++scans;
                    }
                }
                clockEdge = cycles;
            }
            previous = pins;
        }
    };
}

int main(int argc, char** argv)
{
    try
    {
        require(argc == 8, "Usage: native-test <rom> <patched.woz> <period> <hold> <nmi-return> <state-pending> <frame-input>");
        const uint32_t period = uint32_t(std::stoul(argv[3]));
        const uint32_t hold = uint32_t(std::stoul(argv[4]));
        const auto number = [&](int i) { return uint16_t(std::stoul(argv[i], nullptr, 16)); };
        require(hold >= period / 2 && hold <= period, "Invalid PS/2 timing");
        InputMachine m(argv[1], argv[2], period, hold, number(5), number(6));
        const uint16_t frameInput = number(7);
        m.seek(0x20a5, 50000000);
        require(m.vm->PeekData(0xcf00) == 0x48, "Actual disk did not install its NMI adapter");
        m.step();
        m.run(100000);
        for (unsigned i = 0; i < 3; ++i)
        {
            m.key(0x29);
            m.run(2000000);
        }
        m.seek(0x2344, 2000000);
        m.key(period == 120 ? 0x24 : 0x1c); // E or A, through real PS/2 frames
        m.seek(frameInput, 30000000);
        require(!m.vm->IsROMVisible(0xfffa), "Gameplay did not select its RAM scenery cache");
        m.checking = true;
        PadTiming padTiming;
        const auto writeMemory = m.vm->CallbackWriteMemory;
        m.vm->CallbackWriteMemory = [&](uint16_t address, uint8_t value) {
            writeMemory(address, value);
            if (address == 0xc200) padTiming.write(m.vm->GetVIA1()->GetPortBOutput(), m.cycles);
        };
        require(m.cpu->flags.bits.I, "Gameplay unmasked IRQ while its handler is hidden by scenery");
        const uint8_t command = m.vm->ReadData(0xc102);
        m.vm->WriteData(0xc102, (command | 1) & ~2);
        require(m.vm->SimulateSerialKey('Q') && m.vm->IRQAsserted(), "Could not hold a real serial IRQ active");
        m.step();
        m.key(0x1e); // 2: two players
        m.seek(frameInput, 30000000);
        require(m.vm->PeekData(0x51) == 1 && m.vm->PeekData(0x52) == 1, "Physical 2 did not start two-player mode");
        m.step();

        for (unsigned i = 0; i < 160; ++i)
        {
            const unsigned player = i & 1;
            m.vm->SetGamepadState(player, uint16_t((1 << (4 + (i & 3))) | (i & 4 ? 1 : 0)));
            m.run(i * 19 + 1);
            const auto before = m.characters[0xca];
            m.key(0x3b); // J: player two's left direction
            require(m.characters[0xca] == before + 1, "Physical J was lost or duplicated");
            require(m.vm->PeekData(0xce00) == 0 && m.vm->PeekData(0xce01) == 0x3b
                && m.vm->PeekData(0xcb3b) == 0, "Make/break pair lost PS/2 framing");
            m.vm->SetGamepadState(player, 0);
        }
        m.lock(0x58, 4);
        m.lock(0x77, 6);
        m.lock(0x58, 2);
        m.lock(0x77, 0);

        // Inject physical scan traffic while the guest refills all 8 KiB of its
        // scenery cache, including the old NMI-vector-overwrite interval.
        m.vm->GetData()[0xc900] = 0x20;
        m.vm->GetData()[0xc901] = 0x51;
        m.vm->GetData()[0xc902] = 0x85;
        m.vm->GetData()[0xc903] = 0x4c;
        m.vm->GetData()[0xc904] = 0x03;
        m.vm->GetData()[0xc905] = 0xc9;
        for (unsigned i = 0; i < 16; ++i)
        {
            m.cpu->PC = 0xc900;
            m.step();
            m.run(i * 97 + 1);
            const auto before = m.characters[0xca];
            m.key(0x3b);
            m.seek(0xc903, 2000000);
            require(m.characters[0xca] == before + 1, "Scenery refill lost a physical key");
        }
        m.cpu->PC = 0x604e;
        m.seek(frameInput, 30000000);
        m.step();
        m.lock(0x58, 4);
        m.lock(0x58, 0);
        m.lock(0x77, 2);
        m.lock(0x77, 0);
        m.seek(frameInput, 20000000);
        require(m.vm->PeekData(0xcafe) == 0 && m.frames.empty(), "An input interrupt remained active");
        require(m.vm->IRQAsserted() && m.cpu->flags.bits.I, "Gameplay failed to retain its masked serial IRQ");
        require(m.vm->ReadData(0xc100) == 'Q', "Masked serial input was silently discarded");
        m.vm->WriteData(0xc102, command);
        require(!m.vm->IRQAsserted(), "Acknowledging the serial byte did not release IRQ");
        require(m.checkedInterrupts > 5000, "Native input coverage did not exercise enough interrupts");
        require(m.transitionInterrupts > 0, "No interrupt exercised a bank-switch/state-store boundary");
        require(padTiming.scans > 100, "Insufficient real-pin SNES timing coverage");
        std::cout << "PASS native PS/2 " << period << "/" << hold
            << ": actual disk boot/play, 176 mixed-input make/break pairs, eight LED exchanges, "
            << m.checkedInterrupts << " register/bank-preserving NMIs, "
            << m.transitionInterrupts << " interrupted bank transitions, 16 interrupted scenery copies, held serial IRQ\n";
        std::cout << "PASS SNES pins: " << padTiming.scans << " full scans, minimum latch/low/high "
            << padTiming.minLatch << "/" << padTiming.minLow << "/" << padTiming.minHigh << " cycles\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL native World Karate Championship: " << error.what() << "\n";
        return 1;
    }
}
