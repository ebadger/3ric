#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(JMP)
	{
	public:


		TEST_METHOD(TEST_JMP_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);


			vm.WriteData(addr++, JMP_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x20);

			cpu->Reset();
		
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
		
			Assert::IsTrue(cpu->PC == 0x1000);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x2000);

			Assert::IsTrue(cycles == 3);
		}

		TEST_METHOD(TEST_JMP_ABS_I)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2000, 0x00);
			vm.WriteData(0x2001, 0x30);

			vm.WriteData(addr++, JMP_ABS_I);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x20);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);

			Assert::IsTrue(cpu->PC == 0x1000);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x3000);

			Assert::IsTrue(cycles == 5);
		}

	};
}