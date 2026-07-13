# Rock Storm — codegen prompt

- **Model:** Claude Opus 4.8 (GitHub Copilot CLI)
- **Date:** 2026-07-09
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0C00` &nbsp;→&nbsp; `BRUN ROCKS.PRG 0C00`

## Prompt

> Create an asteroids clone, keeping it as close to the original as possible.

## Scope & originality

**ROCK STORM** is an *original* game inspired by the classic vector rock-shooter
genre. It reuses only the un-copyrightable **mechanics and genre conventions** —
rotate a vector ship, thrust with inertia, fire shots, blast drifting rocks that
split into smaller rocks, everything wraps at the screen edges, plus a
hyperspace panic-jump, lives, score, and escalating waves. It deliberately does
**not** reproduce any specific game's protected expression: no third-party ROM
or code, no copied vector shapes, no trademarked name, no sampled sounds. All
polygon art (the arrowhead ship, the thrust flame, the lumpy rocks), the name,
and the code here are original to this project.

## Result

- **`rocks.s`** — 65C02 source.
- **`rocks.prg`** — assembled raw image (load and run at `$0C00`).
- **`rockgen.mjs`** — Node script that bakes every rotated silhouette and rock
  polygon into the `.byte` geometry tables pasted into `rocks.s` (the assembler
  has no multiply and there is no runtime trig, so all geometry is precomputed).

Runs in mixed hi-res mode (a 280×160 vector playfield over a 4-line text HUD).
The engine builds a 192-entry hi-res row-address table and draws every shape
with an XOR Bresenham line routine. To eliminate flicker it **page-flips**
between the two hi-res pages (`$2000`/`$4000`) and their matching text-HUD
pages (`$400`/`$800`): each frame clears the hidden (off-screen) page, redraws
the whole scene there, then flips the display soft switch (`LOWSCR`/`HISCR`) so
the player never sees a half-drawn frame. The `pgoff`/`txtoff` offsets steer pixel
and HUD writes at the hidden page, while `clear_screen` patches its absolute store
operands to the same target; the flip alternates them together each frame. This
full-frame clear-and-redraw replaces the old
erase-by-redraw pass. The clear loop uses 32 unrolled absolute-indexed stores and
self-modifies their high address bytes when the draw page flips; this cuts an 8 KB
clear from 61,843 to 34,307 cycles. The line setup divides X by seven with six
power-of-two subtracts instead of as many as 45 repeated subtracts, reducing a
four-large-rock draw from 113,775 to 82,213 cycles. The per-pixel loop also inlines
its `plotcur`/`stepx`/`stepy` helpers and keeps its Bresenham error term in one byte
(every rock/ship edge spans ≤36 px). Finally, the live loop no longer adds a
30,861-cycle fixed delay after its renderer has already paced the game.

Together these changes reduce an opening-wave live frame from **225,949 to 133,274
65C02 cycles** (41% fewer cycles, about 1.69× the throughput, or roughly 4.5→7.7
fps at 1.023 MHz) while remaining pixel- and state-identical across a 400-frame
scripted comparison. Ship, bullets, and rocks share a 16-byte object struct with 8.8
fixed-point position and velocity; motion wraps modulo the playfield. Rocks
split into two faster children when shot (20/50/100 points by size); the ship
gets a brief spawn/arrival invulnerability. Waves escalate from four rocks up to
a cap of eight.

An **attract / title screen** opens the game (press **SPACE** to launch). Clear
every rock to roll into the next, larger wave; lose your last ship for **game
over** — press **SPACE** to play again.

## Build & test

```sh
# assemble
node codegen/tools/asm6502.mjs emulator/AICodeGen/rocks/rocks.s emulator/AICodeGen/rocks/rocks.prg --org 0x0C00

# (optional) regenerate the baked geometry tables
node emulator/AICodeGen/rocks/rockgen.mjs

# headless engine + gameplay tests (layout/cycle budget, both clear pages,
# row table, XOR line/clip, polygon draw,
# ship physics/wrap, bullets, rock spawn/drift/split, collisions/score, waves,
# HUD, attract/game-over flow, thrust flame, hyperspace)
node codegen/tools/rocks.test.mjs
```

## Run it

- **Hardware / disk:** `BRUN ROCKS.PRG 0C00`.
- **Hosted emulator:** deep link `?prg=programs/rocks.prg&org=0C00` (set **Speed**
  to **Max** for full-speed vectors), or the **Load .PRG…** button at address
  `0C00`.

### Controls

- **A / left** — rotate left
- **D / right** — rotate right
- **W / up** — thrust (lights the engine flame)
- **SPACE** — fire; also starts the game from the title screen and restarts on
  the game-over screen
- **H** — hyperspace (warp to a random spot; brief cooldown)
