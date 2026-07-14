# 3ric — Web / WASM Client Spec (WEB-CLIENT.md)

> The Emscripten/WebAssembly port and the browser UI that make 3ric playable at
> <https://ebadger.github.io/3ric/> with no install. It compiles the **same** VM core
> (`EMULATOR.md`) to WASM and renders it to an HTML canvas. Everything here is additive to
> the shared sources — see `web/README.md` for the deep dive.

---

## Purpose

Boot the real 512 KB ROM in any browser: render Apple-II text/lo-res/hi-res video to a
`<canvas>`, feed keyboard and standard Gamepad API input through the machine's real input
paths, run Disk II and micro-SD images, and assemble/run 65C02 source client-side — all 100%
client-side so GitHub Pages can host it as static files.

## Contracts / Interfaces

- **Build:** `web/build.ps1` compiles `Badger6502VMLib` (vm, cpu, Instructions, acia, via,
  snesgamepads, mockingboard, ay38910, PS2Keyboard, badgervmpal) + `WozLib` (DriveEmulator, WozDisk,
  WozFile) + `MockMicroSD` (SDCard, MappedFile) + `web/web_bridge.cpp` with
  `-DPLATFORM_WEB`. Excludes `symbols.cpp` and `Disassemble.cpp`. Key flags:
  `-std=c++17 -O2 -lembind -sMODULARIZE=1
  -sEXPORT_NAME=createBadgerVM -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,node`. Output:
  `web/badger6502.js` + `web/badger6502.wasm` (git-ignored — regenerated).
- **Bridge API (embind, `web_bridge.cpp`):** `loadData(addr, bytes)`, `seedBasicRom()`,
  `loadFont(bytes)`, `loadSD(bytes)`, `insertDisk(drive, bytes)`, `reset()`, `run(maxSteps)`,
  `runCycles(cycleBudget)`, `setPC`, `poke/peek`, `keyDown(code)`, `drainOutput()` (serial),
  `setGamepadState(index, pressedMask)`,
  `enableAudio(sampleRate)`, `disableAudio()`, `drainAudio()` (interleaved Float32 stereo PCM),
  `renderFrame()` (RGBA framebuffer), `pc/sp/regA/regX/regY/status`, `sdReadCount()`.
- **Compat shims (`web_compat.h`):** map MSVC-isms (`OutputDebugString`, `sprintf_s`,
  `fopen_s`, `_ASSERT`, …) onto Emscripten so `WozLib`/`MockMicroSD` compile unchanged.
- **UI (`index.html`):** `requestAnimationFrame` driver, physical/virtual keyboard and gamepad
  input, disk/SD/clock/sound controls, and the in-browser **Assembler** panel (imports
  `assemble()` from the staged
  `asm6502.mjs`). Honors optional `window.ASSET_BASE` / `?assets=` for CDN/R2 offload and
  `?src=` / `?prg=` / `?code=` deep links, plus a **Share** button that builds a one-click
  link to the current editor program. The sample-source loads (the **sample** dropdown and
  `?src=programs/<name>.s`) fetch with `{ cache: "no-cache" }` so the browser **revalidates**
  against Pages instead of serving a stale `max-age=600` copy — a freshly deployed program
  shows up on the next selection without a hard refresh. (There is no service worker, and
  GitHub Pages purges its CDN on every deploy, so the revalidation returns the new source.)
- **Mobile virtual keyboard (`virtual-keyboard.js` + `index.html`):** a collapsed
  `<details>` panel directly below the emulator canvas renders the five-row keyboard from
  the **1983 Apple IIe Owner's Manual, Figure 2-1**, without invoking the phone's incomplete
  software keyboard. Key order and relative widths match that diagram, including Delete,
  dual Shift, Caps Lock, the separate grave/tilde key, the wide space bar, and arrows ordered
  left/right/down/up. Reset and the Open/Solid Apple keys are intentionally omitted; blank
  bottom-row spacers preserve the remaining keys' physical positions. One-shot Shift and
  Control modifiers complete the emulator's character set. Key buttons enqueue the same
  7-bit bytes as physical `keydown` events; the frame driver remains the single writer to
  `keyDown()` and waits for the `$C000` strobe to clear before delivering each byte.
- **Browser gamepads (`gamepad.js` + `index.html`):** the frame driver polls the standard
  Gamepad API before running the CPU, keeps the first two connected devices in stable player
  slots, maps each to the 12-button SNES mask, and calls `setGamepadState()` for both slots.
  Standard-layout face buttons 0/1/2/3 map to SNES B/A/Y/X; 8/9 to Select/Start; 4 or 6 to
  L; 5 or 7 to R; D-pad buttons 12–15 and left-stick axes 0/1 (0.5 deadzone) map directions.
  USB and Bluetooth pairing is handled by the operating system — the page does not use Web
  Bluetooth. Browsers may hide a connected pad until the user presses one of its buttons;
  the header reports API availability and the currently assigned players.
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
- **Story / landing page (`story.html`):** a committed, WASM-free narrative page that tells
  the story of 3ric and the wider hardware-hacking journey (the Atari-1200XL / learning-journey
  origin, the Lode-Runner goal that drove the push toward Apple II *compatibility* — 3ric is an
  original design, not a clone, with its own ROM and modern I/O (PS/2 keyboard/mouse, SNES pads,
  SD card), so some Apple II software and Applesoft do not run — the hardware-generated VGA
  graphics with NTSC-artifact color reproduced in logic (the part the author is proudest of), the
  shared-RAM CPU/video timing, breadboard → PCB, the Ultima IV payoff, the in-browser build →
  **Download .woz** Apple II dev-kit angle, and the related builds — the Badger6502 **Pico**
  kit/emulator, ESP32/Atari-2600 experiments, and the cross-platform Lode Runner saga). It links each chapter to its YouTube
  episode via a **lite-embed facade** (a static `img.youtube.com` thumbnail that, on click,
  swaps in a privacy-friendly `youtube-nocookie.com` iframe — so no third-party player loads
  until the visitor asks for it) and funnels visitors into the live emulator/editor, the
  Gallery, and the Tutorials. A **Community** section pairs a curated **real-time Reddit
  timeline** (16 milestone `r/beneater` / maker-community posts from 2020&ndash;2025, each linking
  to its permalink &mdash; day-one breadboard → the stated Lode-Runner goal → first run → Tom's
  Hardware writeup → Zork-on-Pico → Ultima IV finished → &ldquo;the conclusion&rdquo;) with link
  cards to the `r/beneater` subreddit, the `u/ebadger1973` profile, and the 6502.org project
  thread; the timeline is hand-curated in the page markup. Pure static markup (one small inline
  script for the facade); no WASM, no bundle
  dependency. Linked from the `index.html` / `gallery.html` / `tutorials.html` headers so it is
  reachable from anywhere in the web client.
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

- The CPU is paced from elapsed monotonic time, not an assumed display refresh rate.
  `runCycles(cycleBudget)` executes each finite-speed budget in bounded batches and carries
  instruction-boundary overshoot into the next animation frame. This keeps native **1× =
  1.5734375 MHz** (25.175 MHz VGA dot clock ÷ 16) on 60 Hz, high-refresh, and variable-refresh
  displays. A wall-clock execution cap keeps the tab responsive; **Max** remains unthrottled
  within that cap. Timing debt is reset after a machine reset, speed change, or hidden-tab
  transition rather than replaying a stale wall-clock interval.
- Sound is opt-in because browsers require a user gesture to start `AudioContext`.
  `audio-worklet.js` consumes transferable Float32 chunks from the bridge without requiring
  `SharedArrayBuffer` or cross-origin isolation. It prebuffers a short bounded lead before
  playback, renders without per-sample allocation, and discards only the oldest queued frames
  if a stalled producer exceeds the latency bound. Sound is generated only at 1x speed;
  changing speed mutes and flushes PCM while the emulated VIA/AY state continues to advance.
- Gamepad state is sampled once per rendered frame, independently of CPU speed. Disconnecting
  a pad releases every button immediately; reconnecting fills the first free player slot.
  The shared VM, not JavaScript, performs the SNES latch/clock protocol and active-low VIA
  input behavior.
- The virtual keyboard is collapsed by default so it does not displace the emulator or
  assembler until requested. Shift and Control are one-shot touchscreen modifiers: tapping
  either toggles its pressed state, and the next non-modifier key consumes both.
  Control uses conventional ASCII control mappings (`@`/letters/`[` through `_`, plus
  `?` for DEL). The bridge still uppercases alphabetic input to match the native host and
  ROM, so the virtual keycaps show uppercase letters. The IIe Caps Lock key is displayed in
  its physical position but disabled with an explicit uppercase-only label; it does not fake
  a lowercase mode the bridge cannot deliver. Both the virtual IIe Delete key and a physical
  keyboard's Delete key emit ASCII DEL (`$7F`).
- Pointer/touch activation returns focus to the canvas after expanding the panel or pressing
  any virtual key, preserving immediate physical-keyboard input. Keyboard and assistive-
  technology activation retains focus on the activated control so consecutive accessible
  navigation is not interrupted. While the canvas has focus, physical `Shift+Tab` remains a
  browser focus-navigation escape instead of being consumed as emulator input.
- Key labels meet normal-text contrast, and dense rows retain at least 24 CSS-pixel key
  widths. On narrower screens the complete 530 CSS-pixel keyboard matrix pans horizontally
  as one unit instead of shrinking targets or distorting the manual-derived key-width ratios;
  the space bar retains its Figure 2-1 position within that matrix. Ratios digitized from the
  manual crop, normalized to a standard key, are Delete/Tab 1.58, Control 1.86, Return 1.87,
  left/right Shift 2.48/2.38, and Space 5.86. Every row uses the same key height.
- The Caps Lock key's uppercase-only limitation is both visible beneath the keys and associated
  with the focusable `aria-disabled` key, so touch and assistive-technology users do not depend
  on a hover-only tooltip.
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
seedBasicRom / loadFont / reset) → Gamepad API→gamepad.js mapping→setGamepadState()→shared
SNES/VIA peripheral; elapsed-time budget→runCycles() per frame →
renderFrame()→canvas, drainOutput()→log, drainAudio()→AudioWorklet→speakers; canvas keydown or
virtual-keyboard button→shared input queue→strobe-clear frame→keyDown()→$C000;
Boot Disk/Mount SD →
insertDisk()/loadSD() → C600G / EC5CG`.

Gallery: `gallery.html → fetch gallery.json → render cards → click Run & Remix →
index.html?src=programs/<name>.s → Share/Remix loader assembles + runs`.

## Dependencies

- **Upstream:** the VM core (`EMULATOR.md`), the ROM/font/disk/SD data (`ROM-SOFTWARE.md`),
  `codegen/tools/asm6502.mjs` (staged for the in-browser assembler and reused to assemble the
  `.woz` boot loader — `CODEGEN.md`), and `codegen/tools/wozgen.mjs` (staged bootable-`.woz`
  generator, a JS port of `emulator/dsk2woz2`). The `.woz` boot loader depends on the `$C600`
  P5 boot PROM contract (`ROM-SOFTWARE.md`) and the Disk II phase-stepping model (`EMULATOR.md`).
- **Downstream:** GitHub Pages deploy (`.github/workflows/deploy-pages.yml`) — its **Stage
  site** step stages `gamepad.js` + `virtual-keyboard.js` + `gallery.html` + `gallery.json`
  + `story.html` + `llms.txt` + `robots.txt` + `sitemap.xml` (alongside `index.html` and
  `programs/`) into `_site/`; the public users of the demo, and AI coding tools that fetch
  `llms.txt`.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| WASM build of the VM core + WozLib + SD | Shipped | `web/build.ps1`, Emscripten 6.0.1. |
| Canvas video + keyboard | Shipped | text/lo-res/hi-res, `$C000` input. |
| Mobile virtual keyboard | Shipped | Exact 1983 Apple IIe Figure 2-1 key order/widths below the canvas, minus Reset and both Apple keys; full emulator character set, one-shot Shift/Control, and the same strobe-aware `$C000` queue as physical input. |
| USB/Bluetooth gamepads | Shipped | Two stable player slots through the standard Gamepad API and shared SNES/VIA peripheral; covered by browser-mapping, serial-protocol, and ROM-table tests. |
| Disk II WOZ boot + micro-SD DOS shell | Shipped | **Boot Disk** / **Mount SD** buttons. |
| In-browser assembler (Assemble & Run) | Shipped | dual-use `asm6502.mjs`; ~11 samples; `?src=`. Sample sources fetched with `cache:"no-cache"` (revalidate) so a new deploy isn't masked by the browser cache. |
| Program downloads (.PRG / .woz) | Shipped | **Download .PRG** (raw bytes) + **Download .woz** (bootable WOZ2 via `wozgen.mjs`, a port of `dsk2woz2`, with a multi-track boot loader); verified by `web/test_woz_download.cjs`. |
| Share / Remix deep links | Shipped | **Share** button; `?src=programs/<name>.s` for unmodified samples, inline base64url `?code=` otherwise, both carrying `&org=` when the source has no `.org`; remix banner on shared links. |
| Community Gallery | Shipped | `gallery.html` renders the curated `gallery.json`; one-click **Run & Remix** via `?src=`/`?code=`; PR-based submissions credited by author. |
| Story / landing page | Shipped | `story.html` — narrative of 3ric + the wider hardware-hacking journey; lite-embed YouTube chapters (facade → `youtube-nocookie` iframe on click); a curated real-time **Reddit timeline** (16 `r/beneater`/maker milestone posts, 2020–2025, each linking to its permalink); links to emulator/gallery/tutorials + `r/beneater` / `u/ebadger1973` / 6502.org. Linked from the `index.html`/`gallery.html`/`tutorials.html` headers; staged by the deploy workflow. |
| AI-contributor entry point (`llms.txt`) | Shipped | machine-readable 65C02 codegen quickstart + links; published at the site root, staged by the deploy workflow. |
| `llms.txt` discoverability | Shipped | `<link rel="alternate">` + footer links in `index.html`/`gallery.html`; `robots.txt` + `sitemap.xml` staged (advisory on the project-page root; authoritative under a custom domain). |
| Support / funding link | Shipped | GitHub Sponsors call-to-action in the `index.html`/`gallery.html` footers; target declared in `.github/FUNDING.yml`. |
| Adjustable CPU clock | Shipped | frontend-only pacing; native **1× ≈ 1.57 MHz** (25.175 MHz VGA dot clock ÷ 16) default. |
| Slot-4 Mockingboard audio | Shipped | User-gesture AudioWorklet sink for the shared dual-AY stereo PCM; sound enabled only at 1x. |
| Headless smoke tests | Shipped | `web/test_*.cjs` (boot/render/input/audio/screen/sd/disk). |
| GitHub Pages CI deploy | Shipped | on push to `main` touching emulator/web/codegen sources. |
