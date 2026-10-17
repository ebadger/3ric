# Wizardry I: an SD-card port of an Apple Pascal game

**2026-10-16. Emulator-verified; no physical-board trial yet.**
The owner supplied the Apple II boot and scenario disks of *Wizardry: Proving
Grounds of the Mad Overlord* (version 2.1 of 22-JAN-82) and asked for a port like
the [Ultima IV one](https://github.com/ebadger/u4remastereda2) (`fixed` branch) and
the in-repo [Ultima V port](ultima-v.md). The disks and the generated SD files
contain Sir-Tech's game; they stay local. This repository holds the converter,
the 6502 glue and its tests only.

| Input (decompressed `.dsk`) | SHA-256 |
|---|---|
| boot, `/WBV2.1` | `99a982c2a711adc545d6e17a71df7350ff9b2336c3013e131f3b4bdc741d0229` |
| scenario, `/WSV2.1` (a played copy: 20 characters on the roster) | `9629120fb37bdcd416a93ff6b1bb3d442fe321703e1e77cdc593c5e470dd598e` |

## What the disks turned out to be

Both disks are **Apple Pascal 1.1 volumes**, not DOS 3.3. Wizardry is a UCSD
p-code program with a few 6502 procedures, run by `RTSTRP.APPLE` - a stripped
runtime (p-machine interpreter + BIOS) that the boot block loads to
`$9200-$BEFF` of main RAM. The game is a 48 KB program.

| Boot disk | Scenario disk |
|---|---|
| `WIZARDRY.CODE` 6-148, `RTSTRP.APPLE`, `SYSTEM.PASCAL`, `SYSTEM.LIBRARY`, `SYSTEM.MISCINFO`, `WT` (title picture), `SYSTEM.STARTUP` (title, menu, utilities) | the identical `WIZARDRY.CODE` 6-148, `SCENARIO.DATA` 149-264, `SCENARIO.MESGS` 265-279 |

On a one-drive Apple II you boot the boot disk, choose **S)TART GAME**, and the
game asks for `SCENARIO MASTER IN DRV 1` and then `MASTER/DUPLICATE IN DRV 1`.
All game I/O goes through two BIOS entries (`DISKREAD`/`DISKWRITE`, jump table
`$BDC5/$BDC8`, bodies `$AF2C/$AF28`) with block, byte count, buffer and drive on
the 6502 stack and `IORESULT` returned in X.

## How it was found

The original disk boots on 3RIC's emulated Disk II (converted with `wozgen`) to
the animated title, so the CPU, video and language-card behavior were fine. A
small UCSD II.1 p-code disassembler (scratch, not committed) then explained each
stop:

1. **Write-protect check.** `SYSTEM.STARTUP`'s `OPTIONS` segment writes block 0
   and hangs unless `IORESULT = 16`: the master boot disk must be write-protected.
2. **Boot timing check.** `WIZBOOT` proc 4 calls a 6502 routine that times
   sectors on tracks 10-13 directly on the Disk II and compares them with values
   derived from block 5. This copy's routine returns canned values (an old crack)
   that run out on the second call, so **S)TART GAME** halted.
3. **Language card mapped empty (anti-RESET).** `WIZARDRY.CODE`'s key-wait
   routine reads `$C083`/`$C08B`, leaving the empty language-card RAM mapped so a
   RESET finds zero vectors. On 3RIC every `$C010` strobe is an NMI, which jumped
   to `$0000`. This is the Ultima V problem again.
4. **Scenario timing check.** `SPECIALS` proc 9 reads 6502 code from
   `SCENARIO.DATA` (block +3) to `$2000` and runs it (dispatcher code 60,
   `JMP $2002`) for the same kind of track timing; on failure it calls code 70,
   which wipes memory.
5. **Watermark.** That routine's seek stores `10` in screen hole `$0479`; the
   `CASTLE` segment checks it twice and wipes memory if it is missing.

A side finding, not fixed here: after the Disk II motor has stopped,
`DriveEmulator` returns no data for a full second after motor-on, so the Pascal
BIOS's spin check fails with error 9 when the user takes more than a second
between disk accesses. That is a WozLib fidelity gap recorded in
[`EMULATOR.md`](../../specs/EMULATOR.md); the SD port does not use the Disk II.

## The port

`node codegen/tools/port-wizardry1.mjs <disk-dir> <out-dir>` reads both images
(`.dsk`/`.do`/`.po`, either sector order, optionally gzip-compressed), finds the
boot and scenario volumes by their files and writes `<out-dir>/WIZ1/`:

- `WIZ1.PRG` (2 KB at `$0800`): loader + resident page + shim.
- `WIZ1.VOL` (411 blocks): **one Pascal volume holding both disks.** Blocks
  0-279 are the scenario disk (boot area, its serial block 5, `WIZARDRY.CODE`,
  `SCENARIO.DATA/MESGS`); the boot disk's system files follow as one run from
  block 280. The directory takes the boot disk's header - the system volume the
  runtime booted from - with the new size and all nine files. (The runtime's
  volume search checks header byte 25: with the scenario's header it probed
  drive 2, kept `SYSIO` in memory and loaded later segments 3.6 KB lower, which
  crashed.) Both disk prompts are then answered by pressing RETURN.
- Four byte-verified p-code patches, located through the code files' segment
  dictionaries:

| File / segment + offset | Change | Why |
|---|---|---|
| `SYSTEM.STARTUP`/`WIZBOOT`+`$4C` | `l2 := 1` → `UJP` to its `EXIT` | skip the boot timing check after copying the serial (so `SER:` shows the scenario's) |
| `WIZARDRY.CODE`/`SPECIALS`+`$808` | `CLP 16` → `NOP NOP` | skip the scenario timing check |
| `WIZARDRY.CODE`/`CASTLE`+`$1584` | `SLDC 10; NEQI` → `SLDC 0; LAND` | the `$0479` watermark check becomes false |
| `WIZARDRY.CODE`/`CASTLE`+`$196` | same | second copy |

The write-protect check needs no patch: the driver returns 16 for block 0.

Copy `WIZ1` to the card, then at the DOS prompt: `CD WIZ1`, `BRUN WIZ1.PRG 0800`.

**Loader** (`codegen/patches/wizardry1/loader.s`): checks COUT, the ROM NMI proxy
and Fletcher sums of the ROM code the glue depends on; finds `WIZ1.VOL` (exact
size) by reading the current directory's entries itself; installs the resident;
fills the language card - shim at `$E000`, the file's **cluster table** (one LBA
per cluster, from the FAT chain, so fragmentation and any cluster size work),
bank signatures (`$DFFF` = `$A5`/`$5A`) and RAM NMI/IRQ vectors; reads block 2
through the shim and checks the volume header; reads the first 45 pages of
`RTSTRP.APPLE` to `$9200` through the same BIOS path, checks and patches the
DISKREAD/DISKWRITE body (`$AF31` → `JMP disk_entry`), and enters the runtime as
the boot block does (`X=$60`, ROM selected, `JMP ($BEFE)`).

**Resident** (`resident.s`, `$CF00-$CFFF`): the Ultima V PS/2 fast path and ROM
forwarder unchanged, plus `disk_entry` (records ROM / bank 1 / bank 2, runs the
shim with bank 1 read/write, restores the mapping, drops the ten parameter bytes,
returns X = `IORESULT`) and `rom_sd` (calls the ROM sector routine with ROM reads
and bank-1 writes).

**Shim** (`shim.s`, language-card `$E000`): block n of the volume is file sector
n, LBA = `cltab[n >> shift] + (n & mask)`. Whole blocks move directly between the
card and the caller's buffer through the ROM's `sd_readsector`/`sd_writesector`;
a final partial block goes through a bank-1 buffer. `IORESULT`: 8 outside the
volume, 9 any drive but slot 6 drive 1, 16 for writes outside blocks 2-279 (the
scenario's) or not in whole blocks. Only `$B0-$B3`/`$B8-$B9` of zero page are
touched, saved and restored.

## What went wrong on the way

- **The first driver used `FLOAD`/`OWRITE`.** It worked through the real ROM DOS
  with the volume split into 97 chunk files (8-block read-only chunks, 2-block
  chunks aligned to the game's 1 KB `SCENARIO.DATA` windows, because `OWRITE`
  always writes from the start of a file). It cost ~0.7 M cycles per 512-byte
  block - 128 M cycles of disk before the title (81 s at 1.57 MHz) - because
  `FLOAD` copies byte by byte, skips to its start offset by reading, and scans
  the directory each time. Benchmark: `FLOAD` ~370 K cycles per sector,
  `sd_readsector` ~150 K. With owner approval the port switched to direct sector
  I/O: the same 23 boot calls take 19.6 M cycles (12.5 s), 6.5× faster.
- **A failed `FLOAD` does not fail.** For a missing file the ROM prints `NOFIND`
  and then still runs `fat32_file_read_part` with stale state, so the loader
  finds the file by scanning directory sectors itself.
- **Assembler symbols are case-insensitive:** a `sd_read:` label silently replaced
  the `SD_READ = $E1B9` equate and the first direct-I/O build read nothing.

## Evidence

`node codegen/tools/port-wizardry1.test.mjs` (after `web/build.ps1`), no game data:

- Pascal reader in both sector orders, segment dictionaries, the combined volume
  (relocation, header, serial block), guarded idempotent patches, refusal of
  mismatched `WIZARDRY.CODE`.
- The real loader/resident/shim on the ROM DOS with a synthetic volume and a fake
  runtime at RTSTRP's BIOS addresses, on cards with 1-sector, 8-sector
  **fragmented** and 64-sector clusters: whole, partial (stops at the byte count)
  and cross-cluster reads; errors 8, 9 and 16 (block 0, boot blocks, partial
  block, straddling the protected end); write and read-back; NMIs with bank 2 and
  bank 1 mapped and BIOS calls from both banks restoring bank, write enable and
  the BASIC overlay.
- Loader refusals: missing, short or foreign `WIZ1.VOL`, unexpected runtime,
  different ROM code.
- With `WIZ1_DISKS=<folder>`: the original disks boot from `BRUN` to the animated
  title, the menu (write-protect probe answered 16), both disk prompts, the
  castle, the edge of town and the training grounds.

`pwsh codegen\tools\port-wizardry1.native.ps1` (Visual Studio C++ tools) runs the
Ultima V native PS/2 harness against this resident: real frames at 94/120/160-
cycle bit periods, Caps Lock LED exchange and a `$C010` strobe on a stop bit, with
language-card banks swapped between keys - all pass.

Manual WASM sessions on the original disks: title, menu, both prompts, castle,
tavern (a character joined: the 1 KB roster window was written back), edge of
town, camp and the 3D maze view at the stairs. Typical costs at 1.57 MHz: a town
location segment 1.4-1.8 s, a 1 KB roster window 0.2 s, entering the maze ~5 s.

**Not yet shown:** a physical-board run; combat, spells, deeper maze levels,
leveling up and a full save/reload cycle across a reboot on a real card.

## Known limits

- **ROM coupling.** The glue calls `sd_readsector` (`$E1B9`) and `sd_writesector`
  (`$E21C`) and reads `fat32_fatstart`/`datastart`/`rootcluster`/`sectorsper-
  cluster` (`$CC00/$CC04/$CC08/$CC32`) and the current directory (`$CC20`). The
  loader refuses a ROM whose code in those ranges differs; a ROM update means
  regenerating `WIZ1.PRG`. SD errors are the ROM's: it prints a message and stops.
- **One drive.** Utilities that need two different disks (backup, make scenario,
  transfer between scenarios) are not useful: drive 2 reports error 9 and the
  backup utility refuses a disk that holds `WIZARDRY.CODE`. Copy `WIZ1.VOL` on a
  PC to back up characters.
- **Disk protection removed.** Sir-Tech's timing checks cannot run without a
  Disk II; the four patches above are the whole change to the game.
- **Speed.** About 150 K cycles per block with no cache: ~12 s of disk time
  from `BRUN` to the title, 1.4-1.8 s per town location.
