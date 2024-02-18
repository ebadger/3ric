#include "cpu.h"
#include <stdio.h>

uint8_t CPU::Load(uint8_t opCode, uint8_t & reg)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;

	PC++;
	cycles++;

	InstructionInfo ii = Instruction[opCode];

	data = ReadByAddressMode(ii.mode, bytes, cycles, nullptr);

	reg = data;
	flags.bits.Z = (reg == 0);
	flags.bits.N = !!(reg & 0x80);

	return cycles;
}

uint8_t CPU::Store(uint8_t opCode, uint8_t &reg)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;

	PC++;
	bytes++;
	cycles++;

	InstructionInfo ii = Instruction[opCode];

	WriteByAddressMode(reg, ii.mode, bytes, cycles);

	return cycles;
}

uint8_t CPU::IncrementRegister(uint8_t opCode, uint8_t& reg, bool positive)
{
	uint8_t cycles = 2;

	PC++;

	InstructionInfo ii = Instruction[opCode];

	reg += positive ? 1 : -1;

	flags.bits.Z = (reg == 0);
	flags.bits.N = !!(reg & 0x80);

	return cycles;

}

uint8_t CPU::IncrementMemory(uint8_t opCode, bool positive)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint16_t addr = 0;

	PC++;

	InstructionInfo ii = Instruction[opCode];

	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);
	
	data += positive ? 1 : -1;

	_vm->WriteData(addr, data);

	flags.bits.Z = (data == 0);
	flags.bits.N = !!(data & 0x80);

	GetInstructionInfo(opCode, addr, &bytes, &cycles);
	cycles += 2;

	return cycles;

}

uint8_t CPU::JSR(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t msb = 0;
	uint8_t lsb = 0;
	uint16_t addr = 0;
	uint16_t retaddr = 0;

	PC++;
	bytes++;
	cycles++;

	InstructionInfo ii = Instruction[opCode];

	// read the jump address
	lsb = ReadByAddressMode(AddressingMode::Immediate, bytes, cycles, nullptr);
	msb = ReadByAddressMode(AddressingMode::Immediate, bytes, cycles, nullptr);

	// jump address
	addr = msb << 8 | lsb;

	retaddr = PC - 1;
	// push PC onto the stack - push the MSB first
	_vm->WriteData(0x100 + SP--, retaddr >> 8);
	cycles++;

	_vm->WriteData(0x100 + SP--, retaddr & 0xFF);
	cycles++;

	PC = addr;
	cycles++;

	return cycles;
}

uint8_t CPU::RTS(uint8_t)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t msb = 0;
	uint8_t lsb = 0;
	uint16_t addr = 0;

	PC++;
	bytes++;

	lsb = _vm->ReadData(++SP + 0x100);
	msb = _vm->ReadData(++SP + 0x100);

	addr = msb << 8 | lsb;
	PC = addr;
	PC++;

	cycles = 6;

	return cycles;
}

uint8_t CPU::Push(uint8_t opcode, uint8_t reg)
{
	uint8_t cycles = 3;
	PC++;

	_vm->WriteData(0x100 + SP--, reg);

	return cycles;
}

uint8_t CPU::Pull(uint8_t opcode, uint8_t &reg, bool updateflags)
{
	uint8_t cycles = 4;
	PC++;
	
	reg = _vm->ReadData(++SP + 0x100);

	if (updateflags)
	{
		flags.bits.Z = (reg == 0);
		flags.bits.N = !!(reg & 0x80);
	}

	return cycles;
}

uint8_t CPU::ORA(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint16_t addr = 0;

	PC++;
	cycles++;

	InstructionInfo ii = Instruction[opCode];

	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	A |= data;

	flags.bits.Z = (A == 0);
	flags.bits.N = !!(A & 0x80);

	return cycles;
}

uint8_t CPU::AND(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint16_t addr = 0;

	PC++;
	cycles++;

	InstructionInfo ii = Instruction[opCode];

	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	A &= data;

	flags.bits.Z = (A == 0);
	flags.bits.N = !!(A & 0x80);

	return cycles;
}

uint8_t CPU::EOR(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint16_t addr = 0;

	PC++;
	cycles++;

	InstructionInfo ii = Instruction[opCode];

	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	A ^= data;

	flags.bits.Z = (A == 0);
	flags.bits.N = !!(A & 0x80);

	return cycles;
}

uint8_t CPU::ASL(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint8_t shifted = 0;
	uint16_t addr = 0;

	PC++;

	InstructionInfo ii = Instruction[opCode];

	if (ii.mode == AddressingMode::Accumulator)
	{
		data = A;
		A = A << 1;
		shifted = A;
	}
	else
	{
		data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);
		shifted = data << 1;

		_vm->WriteData(addr, shifted);
	}

	flags.bits.C = !!(data & 0x80);
	flags.bits.Z = (shifted == 0);
	flags.bits.N = !!(shifted & 0x80);
	
	switch (ii.mode)
	{
	case Accumulator:
		cycles = 2;
		break;
	case ZeroPage:
		cycles = 5;
		break;
	case ZeroPage_Indexed_With_X:
		cycles = 6;
		break;
	case Absolute:
		cycles = 6;
		break;
	case Absolute_Indexed_X:
		cycles = 7;
		break;
	}

	return cycles;
}

uint8_t CPU::LSR(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint8_t shifted = 0;
	uint16_t addr = 0;

	PC++;

	InstructionInfo ii = Instruction[opCode];

	if (ii.mode == AddressingMode::Accumulator)
	{
		data = A;
		A = A >> 1;
		shifted = A;
	}
	else
	{
		data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);
		shifted = data >> 1;

		_vm->WriteData(addr, shifted);
	}

	flags.bits.C = !!(data & 0x01);
	flags.bits.Z = (shifted == 0);
	flags.bits.N = !!(shifted & 0x80);

	switch (ii.mode)
	{
	case Accumulator:
		cycles = 2;
		break;
	case ZeroPage:
		cycles = 5;
		break;
	case ZeroPage_Indexed_With_X:
		cycles = 6;
		break;
	case Absolute:
		cycles = 6;
		break;
	case Absolute_Indexed_X:
		cycles = 7;
		break;
	}

	return cycles;
}

uint8_t CPU::ROL(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint8_t shifted = 0;
	uint16_t addr = 0;

	PC++;

	InstructionInfo ii = Instruction[opCode];

	if (ii.mode == AddressingMode::Accumulator)
	{
		data = A;
		A = A << 1;
		A |= flags.bits.C;
		shifted = A;
	}
	else
	{
		data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);
		shifted = data << 1;
		shifted |= flags.bits.C;

		_vm->WriteData(addr, shifted);
	}

	flags.bits.C = !!(data & 0x80);
	flags.bits.Z = (shifted == 0);
	flags.bits.N = !!(shifted & 0x80);

	switch (ii.mode)
	{
	case Accumulator:
		cycles = 2;
		break;
	case ZeroPage:
		cycles = 5;
		break;
	case ZeroPage_Indexed_With_X:
		cycles = 6;
		break;
	case Absolute:
		cycles = 6;
		break;
	case Absolute_Indexed_X:
		cycles = 7;
		break;
	}

	return cycles;
}

uint8_t CPU::ROR(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint8_t shifted = 0;
	uint16_t addr = 0;

	PC++;

	InstructionInfo ii = Instruction[opCode];

	if (ii.mode == AddressingMode::Accumulator)
	{
		data = A;
		A = A >> 1;
		A |= (flags.bits.C << 7);
		shifted = A;
	}
	else
	{
		data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);
		shifted = data >> 1;
		shifted |= (flags.bits.C << 7);

		_vm->WriteData(addr, shifted);
	}

	flags.bits.C = !!(data & 0x01);
	flags.bits.Z = (shifted == 0);
	flags.bits.N = !!(shifted & 0x80);

	switch (ii.mode)
	{
	case Accumulator:
		cycles = 2;
		break;
	case ZeroPage:
		cycles = 5;
		break;
	case ZeroPage_Indexed_With_X:
		cycles = 6;
		break;
	case Absolute:
		cycles = 6;
		break;
	case Absolute_Indexed_X:
		cycles = 7;
		break;
	}

	return cycles;
}

uint8_t CPU::BIT(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint16_t addr = 0;

	PC++;
	cycles++;

	InstructionInfo ii = Instruction[opCode];

	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	flags.bits.Z = (data & A) == 0;

	if (ii.mode != AddressingMode::Immediate)
	{
		flags.bits.N = (data & 0x80) > 0;
		flags.bits.V = (data & 0x40) > 0;
	}

	return cycles;
}

uint8_t CPU::TRB(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint8_t data2 = 0;
	uint16_t addr = 0;
	uint8_t mask = 0;

	PC++;
	cycles++;

	InstructionInfo ii = Instruction[opCode];

	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	mask = A ^ 0xFF;
	data2 = data & mask;

	_vm->WriteData(addr, data2);

	flags.bits.Z = (data & A) == 0;

	switch (ii.mode)
	{
	case ZeroPage:
		cycles = 5;
		break;
	case Absolute:
		cycles = 6;
		break;
	}

	return cycles;
}

uint8_t CPU::TSB(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint8_t data2 = 0;
	uint16_t addr = 0;

	PC++;
	cycles++;

	InstructionInfo ii = Instruction[opCode];

	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	data2 = data | A;

	_vm->WriteData(addr, data2);

	flags.bits.Z = (data & A) == 0;

	switch (ii.mode)
	{
	case ZeroPage:
		cycles = 5;
		break;
	case Absolute:
		cycles = 6;
		break;
	}

	return cycles;
}

uint8_t CPU::ADC(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint16_t addr = 0;
	uint16_t result = 0;

	PC++;
	cycles++;

	InstructionInfo ii = Instruction[opCode];

	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	result = A + data + flags.bits.C;


	if (flags.bits.D)
	{
		if (((A & 0xF) + (data & 0xF) + flags.bits.C) > 9)
		{
			result += 0x06;
		}

		if (result > 0x99)
		{
			result += 0x60;
		}
	}


	flags.bits.C = result > 0xFF;
	flags.bits.V = ((A ^ result) & (data ^ result) & 0x80) ? 1 : 0;

	A = result & 0xFF;

	flags.bits.Z = (A == 0);
	flags.bits.N = !!(A & 0x80);

	return cycles;
}

uint8_t CPU::SBC(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint16_t addr = 0;
	uint16_t result = 0;

	PC++;
	cycles++;

	InstructionInfo ii = Instruction[opCode];

	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	if (flags.bits.D)
	{
		data = 0x99 - data;
	}
	else
	{
		data = ~data;
	}

	result = A + data + flags.bits.C;

	if (flags.bits.D) 
	{
		if (((A & 0xF) + (data & 0xF) + flags.bits.C) > 9)
		{
			result += 0x06;
		}

		if (result > 0x99)
		{
			result += 0x60;
		}
	}

	flags.bits.C = result > 0xFF;
	flags.bits.V = ((A ^ result) & (data ^ result) & 0x80) ? 1 : 0;

	A = result & 0xFF;

	flags.bits.Z = (A == 0);
	flags.bits.N = !!(A & 0x80);

	return cycles;
}

uint8_t CPU::STZ(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint8_t data2 = 0;
	uint16_t addr = 0;

	PC++;
	cycles++;

	InstructionInfo ii = Instruction[opCode];

	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	_vm->WriteData(addr, 0x00);

	if (ii.mode == AddressingMode::Absolute_Indexed_X)
	{
		cycles++;
	}

	return cycles;
}

uint8_t CPU::TransferRegister(uint8_t opCode, uint8_t& source, uint8_t& dest, bool updateflags)
{
	uint8_t cycles = 2;

	PC++;

	InstructionInfo ii = Instruction[opCode];

	dest = source;

	if (updateflags)
	{
		flags.bits.Z = (dest == 0);
		flags.bits.N = !!(dest & 0x80);
	}

	return cycles;
}

uint8_t CPU::CompareRegister(uint8_t opCode, uint8_t& reg)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint16_t addr = 0;

	PC++;
	cycles++;

	InstructionInfo ii = Instruction[opCode];

	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	flags.bits.Z = (data == reg);
	flags.bits.C = (reg >= data);
	flags.bits.N = !!((reg - data) & 0x80);

	return cycles;
}

uint8_t CPU::JMP(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint16_t addr = 0;
	uint16_t addrmsb = 0;
	uint16_t addrlsb = 0;
	uint8_t lsb = 0;
	uint8_t msb = 0;
	uint16_t PCtmp = 0;


	PC++;

	InstructionInfo ii = Instruction[opCode];


	if (ii.mode == AddressingMode::Absolute)
	{
		data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);
		PC = addr;
		cycles = 3;
	}
	else if (ii.mode == AddressingMode::Absolute_Indirect)
	{
		PCtmp = PC;
		// read the jump address
		lsb = _vm->ReadData(PC);

		if (_output) {
			pal_sprintf(_debugstring, " #$%02x", lsb);
		}

		PC++;
		bytes++;
		cycles++;

		// preserve page for MSB for jump indirect bug
		msb = _vm->ReadData(PC & 0xFF | PCtmp & 0xFF00);

		if (_output) {
			pal_sprintf(_debugstring, " #$%02x", msb);
		}

		PC++;
		bytes++;
		cycles++;

		cycles = 5;

		addrlsb = lsb | msb << 8;
		addrmsb = (lsb + 1) | msb << 8;

		addr = _vm->ReadData(addrlsb);
		PC = addr | _vm->ReadData(addrmsb) << 8;
	}
	else if (ii.mode == AddressingMode::Absolute_Indexed_Indirect_With_X)
	{
		PCtmp = PC;
		// read the jump address
		lsb = _vm->ReadData(PC);

		if (_output) {
			pal_sprintf(_debugstring, " #$%02x", lsb);
		}

		PC++;
		bytes++;
		cycles++;

		// preserve page for MSB for jump indirect bug
		msb = _vm->ReadData(PC & 0xFF | PCtmp & 0xFF00);

		if (_output) {
			pal_sprintf(_debugstring, " #$%02x", msb);
		}

		PC++;
		bytes++;
		cycles++;

		cycles = 5;

		addrlsb = lsb | msb << 8;
		addrlsb += X;
		addrmsb = addrlsb + 1;

		addr = _vm->ReadData(addrlsb);
		PC = addr | _vm->ReadData(addrmsb) << 8;
	}
	else
	{
		pal_debugbreak();
	}

	return cycles;
}

uint8_t CPU::BranchOnFlag(uint8_t opCode, uint8_t bFlag, bool bIfPositive)
{
	uint8_t cycles = 2;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint16_t addr = 0;
	uint8_t offset = 0;

	PC++;

	InstructionInfo ii = Instruction[opCode];

	// branch
	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	if (!(bFlag ^ (uint8_t)bIfPositive))
	{
		if (PC >> 8 != (PC + data) >> 8)
		{
			cycles++;
		}

		PC = PC + (int8_t)data;
/*
		offset = (PC + data) & 0xFF;
		PC &= 0xFF00;
		PC |= offset;
*/
	}

	return cycles;
}

uint8_t CPU::BranchOnBit(uint8_t opCode, uint8_t bit, bool bIfPositive)
{
	uint8_t cycles = 2;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint16_t addr = 0;
	uint8_t offset = 0;

	PC++;
	InstructionInfo ii = Instruction[opCode];

	// read from ZP
	data = ReadByAddressMode(AddressingMode::ZeroPage, bytes, cycles, &addr);

	uint8_t fBranch = !!(data & (1 << bit));

	// branch address
	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	if (!(fBranch ^ (uint8_t)bIfPositive))
	{
		if (PC >> 8 != (PC + data) >> 8)
		{
			cycles++;
		}

		offset = (PC + data) & 0xFF;
		PC &= 0xFF00;
		PC |= offset;
	}

	return 5;
}

uint8_t CPU::SetOrClearFlag(uint8_t opCode)
{
	PC++;
	switch (opCode)
	{
	// SEC - set carry flag
	case SEC:
		flags.bits.C = 1;
		break;

	// CLC - Clear carry flag
	case CLC:
		flags.bits.C = 0;
		break;

	// SEI - Set interrupt disable flag
	case SEI:
		flags.bits.I = 1;
		break;

	// CLI - Clear interrupt disable flag
	case CLI:
		flags.bits.I = 0;
		break;

	// SED - Set decimal flag
	case SED:
		flags.bits.D = 1;
		break;

	// CLD - Clear decimal flag
	case CLD:
		flags.bits.D = 0;
		break;

	// CLV - Clear overflow
	case CLV:
		flags.bits.V = 0;
		break;
	}

	return 2;
}

uint8_t CPU::SetOrClearBit(uint8_t opCode, uint8_t bit, bool fSet)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint8_t data2 = 0;
	uint16_t addr = 0;
	uint8_t mask = 0;

	PC++;
	
	InstructionInfo ii = Instruction[opCode];

	data = ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	if (fSet)
	{
		mask = (1 << bit);
		data2 = data | mask;
	}
	else
	{
		mask = ~(1 << bit);
		data2 = data & mask;
	}

	_vm->WriteData(addr, data2);

	return 5;
}

uint8_t CPU::BRK(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t data = 0;
	uint16_t addr = 0;

	PC++;

	InstructionInfo ii = Instruction[opCode];

	ReadByAddressMode(ii.mode, bytes, cycles, &addr);

	cycles = MaskableInterrupt(true);

	return cycles;
}

uint8_t CPU::MaskableInterrupt(bool fSoftware)
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t msb = 0;
	uint8_t lsb = 0;
	uint16_t addr = 0;
	uint16_t retaddr = 0;

	waitForInterrupt = false;

	// check interrupt enabled flag?

	if (flags.bits.I == 1 && !fSoftware)
	{
		return 0;
	}

	retaddr = PC;
	// push return address onto the stack
	// push PC onto the stack - push the MSB first
	_vm->WriteData(0x100 + SP--, retaddr >> 8);
	cycles++;

	_vm->WriteData(0x100 + SP--, retaddr & 0xFF);
	cycles++;

	// push processor status onto the stack
	flags.bits.B = fSoftware;
	flags.bits.R = 1;
	_vm->WriteData(0x100 + SP--, flags.reg);

	// set flags
	flags.bits.B = 0;
	flags.bits.I = 1;
	flags.bits.D = 0;

	// jump to the IRQ address

	lsb = _vm->ReadData(0xFFFE);
	msb = _vm->ReadData(0xFFFF);

	// jump address
	addr = msb << 8 | lsb;

	PC = addr;
	cycles++;

	return 7;
}

uint8_t CPU::NonMaskableInterrupt()
{
	uint8_t cycles = 0;
	uint8_t bytes = 0;
	uint8_t msb = 0;
	uint8_t lsb = 0;
	uint16_t addr = 0;
	uint16_t retaddr = 0;

	waitForInterrupt = false;

	retaddr = PC;
	// push return address onto the stack
	// push PC onto the stack - push the MSB first
	_vm->WriteData(0x100 + SP--, retaddr >> 8);
	cycles++;

	_vm->WriteData(0x100 + SP--, retaddr & 0xFF);
	cycles++;

	// push processor status onto the stack
	flags.bits.B = false;
	flags.bits.R = 1;
	_vm->WriteData(0x100 + SP--, flags.reg);

	// set flags
	flags.bits.B = 0;
	flags.bits.I = 1;
	flags.bits.D = 0;

	// jump to the IRQ address

	lsb = _vm->ReadData(0xFFFA);
	msb = _vm->ReadData(0xFFFB);

	// jump address
	addr = msb << 8 | lsb;

	PC = addr;
	cycles++;

	return 7;
}

uint8_t CPU::RTI(uint8_t opCode)
{
	uint8_t cycles = 0;
	uint8_t lsb = 0;
	uint8_t msb = 0;
	uint16_t addr = 0;

	PC++;
	
	// pull the status register
	flags.reg = _vm->ReadData(++SP + 0x100);

	// clear the B flag
	flags.bits.B = 0;

	// pull the return address
	lsb = _vm->ReadData(++SP + 0x100);
	msb = _vm->ReadData(++SP + 0x100);

	addr = msb << 8 | lsb;
	PC = addr;
	
	return 6;
}