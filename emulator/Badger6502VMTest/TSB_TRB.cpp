#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(TSB_TRB)
	{
	public:

		TEST_METHOD(TEST_TSB_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2121, 0xAA);

			vm.WriteData(addr++, TSB_ABS);
			vm.WriteData(addr++, 0x21);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, TSB_ABS);
			vm.WriteData(addr++, 0x21);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, TSB_ABS);
			vm.WriteData(addr++, 0x21);
			vm.WriteData(addr++, 0x21);

			cpu->Reset();
			cpu->A = 0x55;

			Assert::IsTrue(cpu->A == 0x55);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2121) == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			cpu->A = 0xF0;
			vm.WriteData(0x2121, 0x8F);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2121) == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cpu->A = 0x00;
			vm.WriteData(0x2121, 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2121) == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			Assert::IsTrue(cycles == 18);
		}

		TEST_METHOD(TEST_TSB_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x21, 0xAA);

			vm.WriteData(addr++, TSB_ZP);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, TSB_ZP);
			vm.WriteData(addr++, 0x21);

			cpu->Reset();
			cpu->A = 0x55;

			Assert::IsTrue(cpu->A == 0x55);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x21) == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			cpu->A = 0x00;
			vm.WriteData(0x21, 0x00);
			cycles += cpu->Step();

			Assert::IsTrue(vm.ReadData(0x21) == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			Assert::IsTrue(cycles == 10);
		}

		TEST_METHOD(TEST_TRB_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2121, 0xFF);

			vm.WriteData(addr++, TRB_ABS);
			vm.WriteData(addr++, 0x21);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, TRB_ABS);
			vm.WriteData(addr++, 0x21);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, TRB_ABS);
			vm.WriteData(addr++, 0x21);
			vm.WriteData(addr++, 0x21);

			cpu->Reset();
			cpu->A = 0xAA;

			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2121) == 0x55);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2121) == 0x55);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			cpu->A = 0x0F;
			vm.WriteData(0x2121, 0xFF);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2121) == 0xF0);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			Assert::IsTrue(cycles == 18);
		}


		TEST_METHOD(TEST_TRB_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x21, 0xFF);

			vm.WriteData(addr++, TRB_ZP);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, TRB_ZP);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, TRB_ZP);
			vm.WriteData(addr++, 0x21);

			cpu->Reset();
			cpu->A = 0xAA;

			Assert::IsTrue(cpu->A == 0xAA);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x21) == 0x55);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x21) == 0x55);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			cpu->A = 0x0F;
			vm.WriteData(0x21, 0xFF);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x21) == 0xF0);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			Assert::IsTrue(cycles == 15);
		}

	};
}