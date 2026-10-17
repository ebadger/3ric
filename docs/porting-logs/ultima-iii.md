# Ultima III: an SD-card port under the game's own DOS

**2026-10-15. Emulator-verified. Board: the music sounded discordant on the first trial and correct on a retry (cause not isolated); gamepads untried.**
The owner supplied two Apple II disk images (`ULT31SND.DSK`, `ULT32SND.DSK`) and asked
for a port like the [Ultima IV one](https://github.com/ebadger/u4remasteredA2)
(`fixed` branch), which put the game files on the SD card and turned its disk
access into Ctrl-D commands for the 3RIC ROM DOS. The images and the generated SD
folder contain Origin's game; they stay local. This repository holds the converter,
the glue code and its tests only.

| Image | SHA-256 |
|-------|---------|
| `ULT31SND.DSK` (side 1, program) | `fb21bd6d24c22a3de125cdde432d564c4a97b0b3958c8f61fcc680362726816e` |
| `ULT32SND.DSK` (side 2, player disk, as supplied) | `6401e36eb3018ac00632b44dd8255d4538cfbd91a4d39999e60e0d3e7a5a6494` |

Side 2 changes whenever a game is saved, so the converter does not check its hash.
It checks the hash of the game's resident DOS instead (below).

## What the disks turned out to be

Neither side has a usable DOS 3.3 catalog (side 1 lists only `HELLO`). Side 1's boot
sector is the standard DOS 3.3 stage 0, but stage 1 (`$B700`) is replaced: it reads
174 sectors downward from track 28 sector 13 into `$B600` down to `$0900` and jumps to
`$8F00`, which moves `$2000-$29FF` to zero page/stack/`$0200-$08FF` and `$B700`,
restores part of the hi-res page and resumes with `RTI`. It is a **memory image** of
the machine taken while `TEST` (the Mockingboard set-up program) was running.

That image carries the game's DOS at `$AF80-$BFFF`:

- a COUT hook at `$B44A` (state machine at `$B42A`) that passes ordinary output to
  `($B403)` and parses `Ctrl-D BLOAD/BRUN/BSAVE NAME[,Dn][,Vn][,Sn]`;
- a 96-entry file table at `$AF80` (count `$B413`, pointer `$B414`). Each 12-byte
  entry is: the 4-character name **reversed**, the side (`'1'`/`'2'`), a start track
  and sector, the address low byte, the top page, the bytes in a partial top page and
  the number of whole pages. A file is stored **top-down**: the partial page (if any)
  at the start sector, then each whole page one sector lower, filling memory
  downwards. `BRUN` jumps to where the loop ends, the file's lowest address;
- the standard DOS 3.3 RWTS at `$B800-$BFFF`, entered at `$BD00`, which the DOS calls
  once per sector with its IOB at `$B750` after patching per-side address/data marks
  into the RWTS (`$B8E7`, `$B8F1`, `$B955`, `$B95F`, `$B96A`, `$BA00-$BB28`).

Every file name is unique across both sides, so all 96 files can share one folder.
The extracted `SUBS` matches the `SUBS.bin` in the third-party
[ult3edit](https://github.com/BradHawthorne/ult3edit) project byte for byte, a useful
cross-check on the top-down reading. The game itself starts `TEST` → `MBS` (Kenneth
Arnold's Mockingboard driver and score at `$9A00`) → `EXOD` (intro) → `BOOT` (menus,
character creation) → `ULT3` (the game, `$5000`), and loads maps, monsters, dialogue,
battlefields and overlays by name from then on.

## Why the DOS had to stay

The first attempt redirected the DOS's sector loop at `$B5A8` to the SD card. The game
booted, created a character, entered the world, and dropped into the monitor: `ULT3`
(`$71BF`) XORs `$B5A8-$B628` and expects `$0F`. The checks found in the game files:

| Check | Where |
|-------|-------|
| XOR `$B42D-$B4AD` = `$C5` | `ULT3` start, through `UPDT`'s routine at `$03A3` |
| XOR `$B5A8-$B628` = `$0F` | `ULT3 $71BF` (address high byte self-modified) |
| XOR `$B610-$B690` = `$D1` | `TEST`, `ULT3`, `SHP2-4` |
| XOR `$B731-$B74C` = `$32` | `ULT3` |
| `$B766/$B769/$B76C/$B76F` are not the standard `$AA` marks; `$B44A` is `$08` | `TEST`, `BOOT`, `ULT3`, shops |
| `$03F1` = `$B7` (BRK vector into the DOS) | `ULT3 $655A`, before every autosave |

A failed check jumps through `$03F0` to `$B72D`, which wipes memory and resets. So the
port keeps `$AF80-$B7FF` exactly as the disk left it (the converter checks the SHA-256
of `$AF80-$BFFF`, `8ca1a78f…072288`) and replaces only the layer the DOS calls:

- **RWTS shim** (`codegen/patches/ultima3/shim.s`): `$BD00` becomes `JMP $BE40`.
  The code sits above `$BE3D` (the RWTS byte count the DOS still writes) and the
  nibble tables the DOS still patches. Real RWTS leaves `$48/$49` pointing at the IOB;
  the DOS's file lookup leaves them pointing at the table entry. So the first call of
  a command sees the entry, moves the whole file with one ROM DOS command, and leaves
  `$48/$49` at the IOB; the remaining sector calls of that command see the IOB and
  return at once. The DOS's loop still counts sectors, keeps its buffer pointer, and
  `BRUN` still jumps through it. Loads are `FLOAD NAME aaaa 0000 len-1`; saves are
  `OWRITE NAME aaaa len`, and by the time `BSAVE` reaches RWTS the memory is final.
- **Loader** (`loader.s`, `U3.PRG` at `$0800`): checks for the ROM DOS (`COUT` is
  `JMP ($0036)`, the `$03EA` hook exists), sets `$CAFE = 0` and turns the BASIC overlay
  off, copies the patched `$AF00-$BFFF` image, captures the ROM's command collector
  from `$03EA` for the shim, points `$03F0` at `$B72D` as the disk did, sets
  `CSW = $B44A` and prints `Ctrl-D BRUN TEST` through `COUT`: the game's DOS does the
  rest.

## The music

`MBS` runs from a Mockingboard VIA T1 interrupt (IRQ → ROM `$FA86` → `JMP ($03FE)`).
The 3RIC CPU, VIAs and AYs run at 25.175 MHz / 16, 1.538472 times the Apple's
14.31818 MHz / 14 (the same ratio the Pitfall II work used). The converter
changes one game file, with guards on the original bytes:

- the T1 latch at `$9A5A/$9A60`, `$411A` → `$6429` (period `latch + 2` scaled), and
- the 96-entry AY note period table (`$9E40` low bytes, `$9EA0` high bytes; an
  equal-tempered A0-B7 table, checked by SHA-256), each period scaled and kept within
  12 bits; and
- its two IRQ-vector stores (`$9A3C/$9A41`), redirected for the gamepad tick (below).

Measured on the WASM build: 123 music interrupts in two seconds of 3RIC time
(61.5 Hz; the Apple runs at 61.4 Hz). Pitch is calculated, not a listening test.
Envelope periods and the speaker effects in `SUBS`/`EXOD` are not rescaled, so speaker
sounds and delay loops run about 1.54 times faster.

`MBS` also keeps its pointers in `$B0-$BB`, the zero page the ROM's FAT32 code uses.
The original RWTS ran with interrupts off; the shim does the same and restores
`$B0-$BF` and `CSW` around each ROM command. A trace of the first six commands showed
no other zero-page or `$0200-$03FF` byte changed by the ROM.

## SNES gamepads

Ultima III only reads the keyboard, and it has no periodic hook of its own once the
Mockingboard is off. The port adds one: the loader runs Timer 1 of the **second**
Mockingboard VIA (`$C480`) free at ~61 Hz and points the Apple IRQ vector `$03FE` at a
tick (`codegen/patches/ultima3/gamepad.s`) placed in the dead RWTS code at
`$BD03-$BE3C`. Sound I/II settings drive only the first AY; SND/SPCH drives the second
AY's ports but never its timer, so the two uses don't collide. `MBS` used to store its
own handler in `$03FE`; two guarded byte patches send those stores to the tick's
`next_irq` link instead, so the music handler still runs on every interrupt that isn't
the tick's (the 61.5 Hz music cadence is re-checked by the real-disk test).

Each tick touches `PTRIG $C070` so the ROM rescans both pads in its NMI, then reads the
ROM's tables (`$CEE0`, `$CEF0`; either pad counts). A new press of a mapped button
becomes that key in `$C000` as soon as the game has taken the previous key; a held
D-pad direction repeats after ~0.3 s, then every ~0.15 s, never queueing more than one
key. The keyboard is untouched.

| Button | Key | Use |
|--------|-----|-----|
| D-pad | Return, `/`, ←, → | north, south, west, east (also combat directions) |
| B | Space | pass, continue, "press space" |
| A | `A` | attack (then a direction) |
| X | `E` | enter a town, castle or dungeon |
| Y | `T` | transact (talk, shop) |
| L / R | `K` / `D` | klimb / descend |
| Select | `I` | ignite a torch |
| Start | `G` | get a chest |

Set-up prompts (Mockingboard type and slot, the disk drive, character creation, shop
quantities) still need the keyboard. The loader also resets the second AY before the
game starts; the game only ever resets the first, so the second could otherwise power
up making noise.

Evidence (WASM): the synthetic test checks the vector, that a button on pad 2 types its
key, that a released button types nothing more and that a held direction repeats; the
real-disk test walks the party north with SNES Up, and a manual run answered a fight's
"HAND ATTACK DIR-" prompt with A. Not shown: the board,
where every pad scan is an NMI alongside the PS/2 keyboard's.

## Using it

```text
node codegen/tools/port-ultima3.mjs <folder-with-both-images> <out>
```

Copy `<out>/U3` to the card root, then at the DOS prompt `CD U3`, `BRUN U3.PRG 0800`.
`TEST` asks for the Mockingboard (the crack always asks): type `2` (Sound II; `1`
also works) and slot `4`. At the title, "INSERT GAME DISK" asks for a drive: `1`.
Movement keys are the Apple II ones (Return north, `/` south, ←/→ west/east).

## Evidence (WASM emulator, real ROM DOS and SD emulation)

`node codegen/tools/port-ultima3.test.mjs` (after `web/build.ps1`):

- boot-image reconstruction, file table and top-down reads on a synthetic side 1;
  the MBS patch refuses unexpected bytes;
- the real loader and shim on a generated FAT32 card, driven like the game's DOS:
  a whole file with a partial top page in one `FLOAD` (no byte past the end), a load
  into `$00E0-$00EF` touching nothing else, later sector calls as no-ops, `$48/$49`,
  carry, interrupt flag and `$B0-$BF` as expected, and a write read back.

With `U3_DISKS=<folder>` it plays the original disks: Mockingboard set-up and the
61.5 Hz music interrupt, credits, intro, the "INSERT GAME DISK" prompt, character
creation (roster saved), forming a party, Journey Onward into the world, entering Lord
British's castle (`MAPA`), walking out (`SOSA`), stepping onto a dungeon and entering it
(`MAPS`, `DDRW`), then a reset and a resume from the autosave.

Manual sessions also showed a wandering-monster fight (`CONG`) and Quit & Save
followed by a reset and resume at the saved position. Loads run at about 2 KB/s in the
emulator (`TEST` 0.65 s, `MBS` 2.6 s), so the boot to the title takes about 30 s.

**Not yet shown:** talking and shops (`SHP0-7`, whose own checks read the DOS),
Moongates, Ambrosia, the Exodus fight and `END`, and anything on the physical board.

## Known limits

- **One release.** The converter accepts only a side 1 whose DOS hashes as above.
- **The card's contents are trusted**, as in the Ultima V port: a failed ROM command
  is reported only as text. A missing save file would send `OWRITE` to its `BSAVE`
  fallback in the BASIC bank. Copy the whole folder.
- **Reset** keeps 3RIC's own reset handling; the disk's reset vector (into the
  memory-wiping `$B72D`) is not installed.
