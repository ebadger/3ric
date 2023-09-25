#pragma once
#include "vm.h"

class VM;

struct CPU
{
	CPU(VM *vm);
	bool GetInstructionInfo(uint8_t  opCode,
		uint16_t address,
		uint8_t* bytes,
		uint8_t* cycles);
	void Reset();
	void Run();
	void SetOutput(bool fOut);
	void DumpHistory();

	uint8_t Step();
	uint8_t Execute(uint8_t opCode);
	uint8_t ReadByAddressMode(AddressingMode mode, uint8_t& bytes, uint8_t& cycles, uint16_t *outaddr);
	uint8_t WriteByAddressMode(uint8_t data, AddressingMode mode, uint8_t& bytes, uint8_t& cycles);
	// instructions
	uint8_t Load(uint8_t opCode, uint8_t& reg);
	uint8_t Store(uint8_t opCode, uint8_t& reg);
	uint8_t Push(uint8_t opcode, uint8_t reg);
	uint8_t Pull(uint8_t opcode, uint8_t &reg, bool updateflags);
	uint8_t SetOrClearFlag(uint8_t opcode);
	uint8_t SetOrClearBit(uint8_t opCode, uint8_t bit, bool fSet);
	uint8_t IncrementRegister(uint8_t opcode, uint8_t& reg, bool positive);
	uint8_t IncrementMemory(uint8_t opcode, bool positive);
	uint8_t TransferRegister(uint8_t opcode, uint8_t& source, uint8_t& dest, bool updateflags);
	uint8_t CompareRegister(uint8_t opcode, uint8_t& reg);
	uint8_t BranchOnFlag(uint8_t opCode, uint8_t bFlag, bool bIfPositive);
	uint8_t BranchOnBit(uint8_t opCode, uint8_t bit, bool bIfPositive);
	uint8_t MaskableInterrupt(bool fSoftware);
	uint8_t NonMaskableInterrupt();
	uint8_t BRK(uint8_t opcode);
	uint8_t RTI(uint8_t opcode);
	uint8_t ORA(uint8_t opcode);
	uint8_t AND(uint8_t opcode);
	uint8_t EOR(uint8_t opcode);
	uint8_t JSR(uint8_t opcode);
	uint8_t RTS(uint8_t opcode);
	uint8_t ASL(uint8_t opcode);
	uint8_t LSR(uint8_t opcode);
	uint8_t ROL(uint8_t opcode);
	uint8_t ROR(uint8_t opcode);
	uint8_t BIT(uint8_t opcode);
	uint8_t TRB(uint8_t opcode);
	uint8_t TSB(uint8_t opcode);
	uint8_t ADC(uint8_t opcode);
	uint8_t SBC(uint8_t opcode);
	uint8_t STZ(uint8_t opcode);
	uint8_t JMP(uint8_t opcode);

	VM* _vm;

	uint8_t A, X, Y; // registers
	bool waitForInterrupt = false;
	bool _output = false;
	char _debugstring[255];

	union flags
	{
		struct bits
		{
			uint8_t C : 1; // carry 1 = true
			uint8_t Z : 1; // zero  1 = true
			uint8_t I : 1; // irq disable 1 = disable
			uint8_t D : 1; // decimal mode 1 = true
			uint8_t B : 1; // brk 1 = BRK, 0 = IRQB
			uint8_t R : 1; // reserved
			uint8_t V : 1; // overflow 1 = true
			uint8_t N : 1; // negative 1 = negative
		} bits;

		uint8_t reg;
	} flags;

	struct cpu_history
	{
		bool fValid;
		union flags f;
		uint8_t A;
		uint8_t X;
		uint8_t Y;
		uint8_t SP;
		uint16_t PC;
	};

	uint8_t  SP;   // stack pointer
	uint16_t PC;   // program counter
	
	uint8_t  _OpCode; // last OpCode for debugging

	cpu_history _history[0x100];
	uint8_t _historyIndex = 0;

	InstructionInfo Instruction[0x100];
};
