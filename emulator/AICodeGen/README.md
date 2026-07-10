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

## Projects

| Project | Description | Load addr |
| --- | --- | --- |
| [`life`](life) | Conway's Game of Life — hi-res, toroidal wrap, **SPACE** reseeds. | `$0800` |
| [`jungle`](jungle) | JUNGLE QUEST — original hi-res jungle platformer: a four-screen world with run/jump physics, a rolling-log hazard, a swinging vine, six gems, a countdown timer, and a title screen. | `$0800` |
| [`rocks`](rocks) | ROCK STORM — original hi-res vector rock-shooter: a rotate/thrust/inertia ship, shots that split drifting rocks, screen wrap, a thrust flame, hyperspace, escalating waves, score/lives, and attract/game-over screens. | `$0800` |
| [`swarm`](swarm) | STAR SWARM — original hi-res fixed-shooter: a formation of aliens that marches, drops, and speeds up while raining bombs, a bottom cannon that fires up, destructible shields, a bonus saucer, escalating waves, score/lives/high score, and attract/game-over screens. | `$0800` |
