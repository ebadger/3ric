#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(JSR_RTS)
	{
	public:


		TEST_METHOD(TEST_JSR_RTS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0x01);

			vm.WriteData(addr++, JSR_ABS);
			vm.WriteData(addr++, 0x22);
			vm.WriteData(addr++, 0x44);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0x3);

			// subroutine

			vm.WriteData(0x4422, LDX_IMM);
			vm.WriteData(0x4423, 0x2);
			vm.WriteData(0x4424, RTS_STACK);

			cpu->Reset();

			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();

			Assert::IsTrue(cpu->A == 1);
			Assert::IsTrue(cpu->X == 2);
			Assert::IsTrue(cpu->Y == 3);
			Assert::IsTrue(cpu->SP == 0xFF);

			Assert::IsTrue(cycles == 18);
		}

	};
}