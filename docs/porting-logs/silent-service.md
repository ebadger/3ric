# Silent Service: a disk-only 3ric compatibility candidate

**Experimental; emulator-verified, not physical-board approved.** This port adapts
the owner's supplied disk without changing the 3ric ROM, emulator, browser client
or hardware decode. The owner explicitly chose this disk-only delivery with the
fast-keyboard limitation below rather than extending the work into a ROM update.

## Exact artifacts

The input and generated game images stay local. The repository contains the
original adapter, guarded patcher and tests, not the game or a game download.

| Artifact | Size | SHA-256 |
|----------|------|---------|
| Original DOS-order `SilentService.dsk` | 143,360 bytes | `2f159310ef2ea2107f4d9ac66ed2025de0f4a5e75ff702da2df127e499da8b6f` |
| `SilentService-3ric.dsk` | 143,360 bytes | `a0810999f0e5e84f729345c9cd03630d7ed044964ebc30b12d707b3358d6bc12` |
| `SilentService-3ric.woz` | 234,496 bytes | `51f062d833868c69dcbfb4eeefb133d1b020cb67544d0533e20b9cb07aaf83b9` |
| Unchanged repository `badger6502.bin` | 524,288 bytes | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

Only this disk/ROM pair is supported. The ROM hash is the repository file, not a
readback of the physical machine.

## Generate and boot

Set `$disk` to the path of the exact original image:

```powershell
$disk = ".\SilentService.dsk"
node codegen\tools\patch-silent-service.mjs $disk .\SilentService-3ric.woz
# Optional DOS-order output for other disk-transfer tools:
node codegen\tools\patch-silent-service.mjs $disk .\SilentService-3ric.dsk
```

The tool refuses another revision, an existing output or input overwrite. It never
downloads assets. The WOZ output uses the project's existing DOS-order 6-and-2
encoder; converting a sector image cannot reconstruct any original flux timing.

Cold-reset the emulator, select **Insert .woz...**, and choose the patched WOZ.
In the monitor, enter `C600G`. If the machine shows the DOS shell's `>` prompt,
enter `MON` first, then `C600G`. The browser's **Boot Disk** button selects its
bundled demo; use **Insert .woz...** for this file.

Answer **Y** or **N** to the Mockingboard question. Select **1** for practice,
**2** for convoy actions or **3** for a war patrol, make any further selections,
then press **Return** on the difficulty/options screen. The original patrol
ship-identification prompt is retained.

Use controller 1's **D-pad** to move the station selector and **B or X** to select.
Opposing directions cancel and released axes return to neutral. Original keyboard
input remains available: **T** selects the periscope/torpedo-data view, **Space**
returns to station selection, and **Return** remains a game command in play.
In the browser, use native **1x** speed and click the screen once for sound.

This is a digital SNES adaptation, not an analog Apple II joystick implementation.
Timing and sound still use 3ric's clock; no Apple II clock/pitch correction is claimed.

## Why the original fails

The standard DOS boot succeeds far enough to relocate DOS into language-card RAM.
It then enters `$E000` for Applesoft cold start. That address is not Applesoft on
3ric, and the binary greeting also calls Applesoft's `$DB3A` string output.

After adapting those startup calls, the game can display its menus but entering
a scenario exposes another problem. A paddle request at `$AEA7` touches `$C070`
while the RAM NMI vector points at DOS's `$BF0C` reset path. Physical keyboard edges
can take that path too; `SEI` does not mask them.

Register-preserving NMI forwarding alone is insufficient. The compiled interpreter's
`NEXT` at `$11A8` pops its FOR frame and later rereads/reuses the discarded stack
bytes. A native trace caught a PS/2 interrupt at `$11CF`, with SP `$FB`, overwriting
the saved loop return link. The interpreter subsequently loaded that damaged link
and dispatched through zero page. The corruption occurs even when NMI restores
every register, flag, stack pointer and bank correctly.

## What changes

- The disk's existing DOS RWTS loads a 1,513-byte installer from six previously
  free track-4 sectors. Their VTOC bits are allocated. The 147-byte bootstrap uses
  checked unused DOS space and explicitly halts on a disk-read error.
- Original cold-start and string-output adapters launch the existing binary greeting,
  compiler runtime and game. The game, graphics, sound driver, scenario data and
  disk loading are retained.
- The interpreter runs with language-card RAM visible. Firmware-call wrappers expose
  ROM temporarily and restore RAM afterward; blocking keyboard waits stay in the
  adapter. The DOS bank operands retain their self-modifying `$81/$83/$8B` convention
  so subsequent overlay reads do not silently select the wrong bank.
- `NEXT` reads its still-live stack frame and discards it only when finished or
  searching an enclosing loop. Return-address probes capture their own live return
  addresses rather than rereading stack bytes after `RTS`.
- Bank-safe PS/2 forwarding and direct SNES scanning reuse Archon's adapter code.
  Direct controller polling avoids paddle-timer NMIs whose firmware acknowledgements
  can erase a simultaneous keyboard edge. The Archon resident, installer and boot
  stub remain byte-identical after extraction into shared sources.
- This exact profile reserves `$C800-$C9FF`, `$CC00-$CDFF`, `$CF00-$CFFF` and the shared
  language-card NMI vector. It preserves the ROM's keyboard state, `$CAFE` and
  controller tables. These reservations are not a declaration of general free RAM.

There are 117 checked patch records, changing **1,811 bytes in 36 DSK sectors**.
Reversing them reproduces the original DSK exactly. All 560 encoded WOZ sectors
decode to the patched DOS-order image and pass their sector/container checks.
The patcher checks the complete ROM fingerprint; the guest installer checks the
NMI proxy and banked input-code ABI and shows `3RIC ROM MISMATCH - RESET` on failure.

## Coverage and limits

These commands passed, with `$disk` pointing to the owner-supplied original:

```powershell
pwsh -NoProfile -File web\build.ps1
node codegen\tools\patch-silent-service.test.mjs --dsk $disk
pwsh -NoProfile -File codegen\tools\patch-silent-service.test.ps1 -InputDsk $disk
node codegen\tools\asm6502.test.mjs
node codegen\tools\patch-archon.test.mjs
node web\test_boot.cjs
node web\test_woz_download.cjs
```

The JavaScript check includes exact-image rejection, exclusive CLI output,
reversible edits, all 560 sector round trips, visible disk-read/ROM-ABI errors,
and synthetic ascending/descending/nested loop checks with **782 injected NMIs**.
It cold-boots the real output into practice, the first convoy scenario and the
first war patrol, using the unchanged ship-identification prompt. Practice coverage
includes all four controller directions, neutral/opposing directions, keyboard
station changes, return to station selection, controller selection and nonzero
PCM from the emulated sound hardware. Both sound choices are exercised.

Native checks cold-boot the same output and use real PS/2 make/break frames at
**120- and 160-cycle bit periods**, changing DATA after 80 cycles. Each case covers
physical menu keys, 80 keyboard pairs mixed with controller motion, eight
bidirectional Caps/Num Lock LED exchanges, both language-card banks and over
3,000 register/flags/stack/bank-preserving interrupts. The 160-cycle run also
interrupted a bank-switch/state-store boundary. These are emulator observations,
not oscilloscope measurements or confirmation of physical LEDs.

**Known fast-keyboard failure:** the 94-cycle case still fails when input arrives
during an unmodified-ROM call. It can nest firmware NMIs and restore the wrong
BASIC overlay. Reproduce it with:

```powershell
pwsh -NoProfile -File codegen\tools\patch-silent-service.test.ps1 -InputDsk $disk -BitPeriods 94
```

That diagnostic is expected to fail for this candidate and is not part of the
passing default cases. The owner accepted it as a disk-only limitation. Do not
claim compatibility with every physical PS/2 keyboard or input timing.

**Existing smoke-test issue:** `node web\test_disk.cjs` fails on the unchanged ROM
because it types `C600G` at `>` without entering `MON`; the screen reports `EH?`.
No shared VM/web code is changed here. The new integration checks use the documented
`MON` then `C600G` sequence, and the existing nine-case WOZ-download suite passes.

**Not established:** a complete playthrough, every scenario/station/weapon,
save/restart/game-over paths, arbitrary input during disk loading, or physical-board
operation. The supplied game and any screenshots/dumps used during investigation
are not published with the PR.
