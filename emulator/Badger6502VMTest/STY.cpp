#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(STY)
	{
	public:

		/*
			case STY_ABS:
			case STY_ZP:
			case STY_ZP_X:
		*/

		TEST_METHOD(TEST_STY_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0x69);

			vm.WriteData(addr++, STY_ABS);
			vm.WriteData(addr++, 0xCD);
			vm.WriteData(addr++, 0xAB);

			cpu->Reset();

			cycles += cpu->Step();
			cycles += cpu->Step();

			Assert::IsTrue(vm.ReadData(0xABCD) == 0x69);
			Assert::IsTrue(cycles == 6);
		}


		TEST_METHOD(TEST_STY_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0x69);

			vm.WriteData(addr++, STY_ZP);
			vm.WriteData(addr++, 0xAA);

			cpu->Reset();

			cycles += cpu->Step();
			cycles += cpu->Step();

			Assert::IsTrue(vm.ReadData(0xAA) == 0x69);
			Assert::IsTrue(cycles == 5);
		}

		TEST_METHOD(TEST_STY_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0x69);

			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0x11);

			vm.WriteData(addr++, STY_ZP_X);
			vm.WriteData(addr++, 0xAA);

			cpu->Reset();

			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();

			Assert::IsTrue(vm.ReadData(0xBB) == 0x69);
			Assert::IsTrue(cycles == 7);
		}

	};
}