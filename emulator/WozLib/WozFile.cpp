#include "wozfile.h"
#include <Windows.h>
#include <debugapi.h>

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

void WozFile::CloseFile()
{
	std::lock_guard<std::mutex> guard(_mutex);

	_track = -1;

	_vecChunks.clear();
	_trackData.clear();
	_bitData.clear();

	if (_wozFile != nullptr)
	{
		fclose(_wozFile);
		_wozFile = nullptr;
	}

	_InfoChunk = nullptr;
	_MetaChunk = nullptr;
	_TrksChunk = nullptr;
	_TmapChunk = nullptr;
	_Trk = nullptr;
	_Tmap = nullptr;

}

bool WozFile::IsFileLoaded()
{
	return _wozFile != nullptr;
}

uint32_t WozFile::OpenFile(const char * szFileName)
{
	std::lock_guard<std::mutex> guard(_mutex);

	errno_t err = fopen_s(&_wozFile, szFileName, "rb");

	if (err != 0 || nullptr == _wozFile)
	{
		goto exit;
	}

	err = ReadFileHeader();
	if (err != 0 || nullptr == _wozFile)
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

uint32_t WozFile::ReadFileHeader()
{
	char buffer[12];

	if (!_wozFile)
	{
		return INVALID_WOZ_FILE;
	}

	fseek(_wozFile, 0L, SEEK_END);
	_fileEnd = ftell(_wozFile);
	fseek(_wozFile, 0L, SEEK_SET); // Reset to the beginning

	// read the header
	size_t read = fread_s(buffer, sizeof(buffer), sizeof(buffer), 1, _wozFile);
	_ASSERT(read == 1);
	if (read != 1) {
		perror("Error reading data");
		fclose(_wozFile);
		_wozFile = nullptr;
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

uint32_t WozFile::ReadChunks()
{

	if (nullptr == _wozFile)
	{
		return INVALID_WOZ_FILE;
	}

	Chunk *pChunk = new Chunk();
	pChunk->FileOffset = ftell(_wozFile) + 8;

	size_t read = fread_s(pChunk->ChunkID.text, sizeof(pChunk->ChunkID.text), sizeof(pChunk->ChunkID.text), 1, _wozFile);
	_ASSERT(read == 1);
	if (read != 1) {
		fclose(_wozFile);
		_wozFile = nullptr;
		return INVALID_INFO_CHUNK;
	}


	read = fread_s(&pChunk->ChunkSize, sizeof(pChunk->ChunkSize), sizeof(pChunk->ChunkSize), 1, _wozFile);
	_ASSERT(read == 1);
	if (read != 1) {
		fclose(_wozFile);
		_wozFile = nullptr;
		return INVALID_INFO_CHUNK;
	}

	if (pChunk->ChunkID.value == Chunk::INFO_CHUNK_ID)
	{
		_InfoChunk = pChunk;
		_InfoChunk->ChunkData.resize(_InfoChunk->ChunkSize, 0);

		read = fread_s(_InfoChunk->ChunkData.data(),
			_InfoChunk->ChunkData.size(),
			_InfoChunk->ChunkData.size(),
			1,
			_wozFile);

		_ASSERT(read == 1);

		if (read != 1) {
			fclose(_wozFile);
			_wozFile = nullptr;
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

		read = fread_s(_TmapChunk->ChunkData.data(),
			_TmapChunk->ChunkData.size(),
			_TmapChunk->ChunkData.size(),
			1,
			_wozFile);

		_ASSERT(read == 1);

		if (read != 1) {
			fclose(_wozFile);
			_wozFile = nullptr;
			return INVALID_TMAP_CHUNK_DATA;
		}

		_Tmap = _TmapChunk->ChunkData.data();
	}
	else if (pChunk->ChunkID.value == Chunk::TRKS_CHUNK_ID)
	{
		_TrksChunk = pChunk;

		if (160 * sizeof(TRK) > _TrksChunk->ChunkSize)
		{
			fclose(_wozFile);
			_wozFile = nullptr;
			return INVALID_TRKS_CHUNK_DATA;
		}

		uint32_t TrksSize = 160 * sizeof(TRK);
		_TrksChunk->ChunkData.resize(TrksSize, 0);

		read = fread_s(_TrksChunk->ChunkData.data(),
			TrksSize,
			TrksSize,
			1,
			_wozFile);

		_ASSERT(read == 1);

		if (read != 1) {
			fclose(_wozFile);
			_wozFile = nullptr;
			return INVALID_TRKS_CHUNK_DATA;
		}

		_Trk = (TRK*)_TrksChunk->ChunkData.data();

		// advance past the track bits
		fseek(_wozFile, pChunk->ChunkSize - TrksSize, SEEK_CUR);

	}
	else if (pChunk->ChunkID.value == Chunk::WRIT_CHUNK_ID)
	{

	}
	else if (pChunk->ChunkID.value == Chunk::FLUX_CHUNK_ID)
	{

	}
	else
	{
		_ASSERT(false);
		printf("Unknown chunk: %s\r\n", pChunk->ChunkID.text);
	}

	_vecChunks.push_back(pChunk);

	if (pChunk->ChunkData.size() == 0)
	{
		// chunk is not loaded, skip the data to get to the next chunk
		fseek(_wozFile, pChunk->ChunkSize, SEEK_CUR);
	}

	if (ftell(_wozFile) == _fileEnd)
	{
		return END_OF_WOZFILE;
	}

	return 0;
}


InfoChunkData* WozFile::GetInfoChunkData()
{
	if (nullptr == _wozFile || !_InfoChunk)
	{
		return nullptr;
	}

	return (InfoChunkData*)_InfoChunk->ChunkData.data();
}

void WozFile::SetTrack(int16_t track)
{
	std::lock_guard<std::mutex> guard(_mutex);
	size_t read = 0;

	_ASSERT(track < 160);
	_ASSERT(_wozFile != nullptr);

	if (_wozFile == nullptr)
	{
		return;
	}

	if (track > 159 || _track == track)
	{
		return;
	}

	_track = track;

	char buf[255];
	sprintf_s(buf, 255, "TrackIndex: %d\r\n", _track);
	OutputDebugStringA(buf);

	uint8_t trkIndex = _Tmap[track];
	if (trkIndex > 159)
	{
		_bitCount = 0;
		return;
	}

	sprintf_s(buf, 255, "Logical Track: %d\r\n", trkIndex);
	OutputDebugStringA(buf);

	_bitCount = _Trk[trkIndex].BitCount;
	uint32_t offset = _Trk[trkIndex].StartingBlock << 9;
	uint16_t blocks = _Trk[trkIndex].BlockCount;
	uint16_t largest = GetInfoChunkData()->LargestTrack;

	_ASSERT(offset != 0 && blocks != 0);

	_trackData.resize(largest << 9, 0);
	_bitData.resize(largest << 12, 0);

	// read the track

	fseek(_wozFile, offset, SEEK_SET);

	read = fread_s(_trackData.data(),
		blocks << 9,
		blocks << 9,
		1,
		_wozFile);

	_ASSERT(read == 1);

	if (read != 1) {
		fclose(_wozFile);
		_wozFile = nullptr;
		return;
	}

	int bitcount = 0;
	for (int n = 0; n < _trackData.size(); n++)
	{
		uint8_t b = _trackData[n];

		for (int i = 7; i >= 0; i--)
		{
			_bitData[bitcount++] = (b >> i) & 1;
		}

	}

	sprintf_s(buf, _countof(buf), "_trackData[0]=$%02x, %d %d %d %d %d %d %d %d\r\n",
		_trackData[0],
		_bitData[0], _bitData[1], _bitData[2], _bitData[3], _bitData[4],
		_bitData[5], _bitData[6], _bitData[7]);
	OutputDebugStringA(buf);
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

	return _bitData[_readPosition++] > 0 ? true : false;
}

bool WozFile::GetNextBit()
{
	std::lock_guard<std::mutex> guard(_mutex);

	if (_bitCount == 0)
	{
		return rand() % 2;
	}

	_readPosition++;

	int32_t bitPos = _readPosition % _bitCount;
	int32_t byteIndex = bitPos >> 3;
	uint8_t bitInByte = bitPos - (byteIndex << 3);

#if 0
	if (bitPos == 0)
	{
		OutputDebugStringA("****** bitpos == 0 ******");
	}
#endif


	uint8_t b = _trackData.data()[byteIndex];

#if 0
	char buf[255];
	sprintf_s(buf, 255, "%d\r\n", byteIndex);
	OutputDebugStringA(buf);
#endif


	b = b << bitInByte;
 
	return (b & 0x80);
}