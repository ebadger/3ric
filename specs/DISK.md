# 3RIC — DISK Spec

> Source of truth for storage emulation and tooling: the Disk II 5.25″ floppy (`WozLib`), the
> micro-SD card (`MockMicroSD`, bit-banged SPI), the `.dsk`→`.woz` converter (`dsk2woz2`), and
> the real-hardware Raspberry Pi Pico disk/SD interface (`picodisk`).

---

## Purpose

Let Badger6502 load and run software from period-appropriate media: Disk II `.woz` floppies
and a FAT32 micro-SD card — both in the emulators and (via `picodisk`) on real hardware.

## Contracts / Interfaces

- **`emulator/WozLib`** (C++) — `DriveEmulator` + `WozDisk` + `WozFile`. Embedded in `VM`;
  reached through the standard hardware path: Disk II boot PROM at `$C600`, data registers
  `$C0E0–$C0EF` routed via `VM::DoDisk`. `insertDisk(drive, bytes)` loads a WOZ image (through
  MEMFS in the web build); booting types `C600G`.
- **`emulator/MockMicroSD`** (C++) — `SDCard` + `MappedFile`. A bit-banged **SPI** device on
  VIA1 port A: each CPU write to `$C201`/`$C20F` clocks the state machine (CS=b4, SCK=b3,
  MOSI=b2, MISO=b1 folded back). Backs a 2 GB FAT32 logical image with a lazily-allocated
  `unordered_map<sector,512>`; never-written sectors read as zero. The ROM's own FAT32 driver
  (`fat32_start`/`fat32_dir`) reads the card over SPI.
- **`sd.sparse`** (web) — compact `SDSP` container of only the non-zero 512-byte sectors of
  the 2 GB image (~11.5 MB), produced by `web/make_sd_sparse.py`; consumed by `loadSD()`.
- **`emulator/dsk2woz2`** (C++) — converts `.dsk` disk images to `.woz` (flux-level format the
  `DriveEmulator` boots).
- **`emulator/picodisk`** (C/C++, Pi Pico SDK + CMake) — the **real-hardware** disk/SD
  peripheral firmware (the physical counterpart to `WozLib`/`MockMicroSD`).

## Behaviour / Rules

- The micro-SD SPI pump is installed via `VM::CallbackWriteMemory`; every `$C201`/`$C20F`
  write advances the SD state machine — keep this contract identical across host and web.
- Self-booting machine-code floppies run; DOS 3.3 / Quick-DOS disks that auto-run an Applesoft
  greeting load DOS but trap (this clone's BASIC is generic Microsoft BASIC, not Applesoft).
- The SD/Disk register addresses and SPI bit assignment are part of the hardware contract
  (`HARDWARE.md`); changing them is a cross-layer event (hardware + emulator + `picodisk`).
- If the web SD contents change, give the image a new filename (cache-busting) and update the
  fetch path in `index.html` (see `web/README.md`).

## Data flow

```
.dsk → dsk2woz2 → .woz → insertDisk(1, bytes) → C600G → Disk II boot PROM ($C600) → game
CPU $C0E0–$C0EF ↔ DriveEmulator (WozDisk/WozFile)
CPU writes $C201/$C20F → SDCard SPI state machine → MappedFile sectors → FAT32 driver in ROM
web: fetch sd.sparse → loadSD() ;  real hw: picodisk firmware on the Pico
```

## Dependencies

- Upstream: `EMULATOR.md` (`VM`, `CallbackWriteMemory`, `DoDisk`), `ROMS.md` (Disk II boot
  PROM + FAT32 driver in `badger6502.bin`), `HARDWARE.md` (Disk II + VIA1 SD wiring).
- Downstream: `WEB.md` (`loadSD`, `insertDisk`), real hardware (`picodisk`).

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| Disk II 5.25″ floppy (`WozLib`) | Shipped | Boots WOZ images in host + web |
| Micro-SD (SPI/FAT32, `MockMicroSD`) | Shipped | DOS shell `DIR`/`CAT`/`CD`/`BRUN` work |
| `sd.sparse` generation | Shipped | `web/make_sd_sparse.py` |
| `dsk2woz2` converter | Shipped | `.dsk` → `.woz` |
| `picodisk` (Pi Pico firmware) | Shipped | Real-hardware disk/SD interface |
| DOS 3.3 / Applesoft auto-run disks | Known gap | No Applesoft in this clone — see `web/README.md` |
