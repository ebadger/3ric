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
| `tools/patch-karateka.mjs` | Adds an original Mockingboard gameplay score to one exact owner-supplied Karateka DSK; creates a separate local DSK or WOZ. |

## Local Karateka soundtrack patch

This patch targets **3ric's slot-4 Mockingboard**, not an unmodified Apple II.
It accepts only the 143,360-byte DOS-order image with SHA-256
`4399db1c5469299f6a519abd890456ba1bbba70596d72096f1db4a84e5669370`.
The original six-voice, 16-bar **Cliffside Resolve** score is in
[`patches/karateka-music.s`](./patches/karateka-music.s). No game image, game
source, or transcription of Karateka's original music is distributed here.

Run from the repository root, substituting your own local paths:

```powershell
node codegen\tools\patch-karateka.mjs "C:\Games\Karateka.dsk" "C:\Games\Karateka-Mockingboard-3ric.woz"
node codegen\tools\patch-karateka.mjs "C:\Games\Karateka.dsk" "C:\Games\Karateka-Mockingboard-3ric.dsk"
```

Both commands refuse an existing output file, input overwrite, or another disk
revision. Keep both game images local; do not add them to Git or the gallery.
Choose **Insert .woz...** in the browser emulator to boot the WOZ, run at **1x**,
and click the emulator to enable audio. Space starts a game from attract mode;
**K** selects keyboard controls, arrows move, Space changes stance, and Q/A/Z
and W/S/X perform high/middle/low attacks. **Escape** pauses until another key;
**Control-S** cycles music and effects / effects only / all off. **Control-R**
retains the game's restart behavior.

The score uses actual AY registers, not browser audio playback. It advances on a
polled timer during rendering, with its clock suspended across blocking speaker
effects so their pitch/timing is unchanged. Original musical cues, pauses, loads
and restarts silence the added score. A loop is approximately 40 seconds of
rendering time. The hardware map and emulator are unchanged.

After `pwsh web\build.ps1`, run the player checks without a game, or include your
disk for actual boot, gameplay, controls and speaker comparisons:

```powershell
node codegen\tools\patch-karateka.test.mjs
node codegen\tools\patch-karateka.test.mjs --disk "C:\Games\Karateka.dsk"
```

`--capture-dir <directory>` additionally writes a stereo WAV captured from the
game's real mixed PCM. Automated coverage is not a complete playthrough or
physical-board certification; the shared-routine copies for later disk segments
are patched and checked, but later-level gameplay still needs a playthrough.

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
