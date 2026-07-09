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
press **SPACE** to reseed a random field. Built from
[`codegen/programs/life.s`](../../codegen/programs/life.s) and deep-linkable at
`?prg=programs/life.prg&org=0800` (set **Speed** to **Max** to run it fast):

```sh
node codegen/tools/asm6502.mjs codegen/programs/life.s web/programs/life.prg --org 0x0800
```

The GitHub Pages workflow stages this directory to the site root under
`programs/` (see `.github/workflows/deploy-pages.yml`).
