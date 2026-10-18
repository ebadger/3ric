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
| `tools/msbasic-woz.mjs` | Writes a local WOZ that boots the ROM's Microsoft BASIC into the RAM under `$9000-$BFFF` (see below). |
| `tools/msbasic-prg.mjs` | Writes a local `BASIC.PRG`: the same BASIC started from the DOS shell, with SD-card `LOAD`/`SAVE` (see below). |
| `tools/msbasic-woz.test.ps1` | Native PS/2 + picodisk READY-stall check of that disk (Windows, MSVC). |

## MS-BASIC boot disk

```sh
node codegen/tools/msbasic-woz.mjs codegen/out/basic.woz   # from emulator/Data/badger6502.bin
node codegen/tools/msbasic-woz.mjs codegen/out/basic.woz --rom my-board.bin
```

Insert the disk, enter `MON` if the shell shows `>`, then `C600G`; press Return at
`MEMORY SIZE?`. The disk refuses to load if the machine's upper ROM (`$D000-$FFFF`)
differs from the ROM it was made from. It contains the ROM's third-party Microsoft
BASIC, so keep it local (`codegen/out/` is git-ignored) rather than committing or
sharing it (see `NOTICE`). BASIC appears about a second after loading: the disk waits
out the picodisk's spin-down and resyncs the ROM's PS/2 decoder, which READY stalls
during the boot can misalign. If keys are still garbled, Reset then `MON`/`E000G`
restarts the loaded BASIC. Its prompt is a bare `]`. ROM BASIC shows `"]` because its
message line breaks are mis-assembled; the disk repairs its own copy. Shift+= types `+`,
which the ROM's PS/2 decoder never produces; `PEEK(49152)` still sees `=`. Don't select
BASIC ROM (`$C006`, e.g. `PEEK(49158)`) from disk BASIC or the monitor: key input then
`BRK`s until Reset (then `MON`/`E000G`).
`node codegen/tools/msbasic-woz.test.mjs` verifies it on the WASM build;
`pwsh codegen/tools/msbasic-woz.test.ps1 [-Node <node>]` (Windows, MSVC) types into it
through the ROM's real PS/2 decoder while modelling the picodisk's READY stalls.

## MS-BASIC for 3RIC DOS

```sh
node codegen/tools/msbasic-prg.mjs codegen/out/BASIC.PRG   # ROM + badger6502.dbg from emulator/Data
node codegen/tools/msbasic-prg.mjs codegen/out/BASIC.PRG --rom my-board.bin --dbg my-board.dbg
```

Copy `BASIC.PRG` to the SD card. At the DOS `>` prompt, `CD` to the folder that should
hold your programs, then `BRUN BASIC.PRG 0800` (with `BASIC.PRG` in that folder) and press
Return at `MEMORY SIZE?` (`34047 BYTES FREE`). In BASIC, `SAVE "HELLO.BAS"` writes the
program to that folder, replacing a file of the same name, and `LOAD "HELLO.BAS"` reads it
back; any string expression works (`SAVE A$`). Names are FAT 8.3 and upper-cased. Errors:
`?FILE NOT FOUND ERR`, `?FILE TYPE MISMATCH ERR` (a directory or not a BASIC program),
`?BAD FILE NAME ERR`, `?OUT OF MEMORY ERR`, `?I/O ERR`. Use the shell for `DIR`, `CD` and
`DEL`. Like the disk, the file refuses to start on a ROM other than the one it was built
from and contains Microsoft's BASIC, so keep it local.
`node codegen/tools/msbasic-prg.test.mjs` verifies it on the WASM build.

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
