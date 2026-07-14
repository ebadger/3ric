#include "pch.h"
#include "CppUnitTest.h"
#include "via.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(VIATests)
	{
	public:
		TEST_METHOD(Timer1SetsFlagBeforeItIsEnabled)
		{
			VIA via;

			via.WriteRegister(VIA::T1CL, 1);
			via.WriteRegister(VIA::T1CH, 0);
			via.Tick();
			Assert::AreEqual((uint8_t)0, (uint8_t)(via.ReadRegister(VIA::IFR) & 0x40));
			via.Tick();

			Assert::AreEqual((uint8_t)0x40, (uint8_t)(via.ReadRegister(VIA::IFR) & 0x40));
			Assert::IsFalse(via.IRQAsserted());

			via.WriteRegister(VIA::IER, 0xC0);
			Assert::IsTrue(via.IRQAsserted());
			Assert::AreEqual((uint8_t)0xC0, (uint8_t)(via.ReadRegister(VIA::IFR) & 0xC0));

			via.WriteRegister(VIA::IFR, 0x40);
			Assert::IsFalse(via.IRQAsserted());
		}

		TEST_METHOD(Timer1FreeRunsFromItsLatch)
		{
			VIA via;
			via.WriteRegister(VIA::ACR, 0x40);
			via.WriteRegister(VIA::T1CL, 1);
			via.WriteRegister(VIA::T1CH, 0);

			via.Tick();
			via.Tick();
			Assert::AreEqual((uint8_t)0x40, (uint8_t)(via.ReadRegister(VIA::IFR) & 0x40));

			(void)via.ReadRegister(VIA::T1CL);
			via.Tick();
			via.Tick();
			Assert::AreEqual((uint8_t)0x40, (uint8_t)(via.ReadRegister(VIA::IFR) & 0x40));
		}

		TEST_METHOD(Timer1UsesUltimaProgrammedCadence)
		{
			const uint16_t latches[] = { 0x6682, 0x8B06, 0x9C67, 0xA6D4 };
			for (uint16_t latch : latches)
			{
				VIA via;
				via.WriteRegister(VIA::ACR, 0x40);
				via.WriteRegister(VIA::T1CL, (uint8_t)latch);
				via.WriteRegister(VIA::T1CH, (uint8_t)(latch >> 8));

				const uint32_t period = (uint32_t)latch + 1;
				const uint32_t earlyTicks = period * 2 / 3;
				for (uint32_t i = 0; i < earlyTicks; ++i)
				{
					via.Tick();
				}
				Assert::AreEqual(
					(uint8_t)0,
					(uint8_t)(via.ReadRegister(VIA::IFR) & 0x40));

				for (uint32_t i = earlyTicks; i < period; ++i)
				{
					via.Tick();
				}
				Assert::AreEqual(
					(uint8_t)0x40,
					(uint8_t)(via.ReadRegister(VIA::IFR) & 0x40));
			}
		}

		TEST_METHOD(Timer2CountsPB6FallingEdges)
		{
			VIA via;
			via.WriteRegister(VIA::ACR, 0x20);
			via.WriteRegister(VIA::T2CL, 1);
			via.WriteRegister(VIA::T2CH, 0);

			for (int i = 0; i < 100; ++i)
			{
				via.Tick();
			}
			Assert::AreEqual((uint8_t)0, (uint8_t)(via.ReadRegister(VIA::IFR) & 0x20));

			via.SetPortBInputBits(0x40, 0x00);
			Assert::AreEqual((uint8_t)0, (uint8_t)(via.ReadRegister(VIA::IFR) & 0x20));
			via.SetPortBInputBits(0x40, 0x40);
			via.SetPortBInputBits(0x40, 0x00);
			Assert::AreEqual((uint8_t)0x20, (uint8_t)(via.ReadRegister(VIA::IFR) & 0x20));
		}

		TEST_METHOD(Timer1ForcesPB7ToOutput)
		{
			VIA via;
			via.WriteRegister(VIA::ACR, 0x80);
			via.WriteRegister(VIA::T1CL, 1);
			via.WriteRegister(VIA::T1CH, 0);

			Assert::AreEqual((uint8_t)0, (uint8_t)(via.ReadRegister(VIA::ORB_IRB) & 0x80));
			via.Tick();
			via.Tick();
			Assert::AreEqual((uint8_t)0x80, (uint8_t)(via.ReadRegister(VIA::ORB_IRB) & 0x80));
		}

		TEST_METHOD(IERUsesSetAndClearSemantics)
		{
			VIA via;
			via.WriteRegister(VIA::IER, 0xE0);
			Assert::AreEqual((uint8_t)0xE0, via.ReadRegister(VIA::IER));

			via.WriteRegister(VIA::IER, 0x20);
			Assert::AreEqual((uint8_t)0xC0, via.ReadRegister(VIA::IER));
		}

		TEST_METHOD(VMSamplesLevelIRQBetweenInstructions)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			const uint16_t start = 0x1000;
			const uint16_t handler = 0x2000;

			vm.WriteData(0xFFFC, (uint8_t)(start & 0xFF));
			vm.WriteData(0xFFFD, (uint8_t)(start >> 8));
			vm.WriteData(0xFFFE, (uint8_t)(handler & 0xFF));
			vm.WriteData(0xFFFF, (uint8_t)(handler >> 8));
			vm.WriteData(start, 0xEA);
			cpu->Reset();
			cpu->flags.bits.I = 0;

			vm.WriteData(MM_MOCKINGBOARD_VIA1_START + VIA::IER, 0xC0);
			vm.WriteData(MM_MOCKINGBOARD_VIA1_START + VIA::T1CL, 1);
			vm.WriteData(MM_MOCKINGBOARD_VIA1_START + VIA::T1CH, 0);
			vm.TickDevices(2);

			Assert::IsTrue(vm.IRQAsserted());
			Assert::AreEqual((uint8_t)7, vm.Step());
			Assert::AreEqual(handler, cpu->PC);
			Assert::IsTrue(cpu->flags.bits.I != 0);
		}

		TEST_METHOD(OnboardVIAControlPinsQueueNMI)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			const uint16_t start = 0x1000;
			const uint16_t handler = 0x3000;

			vm.WriteData(0xFFFC, (uint8_t)(start & 0xFF));
			vm.WriteData(0xFFFD, (uint8_t)(start >> 8));
			vm.WriteData(0xFFFA, (uint8_t)(handler & 0xFF));
			vm.WriteData(0xFFFB, (uint8_t)(handler >> 8));
			cpu->Reset();

			vm.WriteData(MM_VIA1_START + VIA::IER, 0x90);
			vm.SignalVIA1Pin(VIA::CB1);

			Assert::AreEqual((uint8_t)7, vm.Step());
			Assert::AreEqual(handler, cpu->PC);
		}

		TEST_METHOD(OnboardVIATimerQueuesNMI)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			const uint16_t start = 0x1000;
			const uint16_t handler = 0x3000;

			vm.WriteData(0xFFFC, (uint8_t)(start & 0xFF));
			vm.WriteData(0xFFFD, (uint8_t)(start >> 8));
			vm.WriteData(0xFFFA, (uint8_t)(handler & 0xFF));
			vm.WriteData(0xFFFB, (uint8_t)(handler >> 8));
			cpu->Reset();

			vm.WriteData(MM_VIA1_START + VIA::IER, 0xC0);
			vm.WriteData(MM_VIA1_START + VIA::T1CL, 1);
			vm.WriteData(MM_VIA1_START + VIA::T1CH, 0);
			vm.TickDevices(2);

			Assert::AreEqual((uint8_t)7, vm.Step());
			Assert::AreEqual(handler, cpu->PC);
		}
	};
}
