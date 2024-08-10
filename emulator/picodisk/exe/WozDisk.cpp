#include "WozDisk.h"
#include <stdlib.h>
#include <cstring>
#include "Console.h"

extern Console * _console;

char buf[255];

WozDisk::WozDisk()
{
	srand(*(unsigned int *)this);
	// make _trackPosition random and set the _toothPosition accordingly
	_trackPosition = rand() % 159;
	_toothPosition = _trackPosition % 4;
}

void 
__not_in_flash_func(WozDisk::SetId)(uint8_t id)
{
	_id = id;
}

void 
__not_in_flash_func(WozDisk::AddCycles)(uint32_t cycles)
{
	_cycles += cycles;

	if (_pendingRotation > 0)
	{
		_pendingRotation -= cycles;		

		if (_pendingRotation <= 0)
		{
			DoRotation();
			_pendingRotation = 0;
		}
	}	
}

inline
uint8_t 
__not_in_flash_func(WozDisk::ToothBefore)()
{
	return (_toothPosition + 7) % 8;
}

inline
uint8_t 
__not_in_flash_func(WozDisk::ToothAfter)()
{
	return (_toothPosition + 1) % 8;
}

inline
void 
__not_in_flash_func(WozDisk::UpdateMagneticField)()
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
	_pendingRotation = 1000;
}

inline
int8_t 
__not_in_flash_func(WozDisk::UpdateWheel)()
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

void 
__not_in_flash_func(WozDisk::PhaseOn)(uint8_t iPhase)
{
	if (_phase[iPhase])
	{
		return;
	}

	_phase[iPhase] = true;
	UpdateMagneticField();
}

void 
__not_in_flash_func(WozDisk::PhaseOff)(uint8_t iPhase)
{
	if (!_phase[iPhase])
	{
		return;
	}

	_phase[iPhase] = false;
	UpdateMagneticField();
}

inline
void
__not_in_flash_func(WozDisk::DoRotation)()
{
		int8_t move = 0;

		move = UpdateWheel();

#if 0
    	uint8_t tb = _toothPosition;
	sprintf(buf, "%d,%d,%d,%d [%d,%d,%d,%d,%d,%d,%d,%d] %d->%d\r\n", 
		_phase[0], _phase[1], _phase[2], _phase[3],
		_magneticField[0], _magneticField[1], _magneticField[2], _magneticField[3],
		_magneticField[4], _magneticField[5], _magneticField[6], _magneticField[7],
		tb, _toothPosition);
	_console->PrintOut(buf);
	//OutputDebugStringA(buf);
#endif
	if (move != 0)
	{
		MoveTrackPosition(move);
	}

}

inline
int8_t 
__not_in_flash_func(WozDisk::MoveTrackPosition)(int iDiff)
{
	int8_t moved = 0;
    int16_t prevPosition = _trackPosition;

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

	moved = _trackPosition - prevPosition;

	if (_WozFile.IsFileLoaded())
	{
		_lastTrackCycle = _cycles;
		_WozFile.SetTrack(_trackPosition);
	}

	return moved;
}

bool 
__not_in_flash_func(WozDisk::GetWriteProtect)()
{
	InfoChunkData *pData = _WozFile.GetInfoChunkData();
	if (pData)
	{
		return pData->WriteProtected;
	}

	return false;
}

void 
__not_in_flash_func(WozDisk::SetSpinning)(bool spinning)
{
	//_console->PrintOut("Drive %d: Spinning: %d\n", _id, spinning);

	_spinning = spinning;

	if (spinning)
	{
		_lastShiftCycle = 0;
	}
}

bool 
__not_in_flash_func(WozDisk::InsertDisk)(const char* filename)
{
	_WozFile.CloseFile();
	_trackPosition = (rand() % 158) + 1;

	if (_WozFile.OpenFile(filename) == END_OF_WOZFILE)
	{
		_lastTrackCycle = _cycles;
		_WozFile.SetTrack(_trackPosition);
		return true;
	}

	return false;
}

void 
__not_in_flash_func(WozDisk::RemoveDisk)()
{
	_WozFile.CloseFile();
}

bool 
__not_in_flash_func(WozDisk::IsDiskPresent)()
{
	return _WozFile.IsFileLoaded();
}

WozFile * 
__not_in_flash_func(WozDisk::GetFile)()
{
	return &_WozFile;
}
