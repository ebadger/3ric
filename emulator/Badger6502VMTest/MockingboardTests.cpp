#include "pch.h"
#include "CppUnitTest.h"
#include "mockingboard.h"

#include <algorithm>
#include <cmath>

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace
{
	void PrepareAY(VM& vm, uint16_t base)
	{
		vm.WriteData(base + VIA::DDRA, 0xFF);
		vm.WriteData(base + VIA::DDRB, 0x07);
		vm.WriteData(base + VIA::ORB_IRB, 0x04);
	}

	void WriteAY(VM& vm, uint16_t base, uint8_t reg, uint8_t data)
	{
		vm.WriteData(base + VIA::ORA_IRA, reg);
		vm.WriteData(base + VIA::ORB_IRB, 0x07);
		vm.WriteData(base + VIA::ORB_IRB, 0x04);
		vm.WriteData(base + VIA::ORA_IRA, data);
		vm.WriteData(base + VIA::ORB_IRB, 0x06);
		vm.WriteData(base + VIA::ORB_IRB, 0x04);
	}
}

namespace Badger6502VMTest
{
	TEST_CLASS(MockingboardTests)
	{
	public:
		TEST_METHOD(DecodesBothVIAsAndTheirMirrors)
		{
			VM vm(true);

			vm.WriteData(0xC432, 0x07);
			vm.WriteData(0xC4B2, 0x05);

			Assert::AreEqual((uint8_t)0x07, vm.ReadData(0xC402));
			Assert::AreEqual((uint8_t)0x05, vm.ReadData(0xC482));
		}

		TEST_METHOD(ProducesHardPannedStereoAtThe3ricClock)
		{
			VM vm(true);
			Mockingboard* board = vm.GetMockingboard();
			Assert::IsTrue(board->EnableAudio(48000));
			PrepareAY(vm, MM_MOCKINGBOARD_VIA1_START);

			WriteAY(vm, MM_MOCKINGBOARD_VIA1_START, 0, 100);
			WriteAY(vm, MM_MOCKINGBOARD_VIA1_START, 1, 0);
			WriteAY(vm, MM_MOCKINGBOARD_VIA1_START, 7, 0x3E);
			WriteAY(vm, MM_MOCKINGBOARD_VIA1_START, 8, 0x0F);

			vm.TickDevices(100000);
			const std::vector<float> audio = board->DrainAudio();
			Assert::IsTrue(audio.size() > 1000);

			double leftEnergy = 0.0;
			double rightEnergy = 0.0;
			for (size_t i = 0; i + 1 < audio.size(); i += 2)
			{
				leftEnergy += std::abs(audio[i]);
				rightEnergy += std::abs(audio[i + 1]);
			}

			Assert::IsTrue(leftEnergy > 10.0);
			Assert::IsTrue(rightEnergy < 0.001);
		}

		TEST_METHOD(CombinesBothVIAInterruptsOntoIRQ)
		{
			VM vm(true);
			vm.WriteData(MM_MOCKINGBOARD_VIA2_START + VIA::IER, 0xC0);
			vm.WriteData(MM_MOCKINGBOARD_VIA2_START + VIA::T1CL, 1);
			vm.WriteData(MM_MOCKINGBOARD_VIA2_START + VIA::T1CH, 0);

			vm.TickDevices(2);

			Assert::IsTrue(vm.GetMockingboard()->IRQAsserted());
			Assert::IsTrue(vm.IRQAsserted());
			Assert::AreEqual(
				(uint8_t)0xC0,
				(uint8_t)(vm.ReadData(MM_MOCKINGBOARD_VIA2_START + VIA::IFR) & 0xC0));
		}

		TEST_METHOD(AYBusLatchesOnFallingControlEdge)
		{
			VM vm(true);
			Mockingboard* board = vm.GetMockingboard();
			const uint16_t base = MM_MOCKINGBOARD_VIA1_START;
			PrepareAY(vm, base);

			vm.WriteData(base + VIA::ORA_IRA, 0);
			vm.WriteData(base + VIA::ORB_IRB, 0x07);
			vm.WriteData(base + VIA::ORB_IRB, 0x04);
			vm.WriteData(base + VIA::ORA_IRA, 0x12);
			vm.WriteData(base + VIA::ORB_IRB, 0x06);
			Assert::AreEqual((uint8_t)0x00, board->GetAY(0)->ReadRegister(0));
			vm.WriteData(base + VIA::ORA_IRA, 0x34);
			vm.WriteData(base + VIA::ORB_IRB, 0x06);
			Assert::AreEqual((uint8_t)0x00, board->GetAY(0)->ReadRegister(0));
			vm.WriteData(base + VIA::ORB_IRB, 0x05);

			Assert::AreEqual((uint8_t)0x34, board->GetAY(0)->ReadRegister(0));
		}

		TEST_METHOD(AYDoesNotAdvanceWhileResetIsAsserted)
		{
			VM heldInReset(true);
			VM reference(true);
			const uint16_t base = MM_MOCKINGBOARD_VIA1_START;

			PrepareAY(heldInReset, base);
			PrepareAY(reference, base);
			heldInReset.WriteData(base + VIA::ORB_IRB, 0x00);
			reference.WriteData(base + VIA::ORB_IRB, 0x00);
			heldInReset.TickDevices(12345);
			heldInReset.WriteData(base + VIA::ORB_IRB, 0x04);
			reference.WriteData(base + VIA::ORB_IRB, 0x04);

			Assert::IsTrue(heldInReset.GetMockingboard()->EnableAudio(48000));
			Assert::IsTrue(reference.GetMockingboard()->EnableAudio(48000));
			WriteAY(heldInReset, base, 0, 100);
			WriteAY(heldInReset, base, 1, 0);
			WriteAY(heldInReset, base, 7, 0x3E);
			WriteAY(heldInReset, base, 8, 0x0F);
			WriteAY(reference, base, 0, 100);
			WriteAY(reference, base, 1, 0);
			WriteAY(reference, base, 7, 0x3E);
			WriteAY(reference, base, 8, 0x0F);

			heldInReset.TickDevices(50000);
			reference.TickDevices(50000);
			const std::vector<float> heldAudio =
				heldInReset.GetMockingboard()->DrainAudio();
			const std::vector<float> referenceAudio =
				reference.GetMockingboard()->DrainAudio();

			Assert::AreEqual(referenceAudio.size(), heldAudio.size());
			Assert::IsTrue(std::equal(
				referenceAudio.begin(),
				referenceAudio.end(),
				heldAudio.begin()));
		}
	};
}
