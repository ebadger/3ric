# Conway's Game of Life — codegen prompt

- **Model:** Claude Opus 4.8 (GitHub Copilot CLI)
- **Date:** 2026-07-09
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` &nbsp;→&nbsp; `BRUN LIFE.PRG 0800`

## Prompt

> Create Conway's Game of Life running in the high-res mode that resets to a
> random seed when pressing the space bar and then executes the rules of the
> game at full speed. The world should wrap. Build and test it and then show me
> how to run it myself.

## Result

- **`life.s`** — 65C02 source.
- **`life.prg`** — assembled raw image (load and run at `$0800`).

Renders Life in hi-res (280×192) on a 40×48 **toroidal** cell grid — each cell
is one hi-res byte wide × 4 scanlines tall, so the world fills the screen and
every edge wraps. A 16-bit Galois LFSR seeds a pseudo-random field, the B3/S23
rules evolve continuously with a double-buffered step, and **SPACE** reseeds.
Both generation buffers live in the free `$4000–$5FFF` hi-res page-2 RAM.

## Build & test

```sh
# assemble
node codegen/tools/asm6502.mjs emulator/AICodeGen/life/life.s emulator/AICodeGen/life/life.prg --org 0x0800

# headless cross-check vs a JS reference Life (rules, wrap, glider, reseed)
node codegen/tools/life.test.mjs
```

## Run it

- **Hardware / disk:** `BRUN LIFE.PRG 0800` — press **SPACE** to reseed.
- **Hosted emulator:** deep link `?prg=programs/life.prg&org=0800` (set **Speed**
  to **Max**), or the **Load .PRG…** button at address `0800`.

Validated on real hardware and in the emulator.
