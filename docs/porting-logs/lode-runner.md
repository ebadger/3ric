# Lode Runner: an SD-card port on the ROM DOS, paced to an Apple II

**2026-10-18. Emulator-verified; not yet tried on the board.**
The owner supplied the Apple II disk image (`lode_runner.dsk.gz`) and the Atari 8-bit
release (for its sound), and asked for a port in the style of the
[Ultima IV one](https://github.com/ebadger/u4remastereda2): the game on the SD card
through the 3RIC ROM DOS instead of the Apple disk routines, high scores that save, the
board editor able to edit and add levels, native SNES gamepads, Apple II game speed, and
the Atari version's end-of-level sound on the Mockingboard. The disk images and the
generated SD folder contain Broderbund's game; they stay local. This repository holds the
converter, the glue code and its tests only.

| Input | SHA-256 |
|-------|---------|
| `LODE RUNNER` file on the disk (33,024 bytes, `A$0800`) | `a2e62f89abc8ae6aa763574fbf4db2b38cf7eb3f5b4fc0b68cbf339a12f9bd90` |
| Reference ROM `emulator/Data/badger6502.bin` | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

## What the disk turned out to be

A cracked release ("CRACKED BY ->RESET VECTOR!" in the catalog): DOS 3.3 boots and
`BRUN`s one binary, `LODE RUNNER`. It is byte-identical to `golden_source.bin` of
[XekriRedmane/lode_runner_reveng](https://github.com/XekriRedmane/lode_runner_reveng), a
complete literate disassembly; this port uses its names and addresses. The file loads at
`$0800`, jumps to `$2800`, copies itself to `$3F00-$BFFF` and moves `$3F00-$5EFF` down to
`$0000-$1FFF` (zero page and stack included); code runs at `$5F00-$8FFF`, the first
three levels (for the attract demo) at `$9F00-$A1FF`, sprite tables to `$B5FF`, and a
private copy of DOS 3.3's RWTS at `$B600-$BFFF`.

All disk access ends in that RWTS (`$B7B5`, IOB `$B7E8`). The level area is tracks 3-12:
one compressed level per sector (28x16 tiles, 4 bits each), 150 levels, and T12 S15 is
the high-score sector, which also says what kind of disk it is ("LODE RUNNER" marker,
last byte non-zero on the master). The board editor works only on a *data disk*
(initialized from the editor) and refuses to touch the master; the game plays and records
high scores on whichever disk is in the drive.

## The port

`node codegen/tools/port-loderunner.mjs <lode_runner.dsk[.gz]> <out-dir>` writes
`<out-dir>/LODERUN/`:

- `LR.PRG` (731 bytes at `$0800`) - the loader; `GAME.BIN` - the `LODE RUNNER` file with
  27 guarded patches and the resident (below).
- `MASTER/` and `DATA/` - the two floppies: `HISCORE` (T12 S15) and `L00`-`L4F`, two
  level sectors per 512-byte file. `DATA` starts as a freshly initialized data disk.

Copy `LODERUN` to the card, then `CD LODERUN` and `BRUN LR.PRG 0800`. The tool refuses to
overwrite an existing folder (its scores and levels are the player's); `--update`
rewrites `LR.PRG` and `GAME.BIN` only.

**Disk.** `$B7B5` jumps to a shim that keeps the IOB contract and moves files with ROM DOS
`FLOAD`/`OWRITE` (the Ultima I/II/IV way), all of zero page saved around each command.
Every write is one 512-byte SD sector, which `OWRITE` writes correctly on any cluster
size (its multi-sector loop is only right on 512-byte clusters); a level write reads the
file, replaces its half and writes it back. Formatting the data disk would be ~80 writes,
so it is lazy: bytes 80-99 of `DATA/HISCORE`, unused by the game, are an erased-level
bitmap. The game's own checks still decide what may be written: the master's levels are
never edited, its high scores are.

**Two disks, `Ctrl-D`.** The user chose to keep the Apple's master/data split. `Ctrl-D`
swaps the folder ("the disk in the drive"): at the title it shows that disk's high scores,
labelled `MASTER DISK` / `DATA DISK`; in the editor the prompt reads
`(MASTER) COMMAND>` / `(DATA) COMMAND>`, and inside a command (`SOURCE DISKETTE`,
`DESTINATION DISKETTE`) it shows the disk at the cursor. `Ctrl-E` enters the editor on the
data disk; Move level may read from the master, so an original level can be copied and
then edited; `Esc` at the prompt returns to the title (the Apple editor had no exit). To
play your own levels as a full game, `Ctrl-D` to the data disk at the title and start.

| Editor key | Action | | Editor key | Action |
|-----|-----|-|-----|-----|
| `E` | edit a level (I/J/K/M move, 0-9 tiles, Ctrl-S save, Ctrl-Q done, arrows: next/previous level) | | `P` | play a level |
| `M` | move (copy) a level | | `C` | clear a level |
| `I` | initialize the data disk | | `S` | clear the disk's high scores |

**Speed.** The 3RIC CPU runs 1.538x an Apple II, and Lode Runner times everything by
instruction count. Mockingboard VIA 2 Timer 2 runs free (no interrupt) and measures the CPU
time since the last frame point (`PLAY_SOUND`, the input-wait delay, each iris step, the
game-over spin); `pace_sync` then waits 0.539x as long. `PLAY_NOTE` and `BEEP` are rebuilt
on the same timer from the original loops' cycle counts, so the speaker keeps its Apple
pitch. The game's own speed keys (left/right arrow) still work on top.

**SNES pads.** Read straight from VIA1 port B, never through `PTRIG` (the ROM's `$C070`
scan NMI is what broke keyboards in earlier ports). D-pad runs and climbs, Y/X/L dig left,
B/A/R dig right, Start pauses (and resumes), Select gives up the life (Ctrl-A); a button
starts a game, skips the demo and the high-score wait. Pad input switches to joystick mode
and I/J/K/L/U/O/space to keyboard mode, so neither player has to press Ctrl-J/Ctrl-K.

**Level-clear sound.** The Atari disk is copy-protected and its game is encrypted, so the
sound was found by running it: a small py65-based Atari harness (session-only) boots the
cracked ATR with sector reads, VBI interrupts and the SIO checksum, then runs the
level-cleared code (`$614D`) and logs every POKEY write per frame. The Atari game queues
4-byte notes (frames, AUDF3, AUDF4, AUDC) that its VBI plays on channels 3 and 4
(`AUDCTL = $80`, 64 kHz base). At a level clear it adds 100 points 15 times, each with the
note `[2, N, 0, $A9]` then `[2, 0, 0, $A0]` - two frames of a pure tone at volume 9, two
frames of silence - with `N` = 150, 145 ... 80 (channel 4 sits at AUDF 0, ~32 kHz,
inaudible). That is a rising 211.7 Hz to 394.6 Hz run lasting exactly one second. The
port plays it on channel A of both AYs (centre) with period `3.0769 x (N+1)`, in place of
the Apple's three speaker notes per 100 points; it is silent but timed with Ctrl-S sound off.

## What went wrong on the way

- **A patch landed inside an entry point.** `MAIN` jumps into the title loop at
  `$619B`, two bytes after the loop's label; the first title patch covered both and the
  game started a game by itself. Every patched range was then checked against all branch
  and jump targets in the game (only BEEP's own loop, which is replaced whole, falls inside).
- **The "unused" region was not.** The disassembly calls `$9000-$9EFF` unused, but the
  attract-mode demo reads its recorded moves from `$9B00`. With the resident past `$9B00`
  the demo runner died 30 s in. The resident now ends below `$9B00` and the rest lives in
  the replaced RWTS (`$B800-$BFFF`).
- **`fat32_filecluster` does not mean "found".** The Seven Cities port reads it after a
  load; here, set to `$FFFFFFFF` before an `FLOAD` of a missing file, the directory scan
  still changed it. Missing files are now detected by an `$A5` sentinel in the destination
  (no level byte or high-score initial can be `$A5`), and `OWRITE` - whose fallback for a
  missing file jumps into the BASIC bank - only follows a successful `FLOAD`.
- **The pacing paid for its own pad scans.** A 700-cycle scan inside a frame was padded
  like Apple work (+2.5% in the demo). Scans are now credited, and `pace_sync` discounts
  its own ~140 cycles; the demo's first level then lasts within 0.2% of the original's.
- **A test jumped in mid-command.** Starting the test program while the ROM was still
  executing a typed `CD` left the SD card mid-transaction ("SD READ FAILED"); the tests
  wait for the prompt.
- **Review round.** The two reviewers found that the lazy format left `DATA/HISCORE`
  without its marker until the editor rewrote it (now written with it), that the attract
  cycle showed the scores baked into `GAME.BIN` (the card's are now read at start-up and on
  leaving the editor), that the disk name after `DESTINATION DISKETTE` ran past column 27
  (it now goes on the next line), and that the loader had no test without the real disk.
- **Emulator finding (not changed here):** the VM's branch timing differs from the 65C02
  datasheet - a not-taken branch costs 3 cycles and a taken backward branch 4 (a
  `DEY/BNE` loop measures 6 cycles per pass instead of 5): `BranchOnFlag` adds the
  page-cross cycle using the unsigned offset. In the emulator, code therefore runs slower
  than on the board. The port's pacing measures time on a VIA timer, so it is correct on
  the board and self-consistent in the emulator; the timing test compares against the
  unpatched game run in the same emulator.

## Evidence (WASM emulator, real ROM DOS and SD emulation)

`node codegen/tools/port-loderunner.test.mjs` (after `web/build.ps1`):

- Converter on a synthetic DOS 3.3 disk: the catalog file, gzip, the relocation map,
  level files, the data-disk and master high-score sectors, every patch exact and guarded,
  the resident's two regions and buffers clear of the IOB.
- The output folder: an existing `LODERUN` is refused; `--update` rewrites `LR.PRG` and
  `GAME.BIN` and keeps the scores and levels.
- The real loader with a **synthetic** `GAME.BIN`: it loads at `$0800`, checks the sum and both
  `HISCORE` markers, hands the resident the collector, turns the BASIC overlay off and enters
  `$2800`; a changed `GAME.BIN`, a missing `GAME.BIN` and a missing or markerless `HISCORE`
  each stop with a message.
- The real resident on a generated FAT32 card with **synthetic** level files: master
  reads (`FLOAD L02 0D00 0100 01FF` for sector 5), zero page preserved, master level writes
  and formatting refused, the disk swap, data-disk read-modify-write leaving the partner
  level intact, the lazy format (erased levels read as zeros with no card access; a write
  clears one bit and zeroes an erased partner), score writes keeping the bitmap, missing
  files failing without an `OWRITE`.
- Pacing: work x1.539; `PLAY_NOTE` at 1.53-1.60x the original loop's true cycle count;
  `BEEP` within 2%.
- Pads: every button, both controllers, Start/Select edges, pause and resume, mode
  selection both ways, upper-case folding, the input-wait carry.
- Tally: 15 tones in 1.002 s (60 Atari frames), measured on both AYs at the POKEY pitches.
- With `LR_DISK` (the original disk): the loader and attract demo; high scores and
  `Ctrl-D` per disk; the editor drawing, saving and playing a data-disk level through a
  level clear (score 1,750, the tally heard), a game over recording `ABC` on the data
  disk, Move copying master level 1 into the data disk, Initialize, `Esc` out of the
  editor, and a master game started with a pad button and played with the D-pad. With
  `LR_TIMING=1` as well: the demo's first level against the unpatched game in memory.

Manual emulator session (screenshots): the master high-score table (Broderbund's scores
on the disk) and the empty data disk, each labelled; the editor prompt; a drawn level.

**Not yet shown:** anything on the physical board; a full game through the 150 levels.

## Known limits

- **Loading is slow.** `GAME.BIN` takes ~16 s at start-up; a level ~0.5-1.5 s (about
  0.43 s plus ~12 ms per directory entry in front of its file - the ROM DOS scans the
  folder for every command); saving a level ~2-3 s. Copy the folders in name order.
- **High-score initials and the editor need the keyboard.**
- **The game's own 1.538x-sensitive paths outside play** (the title's attract and
  high-score timeouts) still count loop passes, which the pad polling roughly slows back.
- **Trust:** the ROM DOS gives no error codes; a file that is present but damaged is used
  as is. The loader checks `GAME.BIN`'s sum and both `HISCORE` files.

## Next steps worth discussing

- A board trial: keyboard, pads, pacing and the tally on hardware.
- Faster level loads by resolving each folder's files once and reading sectors directly
  (the Seven Cities approach), at the cost of binding to ROM internals.
- The VM branch-timing finding above, as a separate emulator fix.
