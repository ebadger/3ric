#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(Shifting)
	{
	public:
		TEST_METHOD(TEST_ASL_A)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0x55);

			vm.WriteData(addr++, ASL_A);
			vm.WriteData(addr++, ASL_A);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x55);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x54);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 6);
		}

		TEST_METHOD(TEST_ASL_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2323, 0x55);

			vm.WriteData(addr++, ASL_ABS);
			vm.WriteData(addr++, 0x23);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ASL_ABS);
			vm.WriteData(addr++, 0x23);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0xAA);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x54);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 12);
		}

		TEST_METHOD(TEST_ASL_ABS_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);


			vm.WriteData(0x2323, 0x55);

			vm.WriteData(addr++, ASL_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ASL_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			cpu->X = 0x23;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x23);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0xAA);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x54);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 14);
		}

		TEST_METHOD(TEST_ASL_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x23, 0x55);

			vm.WriteData(addr++, ASL_ZP);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ASL_ZP);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x23) == 0xAA);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x23) == 0x54);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 10);
		}

		TEST_METHOD(TEST_ASL_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);


			vm.WriteData(0x46, 0x55);

			vm.WriteData(addr++, ASL_ZP_X);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ASL_ZP_X);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			cpu->X = 0x23;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x23);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x46) == 0xAA);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x46) == 0x54);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 12);
		}

// right shift
		TEST_METHOD(TEST_LSR_A)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, LSR_A);
			vm.WriteData(addr++, LSR_A);

			cpu->Reset();
			
			cpu->A = 0xAA;

			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x55);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x2A);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 4);
		}

		TEST_METHOD(TEST_LSR_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2323, 0xAA);

			vm.WriteData(addr++, LSR_ABS);
			vm.WriteData(addr++, 0x23);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, LSR_ABS);
			vm.WriteData(addr++, 0x23);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x55);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x2A);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 12);
		}

		TEST_METHOD(TEST_LSR_ABS_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);


			vm.WriteData(0x2323, 0xAA);

			vm.WriteData(addr++, LSR_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, LSR_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			cpu->X = 0x23;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x23);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x55);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x2A);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 14);
		}

		TEST_METHOD(TEST_LSR_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x23, 0xAA);

			vm.WriteData(addr++, LSR_ZP);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, LSR_ZP);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x23) == 0x55);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x23) == 0x2A);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 10);
		}

		TEST_METHOD(TEST_LSR_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);


			vm.WriteData(0x46, 0xAA);

			vm.WriteData(addr++, LSR_ZP_X);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, LSR_ZP_X);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			cpu->X = 0x23;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x23);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x46) == 0x55);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x46) == 0x2A);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 12);
		}

// ROL
		TEST_METHOD(TEST_ROL_A)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, ROL_A);
			vm.WriteData(addr++, ROL_A);

			cpu->Reset();

			cpu->A = 0xAA;
			cpu->flags.bits.C = 1;

			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x55);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xAB);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 4);
		}

		TEST_METHOD(TEST_ROL_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2323, 0xAA);

			vm.WriteData(addr++, ROL_ABS);
			vm.WriteData(addr++, 0x23);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ROL_ABS);
			vm.WriteData(addr++, 0x23);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();
			cpu->flags.bits.C = 1;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x55);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0xAB);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 12);
		}

		TEST_METHOD(TEST_ROL_ABS_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);


			vm.WriteData(0x2323, 0xAA);

			vm.WriteData(addr++, ROL_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ROL_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			cpu->X = 0x23;
			cpu->flags.bits.C = 1;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x23);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x55);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0xAB);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 14);
		}

		TEST_METHOD(TEST_ROL_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x23, 0xAA);

			vm.WriteData(addr++, ROL_ZP);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ROL_ZP);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();
			cpu->flags.bits.C = 1;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x23) == 0x55);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x23) == 0xAB);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 10);
		}

		TEST_METHOD(TEST_ROL_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);


			vm.WriteData(0x46, 0xAA);

			vm.WriteData(addr++, ROL_ZP_X);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ROL_ZP_X);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			cpu->X = 0x23;
			cpu->flags.bits.C = 1;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x23);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x46) == 0x55);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x46) == 0xAB);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 12);
		}

// ROR
		TEST_METHOD(TEST_ROR_A)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, ROR_A);
			vm.WriteData(addr++, ROR_A);
			vm.WriteData(addr++, ROR_A);

			cpu->Reset();

			cpu->A = 0xAA;

			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x55);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x2A);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x95);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 6);
		}

		TEST_METHOD(TEST_ROR_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2323, 0xAA);

			vm.WriteData(addr++, ROR_ABS);
			vm.WriteData(addr++, 0x23);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ROR_ABS);
			vm.WriteData(addr++, 0x23);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ROR_ABS);
			vm.WriteData(addr++, 0x23);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x55);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x2A);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x95);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 18);
		}

		TEST_METHOD(TEST_ROR_ABS_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);


			vm.WriteData(0x2323, 0xAA);

			vm.WriteData(addr++, ROR_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ROR_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ROR_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			cpu->X = 0x23;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x23);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x55);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x2A);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2323) == 0x95);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 21);
		}

		TEST_METHOD(TEST_ROR_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x23, 0xAA);

			vm.WriteData(addr++, ROR_ZP);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ROR_ZP);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ROR_ZP);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x23) == 0x55);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x23) == 0x2A);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x23) == 0x95);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 15);
		}

		TEST_METHOD(TEST_ROR_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);


			vm.WriteData(0x46, 0xAA);

			vm.WriteData(addr++, ROR_ZP_X);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ROR_ZP_X);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, ROR_ZP_X);
			vm.WriteData(addr++, 0x23);

			cpu->Reset();

			cpu->X = 0x23;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x23);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x46) == 0x55);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x46) == 0x2A);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x46) == 0x95);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			Assert::IsTrue(cycles == 18);
		}

	};
}