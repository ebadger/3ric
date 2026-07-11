# 3ric — Codegen Tooling Spec (CODEGEN.md)

> The Node.js toolchain that assembles 65C02 programs for 3ric, validates them headlessly on
> the WASM emulator, and emits a card-ready `.PRG`. The design of record lives in
> [`codegen/SPEC.md`](../codegen/SPEC.md); this sub-spec is the layer summary + its
> cross-layer contracts. Read `codegen/SPEC.md` before changing the toolchain.

---

## Purpose

Give a program author (human or AI) a fast, deterministic loop: write 65C02 source →
assemble → run on the same emulator the browser uses → assert on serial / text screen /
graphics / registers → produce a `.PRG` that also `BRUN`s on real hardware.

## Contracts / Interfaces

**Tools (`codegen/tools/`):**

| Tool | Role |
|------|------|
| `asm6502.mjs` | Dependency-free two-pass 65C02 assembler (`assemble()` + CLI). **Dual-use:** the exact same file is a Node CLI *and* a browser ES module (the web assembler imports it) — the CLI tail is guarded by a `process`/node check and its `node:url` import is dynamic. |
| `asm6502.test.mjs` | Assembler encoding tests (`node asm6502.test.mjs`) — the fast, no-build gate wired into `pre-push`. |
| `harness.cjs` | Boots the WASM emulator, loads a program, runs it, captures serial/text/registers, detects halt. |
| `run6502.mjs` | CLI: assemble/load → run → apply checks → emit `.PRG` + verdict (exit 0 only if it halted cleanly and every check passed). |
| `gen_platform_ref.mjs` | Regenerates `platform/platform-ref.{md,json}` from `vm.h` + `badger6502.dbg`. |

**Platform reference (`codegen/platform/`)** — the generator's machine/human contract:
`prompt-system.md` (assembler dialect, entry/exit conventions), `platform-ref.md` +
`platform-ref.json` (memory map, soft switches, zero page, ROM entry points). These are
**generated** from the VM — regenerate after any `vm.h` `MM_*` or ROM-symbol change.

**Assembler dialect:** `$hex` / `%bin` / decimal / char literals; labels; directives
`.org`/`*=`, `.byte`, `.word`, `.res`, `.asciiz`; full 65C02 ISA + addressing modes;
zero-page forcing; branch resolution. A source's own origin directive is authoritative.

**Validation channels** (a program declares which it uses): serial (`drainOutput()`), text
screen (decode `$0400`, 40×24 interleaved), graphics (`renderFrame()` RGBA), CPU/memory
(final `regA/X/Y`, `status`, `peek`). Halt detection: BRK-to-monitor, WAI, idle loop, timeout.

## Behaviour / Rules

- The harness runs the **same `badger6502.js/.wasm`** the browser uses — build it first
  (`pwsh web/build.ps1`). Keep the toolchain **dependency-free** (no npm packages).
- `asm6502.mjs` must stay browser-safe: no static `node:*` imports at module top level, no
  reliance on `process` outside the guarded CLI tail — breaking this breaks the in-browser
  assembler (`WEB-CLIENT.md`).
- `platform-ref.*` is generated, not hand-edited; edit `vm.h`/symbols then regenerate.
- **AI-contributor path.** The codegen guide is exposed for external AI tools: `web/llms.txt`
  (published at the site root, owned by `WEB-CLIENT.md`) is the machine-readable entry point
  that links `prompt-system.md` + `platform-ref.md`, and `prompt-system.md` closes the loop to
  the gallery (write → test → submit a `gallery.json` entry, per `CONTRIBUTING.md`). Keep
  `llms.txt`'s inline quickstart in sync with `prompt-system.md` when the dialect or entry/exit
  conventions change.

## Data flow

`.s source → asm6502.assemble() → bytes + symbols → harness loads into RAM at --org → run →
capture serial/text/gfx/regs → checks PASS/FAIL → optional .PRG (+ manifest)`.

## Dependencies

- **Upstream:** the WASM build (`WEB-CLIENT.md`) and the VM memory map/ROM symbols
  (`EMULATOR.md`, `ROM-SOFTWARE.md`).
- **Downstream:** the `.PRG` programs (`ROM-SOFTWARE.md`) and the browser assembler, which
  stages `asm6502.mjs` + sample `.s` sources.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| `asm6502` assembler + encoding tests | Shipped | dual-use; `asm6502.test.mjs`. |
| `harness` + `run6502` validation loop | Shipped | serial/text/gfx/register checks + `.PRG`. |
| `gen_platform_ref` platform reference | Shipped | from `vm.h` + `badger6502.dbg`. |
| Sample programs | Shipped | `codegen/programs/hello.s`; games under `emulator/AICodeGen/`. |
| AI-contributor entry point | Shipped | `web/llms.txt` + `CONTRIBUTING.md`; `prompt-system.md` closes the loop to the gallery. |
