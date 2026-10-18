#include "pch.h"
#include "CppUnitTest.h"
#include "WozFile.h"

#include <Windows.h>
#include <cstdio>
#include <cstring>
#include <memory>

using namespace Microsoft::VisualStudio::CppUnitTestFramework;

namespace
{
	using Bytes = std::vector<uint8_t>;

	void Write16(Bytes& bytes, size_t at, uint16_t value)
	{
		bytes[at] = uint8_t(value);
		bytes[at + 1] = uint8_t(value >> 8);
	}

	void Write32(Bytes& bytes, size_t at, uint32_t value)
	{
		Write16(bytes, at, uint16_t(value));
		Write16(bytes, at + 2, uint16_t(value >> 16));
	}

	void Tag(Bytes& bytes, size_t at, const char* tag)
	{
		memcpy(bytes.data() + at, tag, 4);
	}

	Bytes Image()
	{
		Bytes bytes(2048, 0);
		const uint8_t header[] = { 'W', 'O', 'Z', '2', 0xFF, 0x0A, 0x0D, 0x0A };
		memcpy(bytes.data(), header, sizeof(header));
		Tag(bytes, 12, "INFO");
		Write32(bytes, 16, 60);
		bytes[20] = 2;
		bytes[21] = 1;
		bytes[57] = 1;
		bytes[59] = 32;
		Write16(bytes, 64, 1);
		Tag(bytes, 80, "TMAP");
		Write32(bytes, 84, 160);
		memset(bytes.data() + 88, 0xFF, 160);
		bytes[88] = bytes[89] = 0;
		Tag(bytes, 248, "TRKS");
		Write32(bytes, 252, 1792);
		Write16(bytes, 256, 3);
		Write16(bytes, 258, 1);
		Write32(bytes, 260, 8);
		bytes[1536] = 0x96;
		return bytes;
	}

	void AddCrc(Bytes& bytes)
	{
		uint32_t crc = 0xFFFFFFFF;
		for (size_t at = 12; at < bytes.size(); ++at)
		{
			crc ^= bytes[at];
			for (int bit = 0; bit < 8; ++bit)
			{
				crc = (crc >> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
			}
		}
		Write32(bytes, 8, ~crc);
	}

	class TempImage
	{
	public:
		explicit TempImage(const Bytes& bytes)
		{
			char directory[MAX_PATH];
			const DWORD size = GetTempPathA(MAX_PATH, directory);
			Assert::IsTrue(size > 0 && size < MAX_PATH);
			Assert::IsTrue(GetTempFileNameA(directory, "woz", 0, _path) != 0);
			Replace(bytes);
		}

		~TempImage() { DeleteFileA(_path); }
		const char* Path() const { return _path; }

		void Replace(const Bytes& bytes)
		{
			FILE* raw = nullptr;
			Assert::AreEqual(0, fopen_s(&raw, _path, "wb"));
			std::unique_ptr<FILE, decltype(&fclose)> file(raw, fclose);
			Assert::IsTrue(fwrite(bytes.data(), 1, bytes.size(), file.get()) == bytes.size());
		}

	private:
		char _path[MAX_PATH] = {};
	};

	void CheckBits(WozFile& disk)
	{
		disk.SetTrack(0);
		for (int bit = 0; bit < 24; ++bit)
		{
			Assert::AreEqual((0x96 & (0x80 >> (bit % 8))) != 0, disk.GetNextBit2());
		}
	}
}

namespace Badger6502VMTest
{
	TEST_CLASS(WozFileTests)
	{
	public:
		TEST_METHOD(ReadsValidatedBitstreamsAndKeepsAnImmutableSnapshot)
		{
			TempImage file(Image());
			WozFile disk;
			Assert::IsTrue(disk.OpenFile(file.Path()) == END_OF_WOZFILE);
			CheckBits(disk);
			file.Replace(Bytes(12, 0));
			disk.SetTrack(1);
			CheckBits(disk);
			disk.SetTrack(-1);
			disk.SetTrack(160);
			Assert::IsTrue(disk.IsFileLoaded());
		}

		TEST_METHOD(ChecksCrcWhenPresentAndAcceptsItsDocumentedOmission)
		{
			Bytes bytes = Image();
			AddCrc(bytes);
			TempImage file(bytes);
			WozFile disk;
			Assert::IsTrue(disk.OpenFile(file.Path()) == END_OF_WOZFILE);
			CheckBits(disk);
			bytes[1536] ^= 1;
			file.Replace(bytes);
			Assert::IsTrue(disk.OpenFile(file.Path()) == INVALID_WOZ_CRC);
			Assert::IsFalse(disk.IsFileLoaded());
			Write32(bytes, 8, 0);
			file.Replace(bytes);
			Assert::IsTrue(disk.OpenFile(file.Path()) == END_OF_WOZFILE);
		}

		TEST_METHOD(RejectsMalformedTablesAndTrackBoundsWithoutRetainingState)
		{
			struct Mutation { const wchar_t* name; void (*change)(Bytes&); };
			const Mutation cases[] = {
				{ L"header only", [](Bytes& b) { b.resize(12); } },
				{ L"bad signature", [](Bytes& b) { b[4] = 0; } },
				{ L"truncated chunk header", [](Bytes& b) { b.resize(16); } },
				{ L"truncated chunk data", [](Bytes& b) { b.resize(2047); } },
				{ L"huge chunk", [](Bytes& b) { Write32(b, 16, 0xFFFFFFFF); } },
				{ L"missing INFO", [](Bytes& b) { Tag(b, 12, "SKIP"); } },
				{ L"missing TMAP", [](Bytes& b) { Tag(b, 80, "SKIP"); } },
				{ L"missing TRKS", [](Bytes& b) { Tag(b, 248, "SKIP"); } },
				{ L"short INFO", [](Bytes& b) { Write32(b, 16, 0); } },
				{ L"short TMAP", [](Bytes& b) { Write32(b, 84, 159); } },
				{ L"short TRKS", [](Bytes& b) { Write32(b, 252, 1279); } },
				{ L"duplicate INFO", [](Bytes& b) { b.resize(2116); Tag(b, 2048, "INFO"); Write32(b, 2052, 60); } },
				{ L"invalid map index", [](Bytes& b) { b[88] = 160; } },
				{ L"missing mapped track", [](Bytes& b) { b[88] = 1; } },
				{ L"zero largest track", [](Bytes& b) { Write16(b, 64, 0); } },
				{ L"huge largest track", [](Bytes& b) { Write16(b, 64, 0xFFFF); } },
				{ L"track in header", [](Bytes& b) { Write16(b, 256, 1); } },
				{ L"track past EOF", [](Bytes& b) { Write16(b, 256, 0xFFFF); } },
				{ L"zero blocks", [](Bytes& b) { Write16(b, 258, 0); } },
				{ L"oversized track", [](Bytes& b) { Write16(b, 258, 2); Write16(b, 64, 2); } },
				{ L"zero bits", [](Bytes& b) { Write32(b, 260, 0); } },
				{ L"bits past blocks", [](Bytes& b) { Write32(b, 260, 4097); } },
				{ L"invalid unreferenced track", [](Bytes& b) { Write32(b, 268, 1); } },
			};
			WozFile disk;
			for (const auto& item : cases)
			{
				Bytes bytes = Image();
				item.change(bytes);
				TempImage file(bytes);
				Assert::IsTrue(disk.OpenFile(file.Path()) != END_OF_WOZFILE, item.name);
				Assert::IsFalse(disk.IsFileLoaded(), item.name);
				Assert::IsNull(disk.GetInfoChunkData(), item.name);
				disk.SetTrack(0);
				disk.GetNextBit();
				disk.GetNextBit2();
				file.Replace(Image());
				Assert::IsTrue(disk.OpenFile(file.Path()) == END_OF_WOZFILE, item.name);
				CheckBits(disk);
			}
			disk.CloseFile();
			Assert::IsFalse(disk.IsFileLoaded());
			Assert::IsNull(disk.GetInfoChunkData());
			disk.GetNextBit2();
		}

		TEST_METHOD(RejectsUnsupportedFormats)
		{
			Bytes bytes = Image();
			TempImage file(bytes);
			WozFile disk;
			bytes[3] = '1';
			file.Replace(bytes);
			Assert::IsTrue(disk.OpenFile(file.Path()) == UNSUPPORTED_WOZ_FORMAT);
			bytes = Image();
			bytes[21] = 2;
			file.Replace(bytes);
			Assert::IsTrue(disk.OpenFile(file.Path()) == UNSUPPORTED_WOZ_FORMAT);
			bytes = Image();
			bytes[20] = 1;
			file.Replace(bytes);
			Assert::IsTrue(disk.OpenFile(file.Path()) == UNSUPPORTED_WOZ_FORMAT);
			bytes = Image();
			bytes[20] = 3;
			file.Replace(bytes);
			Assert::IsTrue(disk.OpenFile(file.Path()) == END_OF_WOZFILE);
			Write16(bytes, 66, 4);
			Write16(bytes, 68, 1);
			file.Replace(bytes);
			Assert::IsTrue(disk.OpenFile(file.Path()) == UNSUPPORTED_WOZ_FORMAT);
			bytes = Image();
			bytes.resize(2056);
			Tag(bytes, 2048, "FLUX");
			file.Replace(bytes);
			Assert::IsTrue(disk.OpenFile(file.Path()) == UNSUPPORTED_WOZ_FORMAT);
		}

		TEST_METHOD(EnforcesTheInclusiveEightMiBLimitAndSkipsOptionalChunks)
		{
			Assert::IsTrue(WozFile::MaxFileSize == 8 * 1024 * 1024);
			Bytes bytes = Image();
			bytes.resize(WozFile::MaxFileSize);
			Tag(bytes, 2048, "META");
			Write32(bytes, 2052, WozFile::MaxFileSize - 2056);
			TempImage file(bytes);
			WozFile disk;
			Assert::IsTrue(disk.OpenFile(file.Path()) == END_OF_WOZFILE);
			CheckBits(disk);
			bytes.push_back(0);
			file.Replace(bytes);
			Assert::IsTrue(disk.OpenFile(file.Path()) == INVALID_WOZ_SIZE);
			Assert::IsFalse(disk.IsFileLoaded());
		}
	};
}
