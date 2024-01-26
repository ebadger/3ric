#pragma once
#include "stdint.h"
#include "opcodes.h"
#include "cpu.h"
#include "acia.h"
#include "via.h"
#include "ps2keyboard.h"
#include <functional>
#include <unordered_map>
#include "badgervmpal.h"

using namespace std;

/*
	0x0000 0xBFFF RAM 48KB
	0xC000 0xC0FF Devices
	0xC100 0xE2FF Basic ROM
	0xE300 0xFFFF OS
*/

enum
{
	MM_RAM_START		= 0x0000,
	MM_RAM_END			= 0x8FFF,
	MM_BASIC_START      = 0x9000,
	MM_BASIC_END        = 0xBFFF,
	MM_VIDEO_START		= 0x2000,
	MM_VIDEO_END		= 0x5FFF,
	MM_DEVICES_START	= 0xC000,
	MM_SS_START         = 0xC000,
	MM_SS_KEYBOARD      = 0xC000,
	MM_SS_BASIC_ROM_ON  = 0xC006,
	MM_SS_BASIC_ROM_OFF = 0xC007,
	MM_SS_KEYBD_STROBE  = 0xC010,
	MM_SS_GRAPHICS      = 0xC050,
	MM_SS_TEXT          = 0xC051,
	MM_SS_FULLSCREEN    = 0xC052,
	MM_SS_SPLITSCREEN   = 0xC053,
	MM_SS_DISPLAY1      = 0xC054,
	MM_SS_DISPLAY2      = 0xC055,
	MM_SS_LORES         = 0xC056,
	MM_SS_HIRES         = 0xC057,
	MM_SS_JOYSTICK      = 0xC070,
	MM_SS_END_LOW       = 0xC07F,
	MM_SS_START_HIGH    = 0xC080,
	MM_SS_R_BANK2       = 0xC080,
	MM_SS_W_BANK2       = 0xC081,
	MM_SS_R_ROM2        = 0xC082,
	MM_SS_RW_BANK2      = 0xC083,
	MM_SS_R_BANK2_2     = 0xC084,
	MM_SS_W_BANK2_2     = 0xC085,
	MM_SS_R_ROM2_2      = 0xC086,
	MM_SS_RW_BANK2_2    = 0xC087,
	MM_SS_R_BANK1       = 0xC088,
	MM_SS_W_BANK1       = 0xC089,
	MM_SS_R_ROM1        = 0xC08A,
	MM_SS_RW_BANK1      = 0xC08B,
	MM_SS_R_BANK1_2     = 0xC08C,
	MM_SS_W_BANK1_2     = 0xC08D,
	MM_SS_R_ROM1_2      = 0xC08E,
	MM_SS_RW_BANK1_2    = 0xC08F,
	MM_SS_END           = 0xC0FF,
	MM_DEVICES_END		= 0xC7FF,
	MM_ACIA_START		= 0xC100,
	MM_ACIA_END			= 0xC10F,
	MM_VIA1_START		= 0xC200,
	MM_VIA1_END			= 0xC20F,
	MM_ROMDISK_START    = 0xC300,
	MM_ROMDISK_END      = 0xC30F,
	MM_AUDIO_START      = 0xC400,
	MM_RAM2_START       = 0xC800,
	MM_RAM2_END         = 0xCFFF,
	MM_ROM_START		= 0xD000,
	MM_ROM_END			= 0xFFFF
};

struct	CPU;
class	ACIA;
class	VIA;
class	PS2Keyboard;

class VM
{
public:
	VM();
	VM(bool testmode);
	~VM();

	void Run();
	void Reset();
	CPU* GetCPU();
	VIA* GetVIA1();
	VIA* GetVIA2();
	PS2Keyboard* GetPS2Keyboard();

	bool SimulateSerialKey(uint8_t key);

	uint8_t ReadData  (uint16_t address);
	void    WriteData (uint16_t address, uint8_t byte);
	bool	LoadBinaryFile(const char* wzFileName);
	bool	LoadBinaryFile(const char * wzFileName, uint16_t offset);
	bool	LoadRomDiskFile(const char* wzFileName);
	void	SetTestMode(bool mode);

	void	GetFileName(std::string& file);

	#if defined(PLATFORM_WINDOWS)
	wstring Disassemble();
	#endif
	
	bool	OffsetFromAddress(uint16_t address, uint32_t& offset);
	uint32_t GetLineFromAddress(uint16_t address);
	uint32_t GetOffsetFromLine(uint32_t line);

	std::function<void(uint8_t)> CallbackReceiveChar;
	std::function<void(char*)> CallbackDebugString;
	std::function<void(uint16_t, uint8_t)> CallbackWriteVideo;
	std::function<void(uint8_t, uint8_t)> CallbackAudio;
    std::function<void(uint16_t, uint8_t)> CallbackHires1;
    std::function<void(uint16_t, uint8_t)> CallbackHires2;
	std::function<void(uint16_t, uint8_t)> CallbackText1;
	std::function<void(uint16_t, uint8_t)> CallbackText2;
	std::function<void(uint8_t)> CallbackSetMode;
	std::function<void(uint16_t, uint8_t)> CallbackWriteMemory;
	std::function<void(uint16_t)> CallbackReadMemory;
	std::function<void(bool, bool, bool, bool)> CallbackSetSoftSwitches;

	std::function<void(std::string &, std::vector<uint8_t> &, uint8_t &)> CallbackLoadFile;
	std::function<void(std::string &, std::vector<uint8_t> &, uint8_t &)> CallbackSaveFile;

	uint8_t * GetData();
	uint8_t * GetRomDisk();
	uint8_t * GetBasicRom();

private:
	void Init();
	void DoSoftSwitches(uint16_t address, bool write);

	CPU	*			_cpu;
	ACIA *			_acia;
	VIA *			_via1;
	VIA *			_via2;
	PS2Keyboard *	_pPS2;
	
	uint8_t			_data[0x10000];  // 64KB address space
	uint8_t			_basic[0x3000];  // 12KB basic bank ROM

	uint8_t         _bank1_d000[0x1000];
	uint8_t         _bank2_d000[0x1000];
	uint8_t         _bank_e000[0x2000];

	uint8_t *		_romdisk; // 512KB ROM disk

	uint8_t			_romdiskLow = 0;
	uint8_t			_romdiskHigh = 0;
	uint8_t			_romdiskBank = 0;

	unordered_map<uint32_t, uint32_t>	_mapLineToOffset;
	unordered_map<int16_t, int32_t>		_mapAddressToLine;
	unordered_map<int16_t, int32_t>		_mapAddressToOffset;
	
	uint8_t _pitch = 0;
	uint8_t _duration = 0;
	uint8_t _result = 0;

	bool _basicbank = false;

	bool _bank_read = false;
	bool _bank_write = false;
	bool _bank_page1 = false;
	bool _bank_ff = false;

	bool _graphics = false;
	bool _page2 = false;
	bool _mixed = false;
	bool _lores = false;

	bool _testmode = false;
};