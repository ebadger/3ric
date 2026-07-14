# Star Swarm — codegen prompt

- **Model:** Claude Opus 4.8 (GitHub Copilot CLI)
- **Date:** 2026-07-09
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` &nbsp;→&nbsp; `BRUN SWARM.PRG 0800`

## Prompt

> Create a space invaders clone.

## Scope & originality

**STAR SWARM** is an *original* game inspired by the classic fixed-shooter
"defend the bottom of the screen" genre. It reuses only the un-copyrightable
**mechanics and genre conventions** — a grid formation of aliens that marches
side to side, drops down and speeds up as its ranks thin, and rains bombs; a
player cannon that slides along the bottom and fires a single bolt upward;
destructible shields to hide behind; and a bonus saucer that streaks across the
top. It deliberately does **not** reproduce any specific game's protected
expression: no third-party ROM or code, no copied sprite art, no trademarked
name, no sampled sounds. Every sprite (the cannon, the three alien ranks and
their animation frames, the saucer, the shields), the name, and the code here
are original to this project.

## Result

- **`swarm.s`** — 65C02 source.
- **`swarm.prg`** — assembled raw image (load and run at `$0800`).
- **`spritegen.mjs`** — Node script that authors every sprite as ASCII art and
  bakes it into the `.byte` mask tables pasted into `swarm.s` (`draw_sprite`
  walks a left-aligned 16-bit row mask, so the art is packed to match).

Runs in mixed hi-res mode (a 280×160 sprite playfield over a 4-line text HUD).
The engine builds a 192-entry hi-res row-address table and blits sprites with an
XOR routine, erasing by redrawing at the old position before redrawing at the
new one (a per-object DRAWN flag suppresses the first erase). Forty aliens in
five rows of eight march as one body via a rolling ripple cursor, stepping
faster as the swarm thins; the front ranks drop bombs on a cadence. The cannon
fires one bolt at a time; a hit scores by rank (top rows worth most). Four
shields erode pixel-by-pixel under fire from both sides, and a mystery saucer
glides across the top for bonus points.

An **attract / title screen** opens the game (press keyboard **SPACE** or SNES
pad **START** to launch). Clear the swarm to roll into a faster wave; let the
swarm reach the shields, or lose your last cannon, for **game over** — press
**SPACE** or **START** to play again. Score, lives, wave, and a high score are
shown on the HUD.

## Build & test

```sh
# assemble
node codegen/tools/asm6502.mjs emulator/AICodeGen/swarm/swarm.s emulator/AICodeGen/swarm/swarm.prg --org 0x0800

# (optional) regenerate the baked sprite tables
node emulator/AICodeGen/swarm/spritegen.mjs

# headless engine + gameplay tests (row table, XOR sprite blit, cannon move/fire,
# formation march/drop/speed-up, bolt/alien collisions + rank scoring, alien
# bombs + cannon hits/lives, destructible shields, mystery saucer, and the
# attract/play/game-over flow with waves, respawn, HUD, and high score)
node codegen/tools/swarm.test.mjs
```

## Run it

- **Hardware / disk:** `BRUN SWARM.PRG 0800`.
- **Hosted emulator:** deep link `?prg=programs/swarm.prg&org=0800` (set **Speed**
  to **Max** for a brisk pace), or the **Load .PRG…** button at address `0800`.

### Controls

- **A / left** — move the cannon left
- **D / right** — move the cannon right
- **SPACE** — fire; also starts the game from the title screen and restarts on
  the game-over screen
- **SNES D-pad left / right** — move the cannon
- **SNES A / B** — fire
- **SNES START** — start or restart; **SELECT** — quit to the monitor

The ROM refreshes its `GAMEPAD1` table when the game touches `PTRIG`; impossible
D-pad states are ignored defensively. The shared emulator models the same VIA/SNES
serial path, with browser USB/Bluetooth controllers supplying the button state.
