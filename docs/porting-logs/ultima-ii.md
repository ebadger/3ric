# Ultima II: a DOS 3.3 translator under unmodified binaries

**2026-10-15. Emulator-verified; no physical-board trial yet.**
The owner supplied three Apple II disk images (`u2prgfix.dsk`, `u2master.dsk`,
`u2galact.dsk`) and asked for a port like the
[Ultima IV one](https://github.com/ebadger/u4remastereda2) (`fixed` branch). That port
rebuilt a disassembled source tree: it moved data out of `$E000-$EFFF`, replaced
`BIT $C010` with `STZ $C000` and rewrote each disk request as ROM DOS `CD` and
`BLOAD` commands. Ultima II has no source tree, so this port follows the
[Ultima V](ultima-v.md) approach instead: keep Origin's binaries and replace what
sat underneath them. The disks and the generated SD folder contain the game and stay
local; this repository holds the converter, the glue code and its tests only.

## What the disks turned out to be

All three are 140 KB **DOS 3.3** images whose VTOC is `$FF` apart from the catalog
pointer, and every file is a binary (`B`) file:

| Disk | Folder | Contents |
|------|--------|----------|
| Program | `PROGRAM` | `HELLO` ($6000, title/menu), intro overlays `UL II FL WII`, `CREATE`, `STD SUBS.OBJ`, `TABLES.903C.OBJ`, `ULTIMA II.OBJ` ($5000-$88CE), `PIC.*` slideshow |
| Player master | `PLAYER` | `PLAYER` ($4E00, the character), Earth's `MAP xy` ($1000, 4 KB), `MON xy`, `TLK xy`, `STARS.OBJ`, `DNGDRAW.OBJ`, `END` |
| Galactic | `GALACTIC` | the other planets' `MAP/MON/TLK` files, plus `STARS.OBJ` and the shared overlays |

The two data disks reuse names with **different contents** (`MAP 10`, `MON 32`,
`TLK 41`, ...), so the disk in the drive matters and the folders cannot be merged.
Only the player master's Earth surface maps, their monsters and `PLAYER` are ever
written.

The important finding is that Ultima II never touches DOS 3.3 internals. Every disk
access is text: an inline-string printer (`JSR $402C`, or its copies in `HELLO` and
`CREATE`) sends Ctrl-D, `BLOAD MAP 21`, CR through `COUT`. Map digits are poked into
those strings. The game uses RAM up to `$95FF` (`TABLES` ends at `$94FF`) and never
uses the language card. Disk swaps are prompts that wait for ESC: "INSERT PLAYER
DISK" at the start of play and around character creation, and "INSERT PLAYER DISK"
or "INSERT GALACTIC DISK" in `STARS.OBJ` when a ship lands.

## The port

`node codegen/tools/port-ultima2.mjs <disk-dir> <out-dir>` finds the three disks by
content, applies the patches and writes `<out-dir>/U2/`: `U2.PRG` (3.25 KB at
`$0800`) and one folder per disk. DOS 3.3 names become 8-character keys of letters
and digits (`MAP 21` → `MAP21`, `ULTIMA II.OBJ` → `ULTIMAII`). Copy `U2` to the
card root, then: `CD U2`, `BRUN U2.PRG 0800`.

**Translator** (`codegen/patches/ultima2/resident.s`, `$9600`, where DOS 3.3 used to
live): the game's `CSW`. Ordinary characters go to `COUT1`. A Ctrl-D starts a
command line, which runs at CR:

| DOS 3.3 | 3RIC ROM DOS |
|---------|--------------|
| `BLOAD name[,A$a]` | `FLOAD key a 0000 len-1` (address and length from a generated table) |
| `BRUN name` | the same, then `JMP` (no return, like DOS 3.3) |
| `BSAVE name,A$a,L$l` | `OWRITE key a l`, only for an existing file of exactly `l` bytes |
| `NOMON I,O,C`, `MON`, `MAXFILES` | ignored |
| `DISK n` (port only) | `CD ..`, `CD PROGRAM/PLAYER/GALACTIC` |

The ROM command goes through the ROM's own Ctrl-D collector (captured from the
`$03EA` hook) with screen echo muted; `$B0-$BF` (the ROM's FAT32 zero page) and
`CSW` are saved and restored, and A/X/Y survive every `COUT`. An unknown command, a
file missing from the current disk or a partial `BSAVE` prints a one-line reason and
the command, then stops in the monitor before the ROM sees it - DOS 3.3 would also
have stopped the game there.

**Patches** (seven sites, each byte-verified and idempotent): every "insert disk"
prompt string is rewritten in place to Ctrl-D `DISK n`, space-padded to its length
and ending in CR, and the `BNE` of its ESC wait becomes `NOP NOP`. Sites: main
program `$500D` (player), `CREATE` `$600D` (player) and `$6586` (program),
`STARS.OBJ` `$8FD7` (player) and `$9005` (galactic) on both data disks.

**Loader** (`loader.s`): checks that `COUT` is `JMP ($0036)` and the `$03EA` hook
exists, zeroes the ROM NMI nest counter `$CAFE` and turns the BASIC overlay off,
copies the translator to `$9600`, records the previous and ROM-collector `CSW`,
starts the gamepad timer (below), selects `PROGRAM`, plants `JMP no_hello` at
`$6000` (so a failed `HELLO` load stops with a message and the timer off rather
than running stale memory) and prints `BRUN HELLO` through the translator, as the
boot disk's DOS did.

## SNES gamepads (added 2026-10-17)

Ultima II reads the keyboard in many places (`RDKEY` in the menu and character
creation, `$C000` polling in the command loop, ESC waits), so the pads are turned
into keystrokes rather than patched into each input path. The 3RIC ROM's `KEYIN`
reads the `$C000` latch directly, and the ROM's own keyboard decoder writes there,
so a key the resident writes into `$C000` is indistinguishable from a typed one.

The loader points the ROM's Apple-style IRQ vector (`$03FE`; the ROM's entry saves
A in `$45`) at the resident, clears both Mockingboard VIAs' interrupt enables and
runs the first VIA's Timer 1 free-running at ~30 Hz. The game never uses the
Mockingboard or `$45`. On a Timer 1 IRQ the resident clocks both pads itself on
VIA1 port B, copying the ROM scan's pin sequence (`$B99B`: latch, then 16 clock
pulses, data on bits 5 and 4, active low, with the same settle time before each
read), ORs the two pads, and turns a new press into its key when `$C000` bit 7 is
clear. The latch is checked immediately before the store and a press counts as
sent only once stored, so a busy latch retries next tick and a pending key is not
overwritten. The D-pad repeats after ~0.33 s, every ~0.13 s. Any other IRQ is an
ACIA received byte in the emulator (the board routes the ACIA to NMI, where the
ROM does the same): it is delivered to `$C000` as a key rather than left asserted.

| Pad | Key | Ultima II |
|-----|-----|-----------|
| D-pad | Return / `/` / ← / → | north / south / west / east, and direction answers |
| A | `A` | Attack |
| B | `E` | Enter |
| X | `T` | Transact |
| Y | `G` | Get |
| L | `Z` | Ztats |
| R | `I` | Ignite torch |
| Select | ESC | dismiss prompts |
| Start | Space | pass / continue |

ROM DOS commands run with IRQs masked, so the poller never interleaves with SD
bit-banging. A tick costs about 1,000 cycles: 2.1% of the CPU measured, with no
NMI raised.

**Detours:**
- The first version touched `PTRIG $C070` and read the ROM's pad tables. The review
  panel found that the ROM's `$C070` path also arms VIA1's paddle timers: three NMIs
  per tick, each ending in a blanket VIA1 `IFR` clear that can drop a PS/2 edge -
  the failure the A2Robots port hit on the board. It also cost 3.8% of the CPU.
  Clocking the pads directly removed every scan NMI. A rate of 60 Hz had cost ~7%.
- The first overhead figure read 52% because `vm.run()` budgets do not map to
  executed cycles while interrupts are active; a per-instruction `vm.step()`
  profile gave the real number.
- A "pending key overwritten" failure was a test race (the consumer read the typed
  key before its pause took effect), and stray NMIs in the profile were the test's
  own `$C010` strobes (CB1), not the poller.

## Why it was simpler than Ultima V

- **No language card.** The ROM stays mapped, so the CPU takes the ROM's NMI vector:
  PS/2 edges, the `$C010` strobe and paddle triggers reach the unmodified ROM
  handler, which brackets itself with `BIT $C006`/`BIT $C007` and restores BASIC-off
  when `$CAFE` returns to 0. No resident NMI path was needed, unlike Ultima V,
  Archon and A2Robots.
- **No block reads.** Every load is a whole file, so there is no raw-block chunking
  or cache. Loads cost one `FLOAD`; a map change is two.
- **`$C010` stays.** The Ultima IV port's `BIT $C010` → `STZ $C000` rewrite is not
  needed with the current ROM, which services the `$C010` strobe itself.

## What went wrong on the way

- **The VTOC is not a VTOC.** The first reader rejected all three disks: Origin's
  VTOC fills tracks/sectors/version with `$FF`. Only the catalog pointer is
  checked now.
- **The table did not fit in `$9600-$9FFF`.** 104 distinct (name, address, length)
  entries plus the code reach `$A1FF`; the tool allows up to `$AFFF`, all of it
  former DOS 3.3 space.

## Evidence (WASM emulator, real ROM DOS and SD emulation)

`node codegen/tools/port-ultima2.test.mjs` (after `web/build.ps1`):

- DOS 3.3 reader on a synthetic image with an Origin-style VTOC; SD key mapping.
- The seven prompt patches: exact replacement, idempotent, refused on other bytes.
- The real loader and translator on a generated FAT32 card with **synthetic**
  disks: text reaches the screen and commands do not; `NOMON` ignored; default and
  explicit-address `BLOAD` stop exactly at EOF; the same name loads different bytes
  after `DISK 2` and `DISK 3`; `BSAVE` rewrites a file that reads back identically;
  `BRUN` runs; BASIC stays off; A/X/Y survive `COUT`; the file table is intact.
  A missing file, a partial `BSAVE` and `CATALOG` each stop in the monitor with
  their message, in text mode, with the gamepad timer off, without reaching the
  ROM. A card missing `HELLO` stops with "HELLO DID NOT LOAD" instead of running
  stale memory.
- Gamepads on the emulated SNES pads (`setGamepadState`), after a ROM DOS command:
  all twelve buttons on either pad type their mapped key once; a held D-pad repeats
  (5-8 keys a second), a held A does not; a pending typed key survives and the pad
  key follows; A, X, Y and flags survive the IRQ; 30 ticks per 30 timer periods;
  2.1% CPU; no CB2 scan or T1/T2 paddle-timer NMI; ROM `FLOAD` is entered with IRQs
  masked. On the real disks a D-pad press walks the party south. The ACIA-receive
  branch is not exercised (the bridge has no serial-input call).
- With `U2_DISKS=<folder>`: the original disks run through the intro to the menu,
  create a character (saved to `PLAYER`, then back to `PROGRAM` and `HELLO`),
  start play on Earth's map in mixed hi-res with the character loaded, and run the
  patched `STARS.OBJ` galactic and player swaps in place: the following `MAP 30`
  load matches the galactic disk's file (not the player disk's), and `MAP 40`
  matches the player disk's.

Manual emulator sessions on the original disks (scripted keys, screenshots): the
title animation, the demonstration slideshow (`PIC.*`), movement, Z-stats,
quit-save (`OWRITE MAP20/MON20/PLAYER`), walking 44 steps to a dungeon in 1423 BC
(the save on entry, then `MAP24`, `MON24`, `MONSTERS`; "IT'S DARK!" without a torch),
and reloading the saved character by re-entering `$5000` after clearing its page.
The translator's code and table were unchanged after play.

**Physical board:** not yet tried.

**Not yet shown:** towns and dialogue (`TLK`), combat beyond wandering monsters,
buying and flying a ship, landing on another planet through real play, time doors,
and the endgame (`END`). The keyboard path on the board is the ROM's own, but no
native PS/2-frame test was run for this port.

## Known limits

- **Map saves write one sector too many (known issue, shipped by owner decision).**
  The ROM's `OWRITE` sizes a write as ⌊len/512⌋+1 sectors (`fat32_bytes_to_clusters`
  ORs the whole-sector count into its round-up test at `$EB07`). The translator passes
  the file length, so 256-byte `PLAYER`/`MON` saves are exact but every 4 KB `MAP`
  save writes a ninth 512-byte sector (from `$2000`) past the end of the file's
  cluster chain, onto a location derived from the end-of-chain marker - most
  likely in the second FAT copy. The game keeps working; the card may need
  `chkdsk` on a PC. Fix when wanted: pass `len-1` (as `FLOAD` already does) and add a
  4 KB save round-trip test. Found by the review panel; not yet observed on a card.
- **512-byte clusters only for saves.** The ROM's write loop advances to the next
  cluster on every sector (`$E53C` → `$E3EB`), unlike reads. Multi-sector saves are
  only correct on cards formatted with one sector per cluster, as the repository's
  shipped card image is. On a card with larger clusters, map saves lose all but their
  first 512 bytes and write the rest elsewhere.
- **Unvalidated converter inputs (known issue).** The tool does not reject one image
  that matches two disk roles, files that would load over the translator at `$9600`,
  or DOS 3.3 files whose header length exceeds their allocated sectors (trailing
  track/sector-list slots are read as zeros). The owner's three disks convert
  correctly; other or damaged images may not be caught.
- **Over-long commands are truncated, not rejected.** A Ctrl-D line over 96
  characters is cut and still executed. Ultima II's longest command is 26.
- **`BRUN` leaves its four bytes of call frames on the stack**, as reviewers noted.
  Kept deliberately: a `BRUN` routine that ends in `RTS` returns to its caller as
  under DOS 3.3, no Ultima II `BRUN` target returns or checks the stack, the game
  keeps no data in page 1, and abandoned frames on the circular stack are never
  popped.
- **Gamepads need the slot-4 Mockingboard.** Its VIA supplies the poll timer; on a
  board without it the pads are ignored and the keyboard still works. With the
  timer running, the ROM's IRQ entry overwrites `$45` (unused by the game). Only
  emulator-tested: the browser injects keys without the PS/2 receiver, so the
  board's keyboard-plus-pad interaction is unproven, and no native PS/2-frame test
  was run. A PS/2 key decoded between the poller's latch check and its store (two
  instructions) can still be overwritten by a pad key. The poller adds ~1,000-cycle
  pauses to speaker tones 30 times a second.
- **Speed.** 3RIC runs at 1.573 MHz, so the game and its speaker sounds run about
  1.54x faster than on a 1.02 MHz Apple II, including the idle timer that makes
  the party "PASS".
- **The card's contents are trusted.** The translator checks its own table, but the
  ROM DOS reports failures only as text, so a missing or renamed file on the card
  loads nothing and the game continues on stale memory. Copy the whole folder.
- **Reserved memory.** `$9600-$AFFF` belongs to the translator while the game runs, and the IRQ vector `$03FE` and Mockingboard VIA 1 Timer 1 to the pad poller;
  `$C800-$CFFF` remains ROM state.

## Next steps worth discussing

- A physical-board trial of character creation, a save and one landing.
- A short play script that reaches a town and a conversation, to cover `TLK`.
