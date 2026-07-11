# PADDLES — codegen prompt

- **Model:** Claude Opus 4.8 (GitHub Copilot CLI)
- **Date:** 2026-07-09
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` &nbsp;→&nbsp; `BRUN PADDLES.PRG 0800`

## Prompt

> Create an original paddle-and-ball tennis game named PADDLES for the 3ric as its
> own codegen project. Text mode, a bordered court with a center net, a human
> paddle versus a ball-tracking CPU paddle, wall/paddle bounces, first-to-seven
> scoring, quit, and a restart-on-space win screen. Build and test it headlessly.

## Result

- **`paddles.s`** — 65C02 source.
- **`paddles.prg`** — assembled raw image (load and run at `$0800`).

Runs on the 40×24 **text** page. A 24-entry row-base table maps `(row,col)` to the
interleaved screen layout. Top and bottom walls bound the court, a dashed net runs
down the middle, and the ball (`O`) carries a `±1` row/column velocity that flips
off the walls and off each paddle (`|`). The CPU paddle steps one row toward the
ball each tick; missing the ball scores for the other side and re-serves from
center. First to seven wins — then **SPACE** restarts and **Q** quits.

## Build & test

```sh
# assemble
node codegen/tools/asm6502.mjs emulator/AICodeGen/paddles/paddles.s emulator/AICodeGen/paddles/paddles.prg --org 0x0800

# headless smoke/behaviour test (render, ball motion, scoring, restart)
node codegen/tools/paddles.test.mjs
```

## Run it

- **Hardware / disk:** `BRUN PADDLES.PRG 0800` — **W/S** or up/down arrows move
  your paddle, **Q** quits.
- **Hosted emulator:** the **Games** dropdown, deep link
  `?prg=programs/paddles.prg&org=0800`, or **Load .PRG…** at address `0800`.
  A **1×–2×** Speed is a comfortable pace.
