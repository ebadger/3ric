# M.U.L.E.: an Atari 8-bit game on the 3RIC

**2026-10-18. Emulator-verified from the intro (the players choose on the 3RIC) through
the random events into the second round; not yet tried on the board.**
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
  WARMSV ends the intro). Patched in the intro: its 10 hardware reads and CONSOL
  clicks, as in the game; its RTCLOK-equality waits (a delay subroutine, a delay that
  stops early, two timeout deadlines and the loader's one-tick wait) become
  elapsed-time waits that catch up: each keeps how late it ended (up to 32 ticks)
  and the next ends that much early, so steps lost while a redraw held the CPU are
  made up; its loader skips the disk check and the reading of the main
  game. The title's logo appears at once: on the Atari it is revealed pixel by
  pixel for 47 seconds, and every revealed pixel made the renderer redraw the
  banner, so the M.U.L.E. walking below it showed only now and then; both reveal
  sweeps run straight away and `title_hold` keeps the title up until the Atari's
  would end. The banner's DLI no longer steps COLOR2 each frame (each step redrew
  the whole banner), nor adds COLOR2 (which the music's notes set) to its shading,
  so the letters stay one colour. Any key typed reaches the intro's `CH` (the OS keyboard handler's
  job), so a key skips the title as on the Atari. The number of planeteers starts
  at 1 and SELECT cycles 1, 0 (all computer), 2: the controller screen wants a
  different controller's button per planeteer, and the 3RIC has the keyboard and
  two pads. The intro's renderer build skips the player-collision scan (the intro
  reads none); its console-key
  holds count only the ticks between redraws, since its main code (which reads
  CONSOL) does not run during one. Phase 1 of the loader loads the runtime, the intro's renderer and OS layer
  and the intro, saves what the ROM DOS (or the Disk II boot) needs (zero page, stack,
  pages 2-3 and 8-9, RAM2, the VIA's interrupt enables) and runs it. At the warm start
  `intro_done` stashes `$0000-$0FFF` (the configuration the intro wrote) at `$3000`,
  shows "LOADING" on the text page, puts the loader's state back and returns into it;
  phase 2 loads the main game as before and `boot_final` hands it the stash. The
  intro uses none of `$1000-$6FFF`: `intro.s` lives at `$1000`, the snapshot at
  `$6000`.
- **Memory.** The hi-res page must be `$2000` or `$4000`, both inside the game. The
  `$2000-$3FFF` block (about 3 KB of code, strings, the map screen, tables) moves to
  language-card RAM at `$E000`. 325 absolute references were found by recursive
  disassembly seeded from every instruction three long traced sessions executed (and
  three more, in the random events, by a scan for JSR/JMP to the entry points the
  others reach); 80
  pointer sources (string addresses, pointer tables, DLI vectors, the screen writer's
  base, two VBI jump-table entries) by tracking, in a reference emulator, which
  immediate or table byte produced the high byte of every pointer that reached the
  block, through arithmetic and self-modified code, and by a static scan of the three
  string routines' call sites. One message straddles `$3FFF/$4000`; it gets a
  contiguous copy (in bank 2's free end). The music player's end/loop checks compare its four voice
  pointers with block addresses (`CMP #$29`...); those four immediates move too.
  Hardware **stores** need no patch: they land in a register file of
  bank-2 RAM at the real addresses. The 65 hardware **reads** become a read mirror
  (`$0300`) or helpers (RANDOM, VCOUNT, CONSOL clicks); the ROM-font copies read the
  port's font; `SETVBV` is replaced. The game's two waits for RTCLOK to *equal*
  start + n (`$1310`, and an inline one at `$3926` that also polls the players)
  become waits for n *elapsed* ticks (`jwait`), because the redraw runs inside the
  tick and the main code can miss the one tick with that exact value.
- **Runtime** (`rt.s`): a 60 Hz tick on the second Mockingboard VIA plays the Atari
  VBI NMI (pads and keyboard to sticks/triggers/console keys, POKEY to the two AYs,
  player-0 collisions (only players within 8 colour clocks of player 0 are scanned), then the game's VBI with the Atari stack frame, carrying the
  interrupted code's `P`: the game skips its work when `I` was set). The game's VBI
  runs only while NMIEN enables it, as on the Atari: its pause screen turns NMIs
  off and waits inside its VBI for START, which the tick keeps reading. The first VIA's
  Timer 1 runs in step and gives VCOUNT. Code that only runs with bank 2 mapped
  (`hw_init`, `boot_final`, the jiffy waits, SETVBV, the CONSOL clicks) sits in free
  gaps between the FP package's entry points, leaving RAM2 to what both banks need.
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
  **Return or 1** = START, **Tab or 2** = SELECT, **3** = OPTION; any key passes the
  title.
- **Display** (`render.s`, bank 1): with interrupts off, walk the display list and
  call the game's DLI handlers where ANTIC would, recording per band the colours,
  character set, player positions and colours, and (in the band's hi-res *screen
  hole*, the 8 undisplayed bytes of hi-res block n) its missile positions and player
  widths; then, interruptible, hash every band: its layout, colours as the hi-res
  colours they become, screen bytes, and the bytes of every player and of the
  missiles over its lines (with their line), plus, for each sprite with pixels there,
  its position and width. If nothing changed nothing is written. A changed band is
  redrawn row by row, each row's players and missiles ORed in as soon as its
  playfield is drawn, so a sprite is off the screen only while its own row is
  rewritten; nothing is kept between frames (no save-unders or row records, so
  there is no limit on how many sprite rows a screen has: the map's mountains, river,
  town and plot cursor need about 220). There is no second page to flip to (both
  hi-res pages are inside the game), so this stands in for double buffering: static
  screens never blink. One Atari column per hi-res byte (four 2-bit pixels per byte
  in modes 4/5 and the intro's mode D banner); colours to the nearest hi-res colour.
  In modes 4, 5, 8, D and E COLBK fills the background; a playfield colour that
  becomes the background's hi-res colour (but is not COLBK) is drawn white (black on
  white), so the logo's black outlines on its gold show; on a black screen nothing
  is drawn black. In modes 6 and 7 each Atari pixel is 1.75 dots: pixels 3 and 7
  would be one dot each, of opposite parity, and vanish in the colours that light the
  other dot, so pixel 3 also lights dot 7 and pixel 7 dot 12; a blank character
  takes the palette bit of the byte before (a palette-0 byte cut short the half-dot
  shift of an orange or blue dot before it), and a row of nothing but blank code 0
  is filled black at once. The second scan line of a mode 5, 7 or D line is
  a copy of the first, unless sprites were ORed into the first. Blank lines above
  the first mode line that are on the screen become one entry, so sprites there (the
  intro's species grid) are drawn. A band whose playfield (layout, colours, screen
  bytes; its own part of the hash) is unchanged but whose sprites changed is
  redrawn only in the columns its sprites cover now or did last time (groups of
  four), so a walking figure rewrites a few columns, not the band; the
  hash's colour classes are cached per slot. The intro's mode-D logo is drawn in
  colour cells: every 8 pixels are 7 cells of two dots, each from two neighbouring
  pixels (the outline wins), so the letters' edges fall on whole cells, with one
  palette bit for the band; both fills the intro uses are white, so it shows white
  letters with black outlines on the gold, without fringes. After a redraw the tick
  waits as long as the redraw took (three ticks at least) before the next, so the
  main code keeps half the CPU on busy screens; while the interrupted code stays in
  one page from tick to tick (a polling loop or a wait) the wait halves each tick.
  Renderer code that is the same in both builds also
  uses RAM2's end; its variables sit after the runtime's in page 3. Code and data
  each build keeps for itself live in main RAM its program leaves free: the game's
  at `$0600` (loaded with page 3) and `$0406`, the intro's at `$1800` (in
  `IRT.BIN`) and `$1D00`.
- **Sprites in colour cells.** The hi-res screen shows 140 colour cells across, the
  Atari playfield 160 colour clocks, so a sprite's place is cell x * 7/8 (it keeps
  its place on the map), but each of its pixels is a whole cell, two dots lit on its
  colour's own dot (both for white): shapes keep every pixel and their colour wherever
  they stand, one dot of width wider per 7 than the playfield's scale. (They were 2,
  2, 2 and 1 dots per 4 pixels, ANDed with the colour's dot pattern, which dropped
  pixels and shimmered as a sprite moved.) Double and quad players (SIZEP) are 2 or
  4 cells a pixel; missiles 2, 4 or 8 cells (SIZEM), in COLPF3 when PRIOR selects the
  fifth player (the title's and the town's mules have missile bodies), else their
  player's colour. The map's river (player 3 in gold) is drawn blue: it is water,
  and only on bytes nothing else is drawn on, so a plot's frame, icon and
  production dots stay readable over it.
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
- **Sprites that did not look right.** On the title only the mules' legs showed:
  their bodies are the four missiles side by side as the fifth player, and missiles
  were not drawn. The plot cursor is a double-width player (drawn single width); the
  plot frames' sides and the production dots are missiles the display-list
  interrupts move per band. With those in, the map needed about 220 player-row
  records against 80, so the last players (the river, the town) were dropped:
  records and save-unders went, and sprites are now composited as each band row is
  drawn. A double-width player was still missing after that: its run routine tested
  a flag the caller's `LDX` had just set.
- **A development round that never ended**, once the river was blue (it was not the
  colour). The random events' code read POKEY's RANDOM directly at 12 sites the
  traced sessions never reached ("SUNSPOT ACTIVITY" waits for RANDOM to fall in
  `$36-$C2`, and a constant may never), and the radiation event called two routines
  of the moved block at their old addresses, so the CPU ran the hi-res page. The
  game's VBI was also re-entered while its pause screen ran inside it with NMIs
  off. A scan of every absolute hardware read and of every JSR/JMP to an entry point
  of the moved block found them; the test now asserts that none is left. (The
  river's blue had only changed the timing that led the test into those events.)
- **No way past the intro on the keyboard.** The controller screen waited for a
  third and fourth controller (the Atari's default is four planeteers); START
  typed during a redraw expired before the intro's main code ran again; and once
  through, the game paused on its first frame: Space (`CH` = `$21`) is the Atari
  game's pause key, the intro's last key had left `CH` at `$21`, and nothing in the
  game sets `CH`, so it waited forever on a black screen. `boot_final` now leaves
  `CH` at `$FF`, as the OS does.
- **A plot frame without its right side**, and a column of production dots missing
  in the orange plots: the intro draws the plot in mode-6 characters, and their
  one-dot pixels fell on the colour's unlit dot. The logo's outlines were white: a
  black playfield colour was drawn white, also on the logo's gold background.
- **Still slow.** Redraws of the title's walking band spent most of their time on
  blank characters, and a sixth of the CPU went to collisions the intro never reads.
  Title redraws went from 5 to 13 per 300 ticks, options 3 to 18, controllers 8
  to 21; the walk itself, done in the intro's VBI, always kept the Atari's pace.
- **A logo that kept moving, and a store too slow to play.** The banner's shading
  followed the music's notes, and a sweep turned the letters' fill from PF2 into
  PF1 (the background's gold) pixel by pixel; each step redrew banner lines. In the
  town the game's main loop only polled, yet the tick waited a redraw's length
  between redraws, and each step of the player redrew whole mode-4 bands at about
  340 cycles a byte: under two redraws a second. With the sprite-only column
  redraws and the shorter wait when the main code polls, walking in the town went
  from 4 to 9 redraws per 120 ticks. (A first rule that redrew at once whenever the
  intro's main code was in one page starved the sweeps, which then filled the
  letters over seconds.)

## Evidence

`node codegen/tools/port-mule.test.mjs`: FP against an independent decimal reference
(1,600 operations within one unit in the last place, IFP/FPI, FASC formats), runtime,
both renderers, `intro.s` and loader layout, and font. With `MULE_ATR=<atr>` (after
`web/build.ps1`): converts the original disk and checks that no absolute read of an
Atari hardware register and no JSR/JMP to an entry point of the moved block is left
in the game or the intro; boots the folder from a generated FAT32
card on the WASM 3RIC and plays the intro on the pads by what its screen says (title left with a typed key,
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
pirate ship, the status after a round and the first auctions; then the title's
walking mule with its body, any key passing the title, the map with mountains, a
blue river, the town and the plot cursor, complete plot frames and production dots,
and play on through the random events into the second round; and a keyboard-only
`MULE.WOZ` run (Q, Return, Space, Space, D, D, Space, Space) from the title to the
status summary, the intro's plot drawn whole in blue, violet and orange; the logo
steady white with black outlines through the title; a walking mule redrawn by
columns with nothing left behind (frames taken between redraws); and play through
the town, development, production, the status and the first auctions.

**Not yet shown:** the town and mules with real play, later rounds and the end of a
game on the 3RIC; sound by ear; anything on the physical board.

## Known limits

- The planet surface is incomplete (background colours are filled only in modes
  4, 5, 8, D and E; mode-6 map
  tiles in dark tones become white, dark sprites white), and the playfield is redrawn
  every third tick, so motion is choppier than the Atari; a sprite that moves
  redraws the bands it is on, which can tear for a moment mid-redraw.
- Playfield collisions (`P0PF` reads 0), player collisions from DLI-moved players,
  multicolour players (PRIOR bit 5), missile widths changed per band and the
  missiles' own priority are not modelled.
- The keyboard works where keys arrive in `$C000` (the browser emulator, the native
  emulator's direct path); the physical board's PS/2 keyboard is not decoded while the
  game runs (its NMIs are off and the ROM handler's RAM is the runtime's). Pads: B/A/Y
  fire, Start = START, Select = SELECT, X/L/R = OPTION.
- Keyboard directions latch, so steering is coarser than with a pad.
- The intro's horizontal fine scrolling (HSCROL) is ignored, and its banner's colour
  cycling and shading are turned off. The title redraws about three times a second.
- Entering the town redraws its whole mode-4 screen, about two seconds; walking
  there redraws about four times a second. The player-collision scan still reads
  every row of player 0 each tick (about a tenth of the CPU in the town).
- The river's hiding over a developed river plot follows from the code and was not
  seen in a run (no river plot was developed in the scripted games).
- Space fires; the Atari game's Space pause is not reachable from the keyboard.
- Relocation and hardware reads are complete for every path the static scans and
  three long sessions reached; an untested path could still use a pointer the
  analysis missed.
- Only the release this port was built on is accepted (pinned main-image hash).

## Next steps worth discussing

- Background colours for modes 2/6/7 and the planet surface; play through a full game.
- Sprite art redrawn for colour cells, with the C64 release's multicolour sprites as
  a reference.
- Tests that need no disk image: drive `key_scan`, the sound mapping, `jwait` and the
  sprite compositing on the assembled runtime, and `buildGame`'s patches on a
  synthetic image (deferred from the second-model review; today they run only with
  `MULE_ATR`).
- A board trial.
