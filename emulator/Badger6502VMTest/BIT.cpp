#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(BIT)
	{
	public:


		TEST_METHOD(TEST_BIT_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2121, 0xC0);
			vm.WriteData(0x2122, 0x80);
			vm.WriteData(0x2123, 0x40);
			vm.WriteData(0x2124, 0x00);

			vm.WriteData(addr++, BIT_ABS);
			vm.WriteData(addr++, 0x21);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, BIT_ABS);
			vm.WriteData(addr++, 0x22);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, BIT_ABS);
			vm.WriteData(addr++, 0x23);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, BIT_ABS);
			vm.WriteData(addr++, 0x24);
			vm.WriteData(addr++, 0x21);

			cpu->Reset();
			cpu->A = 0x80;

			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			Assert::IsTrue(cycles == 16);
		}


		TEST_METHOD(TEST_BIT_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x21, 0xC0);
			vm.WriteData(0x22, 0x80);
			vm.WriteData(0x23, 0x40);
			vm.WriteData(0x24, 0x00);

			vm.WriteData(addr++, BIT_ZP);
			vm.WriteData(addr++, 0x21);

			vm.WriteData(addr++, BIT_ZP);
			vm.WriteData(addr++, 0x22);

			vm.WriteData(addr++, BIT_ZP);
			vm.WriteData(addr++, 0x23);

			vm.WriteData(addr++, BIT_ZP);
			vm.WriteData(addr++, 0x24);

			cpu->Reset();
			cpu->A = 0x80;

			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);

			Assert::IsTrue(cycles == 12);
		}

	};
}