# 3ric code-generation guide

This is the operating guide for generating 65C02 programs for the **3ric**
computer, testing them headlessly on the project emulator, and producing a
card-ready `.PRG` you can `BRUN` on real hardware.

Read [`platform-ref.md`](./platform-ref.md) first — it lists the memory map,
soft switches, zero-page locations, and ROM entry points (all generated from
the ROM's own symbol table, so the addresses are authoritative).

## The loop

1. **Write** a `.s` source file under `codegen/programs/` (assembler dialect below).
2. **Run** it and assert what success looks like:
   ```
   node codegen/tools/run6502.mjs codegen/programs/NAME.s \
       --out codegen/programs/NAME.prg \
       --expect-serial "EXPECTED TEXT" --expect-halt brk-monitor
   ```
3. **Read the verdict.** `run6502.mjs` prints the captured serial output, the
   decoded 40×24 text screen, final registers, the halt reason, and each
   check's PASS/FAIL. Exit code is 0 only when the program halted cleanly and
   every check passed.
4. **Iterate** until it passes, then hand over `NAME.prg` (+ the entry address).

## Entry & exit conventions

- A `.PRG` is a **raw memory image, no header**. `BRUN FILE.PRG <addr>` loads
  the bytes at `<addr>` and `JMP`s to `<addr>`. **Load address == entry point.**
- Start your source with `.org <addr>` at that same address. `$0800` and
  `$6000` are convenient free RAM. The runner defaults the entry to the `.org`.
- **End with `BRK`** to return to the monitor `*` prompt. The harness treats the
  monitor's register dump as the "program finished" sentinel. Do **not** `RTS`
  from the top level unless you have set up the stack yourself.
- To print text, call `COUT` ($FDED) with ASCII **high bit set** (`'A' → $C1`);
  `$8D` is carriage return. `COUT` output is echoed to the serial port and
  captured by the harness. You can also `STA $C100` to emit a raw serial byte.

## Assembler dialect (`codegen/tools/asm6502.mjs`)

Two-pass 65C02 assembler. Instruction sizes are frozen in pass 1, so labels are
absolute by default; force with `z:`/`a:` prefixes.

- **Labels:** `name:` (colon optional at column 0). **Equates:** `NAME = expr`.
- **Set location:** `.org expr` or `*= expr`.
- **Data:** `.byte`/`.db` (bytes & `"strings"`), `.word`/`.dw` (little-endian),
  `.res n[,fill]`, `.asciiz "..."` (NUL-terminated), `.text`/`.asc` (= `.byte`).
- **Numbers:** `$hex`, `%binary`, decimal, `'c'` char. **Operators:** `+ -`,
  `<expr` (low byte), `>expr` (high byte), `*` (current PC), `label±N`.
- **Addressing:** immediate `#`, zp/abs auto-selected (prefix `z:`/`a:` to force),
  `,x` / `,y`, `(zp)`, `(zp,x)`, `(zp),y`, `(abs)` and `(abs,x)` for `JMP`,
  accumulator (`asl`, `asl a`). 65C02 extras: `BRA`, `STZ`, `PHX/PHY/PLX/PLY`,
  `INC A`/`DEC A`, `TRB`, `TSB`, `WAI`, `STP`.

Example (`codegen/programs/hello.s`):

```asm
        .org $0800
COUT    = $FDED
        ldx #0
print:  lda msg,x
        beq done
        jsr COUT
        inx
        bne print
done:   brk
msg:    .byte $C8,$C5,$CC,$CC,$CF,$8D,$00   ; "HELLO\r", high bit set
```

## `run6502.mjs` checks

| Flag | Asserts |
| --- | --- |
| `--expect-halt R` | halt reason is `brk-monitor` / `wai` / `idle` / `timeout` |
| `--expect-serial S` | serial output contains substring `S` (repeatable) |
| `--expect-serial-re RE` | serial matches JS regex `RE` (repeatable) |
| `--expect-mem A=V` | byte at address `A` equals `V` (hex ok, repeatable) |
| `--expect-a/-x/-y V` | final register equals `V` |
| `--out FILE.prg` | write the assembled raw image |
| `--org 0xADDR` | override/supply the load+entry address |
| `--sd FILE.sparse` | mount a FAT32 SD image while running |
| `--json` | emit a machine-readable verdict |

You can also feed a prebuilt raw image: `run6502.mjs game.prg --org 0x6000 …`.

## Halt reasons

- `brk-monitor` — `BRK` (or a return to the monitor) printed the register dump.
  This is the normal "done" signal.
- `wai` — the CPU executed `WAI`/`STP`.
- `idle` — the PC stopped moving with no serial output (an infinite loop; often
  a deliberate `here: bra here` end-state — still a clean stop).
- `timeout` — the cycle budget ran out (default 20M; raise with `--max-cycles`).

## Regenerating the platform reference

If the ROM or `vm.h` changes, refresh the reference:

```
node codegen/tools/gen_platform_ref.mjs
```

## Prerequisite: build the emulator once

The harness loads the project's WebAssembly build. If `web/badger6502.js` or
`web/data/` is missing, build it first (see `codegen/SPEC.md`):

```
pwsh web/build.ps1
```
