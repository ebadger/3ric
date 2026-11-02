# Boulder Dash BDF04: native controller and timing adapter

**2026-10-30. Experimental / emulator-verified through real ROM DOS `BRUN`; physical-board confirmation and a full game playthrough remain open.**

The user supplied the raw BDF04 program and asked for native 3RIC controller support and
timing closer to the game's 1 MHz design target. Launch the current build as
`BRUN BDF04-1MHZ-TITLE-MUSIC.PRG 0F04`. The original game and patched outputs are local
artifacts; the repository contains only the exact-image patcher, its 30-byte assembly
replacement, tests, and this record.

## Exact artifacts

| Artifact | Size | SHA-256 |
|----------|-----:|---------|
| User-supplied `bdf04.prg` | 31,228 bytes | `bca7fa26bded86753165d5ca435277553d38faeb5d88f45d28fa70b4ea2ac0d0` |
| Earlier controller-only `BDF04.PRG` | 31,228 bytes | `2437c92dd64ff2d720328987d910faf23f374804cebec228c8c9973193046dc2` |
| Earlier timed build `BDF04-TIMED.PRG` (Apple II clock target) | 31,228 bytes | `21343268558d1e7ea6509052d7e96db9087318eebee7592cce5467a2a20d759d` |
| Earlier 1 MHz-target build `BDF04-1MHZ.PRG` (title music not retimed) | 31,228 bytes | `ae7e2a9f59d78f1b9a38fb60ea53750b4145d4db5a3f90cb5f4e80fd5a2d223a` |
| Current 1 MHz-target build `BDF04-1MHZ-TITLE-MUSIC.PRG` | 31,228 bytes | `a3221285fee7e6ade55acdf9291a1e6c575e4ae74ceebdea22df854206e5c3a0` |
| Repository `badger6502.bin` | 512 KiB | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The `.PRG` loads at `$0F04` and jumps to its game body at `$6000`. The original 30-byte
direction decoder at image address `$2284` (file offset `$1380`) is copied by the game to
runtime `$0284`. The output replaces that block with a speaker-sweep helper at `$0284`, a
music-loop helper at `$028E`, and the D-pad mapper at `$0290`, then patches nine guarded
timing sites in the game body. Compared with the original, the output remains the same length
and 58 bytes differ: the
30-byte block at file offsets `$1380-$139D`, plus the frame delay at `$1296`, fixed speaker
delay at `$1288`, the shared delay routine at `$14BB-$14C6` (loaded `$23BF-$23CA`, copied
to runtime `$03BF`), the sweep branch operand at `$136F`, and the sweep call at
`$1376-$1378`, plus title-music loop/bridge code at source `$3243-$324D` and `$325D-$3267`.
The patcher verifies the full original-image fingerprint and the original bytes at every
modified site.

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

The timing target is the game's 1.000 MHz design clock, a 1.5734375x slowdown on 3RIC's
1.5734375 MHz CPU. The shared nested delay routine at source `$23BF` changes its inner
`SBC #1` to `DEC A; NOP $00` and its outer `SBC #1` to `DEC A`; the 12-byte routine keeps
its stack depth, A=0 return, carry, and N/Z result, but does not preserve V. The frame-wait
immediate at `$219A` changes from `$1B` to `$86`, and the fixed speaker delay at `$218C`
changes from `$0A` to `$0B`. The helper at `$0284` retains the zero-count exit to the mapper,
adds one to sweep arguments 17-26 before jumping to `$03BF`, and is skipped during normal pad
polling by the `$2273` branch; the `$227A` call points to the helper. Title-music loops at
source `$3246` and `$3260` (runtime `$9246` and `$9260`) call the flag-preserving NOP/RTS
helper at `$028E`. The bridges at `$3243` and `$325D` change from a 3-cycle absolute jump to
`BRA +0; NOP`, adding two cycles on the normal loop path; together with the helper call this
adds 13 cycles to a continuing iteration and 16 to the terminal iteration.

Through the real ROM DOS `BRUN` test, the frame poll measures 124,638.75 cycles with the
original `$1B` operand and 196,333.5 with the retimed shared delay and `$86` operand
(1.57522x). The complete speaker sweep measures 20,929 cycles before and 32,937 afterward
(1.57375x); its measured speaker intervals scale by 1.56854x. Direct shared-delay calls at
A=`$00` and A=`$F0` scale by 1.58992x and 1.58916x. Fixed-tone speaker intervals measure
409 cycles before and 673 afterward (1.64548x); `$0B` is the closest one-count choice
because `$0A` gives only 1.40342x. The retimed/original ratio for 40 title-music `$C030`
intervals with live `$E4=98` and `$E5=77` is 1.56564x, 0.50% below the 1 MHz target. The test
corrects the VM's relative-branch cycle accounting and its one-cycle undercount for the
65C02 zero-page NOP.

## Generate and run

Use the exact original image at a path outside the repository; the patcher also requires its
output path to be outside the repository and refuses to overwrite an existing file:

```powershell
node codegen\tools\patch-bdf04.mjs C:\games\bdf04.prg C:\3ric-card\BDF04-1MHZ-TITLE-MUSIC.PRG
```

Copy `BDF04-1MHZ-TITLE-MUSIC.PRG` to the root of the 3RIC FAT32 card and run:

```text
BRUN BDF04-1MHZ-TITLE-MUSIC.PRG 0F04
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
then measures the title-music intervals, frame poll, shared delays, fixed-tone intervals,
and speaker sweep with corrected branch and zero-page-NOP cycle counts. The current
1 MHz-target output was generated and checked: exactly 58 bytes differ, all at the decoder
and guarded timing sites.

This establishes the mapping through the emulator's real ROM scan and DOS loader; it does not
establish a complete cave traversal, full-game behavior, or physical-board controller behavior.
