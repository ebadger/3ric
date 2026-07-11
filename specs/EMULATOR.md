# 3ric — Emulator Core Spec (EMULATOR.md)

> The 65C02 virtual machine at the heart of 3ric, in C++. The same sources power the Windows
> hosts (`Console`, WinUI) and — behind `__EMSCRIPTEN__`/`PLATFORM_WEB` guards — the browser
> build (see `WEB-CLIENT.md`). Source of truth for the machine's behavior; update it in the
> same commit as the code.

---

## Purpose

Faithfully emulate the 3ric machine: a WDC 65C02 CPU, 36 KB RAM, Microsoft BASIC + a 512 KB
ROM (monitor/DOS), Apple-II-style text/lo-res/hi-res video, keyboard, a 6551 ACIA serial
port, a 6522 VIA (I/O + bit-banged SPI micro-SD), and a Disk II 5.25″ floppy. It is the
**reference implementation of the target hardware** — the emulator is correct when it
behaves like the real machine will.

## Contracts / Interfaces

**Projects (`emulator/Badger6502VM.sln`):**

| Project | Role |
|---------|------|
| `Badger6502VMLib` | The VM core: `vm`, `cpu`, `Instructions`, `acia`, `via`, `PS2Keyboard`, `badgervmpal` (video). Windows-only: `symbols`, `Disassemble`. |
| `WozLib` | Disk II emulation: `DriveEmulator`, `WozDisk`, `WozFile` (`.woz` images). |
| `MockMicroSD` | Bit-banged SPI SD card (`SDCard`) over a memory-mapped image (`MappedFile`). |
| `Badger6502VMTest` | MSTest (native C++) CPU unit tests — one file per instruction family. |
| `Console`, `Badger6502Emulator`(+Package) | Win32 console and WinUI hosts. |
| `WozFileTestApp`, `dsk2woz2`, `picodisk` | WOZ tooling / disk conversion / Pico target. |

**Memory map — the cross-layer contract** (`vm.h`, `MM_*`; mirrored by the 22V10 GAL, the
web bridge, and `codegen/platform-ref.*`):

```
$0000–$8FFF  RAM (36 KB)          $2000–$5FFF  hi-res video pages
$9000–$BFFF  Microsoft BASIC ROM  $C000        keyboard data / $C010 strobe clear
$C050–$C057  display soft switches (GRAPHICS/TEXT/…/LORES/HIRES)
$C080–$C08F  language-card bank switches
$C100–$C10F  ACIA (6551 serial)   $C200–$C20F  VIA1 (SPI micro-SD)
$C300–$C30F  ROM disk / char-gen  $C400 audio  $C600–$C6FF Disk II boot PROM
$C0E0–$C0EF  Disk II data/control $C800–$CFFF  RAM2
$D000–$FFFF  ROM (monitor / OS / DOS shell); reset vector at $FFFC/$FFFD
```

Soft switches are dispatched by `VM::DoSoftSwitches(address, write)`; memory-access
callbacks (`CallbackWriteMemory`, `CallbackSetSoftSwitches`) let hosts hook I/O (the web
bridge uses this to clock the SD card and advance the drive).

## Behaviour / Rules

- CPU is driven **cooperatively**: hosts call `Step()` per instruction and tick the
  VIAs/keyboard/drive by the returned cycle count. The blocking `VM::Run()` is not used by
  the web build.
- `reset()` loads PC from `$FFFC/$FFFD`. ROM load recipe (mirrored by every host): write the
  first `0x10000` bytes of `badger6502.bin` into `GetData()`, `seedBasicRom()` (copy
  `$9000..$BFFF`), `loadFont()`, then `reset()`.
- **Portability rule:** the shared VM/WozLib/SD sources must compile and behave identically
  on Windows and Emscripten. Platform-specific code lives behind `__EMSCRIPTEN__` /
  `PLATFORM_WEB` (or MSVC) guards only — never a silent behavioral fork.
- **No fabricated emulation.** An unimplemented opcode/device/soft-switch must be observable
  (assert/log/explicit unimplemented), never a plausible-looking fake value.
- This clone's `$E000` BASIC is **generic Microsoft BASIC, not Applesoft** — a deliberate,
  known limitation (see `ROM-SOFTWARE.md`).

## Data flow

`6502 ROM/program → CPU Step() → memory/soft-switch access → device (video/ACIA/VIA/SD/Disk
II) → framebuffer + serial + register state → host (native window or web bridge → canvas)`.

## Dependencies

- **Upstream:** the 512 KB ROM + `fontrom.dat` (`ROM-SOFTWARE.md`); WOZ/SD images.
- **Downstream:** the web bridge/client (`WEB-CLIENT.md`), the codegen harness
  (`CODEGEN.md`), and the hardware, which must match this behavior (`HARDWARE.md`).

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| 65C02 CPU + full ISA/addressing | Shipped | Covered by `Badger6502VMTest` (MSTest). |
| Memory map + soft switches | Shipped | `vm.h` `MM_*`; the shared contract. |
| Text / lo-res / hi-res video | Shipped | `badgervmpal`; color/fringe logic shared with hosts. |
| Keyboard + ACIA serial | Shipped | `$C000`/`$C010`; `PS2Keyboard`, `acia`. |
| VIA1 + bit-banged SPI micro-SD | Shipped | `via` + `MockMicroSD`. |
| Disk II 5.25″ floppy (WozLib) | Shipped | `$C600` boot PROM + `$C0E0–$C0EF`. |
