# World Karate Championship: a disk-only 3ric port

**Experimental hardware-trial image; not yet confirmed on the physical board.**
This adapts the owner's supplied Apple II disk, not a rewrite of the game.
The repository contains the original adapter, guarded patcher and tests, not the
commercial game or a download of it.

## Exact artifacts

| Artifact | Bytes | SHA-256 |
|----------|-------|---------|
| Original `wckarate.dsk`, DOS sector order | 143,360 | `6d3892128898de49c24d8cebc975dd822b3880bb8536a26b8d688d321644a2ca` |
| Generated `wckarate-3ric.woz` | 234,496 | `0d2843d9711fe2389cdf119c43f97109726892900181e925a620c7061dcac23a` |
| Unchanged repository `badger6502.bin` | 524,288 | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The patcher rejects other disk and ROM revisions. The installer also checks the
ROM NMI proxy and the banked input-code checksum on-machine; this is an input ABI
guard, not a cryptographic readback of the physical ROM.

## What needed porting

1. **The game's disk reader starts with the wrong head record.** The ProDOS boot
   succeeds and loads `KARATE` at `$2000`, ending on block 86, track 10. The game's
   slot-6 half-track record at `$BA65` instead starts at `$60`. Its first title
   read seeks from that stale position and stalls. Setting the record to `$14`
   retains the original reader and lets it load the title and subsequent scenery.
2. **Scenery hides the keyboard interrupt handler.** The game caches an entire
   hi-res screen at `$E000-$FFFF`. It then copies the ROM vectors, including
   `$F1BB`, into RAM, but the code at that address is now scenery. Starting play
   from the keyboard can execute picture bytes rather than the input handler.
   The refill also overwrites the live vector before restoring it.
3. **Apple II analog paddles are not 3ric's SNES pads.** The original timing loop
   around `$C070/$C064/$C065` is replaced by real VIA1 latch/clock/data transactions.
   The game still chooses and animates its own moves.
4. **Sound temporarily exposed the slow ROM keyboard receiver.** Merely installing
   a RAM handler was insufficient: native PS/2 traffic nested deeply during the
   original ROM-mapped beeps. The port copies the ROM's `$D000` waveform page to
   `$C800` and uses an instruction-identical, same-page RAM `WAIT` routine.
   Gameplay waits and sound no longer hide the fast RAM receiver. Speaker events
   and waveform contents remain game/ROM-owned, not host-generated audio.

## Adapter and preservation

The bootstrap uses `$5A00-$5E08`, after the startup graphics-copy source ending
at `$59FF`. The title read later overwrites that staging area. The installed
resident occupies `$CC00-$CD4A` and `$CF00-$CF9F`; whole pages
`$CC00-$CDFF/$CF00-$CFFF` are reserved for this profile, along with the waveform
page `$C800-$C8FF`. The keyboard tables, `$CAFE` nesting counter and controller
tables remain intact. These are game-specific reservations, not general free RAM.

The shared handler is the Archon adapter's existing fast PS/2 receiver and guarded
ROM-decoder forwarding path. Bank wrappers preserve both graphics banks and
recover the selected mode from interrupted X when NMI lands between a switch and
its state store. A scenery refill copies only through `$FFF7`; the eight unused
hi-res holes containing the vectors remain valid throughout the copy.

There are **23 guarded edits affecting 1,106 bytes in 15 DSK sectors**. The ProDOS
boot blocks, directory, allocation, title and all eight original scenery images
are unchanged. Reversing the edits reproduces the original DSK byte for byte.
The output is a newly encoded standard WOZ2 because the supplied DSK contains
sector data, not an original WOZ bitstream or track-timing metadata.

No ROM, VM, browser bridge, memory-map, generated platform-reference or hardware
decoder changes are required. Archon's four emitted payloads remain byte-identical
after sharing the NMI source; the native PS/2/LED test host is shared too.

## Generate and run

With the exact original disk available locally:

```powershell
node codegen\tools\patch-wckarate.mjs .\wckarate.dsk .\wckarate-3ric.woz
```

The output must not already exist. The original input is never overwritten.
An on-machine ABI failure displays `3RIC ROM MISMATCH - RESET` instead of
continuing into incompatible input code.

Cold-reset/power-cycle and insert the output through the browser's **Insert .woz**
control or the machine's compatible Disk II image loader. To boot manually, enter
`MON` if the shell shows `>`, then `C600G`. This is a floppy image, **not a `.PRG`**.
Use native **1x** speed and click the emulator once for browser sound.

Press **Space** through the title/information screens, then **A** for Australia
or **E** for Egypt. Release keys during disk loading.

| Action | Control |
|--------|---------|
| Start/restart single player | `1`, or a fresh Start press on pad 1 during attract/play |
| Start/restart two players | `2`, or a fresh Start press on pad 2 during attract/play |
| Pad movement/move direction | D-pad; opposite directions cancel |
| Pad attack modifier | Hold B or X with a direction |
| Player 1 keyboard mode / joystick mode | Ctrl-K / Ctrl-J; joystick is the original default |
| Player 1 keyboard direction grid | E/R/T, D/F, X/C/V; Space toggles the attack modifier |
| Player 2 keyboard direction grid | U/I/O, J/K, N/M/comma; Return toggles the attack modifier |
| Pause / resume | Esc pauses; a new non-Esc key resumes |
| Sound | Ctrl-S toggles the original sound flags |

Player two's active pad takes priority over its keyboard latch; releasing it
returns to neutral rather than reviving stale movement. Both keyboard grids
retain the original game's event-driven latches, not PC-style held-key tracking.
Pad Start is edge-triggered and never overwrites an already pending keyboard
character. The initial title/location selection still uses the keyboard.

## Executed coverage and limits

The following commands passed with the fingerprints above:

```powershell
pwsh -NoProfile -File web\build.ps1
node codegen\tools\patch-wckarate.test.mjs --dsk .\wckarate.dsk
pwsh -NoProfile -File codegen\tools\patch-wckarate.test.ps1 -InputDsk .\wckarate.dsk
node codegen\tools\patch-archon.test.mjs
node codegen\tools\asm6502.test.mjs
node web\test_boot.cjs
node web\test_woz_download.cjs
```

The Karate WASM suite boots the actual generated WOZ through `$C600`, verifies the
loaded title, enters both starting locations, starts one/two-player games, exercises
both SNES pads and keyboard grids, movement and attack selection, release/opposing
directions, pause, sound and fresh/held Start. Gameplay produces real speaker PCM;
Ctrl-S produces silence after the existing DC blocker settles.

Focused guest calls read **all eight scenery images from the disk** and refill
the cache while preserving the vectors and image bytes. This is not a claim of
winning every round to reach those scenes. Revision rejection, exclusive output
creation, all 560 WOZ sector checksums, unchanged assets and exact reversal of
the DSK patches are covered too.

Native gameplay input runs at 94-, 120- and 160-cycle PS/2 bit periods, advancing
DATA after 80 cycles. Each case covers 176 mixed keyboard/pad make/break pairs,
eight bidirectional Caps/Num Lock LED exchanges and 16 interrupted scenery copies.
The cases checked 6,142 / 6,142 / 6,140 register/flags/stack/bank-preserving NMIs,
including 156 / 182 / 164 at the bank-switch/state-store boundary. Initial monitor
commands use latch injection; the title/location keys use PS/2 frames with full-period
DATA hold, and gameplay uses the shorter hold above.

Without `--dsk`, the Karate JavaScript check explicitly skips owner-disk integration.
The Archon command above ran its synthetic checks and byte-identical payload
regression, not its optional owner-disk gameplay suite.

**Still open:** physical-board confirmation, a complete playthrough and every
game-over/high-score path, and arbitrary keyboard traffic during disk loading.
Timing and speaker pitch remain tied to 3ric's native 1.5734375 MHz clock; this is
not an Apple II clock-correctness claim. The native LED peer exercises the protocol,
not a real keyboard's waveform or LEDs.
