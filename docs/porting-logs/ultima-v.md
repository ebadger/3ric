# Ultima V: an SD-card port in the Ultima IV style

**2026-10-15. Emulator-verified; first board trial booted but the keyboard failed (fixed, re-trial pending).**
The owner supplied the eight Apple II disk sides and asked for a port like the
[Ultima IV one](https://github.com/ebadger/u4remastereda2) (`fixed` branch), which
put each disk in its own SD-card folder and replaced DOS 3.3 disk reads with
Ctrl-D commands to the 3RIC ROM DOS. The disks and the generated SD folder contain
Origin's game; they stay local. This repository holds the converter, the glue code
and its tests only.

## What the disks turned out to be

All eight sides are **ProDOS volumes** (`ULTIMA5`, `BRITANNIA`, `UNDERWORLD`,
`TOWNE`, `DWELLING`, `CASTLE`, `KEEP`, `DUNGEON`), but the game does not use ProDOS.
The program disk boots **DINKEYDOS**, Origin's own 4 KB read/write ProDOS-format
loader. It copies itself to language-card bank 1 at `$D000` and exposes a 14-entry
jump table whose parameters follow the `JSR` inline:

| Entry | Use |
|-------|-----|
| `$D000-$D015` | load (or load and run) a file by inline name or pointer, at its aux type or an inline address |
| `$D018/$D01B` | write over an existing file (save game, rosters, temporary lists) |
| `$D01E/$D021` | select a volume (`/TOWNE`); a failure makes the game ask for that disk |
| `$D024/$D027` | read/write one ProDOS block through a buffer at `$D600` |

Each disk also has a run of blocks that no file owns (overworld chunks, towne
maps, dialogue, dungeon levels). The game reads them by block number:
Britannia's world is 16x16 chunks of 16x16 one-byte tiles, chunk `(x,y)` being half
`x&1` of block `152 + 8y + x/2`. The Ultima IV port had a reconstructed source tree;
Ultima V has none, so this port leaves the game binaries alone and replaces the
loader underneath them.

**128 KB is only for music.** `STARTUP` probes for IIe auxiliary memory only when
`$FBB3` reads `$06`; the 3RIC ROM returns `$EA`, so the game records "no aux" and every
later aux access (all in the Mockingboard music driver) is skipped. The game itself
runs in 64 KB, which 3RIC provides as RAM to `$BFFF` (BASIC overlay off) plus
language-card RAM.

## The port

`node codegen/tools/port-ultima5.mjs <disk-dir> <out-dir>` reads the eight images,
finds each volume by name and writes `<out-dir>/U5/`:

- `U5.PRG` (5 KB at `$0800`): loader + resident page + shim.
- One folder per disk (`ULTIMA5 BRITANIA UNDRWRLD TOWNE DWELLING CASTLE KEEP DUNGEON`).
  ProDOS names become 8-character keys with the dots removed (`MAIN.COMBAT` →
  `MAINCOMB`). Each disk's 280 blocks are also written as `RAW00`-`RAW22`, 4 KB each.
- One verified patch: `STARTUP $8169` no longer writes the IIe aux/RamWorks
  switches `$C008/$C005/$C004/$C073`. They are no-ops in the emulator; the board's
  `$C00x` decode is not specified for them, so the port does not depend on it.

Copy `U5` to the card root, then at the DOS prompt: `CD U5`, `BRUN U5.PRG 0800`.

**Shim** (`codegen/patches/ultima5/shim.s`, bank 1 `$D000`): keeps DINKEYDOS's jump
table, inline parameters, zero page (`$52-$55`, `$60-$7F`) and return codes. A
volume select becomes `CD ..` + `CD <dir>`; a file is looked up only among the
current disk's files (a table the tool generates: key, aux type, length, disk
mask) and loaded with `FLOAD key addr 0000 eof-1`; a write becomes
`OWRITE key addr eof`; a block read becomes `FLOAD RAWnn D600 start end` into
bank 1. A missing file or volume fails without reaching the ROM, as it did on the
floppy.

**Resident** (`resident.s`, `$CF00-$CFFF`): the game keeps language-card RAM
mapped, so the CPU takes NMI and IRQ vectors from the game's `$FFFA/$FFFE`. Every
PS/2 clock edge, `$C010` strobe and `$C070` paddle trigger is an NMI on 3RIC. The
loader points both RAM vectors here.

- **Fast path, no bank work:** PS/2 start, data and parity edges and the `$C010`
  strobe (CB1) are serviced directly, mirroring the ROM's receiver state
  (`KBSTATE $CE00`, `KBTEMP $CE01`, `KBD_NONPRINT $CE19`). DATA is read through
  `PORTA`'s no-handshake alias `$C20F` about 30 cycles after the edge; only the
  serviced IFR bit is acknowledged, and IFR is re-checked before `RTI`. A pending
  strobe is serviced before a stop bit is forwarded: the ROM's exit writes `$7F`
  to IFR and would otherwise discard it, leaving the key strobed.
- **ROM path:** the stop bit (scan-code decode), ACIA, paddles and timers go to the
  ROM handler. The entry saves X/Y (the ROM restores only A/X), reads a signature
  byte at `$DFFF` (bank 1 holds `$A5`, bank 2 holds the game's font, checked at
  build time), pushes the mode to restore, selects the ROM and enters its handler
  with a fake RTI frame (status B clear). The handler returns to the resident,
  which re-selects `$C083` or `$C08B` with two reads. Ultima V only maps the
  language card read/write, so those two modes are its complete state.

The shim runs ROM DOS commands: it saves `$B0-$BF` and `$36/$37`, points `CSW` at
the ROM's command collector captured from `$03EA` at load time, and calls the
resident, which selects "read ROM, write bank 1" (so loads can land in `$D600`
and `$E000-$FFFF`) while the Ctrl-D command goes through `COUT`.

**Loader** (`loader.s`): checks that `COUT` is `JMP ($0036)`, the `$03EA` hook
exists and the ROM NMI proxy `$F1BB-$F1C5` matches the one whose receiver state the
fast path shares (otherwise it prints a message and stops in the monitor), turns
the BASIC overlay off and zeroes the ROM NMI nest counter (`$CAFE`),
installs the resident, copies the shim into bank 1 and clears bank 2/high RAM
while the ROM is still selected for reads (an NMI during setup always sees ROM
vectors), installs the RAM vectors, then selects `/ULTIMA5` and runs `STARTUP`
exactly as DINKEYDOS would.

**SNES controllers** (added after the first board trial): the game reads the
keyboard in three places, all `LDA $C000`: `MAIN.SUBS` `scankey` at `$EFC2`
(every overlay goes through it), the title menu at `STARTUP $8B77`, and `VIEW
$A75A` (any key closes the map). Guarded patches turn each into `JSR pad_key`
(resident, same length). `pad_key` maps bank 1 if the game is in bank 2 and calls
`pad_poll` (shim, `$D02A` slot), then returns `LDA $C000` with X/Y and the other
flags unchanged. `pad_poll` reads both pads straight from VIA1 port B, the way
the ROM's scan does (PB6 latch, PB7 clock, PB5/PB4 data) but without `$C070`
and the paddle-timer NMIs that follow it, and types the mapped key into `$C000`
exactly as the ROM does for a PS/2 key, only when no key is pending. The game's
own `$C010` then acknowledges it. VIA1 Timer 2 (one-shot mode keeps counting) is
the clock: pads are read at most every ~1.3 ms, and a held direction repeats
after ~0.39 s, then every ~0.18 s, only while the game's key queue (`$B8`) is
empty, so releasing stops at once. Both pads are merged.

| Pad | Key | | Pad | Key |
|-----|-----|-|-----|-----|
| D-pad | arrow keys (move, menus) | | A | Return |
| B | Space (pass, continue) | | X | T (talk) |
| Y | A (attack) | | L | Esc (cancel) |
| R | E (enter, klimb) | | Start / Select | Z (Ztats) / Q (save) |

Names, numbers and the other commands still need the keyboard.

## What went wrong on the way

- **The keyboard did not work on the board** (first hardware trial). The first
  resident sent every NMI through ~42 cycles of bank selection before the ROM
  handler, so the ROM sampled PS/2 DATA after the keyboard had already moved to
  the next bit. The browser injects `$C000` directly and never showed it. A native
  harness that clocks real PS/2 frames reproduced it (`ULTIMA5` arrived as
  `SS EC`); the fast path above, the same approach the A2Robots and Archon ports
  needed, decodes it at 94-200-cycle bit periods with DATA held for half a bit.

- **`FLOAD`'s last operand is an inclusive end, not a length.** The first block
  reads asked for `0200` bytes from offsets past `0200` and loaded nothing; the
  game jumped into zero page. The Ultima IV port's `SS00 SSFF` operands were the
  clue; the ROM's read loop confirms it.
- **`BLOAD` stores one byte past EOF.** Its counter is decremented after each store
  and stops only on wrap. Loading `TLIST` (512 bytes at `$0E00`) zeroed `$1000`, the
  first letter of the Avatar's name, the moment the party left Iolo's hut. All loads
  now use `FLOAD 0000 eof-1`. This is a ROM behavior, not changed here.
- **`OWRITE` of a missing file jumps into BASIC-bank code.** Its fallback to
  `BSAVE` is `JMP $ACFD`, which is game RAM with the overlay off. DINKEYDOS only
  writes existing files, so the shim refuses unknown names before the ROM sees them.
- **Block reads are slow.** One 512-byte read measured **1.71 M cycles (≈1.1 s at
  1.573 MHz)** on a 512-byte-cluster card: ~82% is the bit-banged SPI byte loop over
  ~13 sectors (directory scan, FAT hops, and the sectors `FLOAD` skips byte by byte
  to reach its start). Chunking the raw blocks into 4 KB files instead of 32 KB
  avoids skips of up to 2 M cycles, and a one-block cache (Fletcher-16 checked)
  absorbs the game reading every block twice. Crossing an overworld chunk edge
  still pauses for about two seconds.

## Evidence (WASM emulator, real ROM DOS and SD emulation)

`node codegen/tools/port-ultima5.test.mjs` (after `web/build.ps1`):

- ProDOS reader on synthetic DOS- and ProDOS-order images; guarded `STARTUP` patch.
- The real loader/resident/shim on a generated FAT32 card with **synthetic**
  volumes: exact-length loads, pointer names, aux-type defaults, block reads and
  per-disk cache invalidation, volume switch, write and read-back, missing file /
  file on another disk / unknown volume errors, NMIs taken with bank 2 and with
  bank 1 mapped (bank, write-enable and BASIC-overlay state preserved), load-and-run.
- With `U5_DISKS=<folder>`: the original disks boot to the animated title.
- SNES pads through the real resident and shim with bank swaps: one tap types one
  key, holding Right 1.5 s types 8, release stops at once, chorded buttons both
  type; the keyboard-read patches are exact and guarded.

`pwsh codegen\tools\port-ultima5.native.ps1` (Visual Studio C++ tools): builds the
shared VM natively and types `ULTIMA5` as real PS/2 frames (bit periods 94/120/160
cycles, DATA held 80) while a program keeps language-card RAM mapped and swaps
banks between keys. Every NMI must return with A/X/Y, flags, stack, bank and BASIC
overlay unchanged (293 per run), a Caps Lock press must produce the ROM's ED LED command with the
Caps bit and the keyboard's FA replies, and a $C010 strobe landing on a stop-bit
edge must still clear $C000. The first resident garbles the typing; the second
fails only the stop-bit strobe case.

Manual emulator sessions on the original disks (scripted keys, screenshots):
title and intro animation; character creation through the gypsy's questions,
with the save written to `UNDRWRLD`/`BRITANIA`; *Journey Onward* into Iolo's hut;
walking out to Britannia (overworld chunks streamed from `BRITANIA/RAWnn`); a
wandering-monster fight (`PRECOM` → `MAIN.COMBAT` → back to `MAIN.OUT`); entering
Yew (`TOWNE` disk, towne map blocks); Z-stats overlay; Quit & Save. With the pad
only: menu → *Journey Onward* (A), single steps and held walking in the hut,
Z-stats (Start) and cancel (L), pass (B).

**Physical board:** the first trial booted to the title; the keyboard did not
respond and there was no music (expected: see below). With the PS/2 fix, the
owner reports the game running on the board. SNES controllers: not yet tried on
the board.

**Not yet shown:** a conversation (the `TALK` overlay loads; no scripted dialogue
completed), dungeons, keeps/castle, the endgame, and performance on a real card's
cluster size.

## Known limits

- **No music.** Ultima V's Apple II music needs 128 KB; `STARTUP` sees no
  auxiliary memory on 3RIC and disables it, exactly as on a 64 KB Apple II.
- **The card's contents are trusted.** The ROM DOS reports a failed command only
  as text (`NOFIND`, `ERR`), which the shim does not read, so every command is
  assumed to succeed. With the tool's complete `U5` folder that always holds. If a
  file or folder is missing or renamed, a load runs on stale memory and a save
  crashes (the ROM's `OWRITE` fallback runs `$ACFD`), where the floppy version
  would have reported an error. Copy the whole folder. (Owner decision, after the
  review raised it as a blocker.)
- **Interrupts other than NMI:** the IRQ forwarder always presents a hardware IRQ
  to the ROM (status B clear). Ultima V enables no IRQ source on 3RIC (its music is
  off), so a `BRK` while language-card RAM is mapped would not reach the monitor.

## Next steps worth discussing

- **Fast block reads:** resolve each disk's block file to an SD sector once per
  volume change and read blocks with the ROM's sector routine. Expected ~10x faster,
  but it binds the port to undocumented ROM internals (`sd_readsector`, FAT32
  variables) and needs a contiguity check with an `FLOAD` fallback.
- **ROM `BLOAD` off-by-one** affects every program that loads data below live
  memory; fixing it is a ROM change outside this port.
