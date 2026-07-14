/*
	AY-3-8910 sound generator adapted from floooh/chips ay38910.h at
	commit 9371bfcb8478aec05ad10a1293206363373c1489.

	Changes for 3ric: converted to a C++ class, removed generic pin masks,
	snapshots, and unconnected I/O callbacks, and separated chip ticking from
	host PCM sampling.

	zlib/libpng license

	Copyright (c) 2018 Andre Weissflog
	This software is provided 'as-is', without any express or implied warranty.
	In no event will the authors be held liable for any damages arising from the
	use of this software.
	Permission is granted to anyone to use this software for any purpose,
	including commercial applications, and to alter it and redistribute it
	freely, subject to the following restrictions:
		1. The origin of this software must not be misrepresented; you must not
		claim that you wrote the original software. If you use this software in a
		product, an acknowledgment in the product documentation would be
		appreciated but is not required.
		2. Altered source versions must be plainly marked as such, and must not be
		misrepresented as being the original software.
		3. This notice may not be removed or altered from any source distribution.
*/

#include "ay38910.h"

#include <cstring>

namespace
{
	constexpr uint8_t REGISTER_MASKS[16] = {
		0xFF, 0x0F, 0xFF, 0x0F, 0xFF, 0x0F, 0x1F, 0xFF,
		0x1F, 0x1F, 0x1F, 0xFF, 0xFF, 0x0F, 0xFF, 0xFF
	};

	constexpr float VOLUMES[16] = {
		0.0f,
		0.00999465934234f,
		0.0144502937362f,
		0.0210574502174f,
		0.0307011520562f,
		0.0455481803616f,
		0.0644998855573f,
		0.107362478065f,
		0.126588845655f,
		0.20498970016f,
		0.292210269322f,
		0.372838941024f,
		0.492530708782f,
		0.635324635691f,
		0.805584802014f,
		1.0f
	};

	constexpr uint8_t ENVELOPE_SHAPES[16][32] = {
		{ 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
		{ 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
		{ 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
		{ 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
		{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
		{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
		{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
		{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
		{ 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0 },
		{ 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
		{ 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 },
		{ 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15 },
		{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 },
		{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15 },
		{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0 },
		{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }
	};
}

AY38910::AY38910()
{
	Reset();
}

void AY38910::Reset()
{
	_address = 0;
	std::memset(_register, 0, sizeof(_register));
	_tick = 0;
	for (Tone& tone : _tone)
	{
		tone = Tone{};
	}
	_noise = Noise{};
	_envelope = Envelope{};
	_dcSum = 0.0f;
	_dcPosition = 0;
	std::memset(_dcBuffer, 0, sizeof(_dcBuffer));
	UpdateValues();
	RestartEnvelope();
}

void AY38910::UpdateValues()
{
	for (size_t i = 0; i < CHANNEL_COUNT; ++i)
	{
		Tone& tone = _tone[i];
		tone.period = (uint16_t)(((uint16_t)_register[2 * i + 1] << 8)
			| _register[2 * i]);
		if (tone.period == 0)
		{
			tone.period = 1;
		}
		tone.toneDisable = (_register[7] >> i) & 1;
		tone.noiseDisable = (_register[7] >> (3 + i)) & 1;
	}

	_noise.period = _register[6] & 0x1F;
	if (_noise.period == 0)
	{
		_noise.period = 1;
	}

	_envelope.period = (uint16_t)(((uint16_t)_register[12] << 8) | _register[11]);
	if (_envelope.period == 0)
	{
		_envelope.period = 1;
	}
}

void AY38910::RestartEnvelope()
{
	_envelope.holding = false;
	_envelope.shapeCounter = 0;
	const uint8_t shape = _register[13] & 0x0F;
	_envelope.hold = (shape & 0x08) == 0 || (shape & 0x01) != 0;
	_envelope.shapeState = ENVELOPE_SHAPES[shape][0];
}

void AY38910::Tick()
{
	++_tick;
	if ((_tick & 7) == 0)
	{
		for (Tone& tone : _tone)
		{
			if (++tone.counter >= tone.period)
			{
				tone.counter = 0;
				tone.bit ^= 1;
			}
		}

		if (++_noise.counter >= _noise.period)
		{
			_noise.counter = 0;
			_noise.bit ^= 1;
			if (_noise.bit)
			{
				_noise.rng ^= (((_noise.rng & 1) ^ ((_noise.rng >> 3) & 1)) << 17);
				_noise.rng >>= 1;
			}
		}
	}

	if ((_tick & 15) == 0)
	{
		if (++_envelope.counter >= _envelope.period)
		{
			_envelope.counter = 0;
			if (!_envelope.holding)
			{
				_envelope.shapeCounter = (_envelope.shapeCounter + 1) & 0x1F;
				if (_envelope.hold && _envelope.shapeCounter == 0x1F)
				{
					_envelope.holding = true;
				}
			}
			_envelope.shapeState =
				ENVELOPE_SHAPES[_register[13] & 0x0F][_envelope.shapeCounter];
		}
	}
}

void AY38910::SetAddress(uint8_t address)
{
	_address = address;
}

void AY38910::WriteData(uint8_t data)
{
	if (_address >= REGISTER_COUNT)
	{
		return;
	}

	_register[_address] = data & REGISTER_MASKS[_address];
	UpdateValues();
	if (_address == 13)
	{
		RestartEnvelope();
	}
}

uint8_t AY38910::ReadData() const
{
	if (_address >= REGISTER_COUNT)
	{
		return 0;
	}

	// The 3RIC AY I/O ports are unconnected and therefore read high in input mode.
	if (_address == 14 && (_register[7] & 0x40) == 0)
	{
		return 0xFF;
	}
	if (_address == 15 && (_register[7] & 0x80) == 0)
	{
		return 0xFF;
	}
	return _register[_address];
}

uint8_t AY38910::ReadRegister(uint8_t reg) const
{
	return reg < REGISTER_COUNT ? _register[reg] : 0;
}

float AY38910::RemoveDC(float sample)
{
	_dcSum -= _dcBuffer[_dcPosition];
	_dcSum += sample;
	_dcBuffer[_dcPosition] = sample;
	_dcPosition = (_dcPosition + 1) & (DC_BUFFER_LENGTH - 1);
	return sample - (_dcSum / (float)DC_BUFFER_LENGTH);
}

float AY38910::Sample()
{
	float sample = 0.0f;
	for (size_t i = 0; i < CHANNEL_COUNT; ++i)
	{
		const Tone& tone = _tone[i];
		const uint8_t amplitude = _register[8 + i];
		const float volume = amplitude & 0x10
			? VOLUMES[_envelope.shapeState]
			: VOLUMES[amplitude & 0x0F];
		const bool enabled = (tone.bit || tone.toneDisable)
			&& ((_noise.rng & 1) || tone.noiseDisable);
		if (enabled)
		{
			sample += volume;
		}
	}

	return RemoveDC(sample) * 0.20f;
}
