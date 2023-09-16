#pragma once
#include <pch.h>

class MappedFile
{
public:
	MappedFile() {};
	~MappedFile();

	uint32_t MapFile(wchar_t* wzFileName);
	uint8_t GetData(uint32_t address);
	
private:
	bool _initialized = false;
	HANDLE _hMapFile = INVALID_HANDLE_VALUE;
	HANDLE _hBaseFile = INVALID_HANDLE_VALUE;
	uint8_t* _pBuf;

};
