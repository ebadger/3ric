#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

class VIA;

class SNESGamepads
{
public:
	static constexpr size_t CONTROLLER_COUNT = 2;
	static constexpr uint16_t BUTTON_MASK = 0x0FFF;

	explicit SNESGamepads(VIA& via);

	void Reset();
	bool SetState(size_t controller, uint16_t pressedButtons);
	void UpdatePortB(uint8_t portB);

private:
	void RefreshDataLines();

	VIA& _via;
	std::array<uint16_t, CONTROLLER_COUNT> _liveButtons = {};
	std::array<uint16_t, CONTROLLER_COUNT> _latchedButtons = {};
	uint8_t _bit = 16;
	bool _latch = false;
	bool _clock = false;
};
