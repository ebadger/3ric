# Conway's Game of Life — codegen prompt

- **Model:** Claude Opus 4.8 (GitHub Copilot CLI)
- **Date:** 2026-07-09 (lo-res graphics revision 2026-07-10)
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` &nbsp;→&nbsp; `BRUN LIFE.PRG 0800`

## Prompt

> Create Conway's Game of Life running in the high-res mode that resets to a
> random seed when pressing the space bar and then executes the rules of the
> game at full speed. The world should wrap. Build and test it and then show me
> how to run it myself.
>
> Revision: render it in **full-screen lo-res colour graphics** instead of
> hi-res. The 40×48 grid is identical on screen either way, so lo-res gives the
> same scale with a far simpler, colour renderer.

## Result

- **`life.s`** — 65C02 source.
- **`life.prg`** — assembled raw image (load and run at `$0800`).

Renders Life in **full-screen lo-res colour** on a 40×48 **toroidal** cell grid
— one lo-res block per cell (live = green, dead = black), so the world fills the
screen and every edge wraps. Lo-res page 1 shares the text page (`$0400–$07FF`);
each byte packs two stacked cells (low nibble = upper/even row, high nibble =
lower/odd row), so the renderer writes one byte per two grid rows — no hi-res
address tables and no per-scanline blit. A 16-bit Galois LFSR seeds a
pseudo-random field, the B3/S23 rules evolve continuously with a double-buffered
step, and **SPACE** reseeds. Both generation buffers live in free `$4000–$5FFF`
RAM (the lo-res display is at `$0400–$07FF`, so there is no conflict).

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

Validated headlessly (`life.test.mjs`) and in the emulator.
