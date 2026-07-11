# 3ric — Hardware Spec (HARDWARE.md)

> The physical machine 3ric is: KiCad schematics + PCB, the 22V10 GAL programmable logic
> that does address decoding and color generation, and digital-logic models. The emulator
> (`EMULATOR.md`) is the executable reference for this hardware; the two must agree —
> especially on the memory map. Much of this layer is in progress and documented in the
> YouTube build series.

---

## Purpose

Define the real 3ric computer at the board and chip level: CPU, RAM/ROM, the video circuit,
I/O (VIA/ACIA), the Disk II and micro-SD interfaces, and the glue logic that decodes the
address bus. The goal is a buildable Apple-II-class 65C02 machine whose behavior matches the
emulator.

## Contracts / Interfaces

| Artifact | Path | Role |
|----------|------|------|
| KiCad project | `kicad/3ric/`, `kicad/libraries/` | Schematics + PCB layout + symbol/footprint libraries. |
| Schematic PDF | `schematic_pdf/3ric.pdf`, `diylayout/3RIC.pdf` | Human-readable schematic snapshots. |
| DIY layout | `diylayout/3RIC.diy` | DIYLC board-layout artwork. |
| 22V10 GAL logic | `22v10/3ricDecoder.PLD`, `22v10/EB6502 DECODER.PLD`, `22v10/A2COLOR.PLD`, `22v10/3ricDecoder.si` | Address decode + Apple-II color; the **decoder mirrors the `MM_*` memory map**. |
| Logisim models | `logisim/address_decode.circ`, `logisim/apple2color.circ` | Digital-logic simulations of the decode + color circuits. |
| Memory-map check | `test/memory_map_test/memory_map_test.sln` | Validates address-map decoding. |

**The load-bearing contract:** the 22V10 address decoder (`3ricDecoder.PLD` /
`EB6502 DECODER.PLD`) and the color GAL (`A2COLOR.PLD`) must decode exactly the regions in
the emulator's `MM_*` map (`emulator/Badger6502VMLib/vm.h`) — RAM, BASIC ROM, the `$C0xx`
device/soft-switch page (keyboard, ACIA `$C1xx`, VIA1 `$C2xx`, ROM disk `$C3xx`, audio
`$C4xx`, Disk II PROM `$C6xx`), RAM2, and ROM `$D000–$FFFF`.

## Behaviour / Rules

- **Hardware and emulator are one contract.** A change to address decoding, soft switches,
  or the device map on either side is a cross-layer event: update the GAL/schematic *and*
  the emulator `MM_*` map *and* regenerate `codegen/platform/platform-ref.*` — ideally in
  one commit, or with an explicit tracked gap if the physical build lags.
- Prefer changes you can explain on camera and that keep the emulator as the faithful
  reference (see `docs/MISSION.md`).

## Data flow

`CPU address/data bus → 22V10 decoder → chip selects (RAM / ROM / BASIC / $C0xx devices) →
device responds; video circuit + A2COLOR GAL → composite/color output`. The emulator models
this same routing in `VM::DoSoftSwitches` and the device handlers.

## Dependencies

- **Upstream:** the target machine definition — i.e. the emulator's memory map and device
  behavior (`EMULATOR.md`), and the ROM that must run on it (`ROM-SOFTWARE.md`).
- **Downstream:** none in software; the physical board is the end artifact.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| Schematics (KiCad) | In progress | `kicad/3ric/`; snapshots in `schematic_pdf/`, `diylayout/`. |
| 22V10 address-decode GAL | In progress | `3ricDecoder.PLD` / `EB6502 DECODER.PLD`; mirrors `MM_*`. |
| Apple-II color GAL | In progress | `A2COLOR.PLD` + `logisim/apple2color.circ`. |
| Address-map validation | Present | `test/memory_map_test`. |
| PCB fabrication / bring-up | Tracked in build series | Emulator is the reference until hardware is verified. |
