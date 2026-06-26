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
- Romdisk access through the `$C300` hardware window, and a **Load Lode Runner**
  button that launches `loderun.bin` from the romdisk.

## Layout

| File | Purpose |
| --- | --- |
| `web_bridge.cpp` | embind bridge: wraps `VM`, exposes load/run/keyboard/registers, and produces the RGBA framebuffer. |
| `web_compat.h` | Tiny shims so `WozLib`'s MSVC-isms (`OutputDebugStringA`, `sprintf_s`, `fopen_s`, `_ASSERT`, …) compile under Emscripten. |
| `build.ps1` | Compiles the core + WozLib + bridge to `badger6502.js` / `.wasm` and stages the data files. |
| `index.html` | Canvas UI + `requestAnimationFrame` driver + keyboard. |
| `serve.ps1` | Starts `python -m http.server` (defaults to port 8011). |
| `test_*.cjs` | Headless Node validations (boot, render, keyboard, screen decode, loderun). |

Build outputs (`badger6502.js`, `badger6502.wasm`) and the staged `data/`
copies are git-ignored; regenerate them with `build.ps1`.

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
bridge:          web_bridge.cpp
```

`symbols.cpp` and `Disassemble.cpp` are excluded (Windows-only). Key flags:
`-std=c++17 -O2 -lembind -sMODULARIZE=1 -sEXPORT_NAME=createBadgerVM
-sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,node`. The data files
(`badger6502.bin`, `fontrom.dat`, `loderun.bin`) are copied from
`emulator/Data` into `web/data`.

## Run in the browser

```powershell
cd web
.\serve.ps1            # python -m http.server 8011
```

Open <http://localhost:8011/index.html>, click the canvas, and type. Press
**Load Lode Runner** to launch the game from the romdisk.

> Port 8011 is used because 8000 is taken on this machine.

## Headless tests (fast iteration)

```powershell
$node = "C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe"
& $node web\test_boot.cjs        # ROM boots, sane PC, video RAM written
& $node web\test_render.cjs      # framebuffer has lit pixels
& $node web\test_keyboard.cjs    # monitor echoes typed commands
& $node web\test_screen_text.cjs # decode the text screen to ASCII
& $node web\test_loderun.cjs     # romdisk $C300 readback + Lode Runner runs in hi-res
```

## ROM load recipe (mirrors the WinUI host)

1. Write the first `0x10000` bytes of `badger6502.bin` into `VM::GetData()`
   (`loadData(0, bytes)`) — provides the reset vector at `$FFFC` and ROM/OS at
   `$D000-$FFFF`.
2. `seedBasicRom()` — `memcpy(GetBasicRom(), &GetData()[0x9000], 0x3000)`.
3. `loadRomDisk(loderunBytes)` — fills the 512KB romdisk buffer.
4. `loadFont(fontromBytes)` — used by the text renderer.
5. `reset()` — loads PC from `$FFFC/$FFFD`.

The CPU is driven cooperatively: each animation frame calls `run(maxSteps)`,
which `Step()`s the CPU and ticks the VIAs/keyboard per returned cycle (the
blocking `VM::Run()` is never used).

## How Lode Runner boots

`loderun.bin` is a raw RAM image (`4C 00 60` = `JMP $6000`) that the WinUI host
loads into the romdisk and, in its dev path, copies into RAM at `$0800`. The web
bridge mirrors this: `romDiskToRam(0x0800, 0, len)` then `setPC(0x0800)`. The
program switches into hi-res and paints the screen. The same romdisk is also
readable through the `$C300` hardware window (`writeBus`/`readBus`).
