# World Karate Championship: a disk-only 3ric port

**Revision 2 hardware-trial image; not yet confirmed on the physical board.**
The owner reported that revision 1 froze the picture and timer during SNES-only
gameplay, without keyboard input. Do not use the first candidate as a working
hardware port; retain its fingerprint below only for reproducing that failure.
This adapts the owner's supplied Apple II disk, not a rewrite of the game.
The repository contains the original adapter, guarded patcher and tests, not the
commercial game or a download of it.

## Exact artifacts

| Artifact | Bytes | SHA-256 |
|----------|-------|---------|
| Original `wckarate.dsk`, DOS sector order | 143,360 | `6d3892128898de49c24d8cebc975dd822b3880bb8536a26b8d688d321644a2ca` |
| Revision 1 `wckarate-3ric.woz` (failed hardware trial) | 234,496 | `0d2843d9711fe2389cdf119c43f97109726892900181e925a620c7061dcac23a` |
| Revision 2 `wckarate-3ric-r2.woz` (current candidate) | 234,496 | `c5b95282ebe9c901b2c1326482034260c182f70dcde6d249089143f39f28ce11` |
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
5. **The random sampler can loop forever without an Apple II video bus.** Extended
   SNES-only execution stopped in `$6D76/$86EA`, with the fight timer frozen.
   The original sampler chooses code bytes from `$6000-$60FF` and mixes three
   `$C057` reads. On 3ric those reads are not a source of changing video data.
   With `$0359=0`, constant `$C057=0`, carry set and bounded-selector limit X=1,
   the original rejection loop never returns. Revision 2 redirects only the random-byte entry
   to a nonzero 16-bit `$B400`-feedback LFSR, returning low XOR high and preserving
   X/Y. The game still owns its choice tables, AI and selection rules; the random
   sequence intentionally differs from the Apple II version.
6. **A maskable IRQ can execute scenery instead of a handler.** The first port
   kept the scenery copier's `CLI`, despite its copied IRQ vector targeting
   `$FA86`, now picture data. Holding an actual emulated Mockingboard timer IRQ
   active reproduces an instruction loop through that picture and a frozen timer.
   Revision 2 retains `SEI` throughout play. The game does not use maskable IRQs;
   keyboard NMI still works, and pending serial input is not discarded.
7. **The initial SNES latch pulse was too short.** It lasted eight CPU cycles
   (about 5 microseconds). The published SNES polling waveform uses a 12-microsecond
   latch and 6-microsecond clock phases. Revision 2 holds latch for 20 cycles
   (about 12.7 microseconds); native pin-level coverage checks the latch and both
   clock levels, rather than relying on idealized controller state alone.
   Protocol reference: [SNES controller waveform](https://github.com/llafuente/retropia/blob/master/nintendo/super-nintendo/controllers.md).

The random-choice hang and hidden IRQ handler are reproducible defects, not a
measurement of the physical board's stopped PC or IRQ source. The original short
opening-game checks missed the random-choice loop. Hardware confirmation of this
revised fingerprint is still required.

## Adapter and preservation

The bootstrap uses `$5A00-$5E08`, after the startup graphics-copy source ending
at `$59FF`. The title read later overwrites that staging area. The installed
resident occupies `$CC00-$CD74` and `$CF00-$CF9F`; whole pages
`$CC00-$CDFF/$CF00-$CFFF` are reserved for this profile, along with the waveform
page `$C800-$C8FF`. The keyboard tables, `$CAFE` nesting counter and controller
tables remain intact. These are game-specific reservations, not general free RAM.

The shared handler is the Archon adapter's existing fast PS/2 receiver and guarded
ROM-decoder forwarding path. Bank wrappers preserve both graphics banks and
recover the selected mode from interrupted X when NMI lands between a switch and
its state store. A scenery refill copies only through `$FFF7`; the eight unused
hi-res holes containing the vectors remain valid throughout the copy.

There are **24 guarded edits affecting 1,113 bytes in 16 DSK sectors**. The ProDOS
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
node codegen\tools\patch-wckarate.mjs .\wckarate.dsk .\wckarate-3ric-r2.woz
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

The game checks below passed for revision 2. The unchanged WASM build and the
assembler/boot/WOZ regressions were also exercised for this port:

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

Revision 2 also exercises the actual 65C02 generator through its full 65,535-state
period, all-zero recovery and X/Y preservation. The original bounded selector
returns for all limits 1-32 and all 256 constant `$C057` backing values (8,192
calls); the longest rejected run in the generator's complete wrapped period is
173 draws. A negative control restoring the original sampler reproduces its
static-bus hang.

Separate one- and two-player runs each execute **450 million CPU cycles** of
SNES-only gameplay with a device IRQ held active (about 286 emulated seconds per
run). They cover natural round endings and retain timer progress: 106 and 146
timer changes respectively. Focused checks also hold each Mockingboard IRQ active
while exercising movement, the timer, keyboard restart and scenery replacement.

Focused guest calls read **all eight scenery images from the disk** and refill
the cache while preserving the vectors and image bytes. This is not a claim of
winning every round to reach those scenes. Revision rejection, exclusive output
creation, all 560 WOZ sector checksums, unchanged assets and exact reversal of
the DSK patches are covered too.

Native gameplay input runs at 94-, 120- and 160-cycle PS/2 bit periods, advancing
DATA after 80 cycles. Each case covers 176 mixed keyboard/pad make/break pairs,
eight bidirectional Caps/Num Lock LED exchanges and 16 interrupted scenery copies.
The revision-2 cases hold a real serial-receive IRQ active throughout gameplay,
including the PS/2 and LED exchanges, then confirm the unconsumed serial byte is
still available. They checked 6,142 / 6,143 / 6,140
register/flags/stack/bank-preserving NMIs, including 174 / 138 / 144 at the
bank-switch/state-store boundary. The actual VIA output pins completed
109 / 112 / 103 full SNES scans, with minimum latch/clock-low/clock-high durations
of 20 / 32 / 11 CPU cycles in each case. These are emulator bus timings, not an
oscilloscope capture of the board.

Initial monitor
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
