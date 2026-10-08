# The Halley Project: conversion only, no game patch

**2026-10-08 (UTC). Emulator-verified; physical-board confirmation remains open.**

The owner's disk is a self-booting, 35-track DOS-order sector image. 3RIC's disk
picker expects WOZ, not DSK. Converting it with the existing `wozgen.mjs` encoder
is sufficient: the game already executes on the unchanged 3RIC ROM and VM.
There is no game-specific adapter or replacement firmware.

## Exact artifacts

The input and output remain local. This repository does not include or download
either game image.

| Artifact | Bytes | SHA-256 |
|----------|-------|---------|
| Owner-supplied `halleyproject.dsk` | 143,360 | `f86cc6ddb805077e1d41eec8274694a250bb619e297e3f35ca828fc54ade80a8` |
| Converted `halleyproject-3ric.woz` | 234,496 | `33e23bc5f406df0e1c43c940292f1c57176181897b6e498b8e9bcb200cca0ec5` |
| Unchanged repository `badger6502.bin` | 524,288 | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

All 560 decoded WOZ sectors match the original DSK byte for byte, accounting for
DOS logical-to-physical sector order. The address/data checksums and WOZ CRC
validate. This is a format conversion, not a patch to the loader, game or disk
records. Other game revisions have not been established as compatible.

## Reproduce the conversion

From the repository root, with Node and the original image available locally:

```powershell
$inputDisk = 'C:\path\to\halleyproject.dsk'
$outputDisk = 'C:\path\to\halleyproject-3ric.woz'
@'
import fs from "node:fs";
import { createHash } from "node:crypto";
import { buildWozFromDsk } from "./codegen/tools/wozgen.mjs";

const disk = fs.readFileSync(process.argv[2]);
const hash = createHash("sha256").update(disk).digest("hex");
if (disk.length !== 143360 ||
    hash !== "f86cc6ddb805077e1d41eec8274694a250bb619e297e3f35ca828fc54ade80a8") {
  throw new Error("This is not the verified owner-supplied Halley Project disk.");
}
fs.writeFileSync(process.argv[3], buildWozFromDsk(disk), { flag: "wx" });
'@ | node --input-type=module - $inputDisk $outputDisk
```

The command refuses an existing output, including the input path. Keep both files
outside the checkout. Do not load the disk through **Load .PRG** or `BRUN`.

## Load and play

In the browser, choose **Insert .woz** and select the converted image. The corrected
disk-startup handler cold-resets the machine, lets the ROM initialize, then types
`MON` and `C600G` through the ordinary keyboard queue.

**On a deployed browser version without that fix**, insertion can leave `EH?` and
a DOS `>` prompt. Click the emulator and enter these two lines manually:

```text
MON
C600G
```

Do not press **Boot Disk** afterward: that button loads the bundled demo instead
of the selected game. On a native emulator or hardware, insert the WOZ in drive 1,
enter `MON` if the prompt is `>`, and enter `C600G` at the monitor's `*` prompt.

Use Space to advance the introductory screens and confirm the highlighted pilot
and mission as their prompts appear. Let disk loading finish between screens.
Use native **1x** speed for play.

The first controller's D-pad drives the original joystick controls; **B or X**
is the primary button. In flight, D-pad thrust changes the ship's velocity;
holding the primary button while steering left/right changes the view direction.
Keyboard **H/L** selects high/low power, **Space** brakes, and **R** enters/exits
radar. The game retains its own original input behavior; there is no browser-side
simulation or game-specific control remapping.

## What was verified

- Cold disk boot through the actual Disk II PROM, the introductory/menu sequence
  and mission startup into live flight.
- Real browser **Insert .woz** handling and queued keyboard input, not just a
  direct program-counter jump. Browser keyboard H/L changes the game's actual
  power state.
- Native VM boot with physical PS/2 make/break scan frames (160 CPU-cycle bit
  periods, DATA held for 80 cycles) through the ROM decoder.
- The original timed paddle sampler decodes neutral, all four SNES D-pad
  directions and the B/X primary button through the real VIA/ROM scan.
- Live thrust changes velocity; primary-button steering changes view heading;
  Space halves both signed velocity components; radar opens and returns to flight.
- Upper ROM stays visible for the keyboard NMI path, and the BASIC overlay stays
  off while the game uses RAM above `$9000`.
- Original and converted files remain unchanged after the local runs.

The shared VM, ROM, memory map, generated platform reference and hardware decoder
are unchanged. The browser correction is generic: **Boot Disk** and **Insert .woz**
both previously sent a command before ROM initialization and to the wrong prompt.
`web/test_disk.cjs` now executes the real page's startup functions on the ordinary
bundled disk, with/without mounted SD, and checks keyboard delivery, debugger
restoration, stale-audio draining and invalid-image status. It requires no private
Halley Project image.

**Not verified:** physical-board operation, every mission, automatic landing,
mission completion, saved-progress persistence, or arbitrary keyboard traffic
during disk loading. Native emulation is not a physical-hardware approval.
