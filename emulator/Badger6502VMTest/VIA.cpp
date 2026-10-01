#include "pch.h"
#include "CppUnitTest.h"
#include "via.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace
{
	void TickVIA(VIA& via, uint32_t cycles)
	{
		for (uint32_t i = 0; i < cycles; ++i)
		{
			via.Tick();
		}
	}

	uint16_t ReadTimer(VIA& via, uint8_t lowRegister)
	{
		const uint8_t low = via.ReadRegister(lowRegister);
		const uint8_t high = via.ReadRegister(lowRegister + 1);
		return (uint16_t)(low | ((uint16_t)high << 8));
	}

	void PulsePB6(VIA& via)
	{
		via.SetPortBInputBits(0x40, 0x40);
		via.SetPortBInputBits(0x40, 0x00);
	}

	void AssertTimersQuiet(VIA& via)
	{
		Assert::AreEqual((uint8_t)0, via.ReadRegister(VIA::IFR));
		Assert::IsFalse(via.IRQAsserted());
	}
}

namespace Badger6502VMTest
{
	TEST_CLASS(VIATests)
	{
	public:
		TEST_METHOD(ColdTimersCountAndWrapWithoutInterrupts)
		{
			VIA via;
			uint16_t t1 = ReadTimer(via, VIA::T1CL);
			uint16_t t2 = ReadTimer(via, VIA::T2CL);
			bool t1Wrapped = false;
			bool t2Wrapped = false;
			via.WriteRegister(VIA::IER, 0xE0);

			for (uint32_t cycles = 0; cycles < 0x10008; cycles += 8)
			{
				TickVIA(via, 8);
				// Check IFR before counter-low reads can acknowledge a stray timeout.
				AssertTimersQuiet(via);
				const uint16_t nextT1 = ReadTimer(via, VIA::T1CL);
				const uint16_t nextT2 = ReadTimer(via, VIA::T2CL);
				Assert::AreEqual((uint16_t)(t1 - 8), nextT1);
				Assert::AreEqual((uint16_t)(t2 - 8), nextT2);
				t1Wrapped |= nextT1 > t1;
				t2Wrapped |= nextT2 > t2;
				t1 = nextT1;
				t2 = nextT2;
			}
			Assert::IsTrue(t1Wrapped && t2Wrapped);
		}

		TEST_METHOD(ResetPreservesTimerStorageAndClearsPendingInterrupts)
		{
			const uint8_t modes[] = { 0x80, 0xC0 };
			for (uint8_t mode : modes)
			{
				VIA via;
				via.WriteRegister(VIA::ACR, mode);
				via.WriteRegister(VIA::IER, 0xE0);
				via.WriteRegister(VIA::T1CL, 3);
				via.WriteRegister(VIA::T1CH, 0);
				via.WriteRegister(VIA::T2CL, 4);
				via.WriteRegister(VIA::T2CH, 0);
				via.WriteRegister(VIA::T1LL, 0x34);
				via.WriteRegister(VIA::T1LH, 0x12);
				via.WriteRegister(VIA::T2CL, 0x78);
				TickVIA(via, 5);
				Assert::AreEqual((uint8_t)0xE0, via.ReadRegister(VIA::IFR));
				Assert::IsTrue(via.IRQAsserted());

				via.Reset();
				const uint16_t t1 = (mode & 0x40) ? 0x1233 : 0xFFFE;
				AssertTimersQuiet(via);
				Assert::AreEqual((uint8_t)0, via.ReadRegister(VIA::ACR));
				Assert::AreEqual((uint8_t)0x80, via.ReadRegister(VIA::IER));
				Assert::AreEqual(t1, ReadTimer(via, VIA::T1CL));
				Assert::AreEqual((uint16_t)0xFFFF, ReadTimer(via, VIA::T2CL));
				Assert::AreEqual((uint8_t)0x34, via.ReadRegister(VIA::T1LL));
				Assert::AreEqual((uint8_t)0x12, via.ReadRegister(VIA::T1LH));

				TickVIA(via, 8);
				AssertTimersQuiet(via);
				Assert::AreEqual((uint16_t)(t1 - 8), ReadTimer(via, VIA::T1CL));
				Assert::AreEqual((uint16_t)0xFFF7, ReadTimer(via, VIA::T2CL));
				via.WriteRegister(VIA::T1CH, 0x56);
				via.WriteRegister(VIA::T2CH, 0x9A);
				Assert::AreEqual((uint16_t)0x5634, ReadTimer(via, VIA::T1CL));
				Assert::AreEqual((uint16_t)0x9A78, ReadTimer(via, VIA::T2CL));
			}
		}

		TEST_METHOD(ResetDisarmsLoadedTimersBeforeTheirTimeout)
		{
			const uint8_t modes[] = { 0x80, 0xC0 };
			for (uint8_t mode : modes)
			{
				VIA via;
				via.WriteRegister(VIA::ACR, mode);
				via.WriteRegister(VIA::T1CL, 1);
				via.WriteRegister(VIA::T1CH, 0);
				via.WriteRegister(VIA::T2CL, 2);
				via.WriteRegister(VIA::T2CH, 0);
				via.Tick();
				via.Reset();
				Assert::AreEqual((uint16_t)0, ReadTimer(via, VIA::T1CL));
				Assert::AreEqual((uint16_t)1, ReadTimer(via, VIA::T2CL));
				via.WriteRegister(VIA::IER, 0xE0);
				via.WriteRegister(VIA::ACR, 0xC0);

				for (int i = 0; i < 8; ++i)
				{
					via.Tick();
					AssertTimersQuiet(via);
					Assert::AreEqual(
						(uint8_t)0x80, (uint8_t)(via.GetPortBOutput() & 0x80));
				}
				Assert::AreEqual((uint16_t)0, ReadTimer(via, VIA::T1CL));
				Assert::AreEqual((uint16_t)0xFFF9, ReadTimer(via, VIA::T2CL));
			}
		}

		TEST_METHOD(UnarmedContinuousTimerReloadsWithoutEvents)
		{
			VIA via;
			via.WriteRegister(VIA::IER, 0xE0);
			via.WriteRegister(VIA::ACR, 0xC0);
			via.WriteRegister(VIA::T1CL, 1);
			via.WriteRegister(VIA::T1LL, 3);
			via.WriteRegister(VIA::T1LH, 1);
			via.WriteRegister(VIA::T2CL, 5);
			TickVIA(via, (uint32_t)ReadTimer(via, VIA::T1CL) + 1);
			AssertTimersQuiet(via);
			Assert::AreEqual((uint16_t)0x0103, ReadTimer(via, VIA::T1CL));
			Assert::AreEqual((uint8_t)0x80, (uint8_t)(via.GetPortBOutput() & 0x80));

			TickVIA(via, 0x0104);
			AssertTimersQuiet(via);
			Assert::AreEqual((uint16_t)0x0103, ReadTimer(via, VIA::T1CL));
			Assert::AreEqual((uint8_t)0x80, (uint8_t)(via.GetPortBOutput() & 0x80));
		}

		TEST_METHOD(LatchWritesDoNotReplaceTheCurrentTimeout)
		{
			VIA via;
			via.WriteRegister(VIA::ACR, 0xC0);
			via.WriteRegister(VIA::T1CL, 3);
			via.WriteRegister(VIA::T1CH, 0);
			via.WriteRegister(VIA::T2CL, 3);
			via.WriteRegister(VIA::T2CH, 0);
			via.Tick();
			via.WriteRegister(VIA::T1CL, 7);
			via.WriteRegister(VIA::T1LL, 9);
			via.WriteRegister(VIA::T1LH, 0);
			via.WriteRegister(VIA::T2CL, 12);
			Assert::AreEqual((uint16_t)2, ReadTimer(via, VIA::T1CL));
			Assert::AreEqual((uint16_t)2, ReadTimer(via, VIA::T2CL));

			TickVIA(via, 2);
			AssertTimersQuiet(via);
			via.Tick();
			Assert::AreEqual((uint8_t)0x60, via.ReadRegister(VIA::IFR));
			Assert::AreEqual((uint16_t)9, ReadTimer(via, VIA::T1CL));
			Assert::AreEqual((uint16_t)0xFFFF, ReadTimer(via, VIA::T2CL));
			Assert::AreEqual((uint8_t)0x80, (uint8_t)(via.GetPortBOutput() & 0x80));

			TickVIA(via, 9);
			AssertTimersQuiet(via);
			via.Tick();
			Assert::AreEqual((uint8_t)0x40, via.ReadRegister(VIA::IFR));
			Assert::AreEqual((uint8_t)0, (uint8_t)(via.GetPortBOutput() & 0x80));
		}

		TEST_METHOD(OneShotTimersKeepCountingWithoutRepeatingEvents)
		{
			VIA via;
			via.WriteRegister(VIA::ACR, 0x80);
			via.WriteRegister(VIA::IER, 0xE0);
			via.WriteRegister(VIA::T1CL, 1);
			via.WriteRegister(VIA::T1CH, 0);
			via.WriteRegister(VIA::T2CL, 1);
			via.WriteRegister(VIA::T2CH, 0);
			TickVIA(via, 2);
			Assert::AreEqual((uint8_t)0xE0, via.ReadRegister(VIA::IFR));
			Assert::AreEqual((uint16_t)0xFFFF, ReadTimer(via, VIA::T1CL));
			Assert::AreEqual((uint16_t)0xFFFF, ReadTimer(via, VIA::T2CL));
			TickVIA(via, 8);
			AssertTimersQuiet(via);
			Assert::AreEqual((uint16_t)0xFFF7, ReadTimer(via, VIA::T1CL));
			Assert::AreEqual((uint16_t)0xFFF7, ReadTimer(via, VIA::T2CL));
			TickVIA(via, 0x10000);
			AssertTimersQuiet(via);
			Assert::AreEqual((uint16_t)0xFFF7, ReadTimer(via, VIA::T1CL));
			Assert::AreEqual((uint16_t)0xFFF7, ReadTimer(via, VIA::T2CL));

			via.WriteRegister(VIA::IER, 0x60);
			via.WriteRegister(VIA::IER, 0xE0);
			via.WriteRegister(VIA::ACR, 0xC0);
			via.WriteRegister(VIA::T1CL, 3);
			via.WriteRegister(VIA::T1LL, 5);
			via.WriteRegister(VIA::T1LH, 0);
			via.WriteRegister(VIA::T2CL, 7);
			TickVIA(via, 0xFFF8);
			AssertTimersQuiet(via);
			Assert::AreEqual((uint16_t)5, ReadTimer(via, VIA::T1CL));
			Assert::AreEqual((uint8_t)0x80, (uint8_t)(via.GetPortBOutput() & 0x80));
			TickVIA(via, 6);
			AssertTimersQuiet(via);
			Assert::AreEqual((uint8_t)0x80, (uint8_t)(via.GetPortBOutput() & 0x80));
		}

		TEST_METHOD(HighCounterWritesIndependentlyRearmTimers)
		{
			VIA via;
			via.WriteRegister(VIA::IER, 0xE0);
			via.WriteRegister(VIA::T1CL, 1);
			via.WriteRegister(VIA::T2CL, 1);
			via.WriteRegister(VIA::T1CH, 0);
			via.Tick();
			via.WriteRegister(VIA::T1CH, 0);
			via.Tick();
			AssertTimersQuiet(via);
			via.Tick();
			Assert::AreEqual((uint8_t)0xC0, via.ReadRegister(VIA::IFR));

			via.WriteRegister(VIA::T2CH, 0);
			Assert::AreEqual((uint8_t)0xC0, via.ReadRegister(VIA::IFR));
			TickVIA(via, 2);
			Assert::AreEqual((uint8_t)0xE0, via.ReadRegister(VIA::IFR));
			via.WriteRegister(VIA::T1CH, 0);
			Assert::AreEqual((uint8_t)0xA0, via.ReadRegister(VIA::IFR));
			TickVIA(via, 2);
			Assert::AreEqual((uint8_t)0xE0, via.ReadRegister(VIA::IFR));

			via.WriteRegister(VIA::T2CH, 0);
			Assert::AreEqual((uint8_t)0xC0, via.ReadRegister(VIA::IFR));
			(void)via.ReadRegister(VIA::T1CL);
			via.WriteRegister(VIA::IER, 0x60);
			TickVIA(via, 2);
			Assert::AreEqual((uint8_t)0x20, via.ReadRegister(VIA::IFR));
			Assert::IsFalse(via.IRQAsserted());
			via.WriteRegister(VIA::IER, 0xA0);
			Assert::IsTrue(via.IRQAsserted());
		}

		TEST_METHOD(Timer2SelectsItsClockWhileUnarmed)
		{
			VIA via;
			via.WriteRegister(VIA::ACR, 0x20);
			via.WriteRegister(VIA::IER, 0xA0);
			const uint16_t initial = ReadTimer(via, VIA::T2CL);
			TickVIA(via, 32);
			Assert::AreEqual(initial, ReadTimer(via, VIA::T2CL));
			PulsePB6(via);
			AssertTimersQuiet(via);
			Assert::AreEqual((uint16_t)(initial - 1), ReadTimer(via, VIA::T2CL));

			via.WriteRegister(VIA::DDRB, 0x40);
			PulsePB6(via);
			Assert::AreEqual((uint16_t)(initial - 1), ReadTimer(via, VIA::T2CL));
			via.WriteRegister(VIA::DDRB, 0);
			via.SetPortBInputBits(0x40, 0x40);
			Assert::AreEqual((uint16_t)(initial - 1), ReadTimer(via, VIA::T2CL));
			via.SetPortBInputBits(0x40, 0);
			Assert::AreEqual((uint16_t)(initial - 2), ReadTimer(via, VIA::T2CL));
			for (uint32_t i = 0; i < 0x10000; ++i)
			{
				PulsePB6(via);
			}
			AssertTimersQuiet(via);
			Assert::AreEqual((uint16_t)(initial - 2), ReadTimer(via, VIA::T2CL));

			via.WriteRegister(VIA::ACR, 0);
			PulsePB6(via);
			Assert::AreEqual((uint16_t)(initial - 2), ReadTimer(via, VIA::T2CL));
			TickVIA(via, 8);
			AssertTimersQuiet(via);
			Assert::AreEqual((uint16_t)(initial - 10), ReadTimer(via, VIA::T2CL));
		}

		TEST_METHOD(Timer2PulseTimeoutRequiresHighCounterReload)
		{
			VIA via;
			via.WriteRegister(VIA::ACR, 0x20);
			via.WriteRegister(VIA::T2CL, 1);
			via.WriteRegister(VIA::T2CH, 0);
			TickVIA(via, 32);
			Assert::AreEqual((uint16_t)1, ReadTimer(via, VIA::T2CL));
			PulsePB6(via);
			AssertTimersQuiet(via);
			PulsePB6(via);
			Assert::AreEqual((uint8_t)0x20, via.ReadRegister(VIA::IFR));
			Assert::IsFalse(via.IRQAsserted());
			Assert::AreEqual((uint16_t)0xFFFF, ReadTimer(via, VIA::T2CL));
			PulsePB6(via);
			Assert::AreEqual((uint16_t)0xFFFE, ReadTimer(via, VIA::T2CL));

			via.WriteRegister(VIA::T2CL, 7);
			via.WriteRegister(VIA::IER, 0xA0);
			for (uint32_t i = 0; i < 0x10000; ++i)
			{
				PulsePB6(via);
			}
			AssertTimersQuiet(via);
			Assert::AreEqual((uint16_t)0xFFFE, ReadTimer(via, VIA::T2CL));
			via.WriteRegister(VIA::ACR, 0);
			TickVIA(via, 0x10000);
			AssertTimersQuiet(via);

			via.WriteRegister(VIA::T2CH, 0);
			Assert::AreEqual((uint16_t)7, ReadTimer(via, VIA::T2CL));
			TickVIA(via, 8);
			Assert::AreEqual((uint8_t)0xA0, via.ReadRegister(VIA::IFR));
		}

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
