#pragma once

#include <cstddef>
#include <cstdint>

// Adapted for 3ric from floooh/chips ay38910.h. The original zlib license
// is preserved in ay38910.cpp and NOTICE.
class AY38910
{
public:
	AY38910();

	void Reset();
	void Tick();
	void SetAddress(uint8_t address);
	void WriteData(uint8_t data);
	uint8_t ReadData() const;
	float Sample();

	uint8_t ReadRegister(uint8_t reg) const;

private:
	static constexpr size_t CHANNEL_COUNT = 3;
	static constexpr size_t REGISTER_COUNT = 16;
	static constexpr size_t DC_BUFFER_LENGTH = 512;

	struct Tone
	{
		uint16_t period = 1;
		uint16_t counter = 0;
		uint8_t bit = 0;
		uint8_t toneDisable = 0;
		uint8_t noiseDisable = 0;
	};

	struct Noise
	{
		uint16_t period = 1;
		uint16_t counter = 0;
		uint32_t rng = 1;
		uint8_t bit = 0;
	};

	struct Envelope
	{
		uint16_t period = 1;
		uint16_t counter = 0;
		bool holding = false;
		bool hold = false;
		uint8_t shapeCounter = 0;
		uint8_t shapeState = 0;
	};

	void UpdateValues();
	void RestartEnvelope();
	float RemoveDC(float sample);

	uint8_t _address = 0;
	uint8_t _register[REGISTER_COUNT] = { 0 };
	uint32_t _tick = 0;
	Tone _tone[CHANNEL_COUNT];
	Noise _noise;
	Envelope _envelope;

	float _dcSum = 0.0f;
	size_t _dcPosition = 0;
	float _dcBuffer[DC_BUFFER_LENGTH] = { 0.0f };
};
