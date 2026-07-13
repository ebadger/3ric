# 3ric — Web / WASM Client Spec (WEB-CLIENT.md)

> The Emscripten/WebAssembly port and the browser UI that make 3ric playable at
> <https://ebadger.github.io/3ric/> with no install. It compiles the **same** VM core
> (`EMULATOR.md`) to WASM and renders it to an HTML canvas. Everything here is additive to
> the shared sources — see `web/README.md` for the deep dive.

---

## Purpose

Boot the real 512 KB ROM in any browser: render Apple-II text/lo-res/hi-res video to a
`<canvas>`, feed keystrokes through the memory-mapped keyboard, run Disk II and micro-SD
images, and assemble/run 65C02 source client-side — all 100% client-side so GitHub Pages can
host it as static files.

## Contracts / Interfaces

- **Build:** `web/build.ps1` compiles `Badger6502VMLib` (vm, cpu, Instructions, acia, via,
  PS2Keyboard, badgervmpal) + `WozLib` (DriveEmulator, WozDisk, WozFile) + `MockMicroSD`
  (SDCard, MappedFile) + `web/web_bridge.cpp` with `-DPLATFORM_WEB`. Excludes `symbols.cpp`
  and `Disassemble.cpp`. Key flags: `-std=c++17 -O2 -lembind -sMODULARIZE=1
  -sEXPORT_NAME=createBadgerVM -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,node`. Output:
  `web/badger6502.js` + `web/badger6502.wasm` (git-ignored — regenerated).
- **Bridge API (embind, `web_bridge.cpp`):** `loadData(addr, bytes)`, `seedBasicRom()`,
  `loadFont(bytes)`, `loadSD(bytes)`, `insertDisk(drive, bytes)`, `reset()`, `run(maxSteps)`,
  `setPC`, `poke/peek`, `keyDown(code)`, `drainOutput()` (serial), `renderFrame()` (RGBA
  framebuffer), `pc/sp/regA/regX/regY/status`, `sdReadCount()`.
- **Compat shims (`web_compat.h`):** map MSVC-isms (`OutputDebugString`, `sprintf_s`,
  `fopen_s`, `_ASSERT`, …) onto Emscripten so `WozLib`/`MockMicroSD` compile unchanged.
- **UI (`index.html`):** `requestAnimationFrame` driver, keyboard, disk/SD/clock controls,
  and the in-browser **Assembler** panel (imports `assemble()` from the staged
  `asm6502.mjs`). Honors optional `window.ASSET_BASE` / `?assets=` for CDN/R2 offload and
  `?src=` / `?prg=` / `?code=` deep links, plus a **Share** button that builds a one-click
  link to the current editor program.
- **Assembler downloads (`index.html` + staged `wozgen.mjs`):** the Assembler panel offers
  **Download .PRG** (the raw assembled bytes) and **Download .woz** — a bootable 5.25″ WOZ2
  disk image of the current program, generated fully client-side by `wozgen.mjs` (a
  dependency-free JS port of the `emulator/dsk2woz2` nibbliser). The `.woz` boots the program
  on a real Apple II or via `C600G` in the emulator.
- **SD image:** `make_sd_sparse.py` streams `emulator/Data/sd.zip` (2 GB, mostly-zero FAT32)
  into `data/sd.sparse` (~11.5 MB `SDSP` container), fetched lazily.
- **Gallery (`gallery.html` + `gallery.json`):** a lightweight, WASM-free showcase page that
  fetches the curated `gallery.json` manifest and renders one card per program, each opening
  `index.html?src=programs/<name>.s` (or an inline `?code=`) so the Share/Remix loader
  auto-runs it. Manifest entries carry `title`, `author`/`authorUrl`, `mode`, `description`,
  `tags`, and a run target (a `src` program path or inline `code`, plus optional `org`). Both
  files are committed (not generated), so the deploy workflow stages them into `_site/`.
- **`llms.txt`:** a committed, machine-readable entry point (published at the site root) that
  gives AI coding tools a 65C02 codegen quickstart plus links to the platform reference
  (`codegen/platform/*`), a worked example, the live editor, and the gallery submission flow
  (`CONTRIBUTING.md`). Static text; staged into `_site/` by the deploy workflow.
- **Discoverability of `llms.txt`:** `index.html` advertises it via a
  `<link rel="alternate" type="text/markdown" href="llms.txt">` plus a visible footer link
  (mirrored in `gallery.html`), and committed `robots.txt` + `sitemap.xml` list it for
  crawlers. NOTE: on a GitHub *project* page the served root is `…/3ric/`, not the domain
  root, so `robots.txt`/`sitemap.xml` there are advisory (crawlers honour the domain-root
  `robots.txt`) and become authoritative only under a custom domain — the in-page links and
  the human copy-paste prompt (`CONTRIBUTING.md`) are the discovery paths that work today.
- **Support / funding call-to-action:** the `index.html` and `gallery.html` footers link to
  the project's GitHub Sponsors page (`https://github.com/sponsors/ebadger`), the primary
  target declared in `.github/FUNDING.yml`, so visitors to the live emulator — the project's
  main traffic surface — can fund it. Static markup, external link
  (`target="_blank" rel="noopener noreferrer"`); no new runtime behaviour.

## Behaviour / Rules

- The CPU is stepped per animation frame (`run(maxSteps)`), bounded by a wall-clock budget so
  the tab stays responsive; the **Speed** selector scales cycles/frame around the machine's
  native **1× ≈ 1.57 MHz** (25.175 MHz VGA dot clock ÷ 16), through 0.5×–8× and an uncapped **Max**.
- **Parity is the rule:** the WASM build must behave like the native build. Do not add
  behavior in the bridge that isn't in the shared core unless it's a genuinely
  presentation-only concern (canvas, clock pacing) — and never behind an unguarded fork.
- Assets are relative so the site works under `/<repo>/` on Pages; the mandatory first-load
  payload is ~1.26 MB, with `disk.woz`/`sd.sparse` fetched only on demand.
- **Share / Remix loop.** The editor's **Share** button copies a self-contained deep link
  that reproduces the exact program: an *unmodified* built-in sample links as the short
  `?src=programs/<name>.s`; any edited or hand-written source is embedded inline as URL-safe
  base64 in `?code=`. Either form carries `&org=<hex>` when the source has no `.org`
  directive, so the load address travels with the link. Opening a `?src=` or `?code=` link
  loads it into the editor, auto-assembles/runs it, and shows a "remixing a shared program"
  banner — so every shared program is an editable starting point. No server or storage is
  involved; the link is the whole payload. Large sources make long `?code=` links (the giant
  hi-res samples are shared via `?src=` precisely to avoid this); a future `?codez=` could
  deflate the payload if needed.
- **Bootable `.woz` export.** `wozgen.mjs`'s `buildBootableWoz(bytes, loadAddr, entryAddr)`
  lays the program onto a standard 35-track / 16-sector DOS-3.3 disk and nibblises it to WOZ2
  with the exact encoder ported from `dsk2woz2` (6-and-2, 4-and-4 address fields, `(sector*7)%15`
  interleave, WOZ2 INFO/TMAP/TRKS + CRC32). Track 0 sector 0 holds a 256-byte boot loader that
  the `$C600` P5 boot PROM auto-loads then `JMP $0801`s; the loader re-enters the ROM's
  `ReadSector` (`$C65C`) track-by-track into a page-aligned staging buffer, phase-steps the head
  inward between tracks, then relocates a position-independent copier to `$0200`, copies staging
  → the program's load address and `JMP`s its entry. This handles multi-track programs (the
  default `swarm` sample is ~17 pages / 2 tracks). Constraints: the load address must be
  page-aligned and ≥ `$0800`, and `loadAddr + 2·nPages·256 ≤ $9000` (staging must fit under the
  BASIC ROM at `$9000`). The boot loader itself is assembled at generation time by the staged
  `asm6502.mjs`, so there is a single source of truth for the 65C02 dialect.
- **Community Gallery.** `gallery.html` is the discovery front door: it reads `gallery.json`
  and shows every program as a one-click **Run & Remix** card that opens in the editor via the
  same `?src=` / `?code=` deep links, so each card lands on an editable, auto-running program.
  Contribution is PR-based — add a `.s` under `codegen/programs/` (staged into `programs/` by
  `build.ps1`) plus an entry in `gallery.json` — so every featured program credits its author
  and turns a visitor into a contributor. The page builds card text with `textContent` only:
  the manifest is repo-reviewed, but no entry field is ever injected as HTML.

## Data flow

`build.ps1 → badger6502.js/.wasm + data/ → index.html loads WASM → boot recipe (loadData /
seedBasicRom / loadFont / reset) → run() per frame → renderFrame()→canvas, drainOutput()→
log; keyDown()→$C000; Boot Disk/Mount SD → insertDisk()/loadSD() → C600G / EC5CG`.

Gallery: `gallery.html → fetch gallery.json → render cards → click Run & Remix →
index.html?src=programs/<name>.s → Share/Remix loader assembles + runs`.

## Dependencies

- **Upstream:** the VM core (`EMULATOR.md`), the ROM/font/disk/SD data (`ROM-SOFTWARE.md`),
  `codegen/tools/asm6502.mjs` (staged for the in-browser assembler and reused to assemble the
  `.woz` boot loader — `CODEGEN.md`), and `codegen/tools/wozgen.mjs` (staged bootable-`.woz`
  generator, a JS port of `emulator/dsk2woz2`). The `.woz` boot loader depends on the `$C600`
  P5 boot PROM contract (`ROM-SOFTWARE.md`) and the Disk II phase-stepping model (`EMULATOR.md`).
- **Downstream:** GitHub Pages deploy (`.github/workflows/deploy-pages.yml`) — its **Stage
  site** step stages `gallery.html` + `gallery.json` + `llms.txt` + `robots.txt` +
  `sitemap.xml` (alongside `index.html` and `programs/`) into `_site/`; the public users of
  the demo, and AI coding tools that fetch `llms.txt`.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| WASM build of the VM core + WozLib + SD | Shipped | `web/build.ps1`, Emscripten 6.0.1. |
| Canvas video + keyboard | Shipped | text/lo-res/hi-res, `$C000` input. |
| Disk II WOZ boot + micro-SD DOS shell | Shipped | **Boot Disk** / **Mount SD** buttons. |
| In-browser assembler (Assemble & Run) | Shipped | dual-use `asm6502.mjs`; ~11 samples; `?src=`. |
| Program downloads (.PRG / .woz) | Shipped | **Download .PRG** (raw bytes) + **Download .woz** (bootable WOZ2 via `wozgen.mjs`, a port of `dsk2woz2`, with a multi-track boot loader); verified by `web/test_woz_download.cjs`. |
| Share / Remix deep links | Shipped | **Share** button; `?src=programs/<name>.s` for unmodified samples, inline base64url `?code=` otherwise, both carrying `&org=` when the source has no `.org`; remix banner on shared links. |
| Community Gallery | Shipped | `gallery.html` renders the curated `gallery.json`; one-click **Run & Remix** via `?src=`/`?code=`; PR-based submissions credited by author. |
| AI-contributor entry point (`llms.txt`) | Shipped | machine-readable 65C02 codegen quickstart + links; published at the site root, staged by the deploy workflow. |
| `llms.txt` discoverability | Shipped | `<link rel="alternate">` + footer links in `index.html`/`gallery.html`; `robots.txt` + `sitemap.xml` staged (advisory on the project-page root; authoritative under a custom domain). |
| Support / funding link | Shipped | GitHub Sponsors call-to-action in the `index.html`/`gallery.html` footers; target declared in `.github/FUNDING.yml`. |
| Adjustable CPU clock | Shipped | frontend-only pacing; native **1× ≈ 1.57 MHz** (25.175 MHz VGA dot clock ÷ 16) default. |
| Headless smoke tests | Shipped | `web/test_*.cjs` (boot/render/keyboard/screen/sd/disk). |
| GitHub Pages CI deploy | Shipped | on push to `main` touching emulator/web/codegen sources. |
