# Spy vs Spy: a deliberately splash-only experiment

The investigation was recorded on **2026-09-29**. On **2026-09-30**, the owner listed
Spy vs Spy among the titles working on hardware. Earlier recovered coverage is
detailed emulator boot/input testing, **not a standalone physical pass**. There is
no basis to say the final patch repaired the ROM keyboard race described below.

## Artifacts and original symptom

This is a self-booting machine-code WOZ2 image with 560 standard sectors.
Both original and result are **234,496 bytes**.

| Artifact | SHA-256 |
|----------|---------|
| Original `spyvsspy.woz` | `13d5c3822c5133f4c3c7411a2d6970e0a803b0239996c54a7c5bfc03084b02ce` |
| `spyvsspy-skip-splashes.woz`, later retained as `spyvsspy-patched.woz` with identical bytes | `82544a0b57e4dfe0e6816b807008c327d41f821ba64b96247e0e7489d1428cc9` |

The physical PS/2 keyboard intermittently stopped responding at the Y/N joystick
question; neither answer worked, and the owner reported inactive lock LEDs.
This was not serial input. The owner also wanted to skip the loading screens.
Those two observations produced separate investigations, not one assumed cause.

## Investigation and the deliberately narrower decision

The boot trace identified an added crack intro, then the original title-picture
load/display and delay. Unlike [A2Robots](a2robots.md), native checks found **no
game writes to `$C2xx`**, upper ROM stayed visible, and the effective NMI vector
remained `$F1BB`. Applying the Robots language-card diagnosis would have been wrong.

A reproducible ROM race did emerge. `$C010` raises the CB1 strobe-clear NMI. If a
PS/2 CA2 edge arrives while that NMI line is already asserted, the selected path
can acknowledge CB1 only, then execute the blanket clear at `$F1CE`:
`LDA #$7F; STA $C20D`. That discards the unserviced CA2 event. The PS/2 decoder is
left partway through a frame, so later releases/presses and lock-key makes can
remain misaligned rather than recovering on the next normal keypress.

One native reproduction began the `N` scan code `$31` **48 cycles after the strobe**,
with a 160-cycle bit period. It left `$CE00=$03`, `$CE01=$18`; subsequent input
failed and Caps Lock was not recognized. This is evidence of a reachable race,
not proof that every physical failure had that cause.

A diagnostic replaced acknowledgement with `STZ $C000`, avoiding the `$C010`
collision. **That direct-latch approach was not shipped.** The owner explicitly
chose a **splash-only A/B experiment**, retaining the game's input and interrupt
instructions. Neither a firmware rewrite nor a direct-latch workaround belongs
to the accepted output's explanation.

## Exact splash-only changes

Numbers in this table are hexadecimal. Sector IDs are the **physical address-field
IDs**, not DOS logical-sector order; offsets address decoded 256-byte sector data,
not raw WOZ byte positions.

| Track / sector / offset | Runtime address | Before | After | Purpose |
|-------------------------|-----------------|--------|-------|---------|
| `$00 / $0D / $06` | `$B706` | `A0 BB A9 B7 20 00 BD B0` | `A9 20 8D BF B7 4C 89 B7` | Set next track to `$20` via `$B7BF`, then jump to `$B789`, bypassing the added intro. |
| `$20 / $00 / $46` | `$4046` | `A0 00 20` | `4C 54 40` | Jump to `$4054`, skipping original picture load/display while retaining the payload path. |
| `$20 / $00 / $5E` | `$405E` | `A9 12 A0` | `4C 74 40` | Jump to `$4074`, skipping the delay but retaining final data loading/game entry. |

These are **14 decoded-byte replacements in two sectors**. The historical patcher
required the exact original hash and expected preimage bytes, wrote a new file,
re-encoded only those two sector data fields/checksums, and regenerated the WOZ
container CRC. Unrelated nibble data, track layout, timing, and metadata stayed
unchanged. A generic sector re-export would be a broader, different experiment.

All original keyboard, `$C010`, VIA, and NMI instructions remain unchanged.
Unexecuted splashes naturally omit their own waits/key handling; that is not the
same as patching the surviving input implementation.

## Loading and controls

Use the patched WOZ from a reset/power cycle. Enter `MON` if at DOS, then `C600G`.
It should reach the original **Y/N joystick question without a splash keypress**.
The question is intentionally preserved; both answers were exercised in WASM,
including `N` and the keyboard start path. No in-game control remapping was added.
The game's surviving control screens remain the reference for gameplay keys.

If the keyboard wedges again, retain the timing and exact image/ROM information
instead of treating the splash patch as proof that the input bug cannot recur.
Browser `keyDown` can bypass physical PS/2 processing; see the
[shared baseline](README.md#shared-machine-baseline).

## Recorded verification, lessons, and open questions

Earlier checks used the local image in WASM to verify no-key boot, unchanged input
code, both Y/N paths, and keyboard start. All 560 sector checksums validated;
inverse patching restored the original bytes exactly. Existing WOZ export coverage
also passed **9/9**. These results were recorded before this documentation change.

The later owner statement places the title among working hardware projects, but
does not establish whether skipping splashes reduced a collision window, changed
some other startup state, or merely coincided with a good run. There is no detailed
physical regression matrix or demonstrated permanent timing cure in this record.

The durable lessons are to separate a requested boot-flow improvement from a
reproduced firmware defect, inspect the effective vector before copying another
title's fix, and preserve the disk's surrounding encoding during an A/B test.
[A2Robots](a2robots.md) shows why a passing fixture still needs board comparison;
[Spy Hunter](spy-hunter.md) shows a different input issue caused by how the game
accessed software-backed registers, not by missing controller support.

## Historical tooling and provenance

Local-only commit `b9a1bee73d4f63e69cce539c3c9f32c927559516` created the splash patch.
The historical `codegen\tools\patch-spyvsspy.mjs` and its `.test.mjs` are not in this
docs-only checkout. Later local work factored common editing into `wozedit.mjs`,
using CRC/GCR helpers from the existing [WOZ generator](../../codegen/tools/wozgen.mjs).
The commit may not be published or available in a fresh clone; the table above
records the complete game-byte intervention without depending on that history.

The result's retained filename changed, not its contents. Keep the input and
output hashes separate from any future input-race experiment. [Porting-log index](README.md).
