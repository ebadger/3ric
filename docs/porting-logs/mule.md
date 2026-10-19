# M.U.L.E.: an Atari 8-bit game on the 3RIC

**2026-10-18. Emulator-verified from the intro (the players choose on the 3RIC) through
the production round; not yet tried on the board.**
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

`node codegen/tools/port-mule.mjs <mule.atr> <out-dir>` writes `<out-dir>/MULE/`; on
the 3RIC: `CD MULE`, `BRUN MULE.PRG 2000`. Add `--woz MULE.WOZ` for the same game on
one Disk II side (boot with `MON`, `C600G`): `diskboot.s` re-enters the boot PROM's
sector reader piece by piece, stages the language-card images at `$4000` and copies
each into the card between reads (a card write-enable set before a read did not
survive it). Both loaders work through one piece table (`SEQUENCE`) in two phases.

- **The intro runs on the 3RIC** (`intro.s`): title, options (SELECT for the number
  of players, OPTION for the level, START), controllers, colour and species are chosen
  there, on the pads or the keyboard. Up to two human players (the 3RIC has two pads);
  the rest are computer players. It is the same machine as the game, so the same
  runtime runs it, with a renderer built for hi-res page 2 (page 1 holds the loader and
  the hand-off stash) and a little of the Atari OS: the boot (`JSR load+6`,
  `JSR (DOSINI)`, `JMP (DOSVEC)`), the OS VBI (RTCLOK, ATRACT, shadow registers to
  the register file, sticks and triggers, then VVBLKD) and the OS jump table at
  `$E450` in language-card RAM (SETVBV, SYSVBV, XITVBV; disk calls answer success;
  WARMSV ends the intro). Patched in the intro: its 8 hardware reads and CONSOL
  clicks, as in the game; its RTCLOK-equality waits (a delay subroutine, a delay that
  stops early, two timeout deadlines and the loader's one-tick wait) become
  elapsed-time waits; its loader skips the disk check and the reading of the main
  game. Phase 1 of the loader loads the runtime, the intro's renderer and OS layer
  and the intro, saves what the ROM DOS (or the Disk II boot) needs (zero page, stack,
  pages 2-3 and 8-9, RAM2, the VIA's interrupt enables) and runs it. At the warm start
  `intro_done` stashes `$0000-$0FFF` (the configuration the intro wrote) at `$3000`,
  shows "LOADING" on the text page, puts the loader's state back and returns into it;
  phase 2 loads the main game as before and `boot_final` hands it the stash. The
  intro uses none of `$1000-$6FFF`: `intro.s` and the intro renderer's player tables
  live at `$1000`, the snapshot at `$6000`.
- **Memory.** The hi-res page must be `$2000` or `$4000`, both inside the game. The
  `$2000-$3FFF` block (about 3 KB of code, strings, the map screen, tables) moves to
  language-card RAM at `$E000`. 322 absolute references were found by recursive
  disassembly seeded from every instruction three long traced sessions executed; 80
  pointer sources (string addresses, pointer tables, DLI vectors, the screen writer's
  base, two VBI jump-table entries) by tracking, in a reference emulator, which
  immediate or table byte produced the high byte of every pointer that reached the
  block, through arithmetic and self-modified code, and by a static scan of the three
  string routines' call sites. One message straddles `$3FFF/$4000`; it gets a
  contiguous copy. The music player's end/loop checks compare its four voice
  pointers with block addresses (`CMP #$29`...); those four immediates move too.
  Hardware **stores** need no patch: they land in a register file of
  bank-2 RAM at the real addresses. The 52 hardware **reads** become a read mirror
  (`$0300`) or helpers (RANDOM, VCOUNT, CONSOL clicks); the ROM-font copies read the
  port's font; `SETVBV` is replaced. The game's two waits for RTCLOK to *equal*
  start + n (`$1310`, and an inline one at `$3926` that also polls the players)
  become waits for n *elapsed* ticks (`jwait`), because the redraw runs inside the
  tick and the main code can miss the one tick with that exact value.
- **Runtime** (`rt.s`): a 60 Hz tick on the second Mockingboard VIA plays the Atari
  VBI NMI (pads and keyboard to sticks/triggers/console keys, POKEY to the two AYs,
  player-0 collisions (only players within 8 colour clocks of player 0 are scanned), then the game's VBI with the Atari stack frame, carrying the
  interrupted code's `P`: the game skips its work when `I` was set). The first VIA's
  Timer 1 runs in step and gives VCOUNT.
- **Sound.** POKEY channel 1 (the bass) plays on both AYs' A, channel 2 on AY 1 B,
  channel 3 on AY 2 B, channel 4 (noise drums) on both C. Pitch follows the
  64 kHz / 15 kHz / 1.79 MHz clocks; *distortion C* (`$Cx`, the 4-bit polynomial the
  bass uses) repeats every m = 15 / gcd(n, 15) divider pulses instead of 2 (n = the
  divider count; 5 on the 15 kHz clock), so it sounds m/2 times lower, and m = 1 is
  silence. Noise is sampled once per divider pulse, so the AY noise period is half
  the tone period for the same divider and clock (1-31). POKEY volume is linear,
  the AY's logarithmic (`volmap`).
- **Keyboard** (when no pad is used): the key in `$C000` gives characters only (no
  key release), so **W/A/S/D or the arrows latch** pad 1's stick: press to walk, the
  same key again to stop (another direction turns). **Space** is a short fire press;
  **Return or 1** = START, **Tab or 2** = SELECT, **3** = OPTION.
- **Display** (`render.s`, bank 1): with interrupts off, walk the display list and
  call the game's DLI handlers where ANTIC would, recording per band the colours,
  character set and player positions; then, interruptible, hash every line (with the
  band's player colours) and record every player row (row, column and shift, the
  player byte, its colour) in a pending list, comparing it exactly with the record
  on the screen. If nothing changed nothing is written. Otherwise the changed lines
  are redrawn (wiping the players on them), and only the player rows that changed
  or were wiped are lifted (save-under) and drawn again from the pending list, so
  the records always match the screen even when the game's VBI moves a player
  mid-redraw (that shows next frame). There is no second page to flip to (both hi-res pages
  are inside the game), so this stands in for double buffering: static screens never
  blink, and a moving player is off the screen only for its own rows' update. One
  Atari column per hi-res byte (four 2-bit pixels per byte in modes 4/5 and the
  intro's mode D banner); colours to the nearest hi-res colour, never black on the
  black screen. A line's colours are hashed as the hi-res colours they become, so an
  Atari colour cycle the 3RIC cannot show redraws nothing; the second scan line of a
  mode 5, 7 or D line is a copy of the first. Blank lines above the first mode line
  that are on the screen become one entry, so players there (the intro's species
  grid) are drawn. After a redraw the tick waits at least as long as the redraw took
  (three ticks at least) before the next, so the main code keeps half the CPU on busy
  screens. Renderer scratch beyond bank 1 sits in `$0406-$057F` (the game uses only
  `$0400-$0405` there; `$0580` is the FP package's LBUFF), after the runtime's
  variables in page 3, and for the intro build (twice the player records) at
  `$1800-$1E7F`.
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
- **Music that sounded wrong, and a game that stopped** after the first development
  turn. The bass is POKEY distortion C, which the first sound mapping played as noise.
  Worse, the VBI music task compares each voice pointer with constants inside the
  moved block: voices 2-4 never looped (they played on into other data) and voice 1
  never ended, so the main code, waiting for the tune, waited forever. Pointer
  provenance found where pointers *come from*, not what they are *compared with*.
- **The land grant froze** in some builds and not others (two cycles per tick made
  the difference): the game waited for RTCLOK to equal a value that only occurred
  while the tick was still redrawing.
- **Blinking.** Every redraw lifted all players, redrew lines and walked the player
  graphics again, so players were off the screen for most of each redraw (measured:
  41% of the time on the land grant). Change detection and row-level player updates
  cut the bytes changed on that screen from 101,617 to 1,967 over the same scripted
  play.
- **An intro that crawled.** Running live, the intro got under 10% of the CPU: the
  banner's DLI rotates its colours every frame, so every render redrew it in full and
  renders ran back to back, and the collision scan alone took 35% (every player-0 row
  against three players, every tick, on screens with tall players). Hashing mapped
  colours, copying a mode line's second scan line, the adaptive render gap and the
  collision prefilter gave it about half.
- **An empty species screen.** The species and the colour box are players over a
  tall blank area at the top of the display list; leading blank lines had no
  line-table entry, so no player was drawn there. That display list also overflowed
  the 48-entry line table (the last lines kept the previous screen's text), and the
  four tall players needed twice the game's 80 player-row records.

## Evidence

`node codegen/tools/port-mule.test.mjs`: FP against an independent decimal reference
(1,600 operations within one unit in the last place, IFP/FPI, FASC formats), runtime,
both renderers, `intro.s` and loader layout, and font. With `MULE_ATR=<atr>` (after
`web/build.ps1`): converts the original disk, boots the folder from a generated FAT32
card on the WASM 3RIC and plays the intro on the pads by what its screen says (title,
two players on the options screen, the controller check, colour and species for each
player; the species grid must be drawn on hi-res page 2 and the intro's summary must
show the choices), then reaches the status summary and the land grant with the
hi-res page drawn;
checks ~150 ticks of the summary music's POKEY registers against an independent model
of the AY mapping; types Space and W and checks the trigger and stick; and plays on
through the development and production rounds; then boots `MULE.WOZ` from the Disk II
and plays the same intro into the game's status summary. Scripted WASM runs also
showed moving the colour box changing the species shown and its description, and the
transport ship, per-player status bands, mountains, plot markers, development, the
pirate ship, the status after a round and the first auctions.

**Not yet shown:** the town and mules with real play, later rounds and the end of a
game on the 3RIC; sound by ear; anything on the physical board.

## Known limits

- The planet surface and river are incomplete (background colours are not filled;
  mode-6 map tiles in dark tones become white), and the playfield is redrawn every
  third tick, so motion is choppier than the Atari.
- Missiles, player sizes other than normal, playfield collisions (`P0PF` reads 0) and
  player collisions from DLI-moved players are not modelled.
- The keyboard works where keys arrive in `$C000` (the browser emulator, the native
  emulator's direct path); the physical board's PS/2 keyboard is not decoded while the
  game runs (its NMIs are off and the ROM handler's RAM is the runtime's). Pads: B/A/Y
  fire, Start = START, Select = SELECT, X/L/R = OPTION.
- Keyboard directions latch, so steering is coarser than with a pad.
- The intro's horizontal fine scrolling (HSCROL) and player sizes are ignored; its
  colour cycling shows only where it changes a hi-res colour. It still waits for
  input more slowly than the Atari while its banner is being redrawn.
- Relocation is complete for every path the static scan and three long sessions
  reached; an untested path could still use a pointer the analysis missed.
- Only the release this port was built on is accepted (pinned main-image hash).

## Next steps worth discussing

- Background colours for modes 2/6/7 and the river; play through a full game.
- Tests that need no disk image: drive `key_scan`, the sound mapping, `jwait` and the
  sprite records on the assembled runtime, and `buildGame`'s patches on a synthetic
  image (deferred from the second-model review; today they run only with `MULE_ATR`).
- A board trial.
