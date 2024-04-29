#include "WozDisk.h"
#include <stdlib.h>
#include <cstring>

char buf[255];

WozDisk::WozDisk()
{
	srand(*(unsigned int *)this);
	// make _trackPosition random and set the _toothPosition accordingly
	_trackPosition = rand() % 159;
	_toothPosition = _trackPosition % 4;
}

void WozDisk::AddCycles(uint32_t cycles)
{
	_cycles += cycles;
}

uint8_t WozDisk::ToothBefore()
{
	return (_toothPosition + 7) % 8;
}

uint8_t WozDisk::ToothAfter()
{
	return (_toothPosition + 1) % 8;
}

void WozDisk::UpdateMagneticField()
{
	memset(&_magneticField, 0, sizeof(uint8_t) * 8);

	for (int i = 0; i < 4; i++)
	{
		uint8_t i2 = i << 1;
		uint8_t before = (i2 + 7) % 8;
		uint8_t after = (i2 + 1) % 8;

		if (_phase[i])
		{
			_magneticField[i2] = 3;
			_magneticField[before] += 2;
			_magneticField[after] += 2;
		}
	}
}

int8_t WozDisk::UpdateWheel()
{
	int8_t move = 0;

	if (_magneticField[ToothBefore()] == _magneticField[ToothAfter()])
	{
		// stay put
	}
	else if (_magneticField[ToothBefore()] > _magneticField[_toothPosition])
	{
		while (_magneticField[ToothBefore()] > _magneticField[_toothPosition])
		{
			_toothPosition = ToothBefore();
			move--;
		}
	}
	else
	{
		while (_magneticField[ToothAfter()] > _magneticField[_toothPosition])
		{
			_toothPosition = ToothAfter();
			move++;
		}
	}

	return move;
}

void WozDisk::PhaseOn(uint8_t iPhase)
{
	uint8_t tb = _toothPosition;
	int8_t move = 0;

	_phase[iPhase] = true;
	UpdateMagneticField();
	move = UpdateWheel();

	sprintf(buf, "%d,%d,%d,%d [%d,%d,%d,%d,%d,%d,%d,%d] %d->%d\r\n", 
		_phase[0], _phase[1], _phase[2], _phase[3],
		_magneticField[0], _magneticField[1], _magneticField[2], _magneticField[3],
		_magneticField[4], _magneticField[5], _magneticField[6], _magneticField[7],
		tb, _toothPosition);
	//OutputDebugStringA(buf);

	if (move != 0)
	{
		MoveTrackPosition(move);
	}
}

void WozDisk::PhaseOff(uint8_t iPhase)
{
	int8_t move = 0;
	uint8_t tb = _toothPosition;
	_phase[iPhase] = false;
	UpdateMagneticField();
	move = UpdateWheel();

	sprintf(buf, "%d,%d,%d,%d [%d,%d,%d,%d,%d,%d,%d,%d] %d->%d *\r\n",
		_phase[0], _phase[1], _phase[2], _phase[3],
		_magneticField[0], _magneticField[1], _magneticField[2], _magneticField[3],
		_magneticField[4], _magneticField[5], _magneticField[6], _magneticField[7],
		tb, _toothPosition);
	//OutputDebugStringA(buf);

	if (move != 0)
	{
		MoveTrackPosition(move);
	}
}


int8_t WozDisk::MoveTrackPosition(int iDiff)
{
	int8_t moved = 0;

	_trackPosition += iDiff;
	if (_trackPosition > 159)
	{
		_trackPosition = 159;
	}
	else if (_trackPosition < 0)
	{
		_trackPosition = 0;
	}
	else
	{
		moved = iDiff;
	}

	if (_WozFile.IsFileLoaded())
	{
		_WozFile.SetTrack(_trackPosition);
	}

	return moved;
}

bool WozDisk::GetWriteProtect()
{
	InfoChunkData *pData = _WozFile.GetInfoChunkData();
	if (pData)
	{
		return pData->WriteProtected;
	}

	return false;
}

void WozDisk::SetSpinning(bool spinning)
{
	_spinning = spinning;

	if (spinning)
	{
		_lastShiftCycle = 0;
	}
}

uint8_t WozDisk::GetBits(uint8_t &bitCount)
{
	uint8_t bits = 0;

	uint64_t elapsed = _cycles - _lastShiftCycle;

	if (elapsed > ONE_SECOND)
	{
		_lastShiftCycle = _cycles;
	}
	
	while (_cycles - _lastShiftCycle >= SEVEN_MICROSECONDS)
	{
		bitCount++;
		_lastShiftCycle += SEVEN_MICROSECONDS;
		bits <<= 1;
		bits |= _WozFile.GetNextBit() ? 1 : 0;
	}

	return bits;
}

bool WozDisk::InsertDisk(const char* filename)
{
	if (_WozFile.OpenFile(filename) == END_OF_WOZFILE)
	{
		_WozFile.SetTrack(_trackPosition);
		return true;
	}

	return false;
}

void WozDisk::RemoveDisk()
{
	_WozFile.CloseFile();
}

bool WozDisk::IsDiskPresent()
{
	return _WozFile.IsFileLoaded();
}

WozFile * WozDisk::GetFile()
{
	return &_WozFile;
}