#pragma once
#include "vm.h"

#include <vector>

using namespace std;

class PS2Keyboard
{
public:
	struct KeyEvent
	{
		uint8_t bit : 1;
	};

	PS2Keyboard(VM *p);
	void SignalHardwareKey(bool down, uint32_t scancode);
	void ProcessKeys(uint32_t cycle);
	uint8_t TranslateScancode(uint8_t);
	void Reset();

	void ProcessRaw(uint8_t bit);
private:
	VM* _vm = nullptr;
	vector<KeyEvent> _vecBits;
	uint32_t _lastcycle = 0;

private:
	
};