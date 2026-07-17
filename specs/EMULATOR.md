# 3ric — Emulator Core Spec (EMULATOR.md)

> The 65C02 virtual machine at the heart of 3ric, in C++. The same sources power the Windows
> hosts (`Console`, WinUI) and — behind `__EMSCRIPTEN__`/`PLATFORM_WEB` guards — the browser
> build (see `WEB-CLIENT.md`). Source of truth for the machine's behavior; update it in the
> same commit as the code.

---

## Purpose

Faithfully emulate the 3ric machine: a WDC 65C02 CPU, 36 KB RAM, Microsoft BASIC + a 512 KB
ROM (monitor/DOS), Apple-II-style text/lo-res/hi-res video, keyboard, a `$C030` system
speaker, a 6551 ACIA serial port, a 6522 VIA (I/O + bit-banged SPI micro-SD + two serial
SNES gamepads), a slot-4 dual-AY Mockingboard, and a Disk II 5.25″ floppy. It is the **reference implementation of
the target hardware** — the emulator is correct when it behaves like the real machine will.

## Contracts / Interfaces

**Projects (`emulator/Badger6502VM.sln`):**

| Project | Role |
|---------|------|
| `Badger6502VMLib` | The VM core: `vm`, `cpu`, `Instructions`, `acia`, `via`, `snesgamepads`, `mockingboard`, `ay38910`, `PS2Keyboard`, `badgervmpal` (video). Windows-only: `symbols`, `Disassemble`. |
| `WozLib` | Disk II emulation: `DriveEmulator`, `WozDisk`, `WozFile` (`.woz` images). |
| `MockMicroSD` | Bit-banged SPI SD card (`SDCard`) over a memory-mapped image (`MappedFile`). |
| `Badger6502VMTest` | MSTest (native C++) CPU and peripheral tests, including VIA, SNES gamepads, system speaker, and Mockingboard. |
| `Console`, `Badger6502Emulator`(+Package) | Win32 console and WinUI hosts. |
| `WozFileTestApp`, `dsk2woz2`, `picodisk` | WOZ tooling / disk conversion / Pico target. |

**Memory map — the cross-layer contract** (`vm.h`, `MM_*`; mirrored by the 22V10 GAL, the
web bridge, and `codegen/platform-ref.*`):

```
$0000–$8FFF  RAM (36 KB)          $2000–$5FFF  hi-res video pages
$9000–$BFFF  Microsoft BASIC ROM  $C000        keyboard data / $C010 strobe clear
$C030        system speaker toggle (any read or write access)
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

**SNES gamepad contract (onboard VIA1 at `$C200`):**

- VIA1 PB6 drives the shared controller latch and PB7 drives the shared clock. Controller 1
  returns active-low serial data on PB5 and controller 2 on PB4.
- `VM::SetGamepadState(index, pressedMask)` accepts controller indexes 0 and 1. Bits 0–11
  are pressed-state bits in the ROM's wire order: `B`, `Y`, `SELECT`, `START`, `UP`, `DOWN`,
  `LEFT`, `RIGHT`, `A`, `X`, `L`, `R`; bits 12–15 are unused and ignored.
- A PB6 rising edge snapshots both live masks. Bit 0 is then visible on PB5/PB4; each PB7
  rising edge advances to the next bit. Host changes during a scan take effect only at the
  next latch, just like physical SNES shift registers. After bit 15 the data lines idle high.
- A machine reset clears only the in-flight serial transaction; it does not disconnect or
  release host-reported controllers. The peripheral is attached only to the onboard VIA1,
  not either slot-4 Mockingboard VIA.

## Behaviour / Rules

- CPU is driven **cooperatively**: hosts call `VM::Step()` per instruction. The VM samples
  the shared level-sensitive IRQ line before the instruction and ticks the onboard VIA plus
  both Mockingboard VIA/AY pairs for every returned CPU cycle, then advances the VM-owned
  PCM sample clock. Presentation hosts may then advance host-owned keyboard/disk plumbing.
  `VM::WillExecuteCurrentInstruction()` reports whether the next step will execute the
  opcode at the current PC rather than tick a dormant `WAI`/`STP` or service NMI/IRQ; the
  web debugger uses that boundary without changing execution. The blocking `VM::Run()` is
  not used by the web build.
- `VM::GetMemoryReadMapping()` identifies the backing store currently selected at an address
  (primary 64K image, BASIC ROM, language-card bank 1/2, or shared language-card high RAM).
  `VM::PeekData()` follows that mapping without invoking memory-mapped device reads or
  soft-switch side effects. `VM::IsROMVisible()` reports whether an address currently
  resolves to the BASIC ROM, Disk II boot ROM, or upper ROM; debugger hosts use these
  queries for bank-correct breakpoints, opcode inspection, highlighting, and source labels.
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

**System speaker and mixed-audio contract:**

- Any bus read or write at `MM_SS_SPEAKER` (`$C030`) toggles the one-bit system-speaker
  latch, matching the schematic's address-decoded toggle circuit. Reset clears the latch.
- The latch continues to respond while host audio collection is disabled. At each host PCM
  sample point, its mono level passes through a DC blocker at 0.25 full-scale gain and is
  added equally to left and right.
- PCM scheduling and buffering belong to `VM`, not either sound device: the VM samples both
  AY outputs and the speaker from the same PHI2-derived clock and exposes one interleaved
  stereo stream. Enabling/disabling collection must not stop speaker, VIA, or AY state.

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
- SNES controller data is applied through VIA1's external PB5/PB4 input pins and obeys DDRB;
  software still performs the real `$C070` → CB2/NMI → ROM bit-bang scan.
- AY 1 and AY 2 remain separate left/right sources. The VM-level mixer combines them with
  the centered system speaker without changing the board's hard-panned stereo behavior.

## Data flow

`host controller state → VM::SetGamepadState() → SNES latch/clock on VIA1 PB6/PB7 →
active-low PB5/PB4 → ROM NMI scan → GAMEPAD1/GAMEPAD2`; otherwise
`6502 ROM/program → VM::Step() → memory/soft-switch access → device
(video/ACIA/VIA/$C030 speaker/Mockingboard/SD/Disk II) → VM PCM mixer (mono speaker +
left/right AY) + framebuffer + serial + register state → host (native window or web bridge
→ canvas/audio)`.

## Dependencies

- **Upstream:** the 512 KB ROM + `fontrom.dat` (`ROM-SOFTWARE.md`); WOZ/SD images.
- **Downstream:** the web bridge/client (`WEB-CLIENT.md`), the codegen harness
  (`CODEGEN.md`), and the hardware, which must match this behavior (`HARDWARE.md`).

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| 65C02 CPU + full ISA/addressing | Shipped | Covered by `Badger6502VMTest` (MSTest); instruction readiness is exposed for exact host debugger stops. |
| Memory map + soft switches | Shipped | `vm.h` `MM_*`; the shared contract, including stable read-mapping identity, side-effect-free mapped inspection, and ROM-visibility queries. |
| Text / lo-res / hi-res video | Shipped | `badgervmpal`; color/fringe logic shared with hosts. |
| Keyboard + ACIA serial | Shipped | `$C000`/`$C010`; `PS2Keyboard`, `acia`. |
| VIA1 + bit-banged SPI micro-SD | Shipped | `via` + `MockMicroSD`. |
| Two serial SNES gamepads on VIA1 | Shipped | Shared native/WASM peripheral; latch/clock, active-low data, reset, and two-pad scans covered by MSTest. |
| `$C030` system speaker + VM audio mixer | Shipped | Any read/write toggles the mono latch; centered PCM mixes with both AY channels; covered by native and WASM tests. |
| Slot-4 dual-AY Mockingboard | Shipped | Exact 3RIC `$C400/$C480`, 1.5734375 MHz, VIA IRQ, and hard-panned stereo; covered by native and WASM tests. |
| Disk II 5.25″ floppy (WozLib) | Shipped | `$C600` boot PROM + `$C0E0–$C0EF`. |
