# Boulder Dash BDF04: native controller and timing adapter

**2026-10-30. Experimental / emulator-verified through real ROM DOS `BRUN`; physical-board confirmation and a full game playthrough remain open.**

The user supplied the raw BDF04 program and asked for the 3RIC controller to work natively,
launched as `BRUN BDF04-TIMED.PRG 0F04`. The original game and patched outputs are local
artifacts; the repository contains only the exact-image patcher, its 30-byte assembly
replacement, tests, and this record.

## Exact artifacts

| Artifact | Size | SHA-256 |
|----------|-----:|---------|
| User-supplied `bdf04.prg` | 31,228 bytes | `bca7fa26bded86753165d5ca435277553d38faeb5d88f45d28fa70b4ea2ac0d0` |
| Earlier controller-only `BDF04.PRG` | 31,228 bytes | `2437c92dd64ff2d720328987d910faf23f374804cebec228c8c9973193046dc2` |
| Timed controller build `BDF04-TIMED.PRG` | 31,228 bytes | `21343268558d1e7ea6509052d7e96db9087318eebee7592cce5467a2a20d759d` |
| Repository `badger6502.bin` | 512 KiB | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The `.PRG` loads at `$0F04` and jumps to its game body at `$6000`. The original 30-byte
direction decoder at image address `$2284` (file offset `$1380`) is copied by the game to
runtime `$0284`. The timed output replaces that block with a speaker-delay helper at `$0284`
and the D-pad mapper at `$0290`, then patches four guarded timing sites in the game body.
Compared with the original, the output remains the same length and 33 bytes differ: the
30-byte block at file offsets `$1380-$139D`, plus the frame delay at `$1296`, fixed speaker
delay at `$1288`, sweep branch operand at `$136F`, and sweep call at `$1376-$1378`. The
patcher verifies the full original-image fingerprint and the original bytes at every modified
site.

## Controller adaptation

The original routine derives direction codes from paddle-timing state. The game already
triggers the ROM's SNES pad scan at `$C070`, so the replacement reads controller 1's
`GAMEPAD1` entries directly, scanning indices 7 down to 4. Its result codes match the game:

| Input | Game code |
|-------|-----------|
| Neutral | 0 |
| Left | 1 |
| Right | 2 |
| Up | 3 |
| Down | 4 |

The table scan preserves the game's horizontal-over-vertical priority. For simultaneous
directions, higher scanned entries win (`RIGHT`, `LEFT`, `DOWN`, `UP`). The mapper preserves
Y, stack depth, and carry; the game's following `TAX` consumes the result. The existing
`$C061` button path is not patched.

## Timing adaptation

3RIC's 1.5734375 MHz CPU is about 1.53847 times the Apple II's 1.022727 MHz clock. The
frame-wait immediate at `$219A` changes from `$1B` to `$A4`; the fixed speaker delay at
`$218C` changes from `$0A` to `$0D`. The variable sweep at `$2270` calls the new helper at
`$0284`, which changes each `X` delay argument to `X + ceil(X/4)` before jumping to the
unchanged delay routine at `$03BF`. The helper uses `$D2` as temporary storage; the existing
loop clears it after the sweep. The branch at `$2273` skips the helper during normal pad
polling, and the sweep-call operand at `$227A` points to the helper.

Through the real ROM DOS `BRUN` test, the frame poll measured 124,634 cycles with the
original `$1B` operand and 191,911.5 cycles with `$A4` (1.53980x). The same cycle-corrected
trace measured the speaker sweep at 20,929 cycles before and 32,284 cycles after retiming:
1.54170x for the measured speaker intervals and 1.54255x for the complete sweep. The
individual note intervals are not uniform because the original delay routine is quadratic.
The test corrects the VM's relative-branch cycle accounting to real 65C02 costs when
computing these ratios. The fixed speaker-delay operand is verified in live memory, but its
complete tone duration has not been measured separately.

## Generate and run

Use the exact original image at a path outside the repository; the patcher also requires its
output path to be outside the repository and refuses to overwrite an existing file:

```powershell
node codegen\tools\patch-bdf04.mjs C:\games\bdf04.prg C:\3ric-card\BDF04-TIMED.PRG
```

Copy `BDF04-TIMED.PRG` to the root of the 3RIC FAT32 card and run:

```text
BRUN BDF04-TIMED.PRG 0F04
```

The emulator test's startup sequence leaves the credits screen with Space, selects the Joyport
path with `J`, and uses controller-1 `B` before checking the live direction poll.

## Executed coverage and limits

```powershell
node codegen\tools\patch-bdf04.test.mjs
$env:BDF04_PRG='C:\path\to\bdf04.prg'
node codegen\tools\patch-bdf04.test.mjs
```

The first command assembles the replacement and checks synthetic exact-byte guards, image
immutability, and fingerprint rejection. With `BDF04_PRG`, the test boots the real ROM DOS,
issues `BRUN BDF04.PRG 0F04` from a sparse FAT32 card, and checks the copied helper and
mapper at the live game poll. It verifies neutral and all four directions, horizontal
priority, the returned code in A and `$0F`, and preservation of Y, stack depth, and carry. It
then measures the frame poll and speaker sweep with corrected branch-cycle counts. The
separate timed output was generated and checked: exactly 33 bytes differ, all at the decoder
and guarded timing sites.

This establishes the mapping through the emulator's real ROM scan and DOS loader; it does not
establish a complete cave traversal, full-game behavior, or physical-board controller behavior.
