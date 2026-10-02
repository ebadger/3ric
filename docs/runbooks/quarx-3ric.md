# Quarx shareware on 3RIC

This is a software port for the existing physical 3RIC, not an Apple IIe emulator
mode. It retains the supplied game's rules, scoring, menus, credits, shareware
notice/countdown, speaker effects, and three original Mockingboard songs.
**Native and WASM execution are verified; a physical-board playtest is still required.**

The original disk stops at `REQUIRES 128K AND 65C02`: its renderer and music genuinely
use Apple IIe auxiliary RAM. This port converts the artwork to standard hi-res,
replaces the auxiliary-memory blitters, relocates the menu and original tracker,
and keeps upper ROM visible for real PS/2 interrupts. No system ROM, emulator,
web bridge, platform reference, or hardware decoding is changed.

## Build from your own disk

Use Node 22 or newer from the repository root:

```powershell
node codegen\tools\port-quarx.mjs C:\games\a2quarx-sw.po C:\games\QUARX
```

This creates `QUARX.prg`, `QUARX.woz`, and `QUARX.json`. Use a 1-8 character
alphanumeric/underscore output name for the ROM's FAT32 filename handling. Existing
outputs are never overwritten; the input is unchanged. The JSON records hashes,
sizes, the load command, and the unverified physical-board status.

Only the supplied **Quarx Apple II v1.00 shareware** disk is supported:

```text
143360 bytes
SHA-256 9ecfe3eb8780f78d91e1460fac471b3d13d85788274a5281f92162a9605f586c
```

The builder also checks the canonical 3RIC ROM:

```text
SHA-256 fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435
```

Do not bypass these guards for another revision. The guest checks the interrupt
dispatch bytes too, displaying `3RIC ROM MISMATCH - RESET` for an incompatible ABI.
No game image, extracted graphics/music, or generated binary is committed. Original
credits remain in the game; availability as shareware is not treated as permission
to redistribute a modified game publicly.

## Load and play

**Micro-SD:** copy `QUARX.prg` to a FAT32 card, cold-boot 3RIC, and enter:

```text
BRUN QUARX.PRG 0800
```

**Disk II:** mount `QUARX.woz` through the machine's disk interface. Enter `MON` if
the prompt is DOS `>`, then `C600G` from the monitor. The existing browser's
**Insert .woz** and **Load .PRG** controls also work; use address `0800` for the PRG.

Wait for the original shareware countdown to reach zero, then press a key.
The known slot-4 Mockingboard is detected automatically. **Escape at that notice**
selects speaker-only play instead. A missing card also selects speaker-only play.
Use browser **1x** speed and a pointer/keyboard gesture to activate audio.

| Where | Controls |
|-------|----------|
| Menu | Arrows select; Return/Space activates Start Game, Change Blockset, or Set Difficulty. |
| Gameplay | Left/Right or J/L moves; Down/K drops faster; Space/Z cycles the three blocks. |
| Pause | Escape pauses; Escape resumes. Music continues as in the original. |
| Game over | A key returns to the menu. Eligible scores accept a name and Return. |

The two shareware blocksets, three difficulty choices, original song-selection
keys, and gameplay-song changes are retained. Full-version content is not unlocked.
No SNES mapping is added. Reset exits the game; scores remain in RAM for this run.

## Intentional adaptations

- Six-color standard hi-res replaces 16-color double-hi-res. Title/background
  artwork and tile silhouettes are converted from the supplied disk. The font is
  reduced to standard-hi-res width. The board interior is black instead of the
  original animated dither; menu/credits animation and game-over scrolling remain.
- The original tracker runs from lower RAM, decoding the original songs on the
  65C02 and programming the two real AY chips. There is no host-side music engine
  or prerecorded audio. Only the selected song is decompressed into the playback buffer.
- Slot-4 Timer 1 uses `$6429`, preserving the original `$411A` timer's approximately
  61.362 Hz cadence at the faster 3RIC clock. Tone, envelope and noise periods are
  scaled by 20/13, within 0.001% of the clock ratio before integer rounding.
  Periods saturate at the AY's 12-bit tone, 16-bit envelope, and 5-bit noise limits;
  those limits cannot reproduce every Apple II frequency exactly.
- The system IRQ dispatch at `$03FE` runs music without hiding ROM. NMI keyboard
  handling stays in the unmodified firmware, including Caps Lock's bidirectional
  PS/2 exchange. Music preserves the game's random-number state.

Runtime layout:

| Address | Use |
|---------|-----|
| `$0800-$1FFF` | Original game rules/state, relocated decompressor, shareware notice |
| `$2000-$5FFF` | Two standard hi-res pages |
| `$6000-$65FF` | Hardware adapter, rendering and music wrappers |
| `$6600-$74DF` | Relocated original tracker |
| `$7500-$8AFF` | Compressed converted title |
| `$8B00-$90FF` | Original menu/credits and in-memory scores |
| `$9100-$9A6F` | Scanline tables, converted font and tiles |
| `$9A70-$9B74` | Relocated original high-score handling |
| `$9B80-$B08F` | Compressed background and three supplied songs |
| `$B100-$BFFF` | Active song buffer |

The small raw PRG first expands backward into lower RAM, never overwriting unread
packed input. It fits the existing bootable-WOZ loader below the BASIC overlay.

## Reproduce the checks

Build the shared WASM emulator first, with Node on `PATH`:

```powershell
pwsh -File web\build.ps1
node codegen\tools\port-quarx.test.mjs
node codegen\tools\port-quarx.test.mjs --disk C:\games\a2quarx-sw.po
pwsh -File codegen\tools\port-quarx.test.ps1 -InputDisk C:\games\a2quarx-sw.po
```

Without `--disk`, only asset-free codec/conversion guards run; integration is
explicitly reported as not run. With the supplied disk, coverage includes actual
WOZ boot and every expanded byte, shareware notice, menus, movement/rotation/pause,
an uninterrupted game-over/restart, original match/scoring/name-entry routines,
song changes, real stereo PCM/cadence, full loops of all three songs compared to
the unrelocated original tracker, runtime ROM rejection, speaker-only mode,
CLI overwrite protection, and a real ROM BSAVE/BRUN round-trip through FAT32/SPI.
The sparse SD fixture is modified only inside that isolated emulator instance.

The PowerShell wrapper additionally compiles the unchanged Windows core and drives
physical PS/2 scan frames, arrows, rotation, pause, and Caps Lock while music runs.
It rejects Apple IIe-only soft-switch accesses and hidden upper ROM. Its native host
runs ROM/VIA initialization, then enters the monitor without SD setup; the separate
WASM SD check covers that delivery path. This is not a physical-board or listening test.
