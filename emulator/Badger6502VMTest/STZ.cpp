#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(STZ)
	{
	public:


		TEST_METHOD(TEST_STZ_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2000, 0xFF);

			vm.WriteData(addr++, STZ_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x20);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(vm.ReadData(0x2000) == 0xFF);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2000) == 0x00);

			Assert::IsTrue(cycles == 4);
		}

		TEST_METHOD(TEST_STZ_ABS_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x2020, 0xFF);

			vm.WriteData(addr++, STZ_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x20);

			cpu->Reset();
			cpu->X = 0x20;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x20);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(vm.ReadData(0x2020) == 0xFF);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x2020) == 0x00);

			Assert::IsTrue(cycles == 5);
		}

		TEST_METHOD(TEST_STZ_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x20, 0xFF);

			vm.WriteData(addr++, STZ_ZP);
			vm.WriteData(addr++, 0x20);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(vm.ReadData(0x20) == 0xFF);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x20) == 0x00);

			Assert::IsTrue(cycles == 3);
		}

		TEST_METHOD(TEST_STZ_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x40, 0xFF);

			vm.WriteData(addr++, STZ_ZP_X);
			vm.WriteData(addr++, 0x20);

			cpu->Reset();
			cpu->X = 0x20;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x20);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(vm.ReadData(0x40) == 0xFF);

			cycles += cpu->Step();
			Assert::IsTrue(vm.ReadData(0x40) == 0x00);

			Assert::IsTrue(cycles == 4);
		}

	};
}