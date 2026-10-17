# Flight Simulator II: one language-card NMI vector

**2026-10-16. Emulator-verified disk adapter; not yet tried on the board.**
The owner supplied a 143,360-byte DOS-order image of subLOGIC's *Flight Simulator II*
(Apple II, version 1.0, 1983) and asked for it to work on 3RIC. The image and the
generated disk stay local; this repository holds the adapter, the patcher and tests.

## Exact artifacts

| Artifact | SHA-256 |
|----------|---------|
| Owner-supplied `FlightSimulator2.dsk` | `533c25dd24ed0cdb3e29a83ec42df126583771f4dbfc1aed83848bdab67768d2` |
| Generated 3RIC WOZ2 (deterministic) | `c00b7e602c82166ef37b5e74460f7b21328acf8d8527f5f6cdb355bbfb118ebd` |
| Unchanged repository `badger6502.bin` | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The image is unprotected (standard 16-sector tracks), so the existing `wozgen.mjs`
DSK→WOZ conversion boots it through the `$C600` PROM unchanged.

## What went wrong

The plain conversion booted to the title (`WHAT DISPLAY ARE YOU USING? (TYPE A OR B)`).
Pressing a key then started an endless loop: the loader re-read tracks 7-9, called
monitor `INIT` at `$FB2F`, and started over. Tracing back from the loop:

1. Before the title, the game loads 45 sectors into language-card bank 2 / high RAM
   (`$AC9A`: `LDA $C083` twice) and points the RAM `$FFFA/$FFFC/$FFFE` vectors at
   `$A7E2` (`JMP $AA4C`, its cold-start/restart path). An Apple II never raises NMI.
2. The title's key poll acknowledges the key with `STA $C010` at `$8957`. On 3RIC
   that access raises VIA1 CB1, an **NMI**, and with language-card RAM mapped the CPU
   took the game's vector into the restart path.
3. The restart re-entered the loader with the language card still mapped, so its
   `JSR $FB2F` hit the game's RAM there (`FF FF 00 00` filler that really is on the
   disk at track `$22`), executed `BRK`, and the RAM IRQ vector restarted it again.

So the visible symptom (a loop through `INIT`) was two steps removed from the cause.
The `$FB2F` bytes were not a load failure: all 45 language-card pages matched their
sectors except `$D4xx`, which the game modifies itself.

## The adapter

Same model as [Ultima V](ultima-v.md): forward NMIs while language-card RAM is
mapped, without touching the game's other vectors or code paths.

- **Resident** (`codegen/patches/fs2/resident.s`, `$CF00-$CFFB`): the Ultima V fast
  path for PS/2 start/data/parity edges and the `$C010` strobe (no bank work before the
  DATA sample); everything else enters the ROM handler through a fake RTI frame with
  ROM selected, then returns to bank 1 or 2 read/write.
- **Which bank:** FS2 maps only read/write modes and switches banks in exactly two
  helpers, `$F8B0` (bank 1, course plotter buffer) and `$F8BC` (bank 2), each writing
  its flag `$0E43` *before* its two selecting reads. The resident restores the bank
  the flag names. An NMI between the flag write and the first read returns with the
  target bank already selected, and the next instruction (the selecting read) touches
  no language-card memory. The native test allows a bank change only at those resume PCs.
- **Install:** boot0 already loads three sectors to `$1D00-$1FFF`; its page count and
  table now also load T0 logical sector 14 (zero-filled originally) to `$2000`, and a
  21-byte hook in boot0's zero slack copies the resident (not the rest of the page, so
  `$CFFF` is untouched) to `$CF00` and calls `boot_init` before
  `JMP $1D00`. `boot_init` checks the ROM NMI vector and proxy, zeroes `$CAFE` and turns
  the BASIC overlay off. Game code: `$AC9A` clears the bank flag `$0E43` (power-on RAM
  or a restart from bank 1 could leave it set) and writes the RAM NMI vector (ROM reads,
  bank-2 writes) before RAM becomes visible; `$AD17` keeps it when the game installs
  its vectors. RESET and IRQ keep `$A7E2`.
- **Patcher:** `node codegen\tools\patch-fs2.mjs FlightSimulator2.dsk fs2-3ric.woz`
  checks both fingerprints, applies 7 byte-verified edits (275 bytes) and refuses to
  overwrite an existing file.

## Playing it

Cold boot, insert the generated WOZ, `MON` if the shell shows `>`, then `C600G`
(the web player does this automatically). `A` (colour) at the title, then `B` for
regular flight (`A` is the demo). The original Apple II keyboard controls apply,
for example **T/B** elevator, **F/H** ailerons, **G** centre, **→/←** throttle
(Apple `$15/$08`), **Q** course plotter, **Esc** editor (Return steps through its
fields). For the SNES pad set the editor's `JOYSTICK` to 1, leave the editor, and
press **B** with the D-pad released to calibrate centre; the D-pad then drives
ailerons/elevator digitally (paddle counts 0/58/~107). Browser Ctrl-key combinations
are not passed to the machine.

On 3RIC the game runs on a 1.57 MHz CPU, about 1.54x an Apple II; the frame rate
rises, while the simulation clock stayed close to real time (about 22 simulated
seconds per 20 emulated seconds in testing).

## Executed coverage

```powershell
pwsh -NoProfile -File web\build.ps1
node codegen\tools\patch-fs2.test.mjs --dsk .\FlightSimulator2.dsk
pwsh -NoProfile -File codegen\tools\patch-fs2.native.ps1
pwsh -NoProfile -File codegen\tools\port-ultima5.native.ps1   # shared harness, unchanged result
```

The WASM test cold-boots the generated disk through the Disk II PROM: resident and
vectors installed; title → flight mode with bank 2 mapped and the BASIC overlay off;
T/B/F/H/G reach their handlers, their strobes clear and the CB1 NMI source is
acknowledged; full throttle and a takeoff
read back from the editor's altitude/airspeed; the editor's joystick option with pad
calibration and all four D-pad directions; course recording with bank 1 mapped, an
injected `$C070` NMI there preserving registers/flags/bank/overlay and language-card
write-enable, and the course plot. `$CFFF` keeps a sentinel through boot and play.
It also reproduces the unpatched restart on the first key and the on-machine ROM
mismatch message. The native test types real PS/2 frames (94/120/160-cycle bits,
DATA held 80) and a Caps Lock LED exchange while a program swaps banks through
FS2-style helpers continuously; 293 NMIs per run keep registers, flags and overlay.
Each recorded-bank window is hit 8-14 times and may only return the recorded bank;
the program starts with a stale `$0E43 = 1` that `lc_on` must clear and checks
language-card writes after NMIs, including in an idle loop that never reselects.
Removing `lc_resume`'s write-enabling second read makes all three cases fail.

## Still open

Physical-board trial; scenery disks and their load path; Europe 1917 (the WWI game),
radio/navigation features, sound and the rest of the editor; the `BOOT DOS` plotter
option (it leaves the game); arbitrary keyboard input during disk loads is covered
only through the fast path, not with a scripted test. Do not call this hardware-approved
until the owner confirms the exact output fingerprint. [Porting-log index](README.md).
