#pragma once
#include "vm.h"


#ifndef _pal_countof
#define _pal_countof( x ) ( sizeof(x) / sizeof(x[0]) )
#endif

#if defined(PLATFORM_PICO)


#include <stdio.h>
#include <stdlib.h>
#include "pico/stdlib.h"
#include "pico/types.h"
#include <cstring>
#include <wchar.h>
#include "pico/util/queue.h"

const char *find_embedded_file(const char *name, size_t *size);

#elif defined(PLATFORM_WINDOWS)

#include <corecrt_wstring.h>
#include "symbols.h"

#endif

void pal_sleep(uint32_t milliseconds);
void pal_sprintf(char *dest, const char *fmt, ...);
void pal_debugbreak();
void pal_strncpy(char *, const char *, int);
bool pal_loadbinary(const char *filename, uint8_t *dest);
bool pal_loadromdisk(const char *filename, uint8_t *dest);
void pal_initromdisk(uint8_t **romdisk);
void pal_freeromdisk(uint8_t **romdisk);