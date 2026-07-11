# Hosted programs

Raw `.PRG` images published with the emulator so they can be loaded from the
live site without a file picker:

- **Load .PRG…** button on <https://ebadger.github.io/3ric/>, or
- a deep link: `https://ebadger.github.io/3ric/?prg=programs/hello.prg&org=0800`

Each `.PRG` is a raw memory image (no header); the `org` is the hex load/entry
address, exactly like `BRUN FILE.PRG <org>` on real hardware.

`hello.prg` is the serial "HELLO, 3RIC" demo, built from
[`codegen/programs/hello.s`](../../codegen/programs/hello.s):

```sh
node codegen/tools/run6502.mjs codegen/programs/hello.s --out web/programs/hello.prg
```

`life.prg` is Conway's Game of Life in hi-res on a wrapping (toroidal) world;
press **SPACE** to reseed a random field. Source, prompt, and binary live in
[`emulator/AICodeGen/life/`](../../emulator/AICodeGen/life); deep-link it at
`?prg=programs/life.prg&org=0800` (set **Speed** to **Max** to run it fast):

```sh
node codegen/tools/asm6502.mjs emulator/AICodeGen/life/life.s web/programs/life.prg --org 0x0800
```

`jungle.prg` is **JUNGLE QUEST**, an original hi-res jungle platformer — explore a
four-screen jungle: run and jump across platforms, dodge a rolling log, swing on a
vine over a wide pit, and grab all six gems before the 60-second timer runs out
(**A/D** move and cross between areas, **W/SPACE** jump — jump into a vine to grab
it; **SPACE** starts the game from the title screen and restarts on an end screen).
Source, prompt, and binary live in
[`emulator/AICodeGen/jungle/`](../../emulator/AICodeGen/jungle); deep-link it at
`?prg=programs/jungle.prg&org=0800` (set **Speed** to **1MHz** or **2MHz** for a
playable pace):

```sh
node codegen/tools/asm6502.mjs emulator/AICodeGen/jungle/jungle.s web/programs/jungle.prg --org 0x0800
```

`rocks.prg` is **ROCK STORM**, an original hi-res vector rock-shooter — rotate a
ship, thrust with inertia, and blast drifting rocks that split into smaller,
faster ones; everything wraps at the screen edges. Clear a wave to face a larger
one; a thrust flame trails the engine and **H** triggers a hyperspace panic-jump.
Source, prompt, and binary live in
[`emulator/AICodeGen/rocks/`](../../emulator/AICodeGen/rocks); deep-link it at
`?prg=programs/rocks.prg&org=0800` (set **Speed** to **Max** for full-speed
vectors):

```sh
node codegen/tools/asm6502.mjs emulator/AICodeGen/rocks/rocks.s web/programs/rocks.prg --org 0x0800
```

`swarm.prg` is **STAR SWARM**, an original hi-res fixed-shooter — a five-row
formation of aliens marches side to side, drops down and speeds up as its ranks
thin, and rains bombs while you slide a cannon along the bottom and fire back up
through four crumbling shields; a mystery saucer streaks across the top for bonus
points. Clear the swarm for a faster wave; let it reach the shields (or lose your
last cannon) and it's game over (**A/D** or **arrows** move, **SPACE** fires;
**SPACE** also starts the game from the title screen and restarts after game
over). Source, prompt, and binary live in
[`emulator/AICodeGen/swarm/`](../../emulator/AICodeGen/swarm); deep-link it at
`?prg=programs/swarm.prg&org=0800` (set **Speed** to **Max** for a brisk pace):

```sh
node codegen/tools/asm6502.mjs emulator/AICodeGen/swarm/swarm.s web/programs/swarm.prg --org 0x0800
```

Six **text-mode games** round out the set — each an original take that runs from
the text screen and reads the keyboard. Load any of them with **Load .PRG…** or a
`?prg=programs/<name>.prg&org=0800` deep link (**Speed** **1MHz**–**2MHz** plays
best); source, prompt, and binary live under
[`emulator/AICodeGen/<name>/`](../../emulator/AICodeGen):

- `snake.prg` — **SNAKE**: steer a growing snake to eat food; walls or your own
  tail end the run (arrows/WASD, **SPACE** restarts).
- `blocks.prg` — **BLOCK DROP**: rotate and drop four-cell shapes to clear rows;
  starts gentle and speeds up a level every five lines (**A/D** move, **W** rotate,
  **S** drop).
- `paddles.prg` — **PADDLES**: paddle-and-ball tennis to seven points against a
  ball-tracking CPU (**W/S** or arrows).
- `bricks.prg` — **BRICK BUSTER**: bounce a ball off your paddle to clear bricks
  across three lives (**A/D** move).
- `2048.prg` — **2048**: slide and merge numbered tiles on a 4×4 grid (arrows/WASD).
- `mines.prg` — **MINEFIELD**: clear a 12×12 grid without hitting a mine (arrows
  move, **SPACE** reveals, **F** flags).

Every program here is also a one-click sample in the page's **Assemble & Run**
editor, so you can read, edit, re-assemble, and run any of them in the browser —
or deep-link the source with `?src=programs/<name>.s`.

The GitHub Pages workflow stages this directory to the site root under
`programs/` (see `.github/workflows/deploy-pages.yml`).
