#include "pch.h"
#include "CppUnitTest.h"
#include "vm.h"

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace Badger6502VMTest
{
	TEST_CLASS(ADC_SBC)
	{
	public:
		TEST_METHOD(TEST_ADC_IMM)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);


			// zero to 1
			vm.WriteData(addr++, ADC_IMM);
			vm.WriteData(addr++, 0x01);

			// 1 to $7F
			vm.WriteData(addr++, ADC_IMM);
			vm.WriteData(addr++, 0x7E);

			// $7F to $80   - should trigger negative and overflow flags
			vm.WriteData(addr++, ADC_IMM);
			vm.WriteData(addr++, 0x01);

			// $80 to $81   - overflow flag clears
			vm.WriteData(addr++, ADC_IMM);
			vm.WriteData(addr++, 0x01);

			// $81 to $FF  
			vm.WriteData(addr++, ADC_IMM);
			vm.WriteData(addr++, 0x7E);

			// $FF to $00 - carry and zero flags, negative flag clears
			vm.WriteData(addr++, ADC_IMM);
			vm.WriteData(addr++, 0x01);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $81
			Assert::IsTrue(cpu->A == 0x81);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $FF
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 12);
		}

		TEST_METHOD(TEST_ADC_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0x01);
			vm.WriteData(0x81, 0x7E);

			// zero to 1
			vm.WriteData(addr++, ADC_ZP);
			vm.WriteData(addr++, 0x80);

			// 1 to $7F
			vm.WriteData(addr++, ADC_ZP);
			vm.WriteData(addr++, 0x81);

			// $7F to $80   - should trigger negative and overflow flags
			vm.WriteData(addr++, ADC_ZP);
			vm.WriteData(addr++, 0x80);

			// $80 to $81   - overflow flag clears
			vm.WriteData(addr++, ADC_ZP);
			vm.WriteData(addr++, 0x080);

			// $81 to $FF  
			vm.WriteData(addr++, ADC_ZP);
			vm.WriteData(addr++, 0x81);

			// $FF to $00 - carry and zero flags, negative flag clears
			vm.WriteData(addr++, ADC_ZP);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $81
			Assert::IsTrue(cpu->A == 0x81);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $FF
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 18);
		}

		TEST_METHOD(TEST_ADC_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0x01);
			vm.WriteData(0x81, 0x7E);

			// zero to 1
			vm.WriteData(addr++, ADC_ZP_X);
			vm.WriteData(addr++, 0x10);

			// 1 to $7F
			vm.WriteData(addr++, ADC_ZP_X);
			vm.WriteData(addr++, 0x11);

			// $7F to $80   - should trigger negative and overflow flags
			vm.WriteData(addr++, ADC_ZP_X);
			vm.WriteData(addr++, 0x10);

			// $80 to $81   - overflow flag clears
			vm.WriteData(addr++, ADC_ZP_X);
			vm.WriteData(addr++, 0x10);

			// $81 to $FF  
			vm.WriteData(addr++, ADC_ZP_X);
			vm.WriteData(addr++, 0x11);

			// $FF to $00 - carry and zero flags, negative flag clears
			vm.WriteData(addr++, ADC_ZP_X);
			vm.WriteData(addr++, 0x10);

			cpu->Reset();
			cpu->X = 0x70;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x70);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $81
			Assert::IsTrue(cpu->A == 0x81);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $FF
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 24);
		}

		TEST_METHOD(TEST_ADC_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8000, 0x01);
			vm.WriteData(0x8100, 0x7E);

			// zero to 1
			vm.WriteData(addr++, ADC_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// 1 to $7F
			vm.WriteData(addr++, ADC_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x81);

			// $7F to $80   - should trigger negative and overflow flags
			vm.WriteData(addr++, ADC_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// $80 to $81   - overflow flag clears
			vm.WriteData(addr++, ADC_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// $81 to $FF  
			vm.WriteData(addr++, ADC_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x81);

			// $FF to $00 - carry and zero flags, negative flag clears
			vm.WriteData(addr++, ADC_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $81
			Assert::IsTrue(cpu->A == 0x81);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $FF
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 24);
		}
		TEST_METHOD(TEST_ADC_ABS_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80FF, 0x01);
			vm.WriteData(0x81FF, 0x7E);

			// zero to 1
			vm.WriteData(addr++, ADC_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// 1 to $7F
			vm.WriteData(addr++, ADC_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x81);

			// $7F to $80   - should trigger negative and overflow flags
			vm.WriteData(addr++, ADC_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// $80 to $81   - overflow flag clears
			vm.WriteData(addr++, ADC_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// $81 to $FF  
			vm.WriteData(addr++, ADC_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x81);

			// $FF to $00 - carry and zero flags, negative flag clears
			vm.WriteData(addr++, ADC_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();
			cpu->X = 0xFF;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0xFF);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $81
			Assert::IsTrue(cpu->A == 0x81);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $FF
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 24);
		}

		TEST_METHOD(TEST_ADC_ABS_X_CROSSPAGE)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8100, 0x01);
			vm.WriteData(0x8200, 0x7E);

			// zero to 1
			vm.WriteData(addr++, ADC_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			// 1 to $7F
			vm.WriteData(addr++, ADC_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x81);

			// $7F to $80   - should trigger negative and overflow flags
			vm.WriteData(addr++, ADC_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			// $80 to $81   - overflow flag clears
			vm.WriteData(addr++, ADC_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			// $81 to $FF  
			vm.WriteData(addr++, ADC_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x81);

			// $FF to $00 - carry and zero flags, negative flag clears
			vm.WriteData(addr++, ADC_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();
			cpu->X = 0x01;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x01);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $81
			Assert::IsTrue(cpu->A == 0x81);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $FF
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 30);
		}

		TEST_METHOD(TEST_ADC_ABS_Y)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80FF, 0x01);
			vm.WriteData(0x81FF, 0x7E);

			// zero to 1
			vm.WriteData(addr++, ADC_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// 1 to $7F
			vm.WriteData(addr++, ADC_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x81);

			// $7F to $80   - should trigger negative and overflow flags
			vm.WriteData(addr++, ADC_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// $80 to $81   - overflow flag clears
			vm.WriteData(addr++, ADC_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// $81 to $FF  
			vm.WriteData(addr++, ADC_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x81);

			// $FF to $00 - carry and zero flags, negative flag clears
			vm.WriteData(addr++, ADC_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();
			cpu->Y = 0xFF;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $81
			Assert::IsTrue(cpu->A == 0x81);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $FF
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 24);
		}

		TEST_METHOD(TEST_ADC_ABS_Y_CROSSPAGE)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8100, 0x01);
			vm.WriteData(0x8200, 0x7E);

			// zero to 1
			vm.WriteData(addr++, ADC_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			// 1 to $7F
			vm.WriteData(addr++, ADC_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x81);

			// $7F to $80   - should trigger negative and overflow flags
			vm.WriteData(addr++, ADC_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			// $80 to $81   - overflow flag clears
			vm.WriteData(addr++, ADC_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			// $81 to $FF  
			vm.WriteData(addr++, ADC_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x81);

			// $FF to $00 - carry and zero flags, negative flag clears
			vm.WriteData(addr++, ADC_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();
			cpu->Y = 0x01;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $81
			Assert::IsTrue(cpu->A == 0x81);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $FF
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 30);
		}

		TEST_METHOD(TEST_ADC_I_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0x00);
			vm.WriteData(0x81, 0x40);

			vm.WriteData(0x82, 0x00);
			vm.WriteData(0x83, 0x50);

			vm.WriteData(0x4000, 0x01);
			vm.WriteData(0x5000, 0x7E);

			// zero to 1
			vm.WriteData(addr++, ADC_I_ZP);
			vm.WriteData(addr++, 0x80);

			// 1 to $7F
			vm.WriteData(addr++, ADC_I_ZP);
			vm.WriteData(addr++, 0x82);

			// $7F to $80   - should trigger negative and overflow flags
			vm.WriteData(addr++, ADC_I_ZP);
			vm.WriteData(addr++, 0x80);

			// $80 to $81   - overflow flag clears
			vm.WriteData(addr++, ADC_I_ZP);
			vm.WriteData(addr++, 0x80);

			// $81 to $FF  
			vm.WriteData(addr++, ADC_I_ZP);
			vm.WriteData(addr++, 0x82);

			// $FF to $00 - carry and zero flags, negative flag clears
			vm.WriteData(addr++, ADC_I_ZP);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $81
			Assert::IsTrue(cpu->A == 0x81);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $FF
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 30);
		}

		TEST_METHOD(TEST_ADC_I_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0x00);
			vm.WriteData(0x81, 0x40);

			vm.WriteData(0x82, 0x00);
			vm.WriteData(0x83, 0x50);

			vm.WriteData(0x4000, 0x01);
			vm.WriteData(0x5000, 0x7E);

			// zero to 1
			vm.WriteData(addr++, ADC_I_ZP_X);
			vm.WriteData(addr++, 0x40);

			// 1 to $7F
			vm.WriteData(addr++, ADC_I_ZP_X);
			vm.WriteData(addr++, 0x42);

			// $7F to $80   - should trigger negative and overflow flags
			vm.WriteData(addr++, ADC_I_ZP_X);
			vm.WriteData(addr++, 0x40);

			// $80 to $81   - overflow flag clears
			vm.WriteData(addr++, ADC_I_ZP_X);
			vm.WriteData(addr++, 0x40);

			// $81 to $FF  
			vm.WriteData(addr++, ADC_I_ZP_X);
			vm.WriteData(addr++, 0x42);

			// $FF to $00 - carry and zero flags, negative flag clears
			vm.WriteData(addr++, ADC_I_ZP_X);
			vm.WriteData(addr++, 0x40);

			cpu->Reset();
			cpu->X = 0x40;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x40);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $81
			Assert::IsTrue(cpu->A == 0x81);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $FF
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 36);
		}
		TEST_METHOD(TEST_ADC_I_ZP_Y)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0x00);
			vm.WriteData(0x81, 0x40);

			vm.WriteData(0x82, 0x00);
			vm.WriteData(0x83, 0x50);

			vm.WriteData(0x4080, 0x01);
			vm.WriteData(0x5080, 0x7E);

			// zero to 1
			vm.WriteData(addr++, ADC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			// 1 to $7F
			vm.WriteData(addr++, ADC_I_ZP_Y);
			vm.WriteData(addr++, 0x82);

			// $7F to $80   - should trigger negative and overflow flags
			vm.WriteData(addr++, ADC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			// $80 to $81   - overflow flag clears
			vm.WriteData(addr++, ADC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			// $81 to $FF  
			vm.WriteData(addr++, ADC_I_ZP_Y);
			vm.WriteData(addr++, 0x82);

			// $FF to $00 - carry and zero flags, negative flag clears
			vm.WriteData(addr++, ADC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();
			cpu->Y = 0x80;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $81
			Assert::IsTrue(cpu->A == 0x81);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $FF
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 30);
		}

		TEST_METHOD(TEST_ADC_I_ZP_Y_CROSSPAGE)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0xFF);
			vm.WriteData(0x81, 0x40);

			vm.WriteData(0x82, 0xFF);
			vm.WriteData(0x83, 0x50);

			vm.WriteData(0x4100, 0x01);
			vm.WriteData(0x5100, 0x7E);

			// zero to 1
			vm.WriteData(addr++, ADC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			// 1 to $7F
			vm.WriteData(addr++, ADC_I_ZP_Y);
			vm.WriteData(addr++, 0x82);

			// $7F to $80   - should trigger negative and overflow flags
			vm.WriteData(addr++, ADC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			// $80 to $81   - overflow flag clears
			vm.WriteData(addr++, ADC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			// $81 to $FF  
			vm.WriteData(addr++, ADC_I_ZP_Y);
			vm.WriteData(addr++, 0x82);

			// $FF to $00 - carry and zero flags, negative flag clears
			vm.WriteData(addr++, ADC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();
			cpu->Y = 0x01;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $81
			Assert::IsTrue(cpu->A == 0x81);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $FF
			Assert::IsTrue(cpu->A == 0xFF);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 36);
		}

		//SBC
		TEST_METHOD(TEST_SBC_IMM)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			// zero to $FE  -  negative flag set
			vm.WriteData(addr++, SBC_IMM);
			vm.WriteData(addr++, 0x01);

			// $FF to $80   -  negative flag set, carry flag set
			vm.WriteData(addr++, SBC_IMM);
			vm.WriteData(addr++, 0x7D);

			// $80 to $7F   -  overflow flag set, carry flag set
			vm.WriteData(addr++, SBC_IMM);
			vm.WriteData(addr++, 0x01);

			// $7F to $01   -  carry flag set
			vm.WriteData(addr++, SBC_IMM);
			vm.WriteData(addr++, 0x7E);

			// $01 to $00  -   zero flag, carry flag set
			vm.WriteData(addr++, SBC_IMM);
			vm.WriteData(addr++, 0x01);


			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $FE
			Assert::IsTrue(cpu->A == 0xFE);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 10);
		}

		TEST_METHOD(TEST_SBC_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0x01);
			vm.WriteData(0x82, 0x7D);
			vm.WriteData(0x84, 0x7E);

			// zero to $FE  -  negative flag set
			vm.WriteData(addr++, SBC_ZP);
			vm.WriteData(addr++, 0x80);

			// $FF to $80   -  negative flag set, carry flag set
			vm.WriteData(addr++, SBC_ZP);
			vm.WriteData(addr++, 0x82);

			// $80 to $7F   -  overflow flag set, carry flag set
			vm.WriteData(addr++, SBC_ZP);
			vm.WriteData(addr++, 0x80);

			// $7F to $01   -  carry flag set
			vm.WriteData(addr++, SBC_ZP);
			vm.WriteData(addr++, 0x84);

			// $01 to $00  -   zero flag, carry flag set
			vm.WriteData(addr++, SBC_ZP);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $FE
			Assert::IsTrue(cpu->A == 0xFE);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 15);
		}

		TEST_METHOD(TEST_SBC_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x90, 0x01);
			vm.WriteData(0x92, 0x7D);
			vm.WriteData(0x94, 0x7E);

			// zero to $FE  -  negative flag set
			vm.WriteData(addr++, SBC_ZP_X);
			vm.WriteData(addr++, 0x80);

			// $FF to $80   -  negative flag set, carry flag set
			vm.WriteData(addr++, SBC_ZP_X);
			vm.WriteData(addr++, 0x82);

			// $80 to $7F   -  overflow flag set, carry flag set
			vm.WriteData(addr++, SBC_ZP_X);
			vm.WriteData(addr++, 0x80);

			// $7F to $01   -  carry flag set
			vm.WriteData(addr++, SBC_ZP_X);
			vm.WriteData(addr++, 0x84);

			// $01 to $00  -   zero flag, carry flag set
			vm.WriteData(addr++, SBC_ZP_X);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();
			cpu->X = 0x10;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x10);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $FE
			Assert::IsTrue(cpu->A == 0xFE);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 20);
		}

		TEST_METHOD(TEST_SBC_ABS)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8000, 0x01);
			vm.WriteData(0x8200, 0x7D);
			vm.WriteData(0x8400, 0x7E);

			// zero to $FE  -  negative flag set
			vm.WriteData(addr++, SBC_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// $FF to $80   -  negative flag set, carry flag set
			vm.WriteData(addr++, SBC_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x82);

			// $80 to $7F   -  overflow flag set, carry flag set
			vm.WriteData(addr++, SBC_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// $7F to $01   -  carry flag set
			vm.WriteData(addr++, SBC_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x84);

			// $01 to $00  -   zero flag, carry flag set
			vm.WriteData(addr++, SBC_ABS);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $FE
			Assert::IsTrue(cpu->A == 0xFE);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 20);
		}

		TEST_METHOD(TEST_SBC_ABS_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8080, 0x01);
			vm.WriteData(0x8280, 0x7D);
			vm.WriteData(0x8480, 0x7E);

			// zero to $FE  -  negative flag set
			vm.WriteData(addr++, SBC_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// $FF to $80   -  negative flag set, carry flag set
			vm.WriteData(addr++, SBC_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x82);

			// $80 to $7F   -  overflow flag set, carry flag set
			vm.WriteData(addr++, SBC_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// $7F to $01   -  carry flag set
			vm.WriteData(addr++, SBC_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x84);

			// $01 to $00  -   zero flag, carry flag set
			vm.WriteData(addr++, SBC_ABS_X);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();
			cpu->X = 0x80;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x80);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $FE
			Assert::IsTrue(cpu->A == 0xFE);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 20);
		}

		TEST_METHOD(TEST_SBC_ABS_X_CROSSPAGE)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8100, 0x01);
			vm.WriteData(0x8300, 0x7D);
			vm.WriteData(0x8500, 0x7E);

			// zero to $FE  -  negative flag set
			vm.WriteData(addr++, SBC_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			// $FF to $80   -  negative flag set, carry flag set
			vm.WriteData(addr++, SBC_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x82);

			// $80 to $7F   -  overflow flag set, carry flag set
			vm.WriteData(addr++, SBC_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			// $7F to $01   -  carry flag set
			vm.WriteData(addr++, SBC_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x84);

			// $01 to $00  -   zero flag, carry flag set
			vm.WriteData(addr++, SBC_ABS_X);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();
			cpu->X = 0x01;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x01);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $FE
			Assert::IsTrue(cpu->A == 0xFE);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 25);
		}

		TEST_METHOD(TEST_SBC_ABS_Y)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8080, 0x01);
			vm.WriteData(0x8280, 0x7D);
			vm.WriteData(0x8480, 0x7E);

			// zero to $FE  -  negative flag set
			vm.WriteData(addr++, SBC_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// $FF to $80   -  negative flag set, carry flag set
			vm.WriteData(addr++, SBC_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x82);

			// $80 to $7F   -  overflow flag set, carry flag set
			vm.WriteData(addr++, SBC_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			// $7F to $01   -  carry flag set
			vm.WriteData(addr++, SBC_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x84);

			// $01 to $00  -   zero flag, carry flag set
			vm.WriteData(addr++, SBC_ABS_Y);
			vm.WriteData(addr++, 0x00);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();
			cpu->Y = 0x80;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $FE
			Assert::IsTrue(cpu->A == 0xFE);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 20);
		}

		TEST_METHOD(TEST_SBC_ABS_Y_CROSSPAGE)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x8100, 0x01);
			vm.WriteData(0x8300, 0x7D);
			vm.WriteData(0x8500, 0x7E);

			// zero to $FE  -  negative flag set
			vm.WriteData(addr++, SBC_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			// $FF to $80   -  negative flag set, carry flag set
			vm.WriteData(addr++, SBC_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x82);

			// $80 to $7F   -  overflow flag set, carry flag set
			vm.WriteData(addr++, SBC_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			// $7F to $01   -  carry flag set
			vm.WriteData(addr++, SBC_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x84);

			// $01 to $00  -   zero flag, carry flag set
			vm.WriteData(addr++, SBC_ABS_Y);
			vm.WriteData(addr++, 0xFF);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();
			cpu->Y = 0x01;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $FE
			Assert::IsTrue(cpu->A == 0xFE);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 25);
		}

		TEST_METHOD(TEST_SBC_I_ZP)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0x00);
			vm.WriteData(0x81, 0x40);

			vm.WriteData(0x82, 0x00);
			vm.WriteData(0x83, 0x50);

			vm.WriteData(0x84, 0x00);
			vm.WriteData(0x85, 0x60);

			vm.WriteData(0x4000, 0x01);
			vm.WriteData(0x5000, 0x7D);
			vm.WriteData(0x6000, 0x7E);

			// zero to $FE  -  negative flag set
			vm.WriteData(addr++, SBC_I_ZP);
			vm.WriteData(addr++, 0x80);

			// $FF to $80   -  negative flag set, carry flag set
			vm.WriteData(addr++, SBC_I_ZP);
			vm.WriteData(addr++, 0x82);

			// $80 to $7F   -  overflow flag set, carry flag set
			vm.WriteData(addr++, SBC_I_ZP);
			vm.WriteData(addr++, 0x80);

			// $7F to $01   -  carry flag set
			vm.WriteData(addr++, SBC_I_ZP);
			vm.WriteData(addr++, 0x84);

			// $01 to $00  -   zero flag, carry flag set
			vm.WriteData(addr++, SBC_I_ZP);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $FE
			Assert::IsTrue(cpu->A == 0xFE);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 25);
		}

		TEST_METHOD(TEST_SBC_I_ZP_X)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0x00);
			vm.WriteData(0x81, 0x40);

			vm.WriteData(0x82, 0x00);
			vm.WriteData(0x83, 0x50);

			vm.WriteData(0x84, 0x00);
			vm.WriteData(0x85, 0x60);

			vm.WriteData(0x4000, 0x01);
			vm.WriteData(0x5000, 0x7D);
			vm.WriteData(0x6000, 0x7E);

			// zero to $FE  -  negative flag set
			vm.WriteData(addr++, SBC_I_ZP_X);
			vm.WriteData(addr++, 0x70);

			// $FF to $80   -  negative flag set, carry flag set
			vm.WriteData(addr++, SBC_I_ZP_X);
			vm.WriteData(addr++, 0x72);

			// $80 to $7F   -  overflow flag set, carry flag set
			vm.WriteData(addr++, SBC_I_ZP_X);
			vm.WriteData(addr++, 0x70);

			// $7F to $01   -  carry flag set
			vm.WriteData(addr++, SBC_I_ZP_X);
			vm.WriteData(addr++, 0x74);

			// $01 to $00  -   zero flag, carry flag set
			vm.WriteData(addr++, SBC_I_ZP_X);
			vm.WriteData(addr++, 0x70);

			cpu->Reset();
			cpu->X = 0x10;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x10);
			Assert::IsTrue(cpu->Y == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $FE
			Assert::IsTrue(cpu->A == 0xFE);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 30);
		}

		TEST_METHOD(TEST_SBC_I_ZP_Y)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0x00);
			vm.WriteData(0x81, 0x40);

			vm.WriteData(0x82, 0x00);
			vm.WriteData(0x83, 0x50);

			vm.WriteData(0x84, 0x00);
			vm.WriteData(0x85, 0x60);

			vm.WriteData(0x4080, 0x01);
			vm.WriteData(0x5080, 0x7D);
			vm.WriteData(0x6080, 0x7E);

			// zero to $FE  -  negative flag set
			vm.WriteData(addr++, SBC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			// $FF to $80   -  negative flag set, carry flag set
			vm.WriteData(addr++, SBC_I_ZP_Y);
			vm.WriteData(addr++, 0x82);

			// $80 to $7F   -  overflow flag set, carry flag set
			vm.WriteData(addr++, SBC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			// $7F to $01   -  carry flag set
			vm.WriteData(addr++, SBC_I_ZP_Y);
			vm.WriteData(addr++, 0x84);

			// $01 to $00  -   zero flag, carry flag set
			vm.WriteData(addr++, SBC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();
			cpu->Y = 0x80;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $FE
			Assert::IsTrue(cpu->A == 0xFE);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 25);
		}

		TEST_METHOD(TEST_SBC_I_ZP_Y_CROSSPAGE)
		{
			VM vm(true);
			CPU* cpu = vm.GetCPU();
			uint16_t addr = 0x1000;
			uint32_t cycles = 0;

			

			vm.WriteData(0xFFFC, addr & 0xFF);
			vm.WriteData(0xFFFD, addr >> 8);

			vm.WriteData(0x80, 0xFF);
			vm.WriteData(0x81, 0x40);

			vm.WriteData(0x82, 0xFF);
			vm.WriteData(0x83, 0x50);

			vm.WriteData(0x84, 0xFF);
			vm.WriteData(0x85, 0x60);

			vm.WriteData(0x4100, 0x01);
			vm.WriteData(0x5100, 0x7D);
			vm.WriteData(0x6100, 0x7E);

			// zero to $FE  -  negative flag set
			vm.WriteData(addr++, SBC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			// $FF to $80   -  negative flag set, carry flag set
			vm.WriteData(addr++, SBC_I_ZP_Y);
			vm.WriteData(addr++, 0x82);

			// $80 to $7F   -  overflow flag set, carry flag set
			vm.WriteData(addr++, SBC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			// $7F to $01   -  carry flag set
			vm.WriteData(addr++, SBC_I_ZP_Y);
			vm.WriteData(addr++, 0x84);

			// $01 to $00  -   zero flag, carry flag set
			vm.WriteData(addr++, SBC_I_ZP_Y);
			vm.WriteData(addr++, 0x80);

			cpu->Reset();
			cpu->Y = 0x01;

			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->X == 0x00);
			Assert::IsTrue(cpu->Y == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();  // $FE
			Assert::IsTrue(cpu->A == 0xFE);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x00);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $80
			Assert::IsTrue(cpu->A == 0x80);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x01);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $7F
			Assert::IsTrue(cpu->A == 0x7F);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x01);

			cycles += cpu->Step();   // $01
			Assert::IsTrue(cpu->A == 0x01);
			Assert::IsTrue(cpu->flags.bits.Z == 0x00);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			cycles += cpu->Step();   // $00
			Assert::IsTrue(cpu->A == 0x00);
			Assert::IsTrue(cpu->flags.bits.Z == 0x01);
			Assert::IsTrue(cpu->flags.bits.N == 0x00);
			Assert::IsTrue(cpu->flags.bits.C == 0x01);
			Assert::IsTrue(cpu->flags.bits.V == 0x00);

			Assert::IsTrue(cycles == 30);
		}

	};
}