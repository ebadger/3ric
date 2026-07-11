# 3ric — Web / WASM Client Spec (WEB-CLIENT.md)

> The Emscripten/WebAssembly port and the browser UI that make 3ric playable at
> <https://ebadger.github.io/3ric/> with no install. It compiles the **same** VM core
> (`EMULATOR.md`) to WASM and renders it to an HTML canvas. Everything here is additive to
> the shared sources — see `web/README.md` for the deep dive.

---

## Purpose

Boot the real 512 KB ROM in any browser: render Apple-II text/lo-res/hi-res video to a
`<canvas>`, feed keystrokes through the memory-mapped keyboard, run Disk II and micro-SD
images, and assemble/run 65C02 source client-side — all 100% client-side so GitHub Pages can
host it as static files.

## Contracts / Interfaces

- **Build:** `web/build.ps1` compiles `Badger6502VMLib` (vm, cpu, Instructions, acia, via,
  PS2Keyboard, badgervmpal) + `WozLib` (DriveEmulator, WozDisk, WozFile) + `MockMicroSD`
  (SDCard, MappedFile) + `web/web_bridge.cpp` with `-DPLATFORM_WEB`. Excludes `symbols.cpp`
  and `Disassemble.cpp`. Key flags: `-std=c++17 -O2 -lembind -sMODULARIZE=1
  -sEXPORT_NAME=createBadgerVM -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,node`. Output:
  `web/badger6502.js` + `web/badger6502.wasm` (git-ignored — regenerated).
- **Bridge API (embind, `web_bridge.cpp`):** `loadData(addr, bytes)`, `seedBasicRom()`,
  `loadFont(bytes)`, `loadSD(bytes)`, `insertDisk(drive, bytes)`, `reset()`, `run(maxSteps)`,
  `setPC`, `poke/peek`, `keyDown(code)`, `drainOutput()` (serial), `renderFrame()` (RGBA
  framebuffer), `pc/sp/regA/regX/regY/status`, `sdReadCount()`.
- **Compat shims (`web_compat.h`):** map MSVC-isms (`OutputDebugString`, `sprintf_s`,
  `fopen_s`, `_ASSERT`, …) onto Emscripten so `WozLib`/`MockMicroSD` compile unchanged.
- **UI (`index.html`):** `requestAnimationFrame` driver, keyboard, disk/SD/clock controls,
  and the in-browser **Assembler** panel (imports `assemble()` from the staged
  `asm6502.mjs`). Honors optional `window.ASSET_BASE` / `?assets=` for CDN/R2 offload and
  `?src=` / `?prg=` deep links.
- **SD image:** `make_sd_sparse.py` streams `emulator/Data/sd.zip` (2 GB, mostly-zero FAT32)
  into `data/sd.sparse` (~11.5 MB `SDSP` container), fetched lazily.

## Behaviour / Rules

- The CPU is stepped per animation frame (`run(maxSteps)`), bounded by a wall-clock budget so
  the tab stays responsive; the **Speed** selector scales cycles/frame (0.5×–8×, Max).
- **Parity is the rule:** the WASM build must behave like the native build. Do not add
  behavior in the bridge that isn't in the shared core unless it's a genuinely
  presentation-only concern (canvas, clock pacing) — and never behind an unguarded fork.
- Assets are relative so the site works under `/<repo>/` on Pages; the mandatory first-load
  payload is ~1.26 MB, with `disk.woz`/`sd.sparse` fetched only on demand.

## Data flow

`build.ps1 → badger6502.js/.wasm + data/ → index.html loads WASM → boot recipe (loadData /
seedBasicRom / loadFont / reset) → run() per frame → renderFrame()→canvas, drainOutput()→
log; keyDown()→$C000; Boot Disk/Mount SD → insertDisk()/loadSD() → C600G / EC5CG`.

## Dependencies

- **Upstream:** the VM core (`EMULATOR.md`), the ROM/font/disk/SD data (`ROM-SOFTWARE.md`),
  and `codegen/tools/asm6502.mjs` (staged for the in-browser assembler — `CODEGEN.md`).
- **Downstream:** GitHub Pages deploy (`.github/workflows/deploy-pages.yml`); the public
  users of the demo.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| WASM build of the VM core + WozLib + SD | Shipped | `web/build.ps1`, Emscripten 6.0.1. |
| Canvas video + keyboard | Shipped | text/lo-res/hi-res, `$C000` input. |
| Disk II WOZ boot + micro-SD DOS shell | Shipped | **Boot Disk** / **Mount SD** buttons. |
| In-browser assembler (Assemble & Run) | Shipped | dual-use `asm6502.mjs`; ~11 samples; `?src=`. |
| Adjustable CPU clock | Shipped | frontend-only pacing. |
| Headless smoke tests | Shipped | `web/test_*.cjs` (boot/render/keyboard/screen/sd/disk). |
| GitHub Pages CI deploy | Shipped | on push to `main` touching emulator/web/codegen sources. |
