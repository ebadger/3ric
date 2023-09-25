#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(LDA)
	{
	public:	

#pragma region LDA
		/*
		case LDA_IMM:
		case LDA_ABS:
		case LDA_ABS_X:
		case LDA_ABS_Y:
		case LDA_ZP:
		case LDA_ZP_X:
		case LDA_I_ZP:
		case LDA_I_ZP_X:
		case LDA_I_ZP_Y:
        */

		TEST_METHOD(TEST_LDA_IMM)
		{
			uint32_t cycles = 0;
			VM vm(true);
			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			// load 0x69 into the A register
			vm.WriteData(0x1000, LDA_IMM);
			vm.WriteData(0x1001, 0x69);

			cpu->Reset();

			cycles = cpu->Step();

			Assert::IsTrue(cpu->A == 0x69);
			Assert::IsTrue(cycles == 2);
		}

		TEST_METHOD(TEST_LDA_ABS)
		{
			uint32_t cycles = 0;
			VM vm(true);
			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			vm.WriteData(0x2000, 0x56);

			// load 0x69 into the A register
			vm.WriteData(0x1000, LDA_ABS);
			vm.WriteData(0x1001, 0x00);
			vm.WriteData(0x1002, 0x20);

			cpu->Reset();

			cycles = cpu->Step();

			Assert::IsTrue(cpu->A == 0x56);
			Assert::IsTrue(cycles == 4);
		}
		TEST_METHOD(TEST_LDA_ABS_X)
		{
			uint32_t cycles = 0;
			VM vm(true);
			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			vm.WriteData(0x2020, 0x52);

			// load 0x20 into the X register
			vm.WriteData(0x1000, LDX_IMM);
			vm.WriteData(0x1001, 0x20);

			// load from 0x2000 + 0x20 from X reg
			vm.WriteData(0x1002, LDA_ABS_X);
			vm.WriteData(0x1003, 0x00);
			vm.WriteData(0x1004, 0x20);

			cpu->Reset();

			cycles = cpu->Step();
			cycles += cpu->Step();

			Assert::IsTrue(cpu->A == 0x52);
			Assert::IsTrue(cpu->X == 0x20);
			Assert::IsTrue(cycles == 6);
		}
		TEST_METHOD(TEST_LDA_ABS_Y)
		{
			uint32_t cycles = 0;
			VM vm(true);
			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			vm.WriteData(0x2022, 0x53);

			// load 0x20 into the Y register
			vm.WriteData(0x1000, LDY_IMM);
			vm.WriteData(0x1001, 0x22);

			// load from 0x2000 + 0x22 from Y reg
			vm.WriteData(0x1002, LDA_ABS_Y);
			vm.WriteData(0x1003, 0x00);
			vm.WriteData(0x1004, 0x20);

			cpu->Reset();

			cycles = cpu->Step();
			cycles += cpu->Step();

			Assert::IsTrue(cpu->A == 0x53);
			Assert::IsTrue(cpu->Y == 0x22);
			Assert::IsTrue(cycles == 6);
		}

		TEST_METHOD(TEST_LDA_ZP)
		{
			uint32_t cycles = 0;
			VM vm(true);
			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			vm.WriteData(0x10, 0xAB);

			// load 0x69 into the A register
			vm.WriteData(0x1000, LDA_ZP);
			vm.WriteData(0x1001, 0x10);

			cpu->Reset();

			cycles = cpu->Step();

			Assert::IsTrue(cpu->A == 0xAB);
			Assert::IsTrue(cycles == 3);
		}

		TEST_METHOD(TEST_LDA_ZP_X)
		{
			uint32_t cycles = 0;
			VM vm(true);
			uint16_t addr = 0x1000;

			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			vm.WriteData(0x30, 0xCD);

			// load 0x20 into the X register
			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0x20);

			// load 0x30 into the A register
			vm.WriteData(addr++, LDA_ZP_X);
			vm.WriteData(addr++, 0x10);

			cpu->Reset();

			cycles += cpu->Step();
			cycles += cpu->Step();

			Assert::IsTrue(cpu->A == 0xCD);
			Assert::IsTrue(cpu->X == 0x20);
			Assert::IsTrue(cycles == 6);
		}

		TEST_METHOD(TEST_LDA_I_ZP)
		{
			uint32_t cycles = 0;
			VM vm(true);
			uint16_t addr = 0x1000;

			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			vm.WriteData(0x30, 0xCD);
			vm.WriteData(0x31, 0xAB);

			vm.WriteData(0xABCD, 0xBA);

			// load 0x30 into the A register
			vm.WriteData(addr++, LDA_I_ZP);
			vm.WriteData(addr++, 0x30);

			cpu->Reset();

			cycles += cpu->Step();

			Assert::IsTrue(cpu->A == 0xBA);
			Assert::IsTrue(cycles == 5);
		}

		TEST_METHOD(TEST_LDA_I_ZP_X)
		{
			uint32_t cycles = 0;
			VM vm(true);
			uint16_t addr = 0x1000;

			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			vm.WriteData(0x50, 0xCD);
			vm.WriteData(0x51, 0xAB);

			vm.WriteData(0xABCD, 0xAB);

			// load 0x20 into the X register
			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0x20);

			// load 0x30 into the A register
			vm.WriteData(addr++, LDA_I_ZP_X);
			vm.WriteData(addr++, 0x30);

			cpu->Reset();

			cycles += cpu->Step();
			cycles += cpu->Step();

			Assert::IsTrue(cpu->A == 0xAB);
			Assert::IsTrue(cpu->X == 0x20);
			Assert::IsTrue(cycles == 8);
		}

		TEST_METHOD(TEST_LDA_I_ZP_Y)
		{
			uint32_t cycles = 0;
			VM vm(true);
			uint16_t addr = 0x1000;

			CPU* cpu = vm.GetCPU();

			vm.WriteData(0xFFFC, 0x00);
			vm.WriteData(0xFFFD, 0x10);

			vm.WriteData(0x30, 0x00);
			vm.WriteData(0x31, 0xAB);

			vm.WriteData(0xABCD, 0xAA);

			// load 0xCD into the Y register
			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0xCD);

			// load 0x30 into the A register
			vm.WriteData(addr++, LDA_I_ZP_Y);
			vm.WriteData(addr++, 0x30);

			cpu->Reset();

			cycles += cpu->Step();
			cycles += cpu->Step();

			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->Y == 0xCD);
			Assert::IsTrue(cycles == 7);
		}

#pragma endregion LDA

#pragma region LDX
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
#pragma endregion LDX

	};
}
