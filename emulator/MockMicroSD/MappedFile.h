#pragma once
#include "pch.h"

class MMappedFile
{
public:
#if defined(__EMSCRIPTEN__)
	// Web build: there is no Win32 memory-mapped file. The 2 GB SD image is
	// almost entirely zeros, so it is backed by a lazily-allocated map of
	// 512-byte sectors (see web/make_sd_sparse.py + SDCard::LoadSparseImage).
	~MMappedFile() = default;

	// Establish the logical image size (bytes) without allocating it. Reads of
	// never-written sectors return 0; writes allocate the sector on demand.
	void InitLogical(uint32_t fileSizeBytes);

	// Populate one 512-byte sector from the sparse image.
	void LoadSector(uint32_t sectorIndex, const uint8_t* data, uint32_t len);

	uint8_t GetData(uint32_t address);
	bool SetData(uint32_t address, uint8_t byte);

	bool IsInitialized();
	uint32_t GetFileSize();

private:
	static const uint32_t kSectorSize = 512;

	bool _initialized = false;
	uint32_t _fileSize = 0;
	std::unordered_map<uint32_t, std::vector<uint8_t>> _sectors;

	// Single-entry cache so a sequential read does not re-hash on every bit.
	uint32_t _cacheSector = 0xFFFFFFFF;
	std::vector<uint8_t>* _cacheBuf = nullptr;
#else
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
#endif

};
