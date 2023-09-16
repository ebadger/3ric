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
;0x0000 0xBFFF RAM 48KB
;0xC000 0xC0FF Devices
;0xC100 0xE2FF Basic ROM
;0xE300 0xFFFF OS
*/

enum
{
	MM_RAM_START		= 0x0000,
	MM_RAM_END			= 0xBFFF,
	MM_VIDEO_START		= 0x2000,
	MM_VIDEO_END		= 0x5FFF,
	MM_DEVICES_START	= 0xC000,
	MM_DEVICES_END		= 0xC0FF,
	MM_ACIA_START		= 0xC000,
	MM_ACIA_END			= 0xC00F,
	MM_VIA1_START		= 0xC010,
	MM_VIA1_END			= 0xC01F,
	MM_ROMDISK_START    = 0xC040,
	MM_ROMDISK_END      = 0xC04F,
	MM_AUDIO_START      = 0xC040,
	MM_AUDIO_END        = 0xC04F,
	MM_FILE_START       = 0xC0F0,
	MM_FILE_END         = 0xC0FF,
	MM_ROM_START		= 0xC100,
	MM_ROM_END			= 0xE2FF,
	MM_OS_START			= 0xE300,
	MM_OS_END			= 0xFFFF
};

struct CPU;
class ACIA;
class VIA;
class PS2Keyboard;

class VM
{
public:
	VM();
	VM(bool testmode);
	~VM();

	void Run();
	CPU* GetCPU();
	VIA* GetVIA1();
	VIA* GetVIA2();
	PS2Keyboard* GetPS2Keyboard();

	bool SimulateSerialKey(uint8_t key);

	uint8_t ReadData  (uint16_t address);
	void    WriteData (uint16_t address, uint8_t byte);
	uint8_t * GetVideoBuffer();
	bool LoadBinaryFile(const char* wzFileName);
	bool LoadBinaryFile(const char * wzFileName, uint16_t offset);
	bool LoadRomDiskFile(const char* wzFileName);
	void SetTestMode(bool mode);

	void GetFileName(std::string& file);

	#if defined(PLATFORM_WINDOWS)
	wstring Disassemble();
	#endif
	
	bool OffsetFromAddress(uint16_t address, uint32_t& offset);
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

	std::function<void(std::string &, std::vector<uint8_t> &, uint8_t &)> CallbackLoadFile;
	std::function<void(std::string &, std::vector<uint8_t> &, uint8_t &)> CallbackSaveFile;

	uint8_t * GetData();
	uint8_t * GetRomDisk();

private:

	void Init();

	CPU	*	_cpu;
	ACIA *  _acia;
	VIA *   _via1;
	VIA *   _via2;
	PS2Keyboard * _pPS2;
	
	uint8_t _data[0x10000];  // 64KB address space
	uint8_t _video[0x10000]; // 64KB banked video RAM 
	uint8_t * _romdisk; // 512KB ROM disk

	uint8_t _romdiskLow = 0;
	uint8_t _romdiskHigh = 0;
	uint8_t _romdiskBank = 0;

	unordered_map<uint32_t, uint32_t> _mapLineToOffset;
	unordered_map<int16_t, int32_t> _mapAddressToLine;
	unordered_map<int16_t, int32_t> _mapAddressToOffset;
	
	uint8_t _pitch = 0;
	uint8_t _duration = 0;
	uint8_t _result = 0;

	bool _testmode = false;
	
};