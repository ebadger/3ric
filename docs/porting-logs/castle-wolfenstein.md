# Castle Wolfenstein: a disk-only keyboard and SNES port

**2026-10-05. Emulator-verified candidate; not yet confirmed on the physical board.**
The owner supplied the French DOS-order disk, first approved a keyboard-only port,
then requested independent movement and aiming on one SNES controller. Floppy-save
persistence remains explicitly out of scope.

## Exact artifacts

The game and generated disk stay local. The repository contains only guarded byte
replacements, original resident source, a converter using the existing WOZ encoder,
and tests.

| Artifact | Bytes | SHA-256 |
|----------|-------|---------|
| Owner's `Castle_Wolfenstein_1981_Muse_fr_cr_GGM.do` | 143,360 | `82f12169a75fbb26472df750a8b31883bd73ef6d68df58a0f81e5ac569ac7239` |
| Preserved keyboard-only `castle-wolfenstein-3ric.woz` | 234,496 | `6089e8c8c294635a09430ceb053e5d94d959f1034b4e34b3a5b0b56948f6812d` |
| Current `castle-wolfenstein-3ric-snes.woz` | 234,496 | `c7988ffe09cb4397d6d6a828a63faeae72755d75e084fac61b44ef0f7aef7ec6` |
| Unchanged repository `badger6502.bin` | 524,288 | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The ROM fingerprint identifies the repository file, not a physical-board readback.
The patcher checks it on the host; no on-machine ROM fingerprint guard is installed.

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

## Exact changes

These are **DOS-order file offsets**, not physical WOZ sector numbers.
The keyboard-only baseline, retained by the SNES version:

| Raw offset | Loaded location | Change |
|------------|-----------------|--------|
| `$00CE7` | DOS `$9DE7` | Jump to DOS initialization at `$9DEA`, preserving its cold-start flag, instead of the BASIC cold-start vector. |
| `$00D42` | DOS `$9E42` | Select command `$34` (BRUN) rather than `$06` (RUN). |
| `$01975` | DOS `$AA75` | Replace the default greeting name `^HELLO` with `@INIT`. |
| `$0C502` | `@WOLF` binary header | Extend the loaded length from `$16EB` to `$16EE`. No sector allocation changes. |
| `$0AFEC` | `@WOLF` `$1EF8` | Replace the BASIC jump and three checked `$FF` padding bytes with `STZ $C000; JMP $FF59`. The image ends at `$1EFD`, below the original `$1F00` input driver. |
| `$0D602` | `@INIT` `$0B7E` | Use `$FF59` rather than `$E000` if its final BRUN returns. |

The baseline changes **16 byte values in six logical sectors**. The current SNES
version changes **697 byte values in 16 logical sectors**, including the resident
and its file allocation. Reversing the returned sector replacements reproduces the
original `.do` exactly. The raw input has no track-bitstream layout
to preserve; the existing `wozgen.mjs` encodes all 560 sectors into standard WOZ2,
including sector checksums and the container CRC. Decoding every output sector
recovers exactly the patched DOS-order image.

The SNES resident is **542 bytes at `$C800-$CA1D`**, borrowing inactive ROM FAT32
workspace only while this floppy game runs. It leaves `$CAFE`, the `$CB00` key-state
table, and `$CE00` input state untouched. This is not a general free-RAM declaration.
`@INIT` grows from 4,675 to 5,321 bytes, adding checked, previously empty DOS sectors
**track 4 / logical sectors 0 and 1**. Its binary header, sector list, catalog count
and VTOC bitmap are updated together. The disk loads a staging copy at `$1B00` and
a 41-byte installer at `$1D20`, ending at `$1D48` below the original `$1F00` driver.

Hooks in `@INIT` install the resident and enable Start at the title/options. The
original K-mode driver's three entry jumps forward to resident input/fire wrappers;
its keyboard decoding and swapped-control option remain. Two hooks in `@WOLF`
enable Start after capture and merge queued action keys at the existing dispatcher.
The options label now reads `START/K --> SNES+KB`.

The resident clocks the actual SNES shift register on VIA1 PB6/PB7 and reads PB5.
It does not fake browser keys for movement or aiming, call the paddle timer path,
or reconfigure the VIA. Releasing movement, retaining aim, opposing axes and
modifier actions are handled by guest 65C02 code. Keyboard movement/fire arriving
between the early scan and the action dispatcher is serviced before that dispatcher
can discard it. The original French title, DOS, castle data, sprites and speech
remain. There is no firmware, VM, bridge, global memory-map, platform-reference
or hardware-decoder change.

## Generate and play

With the exact original disk available locally:

```powershell
node codegen\tools\patch-castle-wolfenstein.mjs .\Castle_Wolfenstein_1981_Muse_fr_cr_GGM.do .\castle-wolfenstein-3ric-snes.woz
```

The tool refuses unsupported disk/ROM fingerprints, unexpected byte preimages,
input overwrite and existing outputs. It never downloads the game.

Insert the resulting WOZ in drive 1. In the browser, use **Insert .woz...** and
click the emulator screen. The current browser auto-boot can issue `C600G` at the
DOS `>` prompt and produce `EH?`; that does not eject the inserted disk. Enter
`MON` to reach `*`, then `C600G`. On a freshly reset native/physical machine,
also use `MON` first if it starts at `>` rather than `*`.

Press **Start** at the title, release it, then press **Start** again at the options.
Return then K still works. Keep native 1x speed; 3RIC's clock still determines
game speed and speaker pitch. A standard USB/Bluetooth controller uses the
browser's existing SNES mapping; L/R accept its shoulder or trigger buttons.

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
Search and queued actions stop movement while the original game handles them.
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
node codegen\tools\patch-castle-wolfenstein.test.mjs --disk .\Castle_Wolfenstein_1981_Muse_fr_cr_GGM.do
pwsh -NoProfile -File codegen\tools\patch-castle-wolfenstein.test.ps1 -InputDisk .\Castle_Wolfenstein_1981_Muse_fr_cr_GGM.do
node codegen\tools\asm6502.test.mjs
node web\test_boot.cjs
node web\test_woz_download.cjs
node web\test_gamepad.cjs
```

All passed. The input's actual local path is supplied to `--disk` / `-InputDisk`.
Without `--disk`, the JavaScript check exercises synthetic sector conversion,
patch bounds and rejection/no-output guards, and explicitly skips game integration.

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
These focused calls do not substitute for the real-game acceptance runs. A real
D-pad route reaches the first chest and R starts its opening logic; Select+R
dispatches use against that still-closed chest. Grenade dispatch is checked with
**one grenade seeded in inventory**, then the actual pad chord must consume it
without firing a bullet. That is not a claim of naturally collecting a grenade,
equipping every chest item, or completing a playthrough.

The native keyboard scenario sends **48 PS/2 packets**. Its separate SNES scenario
sends **225**, including 64 make/break pairs while the resident repeatedly clocks
the pad, plus physical monitor commands after controller exit. Odd-parity frames
go through VIA CA2/PA7 using 80-cycle half-period budgets. The stress loop restores
its temporary trampoline and verifies registers, stack, key-state and ROM/DOS
banking. Only initial monitor boot commands use latch injection. This is not a
physical keyboard waveform or LED-protocol certification.

An additional run of the existing `node web\test_disk.cjs` **failed on the unchanged
ROM/UI baseline**: it assumes reset starts at `*` and sends `C600G` to `>` without
`MON`. That separate test and the browser auto-boot were not changed by this
disk-only port. The new integration explicitly follows the real monitor workflow.

**Persistence is not supported:** `DriveEmulator::Write` switches controller lines
but does not write the supplied data into a track; `WozFile` opens images read-only.
Consequently `SAUVE LA PARTIE` is not a persistence guarantee, and Ctrl-N cannot
persist a newly generated castle. This patch deliberately does not implement
floppy writing, suppress that limitation, or claim a successful save test.

**Still open:** physical-board confirmation, complete-playthrough coverage, all
items/room transitions, analog P/J modes and Apple II clock correction.
Speaker PCM establishes signal generation, not a human speech-quality assessment.
