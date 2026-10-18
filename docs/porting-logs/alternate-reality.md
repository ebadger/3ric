# Alternate Reality: The City and The Dungeon - SD-card ports

**2026-10-18. Emulator-verified; not yet tried on the board.**
The owner supplied the Apple II images of *Alternate Reality: The City* (Datasoft /
Paradise Programming, 1985) and *Alternate Reality: The Dungeon* (Datasoft, 1987) and
asked for them to run from the 3RIC SD card, like the
[Ultima IV port](https://github.com/ebadger/u4remastereda2) and the Ultima V, Seven Cities
and Wizardry ports. The disks and the generated SD folder contain the games; they stay
local. This repository holds the converter, the glue code and its tests only.

## What the disks turned out to be

| Side | Image | Volume | Notes |
|------|-------|--------|-------|
| City side 1 | `.nib` | 2 | a crack ("The Gonif and The Wombat"): boots a relocated DOS 3.3 RWTS |
| City side 2 | `.nib` | 3 | data; the game also **writes** to it (T25-T26) |
| City character disk | `.nib` | 253 | 2 sectors used: a boot stub and a 4-slot directory |
| Dungeon disk 1 side 1 | `.nib` and `.dsk` | 16 | the `.nib` is the original; `Disk 1 - Front.dsk` is a crack of it (3 sectors) |
| Dungeon disk 1 side 2 | `.nib` and `.dsk` | 17 | |
| Dungeon disk 2 side 1 | `.nib` and `.dsk` | 18 | |
| Dungeon character disk | `.nib` | 20 | one sector: `AR CHAR!` |

Every `.nib` decodes as a standard 16-sector disk (each nibble track's wrap repeats one
address field, hence 17 headers per track); the other `.dsk` files duplicate the nibs.
Nothing is DOS 3.3: each game has its own loader, and **all disk access goes through one
RWTS per game**, which names the side it wants by **volume number** - a wrong volume is
the game's cue to ask for a disk swap.

- **The City.** The boot sector loads track 0 sectors 0-13 to `$0800-$15FF`, copies the
  monitor ROM into language-card bank 2, points RESET at a memory-wiping stub and jumps to
  the crack's loader at `$1000`. The RWTS is DOS 3.3's, relocated to `$0800-$0FFF`
  (entry `$0D00`, IOB at `$106B`, called through `$1067: SEI; JMP $0D00`). The loader shows
  the crack's title, loads the game to `$4000-$7EFF` and its menu; before the menu the game
  copies the ROM into bank 2 again and puts its own code at `$F000-$F7FF`. In play it
  streams side 2, and a save loads a module from side 2 and writes the character to the
  character disk.
- **The Dungeon.** Its boot sector copies the ROM's `$F800-$FFFF` into language-card RAM,
  loads track 0 to `$4000-$4FFF` (its own RWTS and file loader) and loads the game. The
  RWTS (wrapper `$4383`, core `$4517`) takes zero-page parameters and stores every data byte
  **XOR `$87`** - the raw images are unreadable without it. Files on side 1 trigger a
  copy-protection nibble check (`$49FD`); the crack only NOPs one branch in it.

## The port

`node codegen/tools/port-altreality.mjs <out> <images...>` identifies each side (a `.nib`
by its volume number; a `.dsk` by known SHA-256 or content markers) and writes one
`<out>/AR/` folder: `CITY.PRG` + `CITY1.DSK CITY2.DSK CITYCHR.DSK` and/or `DUNGEON.PRG` +
`DUNGEON1.DSK DUNGEON2.DSK DUNGEON3.DSK DUNCHR.DSK`. Copy it to the card, then
`CD AR`, `BRUN CITY.PRG 6000` (or `DUNGEON.PRG`). One folder holds both games so the
Dungeon's "transfer a City character" can reach `CITYCHR.DSK` (volume 253). Missing
character disks are generated initialized and empty; both templates were checked byte for
byte against the supplied character disks. The tool refuses an existing `AR` folder: its
character disks hold the player's characters.

**Shim** (`sdcore.s` with a front end per game, `city.s` at `$0D00`, `dungeon.s` at
`$4517`; the converter writes it into track 0 of side 1, where the boot loads it). It keeps
each RWTS's interface (City: IOB in `A:Y`, status `$20`/`$40`, volume found at `+$0E`;
Dungeon: `$437B` command, `$3D-$41`, `$45/$46`, errors 3/4 in `$437C`, volume in `$437D`).
A request with a volume selects the image with that volume and leaves it in the drive;
volume 0 uses the image already there. So the games never see a wrong disk and never ask
for a swap. Format succeeds without writing. A 256-byte sector is half of card sector
`base + (T*16+S)/2`, read with the ROM's `sd_readsector` (`$E1B9`); a write is
read-modify-write with `sd_writesector` (`$E21C`), as in the Seven Cities port. The last
card sector stays in the ROM's buffer at `$C800` and is reused: both games read sectors in
pairs, so this halves the card reads (about 55 ms per sector, 52-92 ms measured per call).
The ROM is mapped only around the ROM call - game buffers are often in language-card RAM
(`$D000-$EFFF`) - and the mapping is put back from the RAM NMI vector (ours means RAM).

**Resident** (`resident.s`, `$CF00-$CFB0`, state `$CFE0-$CFFB`): the Ultima V / Seven Cities
NMI/IRQ forwarder (PS/2 start/data/parity bits and the `$C010` strobe without bank work,
everything else through the ROM handler). Neither game ever maps bank 1 and the resident is
only reached through the RAM vectors, so it always restores bank 2 read/write.

**Loader** (`loader.s` + `boot-city.s` / `boot-dungeon.s`, at `$6000`, scratch `$7000`): the
Seven Cities loader's ROM checks and contiguity proof for 3 or 5 images, then the boot
sector's work - raw track-0 reads, the ROM copied into the language card, NMI/IRQ vectors on
the resident - without the City's RESET-wiping stub, and a jump into the game.

**Patches** (each applied only over the expected bytes):

| Game | Where | Change | Why |
|------|-------|--------|-----|
| City | `$0D00` (T0 S5-S6) | SD shim | the RWTS |
| City | `$68E3` | `BIT $C083` pair -> `JSR fixvec` | the menu's ROM copy restores the ROM's NMI vector, whose target (`$F1BB`) the game then overwrites: the first key BRKed |
| City | `$6905` | `JMP $6918` | random seed timed from the spinning disk: no disk to wait for |
| City | `$7400` | `CLC; RTS` | the character-disk initializer's raw "has data?" probe: always warn before erasing |
| City | `$77AE`, `$8C70` | `LDA $106D; RTS` | after a disk error, probe the other drive's hardware: not here |
| City | `$6948` + menu text | `LDX #$07`, line blanked | drop **B**ackup, a raw-disk copier |
| City | `$103E`, `$1043` | `NOP`s | keep the ROM RESET vector, so RESET can return to 3RIC (not tried) |
| Dungeon | `$4517` (T0 S10-S9) | SD shim | the RWTS core (the `PHP/SEI` wrapper stays) |
| Dungeon | `$49FD` | `CLC; RTS` | copy-protection nibble check: report the pass it gives an original disk |

## What went wrong on the way

- **"Insert Disk 1 of the City Side 1" with side 1 in the drive.** The first WOZ images for
  exploration were built with volume 254. The prompt came from a volume mismatch - the
  clue that volumes, not track contents, identify the sides.
- **The first key press BRKed.** On 3RIC the `$C010` strobe is an NMI; with the language
  card mapped the vector is the RAM copy's `$F1BB`, which the City overwrites with its own
  code (Seven Cities' lesson, again in a new form). The Dungeon crashed the same way at its
  title.
- **The Dungeon's directory looked like garbage** (`87 97 87 87`...) until its RWTS turned
  out to XOR every byte with `$87`.
- **The original Dungeon side 1 stopped at "insert your original disk".** Its protection
  check found no protection track. The supplied `Disk 1 - Front.dsk` is a crack (one `BNE`
  NOPed); the port instead returns the check's success, so either image works.
- **"Thou hast died" right after entering the Dungeon** in three of four scripted runs, with
  HP shown as `!!!!!`. It looked like a protection penalty because the cracked image under
  the JavaScript RWTS survived. Frame-stepping showed a great bat attacking the idle new
  character; a different keypress time at the entrance survived (HP 14, a thief). The
  City's mugger does the same. `!!!!!` is how the games print a dead character's HP.
- **Exploration method.** Before the shim existed, a JavaScript RWTS at the entry breakpoint
  (images chosen by volume, as the shim does) let the games run in the emulator without
  WOZ timing, and logged every disk call. Every drive-register access outside the RWTS was
  then found by scanning the images and live memory for `$C08x,X` code.

## Evidence (WASM emulator, real ROM DOS and SD emulation)

`node codegen/tools/port-altreality.test.mjs` (after `web/build.ps1`):

- `.nib` decoding of a synthetic nibble image (6-and-2, checksum, interleave, volume; a bad
  nibble is reported), identification, the game-address -> sector mapping, every patch
  guarded on synthetic sides, character-disk templates.
- The real loaders, resident and both shims on generated FAT32 cards (512-byte and 4 KB
  clusters, reserved FAT bits): reads by volume and by volume 0, drive 2's starting image,
  writes and read-back with the other half untouched, unknown volume and bad track with
  each RWTS's error codes, seek and format, the Dungeon's XOR and sector+16, buffers in
  language-card RAM (unaligned), bank 2 state, ROM zero page and `$48/$49`, a `$C010` NMI
  through the resident, `fixvec`; loader refusals (missing, fragmented, changed ROM).
- With `AR_DISKS=<folder>`: both original games boot from the card to their menus
  (186 and 230 shim calls), NMI vector on the resident.

`pwsh codegen\tools\port-altreality.native.ps1` (MSVC): real PS/2 frames at 94/120/160-cycle
bits with bank 2 mapped, Caps Lock LED exchanges and a stop-bit strobe; 293 NMIs per run
preserve registers, flags, bank and overlay. (`port-ultima5.native.ps1` gained `-Bank2Only`
for this; its default run and the Wizardry wrapper still pass.)

Scripted sessions from a generated card (the original `.nib` images, screenshots):

- **City:** crack title, menu, temporary and new characters, stat gate, "Prepare to enter",
  the street (side-2 writes and ~540 sector reads, ~29 s in the shim), a mugger encounter;
  character-disk initialize (warning, format, boot stub and directory written, empty
  slots); a save through the game's save module ("You have been saved!", 16 character-disk
  writes), then RESET, reload, **Resume** lists BOB and brings back his stats.
- **Dungeon:** title, menu, new character (name, sex, confirm), the entrance stat roll, the
  dungeon entrance with a great bat and a thief.

**Not yet shown:** reaching the City's save prompt by walking to it (the run entered the
save module at its "SPACE pressed" branch, `$7B90`; combat keys did not respond in the
scripted mugger fight, also under the plain exploration driver), the Dungeon's save,
"transfer a City character" (the Dungeon reads `CITYCHR.DSK` through its XOR, as it would
read the floppy; the Rubywand note with the images says cracked City character disks
needed conversion for transfer), the Dungeon's character utilities, music and long play,
and anything on the physical board.

## Known limits

- **Binds to the ROM:** like Seven Cities, the shim calls `sd_readsector`/`sd_writesector`
  and the loader reads FAT32 variables; a ROM with different SD routines is refused.
- **Files must be contiguous** (normal after copying to a card); the loader refuses
  otherwise.
- **Loading is slower than the floppy in places:** ~55 ms per sector; entering the City
  spends ~29 s in the shim (the game animates meanwhile).
- **Keyboard only;** no SNES-pad mapping yet. Backup (the raw disk copier) is gone from the
  City menu: copy the `.DSK` files instead.
- **One character disk per game.** Initializing it erases its four characters (the game
  always warns). Keep copies of `CITYCHR.DSK`/`DUNCHR.DSK`.
- **Other releases** are converted with a warning when the patch sites match; only these
  images are tested.
- A character disk initialized in-game carries the patched `$7400` bytes in its boot stub
  (the initializer writes `$7340-$743F`, which runs into the probe). The stub only matters
  when the disk is booted on an Apple II; whether it reaches those bytes was not checked.
