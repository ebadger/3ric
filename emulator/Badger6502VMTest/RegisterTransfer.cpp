#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(RegisterTransfer)
	{
	public:
		TEST_METHOD(TEST_TXA)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, TXA);
			vm.WriteData(addr++, TXA);
			vm.WriteData(addr++, TXA);

			cpu->Reset();
			cpu->X = 0xFF;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0xFF);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->X == 0xFF);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cpu->X = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cpu->X = 0x00;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			Assert::IsTrue(cycles == 6);
		}

		TEST_METHOD(TEST_TAX)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, TAX);
			vm.WriteData(addr++, TAX);
			vm.WriteData(addr++, TAX);

			cpu->Reset();
			cpu->A = 0xFF;

			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->X == 0xFF);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->X == 0x7F);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cpu->A = 0x00;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			Assert::IsTrue(cycles == 6);
		}

		TEST_METHOD(TEST_TAY)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, TAY);
			vm.WriteData(addr++, TAY);
			vm.WriteData(addr++, TAY);

			cpu->Reset();
			cpu->A = 0xFF;

			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->Y == 0xFF);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cpu->A = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->Y == 0x7F);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cpu->A = 0x00;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			Assert::IsTrue(cycles == 6);
		}

		TEST_METHOD(TEST_TYA)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, TYA);
			vm.WriteData(addr++, TYA);
			vm.WriteData(addr++, TYA);

			cpu->Reset();
			cpu->Y = 0xFF;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->Y == 0xFF);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->Y == 0xFF);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cpu->Y = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cpu->Y = 0x00;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			Assert::IsTrue(cycles == 6);
		}

		TEST_METHOD(TEST_TXS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, TXS);
			vm.WriteData(addr++, TXS);
			vm.WriteData(addr++, TXS);

			cpu->Reset();
			cpu->X = 0xAA;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0xAA);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->SP = 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0xAA);
			Assert::IsTrue(cpu->SP == 0xAA);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cpu->X = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->SP == 0x7F);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cpu->X = 0x00;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->SP == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			Assert::IsTrue(cycles == 6);
		}

		TEST_METHOD(TEST_TSX)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, TSX);
			vm.WriteData(addr++, TSX);
			vm.WriteData(addr++, TSX);

			cpu->Reset();
			cpu->SP = 0xAA;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->SP = 0xAA);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->X == 0xAA);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cpu->SP = 0x7F;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->X == 0x7F);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cpu->SP = 0x00;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			Assert::IsTrue(cycles == 6);
		}

	};
}