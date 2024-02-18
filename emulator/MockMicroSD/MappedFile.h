#pragma once
#include "pch.h"

class MMappedFile
{
public:
	~MMappedFile();

	uint32_t MapFile(wchar_t* wzFileName);
	uint8_t GetData(uint32_t address);
	bool SetData(uint32_t address, uint8_t byte);

	bool IsInitialized();
	DWORD GetFileSize();

private:
	bool _initialized = false;
	HANDLE _hMapFile = INVALID_HANDLE_VALUE;
	HANDLE _hBaseFile = INVALID_HANDLE_VALUE;
	uint8_t* _pBuf;
	DWORD _dwFileSize = 0;

};
