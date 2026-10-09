#include "port-input-test.h"

using namespace port_test;

namespace
{
    struct Machine : InputMachine
    {
        uint16_t menuPad, gamePad, gamePadDone;

        Machine(const char* romPath, const char* diskPath, uint32_t bitPeriod, uint32_t dataHold,
            uint16_t returnPC, uint16_t pendingPC, uint16_t menuPC, uint16_t gamePC, uint16_t gameDone)
            : InputMachine(romPath, diskPath, bitPeriod, dataHold, returnPC, pendingPC),
              menuPad(menuPC), gamePad(gamePC), gamePadDone(gameDone)
        {
            run(50000000);
            for (int i = 0; i < 5; ++i)
            {
                key(0x29);
                run(10000000);
            }
            seek(menuPad, 2000000);
            require(vm->PeekData(0xcf00) == 0x48, "Disk did not install its NMI adapter");
            require(!vm->IsROMVisible(0xfffa), "Menu did not retain its bank-safe vector");
            checking = true;
        }

        void moveMenu(uint8_t x, uint8_t y)
        {
            const uint64_t end = cycles + 30000000;
            while (std::abs(int(vm->PeekData(0xa8)) - x) > 2 || std::abs(int(vm->PeekData(0xa9)) - y) > 2)
            {
                unsigned mask = 0;
                if (vm->PeekData(0xa8) < x - 2) mask |= 1 << 7;
                if (vm->PeekData(0xa8) > x + 2) mask |= 1 << 6;
                if (vm->PeekData(0xa9) < y - 2) mask |= 1 << 5;
                if (vm->PeekData(0xa9) > y + 2) mask |= 1 << 4;
                vm->SetGamepadState(0, uint16_t(mask));
                run(5000);
                require(cycles < end, "Menu cursor did not reach its target");
            }
            vm->SetGamepadState(0, 0);
            run(100000);
        }

        void stress(unsigned count)
        {
            for (unsigned i = 0; i < count; ++i)
            {
                vm->SetGamepadState(0, uint16_t(1 << (4 + (i & 3))));
                run(i * 19 + 1);
                const auto before = characters[0xc9];
                key(0x43);
                require(characters[0xc9] == before + 1, "Physical I key was lost or duplicated");
                require(vm->PeekData(0xce00) == 0 && vm->PeekData(0xce01) == 0x43
                    && vm->PeekData(0xcb43) == 0, "Make/break pair lost PS/2 framing");
            }
            vm->SetGamepadState(0, 0);
            run(100000);
        }
    };
}

int main(int argc, char** argv)
{
    try
    {
        require(argc == 10, "Usage: native-test <rom> <patched.woz> <period> <hold> <nmi-return> <state-pending> <menu-pad> <game-pad> <game-done>");
        const auto number = [&](int i) { return uint16_t(std::stoul(argv[i], nullptr, 16)); };
        const uint32_t period = uint32_t(std::stoul(argv[3]));
        const uint32_t hold = uint32_t(std::stoul(argv[4]));
        require(hold >= period / 2 && hold <= period, "Invalid PS/2 timing");
        Machine m(argv[1], argv[2], period, hold, number(5), number(6), number(7), number(8), number(9));
        m.stress(160);
        m.vm->SetGamepadState(0, 1 << 7);
        m.lock(0x58, 4);
        m.lock(0x77, 6);
        m.lock(0x58, 2);
        m.lock(0x77, 0);
        m.vm->SetGamepadState(0, 0);
        m.moveMenu(120, 185);
        m.vm->SetGamepadState(0, 1);
        m.seek(0xc800, 80000000);
        m.vm->SetGamepadState(0, 0);
        m.step();
        m.seek(m.gamePad, 30000000);
        m.stress(80);
        m.vm->SetGamepadState(0, 1 << 6);
        m.lock(0x58, 4);
        m.lock(0x58, 0);
        m.lock(0x77, 2);
        m.lock(0x77, 0);
        m.vm->SetGamepadState(0, 0);
        m.seek(m.gamePadDone, 20000000);
        require(m.vm->PeekData(0xcafe) == 0 && m.frames.empty(), "An input interrupt remained active");
        std::cout << "PASS native PS/2 " << period << "/" << hold
            << ": 240 mixed-input make/break pairs, eight LED exchanges, "
            << m.checkedInterrupts << " register/bank-preserving NMIs, "
            << m.transitionInterrupts << " interrupted bank transitions; actual disk menu and board\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAIL native Archon: " << error.what() << "\n";
        return 1;
    }
}
