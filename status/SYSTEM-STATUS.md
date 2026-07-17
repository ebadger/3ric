# 3ric — System Status

> The **current runtime reality** of the system: how to build it, run it, and verify it's
> healthy. Read at session start. Keep it lean and *current* — stale status is worse than
> no status. Move historical detail to `status/CHANGELOG.md` and deep runbooks to
> `docs/runbooks/`.

_Last updated: 2026-07-16 — ebadger (via Copilot)_

---

## Environments

| Environment | Where | URL | Notes |
|-------------|-------|-----|-------|
| Dev (native emulator) | Windows + Visual Studio 2022 | — | Open `emulator/Badger6502VM.sln`; run the `Console` or WinUI host. |
| Dev (WASM, local) | emsdk 6.0.1 + Node + Python 3 | `http://localhost:8011/index.html` | `web/build.ps1` then `web/serve.ps1`. |
| Production | GitHub Pages (static) | <https://ebadger.github.io/3ric/> | 100% client-side; deployed by `.github/workflows/deploy-pages.yml` on push to `main`. |
| Production (optional self-host) | Raspberry Pi + Cloudflare Tunnel / R2 | — | `web/Caddyfile`; `ASSET_BASE` offloads the heavy `sd.sparse`/`.wasm`. See `web/README.md`. |

## How to run it (dev)

**Native emulator (Windows):** open `emulator/Badger6502VM.sln` in Visual Studio 2022 and
build/run the `Console` or WinUI (`Badger6502Emulator`) host.

**Browser / WebAssembly build:**

```powershell
pwsh web/build.ps1     # Emscripten 6.0.1 -> web/badger6502.js + .wasm, stages data/
pwsh web/serve.ps1     # python -m http.server 8011 ; open http://localhost:8011/index.html
```

Prereqs on this machine (see `web/README.md`): emsdk **6.0.1** at `C:\Users\ebadger\emsdk`,
Node at `C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe` (not on `PATH`), Python 3.

## How to verify it's healthy

```powershell
$node = "C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe"
& $node codegen/tools/asm6502.test.mjs   # assembler encoding tests (no WASM build needed)
& $node web/test_boot.cjs                # ROM boots, sane PC, video RAM written
& $node web/test_render.cjs              # framebuffer has lit pixels
& $node web/test_keyboard.cjs            # monitor echoes typed commands
& $node web/test_virtual_keyboard.cjs    # touch layout covers symbols/modifiers/key codes
& $node web/test_screen_text.cjs         # decode the 40x24 text screen to ASCII
& $node web/test_emulation_clock.cjs     # 1x timing at 60/120/144 Hz displays
& $node web/test_sound_default.cjs       # default-on UI + first-gesture activation
& $node web/test_audio_pacing.cjs        # real WASM PCM rate at 60/144 Hz displays
& $node web/test_audio_worklet.cjs       # prebuffer + bounded PCM queue
& $node web/test_mockingboard.cjs        # slot-4 mirrors, stereo PCM, 3RIC clock, VIA IRQ
& $node web/test_system_speaker.cjs     # $C030 read/write toggles + mixed speaker/AY PCM
& $node web/test_gamepad.cjs             # browser mapping, VIA serial pads, ROM tables
& $node web/test_debugger.cjs            # breakpoints, stepping, source map, ROM debug lookup
& $node web/test_sd.cjs                  # mount SD + DIR lists the FAT32 root
& $node web/test_disk.cjs                # boot a WOZ floppy via C600G into a hi-res title
& $node web/test_woz_download.cjs        # "Download .woz" builds a bootable disk that boots via C600G
```

C++ CPU unit tests (`emulator/Badger6502VMTest`, MSTest): **Test → Run All Tests** in
Visual Studio. Expected: a booted ROM sits at the monitor `*` prompt; the smoke tests all
print `PASS` / exit 0.

## Credentials & secrets

**None.** 3ric is a 100% client-side static site — no database, no API server, no runtime
secrets. Nothing to configure and nothing to commit. (The only "secret" is the standard
`GITHUB_TOKEN` the Pages workflow uses, provided automatically by Actions.)

## Key scripts

| Script | Purpose |
|--------|---------|
| `scripts/dev/install-hooks.sh` | Activate the git `pre-push` guards (run once per clone). |
| `scripts/dev/check-learnings-budget.sh` | Enforce the `docs/LEARNINGS.md` token cap. |
| `scripts/dev/pre-push-tests.sh` | Project test gate — runs the 65C02 assembler tests (+ boot smoke test if a WASM build is present). |
| `web/build.ps1` | Compile the VM core + WozLib + MockMicroSD + bridge to WASM; stage data. |
| `web/serve.ps1` | Local static server for the browser build (port 8011). |
| `codegen/tools/run6502.mjs` | Assemble → run → check a 6502 program; emit a card-ready `.PRG`. |
| `codegen/tools/gen_platform_ref.mjs` | Regenerate `codegen/platform/platform-ref.*` from `vm.h` + `badger6502.dbg`. |

## Current state / known gaps

- **Emulator:** boots the unmodified 512 KB ROM to the monitor; text/lo-res/hi-res color
  video; keyboard; two serial SNES pads; ACIA serial; Disk II WOZ boot; micro-SD FAT32 DOS
  shell; `$C030` system speaker centered into the slot-4 dual-AY Mockingboard stereo stream
  at the hardware's 1.5734375 MHz clock; adjustable CPU clock. The browser maps standard
  USB/Bluetooth controllers through the SNES/VIA path. Shared VM core runs identically on
  Windows and in the browser.
- **In-browser assembler:** assembles 65C02 source client-side with the project's own
  `asm6502.mjs` and runs it like `BRUN`; ships ~11 sample programs; deep-linkable via `?src=`.
  Exports the assembled program as a raw **.PRG** or a bootable **.woz** disk image
  (`wozgen.mjs`, a JS port of `dsk2woz2` with a multi-track boot loader) that boots via `C600G`.
- **Browser debugger:** source-correlated instruction breakpoints for assembled programs,
  pause/continue, step into/over, live registers, raw-memory inspection, arbitrary PC
  breakpoints, and lazy ROM symbol/source-file:line correlation from `badger6502.dbg`.
- **Disk gap:** DOS 3.3 / Quick-DOS and games that chain through an Applesoft auto-run
  greeting don't run — this clone's `$E000` BASIC is generic Microsoft BASIC, not Applesoft.
  Self-booting machine-code disks work.
- **CI:** `deploy-pages.yml` rebuilds and publishes to GitHub Pages on every push to `main`
  that touches the emulator/web/codegen sources it lists.
- **Usage analytics:** every staged page loads a privacy-first, cookieless **GoatCounter**
  counter (`//gc.zgo.at/count.js` → `https://3ric.goatcounter.com/count`); no cookies, no PII,
  no server, and the site is unaffected if it is blocked. Totals live on the owner dashboard at
  <https://3ric.goatcounter.com> — **register the `3ric` code there once to claim the stats.**
- **Hardware:** schematics, PCB, and 22V10 GAL logic are in progress and tracked through the
  YouTube build series; the emulator is the reference implementation of the target machine.
