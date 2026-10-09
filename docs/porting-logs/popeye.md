# Popeye: replacing the Applesoft supervisor, not the game

**2026-10-08 update.** The initial image reaches the title and plays music on the
physical board, but stalls after Start. A motor-spin-up correction is
emulator-verified and awaits another board trial. The owner supplied
`popeye.do.zip` and selected a disk-only port rather than a general Applesoft
implementation on 2026-10-07.

## Exact artifacts

The input, extracted files and converted disk remain local. This repository
contains the original 65C02 supervisor, guarded converter and tests, not game
assets or a downloadable game.

| Artifact | Bytes | SHA-256 |
|----------|-------|---------|
| Owner-supplied `PopEye.do` | 143,360 | `cf399cc69ea391774ea64057975b6402978569332e23951721fb1d618fe3366c` |
| Initial `popeye-3ric.woz` (physical post-title stall) | 234,496 | `a397191f443df1ed90f4048f6db7c9c540555db170eaa784b577c3f468aa0330` |
| Revised `popeye-3ric-spinup.woz` candidate | 234,496 | `2f24f71c439d034299b0e84a2340c87d5a917a10b2cbdfef43aa541c24b7cd3e` |
| Unchanged repository `badger6502.bin` | 524,288 | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The ROM fingerprint is the canonical file, not a readback of the physical board.
The converter checks it on the host; this port does not include an on-machine
full-ROM identity check.

## Why simple disk conversion does not work

The disk is a standard 35-track, 16-sector DOS-order image. Its `HELLO` runs
`POPEYE`, an Applesoft launcher. That program loads the title and music and
then selects `BASIC` or the Mockingboard-enabled `BASIC2`.

These are not just optional greeting screens: BASIC manages file loading,
three levels, difficulty, lives, game-over and restarting. The supplied
machine-code engine returns events to BASIC. It also calls Applesoft's random
routine at `$EFAE` and consumes the random byte at `$9E`. On the unchanged
3ric ROM, the original disk returns to the monitor instead of launching the game.

The game itself is already separate: the three `P.OB*` engines load at `$6000`,
`P.ANM` provides animation/code/state through `$95FF`, and `RP` expands the
three packed backgrounds into both hi-res pages. Keeping those pieces avoids
rewriting the gameplay or importing a different firmware.

## The disk-only adaptation

`codegen\tools\patch-popeye.mjs` validates the exact source disk, DOS catalog,
sector-list geometry/counts/overlaps and every required binary header. It
assembles `codegen\patches\popeye-3ric.s`, replaces track 0's DOS bootstrap,
applies **41 guarded compatibility edits**, and encodes standard WOZ2 sectors
using the existing `wozgen.mjs`. Reversing those edits reproduces every source
byte outside the replaced boot track. All 560 output sectors are decoded and
compared in the integration check.

The revised 2,249-byte supervisor lives at `$A000-$A8C8`, loaded from nine boot-track
sectors. A callback at `$0801` re-enters it after the real `$C65C` reader finishes
a sector; `$0900` is a temporary sector buffer. File descriptors point to the
original DOS file sectors, strip the four-byte binary headers and support
unaligned destinations such as `$6CC8`. Later levels are read from the floppy,
not embedded snapshots. Keep the disk inserted.

The adapter keeps upper ROM visible and turns off the lower BASIC overlay.
It does not allocate private code in `$C800-$CFFF`, replace the hardware NMI vector,
change the ROM, or alter the VM, browser bridge, platform reference or hardware
decoder. The ROM can briefly expose its banked input implementation during NMI
and then restore the supervisor's RAM.

The compatibility edits are limited to the three engines' input/random calls
and two title-music instructions:

- Real SNES latch/clock/data pins supply controller 1. Digital axes preserve the
  game's inverted paddle convention: low values mean right/down, high values
  mean left/up, and the center is 105. Release stops and opposites cancel.
- Keyboard characters use the existing ROM receiver. Directions latch until
  another direction or **X**; this also works in the browser, whose input API
  supplies characters rather than hardware key-up state. Space creates a short
  punch burst. The original movement, climbing and punch animation remain.
- An original 16-bit LFSR supplies `$9E` instead of entering Applesoft at `$EFAE`.
  This preserves random decisions, not the original random sequence.
- The original title driver still programs slot-4 AY/VIA hardware, but its
  timer is polled with IRQ masked; its entry returns as a subroutine instead of
  assuming Apple's interrupt-stack convention. Gameplay uses the supplied
  Mockingboard engine and sound driver directly.

The supervisor retains the original three-level cycle, decreasing delay and
difficulty floors, score/high-score digits, lives, death animation cleanup and
both game-over routes. The unusual original missed-item rule is retained:
restarting after ten misses begins with a 40-item goal; an ordinary last-life
restart begins with 20. No score is written to the disk.

Unused onboard paddle-timer interrupts are masked during play and the previous
VIA interrupt enables are restored on exit. No input-VIA sound-card probe is
performed. Sound is the disk's **fixed slot-4 Mockingboard variant**; there is
no automatic speaker-only fallback. Pitch and speed remain tied to 3ric's
native clock, with no Apple II clock compensation.

## Physical post-title stall and motor restart

On 2026-10-08 the owner confirmed the initial image boots on physical 3ric
through the Pico disk interface. Start is recognized: the music stops and the
screen changes to `LOADING POPEYE - RELEASE KEYS`, where it remains. This is
not evidence that the deferred SNES timing issue caused the stall.

The supervisor stops the motor while waiting at the title, then immediately
seeks when loading the first game file. A trace of the initial image starts
changing head phases only **35 CPU cycles after motor-on**.

The checked-in Pico firmware has a different scheduling boundary from WozLib:

- `core1()` in `emulator/picodisk/exe/picodisk.cpp`: disk-register
  actions happen before accumulated `AddCycles`, and background clock service
  runs only while `IsRunning()` is true.
- `emulator/picodisk/exe/DriveEmulator.cpp` waits 1,023,000 internal cycles before
  setting the motor running.
- `emulator/picodisk/exe/WozDisk.cpp` defers head settlement by 1,000 cycles.
  While the motor is starting, a later phase-off access can replace the pending
  magnetic field before the elapsed seek delay is processed. WozLib rotates
  immediately and therefore does not expose that dropped-step behavior.

Replaying the actual old loader's disk operations against those scheduling
rules ends at **track 23 while requesting track 27**. The ROM then keeps
searching for an address field that never arrives. This is a source-based
timing replay, not a capture from the owner's Pico or a full firmware simulation.

The revised loader starts the motor once per loading session and performs
twelve bounded ROM delays with data-latch reads between them, allowing the
Pico's motor-start clock to advance before any phase changes. The first phase
now occurs **2,387,248 emulated CPU cycles after motor-on**; the same replay
reaches the requested track 27. The motor stays enabled across sectors and
files, then stops at the same title/gameplay boundaries as before.

The new native regression fails on the old supervisor with
`Head phase changed before motor spin-up completed`. With the correction it
checks at least 1,573,438 cycles before the first phase, periodic data-latch
reads, no repeated motor-on while loading, and all three level restarts after
a delayed title Start. The actual-image native and WASM gameplay/lifecycle
checks pass. No ROM, Pico firmware, VM or controller-timing change is included.
The revised disk still needs the owner's physical-board confirmation.

## Generate and play

Extract the owner's archive locally, then:

```powershell
node codegen\tools\patch-popeye.mjs .\PopEye.do .\popeye-3ric-spinup.woz
```

The output must not already exist, even if it names the input. Wrong disk or ROM
fingerprints fail before writing a file.

In [3RIC Studio](https://ebadger.github.io/3ric/), choose **Insert .woz...** and
select the result. If the DOS shell shows `>`, enter **`MON`**, then **`C600G`**
at the monitor's `*` prompt. The same monitor command boots it on the physical
machine after cold reset and disk insertion. Use **1x** for sound, click the
browser canvas once to enable audio, and release keys during disk loading.
At native speed, disk loading takes tens of seconds; the loading screen is
not a hung game.

For a physical-board trial, start with the keyboard. The current SNES adapter
has an unresolved timing limitation described below; emulator controller
success is not proof that a physical controller will latch reliably.

| Action | Keyboard | Controller 1 |
|--------|----------|--------------|
| Start title / restart after game over | Any key | Start, B, A or X |
| Move / climb | WASD or arrows | D-pad |
| Stop | X | Release D-pad |
| Punch | Space | B, A or X |
| Return to monitor | Q or Escape during play | Keyboard required |

## Executed coverage and limits

```powershell
pwsh -NoProfile -File web\build.ps1
node codegen\tools\patch-popeye.test.mjs --disk .\PopEye.do
pwsh -NoProfile -File codegen\tools\patch-popeye.test.ps1 -InputDisk .\PopEye.do
node codegen\tools\asm6502.test.mjs
node web\test_boot.cjs
node web\test_woz_download.cjs
```

The build and existing checks passed for the initial port; the actual-image
native/WASM checks, assembler checks and ROM boot were rerun successfully for
the 2026-10-08 correction. The WASM check cold-boots the actual output, produces real title and
gameplay PCM, moves left/right, climbs/descends, punches, checks release/opposites
and keyboard stop, loads all three levels repeatedly, covers both game-over
routes and both restart input paths, retains high score, and executes a typed
monitor command after quitting. It also checks output exclusivity, disk/ROM
rejection, all sector round trips and unchanged unrelated disk data.

Level completion, collision and ladder-position checks use **explicit controlled
fixtures inside the running original engine**. They exercise its event returns
and the complete supervisor/disk-loading path; they are not an unassisted
playthrough. Without `--disk`, the JavaScript suite uses synthetic DOS data and
reports game integration as skipped.

The level-cycle check reaches the **speed** floor, but its six completions only
reduce **difficulty from 60 to 30**. Despite its printed "difficulty/speed floors"
message, it does not reach difficulty 1 or check the applied difficulty byte
`$FB`. That specific long-play coverage remains missing.

The native check boots from the generated WOZ and uses actual PS/2 scan frames,
not injected ASCII, for title/gameplay input. At both **120- and 160-cycle bit
periods**, with DATA changing 80 cycles after the falling edge, it covers
three levels, SNES motion/release, **82 make/break characters** and **2,706
register/flags/stack/bank-preserving NMIs** per case.

## Review findings retained by owner decision

On 2026-10-07, the owner chose to keep this exact candidate and document both
non-blocking GPT-review findings rather than spend another implementation and
re-review cycle:

- **Physical SNES timing:** `scan_pad` holds PB6 high for eight CPU cycles,
  approximately 5.1 microseconds, and reads the first bit without a deliberate
  post-latch delay. The [documented SNES sequence](https://gamesx.com/controldata/snesdat.htm)
  uses a 12-microsecond latch and a 6-microsecond interval before clocking.
  Physical controllers may not latch/read reliably. The current emulator
  snapshots on the latch edge without modeling those pulse widths, and the
  native test does not assert signal timing.
- **Difficulty-floor coverage:** the integration check stops at difficulty 30,
  not its floor of 1, and does not assert `$FB`. The recommended follow-up is
  enough level transitions to reach and remain at 1, checking both supervisor
  and engine difficulty after each load.

Those two deferrals did not change the initial candidate's fingerprint.
The later motor-restart correction is separate and leaves both limitations open.

**Still open:** physical-board confirmation, a complete human playthrough,
Caps/Num Lock LED-command exchanges, sound quality/clock tuning, and arbitrary
keyboard traffic during disk loading, plus the two findings above.
This is an emulator-verified hardware-trial
candidate, not a claim that every board, ROM revision or Popeye disk is supported.
