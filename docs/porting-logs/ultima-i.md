# Ultima I Enhanced: a single-disk, RAM-save hardware candidate

**2026-10-07. Emulator-verified; not yet confirmed on the physical board.**
The owner supplied `Ultima_I-Enhanced.dsk`, selected a disk-only port for physical
3ric, and chose single-disk play. After confirming that both the current VM and
checked-in Pico floppy firmware lack disk writes, the owner explicitly deferred
persistent saving.

## Exact artifacts

Game images remain local. The repository contains only the adapter, fingerprinted
patcher and tests; it does not distribute the game.

| Artifact | Bytes | SHA-256 |
|----------|-------|---------|
| Original `Ultima_I-Enhanced.dsk` | 143,360 | `3b80cb92955436524ae99584f543e3ac641bf7fe4aa4fb040c48ce9a330ea33d` |
| `Ultima_I-3ric-RAM.dsk` candidate | 143,360 | `864c7301411a266df01b50e583f54abdd058b4d20497f73eaacc577b00b4b3a5` |
| `Ultima_I-3ric-RAM.woz` candidate | 234,496 | `c389678481a018d6920f6a96bd24d51b68cb014ec38fe482386149d7b93e5eef` |
| Unchanged `badger6502.bin` | 524,288 | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The ROM hash identifies the repository file, not a physical-board readback.

## What needed changing

The input is a **DOS-sector-order disk containing a ProDOS filesystem**. Conversion
alone already boots the original added intro, title and character generator on the
unchanged VM. This is not an Applesoft-dependent title.

The original player-file path is `/U1.PLAYER/U1.VARS`, on a separate player volume.
Creating a character starts looking for that disk; an observed VM run stalled in
the banked ProDOS `$D3A5/$D3A8` Disk II polling loop. No disk write had occurred.
The VM's `DriveEmulator::Write` and the Pico counterpart only change controller
state; they do not write the supplied bytes to a track. Reporting a successful
persistent save would therefore be false.

During ProDOS work, language-card RAM also supplies the NMI vector `$03FB`
instead of 3ric's ROM `$F1BB`. Physical PS/2 clock edges and keyboard-strobe
acknowledgements use VIA-driven NMI, which `SEI` cannot mask. The game itself
returns to ROM-visible interactive execution, so this port can protect bounded
disk operations rather than install a permanently bank-forwarding NMI handler.

## Disk-only adaptation

- A 628-byte installer is appended to the checked `PRODOS` file, extending it
  from 14,848 to 15,476 bytes. Its sapling index, directory entry and bitmap reserve
  blocks **259 and 260**. Filesystem-free blocks containing the raw intro are left
  alone. Only **13 logical sectors** differ from the input.
- The installer checks the ROM NMI proxy bytes and copies the 335-byte resident
  into `$CC00-$CD4E`; its two-page reservation is `$CC00-$CDFF`. It inhibits input
  before ProDOS performs its initial banked work. `U1.SYSTEM` releases that initial
  hold before ordinary interaction begins.
- The ProDOS MLI entry goes through a wrapper that preserves its inline
  command/parameter/return convention. Before banked work, the adapter first lets
  an in-flight receive frame finish. A bounded wait displays `PS/2 TIMEOUT - RESET`
  if the receiver stalls, rather than dropping a completed scan byte at the
  interrupt-mask boundary. It saves VIA IER/DDRA, masks onboard VIA interrupts,
  and drives PS/2 CLOCK low through PA6.
  A minimum 200-cycle delay exceeds the keyboard's 100-microsecond inhibit interval
  at 3ric's clock. On return with ROM visible, it resynchronizes the receive frame,
  acknowledges the inhibited CA2 edge, restores direction/interrupt enables and
  releases the keyboard. Completed key decoding and LED commands remain ROM-owned.
- Only the three checked character/checkpoint file calls are redirected to a
  **458-byte RAM checkpoint** in `$C800-$C9C9`, reserving `$C800-$C9FF`.
  Other file operations still use the original ProDOS and Disk II loader.
  Continue with no checkpoint reports `No RAM save. Create one first.`
- The main menu says **RAM ONLY / RESET LOSES / YOUR PROGRESS!**; the character
  confirmation and outdoor Q message also identify RAM saving. Outdoors, Q now
  saves and returns to the character menu; B restores that checkpoint through the
  game's ordinary Continue path. Booting the disk again invalidates it.

These reservations apply only to the fingerprinted game/ROM pair. ROM, VM, web
bridge, hardware decode and generated platform reference are unchanged. No
physical write support or fake successful disk write is added.

## Generate and play

With the original disk available locally:

```powershell
node codegen\tools\patch-ultima.mjs .\Ultima_I-Enhanced.dsk .\Ultima_I-3ric-RAM
```

This creates separate `.dsk` and `.woz` files. It refuses an existing output or a
different disk/ROM revision. WOZ uses the existing DOS-order encoder; all 560
decoded sectors match the patched DSK. Use the WOZ with the current 3ric/Pico
disk interface. Do not replace the original input.

Cold-start 3ric, select the candidate in drive 1, enter `MON` if the shell shows
`>`, then `C600G`. Press **Space** at the added intro and again at the Ultima title.
Choose **A** to generate a character, distribute the 30 points with the arrow keys,
then Space. Choose race, sex and class, enter a name and Return, then **Y**.
Choose **B** to play.

Use arrows to move, **E** to enter a location, and the game's original letter
commands. In a dungeon, left/right turn and up moves forward. Outdoors, **Q**
creates a RAM checkpoint and returns to the menu; **B** continues it.
**Reset or power-off loses all progress.** There is no player-disk swap, save
file on the onboard SD card, or persistent storage in this version.

## Executed coverage

The following passed with the exact original image supplied to the optional
integration arguments:

```powershell
pwsh -NoProfile -File web\build.ps1
node codegen\tools\patch-ultima.test.mjs --dsk .\Ultima_I-Enhanced.dsk
pwsh -NoProfile -File codegen\tools\patch-ultima.test.ps1 -InputDsk .\Ultima_I-Enhanced.dsk
node codegen\tools\asm6502.test.mjs
node codegen\tools\patch-archon.test.mjs
node web\test_boot.cjs
node web\test_woz_download.cjs
```

The WASM suite cold-boots the actual output through `$C600`, rejects a mismatched
ROM ABI, creates a character, enters the overworld, moves, verifies every byte of
the RAM checkpoint, quits to the menu and continues. It walks to Castle British,
enters/exits, enters/exits Britain, then reaches the Dungeon of Montor and checks
turning, blocked-wall collision and forward movement. Rebooting the same VM
invalidates the previous checkpoint. It also checks input immutability, protected
intro blocks, unchanged unrelated files, all 560 WOZ sectors, exclusive CLI
outputs and malformed synthetic filesystem fixtures.

Without `--dsk`, the JavaScript test runs synthetic fixtures and explicitly skips
game integration. `patch-archon.test.mjs` likewise ran without its private disk;
the existing Archon native harness was compiled against the extracted, unchanged
PS/2 LED peer, not replayed against Archon's private disk.

Native checks use real PS/2 make/break frames at **94, 120 and 160 cycles per bit**,
with DATA changing after 80 cycles. Each case creates a character, continues,
moves with extended arrow scan codes, saves, returns to the menu and continues
again, and completes four bidirectional Caps/Num Lock LED command exchanges.
A real Q break frame is deliberately started at the disk-lock entry to exercise
the in-flight receive wait and release-prefix preservation.
Each observes **51 MLI calls**, **15 clock-inhibited frame retries** and a minimum
observed clock hold of **309 cycles**, with no floppy writes. It rejects enabled
VIA interrupts or a released PS/2 clock while upper ROM is hidden, and rejects
game/ROM writes into the adapter's reserved RAM.

## Remaining limits

This is a **physical-trial candidate**, not a board-certified port or a completed
playthrough. Persistent saves were deliberately deferred. Space flight, the final
battle, every spell/equipment combination and all death/restart paths have not
been exhaustively exercised.

The keyboard peer models clock inhibition and frame retry; it is not a measurement
of a particular keyboard's waveform. The adapter protects onboard VIA input,
not arbitrary external NMI sources; leave serial receive/external NMI traffic
inactive during play. The existing ROM's input implementation, physical
ACIA/NMI-versus-emulator-IRQ discrepancy and board ROM contents are not changed
or certified by this patch. Game timing and speaker pitch remain tied to 3ric's
clock. No analog-joystick or SNES adaptation is claimed.
