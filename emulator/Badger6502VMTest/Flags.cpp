#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(Flags)
	{
	public:

		// SEC - set carry flag
		// CLC - Clear carry flag
		// SEI - Set interrupt disable flag
		// CLI - Clear interrupt disable flag
		// SED - Set decimal flag
		// CLD - Clear decimal flag
		// CLV - Clear overflow
		

		TEST_METHOD(TEST_FLAGS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);


			vm.WriteData(addr++, SEC);
			vm.WriteData(addr++, CLC);
			vm.WriteData(addr++, SEI);
			vm.WriteData(addr++, CLI);
			vm.WriteData(addr++, SED);
			vm.WriteData(addr++, CLD);
			vm.WriteData(addr++, CLV);

			cpu->Reset();
			cpu->flags.bits.I = 0;

			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.I == 0x00);
			Assert::IsTrue(cpu->flags.bits.D == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step(); 
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.I == 0x00);
			Assert::IsTrue(cpu->flags.bits.D == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.I == 0x00);
			Assert::IsTrue(cpu->flags.bits.D == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.I == 0x01);
			Assert::IsTrue(cpu->flags.bits.D == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.I == 0x00);
			Assert::IsTrue(cpu->flags.bits.D == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.I == 0x00);
			Assert::IsTrue(cpu->flags.bits.D == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.I == 0x00);
			Assert::IsTrue(cpu->flags.bits.D == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cpu->flags.bits.V = 1;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.I == 0x00);
			Assert::IsTrue(cpu->flags.bits.D == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 14);
		}



	};
}