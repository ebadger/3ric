# Copilot Instructions for 3RIC

## Before Starting Any Work

Read these at session start (the `compliance-hooks` extension also injects the start
checklist automatically):

1. `docs/LEARNINGS.md` — **canonical** workflow rules (§1–6) + distilled lessons (the
   always-loaded Tier-1 digest, capped ~2,500 tokens). This is the source of truth for how
   we work; the rules below are a pointer, not a second copy. Full incident narratives live
   in `docs/learnings/` — read on demand.
2. `docs/MISSION.md` — organization purpose and operating principles.
3. `specs/SYSTEM.md` — umbrella overview of the system + links to every sub-spec.
4. `status/SYSTEM-STATUS.md` — runtime env, credentials, scripts, verification commands.

Then read **only the sub-spec(s) for the layer you'll actually touch** — don't load all of
them speculatively. Deep dives (runbooks, changelog) are read on demand, not at start-up.

## How We Work (canonical: docs/LEARNINGS.md §1–6)

- **Specs first, code second.** Update specs before implementing.
- **Trace all layers** a change can touch: Hardware → ROMs → VM core → Hosts (WinUI · Web) → Disk. A memory-map / I/O-register / ROM change must land across every affected layer.
- **Never self-merge.** Always open a PR and give ebadger the link in the chat.
- **Commit atomically** across specs/layers.
- **Check PR state before pushing** (`gh pr view <n> --json state`).
- **Mission clock > org clock.** Don't create net-new org/process artifacts while the
  product has unmet, higher-priority needs — fix the product first. Slimming org machinery
  is always fine; adding it waits. (See `docs/ROLES.md` gates.)
- After implementing, **update the implementation status** in the relevant spec.
- See a better way to work? Add it to `docs/SUGGESTIONS.md`.

## Project Context

- **Stack**: C++17 65C02 VM core — WinUI 3 (C++/WinRT) desktop host, Emscripten/WASM web build, MSVC C++ unit tests; C# ROM-generator tools + Python/PowerShell build scripts; KiCad + 22V10 GAL + Logisim hardware; Raspberry Pi Pico (C/C++) disk
- **Domain**: A 65C02 ("6502-class") Apple-II-style homebrew personal computer — hardware, ROMs/firmware, and cycle-faithful emulators.
- **Layers**: Hardware (KiCad/PCB · 22V10 GAL · Logisim) → ROMs/firmware (monitor + font/video-timing ROMs) → Emulator core (shared C++ VM) → Hosts (WinUI 3 desktop · Emscripten/WASM web) → Disk tooling (WozLib · MockMicroSD · Pi Pico). See `specs/SYSTEM.md`.
- **Dev environment**: Windows + Visual Studio 2022. Emulator: open `emulator/Badger6502VM.sln`, build, and run the **Badger6502VMTest** suite in Test Explorer (or `vstest.console.exe` on the built test DLL). Web: `cd web; .\build.ps1` (needs emsdk) then `.\serve.ps1` → http://localhost:8011.
- **Production**: Not yet deployed. The web emulator is 100% client-side static files, intended to be served from a Raspberry Pi behind a Cloudflare Tunnel (see `specs/WEB.md`).

## Code Style

- **C++17** for the shared VM core, disk libs, and web bridge (`emulator/Badger6502VMLib`, `emulator/WozLib`, `emulator/MockMicroSD`, `web/`); **WinUI 3 (C++/WinRT)** for the desktop host (`emulator/Badger6502VM`); **C#/.NET** for the ROM-generator tools (`romgen/`); **Python/PowerShell** for build/serve scripts (`web/build.ps1`, `web/serve.ps1`). Keep platform-specific code behind `__EMSCRIPTEN__` / `PLATFORM_WEB` guards so the Windows, Pico, and web builds stay in lockstep (see `web/README.md`).
- **Match the surrounding file.** The shared VM/WozLib sources are the contract: a change there must keep the WinUI 3 host, the WASM web build, and the tests behaving identically — that consistency is the critical path (`docs/LEARNINGS.md`).
