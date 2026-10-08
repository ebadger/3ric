#include "port-input-test.h"
#include <iostream>

namespace
{
    using port_test::require;

    struct Machine : port_test::Machine
    {
        uint16_t readKey, gameDone;

        Machine(const char* romPath, const char* diskPath, uint32_t bitPeriod, uint32_t dataHold,
            uint16_t returnPC, uint16_t pendingPC, uint16_t keyPC, uint16_t donePC)
            : port_test::Machine(romPath, bitPeriod, dataHold, returnPC, pendingPC),
              readKey(keyPC), gameDone(donePC)
        {
            // Only the original noise sampler may read the mirrored vector bytes as data.
            vectorReadInstruction = 0x9df4;
            bootDisk(diskPath);
            seek(readKey, 2000000);
            require(vm->PeekData(0xcf00) == 0x48 && !vm->IsROMVisible(0xfffa),
                "Actual disk did not install bank-safe input");
            checking = true;
            key(0x29);
            run(16000000);
            require(vm->PeekData(0x23) == 1, "Physical Space did not advance the intro");
        }

        void stress(unsigned count, bool playing)
        {
            for (unsigned i = 0; i < count; ++i)
            {
                vm->SetGamepadState(0, uint16_t(playing ? (1 << (4 + (i & 3))) | 1 : 1));
                vm->SetGamepadState(1, uint16_t(playing ? (1 << (4 + ((i + 1) & 3))) | (1 << 9) : 0));
                run(i * 19 + 1);
                const auto before = characters[0xc9];
                key(0x43);
                require(characters[0xc9] == before + 1, "Physical I key was lost or duplicated");
                require(vm->PeekData(0xce00) == 0 && vm->PeekData(0xce01) == 0x43
                    && vm->PeekData(0xcb43) == 0, "Make/break pair lost PS/2 framing");
            }
            vm->SetGamepadState(0, 0);
            vm->SetGamepadState(1, 0);
            run(100000);
        }

        void pulse(unsigned controller, uint16_t mask)
        {
            vm->SetGamepadState(uint8_t(controller), mask);
            run(2000000);
            vm->SetGamepadState(uint8_t(controller), 0);
            run(2000000);
        }

        void samplePads(uint16_t first, uint16_t second)
        {
            vm->SetGamepadState(0, first);
            vm->SetGamepadState(1, second);
            run(1000000);
            seek(gameDone, 10000000);
        }
    };
}

int main(int argc, char** argv)
{
    try
    {
        require(argc == 9, "Usage: native-test <rom> <patched.woz> <period> <hold> <nmi-return> <state-pending> <read-key> <game-done>");
        const auto number = [&](int i) { return uint16_t(std::stoul(argv[i], nullptr, 16)); };
        Machine m(argv[1], argv[2], uint32_t(std::stoul(argv[3])), uint32_t(std::stoul(argv[4])),
            number(5), number(6), number(7), number(8));
        m.stress(80, false);
        m.lock(0x58, 4);
        m.lock(0x77, 6);
        m.lock(0x58, 2);
        m.lock(0x77, 0);
        m.pulse(0, 1 << 3);
        m.stress(160, true);
        m.run(16000000);
        require(m.vm->PeekData(0x23) == 0x80, "SNES Start did not start a match");
        m.lock(0x58, 4);
        m.lock(0x58, 0);
        m.lock(0x77, 2);
        m.lock(0x77, 0);
        m.key(0x23); // D, player-one stop
        m.key(0x42); // K, player-two stop
        m.samplePads((1 << 4) | 1, (1 << 7) | (1 << 9));
        require(m.vm->PeekData(0x14) == 0 && m.vm->PeekData(0x15) == 6
            && m.vm->PeekData(0x16) == 255 && m.vm->PeekData(0x17) == 255,
            "Two native controllers did not move/fire independently");
        m.samplePads(0, 0);
        require(m.vm->PeekData(0x14) == 255 && m.vm->PeekData(0x15) == 255
            && m.vm->PeekData(0x16) == 0 && m.vm->PeekData(0x17) == 0,
            "Native controller release stuck");
        m.pulse(1, 1 << 3);
        require(m.vm->PeekData(0x19) == 255, "Controller two did not pause");
        m.pulse(1, 1 << 3);
        require(m.vm->PeekData(0x19) == 0, "Controller two did not resume");
        m.seek(m.gameDone, 10000000);
        require(m.vm->PeekData(0xcafe) == 0 && m.frames.empty(), "An input interrupt remained active");
        std::cout << "PASS native Ballblazer PS/2 " << m.period << "/" << m.hold
            << ": actual WOZ boot, physical intro key, 240 mixed-input make/break pairs, eight LED exchanges, "
            << m.checkedInterrupts << " register/bank-preserving NMIs; two-pad move/fire/release/pause\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL native Ballblazer: " << error.what() << "\n";
        return 1;
    }
}
