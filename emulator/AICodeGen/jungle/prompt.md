# Jungle Quest — codegen prompt

- **Model:** Claude Opus 4.8 (GitHub Copilot CLI)
- **Date:** 2026-07-10
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` &nbsp;→&nbsp; `BRUN JUNGLE.PRG 0800`

## Prompt

> Create a jungle-adventure platformer for the 3ric, faithful to the classic
> Atari-2600 jungle-runner genre.

## Scope & originality

**JUNGLE QUEST** is an *original* game inspired by the jungle-platformer genre.
It reuses only the un-copyrightable **mechanics and genre conventions** — run and
jump, leap over pits, dodge a moving hazard, grab treasure, race a countdown
timer, lives/score, a flip-screen jungle. It deliberately does **not** reproduce
any specific game's protected expression: no third-party ROM or code, no
character likeness, no reused sprite art, no copied level layouts, no trademarked
name, no sampled sounds. All art (hero, gem, log), level design, name, and code
here are original to this project.

## Result

- **`jungle.s`** — 65C02 source.
- **`jungle.prg`** — assembled raw image (load and run at `$0800`).

Runs in mixed hi-res mode (160px playfield + a 4-line text HUD). The engine
builds a 192-entry hi-res row-address table, blits OR-masked sprites with a
single x/7 division each, and erases by copying from a clean background buffer.
The player has 8.8 fixed-point gravity/jump physics with ground- and pit-edge
collision; falling in a pit costs a life. A rolling log hazard patrols the left
platform and wraps. Three gems are collectible (+2000 BCD each); a 60-second
countdown ticks in the HUD. Collect them all to **win**, run out of lives for
**game over**, or let the clock hit zero for **time up** — press **SPACE** on any
end screen to play again.

## Build & test

```sh
# assemble
node codegen/tools/asm6502.mjs emulator/AICodeGen/jungle/jungle.s emulator/AICodeGen/jungle/jungle.prg --org 0x0800

# headless engine + gameplay tests (row table, plot, sprite blit, physics,
# hazard collision, treasure pickup/score, win, timer)
node codegen/tools/jungle.test.mjs
```

## Run it

- **Hardware / disk:** `BRUN JUNGLE.PRG 0800`.
- **Hosted emulator:** deep link `?prg=programs/jungle.prg&org=0800` (set **Speed**
  to **1MHz** or **2MHz** for a playable pace — not Max), or the **Load .PRG…**
  button at address `0800`.

### Controls

- **A / left** — run left
- **D / right** — run right
- **W / SPACE** — jump
- **SPACE** — (on an end screen) start a new game
