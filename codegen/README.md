# 3ric codegen

Tools for generating 65C02 programs for the **3ric** computer, testing them
headlessly on the project's WebAssembly emulator, and producing a card-ready
`.PRG` you can `BRUN` on real hardware or load in the hosted emulator.

- **[`SPEC.md`](./SPEC.md)** — the design of record (mechanism, `.PRG` format,
  emulator API, validation strategy).
- **[`platform/prompt-system.md`](./platform/prompt-system.md)** — the guide the
  code generator follows: assembler dialect, entry/exit conventions, the loop.
- **[`platform/platform-ref.md`](./platform/platform-ref.md)** — memory map,
  soft switches, zero page, and ROM entry points (generated from the ROM's own
  symbols). Machine-readable copy: `platform/platform-ref.json`.

## Quick start

```sh
# 0. Build the emulator once (produces web/badger6502.js + web/data/).
pwsh web/build.ps1

# 1. Assemble + run + check a program; write the card-ready .PRG.
node codegen/tools/run6502.mjs codegen/programs/hello.s \
    --out codegen/programs/hello.prg \
    --expect-serial "HELLO, 3RIC" --expect-halt brk-monitor
```

`run6502.mjs` prints the captured serial output, the decoded 40×24 text screen,
the final registers, the halt reason, and each check's PASS/FAIL. Exit code is 0
only when the program halted cleanly and every check passed.

## Using the program

- **On hardware / SD card:** copy the `.PRG` to the micro-SD card and run
  `BRUN HELLO.PRG 0800` (the number is the hex load/entry address).
- **In the hosted emulator:** <https://ebadger.github.io/3ric/> → **Load .PRG…**,
  enter the address, pick the file. Or deep-link a hosted program:
  `https://ebadger.github.io/3ric/?prg=programs/hello.prg&org=0800`.

## Tools

| File | Purpose |
| --- | --- |
| `tools/asm6502.mjs` | Dependency-free two-pass 65C02 assembler (`assemble()` + CLI). |
| `tools/asm6502.test.mjs` | Encoding tests for the assembler (`node asm6502.test.mjs`). |
| `tools/harness.cjs` | Boots the WASM emulator, loads a program, runs it, captures serial/text/registers, detects halt. |
| `tools/run6502.mjs` | CLI: assemble/load → run → apply checks → emit `.PRG` + verdict. |
| `tools/gen_platform_ref.mjs` | Regenerates `platform/platform-ref.{md,json}` from `vm.h` + `badger6502.dbg`. |

## Layout

```
codegen/
  SPEC.md
  README.md
  platform/
    prompt-system.md      # generator guide
    platform-ref.md       # generated reference (human)
    platform-ref.json     # generated reference (machine)
  programs/
    hello.s               # demo source (tracked)
    *.prg                 # assembled images (git-ignored; regenerate)
  tools/
    asm6502.mjs  asm6502.test.mjs  harness.cjs  run6502.mjs  gen_platform_ref.mjs
```
