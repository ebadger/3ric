#include "windows.h"

#include "vm.h"
#include "badgervmpal.h"
#include <wchar.h>
#include <fstream>
#include <sys/stat.h>
#include <string>

using namespace std;

/*
;0x0000 0xCFFF RAM 52KB
;0xC000 0xC0FF Devices
;0xC100 0xE2FF Basic ROM
;0xE300 0xFFFF OS
*/

VM::VM()
{
	Init();
}

VM::VM(bool bTestMode)
{
	_testmode = bTestMode;
	Init();
}

VM::~VM()
{
	delete _cpu;
	pal_freeromdisk(&_romdisk);
}

void VM::Init()
{
	_cpu = new CPU(this);
	_acia = new ACIA(this);
	_via1 = new VIA(this);
	_via2 = new VIA(this);
	_pPS2 = new PS2Keyboard(this);
	srand(*(unsigned int*)(void*)this);

	// fill data with garbage
	for (int i = 0; i < _pal_countof(_data); i++)
	{
		_data[i] =  (rand() * 255) & 0xFF;
	}

	pal_initromdisk(&_romdisk);
}

void VM::Reset()
{
	_basicbank = false;

	_bank_read = false;
	_bank_write = false;
	_bank_page1 = false;
	_bank_ff = false;

	_graphics = false;
	_page2 = false;
	_mixed = false;
	_lores = false;

	_cpu->Reset();
	_pPS2->Reset();
	_via1->Reset();
	_via2->Reset();
}

void VM::Run()
{
	_cpu->Reset();
	_cpu->Run();
}

PS2Keyboard* VM::GetPS2Keyboard()
{
	return _pPS2;
}

DriveEmulator* VM::GetDriveEmulator()
{
	return &_driveEmulator;
}

CPU* VM::GetCPU()
{
	return _cpu;
}

VIA* VM::GetVIA1()
{
	return _via1;
}

VIA* VM::GetVIA2()
{
	return _via2;
}

void VM::SetTestMode(bool mode)
{
	_testmode = mode;
}

uint8_t VM::DoDisk(uint16_t address, uint8_t data, bool write)
{
	if (false == write)
	{
		return _driveEmulator.Read(address & 0xF);
	}
	
	_driveEmulator.Write(address & 0xF, data);
	return 0;
}

void VM::DoSoftSwitches(uint16_t address, bool write)
{
	switch (address)
	{
	case MM_SS_KEYBD_STROBE:
		_via1->SignalPin(VIA::CB1);
		break;

	case MM_SS_JOYSTICK:
		_via1->SignalPin(VIA::CB2);
		break;

	case MM_SS_GRAPHICS:
		_graphics = true;
		break;

	case MM_SS_TEXT:
		_graphics = false;
		break;

	case MM_SS_DISPLAY1:
		_page2 = false;
		break;

	case MM_SS_DISPLAY2:
		_page2 = true;
		break;

	case MM_SS_FULLSCREEN:
		_mixed = false;
		break;

	case MM_SS_SPLITSCREEN:
		_mixed = true;
		break;

	case MM_SS_HIRES:
		_lores = false;
		break;

	case MM_SS_LORES:
		_lores = true;
		break;

		// memory banking
/*
	bool _bank_read_page2 = false;
	bool _bank_write_page2 = false;
	bool _bank_read_page1 = false;
	bool _bank_write_page2 = false;
*/
	case MM_SS_R_BANK2:
	case MM_SS_R_BANK2_2:
		_bank_page1 = false;
		_bank_read = true;
		_bank_write = false;
		_bank_ff = false;
		break;

	case MM_SS_W_BANK2:	
	case MM_SS_W_BANK2_2:
		_bank_page1 = false;
		_bank_read = false;
		if (!_bank_ff)
		{
			_bank_write = true;
		}
		_bank_ff = true;

		break;

	case MM_SS_R_ROM2:
	case MM_SS_R_ROM2_2:
	case MM_SS_R_ROM1:
	case MM_SS_R_ROM1_2:
		_bank_read = false;
		_bank_write = false;
		_bank_ff = false;
		break;

	case MM_SS_RW_BANK2:
	case MM_SS_RW_BANK2_2:
		_bank_page1 = false;
		_bank_read = true;
		if (_bank_ff)
		{
			_bank_write = true;
		}
		_bank_ff = true;

		break;

	case MM_SS_R_BANK1:
	case MM_SS_R_BANK1_2:
		_bank_page1 = true;
		_bank_read = true;
		_bank_write = false;
		_bank_ff = false;
		break;

	case MM_SS_W_BANK1:
	case MM_SS_W_BANK1_2:
		_bank_page1 = true;
		_bank_read = false;
		if (_bank_ff)
		{
			_bank_write = true;
		}
		_bank_ff = true;	

		break;

	case MM_SS_RW_BANK1:
	case MM_SS_RW_BANK1_2:
		_bank_page1 = true;
		if (_bank_ff)
		{
			_bank_write = true;
		}
		_bank_ff = true;
		_bank_read = true;
		break;
	
	case MM_SS_BASIC_ROM_OFF:
		_basicbank = false;

		break;
	case MM_SS_BASIC_ROM_ON:
		_basicbank = true;
		break;

	default:
		return;
	}

	if (address >= MM_SS_START && address <= MM_SS_END_LOW)
	{
		if (CallbackSetSoftSwitches)
		{
			if (address != 0xC070) // skip joystick for now
			{
				CallbackSetSoftSwitches(_graphics, _page2, _mixed, _lores);
			}
		}
	}
}

uint8_t VM::ReadData(uint16_t address)
{
	if (CallbackReadMemory)
	{
		CallbackReadMemory(address);
	}

    if (address >= MM_RAM_START && address <= MM_RAM_END)
	{
		// RAM
		return _data[address];
	}
	else if (address >= MM_RAM2_START && address <= MM_RAM2_END)
	{
		return _data[address];
	}
	else if (address == MM_SS_KEYBOARD)
	{
		return _data[address];
	}
	else if (address >= MM_SS_DISK_START && address <= MM_SS_DISK_END)
	{
		return DoDisk(address, 0, false);
	}
	else if (address >= MM_SS_START && address <= MM_SS_END)
	{
		DoSoftSwitches(address, false);
		return _data[address];
	}
	else if (address >= MM_ACIA_START && address <= MM_ACIA_END)
	{
		// ACIA
		return _acia->ReadData(address);
	}
	else if (address >= MM_VIA1_START && address <= MM_VIA1_END)
	{
		// VIA1
		return _via1->ReadRegister(address & 0xF);
	}
	else if (address >= MM_ROMDISK_START && address <= MM_ROMDISK_END)
	{
		uint32_t addr = (_romdiskBank & 3) << 16 | _romdiskHigh << 8 | _romdiskLow;
		return _romdisk[addr];
	}
	else if (address >= MM_DISKROM_START && address <= MM_DISKROM_END)
	{
		return _data[address];
	}
	else if (address >= MM_DEVICES_START && address <= MM_DEVICES_END)
	{
		// unimplemented devices
		return _data[address];
	}
	else if (address >= MM_ROM_START && address <= MM_ROM_END)
	{
		if (_bank_read) // read RAM
		{
			if (address >= 0xD000 && address < 0xE000)
			{
				if (_bank_page1)
				{
					return _bank1_d000[address - 0xD000];
				}
				else
				{
					return _bank2_d000[address - 0xD000];
				}
			}
			else if (address >= 0xE000 && address <= 0xFFFF)
			{
				return _bank_e000[address - 0xE000];
			}
		}
		else
		{
			return _data[address];
		}
	}
	else if (address >= MM_BASIC_START && address <= MM_BASIC_END)
	{
		if (_basicbank)
		{
			return _basic[address - MM_BASIC_START];
		}
		else
		{
			return _data[address];
		}
	}
	else
	{
		pal_debugbreak();
	}

	return 0;
	// ROM
}

void VM::WriteData(uint16_t address, uint8_t byte)
{
	std::string filename = "";


	if (address >= MM_RAM_START && address <= MM_RAM_END
		|| address >= MM_RAM2_START && address <= MM_RAM2_END
		|| (_basicbank == false 
			&& address >= MM_BASIC_START && address <= MM_BASIC_END)
	)
	{
		// RAM
		_data[address] = byte;

		if (address >= 0x2000 && address < 0x4000)
		{
			if (CallbackHires1)
			{
				CallbackHires1(address - 0x2000, byte);
			}
		}
		else if (address >= 0x4000  && address < 0x6000)
		{
			if (CallbackHires2)
			{
				CallbackHires2(address - 0x4000, byte);
			}
		}
		else if (address >= 0x1F00 && address < 0x1F50) // high score
		{
#if 0
			if (CallbackHighScore)
			{
				CallbackHighScore((address - 0x1F00), byte);
			}
#endif
		}
		else if (address >= 0x400 && address <= 0x7FF)
		{
			if (CallbackText1)
			{
				CallbackText1(address - 0x400, byte);
			}
		}
		else if (address >= 0x800 && address <= 0xBFF)
		{
			if (CallbackText2)
			{
				CallbackText2(address - 0x800, byte);
			}
		}
	}
	else if (address == MM_SS_KEYBOARD)
	{
		_data[address] = byte;
	}
	else if (address >= MM_ROM_START && address <= MM_ROM_END)
	{
		// ROM
		if (_testmode)
		{
			_data[address] = byte;
		}
		
		if (_bank_write)
		{
			if (address >= 0xD000 && address < 0xE000)
			{
				if (_bank_page1)
				{
					_bank1_d000[address - 0xD000] = byte;
				}
				else
				{
					_bank2_d000[address - 0xD000] = byte;
				}
			}
			else if (address >= 0xE000 && address <= 0xFFFF)
			{
				_bank_e000[address - 0xE000] = byte;
			}
		}
	}
	else if (address >= MM_BASIC_START && address <= MM_BASIC_END)
	{
		if (_testmode || !_basicbank)
		{
			_data[address] = byte;
		}
	}
	else if (address >= MM_SS_DISK_START && address <= MM_SS_DISK_END)
	{
		DoDisk(address, byte, true);
	}
	else if (address >= MM_SS_START && address <= MM_SS_END)
	{
		DoSoftSwitches(address, true);
		_data[address] = byte;
	}
	else if (address >= MM_ACIA_START && address <= MM_ACIA_END)
	{
		// ACIA
		_acia->WriteData(address, byte);
	}
	else if (address >= MM_VIA1_START && address <= MM_VIA1_END)
	{
		// VIA1
		_via1->WriteRegister(address & 0xF, byte);
	}
	else if (address >= MM_ROMDISK_START && address <= MM_ROMDISK_END)
	{
		switch (address & 0xF)
		{
		case 0:
			_romdiskLow = byte;
			break;
		case 1:
			_romdiskHigh = byte;
			break;
		case 2:
			_romdiskBank = byte & 3;
			break;
		case 3:
		case 7:
		case 15:
			if (CallbackSetMode)
			{
				CallbackSetMode(byte);
			}
			break;
		}

	}
#if 0
	else if (address >= MM_AUDIO_START && address <= MM_AUDIO_END)
	{
		switch(address & 0xF)
		{
			case 0:
				_duration = byte;
				break;
			case 1:
				_pitch = byte;
				break;
			case 3:
				if (CallbackAudio)
				{
					CallbackAudio(_duration, _pitch);
				}
				break;
		}
	}
	else if (address >= MM_FILE_START && address <= MM_FILE_END)
	{
		std::vector<uint8_t> bytes;
		uint16_t start = 0;
		uint16_t end = 0;

/*
	PET 2001 ROM 2.0 ("new ROM")

	TXTTAB  0028-0029      40-41     Pointer: Start of BASIC Text
	VARTAB  002A-002B      42-43     Pointer: Start of BASIC Variables
	ARYTAB  002C-002D      44-45     Pointer: Start of BASIC Arrays
	STREND  002E-002F      46-47     Pointer: End of BASIC Arrays (+1)
	FRETOP  0030-0031      48-49     Pointer: Bottom of String Storage
	FRESPC  0032-0033      50-51     Utility String Pointer
	MEMSIZ  0034-0035      52-52     Pointer: Highest Address Used by BASIC
*/

		switch (address & 0xF)
		{
			case 0: // save
				GetFileName(filename);

				// populate bytes vector with data to write
				// $28, $29 = first address of basic program
				// $2A, $2B   end address of basic program

				for (uint16_t i = 0x28; i < 0x36; i++)
				{
					bytes.push_back(_data[i]);
				}

				start = _data[0x28] | (_data[0x29] << 8);
				end = _data[0x2E] | (_data[0x2F] << 8);

				for (uint16_t i = start; i < end; i++)
				{
					bytes.push_back(_data[i]);
				}

				CallbackSaveFile(filename, bytes, _result);
				// write the code into memory

				break;
			case 1: // load

				GetFileName(filename);
				CallbackLoadFile(filename, bytes, _result);
				// write the code into memory
				// write vector of bytes into memory starting at 0x1001
				
				start = 0x1001;
				end = start + (uint16_t)bytes.size();

				uint8_t offset = 0;

				for (uint8_t b : bytes)
				{
					if (offset > 13)
					{
						_data[start++] = b;
					}
					else
					{
						_data[0x28 + offset] = b;
						offset++;
					}
				}

				break;
		}
	}
#endif
	else if (address >= MM_DEVICES_START && address <= MM_DEVICES_END)
	{
		// unimplemented devices
	}
	else
	{
		pal_debugbreak();
	}

	if (CallbackWriteMemory)
	{
		CallbackWriteMemory(address, byte);
	}

}


bool VM::SimulateSerialKey(uint8_t byte)
{
	return _acia->Receive(byte);
}

bool VM::LoadBinaryFile(const char* szFileName)
{
	return pal_loadbinary(szFileName, _data);
}


bool VM::LoadBinaryFile(const char* szFileName, uint16_t offset)
{
	struct stat results = { 0 };
	int max_read = 0x10000;

	if (stat(szFileName, &results) == 0)
	{
		ifstream data(szFileName, ios::in | ios::binary);
	
		if (max_read > results.st_size)
		{
			max_read = results.st_size;
		}

		if (offset + max_read > 0x10000)
		{
			data.close();
			return false;
		}

		data.read((char *)&_data[offset], max_read);
		data.close();

		return true;
	}
	
	return false;
}


bool VM::LoadRomDiskFile(const char* szFileName)
{
	return pal_loadromdisk(szFileName, _romdisk);
}

bool VM::OffsetFromAddress(uint16_t address, uint32_t &offset)
{
	if (_mapAddressToOffset.find(address) == _mapAddressToOffset.end())
	{
		return false;
	}

	offset = _mapAddressToOffset[address];
	return true;
}

uint32_t VM::GetLineFromAddress(uint16_t address)
{
	return _mapAddressToLine[address];
}

uint32_t VM::GetOffsetFromLine(uint32_t line)
{
	return _mapLineToOffset[line];
}

uint8_t * VM::GetData()
{
	return (uint8_t *)_data;
}

uint8_t * VM::GetRomDisk()
{
	return (uint8_t *)_romdisk;
}

uint8_t* VM::GetBasicRom()
{
	return (uint8_t*)_basic;
}

#if defined(PLATFORM_WINDOWS)
wstring VM::Disassemble()
{
	uint32_t offset = 0;
	uint32_t linenum = 0;
	wstring str = L"";
	wchar_t line[255];
	uint32_t address = 0;
	//uint8_t bytes = 0;
	//uint8_t cycles = 0;
	uint8_t opCode = 0;
	uint16_t tempaddr;
	uint32_t size = 0;

	uint8_t lsb;
	uint8_t msb;
	uint16_t data;
	uint16_t data2;

	while (address < 0xFFFF)
	{
		opCode = _data[address];
		InstructionInfo ii = _cpu->Instruction[opCode];
		//_cpu->GetInstructionInfo(opCode, address, &bytes, &cycles);
		SymbolT* pSym = nullptr;
		wstring label;

		size = 0;

		if (DebugSymbols::AddressToSymbol(address, "lab", label, L"$%04X", address, size))
		{
			_mapLineToOffset[linenum] = (uint32_t)str.length();
			str += (label + L":\r");
			linenum++;
		}
		
		label = L"";

		_mapAddressToOffset[address] = (uint32_t)str.length();
		_mapLineToOffset[linenum] = (uint32_t)str.length();
		_mapAddressToLine[address] = linenum++;

		if (strlen(ii.tag) == 0)
		{
			tempaddr = address++;
			data = _data[tempaddr];
			swprintf_s(line, _countof(line), L"\t$%04X $%02X          .byte $%02X\r", tempaddr, opCode, data);
		}
		else
		{
			switch (ii.mode)
			{
			case AddressingMode::Absolute:
				tempaddr = address++;
				lsb = _data[address++];
				msb = _data[address++];
				data = lsb | msb << 8;

				DebugSymbols::AddressToSymbol(data, nullptr, label, L"$%04X", data, size);
				swprintf_s(line, _countof(line), L"\t$%04X $%02X $%02X $%02X %5S %s\r", tempaddr, opCode, lsb, msb, ii.tag, label.c_str());

				break;

			case AddressingMode::Absolute_Indexed_X:
				tempaddr = address++;
				lsb = _data[address++];
				msb = _data[address++];
				data = lsb | msb << 8;

				DebugSymbols::AddressToSymbol(data, nullptr, label, L"$%04X", data, size);
				swprintf_s(line, _countof(line), L"\t$%04X $%02X $%02X $%02X %5S %s,X\r", tempaddr, opCode, lsb, msb, ii.tag, label.c_str());
				break;

			case AddressingMode::Absolute_Indexed_Y:
				tempaddr = address++;
				lsb = _data[address++];
				msb = _data[address++];
				data = lsb | msb << 8;

				DebugSymbols::AddressToSymbol(data, nullptr, label, L"$%04X", data, size);
				swprintf_s(line, _countof(line), L"\t$%04X $%02X $%02X $%02X %5S %s,Y\r", tempaddr, opCode, lsb, msb, ii.tag, label.c_str());
				break;

			case AddressingMode::ZeroPage_Indirect:
				tempaddr = address++;
				data = _data[address++];

				DebugSymbols::AddressToSymbol(data, nullptr, label, L"$%02X", data, size);
				swprintf_s(line, _countof(line), L"\t$%04X $%02X $%02X     %5S (%s)\r", tempaddr, opCode, data, ii.tag, label.c_str());
				break;

			case AddressingMode::ZeroPage:
				tempaddr = address++;
				data = _data[address++];

				DebugSymbols::AddressToSymbol(data, nullptr, label, L"$%02X", data, size);
				swprintf_s(line, _countof(line), L"\t$%04X $%02X $%02X     %5S %s\r", tempaddr, opCode, data, ii.tag, label.c_str());
				break;

			case AddressingMode::ZeroPage_Indexed_With_X:
				tempaddr = address++;
				data = _data[address++];

				DebugSymbols::AddressToSymbol(data, nullptr, label, L"$%02X", data, size);
				swprintf_s(line, _countof(line), L"\t$%04X $%02X $%02X     %5S %s,X\r", tempaddr, opCode, data, ii.tag, label.c_str());
				break;

			case AddressingMode::ZeroPage_Indexed_With_Y:
				tempaddr = address++;
				data = _data[address++];

				DebugSymbols::AddressToSymbol(data, nullptr, label, L"$%02X", data, size);
				swprintf_s(line, _countof(line), L"\t$%04X $%02X $%02X     %5S %s,Y\r", tempaddr, opCode, data, ii.tag, label.c_str());
				break;

			case AddressingMode::ZeroPage_Indexed_Indirect_With_X:
				tempaddr = address++;
				data = _data[address++];

				DebugSymbols::AddressToSymbol(data, nullptr, label, L"$%02X", data, size);
				swprintf_s(line, _countof(line), L"\t$%04X $%02X $%02X     %5S (%s,X)\r", tempaddr, opCode, data, ii.tag, label.c_str());
				break;

			case AddressingMode::ZeroPage_Indirect_Indexed_With_Y:
				tempaddr = address++;
				data = _data[address++];

				DebugSymbols::AddressToSymbol(data, nullptr, label, L"$%02X", data, size);
				swprintf_s(line, _countof(line), L"\t$%04X $%02X $%02X     %5S (%s),Y\r", tempaddr, opCode, data, ii.tag, label.c_str());
				break;

			case AddressingMode::Absolute_Indirect:
				tempaddr = address++;
				lsb = _data[address++];
				msb = _data[address++];
				data = lsb | msb << 8;

				DebugSymbols::AddressToSymbol(data, nullptr, label, L"$%04X", data, size);
				swprintf_s(line, _countof(line), L"\t$%04X $%02X $%02X $%02X %5S (%s)\r", tempaddr, opCode, lsb, msb, ii.tag, label.c_str());
				break;

			case AddressingMode::Absolute_Indexed_Indirect_With_X:
				tempaddr = address++;
				lsb = _data[address++];
				msb = _data[address++];
				data = lsb | msb << 8;

				DebugSymbols::AddressToSymbol(data, nullptr, label, L"$%04X", data, size);
				swprintf_s(line, _countof(line), L"\t$%04X $%02X $%02X $%02X %5S (%s,X)\r", tempaddr, opCode, lsb, msb, ii.tag, label.c_str());
				break;

			case AddressingMode::Accumulator:
			case AddressingMode::Implied:
			case AddressingMode::Stack:
				tempaddr = address++;
				swprintf_s(line, _countof(line), L"\t$%04X $%02X         %5S\r", tempaddr, opCode, ii.tag);

				break;
			case AddressingMode::PC_Relative:
				tempaddr = address++;
				data = _data[address++];

				msb = address >> 8;
				lsb = address & 0xFF;
				lsb += data;

				data2 = msb << 8 | lsb;

				DebugSymbols::AddressToSymbol(data2, nullptr, label, L"$%02X", data2, size);
				swprintf_s(line, _countof(line), L"\t$%04X $%02X $%02X     %5S %s\r", tempaddr, opCode, data, ii.tag, label.c_str());
				break;

			case AddressingMode::Immediate:
				tempaddr = address++;
				data = _data[address++];

				DebugSymbols::AddressToSymbol(data, nullptr, label, L"$%02X", data, size);
				swprintf_s(line, _countof(line), L"\t$%04X $%02X $%02X     %5S #%s\r", tempaddr, opCode, data, ii.tag, label.c_str());
				break;
			default:
				__debugbreak();
			}
		}

		str += line;
	}

	return str;
}

void VM::GetFileName(std::string &filename)
{
	// go look at $200 to parse out the filename
	uint8_t* p = &_data[0x200];
	int q = 0;

	while (*(p++))
	{
		if (*p == '\"')
		{
			q++;
		}
		else if (q == 2)
		{
			break;
		}
		else if (q > 0)
		{
			filename += (char) *p;
		}
	}
}

#endif