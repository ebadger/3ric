# BLOCK DROP — codegen prompt

- **Model:** Claude Opus 4.8 (GitHub Copilot CLI)
- **Date:** 2026-07-09
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` &nbsp;→&nbsp; `BRUN BLOCKS.PRG 0800`

## Prompt

> Create an original falling-block stacker named BLOCK DROP for the 3ric as its
> own codegen project. Text mode, a 10×20 well, the seven four-cell shapes, with
> move, rotate, soft-drop, line clears, scoring, quit, and a restart-on-space
> game-over screen. Build and test it headlessly.

## Result

- **`blocks.s`** — 65C02 source.
- **`blocks.prg`** — assembled raw image (load and run at `$0800`).

Runs on the 40×24 **text** page. A 24-entry row-base table maps `(row,col)` to the
interleaved screen layout. The well is kept separately as a 10×20 byte model:
settled cells render as `#` and the active falling piece as `@`. The seven shapes
and their rotations are precomputed as four `(dRow,dCol)` cell offsets each (the
assembler has no multiply), full rows shift the model down and bump the score, and
a 16-bit Galois LFSR picks the next shape. Gravity is paced by a 16-bit counter
(`GRAV`) tuned for the emulator's native **1.57 MHz** clock (~0.8 s per cell, a
classic level-0 pace). **SPACE** restarts after a top-out; **Q** returns to the
monitor.

## Build & test

```sh
# assemble
node codegen/tools/asm6502.mjs emulator/AICodeGen/blocks/blocks.s emulator/AICodeGen/blocks/blocks.prg --org 0x0800

# headless smoke/behaviour test (render, gravity, locking, line-clear hook)
node codegen/tools/blocks.test.mjs
```

## Run it

- **Hardware / disk:** `BRUN BLOCKS.PRG 0800` — **A/D** move, **W** rotate,
  **S** soft-drop, **Q** quits.
- **Hosted emulator:** the **Games** dropdown, deep link
  `?prg=programs/blocks.prg&org=0800`, or **Load .PRG…** at address `0800`.
  The gravity is tuned for the native **1×** (≈1.57 MHz) Speed setting.
