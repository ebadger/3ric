# 3RIC — WEB Spec

> Source of truth for the in-browser (WebAssembly) emulator under `web/`. It compiles the
> **same** C++ VM core (`EMULATOR.md`) to WASM, so it must stay behavior-consistent with the
> WinUI 3 host and the real hardware (the critical path). See `web/README.md` for the long
> form.

---

## Purpose

A self-contained Emscripten/WebAssembly port of Badger6502: compile the C++ VM core + disk
libs to WASM, boot the real ROM, render video to an HTML `<canvas>`, and feed keyboard/disk/
SD input — 100% client-side, no backend.

## Contracts / Interfaces

- **Bridge — `web/web_bridge.cpp`** (embind). Wraps `VM`: `loadData`, `seedBasicRom`,
  `loadFont`, `reset`, `run`, register/keyboard access, `loadSD`, `insertDisk`, and produces
  the RGBA framebuffer. Module factory: `createBadgerVM` (`-sMODULARIZE=1 -sEXPORT_NAME=...`).
- **Compat shim — `web/web_compat.h`** — shims MSVC-isms (`OutputDebugString`, `sprintf_s`,
  `fopen_s`, `_ASSERT`, …) so `WozLib` + `MockMicroSD` compile under Emscripten.
- **UI — `web/index.html`** — canvas + `requestAnimationFrame` driver, keyboard, and the
  Speed/Boot Disk/Insert .woz/Mount SD controls. Honors optional `window.ASSET_BASE` /
  `?assets=` to relocate `.wasm` + `data/` to a CDN (Cloudflare R2).
- **Build — `web/build.ps1`** — compiles core + `WozLib` + `MockMicroSD` + bridge with
  `-DPLATFORM_WEB -std=c++17 -O2 -lembind -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,node`;
  stages `badger6502.bin` + `fontrom.dat`; generates `data/sd.sparse`; stages demo `disk.woz`.
  Outputs (`badger6502.js`, `badger6502.wasm`, staged `data/`) are git-ignored.
- **Serve — `web/serve.ps1`** (dev, `python -m http.server 8011`) and **`web/Caddyfile`**
  (prod static origin: gzip/zstd, immutable cache for `/data/`, `no-cache` for `index.html`).
- **Asset prep — `web/make_sd_sparse.py`** — streams the 2 GB FAT32 image into a compact
  `sd.sparse` (~11.5 MB, `SDSP` container of non-zero sectors).

## Behaviour / Rules

- **Parity is mandatory:** the bridge/renderer must match the WinUI host's color/fringe logic
  (it was ported verbatim). Core changes land in both, behind `__EMSCRIPTEN__`/`PLATFORM_WEB`.
- WASM must be served over HTTP with `application/wasm` (not `file://`).
- Per fresh visit the mandatory payload is ~1.26 MB; `disk.woz` (~230 KB) and `sd.sparse`
  (~11.5 MB) load lazily on demand.
- Clock speed is a frontend-only concern (per-frame wall-clock budget); the VM core is
  unchanged by it.

## Data flow

```
build.ps1 → badger6502.js/.wasm + data/  →  index.html loads createBadgerVM()
loadData(badger6502.bin) → seedBasicRom() → loadFont(fontrom.dat) → reset()
rAF loop: run(maxSteps) → framebuffer (RGBA) → <canvas>
keydown → $C000 ; Mount SD → loadSD(sd.sparse) ; Boot Disk → insertDisk(.woz) + C600G
prod: browser → Caddy (Pi) [→ Cloudflare edge / R2 for /data/]  (static only)
```

## Dependencies

- Upstream: `EMULATOR.md` (VM core), `DISK.md` (`WozLib`, `MockMicroSD`, `sd.sparse`),
  `ROMS.md` (`badger6502.bin`, `fontrom.dat`).
- Downstream: end users' browsers. Production serving is **not yet deployed**.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| WASM build of core + bridge | Shipped | `web/build.ps1` |
| Video (text/lo-res/hi-res color) | Shipped | Ported from WinUI renderer |
| Keyboard input | Shipped | `$C000`/`$C010` strobe |
| Micro-SD (FAT32) + DOS shell | Shipped | `sd.sparse`, `loadSD` |
| Disk II 5.25″ (WOZ) boot | Shipped | `insertDisk` + `C600G` |
| Headless node tests | Shipped | `web/test_*.cjs` (boot/render/keyboard/screen/sd/disk) |
| Production deployment (Pi + Cloudflare / R2) | Not started | Config ready (`Caddyfile`, `ASSET_BASE`); not live |
