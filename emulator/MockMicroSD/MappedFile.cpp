#include "pch.h"
#include "MappedFile.h"

MMappedFile::~MMappedFile()
{
	UnmapViewOfFile(_pBuf);
	CloseHandle(_hMapFile);
	CloseHandle(_hBaseFile);
}

bool MMappedFile::IsInitialized()
{
	return _initialized;
}

uint8_t MMappedFile::GetData(uint32_t address)
{
	if (!_initialized)
	{
		return 0;
	}

	return _pBuf[address];
}

bool MMappedFile::SetData(uint32_t address, uint8_t byte)
{
	if (!_initialized)
	{
		return false;
	}

	_pBuf[address] = byte;
	return true;
}

uint32_t MMappedFile::MapFile(wchar_t* wzFile)
{
	_initialized = false;

	_hBaseFile = CreateFile(wzFile, 
							GENERIC_READ | GENERIC_WRITE, 
							FILE_SHARE_READ | FILE_SHARE_WRITE, 
							nullptr, 
							OPEN_EXISTING, 
							FILE_ATTRIBUTE_NORMAL, 
							nullptr);

	if (nullptr == _hBaseFile || INVALID_HANDLE_VALUE == _hBaseFile)
	{
		return GetLastError();
	}

	_dwFileSize = ::GetFileSize(_hBaseFile, NULL);

	_hMapFile = CreateFileMapping(_hBaseFile, 
								nullptr, 
								PAGE_READWRITE, 
								0, 
								0, 
								nullptr)
		;
	if (nullptr == _hMapFile || INVALID_HANDLE_VALUE == _hBaseFile)
	{
		return GetLastError();
	}

	_pBuf = (uint8_t *)MapViewOfFile(_hMapFile, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, 0);
	if (!_pBuf)
	{
		return GetLastError();
	}

	_initialized = true;
	return 0;
}

DWORD MMappedFile::GetFileSize()
{
	return _dwFileSize;
}