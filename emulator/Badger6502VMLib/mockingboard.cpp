#include "mockingboard.h"

#include <utility>

Mockingboard::Mockingboard()
{
	Reset();
}

void Mockingboard::Reset()
{
	for (size_t channel = 0; channel < CHANNEL_COUNT; ++channel)
	{
		_via[channel].Reset();
		_ay[channel].Reset();
		_resetAsserted[channel] = false;
		_ayBusMode[channel] = 0;
	}
}

size_t Mockingboard::ChannelForAddress(uint16_t address) const
{
	return (address & 0x80) != 0 ? 1 : 0;
}

void Mockingboard::RefreshAYReadBus(size_t channel)
{
	const uint8_t control = _via[channel].GetPortBOutput() & 0x07;
	if ((control & 0x04) && (control & 0x03) == 0x01)
	{
		_via[channel].SetPortAInput(_ay[channel].ReadData());
	}
	else
	{
		_via[channel].SetPortAInput(0xFF);
	}
}

void Mockingboard::SyncAYBus(size_t channel)
{
	const uint8_t control = _via[channel].GetPortBOutput() & 0x07;
	if ((control & 0x04) == 0)
	{
		if (!_resetAsserted[channel])
		{
			_ay[channel].Reset();
		}
		_resetAsserted[channel] = true;
		_ayBusMode[channel] = 0;
		_via[channel].SetPortAInput(0xFF);
		return;
	}

	const bool wasResetAsserted = _resetAsserted[channel];
	_resetAsserted[channel] = false;
	const uint8_t mode = control & 0x03;
	if (!wasResetAsserted && _ayBusMode[channel] == 0x03 && (mode & 0x02) == 0)
	{
		_ay[channel].SetAddress(_via[channel].GetPortAOutput());
	}
	else if (!wasResetAsserted && _ayBusMode[channel] == 0x02 && (mode & 0x02) == 0)
	{
		_ay[channel].WriteData(_via[channel].GetPortAOutput());
	}
	_ayBusMode[channel] = mode;
	RefreshAYReadBus(channel);
}

uint8_t Mockingboard::Read(uint16_t address)
{
	const size_t channel = ChannelForAddress(address);
	RefreshAYReadBus(channel);
	return _via[channel].ReadRegister(address & 0x0F);
}

void Mockingboard::Write(uint16_t address, uint8_t data)
{
	const size_t channel = ChannelForAddress(address);
	const uint8_t reg = address & 0x0F;
	_via[channel].WriteRegister(reg, data);
	if (reg == VIA::ORB_IRB || reg == VIA::DDRB)
	{
		SyncAYBus(channel);
	}
}

void Mockingboard::Tick()
{
	for (size_t channel = 0; channel < CHANNEL_COUNT; ++channel)
	{
		_via[channel].Tick();
		if (!_resetAsserted[channel])
		{
			_ay[channel].Tick();
		}
	}
}

bool Mockingboard::IRQAsserted() const
{
	return _via[0].IRQAsserted() || _via[1].IRQAsserted();
}

float Mockingboard::Sample(size_t channel)
{
	return channel < CHANNEL_COUNT ? _ay[channel].Sample() : 0.0f;
}

VIA* Mockingboard::GetVIA(size_t channel)
{
	return channel < CHANNEL_COUNT ? &_via[channel] : nullptr;
}

const AY38910* Mockingboard::GetAY(size_t channel) const
{
	return channel < CHANNEL_COUNT ? &_ay[channel] : nullptr;
}
