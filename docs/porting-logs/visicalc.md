# VisiCalc: a 40-column, bank-safe compatibility image

**2026-10-08. Emulator-verified hardware-trial candidate; not yet confirmed on
the physical board.** The owner supplied `VISICALC.DSK` and chose a disk-only
40-column port, deferring emulator floppy saving.

## Exact artifacts

The application and generated disk remain local. The repository contains only
the original adapter, guarded patcher and tests, not a VisiCalc distribution.

| Artifact | Bytes | SHA-256 |
|----------|-------|---------|
| Owner-supplied `VISICALC.DSK` | 143,360 | `3805dbc99c4ebaf2f117c9e720f793dabbd10ef93f921eae7708853b2fd2a72e` |
| `VISICALC-3RIC.woz` candidate | 234,496 | `1a7db6b1187d9bb2659fbc70eeea65c3f21cfba9a86a7dcfb39a427bb561ee1a` |
| Unchanged repository `badger6502.bin` | 524,288 | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |

The ROM hash identifies the repository file, not a readback of the physical board.
The patcher verifies the full file; the on-machine installer checks the NMI proxy
and banked input-code checksum, not a cryptographic checksum of the entire ROM.

## Why the original fails

Converting the supplied DOS-order DSK to WOZ is enough to boot its `VC/80 1`
loader. Answering **N** to the 80-column question displays VisiCalc 2.08's blank
sheet. It is not enough to use the program.

VisiCalc maps language-card RAM over the upper ROM and leaves `$FFFA-$FFFB` at
zero. Its first keyboard acknowledgement, `BIT $C010` at `$0E1C`, triggers
3ric's VIA input NMI and transfers control to `$0000`. Physical PS/2 input also
needs that NMI vector before the character has been decoded. `SEI` cannot fix
an NMI.

Separately, the current ROM's PS/2 shifted table maps Shift+= to `=`. The browser
injects ASCII and does not expose that table error; native keyboard formula entry
does. The adapter fixes that one translation locally without changing the ROM.

## What the candidate changes

The patcher appends a three-sector installer to `VC/80 1`, allocating track 3
sectors 0-2 and updating the DOS allocation bitmap, track/sector list and file
sector count. Its boot hook enters the original 40-column startup automatically.
The existing second-stage loader still loads and relocates VisiCalc itself.

The resident uses `$C800-$C8FF` and `$CF00-$CFFF`, which this application does not
use for FAT32 operations. Keyboard state, key tables and `$CAFE` are preserved.
The NMI vector occupies `$FFFA-$FFFB`, within the top eight bytes VisiCalc already
excludes from worksheet allocation. Both language-card banks remain available;
the initial free-memory display remains 34.

One six-byte replacement redirects VisiCalc's bank selector at `$08CE`. The
shared `banked-input-3ric.s` resident handles short PS/2 receive phases locally
and forwards completed packets to the guarded ROM decoder. It preserves
registers, flags, stack and the selected bank, including an interrupt immediately
after the bank switch but before the selected mode is stored. The same shared
resident is used by Archon; its payload remains byte-identical after extraction.

A VisiCalc-only post-decode hook converts a latched `=` to `+` for a pressed
scan code `$55` with either Shift key held. Unshifted `=`, releases and unrelated
characters are unchanged.

All twelve supplied worksheet files, their catalog entries and sector lists are
preserved byte for byte. The patcher converts the resulting DSK with the existing
DOS-order WOZ encoder and sets **write protection**. VisiCalc reports
`ERROR: WRITE PROTECTED` instead of appearing to save onto the emulator's
unimplemented floppy-write path.

## Generate and run

With the exact original disk available locally, from the repository root:

```powershell
node codegen\tools\patch-visicalc.mjs .\VISICALC.DSK .\VISICALC-3RIC.woz
```

The command rejects other disk/ROM fingerprints and refuses an existing output,
including its input path. Keep the original disk unchanged. A runtime ABI mismatch
displays `3RIC ROM MISMATCH - RESET`.

**Browser:** open <https://ebadger.github.io/3ric/>, choose **Insert .woz...**, and
select `VISICALC-3RIC.woz`. If the browser remains at the DOS `>` prompt or reports
an unknown command, enter `MON`, press Return, then enter `C600G` and press Return.
At a monitor `*` prompt, only `C600G` is needed. Click the emulated screen for
keyboard focus and wait for the A1 grid; there is no 80-column question.

**Native / physical trial:** cold-start the machine, insert the candidate through
the Disk II image path, enter `MON` if necessary, then `C600G`. Do not load the WOZ
with `BRUN`; it is a floppy image, not a raw PRG. Physical-board confirmation of
the exact output fingerprint remains open.

To try a calculation, enter `123` and Return in A1. Enter `>B1` and Return to
move to B1, then `+A1*2` and Return: B1 displays 246. Changing A1 to 456 updates
B1 to 912. `>` followed by a cell address navigates; Return commits an entry.

`/CY` clears the sheet; wait for the blank grid before the next command.
`/SLBUDGET.VC` followed by Return loads the supplied budget model. The image is
write-protected: **edits are RAM-only and will be lost when restarting or closing
the emulator.** Saving, disk initialization and deletion must not be relied on
for persistence. Escape cancels a storage error/prompt.

## Executed coverage and limits

The following commands passed, with `VISICALC.DSK` pointing to the owner-supplied
file rather than a repository fixture:

```powershell
pwsh -NoProfile -File web\build.ps1
node codegen\tools\patch-visicalc.test.mjs --dsk .\VISICALC.DSK
pwsh -NoProfile -File codegen\tools\patch-visicalc.test.ps1 -InputDsk .\VISICALC.DSK
node codegen\tools\patch-archon.test.mjs
node codegen\tools\asm6502.test.mjs
node web\test_boot.cjs
node web\test_woz_download.cjs
```

The VisiCalc JavaScript suite checks reversible edits, all 560 encoded sectors,
DOS allocation consistency, all twelve unchanged worksheets, CLI overwrite
refusal, real-disk boot, labels, decimal/range formulas, dependency recalculation,
clear/reuse, budget loading/recalculation, write-protection errors, the plus-key
guards and two runtime ROM-ABI rejection cases.

Native checks compile the Windows VM and boot the actual generated image. They
type the spreadsheet and storage commands as PS/2 make/break frames, with DATA
changing after 80 CPU cycles at 94-, 120- and 160-cycle bit periods. Each case
also runs 160 make/break pairs through a **synthetic bank-switch stress caller**
using VisiCalc's actual selector, explicitly places stop-bit NMIs at both
switch/state-store boundaries, and checks 9,978 interrupt returns for register,
flags, stack, language-card bank and ROM-banking-depth preservation.

The checker distinguishes a safe nested-ROM epilogue transition: after the outer
`DEC $CAFE` reaches zero, a nested NMI may perform its pending `$C007` before the
outer `BNE`/`BIT` resumes in upper ROM. Application returns still require the
original BASIC mapping; this exception is limited to those two ROM epilogue PCs
with zero saved banking depth and the expected zero flag.

Without `--dsk`, the VisiCalc suite runs payload/guard and Archon fingerprint
checks and explicitly skips application integration. The Archon suite above ran
its synthetic coverage without the owner's separate Archon disk; the extracted
payload fingerprints prove that its generated adapter bytes have not changed.

**Not claimed:** physical-board approval, exhaustive spreadsheet functionality,
arbitrary keyboard traffic throughout boot/disk loading, LED-command waveform
coverage for this candidate, 80-column/Videx display, printer support, or floppy
writing/export. No VM, firmware, web bridge, platform reference or hardware decode
change is required.
