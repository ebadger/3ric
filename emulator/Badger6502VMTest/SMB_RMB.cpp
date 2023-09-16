#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(SMB_RMB)
	{
	public:

		TEST_METHOD(TEST_SMB_RMB)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x20, 0x00);

			vm.WriteData(addr++, SMB0);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, SMB1);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, SMB2);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, SMB3);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, SMB4);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, SMB5);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, SMB6);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, SMB7);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, RMB0);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, RMB1);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, RMB2);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, RMB3);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, RMB4);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, RMB5);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, RMB6);
			vm.WriteData(addr++, 0x20);

			vm.WriteData(addr++, RMB7);
			vm.WriteData(addr++, 0x20);

			cpu->Reset();

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b00000001);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b00000011);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b00000111);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b00001111);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b00011111);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b00111111);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b01111111);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b11111111);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b11111110);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b11111100);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b11111000);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b11110000);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b11100000);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b11000000);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b10000000);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0b00000000);

			Assert::IsTrue(cycles == 80);
		}
	};
}