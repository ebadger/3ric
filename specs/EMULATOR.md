# 3RIC — EMULATOR Spec

> Source of truth for the software emulation of Badger6502: the shared C++ VM core, the
> WinUI 3 desktop host, and the per-opcode unit tests. The VM core is the **critical path** —
> it backs the desktop host, the WASM web build (`WEB.md`), and the tests, so a regression
> here breaks all three.

---

## Purpose

Faithfully emulate the Badger6502 hardware in software: the 65C02 CPU, memory, VIA, ACIA,
keyboard, video, and the Disk II/SD interfaces — as a reusable C++ core plus a native
Windows host for interactive use.

## Contracts / Interfaces

- **VM core — `emulator/Badger6502VMLib`** (C++17). Modules: `vm`, `cpu`, `Instructions`,
  `acia`, `via`, `PS2Keyboard`, `badgervmpal` (the 22V10/PAL glue logic). Exposes (used by
  every host, see `web/web_bridge.cpp` for the canonical surface):
  - `GetData()` — pointer to the 64 KB CPU address space; `loadData(offset, bytes)`.
  - `seedBasicRom()` / `GetBasicRom()` — seed BASIC from the ROM image.
  - `loadFont(bytes)` — load `fontrom.dat` for the text renderer.
  - `reset()` — load PC from `$FFFC/$FFFD`.
  - `Step()` / `run(maxSteps)` — cooperative stepping; ticks VIAs/keyboard per CPU cycle
    (the blocking `Run()` is not used by the cooperative hosts).
  - `CallbackWriteMemory` — memory-write hook (used to pump the micro-SD SPI state machine).
- **Memory-mapped I/O contract** (must match `HARDWARE.md`): keyboard `$C000`/`$C010`;
  Disk II `$C0E0–$C0EF` + boot PROM `$C600`; micro-SD on VIA1 `$C201`/`$C20F`.
- **WinUI 3 host — `emulator/Badger6502VM`** (C++/WinRT). Owns the window, the text/lo-res/
  hi-res renderer (`MainWindow.xaml.cpp` — the renderer the web bridge was ported from), the
  keyboard mapping, and the clock loop.
- **Tests — `emulator/Badger6502VMTest`** (MSVC `CppUnitTestFramework`, C++). Per-opcode
  suites (LDA, ADC_SBC, Branching, Stack, Interrupts, SMB_RMB, TSB_TRB, …) asserting 65C02
  instruction semantics.

## Behaviour / Rules

- **Cooperative execution:** hosts call `run(maxSteps)` per frame, never the blocking loop,
  so the UI stays responsive.
- **Platform parity:** Windows-only code (`symbols.cpp`, `Disassemble.cpp`, MSVC-isms) must
  stay behind guards so the same core compiles for WASM. New core behavior must be reflected
  in both the host renderer and the web bridge, or the builds diverge (critical path).
- **Correctness first:** any CPU/instruction change requires a passing (or new) test in
  `Badger6502VMTest` before it ships. This is the pre-push gate's primary target.

## Data flow

```
badger6502.bin → loadData(0, …) → seedBasicRom() → loadFont(fontrom.dat) → reset()
per frame: run(maxSteps) → Step() CPU → tick VIA/ACIA/keyboard → video RAM
video RAM + font → renderer (WinUI host / web canvas) → display
keyboard → $C000 ; SD writes → CallbackWriteMemory → SPI state machine (see DISK.md)
```

## Dependencies

- Upstream: `ROMS.md` (`badger6502.bin`, `fontrom.dat`), `HARDWARE.md` (the behavior being
  emulated), `DISK.md` (`WozLib`, `MockMicroSD`).
- Downstream: `WEB.md` (compiles this core to WASM), the desktop host, the test suite.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| 65C02 CPU + instruction set | Shipped | Per-opcode tests in `Badger6502VMTest` |
| VIA / ACIA / PS/2 keyboard | Shipped | `via`, `acia`, `PS2Keyboard` |
| PAL/GAL glue (`badgervmpal`) | Shipped | Mirrors `22v10/` |
| WinUI 3 host + renderer | Shipped | `emulator/Badger6502VM` |
| Test gate wired to pre-push | Shipped | `scripts/dev/pre-push-tests.sh` (VSTest, fail-open) |
| Cycle-accuracy notes vs real hardware documented here | In progress | Tracked gap |
