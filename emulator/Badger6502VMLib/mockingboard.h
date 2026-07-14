#pragma once

#include "ay38910.h"
#include "via.h"

#include <array>
#include <cstdint>
#include <vector>

class Mockingboard
{
public:
	static constexpr uint32_t VGA_DOT_CLOCK_HZ = 25175000;
	static constexpr uint32_t PHI2_DIVISOR = 16;

	Mockingboard();

	void Reset();
	uint8_t Read(uint16_t address);
	void Write(uint16_t address, uint8_t data);
	void Tick();
	bool IRQAsserted() const;

	bool EnableAudio(uint32_t sampleRate);
	void DisableAudio();
	std::vector<float> DrainAudio();

	VIA* GetVIA(size_t channel);
	const AY38910* GetAY(size_t channel) const;

private:
	static constexpr size_t CHANNEL_COUNT = 2;

	size_t ChannelForAddress(uint16_t address) const;
	void SyncAYBus(size_t channel);
	void RefreshAYReadBus(size_t channel);

	std::array<VIA, CHANNEL_COUNT> _via;
	std::array<AY38910, CHANNEL_COUNT> _ay;
	std::array<bool, CHANNEL_COUNT> _resetAsserted = { false, false };
	std::array<uint8_t, CHANNEL_COUNT> _ayBusMode = { 0, 0 };

	bool _audioEnabled = false;
	uint32_t _sampleRate = 0;
	uint64_t _sampleAccumulator = 0;
	std::vector<float> _audio;
};
