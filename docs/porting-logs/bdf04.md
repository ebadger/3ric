# Boulder Dash BDF04: native D-pad adapter

**2026-10-29. Experimental / emulator-verified; physical-board confirmation and a full game playthrough remain open.**

The user supplied the raw BDF04 program and asked for the 3RIC controller to work natively,
launched as `BRUN BDF04.PRG 0F04`. The original game and patched output are local artifacts;
the repository contains only the exact-image patcher, its 30-byte assembly replacement, tests,
and this record.

## Exact artifacts

| Artifact | Size | SHA-256 |
|----------|-----:|---------|
| User-supplied `bdf04.prg` | 31,228 bytes | `bca7fa26bded86753165d5ca435277553d38faeb5d88f45d28fa70b4ea2ac0d0` |
| Locally generated `BDF04.PRG` | 31,228 bytes | `2437c92dd64ff2d720328987d910faf23f374804cebec228c8c9973193046dc2` |
| Repository `badger6502.bin` | 512 KiB | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The `.PRG` loads at `$0F04` and jumps to its game body at `$6000`. The direction decoder at
image address `$2284` (file offset `$1380`) is copied by the game to runtime `$0284`. The
patcher verifies both the full original-image fingerprint and the original decoder bytes,
then replaces that 30-byte routine only. The output remains the same length; 26 bytes differ,
all within file offsets `$1380-$139B`.

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
directions, higher scanned entries win (`RIGHT`, `LEFT`, `DOWN`, `UP`). The routine preserves
Y, stack depth, and carry; the game's following `TAX` consumes the result. The existing
`$C061` button path is not patched.

## Generate and run

Use the exact original image at a path outside the repository; the patcher also requires its
output path to be outside the repository and refuses to overwrite an existing file:

```powershell
node codegen\tools\patch-bdf04.mjs C:\games\bdf04.prg C:\3ric-card\BDF04.PRG
```

Copy `BDF04.PRG` to the root of the 3RIC FAT32 card and run:

```text
BRUN BDF04.PRG 0F04
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
issues `BRUN BDF04.PRG 0F04` from a sparse FAT32 card, and checks the copied decoder and
`GAMEPAD1` table at the live game poll. It verifies neutral and all four directions, horizontal
priority, the returned code in A and `$0F`, and preservation of Y, stack depth, and carry. The
separate local output was also generated and checked: exactly 26 bytes differ, all inside the
decoder site.

This establishes the mapping through the emulator's real ROM scan and DOS loader; it does not
establish a complete cave traversal, full-game behavior, or physical-board controller behavior.
