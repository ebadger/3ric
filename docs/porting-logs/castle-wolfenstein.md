# Castle Wolfenstein: a disk-only keyboard port

**2026-10-05. Emulator-verified candidate; not yet confirmed on the physical board.**
The owner supplied the French DOS-order disk and approved a keyboard-only port,
with the existing emulator's lack of floppy-save persistence explicitly out of scope.

## Exact artifacts

The game and generated disk stay local. The repository contains only guarded byte
replacements, a converter using the existing WOZ encoder, and tests.

| Artifact | Bytes | SHA-256 |
|----------|-------|---------|
| Owner's `Castle_Wolfenstein_1981_Muse_fr_cr_GGM.do` | 143,360 | `82f12169a75fbb26472df750a8b31883bd73ef6d68df58a0f81e5ac569ac7239` |
| `castle-wolfenstein-3ric.woz` | 234,496 | `6089e8c8c294635a09430ceb053e5d94d959f1034b4e34b3a5b0b56948f6812d` |
| Unchanged repository `badger6502.bin` | 524,288 | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The ROM fingerprint identifies the repository file, not a physical-board readback.
The patcher checks it on the host; no on-machine ROM fingerprint guard is installed.

## What failed, and why

Simply converting the `.do` to WOZ was not enough. The original reached its
SUPERDOS banner, then `$9DE7` dispatched to the BASIC cold-start vector at `$E000`.
3RIC has Microsoft BASIC rather than Applesoft. Its `$E000` trampoline jumps to
`$B234`, which the disk's DOS has already replaced with RAM code. That path returned
through an uninitialized stack and reached `$0001` instead of running the greeting.

The `^HELLO` greeting only configures DOS output and runs the machine-code `@INIT`.
The game's own startup repeats the relevant DOS configuration. It is therefore
possible to retain DOS initialization and its file loader, but select `BRUN @INIT`
directly instead of entering a BASIC interpreter. All subsequent game and asset
loads still go through the disk's DOS.

The other BASIC dependency was leaving the game. Its Escape path ends at `$E000`
after the save routine. Redirecting that jump to the ROM monitor alone initially
lost the first typed command character: the still-pending Escape was interpreted
as an Apple II monitor cursor command. Clearing `$C000` before monitor initialization
fixes that without changing the keyboard firmware.

## Exact changes

These are **DOS-order file offsets**, not physical WOZ sector numbers.

| Raw offset | Loaded location | Change |
|------------|-----------------|--------|
| `$00CE7` | DOS `$9DE7` | Jump to DOS initialization at `$9DEA`, preserving its cold-start flag, instead of the BASIC cold-start vector. |
| `$00D42` | DOS `$9E42` | Select command `$34` (BRUN) rather than `$06` (RUN). |
| `$01975` | DOS `$AA75` | Replace the default greeting name `^HELLO` with `@INIT`. |
| `$0C502` | `@WOLF` binary header | Extend the loaded length from `$16EB` to `$16EE`. No sector allocation changes. |
| `$0AFEC` | `@WOLF` `$1EF8` | Replace the BASIC jump and three checked `$FF` padding bytes with `STZ $C000; JMP $FF59`. The image ends at `$1EFD`, below the original `$1F00` input driver. |
| `$0D602` | `@INIT` `$0B7E` | Use `$FF59` rather than `$E000` if its final BRUN returns. |

Only **16 byte values in six logical sectors** change. Reversing these replacements
reproduces the original `.do` exactly. The raw input has no track-bitstream layout
to preserve; the existing `wozgen.mjs` encodes all 560 sectors into standard WOZ2,
including sector checksums and the container CRC. Decoding every output sector
recovers exactly the patched DOS-order image.

The original French title, DOS, castle data, sprites, speech and keyboard driver
remain. There is no resident adapter or firmware, VM, bridge, memory-map,
platform-reference or hardware-decoder change.

## Generate and play

With the exact original disk available locally:

```powershell
node codegen\tools\patch-castle-wolfenstein.mjs .\Castle_Wolfenstein_1981_Muse_fr_cr_GGM.do .\castle-wolfenstein-3ric.woz
```

The tool refuses unsupported disk/ROM fingerprints, unexpected byte preimages,
input overwrite and existing outputs. It never downloads the game.

Insert the resulting WOZ in drive 1. In the browser, use **Insert .woz...** and
click the emulator screen. The current browser auto-boot can issue `C600G` at the
DOS `>` prompt and produce `EH?`; that does not eject the inserted disk. Enter
`MON` to reach `*`, then `C600G`. On a freshly reset native/physical machine,
also use `MON` first if it starts at `>` rather than `*`.

At the title press **Return**, then **K** for keyboard (`CLAVIER`). Keep the native
1x speed; 3RIC's clock still determines game speed and speaker pitch.

```text
Move          Aim
 Q W E         I O P
 A S D         K L ;
 Z X C         , . /
```

**S** stops movement; **L** fires in the aimed direction. **T** searches and
**Return** displays inventory. **Escape** runs the game's save/exit path and returns
to a usable monitor, but does **not** actually save in the current emulator.
After capture, Return returns to the options; K starts again from the supplied
castle. The original P/J options remain, but analog controls and an SNES adaptation
are not part of this keyboard port.

## Executed coverage and limits

Run with the owner's original image, not the generated WOZ:

```powershell
pwsh -NoProfile -File web\build.ps1
node codegen\tools\patch-castle-wolfenstein.test.mjs
node codegen\tools\patch-castle-wolfenstein.test.mjs --disk .\Castle_Wolfenstein_1981_Muse_fr_cr_GGM.do
pwsh -NoProfile -File codegen\tools\patch-castle-wolfenstein.test.ps1 -InputDisk .\Castle_Wolfenstein_1981_Muse_fr_cr_GGM.do
node codegen\tools\asm6502.test.mjs
node web\test_boot.cjs
node web\test_woz_download.cjs
```

All passed. The input's actual local path is supplied to `--disk` / `-InputDisk`.
Without `--disk`, the JavaScript check exercises synthetic sector conversion,
patch bounds and rejection/no-output guards, and explicitly skips game integration.

Both integrations cold-boot the generated disk through `$C600`, without injecting
game code or changing the PC to bypass loading. They exercise keyboard movement
to a different tile, stopping, aiming, a shot that consumes ammunition and produces
speaker PCM, walking into a guard and being captured, and restarting from the
original castle. Escape returns to a monitor that accepts the complete `4343`
memory-examination command. The WASM check also reboots the still-inserted disk.
The native check sends **48 PS/2 packets**, with odd parity and make/break sequences
through VIA CA2/PA7 using 80-cycle half-period budgets. Only the initial monitor
boot commands use latch injection. This is not a physical keyboard waveform or
LED-protocol certification.

An additional run of the existing `node web\test_disk.cjs` **failed on the unchanged
ROM/UI baseline**: it assumes reset starts at `*` and sends `C600G` to `>` without
`MON`. That separate test and the browser auto-boot were not changed by this
disk-only port. The new integration explicitly follows the real monitor workflow.

**Persistence is not supported:** `DriveEmulator::Write` switches controller lines
but does not write the supplied data into a track; `WozFile` opens images read-only.
Consequently `SAUVE LA PARTIE` is not a persistence guarantee, and Ctrl-N cannot
persist a newly generated castle. This patch deliberately does not implement
floppy writing, suppress that limitation, or claim a successful save test.

**Still open:** physical-board confirmation, complete-playthrough coverage, all
items/room transitions, analog/controller modes and Apple II clock correction.
Speaker PCM establishes signal generation, not a human speech-quality assessment.
