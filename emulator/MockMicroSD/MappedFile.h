#pragma once
#include "pch.h"

class MMappedFile
{
public:
	~MMappedFile();

	uint32_t MapFile(wchar_t* wzFileName);
	uint8_t GetData(uint32_t address);
	bool IsInitialized();

private:
	bool _initialized = false;
	HANDLE _hMapFile = INVALID_HANDLE_VALUE;
	HANDLE _hBaseFile = INVALID_HANDLE_VALUE;
	uint8_t* _pBuf;

};
