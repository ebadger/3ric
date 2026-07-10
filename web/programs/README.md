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

The GitHub Pages workflow stages this directory to the site root under
`programs/` (see `.github/workflows/deploy-pages.yml`).
