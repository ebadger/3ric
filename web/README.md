# 3ric — Apple-II-clone 65C02 emulator in the browser (WebAssembly)

This folder is a self-contained Emscripten/WebAssembly port of the `3ric` 65C02
Apple-II-clone emulator. It compiles the existing C++ VM core
(`emulator/Badger6502VMLib`) and disk library (`emulator/WozLib`) to WebAssembly,
boots the real 512KB ROM, renders Apple-II text/hi-res/lo-res video to an HTML
`<canvas>`, and feeds keystrokes through the memory-mapped keyboard at `$C000`.

Everything here is additive. The shared VM/WozLib sources gained only
`__EMSCRIPTEN__` / `PLATFORM_WEB`-guarded branches, so the Windows (WinUI) and
Pico builds compile and behave exactly as before.

## What works

- Boots the unmodified `badger6502.bin` ROM to the monitor.
- Hi-res color, lo-res color, and 40×24 text rendering — ported verbatim from
  the WinUI host renderer (`MainWindow.xaml.cpp`) into the bridge so the color /
  fringe logic is identical.
- Keyboard input via the Apple-II `$C000` / `$C010` strobe mechanism.
- **Micro-SD card** (bit-banged SPI through VIA1) backing a FAT32 disk image. A
  **Mount SD** button drops into the ROM's DOS shell (`>` prompt) and lists the
  card; from there `DIR`, `CAT`, `CD <dir>`, `BLOAD`/`BRUN <file>` all work.
- **Disk II 5.25″ floppy** emulation (WozLib) through the standard boot ROM at
  `$C600`. A **Boot Disk** button boots the bundled `.woz`, and **Insert .woz…**
  boots any WOZ image you pick. Self-booting machine-code game disks run into
  their hi-res title; DOS 3.3 / Quick-DOS disks don't (this clone has no
  Applesoft for their auto-run greeting — see below).
- **Adjustable CPU clock** (**Speed** selector): 0.5× / 1× (≈1 MHz) / 2× / 4× /
  8× / Max, with a per-frame wall-clock cap so the page stays responsive.
- **In-browser assembler** (**Assemble & Run**): edit 65C02 source in the page,
  assemble it client-side with the very same assembler the CLI uses
  (`codegen/tools/asm6502.mjs`), run the resulting image like **Load .PRG**, and
  download the `.PRG`. Ships the project's sample programs; deep-linkable with
  `?src=`.

## Layout

| File | Purpose |
| --- | --- |
| `web_bridge.cpp` | embind bridge: wraps `VM`, exposes load/run/keyboard/registers, drives the SD card, and produces the RGBA framebuffer. |
| `web_compat.h` | Tiny shims so `WozLib` + `MockMicroSD`'s MSVC-isms (`OutputDebugString`, `sprintf_s`, `swprintf_s`, `fopen_s`, `_ASSERT`, …) compile under Emscripten. |
| `make_sd_sparse.py` | Streams `emulator/Data/sd.zip` (a 2GB, mostly-zero FAT32 image) into a compact `data/sd.sparse` keeping only the ~11.5MB of non-zero sectors. |
| `build.ps1` | Compiles the core + WozLib + MockMicroSD + bridge to `badger6502.js` / `.wasm`, stages the data files, generates `sd.sparse`, and stages the demo `disk.woz`. |
| `index.html` | Canvas UI + `requestAnimationFrame` driver + keyboard + clock-speed/disk controls + the in-browser assembler/editor. Honors an optional `ASSET_BASE` (R2/CDN offload). |
| `asm6502.mjs` | The 65C02 assembler, staged from `codegen/tools/asm6502.mjs` (git-ignored). Dual-use: the same file is a Node CLI and a browser ES module — `index.html` imports its `assemble()` for **Assemble & Run**. |
| `serve.ps1` | Starts `python -m http.server` (defaults to port 8011) for local dev. |
| `Caddyfile` | Production static server config (compression + cache headers) for hosting behind a Cloudflare Tunnel. |
| `test_*.cjs` | Headless Node validations (boot, render, keyboard, screen decode, SD, disk). |

Build outputs (`badger6502.js`, `badger6502.wasm`), the staged `data/` copies,
and the editor's staged `asm6502.mjs` + `programs/*.s` sample sources are
git-ignored; regenerate them with `build.ps1`.

## Prerequisites (this machine)

- **emsdk 6.0.1** at `C:\Users\ebadger\emsdk` (x86_64). `emsdk_env.bat` does not
  add `upstream\emscripten` to `PATH`, so the build invokes `em++.exe` by full
  path after sourcing the env in the same `cmd` process.
- **Node** (for headless tests): `C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe`
  (the system has no `node` on `PATH`).
- **Python 3** for serving (sets the `application/wasm` MIME type; `.wasm` must
  be served over http, not `file://`).

## Build

```powershell
cd web
.\build.ps1
```

This compiles these sources with `-DPLATFORM_WEB`:

```
Badger6502VMLib: vm cpu Instructions acia via PS2Keyboard badgervmpal
WozLib:          DriveEmulator WozDisk WozFile
MockMicroSD:     SDCard MappedFile
bridge:          web_bridge.cpp
```

`symbols.cpp` and `Disassemble.cpp` are excluded (Windows-only). Key flags:
`-std=c++17 -O2 -lembind -sMODULARIZE=1 -sEXPORT_NAME=createBadgerVM
-sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,node`. The data files
(`badger6502.bin`, `fontrom.dat`) are copied from
`emulator/Data` into `web/data`, `sd.sparse` is generated from
`emulator/Data/sd.zip` (first run only; ~20s), and the demo `disk.woz` is staged
from the in-repo WOZ test images.

## Run in the browser

```powershell
cd web
.\serve.ps1            # python -m http.server 8011
```

Open <http://localhost:8011/index.html>, click the canvas, and type. Press
**Boot Disk** to boot the bundled 5.25″ floppy, or **Insert .woz…** to boot one
of your own WOZ images. Press **Mount SD** to mount the micro-SD card and enter
the DOS shell — it runs the monitor command `EC5CG` (Go to `$EC5C`, the `dos`
routine) which mounts the FAT32 image and prints a `>` prompt, then auto-runs
`DIR`. Type `CAT`, `CD <dir>`, `BRUN <file>`, etc. to load games and programs
from the card. The **Speed** selector sets the CPU clock (0.5×–8× or Max).

> Port 8011 is used because 8000 is taken on this machine.

## In-browser assembler (Assemble & Run)

The page includes an **Assembler** panel that assembles 65C02 source entirely in
the browser and runs it in the emulator — no CLI, no server round-trip:

1. **Pick a sample** — hi-res games (STAR SWARM, ROCK STORM, JUNGLE QUEST,
   Conway's Life), text-mode games (Snake, Block Drop, Paddles, Brick Buster,
   2048, Minefield), or Hello (serial) — or type your own source into the editor.
2. **Assemble & Run** (button or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>) assembles the
   source and loads the image exactly like **Load .PRG** (`BRUN` on hardware).
   Assembler errors show as `line N: …` and are non-fatal.
3. **Download .PRG** saves the assembled image so you can `BRUN` it on real
   hardware or off the SD card.

Implementation notes:

- The assembler is the project's own `codegen/tools/asm6502.mjs`, made *dual-use*:
  its CLI tail is guarded by a `process`/`node` check and its lone `node:url`
  import is dynamic, so the exact same file runs as a Node CLI **and** imports
  cleanly as a browser ES module. `index.html` lazily `import()`s its `assemble()`.
- A source's own `.org` / `*=` is authoritative; the **org $** field is only used
  when the source has no origin directive (passing both would corrupt the layout).
- The editor autosaves to `localStorage`, and a program is deep-linkable:
  `?src=programs/swarm.s` fetches that source, fills the editor, and auto-runs it.
- `build.ps1` stages `asm6502.mjs` and the eleven sample `.s` sources into
  `web/` and `web/programs/` (git-ignored, regenerated each build; CI does the
  same before publishing).

## Headless tests (fast iteration)

```powershell
$node = "C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe"
& $node web\test_boot.cjs        # ROM boots, sane PC, video RAM written
& $node web\test_render.cjs      # framebuffer has lit pixels
& $node web\test_keyboard.cjs    # monitor echoes typed commands
& $node web\test_screen_text.cjs # decode the text screen to ASCII
& $node web\test_sd.cjs          # mount the SD card + DIR lists the FAT32 root
& $node web\test_disk.cjs        # boot a WOZ floppy via C600G into a hi-res title
```

## ROM load recipe (mirrors the WinUI host)

1. Write the first `0x10000` bytes of `badger6502.bin` into `VM::GetData()`
   (`loadData(0, bytes)`) — provides the reset vector at `$FFFC` and ROM/OS at
   `$D000-$FFFF`.
2. `seedBasicRom()` — `memcpy(GetBasicRom(), &GetData()[0x9000], 0x3000)`.
3. `loadFont(fontromBytes)` — used by the text renderer.
4. `reset()` — loads PC from `$FFFC/$FFFD`.

The CPU is driven cooperatively: each animation frame calls `run(maxSteps)`,
which `Step()`s the CPU and ticks the VIAs/keyboard per returned cycle (the
blocking `VM::Run()` is never used).

## How the micro-SD card works

The card is a bit-banged SPI device wired to VIA1's port-A register, exactly like
the WinUI host (`MainWindow.xaml.cpp`). Each CPU write to `$C201`/`$C20F` clocks
the SD state machine (`emulator/MockMicroSD/SDCard.cpp`): `CS`=bit4, `SCK`=bit3,
`MOSI`=bit2, and the resulting `MISO`=bit1 is folded back into the register. The
bridge installs this pump via `VM::CallbackWriteMemory`.

The disk image (`emulator/Data/sd.zip`) decompresses to a **2GB** FAT32 image
that is almost entirely zeros — far too large to fetch or allocate in a browser.
`make_sd_sparse.py` streams it straight out of the zip and emits only the
~23k non-zero 512-byte sectors as `data/sd.sparse` (~11.5MB, an `SDSP`
container). The Emscripten branch of `MMappedFile` (`MockMicroSD/MappedFile.cpp`)
backs the 2GB logical image with a lazily-allocated `unordered_map<sector,
512 bytes>`; never-written sectors read back as zero.

At runtime the page lazily fetches `sd.sparse`, hands it to `loadSD()`
(`SDCard::LoadSparseImage`), and the ROM's own FAT32 driver (`fat32_start` →
`fat32_dir`) reads the card over SPI. `test_sd.cjs` proves the round trip: it
enters the shell, runs `DIR`, and asserts real `<DIR>` folders and `PRG` files
come back along with a non-zero sector-read count.

## How the Disk II floppy boots

The 5.25″ drive is the WinUI host's `WozLib` emulator (`DriveEmulator` +
`WozDisk` + `WozFile`), already embedded in `VM`. The CPU reaches it through the
standard hardware path: the Disk II boot PROM lives at `$C600` (part of the ROM
image), and the data registers at `$C0E0-$C0EF` route to `DriveEmulator` via
`VM::DoDisk`. The bridge advances the drive on every `$C0E0-$C0EF` access
(`AddCycles(elapsed)`), exactly like the host.

`insertDisk(drive, bytes)` writes the WOZ bytes to Emscripten's in-memory
filesystem and calls `WozDisk::InsertDisk(path)` (the loader reads through a
`FILE*`, which MEMFS provides) — no changes to WozLib were needed. **Boot Disk**
and **Insert .woz…** re-seed a clean machine, insert the image into drive 1, and
type `C600G` (the monitor "Go" command) to jump to the boot ROM, just like
booting on real hardware.

This clone's `$E000` BASIC is a generic Microsoft BASIC (it prompts
`MEMORY SIZE?`), **not** Applesoft, so disks whose boot auto-runs an Applesoft
greeting — DOS 3.3 / Quick-DOS System Masters, and games that chain through them
— load DOS but then trap to `$0000`. Self-booting machine-code game disks (the
bundled demo and most of the WOZ test images) bring their own code and run fine.
`test_disk.cjs` boots one through `C600G` and asserts it reaches a painted hi-res
screen without trapping.

## CPU clock speed

The frame loop runs `BASE_CYCLES_PER_FRAME` (≈17030, i.e. ~1 MHz at 60 fps) times
the **Speed** multiplier each animation frame, bounded by a ~12 ms wall-clock
budget so the tab never locks up. `Max` sets the multiplier to `Infinity`, so the
CPU runs as many cycles as fit in that budget. Clock speed is purely a frontend
concern — the VM core is unchanged.

## Hosting on GitHub Pages (zero-cost, public)

Because the emulator is 100% client-side, the repo publishes it straight to
**GitHub Pages** — no server to run. The live site is:

**<https://ebadger.github.io/3ric/>**

Anyone with a browser can open it; **no GitHub account is required**. For a
public repo, Pages hosting and the Actions build are free (soft limits: 1 GB
site, 100 GB/month bandwidth).

`.github/workflows/deploy-pages.yml` does it automatically on every push to
`main` that touches the emulator sources:

1. installs Python + Emscripten (`6.0.1`, matching this project),
2. runs `web/build.ps1` (it detects Linux CI and invokes `em++` directly, and
   stages `asm6502.mjs` + the `programs/*.s` sample sources for the editor),
3. stages `index.html` + `badger6502.js` + `.wasm` + `asm6502.mjs` + `data/` +
   `programs/` as the site root,
4. uploads it as a Pages artifact and deploys.

The build outputs stay git-ignored — CI regenerates them from the committed
sources (`emulator/Data/*`, the demo `.woz`, etc.) each run. To publish from a
fork, enable Pages with the **GitHub Actions** source (Settings → Pages), then
push to `main` or run the workflow manually from the Actions tab. The site is
served under `/<repo>/`, which works because every asset path in `index.html` is
relative.

## Serving in production (Raspberry Pi + Cloudflare)

The emulator is **100% client-side** — the server only hands out static files,
and all 65C02/video/disk emulation runs in the visitor's browser. So a tiny
origin (e.g. a Raspberry Pi behind a Cloudflare Tunnel) can serve a large number
of concurrent users; the only real constraint is bandwidth for *first-time*
downloads, which Cloudflare's edge cache absorbs.

Per fresh visit the mandatory payload is ~1.26 MB (`index.html` + `badger6502.js`
+ `.wasm` + `badger6502.bin` + `fontrom.dat`). `disk.woz` (~230 KB) and
`sd.sparse` (~11.5 MB) are fetched lazily, only when the user clicks **Boot Disk**
or **Mount SD**.

### Caddy (static origin)

Use the included `Caddyfile` instead of the dev `serve.ps1` — it adds gzip/zstd
compression, long cache headers for the immutable assets, and `no-cache` for
`index.html` so rebuilds appear immediately:

```bash
cd web
caddy run --config Caddyfile      # serves :8080
```

Point your Cloudflare Tunnel's public hostname at `http://localhost:8080`.

### Caching the SD image to minimize ISP upload

The `Caddyfile` already sends `Cache-Control: public, max-age=31536000, immutable`
on everything under `/data/` (including the ~11.5 MB `sd.sparse`), so a returning
visitor's **browser** never re-downloads it. To also stop your **Pi** from
re-uploading it to each *new* visitor, let Cloudflare's edge cache it:

1. In the Cloudflare dashboard go to **Caching → Cache Rules** and add a rule:
   - **If** URI Path starts with `/data/` (or matches `*.sparse`), **then** set
     **Cache eligibility → Eligible for cache**, and an **Edge TTL** (e.g.
     "Use cache-control header" since the origin already sends a year, or pin
     "1 month").
   - This rule is *required*: a `.sparse` file is **not** one of the extensions
     Cloudflare caches by default, so without it the edge passes every request
     straight through to your Pi.
2. Verify with `curl -I https://your-host/data/sd.sparse`. After the first
   request you should see `cf-cache-status: HIT` — meaning that download came
   from Cloudflare, not your uplink. (Free/Pro cache objects up to 512 MB, so
   11.5 MB is fine.)

With the rule in place your Pi serves `sd.sparse` roughly **once per Cloudflare
location per TTL** instead of once per visitor. If you change the SD contents,
give the new image a different filename (e.g. `sd.v2.sparse`) and update the
fetch path in `index.html`, otherwise cached copies persist for up to a year.

For the strongest result — `sd.sparse` never touching your home connection at
all — offload it to R2 (next section): zero egress fees, served straight from
Cloudflare's network.

### Offloading the heavy files to R2 (`ASSET_BASE`)

If the optional 11.5 MB `sd.sparse` gets popular, serving it from your home
connection can saturate your uplink (or hit an ISP data cap). `index.html`
supports an **`ASSET_BASE`** that relocates the `.wasm` binary and everything
under `data/` to any CDN — ideally a **Cloudflare R2** bucket (free tier: 10 GB
storage + **zero egress fees**, and policy-clean for large-file distribution):

1. Upload `badger6502.wasm` and the whole `data/` folder to a public R2 bucket,
   preserving paths (so `…/badger6502.wasm` and `…/data/sd.sparse` resolve).
2. Configure the bucket's **CORS policy** to allow your site's origin (or `*`),
   and make sure objects are served with sensible content types — in particular
   `badger6502.wasm` as `application/wasm` for streaming compile.
3. Point the page at the bucket, either by editing the page or at runtime:
   - `window.ASSET_BASE = "https://pub-<hash>.r2.dev";` before the main script, or
   - append `?assets=https://pub-<hash>.r2.dev` to the page URL.

The small `index.html` + `badger6502.js` bootstrap still come from your origin;
everything large comes from R2. Leave `ASSET_BASE` empty to serve everything
locally (the default).
