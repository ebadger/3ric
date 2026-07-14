#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

#include <array>

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace
{
	std::array<uint16_t, 2> ScanGamepads(VM& vm)
	{
		std::array<uint16_t, 2> result = {};

		vm.WriteData(MM_VIA1_START + VIA::DDRB, 0xC0);
		vm.WriteData(MM_VIA1_START + VIA::ORB_IRB, 0x00);
		vm.WriteData(MM_VIA1_START + VIA::ORB_IRB, 0x40);

		for (uint8_t bit = 0; bit < 16; ++bit)
		{
			vm.WriteData(MM_VIA1_START + VIA::ORB_IRB, 0x00);
			const uint8_t portB = vm.ReadData(MM_VIA1_START + VIA::ORB_IRB);
			if ((portB & 0x20) == 0)
			{
				result[0] |= (uint16_t)(1u << bit);
			}
			if ((portB & 0x10) == 0)
			{
				result[1] |= (uint16_t)(1u << bit);
			}
			vm.WriteData(MM_VIA1_START + VIA::ORB_IRB, 0x80);
		}

		return result;
	}
}

namespace Badger6502VMTest
{
	TEST_CLASS(GamepadTests)
	{
	public:
		TEST_METHOD(SerializesBothControllersInROMOrder)
		{
			VM vm(true);
			Assert::IsTrue(vm.SetGamepadState(0, 0x0A55));
			Assert::IsTrue(vm.SetGamepadState(1, 0x05AA));

			const std::array<uint16_t, 2> scanned = ScanGamepads(vm);

			Assert::AreEqual((uint16_t)0x0A55, scanned[0]);
			Assert::AreEqual((uint16_t)0x05AA, scanned[1]);
		}

		TEST_METHOD(HoldsLatchedStateUntilTheNextScan)
		{
			VM vm(true);
			Assert::IsTrue(vm.SetGamepadState(0, 0x0001));

			vm.WriteData(MM_VIA1_START + VIA::DDRB, 0xC0);
			vm.WriteData(MM_VIA1_START + VIA::ORB_IRB, 0x00);
			vm.WriteData(MM_VIA1_START + VIA::ORB_IRB, 0x40);
			vm.WriteData(MM_VIA1_START + VIA::ORB_IRB, 0x00);
			Assert::IsTrue(vm.SetGamepadState(0, 0x0002));

			Assert::AreEqual(
				(uint8_t)0,
				(uint8_t)(vm.ReadData(MM_VIA1_START + VIA::ORB_IRB) & 0x20));
			vm.WriteData(MM_VIA1_START + VIA::ORB_IRB, 0x80);
			vm.WriteData(MM_VIA1_START + VIA::ORB_IRB, 0x00);
			Assert::AreEqual(
				(uint8_t)0x20,
				(uint8_t)(vm.ReadData(MM_VIA1_START + VIA::ORB_IRB) & 0x20));

			Assert::AreEqual((uint16_t)0x0002, ScanGamepads(vm)[0]);
		}

		TEST_METHOD(ResetPreservesTheConnectedControllerState)
		{
			VM vm(true);
			Assert::IsTrue(vm.SetGamepadState(0, 0x0FFF));

			vm.Reset();

			Assert::AreEqual((uint16_t)0x0FFF, ScanGamepads(vm)[0]);
		}

		TEST_METHOD(RejectsInvalidControllersAndUnusedButtons)
		{
			VM vm(true);

			Assert::IsFalse(vm.SetGamepadState(2, 0x0001));
			Assert::IsTrue(vm.SetGamepadState(0, 0xFFFF));
			Assert::AreEqual((uint16_t)0x0FFF, ScanGamepads(vm)[0]);
		}
	};
}
