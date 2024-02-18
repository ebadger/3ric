#pragma once
#include "pch.h"

class SDCard
{	
public:
	uint32_t LoadImageFile(wchar_t* filename);
	void SetCS(bool high);
	void SetMOSI(bool high);
	void SetSCK(bool high);
	bool GetMISO();

private:

	void SetSector();

	typedef enum Mode
	{
		MODE_COMMAND,
		MODE_READSECTOR_ACK,
		MODE_READSECTOR_START,
		MODE_WRITESECTOR_ACK,
		MODE_WRITESECTOR_START,
		MODE_WRITESECTOR_COMPLETE,
		MODE_READSECTOR,
		MODE_WRITESECTOR,
		MODE_GO_IDLE,
		MODE_SEND_IF_COND,
		MODE_APP_COMMAND,
		MODE_APP_SEND_OP_COND,
		MODE_OUTPUT_STATUS
	} Mode;

	Mode _mode = MODE_COMMAND;
	uint32_t _status = 0;

	uint8_t _bits = 0;
	uint8_t _byteIn = 0;
	uint16_t _response = 0;
	uint32_t _byteCount = 0;

	uint8_t _command[6] = { 0 };
	uint8_t _commandByte = 0;

	bool _initialized = false;
	bool _miso = false;
	bool _mosi = false;
	bool _cs = false;
	
	uint32_t _sector = 0;
	uint32_t _pos    = 0;

	MMappedFile _mappedFile;
};