#include "acia.h"
#include "stdio.h"

ACIA::ACIA(VM *vm)
{
	_vm = vm;
}

/*

Status Register

7   6    5    4    3    2    1  0
IRQ DSRB DCDB TDRE RDRF OVRN FE PE

Bit 7 Interrupt (IRQ)
  0 No Interrupt
  1 Interrupt has occurred
Bit 6 Data Set Ready (DSRB)
  0 DSR low (ready)
  1 DSR high (not ready)
Bit 5 Data Carrier Detect (DCDB)
  0 DCD low (detected)
  1 DCD high (not detected)
Bit 4 Transmitter Data Register Empty*
  0 Never 0 During transmission
  1 Empty
Bit 3 Receiver Data Register Full
  0 Not full
  1 Full
Bit 2 Overrun
  0 No overrun
  1 Overrun has occurred
Bit 1 Framing Error
  0 No framing error
  1 Framing error detected
Bit 0 Parity Error
  0 No parity error
  1 Parity error detected
*/

uint8_t ACIA::ReadData(uint16_t address)
{
	// acia only uses 3 address bits
	uint8_t reg = address & 0x3;
	uint8_t ret = 0;

	switch(reg)
	{
		case 0:
			//clear the rx full bit,
			_regStatus &= 0xF7;
			// set tx bit
			_regStatus &= 0x10;
			ret = _regTransfer;
			_regTransfer = 0;
			return ret;
			break;
		case 1:
			// clear the IRQ bit
			_regStatus &= 0x7F;
			return _regStatus;
			break;
		case 2:
			return _regCommand;
			break;
		case 3:
			return _regControl;
			break;
	}

	return 0;
}

void ACIA::WriteData(uint16_t address, uint8_t data)
{
	uint8_t reg = address & 0x3;

	switch (reg)
	{
	case 0:
		_vm->CallbackReceiveChar(data);
		_regTransfer = 0;
		_regStatus |= 0x10; // ready for transmit
		break;
	case 1:
		_regStatus = data | 0x10;  // ready for transmit
	
		break;
	case 2:
		_regCommand = data;
		break;
	case 3:
		_regControl  = data;
		break;
	}
}

bool ACIA::Receive(uint8_t byte)
{
	if (_regStatus & 0x80 || _vm->GetCPU()->flags.bits.I == 1)
	{
		return false;
	}

	_regStatus |= 0x88; // flip on interrupt bit and flip on receive full bit
	_regTransfer = byte;

	_vm->GetCPU()->MaskableInterrupt(false);  // fire an interrupt	
	return true;
}