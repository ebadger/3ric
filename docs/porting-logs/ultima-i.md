# Ultima I: replacing ProDOS under an unmodified game

**2026-10-15, controllers added 2026-10-17. Emulator-verified; the owner's first
run from an SD card (2026-10-17) loaded the game and went through character creation.**
The owner supplied one Apple II disk image, `Ultima_I-Enhanced.dsk`, and asked
for a port like the [Ultima IV one](https://github.com/ebadger/u4remastereda2)
(`fixed` branch). That port rebuilt Ultima IV from a reconstructed source tree,
put each disk in its own SD-card folder and replaced every DOS 3.3 call with a
Ctrl-D command to the 3RIC ROM DOS (`BLOAD`, `FLOAD`, `OWRITE`, `CD`). Ultima I has
no reconstructed source, so - as with [Ultima V](ultima-v.md) - this port leaves the
game binaries alone and replaces what is underneath them. The disk and the
generated SD folder contain Origin's game; they stay local. This repository holds
the converter, the glue code and its tests only.

| Input | SHA-256 |
|-------|---------|
| Owner's disk image (143,360 bytes, DOS order) | `3b80cb92955436524ae99584f543e3ac641bf7fe4aa4fb040c48ce9a330ea33d` |
| `U1.SYSTEM` (checked by the converter) | `a51bbe1a2f64d99643bf185e4011d927219f3c30d514a7fb60e8200c9251296a` |
| Reference ROM `emulator/Data/badger6502.bin` | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

## What the disk turned out to be

The boot sector is a cracker's loader (its XOR-hidden banner reads
`Intercept 1.3 1/7/87`), but behind it is an ordinary **ProDOS volume, `/U1`**: the
1986 Origin release of *Ultima I: The First Age of Darkness*, sixteen files in one
directory. Unlike Ultima V it keeps no data outside its files: the 21 blocks no file
owns are marked free (12 hold leftovers), and the game issues no block reads in play.
`PRODOS` is the real kernel; `U1.SYSTEM` is the startup
program. The game never touches the disk hardware itself, except a player-disk
formatter in `GEN`.

`U1.SYSTEM` prints the title, then relocates a small **Origin file layer** to
`$B700-$BAFF`: a jump table whose callers put a file name (or a pointer to one), an
address and a length inline after the `JSR` - load at the file's aux type, load at an
address, save, load-and-run, delete, set prefix, read/write a block. Every game file
goes through it: `U1.INTRO`, `MAKE.INDATA`, `MI.U1`, `STUPH` (shared routines at
`$0800`), and the mode overlays at `$8956` (`GEN` character creation, `OUT` the
overworld, `TWN`/`CAS` towns and castles with `TCMAPS` and `MAPCHARS`, `DNG`, `SPA`
space, `TM` and `NIF`). The layer in turn calls the ProDOS MLI: `GET_FILE_INFO`,
`OPEN`, `GET_EOF`, `READ`, `WRITE`, `SET_FILE_INFO`, `SET_EOF`, `CLOSE`, `CREATE`,
`DESTROY`, `GET/SET_PREFIX`. The game itself calls the MLI directly only for the
formatter (`READ_BLOCK`, `WRITE_BLOCK`, `GET_TIME`) and for a mouse-card interrupt
(`ALLOC/DEALLOC_INTERRUPT`).

Characters live on a separate **player disk**: `/U1.PLAYER/U1.VARS`, 458 bytes saved
from `$7E6D` (its first word is the length, `$01CA`, which the game checks on load).

**Machine checks.** `STUPH` probes every slot for a mouse card and, only on an
enhanced IIe (`$FBB3 = $06`), waits on `$C019` VBL and drives the IIgs speed
register. The 3RIC ROM returns `$EA` there, so the game takes its Apple II+ path.
With `MACHID` reporting 128 KB it would cache overlays in `/RAM` and switch the IIe
auxiliary zero page; at 64 KB it does neither. The game never maps the language card,
so the 3RIC ROM stays visible while it plays and the ROM's own NMI handler keeps
serving the PS/2 keyboard - none of the Ultima V resident machinery is needed. Its
few monitor calls (`INIT $FB2F`, `HOME`, `MOVE`, `TABV`, `COUT`, `$FF59`) all exist
at the Apple addresses in the 3RIC ROM.

## The port

`node codegen/tools/port-ultima1.mjs <ultima1.dsk> <out-dir>` reads the image, checks
the volume and the `U1.SYSTEM` fingerprint, and writes `<out-dir>/U1/`:

- `U1.PRG` (1,984 bytes at `$0800`): the loader, the ProDOS stand-in image and the
  SNES pad glue.
- Every game file except `PRODOS`, under a dot-less 8-character key
  (`MAKE.INDATA` → `MAKEINDA`, `U1.SYSTEM` → `U1SYSTEM`, `MI.U1` → `MIU1`).
- `U1VARS`, the player disk's save, created zero-filled (the game reads that as "no
  character": *Please put in the Player disk.*). The ROM's `OWRITE` can only rewrite
  an existing file, so it must exist. Re-running the tool keeps an existing save.
- Two verified STUPH patches. `$178C` `LDX #$C7` → `BRA $17BB` skips the mouse
  probe: 3RIC has no mouse card, and the probe reads `$Cn0C/$Cn11/$CnFB` of every slot,
  including the live ACIA and VIA pages; on undecoded slot space a false match would
  send the game into mouse firmware that is not there. `$1D64` `LDA $C000` →
  `JSR $0300` adds the SNES controllers (below).

Copy `U1` to the card root, then at the DOS prompt: `CD U1`, `BRUN U1.PRG 0800`.

**SNES controllers** (`codegen/patches/ultima1/pad.s`, added at the owner's request
after the first SD-card run). `STUPH` reads the keyboard with `LDA $C000` at `$1D64` on
every input wait, putting a ready key in its 4-key type-ahead buffer (`$74-$77`, count
`$78`). That read now calls `padpoll` at `$0300`, which returns what `LDA $C000` would -
unless no key is waiting and a button has just been pressed, in which case it returns
that button's key with bit 7 set and the game buffers it like a typed one. The game
itself turns Return, `/`, `;` and `'` into the arrow codes `$0B/$0A/$08/$15`, so the
D-pad sends those and works for walking, the dungeon view and character creation alike.

| Pad | Key | | Pad | Key |
|-----|-----|-|-----|-----|
| D-pad | arrows (move) | | Y | `T` Transact |
| A | `A` Attack | | L | `K` Klimb |
| B | `E` Enter | | R | `F` Fire |
| X | `X` eXit | | Select / Start | `Z` Ztats / Space (pass) |

- Either controller works; X/Y are preserved; a typed key always wins, including one
  decoded while the pads were being read (the press is then sent on the next poll).
- **The glue reads the pads itself**: 12 clocks on VIA1 port B, the same sequence as
  the ROM's `@joystick_gamepads` (latch bit 6, clock bit 7, data bits 5/4, active low),
  ~400 cycles on every input-wait poll (~1% of the CPU). Keyboard NMIs are served
  throughout. See below for why not `PTRIG`.
- Each button sends one key on its own press, however buttons overlap (a 12-byte
  state table: up, held, or pressed-not-yet-sent). The last D-pad direction repeats
  while held - after 12 scans, then every 8 (≈0.3 s, then ≈5 steps a second, measured
  walking) - and only while the type-ahead count is zero, so letting go never leaves
  queued steps.
- `STUPH`'s other read, `LDA $C000` at `$1C59` (it buffers typed keys while the view
  animates), is left alone: the game acts on keys only at input waits.
- `$0300-$03BF` was chosen by measurement: with pages 2-3 filled with a marker before
  `BRUN`, play through creation, save, continue, a town, a castle and a dungeon left
  `$0300-$03CD` untouched (`U1.INTRO` writes `$03CE`); the static hits in other
  overlays are data bytes, not instructions. The glue is 163 bytes.
**ProDOS stand-in** (`codegen/patches/ultima1/prodos.s`). Only ProDOS is replaced;
`U1.SYSTEM`, Origin's layer and the game run unmodified.

- `$BF00-$BFFF` is a ProDOS global page: MLI entry at `$BF00`, `MACHID = $60`
  (II+-class, 64 KB), `DEVNUM = $60`, a memory bitmap, and every `DEVADR` pointing at
  a "no device" routine. That last part makes the formatter, if it were ever reached,
  answer *No Disk II connected.*
- The MLI code and the file table sit in `$BB00-$BEFF`, the 1 KB ProDOS gave the
  layer as its `OPEN` buffer; the stand-in never uses an I/O buffer. Its dispatch
  tables, prefix string and variables use ProDOS-internal global-page bytes.
- A path resolves by its last component, so `/U1/OUT` and `/U1.PLAYER/U1.VARS` both
  live flat in the folder. Information calls are answered from the table; only `READ`
  (`FLOAD key buf mark mark+n-1`) and `WRITE` (`OWRITE key buf n`, whole-file rewrites
  only) reach the card. One file can be open at a time - the layer never opens two.
- Each call saves `$B0-$BF`; the ROM DOS changes nothing else of the game's RAM (a
  probe filled `$0900-$7FFF` and `$9000-$BFFF` and compared after `FLOAD` and `OWRITE`; the command
  text is collected at `$CD00`). Commands stream through `COUT` to the collector the
  loader captured from the `$03EA` hook, with the screen echo muted.
- `$03FE` (ProDOS's IRQ vector) points at a return stub; the ROM leaves it zero, and
  `STUPH` enables interrupts.

**Loader** (`loader.s`): checks that `COUT` is `JMP ($0036)`, the `$03EA` hook exists
and the ROM NMI proxy (`$F1BB-$F1CD`) is the one that turns the BASIC overlay back
off when its nest count `$CAFE` returns to zero; zeroes that count, turns the overlay
off (`$C007`), installs the stand-in, captures the command collector, then loads
`U1.SYSTEM` at `$2000` through the stand-in and jumps to it, as ProDOS would.

## What went wrong on the way

- **The ROM DOS reuses the stand-in's zero page.** The first build kept its
  parameter pointer in `$B0` and the file entry in `$B4`; `FLOAD` changes both. The
  load itself was right (the buffer address is sent before the command runs), but the
  transfer count was then written through a garbage pointer. The synthetic test caught
  it (`trans_count` 0 instead of 300); the stand-in now keeps its scratch across each
  command. The real game had run with this bug without visible harm - which is why
  the test checks the parameter block, not just the loaded bytes.
- **An empty prefix is not harmless.** Returning an empty `GET_PREFIX` makes
  `U1.SYSTEM` derive one from the startup pathname at `$0280`: it scans backwards with
  a wrapping index and copies whatever it finds over its own code. The stand-in
  reports `/U1/`, which skips that path.
- **1 KB is tight.** The first stand-in (command buffer, separate resolver passes)
  left room for 14 of the 16 file-table entries. Streaming the command straight to
  the collector, a one-pass path resolver and moving tables into the global page fit
  16 with 19 bytes to spare; the converter refuses a build that would spill.
- **Harness timing.** The bridge's `run(n)` counts instructions, not cycles. The
  test keeps the Ultima V test's key pacing; cycle measurements use `runCycles`.
- **The first controller glue dropped keyboard input.** It touched `PTRIG $C070` so the
  ROM's NMI scanned the pads - ~1,500 cycles inside an NMI, during which PS/2 clock
  edges are not served. Both reviewers flagged it, and the A2Robots board history
  recorded the same failure. A native harness that clocks real PS/2 frames while the
  glue scans (`port-ultima1.native.ps1`) reproduced it: `BRITISH ULTIMA` arrived as
  `BRITI0ZZ.X6OGGSP$$<RQNIMA`, or the Caps Lock LED exchange timed out.
- **Calling the ROM's scan routine was not enough either.** `@joystick_gamepads`
  (`$B99B`, in the BASIC bank) was called with a fake NMI frame and a nested `$CAFE`
  count, keeping keyboard NMIs live. It still garbled frames at a 160-cycle bit and
  corrupted an LED command: the routine leaves through the ROM's NMI exit, which writes
  `$7F` to VIA1's IFR and discards a PS/2 or strobe edge that arrived just before (the
  collision the Archon log describes). Clocking port B directly passes every case.
- **Pacing followed the wrong poll.** Scanning on every 4th call of *both* keyboard
  reads tied the D-pad repeat to how often the view animated; suppressing repeats at
  the animation read then left a held direction waiting ~1.3 s. Reading the pads only
  at input waits - every one, now that a scan is cheap - restored ≈0.3 s / 5 steps a
  second.
- **The ROM's LED path changes Y.** The native harness showed an NMI returning with Y
  changed whenever the ROM sent a Caps Lock LED command (its delay loops at
  `$BC14-$BC30` use Y). That is ROM behavior for every program, not the glue's; the
  harness exempts Y on exactly those NMIs and counts them.
## Evidence (WASM emulator, real ROM DOS and SD emulation)

`node codegen/tools/port-ultima1.test.mjs` (after `web/build.ps1`):

- Converter: the STUPH patches are exact, idempotent and refuse other bytes; the tree
  has `U1.PRG`, no `PRODOS`, a zero-filled `U1VARS`; key collisions are refused; 16
  files fit.
- A **synthetic** `U1.SYSTEM` calls every MLI function through the real loader and
  stand-in: file info (type, aux, storage, blocks), open by lower-case and by full
  path, `GET_EOF`, a whole-file read that stops exactly at EOF, a partial read and a
  read from mark 100 (`FLOAD DATAONE 4100 0064 012B`), EOF and closed-ref errors, a
  5,000-byte read across sectors, a write to `/U1.PLAYER/U1.VARS` and its read-back,
  writes past mark 0 or past the file's size refused, two opens refused,
  `CREATE`/`DESTROY`/block calls/`ALLOC_INTERRUPT`/unknown calls with ProDOS codes,
  `GET_PREFIX`, X/Y and `$B0-$BF` preserved, the global page, the IRQ vector, and the
  BASIC overlay still off after a keyboard-strobe NMI. No unknown name reaches the ROM.
- The loader stops with a message in the monitor when `U1SYSTEM` is missing.
- With `U1_DISK=<image>`: the original game shows the intro in hi-res; a fighter is
  created and saved (`OWRITE U1VARS 7E6D 01CA`); *Continue previous game* loads it
  into the overworld; **Q** saves in place; Lord British's castle loads (`CAS`,
  `TCMAPS`, `MAPCHARS` at `$B000`) when the pad's **B** is pressed; and `$BB00-$BFFF`
  is byte-identical to the image apart from the stand-in's own state and the bytes
  `U1.SYSTEM` writes (`$BF6E/F`, `$BFFC/D`), as is the pad code at `$0300`.
- SNES pads (synthetic loop calling `padpoll` like STUPH): each of the 12 buttons
  sends its key, controller 2 works, a held button sends one key, a lower button
  pressed under a held one still sends and releases send nothing, a held D-pad waits
  while the type-ahead count is non-zero and repeats once it is zero, a typed key wins
  over a held pad - also when it is decoded during a scan, without losing the press -
  X/Y are preserved, and the ROM's NMI nest count and BASIC overlay are untouched.

`pwsh codegen\tools\port-ultima1.native.ps1` (Visual Studio C++ tools): builds the
shared VM natively and types `BRITISH ULTIMA` twice plus Caps Lock as real PS/2 frames
(bit periods 94/120/160 cycles, DATA held 80) at drifting offsets while a loop polls
the glue like `STUPH`. All three pass: ~1,800-1,900 scans, 38-671 keyboard NMIs taken
*inside* a scan, the LED exchange completes, every character arrives, and every NMI
returns with A/X, flags and overlay intact (Y excepted on the ROM's LED-command NMIs).
With `-Pad` pointing at the first, `PTRIG` glue, the same harness fails all three.

Manual emulator sessions on the original disk (scripted keys, screenshots): the
title text, the animated intro, the menu, character generation, the city of Britain,
an overworld fight with bears, a quick-save, and **the Dungeon of Doubt** (`DNG`,
3D view, moving forward), with the stand-in checked intact after each. With the
controller only: Select showed Ztats, the D-pad walked to the dungeon, B entered it
and Up moved forward (tap-length presses); holding the D-pad walked ≈5 tiles a second
and stopped on release.

Measured load cost (`runCycles`, 512-byte-cluster test card): `U1.SYSTEM` 1.3 s,
`MAKE.INDATA` 6.3 s, the whole start-up ≈22 s, `OUT` 2.6 s, `DNG` 4.6 s, a town or
castle ≈8 s (three files). About 0.45 s per KB, nearly all in the ROM's bit-banged SPI
byte loop - the same cost the Ultima V port measured.

**Owner's first SD-card run (2026-10-17, before the controller change):** the game
loaded and character creation worked. (*Continue* first said "Please put in the
Player disk." - correctly, as no character had been saved yet.)

**Not yet shown:** saving and continuing, play and the controllers outside the
emulator; space flight (`SPA`), the time machine (`TM`, `NIF`), the endgame; and
performance on a real card's cluster size.

## Known limits

- **Speed.** The game runs at 3RIC's clock (≈1.54x an Apple II) with no VBL pacing on
  the II+ path, and loads are slow (above). Neither is changed by the port.
- **The card's contents are trusted.** As in Ultima V, the ROM DOS reports a failed
  command only as text, which the stand-in does not read. With the tool's complete
  folder every command succeeds; a missing or renamed file would leave stale memory.
- **One save slot.** The player disk is one file, `U1VARS`, as on the floppy. Back it
  up by copying the file.
- **Speaker only.** Ultima I has no Mockingboard music; its effects use `$C030`.
- **Lock keys.** The ROM's Caps/Num Lock LED handling changes the Y register of
  whatever it interrupts (above); a lock-key press mid-game could disturb the game.
- **Controller keys reach the game only at input waits**, like the game's own key
  handling; a tap shorter than a slow redraw can be missed.

## Next steps worth discussing

- **Overlay cache in language-card RAM.** The game never uses the 16 KB language
  card. A stand-in that kept recently loaded overlays there would make re-entering a
  town or returning to the overworld nearly instant, but every copy would need the
  ROM hidden briefly - the bank-safe NMI path the Ultima V resident needed.
- **Hardware confirmation.** The keyboard path is the ROM's own (no language card
  mapped), so the Ultima V keyboard failure mode should not apply, and the first run
  got through character creation; saving, play and the controllers still need it.
