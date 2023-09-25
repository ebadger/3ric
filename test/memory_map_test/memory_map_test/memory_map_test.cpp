// memory_map_test.cpp : This file contains the 'main' function. Program execution begins and ends there.
//

#include <iostream>
#include <vector>

using namespace std;

const bool _dump_struct = false;
const bool _dump_readable = false;
const bool _test_expected = true;
const bool _gen_22v10_testdata = true;

#define BIT(a,b) !!((a & b) != 0)

#define PIN2BUF(_A) { \
                    if(_A) { buf[pos] = L'1'; \
                   } else { \
                    buf[pos] = L'0'; } pos++; \
                   }

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

typedef struct Expected
{
	uint16_t start;
	uint16_t end;
	uint16_t pins;
	bool rom;
	bool ram;
	bool dev;
	bool a16;
} Expected;


std::vector<Result> _results[32];

const Expected _expected[] = {
    {0x0000,0xbfff,0x0000,1,0,1,0},
    {0xc000,0xc7ff,0x0000,1,1,0,0},
    {0xc800,0xcfff,0x0000,1,0,1,0},
    {0xd000,0xffff,0x0000,0,1,1,0},
    {0x0000,0x8fff,0x0001,1,0,1,0},
    {0x9000,0xbfff,0x0001,0,1,1,0},
    {0xc000,0xc7ff,0x0001,1,1,0,0},
    {0xc800,0xcfff,0x0001,1,0,1,0},
    {0xd000,0xffff,0x0001,0,1,1,0},
    {0x0000,0xbfff,0x0002,1,0,1,0},
    {0xc000,0xc7ff,0x0002,1,1,0,0},
    {0xc800,0xcfff,0x0002,1,0,1,0},
    {0xd000,0xffff,0x0002,0,1,1,0},
    {0x0000,0x8fff,0x0003,1,0,1,0},
    {0x9000,0xbfff,0x0003,0,1,1,0},
    {0xc000,0xc7ff,0x0003,1,1,0,0},
    {0xc800,0xcfff,0x0003,1,0,1,0},
    {0xd000,0xffff,0x0003,0,1,1,0},
    {0x0000,0xbfff,0x0004,1,0,1,0},
    {0xc000,0xc7ff,0x0004,1,1,0,0},
    {0xc800,0xffff,0x0004,1,0,1,0},
    {0x0000,0x8fff,0x0005,1,0,1,0},
    {0x9000,0xbfff,0x0005,0,1,1,0},
    {0xc000,0xc7ff,0x0005,1,1,0,0},
    {0xc800,0xffff,0x0005,1,0,1,0},
    {0x0000,0xbfff,0x0006,1,0,1,0},
    {0xc000,0xc7ff,0x0006,1,1,0,0},
    {0xc800,0xcfff,0x0006,1,0,1,0},
    {0xd000,0xdfff,0x0006,1,0,1,1},
    {0xe000,0xffff,0x0006,1,0,1,0},
    {0x0000,0x8fff,0x0007,1,0,1,0},
    {0x9000,0xbfff,0x0007,0,1,1,0},
    {0xc000,0xc7ff,0x0007,1,1,0,0},
    {0xc800,0xcfff,0x0007,1,0,1,0},
    {0xd000,0xdfff,0x0007,1,0,1,1},
    {0xe000,0xffff,0x0007,1,0,1,0},
    {0x0000,0xbfff,0x0008,1,0,1,0},
    {0xc000,0xc7ff,0x0008,1,1,0,0},
    {0xc800,0xcfff,0x0008,1,0,1,0},
    {0xd000,0xffff,0x0008,0,1,1,0},
    {0x0000,0x8fff,0x0009,1,0,1,0},
    {0x9000,0xbfff,0x0009,0,1,1,0},
    {0xc000,0xc7ff,0x0009,1,1,0,0},
    {0xc800,0xcfff,0x0009,1,0,1,0},
    {0xd000,0xffff,0x0009,0,1,1,0},
    {0x0000,0xbfff,0x000a,1,0,1,0},
    {0xc000,0xc7ff,0x000a,1,1,0,0},
    {0xc800,0xcfff,0x000a,1,0,1,0},
    {0xd000,0xffff,0x000a,0,1,1,0},
    {0x0000,0x8fff,0x000b,1,0,1,0},
    {0x9000,0xbfff,0x000b,0,1,1,0},
    {0xc000,0xc7ff,0x000b,1,1,0,0},
    {0xc800,0xcfff,0x000b,1,0,1,0},
    {0xd000,0xffff,0x000b,0,1,1,0},
    {0x0000,0xbfff,0x000c,1,0,1,0},
    {0xc000,0xc7ff,0x000c,1,1,0,0},
    {0xc800,0xffff,0x000c,1,0,1,0},
    {0x0000,0x8fff,0x000d,1,0,1,0},
    {0x9000,0xbfff,0x000d,0,1,1,0},
    {0xc000,0xc7ff,0x000d,1,1,0,0},
    {0xc800,0xffff,0x000d,1,0,1,0},
    {0x0000,0xbfff,0x000e,1,0,1,0},
    {0xc000,0xc7ff,0x000e,1,1,0,0},
    {0xc800,0xcfff,0x000e,1,0,1,0},
    {0xd000,0xdfff,0x000e,1,0,1,1},
    {0xe000,0xffff,0x000e,1,0,1,0},
    {0x0000,0x8fff,0x000f,1,0,1,0},
    {0x9000,0xbfff,0x000f,0,1,1,0},
    {0xc000,0xc7ff,0x000f,1,1,0,0},
    {0xc800,0xcfff,0x000f,1,0,1,0},
    {0xd000,0xdfff,0x000f,1,0,1,1},
    {0xe000,0xffff,0x000f,1,0,1,0},
    {0x0000,0xbfff,0x0010,1,0,1,0},
    {0xc000,0xc7ff,0x0010,1,1,0,0},
    {0xc800,0xcfff,0x0010,1,0,1,0},
    {0xd000,0xffff,0x0010,0,1,1,0},
    {0x0000,0x8fff,0x0011,1,0,1,0},
    {0x9000,0xbfff,0x0011,0,1,1,0},
    {0xc000,0xc7ff,0x0011,1,1,0,0},
    {0xc800,0xcfff,0x0011,1,0,1,0},
    {0xd000,0xffff,0x0011,0,1,1,0},
    {0x0000,0xbfff,0x0012,1,0,1,0},
    {0xc000,0xc7ff,0x0012,1,1,0,0},
    {0xc800,0xcfff,0x0012,1,0,1,0},
    {0xd000,0xffff,0x0012,0,1,1,0},
    {0x0000,0x8fff,0x0013,1,0,1,0},
    {0x9000,0xbfff,0x0013,0,1,1,0},
    {0xc000,0xc7ff,0x0013,1,1,0,0},
    {0xc800,0xcfff,0x0013,1,0,1,0},
    {0xd000,0xffff,0x0013,0,1,1,0},
    {0x0000,0xbfff,0x0014,1,0,1,0},
    {0xc000,0xc7ff,0x0014,1,1,0,0},
    {0xc800,0xcfff,0x0014,1,0,1,0},
    {0xd000,0xffff,0x0014,0,1,1,0},
    {0x0000,0x8fff,0x0015,1,0,1,0},
    {0x9000,0xbfff,0x0015,0,1,1,0},
    {0xc000,0xc7ff,0x0015,1,1,0,0},
    {0xc800,0xcfff,0x0015,1,0,1,0},
    {0xd000,0xffff,0x0015,0,1,1,0},
    {0x0000,0xbfff,0x0016,1,0,1,0},
    {0xc000,0xc7ff,0x0016,1,1,0,0},
    {0xc800,0xcfff,0x0016,1,0,1,0},
    {0xd000,0xffff,0x0016,0,1,1,0},
    {0x0000,0x8fff,0x0017,1,0,1,0},
    {0x9000,0xbfff,0x0017,0,1,1,0},
    {0xc000,0xc7ff,0x0017,1,1,0,0},
    {0xc800,0xcfff,0x0017,1,0,1,0},
    {0xd000,0xffff,0x0017,0,1,1,0},
    {0x0000,0xbfff,0x0018,1,0,1,0},
    {0xc000,0xc7ff,0x0018,1,1,0,0},
    {0xc800,0xffff,0x0018,1,0,1,0},
    {0x0000,0x8fff,0x0019,1,0,1,0},
    {0x9000,0xbfff,0x0019,0,1,1,0},
    {0xc000,0xc7ff,0x0019,1,1,0,0},
    {0xc800,0xffff,0x0019,1,0,1,0},
    {0x0000,0xbfff,0x001a,1,0,1,0},
    {0xc000,0xc7ff,0x001a,1,1,0,0},
    {0xc800,0xcfff,0x001a,1,0,1,0},
    {0xd000,0xdfff,0x001a,1,0,1,1},
    {0xe000,0xffff,0x001a,1,0,1,0},
    {0x0000,0x8fff,0x001b,1,0,1,0},
    {0x9000,0xbfff,0x001b,0,1,1,0},
    {0xc000,0xc7ff,0x001b,1,1,0,0},
    {0xc800,0xcfff,0x001b,1,0,1,0},
    {0xd000,0xdfff,0x001b,1,0,1,1},
    {0xe000,0xffff,0x001b,1,0,1,0},
    {0x0000,0xbfff,0x001c,1,0,1,0},
    {0xc000,0xc7ff,0x001c,1,1,0,0},
    {0xc800,0xffff,0x001c,1,0,1,0},
    {0x0000,0x8fff,0x001d,1,0,1,0},
    {0x9000,0xbfff,0x001d,0,1,1,0},
    {0xc000,0xc7ff,0x001d,1,1,0,0},
    {0xc800,0xffff,0x001d,1,0,1,0},
    {0x0000,0xbfff,0x001e,1,0,1,0},
    {0xc000,0xc7ff,0x001e,1,1,0,0},
    {0xc800,0xcfff,0x001e,1,0,1,0},
    {0xd000,0xdfff,0x001e,1,0,1,1},
    {0xe000,0xffff,0x001e,1,0,1,0},
    {0x0000,0x8fff,0x001f,1,0,1,0},
    {0x9000,0xbfff,0x001f,0,1,1,0},
    {0xc000,0xc7ff,0x001f,1,1,0,0},
    {0xc800,0xcfff,0x001f,1,0,1,0},
    {0xd000,0xdfff,0x001f,1,0,1,1},
    {0xe000,0xffff,0x001f,1,0,1,0}
};

void TestLogic()
{
    bool rom = false;
    bool ram = false;
    bool dev = false;
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
                || (BIT(p, BRR) && BIT(p, RW))
                || (BIT(p, BRW) && !(BIT(p, RW))))
                &&
                !((a[13] || a[12]) && a[15]
                    && BIT(p, BB)
                    && !a[14]);

            ram = !(dev && rom);

            a[16] = ((BIT(p, BRR) && BIT(p, RW)) || (BIT(p, BRW) && !BIT(p, RW)))
                && BIT(p, B2)
                && !a[13]
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

}

void ValidateData()
{
    int errors = 0;
    int pos = 0;

    for (auto r : _results)
    {
        wstring tags;
        uint32_t minaddr = UINT_MAX;
        uint32_t maxaddr = UINT_MAX;
        Result result = {};
        result.addr = 0xFFFF;


        for (auto v : r)
        {
            if (result.rom != v.rom
                || result.ram != v.ram
                || result.dev != v.dev
                || result.a16 != v.a16
                || result.addr + 1 != v.addr)
            {
                if (minaddr == UINT_MAX)
                {
                    minaddr = v.addr;
                }
                else if (maxaddr == UINT_MAX)
                {
                    maxaddr = v.addr;
                }

                if (_dump_readable || _test_expected)
                {
                    tags.clear();
                    for (int i = 0; i < 5; i++)
                    {
                        if ((result.pins >> i) & 1)
                        {
                            tags.append(_pinTags[i]);
                            tags.append(L" ");
                        }
                    }
                }

                if (maxaddr != UINT_MAX)
                {
                    if (_test_expected)
                    {
                        Expected ex = {};
                        ex.start = minaddr;
                        ex.end = result.addr;
                        ex.pins = result.pins;
                        ex.rom = result.rom;
                        ex.ram = result.ram;
                        ex.dev = result.dev;
                        ex.a16 = result.a16;

                        if (memcmp(&_expected[pos++], &ex, sizeof(Expected)))
                        {
                            errors++;
                            // error, unexpected value
                            wprintf(L"%20s: %04x - %04x, Rom:%d, Ram:%d, Dev:%d, A16:%d\r\n", tags.c_str(), minaddr, result.addr, result.rom, result.ram, result.dev, result.a16);
                        }
                    }

                    if (_dump_struct)
                    {
                        wprintf(L"    {0x%04x,0x%04x,0x%04x,%d,%d,%d,%d},\r\n",
                            minaddr,
                            result.addr,
                            result.pins,
                            result.rom,
                            result.ram,
                            result.dev,
                            result.a16);
                    }

                    if (_dump_readable)
                    {
                        wprintf(L"%20s: %04x - %04x, Rom:%d, Ram:%d, Dev:%d, A16:%d\r\n", tags.c_str(), minaddr, result.addr, result.rom, result.ram, result.dev, result.a16);
                    }

                    minaddr = v.addr;
                    maxaddr = UINT_MAX;
                }

                // switch range
            }

            result = v;
        }

        if (_dump_struct)
        {
            wprintf(L"    {0x%04x,0x%04x,0x%04x,%d,%d,%d,%d},\r\n",
                minaddr,
                result.addr,
                result.pins,
                result.rom,
                result.ram,
                result.dev,
                result.a16);
        }

        if (_dump_readable)
        {
            wprintf(L"%20s: %04x - %04x, Rom:%d, Ram:%d, Dev:%d, A16:%d\r\n", tags.c_str(), minaddr, result.addr, result.rom, result.ram, result.dev, result.a16);
        }

        if (_test_expected)
        {
            Expected ex = {};
            ex.start = minaddr;
            ex.end = result.addr;
            ex.pins = result.pins;
            ex.rom = result.rom;
            ex.ram = result.ram;
            ex.dev = result.dev;
            ex.a16 = result.a16;

            if (memcmp(&_expected[pos++], &ex, sizeof(Expected)))
            {
                errors++;
                wprintf(L"%20s: %04x - %04x, Rom:%d, Ram:%d, Dev:%d, A16:%d\r\n", tags.c_str(), minaddr, result.addr, result.rom, result.ram, result.dev, result.a16);
            }
        }


    }

    if (_test_expected)
    {
        wprintf(L"errors=%d\r\n", errors);
    }
}


void Write22v10Simulation()
{
    wchar_t buf[255] = {0};
    wchar_t buf2[255] = {0};

    FILE * file = nullptr;
    FILE * file2 = nullptr;
    if (0 == fopen_s(&file,  "3ricDecoder.si",  "w+") 
     && 0 == fopen_s(&file2, "3ricDecoder.out", "w+"))
    {
        fwprintf(file, L"ORDER: A15, A14, A13, A12, A11, RW, VIDBUS, VIDENABLE, BB, B2, BRW, BRR, !ROM_CS, !RAM_CS, !DEVICE_CS, A16;\r\n\r\n\r\nVECTORS:\r\n");
        int outpos = 0;

        for (auto e : _expected)
        {
            for (int a = (e.start >> 11); a < (e.end >> 11); a++)
            {
                int pos = 0;

                swprintf_s(buf2, _countof(buf2), L"%04d: ", ++outpos);

                for (int bit = 4; bit >= 0; bit--)
                {
                    PIN2BUF((a >> bit) & 1);
                }

                PIN2BUF(e.pins & RW);
                PIN2BUF(1); // vidbus
                PIN2BUF(1); // videnable
                PIN2BUF(e.pins & BB);
                PIN2BUF(e.pins & B2);
                PIN2BUF(e.pins & BRW);
                PIN2BUF(e.pins & BRR);

                wcscat_s(buf2, _countof(buf2), buf);
                
                buf[pos++] = L'*'; // ROM_CS
                buf[pos++] = L'*'; // RAM_CS
                buf[pos++] = L'*'; // DEVICE_CS
                buf[pos++] = L'*'; // A16_CS

                int buf2len = (int)wcslen(buf2);

                buf[pos++] = L'\r';
                buf[pos++] = L'\n';
                
                swprintf_s(&buf2[buf2len], _countof(buf2) - buf2len, L"%c%c%c%c\r",
                    e.rom ? L'H' : L'L',
                    e.ram ? L'H' : L'L',
                    e.dev ? L'H' : L'L',
                    e.a16 ? L'H' : L'L');
                
                fwprintf(file,  buf);
                fwprintf(file2, buf2);

                memset(buf, 0, _countof(buf) * sizeof(wchar_t));
                memset(buf2, 0, _countof(buf2) * sizeof(wchar_t));
            }

        }

        fflush(file);
        fflush(file2);

        ::fclose(file);
        ::fclose(file2);
    }
}

int main()
{
    TestLogic();
    ValidateData();

    if (_gen_22v10_testdata)
    {
        Write22v10Simulation();
    }
}
