#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(Branching)
	{
	public:

		// BRA - branch always
		TEST_METHOD(TEST_BRA)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, BRA);
			vm.WriteData(addr++, 0x7E);

			vm.WriteData(addr++, BRA);
			vm.WriteData(addr++, 0xFC);

			cpu->Reset();

			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1080);

			cpu->PC = 0x1002;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1000);

			Assert::IsTrue(cycles == 7);
		}

		// BPL - Branch if result plus (n=0)
		TEST_METHOD(TEST_BPL)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, BPL);
			vm.WriteData(addr++, 0x7E);

			vm.WriteData(addr++, BPL);
			vm.WriteData(addr++, 0xFC);

			cpu->Reset();

			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1080);

			cpu->PC = 0x1000;
			cpu->flags.bits.N = 1;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1002);

			cpu->PC = 0x1002;
			cpu->flags.bits.N = 0;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1000);

			Assert::IsTrue(cycles == 10);
		}

		// BMI - Branch if result Minus (n=1)
		TEST_METHOD(TEST_BMI)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, BMI);
			vm.WriteData(addr++, 0x7E);

			vm.WriteData(addr++, BMI);
			vm.WriteData(addr++, 0xFC);

			cpu->Reset();

			cpu->flags.bits.N = 1;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1080);

			cpu->PC = 0x1000;
			cpu->flags.bits.N = 0;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1002);

			cpu->PC = 0x1002;
			cpu->flags.bits.N = 1;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1000);

			Assert::IsTrue(cycles == 10);
		}

		// BVC - Branch on overflow clear (v=0)
		TEST_METHOD(TEST_BVC)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, BVC);
			vm.WriteData(addr++, 0x7E);

			vm.WriteData(addr++, BVC);
			vm.WriteData(addr++, 0xFC);

			cpu->Reset();

			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1080);

			cpu->PC = 0x1000;
			cpu->flags.bits.V = 1;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1002);

			cpu->PC = 0x1002;
			cpu->flags.bits.V = 0;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1000);

			Assert::IsTrue(cycles == 10);
		}
		// BVS - Branch on overflow set (v=1)
		TEST_METHOD(TEST_BVS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, BVS);
			vm.WriteData(addr++, 0x7E);

			vm.WriteData(addr++, BVS);
			vm.WriteData(addr++, 0xFC);

			cpu->Reset();

			cpu->flags.bits.V = 1;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1080);

			cpu->PC = 0x1000;
			cpu->flags.bits.V = 0;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1002);

			cpu->PC = 0x1002;
			cpu->flags.bits.V = 1;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1000);

			Assert::IsTrue(cycles == 10);
		}

		// BCC - Branch on carry clear (c=0)
		TEST_METHOD(TEST_BCC)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, BCC);
			vm.WriteData(addr++, 0x7E);

			vm.WriteData(addr++, BCC);
			vm.WriteData(addr++, 0xFC);

			cpu->Reset();

			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1080);

			cpu->PC = 0x1000;
			cpu->flags.bits.C = 1;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1002);

			cpu->PC = 0x1002;
			cpu->flags.bits.C = 0;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1000);

			Assert::IsTrue(cycles == 10);
		}

		// BCS - Branch on carry set (c=1)
		TEST_METHOD(TEST_BCS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, BCS);
			vm.WriteData(addr++, 0x7E);

			vm.WriteData(addr++, BCS);
			vm.WriteData(addr++, 0xFC);

			cpu->Reset();

			cpu->flags.bits.C = 1;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1080);

			cpu->PC = 0x1000;
			cpu->flags.bits.C = 0;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1002);

			cpu->PC = 0x1002;
			cpu->flags.bits.C = 1;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1000);

			Assert::IsTrue(cycles == 10);
		}

		// BNE - Branch if not equal zero (z=0)
		TEST_METHOD(TEST_BNE)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, BNE);
			vm.WriteData(addr++, 0x7E);

			vm.WriteData(addr++, BNE);
			vm.WriteData(addr++, 0xFC);

			cpu->Reset();

			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1080);

			cpu->PC = 0x1000;
			cpu->flags.bits.Z = 1;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1002);

			cpu->PC = 0x1002;
			cpu->flags.bits.Z = 0;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1000);

			Assert::IsTrue(cycles == 10);
		}

		// BEQ - Branch if equal to zero (z=1)
		TEST_METHOD(TEST_BEQ)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(addr++, BEQ);
			vm.WriteData(addr++, 0x7E);

			vm.WriteData(addr++, BEQ);
			vm.WriteData(addr++, 0xFC);

			cpu->Reset();

			cpu->flags.bits.Z = 1;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1080);

			cpu->PC = 0x1000;
			cpu->flags.bits.Z = 0;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1002);

			cpu->PC = 0x1002;
			cpu->flags.bits.Z = 1;
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == 0x1000);

			Assert::IsTrue(cycles == 10);
		}

		TEST_METHOD(TEST_BBR_NEG)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x20, 0xFF);

			vm.WriteData(addr++, BBR0);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBR1);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBR2);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBR3);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBR4);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBR5);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBR6);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBR7);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();

			// negative case, none of the instructions branch
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == addr);


			Assert::IsTrue(cycles == 40);
		}

		TEST_METHOD(TEST_BBR_POS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x20, 0x00);

			vm.WriteData(addr++, BBR0);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBR1);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBR2);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBR3);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBR4);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBR5);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBR6);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBR7);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			cpu->Reset();

			// negative case, none of the instructions branch
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();

			Assert::IsTrue(cpu->PC == addr);


			Assert::IsTrue(cycles == 40);
		}

		TEST_METHOD(TEST_BBS_NEG)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x20, 0x00);

			vm.WriteData(addr++, BBS0);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBS1);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBS2);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBS3);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBS4);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBS5);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBS6);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			vm.WriteData(addr++, BBS7);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();

			// negative case, none of the instructions branch
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC == addr);


			Assert::IsTrue(cycles == 40);
		}

		TEST_METHOD(TEST_BBS_POS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x20, 0xFF);

			vm.WriteData(addr++, BBS0);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBS1);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBS2);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBS3);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBS4);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBS5);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBS6);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			vm.WriteData(addr++, BBS7);
			vm.WriteData(addr++, 0x20);
			vm.WriteData(addr++, 0x10);

			addr += 0x10;

			cpu->Reset();

			// negative case, none of the instructions branch
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();
			cycles += cpu->Step();

			Assert::IsTrue(cpu->PC == addr);


			Assert::IsTrue(cycles == 40);
		}

	};
}