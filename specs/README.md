# Specs (`specs/`)

**Specs are the source of truth. Code follows specs, not the other way around.**

This is the single most load-bearing convention in the whole operating model: every change
to the **memory map, an I/O register, or a ROM** is specified across *all* the layers it
touches **before** it is built, and the spec is updated **in the same commit** as the code.
That is what keeps an AI workforce — which has no persistent memory between sessions — from
drifting.

## How specs are organized

- `SYSTEM.md` — the **umbrella**: a short overview of the whole system that links to every
  sub-spec. Start here; read sub-specs lazily.
- One sub-spec **per layer** (copy `_TEMPLATE.md`). 3RIC's set:
  - `HARDWARE.md` — schematic/PCB, 22V10 GAL decode, Logisim, the memory map, I/O registers, video timing.
  - `ROMS.md` — monitor/OS + BASIC, font/video ROMs, the `romgen/` generators, `badger6502.bin` / `fontrom.dat`.
  - `EMULATOR.md` — shared C++ VM core, WinUI 3 (C++/WinRT) host, MSVC unit tests.
  - `WEB.md` — Emscripten/WASM build, the JS↔core bridge, browser UI.
  - `DISK.md` — Disk II floppy (`WozLib`), micro-SD (`MockMicroSD`), `dsk2woz2`, real-hardware `picodisk`.

## The rules (canonical in `docs/LEARNINGS.md` §1–4)

1. **Layer checklist.** Before committing, verify every layer the change could touch.
2. **Data flow, not documents.** Specify every link:
   `Key press → keyboard register $C000 → CPU read → ROM/monitor → video RAM → renderer (host + web) → frame`.
3. **Specs before code.** Update the spec first; code implements the spec.
4. **Commit atomically.** A feature spanning multiple specs/layers updates them all in one
   commit, so history is consistent at every point.

After implementing, update the **Implementation Status** section of the relevant sub-spec.

> The `compliance-hooks` extension nudges a cross-layer check whenever you edit a file that
> looks like a layer/spec file (see `.github/extensions/compliance-hooks/`).
