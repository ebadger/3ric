#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(Registers)
	{
	public:

		TEST_METHOD(TEST_INC)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0x01);

			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0x02);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0x03);

			vm.WriteData(addr++, INC_A);
			vm.WriteData(addr++, INX);
			vm.WriteData(addr++, INY);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->X == 0x02);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->X == 0x02);
			Assert::IsTrue(cpu->Y == 0x03);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x02);
			Assert::IsTrue(cpu->X == 0x02);
			Assert::IsTrue(cpu->Y == 0x03);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x02);
			Assert::IsTrue(cpu->X == 0x03);
			Assert::IsTrue(cpu->Y == 0x03);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x02);
			Assert::IsTrue(cpu->X == 0x03);
			Assert::IsTrue(cpu->Y == 0x04);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 12);
		}

		TEST_METHOD(TEST_INC_FLAGS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(addr++, INC_A);
			vm.WriteData(addr++, INX);
			vm.WriteData(addr++, INY);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->X == 0xFF);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->X == 0xFF);
			Assert::IsTrue(cpu->Y == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0xFF);
			Assert::IsTrue(cpu->Y == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 12);
		}

		TEST_METHOD(TEST_DEC)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0x00);

			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0x01);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0x02);

			vm.WriteData(addr++, DEC);
			vm.WriteData(addr++, DEX);
			vm.WriteData(addr++, DEY);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x01);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x01);
			Assert::IsTrue(cpu->Y == 0x02);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->X == 0x01);
			Assert::IsTrue(cpu->Y == 0x02);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x02);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cycles == 12);
		}

	};
}