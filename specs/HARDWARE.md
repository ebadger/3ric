# 3RIC — HARDWARE Spec

> Source of truth for the physical Badger6502 machine. Update it in the same commit as any
> schematic, PCB, or PLD change. Hardware changes that move an I/O register or the memory
> map are **cross-layer events** — they must land in `ROMS.md`, `EMULATOR.md`, and the
> emulator core together.

---

## Purpose

The discrete-logic 65C02 computer itself: CPU, memory, address decoding, video generation,
keyboard, serial/parallel I/O, and the Disk II + micro-SD interfaces — captured as KiCad
schematics/PCB, 22V10 GAL equations, a Logisim model, and a DIYLC layout.

## Contracts / Interfaces

The hardware's externally-depended-on contract is the **6502 address space** (what the ROM
and both emulators target). Current layout (64 KB CPU map):

| Range | Use |
|-------|-----|
| `$0000–$BFFF` | RAM (zero page, stack, program/video RAM) |
| `$C000` / `$C010` | Keyboard data / strobe-clear (Apple-II `KBD`/`KBDSTRB`) |
| `$C0E0–$C0EF` | Disk II data registers |
| `$C201` / `$C20F` | VIA1 port-A register — bit-banged SPI to the micro-SD card (CS=b4, SCK=b3, MOSI=b2, MISO=b1) |
| `$C600` | Disk II boot PROM |
| `$D000–$FFFF` | ROM / OS (reset vector at `$FFFC/$FFFD`) |
| `$E000–` | BASIC (generic Microsoft BASIC) within the ROM region |

> Additional VIA/ACIA register addresses and the full decode map: **to document from the
> KiCad schematic** (`kicad/`, `schematic_pdf/`). Keep this table authoritative once filled.

Key components (as emulated; confirm exact part numbers against `kicad/`):
- **CPU:** 65C02, ~1 MHz.
- **Video:** hardware character/graphics generator driven by ROM sequencing — `syncsignals`
  (H/V sync + timing), `videaddress` (video RAM address generation), and `fontrom`
  (character generator). Produces Apple-II-style 40×24 text, lo-res, and hi-res color. See
  `ROMS.md`.
- **I/O:** 65C22 VIA (VIA1 used for micro-SD SPI), 65C51 ACIA (serial), PS/2 keyboard.
- **Storage:** Disk II–style 5.25″ floppy interface; micro-SD card (SPI via VIA1).
- **Glue logic:** 22V10 GAL(s) for address decoding (`22v10/`), emulated as `badgervmpal`.

## Behaviour / Rules

- The machine boots from the reset vector at `$FFFC/$FFFD` into the monitor ROM.
- Video timing is generated continuously by the sync/address ROMs independent of the CPU.
- Any change to a chip's address decode, a VIA/ACIA register, or the video timing **must**
  be reflected in the GAL equations (`22v10/`), the schematic (`kicad/`), and the emulator
  (`emulator/Badger6502VMLib`) so hardware and emulators stay consistent (the critical path).

## Data flow

```
Power-on → 65C02 reads reset vector ($FFFC) from ROM → monitor runs
CPU bus ↔ address decode (22V10 GAL) → RAM / ROM / VIA / ACIA / Disk II / video latches
Video ROMs (sync + address) + font ROM → video signal → display
Keyboard (PS/2) → $C000 ; Serial → ACIA ; SD/SPI → VIA1 ($C201/$C20F)
```

## Dependencies

- Upstream: none (this is the base layer).
- Downstream: `ROMS.md` (targets this memory map), `EMULATOR.md` (emulates this hardware),
  `DISK.md` (Disk II + micro-SD interfaces), `WEB.md` (emulates it in the browser).

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| KiCad schematic + PCB | Shipped | `kicad/`, PDF exports in `schematic_pdf/` |
| 22V10 GAL equations | Shipped | `22v10/` |
| Logisim logic model | Shipped | `logisim/` |
| DIYLC layout | Shipped | `diylayout/` |
| Full memory/decode map documented here | In progress | Fill the table above from the schematic |
| Exact BOM / part numbers in this spec | Not started | Tracked gap — read from `kicad/` |

> Build walkthrough: the YouTube series linked from the repo `README.md`.
