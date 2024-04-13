#include "wozfile.h"

const char* c_WOZHeader = "WOZ2";

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
	for (int i = _vecChunks.size() - 1; i >= 0; i--)
	{
		Chunk *p = _vecChunks[i];
		delete p;
	}

	if (_wozFile != nullptr)
	{
		fclose(_wozFile);
	}
}

uint32_t WozFile::OpenFile(const char * szFileName)
{
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
	if (read != 1) {
		perror("Error reading data");
		fclose(_wozFile);
		_wozFile = nullptr;
		return 1;
	}

	// validate the header
	// for now only support Woz2.x format
	if (strncmp(c_WOZHeader, buffer, 4) != 0)
	{
		// header mismatch
		// not a valid WOZ file
		return INVALID_WOZ_FILE;
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
	if (read != 1) {
		fclose(_wozFile);
		_wozFile = nullptr;
		return INVALID_INFO_CHUNK;
	}


	read = fread_s(&pChunk->ChunkSize, sizeof(pChunk->ChunkSize), sizeof(pChunk->ChunkSize), 1, _wozFile);
	if (read != 1) {
		fclose(_wozFile);
		_wozFile = nullptr;
		return INVALID_INFO_CHUNK;
	}

	if (pChunk->ChunkID.value == Chunk::INFO_CHUNK_ID)
	{
		_InfoChunk = pChunk;
		_InfoChunk->ChunkData.resize(_InfoChunk->ChunkSize);

		read = fread_s(_InfoChunk->ChunkData.data(),
			_InfoChunk->ChunkData.size(),
			_InfoChunk->ChunkData.size(),
			1,
			_wozFile);

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
	}
	else if (pChunk->ChunkID.value == Chunk::TRKS_CHUNK_ID)
	{
		_TrksChunk = pChunk;
	}
	else if (pChunk->ChunkID.value == Chunk::WRIT_CHUNK_ID)
	{

	}
	else if (pChunk->ChunkID.value == Chunk::FLUX_CHUNK_ID)
	{

	}
	else
	{
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
