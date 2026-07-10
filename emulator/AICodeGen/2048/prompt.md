# 2048 — codegen prompt

- **Model:** Claude Opus 4.8 (GitHub Copilot CLI)
- **Date:** 2026-07-09
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` &nbsp;→&nbsp; `BRUN 2048.PRG 0800`

## Prompt

> Create a 2048 game for the 3ric as its own codegen project. Text mode, a
> 4×4 grid, standard slide/merge mechanics, score display, random tile spawning,
> arrow/WASD control, Q to quit, and restart-on-space after game over. Include a
> deterministic BRK hook for headless tests.

## Result

- **`2048.s`** — 65C02 source.
- **`2048.prg`** — assembled raw image (load and run at `$0800`).

Runs on the 40×24 **text** page. A 24-entry row-base table maps `(row,col)` to
the interleaved screen layout. The 4×4 board lives at fixed RAM label `board`
(`$1A00`) as tile exponents (`0` empty, `1` = 2, `2` = 4, ...). The `dir` label
(`$1A10`) selects deterministic moves (`0` left, `1` right, `2` up, `3` down),
and `score` (`$1A11`) is a 16-bit little-endian score. The `do_move` hook slides
and merges once without spawning, updates score, then executes `BRK`.

## Build & test

```sh
# assemble
node codegen/tools/asm6502.mjs emulator/AICodeGen/2048/2048.s emulator/AICodeGen/2048/2048.prg --org 0x0800

# headless smoke/behaviour test (render + deterministic move hook)
node codegen/tools/2048.test.mjs
```

## Run it

- **Hardware / disk:** `BRUN 2048.PRG 0800` — arrows or **W/A/S/D** move, **Q** quits.
- **Hosted emulator:** the **Games** dropdown, deep link
  `?prg=programs/2048.prg&org=0800`, or **Load .PRG…** at address `0800`.
