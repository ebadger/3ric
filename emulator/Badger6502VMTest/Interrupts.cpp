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

		TEST_METHOD(ResetClearsWaitForInterrupt)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			cpu->waitForInterrupt = true;

			cpu->Reset();

			Assert::IsFalse(cpu->waitForInterrupt);
		}

		TEST_METHOD(WAIResumesAfterMaskedIRQ)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			const uint16_t start = 0x1000;

			vm.WriteData(start, WAI);
			vm.WriteData(start + 1, NOP);
			cpu->PC = start;
			cpu->flags.bits.I = 1;
			vm.WriteData(MM_MOCKINGBOARD_VIA1_START + VIA::IER, 0xC0);
			vm.WriteData(MM_MOCKINGBOARD_VIA1_START + VIA::T1CL, 1);
			vm.WriteData(MM_MOCKINGBOARD_VIA1_START + VIA::T1CH, 0);

			Assert::AreEqual((uint8_t)3, vm.Step());
			Assert::IsTrue(cpu->waitForInterrupt);
			Assert::AreEqual((uint16_t)(start + 1), cpu->PC);
			Assert::IsTrue(vm.IRQAsserted());

			Assert::AreEqual((uint8_t)2, vm.Step());
			Assert::IsFalse(cpu->waitForInterrupt);
			Assert::AreEqual((uint16_t)(start + 2), cpu->PC);
		}

		TEST_METHOD(WAIInterruptsWhenIRQIsEnabled)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			const uint16_t start = 0x1000;
			const uint16_t handler = 0x2000;

			vm.WriteData(start, WAI);
			vm.WriteData(0xFFFE, (uint8_t)handler);
			vm.WriteData(0xFFFF, (uint8_t)(handler >> 8));
			cpu->PC = start;
			cpu->flags.bits.I = 0;
			vm.WriteData(MM_MOCKINGBOARD_VIA1_START + VIA::IER, 0xC0);
			vm.WriteData(MM_MOCKINGBOARD_VIA1_START + VIA::T1CL, 1);
			vm.WriteData(MM_MOCKINGBOARD_VIA1_START + VIA::T1CH, 0);

			Assert::AreEqual((uint8_t)3, vm.Step());
			Assert::IsTrue(cpu->waitForInterrupt);
			Assert::AreEqual((uint8_t)7, vm.Step());
			Assert::IsFalse(cpu->waitForInterrupt);
			Assert::AreEqual(handler, cpu->PC);
		}

		TEST_METHOD(STPOnlyExitsOnReset)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			const uint16_t start = 0x1000;

			vm.WriteData(start, STP);
			cpu->PC = start;
			Assert::AreEqual((uint8_t)3, vm.Step());
			Assert::IsTrue(cpu->stopped);
			const uint16_t stoppedPC = cpu->PC;

			vm.WriteData(MM_MOCKINGBOARD_VIA1_START + VIA::IER, 0xC0);
			vm.WriteData(MM_MOCKINGBOARD_VIA1_START + VIA::T1CL, 1);
			vm.WriteData(MM_MOCKINGBOARD_VIA1_START + VIA::T1CH, 0);
			vm.TickDevices(2);
			Assert::IsTrue(vm.IRQAsserted());

			Assert::AreEqual((uint8_t)1, vm.Step());
			Assert::AreEqual(stoppedPC, cpu->PC);
			Assert::IsTrue(cpu->stopped);

			cpu->Reset();
			Assert::IsFalse(cpu->stopped);
		}

		TEST_METHOD(ACIAReceiverIRQFollowsCommandRegister)
		{
			VM vm(true);

			vm.WriteData(MM_ACIA_START + 2, 0x03);
			Assert::IsTrue(vm.SimulateSerialKey('A'));
			Assert::IsFalse(vm.IRQAsserted());
			Assert::AreEqual(
				(uint8_t)0x08,
				(uint8_t)(vm.ReadData(MM_ACIA_START + 1) & 0x08));
			Assert::AreEqual((uint8_t)'A', vm.ReadData(MM_ACIA_START));

			vm.WriteData(MM_ACIA_START + 2, 0x01);
			Assert::IsTrue(vm.SimulateSerialKey('B'));
			Assert::IsTrue(vm.IRQAsserted());

			vm.WriteData(MM_ACIA_START + 2, 0x03);
			Assert::IsFalse(vm.IRQAsserted());
			Assert::AreEqual((uint8_t)'B', vm.ReadData(MM_ACIA_START));
		}

		TEST_METHOD(ACIAProgrammedResetIgnoresWrittenData)
		{
			VM vm(true);

			vm.WriteData(MM_ACIA_START + 3, 0x1E);
			vm.WriteData(MM_ACIA_START + 2, 0xE1);
			Assert::IsTrue(vm.SimulateSerialKey('A'));
			Assert::IsTrue(vm.IRQAsserted());

			vm.WriteData(MM_ACIA_START + 1, 0x80);

			Assert::IsFalse(vm.IRQAsserted());
			Assert::AreEqual((uint8_t)0x10, vm.ReadData(MM_ACIA_START + 1));
			Assert::AreEqual((uint8_t)0xE0, vm.ReadData(MM_ACIA_START + 2));
			Assert::AreEqual((uint8_t)0x1E, vm.ReadData(MM_ACIA_START + 3));
		}


	};
}