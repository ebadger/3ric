// pch.h: This is a precompiled header file.
// Files listed below are compiled only once, improving build performance for future builds.
// This also affects IntelliSense performance, including code completion and many code browsing features.
// However, files listed here are ALL re-compiled if any one of them is updated between builds.
// Do not add files here that you will be updating frequently as this negates the performance advantage.

#ifndef PCH_H
#define PCH_H


#if defined(__EMSCRIPTEN__)
// Web build: no Win32. Pull in the portable shims and the standard containers
// used by the in-memory (sparse) SD backing.
#include <stdint.h>
#include <cstring>
#include <vector>
#include <unordered_map>
#include "web_compat.h"
#include "MappedFile.h"
#include "SDCard.h"
#else
#include <windows.h>
#include <stdint.h>
#include "framework.h"
#include "mappedfile.h"
#include "sdcard.h"
#endif
#endif //PCH_H
