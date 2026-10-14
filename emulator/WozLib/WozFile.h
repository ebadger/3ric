#pragma once
#include <stdint.h>
#include <array>
#include <vector>
#include <mutex>
#include "WozErrors.h"
#include "Timing.h"

// https://applesaucefdc.com/woz/reference2/

typedef struct Chunk
{
	union ChunkID 
	{
		uint32_t	value;
		char		text[4];
	} ChunkID;

	uint32_t				ChunkSize;
	std::vector<uint8_t>	ChunkData;

	uint32_t                FileOffset;

	static uint32_t INFO_CHUNK_ID;
	static uint32_t TMAP_CHUNK_ID;
	static uint32_t TRKS_CHUNK_ID;
	static uint32_t WRIT_CHUNK_ID;
	static uint32_t META_CHUNK_ID;
	static uint32_t FLUX_CHUNK_ID;
} _Chunk;

typedef struct TRK
{
	uint16_t StartingBlock;  // (x << 9) to get byte offset
	uint16_t BlockCount;
	uint32_t BitCount;
} _TRK;

typedef struct InfoChunkData
{
	uint8_t Version;
	uint8_t DiskType;
	uint8_t WriteProtected;
	uint8_t Synchronized;
	uint8_t Cleaned;
	char	Creator[32];
	uint8_t Sides;
	uint8_t BootSectorFormat;
	uint8_t OptimalBitTiming;
	uint16_t CompatibleHardware;
	uint16_t RequiredRAM;
	uint16_t LargestTrack;
	uint16_t FLUXBlock;
	uint16_t LargestFluxTrack;

	enum DiskTypes : uint8_t
	{
		Invalid = 0,
		FiveAndAQuarter = 1,
		ThreePointFive = 2
	};

	enum BootSectorFormats : uint8_t
	{
		Unknown = 0,
		SixteenSector = 1,
		ThirteenSector  = 2,
		Both = 3
	};

	enum CompatibleHardwareIds : uint16_t
	{
		AppleII = 0x1,
		AppleIIPlus = 0x2,
		AppleIIe = 0x4,
		AppleIIc = 0x8,
		AppleIIcEnhanced = 0x10,
		AppleIIgs = 0x20,
		AppleIIcPlus = 0x40,
		AppleIII = 0x80,
		AppleIIIPlus = 0x100
	};

} _InfoChunkDat;

class WozFile
{
public:
	static constexpr uint32_t MaxFileSize = 8 * 1024 * 1024;

	WozFile();
	~WozFile();

	uint32_t OpenFile(const char* szFileName);
	InfoChunkData* GetInfoChunkData();
	void CloseFile();
	bool IsFileLoaded();
	bool GetNextBit();
	bool GetNextBit2();
	void SetTrack(int16_t track);

private:

	uint32_t ValidateImage();
	uint32_t RejectImage(uint32_t error);
	void ClearImage();

	std::vector<uint8_t> _fileData;
	std::vector<uint8_t> _trackData;
	std::vector<uint8_t> _bitData;

	std::mutex _mutex;

	InfoChunkData _info = {};
	std::array<TRK, 160> _tracks = {};
	std::array<uint8_t, 160> _tmap = {};
	bool _loaded = false;
	int16_t _track = -1;

	uint32_t _readPosition = 0;
	uint32_t _bitCount = 0;

};
