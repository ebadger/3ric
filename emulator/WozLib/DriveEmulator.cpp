#include "DriveEmulator.h"
#include <Windows.h>
#include <debugapi.h>
/*
* https://stackoverflow.com/questions/69369122/apple-iie-6502-assembly-accessing-disk
*
To turn on the drive, access $C0E9. To turn it off, access $C0E8.
The effect of turning off the drive will be delayed by about a second.

To switch to drive 2, access $C0EB. To switch to drive 1, access $C0EA.

To move the head, think of it as being attached to a wheel which is
attached to a hand on a clock face. The hand will point at 12:00 when
the head is at any even numbered, track, and at 6:00 when it is on any
odd numbered track. Reading $C0E1, $C0E3, $C0E5, or $C0E7 will turn on a coil
that pulls the hand toward 12:00, 3:00, 6:00, or 9:00. Accessing the
next lower address will turn off the coil.
Move the head by turning on a coil 90 degrees from the wheel's current position,
waiting awhile, turning that coil off and turning on the next one, etc.

To see if a drive is attached, read $C0EC a few times and see if the value changes.
If not, no drive is attached. If a drive is known to exist, use a two-instruction loop
to read $C0EC until the high bit becomes set. If one a four-cycle instruction
was used for the read, and a two-cycle branch-not-taken once high bit became set
(e.g. wait293: LDX $C0EC / BPL wait293). To ensure that one reads every byte,
ensure that the CPU executes at least 12 and at most 24 cycles before the next time
the sequence is executed. Taking less than 12 cycles may yield duplicate reads.
Taking more than 24 may cause bytes to be skipped.

To start writing data, write any value to $C0ED, then write the first byte
value to $C0EF and immediately read $C0EC (ignore the value written).
One must then execute exactly 24 cycles of other code,
a write of the next byte to $C0ED, an immediate read of $C0EC, etc.
When done, read $C0EE.
*/

DriveEmulator::DriveEmulator()
{
}

DriveEmulator::~DriveEmulator()
{

}

void
DriveEmulator::AddCycles(uint32_t cycles)
{
	_cycles += cycles;
	_D[0].AddCycles(cycles);
	_D[1].AddCycles(cycles);
	
	if (_motorStarting != 0)
	{
		if (_cycles - _motorStarting >= ONE_SECOND)
		{
			_motorStarting = 0;
			_motorRunning = true;
		}

		_activeDisk = _pendingActiveDisk;
	}
	else if (_motorStopping != 0)
	{
		if (_cycles - _motorStopping >= ONE_SECOND)
		{
			_motorStopping = 0;
			_motorRunning = false;
			GetActiveDisk()->SetSpinning(false);
		}
		_activeDisk = _pendingActiveDisk;
	}

	if (_motorRunning)
	{
		// in read mode and the motor is running, shift in bits
		uint8_t bitCount = 0;
		uint8_t bits = GetActiveDisk()->GetBits(bitCount);

		if ((_shiftRegister & 0x80) && bitCount > 0)
		{
#if 0
			char buf[255];
			sprintf_s(buf, _countof(buf), "%02x ", _shiftRegister);
			_debugString.append(buf);
	
			if (_debugString.size() > 64)
			{
				_debugString.append("\r\n");
				OutputDebugStringA(_debugString.c_str());
				_debugString.clear();
			}
#endif

			_shiftRegister = 0;
		}

		if (bitCount > 0)
		{
			_shiftRegister = _shiftRegister << bitCount;
			_shiftRegister |= bits;
		}
	}
}

WozDisk *
DriveEmulator::GetActiveDisk()
{
	return &_D[_activeDisk];
}

WozDisk *
DriveEmulator::GetDisk(uint8_t index)
{
	return &_D[index % 2];
}

uint8_t DriveEmulator::Read(uint8_t address)
{
	switch (address & 0xF)
	{
	case 0x0:	// Phase 0 off
		GetActiveDisk()->PhaseOff(0);
		break;
	case 0x1:	// Phase 0 on  
		GetActiveDisk()->PhaseOn(0);
		break;
	case 0x2:	// Phase 1 off
		GetActiveDisk()->PhaseOff(1);
		break;
	case 0x3:	// Phase 1 on
		GetActiveDisk()->PhaseOn(1);
		break;
	case 0x4:	// Phase 2 off
		GetActiveDisk()->PhaseOff(2);
		break;
	case 0x5:	// Phase 2 on
		GetActiveDisk()->PhaseOn(2);
		break;
	case 0x6:	// Phase 3 off
		GetActiveDisk()->PhaseOff(3);
		break;
	case 0x7:	// Phase 3 on
		GetActiveDisk()->PhaseOn(3);
		break;
	case 0x8:	// Motor off
		_motorStarting = 0;
		_motorStopping = _cycles;
		break;
	case 0x9:	// Motor on
		_motorStopping = 0;
		_motorStarting = _cycles;
		GetActiveDisk()->SetSpinning(true);
		break;
	case 0xA:	// Select drive 1	
		_pendingActiveDisk = 0;
		if (_motorRunning && _activeDisk != _pendingActiveDisk)
		{
			_motorStopping = _cycles;
		}
		break;
	case 0xB:	// Select drive 2
		_pendingActiveDisk = 1;
		if (_motorRunning && _activeDisk != _pendingActiveDisk)
		{
			_motorStopping = _cycles;
		}
		break;
	case 0xC:	// Q6L - Reading this value will return drive bits on the current track
		UpdateQ(false, _Q7);

		if (false == _Q6 && false == _Q7)
		{
			return _shiftRegister;
		}
		break;
	case 0xD:	// Q6H
		UpdateQ(true, _Q7);
		break;
	case 0xE:	// Q7L
		UpdateQ(_Q6, false);
		if (_Q6)
		{
			return _statusRegister;
		}
		break;
	case 0xF:	// Q7H
		UpdateQ(_Q6, true);
		break;
	}

	return 0;
}

void DriveEmulator::Write(uint8_t address, uint8_t data)
{
	switch (address & 0xF)
	{
	case 0x0:	// Phase 0 off
		GetActiveDisk()->PhaseOff(0);
		break;
	case 0x1:	// Phase 0 on  
		GetActiveDisk()->PhaseOn(0);
		break;
	case 0x2:	// Phase 1 off
		GetActiveDisk()->PhaseOff(1);
		break;
	case 0x3:	// Phase 1 on
		GetActiveDisk()->PhaseOn(1);
		break;
	case 0x4:	// Phase 2 off
		GetActiveDisk()->PhaseOff(2);
		break;
	case 0x5:	// Phase 2 on
		GetActiveDisk()->PhaseOn(2);
		break;
	case 0x6:	// Phase 3 off
		GetActiveDisk()->PhaseOff(3);
		break;
	case 0x7:	// Phase 3 on
		GetActiveDisk()->PhaseOn(3);
		break;
	case 0x8:	// Motor off
		_motorStarting = 0;
		_motorStopping = _cycles;
		break;
	case 0x9:	// Motor 
		_motorStopping = 0;
		_motorStarting = _cycles;
		GetActiveDisk()->SetSpinning(true);
		break;
	case 0xA:	// Select drive 1		
		_pendingActiveDisk = 0;
		if (_motorRunning && _activeDisk != _pendingActiveDisk)
		{
			_motorStopping = _cycles;
		}
		break;
	case 0xB:	// Select drive 2
		_pendingActiveDisk = 1;
		if (_motorRunning && _activeDisk != _pendingActiveDisk)
		{
			_motorStopping = _cycles;
		}
		break;
	case 0xC:	// Q6L  Turns off Writing
		UpdateQ(false, _Q7);
		break;
	case 0xD:	// Q6H  Writing a value here turns on writing
		UpdateQ(true, _Q7);
		break;
	case 0xE:	// Q7L  
		UpdateQ(_Q6, false);
		break;
	case 0xF:	// Q7H  Sets the value to write
		UpdateQ(_Q6, true);
		break;
	}
}

void
DriveEmulator::UpdateQ(bool Q6, bool Q7)
{
	if (_Q6 != Q6 || _Q7 != Q7)
	{
		// state changing
		if (!_Q6 && !_Q7)
		{
			// changing into reading state

		}
	}

	if (Q6)
	{
		if (GetActiveDisk()->GetWriteProtect())
		{
			_statusRegister |= 0x80;
		}
		else
		{
			_statusRegister &= 0x7F;
		}

	}
	_Q6 = Q6;
	_Q7 = Q7;
}