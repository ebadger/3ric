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
language-card RAM. Music came back later through a compact player written for
this port (see **Music** below).

## The port

`node codegen/tools/port-ultima5.mjs <disk-dir> <out-dir>` reads the eight images,
finds each volume by name and writes `<out-dir>/U5/`:

- `U5.PRG` (~5.5 KB at `$0800`): loader, resident page, music glue, the player's
  RAM2 tables, and the shim + player image for bank 1.
- One folder per disk (`ULTIMA5 BRITANIA UNDRWRLD TOWNE DWELLING CASTLE KEEP DUNGEON`).
  ProDOS names become 8-character keys with the dots removed (`MAIN.COMBAT` →
  `MAINCOMB`), and a one-letter extension names the file's ProDOS load address in a
  table the loader installs (`MAINCOMB.P`; no extension = 0). Each disk's 280 blocks
  are also written as `RAW00`-`RAW22`, 4 KB each, and each folder starts with the
  repacked songs `SONG01`-`SONG15`.
- Guarded patches (each applied only over the exact original bytes): `STARTUP $8169`
  no longer writes the IIe aux/RamWorks switches `$C008/$C005/$C004/$C073` (no-ops
  in the emulator; the board's `$C00x` decode is not specified for them); the three
  keyboard reads (SNES pads, below); and 46 music sites (below).

Copy `U5` to the card root, then at the DOS prompt: `CD U5`, `BRUN U5.PRG 0800`.

**Shim** (`codegen/patches/ultima5/shim.s`, bank 1 `$D000`): keeps DINKEYDOS's jump
table, inline parameters, zero page (`$52-$55`, `$60-$7F`) and return codes. It
calls the ROM's FAT32 routines directly - the ones its `FLOAD` and `OWRITE` commands
use (`fat32_open_cd`, `fat32_finddirent`, `fat32_opendirent`,
`fat32_file_read_part`, `fat32_file_write`) - through the resident's `rom_call`
(ROM reads, bank-1 writes, so loads can land in `$D600` and `$E000-$FFFF`), saving
the ROM's zero page `$B0-$BF` around each session. A volume select sets the ROM's
current-directory cluster from a table the loader fills in; a file is found in the
current directory only (so a missing file fails with `$46`, as on the floppy) and
read as bytes `[0, size-1]`; the lookup matches `KEY.*` (the ROM's own wildcard) and
the extension letter it finds gives the load address; a write rewrites the file's
sectors in place, as `OWRITE` does; a block read loads 512 bytes of `RAWnn` into
`$D600`. The first version sent ROM DOS command lines through `COUT`; direct calls
freed ~1.2 KB of bank 1 for music and made missing files detectable. The loader
refuses to start (with a message) if `STARTUP` turns up without an extension: files
from an older `U5` folder are still on the card and would be found first.

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

**Loader** (`loader.s`): checks the ROM NMI proxy `$F1BB-$F1C5` (whose receiver
state the fast path shares) and the first 8 bytes of each ROM FAT32 routine the
shim calls against the repository's ROM image (otherwise it prints a message and
stops in the monitor), turns the BASIC overlay off and zeroes the ROM NMI nest
counter (`$CAFE`), copies the resident, the music glue and the player's tables
into RAM2, finds the eight disk folders in one `fat32_readdirent` pass (one lookup
per folder cost ~0.3 s each), detects the Mockingboard, copies the shim into
bank 1 and clears bank 2/high RAM while the ROM is still selected for reads (an NMI
during setup always sees ROM vectors), installs the RAM vectors, starts the music
timer, then selects `/ULTIMA5` and runs `STARTUP` exactly as DINKEYDOS would.

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

**Music** (added after the board ran the game). The 128K edition's Mockingboard
driver (`MUDR`, with `MUDI`, `MUIN` instruments and `MUFF` songs) lives in auxiliary
memory and takes ~19 KB; 3RIC has 64 KB and main RAM is full. A reverse-engineering
pass documented its format and algorithm exactly (per-tick sequencer, two ADSR
envelopes, a register shadow flushed on change, the `$80-$83` request interface), and
this port plays the songs with a compact re-implementation (`music.s`, ~1.3 KB):

- **Memory.** Bank 1 holds the shim, the player and one song buffer (`SONGBUF`,
  865 bytes). The player's state is in RAM2 `$CA00-$CAD6`; its tables (period,
  duration, noise, instrument records, voice map, load addresses) are in RAM2 the
  ROM uses only at boot or from the DOS prompt (`$CAD7-$CAFD`, `$CC3D-$CCFF`,
  `$CD00-$CD6B`, `$CE24-$CEDF`); the game-side glue is at `$CD80` (`ram2.inc` has
  the map).
- **Songs: all 15.** Origin's songs are 243-1961 bytes. The tool repacks each one
  (absolute pointers, tempo as a ready T1 latch, instrument numbers as record
  offsets, sync bytes dropped) and then compresses it in two lossless steps:
  - *Durations:* a note names duration register A, B or an explicit index, and
    commands set the registers. Origin's encoding spends ~23% of all events on
    register changes; dynamic programming over the register pair picks the cheapest
    encoding for each track (-3 to -14%).
  - *Phrases:* the repeated phrase that saves the most bytes becomes a subroutine,
    again and again (greedy grammar compression). Two player commands carry it:
    `$39 n` calls entry `n` and `$3A` returns, both keeping pitch and duration (Origin's
    own `$3C`/`$3D` reset them). Calls of both kinds nest 3 deep per voice.

  Song 1 (Ultima Theme) goes 1716 → 1240 bytes, 11 (underworld) 1300 → 790,
  5 (Stones) 1075 → 552, 12 (Blackthorn) 895 → 689. The tool then replays every voice
  of the packed bytes against Origin's original (notes with pitch register, duration
  and tie; rests; transposes, levels, instruments, tempi; the end) and refuses to
  write a song that differs.
- **The block buffer as a second region.** Only song 1 is still larger than the main
  buffer. Its remaining 375 bytes go to `$D600-$D7FF`, the DINKEYDOS block buffer,
  which only block reads (`$D024`) write. The title requests song 1 after its last disk
  access and never reads a block while it plays (traced in the emulator). If a block
  read does come (leaving combat after the victory theme, say), the shim drops the
  song first; the player silences and the foreground loads the song again (it
  restarts). No event stream crosses between the two regions.
- **Loading.** When the tick meets a song that is not in the buffer it goes silent
  and asks the foreground; the next keyboard scan (`pad_poll`, already called from
  the game's scankey) reads `SONGnn` from the current disk folder (a song with a
  second part takes a second read of the same file), then the tick starts it.
- **Timing and pitch.** The tool pre-scales note periods, the noise period and every
  timer latch for 3RIC's 1.5734 MHz Mockingboard clock (×1.5385), from the user's own
  `MUDR` (no driver data is stored in the repository).
- **Game hooks.** The game talks to the driver through aux zero page `$80-$83`
  between `STA $C009`/`STA $C008`, behind `LDA $EC / LSR / BCC` (music card present).
  The patches open those gates and turn the two stores into `JSR mus_in` /
  `JSR mus_out`, which swap the game's `$80-$83` with the player's copy. The song
  helper `TEMP.SUBS $15B9` becomes `mus_setx` (no wait), and the pause/resume
  dispatcher `MAIN.SUBS $EE46` calls `mus_ctl`: pause silences at once and stops the
  timer (the original faded out over ~0.85 s before every disk access), resume
  restarts it and the volume ramps back up as before. The title screen's
  music-synchronized animation waits (`$037F`) keep their 64K behaviour.
- **IRQ.** The resident's IRQ entry checks the Mockingboard T1 flag (`BIT $C40D`,
  patched in by the loader only when a card answers), maps bank 1 if the game is in
  bank 2, runs one tick and restores the bank; anything else still goes to the ROM.
  ROM sessions hold the timer off (`IER`) because the ROM owns the vectors then.

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
- **The first music layout did not fit.** Shim, player and tables left 62 bytes for
  a song. Calling the ROM's FAT32 routines directly instead of building DOS command
  lines, and moving the tables into RAM2 that only the ROM's boot code and DOS prompt
  touch (found by scanning the ROM for absolute references), left 804, enough for
  11 songs.
- **The other 4 songs.** Compression (above) brought songs 5, 11 and 12 under the
  buffer and song 1 to 1240 bytes. Room came from replacing the 234-byte load-address
  hash table with file-name extensions, sizing the period table to the notes the songs
  use (MIDI 26-99) so the extension table fits in RAM2, and moving code between the
  two halves of bank 1; the rest of song 1 borrows the block buffer.
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
- Music end to end with **synthetic** driver files: the song request goes through
  the glue, the foreground loads `SONG01` on demand, the timer IRQ plays it while
  bank 2 is mapped (mixer, scaled period, envelope, scaled tempo latch checked in the
  register shadow), pause silences every channel and stops the timer, a file loads,
  resume restarts it and the volume ramps back. The synthetic song is built too large
  for the main buffer, so it also covers the second region: its part in the block
  buffer is loaded with a second read, a block read drops it, and the song is loaded
  again and plays. All 46 music-site patches are exact and guarded.
- Song repacking on a synthetic song: a repeated phrase becomes a keep-state
  subroutine, a song too large for the main buffer continues in the second region,
  one too large for both is rejected; every result passes the replay check.
- File names carry the load address; a leftover `STARTUP` from an older folder stops
  the loader with a message.
- With `U5_DISKS=<folder>`: the original disks boot to the animated title with the
  Mockingboard timer running and all 15 songs built (each passing the replay check).
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

Player accuracy (session-only, since it runs Origin's data): a py65 harness ran the
assembled player against the reverse-engineered reference (itself verified bit-exact
against the original driver) and compared the AY register image and timer latch
after every tick, with the reference scaled to 3RIC's clock: all 15 compressed songs
exact for 6000 ticks (songs 1, 5, 11 and 12 for 16000, past their loop points; song 1
read from both regions), plus switching, bit-7 and `> 15` requests, stop/restart,
volume changes and both chain cases. A tick costs ~3-5 K cycles on average (6-15% of
the CPU).

Manual emulator sessions on the original disks (scripted keys, screenshots):
title and intro animation; character creation through the gypsy's questions,
with the save written to `UNDRWRLD`/`BRITANIA`; *Journey Onward* into Iolo's hut;
walking out to Britannia (overworld chunks streamed from `BRITANIA/RAWnn`); a
wandering-monster fight (`PRECOM` → `MAIN.COMBAT` → back to `MAIN.OUT`); entering
Yew (`TOWNE` disk, towne map blocks); Z-stats overlay; Quit & Save. With the pad
only: menu → *Journey Onward* (A), single steps and held walking in the hut,
Z-stats (Start) and cancel (L), pass (B). With music: *Journey Onward* starts the
huts song in Iolo's hut (audible Mockingboard output); requests for songs 2, 9, 3
and 10 load each from the disk folder mid-game and play; music keeps playing across
moves. The title plays the Ultima Theme (song 1, part of it in the block buffer)
from its request onward, with the animation running.

**Physical board:** the first trial booted to the title; the keyboard did not
respond and there was no music (expected then). With the PS/2 fix, the owner
reports the game running on the board. SNES controllers and music: not yet tried
on the board.

**Not yet shown:** a conversation (the `TALK` overlay loads; no scripted dialogue
completed), dungeons, keeps/castle, the endgame, and performance on a real card's
cluster size.

## Known limits

- **Music:** a song change mid-game pauses the game briefly while `SONGnn` loads at
  the next keyboard scan. Song 1 restarts if the game reads a disk block while it
  plays. Pause is immediate rather than a fade. The player depends on the RAM2 areas
  above staying unused by the ROM during play, and on the ROM FAT32 routines the
  loader checks. Bank 1 is full: a later code change can push a song (the tool says
  which) into the block buffer.
- **Updating the card:** delete the old `U5` folder before copying a new one (the
  loader detects leftovers and says so).

- **Missing files are now detected** (the ROM's directory search fails cleanly with
  `$46`, as on the floppy), and a missing disk folder stops the loader with a
  message. A damaged file is still trusted. Copy the whole `U5` folder.
- **Interrupts other than NMI and the music timer:** the IRQ forwarder always
  presents a hardware IRQ to the ROM (status B clear), so a `BRK` while
  language-card RAM is mapped would not reach the monitor.


## Next steps worth discussing

- **Fast block reads:** resolve each disk's block file to an SD sector once per
  volume change and read blocks with the ROM's sector routine. Expected ~10x faster,
  but it binds the port to undocumented ROM internals (`sd_readsector`, FAT32
  variables) and needs a contiguity check with an `FLOAD` fallback.
- **ROM `BLOAD` off-by-one** affects every program that loads data below live
  memory; fixing it is a ROM change outside this port.
