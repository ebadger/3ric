# Ballblazer: keyboard and two-SNES compatibility candidate

**2026-10-07. Experimental hardware-trial image; native and WASM emulator coverage, not yet
confirmed on the physical board.** The game and generated disk stay local. This
repository contains the adapter, guarded importer and checks, not a game download.

## Exact artifacts

| Artifact | SHA-256 |
|----------|---------|
| Original 143,360-byte DOS-order disk, after gunzip | `5e0cc7aa1fd0832ceccb24e3a24f4921534e200cadc57ea96e576d02c60b0aeb` |
| Generated 234,496-byte `ballblazer-3ric.woz` | `5bda2a189572c5cdc8142de9a1d84bf7f82d528dc5eb31251e8644b4fab816e6` |
| Unchanged repository `badger6502.bin` | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The ROM hash describes the repository file, not a physical-chip readback. The guest
installer checks the NMI proxy and a checksum of the banked input implementation;
that is an ABI guard, not a full-ROM cryptographic check.

## Generate and boot

With the owner's original disk available locally and Node 22+ on PATH:

```powershell
node codegen\tools\patch-ballblazer.mjs .\ball_blazer.dsk.gz .\ballblazer-3ric.woz
```

An uncompressed `.dsk` is also accepted. Other revisions, malformed input and
existing output files are rejected. The source is never overwritten. This creates
a new self-booting WOZ; it does not preserve the original DOS catalog or add
Applesoft to 3ric.

Cold-reset/power-cycle, insert the WOZ, enter `MON` if the shell shows `>`, then
enter `C600G`. Release keys during disk loading. The supplied intro remains:
Space, SNES Start, B or X advances it. Release the button before pressing Start
again to begin a match. In the browser, use the existing Insert control and click
or tap the emulator once to enable sound.

## Controls

Both SNES controllers work without choosing the original Apple II joystick option.
Each pad controls its corresponding human player; a selected computer player
remains computer-controlled.

| SNES input | Action |
|------------|--------|
| D-pad in play | Eight-way movement; opposing directions cancel per axis |
| B or X | Fire/repulsor, using the game's original action logic |
| Start | Advance intro; start from title/options; pause/resume during a match |
| Select | Escape: enter options from the title, or leave a paused match |
| Up or Down in title/options | Cycle the selected option |
| Left or Right in title/options | Cycle that option's value |

To change options during play, Start pauses, Select leaves the match, and Select
again opens options. Tap menu controls: they act once per press, and the game's
original menu timeout still applies.

The original keyboard controls and both selectable layouts remain. The default
direction grids are:

```text
Player 1             Player 2
 W E R                U I O
 S D F                J K L
 X C V                M , .
```

D and K stop their respective players; B/Z and N/`/` fire. Return starts, Space
pauses/resumes, and Escape and the arrow/menu keys retain their original roles.
The original keyboard directions latch until changed or stopped. A held pad
direction temporarily overrides that player's keyboard direction; releasing the
pad returns to the keyboard latch, normally stopped. New rounds clear those
latches. Pad fire is combined with keyboard fire without extending its timer.

## Why an adapter is needed

The supplied DOS disk's `HELLO` is an Applesoft program that runs a 27,043-byte
binary at `$07FD`. 3ric does not supply Applesoft. Extracting the binary gets
through the intro, but the game then selects language-card RAM with no valid NMI
handler. A keypress on the unadapted game reached `$0000` rather than 3ric's ROM
keyboard handler.

The game also expects Apple II paddle timing and buttons. 3ric has serial SNES
pads on VIA1 instead. Finally, its noise routine temporarily selects upper ROM;
leaving that transition untouched would bypass the resident fast PS/2 receiver
during sound effects.

## What changes

The existing `wozgen.mjs` loader loads the extracted program and a guest installer
through the real `$C600` Disk II PROM. The installer validates the ROM ABI and
13 game preimages, then applies same-length hooks before the game's own relocation.
The first three binary bytes are an entry jump; the WOZ loads its body at `$0800`
and enters the installer at `$7200`, which eventually enters the original intro.
No host-side `setPC` or direct game RAM load is used by the acceptance boot.

The resident reserves `$C800-$C9FF`, `$CC00-$CDFF` and `$CF00-$CFFF`. It preserves
the ROM keyboard state/tables, `$CAFE`, and the `$CEE0/$CEF0` controller tables.
The shared bank-safe PS/2 receiver samples actual VIA input pins, reuses the checked
ROM decoder for complete packets and LED commands, and restores the interrupted
registers, flags, stack and bank. Its extraction leaves all existing Archon
resident, installer and bootstrap bytes unchanged.

Pad scans use the actual VIA1 latch, clock and both active-low serial data pins.
The game no longer requests analog paddle scans. Keyboard fire/direction latches
are kept separate from controller levels. A virtual menu-key latch survives the
title's repeated reads until acknowledged, gives the physical keyboard priority,
and never writes over `$C000`. Its acknowledgement cannot erase an arriving
physical key.

Upper RAM remains selected during noise effects. The otherwise-unused
`$E000-$FFFF` RAM holds the current 3ric ROM's noise bytes, except for the resident
NMI vector and the original game reset vector. The game already derives noise from
machine ROM contents; this is not an Apple II ROM replacement or a claim of
bit-identical Apple II audio. Title music and sound effects still drive `$C030`,
and timing/pitch remain tied to 3ric's native clock.

Runtime mismatches stop on `3RIC ROM MISMATCH - RESET` or
`BALLBLAZER PATCH MISMATCH - RESET`, rather than continuing into unknown code.
The ROM, VM core, browser bridge, generated platform reference and hardware address
decode are unchanged.

## Executed coverage and limits

Set `$InputDisk` to the local owner-supplied DSK/gzip. On the development machine,
put the bundled Node directory on PATH first:

```powershell
$env:PATH = "C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin;" + $env:PATH
pwsh -NoProfile -File web\build.ps1
node codegen\tools\patch-ballblazer.test.mjs --disk $InputDisk
node codegen\tools\patch-ballblazer.test.mjs
pwsh -NoProfile -File codegen\tools\patch-ballblazer.test.ps1 -InputDisk $InputDisk
node codegen\tools\patch-archon.test.mjs
node codegen\tools\asm6502.test.mjs
node web\test_boot.cjs
node web\test_gamepad.cjs
node web\test_woz_download.cjs
```

These checks pass for the fingerprint above. Without `--disk`, the Ballblazer
check runs synthetic DOS/WOZ/installer/input cases and explicitly skips real-game
integration. Without `--woz`, the Archon check likewise skips its supplied-game
integration; the extracted native Archon check also compiles.

WASM coverage cold-boots the actual output, checks the original intro/music,
both pads' movement/fire/release and opposing axes, both keyboard layouts,
keyboard fire timing and mixed input, menu selection, pause/resume and restart.
An unshortened one-minute AI match completes after 82,700,962 measured cycles
from the active-game checkpoint and can be restarted. Player structures are
sampled at an input boundary because drawing temporarily swaps the two players.
Negative cases exercise on-machine ROM/preimage rejection and CLI overwrite refusal.

Each native case uses real PS/2 scan frames with DATA held for 80 CPU cycles at
94-, 120- and 160-cycle bit periods. Each cold-boots the generated WOZ, advances
the intro with a physical Space frame, runs 240 mixed-input make/break pairs and
eight bidirectional Caps/Num Lock LED exchanges, and checks 8,283
register/flags/stack/bank-preserving NMIs. Both pads move/fire/release independently
and controller two pauses/resumes. The LED peer verifies the emulator protocol,
not the waveform or LEDs of a physical keyboard.

**Still open:** confirmation of the exact output on the physical board, actual
USB/Bluetooth-controller play on a user's browser, exhaustive scoring/AI/difficulty
and long-session coverage, and arbitrary input during the disk-loading phase.
No physical timing or original-Apple-II audio fidelity is claimed.
