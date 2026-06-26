// web_compat.h — Emscripten/WebAssembly compatibility shims for the shared
// WozLib sources, which were written against the Win32 API.
//
// This header is ONLY pulled in when compiling for Emscripten (the WozLib .cpp
// files include it under `#if defined(__EMSCRIPTEN__)`), so the existing
// Windows / MSVC build is completely unaffected.
//
// It provides no-op / portable stand-ins for the handful of Win32 helpers the
// WozLib debug paths reference: OutputDebugStringA, sprintf_s and _countof.
#pragma once

#if defined(__EMSCRIPTEN__)

#include <cstdio>
#include <cstring>
#include <cerrno>

// Debug tracing → drop on the floor in the browser build.
#ifndef OutputDebugStringA
#define OutputDebugStringA(s) ((void)(s))
#endif
#ifndef OutputDebugStringW
#define OutputDebugStringW(s) ((void)(s))
#endif

// MSVC bounds-checked sprintf → portable snprintf (identical (buf, size, fmt, ...) shape).
#ifndef sprintf_s
#define sprintf_s snprintf
#endif

// MSVC array-length helper.
#ifndef _countof
#define _countof(a) (sizeof(a) / sizeof((a)[0]))
#endif

// MSVC secure CRT used by WozLib's file loaders. These paths are dead code in
// the web build (disk images are handed in as byte arrays, not read from a
// .woz file), but they still must compile and link.
typedef int errno_t;

static inline errno_t web_fopen_s(FILE** pf, const char* name, const char* mode)
{
    if (!pf) return EINVAL;
    *pf = fopen(name, mode);
    return *pf ? 0 : (errno ? errno : -1);
}
#ifndef fopen_s
#define fopen_s web_fopen_s
#endif

// MSVC fread_s(buf, bufsize, elemsize, count, stream) → fread(buf, elemsize, count, stream).
#ifndef fread_s
#define fread_s(buf, bufsize, elemsize, count, stream) fread((buf), (elemsize), (count), (stream))
#endif

// MSVC debug assert → no-op (avoid surprise aborts in this otherwise-dead code).
#ifndef _ASSERT
#define _ASSERT(x) ((void)0)
#endif

#endif // __EMSCRIPTEN__
