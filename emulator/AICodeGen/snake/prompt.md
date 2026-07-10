# SNAKE — codegen prompt

- **Model:** Claude Opus 4.8 (GitHub Copilot CLI)
- **Date:** 2026-07-09
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` &nbsp;→&nbsp; `BRUN SNAKE.PRG 0800`

## Prompt

> Create a Snake game for the 3ric as its own codegen project. Text mode, a
> bordered arena, a growing snake that eats food to score, wall/self collision
> ends the game, arrow/WASD control, and a restart-on-space game-over screen.
> Build and test it headlessly.

## Result

- **`snake.s`** — 65C02 source.
- **`snake.prg`** — assembled raw image (load and run at `$0800`).

Runs on the 40×24 **text** page. A 24-entry row-base table maps `(row,col)` to
the interleaved screen layout; the on-screen glyphs double as the collision map
(a non-blank, non-food destination cell is a crash). The snake body is a 256-entry
ring buffer, food is dropped on a random empty cell by a 16-bit Galois LFSR, and
a pending-direction latch rejects instant 180° reversals. **SPACE** restarts after
a crash; **Q** returns to the monitor.

## Build & test

```sh
# assemble
node codegen/tools/asm6502.mjs emulator/AICodeGen/snake/snake.s emulator/AICodeGen/snake/snake.prg --org 0x0800

# headless smoke/behaviour test (render, motion, wall crash, restart)
node codegen/tools/snake.test.mjs
```

## Run it

- **Hardware / disk:** `BRUN SNAKE.PRG 0800` — arrows or **W/A/S/D** steer, **Q** quits.
- **Hosted emulator:** the **Games** dropdown, deep link `?prg=programs/snake.prg&org=0800`,
  or **Load .PRG…** at address `0800`. A **1×–2×** Speed is a comfortable pace.
