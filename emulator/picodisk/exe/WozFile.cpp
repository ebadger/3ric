#include "wozfile.h"
#include "stdio.h"
#include "stdlib.h"
#include <string.h>
#include <errno.h>
#include "console.h"

extern Console * _console;

const char* c_WOZ2Header = "WOZ2";
const char* c_WOZ1Header = "WOZ1";

// statics
uint32_t Chunk::INFO_CHUNK_ID = *(uint32_t*)"INFO";
uint32_t Chunk::TMAP_CHUNK_ID = *(uint32_t*)"TMAP";
uint32_t Chunk::TRKS_CHUNK_ID = *(uint32_t*)"TRKS";
uint32_t Chunk::WRIT_CHUNK_ID = *(uint32_t*)"WRIT";
uint32_t Chunk::META_CHUNK_ID = *(uint32_t*)"META";
uint32_t Chunk::FLUX_CHUNK_ID = *(uint32_t*)"FLUX";


WozFile::WozFile()
{

}

WozFile::~WozFile()
{
	CloseFile();
}

void 
__not_in_flash_func(WozFile::CloseFile)()
{
	_track = -1;

	_vecChunks.clear();
	_trackData.clear();

	if (_wozFile.obj.fs != 0)
	{
		f_close(&_wozFile);
	}

	_InfoChunk = nullptr;
	_MetaChunk = nullptr;
	_TrksChunk = nullptr;
	_TmapChunk = nullptr;
	_Trk = nullptr;
	_Tmap = nullptr;
}

bool 
__not_in_flash_func(WozFile::IsFileLoaded)()
{
	return _wozFile.obj.fs != 0;
}

uint32_t 
__not_in_flash_func(WozFile::OpenFile)(const char * szFileName)
{
	FRESULT fr = FR_OK;
	uint32_t err = 0;
	fr = f_open(&_wozFile, szFileName,  FA_READ | FA_WRITE);

	if (FR_OK != fr)
	{
		goto exit;
	}

	err = ReadFileHeader();
	if (err != 0) // additional file valid check?
	{
		goto exit;
	}

	while (err == 0)
	{
		err = ReadChunks();
	}

exit:
	return err;
}

uint32_t 
__not_in_flash_func(WozFile::ReadFileHeader)()
{
	FRESULT fr = FR_OK;
	char buffer[12];

	if (_wozFile.obj.fs == 0)
	{
		return INVALID_WOZ_FILE;
	}

	_fileEnd = _wozFile.obj.objsize;
	f_lseek(&_wozFile, 0L); // Reset to the beginning

	// read the header
	UINT read = 0;
	fr = f_read(&_wozFile, buffer, sizeof(buffer), &read);
	//_ASSERT(read == 1);
	if (read != sizeof(buffer) || fr != FR_OK) {
		perror("Error reading data");
		f_close(&_wozFile);
		return 1;
	}

	// validate the header
	// for now only support Woz2.x format
	if (strncmp(c_WOZ2Header, buffer, 4) != 0)
	{
		if (strncmp(c_WOZ1Header, buffer, 4) != 0)
		{
			// header mismatch
			// not a valid WOZ file
			return INVALID_WOZ_FILE;
		}
	}

	if (buffer[4] != (char)0xFF)
	{
		return INVALID_WOZ_FILE;
	}

	_crc = *(uint32_t*)&buffer[8];

	
	return 0;
}

uint32_t 
__not_in_flash_func(WozFile::ReadChunks)()
{
	FRESULT fr = FR_OK;

	if (_wozFile.obj.fs == 0)
	{
		return INVALID_WOZ_FILE;
	}

	Chunk *pChunk = new Chunk();
	pChunk->FileOffset = _wozFile.fptr + 8;

	UINT read = 0;
	fr = f_read(&_wozFile, pChunk->ChunkID.text, sizeof(pChunk->ChunkID.text), &read);
	//_ASSERT(read == 1);
	if (read != sizeof(pChunk->ChunkID.text) || FR_OK != fr) {
		f_close(&_wozFile);
		return INVALID_INFO_CHUNK;
	}


	fr = f_read(&_wozFile, &pChunk->ChunkSize, sizeof(pChunk->ChunkSize), &read);
	//_ASSERT(read == 1);
	if (read != sizeof(pChunk->ChunkSize) || FR_OK != fr) {
		f_close(&_wozFile);
		return INVALID_INFO_CHUNK;
	}

	if (pChunk->ChunkID.value == Chunk::INFO_CHUNK_ID)
	{
		_InfoChunk = pChunk;
		_InfoChunk->ChunkData.resize(_InfoChunk->ChunkSize, 0);

		fr = f_read(&_wozFile,
			_InfoChunk->ChunkData.data(),
			_InfoChunk->ChunkData.size(),
			&read);

		//_ASSERT(read == 1);

		if (read != _InfoChunk->ChunkData.size() || FR_OK != fr) {
			f_close(&_wozFile);
			return INVALID_INFO_CHUNK_DATA;
		}
	} 
	else if (pChunk->ChunkID.value == Chunk::META_CHUNK_ID)
	{
		_MetaChunk = pChunk;
	}
	else if (pChunk->ChunkID.value == Chunk::TMAP_CHUNK_ID)
	{
		_TmapChunk = pChunk;
		_TmapChunk->ChunkData.resize(_TmapChunk->ChunkSize, 0);

		fr = f_read(&_wozFile,
			_TmapChunk->ChunkData.data(),
			_TmapChunk->ChunkData.size(),
			&read);

		//_ASSERT(read == 1);

		if (read != _TmapChunk->ChunkData.size() || FR_OK != fr) {
			f_close(&_wozFile);
			return INVALID_TMAP_CHUNK_DATA;
		}

		_Tmap = _TmapChunk->ChunkData.data();
	}
	else if (pChunk->ChunkID.value == Chunk::TRKS_CHUNK_ID)
	{
		_TrksChunk = pChunk;

		if (160 * sizeof(TRK) > _TrksChunk->ChunkSize)
		{
			f_close(&_wozFile);
			return INVALID_TRKS_CHUNK_DATA;
		}

		uint32_t TrksSize = 160 * sizeof(TRK);
		_TrksChunk->ChunkData.resize(TrksSize, 0);

		fr = f_read(&_wozFile, 
			_TrksChunk->ChunkData.data(),
			TrksSize,
			&read);

		//_ASSERT(read == 1);

		if (read != TrksSize || FR_OK != fr) {
			f_close(&_wozFile);
			return INVALID_TRKS_CHUNK_DATA;
		}

		_Trk = (TRK*)_TrksChunk->ChunkData.data();

		// advance past the track bits
		f_lseek(&_wozFile, _wozFile.fptr + pChunk->ChunkSize - TrksSize);

	}
	else if (pChunk->ChunkID.value == Chunk::WRIT_CHUNK_ID)
	{

	}
	else if (pChunk->ChunkID.value == Chunk::FLUX_CHUNK_ID)
	{

	}
	else
	{
		//_ASSERT(false);
		printf("Unknown chunk: %s\r\n", pChunk->ChunkID.text);
	}

	_vecChunks.push_back(pChunk);

	if (pChunk->ChunkData.size() == 0)
	{
		// chunk is not loaded, skip the data to get to the next chunk
		f_lseek(&_wozFile, _wozFile.fptr + pChunk->ChunkSize);
	}

	if (f_eof(&_wozFile))
	{
		return END_OF_WOZFILE;
	}

	return 0;
}


InfoChunkData* 
__not_in_flash_func(WozFile::GetInfoChunkData)()
{
	if (_wozFile.obj.fs == 0 || !_InfoChunk)
	{
		return nullptr;
	}

	return (InfoChunkData*)_InfoChunk->ChunkData.data();
}

void 
__not_in_flash_func(WozFile::SetTrack)(int16_t track)
{
	FRESULT fr = FR_OK;
	UINT read = 0;

	//_ASSERT(track < 160);
	//_ASSERT(_wozFile != nullptr);

	if (_wozFile.obj.fs == 0)
	{
		return;
	}

	if (track > 159 || _track == track)
	{
		return;
	}

	_track = track;

	//OutputDebugStringA(buf);

	uint8_t trkIndex = _Tmap[track];

	if (trkIndex > 159)
	{
		_bitCount = 0;
		//_console->PrintOut("trkIndex > 159 = %d\n", trkIndex);
		return;
	}

	//_console->PrintOut("T:%d\n", trkIndex);
	_trackReadCompleted = false;

	// read the track
#if 0
	LoadTrack();
#endif

}

void 
__not_in_flash_func(WozFile::LoadTrack)()
{
	FRESULT fr = FR_OK;

	if (_wozFile.obj.fs ==  0 || true == _trackReadCompleted)
	{
		return;
	}

	uint8_t trkIndex = _Tmap[_track];

	if (trkIndex > 159)
	{
		return;
	}

	if (_trackLoaded == trkIndex)
	{
		return;
	}


	uint16_t largest = GetInfoChunkData()->LargestTrack;

	//_ASSERT(offset != 0 && blocks != 0);

	_trackData.resize(largest << 9, 0);

	_trackLoaded = trkIndex;

	uint16_t offset = _Trk[trkIndex].StartingBlock << 9;
	uint16_t blocks = _Trk[trkIndex].BlockCount;
    UINT read = 0;

	fr = f_lseek(&_wozFile, offset);
	if (FR_OK != fr)
	{
		_console->PrintOut("seek failed, %d\n",fr);
	}

	fr = f_read(&_wozFile,
		_trackData.data(),
		blocks << 9,
		&read);

	//_ASSERT(read == 1);
	_console->PrintOut("Read track %d: fr=%d, read=%d, blocks=%d\n", trkIndex, fr, read, blocks << 9);

	if (read != blocks << 9 || FR_OK != fr) {
		f_close(&_wozFile);
		return;
	}

	_bitCount = _Trk[trkIndex].BitCount;

	_trackReadCompleted = true;
}

bool 
__not_in_flash_func(WozFile::GetNextBit)()
{		
	if (_bitCount == 0 || false == _trackReadCompleted)
	{
		return rand() % 2;
	}

	_readPosition++;

	int32_t bitPos = _readPosition % _bitCount;
	int32_t byteIndex = bitPos >> 3;
	//uint8_t bitInByte = bitPos - (byteIndex << 3);
	uint8_t bitInByte = bitPos % 8;



#if 0
	if (bitPos == 0)
	{
		_console->PrintOut("bitpos == 0\n");
	}
#endif

	uint8_t b = _trackData[byteIndex];

#if 0
	char buf[255];
	sprintf_s(buf, 255, "%d\r\n", byteIndex);
	OutputDebugStringA(buf);
#endif


	b = b << bitInByte;
 
	return (b & 0x80);
}