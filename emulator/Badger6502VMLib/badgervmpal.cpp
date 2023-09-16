#include "vm.h"
#include <stdarg.h>
#include <stdlib.h>
#include <fstream>
#include <sys/stat.h>


#if defined(PLATFORM_PICO)
#elif defined(PLATFORM_WINDOWS)
#include <chrono>
#include <thread>
#else
#error Must define either PLATFORM_PICO or PLATFORM_WINDOWS
#endif


void pal_sleep(uint32_t milliseconds)
{
#if defined(PLATFORM_PICO)
    sleep_ms(milliseconds);
#elif defined(PLATFORM_WINDOWS)
    this_thread::sleep_for(chrono::milliseconds(milliseconds));
#endif
}

void pal_sprintf(char *dest, const char *fmt, ...)
{
    if (!dest || !fmt)
    {
        return;
    }

    va_list ap;
    va_start(ap, fmt);
#if defined(PLATFORM_WINDOWS)
#pragma warning (disable : 4996)
    vsprintf(dest, fmt, ap);
#pragma warning (restore : 4996)
#elif defined(PLATFORM_PICO)
    vsprintf(dest, fmt, ap);
#endif
    va_end(ap);
}

void pal_debugbreak()
{
#if defined(PLATFORM_WINDOWS)
    __debugbreak();
#elif defined(PLATFORM_PICO)
    
#endif
}

void pal_strncpy(char *dest, const char *src, int cch)
{
#if defined(PLATFORM_WINDOWS)
    strncpy_s(dest, _pal_countof(dest), src, cch);
#elif defined(PLATFORM_PICO)
    strncpy(dest, src, cch);
#endif
}

bool pal_loadbinary(const char *szFileName, uint8_t *dest)
{
    #if defined(PLATFORM_WINDOWS)

        uint16_t offset;
        struct stat results = { 0 };
        if (stat(szFileName, &results) == 0)
        {
            ifstream data(szFileName, ios::in | ios::binary);

            if (results.st_size > 0x10000 || results.st_size == 0)
            {
                data.close();
                return false;
            }

            offset = (uint16_t)(0x10000 - results.st_size);

            data.read((char*)&dest[offset], results.st_size);
            data.close();

            return true;
        }
        return false;

    #elif defined(PLATFORM_PICO)

        size_t dataSize = 0;
        const char *pFile =  find_embedded_file(szFileName, &dataSize);
        memcpy(&dest[0x8000], pFile, dataSize);
        return true;  

    #endif
}


bool pal_loadromdisk(const char *szFileName, uint8_t *dest)
{
    #if defined(PLATFORM_WINDOWS)
    
    struct stat results = { 0 };
	if (stat(szFileName, &results) == 0)
	{
		ifstream data(szFileName, ios::in | ios::binary);

		if (results.st_size > 0x80000 || results.st_size == 0)
		{
			data.close();
			return false;
		}

		data.read((char *)dest, results.st_size);
		data.close();

		return true;
	}

	return false;

    #elif defined(PLATFORM_PICO)

        return false;

    #endif
}

	
void pal_initromdisk(uint8_t **romdisk)
{
    #if defined(PLATFORM_WINDOWS)
        *romdisk = new uint8_t[0x80000];
        memset(*romdisk, 0, sizeof(int8_t) * _pal_countof(*romdisk));
    #elif defined(PLATFORM_PICO)
        *romdisk = (uint8_t *) find_embedded_file("data/loderun.bin", nullptr);
    #endif
}

void pal_freeromdisk(uint8_t **romdisk)
{
    #if defined(PLATFORM_WINDOWS)
        delete [] *romdisk;
    #elif defined(PLATFORM_PICO)
    #endif
}