# Quarx for Apple II+ and Apple2TS

Use **`QUARX-APPLE2.woz`** for a conventional Apple II emulator, and
**`QUARX-3RIC.woz`** for 3RIC. These are separate programs, not two names for the
same disk. The 3RIC image retains its hardware-confirmed keyboard/music fix.

The Apple II companion targets an **NMOS 6502 Apple II+ with 64 KiB**: 48 KiB of
main RAM plus a 16 KiB language card. It needs a standard slot-6 Disk II
controller; a slot-4 Mockingboard is optional. The same image is also exercised
in Apple2TS's enhanced-IIe configuration. **No physical Apple II board test is claimed.**

## Load in Apple2TS

1. Open <https://apple2ts.com/>.
2. In **Machine Configuration**, select **Apple II+** for the original-6502/64-KiB
   target, or leave **Apple IIe Enhanced** selected. Keep Disk II in slot 6 and
   Mockingboard in slot 4 for music.
3. Load `QUARX-APPLE2.woz` into floppy drive 1 and press **Boot**.
4. Wait for the preserved shareware countdown, then press **Space** or **Return**.
   Escape at this notice selects speaker-only play.
5. Use **Normal / 1 MHz** speed for the intended timing and sound. Enable the
   browser's sound control and interact with the page if audio has not started.

The original controls remain: menu arrows and Return/Space; gameplay Left/Right
or J/L to move, Down/K to drop faster, Space/Z to cycle the three blocks, and
Escape to pause/resume. Reset from normal-speed running play returns to the ROM
monitor and stops music. The game-over screen can return to the menu and restart.

The supplied game is keyboard-only. Per the owner's decision, this port adds no
joystick or SNES mapping. Apple2TS does not currently emulate an SNES MAX card.

## Build from the supplied shareware disk

From the repository root with Node 22 or newer:

```powershell
node codegen\tools\port-quarx-apple2.mjs C:\games\a2quarx-sw.po C:\games\QUARX-APPLE2.woz
```

The input must be the original 143,360-byte v1.00 shareware disk:

```text
9ecfe3eb8780f78d91e1460fac471b3d13d85788274a5281f92162a9605f586c
```

The builder leaves the input unchanged and refuses to overwrite an existing
destination. No game, converted asset, Apple firmware, or generated disk is
committed. It reuses the pinned 3RIC conversion and rejects an unexpected change
to that base before applying Apple-specific transformations.

| Image | SHA-256 |
|-------|---------|
| Hardware-confirmed 3RIC / `QXINPUT.woz` | `aa55941794ee1cf61b19e7b7aacfd5e7ef39d4a7bc97e5c8942fddd65d30fd11` |
| Apple II companion | `818aa599753d918ef141d12cc58a9d3264f7ab30f0399118f0d16624cbb9f3fb` |

## What differs from the 3RIC version

- Both versions use adapted standard-hi-res artwork, a narrower font, and a black
  board interior instead of the original double-hi-res dither animation. Rules,
  scores, menus, shareware restrictions, credits, and the three supplied songs remain.
- The Apple II builder replaces 65C02-only operations with documented NMOS 6502
  sequences. It preserves registers, meaningful flags, stack behavior, branch
  entry points, and the known self-modifying font operands. Unknown unsafe patch
  boundaries fail rather than receiving guessed byte edits.
- At boot, the program copies the machine's own ROM into language-card RAM.
  Ninety-eight expansion patches and the IRQ veneer occupy 1,501 bytes below
  `$F800`; the monitor remains available. The WOZ does not ship an Apple ROM.
  A missing language card produces `64K LANGUAGE CARD REQUIRED`.
- A private IRQ veneer gives the tracker the same saved-A and hardware-stack
  convention on II+ and enhanced IIe; their ROM IRQ entry conventions differ.
  It clears decimal mode before music arithmetic on the NMOS CPU. The original
  Apple II timer latch `$411A` and unscaled AY periods replace 3RIC's clock correction.
- Keyboard acknowledgements use the normal Apple II `$C010` hardware strobe.
  The 3RIC-only RAM-latch workaround is deliberately not carried over.
- Reset and BRK silence the sound card before leaving the game's interrupt
  environment. The standard soft-reset vector selects a small lower-RAM handler
  that restores ROM and enters the monitor, avoiding BASIC's overwritten workspace.

All conversion and gameplay remain local. There is no second game engine,
JavaScript renderer, host-side music playback substitute, or new controller scheme.

## Reproduce the checks

Build the existing WASM core for the instruction-equivalence fixtures, then run:

```powershell
pwsh -File web\build.ps1
node codegen\tools\port-quarx-apple2.test.mjs --disk C:\games\a2quarx-sw.po
```

The 16 checks cover the 151-opcode NMOS inventory; replacement semantics across
register/flag states; stack, zero-page wrapping, branches and self-modification;
unsafe-input rejection; loader/vector bounds; CLI output/overwrite protection;
and exact preservation of the hardware-confirmed 3RIC output. The shared 65C02
VM is used for semantic comparison, **not as sole proof of NMOS compatibility**.

The optional browser acceptance script requires an external Playwright install
and a browser; these are validation tools, not dependencies of the converter:

```powershell
$env:PLAYWRIGHT_MODULE = "C:\tools\browser-check\node_modules\playwright"
$env:BROWSER_EXE = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
node codegen\tools\port-quarx-apple2.browser.cjs C:\games\a2quarx-sw.po C:\checks APPLE2P
node codegen\tools\port-quarx-apple2.browser.cjs C:\games\a2quarx-sw.po C:\checks APPLE2EE
```

It launches a fresh browser profile against the real Apple2TS site and loads the
generated WOZ through the page's file input. The test observes the existing worker
bridge; it does not replace the emulator's CPU, ROM, devices or rendering. It
checks every expanded byte, actual menu pixels, existing controls and song
selection, non-silent changing Mockingboard register frames, pause, natural
game-over/restart, and Reset from normal-speed running play to a monitor that can
execute a memory-examination command. The II+ run keeps illegal-6502 trapping
armed and calibrates it with a separate `PHX` negative control after the game run.
Optional screenshots and a fingerprint report go into a fresh output subdirectory.

Reset while paused at a debugger breakpoint in ludicrous-speed mode stalled the
current browser worker during development; the verified path resumes at normal
speed before Reset. That debugger/fast-mode combination is not a compatibility
claim. Browser acceptance is also not a physical-board or listening certification.
