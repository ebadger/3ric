#include "via.h"

#include <cstring>

VIA::VIA(VM*)
{
	Reset();
}

void VIA::Reset()
{
	std::memset(_register, 0, sizeof(_register));
	_t1Latch = 0;
	_t1Counter = 0;
	_t2Latch = 0;
	_t2Counter = 0;
	_t1Running = false;
	_t1Fired = false;
	_t2Running = false;
	_t2Fired = false;
	_pb7Output = true;
	_portAInput = 0xFF;
	_portBInput = 0xFF;
}

bool VIA::IRQAsserted() const
{
	return (_register[IFR] & _register[IER] & 0x7F) != 0;
}

void VIA::Tick()
{
	if (_t1Running)
	{
		if (_t1Counter == 0)
		{
			const bool continuous = (_register[ACR] & 0x40) != 0;
			if (continuous || !_t1Fired)
			{
				_register[IFR] |= IFR_T1;
			}

			if (continuous)
			{
				_t1Counter = _t1Latch;
				if (_register[ACR] & 0x80)
				{
					_pb7Output = !_pb7Output;
				}
			}
			else
			{
				_t1Counter = 0xFFFF;
				if (_register[ACR] & 0x80)
				{
					_pb7Output = true;
				}
				_t1Fired = true;
			}
		}
		else
		{
			--_t1Counter;
		}
	}

	if (_t2Running && (_register[ACR] & 0x20) == 0)
	{
		ClockTimer2();
	}
}

void VIA::ClockTimer2()
{
	if (_t2Counter == 0)
	{
		if (!_t2Fired)
		{
			_register[IFR] |= IFR_T2;
			_t2Fired = true;
		}
		_t2Counter = 0xFFFF;
	}
	else
	{
		--_t2Counter;
	}
}

bool VIA::SignalPin(VIA::Pins pin)
{
	uint8_t flag = 0;
	switch (pin)
	{
	case CA1:
		flag = IFR_CA1;
		break;
	case CA2:
		flag = IFR_CA2;
		break;
	case CB1:
		flag = IFR_CB1;
		break;
	case CB2:
		flag = IFR_CB2;
		break;
	case PA:
	case PB:
		break;
	}
	_register[IFR] |= flag;
	return (_register[IER] & flag) != 0;
}

void VIA::ClearPortAInterrupts(bool handshake)
{
	if (!handshake)
	{
		return;
	}

	_register[IFR] &= (uint8_t)~IFR_CA1;
	const uint8_t ca2Mode = (_register[PCR] >> 1) & 0x07;
	if (ca2Mode != 1 && ca2Mode != 3)
	{
		_register[IFR] &= (uint8_t)~IFR_CA2;
	}
}

void VIA::ClearPortBInterrupts()
{
	_register[IFR] &= (uint8_t)~IFR_CB1;
	const uint8_t cb2Mode = (_register[PCR] >> 5) & 0x07;
	if (cb2Mode != 1 && cb2Mode != 3)
	{
		_register[IFR] &= (uint8_t)~IFR_CB2;
	}
}

uint8_t VIA::ReadPortA() const
{
	return (uint8_t)((_register[ORA_IRA] & _register[DDRA])
		| (_portAInput & (uint8_t)~_register[DDRA]));
}

uint8_t VIA::ReadPortB() const
{
	uint8_t output = _register[ORB_IRB];
	uint8_t outputMask = _register[DDRB];
	if (_register[ACR] & 0x80)
	{
		outputMask |= 0x80;
		if (_pb7Output)
		{
			output |= 0x80;
		}
		else
		{
			output &= 0x7F;
		}
	}
	return (uint8_t)((output & outputMask)
		| (_portBInput & (uint8_t)~outputMask));
}

uint8_t VIA::ReadRegister(uint8_t reg)
{
	reg &= 0x0F;

	switch (reg)
	{
	case IER:
		return _register[IER] | 0x80;

	case IFR:
		return (uint8_t)(_register[IFR] | (IRQAsserted() ? 0x80 : 0x00));

	case ORA_IRA:
		ClearPortAInterrupts(true);
		return ReadPortA();

	case ORA_IRA_2:
		return ReadPortA();

	case ORB_IRB:
		ClearPortBInterrupts();
		return ReadPortB();

	case T1CL:
		_register[IFR] &= (uint8_t)~IFR_T1;
		return (uint8_t)(_t1Counter & 0xFF);

	case T1CH:
		return (uint8_t)(_t1Counter >> 8);

	case T1LL:
		return (uint8_t)(_t1Latch & 0xFF);

	case T1LH:
		return (uint8_t)(_t1Latch >> 8);

	case T2CL:
		_register[IFR] &= (uint8_t)~IFR_T2;
		return (uint8_t)(_t2Counter & 0xFF);

	case T2CH:
		return (uint8_t)(_t2Counter >> 8);

	case SR:
		_register[IFR] &= (uint8_t)~IFR_SR;
		return _register[SR];

	default:
		return _register[reg];
	}
}

void VIA::WriteRegister(uint8_t reg, uint8_t data)
{
	reg &= 0x0F;

	switch (reg)
	{
	case IER:
		if (data & 0x80)
		{
			_register[IER] |= data & 0x7F;
		}
		else
		{
			_register[IER] &= (uint8_t)~data;
		}
		break;

	case IFR:
		_register[IFR] &= (uint8_t)~(data & 0x7F);
		break;

	case ORA_IRA:
		ClearPortAInterrupts(true);
		_register[ORA_IRA] = data;
		_register[ORA_IRA_2] = data;
		break;

	case ORA_IRA_2:
		_register[ORA_IRA] = data;
		_register[ORA_IRA_2] = data;
		break;

	case ORB_IRB:
		ClearPortBInterrupts();
		_register[ORB_IRB] = data;
		break;

	case T1CL:
	case T1LL:
		_t1Latch = (uint16_t)((_t1Latch & 0xFF00) | data);
		_register[T1CL] = data;
		_register[T1LL] = data;
		break;

	case T1CH:
		_t1Latch = (uint16_t)((_t1Latch & 0x00FF) | ((uint16_t)data << 8));
		_t1Counter = _t1Latch;
		_t1Running = true;
		_t1Fired = false;
		_register[IFR] &= (uint8_t)~IFR_T1;
		_register[T1CH] = data;
		_register[T1LH] = data;
		if (_register[ACR] & 0x80)
		{
			_pb7Output = false;
		}
		break;

	case T1LH:
		_t1Latch = (uint16_t)((_t1Latch & 0x00FF) | ((uint16_t)data << 8));
		_register[T1LH] = data;
		_register[IFR] &= (uint8_t)~IFR_T1;
		break;

	case T2CL:
		_t2Latch = (uint16_t)((_t2Latch & 0xFF00) | data);
		_register[T2CL] = data;
		break;

	case T2CH:
		_t2Latch = (uint16_t)((_t2Latch & 0x00FF) | ((uint16_t)data << 8));
		_t2Counter = _t2Latch;
		_t2Running = true;
		_t2Fired = false;
		_register[IFR] &= (uint8_t)~IFR_T2;
		_register[T2CH] = data;
		break;

	case SR:
		_register[SR] = data;
		_register[IFR] &= (uint8_t)~IFR_SR;
		break;

	default:
		_register[reg] = data;
		break;
	}
}

void VIA::SetPortAInput(uint8_t data)
{
	_portAInput = data;
}

void VIA::SetPortAInputBits(uint8_t mask, uint8_t data)
{
	_portAInput = (uint8_t)((_portAInput & (uint8_t)~mask) | (data & mask));
}

void VIA::SetPortBInput(uint8_t data)
{
	const uint8_t previous = _portBInput;
	_portBInput = data;
	if (_t2Running
		&& (_register[ACR] & 0x20)
		&& (_register[DDRB] & 0x40) == 0
		&& (previous & 0x40)
		&& (data & 0x40) == 0)
	{
		ClockTimer2();
	}
}

void VIA::SetPortBInputBits(uint8_t mask, uint8_t data)
{
	SetPortBInput((uint8_t)((_portBInput & (uint8_t)~mask) | (data & mask)));
}

uint8_t VIA::GetPortAOutput() const
{
	return ReadPortA();
}

uint8_t VIA::GetPortBOutput() const
{
	return ReadPortB();
}
