#include <Windows.h>
#include <stdlib.h>
#include <stdio.h>
#include <wozfile.h>

typedef struct TestData
{
	char fileName[MAX_PATH];
} TestData;

std::vector<TestData> _testData;

int main(int, char**)
{
	uint32_t result = 0;
	_testData.push_back({ "TestData\\WOZ 2.0\\Dino Eggs - Disk 1, Side A.woz" });
	_testData.push_back({ "TestData\\WOZ 2.0\\Blazing Paddles (Baudville).woz" });
	_testData.push_back({ "TestData\\WOZ 2.0\\Border Zone - Disk 1, Side A.woz" });
	_testData.push_back({ "TestData\\WOZ 2.0\\Border Zone - Disk 1, Side B.woz" });
	_testData.push_back({ "TestData\\WOZ 2.0\\Bouncing Kamungas - Disk 1, Side A.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\Commando - Disk 1, Side A.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\Crisis Mountain - Disk 1, Side A.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\Dino Eggs - Disk 1, Side A.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\DOS 3.2 System Master.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\DOS 3.3 System Master.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\First Math Adventures - Understanding Word Problems.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\Hard Hat Mack - Disk 1, Side A.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\Miner 2049er II - Disk 1, Side A.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\Planetfall - Disk 1, Side A.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\Rescue Raiders - Disk 1, Side B.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\Sammy Lightfoot - Disk 1, Side A.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\Stargate - Disk 1, Side A.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\Stickybear Town Builder - Disk 1, Side A.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\Take 1 (Baudville).woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\The Apple at Play.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\The Bilestoad - Disk 1, Side A.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\The Print Shop Companion - Disk 1, Side A.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\Wings of Fury - Disk 1, Side A.woz"});
	_testData.push_back({ "TestData\\WOZ 2.0\\Wings of Fury - Disk 1, Side B.woz"});
	_testData.push_back({ "TestData\\WOZ 2.1 (with FLUX chunks)\\ProDOS User's Disk - Disk 1, Side A.woz" });

	char path[MAX_PATH];
	GetCurrentDirectoryA(MAX_PATH, path);

	for (TestData t : _testData)
	{
		WozFile wozFile;

		result = wozFile.OpenFile(t.fileName);

		if (result != END_OF_WOZFILE)
		{
			printf("Error: 0x%08x\r\n", result);
		}

		InfoChunkData* pInfo = wozFile.GetInfoChunkData();
	}
	
	return result;
}