# Spy Hunter: respect the software-backed joystick registers

Record assembled **2026-09-30**. The owner identifies Spy Hunter as working on the
physical machine in the current request. The earlier implementation record still
said physical confirmation was pending, so the detailed evidence below is **real-ROM
emulator coverage**, not an invented board playthrough.

## Artifacts and load contract

Both files are **34,307 bytes** (`$8603`), raw memory images with **no load-address
header**. Load and entry are **`$07FD`**, not `$0800`.

| Artifact | SHA-256 |
|----------|---------|
| Original `spyh07fd.prg` | `8740e1181ed35b13b129a8f25aae977d95129e885cb4f7ccfaa9126264c93af3` |
| Delivered `SPY3RIC.PRG`, subsequently retained as `spyp7fd.PRG` | `28b2df9a90f7bdc2e0726c1c0939b57e896ab54678daae7055578159fec58c27` |

The [canonical ROM fingerprint](README.md#shared-machine-baseline) is part of the
reproduction context. It does not certify the board's installed ROM by readback.
[Pitfall II](pitfall-ii.md) shares the easily missed `$07FD` raw-file convention.

## Investigation: the joystick was already there

The original could not reliably start or steer. The owner's important correction
was that **3ric already provides an Apple II joystick interface**: the ROM responds
to `$C070`, scans the built-in pad, updates RAM-backed buttons at `$C061/$C062`,
and uses onboard VIA timers to maintain paddle timing at `$C064/$C065`.
ACIA `$C100` is serial, not that timer.

Two game assumptions broke this contract. First, some button waits repeatedly read
`$C061` without a fresh `$C070` scan. Pressing or releasing a physical/controller
button could not refresh that latched value by itself. The original calibration
release loop at `$0EC1-$0EC9` stalled; it also ignored keyboard input, so a key was
not a way out of that wait.

Second, the original used `ASL absolute` directly on `$C061`, `$C062`, `$C064`, and
`$C065`. On an Apple II, writes to those read-only input locations do not modify
the sampled value. On 3ric's software-backed registers, the read/modify/write
instruction wrote the shifted value back into RAM and corrupted later measurements.
Adding more controller injection or pretending the hardware lacked joystick
support would have missed both root causes.

The chosen repair was **game-only and in place**: refresh scans where the game
waits for buttons, and shift a loaded accumulator rather than the input register.
No ROM change, emulator change, relocation, extra RAM, or new input driver was needed.

## Exact patch map and reconstruction notes

File offset is `runtime address - $07FD`. Six replacement ranges cover **135 bytes**;
**109 bytes actually differ** from the original. The original size/load address stay
unchanged. The following table and instruction-flow notes describe the historical
replacement, including the existing scratch state it relied on.

| Runtime start | Raw-file offset | Reserved bytes | Replacement |
|---------------|-----------------|----------------|-------------|
| `$0E9F` | `$06A2` | 34 | Bounded character/button wait with periodic `$C070` refresh |
| `$0EC1` | `$06C4` | 3 | `JSR $0FB6` instead of a stale direct button read |
| `$0F24` | `$0727` | 3 | `JSR $0FB6` |
| `$0F86` | `$0789` | 58 | Non-destructive button reads, compact threshold binning, shared scan helper |
| `$0FF0` | `$07F3` | 34 | Non-destructive, cycle-preserving paddle sample loop |
| `$2805` | `$2008` | 3 | `JSR $0FB6` |

**Timed wait at `$0E9F`:** the outer wait sets Y to `$B4`; each scan executes
`BIT $C070`. Poll `$C000`, returning its character when negative. Otherwise
`LDA $C061; ORA $C062` detects a button via bit 7. `DEC $6E` controls the inner
polling period. At zero, decrement Y and rescan if Y is nonzero; otherwise
decrement X and restart the outer wait while nonzero. Button or timeout returns
`LDA #0`; all exits pass
through `LDY $C010; RTS`. This keeps character, strobe, and bounded-timeout semantics.

**Controls at `$0F86`:** use `LDA $C061; ASL A; ROL $A7`, then the corresponding
sequence for `$C062/$A8`. The sole caller at `$0ED0` clears `$A7/$A8` first; that
precondition matters because these are rotates, not replacements of arbitrary RAM.
For X binning, `LDX #$FF; LDA $6E`, then `INX; CMP $01F1,X; BCS` back to `INX`;
map through `$0FC0,X` into `$A9`. Repeat for Y using `$6F` and thresholds `$0201,X`,
then map `$0FD0,X` to `$AA` and `$0FE0,X` to `$AB`; `RTS`.

Compaction frees `$0FB6` for **SCAN_BUTTON**:

```asm
LDA $C070
LDA $C061
RTS
```

Three trailing `NOP`s fill the 58-byte region. The helper leaves X/Y intact and
returns a freshly scanned button in A; the three call sites above share it.

**Paddles at `$0FF0`:** `LDA $C070; LDX #$7F; STZ $6E; STZ $6F`, then sample
`LDA $C064; ASL A; LDA $6E; ADC #0; STA $6E`, followed by the analogous
`$C065/$6F` sequence. Finish each iteration with `NOP; DEX; BNE` to the sample;
`RTS` when complete. `LDA absolute` (four cycles) plus `ASL A` (two) preserves the
old six-cycle sampling cost without writing the paddle register. Carry from the
shift still feeds the counter addition; the timing `NOP` is part of the patch.

These semicolon-separated flows are compact instruction notation, not source for
direct assembly. The historical generator used the repository's
[assembler](../../codegen/tools/asm6502.mjs), checked exact lengths and non-overlap,
guarded the original hash, and refused to overwrite an existing output file.

## Loading and controls

From the ROM DOS shell, the delivered name used:

```text
BRUN SPY3RIC.PRG 07FD
```

Substitute the retained filename if using `spyp7fd.PRG`, keeping `07FD`.
Advance the splashes with a key and choose **J** for joystick. Calibrate in order:
center, upper-left, lower-right, with a face-button **press and release at each**
prompt. A face button starts play; Start is not the legacy fire button.

Controller 1 B/X supplies fire 1, A/Y supplies fire 2. Let the car-delivery animation
finish, then press Up to accelerate before expecting steering movement. Original
keyboard mode remains: L/semicolon steer, A/Z throttle, and 1/2 select weapons.
The patch repairs sampling, not the game's calibration or startup choreography.

## Recorded verification and its limits

Prior real-ROM tests reproduced the original release-loop stall, then exercised
ordered three-point calibration, actual game start, left/right car-position
changes, throttle and fire press/release, bounded timeouts, X/Y preservation, and
keyboard mode. They also saved and reloaded the exact 34,307-byte image through a
staged `sd.sparse`:

```text
BSAVE SPY3RIC.PRG 07FD 8603
BRUN SPY3RIC.PRG 07FD
```

That SD round trip and CLI guard coverage strengthened the loading evidence.
Historical notes also mention native PS/2-path testing; they do **not** establish
complete physical keyboard timing margins. None of these runtime tests were rerun
for the documentation PR.

The useful general lesson is not "replace every Apple II input routine." It is
that a read-only hardware register emulated with writable RAM has observable RMW
semantics, and an emulated latch may need an explicit scan before both press
**and release** waits. Preserving cycle cost kept that repair from becoming a new
paddle-timing bug. [A2Robots](a2robots.md) needs a different adapter because its
SNES MAX path is not this standard analog interface.

The current owner statement supplies the hardware-working status. A future detailed
board record could add controller model, calibration values, sustained play, and
the exact installed ROM; those specifics are absent from the recovered history.

## Historical tooling and provenance

Local implementation commit `9dff616aaec09f9d32dc3aae8fd0149015929888` contains
`codegen\tools\patch-spyhunter.mjs`, its `.test.mjs`, and contemporary spec notes.
Commit `6494b2606c39c77de2c80ddc4c79ad1a3606cb55` deliberately **removed** those
repository changes at the owner's request to deliver only the patched PRG.

The tool is historical, not an active command in this checkout. If the first
commit is available locally, `git show` can recover its source; the SHA is not a
claim that origin publishes it. These logs neither reinstate that tooling nor
publish either PRG. The accepted artifact is identified by its hash, independent
of its rename. [Porting-log index](README.md).
