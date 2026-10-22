# Dirt Bike: an SD-card port at Apple II speed

**2026-10-22. Emulator-verified; no physical-board trial yet.**
The owner supplied `DIRTBIKE.dsk`, Verhille Arnaud's Apple II port of a motocross time
trial ("DIRTBIKE - APPLE II+ 48K", V1.0: 30 tracks, three laps each, a hall of fame),
and asked for it to load from the 3RIC ROM DOS rather than as a WOZ. The image and
the generated SD folder contain the game and stay local. This repository holds the
converter, the glue code and its tests only.

| Artifact | SHA-256 |
|----------|---------|
| `DIRTBIKE.dsk` as supplied (140 KB, DOS order) | `ea40bda3dd58a31674af742736fd900dcbfd264ad4ef04eab09b6d59e247096e` |
| `DIRTBIKE` file body (`$6000-$957E`), checked by the tool | `296fa338efabd5fa72402fcd3d9d500bfc26c5080880fbefdc654b057df3424f` |
| `TITLE` file body, checked by the tool | `3167fb0e9275e405494db47d1f7d58d22daf03d876ce2b2ddbab8bde460ad7bf` |

`DIRTHOF` (the hall of fame) changes whenever a record is set, so it is not checked.

## What the disk turned out to be

A DOS 3.3 disk with a relocatable "master" boot (`$08FE = $36`) and an Applesoft
`HELLO` that only prints a banner and does `BRUN DIRTBIKE`. The game never touches the
DOS 3.3 file manager. It reads its files itself, one sector at a time, through RWTS
(`JSR $03E3` for the IOB, `JSR $03D9`), using track/sector tables compiled into the
binary:

| Game routine | Does | Table |
|--------------|------|-------|
| `$84D1` | read a file's T/S list into `$B600`, then each data sector into consecutive pages from `$075F` | tracks `$917F/$919D`, `TITLE` `$91C2/3` |
| `$8519` / `$8516` | read / write one sector (track `$075D`, sector `$075E`, page `$075F`) | |
| `$76BC` / `$76A9` | read / write the hall of fame's two sectors at `$B500-$B6FF` | `$91BC-$91BF` |

Because the loader stores **raw sectors**, each file's 4-byte DOS header lands in
memory too: `TITLE` and every track load at `$9600` with their data from `$9604`, and
the code is built for that (`TITLE`'s menu entry `JMP $9C00` only makes sense with the
data at `$9604`). `TITLE` holds the help and ending text, the main menu's code and the
compressed title picture, not just a picture. `T01-T30` are the tracks (0.9-3 KB).
`DIRTHOF` is 368 bytes of records, initials and the saved input setting
(keyboard/joystick), signed `DBH\x01`. It is copied to `$1E6E` and written back as
the same two raw sectors. The game loads over DOS 3.3's own memory (`$9600-$A6FF`,
`$B500-$B703`) and keeps only RWTS (`$B800-$BFFF`) and its IOB page. Menu item
"5 QUIT TO BASIC" stores `QU` at `$8000` and reboots the floppy (`JMP $C600`), so
the disk's `HELLO` sees the marker and says `DIRTBIKE: BYE!`.

Nothing else is a 3RIC problem. The game never uses the language card, IRQs or
`$C800-$CFFF`. Its IIe soft-switch writes are skipped because the ROM's `$FBB3` reads
`$EA` (a II+). `WAIT`, `BELL` and `MONZ` are where the Apple keeps them. It uses no
undocumented NMOS opcodes and no `JMP ($xxFF)`.

## The port

`node codegen/tools/port-dirtbike.mjs <DIRTBIKE.dsk> <out>` writes `<out>/DIRTBIKE/`:
`DIRTBIKE.PRG` (16.5 KB), `TITLE`, `T01`-`T30` and `DIRTHOF`, 86 KB in all. Each data
file holds exactly the raw data sectors the game's loader read (T/S-list order, up
to the first empty entry), so memory ends up byte for byte as on the Apple. An
existing `DIRTHOF` in the output folder is kept: it holds the player's records.
Copy the folder to the card root, then `CD DIRTBIKE` and `BRUN DIRTBIKE.PRG 0800`.

**Loader** (`codegen/patches/dirtbike/loader.s`, `$0800`) stands in for `HELLO`. It
checks the ROM ABI (`COUT = JMP ($0036)`, the `$03EA` hook, the NMI proxy at `$F1BB`
and the `dos` entry), zeroes `$CAFE` and turns the BASIC overlay off. It then copies
the resident to `$B704` and the patched game to `$6000-$957E`, clears the rest of
that last page, captures the ROM DOS collector from `$03EA`, starts the timer (below)
and jumps to `$6000` with IRQs masked.

**Resident** (`resident.s`, `$B704-$BF4B`, DOS 3.3's old IOB page and RWTS: the game
called RWTS there and only ever spills the 4 bytes `$B700-$B703` of its hall-of-fame
copy below it):

| Game site | Becomes |
|-----------|---------|
| `$84D1` load by T/S list | `FLOAD NAME pp00 0000 size-1`, the name found by the T/S location in a table the tool builds from the game's own tables |
| `$76BC` read hall of fame | `FLOAD DIRTHOF B500 0000 01FF` |
| `$76A9` write hall of fame | `OWRITE DIRTHOF B500 01FF` (one 512-byte card sector) |
| `$8516` / `$8519` RWTS sector I/O | `SEC / RTS` (no callers remain) |
| `TITLE $9D01` reboot | back to the ROM DOS prompt as a reset leaves it: Mockingboard quiet, `$CAFE`, `MUTE_OUTPUT` and the key latch cleared, `SETNORM`/`INIT`/`SETVID`/`SETKBD`, the collector as `CSW`, `dos` |
| `TITLE $9DB9` | the menu says `QUIT TO DOS` |

Commands go through the ROM's Ctrl-D collector with output muted, because the game
keeps routines and variables in the text page. `$B0-$BF`, `CSW` and `MUTE_OUTPUT` are
restored afterwards. The ROM DOS reports failures only as text, and a failed `FLOAD`
still copies from stale state through `($BC)`, which it sets only after finding the
file. So the resident points `$BC/$BD` at the destination, clears the destination's
first four bytes, and counts a load only if the file's DOS header arrives. Otherwise
it returns carry set, and the game shows its own `DISK ERROR: PRESS A KEY`. The game's
save routine reads the hall of fame first and stops if that fails, so `OWRITE` never
meets a missing file (it would fall into `BSAVE` in the BASIC bank).

## SNES pads

The game has a joystick mode (default when a joystick is found): paddle 0 for lean,
paddle 1 for menu up/down, button 0 gas, button 1 brake. On 3RIC that path breaks
twice. The ROM serves `$C061`-`$C065` from RAM refreshed only by a `PTRIG` (`$C070`)
scan, so the game's release wait at `$6119` (`LDA $C061 / ORA $C062 / BMI`) never
ends, the [Spy Hunter](spy-hunter.md) trap. And each scan raises NMIs whose ROM exit
clears every VIA1 flag, the PS/2 hazard that [A2Robots](a2robots.md) and
[Ultima II](ultima-ii.md) avoided. The port redirects `$815C` (the paddle read) and all
six `$C061`/`$C062` reads into the resident. That clocks both pads directly on VIA1
port B with the ROM scan's pin sequence and settle time, as Ultima II does (12 bits;
the 4 unused ones are not clocked), and fixes the calibration at `$921B` to the
resident's centre (`$40`). The game's own frame reads the paddles every other frame
and the buttons every frame. The button read reuses a paddle read made earlier in
the same frame.

| Pad (either) | Game |
|--------------|------|
| D-pad left / right | lean back / lean forward (paddle 0 low / high) |
| D-pad up / down | menu up / down (paddle 1) |
| B or X | button 0: gas (as the ROM maps them to `$C061`) |
| A or Y | button 1: brake (as the ROM maps them to `$C062`) |
| Start | Esc (main menu), typed into `$C000` once free |
| Select | R (restart the track) |

The keyboard keeps working alongside: A/Up gas, Z/Down half gas, J/Left and L/Right
lean, Space brake, R restart, S sound, Esc menu. Half gas has no pad button, as in the
original's joystick mode. Menu item 3 still switches the game to keyboard-only, and
that setting is saved in `DIRTHOF`.

## Apple II speed

3RIC's 65C02 runs at 1.5734375 MHz, 1.538 times the Apple's 1.0227 MHz, and the game
has no timer. A race frame lasts as long as its code takes, and the race clock adds
3, 3, 4 hundredths per frame (30 fps). Unpaced, the first race ran 46.5 frames per
second, and the clock gained 3.10 s every 2 real seconds. Its sound effects and the
title music are speaker delay loops (`$6003`, with a note player at `$7B73`), and its
pauses are the monitor's `WAIT`. At the owner's choice the port restores Apple timing:

- **Sound.** `$6003`'s two call sites go to a copy whose half period is `15 + 5n`
  cycles with `n = X + X/2 + X/32 + X/64 + 1`. The Apple's was `5X + 12` cycles at
  1.0227 MHz, so pitch and length match within 1% over the X values the game uses.
  The loops sit in one page (the tool checks), so no branch costs an extra cycle.
- **Pauses.** The six `WAIT` calls (countdown, menu polling, the record screens) run
  `WAIT(a)` and then `WAIT(wtab[a])`, a 256-entry table the tool computes so the pair
  lasts as long as `WAIT(a)` did (`$28` → 27, `$4F` → 56).
- **Frames.** At `$7D95`, the frame's last call before its page flip, `pace` measures
  the frame's own work on the slot-4 Mockingboard's first VIA. Timer 1 runs free from
  `$FFFF`, is polled, and has interrupts off. `pace` then waits 0.538 times that
  (`1/2 + 1/32 + 1/256 + 1/512 + 1/1024`). Tone, `WAIT` and disk time are not work:
  they already run at the Apple's length. The wait's overshoot carries to the next
  frame as a negative balance. `PACE_DEBT` (357 cycles) removes 1.538 times the ~232
  cycles of `pace`'s own code that fall inside a frame's work. More than 64K cycles
  of work in one frame means a menu or a pause, not a race frame: not padded. A
  timer that stopped counting would end the pacing rather than hang the game.

`timer_init` keeps the timer only if two probes see it count. Without a Mockingboard,
frames run at 3RIC speed while sound and pauses stay retimed, because those need no
timer.

**Result** (emulator, WASM): the same 300 race frames on the pad (identical bike
position and clock in both builds) take 11.41 s at Apple II speed, judged from an
unpaced build's cycles, and 11.35 s on 3RIC with the pacing.

## What went wrong on the way

- **`PAGE` and `page` are one symbol.** asm6502 folds case, and a resident variable
  named `page` silently replaced the game's `PAGE = $075F`. `TITLE` went to `$B500`
  and over the resident. The tool now refuses sources whose equates and labels collide
  case-insensitively (`checkSymbols`).
- **The resident outgrew `$B800-$BFFF`** once the file table and the `WAIT` table were
  in (it ended at `$C02C`), so it now starts at `$B704`.
- **Pacing overhead.** The first pacer measured each wait from a fresh tick and reset
  the timing after it, which ran frames ~2% long. Now the wait counts from the frame's
  last tick, the overshoot carries over, and `PACE_DEBT` subtracts the pacer's own
  instructions. Ten synthetic frames are within 0.5%.
- **One flag, two underflows.** Polling Timer 1 cannot tell one underflow from two.
  A single stretch between ticks is exact only up to one period (65,537 cycles,
  42 ms). Race frames measure ~38,000 cycles (median, emulator), and menus are many
  short stretches split by `WAIT`s.
- **Emulator branch timing.** The tone test first measured 2,374 cycles per half
  period instead of 1,980. The emulator counts not-taken branches as 3 cycles and
  most taken backward branches as 4. A 65C02 takes 2, and 3 unless a page is crossed:
  `ReadByAddressMode` adds a cycle for every relative operand, and `BranchOnFlag`'s
  page test adds the unsigned offset. Delay loops therefore run ~20% long in the
  emulator. The port keeps 65C02 datasheet timing for the board, and the tests compare
  each retimed routine with an Apple-style reference run in the same emulator.
  Recorded as a known gap in [`EMULATOR.md`](../../specs/EMULATOR.md); not changed here.
- A pad-typed `R` left in the key latch reached the DOS prompt after quitting
  (`RCD DIRTBIKE`, "EH?"). The quit now clears the latch, as a reset does.

## Evidence (WASM emulator, real ROM DOS and SD emulation)

`node codegen/tools/port-dirtbike.test.mjs` (after `web/build.ps1`), synthetic files:

- catalog reader, byte-verified patch sites (none overlap; the 9 timing sites are
  separable), the symbol-case guard, and the `WAIT` table within 1% on datasheet
  timing;
- the real loader and resident on the ROM DOS:
  - loads by T/S list that stop at the file's end with `$B0-$BF` intact;
  - a missing file returns carry set and writes nowhere outside its destination (a
    full 48 KB RAM diff);
  - an unknown T/S list returns carry set without a ROM command;
  - a hall-of-fame write reads back to its last byte;
- pads:
  - paddles from either pad's D-pad, both buttons and the B/X and A/Y pairs;
  - a button read reuses the frame's paddle read once;
  - Start and Select typed once, without overwriting a waiting key;
- timing:
  - tone half periods within 1% of 1.538 times the reference loop's;
  - `WAIT` within 3% of 1.538 times the ROM's;
  - one paced frame within 2%, ten within 0.5%;
  - tone time not padded twice; 64K+ of work not padded; no pacing without the timer;
- the quit: DOS banner, unmuted, `$CAFE` 0, and `CD DIRTBIKE` answers `OK`.

With `DIRTBIKE_DSK=<path>` the original disk also plays:

- the tool's checks: 33 files, the disk's own hall of fame, `QUIT TO DOS`, a refused
  one-bit change, an existing `DIRTHOF` kept;
- the title (`FLOAD DIRTHOF`, `FLOAD TITLE`) in joystick mode by default, the menu,
  then `T01` raced on the pad;
- the speed comparison above;
- the main menu's input switch saved with `FLOAD` + `OWRITE DIRTHOF`, quit to the
  DOS, and a re-run reading keyboard mode back from the card;
- a staged finish (third lap, three units before the line), a new record, initials
  `EBG` saved to `DIRTHOF`, and the game moving on to `T02`.

Manual emulator play also showed the title, the track menu, crashes and the
`QUIT TO DOS` menu. Loads run at about 2 KB/s in the emulator: `BRUN` takes ~8 s,
`TITLE` (which `Esc` reloads for the menu) 2.2 s, a track 0.7-2.1 s.

**Physical board:** not yet tried.

## Known limits

- Only emulator-tested. The pad path clocks VIA1 port B directly, like Ultima II and
  III, and that is not yet confirmed on the board. The no-Mockingboard fallback (full
  speed) has not been exercised, because the emulator always has the card.
- No complete race was driven start to finish. A full-gas script crashes on track 1's
  first jump, so the record path was reached by placing the bike near the finish line.
  Tracks 2-30 were loaded but not raced.
- Pacing is per frame and only in the race loop. After a short visit to the menu, the
  first frame back can be padded up to ~22 ms once. Title and menu screens run at
  3RIC speed apart from their sound and `WAIT`s. In joystick mode a frame's pad reads
  average ~735 cycles: the paddle read every other frame, reused by that frame's
  button read, 12 bits clocked. That stands in for the Apple's paddle loop (~740 for
  a centred stick, longer off-centre) and is scaled with the frame.
- Card contents are trusted (review-panel findings; the owner's decision, as for the
  earlier ports):
  - A load is checked only by the file's 4-byte DOS header, so a truncated or
    corrupted file with an intact header is accepted (a truncated `TITLE` would run
    stale memory).
  - Hall-of-fame writes are not read back: a failed `OWRITE` reaches the game as
    success. The game's save reads `DIRTHOF` first, but if the file vanished between
    that read and the write, the ROM's `OWRITE` would fall into `BSAVE` code in the
    BASIC bank, which is RAM while the game runs.
  - The converter keeps any existing `DIRTHOF` without checking it.

  Copy the whole folder and don't edit its files.
- Pad keys and the keyboard: a PS/2 key decoded between the resident's latch check
  and its store (two instructions) is overwritten by a Start/Select key, as in
  Ultima II. A second Start/Select press while the first is still waiting replaces it.
- The ROM's own F-key hotkeys (`@handlef7`-`@handlef12` video page/mode, `@handlef1`
  font; gated by the key-state entry `$CB77`) act during the game, as in any program.
- `DIRTHOF` writes are one 512-byte card sector, so any cluster size works.
- Reserved while the game runs: `$B704-$BF4B` (resident), the slot-4 Mockingboard's
  first VIA Timer 1 (pacing), VIA1 port B (pads). `$C800-$CFFF` remains ROM state.

## Next steps worth discussing

- A board trial: title, a race on the pad and the keyboard, and a saved record.
- Fixing the emulator's branch cycle counts (a separate change: it moves every
  emulator-measured cycle budget).
