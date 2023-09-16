// pch.h: This is a precompiled header file.
// Files listed below are compiled only once, improving build performance for future builds.
// This also affects IntelliSense performance, including code completion and many code browsing features.
// However, files listed here are ALL re-compiled if any one of them is updated between builds.
// Do not add files here that you will be updating frequently as this negates the performance advantage.

#ifndef PCH_H
#define PCH_H

#include "vm.h"

#define TXCOUNT 38400 // Total pixels/2 (since we have 2 pixels per byte)
uint8_t vga_buffer[TXCOUNT];

#endif //PCH_H
