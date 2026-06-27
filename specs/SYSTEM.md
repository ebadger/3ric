# 3RIC — System Overview (SYSTEM.md)

> The umbrella spec. Keep this short — it is read at the start of every session. It
> describes the whole system at a glance and **links to every sub-spec**; the detail lives
> in the sub-specs, read lazily.

---

## What this system is

3RIC (**Badger6502**) is a from-scratch **65C02 homebrew personal computer** in the
Apple-II tradition: a hand-designed digital logic machine with text/lo-res/hi-res video,
a PS/2 keyboard, serial (ACIA) and parallel (VIA) I/O, a Disk II–style 5.25″ floppy, and a
micro-SD card. The repo holds the **real hardware** (schematics, PCB, PLD logic), the
**ROMs/firmware** that boot it, and two **faithful emulators** — a native WinUI 3 desktop
host and an in-browser WebAssembly build — that run the *same* C++ VM core so they behave
like the physical machine. The "why" lives in `docs/MISSION.md`.

## Architecture at a glance

```
   Hardware (KiCad PCB · 22V10 GAL · TTL video)        Shared C++ VM core
   65C02 + RAM/ROM + VIA + ACIA + video + Disk II      (emulator/Badger6502VMLib)
              │  same ROM image + memory map  │            │            │
              ▼                               ▼            ▼            ▼
        badger6502.bin  ───────────────►  WinUI 3 host   WASM web    Unit tests
        fontrom.dat       (romgen)         (desktop)     (browser)  (per-opcode)
                                               │            │
                                          WozLib floppy + MockMicroSD (SD/SPI via VIA1)
                                               │
                                          picodisk (Pi Pico disk/SD for real hardware)
```

- **Stack:** C++17 65C02 VM core — WinUI 3 (C++/WinRT) desktop host, Emscripten/WASM web
  build, MSVC C++ unit tests; C# ROM-generator tools + Python/PowerShell build scripts;
  KiCad + 22V10 GAL + Logisim hardware; Raspberry Pi Pico (C/C++) disk.
- **Environments:** dev = Windows + Visual Studio 2022 (emulator) and emsdk + Node (web);
  prod = **not yet deployed** (web emulator is static files, intended for a Raspberry Pi
  behind a Cloudflare Tunnel). See `status/SYSTEM-STATUS.md`.

## Sub-specs (read only the layer you'll touch)

| Layer | Spec | Covers |
|-------|------|--------|
| Hardware | [`HARDWARE.md`](./HARDWARE.md) | KiCad schematic/PCB, 22V10 GAL logic, Logisim sim, DIYLC layout, memory map, video, I/O |
| ROMs / firmware | [`ROMS.md`](./ROMS.md) | `romgen` font/sync/video-address ROMs, monitor/OS ROM image (`badger6502.bin`), BASIC |
| Emulator | [`EMULATOR.md`](./EMULATOR.md) | Shared C++ VM core (CPU, VIA, ACIA, keyboard), WinUI 3 host, unit tests |
| Web | [`WEB.md`](./WEB.md) | Emscripten/WASM bridge, canvas UI, build/serve, Cloudflare/R2 serving |
| Disk | [`DISK.md`](./DISK.md) | WozLib 5.25″ floppy, MockMicroSD (SPI/FAT32), `dsk2woz2`, `picodisk` |

> Create each sub-spec from [`_TEMPLATE.md`](./_TEMPLATE.md).

## Cross-cutting concerns

- **The shared contract:** the **ROM image (`badger6502.bin`) + the 6502 memory map** are
  the single source of truth shared by hardware, the WinUI 3 host, and the WASM web build.
  A change to the memory map, an I/O register, or the ROM is a **cross-layer event** — it
  must land in the hardware (PLD/schematic), the emulator core, and the ROM together.
- **Memory map (current, as emulated):** RAM low; ROM/OS `$D000–$FFFF` (reset vector
  `$FFFC/$FFFD`); BASIC at `$E000` (generic Microsoft BASIC, seeded from the ROM image);
  keyboard `$C000` data / `$C010` strobe; Disk II boot PROM `$C600`, data regs
  `$C0E0–$C0EF`; micro-SD (bit-banged SPI) on VIA1 at `$C201`/`$C20F`. Detail in the specs.
- **The critical path:** the **65C02 VM core stays instruction-correct**, and the **web +
  WinUI 3 emulators stay behavior-consistent with the real hardware build**. This is what
  the model-diverse review panel (`docs/CODE-REVIEW-PANEL.md`) and the pre-push test gate
  (`scripts/dev/pre-push-tests.sh`) exist to protect. Platform code is guarded by
  `__EMSCRIPTEN__` / `PLATFORM_WEB` so the three builds never silently diverge.
- **Auth model:** none — single-user hobby project; the web build is 100% client-side with
  no backend or stored user data.

## Implementation status (summary)

| Area | Status |
|------|--------|
| Hardware (schematic, PCB, PLD, video) | Built — documented in the YouTube build series; see `HARDWARE.md` |
| ROMs / firmware (`romgen`, monitor, font) | Shipped — `badger6502.bin` + `fontrom.dat` boot the machine |
| Emulator core + WinUI 3 host | Shipped — per-opcode unit tests in `Badger6502VMTest` |
| Web (WASM) emulator | Shipped — boots ROM, video, keyboard, SD, Disk II; headless node tests |
| Disk tooling (WozLib, `dsk2woz2`, `picodisk`) | Shipped — floppy + SD working; see `DISK.md` |
