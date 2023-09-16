#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

// https://github.com/Klaus2m5/6502_65C02_functional_tests

namespace Badger6502VMTest
{
	TEST_CLASS(AND)
	{
	public:

		TEST_METHOD(TEST_AND_IMM)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);


			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, AND_IMM);
			vm.WriteData(addr++, 0xF0);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xF0);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);


			Assert::IsTrue(cycles == 4);
		}

		TEST_METHOD(TEST_AND_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2121, 0x0F);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, AND_ABS);
			vm.WriteData(addr++, 0x21);
			vm.WriteData(addr++, 0x21);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x0F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 6);
		}

		TEST_METHOD(TEST_AND_ABS_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2121, 0x01);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, AND_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x21);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->X == 0x21);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 8);
		}

		TEST_METHOD(TEST_AND_ABS_X_CROSSPAGE)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2121, 0xAA);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0x22);

			vm.WriteData(addr++, AND_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x20);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(vm.ReadData(0x2121) == 0xAA);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->X == 0x22);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 9);
		}
		TEST_METHOD(TEST_AND_ABS_Y)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2121, 0xAA);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, AND_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x21);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->Y == 0x21);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);


			Assert::IsTrue(cycles == 8);
		}

		TEST_METHOD(TEST_AND_ABS_Y_CROSSPAGE)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2121, 0xAA);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0x22);

			vm.WriteData(addr++, AND_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x20);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(vm.ReadData(0x2121) == 0xAA);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->Y == 0x22);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);


			Assert::IsTrue(cycles == 9);
		}

		TEST_METHOD(TEST_AND_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x22, 0xAA);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, AND_ZP);
			vm.WriteData(addr++, 0x22);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 5);
		}

		TEST_METHOD(TEST_AND_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x22, 0xAA);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0x11);

			vm.WriteData(addr++, AND_ZP_X);
			vm.WriteData(addr++, 0x11);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(vm.ReadData(0x22) == 0xAA);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->X == 0x11);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);


			Assert::IsTrue(cycles == 8);
		}

		TEST_METHOD(TEST_AND_I_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x1234, 0xAA);

			vm.WriteData(0x22, 0x34);
			vm.WriteData(0x23, 0x12);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0x11);

			vm.WriteData(addr++, AND_I_ZP_X);
			vm.WriteData(addr++, 0x11);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->X == 0x11);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 10);
		}
		TEST_METHOD(TEST_AND_I_ZP_Y)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x1234, 0xAA);

			vm.WriteData(0x22, 0x00);
			vm.WriteData(0x23, 0x12);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0x34);

			vm.WriteData(addr++, AND_I_ZP_Y);
			vm.WriteData(addr++, 0x22);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->Y == 0x34);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 9);
		}

		TEST_METHOD(TEST_AND_I_ZP_Y_CROSSPAGE)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x1234, 0xAA);

			vm.WriteData(0x22, 0xFF);
			vm.WriteData(0x23, 0x11);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0x35);

			vm.WriteData(addr++, AND_I_ZP_Y);
			vm.WriteData(addr++, 0x22);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->Y == 0x35);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 10);
		}

	};
}