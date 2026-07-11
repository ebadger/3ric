# SNAKE — codegen prompt

- **Model:** Claude Opus 4.8 (GitHub Copilot CLI)
- **Date:** 2026-07-09 (lo-res graphics revision 2026-07-10)
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` &nbsp;→&nbsp; `BRUN SNAKE.PRG 0800`

## Prompt

> Create a Snake game for the 3ric as its own codegen project. A bordered arena,
> a growing snake that eats food to score, wall/self collision ends the game,
> arrow/WASD control, and a restart-on-space game-over screen. Build and test it
> headlessly.
>
> Revision: render it in **lo-res colour graphics** instead of the text page.

## Result

- **`snake.s`** — 65C02 source.
- **`snake.prg`** — assembled raw image (load and run at `$0800`).

Renders in **mixed lo-res**: a 40×40 colour playfield (each cell an 8×8 block)
above four text HUD rows (screen rows 20–23) that carry the score/status line and
the game-over banner. Lo-res page 1 shares the text page ($0400–$07FF) — each byte
packs two stacked pixels (low nibble = upper/even row, high nibble = lower/odd
row), so a lo-res row R maps to text row R/2. The playfield doubles as the
collision map (a non-black, non-food destination cell is a crash). The snake body
is a 256-entry ring buffer, food is dropped on a random empty cell by a 16-bit
Galois LFSR, and a pending-direction latch rejects instant 180° reversals.
Colours: grey border, green snake, yellow food. **SPACE** restarts after a crash;
**Q** returns to the monitor.

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
