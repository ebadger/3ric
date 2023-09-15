// memory_map_test.cpp : This file contains the 'main' function. Program execution begins and ends there.
//

#include <iostream>
#include <vector>

using namespace std;

#define BIT(a,b) !!((a & b) != 0)
typedef enum PIN
{
	BB =  1 << 0,
	B2 =  1 << 1,
	BRW = 1 << 2,
	BRR = 1 << 3,
	RW  = 1 << 4,
	MAX = 1 << 5
}PIN;

const wchar_t* _pinTags[] = {L"BB", L"B2", L"BRW", L"BRR", L"RW"};

typedef struct Result
{
	uint16_t pins;
	uint16_t addr;
	bool rom;
	bool ram;
	bool dev;
	bool a16;
}Result;

std::vector<Result> _results[32];


int main()
{
	bool rom = false;
	bool ram = false;
	bool dev = false;
	int pos = 0;
	
	for (int p = 0; p < 32; p++)
	{
		bool a[17] = { false };

		for (uint32_t addr = 0; addr <= 0xFFFF; addr++)
		{
			// populate the address bits
			for (int i = 0; i < 16; i++)
			{
				a[i] = (addr >> i) & 1;
			}

			dev = (a[11] || a[12] || a[13]) || !(a[14] && a[15]);

			rom = (!(a[14] && a[15])
				|| (!a[12] && !a[13])
				|| (BIT(p,BRR) && BIT(p,RW))
				|| (BIT(p,BRW) && !(BIT(p,RW))))
				&&
				!((a[13] || a[12]) && a[15]
					&& BIT(p,BB)
					&& !a[14]);

			ram = !(dev && rom);

			a[16] = ((BIT(p,BRR) && BIT(p,RW)) || (BIT(p, BRW) && !BIT(p,RW)))
				&& BIT(p,B2)
				&& (!a[13] && a[14])
				&& (a[14] && a[15] && a[12]);

			Result r;
			r.addr = addr;
			r.pins = p;
			r.ram = ram;
			r.rom = rom;
			r.dev = dev;
			r.a16 = a[16];
			_results[p].push_back(r);
		}
	}

	for (auto r : _results)
	{
		wstring tags;
		uint32_t minaddr = UINT_MAX;
		uint32_t maxaddr = UINT_MAX;
		Result result = {};
		result.addr = 0xFFFF;
		
		
		for (auto v : r)
		{
			if (   result.rom != v.rom
				|| result.ram != v.ram
				|| result.dev != v.dev
				|| result.a16 != v.a16
				|| result.addr +1 != v.addr )
			{
				if (minaddr == UINT_MAX)
				{
					minaddr = v.addr;
				}
				else if (maxaddr == UINT_MAX)
				{
					maxaddr = v.addr;
				}

				tags.clear();
				for (int i = 0; i < 5; i++)
				{
					if ((result.pins >> i) & 1)
					{
						tags.append(_pinTags[i]);
						tags.append(L" ");
					}
				}

				if (maxaddr != UINT_MAX)
				{
					wprintf(L"%20s: %04x - %04x, Rom:%d, Ram:%d, Dev:%d, A16:%d\r\n", tags.c_str(), minaddr, result.addr, result.rom, result.ram, result.dev, result.a16);
					minaddr = v.addr;
					maxaddr = UINT_MAX;
				}

				// switch range
			}

			result = v;
		}
		wprintf(L"%20s: %04x - %04x, Rom:%d, Ram:%d, Dev:%d, A16:%d\r\n", tags.c_str(), minaddr, result.addr, result.rom, result.ram, result.dev, result.a16);

		pos++;
	}
 }
