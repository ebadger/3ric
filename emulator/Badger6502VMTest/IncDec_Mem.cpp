#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(IncDec_Memory)
	{
	public:

		TEST_METHOD(TEST_INC_MEMORY)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2121, 0x7F);
			vm.WriteData(0x2122, 0xFF);
			vm.WriteData(0x22, 0x01);
            
			vm.WriteData(addr++, INC_ABS);
			vm.WriteData(addr++, 0x21);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0x22);

			vm.WriteData(addr++, INC_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, INC_ZP);
			vm.WriteData(addr++, 0x22);

			vm.WriteData(addr++, INC_ZP_X);
			vm.WriteData(addr++, 0x00);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2121) == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->X == 0x22);

			Assert::IsTrue(vm.ReadData(0x2122) == 0xFF);
			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2122) == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x22) == 0x02);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x22) == 0x03);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);


			Assert::IsTrue(cycles == 26);
		}


		TEST_METHOD(TEST_DEC_MEMORY)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2121, 0x80);
			vm.WriteData(0x2122, 0x00);
			vm.WriteData(0x22, 0x01);

			vm.WriteData(addr++, DEC_ABS);
			vm.WriteData(addr++, 0x21);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0x22);

			vm.WriteData(addr++, DEC_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, DEC_ZP);
			vm.WriteData(addr++, 0x22);

			vm.WriteData(addr++, DEC_ZP_X);
			vm.WriteData(addr++, 0x00);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2121) == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->X == 0x22);
			Assert::IsTrue(vm.ReadData(0x2122) == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2122) == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x22) == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x22) == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);


			Assert::IsTrue(cycles == 26);
		}

	};
}