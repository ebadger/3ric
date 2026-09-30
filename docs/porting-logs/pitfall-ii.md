# Pitfall II: four bytes for hardware music, then a separate tuning problem

The investigation took place on **2026-09-25**. With the direct-slot-4 image, the
owner reported: **"it works! I can control with gamepad and music is playing!"**
That is the explicit physical success. Later pitch/tempo experiments improved
sound but have different evidence boundaries; the last candidate has no recorded
owner listening confirmation.

## Artifacts and address conventions

Every listed PRG is **34,819 bytes**, a raw file with no load-address header.
Load and entry are **`$07FD`**. Starting at `$0800` skips three bytes, misaligning
execution into `BRK`; the filename's `7fd` is meaningful, not decorative.

| Stage / filename | SHA-256 |
|------------------|---------|
| Original `pfii_7fd.prg` | `4001ea4314320467183d54cf585406081584e2acb4cc1bb27b317a0afc63e9d5` |
| Superseded timer-priming experiment, `PFII_MB.PRG` / retained `PFMB07fd.PRG` | `5918c6b3c38320153e04b5faf88eac348cef8019e0fa38a31ea004a5f09440de` |
| **Hardware-working direct C4**, `PFMBC4.PRG` / retained `PFMB7fd.PRG` | `0b7ab238df28dc854611d490e3a89c7982d5e5c5d885cd3f5a51a1d7beeb3753` |
| Clock-scaled `PFMBTUNE.PRG` | `08ecaf12e7045a31a4057ca6c88f9500ae3db20935fd13e41a36505064eb9b5f` |
| Unconfirmed A440 candidate `PFMB440.PRG` | `3c91ab035c736c03e1dc1990a6881044cb59d8ae16623b86142ff52c3b2baff6` |

The driver relocates by **`+$8000`**. A raw offset near `$25Ex` first loads near
`$2DEx`, then executes near `$ADEx`; loaded and relocated addresses are not file
offsets. The [shared baseline](README.md#shared-machine-baseline) pins the reference
ROM and clocks without claiming a full readback of the physical ROM.

## Investigation: several plausible fixes failed

### 1. Silent music came from a rejected detector, not necessarily broken AY output

The original probe at relocated `$ADE0` constructs slot-relative `$Cn04/$Cn84`
Timer-1-low reads and expects an eight-tick difference. If no card passes, it
patches **four music entry points to `RTS`**. In the emulator, reset timers were
not running and initially read zero, so the scan rejected the card and effectively
disabled the driver.

The first private patch started both slot-4 timers before the original detector.
It passed an emulator check, but that was premature confidence, not a hardware fix.
Space only advances the splash; after waiting for the title, **Escape** starts
gameplay and the score. On the board the owner reported Caps Lock LEDs stopping
after Escape. Because keyboard input depends on NMI, that clue redirected attention
from audio output alone to the onboard input VIA and interrupt path.

### 2. A slot scan could mistake an input-VIA alias for two sound-card timers

In the final 74LS154 decode, A8-A11 select the `$C2xx` page, while the onboard VIA
uses A0-A3 for registers and ignores A7. Thus `$C204` and `$C284` could be reads of
the **same onboard timer**, not the two separate Mockingboard timers found at
`$C404/$C484`. The current VM's narrow `$C200-$C20F` handling misses that `$C284`
mirror, so an emulator-only scan did not establish the physical decode behavior.

A differential experiment forcing slot-2 detection succeeded in making the driver
write `$FF` to input DDRA `$C203`, damaging keyboard/pad configuration in the
emulator. The timing of the effect differed from the board observation. This was
a plausible alias/probe hazard, **not proof of the sole physical cause**.
The historical `22v10` designs were not the final schematic to reason from.

### 3. Starting at slot 4 still retained a second hazard

The owner fixed the sound card at `$C4`. A `PFMB4.PRG` experiment began scanning
there instead of `$C1`, but retained the timer check; physical keyboard and sound
still failed. No verified fingerprint for that intermediate is recorded here.

Timer priming itself can assert IRQ when T1 interrupts are already enabled.
An emulator differential reproduced an interrupt stall from this added behavior.
That exposed another self-induced hazard, not a proven complete explanation for
the board. The safer experiment restarted from the **original image**, removed
artificial timer starts, and bypassed detection entirely for the known slot.

## The four-byte hardware-working result

Only these bytes differ from the original; file length and all other content stay
unchanged. Numbers are hexadecimal.

| Raw-file offset | Loaded address | Relocated address | Before | After |
|-----------------|----------------|-------------------|--------|-------|
| `$25E8` | `$2DE5` | `$ADE5` | `C1` | `C4` |
| `$25EB-$25ED` | `$2DE8-$2DEA` | `$ADE8-$ADEA` | `A0 04 B1` | `4C 21 AE` |

The first change selects slot 4 directly. The second is `JMP $AE21`, bypassing
the probe and entering the original initialization path without priming timers.
This produced `PFMBC4.PRG`, later retained as the byte-identical `PFMB7fd.PRG`.
The owner's gamepad-and-music confirmation applies to this fingerprint.

This is a **fixed-slot compatibility patch**, not a general Mockingboard detector.
It does not gracefully establish that a card is present, and it is not appropriate
for an absent card or another slot. No ROM rewrite or emulator fix was shipped.
The same input-VIA separation matters to [A2Robots](a2robots.md), whose unused
paddle timers also complicated keyboard traffic.

## Clock correction was a second, only partly resolved story

3ric's CPU/AY clock is 1,573,437.5 Hz; the Apple II reference is about
1,022,727.14 Hz, a ratio of **1.538472418**. Reusing the original AY periods at the
higher clock raises pitch. Reusing the original song dividers changes tempo too;
slowing the entire game was not the chosen repair.

`PFMBTUNE.PRG` retained the direct-C4 fix and increased the **35 nonzero 16-bit AY
period words** in raw `$278C-$27D1` (relocated `$AF89-$AFCE`). Every retained word
matches `round(original_period * ((25_175_000/16) / (14_318_180/14)))`; none is near
a half-integer rounding tie. That is a verified binary transformation, not a claim
about the unavailable original generator's language. The zero/rest word at raw
`$27D2` was left unchanged. Four song tempo bytes at raw `$27EC-$27EF` changed from
`05 06 07 06` to `08 0A 0B 0A`. This changes music timing, not a global game-speed
setting. Byte comparison found **56 actual byte changes relative to direct C4**.

A recorded emulator tone was 887.4 Hz against an Apple-intended 887.8 Hz, with
beat timing within about 3%. The owner's response was **"Sound is better ...
some of the tones are wrong"**. Preserve both halves of that observation:
clock compensation helped, but musical correctness was not settled.

The later private `PFMB440.PRG` candidate retuned the same 35 sounding note indices
toward equal temperament with concert A at 440 Hz. Relative to `PFMBTUNE`, only
**22 bytes in 22 notes** changed; the direct-C4 patch, four tempo bytes, and zero
rest remained intact. It must not be promoted to hardware-perfect or final-approved
status merely because the period arithmetic looks better.

The retained retuning script starts from each **original**, not already-scaled,
period: `original_hz = (14_318_180/14) / (16 * original_period)`. It selects
`midi = round(69 + 12 * log2(original_hz / 440))`, then
`target_hz = 440 * 2**((midi - 69) / 12)` and
`period = round((25_175_000/16) / (16 * target_hz))`. All 35 retained candidate
words match this rule. Original notes farther than 25 cents from the selected
target are rejected rather than silently assigned a different pitch.

Read-only calculations from retained images found the following errors relative
to nearest A440 equal-tempered targets:

| Table | Maximum error | Mean error |
|-------|---------------|------------|
| `PFMBTUNE` | 14.907 cents | 4.810 cents |
| `PFMB440` | 6.013 cents | 1.428 cents |

These are **calculated period-table errors**, not fresh PCM or physical listening
measurements. The earlier summary "under seven cents" for the candidate is
consistent with them. There is no recorded owner listening approval for `PFMB440`.

## Loading and controls

From the ROM DOS shell, using the original working delivery name:

```text
BRUN PFMBC4.PRG 07FD
```

For the retained working copy, use `BRUN PFMB7fd.PRG 07FD`; keep the load address
when substituting a tuning candidate's filename. Space advances the splash,
then wait for the title and press **Escape** to start gameplay/music. The owner
confirmed pad control and music for the direct-C4 image. Historical emulator
checks included the ROM's pad B+Left path; the record is not a complete controls
manual or an all-buttons physical certification.

## Verification lessons and provenance

Prior local `pitfall_retune.py` work guarded hash, size, table bounds, original-note
pitch interpretation within 25 cents of the nearest pitch, and 12-bit AY periods.
`pitfall_music_check.cjs` checked twelve score streams, 25 synchronized events with
unchanged time/voice/note between TUNE and 440, live AY register periods on both
`$C400/$C480` sides, ROM pad input, and PCM notes 0/6/32 against computed frequency.
Those are prior-session checks, not tests rerun for this documentation change.

The patch/tuning scripts were **private session artifacts**, not repository-tracked
tools. No Pitfall code commit or code PR is recorded. These filenames are provenance,
not links to scripts present in this checkout, and no PRG is included here.

The durable lesson is to separate four claims: a detector finding a card, a driver
playing sound, the board remaining controllable, and the music sounding right.
The original scan could disable good driver code; a well-meant timer fix could
add an IRQ problem; arithmetic improvements could still leave audible wrong tones.
Future work can compare the three preserved C4/TUNE/440 hashes on the same board,
then isolate period rounding, score interpretation, and timbre without reopening
the already-working slot selection. [Porting-log index](README.md).
