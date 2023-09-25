#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(Stack)
	{
	public:

		/*
		   PHA
		   PLA
		   PHX
		   PLX
		   PHY
		   PLY
		   PHP
		   PLP
		*/

		TEST_METHOD(TEST_PHA_PLA)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0x01);

			vm.WriteData(addr++, PHA_STACK);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0x02);

			vm.WriteData(addr++, PLA_STACK);

			cpu->Reset();

			cycles += cpu->Step();

			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->SP == 0xFF);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->SP == 0xFE);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x02);
			Assert::IsTrue(cpu->SP == 0xFE);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->SP == 0xFF);

			Assert::IsTrue(cycles == 11);
		}

		TEST_METHOD(TEST_PHX_PLX)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0x01);

			vm.WriteData(addr++, PHX_STACK);

			vm.WriteData(addr++, LDX_IMM);
			vm.WriteData(addr++, 0x02);

			vm.WriteData(addr++, PLX_STACK);

			cpu->Reset();

			cycles += cpu->Step();

			Assert::IsTrue(cpu->X == 0x01);
			Assert::IsTrue(cpu->SP == 0xFF);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->SP == 0xFE);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->X == 0x02);
			Assert::IsTrue(cpu->SP == 0xFE);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->X == 0x01);
			Assert::IsTrue(cpu->SP == 0xFF);

			Assert::IsTrue(cycles == 11);
		}

		TEST_METHOD(TEST_PHY_PLY)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0x01);

			vm.WriteData(addr++, PHY_STACK);

			vm.WriteData(addr++, LDY_IMM);
			vm.WriteData(addr++, 0x02);

			vm.WriteData(addr++, PLY_STACK);

			cpu->Reset();

			cycles += cpu->Step();

			Assert::IsTrue(cpu->Y == 0x01);
			Assert::IsTrue(cpu->SP == 0xFF);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->SP == 0xFE);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->Y == 0x02);
			Assert::IsTrue(cpu->SP == 0xFE);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->Y == 0x01);
			Assert::IsTrue(cpu->SP == 0xFF);

			Assert::IsTrue(cycles == 11);
		}

		TEST_METHOD(TEST_PHP_PLP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, PHP_STACK);
			cpu->flags.reg = 0x00;
			vm.WriteData(addr++, PLP_STACK);

			cpu->Reset();

			cpu->flags.reg = 0xFF;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->flags.reg == 0xFF);
			Assert::IsTrue(cpu->SP == 0xFE);

			cpu->flags.reg = 0x00;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->SP == 0xFF);
			Assert::IsTrue(cpu->flags.reg == 0xFF);
		}

	};
}