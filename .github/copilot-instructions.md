# Copilot Instructions for 3ric

## Before Starting Any Work

Read these at session start (the `compliance-hooks` extension also injects the start
checklist automatically):

1. `docs/LEARNINGS.md` — **canonical** workflow rules (§1–6) + distilled lessons (the
   always-loaded Tier-1 digest, capped ~2,500 tokens). This is the source of truth for how
   we work; the rules below are a pointer, not a second copy. Full narratives live in
   `docs/learnings/` — read on demand.
2. `docs/MISSION.md` — why 3ric exists and how we operate.
3. `specs/SYSTEM.md` — umbrella overview of the machine + links to every layer sub-spec.
4. `status/SYSTEM-STATUS.md` — how to build, run, and verify the emulator and browser build.

Then read **only the sub-spec(s) for the layer you'll actually touch** (see `specs/`) —
don't load all of them speculatively. Deep dives (the codegen SPEC/prompt system, hardware
sheets) are read on demand, not at start-up.

## How We Work (canonical: docs/LEARNINGS.md §1–6)

- **Specs first, code second.** Update the layer's spec in `specs/` before implementing.
- **Trace all layers** for any change to a shared contract. 3ric's layer chain is:
  **6502 ROM/software → Emulator VM core (C++) → Web bridge / WASM client**, with the
  **codegen platform-ref** and the **22V10 GAL address decode** mirroring the VM memory map.
  The memory map, soft switches, and ROM entry points are **cross-layer contracts** —
  change one, verify them all.
- **Native and WASM must stay behavior-identical.** Shared VM/WozLib/SD sources may only
  diverge behind `__EMSCRIPTEN__` / `PLATFORM_WEB` guards; verify both the Windows build
  and `web/build.ps1` + `web/test_boot.cjs` before calling a core change done.
- **Never self-merge.** Always open a PR and give ebadger the link in the chat.
- **Commit atomically** across a spec and the code that implements it.
- **Check PR state before pushing** (`gh pr view <n> --json state`).
- **Mission clock > org clock.** Don't create net-new org/process machinery while the
  machine has unmet, higher-priority needs — fix the product first. Slimming machinery is
  always fine; adding it waits. (See `docs/ROLES.md` gates.)
- After implementing, **update the Implementation Status** in the relevant sub-spec.
- See a better way to work? Add it to `docs/SUGGESTIONS.md`.

## Project Context

- **Stack**: C++17 VM core → Emscripten/WebAssembly browser build; Node.js ESM tooling
  (65C02 assembler + headless emulator harness); 6502 assembly ROM/software; KiCad + 22V10
  GAL hardware.
- **What it is**: 3ric is a from-scratch Apple-II-class 65C02 personal computer — real
  hardware plus a cycle-honest emulator that also compiles to WebAssembly so the machine
  runs in any browser with no install.
- **Layers** (see `specs/SYSTEM.md` for the map and each sub-spec):
  - **Emulator core** (`emulator/Badger6502VMLib`, `WozLib`, `MockMicroSD`) — the 65C02 VM,
    video/keyboard/ACIA/VIA, Disk II floppy, bit-banged SPI micro-SD. Built with Visual
    Studio 2022 (`emulator/Badger6502VM.sln`); unit-tested by `Badger6502VMTest` (MSTest).
  - **Web / WASM client** (`web/`) — `web_bridge.cpp` (embind) + `index.html` canvas UI +
    in-browser assembler; built by `web/build.ps1` (Emscripten 6.0.1) → `badger6502.js/.wasm`.
  - **Codegen tooling** (`codegen/`) — `asm6502.mjs` (65C02 assembler, dual-use Node+browser),
    `run6502.mjs` / `harness.cjs` (headless test harness), `gen_platform_ref.mjs`.
  - **ROM & software** — `emulator/Data/badger6502.bin` (512KB ROM: monitor, DOS shell,
    Microsoft BASIC), `fontrom.dat`, and `.s` / `.prg` 6502 programs (`emulator/AICodeGen/`,
    `codegen/programs/`).
  - **Hardware** (`kicad/`, `22v10/`, `logisim/`, `diylayout/`) — schematics, PCB, GAL
    address decode, and digital-logic models.
- **Dev environment**: Windows + Visual Studio 2022 for the native emulator; emsdk 6.0.1
  (`C:\Users\ebadger\emsdk`) + Node (bundled in emsdk) + Python 3 for the WASM build/tests.
  See `status/SYSTEM-STATUS.md` for the exact commands.
- **Production**: GitHub Pages — <https://ebadger.github.io/3ric/> — published by
  `.github/workflows/deploy-pages.yml` on push to `main` that touches emulator sources.
  100% client-side; no server, no secrets.

## Code Style

- **C++ (VM core)**: C++17, MSVC conventions. Keep the core portable — put platform code
  behind `__EMSCRIPTEN__` / `PLATFORM_WEB` guards; never fork behavior silently (see
  `web/README.md`). Windows-only files (`symbols.cpp`, `Disassemble.cpp`) stay out of the
  WASM build. Match the existing style in `emulator/Badger6502VMLib/vm.cpp` and `cpu.cpp`.
- **6502 assembly**: target the project's own `asm6502.mjs` dialect — see
  `codegen/platform/prompt-system.md` (assembler dialect, entry/exit conventions, ROM
  routines) and `codegen/platform/platform-ref.md` (memory map, soft switches, ROM entry
  points). A source's own `.org` / `*=` is authoritative.
- **JavaScript (codegen/web)**: dependency-free Node ESM (`.mjs`) / CommonJS (`.cjs`).
  `asm6502.mjs` must stay **dual-use** (Node CLI **and** browser ES module) — keep the
  `process`/node guards and the dynamic `node:url` import intact.
- **The memory map is generated context**: after changing `vm.h`'s `MM_*` map or the ROM
  symbols, regenerate the platform reference —
  `node codegen/tools/gen_platform_ref.mjs` — so `codegen/platform/platform-ref.*` stays true.
