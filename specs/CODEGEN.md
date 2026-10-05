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
| `patch-archon.mjs` | Exact-image local WOZ compatibility patcher; see `ROM-SOFTWARE.md`. Contains only adapter code and guarded replacements, never downloads game assets, and refuses input overwrite or fingerprint/sector validation failure. |
| `patch-castle-wolfenstein.mjs` | Exact-image local DOS-order-to-WOZ2 keyboard port; see `ROM-SOFTWARE.md`. Guards disk/ROM fingerprints and byte preimages, preserves other DOS sectors, and creates output exclusively. No game assets are included or downloaded. |
| `wozedit.mjs` | Node-only checked WOZ2 sector reading/editing, reusing the dual-use `wozgen.mjs` CRC and 6-and-2 codec. Preserves non-edited bitstream and metadata bytes. |

**Platform reference (`codegen/platform/`)** — the generator's machine/human contract:
`prompt-system.md` (assembler dialect, entry/exit conventions), `platform-ref.md` +
`platform-ref.json` (memory map, including the `$C030` speaker toggle, soft switches, zero
page, ROM entry points). These are
**generated** from the VM — regenerate after any `vm.h` `MM_*` or ROM-symbol change.

**Assembler dialect:** `$hex` / `%bin` / decimal / char literals; labels; directives
`.org`/`*=`, `.byte`, `.word`, `.res`, `.asciiz`; full 65C02 ISA + addressing modes;
zero-page forcing; branch resolution. A source's own origin directive is authoritative.
`assemble()` returns `listing` records for every emitted source statement. Each record
contains its start PC, emitted bytes, one-based source line, and `instruction`/`data` kind;
the browser debugger uses only instruction records as source-breakpoint targets.

**Validation channels** (a program declares which it uses): serial (`drainOutput()`), text
screen (decode `$0400`, 40×24 interleaved), graphics (`renderFrame()` RGBA), CPU/memory
(final `regA/X/Y`, `status`, `peek`). Halt detection: BRK-to-monitor, WAI, idle loop, timeout.

## Behaviour / Rules

- **TTS v1 submissions:** canonical prompt and guide live in `codegen/challenges/tts/v1/`;
  an entrant owns only `submissions/<id>/` (`tts.s`, `entry.json`, `README.md` and optional
  tests/generators). IDs match `[a-z0-9]+(?:-[a-z0-9]+)*`, at most 60 characters. Metadata
  has schemaVersion 1, challenge `tts-v1`, id, title, author, model, agent, baseline (40-hex
  launch SHA), description, assistance, license, memory and limitations (nonempty strings).
  Metadata describes provenance, not independently verified badges.
  `tts-entry.mjs` validates regular files, metadata and assembly at `$0800`, with the raw
  image ending at or below `$C000`. Fixed callable symbols are `TTS_INIT`, `TTS_SPEAK` and
  `TTS_INPUT` (122 reserved bytes in always-mapped application RAM). Init must be callable
  after image load without entering the UI. Speech takes string pointer low byte A/high
  byte X, preserves the string, returns A=0 complete, A=1 cancelled or A=2 invalid input.
  Reserve `$0300-$031F` for the shared check's caller trampoline. Return with upper ROM
  visible. Banked workspace is allowed, but hardware loading must be documented.
- **TTS checks:** `check-tts.mjs --entry <id>` / `--all` validates and assembles, then
  calls guest routines in the unchanged WASM VM, with bounded emulated execution and
  regular PCM draining. Init/empty/invalid calls have a 2-second emulated deadline;
  speech has 90 seconds, cancellation must return within 1 second of Escape.
  Check repeated public sentences, unchanged strings, empty/space-only/overlength input,
  cancellation and post-call silence. Write raw PRG, PCM-derived WAVs and JSON reports
  under ignored `codegen/out/tts-v1/`, including source hash and Git revision.
  Zero entries is an explicit empty result, not a successful TTS implementation.
  Shared checks never execute entrant-supplied JavaScript. Interactive editing, ROM/SD
  loading, sound-source compliance, intelligibility and physical hardware still need
  separate review; reports must not imply those were automatically established.
  PR jobs have read-only permissions, no secrets/deployment credentials and timeouts.
- **Challenge publication:** `build-challenges.mjs` renders a restricted Markdown subset
  (headings, paragraphs, lists, fences, links, inline code/emphasis; raw HTML escaped).
  The launch revision comes from the first-add commit of the versioned prompt; active
  prompt/guide/metadata cannot silently differ from that commit. Before the initial
  commit only `--preview` permits unresolved-baseline generation. Build production from
  full Git history. Reference links use the resolved SHA, not moving `main`.
- The harness runs the **same `badger6502.js/.wasm`** the browser uses — build it first
  (`pwsh web/build.ps1`). Keep the toolchain **dependency-free** (no npm packages).
- `asm6502.mjs` must stay browser-safe: no static `node:*` imports at module top level, no
  reliance on `process` outside the guarded CLI tail — breaking this breaks the in-browser
  assembler (`WEB-CLIENT.md`).
- `platform-ref.*` is generated, not hand-edited; edit `vm.h`/symbols then regenerate.
- Local WOZ editing must validate container bounds/CRC, address fields, 6-and-2
  checksums and exact preimages before changing data. Re-encode only changed sector
  data fields; do not rebuild a supplied disk into a different track layout. Synthetic
  fixtures must cover malformed input, round trips and unchanged surrounding bits.
- A supplied raw DOS-order image has no bitstream layout to preserve. The Castle
  Wolfenstein patcher changes only its declared byte ranges and then uses
  `wozgen.mjs` to encode all 560 sectors. Tests must decode every sector back to the
  patched DOS-order bytes and reverse the byte patches to the exact original.
  Optional owner-image integration must boot that output, not inject game code into
  emulator memory. Without the private image, report that integration was skipped.
- **AI-contributor path.** The codegen guide is exposed for external AI tools: `web/llms.txt`
  (published at the site root, owned by `WEB-CLIENT.md`) is the machine-readable entry point
  that links `prompt-system.md` + `platform-ref.md`, and `prompt-system.md` closes the loop to
  the gallery (write → test → submit a `gallery.json` entry, per `CONTRIBUTING.md`). Keep
  `llms.txt`'s inline quickstart in sync with `prompt-system.md` when the dialect or entry/exit
  conventions change.

## Data flow

`.s source → asm6502.assemble() → bytes + symbols + source listing metadata → harness loads
into RAM at --org → run → capture serial/text/gfx/regs → checks PASS/FAIL → optional .PRG
(+ manifest)`. The browser additionally maps listing instruction PCs back to source rows for
breakpoints and current-PC highlighting.

## Dependencies

- **Upstream:** the WASM build (`WEB-CLIENT.md`) and the VM memory map/ROM symbols
  (`EMULATOR.md`, `ROM-SOFTWARE.md`).
- **Downstream:** the `.PRG` programs (`ROM-SOFTWARE.md`) and the browser assembler, which
  stages `asm6502.mjs` + sample `.s` sources.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| Versioned TTS brief, entry validation and PCM checks | Implemented | Bounded guest calls, PRG/WAV/reports and positive/negative tooling fixtures; human listening/hardware checks remain separate. |
| `asm6502` assembler + encoding tests | Shipped | dual-use; `asm6502.test.mjs`. |
| Source listing metadata | Shipped | Each emitted record reports PC, bytes, source line, and instruction/data kind for browser debugging; covered by `asm6502.test.mjs`. |
| `harness` + `run6502` validation loop | Shipped | serial/text/gfx/register checks + `.PRG`. |
| `gen_platform_ref` platform reference | Shipped | from `vm.h` + `badger6502.dbg`. |
| Archon local WOZ patching | Experimental / emulator-verified | `patch-archon.test.mjs` covers synthetic editor fixtures and optional owner-supplied-disk gameplay; `patch-archon.test.ps1` covers native PS/2 timing and LED commands. Both game images stay outside the repository. |
| Castle Wolfenstein local disk patching | Experimental / emulator-verified | `patch-castle-wolfenstein.test.mjs` covers guards, exact reversal, all 560 encoded sectors and optional owner-image gameplay; `.test.ps1` covers the native build and physical-path PS/2 input. No game assets or save-persistence claim. |
| Sample programs | Shipped | `codegen/programs/hello.s`; games under `emulator/AICodeGen/`. |
| AI-contributor entry point | Shipped | `web/llms.txt` + `CONTRIBUTING.md`; `prompt-system.md` closes the loop to the gallery. |
