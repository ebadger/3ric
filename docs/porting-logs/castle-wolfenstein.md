# Castle Wolfenstein: a disk-only keyboard and SNES port

**2026-10-06 update. Packet-boundary correction is emulator-verified; the newest candidate needs board confirmation.**
The owner first supplied a French DOS-order disk, then requested independent SNES
movement/aiming, and subsequently supplied the intended English WOZ and reported
that keyboard actions such as U did not work in play. Both exact disk profiles now
use the corrected resident. A later report of dead Return/Caps Lock led to the
owner-approved RAM-shadowed monitor/fast NMI correction below. Floppy-save
persistence remains explicitly out of scope.
The English profile also bypasses DOS motor spin-up waits at the owner's request.
The latest input correction handles tightly spaced packets and stale startup
receive state, following the owner's observed Return-to-G misdecoding.

## Exact artifacts

The game and generated disk stay local. The repository contains only guarded byte
replacements, original resident source, a converter using the existing WOZ encoder,
and tests.

| Artifact | Bytes | SHA-256 |
|----------|-------|---------|
| Owner's `Castle_Wolfenstein_1981_Muse_fr_cr_GGM.do` | 143,360 | `82f12169a75fbb26472df750a8b31883bd73ef6d68df58a0f81e5ac569ac7239` |
| Preserved keyboard-only `castle-wolfenstein-3ric.woz` | 234,496 | `6089e8c8c294635a09430ceb053e5d94d959f1034b4e34b3a5b0b56948f6812d` |
| Earlier French `castle-wolfenstein-3ric-snes.woz` (before the U fix; preserved, superseded) | 234,496 | `c7988ffe09cb4397d6d6a828a63faeae72755d75e084fac61b44ef0f7aef7ec6` |
| Owner's English `Castle Wolfenstein - Disk 1, Side A.woz` | 234,815 | `727335c08ffc39b470f95e6b1c89de28de6ca6c3be30b0191757ec9cfc474ad3` |
| Earlier English `castle-wolfenstein-3ric-english-snes.woz` (U fix, before fast PS/2; preserved) | 234,815 | `d7c1c07775a2fb151a5c9bea0cf8a2a8eb0206527a376692d0998ff26343ba24` |
| Earlier `castle-wolfenstein-3ric-english-ps2.woz` (mechanical delays retained; preserved) | 234,815 | `07106c99054bf6408f6e4f74c19cbb8768541694b120ea03c530876542932722` |
| Earlier `castle-wolfenstein-3ric-english-fastload.woz` (packet-boundary defect remains) | 234,815 | `b29fad63fe20319006915ddfb87161969c24847c4f886ff36ae81ab765bb5cbe` |
| Current `castle-wolfenstein-3ric-english-packetfix.woz` | 234,815 | `76866ae833061c0bb2ba756c7a6d77f5cecee772731a90dd46201a989008b1c3` |
| Matching local `castle-wolfenstein-3ric-english-packet-diagnostic.woz` | 234,815 | `083507db2a8e79575be046d85247fcc825ec742612cecdb69c49816329d29582` |
| Current regenerated French output | 234,496 | `715eb08d642205d9c86cdecc18527ace1ee4dfcfa1f9321b8fcafa3bb2779a9b` |
| Unchanged repository `badger6502.bin` | 524,288 | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The ROM fingerprint identifies the repository file, not a physical-board readback.
The patcher checks it on the host. The installer also checks the 27-byte NMI proxy
ABI before patching its RAM copy; this is not a full physical-ROM fingerprint.

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

The first SNES candidate also had two keyboard-action defects. Holding the D-pad
kept movement nonzero, so the game skipped its stationary action-key dispatcher
and left U unprocessed. Merely stopping movement until U was acknowledged was
insufficient: the next pad scan restarted movement and cancelled the timed item-use
operation. A key arriving between movement polling and action dispatch exposed the
same problem even when the earlier scan saw no key.

The corrected resident lets ready keyboard actions stop movement, samples the pad
again when dispatching an action, and keeps that held D-pad paused until it is
released. A fresh direction press can deliberately cancel an interaction, but an
already-held direction no longer cancels U immediately.

## Physical PS/2 timing and LEDs

The owner reported no Caps Lock LED response at the title or in gameplay, even
though waiting eventually allowed the game to start. The earlier receive fixture
kept DATA stable for a full bit period and did not check the LED protocol; it was
not sufficient evidence for this failure.

A differential native reproduction changed DATA at the rising clock edge. At
94/47- and 120/60-cycle period/data-hold settings, the original ROM read DATA at
66-71 cycles after the scheduled falling edge: Caps `$58` became `$2C`, Return
`$5A` became `$AD`, and no LED commands were sent. At 160/80 and 160/160 it worked.
These are modeled timings, not an oscilloscope measurement of the owner's keyboard.

The approved disk-only fix copies `$D000-$FFFF` from the current ROM into
language-card bank-2/shared RAM, changes its NMI vector and three-byte NMI return
dispatch, and maps that copy **read-only**. Normal monitor/game calls retain their
original code. The new NMI front end saves only A for short PS/2 receive phases,
samples PA7 through `$C20F` before banking, and acknowledges serviced VIA sources
instead of clearing all pending interrupts. Complete packets, key decoding,
modifiers, LED command exchanges and other enabled sources still use the existing
banked ROM implementation, with A/X/Y, status, stack and banking restored.

The same differential diagnostic measured **31-34 cycles** to sample DATA, roughly
half the old delay. The instruction-boundary native acceptance harness records
31 cycles from its injected edge. This is a shorter code path, not faster RAM or a
different CPU clock. Physical bus-cycle/waveform confirmation remains open.

SNES latch/clock/data remain on PB6/PB7/PB5; keyboard DATA/interrupt use PA7/CA2.
The keyboard handler preserves interrupted state and does not toggle the pad pins,
so a paused pad scan resumes at the same bit. The native tests exercise LED-command
traffic while the actual resident repeatedly clocks the pad and compare its
sampled button tables to the supplied masks.

Exiting the game restores upper ROM visibility before entering the monitor. The
fast receiver is therefore **game-scoped**; it does not repair original firmware
timing before installation or after exit. Release keys during disk loading.
An on-machine proxy mismatch displays `3RIC INPUT ROM MISMATCH - RESET` and stops.

**Hardware follow-up, October 6:** the owner still reports intermittent Return and
Caps Lock LEDs with the PS/2 candidate. Typing the entire boot command through
physical-path PS/2 frames also passed in the native emulator; this did not reproduce
the remaining failure. Live title-screen pin/interrupt/receiver diagnostics were
prepared for the board. Do not interpret emulator success or the separate DOS
speedup below as confirmation that physical keyboard input is fixed.

**Packet-boundary follow-up:** the fast diagnostic showed ACK/KEY activity, but
Return produced `KEY=C7` rather than `$8D`, with `BYTE=80` after press/release;
A showed `KEY=00`. `C7` is G. This points to receive framing/decoding, not the
game ignoring a correctly decoded Return.

The previous tests inserted a pause and waited for the receiver to become idle
between every byte. Removing the gap between release prefix `$F0` and the released
scan code reproduced missing Caps Lock LED commands and a Return timeout on the
earlier fast-loading image. Its stop-edge path banked into the ROM before resetting
`$CE00`, so an immediately following start could see the old phase. New bits also
shared `$CE01` with a packet that the slower decoder could still be reading.

The corrected handler resets the phase and acknowledges CA2 **before banking**,
assembles the next packet in private `receive_byte` at `$CAEB`, and publishes
the completed byte to `$CE01` before entering ROM `process_key` at `$B7C0`.
`$CE01` is now a stable completed-byte value rather than the live shift register.
Installer initialization discards stale partial-frame/extended/break/modifier
prefix state while retaining the key/lock tables.

With otherwise identical device-paced input, the old candidate sends no LED
commands and fails to advance; the new candidate sends `F0 02 ED 04 F4` and
Return's raw `$5A` reaches the options screen. A separate fixture seeded
`$CE00=1/$CE01=$80` before the old installer: Return decoded as `$B4`, mapping
to `KEY=C7`. The new installer clears that stale phase and decodes `$5A`
correctly. This reproduces the reported wrong key in a controlled fixture;
it does not establish exactly when the physical board lost alignment.

The new fast-loading diagnostic shows the same live pins/flags and a VIA
interrupt-acknowledgment count (not a PS/2 command-response count). Its `BYTE`
field now shows completed scan codes. Expected Return is `BYTE=5A`, `KEY=8D`
until consumed; expected A is `BYTE=1C`, `KEY=C1`. The game and diagnostic
both pass the compact-packet native probe, but a new board trial is still needed.

## Exact changes

These are **French DOS-order file offsets**, not physical WOZ sector numbers.
The French keyboard-only baseline, retained by the SNES version:

| Raw offset | Loaded location | Change |
|------------|-----------------|--------|
| `$00CE7` | DOS `$9DE7` | Jump to DOS initialization at `$9DEA`, preserving its cold-start flag, instead of the BASIC cold-start vector. |
| `$00D42` | DOS `$9E42` | Select command `$34` (BRUN) rather than `$06` (RUN). |
| `$01975` | DOS `$AA75` | Replace the default greeting name `^HELLO` with `@INIT`. |
| `$0C502` | `@WOLF` binary header | Extend the loaded length from `$16EB` to `$16EE`. No sector allocation changes. |
| `$0AFEC` | `@WOLF` `$1EF8` | Replace the BASIC jump and three checked `$FF` padding bytes with `STZ $C000; JMP $FF59`. The image ends at `$1EFD`, below the original `$1F00` input driver. |
| `$0D602` | `@INIT` `$0B7E` | Use `$FF59` rather than `$E000` if its final BRUN returns. |

The baseline changes **16 byte values in six logical sectors**. The corrected French
SNES/PS2 version changes **1,193 byte values in 18 logical sectors**, including the
resident and its file allocation. Reversing the returned sector replacements
reproduces the original `.do` exactly. The raw input has no track-bitstream layout
to preserve; the existing `wozgen.mjs` encodes all 560 sectors into standard WOZ2,
including sector checksums and the container CRC. Decoding every output sector
recovers exactly the patched DOS-order image.

The shared input resident is **764 bytes at `$C800-$CAFB`**, borrowing inactive ROM FAT32
workspace only while this floppy game runs. It leaves `$CAFE`, the `$CB00` key-state
table and `$CE00` input storage outside the resident. Installation only resets the
documented partial-frame/prefix fields there. This is not a general free-RAM declaration.

| Profile | Original / patched `@INIT` | Staging | 214-byte installer | Added logical sectors |
|---------|----------------------------|---------|-------------------|-----------------------|
| French | 4,675 / 5,718 bytes | `$1B00` | `$1E00-$1ED5` | Track 4: 0, 1, 2, 3 |
| English | 4,798 / 5,782 bytes | `$1B40` | `$1E40-$1F15` | Track 12: 0, 1, 2, 3 |

Binary length, sector list, catalog count and VTOC allocation are updated together.
Both installers end below the `$2000` picture area. English installer staging
temporarily uses `$1F00-$1F15` before the menu copies the keyboard driver there.
It is never called while that driver is live; restarting reloads `@INIT` first.
Game exits now use the resident's ROM-restoring wrapper before `$FF59`.

Hooks in `@INIT` install the resident and enable Start at the title/options. The
original K-mode driver's three entry jumps forward to resident input/fire wrappers;
its keyboard decoding and swapped-control option remain. Two hooks in `@WOLF`
enable Start after capture and merge queued action keys at the existing dispatcher.
The labels read `START/K --> SNES+KB` in French and `START/K FOR SNES+KEY` in English.

The resident clocks the actual SNES shift register on VIA1 PB6/PB7 and reads PB5.
It does not fake browser keys for movement or aiming, call the paddle timer path,
or reconfigure the VIA. Releasing movement, retaining aim, opposing axes and
modifier actions are handled by guest 65C02 code. Keyboard movement/fire arriving
between the early scan and the action dispatcher is serviced before that dispatcher
can discard it. The original language-specific title, DOS, castle data, sprites and speech
remain. The burned ROM, VM, bridge, global memory map, platform reference and
hardware decoder are unchanged; only the game's private RAM monitor copy is patched.

## English WOZ preservation

This is an original 13-sector DOS 3.2 image with a mixed-format bootstrap, not a
16-sector disk translated from French. Its standard data fields use 411-nibble
5-and-3 encoding and two-byte `DE AA` epilogues, with self-synchronizing zero bits.
Address-sector labels are doubled on tracks 3-34. The English profile identifies
these actual on-disk labels explicitly.

The English DOS relocates its on-disk addresses while loading. Three small startup
edits preserve initialization and run `@INIT` directly:

| Physical track / sector / byte offset | Runtime change |
|-------------------------------------|----------------|
| 1 / 0 / `$D2` | `$9DD2` jumps to DOS initialization at `$9DD5`, rather than the BASIC cold-start vector. |
| 1 / 1 / `$22` | `$9E22` dispatches to DOS's binary-run handler `$A327`, rather than BASIC RUN. |
| 1 / 12 / `$B8` | The default `^HELLO` filename becomes `@INIT`. |

The English `@INIT` title poll is at `$0C56`, keyboard-driver source at `$1A9E`,
and BASIC fallback at `$0B8A`; its longer source requires later staging. The
shared `@WOLF` hooks and action logic retain the same addresses as the French game.
Extension sectors contain stale **unallocated** data, so the patcher verifies the
VTOC and exact image fingerprint rather than assuming free sectors are zero.

Only **1,137 decoded byte values in 18 sector data fields**, their encoded checksums,
and the WOZ CRC change. Reversing these field edits restores the entire original
234,815-byte file exactly. Track layout, address fields, synchronization bits,
metadata, and the separate 16-sector bootstrap are retained.

All **453 standard 5-and-3 fields** round-trip. The absent 5-and-3 fields at track
0/sector 10 and track 2/sector 12 are explicitly excluded from decoding and cannot
be edited by this profile. They are not replaced with fabricated sectors. The
generic editor's existing default 6-and-2 validation is unchanged.

## Solid-state DOS loading

Profiling the earlier English PS/2 candidate found 79 visits to DOS's mechanical
spin-up loop at `$BD7D-$BD88`, consuming about 58 of the 85 seconds before the title.
DOS compares closely spaced `$C0EC` reads to detect a running motor; equal values
repeatedly select the delay on 3RIC's electronic disk interface.

The owner requested a DOS patch because there is no physical motor. In physical
track 0 / sector 7 / byte `$7B` (normalized offset `$077B`), change opcode `$D0`
to `$80`: runtime `BNE $BD8A` becomes 65C02 `BRA $BD8A`. The branch destination and
unused loop bytes stay unchanged. This skips every DOS spin-up delay, including
the first, but keeps motor/select accesses, track positioning, data-ready polling,
address/data checksums, retries and error handling intact. The VM and Pico device's
own readiness model are unchanged; their data still has to become available.
This is **specific to 3RIC's solid-state interface, not mechanical Apple II drives**.

For the motor-only `b29fad...` candidate, reversing that byte recovers the exact
earlier `07106c...` image. The current receiver candidate adds its input correction
independently; its differential loading test reconstructs an otherwise identical
wait-enabled baseline. Castle/chest contents and frame pacing remain unchanged.

The differential check boots both full images through the unchanged ROM and
measures emulated cycles with no overclock or RAM-loaded game shortcut:

| Interval | Old cycles | New cycles | Old / new seconds at 1x |
|----------|-----------:|-----------:|-----------------------:|
| Cold `C600G` Return to title | 134,438,279 | 24,375,467 | 85.44 / 15.49 |
| Title Return to options | 6,543,744 | 1,019,555 | 4.16 / 0.65 |
| K at options to first live frame | 481,256,150 | 93,467,703 | 305.86 / 59.40 |
| Escape to monitor entry | 2,863,443 | 502,577 | 1.82 / 0.32 |
| Reboot after motor-off interval | 136,766,248 | 24,399,203 | 86.92 / 15.51 |

These are emulator measurements, not board wall-clock guarantees. The new path
must never execute the spin-up loop, must reach the cold/reboot title within
35 seconds at 1,573,437.5 Hz, and must at least halve cold-title time. It also
compares the title framebuffer and disk-loaded game binary against the old image.
Native English keyboard/SNES/LED/U checks and the unchanged French output pass.
The optimization is independent of the unresolved physical keyboard report.

## Generate and play

With the exact original disk available locally:

```powershell
node codegen\tools\patch-castle-wolfenstein.mjs ".\Castle Wolfenstein - Disk 1, Side A.woz" .\castle-wolfenstein-3ric-english-packetfix.woz
```

The same command accepts the exact French `.do` input and a different output name.
The tool refuses unsupported disk/ROM fingerprints, unexpected byte preimages,
input overwrite and existing outputs. It never downloads the game.

Cold-reset/power-cycle and insert the new WOZ in drive 1. In the browser, use **Insert .woz...** and
click the emulator screen. The current browser auto-boot can issue `C600G` at the
DOS `>` prompt and produce `EH?`; that does not eject the inserted disk. Enter
`MON` to reach `*`, then `C600G`. On a freshly reset native/physical machine,
also use `MON` first if it starts at `>` rather than `*`.

Press **Start** at the title, release it, then press **Start** again at the options.
Return then K still works. Keep native 1x speed; 3RIC's clock still determines
game speed and speaker pitch. A standard USB/Bluetooth controller uses the
browser's existing SNES mapping; L/R accept its shoulder or trigger buttons.
The English version retains its introduction and scattered DOS 3.2 reads. With
spin-up waits bypassed, allow roughly 16 seconds to the title and a further minute
from selecting controls to gameplay at 1x in the emulator; do not reset mid-load.

| SNES pad 1 | Action |
|------------|--------|
| D-pad | Move; release to stop |
| X / A / B / Y | Aim up / right / down / left |
| L | Fire; hold to repeat at the game's cadence |
| R | Search guards or open doors/chests; press once per action |
| Start | Advance title/options; continue after capture |
| Select tap | Inventory, on release |
| Select + L | Throw a grenade |
| Select + R | Use/equip contents |
| Start + Select | Quit to monitor; no emulator save persistence |

Movement and aiming work simultaneously; adjacent buttons give diagonals.
Opposing directions cancel per axis, and releasing aim retains the last direction.
Keyboard and controller actions stop movement while the original game handles them.
If the D-pad was held, release it before moving again. This lets a timed U action
finish instead of being cancelled as soon as its keyboard strobe is cleared.
Release L after a modifier chord before firing normally again; releasing Select
first does not accidentally fire a bullet. Tap/chord actions are sampled at the
game's input passes, with one pending action; quit can replace a pending non-quit
action. Controller 2 is ignored. Analog P/J modes remain separate.

The original keyboard grids remain:

```text
Move          Aim
 Q W E         I O P
 A S D         K L ;
 Z X C         , . /
```

**S** stops movement; **L** fires in the aimed direction. **Space** searches/opens,
**T** throws a grenade, **U** uses/equips, and **Return** displays inventory.
The initial keyboard-port note incorrectly called T search; the game's dispatcher
and item routines confirm the controls above. **Escape** runs the save/exit path and returns
to a usable monitor, but does **not** actually save in the current emulator.
After capture, Start or Return returns to the options; Start or K starts again from
the supplied castle.

## Executed coverage and limits

Run with the owner's original image, not the generated WOZ:

```powershell
pwsh -NoProfile -File web\build.ps1
node codegen\tools\patch-castle-wolfenstein.test.mjs
node codegen\tools\patch-castle-wolfenstein.test.mjs --disk ".\Castle Wolfenstein - Disk 1, Side A.woz"
pwsh -NoProfile -File codegen\tools\patch-castle-wolfenstein.test.ps1 -InputDisk ".\Castle Wolfenstein - Disk 1, Side A.woz"
node codegen\tools\patch-castle-wolfenstein.test.mjs --disk .\Castle_Wolfenstein_1981_Muse_fr_cr_GGM.do
pwsh -NoProfile -File codegen\tools\patch-castle-wolfenstein.test.ps1 -InputDisk .\Castle_Wolfenstein_1981_Muse_fr_cr_GGM.do
node codegen\tools\patch-archon.test.mjs
node codegen\tools\asm6502.test.mjs
node web\test_boot.cjs
node web\test_woz_download.cjs
node web\test_gamepad.cjs
```

All passed. The unchanged WASM core was built at initial setup and reused; both
native profiles compile the same shared sources. The actual local attachment path
is supplied to `--disk` / `-InputDisk`.
Without `--disk`, the JavaScript check exercises synthetic sector conversion,
patch bounds and rejection/no-output guards, and explicitly skips game integration.
The English suite also runs the differential loading check above against an
otherwise identical wait-enabled image, reconstructed by reversing only the DOS branch.

Both integrations cold-boot the generated disk through `$C600`, without injecting
game code or changing the PC to bypass loading. They exercise keyboard movement
to a different tile, stopping, aiming, a shot that consumes ammunition and produces
speaker PCM, walking into a guard and being captured, and restarting from the
original castle. Escape returns to a monitor that accepts the complete `4343`
memory-examination command. Both builds also exercise controller-only Start,
independent live movement/aim/fire, release-to-stop, capture/restart, inventory,
quit, and rebooting the still-inserted disk.

The WASM suite separately calls the **disk-installed** resident from a temporary
test trampoline to cover every direction/diagonal, opposing axes, decimal-mode
safety, controller-2 isolation, keyboard handoff, the swapped keyboard driver,
action arbitration, chord release, and resident/key-state/banking integrity.
These focused calls do not substitute for the real-game acceptance runs. On the
French disk a real D-pad route reaches the first chest and R starts its opening
logic; Select+R dispatches use against that still-closed chest. Grenade dispatch is checked with
**one grenade seeded in inventory**, then the actual pad chord must consume it
without firing a bullet. That is not a claim of naturally collecting a grenade,
equipping every chest item, or completing a playthrough.

The new U regression goes beyond observing a handler entry: it positions the player
beside the disk's real chest and shortens the opening timer, **without replacing
its contents**, then presses U with the D-pad held. The original game must finish
collecting the English chest's plans or equipping the French chest's uniform, keep
movement stopped, and resume only after a direction release/new press. Both WASM
host keys and native PS/2 scan packets pass this check. The fixture does not claim
a natural route to the English chest or a full-duration chest-opening playtest.

The expanded native keyboard scenario sends **117 packets**, the SNES
scenario **390**, and the U scenario **72**. Each cold title exercises Caps and Num
Lock on/off at **94/47, 120/60 and 160/80** cycle period/hold settings. The SNES
scenario includes **44 complete LED exchanges**, 64 mixed make/break pairs,
**4,358 register/flag/stack/bank-preserving NMIs** (2,830 while executing the
resident input prefix), and **64 exact sampled pad-table comparisons**.
The keyboard peer is shared with the existing Archon harness; its defaults retain
Archon's earlier timing, while these checks change DATA on the rising edge.
Each key release sends `$F0` and its code consecutively, with no extra delay or
decoder-idle wait. Lock-key tests send entire make/break sequences back-to-back;
additional A/G and extended-key bursts assert every completed raw byte, the
decoded ASCII and cleared prefix/key state.

The native title fixture saves/restores its volatile startup random counters around
the added LED exercises so gameplay assertions do not depend on time spent toggling
LEDs. The stress loop similarly restores its temporary caller trampoline and CPU
context; neither operation changes the generated disk. Initial boot commands still
use latch injection; in-game Return, U and lock-key checks use real scan frames.
After exit, monitor typing uses the original receiver's longer DATA hold because
that firmware path has intentionally been restored.

The WASM check also seeds stale partial-frame/prefix state before installation
and verifies that it is cleared without changing the lock-key table. It compares
the entire monitor RAM shadow against the original
ROM plus its five changed bytes, proves the shadow is write-protected, verifies
original-ROM visibility after exit, and exercises the runtime ABI mismatch stop.
Archon's native source was recompiled after extracting the shared peer; its
asset-free editor/payload tests pass, while private Archon gameplay was not rerun.
None of these checks is a measurement or approval of the physical board's LEDs.

The war plans were **not inserted for testing**. The English `CASTLE`, `BACKUP`
and `^THINGS` files match the owner's original exactly; the U fixture only changes
temporary emulator state and never writes those changes into the delivered WOZ.

An additional run of the existing `node web\test_disk.cjs` **failed on the unchanged
ROM/UI baseline**: it assumes reset starts at `*` and sends `C600G` to `>` without
`MON`. That separate test and the browser auto-boot were not changed by this
disk-only port. The new integration explicitly follows the real monitor workflow.

**Persistence is not supported:** `DriveEmulator::Write` switches controller lines
but does not write the supplied data into a track; `WozFile` opens images read-only.
Consequently either language's save message is not a persistence guarantee, and Ctrl-N cannot
persist a newly generated castle. This patch deliberately does not implement
floppy writing, suppress that limitation, or claim a successful save test.

**Still open:** board confirmation of the newest packet-boundary fix and exact
input-failure mechanism, full physical loading benchmarks, complete-playthrough coverage, all
items/room transitions, analog P/J modes and Apple II clock correction.
Speaker PCM establishes signal generation, not a human speech-quality assessment.
