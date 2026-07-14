#include "snesgamepads.h"

#include "via.h"

namespace
{
	constexpr uint8_t LATCH = 0x40;
	constexpr uint8_t CLOCK = 0x80;
	constexpr uint8_t DATA_1 = 0x20;
	constexpr uint8_t DATA_2 = 0x10;
	constexpr uint8_t DATA_MASK = DATA_1 | DATA_2;
}

SNESGamepads::SNESGamepads(VIA& via)
	: _via(via)
{
	Reset();
}

void SNESGamepads::Reset()
{
	_latchedButtons.fill(0);
	_bit = 16;
	const uint8_t portB = _via.GetPortBOutput();
	_latch = (portB & LATCH) != 0;
	_clock = (portB & CLOCK) != 0;
	RefreshDataLines();
}

bool SNESGamepads::SetState(size_t controller, uint16_t pressedButtons)
{
	if (controller >= CONTROLLER_COUNT)
	{
		return false;
	}

	_liveButtons[controller] = pressedButtons & BUTTON_MASK;
	return true;
}

void SNESGamepads::UpdatePortB(uint8_t portB)
{
	const bool latch = (portB & LATCH) != 0;
	const bool clock = (portB & CLOCK) != 0;

	if (latch && !_latch)
	{
		_latchedButtons = _liveButtons;
		_bit = 0;
	}
	else if (!latch && clock && !_clock && _bit < 16)
	{
		++_bit;
	}

	_latch = latch;
	_clock = clock;
	RefreshDataLines();
}

void SNESGamepads::RefreshDataLines()
{
	uint8_t data = DATA_MASK;
	if (_bit < 16)
	{
		if (_latchedButtons[0] & (uint16_t)(1u << _bit))
		{
			data &= (uint8_t)~DATA_1;
		}
		if (_latchedButtons[1] & (uint16_t)(1u << _bit))
		{
			data &= (uint8_t)~DATA_2;
		}
	}
	_via.SetPortBInputBits(DATA_MASK, data);
}
