# AICodeGen

AI-generated programs for the 3ric, one directory per project. Each attempt
records the **prompt** that produced it, the **source**, and the assembled
**binary**, so results stay reproducible and reviewable.

## Layout

```
emulator/AICodeGen/<project>/
  prompt.md     the natural-language prompt given to the model (+ a little metadata)
  <name>.s      65C02 assembly source
  <name>.prg    assembled raw image — load/run with BRUN <NAME>.PRG <org>
```

## Build & test

Programs are assembled and exercised with the toolchain in [`codegen/`](../../codegen)
(a JS 65C02 assembler + a headless emulator harness). For example:

```sh
# assemble a project to its .prg
node codegen/tools/asm6502.mjs emulator/AICodeGen/life/life.s emulator/AICodeGen/life/life.prg --org 0x0800
```

Some projects ship a headless cross-check test (e.g. `codegen/tools/life.test.mjs`)
that validates the assembled program against a JS reference. Programs can also be
published to the hosted emulator by copying the `.prg` into
[`web/programs/`](../../web/programs) and deep-linking `?prg=programs/<name>.prg&org=<org>`.

## Try it in the browser (no install)

The hosted emulator (<https://ebadger.github.io/3ric/>) has an **Assemble & Run**
editor that assembles 65C02 source client-side and runs it in the emulator. Each
project here is a built-in sample in that editor's picker, so you can read, tweak,
re-assemble, and run any of them — then **Download .PRG** to `BRUN` on hardware.
Deep-link a specific source with `?src=programs/<name>.s` (it auto-assembles and
runs). The editor uses the very same assembler as the CLI above
(`codegen/tools/asm6502.mjs`), so results match byte-for-byte.

## Projects

| Project | Description | Load addr |
| --- | --- | --- |
| [`life`](life) | Conway's Game of Life — full-screen lo-res colour, toroidal wrap, **SPACE** reseeds. | `$0800` |
| [`jungle`](jungle) | JUNGLE QUEST: THE SUNSTONE RUN — six-screen hi-res action-platformer with buffered/coyote jumps, ducking, raised platforms, boulders/snakes/bats, an active vine release, optional fruit, four temple glyphs, checkpoints, and SNES-pad controls. | `$0800` |
| [`rocks`](rocks) | ROCK STORM — original hi-res vector rock-shooter: a rotate/thrust/inertia ship, shots that split drifting rocks, screen wrap, a thrust flame, hyperspace, escalating waves, score/lives, and attract/game-over screens. | `$0800` |
| [`swarm`](swarm) | STAR SWARM — original hi-res fixed-shooter: a formation of aliens that marches, drops, and speeds up while raining bombs, a bottom cannon that fires up, destructible shields, a bonus saucer, escalating waves, score/lives/high score, and attract/game-over screens. | `$0800` |
| [`snake`](snake) | SNAKE — lo-res colour arcade classic: steer a growing snake around a 40×40 playfield to eat food; hitting a wall or yourself ends the game. Arrows/WASD, **SPACE** restarts. | `$0800` |
| [`blocks`](blocks) | BLOCK DROP — original text-mode falling-block stacker: move, rotate, and soft-drop the seven four-cell shapes to clear full rows. **A/D** move, **W** rotate, **S** drop. | `$0800` |
| [`paddles`](paddles) | PADDLES — original text-mode paddle-and-ball tennis against a ball-tracking CPU; first to seven points wins. **W/S** or arrows. | `$0800` |
| [`bricks`](bricks) | BRICK BUSTER — original text-mode brick-breaker: bounce a ball off your paddle to clear rows of bricks across three lives. **A/D** move. | `$0800` |
| [`2048`](2048) | 2048 — slide and merge numbered tiles on a 4×4 grid to build a 2048 tile. Arrows/WASD; a new tile appears after every move. | `$0800` |
| [`mines`](mines) | MINEFIELD — clear a 16×16 grid without detonating a mine; zeros flood-fill and you can flag suspects. Arrows move, **SPACE** reveals, **F** flags. | `$0800` |
