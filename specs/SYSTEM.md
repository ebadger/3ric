# 3ric — System Overview (SYSTEM.md)

> The umbrella spec. Keep this short — it is read at the start of every session. It
> describes the whole machine at a glance and **links to every sub-spec**; the detail lives
> in the sub-specs, read lazily.

---

## What this system is

3ric is a from-scratch **Apple-II-class 65C02 personal computer**: real hardware (KiCad
schematics, a custom PCB, and 22V10 GAL address-decode logic) plus a cycle-honest **C++
emulator** of the same machine. The emulator also compiles to **WebAssembly**, so the exact
same VM core boots the real 512 KB ROM in any browser — text/lo-res/hi-res video on a
canvas, keyboard and USB/Bluetooth gamepad input, a Disk II 5.25″ floppy, and a bit-banged
micro-SD card. A small Node **codegen** toolchain assembles 65C02 programs and validates
them headlessly on the same WASM core. The "why" lives in `docs/MISSION.md`.

## Architecture at a glance

```
   6502 ROM + software (badger6502.bin, fontrom.dat, *.s / *.prg)
                         │  executed by
                         ▼
   Emulator core — 65C02 VM in C++  (emulator/Badger6502VMLib)
     ├─ WozLib       — Disk II 5.25" floppy (.woz)        ┐ shared sources,
     ├─ MockMicroSD  — bit-banged SPI FAT32 card          ├ guarded for both
     └─ video / keyboard / SNES pads / ACIA / VIA         ┘ native + WASM
                 │                              │
   native hosts (Windows/WinUI,        Emscripten bridge (web/web_bridge.cpp)
   Console) via Badger6502VM.sln                │
                                        Browser client (web/index.html) → GitHub Pages
                                                ▲
   Codegen (codegen/): 65C02 assembler + headless harness + platform-ref
                         │  targets the same VM + memory map as
                         ▼
   Hardware (kicad/, 22v10/, logisim/, diylayout/): schematics, PCB, GAL decode
```

- **Stack:** C++17 VM core → Emscripten/WebAssembly browser build; Node.js ESM tooling
  (65C02 assembler + headless emulator harness); 6502 assembly ROM/software; KiCad + 22V10
  GAL hardware.
- **Environments:** dev = Windows + Visual Studio 2022 (native) and emsdk 6.0.1 + Node +
  Python 3 (WASM), local browser via `web/serve.ps1` (`http://localhost:8011`); prod =
  GitHub Pages (<https://ebadger.github.io/3ric/>). See `status/SYSTEM-STATUS.md`.

## Sub-specs (read only the layer you'll touch)

| Layer | Spec | Covers |
|-------|------|--------|
| Emulator core (C++ VM) | [`EMULATOR.md`](./EMULATOR.md) | 65C02 CPU, memory map, soft switches, VIA/ACIA/keyboard/gamepads/video, WozLib, MockMicroSD |
| Web / WASM client | [`WEB-CLIENT.md`](./WEB-CLIENT.md) | Emscripten build, embind bridge API, canvas/gamepad UI, in-browser assembler, Pages deploy |
| Codegen tooling | [`CODEGEN.md`](./CODEGEN.md) | `asm6502` assembler, `run6502`/`harness`, platform-ref generation, validation channels |
| ROM & software | [`ROM-SOFTWARE.md`](./ROM-SOFTWARE.md) | 512 KB ROM (monitor/DOS/BASIC), fonts, 6502 programs, `.PRG` format |
| Hardware | [`HARDWARE.md`](./HARDWARE.md) | KiCad schematics/PCB, 22V10 GAL address decode, logisim/diylayout models |

> Create each new sub-spec from [`_TEMPLATE.md`](./_TEMPLATE.md).

## Cross-cutting concerns

- **The memory map is a shared contract.** `emulator/Badger6502VMLib/vm.h` (the `MM_*` map
  + soft switches + ROM entry points) is mirrored by the 22V10 GAL decode, the web bridge,
  and `codegen/platform/platform-ref.*`. A change to any of these is a **cross-layer event**
  — update all in one commit and regenerate the platform ref.
- **Native ↔ WASM parity.** The Windows and browser builds share the VM/WozLib/SD sources;
  divergence is only allowed behind `__EMSCRIPTEN__` / `PLATFORM_WEB` guards.
- **The critical path:** the emulator must execute 6502 code faithfully enough that **the
  ROM boots to the monitor, the in-browser assembler runs programs, and disk/SD images
  load** — because the public GitHub Pages demo is the primary way the machine is
  experienced. This is what the `Badger6502VMTest` MSTest suite, the `web/test_*.cjs` smoke
  tests, and the `pre-push` assembler-test gate exist to protect.

## Implementation status (summary)

| Area | Status |
|------|--------|
| 65C02 CPU + memory map + soft switches | Shipped |
| Text / lo-res / hi-res video rendering | Shipped |
| Keyboard (`$C000`/`$C010`, physical + web virtual keyboard) + ACIA serial | Shipped |
| Two SNES pads via VIA1 + browser Gamepad API | Shipped |
| Disk II 5.25″ WOZ boot (self-booting machine-code disks) | Shipped |
| Micro-SD FAT32 + ROM DOS shell | Shipped |
| Slot-4 dual-AY Mockingboard | Shipped |
| WebAssembly browser build + in-browser assembler | Shipped |
| DOS 3.3 / Applesoft-dependent disks | Not supported (this clone's BASIC is generic MS-BASIC, not Applesoft) |
| Hardware (KiCad/PCB/GAL) | In progress (documented in the build series) |
