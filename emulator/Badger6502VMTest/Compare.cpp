#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(Compare)
	{
	public:

		TEST_METHOD(TEST_CMP_IMM)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, CMP_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, CMP_IMM);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CMP_IMM);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CMP_IMM);
			vm.WriteData(addr++, 0x7F);

			cpu->Reset();
			cpu->A = 0x01;

			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 8);
		}

		TEST_METHOD(TEST_CMP_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0xFF);
			vm.WriteData(0x82, 0x80);
			vm.WriteData(0x84, 0x7F);

			vm.WriteData(addr++, CMP_ZP);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CMP_ZP);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ZP);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ZP);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->A = 0x01;

			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 12);
		}

		TEST_METHOD(TEST_CMP_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x90, 0xFF);
			vm.WriteData(0x92, 0x80);
			vm.WriteData(0x94, 0x7F);

			vm.WriteData(addr++, CMP_ZP_X);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CMP_ZP_X);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ZP_X);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ZP_X);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->A = 0x01;
			cpu->X = 0x10;

			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->X == 0x10);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 16);
		}

		TEST_METHOD(TEST_CMP_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8000, 0xFF);
			vm.WriteData(0x8200, 0x80);
			vm.WriteData(0x8400, 0x7F);

			vm.WriteData(addr++, CMP_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CMP_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->A = 0x01;

			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 16);
		}

		TEST_METHOD(TEST_CMP_ABS_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8080, 0xFF);
			vm.WriteData(0x8280, 0x80);
			vm.WriteData(0x8480, 0x7F);

			vm.WriteData(addr++, CMP_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CMP_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->A = 0x01;
			cpu->X = 0x80;

			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->X == 0x80);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 16);
		}

		TEST_METHOD(TEST_CMP_ABS_X_CROSSPAGE)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8180, 0xFF);
			vm.WriteData(0x8380, 0x80);
			vm.WriteData(0x8580, 0x7F);

			vm.WriteData(addr++, CMP_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CMP_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->A = 0x01;
			cpu->X = 0x81;

			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->X == 0x81);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 20);
		}

		TEST_METHOD(TEST_CMP_ABS_Y)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8080, 0xFF);
			vm.WriteData(0x8280, 0x80);
			vm.WriteData(0x8480, 0x7F);

			vm.WriteData(addr++, CMP_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CMP_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->A = 0x01;
			cpu->Y = 0x80;

			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 16);
		}

		TEST_METHOD(TEST_CMP_ABS_Y_CROSSPAGE)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8180, 0xFF);
			vm.WriteData(0x8380, 0x80);
			vm.WriteData(0x8580, 0x7F);

			vm.WriteData(addr++, CMP_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CMP_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->A = 0x01;
			cpu->Y = 0x81;

			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->Y == 0x81);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 20);
		}

		TEST_METHOD(TEST_CMP_I_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0x00);
			vm.WriteData(0x81, 0x20);

			vm.WriteData(0x82, 0x00);
			vm.WriteData(0x83, 0x30);

			vm.WriteData(0x84, 0x00);
			vm.WriteData(0x85, 0x40);

			vm.WriteData(0x2000, 0xFF);
			vm.WriteData(0x3000, 0x80);
			vm.WriteData(0x4000, 0x7F);

			vm.WriteData(addr++, CMP_I_ZP);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CMP_I_ZP);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_I_ZP);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_I_ZP);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->A = 0x01;

			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 20);
		}

		TEST_METHOD(TEST_CMP_I_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0x00);
			vm.WriteData(0x81, 0x20);

			vm.WriteData(0x82, 0x00);
			vm.WriteData(0x83, 0x30);

			vm.WriteData(0x84, 0x00);
			vm.WriteData(0x85, 0x40);

			vm.WriteData(0x2000, 0xFF);
			vm.WriteData(0x3000, 0x80);
			vm.WriteData(0x4000, 0x7F);

			vm.WriteData(addr++, CMP_I_ZP_X);
			vm.WriteData(addr++, 0x70);

			vm.WriteData(addr++, CMP_I_ZP_X);
			vm.WriteData(addr++, 0x72);

			vm.WriteData(addr++, CMP_I_ZP_X);
			vm.WriteData(addr++, 0x72);

			vm.WriteData(addr++, CMP_I_ZP_X);
			vm.WriteData(addr++, 0x74);

			cpu->Reset();
			cpu->A = 0x01;
			cpu->X = 0x10;

			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->X == 0x10);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 24);
		}

		TEST_METHOD(TEST_CMP_I_ZP_Y)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0x00);
			vm.WriteData(0x81, 0x20);

			vm.WriteData(0x82, 0x00);
			vm.WriteData(0x83, 0x30);

			vm.WriteData(0x84, 0x00);
			vm.WriteData(0x85, 0x40);

			vm.WriteData(0x2080, 0xFF);
			vm.WriteData(0x3080, 0x80);
			vm.WriteData(0x4080, 0x7F);

			vm.WriteData(addr++, CMP_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CMP_I_ZP_Y);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_I_ZP_Y);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_I_ZP_Y);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->A = 0x01;
			cpu->Y = 0x80;

			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->Y == 0x80);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 20);
		}

		TEST_METHOD(TEST_CMP_I_ZP_Y_CROSSPAGE)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0xFF);
			vm.WriteData(0x81, 0x20);

			vm.WriteData(0x82, 0xFF);
			vm.WriteData(0x83, 0x30);

			vm.WriteData(0x84, 0xFF);
			vm.WriteData(0x85, 0x40);

			vm.WriteData(0x2100, 0xFF);
			vm.WriteData(0x3100, 0x80);
			vm.WriteData(0x4100, 0x7F);

			vm.WriteData(addr++, CMP_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CMP_I_ZP_Y);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_I_ZP_Y);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CMP_I_ZP_Y);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->A = 0x01;
			cpu->Y = 0x01;

			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->Y == 0x01);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->A = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 24);
		}

		TEST_METHOD(TEST_CPX_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8000, 0xFF);
			vm.WriteData(0x8200, 0x80);
			vm.WriteData(0x8400, 0x7F);

			vm.WriteData(addr++, CPX_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CPX_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CPX_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CPX_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->X = 0x01;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x01);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->X = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->X = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->X = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 16);
		}

		TEST_METHOD(TEST_CPX_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0xFF);
			vm.WriteData(0x82, 0x80);
			vm.WriteData(0x84, 0x7F);

			vm.WriteData(addr++, CPX_ZP);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CPX_ZP);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CPX_ZP);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CPX_ZP);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->X = 0x01;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x01);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->X = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->X = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->X = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 12);
		}

		TEST_METHOD(TEST_CPX_IMM)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, CPX_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, CPX_IMM);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CPX_IMM);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CPX_IMM);
			vm.WriteData(addr++, 0x7F);

			cpu->Reset();
			cpu->X = 0x01;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x01);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->X = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->X = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->X = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 8);
		}

		TEST_METHOD(TEST_CPY_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8000, 0xFF);
			vm.WriteData(0x8200, 0x80);
			vm.WriteData(0x8400, 0x7F);

			vm.WriteData(addr++, CPY_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CPY_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CPY_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CPY_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->Y = 0x01;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->Y = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->Y = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->Y = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 16);
		}

		TEST_METHOD(TEST_CPY_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0xFF);
			vm.WriteData(0x82, 0x80);
			vm.WriteData(0x84, 0x7F);

			vm.WriteData(addr++, CPY_ZP);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CPY_ZP);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CPY_ZP);
			vm.WriteData(addr++, 0x82);

			vm.WriteData(addr++, CPY_ZP);
			vm.WriteData(addr++, 0x84);

			cpu->Reset();
			cpu->Y = 0x01;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->Y = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->Y = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->Y = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 12);
		}

		TEST_METHOD(TEST_CPY_IMM)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, CPY_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, CPY_IMM);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CPY_IMM);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, CPY_IMM);
			vm.WriteData(addr++, 0x7F);

			cpu->Reset();
			cpu->Y = 0x01;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->Y = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);

			cpu->Y = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			cpu->Y = 0x80;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);

			Assert::IsTrue(cycles == 8);
		}

	};
}