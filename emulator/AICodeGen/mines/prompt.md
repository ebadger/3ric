# MINEFIELD — codegen prompt

- **Model:** Claude Opus 4.8 (GitHub Copilot CLI)
- **Date:** 2026-07-09
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` &nbsp;→&nbsp; `BRUN MINES.PRG 0800`

## Prompt

> Create a Minesweeper-style game named MINEFIELD for the 3ric as its own
> codegen project. Text mode, a 12×12 grid, random mine placement, flagging,
> flood reveal for empty regions, win/loss banners, SPACE restart, Q quit, and
> deterministic BRK hooks for headless logic tests.

## Result

- **`mines.s`** — 65C02 source.
- **`mines.prg`** — assembled raw image (load and run at `$0800`).

Runs on the 40×24 **text** page. A 24-entry row-base table maps `(row,col)` to
the interleaved screen layout. The game keeps separate exposed RAM arrays:
`MINE` at `$2000`, `STATE` at `$2100`, and `COUNT` at `$2200`, each 256 bytes
for the 16×16 field. `count_hook` recomputes `COUNT[]` for tests, and
`flood_hook` flood-reveals from `START_R`/`START_C` at `$2500`/`$2501`.

> **Update (enlarged board):** the field was grown from the original 12×12 to a
> **16×16** grid (256 cells, 40 mines — the classic Minesweeper "intermediate"
> board) so it fills more of the text screen. 16×16 is the largest grid the
> single-byte cell index (`ROWOFF[row]+col`, max 255) can address, so the loops
> that scan all cells now terminate on the `inx` wrap at 256 instead of `cpx`.

## Build & test

```sh
# assemble
node codegen/tools/asm6502.mjs emulator/AICodeGen/mines/mines.s emulator/AICodeGen/mines/mines.prg --org 0x0800

# headless smoke/logic test (render, counts, flood reveal)
node codegen/tools/mines.test.mjs
```

## Run it

- **Hardware / disk:** `BRUN MINES.PRG 0800` — arrows or **W/A/S/D** move,
  **SPACE/RETURN** reveal, **F** toggles flags, **Q** quits.
- **Hosted emulator:** the **Games** dropdown, deep link
  `?prg=programs/mines.prg&org=0800`, or **Load .PRG…** at address `0800`.
