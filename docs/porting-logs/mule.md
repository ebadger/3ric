# M.U.L.E.: an Atari 8-bit game on the 3RIC

**2026-10-18. Emulator-verified through the land grant; not yet tried on the board.**
The owner supplied the Atari 800 disk image (ATR, 720 sectors) and asked for a port,
knowing that graphics, sound and hardware differ far more than in the Apple II ports.
The image and the generated SD folder contain the game; they stay local. This
repository holds the converter, the runtime and their tests only.

## What the disk turned out to be

Two programs. The **intro** boots from sectors 1-129 (load `$7BEF`): title, options,
controller assignment, colour and species choice. It writes the configuration and a
fixed 1.6 KB data block to `$0900-$0FFF`, loads the **main game** from sectors
400-720 to `$1000-$B07F` through the OS disk vector and warm-starts it
(`DOSINI = DOSVEC = $1009`). The main game never reads the disk again.

The main game is a full 48 KB program. It drives the hardware directly (its own VBI
copies the shadow registers, reads sticks, triggers, paddles and the keyboard and
ends in `PLA x3 / RTI`), uses ANTIC modes 2, 4, 6, 7 and 8 with three character sets
of its own plus the Atari ROM font, single-line players at `$B800` that its
display-list interrupts reposition per band, POKEY for music, CONSOL for clicks, and
**eleven entry points of the Atari floating-point ROM** (money and prices are BCD
floating point). About 120 instructions modify other instructions.

## The port

`node codegen/tools/port-mule.mjs <mule.atr> <out-dir> [--players 1|2] [--level ...]`
writes `<out-dir>/MULE/`; on the 3RIC: `CD MULE`, `BRUN MULE.PRG 2000`.

- **The intro runs at conversion time** (`mule-intro.mjs`): a small 6502 with just
  enough Atari (ANTIC line timing and interrupts, POKEY RANDOM, sticks, console keys,
  the OS disk/VBI/warm-start entry points) plays the intro with scripted presses and
  keeps `$0000-$0FFF` at the warm start. One or two human players (the 3RIC has two
  pads; the rest are computer players).
- **Memory.** The hi-res page must be `$2000` or `$4000`, both inside the game. The
  `$2000-$3FFF` block (about 3 KB of code, strings, the map screen, tables) moves to
  language-card RAM at `$E000`. 322 absolute references were found by recursive
  disassembly seeded from every instruction three long traced sessions executed; 80
  pointer sources (string addresses, pointer tables, DLI vectors, the screen writer's
  base, two VBI jump-table entries) by tracking, in a reference emulator, which
  immediate or table byte produced the high byte of every pointer that reached the
  block, through arithmetic and self-modified code, and by a static scan of the three
  string routines' call sites. One message straddles `$3FFF/$4000`; it gets a
  contiguous copy. Hardware **stores** need no patch: they land in a register file of
  bank-2 RAM at the real addresses. The 52 hardware **reads** become a read mirror
  (`$0300`) or helpers (RANDOM, VCOUNT, CONSOL clicks); the ROM-font copies read the
  port's font; `SETVBV` is replaced.
- **Runtime** (`rt.s`): a 60 Hz tick on the second Mockingboard VIA plays the Atari
  VBI NMI (pads to sticks/triggers/console keys, POKEY to the two AYs, player-0
  collisions, then the game's VBI with the Atari stack frame, carrying the
  interrupted code's `P`: the game skips its work when `I` was set). The first VIA's
  Timer 1 runs in step and gives VCOUNT.
- **Display** (`render.s`, bank 1): with interrupts off, walk the display list and
  call the game's DLI handlers where ANTIC would, recording per band the colours,
  character set and player positions; then, interruptible, redraw changed lines
  (hashed) into hi-res and OR the players on with save-under. One Atari column per
  hi-res byte; colours to the nearest hi-res colour, never black on the black screen.
- **Floating point** (`fp.s`): written for the port to the documented interface
  (base-100 BCD, ten digits), stubs at the Atari addresses, code in gaps between them.
- **Font** (`font.mjs`): drawn for the port, in Atari character order.

## What went wrong on the way

- **Reference emulator first.** Without an Atari emulator or ROM, a scratch JS HLE ran
  the disk. It crashed twice on "corruption": both times the game printing numbers
  through FP ROM calls that returned garbage pointers. Adding the FP package fixed it.
- **VCOUNT `$7C`** is visible only ~10 cycles before the VBI NMI; the title waits for it.
- **Taint through self-modified code.** The screen writer's `LDA #$B5` is rewritten per
  screen; the first tracker followed the instruction, not the byte stored into it.
- **The VBI frame's `P`.** Pushing `P` with `I` set made the game's VBI skip itself:
  no display list ever reached the register file.
- **Warm-start leftovers.** The hand-off still pointed `VDSLST`/`SDLSTL` at the intro;
  a DLI then ran the intro's handler address, now text. Boot resets them as the OS does.
- **A missed jump table** (`$5D7E`, dispatched by a self-modified `JSR`) sent the VBI
  into the hi-res page; it showed as BRK storms in a PC profile.

## Evidence

`node codegen/tools/port-mule.test.mjs`: FP against an independent decimal reference
(1,600 operations within one unit in the last place, IFP/FPI, FASC formats), runtime/
loader layout and font. With `MULE_ATR=<atr>` (after `web/build.ps1`): converts the
original disk, boots the folder from a generated FAT32 card on the WASM 3RIC, presses
the pads and reaches the status summary and the land grant with the hi-res page drawn.
Scripted WASM runs also showed the transport ship, per-player coloured status bands,
mountains and the players' plot markers.

**Not yet shown:** development (town, mules), auctions, production, events and the
end of a game on the 3RIC; sound by ear; anything on the physical board.

## Known limits

- The planet surface and river are incomplete (background colours are not filled;
  mode-6 map tiles in dark tones become white), and the playfield is redrawn every
  third tick, so motion is choppier than the Atari.
- Missiles, player sizes other than normal, playfield collisions (`P0PF` reads 0) and
  player collisions from DLI-moved players are not modelled.
- No keyboard: PS/2 NMIs are off while the game runs. Console keys are on the pads
  (Start = START, Select = SELECT, X/L/R = OPTION; B/A/Y = fire).
- Species and colours are chosen by the converter's script, not by the players.
- Relocation is complete for every path the static scan and three long sessions
  reached; an untested path could still use a pointer the analysis missed.
- Only the release this port was built on is accepted (pinned main-image hash).

## Next steps worth discussing

- Port the intro itself (it is the same machine) so players choose on the 3RIC.
- Background colours for modes 2/6/7 and the river; play through a full game.
- A board trial.
