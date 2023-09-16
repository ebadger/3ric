#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(LDX)
	{
	public:

#pragma region LDX
		/*
			case LDX_IMM:
			case LDX_ABS:
			case LDX_ABS_Y:
			case LDX_ZP:
			case LDX_ZP_Y:
		*/
		TEST_METHOD(TEST_LDX_IMM)
		{
			uint32_t cycles = 0;
			VM vm(true);
			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			// load 0x69 into the X register
			vm.WriteData(0x1000, LDX_IMM);
			vm.WriteData(0x1001, 0x69);

			cpu->Reset();

			cycles = cpu->Step();

			Assert::IsTrue(cpu->X == 0x69);
			Assert::IsTrue(cycles == 2);
		}

		TEST_METHOD(TEST_LDX_ABS)
		{
			uint32_t cycles = 0;
			VM vm(true);
			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			vm.WriteData(0x2000, 0x56);

			// load 0x69 into the A register
			vm.WriteData(0x1000, LDX_ABS);
			vm.WriteData(0x1001, 0x00);
			vm.WriteData(0x1002, 0x20);

			cpu->Reset();

			cycles = cpu->Step();

			Assert::IsTrue(cpu->X == 0x56);
			Assert::IsTrue(cycles == 4);
		}

		TEST_METHOD(TEST_LDX_ABS_Y)
		{
			uint32_t cycles = 0;
			VM vm(true);
			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			vm.WriteData(0x2022, 0x53);

			vm.WriteData(0x1000, LDY_IMM);
			vm.WriteData(0x1001, 0x22);

			vm.WriteData(0x1002, LDX_ABS_Y);
			vm.WriteData(0x1003, 0x00);
			vm.WriteData(0x1004, 0x20);

			cpu->Reset();

			cycles = cpu->Step();
			cycles += cpu->Step();

			Assert::IsTrue(cpu->X == 0x53);
			Assert::IsTrue(cpu->Y == 0x22);
			Assert::IsTrue(cycles == 6);
		}

		TEST_METHOD(TEST_LDX_ZP)
		{
			uint32_t cycles = 0;
			VM vm(true);
			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			vm.WriteData(0x10, 0xAB);

			vm.WriteData(0x1000, LDX_ZP);
			vm.WriteData(0x1001, 0x10);

			cpu->Reset();

			cycles = cpu->Step();

			Assert::IsTrue(cpu->X == 0xAB);
			Assert::IsTrue(cycles == 3);

		}

		TEST_METHOD(TEST_LDX_ZP_Y)
		{
			uint32_t cycles = 0;
			VM vm(true);
			uint16_t addr = 0x1000;

			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			vm.WriteData(0xDD, 0x69);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0xCD);

			vm.WriteData(addr++, LDX_ZP_Y);
			vm.WriteData(addr++, 0x10);

			cpu->Reset();

			cycles += cpu->Step();
			cycles += cpu->Step();

			Assert::IsTrue(cpu->X == 0x69);
			Assert::IsTrue(cpu->Y == 0xCD);
			Assert::IsTrue(cycles == 6);
		}

#pragma endregion LDX


	};
}
