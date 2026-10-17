# Seven Cities of Gold: an SD-card port in the Ultima IV style

**2026-10-16. Emulator-verified; not yet tried on the board.**
The owner supplied the two Apple II disk images (program and map disk) and asked for
a port like the [Ultima IV one](https://github.com/ebadger/u4remastereda2) (`fixed`
branch), which replaced the game's disk access with the 3RIC ROM DOS and the SD card.
The disks and the generated SD folder contain Electronic Arts' game; they stay
local. This repository holds the converter, the glue code and its tests only.

## What the disks turned out to be

Neither disk has a DOS. The program disk boots Electronic Arts' own loader: a
whole-track reader at `$0C00` pulls tracks 1-2 to `$A000-$BFFF` and an obfuscated
bytecode interpreter there (its own symbol table is still on the disk: `ILDA`,
`IJSR`, ...) loads tracks 7-16 to `$0800-$95FF`, XORs every other byte of
`$4000-$67FF` with runs 1..n (n = 5, 6, ...), times raw nibbles on half-tracks
`$18-$1F` as copy protection and jumps to `$4000`. The game then moves three blocks
into place (`$4E00-$95FF` up by `$2200`, `$1000-$1FFF` to `$6000`, `$4900-$4D1F` to
`$6100`) and loads the language card from 63 program-disk sectors (bank 1 from
T29 S1, bank 2 and `$E000-$FEFF` from T26 S2).

From then on all disk access goes through one routine: Ozark's own DOS 3.3 style
RWTS (entry `$8EEF`, fixed IOB at `$8CE4`) - overlays of 16 sectors from the map
disk, map sectors streamed while you explore, saves, and the World Maker, which
carries a second copy of the same RWTS `$7900` lower and formats and writes a new
map disk. The game is single-drive and asks for the map disk to be swapped in.

Two things about that RWTS matter. Its read and write loops address the buffer
through **operands patched in place** (`$8B5F` for reads, `$8A57` for writes); the
IOB's buffer field is stale. The map layer points writes at its own page and the
World Maker load moves reads to `$5F00` (the incoming code overwrites `$1F00`).
And the game never sets the NMI vector: it is whatever language-card RAM held.

## The port

`node codegen/tools/port-sevencities.mjs <program.dsk> <map.dsk> <out-dir>` (gzipped
images are accepted) writes `<out-dir>/7CITIES/`:

- `7CITIES.PRG` (1.4 KB at `$0800`): loader + resident + final stage.
- `GAME.BIN` (`$0800-$BFFF`): memory exactly as the boot loader leaves it at
  `JMP $4000` (decryption reproduced; SHA-256 of the unpatched image pinned),
  with the patches below.
- `PROGRAM.DSK`: the program disk with two signature bytes and the World Maker's
  RWTS entry and shim changed. `MAP.DSK`: the map disk, unchanged. Both stay 140 KB
  DOS-order images on the card; the game reads and writes them in place.

Copy `7CITIES` to the card, then `CD 7CITIES`, `BRUN 7CITIES.PRG 0800`. The tool
refuses to overwrite an existing folder, whose `MAP.DSK` may hold saves.

**Disk access** (owner decision: fast direct access over ROM DOS commands). ROM DOS
commands cost ~0.8 s per 256-byte `FLOAD` on the emulated card - 13 s per overlay and
1.6 s stalls while sailing - so the shim calls the ROM's `sd_readsector`
(`$E1B9`) and `sd_writesector` (`$E21C`) directly: LBA in `$B0-$B3`, 512-byte buffer at
`$C800`. Track T, sector S is half of card sector `base + (T*16+S)/2`; a write is a
read-modify-write. The loader learns each file's first cluster from the ROM's FAT32
variables after an `FLOAD` of its first 256 bytes, proves the computed sector holds
those bytes, and walks the FAT (ignoring the four reserved bits of each entry) to
prove the file is contiguous. It refuses a missing
or fragmented file, or a ROM whose SD routines (`$E141-$E279` checksum) or NMI proxy
differ. Measured: ~102 ms per sector read (the floppy traced at ~110 ms), ~200 ms
per write, ~23 s to format.

**Shim** (`codegen/patches/sevencities/shim.s`, two copies): game at `$8B82-$8CDE`,
World Maker at `$1282-$13CC`, each in its RWTS's dead code below the IOB and above
every operand the game still patches. It keeps the IOB contract (seek, read, write,
format, status `$40` on a bad track), takes the buffer pages from the RWTS operands,
saves ROM zero page `$B0-$B9`, and restores the language-card state it found
(`$DFFF` signature: `$A5` bank 1, `$5A` bank 2, `$00` ROM). `port_disk` (`$CFF8`)
says which disk is "in drive 1": the start-up language-card loads go through
`prog_load` (program disk, then map disk), the World Maker load through `prog_stay`
(program disk until its format, which selects and zeroes the map disk).

**Resident** (`resident.s`, `$CF00-$CFB5`, state at `$CFF0-$CFF8`): the Ultima V NMI/IRQ
forwarder unchanged - PS/2 start/data/parity edges and the `$C010` strobe serviced
without bank work, everything else (stop bit, joystick scan, ACIA, timers) through
the ROM handler with `$C083`/`$C08B` restored. The loader sets both language-card
vectors to it before the game starts.

**Game patches** (each checked against the expected original bytes):

| Runtime | Change | Why |
|---------|--------|-----|
| `$8EEF` | `JMP $8B82` | RWTS → SD shim |
| `$6862-$6877` | `$03 = 0`, `$650A = 0`, `JMP $6994` | copy-protection call skipped, leaving what a passed check leaves (its code at `$6100` is reused as data later) |
| `$4071`, `$408A`, `$6A0C` | `JSR prog_load` / `prog_stay` | the three program-disk loads |
| `$40AF`, `$40BC` | `NOP`s | keep the ROM reset vector in LC RAM |
| `$40B3`, `$40C5` | IRQ → resident | was the game's wipe-and-reboot stub |
| `$8A00-$8A13` | button helpers | `BIT $C070`, 3 NOPs, `LDA`/`BIT $C061` |
| `$774D`, `$84F3`, `$88E8` | `JSR` helper | button tests that never triggered a joystick scan |

## What went wrong on the way

- **The "copy-protection reboot" was an NMI.** Booted from WOZ images the game
  sometimes wiped memory and rebooted. It was the `$C010` strobe: on 3RIC that is an
  NMI, the language card was mapped, and the vector was `$0000` - a `BRK` into the
  game's IRQ vector, its anti-tamper wipe. With the forwarder in place the protection
  check itself passed in the emulator; it has no disk to time on the SD card.
- **The IOB buffer lies.** The first shim used IOB `+8/+9` (always `$1F00` in traces)
  and played fine, but would have written `$1F00` instead of the map layer's page on
  every save, and broken the World Maker load. Found by reading who patches the RWTS.
- **3RIC buttons need a scan.** `$C061`/`$C062` are refreshed by the ROM's `$C070`
  joystick scan (the Spy Hunter lesson). In play the paddle read scans every frame;
  two "press button" waits never did. The timed one silently timed out (menus seemed
  to pick their defaults), the endless one hung the first screen of a new world.
- **"Dead" code was not dead.** The first bypass and helpers lived in the protection
  routine at `$6100`; a late snapshot showed that area reused as data. Space for new
  code now comes only from regions checked unchanged in late-game snapshots.
- Assembler: `SPC` (an equate) and `spc:` (a variable) are the same symbol, and `CPX`
  in a multi-byte add loop clobbers the carry. Both cost a run.

## Evidence (WASM emulator, real ROM, real ROM DOS and SD emulation)

`node codegen/tools/port-sevencities.test.mjs` (after `web/build.ps1`):

- Converter: track layout, gzip, identification, the decryption key stream, the
  relocation map, every patch guarded and surviving relocation, World Maker offsets.
- Real loader, resident and both shim copies on generated FAT32 cards with
  **synthetic** disks and `GAME.BIN`, at 512-byte and 4 KB clusters and with FAT32's
  reserved entry bits set: reads and writes
  on both disks with bank 2, bank 1 and ROM mapped (state and zero page preserved),
  half-sector isolation, buffer pages taken from the operands (stale IOB page never
  touched), bad track, seek, `prog_load`, the World Maker copy's program-disk read and
  format, `$C010` strobes and the button helper's scan with each bank mapped.
- Loader refusals: missing `MAP.DSK`, fragmented `MAP.DSK` / `GAME.BIN`, changed ROM.
- With `SEVENCITIES_DISKS=<folder>`: the original disks load the language card (63
  program-disk sectors) and reach the title, NMI vector on the resident.

`pwsh codegen\tools\port-ultima5.native.ps1 -Resident codegen\patches\sevencities\resident.s`
(MSVC): the resident decodes real PS/2 frames at 94/120/160-cycle bit periods with the
language card mapped, including Caps Lock LED exchanges and a stop-bit strobe; 293
NMIs per run preserve registers, flags, bank and overlay.

Scripted sessions on the original disks (screenshots, shim and protection logs):
title → menus by joystick button → *The Beginning* → experience, court, Spain street
→ ship → *Leaving Old World* → sailing west → "You have discovered a new world!" →
landing, a farming tribe, a village, back to the ship; all reads from `MAP.DSK` after
the 63 program-disk sectors; the protection code never runs. **World Maker**: 73
program-disk reads, format, 301 writes and 208 read-backs of `MAP.DSK`, "The new world
awaits!"; after a reset and `BRUN`, the new world starts a NOVICE expedition (court
loan, Spain).

**Not yet shown:** a save at the Pub and *Resume a saved game* in a real session
(the write path is the one the World Maker exercised), a full voyage home, the
endgame, and anything on the physical board.

## Known limits

- **Binds to the ROM.** The shim calls `sd_readsector`/`sd_writesector` and the
  loader reads FAT32 variables; a ROM with different SD routines is refused at load.
- **Files must be contiguous** (normal after copying to a card); the loader refuses
  otherwise rather than fall back.
- **Other releases are converted with a warning, untested.** Only the program disk
  this port was built on is recognised (pinned image hash). Another dump is still
  converted if every patch site holds the expected bytes, but the 349- and 331-byte
  regions the two shims overwrite are not verified, and the pinned hash does not cover
  the World Maker sectors - such a conversion may crash. (Review finding; owner chose
  to document it rather than refuse.)
- **The World Maker overwrites `MAP.DSK`.** Keep a copy of the original map disk -
  the demo only works with the historical map. Restart (reset, `BRUN`) afterwards.
- **Keys pressed during disk access may be lost:** the SD routines read VIA port A,
  which shares its interrupt flags with the PS/2 clock. The game is played with the
  joystick (SNES pad through the ROM's paddle emulation); keys are Ctrl-S (sound),
  Ctrl-R (restart) and Space (pause).
- **Timing:** the 3RIC CPU runs 1.54× an Apple II, so animation and sound are faster;
  no clock correction is attempted.

## Next steps worth discussing

- A board trial, then a save/resume session on the card.
- Several map disks (`MAP1.DSK` ...) chosen at load, instead of one file the World
  Maker overwrites.
