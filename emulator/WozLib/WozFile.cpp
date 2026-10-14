#include "WozFile.h"
#include <cstdio>
#include <cstring>
#include <memory>
#if defined(__EMSCRIPTEN__)
#include "web_compat.h"
#else
#include <Windows.h>
#include <debugapi.h>
#endif

uint32_t Chunk::INFO_CHUNK_ID = 0x4F464E49;
uint32_t Chunk::TMAP_CHUNK_ID = 0x50414D54;
uint32_t Chunk::TRKS_CHUNK_ID = 0x534B5254;
uint32_t Chunk::WRIT_CHUNK_ID = 0x54495257;
uint32_t Chunk::META_CHUNK_ID = 0x4154454D;
uint32_t Chunk::FLUX_CHUNK_ID = 0x58554C46;

namespace
{
	uint16_t Read16(const uint8_t* bytes)
	{
		return uint16_t(bytes[0]) | (uint16_t(bytes[1]) << 8);
	}

	uint32_t Read32(const uint8_t* bytes)
	{
		return uint32_t(Read16(bytes)) | (uint32_t(Read16(bytes + 2)) << 16);
	}

	uint32_t Crc32(const uint8_t* bytes, size_t size)
	{
		uint32_t crc = 0xFFFFFFFF;
		for (size_t i = 0; i < size; ++i)
		{
			crc ^= bytes[i];
			for (int bit = 0; bit < 8; ++bit)
			{
				crc = (crc >> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
			}
		}
		return ~crc;
	}
}

WozFile::WozFile()
{
}

WozFile::~WozFile()
{
	CloseFile();
}

void WozFile::ClearImage()
{
	_loaded = false;
	_track = -1;
	_readPosition = 0;
	_bitCount = 0;
	_fileData.clear();
	_trackData.clear();
	_bitData.clear();
	_info = {};
	_tracks = {};
	_tmap.fill(0xFF);
}

void WozFile::CloseFile()
{
	std::lock_guard<std::mutex> guard(_mutex);
	ClearImage();
}

bool WozFile::IsFileLoaded()
{
	std::lock_guard<std::mutex> guard(_mutex);
	return _loaded;
}

uint32_t WozFile::RejectImage(uint32_t error)
{
	ClearImage();
	char message[80];
	sprintf_s(message, sizeof(message), "WOZ image rejected (0x%08X)\r\n", error);
	OutputDebugStringA(message);
	return error;
}

uint32_t WozFile::OpenFile(const char* szFileName)
{
	std::lock_guard<std::mutex> guard(_mutex);
	ClearImage();
	if (!szFileName || !*szFileName) return RejectImage(INVALID_WOZ_FILE);

	FILE* rawFile = nullptr;
	if (fopen_s(&rawFile, szFileName, "rb") != 0 || !rawFile)
	{
		return RejectImage(INVALID_WOZ_FILE);
	}
	std::unique_ptr<FILE, decltype(&fclose)> file(rawFile, fclose);
	if (fseek(file.get(), 0, SEEK_END) != 0) return RejectImage(INVALID_WOZ_FILE);
	const long size = ftell(file.get());
	if (size < 12 || size > MaxFileSize) return RejectImage(INVALID_WOZ_SIZE);
	if (fseek(file.get(), 0, SEEK_SET) != 0) return RejectImage(INVALID_WOZ_FILE);

	// Keep the validated bytes, not an open file that could change between tracks.
	_fileData.resize(static_cast<size_t>(size));
	if (fread(_fileData.data(), 1, _fileData.size(), file.get()) != _fileData.size())
	{
		return RejectImage(INVALID_WOZ_FILE);
	}
	file.reset();
	const uint32_t error = ValidateImage();
	if (error != 0) return RejectImage(error);
	_loaded = true;
	return END_OF_WOZFILE;
}

uint32_t WozFile::ValidateImage()
{
	const uint8_t magic[] = { 'W', 'O', 'Z', '2', 0xFF, 0x0A, 0x0D, 0x0A };
	const uint8_t* data = _fileData.data();
	if (memcmp(data, magic, sizeof(magic)) != 0) return UNSUPPORTED_WOZ_FORMAT;
	const uint32_t crc = Read32(data + 8);
	if (crc != 0 && crc != Crc32(data + 12, _fileData.size() - 12)) return INVALID_WOZ_CRC;

	size_t infoOffset = 0, tmapOffset = 0, trksOffset = 0, trksSize = 0;
	for (size_t at = 12; at < _fileData.size();)
	{
		if (_fileData.size() - at < 8) return INVALID_WOZ_FILE;
		const uint32_t id = Read32(data + at);
		const uint32_t size = Read32(data + at + 4);
		at += 8;
		if (size > _fileData.size() - at) return INVALID_WOZ_FILE;
		if (id == Chunk::INFO_CHUNK_ID)
		{
			if (infoOffset || size != 60) return INVALID_INFO_SIZE;
			infoOffset = at;
		}
		else if (id == Chunk::TMAP_CHUNK_ID)
		{
			if (tmapOffset || size != _tmap.size()) return INVALID_TMAP_CHUNK_DATA;
			tmapOffset = at;
		}
		else if (id == Chunk::TRKS_CHUNK_ID)
		{
			if (trksOffset || size < _tracks.size() * 8) return INVALID_TRKS_CHUNK_DATA;
			trksOffset = at;
			trksSize = size;
		}
		else if (id == Chunk::FLUX_CHUNK_ID)
		{
			return UNSUPPORTED_WOZ_FORMAT;
		}
		at += size;
	}
	if (!infoOffset) return INVALID_INFO_CHUNK;
	if (!tmapOffset) return INVALID_TMAP_CHUNK_DATA;
	if (!trksOffset) return INVALID_TRKS_CHUNK_DATA;

	const uint8_t* info = data + infoOffset;
	_info.Version = info[0];
	_info.DiskType = info[1];
	_info.WriteProtected = info[2];
	_info.Synchronized = info[3];
	_info.Cleaned = info[4];
	memcpy(_info.Creator, info + 5, sizeof(_info.Creator));
	_info.Sides = info[37];
	_info.BootSectorFormat = info[38];
	_info.OptimalBitTiming = info[39];
	_info.CompatibleHardware = Read16(info + 40);
	_info.RequiredRAM = Read16(info + 42);
	_info.LargestTrack = Read16(info + 44);
	if (_info.Version < 2 || _info.DiskType != InfoChunkData::FiveAndAQuarter || _info.Sides != 1)
	{
		return UNSUPPORTED_WOZ_FORMAT;
	}
	if (_info.Version >= 3)
	{
		_info.FLUXBlock = Read16(info + 46);
		_info.LargestFluxTrack = Read16(info + 48);
		if (_info.FLUXBlock || _info.LargestFluxTrack) return UNSUPPORTED_WOZ_FORMAT;
	}
	if (_info.LargestTrack > MaxFileSize / 512) return INVALID_INFO_CHUNK_DATA;

	for (size_t index = 0; index < _tracks.size(); ++index)
	{
		const uint8_t* descriptor = data + trksOffset + index * 8;
		TRK& track = _tracks[index];
		track.StartingBlock = Read16(descriptor);
		track.BlockCount = Read16(descriptor + 2);
		track.BitCount = Read32(descriptor + 4);
		if (!track.StartingBlock && !track.BlockCount && !track.BitCount) continue;
		const size_t start = size_t(track.StartingBlock) * 512;
		const size_t bytes = size_t(track.BlockCount) * 512;
		const size_t end = trksOffset + trksSize;
		if (!track.BlockCount || !track.BitCount || track.BlockCount > _info.LargestTrack ||
			start < trksOffset + _tracks.size() * 8 || start > end || bytes > end - start ||
			track.BitCount > bytes * 8)
		{
			return INVALID_TRKS_CHUNK_DATA;
		}
	}
	for (size_t index = 0; index < _tmap.size(); ++index)
	{
		const uint8_t track = data[tmapOffset + index];
		if (track != 0xFF && (track >= _tracks.size() || _tracks[track].BitCount == 0))
		{
			return INVALID_TMAP_CHUNK_DATA;
		}
		_tmap[index] = track;
	}
	return 0;
}

InfoChunkData* WozFile::GetInfoChunkData()
{
	return _loaded ? &_info : nullptr;
}

void WozFile::SetTrack(int16_t track)
{
	std::lock_guard<std::mutex> guard(_mutex);
	if (track < 0 || track >= static_cast<int16_t>(_tmap.size()))
	{
		OutputDebugStringA("Invalid WOZ track index\r\n");
		return;
	}
	if (!_loaded || _track == track) return;
	_track = track;
	const uint8_t index = _tmap[track];
	if (index == 0xFF)
	{
		_bitCount = 0;
		_trackData.clear();
		_bitData.clear();
		return;
	}

	const TRK& descriptor = _tracks[index];
	const size_t start = size_t(descriptor.StartingBlock) * 512;
	const size_t bytes = size_t(descriptor.BlockCount) * 512;
	_trackData.assign(_fileData.begin() + start, _fileData.begin() + start + bytes);
	_bitData.resize(descriptor.BitCount);
	for (size_t bit = 0; bit < _bitData.size(); ++bit)
	{
		_bitData[bit] = (_trackData[bit >> 3] >> (7 - (bit & 7))) & 1;
	}
	_bitCount = descriptor.BitCount;
}

bool WozFile::GetNextBit2()
{
	std::lock_guard<std::mutex> guard(_mutex);

	if (_bitCount == 0)
	{
		return rand() % 2;
	}
	if (_readPosition >= _bitCount)
	{
		_readPosition = 0;
	}
	return _bitData[_readPosition++] > 0;
}

bool WozFile::GetNextBit()
{
	std::lock_guard<std::mutex> guard(_mutex);

	if (_bitCount == 0)
	{
		return rand() % 2;
	}
	_readPosition++;
	const uint32_t bitPos = _readPosition % _bitCount;
	const uint8_t byte = _trackData[bitPos >> 3];
	return (byte << (bitPos & 7)) & 0x80;
}
