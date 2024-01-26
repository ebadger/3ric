#pragma once
#include "vm.h"

class VIA
{

public:

	enum Register
	{
		ORB_IRB = 0,    // output register "b" / input register "b"
		ORA_IRA = 1,    // output register "a" / input register "a" 
		DDRB = 2,    // data direction register "b"
		DDRA = 3,    // data direction register "a"
		T1CL = 4,    // t1 low order latches / t1 low order counter
		T1CH = 5,    // t1 high order counter
		T1LL = 6,    // t1 low order latches
		T1LH = 7,    // t1 high order latches
		T2CL = 8,    // t2 low order latches / t2 low order counter
		T2CH = 9,    // t2 high order counter
		SR = 10,   // shift register
		ACR = 11,   // auxillary control register
		PCR = 12,   // peripheral control register
		IFR = 13,   // interrupt flag register
		IER = 14,   // interrupt enable register
		ORA_IRA_2 = 15,   // same as reg 1 except no handshake
		MAX_ENUM = 16
	};

	enum Pins
	{
		PA,
		PB,
		CB1,
		CB2,
		CA1,
		CA2
	};

private:
	VM*		 _vm = nullptr;
	uint8_t  _register[MAX_ENUM] = { 0 };

	uint16_t _t1_count = 0;
	uint16_t _t2_count = 0;

public:

	VIA(VM* p);

	void    SignalPin(Pins pin);
	void    WriteRegister(uint8_t reg, uint8_t data);
	uint8_t ReadRegister(uint8_t reg);
	void    Tick();
	void	Reset();
};
