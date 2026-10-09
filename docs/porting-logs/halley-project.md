# The Halley Project: hyperspace compatibility candidate

**2026-10-09 (UTC). Revised after a physical-board failure report; hardware
confirmation remains open.**

The owner's disk is a self-booting, 35-track DOS-order sector image. 3RIC's disk
picker expects WOZ, not DSK. The initial lossless conversion reached ordinary
flight in native and WASM checks, but **conversion alone was not sufficient**:
the owner reported white horizontal bands before hyperspace and a hard lockup
when turning away from the comet and holding forward into hyperspace.

The revised candidate makes five guarded disk-side edits, changing 19 bytes.
The ROM, VM and hardware remain unchanged. It addresses two reproduced
hyperspace incompatibilities; the reported white bands remain unresolved.

## Exact artifacts

The input and output remain local. This repository does not include or download
either game image.

| Artifact | Bytes | SHA-256 |
|----------|-------|---------|
| Owner-supplied `halleyproject.dsk` | 143,360 | `f86cc6ddb805077e1d41eec8274694a250bb619e297e3f35ca828fc54ade80a8` |
| Superseded conversion-only `halleyproject-3ric.woz` | 234,496 | `33e23bc5f406df0e1c43c940292f1c57176181897b6e498b8e9bcb200cca0ec5` |
| Revised `halleyproject-3ric-fixed.woz` candidate | 234,496 | `5ca981709f4736e4a5400b293612c0502c7dba6f3273f0ce8ecd8a94e75c9158` |
| Unchanged repository `badger6502.bin` | 524,288 | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The original and superseded conversion remain unchanged. The patcher checks the
original DSK fingerprint and every instruction preimage before editing a copy.
The candidate retains all other sector payload bytes and uses the existing
DOS-order WOZ encoder, including regenerated sector checksums and container CRC.
Other game revisions have not been established as compatible.

## Why hyperspace fails

The main hyperspace loop reaches `$1543: LDA $C019` / `BMI $1543` before
flipping display pages. `$C019` is Apple IIe vertical-blank status, **not a
supported 3RIC video-status register**. The emulator's initially zero byte
allowed the earlier run to continue; that was not a hardware guarantee.
Forcing the unsupported read high reproduces a permanent wait, including a
Space key remaining latched but unconsumed. This reproduces a compatible
failure mechanism, not a readback of the owner's physical machine.

Separately, the hyperspace input call enters `$0E1A`, skipping the full
`$0DB9` sampler and its `$C070` trigger. An Apple II joystick button is live,
but 3RIC refreshes its controller-backed button registers through that trigger
and the ROM SNES scan. A new B/X press therefore remains invisible during the
original hyperspace loop, even when `$C019` reads low.

| DSK byte offsets | Correction |
|------------------|------------|
| `$1A19`, `$3543`, `$BF31` | Replace the three checked five-byte `$C019` polling loops with NOPs. Keep drawing, page selection and existing software delays. |
| `$356C`, `$BF5A` | Change both checked hyperspace calls from `$0E1A` to the complete existing `$0DB9` input sampler. |

This does not add a fabricated vertical-blank register, synchronize page flips,
change the game's physics or disable keyboard interrupts.

## Generate the revised disk

From the repository root, with Node and the original image available locally:

```powershell
node codegen\tools\patch-halley.mjs C:\path\to\halleyproject.dsk C:\path\to\halleyproject-3ric-fixed.woz
```

The command refuses an unrecognized input or any existing output, including
the input path. Supply the original DSK, not the superseded WOZ. Keep both
game files outside the checkout. Do not load the disk through **Load .PRG** or
`BRUN`.

## Load and play

In the browser, choose **Insert .woz** and select the revised image. The corrected
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

## Reproduce the checks

```powershell
pwsh -NoProfile -File web\build.ps1
node codegen\tools\patch-halley.test.mjs --dsk C:\path\to\halleyproject.dsk
node web\test_disk.cjs
```

Without `--dsk`, the patcher check only covers invalid-input/usage guards and
explicitly skips the private-image integration; it is not a game-compatibility
result. With the image, it verifies every decoded sector against the exact
edits, exclusive output creation, original-image failure reproductions,
ordinary-flight preservation, repeated hyperspace distance updates, fresh B/X
and Space exits, and post-exit flight controls.

## Coverage and remaining limits

- Cold disk boot through the actual Disk II PROM, the introductory/menu sequence
  and mission startup into live flight.
- Real browser **Insert .woz** handling and queued keyboard input, not just a
  direct program-counter jump. Browser keyboard H/L changes the game's actual
  power state.
- Native VM boot with physical PS/2 make/break scan frames through the ROM decoder,
  plus mixed keyboard/controller traffic at 94-, 120- and 160-cycle bit periods
  with DATA held for 80 cycles.
- The original timed paddle sampler decodes neutral, all four SNES D-pad
  directions and the B/X primary button through the real VIA/ROM scan.
- Live thrust changes velocity; primary-button steering changes view heading;
  Space halves both signed velocity components; radar opens and returns to flight.
- Upper ROM stays visible for the keyboard NMI path, and the BASIC overlay stays
  off while the game uses RAM above `$9000`.
- The revision reaches hyperspace with `$C019` held high, advances distance
  for 120 updates on each of three visits and returns to a stopped ship using
  fresh B, X and Space input. Power selection, radar and thrust work afterward.
- Native instrumentation checked 2,979 NMIs for register, flags, return-stack
  and game-visible BASIC-overlay preservation. Nested interrupts can straddle
  the ROM's bank-selection/counter boundary; returning to that boundary need
  not immediately match the interrupted overlay, but returning to game code
  must. This is emulator instrumentation, not a physical bus trace.
- Nonzero `$FF` and `$A5` power-on RAM runs reached flight and hyperspace;
  they did not reproduce the owner's white horizontal bands.
- Input and generated host files remain unchanged after the local runs.

The shared VM, ROM, memory map, generated platform reference and hardware decoder
are unchanged. The browser correction is generic: **Boot Disk** and **Insert .woz**
both previously sent a command before ROM initialization and to the wrong prompt.
`web/test_disk.cjs` now executes the real page's startup functions on the ordinary
bundled disk, with/without mounted SD, and checks keyboard delivery, debugger
restoration, stale-audio draining and invalid-image status. It requires no private
Halley Project image.

**Still open:** the white horizontal bands reported before hyperspace, physical
confirmation of this exact candidate, every mission, automatic landing,
mission completion, saved-progress persistence and arbitrary keyboard traffic
during disk loading. The game's intentional hyperspace color inversion is
separate from the reported ordinary-flight symptom. Do not describe the latter
as fixed without a reproduction or the owner's confirmation. Native emulation
is not a physical-hardware approval.
