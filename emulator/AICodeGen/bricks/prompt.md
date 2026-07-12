# BRICK BUSTER — codegen prompt

- **Model:** Claude Opus 4.8 (GitHub Copilot CLI)
- **Date:** 2026-07-09
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` &nbsp;→&nbsp; `BRUN BRICKS.PRG 0800`

## Prompt

> Create an original brick-breaker named BRICK BUSTER for the 3ric as its own
> codegen project. Text mode, side and top walls, several rows of bricks, a
> movable paddle, a bouncing ball that clears bricks and scores, three lives,
> quit, and a restart-on-space game-over/win screen. Build and test it headlessly.

## Result

- **`bricks.s`** — 65C02 source.
- **`bricks.prg`** — assembled raw image (load and run at `$0800`).

Runs on the 40×24 **text** page. A 24-entry row-base table maps `(row,col)` to the
interleaved screen layout. Bricks (`#`) fill several rows and are tracked in a byte
array so each can be cleared individually; the paddle (`=`) slides along the bottom
and the ball (`O`) travels on a diagonal, carrying a `±1` velocity on **both** axes
so it always has horizontal momentum. It is served at a random left/right angle, and
the paddle steers it: strike the ball with the paddle's left half to send it left, the
right half to send it right. It bounces off the walls, the paddle, and the bricks.
Clearing a brick scores; dropping the ball past the paddle costs a life; zero lives
ends the game and clearing the field wins. **SPACE** restarts; **Q** returns to the
monitor. Ball pacing (`PACE`/`DLY`) is tuned to roughly 15 steps/second at the native
1× clock — a playable brick-breaker speed, not the old blink-and-miss-it dash.

## Build & test

```sh
# assemble
node codegen/tools/asm6502.mjs emulator/AICodeGen/bricks/bricks.s emulator/AICodeGen/bricks/bricks.prg --org 0x0800

# headless smoke/behaviour test (render, ball motion, brick clears, logic hook)
node codegen/tools/bricks.test.mjs
```

## Run it

- **Hardware / disk:** `BRUN BRICKS.PRG 0800` — **A/D** or left/right arrows move
  the paddle, **Q** quits.
- **Hosted emulator:** the **Games** dropdown, deep link
  `?prg=programs/bricks.prg&org=0800`, or **Load .PRG…** at address `0800`.
  The ball is paced for the native **1×** clock; bump the **Speed** up for a
  faster game or down to **0.5×** for a gentler one.
