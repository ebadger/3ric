# 3RIC — System Status

> The **current runtime reality** of the system: how to run it, where it lives, how to
> verify it's healthy. Read at session start. Keep it lean and *current* — stale status is
> worse than no status. Move historical detail to `status/CHANGELOG.md` and deep runbooks to
> `docs/runbooks/`.

_Last updated: 2026-06-26 — ebadger (via Copilot CLI, initial template instantiation)_

---

## Environments

| Environment | Where | URL | Notes |
|-------------|-------|-----|-------|
| Dev — emulator | Windows + Visual Studio 2022 | n/a (desktop app) | `emulator/Badger6502VM.sln` (WinUI 3 / C++/WinRT host) |
| Dev — web | Windows + emsdk + Node | http://localhost:8011/index.html | `web/build.ps1` then `web/serve.ps1` |
| Production | not yet deployed | — | Web build is static files; target is a Raspberry Pi behind a Cloudflare Tunnel (see `specs/WEB.md`) |

## How to run it (dev)

```powershell
# Desktop emulator (WinUI 3 host)
#   open emulator/Badger6502VM.sln in Visual Studio 2022, set Badger6502VM as the
#   startup project, then Build + Run (F5).

# Web (WebAssembly) emulator
cd web
.\build.ps1            # compiles the C++ core + bridge to badger6502.js/.wasm (needs emsdk)
.\serve.ps1            # python -m http.server 8011  ->  http://localhost:8011/index.html

# Regenerate ROMs (font / video timing) — C# tools
#   open the relevant solution under romgen/ and run the generator(s).
```

## How to verify it's healthy

```powershell
# 1) 65C02 core correctness — the critical path.
#    Run the Badger6502VMTest suite (MSVC CppUnitTest, per-opcode) in Visual Studio
#    Test Explorer, or headless:
#    vstest.console.exe <build-output>\Badger6502VMTest.dll
#    Expect: all tests pass.

# 2) Web emulator smoke (headless Node; node ships with emsdk):
$node = "C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe"
& $node web\test_boot.cjs        # ROM boots, sane PC, video RAM written
& $node web\test_render.cjs      # framebuffer has lit pixels
& $node web\test_keyboard.cjs    # monitor echoes typed commands
& $node web\test_screen_text.cjs # decode the text screen to ASCII
& $node web\test_sd.cjs          # mount the SD card + DIR lists the FAT32 root
& $node web\test_disk.cjs        # boot a WOZ floppy via C600G into a hi-res title
# Expect: each script exits 0.
```

## Credentials & secrets (dev only — NEVER commit real secrets)

| What | Where it's configured | Dev value |
|------|----------------------|-----------|
| (none) | — | Single-user hobby project: no backend, no auth, no stored user data, no secrets. |
| emsdk | `C:\Users\ebadger\emsdk` (emsdk 6.0.1) | tool path only — not a secret |
| Node (for web tests) | `C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe` | tool path only — not a secret |

> If production hosting is added later (Cloudflare Tunnel / R2), keep tunnel tokens and
> bucket keys outside the repo (env / secret store). Do not commit secrets.

## Key scripts

| Script | Purpose |
|--------|---------|
| `scripts/dev/install-hooks.sh` | Activate the git `pre-push` guards (run once per clone). |
| `scripts/dev/check-learnings-budget.sh` | Enforce the `docs/LEARNINGS.md` token cap. |
| `scripts/dev/pre-push-tests.sh` | Pre-push test gate: C++ VM unit tests (VSTest, fail-open) + web headless node tests. |
| `web/build.ps1` | Build the WASM emulator (core + WozLib + MockMicroSD + bridge), stage data. |
| `web/serve.ps1` | Serve the web build locally on port 8011. |

## Current state / known gaps

- Desktop (WinUI 3) and web (WASM) emulators both boot the real ROM, render
  text/lo-res/hi-res, take keyboard input, and run the Disk II floppy + micro-SD.
- This clone's `$E000` BASIC is generic Microsoft BASIC, **not** Applesoft, so DOS 3.3 /
  Quick-DOS disks that auto-run an Applesoft greeting load DOS but then trap; self-booting
  machine-code game disks run fine (see `web/README.md`).
- **Not deployed to production yet** — no public URL.
- The operating-system layer (specs/, governance hooks, learnings) was just introduced;
  the sub-specs under `specs/` describe intended contracts and are being filled in from the
  existing implementation.
