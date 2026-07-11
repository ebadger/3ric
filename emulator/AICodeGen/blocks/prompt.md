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
a 16-bit Galois LFSR picks the next shape. Gravity is **level-based**: a 16-bit
countdown of keyboard-poll iterations per row is reloaded from a per-level pace
table, so the fall starts gentle (**≈0.80 s/row** at level 1) and speeds up one
step every five cleared lines down to **≈0.09 s/row** at level 15. The current
level shows as `LVL:nn` on the status row. **SPACE** restarts after a top-out;
**Q** returns to the monitor.

## Follow-up — level-based speed curve

> The fall was uniformly too fast (a fixed 8-bit `ldx #PACE` counter capped the
> gravity period at ~0.06 s/row). Replace it with a 16-bit gravity countdown
> reloaded from a per-level pace table so the game starts slow and gets
> progressively faster at each level, and show the level on the status line.

Level rises with lines cleared (`LINES_PER_LEVEL = 5`, capped at 15). `PACE_TBL`
holds the iterations-per-row for levels 1–15; the speeds were calibrated against
the emulator's ~1.02 MHz clock and verified headlessly (see test section **E**).

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
  A **1×–2×** Speed is a comfortable pace.
