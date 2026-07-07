# 3RIC — ROMS Spec

> Source of truth for every ROM image the machine and emulators consume: the monitor/OS
> ROM, BASIC, the character (font) ROM, and the hardware video-timing ROMs. The ROM image
> is part of the **shared contract** (with the memory map) across hardware, the WinUI 3
> host, and the WASM web build — change it in all three together.

---

## Purpose

Generate and own the binary ROM images: the system **monitor/OS** (`badger6502.bin`), the
**character generator** (`fontrom.dat`), and the **hardware video-timing ROMs** produced by
the `romgen` tools (`fontrom`, `syncsignals`, `videaddress`).

## Contracts / Interfaces

- **`badger6502.bin`** — the system ROM image. The first `0x10000` bytes populate the 65C02
  address space: reset vector at `$FFFC/$FFFD`, monitor/OS at `$D000–$FFFF`, and BASIC at
  `$E000` (a generic Microsoft BASIC, ~`0x3000` bytes, seeded into the BASIC region from the
  ROM image). Consumed verbatim by the hardware, the WinUI 3 host, and the web build.
- **`fontrom.dat`** — character generator used by the text renderer (5×7/7×8 glyphs;
  confirm geometry against `romgen/fontrom`).
- **Video-timing ROMs** (`romgen/syncsignals`, `romgen/videaddress`) — burned into the
  hardware video generator; define H/V sync and the video-RAM address sequence. These have
  **no software-visible address** (they drive the video circuit, not the CPU bus), but they
  define the on-screen geometry the emulators reproduce.
- Build data files live in `emulator/Data/` (`badger6502.bin`, `fontrom.dat`) and are staged
  into `web/data/` by `web/build.ps1`.

## Behaviour / Rules

- The ROM region is read-only at runtime; the monitor owns reset/IRQ/NMI vectors.
- Regenerating a ROM is a deliberate act: rebuild with the `romgen` tool, update the data
  file in `emulator/Data/`, and re-run the emulator tests + web smoke tests so hardware and
  emulators stay in lockstep.
- If a generated image changes size or layout, update `HARDWARE.md` (decode) and
  `EMULATOR.md` (load recipe) in the same commit.

## Data flow

```
romgen (C# tools) → fontrom.dat / sync ROM / video-address ROM  → burned to hardware EPROM/GAL
assembler/monitor source → badger6502.bin → emulator/Data/ → (web/build.ps1) → web/data/
Boot: CPU reset vector ($FFFC) → monitor (ROM) → optional BASIC ($E000)
```

## Dependencies

- Upstream: `romgen/` tooling (C#), `emulator/Data/` source images.
- Downstream: `HARDWARE.md` (burns these ROMs), `EMULATOR.md`/`WEB.md` (load `badger6502.bin`
  + `fontrom.dat`), `DISK.md` (Disk II boot PROM lives in the ROM image at `$C600`).

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| Monitor/OS ROM (`badger6502.bin`) | Shipped | Boots to the monitor on real hardware + both emulators |
| Character ROM (`fontrom.dat`) | Shipped | Used by all renderers |
| `romgen/fontrom` (font ROM generator) | Shipped | C# tool |
| `romgen/syncsignals` (video sync ROM) | Shipped | C# tool |
| `romgen/videaddress` (video address ROM) | Shipped | C# tool |
| Exact ROM memory map + font geometry documented here | In progress | Fill from `romgen/` + monitor source |
| BASIC provenance/version noted | In progress | Generic Microsoft BASIC (not Applesoft) — see `web/README.md` |
