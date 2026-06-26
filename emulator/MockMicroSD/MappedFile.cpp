#include "pch.h"
#include "MappedFile.h"

#if defined(__EMSCRIPTEN__)

void MMappedFile::InitLogical(uint32_t fileSizeBytes)
{
	_fileSize = fileSizeBytes;
	_sectors.clear();
	_cacheSector = 0xFFFFFFFF;
	_cacheBuf = nullptr;
	_initialized = true;
}

void MMappedFile::LoadSector(uint32_t sectorIndex, const uint8_t* data, uint32_t len)
{
	if (len > kSectorSize)
	{
		len = kSectorSize;
	}

	std::vector<uint8_t>& sec = _sectors[sectorIndex];
	sec.assign(kSectorSize, 0);
	memcpy(sec.data(), data, len);
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

	uint32_t sector = address / kSectorSize;
	uint32_t offset = address % kSectorSize;

	if (sector != _cacheSector)
	{
		auto it = _sectors.find(sector);
		_cacheBuf = (it == _sectors.end()) ? nullptr : &it->second;
		_cacheSector = sector;
	}

	if (_cacheBuf == nullptr)
	{
		// Never-written sector reads back as zero (the image is mostly zeros).
		return 0;
	}

	return (*_cacheBuf)[offset];
}

bool MMappedFile::SetData(uint32_t address, uint8_t byte)
{
	if (!_initialized)
	{
		return false;
	}

	uint32_t sector = address / kSectorSize;
	uint32_t offset = address % kSectorSize;

	std::vector<uint8_t>& sec = _sectors[sector];
	if (sec.empty())
	{
		sec.assign(kSectorSize, 0);
	}
	sec[offset] = byte;

	// Keep the read cache coherent with a fresh write.
	_cacheSector = sector;
	_cacheBuf = &sec;
	return true;
}

uint32_t MMappedFile::GetFileSize()
{
	return _fileSize;
}

#else

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

#endif