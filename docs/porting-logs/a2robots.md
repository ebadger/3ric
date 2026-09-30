# A2Robots: from the first key crash to a preserved hardware profile

**Attack of the Apple Robots / Apple II PETSCII Robots.** Record assembled
2026-09-30. The owner explicitly confirmed normal menu keyboard input, Return
starting the game, and controller-1 D-pad movement on the board. That confirmation
belongs to the exact accepted image below, not either earlier emulator-passing
version. It is not a full-playthrough or all-actions hardware certification.

## Artifacts and starting point

All four WOZ files below are 234,496 bytes. The
[shared baseline](README.md#shared-machine-baseline) identifies the canonical ROM;
the physical board's full ROM was not read back.

| Profile | Filename / meaning | SHA-256 |
|---------|--------------------|---------|
| Original | `a2robots.woz` | `9bbf9b53dd217468cc3b3f944fb5e6429344e533bcb7d72bac3982f42f919e53` |
| Accepted | `a2robots-3ric-hardware.woz`, byte-identical to `a2robots-input-probe-playable.woz` | `4ede9a889814c29f7e7de7d25e6b748b62f2ac50a1be724afcf2731aa155b998` |
| Superseded v1 | Passed initial fixtures; physical title keyboard/Caps Lock failed | `8fddea60cf8fc9a13c7d92c70943f81016f0522d86080044831f57a800c90337` |
| Superseded v2 | Improved timing/protocol coverage; physical keyboard still failed | `8086280c423551fc4cf7629cc341dd0a3dc0444042a7c82fb2958938345547d1` |

The source disk uses ProDOS 8 v2.4.2. Its `A2ROBOTS.SYSTEM` was 1,940 bytes;
`DECOMP` runs at `$D800`, and bank 2 holds ProRWTS2 at `$D000`. The original reached
the title/menu and played Mockingboard music, but **any physical key**, including
`2`, killed input/execution. This was not simply the game overlooking an ASCII key.

## Investigation: why the obvious fixes were insufficient

### 1. The interrupt target disappeared behind language-card RAM

A native trace showed the effective `$FFFA/$FFFB` NMI vector change from `$F1BB`
to `$03FB` when ProDOS exposed language-card RAM. ProDOS wrote `00 40 00` at
`$03FB-$03FD`: the entry instruction was `BRK`. The first PS/2 clock NMI arrived
**before** the scan byte could be decoded. A browser-injected key could also crash
when the game subsequently executed `STA $C010` and triggered the strobe NMI.

The first bridge lived in always-mapped `$CF00`, temporarily exposed ROM to service
the onboard VIA, then restored the interrupted bank. Copying ROM `$F1BB/$F1C6`
into high language-card RAM was rejected: the game uses that RAM for graphics.
ROM was hidden, not erased, and `SEI` could not solve an NMI problem.

The prototype recognized bank 1 by the old ProDOS `$D8` opcode at `$D000`. Gameplay
replaced that bank with tile graphics, so the signature ceased to identify it and
restoring the wrong bank garbled graphics. The supported image's **bank-2**
ProRWTS2 prefix `4C 9F D0` was stable enough to distinguish the banks instead.
This is an image-specific assumption, not a general language-card detector.

### 2. The game wanted SNES MAX, not the existing analog-joystick interface

The options were KEYBOARD, CUSTOM KEY, and SNES MAX. The owner correctly pointed out
that 3ric already emulates an Apple II joystick; this game simply does not use its
ordinary analog-paddle movement scan. Its SNES MAX expansion-card path consumes
two active-low serial words in `$D0/$D1`.

The adapter reused ROM scan routine `$B99B` and controller-1 table `$CEE0` to rebuild
those words for the original decoder, preserving all twelve native actions and
their edge/held behavior. A full `$C070` wrapper was tried, but its unused paddle
timer NMIs dropped PS/2 input during mixed polling. A bank-safe software call to
`$B99B`, with only onboard VIA1 T1/T2 IER bits `$60` masked, avoided that traffic.
The separate Mockingboard VIAs and their timers were not disabled.

### 3. Emulator success exposed gaps in the keyboard fixture

V1 passed native PS/2 and full-image cases, but the board ignored keys and Caps
Lock at the title while music continued. The fixture had held DATA until the next
falling clock edge; real keyboards can change it sooner. At a 160-cycle bit period,
holding DATA for 88 or 80 cycles let the original ROM decode `2` while the
bank-switch-first bridge failed.

V2 sampled start/data/parity in `$CF00` RAM **before** bank work, handled CB1
acknowledgement quickly, and drained serviced sources rather than discarding a
pending CA2 edge. ROM translation and LED commands also required saving Y, not
just A/X. A bidirectional peer exercised `F0 02`, `ED <mask>`, and `F4`, supplying
the keyboard's `$FA` acknowledgements and checking Caps/Num Lock on/off.

**V2 still failed on the physical board.** These were real fixture/bridge defects,
but fixing them did not establish the remaining hardware cause. The unchanged
ROM path still has its own blanket-IFR-clear behavior; see the distinct
[Spy vs Spy race](spy-vs-spy.md).

### 4. A diagnostic became the controlled path to a working normal game

An owner-authorized title diagnostic added four live rows, a private NMI counter,
heartbeat, effective vectors, VIA state, and frame/decoded-byte state. It avoided
`$C100/$C101` reads and interrupt-flag acknowledgements that might unstick the
machine, using non-handshaking VIA observations rather than changing input state.

The board photo after `2` showed `NM=$21` (33 NMIs), `SC=$1E`, `KEY=$B2`,
`ST=$00`, `DEP=$00`, vector `$03FB`, hook `$CC00`, and opcode `$4C`.
Recorded VIA state included `IER=$FB`, `PCR=$22`, `DDRA=$1C`, `DDRB=$C0`.
That demonstrated decoding **in the diagnostic**, not the root cause of v2's failure.
Adding the normal `$C010` acknowledgement still worked: the owner saw `KEY=$32`.

Restoring the **normal menu**, while retaining twelve-page relocation,
`$CC00-$CDFF` initialization, and the fifteen-cycle NMI trampoline, produced the
first explicit normal-play physical success: keyboard worked, Return launched,
then the D-pad moved the player. The display/polling code was no longer executed.
This became the accepted profile, not an invitation to trim the unused bytes.

## What the accepted patch changes

Offsets in `A2ROBOTS.SYSTEM` below are hexadecimal; ProDOS block numbers are decimal.
They apply only to the original fingerprint above.

| Location | Meaningful transformation |
|----------|--------------------------|
| System-file offset `$0016` | Redirect the bootstrap to appended installer `$1B94`; preserve the original initialization path after installation. |
| System-file offset `$0480` | Redirect the post-decompression game-entry jump through the game-hook installer. |
| ProDOS file/allocation | Grow 1,940 to 3,012 bytes, allocate blocks **266 and 267**, update sapling index/directory/bitmap, and relocate **12 pages instead of 8**. |
| Disk encoding | Change eleven sector data fields plus WOZ CRC; preserve unrelated bits, layout, timing, address fields, and metadata. |
| `$CF00-$CFFE` | Install the 255-byte bank-safe PS/2 receiver and SNES adapter; restore the interrupted bank and A/X/Y. |
| `$03FB`, `$CC00` | Install `JMP $CC00`; at `$CC00`, execute `INC $CDF0`, three `NOP`s, then `JMP $CF00` (fifteen added cycles). |
| `$CC00-$CDFF` | Preserve the accepted initializer, including inactive diagnostic code/data. No HUD polling/rendering executes in this profile. |
| Game `$7BD4`, `$7CE7`, `$77B5` | Hook SNES reading, menu initialization, and the game-over reload path after decompression. |
| Game `$3B1F`, `$347A` | Repair the input label and remove the irrelevant expansion-card slot prompt, including after reload. |

The installer guards ROM proxy bytes `$F1BB-$F1D5` and a folded two-byte checksum
over `$B500-$BDFF` (decimal **179, 168**). Mismatch displays
`3RIC ROM MISMATCH - RESET` instead of calling an unknown internal ABI. The local
patcher also guards the full input/ROM fingerprints and exact accepted output hash.
`$CC00-$CFFF` is not generally free application RAM; this reservation is specific
to this checked game/ROM pair.

**The fifteen cycles alone are not a proven fix.** Loader footprint, initial RAM,
and entry register state also changed. The ACIA/NMI topology discrepancy in the
[baseline](README.md#shared-machine-baseline) is another unproven lead, not an
observed explanation. No firmware or emulator correction was shipped by this patch.

## Loading and controls

Cold power-cycle; enter `MON` if reset lands at DOS, then `C600G`. Release keys
until the title appears: the installer does not protect the earlier ProDOS boot.
Use the built-in **controller 1**, not a SNES MAX card. The title defaults to
**3RIC SNES**, but menus remain keyboard-driven: arrows select and **Return starts**.
Keyboard/custom-key gameplay remains selectable; default keyboard movement is
I/K/J/L and firing is W/S/A/D.

| Pad input | Native game action |
|-----------|--------------------|
| D-pad | Move |
| X / B / Y / A | Fire up / down / left / right |
| L / R | Search / move an object; use directions to select it |
| Start | Use the selected item, **not** start the title menu |
| Select + L / Select + R | Cycle items / weapons |

Controller 2 is ignored. Actions still need the appropriate inventory/ammunition.
Escape opens pause/abort: N or Escape resumes; Y aborts. A keyboard key acknowledges
game over. The original manual distinguishes 64K title music from **128K required
for in-game music**; that limit is separate from the keyboard crash.

## Recorded verification and remaining avenues

Prior integration booted the **actual patched WOZ**, without debugger RAM fixes.
It covered all 560 sectors and inverse-patch equality, unchanged original input,
ROM mismatch rejection, twelve buttons, controller-2 isolation, real movement and
action dispatch, held behavior, keyboard fallback, pause/abort/menu/restart,
bank/A/X/Y restoration, and Mockingboard PCM.

Mixed-input coverage used PS/2 periods 94/120/160 cycles with 80-cycle DATA hold
(160/88 for Mockingboard), separate rising edges, short interpacket gaps, extended
menu arrows, and full Caps/Num Lock command exchanges. This is **emulator evidence**,
not coverage of every legal keyboard waveform or serial-peripheral configuration.
The native harness initialized ROM/VIA then entered the monitor directly, omitting
SD/DOS startup. Its audio fixture manually supplied a pending Escape, then used
physical-path PS/2 `4` to select slot 4; it was not an untouched physical cold boot.

The board confirms only the keyboard/menu, launch, and D-pad scope stated above.
A useful next experiment would compare one startup variable at a time against the
accepted hash, preserving a known-working copy. Full playthroughs, other ROMs,
third-party tile sets, and cleanup of inactive initializer bytes remain unverified.
As [Pitfall II](pitfall-ii.md) also showed, a diagnostic or timer workaround can
change the machine being measured.

## Historical tooling and provenance

Local-only commit `bb6ac1abf28daa04006be6b9ceda4b325d1ae720` preserves this profile;
`0b5bcd8` is earlier v2 history, **not** hardware approval. The historical
`codegen\tools\patch-a2robots.mjs`, `a2robots-hardware-profile.mjs`,
`patch-a2robots.test.mjs`, `patch-a2robots.test.ps1`, `patch-a2robots.native.cpp`,
`codegen\patches\a2robots-3ric.s`, and `docs\runbooks\a2robots-3ric.md` are not
included here. If that local history is available, the recorded patch command was:

```powershell
node codegen\tools\patch-a2robots.mjs .\a2robots.woz .\a2robots-3ric-hardware.woz
```

Historical checks used the `.test.mjs` with/without `--woz`, and the `.test.ps1`
with `-InputWoz`, after `web\build.ps1` for WASM. These commands require recovered
local tooling; they are not runnable instructions for this docs-only checkout.
The external `msbasic` `newboard` branch was a source clue, not a substitute for
the pinned binary ABI. [Porting-log index](README.md).
