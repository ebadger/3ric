#pragma once
#include "vm.h"

class VM;

class ACIA
{
public:
	ACIA(VM *pVM);

	uint8_t ReadData(uint16_t address);
	void    WriteData(uint16_t address, uint8_t data);

	bool Receive(uint8_t byte);

private:

	uint8_t _regTransfer = 0;
	uint8_t _regStatus = 0x10;
	uint8_t _regControl = 0;
	uint8_t _regCommand = 0;

	VM* _vm = nullptr;
};