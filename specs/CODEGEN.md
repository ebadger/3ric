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
| `port-ultima5.mjs` | Converts the eight Ultima V ProDOS disk sides into a micro-SD `U5/` folder (`U5.PRG` + one folder per disk, with repacked `SONGnn` music files); see `ROM-SOFTWARE.md`. Uses `ultima5/prodos.mjs` (read-only ProDOS reader), `ultima5/music.mjs` (repacks and losslessly compresses the 128K edition's songs - duration re-encoding, phrase subroutines, a replay check against the original - and derives the player's tables from the user's `MUDR`) and, for tests, `ultima5/fat32.mjs` (builds a sparse FAT32 card for the WASM SD mock; options for larger clusters, fragmented files and FAT entries with the reserved bits set). Game data never enters the repository. |
| `port-sevencities.mjs` | Converts the Seven Cities of Gold program and map disk images into a micro-SD `7CITIES/` folder (`7CITIES.PRG`, `GAME.BIN`, `PROGRAM.DSK`, `MAP.DSK`); see `ROM-SOFTWARE.md`. Reproduces the boot loader's decryption and the game's relocation, applies byte-guarded patches, and refuses an existing output folder. Game data never enters the repository. |
| `port-altreality.mjs` | Converts Alternate Reality: The City (two sides) and/or The Dungeon (three sides) from `.nib` or `.dsk` images (optionally gzipped; a `.nib` side is identified by its volume number) into one micro-SD `AR/` folder: `CITY.PRG`/`DUNGEON.PRG` loaders and the sides as 140 KB DOS-order images, side 1 of each game carrying its SD shim and byte-guarded patches, plus generated empty character disks; see `ROM-SOFTWARE.md`. Refuses an existing output folder. Game data never enters the repository. |
| `port-ultima1.mjs` | Converts the Ultima I ProDOS disk (`/U1`) into a micro-SD `U1/` folder: `U1.PRG` (loader + ProDOS stand-in + SNES pad glue from `codegen/patches/ultima1/`) and every game file under an 8-character key, plus a zero-filled `U1VARS` save (kept if one already exists); see `ROM-SOFTWARE.md`. Reuses `ultima5/prodos.mjs` and, for tests, `ultima5/fat32.mjs`. Game data never enters the repository. |
| `port-ultima2.mjs` | Converts the three Ultima II DOS 3.3 disks (program, player master, galactic) into a micro-SD `U2/` folder (`U2.PRG` + `PROGRAM`/`PLAYER`/`GALACTIC`); see `ROM-SOFTWARE.md`. Uses `ultima2/dos33.mjs` (read-only DOS 3.3 reader) and, for tests, `ultima5/fat32.mjs`. Game data never enters the repository. |
| `port-ultima3.mjs` | Converts the two Ultima III DOS-order disk images into a micro-SD `U3/` folder (`U3.PRG` + the 96 game files); rebuilds side 1's boot memory image, checks the game DOS's SHA-256, reads files top-down from its track/sector table rescales the Mockingboard score's timer and note periods and chains its IRQ behind the SNES gamepad tick; see `ROM-SOFTWARE.md`. Game data never enters the repository. |
| `patch-adventure.mjs` | Exact-image local `.dsk` / `.woz` compatibility patcher for the 1980 A Bit Better Associates *Adventure* disk; see `ROM-SOFTWARE.md`. Relocates 3ric's ROM MSBASIC to Language Card RAM (`$D000-$F0FF`), patches DOS 3.3 + `CHAIN` (`$0208`) + Applesoft hooks, retokenizes both BASIC programs (`ADVENTURE` and `ADVENTURE^Q PART TWO`), and emits a bootable WOZ2 image without bundling copyrighted game assets. |
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
| Ultima V SD-card converter | Experimental / emulator-verified | `port-ultima5.test.mjs` covers the ProDOS reader, the guarded patches (keyboard and 46 music sites), the full shim on the ROM FAT32 routines with synthetic volumes, SNES pads, a synthetic two-region song played end to end, the song packer and the stale-folder check;
 `U5_DISKS` adds an original-disk title boot with the music timer running.
 `port-ultima5.native.ps1` builds the VM with MSVC and checks the resident's PS/2 fast path against real keyboard frames, Caps Lock LED exchanges and a stop-bit strobe collision. |
| Seven Cities of Gold SD-card converter | Experimental / emulator-verified | `port-sevencities.test.mjs` covers the decryption, relocation map and guarded patches, then the real loader/resident/shim copies on synthetic FAT32 cards (512-byte and 4 KB clusters) and the loader's refusals; `SEVENCITIES_DISKS` adds an original-disk title boot. The native PS/2 check runs via `port-ultima5.native.ps1 -Resident`. |
| Alternate Reality SD-card converter | Experimental / emulator-verified | `port-altreality.test.mjs` covers `.nib` decoding (synthetic nibble tracks), side identification, the sector mapping and guarded patches of both games, the character-disk templates, then the real loaders, resident and both shims on synthetic FAT32 cards (512-byte and 4 KB clusters, reserved FAT bits) and the loader's refusals; `AR_DISKS` adds original-disk boots of both games to their menus. `port-altreality.native.ps1` runs the native PS/2 check (`port-ultima5.native.ps1 -Bank2Only`). |
| Ultima I SD-card converter | Experimental / emulator-verified | `port-ultima1.test.mjs` covers the guarded STUPH patches, the generated tree, every ProDOS stand-in call on the ROM DOS with synthetic files and the SNES pad glue; `port-ultima1.native.ps1` (MSVC) clocks real PS/2 frames while the glue scans the pads; `U1_DISK` adds an original-disk play-through (creation, save, continue, quick-save, castle via the pad) with stand-in and pad-glue integrity checks. |
| Ultima II SD-card converter | Experimental / emulator-verified | `port-ultima2.test.mjs` covers the DOS 3.3 reader, the guarded prompt patches and the resident DOS 3.3 translator on the ROM DOS with synthetic disks, including fail-loud errors and the SNES-pad keystroke poller (direct VIA1 clocking, no `$C070` NMIs) against the emulated pads; `U2_DISKS` adds original-disk play through creation, save, overworld and both space disk swaps. |
| Ultima III SD-card converter | Experimental / emulator-verified | `port-ultima3.test.mjs` covers boot-image reconstruction, the file table, top-down reads, the guarded MBS patch, the RWTS shim on the ROM DOS with synthetic files and the SNES gamepad tick; `U3_DISKS` plays the original disks from set-up to a dungeon and an autosave resume. |
| Adventure local DSK/WOZ patching | Experimental / emulator-verified | `patch-adventure.test.mjs` covers synthetic relocation/retokenizer/float-bug fixtures and optional owner-supplied-disk boot, `CHAIN` into `ADVENTURE^Q PART TWO`, hi-res title, above-ground and underground gameplay, `POP`, and ROM ABI mismatch guard. Game images stay outside the repository. |
| Sample programs | Shipped | `codegen/programs/hello.s`; games under `emulator/AICodeGen/`. |
| AI-contributor entry point | Shipped | `web/llms.txt` + `CONTRIBUTING.md`; `prompt-system.md` closes the loop to the gallery. |
