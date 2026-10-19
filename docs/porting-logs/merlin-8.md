# Merlin-8 2.58: a ProDOS assembler on the 3RIC DOS card

**2026-10-18. Emulator-verified; no physical-board trial yet.**
The owner supplied both disks of *Merlin-8 v2.58 (ProDOS)* (Glen Bredon, Roger
Wagner Publishing, 1987) and asked for a port that loads and runs from 3RIC DOS and
loads and writes files through 3RIC DOS. The disks and the generated folder contain
the commercial program; they stay local. This repository holds the converter, the
6502 glue and its tests only.

| Input (`.dsk`, DOS order) | SHA-256 |
|---|---|
| disk 1, `/MERLIN.8` | `ed7d0dbbf2cd3cf7d2a0053fdcebc6e4a52b11ca3d467310c59494a9afba4111` |
| disk 2, `/APPLESOFT` | `4af615d3c0d43decfe57b7faa53ca9e504618a31790727b43d6a44ed53fc62e8` |
| `MERLIN.SYSTEM` | `19f8102aa632426c111868c82ce069751d019cdd3d23347c90dec98aca1c0d39` |
| `ED` | `0e45a543e1ed32d4a4dca0a6833a6df02c475f0c1808091ae30b5731b567ec27` |

## Using it

```text
node codegen/tools/port-merlin8.mjs <disk1.dsk> <disk2.dsk> <out>
copy <out>/MERLIN8 to the card, then at the 3RIC DOS prompt:
  CD MERLIN8
  BRUN MERLIN.PRG 0800
```

The main menu shows `Prefix: /SD/MERLIN8/`. `C`atalog, `L`oad, `S`ave, `A`ppend,
`D`isk commands (`CREATE`, `DELETE`, `RENAME`, `BLOAD`, `BSAVE`, `BRUN`, `PREFIX`, ...),
`E`ditor/assembler and `O`bject save all go to the card. In the full-screen editor,
**Ctrl-A then a key** is Open-Apple + key (Ctrl-A Q leaves it). `Q`uit returns to the
3RIC DOS prompt in the same folder, where the files Merlin wrote are ordinary FAT32
files (`DIR`, `FLOAD`, `BRUN HELLO 0900`). The folder carries the `SOURCE`, `LIBRARY`
and `PI` samples and disk 2's `APPLESOF` sources.

## What Merlin needed

`MERLIN.SYSTEM` relocates itself: its main part to `$B200-$BEFF`, the editor and
assembler to both language-card banks, and loads `ED` (the full-screen editor) at
`$9DB6`. It talks to ProDOS for everything, and expects a 128 KB IIe:

1. **ProDOS.** Unlike the Ultima I stand-in (a fixed table of files, whole-file
   `FLOAD`/`OWRITE`), an assembler creates, extends, renames and deletes arbitrary
   files and catalogs directories. The ROM DOS commands cannot extend or create files
   safely from a program (see the `OWRITE` notes in `specs/ROM-SOFTWARE.md`), so the
   stand-in is a small FAT32 file system on the ROM's two sector routines.
2. **Auxiliary memory.** Merlin keeps the symbol table and object buffer in aux RAM
   (`RAMRD`/`RAMWRT` `$C002-$C005` around every access; `AUXMOVE $C311`). A trace of
   every aux access while assembling showed the pages used are reached only through a
   handful of base/limit constants. 3RIC does not decode the aux switches, so moving
   those constants into main RAM (symbols from `$5800`, object buffer `$7000-$84FF`)
   makes all the aux accesses plain main-RAM accesses. Source space is `$0901-$57FF`
   (~19 KB).
3. **80 columns and IIe firmware.** `PR#3` jumped into `$C300`, which on 3RIC is the
   ROM-disk register page; it is replaced by `PR#0`, and the editor's video setup is
   held to 40 columns. The RamWorks bank store to `$C073` is removed (that page is the
   3RIC paddle/pad trigger).
4. **Language-card interrupts.** Merlin runs from LC RAM, so PS/2 NMIs fetch the card's
   vector; the Wizardry/Ultima V resident is reused, generalized to restore read-only
   bank 2 as well as read/write bank 1 (write state probed by flipping `$DFFF`).
5. **Open-Apple.** ED reads `$C061`, which 3RIC's ROM rewrites with SNES pad state.
   ED's key vector now goes to a Ctrl-A prefix handler whose flag ED's three
   Open-Apple tests read instead.
6. **The ED load check.** Merlin's `BLOAD` refuses loads above the source limit; ED
   itself loads above it by design, so that one address is allowed.

## Review fixes

The two-model review panel found, and this port fixed: a RENAME with directories in
the path renamed the parent directory (the new path's lookup moved the saved entry
location); the bank probe flipped all of ``, so an NMI inside it could see the
other bank's signature and restore the wrong bank (it now flips bit 0 only, and a test
injects NMIs exactly there - the old probe fails it); entries could reach the card
before their FAT sectors; locked files were not enforced; disk-full writes reported no
bytes; the free-cluster hint carried only 16 bits; empty or `/SD//` names were
accepted; SET_PREFIX could overflow; 16 MB+ files wrapped on OPEN. Each has a test
except the write ordering, which is by construction (no write-fault injection).

## Evidence

- `node codegen/tools/port-merlin8.test.mjs` (after `web/build.ps1`): converter and
  patch guards; a synthetic `MERLIN.SYSTEM` makes every MLI call Merlin uses, including
  each error path, a 20-file directory spanning two ProDOS blocks, MLI calls and pad
  NMIs from both language-card modes, and QUIT; then the ROM DOS `FLOAD`s and `DIR`s the
  result and the test walks the card (both FATs equal, chains match sizes, no lost or
  shared clusters). Run on 512-byte clusters and on 4 KB clusters with a fragmented file.
  Loader refusals (missing `MERLIN.SYS`, different ROM).
- With `MERLIN_DISKS=<disk1>;<disk2>`: the real Merlin catalogs, assembles
  `SOURCE/EDMAC.S` to an `EDMAC` object byte-identical to the disk's `UTILITIES/EDMAC`,
  BLOADs it back, edits a program in ED with Ctrl-A, assembles, saves source and object,
  BRUNs it, reloads the source and quits to the ROM DOS, whose `DIR` lists the files.
  During development `KEYMAC.S` also assembled byte-identical (under a host-side MLI), and `CLOCK.S` assembled on the real stand-in
  with no stray stores into the stand-in, caches, global page or resident (traced).
- `pwsh codegen/tools/port-merlin8.native.ps1`: the resident through the MSVC native PS/2
  harness at 94/120/160-cycle bits (Caps Lock LED exchange, strobe on a stop bit, every
  NMI preserving registers, flags, bank and overlay). At 94 cycles fewer NMIs reach the
  resident because the ROM serves edges that arrive while it is selected; the harness's
  minimum is an argument for this profile.

## Limits

- No physical-board trial. No real clock (`@` sets a date that is stamped on writes).
- Not exercised: Sourceror, the linker (`LNK`/`REL`), `/RAM`, `ED.16`, the `UTILITIES`
  programs (several load into the relocated workspace or the stand-in and are left out).
- RENAME works within a directory only; one volume (`/SD`); 3 open files; long FAT names
  are not shown; 8.3 mapping can collide (the converter refuses collisions in its own
  output). The FSInfo free-cluster count is left stale (the ROM ignores it).
- Write ordering after an interruption (power loss, reset) is designed but not tested by
  fault injection.
- Depends on fingerprinted ROM SD/FAT32 internals, like the Wizardry I port.
