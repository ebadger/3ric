#pragma once

#include "WozDisk.h"
#include <string>

class DriveEmulator
{
public:
	DriveEmulator();
	~DriveEmulator();

	uint8_t Read(uint8_t address);
	void Write(uint8_t address, uint8_t data);
	void AddCycles(uint32_t cycles);
	WozDisk* GetActiveDisk();

	static bool		_Q6;
	static bool		_Q7;
	static uint8_t	_statusRegister;
	static uint8_t	_shiftRegister;
    static uint8_t  _shiftTemp;

private:
	void StartMotor();
	void StopMotor();
	void UpdateQ(bool Q6, bool Q7);

	WozDisk * GetDisk(uint8_t i);
    WozFile * _activeFile = nullptr;


	WozDisk		_D[2];
	uint8_t		_pendingActiveDisk = 0;
	uint8_t		_activeDisk = 0;

	int32_t		_cycles = 0;
	int32_t     _lastCopy = 0;
    int32_t    _lastShiftCycle = 0;

	uint32_t    _motorStarting = 0;
	uint32_t    _motorStopping = 0;
	bool        _motorRunning = false;

	bool        _byteRead = false;

	std::string _debugString;
};