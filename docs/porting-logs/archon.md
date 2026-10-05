# Archon: a bank-safe input compatibility candidate

**2026-10-05. Experimental hardware-trial image; not yet confirmed on the board.**
The owner supplied the disk and reported a crash after a keyboard press at the
options screen, dead Caps/Num Lock LEDs, and a board that would display after
gamepad startup but would not respond.

## Exact artifacts

Both images are 234,496-byte WOZ2 files. They remain local; this repository contains
the original adapter, guarded patcher and tests, not the game or a download of it.

| Artifact | SHA-256 |
|----------|---------|
| Original owner-supplied `archon.woz` | `a7722abdfc42ef7372b5183283b6f55464c3817b1c855256186cb5c30e600c8d` |
| `archon-3ric.woz` candidate | `a1b5a0757b189d7fbeb877a0e22785ce0967c1e5a3582548191e967caa1cb53f` |
| Unchanged repository `badger6502.bin` | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The ROM hash identifies the canonical file, not a readback of the physical board.
The installer checks the NMI proxy and a checksum of the banked input implementation;
that is a runtime ABI guard, not a full-ROM cryptographic check.

## Why the original fails

The menu renderer selects language-card RAM at `$3A7E` with `BIT $C080`.
In a native reproduction, a physical PS/2 start-bit edge while execution was at
`$3A81` sent NMI to `$0000`, not the ROM handler at `$F1BB`. The exact zero target
belongs to that emulator run; uninitialized physical RAM may contain something else.
The key has not even been decoded when this happens.

On entering the board, RAM instead supplies an effective NMI vector of `$050D`.
The joystick request at `$1F0B` (`BIT $C070`) therefore enters old disk-reading
code and stalls at `$0508`, polling `$C0EC`. This reproduces the gamepad-only
freeze without requiring a keyboard press.

A separate collision exists in the ROM's blanket `$7F` write to VIA IFR at `$F1D0`:
it can discard a PS/2 edge arriving during another input/timer interrupt. Removing
that write alone was tried in emulator memory and **was not a fix**. It left pending
sources asserted and did not repair the banked NMI vector.

## What the candidate changes

- A small boot hook loads the adapter from checked, originally zero-filled sectors
  on track 3 using the disk's existing loader. The added intro and original title
  remain; the game is not replaced or rebuilt from a different disk.
- The resident uses `$C800-$C9FF`, `$CC00-$CDFF` and `$CF00-$CFFF`, preserving
  keyboard state, key tables, `$CAFE` and both controller tables. These reservations
  are specific to this checked game/ROM pair, not generally available application RAM.
- The menu keeps a valid RAM NMI vector while interactive. Bank-select wrappers
  retain both language-card banks. If NMI interrupts the interval between selecting
  a bank and recording it, the forwarding path recognizes the saved PC and recovers
  the selected mode from saved X.
- The RAM handler samples PS/2 DATA through the VIA's non-handshaking port-A alias,
  handles the short receive phases locally, and reuses the guarded ROM decoder for
  completed packets and LED commands. It preserves A/X/Y, CPU flags, stack and banking.
- The game polls the actual SNES serial pins directly. It no longer needs the
  unused paddle-timer interrupts or keyboard-strobe NMIs. The original game's
  direction/selection/combat logic remains, with digital low/center/high axes and
  retained keyboard direction/fire latches.
- A guarded post-decompression installer patches the actual game code before it
  runs, including the source of the language-card NMI-vector bytes. Both keyboard-side
  options keep their original player assignment.

Only **29 sector data fields and the WOZ CRC** change. Original track layout,
timing, address fields, metadata and all other bits are retained. All 560 sectors
validate; reversing the edits reproduces the original file byte for byte.

## Generate and run

With the exact original disk available locally:

```powershell
node codegen\tools\patch-archon.mjs .\archon.woz .\archon-3ric.woz
```

The tool checks the input and repository ROM fingerprints, validates sectors, and
creates a new file exclusively. It refuses an existing output, including the input
path. On-machine ABI/preimage failures display `3RIC ROM MISMATCH - RESET` or
`ARCHON PATCH MISMATCH - RESET` instead of continuing into unknown code.

Cold-reset/power-cycle, insert the candidate, enter `MON` if the shell shows `>`,
then `C600G`. Use Space to advance the intro/title screens as they appear; release
keys during disk loading. On the options screen use controller 1's D-pad to point
at an option and **B or X** to select it. Select **I ACCEPT OPTIONS, BEGIN THE BATTLE**
at the bottom.

In play, each pad's D-pad moves and B/X selects or fires. The original keyboard
controls remain: **F** fires, **U/I/O, J/K/L, M/,/.** provide the direction grid.
The two-player dark/light-on-keyboard choices route the keyboard to that side.
This is a 3ric SNES adaptation, not an analog Apple II joystick or mouse driver.
Timing and speaker pitch remain tied to 3ric's clock; no Apple II clock correction
is claimed.

## Executed coverage and limits

```powershell
pwsh -NoProfile -File web\build.ps1
node codegen\tools\patch-archon.test.mjs --woz .\archon.woz
pwsh -NoProfile -File codegen\tools\patch-archon.test.ps1 -InputWoz .\archon.woz
node codegen\tools\asm6502.test.mjs
node web\test_woz_download.cjs
node web\test_boot.cjs
```

All passed for the candidate above. Without `--woz`, the JavaScript check runs
synthetic sector/editor and payload-bound checks and explicitly skips game integration.

The WASM check cold-boots the actual generated disk. It covers menu navigation,
default single-player keyboard movement, both keyboard-side choices, both controllers
and release/opposing-direction behavior, a legal move by each side into combat,
both combatants moving, and a projectile launch. It also exercises on-machine
ROM-ABI and game-preimage rejection. Passing a title framebuffer alone is not its
acceptance criterion.

Native checks use real PS/2 scan frames, changing DATA after 80 CPU cycles, at
94-, 120- and 160-cycle bit periods. Each case covers 240 mixed keyboard/gamepad
make/break pairs, eight bidirectional Caps/Num Lock LED exchanges and 8,184
register/flags/stack/bank-preserving NMIs. The cases include 13, 26 and 18 interrupts
landing at the bank-switch/state-store boundary. The initial monitor commands use
latch injection; the intro and interactive input checks use the PS/2 receiver.

**Still open:** physical-board confirmation, a complete game/playthrough, all spells,
all restart/game-over paths, and arbitrary keyboard input during disk loading.
The LED peer verifies the command/acknowledgement protocol in the native emulator;
it is not a measurement of a real keyboard's waveform or LEDs. Do not call this
hardware-approved until the owner confirms the exact output fingerprint.
