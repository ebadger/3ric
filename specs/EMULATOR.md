# 3ric — Emulator Core Spec (EMULATOR.md)

> The 65C02 virtual machine at the heart of 3ric, in C++. The same sources power the Windows
> hosts (`Console`, WinUI) and — behind `__EMSCRIPTEN__`/`PLATFORM_WEB` guards — the browser
> build (see `WEB-CLIENT.md`). Source of truth for the machine's behavior; update it in the
> same commit as the code.

---

## Purpose

Faithfully emulate the 3ric machine: a WDC 65C02 CPU, 36 KB RAM, Microsoft BASIC + a 512 KB
ROM (monitor/DOS), Apple-II-style text/lo-res/hi-res video, keyboard, a 6551 ACIA serial
port, a 6522 VIA (I/O + bit-banged SPI micro-SD), a slot-4 dual-AY Mockingboard, and a Disk
II 5.25″ floppy. It is the **reference implementation of the target hardware** — the
emulator is correct when it behaves like the real machine will.

## Contracts / Interfaces

**Projects (`emulator/Badger6502VM.sln`):**

| Project | Role |
|---------|------|
| `Badger6502VMLib` | The VM core: `vm`, `cpu`, `Instructions`, `acia`, `via`, `mockingboard`, `ay38910`, `PS2Keyboard`, `badgervmpal` (video). Windows-only: `symbols`, `Disassemble`. |
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
$C300–$C30F  ROM disk / char-gen  $C400–$C4FF slot-4 Mockingboard
$C400–$C47F  Mockingboard VIA/AY 1 (registers mirror every 16 bytes)
$C480–$C4FF  Mockingboard VIA/AY 2 (registers mirror every 16 bytes)
$C600–$C6FF  Disk II boot PROM
$C0E0–$C0EF  Disk II data/control $C800–$CFFF  RAM2
$D000–$FFFF  ROM (monitor / OS / DOS shell); reset vector at $FFFC/$FFFD
```

Soft switches are dispatched by `VM::DoSoftSwitches(address, write)`; memory-access
callbacks (`CallbackWriteMemory`, `CallbackSetSoftSwitches`) let hosts hook I/O (the web
bridge uses this to clock the SD card and advance the drive).

## Behaviour / Rules

- CPU is driven **cooperatively**: hosts call `VM::Step()` per instruction. The VM samples
  the shared level-sensitive IRQ line before the instruction and ticks the onboard VIA plus
  both Mockingboard VIA/AY pairs for every returned CPU cycle. Presentation hosts may then
  advance host-owned keyboard/disk plumbing. The blocking `VM::Run()` is not used by the web
  build.
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
- Host-received ACIA bytes set RDRF, but assert the shared IRQ line only while DTR is
  asserted and receiver interrupts are enabled in the 6551 command register. A write to the
  status address performs a programmed reset independent of the written value, preserving
  the control register and command parity bits.

**Slot-4 Mockingboard contract (matching `kicad/3ric/Mockingboard.kicad_sch`):**

- The board has two 65C22 VIAs and two AY-3-8910s; it has no speech chip.
- A7 selects the pair: `$C400–$C47F` is VIA/AY 1 and `$C480–$C4FF` is VIA/AY 2.
  A0–A3 select the VIA register and A4–A6 are ignored, so each register has eight mirrors.
- VIA port A is the AY data bus. Port B bit 0 is BC1, bit 1 is BDIR, and bit 2 is active-low
  AY reset; BC2 is tied high.
- AY address and write operations latch whenever BDIR falls from an active address/write
  state. While active-low reset is asserted, the AY remains reset and does not advance.
- Both AY clocks are direct PHI2: 25.175 MHz / 16 = **1,573,437.5 Hz**. This intentionally
  makes software timed for a 1.023 MHz Apple II Mockingboard play about 1.54x faster and
  higher unless that software compensates.
- Each VIA drives the CPU's shared active-low IRQ input. IRQ flags remain asserted until the
  guest clears their source; the CPU samples IRQ only between instructions.
- The shared 65C22 models T1 one-shot/free-run, PB7 timer output, T2 PHI2 timing, and T2 PB6
  falling-edge pulse counting.
- The onboard `$C200` VIA's enabled interrupt output retains its ROM contract as queued NMI
  edges, including control-pin and timer sources. This is separate from the two Mockingboard
  VIA IRQ outputs.
- AY 1 and AY 2 are separate left/right outputs. The shared core produces interleaved stereo
  PCM; host muting disables sample collection without stopping VIA or AY state progression.

## Data flow

`6502 ROM/program → VM::Step() → memory/soft-switch access → device
(video/ACIA/VIA/Mockingboard/SD/Disk II) → framebuffer + serial + stereo PCM + register
state → host (native window or web bridge → canvas/audio)`.

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
| Slot-4 dual-AY Mockingboard | Shipped | Exact 3RIC `$C400/$C480`, 1.5734375 MHz, VIA IRQ, and hard-panned stereo; covered by native and WASM tests. |
| Disk II 5.25″ floppy (WozLib) | Shipped | `$C600` boot PROM + `$C0E0–$C0EF`. |
