#pragma once
#include <stdint.h>
#include <vector>
#include "WozErrors.h"
#include "timing.h"

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
	WozFile();
	~WozFile();

	uint32_t OpenFile(const char* szFileName);
	InfoChunkData* GetInfoChunkData();
	void CloseFile();
	bool IsFileLoaded();
	bool GetNextBit();
	void SetTrack(int16_t track);

private:

	uint32_t ReadFileHeader();
	uint32_t ReadChunks();

	std::vector<uint8_t> _trackData;
	std::vector<Chunk *> _vecChunks;
	Chunk* _InfoChunk = nullptr;
	Chunk* _MetaChunk = nullptr;
	Chunk* _TrksChunk = nullptr;
	Chunk* _TmapChunk = nullptr;

	TRK* _Trk = nullptr;
	uint8_t* _Tmap = nullptr;

	uint32_t _crc = 0;
	uint32_t _fileEnd = 0;

	FILE * _wozFile = nullptr;
	int16_t _track = -1;

	uint32_t _readPosition = 0;
	uint32_t _bitCount = 0;

};
