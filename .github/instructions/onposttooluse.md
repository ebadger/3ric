# Spec Edit — Cross-Layer Verification

You just edited a specification or source file in one of the system layers. Before proceeding, verify cross-layer consistency.

## Layer Checklist

3RIC's layers — for any change to the **memory map, an I/O register, or a ROM**, check all of them:

- [ ] **Hardware** (`specs/HARDWARE.md` — `kicad/`, `22v10/` GAL, `logisim/`) — Is the address decode, an I/O register, or video timing affected?
- [ ] **ROMs / firmware** (`specs/ROMS.md` — `badger6502.bin`, `fontrom.dat`, `romgen/`) — Does the monitor/OS, BASIC, font, or a video ROM change?
- [ ] **Emulator core + host** (`specs/EMULATOR.md` — `emulator/Badger6502VMLib`, WinUI 3 host) — Do the CPU, VIA/ACIA, keyboard, or renderer need to match?
- [ ] **Web (WASM)** (`specs/WEB.md` — `web/`) — Does the bridge/build/UI need the same change (parity with the host)?
- [ ] **Disk** (`specs/DISK.md` — `WozLib`, `MockMicroSD`, `picodisk`) — Are the Disk II / micro-SD interfaces affected (incl. real-hardware `picodisk`)?
- [ ] **SYSTEM.md** (`specs/SYSTEM.md`) — Does the umbrella overview / memory map need updating?

## Rules

- If a change touches one layer, explicitly verify whether the others need updates before committing.
- The **memory map + ROM image** are a shared contract: a change there must land in hardware, the emulator core, and **both** hosts (WinUI + web) so they never diverge (the critical path).
- Update implementation status in the relevant spec after implementing.

## Common Mistakes

- Changing an I/O register or the memory map in the emulator but not the GAL/schematic (or vice-versa)
- Updating the WinUI host renderer but not the web bridge (or vice-versa) — the two must stay consistent
- Regenerating a ROM but not re-running the VM unit tests + web smoke tests
- Updating a spec but not its implementation-status section
