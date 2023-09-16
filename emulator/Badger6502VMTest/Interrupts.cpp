#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(Interrupts)
	{
	public:

		TEST_METHOD(TEST_BRK)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint16_t irqaddr = 0x2000;

			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0xFFFE, irqaddr & 0xFF);
			vm.WriteData(0xFFFF, irqaddr >> 8);

			vm.WriteData(addr++, BRK_STACK);
			vm.WriteData(addr++, 0x00);

			vm.WriteData(addr++, LDA_IMM);
			vm.WriteData(addr++, 0xFF);

			vm.WriteData(irqaddr++, PLA_STACK);
			vm.WriteData(irqaddr++, PHA_STACK);			
			vm.WriteData(irqaddr++, AND_IMM);
			vm.WriteData(irqaddr++, 0x10);   // check the zero flag to see if software interrupt

			vm.WriteData(irqaddr++, RTI_STACK);

			cpu->Reset();

			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC = 0x2000);  // irq routine

			cycles += cpu->Step();  // pull procesor flags
			cycles += cpu->Step();  // push processor flags back onto stack
			cycles += cpu->Step();  // and with $0x10 to check for software interrupt

			Assert::IsTrue(cpu->A == 0x10);

			cycles += cpu->Step();
			Assert::IsTrue(cpu->PC = 0x1002);


			Assert::IsTrue(cycles == 22);
		}

	};
}