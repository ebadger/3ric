#include "cpu.h"
#include "vm.h"
#include "badgervmpal.h"

using namespace std;

CPU::CPU(VM *vm)
{
	_vm = vm;
	Instruction[BRK_STACK] = { "BRK",	AddressingMode::Stack };
	Instruction[ORA_I_ZP_X] = { "ORA",	AddressingMode::ZeroPage_Indexed_Indirect_With_X };
	Instruction[TSB_ZP] = { "TSB",	AddressingMode::ZeroPage };
	Instruction[ORA_ZP] = { "ORA",	AddressingMode::ZeroPage };
	Instruction[ASL_ZP] = { "ASL",	AddressingMode::ZeroPage };
	Instruction[RMB0] = { "RMB0", AddressingMode::ZeroPage };
	Instruction[PHP_STACK] = { "PHP",	AddressingMode::Stack };
	Instruction[ORA_IMM] = { "ORA",	AddressingMode::Immediate };
	Instruction[ASL_A] = { "ASL",	AddressingMode::Accumulator };
	Instruction[TSB_ABS] = { "TSB",	AddressingMode::Absolute };
	Instruction[ORA_ABS] = { "ORA",	AddressingMode::Absolute };
	Instruction[ASL_ABS] = { "ASL",	AddressingMode::Absolute };
	Instruction[BBR0] = { "BBR0", AddressingMode::PC_Relative };
	Instruction[BPL] = { "BPL",	AddressingMode::PC_Relative };
	Instruction[ORA_I_ZP_Y] = { "ORA",	AddressingMode::ZeroPage_Indirect_Indexed_With_Y };
	Instruction[ORA_I_ZP] = { "ORA",	AddressingMode::ZeroPage_Indirect };
	Instruction[TRB_ZP] = { "TRB",	AddressingMode::ZeroPage };
	Instruction[ORA_ZP_X] = { "ORA",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[ASL_ZP_X] = { "ASL",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[RMB1] = { "RMB1", AddressingMode::ZeroPage };
	Instruction[CLC] = { "CLC",	AddressingMode::Implied };
	Instruction[ORA_ABS_Y] = { "ORA",	AddressingMode::Absolute_Indexed_Y };
	Instruction[INC_A] = { "INC",	AddressingMode::Accumulator };
	Instruction[TRB_ABS] = { "TRB",	AddressingMode::Absolute };
	Instruction[ORA_ABS_X] = { "ORA",  AddressingMode::Absolute_Indexed_X };
	Instruction[ASL_ABS_X] = { "ASL",	AddressingMode::Absolute_Indexed_X };
	Instruction[BBR1] = { "BBR1", AddressingMode::PC_Relative };
	Instruction[JSR_ABS] = { "JSR",	AddressingMode::Absolute };
	Instruction[AND_I_ZP_X] = { "AND",	AddressingMode::ZeroPage_Indexed_Indirect_With_X };
	Instruction[BIT_ZP] = { "BIT",	AddressingMode::ZeroPage };
	Instruction[AND_ZP] = { "AND",	AddressingMode::ZeroPage };
	Instruction[ROL_ZP] = { "ROL",	AddressingMode::ZeroPage };
	Instruction[RMB2] = { "RMB2", AddressingMode::ZeroPage };
	Instruction[PLP_STACK] = { "PLP",	AddressingMode::Stack };
	Instruction[AND_IMM] = { "AND",	AddressingMode::Immediate };
	Instruction[ROL_A] = { "ROL",	AddressingMode::Accumulator };
	Instruction[BIT_ABS] = { "BIT",	AddressingMode::Absolute };
	Instruction[AND_ABS] = { "AND",	AddressingMode::Absolute };
	Instruction[ROL_ABS] = { "ROL",  AddressingMode::Absolute };
	Instruction[BBR2] = { "BBR2", AddressingMode::PC_Relative };
	Instruction[BMI] = { "BMI",	AddressingMode::PC_Relative };
	Instruction[AND_I_ZP_Y] = { "AND",	AddressingMode::ZeroPage_Indirect_Indexed_With_Y };
	Instruction[AND_I_ZP] = { "AND",	AddressingMode::ZeroPage_Indirect };
	Instruction[BIT_ZP_X] = { "BIT",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[AND_ZP_X] = { "AND",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[ROL_ZP_X] = { "ROL",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[RMB3] = { "RMB3", AddressingMode::ZeroPage };
	Instruction[SEC] = { "SEC",	AddressingMode::Implied };
	Instruction[AND_ABS_Y] = { "AND",	AddressingMode::Absolute_Indexed_Y };
	Instruction[DEC] = { "DEC",	AddressingMode::Accumulator };
	Instruction[BIT_ABS_X] = { "BIT",	AddressingMode::Absolute_Indexed_X };
	Instruction[AND_ABS_X] = { "AND",	AddressingMode::Absolute_Indexed_X };
	Instruction[ROL_ABS_X] = { "ROL",	AddressingMode::Absolute_Indexed_X };
	Instruction[BBR3] = { "BBR3", AddressingMode::PC_Relative };
	Instruction[RTI_STACK] = { "RTI",	AddressingMode::Stack };
	Instruction[EOR_I_ZP_X] = { "EOR",	AddressingMode::ZeroPage_Indexed_Indirect_With_X };
	Instruction[EOR_ZP] = { "EOR",	AddressingMode::ZeroPage };
	Instruction[LSR_ZP] = { "LSR",	AddressingMode::ZeroPage };
	Instruction[RMB4] = { "RMB4", AddressingMode::ZeroPage };
	Instruction[PHA_STACK] = { "PHA",	AddressingMode::Stack };
	Instruction[EOR_IMM] = { "EOR",	AddressingMode::Immediate };
	Instruction[LSR_A] = { "LSR",	AddressingMode::Accumulator };
	Instruction[JMP_ABS] = { "JMP",	AddressingMode::Absolute };
	Instruction[EOR_ABS] = { "EOR",	AddressingMode::Absolute };
	Instruction[LSR_ABS] = { "LSR",	AddressingMode::Absolute };
	Instruction[BBR4] = { "BBR4", AddressingMode::PC_Relative };
	Instruction[BVC] = { "BVC",	AddressingMode::PC_Relative };
	Instruction[EOR_I_ZP_Y] = { "EOR",	AddressingMode::ZeroPage_Indirect_Indexed_With_Y };
	Instruction[EOR_I_ZP] = { "EOR",	AddressingMode::ZeroPage_Indirect };
	Instruction[EOR_ZP_X] = { "EOR",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[LSR_ZP_X] = { "LSR",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[RMB5] = { "RMB5",	AddressingMode::ZeroPage };
	Instruction[CLI] = { "CLI",	AddressingMode::Implied };
	Instruction[EOR_ABS_Y] = { "EOR",	AddressingMode::Absolute_Indexed_Y };
	Instruction[PHY_STACK] = { "PHY",	AddressingMode::Stack };
	Instruction[EOR_ABS_X] = { "EOR",	AddressingMode::Absolute_Indexed_X };
	Instruction[LSR_ABS_X] = { "LSR",	AddressingMode::Absolute_Indexed_X };
	Instruction[BBR5] = { "BBR5", AddressingMode::PC_Relative };
	Instruction[RTS_STACK] = { "RTS",	AddressingMode::Stack };
	Instruction[ADC_I_ZP_X] = { "ADC",	AddressingMode::ZeroPage_Indexed_Indirect_With_X };
	Instruction[STZ_ZP] = { "STZ",	AddressingMode::ZeroPage };
	Instruction[ADC_ZP] = { "ADC",	AddressingMode::ZeroPage };
	Instruction[ROR_ZP] = { "ROR",	AddressingMode::ZeroPage };
	Instruction[RMB6] = { "RMB6", AddressingMode::ZeroPage };
	Instruction[PLA_STACK] = { "PLA",	AddressingMode::Stack };
	Instruction[ADC_IMM] = { "ADC",	AddressingMode::Immediate };
	Instruction[ROR_A] = { "ROR",	AddressingMode::Accumulator };
	Instruction[JMP_ABS_I] = { "JMP",	AddressingMode::Absolute_Indirect };
	Instruction[ADC_ABS] = { "ADC",	AddressingMode::Absolute };
	Instruction[ROR_ABS] = { "ROR",	AddressingMode::Absolute };
	Instruction[BBR6] = { "BBR6", AddressingMode::PC_Relative };
	Instruction[BVS] = { "BVS",	AddressingMode::PC_Relative };
	Instruction[ADC_I_ZP_Y] = { "ADC",	AddressingMode::ZeroPage_Indirect_Indexed_With_Y };
	Instruction[ADC_I_ZP] = { "ADC",	AddressingMode::ZeroPage_Indirect };
	Instruction[STZ_ZP_X] = { "STZ",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[ADC_ZP_X] = { "ADC",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[ROR_ZP_X] = { "ROR",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[RMB7] = { "RMB7", AddressingMode::ZeroPage };
	Instruction[SEI] = { "SEI",	AddressingMode::Implied };
	Instruction[ADC_ABS_Y] = { "ADC",	AddressingMode::Absolute_Indexed_Y };
	Instruction[PLY_STACK] = { "PLY",	AddressingMode::Stack };
	Instruction[JMP_I_X] = { "JMP",	AddressingMode::Absolute_Indexed_Indirect_With_X };
	Instruction[ADC_ABS_X] = { "ADC",	AddressingMode::Absolute_Indexed_X };
	Instruction[ROR_ABS_X] = { "ROR",	AddressingMode::Absolute_Indexed_X };
	Instruction[BBR7] = { "BBR7", AddressingMode::PC_Relative };
	Instruction[BRA] = { "BRA",	AddressingMode::PC_Relative };
	Instruction[STA_I_ZP_X] = { "STA",	AddressingMode::ZeroPage_Indexed_Indirect_With_X };
	Instruction[STY_ZP] = { "STY",	AddressingMode::ZeroPage };
	Instruction[STA_ZP] = { "STA",	AddressingMode::ZeroPage };
	Instruction[STX_ZP] = { "STX",	AddressingMode::ZeroPage };
	Instruction[SMB0] = { "SMB0", AddressingMode::ZeroPage };
	Instruction[DEY] = { "DEY",	AddressingMode::Implied };
	Instruction[BIT_IMM] = { "BIT",	AddressingMode::Immediate };
	Instruction[TXA] = { "TXA",	AddressingMode::Implied };
	Instruction[STY_ABS] = { "STY",	AddressingMode::Absolute };
	Instruction[STA_ABS] = { "STA",	AddressingMode::Absolute };
	Instruction[STX_ABS] = { "STX",	AddressingMode::Absolute };
	Instruction[BBS0] = { "BBS0", AddressingMode::PC_Relative };
	Instruction[BCC] = { "BCC",	AddressingMode::PC_Relative };
	Instruction[STA_I_ZP_Y] = { "STA",	AddressingMode::ZeroPage_Indirect_Indexed_With_Y };
	Instruction[STA_I_ZP] = { "STA",	AddressingMode::ZeroPage_Indirect };
	Instruction[STY_ZP_X] = { "STY",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[STA_ZP_X] = { "STA",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[STX_ZP_Y] = { "STX",	AddressingMode::ZeroPage_Indexed_With_Y };
	Instruction[SMB1] = { "SMB1", AddressingMode::ZeroPage };
	Instruction[TYA] = { "TYA",	AddressingMode::Implied };
	Instruction[STA_ABS_Y] = { "STA",	AddressingMode::Absolute_Indexed_Y };
	Instruction[TXS] = { "TXS",	AddressingMode::Implied };
	Instruction[STZ_ABS] = { "STZ",	AddressingMode::Absolute };
	Instruction[STA_ABS_X] = { "STA",	AddressingMode::Absolute_Indexed_X };
	Instruction[STZ_ABS_X] = { "STZ",	AddressingMode::Absolute_Indexed_X };
	Instruction[BBS1] = { "BBS1", AddressingMode::PC_Relative };
	Instruction[LDY_IMM] = { "LDY",	AddressingMode::Immediate };
	Instruction[LDA_I_ZP_X] = { "LDA",	AddressingMode::ZeroPage_Indexed_Indirect_With_X };
	Instruction[LDX_IMM] = { "LDX",	AddressingMode::Immediate };
	Instruction[LDY_ZP] = { "LDY",	AddressingMode::ZeroPage };
	Instruction[LDA_ZP] = { "LDA",	AddressingMode::ZeroPage };
	Instruction[LDX_ZP] = { "LDX",	AddressingMode::ZeroPage };
	Instruction[SMB2] = { "SMB2", AddressingMode::ZeroPage };
	Instruction[TAY] = { "TAY",	AddressingMode::Implied };
	Instruction[LDA_IMM] = { "LDA",	AddressingMode::Immediate };
	Instruction[TAX] = { "TAX",	AddressingMode::Implied };
	Instruction[LDY_ABS] = { "LDY",	AddressingMode::Absolute };
	Instruction[LDA_ABS] = { "LDA",	AddressingMode::Absolute };
	Instruction[LDX_ABS] = { "LDX",	AddressingMode::Absolute };
	Instruction[BBS2] = { "BBS2", AddressingMode::PC_Relative };
	Instruction[BCS] = { "BCS",	AddressingMode::PC_Relative };
	Instruction[LDA_I_ZP_Y] = { "LDA",	AddressingMode::ZeroPage_Indirect_Indexed_With_Y };
	Instruction[LDA_I_ZP] = { "LDA",	AddressingMode::ZeroPage_Indirect };
	Instruction[LDY_ZP_X] = { "LDY",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[LDA_ZP_X] = { "LDA",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[LDX_ZP_Y] = { "LDX",	AddressingMode::ZeroPage_Indexed_With_Y };
	Instruction[SMB3] = { "SMB3", AddressingMode::ZeroPage };
	Instruction[CLV] = { "CLV",	AddressingMode::Implied };
	Instruction[LDA_ABS_Y] = { "LDA",	AddressingMode::Absolute_Indexed_Y };
	Instruction[TSX] = { "TSX",	AddressingMode::Implied };
	Instruction[LDY_ABS_X] = { "LDY",	AddressingMode::Absolute_Indexed_X };
	Instruction[LDA_ABS_X] = { "LDA",	AddressingMode::Absolute_Indexed_X };
	Instruction[LDX_ABS_Y] = { "LDX",	AddressingMode::Absolute_Indexed_Y };
	Instruction[BBS3] = { "BBS3", AddressingMode::PC_Relative };
	Instruction[CPY_IMM] = { "CPY",	AddressingMode::Immediate };
	Instruction[CMP_I_ZP_X] = { "CMP",	AddressingMode::ZeroPage_Indexed_Indirect_With_X };
	Instruction[CPY_ZP] = { "CPY",	AddressingMode::ZeroPage };
	Instruction[CMP_ZP] = { "CMP",	AddressingMode::ZeroPage };
	Instruction[DEC_ZP] = { "DEC",	AddressingMode::ZeroPage };
	Instruction[SMB4] = { "SMB4", AddressingMode::ZeroPage };
	Instruction[INY] = { "INY",	AddressingMode::Implied };
	Instruction[CMP_IMM] = { "CMP",	AddressingMode::Immediate };
	Instruction[DEX] = { "DEX",	AddressingMode::Implied };
	Instruction[WAI] = { "WAI",	AddressingMode::Implied };
	Instruction[CPY_ABS] = { "CPY",	AddressingMode::Absolute };
	Instruction[CMP_ABS] = { "CMP",	AddressingMode::Absolute };
	Instruction[DEC_ABS] = { "DEC",	AddressingMode::Absolute };
	Instruction[BBS4] = { "BBS4", AddressingMode::PC_Relative };
	Instruction[BNE] = { "BNE",	AddressingMode::PC_Relative };
	Instruction[CMP_I_ZP_Y] = { "CMP",	AddressingMode::ZeroPage_Indirect_Indexed_With_Y };
	Instruction[CMP_I_ZP] = { "CMP",	AddressingMode::ZeroPage_Indirect };
	Instruction[CMP_ZP_X] = { "CMP",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[DEC_ZP_X] = { "DEC",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[SMB5] = { "SMB5", AddressingMode::ZeroPage };
	Instruction[CLD] = { "CLD",	AddressingMode::Implied };
	Instruction[CMP_ABS_Y] = { "CMP",	AddressingMode::Absolute_Indexed_Y };
	Instruction[PHX_STACK] = { "PHX",	AddressingMode::Stack };
	Instruction[STP] = { "STP",	AddressingMode::Implied };
	Instruction[CMP_ABS_X] = { "CMP",	AddressingMode::Absolute_Indexed_X };
	Instruction[DEC_ABS_X] = { "DEC",	AddressingMode::Absolute_Indexed_X };
	Instruction[BBS5] = { "BBS5", AddressingMode::PC_Relative };
	Instruction[CPX_IMM] = { "CPX",	AddressingMode::Immediate };
	Instruction[SBC_I_ZP_X] = { "SBC",	AddressingMode::ZeroPage_Indexed_Indirect_With_X };
	Instruction[CPX_ZP] = { "CPX",	AddressingMode::ZeroPage };
	Instruction[SBC_ZP] = { "SBC",	AddressingMode::ZeroPage };
	Instruction[INC_ZP] = { "INC",	AddressingMode::ZeroPage };
	Instruction[SMB6] = { "SMB6", AddressingMode::ZeroPage };
	Instruction[INX] = { "INX",	AddressingMode::Implied };
	Instruction[SBC_IMM] = { "SBC",	AddressingMode::Immediate };
	Instruction[NOP] = { "NOP",	AddressingMode::Implied };
	Instruction[CPX_ABS] = { "CPX",	AddressingMode::Absolute };
	Instruction[SBC_ABS] = { "SBC",	AddressingMode::Absolute };
	Instruction[INC_ABS] = { "INC",	AddressingMode::Absolute };
	Instruction[BBS6] = { "BBS6", AddressingMode::PC_Relative };
	Instruction[BEQ] = { "BEQ",	AddressingMode::PC_Relative };
	Instruction[SBC_I_ZP_Y] = { "SBC",	AddressingMode::ZeroPage_Indirect_Indexed_With_Y };
	Instruction[SBC_I_ZP] = { "SBC",	AddressingMode::ZeroPage_Indirect };
	Instruction[SBC_ZP_X] = { "SBC",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[INC_ZP_X] = { "INC",	AddressingMode::ZeroPage_Indexed_With_X };
	Instruction[SMB7] = { "SMB7", AddressingMode::ZeroPage };
	Instruction[SED] = { "SED",	AddressingMode::Implied };
	Instruction[SBC_ABS_Y] = { "SBC",	AddressingMode::Absolute_Indexed_Y };
	Instruction[PLX_STACK] = { "PLX",	AddressingMode::Stack };
	Instruction[SBC_ABS_X] = { "SBC",	AddressingMode::Absolute_Indexed_X };
	Instruction[INC_ABS_X] = { "INC",	AddressingMode::Absolute_Indexed_X };
	Instruction[BBS7] = { "BBS7", AddressingMode::PC_Relative };
}

void CPU::Reset()
{
	uint8_t lsb, msb;

	A = X = Y = 0;

	flags.reg = 0;
	flags.bits.R = 1;
	flags.bits.I = 1;

	SP = 0xFF;
	PC = 0xFFFC;

	lsb = _vm->ReadData(0xFFFC);
	msb = _vm->ReadData(0xFFFD);

	PC = msb << 8 | lsb;
}

void CPU::Run()
{
	uint32_t totalCycles = 0;

	while (true)
	{
		while (waitForInterrupt)
		{
			pal_sleep(500);
		}

		totalCycles += Step();
	}
}

void CPU::DumpHistory()
{
	char output[255];
	uint8_t i = _historyIndex;

	while (++i != _historyIndex)
	{
		if (_history[i].fValid)
		{
			cpu_history* h = &_history[i];

			pal_sprintf(output, "\r\nPC:$%04x, SP:$%02x, A:$%02x X:$%02x, Y:$%02x, N:%d V:%d R:%d B:%d D:%d I:%d Z:%d C:%d",
				h->PC, 
				h->SP, 
				h->A, 
				h->X, 
				h->Y, 
				h->f.bits.N, 
				h->f.bits.V, 
				h->f.bits.R, 
				h->f.bits.B, 
				h->f.bits.D, 
				h->f.bits.I, 
				h->f.bits.Z, 
				h->f.bits.C);

 			_vm->CallbackDebugString(output);
		}
	}
	
	memset(_history, 0, sizeof(_history));

}

void CPU::SetOutput(bool fOutput)
{
	_output = fOutput;
}

uint8_t CPU::Step()
{
	uint8_t opCode = _vm->ReadData(PC);
	uint8_t cycles = 0;

#ifdef ENABLE_OUTPUT
	if (_output)
	{
		pal_sprintf(_debugstring, "$%04x %s", PC, Instruction[opCode].tag);
		_vm->CallbackDebugString(_debugstring);
	}
#endif

	cycles = Execute(opCode);

#ifdef ENABLE_OUTPUT
	if (_output)
	{
		pal_sprintf(_debugstring, "\r\nPC:$%04x, SP:$%02x, A:$%02x X:$%02x, Y:$%02x, N:%d V:%d R:%d B:%d D:%d I:%d Z:%d C:%d\r",
			PC, SP, A, X, Y, flags.bits.N, flags.bits.V, flags.bits.R, flags.bits.B, flags.bits.D, flags.bits.I, flags.bits.Z, flags.bits.C);
		_vm->CallbackDebugString(_debugstring);
	}
#endif
	return cycles;
}

uint8_t CPU::Execute(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;

	_OpCode = opCode;

	switch (opCode)
	{
		case BRK_STACK:
			cycles = BRK(opCode);
			break;

		// Set Memory Bit
		case SMB0:
		case SMB1:
		case SMB2:
		case SMB3:
		case SMB4:
		case SMB5:
		case SMB6:
		case SMB7:
			cycles = SetOrClearBit(opCode, (opCode - SMB0) / 16, true);
			break;


		// ResetMemoryBit
		case RMB0:
		case RMB1:
		case RMB2:
		case RMB3:
		case RMB4:
		case RMB5:
		case RMB6:
		case RMB7:
			cycles = SetOrClearBit(opCode, (opCode - RMB0) / 16, false);
			break;

		// Branch on Bit Reset
		case BBR0:
		case BBR1:
		case BBR2:
		case BBR3:
		case BBR4:
		case BBR5:
		case BBR6:
		case BBR7:
			cycles = BranchOnBit(opCode, (opCode - BBR0) / 16, false);
			break;

	    // Branch on Bit set
		case BBS0:
		case BBS1:
		case BBS2:
		case BBS3:
		case BBS4:
		case BBS5:
		case BBS6:
		case BBS7:
			cycles = BranchOnBit(opCode, (opCode - BBS0) / 16, true);
			break;

		// ORA - or with accumulator
		case ORA_I_ZP_X:
		case ORA_ZP:
		case ORA_IMM:
		case ORA_ABS:
		case ORA_I_ZP_Y:
		case ORA_I_ZP:
		case ORA_ZP_X:
		case ORA_ABS_Y:
		case ORA_ABS_X:
			cycles = ORA(opCode);
			break;

		// AND - and with accumulator
		case AND_ABS:
		case AND_I_ZP_X:
		case AND_IMM:
		case AND_I_ZP_Y:
		case AND_I_ZP:
		case AND_ABS_Y:
		case AND_ABS_X:
		case AND_ZP:
		case AND_ZP_X:
			cycles = AND(opCode);
			break;

		// EOR - XOR with accumulator
		case EOR_I_ZP_X:
		case EOR_ZP:
		case EOR_IMM:
		case EOR_I_ZP_Y:
		case EOR_I_ZP:
		case EOR_ZP_X:
		case EOR_ABS_Y:
		case EOR_ABS:
		case EOR_ABS_X:
			cycles = EOR(opCode);
			break;

		// ASL - arithmetic shift left
		case ASL_A:
		case ASL_ZP:
		case ASL_ABS:
		case ASL_ZP_X:
		case ASL_ABS_X:
			cycles = ASL(opCode);
			break;

		// LSR - logical shift right
		case LSR_ZP:
		case LSR_A:
		case LSR_ABS:
		case LSR_ZP_X:
		case LSR_ABS_X:
			cycles = LSR(opCode);
			break;

		// ROL - rotate one bit left
		case ROL_ZP:
		case ROL_A:
		case ROL_ABS:
		case ROL_ZP_X:
		case ROL_ABS_X:
			cycles = ROL(opCode);
			break;

		// ROR - rotate one bit right
		case ROR_ZP:
		case ROR_A:
		case ROR_ZP_X:
		case ROR_ABS_X:
		case ROR_ABS:
			cycles = ROR(opCode);
			break;

		// BIT - bit test
		case BIT_ZP:
		case BIT_ABS:
		case BIT_ZP_X:
		case BIT_ABS_X:
		case BIT_IMM:
			cycles = BIT(opCode);
			break;

		// TSB - test and set memory bit
		case TSB_ZP:
		case TSB_ABS:
			cycles = TSB(opCode);
			break;

		// TRB - test and reset memory bit
		case TRB_ZP:
		case TRB_ABS:
			cycles = TRB(opCode);
			break;

		// ADC - Add memory to accumulator and carry
		case ADC_I_ZP_X:
		case ADC_ZP:
		case ADC_IMM:
		case ADC_ABS:
		case ADC_I_ZP_Y:
		case ADC_I_ZP:
		case ADC_ZP_X:
		case ADC_ABS_Y:
		case ADC_ABS_X:
			cycles = ADC(opCode);
			break;

		// SBC - subtract from accumulator with borrow (carry bit)
		case SBC_I_ZP_X:
		case SBC_ZP:
		case SBC_IMM:
		case SBC_ABS:
		case SBC_I_ZP_Y:
		case SBC_I_ZP:
		case SBC_ZP_X:
		case SBC_ABS_Y:
		case SBC_ABS_X:
			cycles = SBC(opCode);
			break;

		// STA - Store accumulator in memory
		case STA_I_ZP_Y:
		case STA_I_ZP:
		case STA_ZP:
		case STA_I_ZP_X:
		case STA_ABS:
		case STA_ZP_X:
		case STA_ABS_Y:
		case STA_ABS_X:
			cycles = Store(opCode, A);
			break;

		// STX - store X register in memory
		case STX_ZP:
		case STX_ABS:
		case STX_ZP_Y:
			cycles = Store(opCode, X);
			break;

		// STY - store Y register in memory
		case STY_ZP:
		case STY_ABS:
		case STY_ZP_X:
			cycles = Store(opCode, Y);
			break;

		// STZ - store zero in memory
		case STZ_ZP:
		case STZ_ZP_X:
		case STZ_ABS:
		case STZ_ABS_X:
			cycles = STZ(opCode);
			break;

		// LDA - load Accumulator from memory
		case LDA_ABS_X:
		case LDA_ABS_Y:
		case LDA_I_ZP_X:
		case LDA_ZP:
		case LDA_IMM:
		case LDA_ABS:
		case LDA_I_ZP_Y:
		case LDA_I_ZP:
		case LDA_ZP_X:
			cycles = Load(opCode, A);
			break;

		// LDX - load X register from memory
		case LDX_ABS:
		case LDX_ABS_Y:
		case LDX_IMM:
		case LDX_ZP:
		case LDX_ZP_Y:
			cycles = Load(opCode, X);
			break;

		// LDY - load Y register from memory
		case LDY_ABS:
		case LDY_IMM:
		case LDY_ZP:
		case LDY_ZP_X:
		case LDY_ABS_X:
			cycles = Load(opCode, Y);
			break;

		// INC - increment memory or accumulator by 1
	
		// increment memory addresses
		case INC_ZP:
		case INC_ABS:
		case INC_ZP_X:
		case INC_ABS_X:
			cycles = IncrementMemory(opCode, true);
			break;

		// increment Accumulator
		case INC_A:
			cycles = IncrementRegister(opCode, A, true);
			break;

		// INX - increment X register by 1
		case INX:
			cycles = IncrementRegister(opCode, X, true);
			break;

		// INY - increment Y register by 1
		case INY:
			cycles = IncrementRegister(opCode, Y, true);
			break;

		// DEC - Decrement memory or accumulator by 1
		
		// decrement memory
		case DEC_ZP_X:
		case DEC_ZP:
		case DEC_ABS:
		case DEC_ABS_X:
			cycles = IncrementMemory(opCode, false);
			break;

		// DEC - decrement A register by 1
		case DEC:
			cycles = IncrementRegister(opCode, A, false);
			break;

		// DEX - Decrement X registery by 1
		case DEX:
			cycles = IncrementRegister(opCode, X, false);
			break;
		
		// DEY - Decrement Y register by 1
		case DEY:
			cycles = IncrementRegister(opCode, Y, false);
			break;

		// stack operations
		// 
		// PHA - Push Accumulator on stack
		case PHA_STACK:
			cycles = Push(opCode, A);
			break;

		// PLA - Pull Accumulator from stack
		case PLA_STACK:
			cycles = Pull(opCode, A, true);
			break;

		// PHX - Push X register on stack
		case PHX_STACK:
			cycles = Push(opCode, X);
			break;

		// PLX - Pull X register from stack
		case PLX_STACK:
			cycles = Pull(opCode, X, true);
			break;

		// PHY - Push Y register on stack
		case PHY_STACK:
			cycles = Push(opCode, Y);
			break;

		// PLY - Pull Y register from stack
		case PLY_STACK:
			cycles = Pull(opCode, Y, true);
			break;

		// PHP - Push processor status on stack
		case PHP_STACK:
			cycles = Push(opCode, flags.reg | 0x30 );
			break;

		// PLP - Pull processor status from stack
		case PLP_STACK:
			cycles = Pull(opCode, flags.reg, false);
			flags.bits.R = 1;
			flags.bits.B = 1;
			break;

		// register transfer

		// TXA - transfer X register to accumulator
		case TXA:
			cycles = TransferRegister(opCode, X, A, true);
			break;

		// TAX - transfer Accumulator to X register
		case TAX:
			cycles = TransferRegister(opCode, A, X, true);
			break;

		// TYA - transfer Y register to Accumulator
		case TYA:
			cycles = TransferRegister(opCode, Y, A, true);
			break;

		// TAY - transfer Accumulator to Y register
		case TAY:
			cycles = TransferRegister(opCode, A, Y, true);
			break;

		// TXS - transfer X register to stack pointer
		case TXS:
			cycles = TransferRegister(opCode, X, SP, false);
			break;

		// TSX - Transfer stack pointer to X register
		case TSX:
			cycles = TransferRegister(opCode, SP, X, true);
			break;

		// CMP - Compare memory and Accumulator
		case CMP_IMM:
		case CMP_ZP:
		case CMP_ZP_X:
		case CMP_ABS:
		case CMP_ABS_X:
		case CMP_ABS_Y:
		case CMP_I_ZP:
		case CMP_I_ZP_X:
		case CMP_I_ZP_Y:
			cycles = CompareRegister(opCode, A);
			break;

		// CPX - Compare memory and X register
		case CPX_IMM:
		case CPX_ZP:
		case CPX_ABS:
			cycles = CompareRegister(opCode, X);
			break;

		// CPY - Compare memory and Y register
		case CPY_IMM:
		case CPY_ZP:
		case CPY_ABS:
			cycles = CompareRegister(opCode, Y);
			break;

		// jumping and branching

		// JMP - Jump to new location
		case JMP_ABS_I:
		case JMP_I_X:
		case JMP_ABS:
			cycles = JMP(opCode);
			break;

		// JSR - Jump to sub routine
		case JSR_ABS:
			cycles = JSR(opCode);
			break;

		// RTS - return from subroutine
		case RTS_STACK:
			cycles = RTS(opCode);
			break;

		// RTI - return from interrupt routine
		case RTI_STACK:
			cycles = RTI(opCode);
			break;

		// BPL - Branch if result plus (n=0)
		case BPL:
			cycles = BranchOnFlag(opCode, flags.bits.N, false);
			break;

		// BMI - Branch if result Minus (n=1)
		case BMI:
			cycles = BranchOnFlag(opCode, flags.bits.N, true);
			break;

		// BVC - Branch on overflow clear (v=0)
		case BVC:
			cycles = BranchOnFlag(opCode, flags.bits.V, false);
			break;

		// BVS - Branch on overflow set (v=1)
		case BVS:
			cycles = BranchOnFlag(opCode, flags.bits.V, true);
			break;
		
		// BRA - branch always
		case BRA:
			cycles = BranchOnFlag(opCode, 1, true);
			break;

		// BCC - Branch on carry clear (c=0)
		case BCC:
			cycles = BranchOnFlag(opCode, flags.bits.C, false);
			break;

		// BCS - Branch on carry set (c=1)
		case BCS:
			cycles = BranchOnFlag(opCode, flags.bits.C, true);
			break;

		// BNE - Branch if not equal zero (z=0)
		case BNE:
			cycles = BranchOnFlag(opCode, flags.bits.Z, false);
			break;

		// BEQ - Branch if equal to zero (z=1)
		case BEQ:
			cycles = BranchOnFlag(opCode, flags.bits.Z, true);
			break;

		// processor flags

		// SEC - set carry flag
		case SEC:
			cycles = SetOrClearFlag(opCode);
			break;

		// CLC - Clear carry flag
		case CLC:
			cycles = SetOrClearFlag(opCode);
			break;
			
		// SEI - Set interrupt disable flag
		case SEI:
			cycles = SetOrClearFlag(opCode);
			break;

		// CLI - Clear interrupt disable flag
		case CLI:
			cycles = SetOrClearFlag(opCode);
			break;

		// SED - Set decimal flag
		case SED:
			cycles = SetOrClearFlag(opCode);
			break;

		// CLD - Clear decimal flag
		case CLD:
			cycles = SetOrClearFlag(opCode);
			break;

		// CLV - Clear overflow
		case CLV:
			cycles = SetOrClearFlag(opCode);
			break;

		// WAI - wait for hardware interrupt
		case WAI:
			cycles = 3;
			waitForInterrupt = true;
			break;

		// STP - Stop mode (like WAI but also resets)
		case STP:
			cycles = 3;
			waitForInterrupt = true;
			Reset();
			break;

		// NOP - No operation
		case NOP:
			ReadByAddressMode(Instruction[opCode].mode, bytes, cycles, nullptr);
			cycles += 1;
			break;

		case 0x02:
		case 0x22:
		case 0x42:
		case 0x44:
		case 0x54:
		case 0x62:
		case 0x82:
		case 0xC2:
		case 0xD4:
		case 0xE2:
		case 0xF4:
			PC += 2;
			cycles = 2;
			break;

		case 0x5C:
		case 0xDC:
		case 0xFC:
			PC += 3;
			cycles = 2;
			break;

		case 0x03:
		case 0x0B:
		case 0x13:
		case 0x1B:
		case 0x23:
		case 0x2B:
		case 0x33:
		case 0x3B:
		case 0x43:
		case 0x4B:
		case 0x53:
		case 0x5B:
		case 0x63:
		case 0x6B:
		case 0x73:
		case 0x7B:
		case 0x83:
		case 0x8B:
		case 0x93:
		case 0x9B:
		case 0xA3:
		case 0xAB:
		case 0xB3:
		case 0xBB:
		case 0xC3:
		case 0xD3:
		case 0xE3:
		case 0xEB:
		case 0xF3:
		case 0xFB:
			PC += 1;
			cycles = 2;
			break;

		default:
			pal_debugbreak();
			break;
	}

	cpu_history *h = &_history[_historyIndex++];
	h->A = A;
	h->X = X;
	h->Y = Y;
	h->f = flags;
	h->SP = SP;
	h->PC = PC;
	h->fValid = true;

	return cycles;
}

uint8_t CPU::ReadByAddressMode(AddressingMode mode, uint8_t& bytes, uint8_t& cycles, uint16_t *outaddr)
{
	uint16_t addr = 0;
	uint16_t addr1 = 0;
	uint8_t data = 0;
	uint8_t lsb = 0;
	uint8_t msb = 0;
	uint8_t zaddr = 0;

	switch (mode)
	{
	case AddressingMode::Absolute:
		lsb = _vm->ReadData(PC);
		PC++;

		msb = _vm->ReadData(PC);
		PC++;

		addr = msb << 8 | lsb;
		data = _vm->ReadData(addr);

#ifdef ENABLE_OUTPUT
		if (_output)
		{
			pal_sprintf(_debugstring," $%04x [$%02x]", addr, data);
			_vm->CallbackDebugString(_debugstring);
		}
#endif

		bytes +=2;
		cycles+=3;
		break;

	case AddressingMode::Absolute_Indexed_X:
		lsb = _vm->ReadData(PC);
		PC++;

		msb = _vm->ReadData(PC);
		PC++;

		addr1 = msb << 8 | lsb;
		addr = addr1 + X;
		data = _vm->ReadData(addr);

#ifdef ENABLE_OUTPUT
		if (_output) { 
			pal_sprintf(_debugstring, " $%04x, X {$%04x} [$%02x]", addr1, addr, data); 
			_vm->CallbackDebugString(_debugstring);
		}
#endif

		cycles+=3;
		bytes +=2;

		if (addr >> 8 != addr1 >> 8)
		{
			// Datasheet says to add cycle for crossing page boundary
			cycles++;
		}

		break;
	case AddressingMode::Absolute_Indexed_Y:
		lsb = _vm->ReadData(PC);
		PC++;

		msb = _vm->ReadData(PC);
		PC++;

		addr1 = msb << 8 | lsb;
		addr = addr1 + Y;
		data = _vm->ReadData(addr);
	
	#ifdef ENABLE_OUTPUT
		if (_output) {
			pal_sprintf(_debugstring, " $%04x, Y {$%04x} [$%02x]", addr1, addr, data);
			_vm->CallbackDebugString(_debugstring);
		}
	#endif

		cycles+=3;
		bytes +=2;

		if (addr >> 8 != addr1 >> 8)
		{
			// Datasheet says to add cycle for crossing page boundary
			cycles++;
		}

		break;

	case AddressingMode::Immediate:
	case AddressingMode::PC_Relative:
	case AddressingMode::Stack:
	case AddressingMode::Implied:
		data = _vm->ReadData(PC);

#ifdef ENABLE_OUTPUT		
		if (_output) {
			pal_sprintf(_debugstring, " #$%02x", data);
			_vm->CallbackDebugString(_debugstring);
		}
#endif
		PC++;
		bytes++;
		cycles++;
		break;

	case AddressingMode::ZeroPage:
		addr = _vm->ReadData(PC);
		PC++;
		bytes++;

		data = _vm->ReadData(addr);

#ifdef ENABLE_OUTPUT
		if (_output) {
			pal_sprintf(_debugstring, " $%02x  [$%02x]", addr, data);
			_vm->CallbackDebugString(_debugstring);
		}
#endif
		cycles+=2;
		break;

	case AddressingMode::ZeroPage_Indexed_With_X:
		zaddr = _vm->ReadData(PC);
		PC++;
		bytes++;
		addr = (zaddr + X) & 0xFF;
		data = _vm->ReadData(addr);

#ifdef ENABLE_OUTPUT
		if (_output) {
			pal_sprintf(_debugstring, " $%02x, X {$%02x} [$%02x]", zaddr, addr, data);
			_vm->CallbackDebugString(_debugstring);
		}
#endif
		cycles+=3;
		break;


	case AddressingMode::ZeroPage_Indexed_With_Y:
		zaddr = _vm->ReadData(PC);
		PC++;
		bytes++;
		addr = (zaddr + Y) & 0xFF;
		data = _vm->ReadData(addr);
		
#ifdef ENABLE_OUTPUT
		if (_output) {
			pal_sprintf(_debugstring, " $%02x, Y {$%02x} [$%02x]", zaddr, addr, data);
			_vm->CallbackDebugString(_debugstring);
		}
#endif
		cycles+=3;
		break;

	case AddressingMode::ZeroPage_Indirect:
		zaddr = _vm->ReadData(PC);
		PC++;
		bytes++;

		lsb = _vm->ReadData(zaddr);

		msb = _vm->ReadData((zaddr + 1) & 0xFF);

		addr = msb << 8 | lsb;
		data = _vm->ReadData(addr);

	#ifdef ENABLE_OUTPUT
		if (_output) {
			pal_sprintf(_debugstring, " ($%02x) {$%04x} [$%02x]", zaddr, addr, data);
			_vm->CallbackDebugString(_debugstring);
		}
#endif
		cycles+=4;
		break;

	case AddressingMode::ZeroPage_Indexed_Indirect_With_X:
		zaddr = _vm->ReadData(PC);
		PC++;
		bytes++;

#ifdef ENABLE_OUTPUT		
		if (_output) {
			pal_sprintf(_debugstring, " ($%02x, X)", zaddr);
			_vm->CallbackDebugString(_debugstring);
		}
#endif

		zaddr += X;
#ifdef ENABLE_OUTPUT
		if (_output) {
			pal_sprintf(_debugstring, " {$%02x} ", zaddr);
			_vm->CallbackDebugString(_debugstring);
		}
#endif


		lsb = _vm->ReadData(zaddr & 0xFF);

		msb = _vm->ReadData((zaddr + 1) & 0xFF);

		addr = msb << 8 | lsb;
		data = _vm->ReadData(addr);

#ifdef ENABLE_OUTPUT
		if (_output) {
			pal_sprintf(_debugstring, " {$%04x} [$%02x]", addr, data);
			_vm->CallbackDebugString(_debugstring);
		}
#endif

		cycles+=5;
		break;


	case AddressingMode::ZeroPage_Indirect_Indexed_With_Y:
		zaddr = _vm->ReadData(PC);
		PC++;
		bytes++;

#ifdef ENABLE_OUTPUT
		if (_output) {
			pal_sprintf(_debugstring, " ($%02x), Y", zaddr);
			_vm->CallbackDebugString(_debugstring);
		}
		#endif

		lsb = _vm->ReadData(zaddr);

		msb = _vm->ReadData((zaddr + 1) & 0xFF);

		addr1 = msb << 8 | lsb;
		addr = addr1 + Y;
		data = _vm->ReadData(addr);

#ifdef ENABLE_OUTPUT
		if (_output) {
			pal_sprintf(_debugstring, " {$%04x} {$%04x} [$%02x]", addr1, addr, data);
			_vm->CallbackDebugString(_debugstring);
		}
#endif
		cycles+=4;

		if (addr >> 8 != addr1 >> 8)
		{
			// Datasheet says to add cycle for crossing page boundary
			cycles++;
		}

		break;
	}

	if (outaddr)
	{
		*outaddr = addr;
	}

	return data;
}

uint8_t CPU::WriteByAddressMode(uint8_t data, AddressingMode mode, uint8_t& bytes, uint8_t& cycles)
{
	uint16_t addr = 0;
	uint8_t lsb = 0;
	uint8_t msb = 0;
	uint8_t zaddr = 0;

	switch (mode)
	{
		case AddressingMode::Absolute:
			lsb = _vm->ReadData(PC);
			PC++;

			msb = _vm->ReadData(PC);
			PC++;
   			bytes+=2;

			addr = msb << 8 | lsb;
			_vm->WriteData(addr, data);

#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " $%04x [$%02x]", addr, data);
				_vm->CallbackDebugString(_debugstring);
			}
#endif

			cycles+=3;
			break;

		case AddressingMode::Absolute_Indexed_X:
			lsb = _vm->ReadData(PC);
			PC++;

			msb = _vm->ReadData(PC);
			PC++;
			bytes+=2;

			addr = msb << 8 | lsb;
		
#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " $%04x,X ", addr);
				_vm->CallbackDebugString(_debugstring);
			}
#endif

			addr += X;
			_vm->WriteData(addr, data);
			
#ifdef ENABLE_OUTPUT
			if (_output) 
			{
				pal_sprintf(_debugstring, " {$%04x} [$%02x]", addr, data);
				_vm->CallbackDebugString(_debugstring);
			}
#endif
			cycles+=3;
			break;

		case AddressingMode::Absolute_Indexed_Y:
			lsb = _vm->ReadData(PC);
			PC++;

			msb = _vm->ReadData(PC);
			PC++;
			bytes+=2;

			addr = msb << 8 | lsb;
			
#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring," $%04x,Y ", addr);
				_vm->CallbackDebugString(_debugstring);
			}
#endif

			addr += Y;
			_vm->WriteData(addr,data);

#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " {$%04x} [$%02x]", addr, data);
				_vm->CallbackDebugString(_debugstring);
			}
#endif

			cycles+=3;
			break;

		case AddressingMode::ZeroPage:
			zaddr = _vm->ReadData(PC);
			PC++;
			bytes++;

			_vm->WriteData(zaddr,data);

#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " $%02x  [$%02x] ", zaddr, data);
				_vm->CallbackDebugString(_debugstring);
			}
#endif

			cycles+=2;
			break;

		case AddressingMode::ZeroPage_Indexed_Indirect_With_X:
			zaddr = _vm->ReadData(PC);
			PC++;
			bytes++;

#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " ($%02x,X) ", zaddr);
				_vm->CallbackDebugString(_debugstring);
			}
#endif
			zaddr += X;

#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, "{$%02x} ", zaddr);
				_vm->CallbackDebugString(_debugstring);
			}
#endif

			lsb = _vm->ReadData(zaddr);

			msb = _vm->ReadData(zaddr + 1);

			addr = msb << 8 | lsb;
			_vm->WriteData(addr, data);

#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " {$%04x} [$%02x] ", addr, data);
				_vm->CallbackDebugString(_debugstring);
			}
#endif
			cycles+=5;
			break;

		case AddressingMode::ZeroPage_Indexed_With_X:
			zaddr = _vm->ReadData(PC);
			PC++;
			bytes++;

#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " $%02x,X ", zaddr);
				_vm->CallbackDebugString(_debugstring);
			}
#endif
			_vm->WriteData((zaddr + X) & 0xFF, data);

#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " {$%02x} [$%02x]", (zaddr + X) & 0xFF, data);
				_vm->CallbackDebugString(_debugstring);
			}
#endif
			cycles+=2;
			break;

		case AddressingMode::ZeroPage_Indexed_With_Y:
			zaddr = _vm->ReadData(PC);
			PC++;
			bytes++;

#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " $%02x,Y ", zaddr);
				_vm->CallbackDebugString(_debugstring);
			}
#endif

			_vm->WriteData((zaddr + Y) & 0xFF, data);

#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " {$%02x} [$%02x]", (zaddr + Y) & 0xFF, data);
				_vm->CallbackDebugString(_debugstring);
			}
#endif
			cycles+=2;
			break;

		case AddressingMode::ZeroPage_Indirect:
			zaddr = _vm->ReadData(PC);
			PC++;
			bytes++;

#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " ($%02x) ", zaddr);
				_vm->CallbackDebugString(_debugstring);
			}
#endif
			lsb = _vm->ReadData(zaddr);

			msb = _vm->ReadData((zaddr + 1) & 0xFF);

			addr = msb << 8 | lsb;
			_vm->WriteData(addr, data);

#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " {$%04x} [$%02x]", addr, data);
				_vm->CallbackDebugString(_debugstring);
			}
#endif

			cycles+=4;
			break;

		case AddressingMode::ZeroPage_Indirect_Indexed_With_Y:
			zaddr = _vm->ReadData(PC);
			PC++;
			bytes++;
			
#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " ($%02x),Y ", zaddr);
				_vm->CallbackDebugString(_debugstring);
			}
#endif

			lsb = _vm->ReadData(zaddr);

			msb = _vm->ReadData((zaddr + 1) & 0xFF);

			addr = msb << 8 | lsb;
			addr += Y;
			_vm->WriteData(addr, data);
			
#ifdef ENABLE_OUTPUT
			if (_output) {
				pal_sprintf(_debugstring, " {$%04x} [$%02x]  ", addr, data);
				_vm->CallbackDebugString(_debugstring);
			}
#endif

			cycles+=4;

			break;
	}
	return 0;
}


bool CPU::GetInstructionInfo(uint8_t opCode, uint16_t address, uint8_t* bytes, uint8_t* cycles)
{
	switch (Instruction[opCode].mode)
	{
	case AddressingMode::Undefined:
		return false;

	case AddressingMode::Absolute:								// a
		*cycles = 4;
		*bytes  = 3;
		// Datasheet says: Read-Modify-Write, add 2 cycles
		// Looks like this pertains to multi processor systems
		break;

	case AddressingMode::Absolute_Indexed_Indirect_With_X:		// (a,x)
		*cycles = 6;
		*bytes  = 3;
		break;

	case AddressingMode::Absolute_Indexed_X:					// a,x
		*cycles = 4;
		*bytes  = 3;

		if (opCode == STA_ABS_X)
		{
			(*cycles)++;
			//Add 1 cycle for STA abs,X regardless of boundary crossing
		}
		else
		{
			//Page boundary, add 1 cycle if page boundary is crossed when forming address. 
			if (address >> 8 != PC >> 8)
			{
				(*cycles)++;
			}
		}

		// Datasheet says: Read-Modify-Write, add 2 cycles
		// Looks like this pertains to multi processor systems

		break;

	case AddressingMode::Absolute_Indexed_Y:					// a,y
		*cycles = 4;
		*bytes  = 3;

		// Datasheet says: Page boundary, add 1 cycle if page boundary is crossed when forming address.
		if (address >> 8 != PC >> 8)
		{
			(*cycles)++;
		}

		break;

	case AddressingMode::Absolute_Indirect:						// (a)
		*cycles = 6;
		*bytes  = 3;
		break;

	case AddressingMode::Accumulator:							// A
		*cycles = 2;
		*bytes  = 1;
		break;

	case AddressingMode::Immediate:								// #
		*cycles = 2;
		*bytes  = 2;
		break;

	case AddressingMode::Implied:								// i
		*cycles = 2;
		*bytes  = 1;
		break;

	case AddressingMode::PC_Relative:							// r
		*cycles = 2;
		*bytes  = 1;

		// Branch taken, add 1 cycle if branch is taken
		if (address >> 8 != PC >> 8)
		{
			// Datsheet says: Page boundary, add 1 cycle if page boundary is crossed when forming address.
			(*cycles)++;
		}

		break;

	case AddressingMode::Stack:									// s
		*cycles = 7;  // data sheet shows 3-7 ??
		*bytes  = 1;
		break;

	case AddressingMode::ZeroPage:								// zp
		*cycles = 3;
		*bytes  = 2;

		// Datasheet says: Read-Modify-Write, add 2 cycles
		// Looks like this pertains to multi processor systems
		break;

	case AddressingMode::ZeroPage_Indexed_Indirect_With_X:		// (zp,x)
		*cycles = 6;
		*bytes  = 2;
		break;

	case AddressingMode::ZeroPage_Indexed_With_X:		   	    // zp,x
		*cycles = 4;
		*bytes  = 2;

		// Datasheet says: Read-Modify-Write, add 2 cycles
		// Looks like this pertains to multi processor systems
		break;

	case AddressingMode::ZeroPage_Indexed_With_Y:				// zp,y
		*cycles = 4;
		*bytes  = 2;
		break;

	case AddressingMode::ZeroPage_Indirect:						// (zp)
		*cycles = 5;
		*bytes  = 2;
		break;

	case AddressingMode::ZeroPage_Indirect_Indexed_With_Y:		// (zp),y
		*cycles = 5;
		*bytes  = 2;

		if (address >> 8 != PC >> 8)
		{
			// Datsheet says: Page boundary, add 1 cycle if page boundary is crossed when forming address.
			(*cycles)++;
		}
		break;
	}

	return true;
}