# Wirethroat formant talker

Original English text-to-speech for the 3RIC slot-4 Mockingboard. Entry `grok-4-7`
in challenge `tts-v1`. Baseline `bd795bee12c5fb73a7de9e733e19e0aad95fb57c`.

The voice is a small robot: two square-wave formants on each AY, pulsed by that
chip's envelope generator at a fixed pitch. It is not a port of another engine,
rule set, voice table, or recording.

## What you can do

`BRUN TTS.PRG 0800` opens a text screen. Type letters, spaces, apostrophes,
hyphens, and `. , ? !`. Return speaks. Backspace or Delete edits. Escape during
speech silences the chips and returns to the prompt. Escape at the prompt exits
with `BRK`. The line holds 120 characters; a longer line prints
`LIMIT IS 120 CHARACTERS.` Unsupported keys print `UNSUPPORTED CHARACTER.`
Empty or space-only input prints `NOTHING TO SAY.` and does not beep.

## Callable ABI

| Label | Role |
| --- | --- |
| `TTS_INIT` | Reset both slot-4 VIAs/AYs, disable their IRQs, silence, `RTS`. Does not wait for a key. |
| `TTS_SPEAK` | `A`/`X` = pointer to NUL-terminated ASCII in RAM. Preserves the string. `RTS` with `A=0` done (including empty), `A=1` Escape, `A=2` invalid or longer than 120. The 121st byte is the overlength check; scanning stops there. |
| `TTS_INPUT` | 122 always-mapped bytes at the label, for callers and the on-screen editor. |

Clobbers `A`, `X`, `Y`, and flags. Does not use zero page. Does not enable a
Mockingboard IRQ. Does not touch `$C006`/`$C007`. Every return reads `$C082`,
so upper ROM is visible and language-card writes are off even if the caller
had banked RAM over `$D000-$FFFF`. ROM is restored before chip setup or a
`$C010` keyboard-strobe access, because that access edges motherboard VIA1
CB1 and this emulator turns that edge into an NMI. Sound is silent on every return. Call
`TTS_INIT` once before `TTS_SPEAK` if the chips have never been set up;
`TTS_SPEAK` will initialize them on the first call.

Lowercase ASCII is folded to uppercase. Allowed characters are `A-Z`, `a-z`,
space, `'`, `-`, `.`, `,`, `?`, and `!`. Anything else, or a 121st character,
returns `A=2` with no speech.

## Memory

| Region | Use |
| --- | --- |
| `$0800` | `JMP` to the UI. `TTS_INIT` and `TTS_SPEAK` follow, still in `$0800-$8FFF`. |
| program image | Rules, phoneme table, messages. Ends before `$1C00`. |
| `TTS_INPUT` | 122-byte text buffer. |
| following RAM | Normalized copy, word buffer, phoneme buffer, engine scratch. |
| `$0300-$031F` | Reserved for the shared checker's trampoline. Not used. |
| `$0400-$07FF` | Text page, written by the UI only. |
| `$C400` / `$C480` | Left and right Mockingboard VIA/AY. |

No language-card bank and no `$9000` staging. A raw `BRUN TTS.PRG 0800` is the
whole load. Browser bulk load of the same image is the same map.

## Synthesis

AY clock assumption: 1,573,437.5 Hz. Tone period = round(clock / (16 * Hz)).
Envelope period is 50 (about 123 Hz) or 40 when the line contains `?`.

Each phoneme is 8 bytes: duration in ~11 ms frames, formant periods, volumes,
and a mode nibble. Frame delay is `FWAIT` (14) outer loops of 256 `DEX`/`BNE`
pairs, about 11 ms at 1.573 MHz. That figure is a cycle estimate, not a
measured wall-clock sample rate. The checker records PCM at 48 kHz.

- Vowels: channel A is F2, channel B is F1, both on the envelope (`$10`). Mixer `$3C`. Shape `$0E` is latched once per voiced run.
- Nasals: low formant on B only.
- Fricatives: noise plus a tone at a chosen peak. Voiced fricatives also pulse a low tone from the envelope.
- Stops: two silent frames, then a short noise burst.

Both chips get the same writes, so the hard-panned pair is heard in both ears.
`$C030` is not used. No host synthesis.

`generate.mjs` is the parameter source (frequencies, noise periods, mode ids).
The bytes it prints are the `PTAB` table in `tts.s`. `test.mjs` checks they match.

## Pronunciation

A short whole-word exception list supplements general rules. The rules cover
digraphs (`TH`, `SH`, `CH`, `QU`, `EE`, `OW`, …), a few longer patterns
(`TION`, `ALK`, `ARE`, `OFT`, `OLD`), silent final E when one consonant
precedes it, and final-S voicing after a long vowel, ER, or a voiced consonant.
Apostrophes are dropped (`DON'T` is read as `DONT`). This is an original small
rule set, not a copy of a published lexicon. Irregular words outside the
exception list will be wrong. Soft G is always hard. Numbers are rejected.

## Reused hardware helpers

The VIA reset and AY address/data latch in `reset_chip` / `ay_one` follow
`codegen/programs/groovebox.s` (Eric Badger / 3RIC, MIT): port B bit 0 is BC1,
bit 1 is BDIR, bit 2 is active-low reset, and a falling BDIR edge latches.
New source and the original phoneme data are MIT. See the repository `LICENSE`.

References used as hardware and phonetics background, not as copied tables:
the 3RIC emulator Mockingboard contract, the GI AY-3-8910 register map, and
general formant ranges (F1 roughly 280–720 Hz, F2 roughly 700–2300 Hz), rounded
for this voice.

## Tests

```text
pwsh -File web\build.ps1
node codegen\tools\check-tts.mjs --entry grok-4-7
node codegen\challenges\tts\v1\submissions\grok-4-7\test.mjs
node codegen\challenges\tts\v1\submissions\grok-4-7\generate.mjs
```

`test.mjs` covers UI typing, backspace, the 120-character limit, rejected
characters, Escape back to the monitor, empty/invalid/overlength silence,
repeated `HELLO`, cancellation, speech after cancel, bank mapping, and IRQ
enable bits. It does not certify intelligibility.

## Evidence and gaps

- Automated checker on this source: `node codegen/tools/check-tts.mjs --entry grok-4-7` passed (runtime). Public sentences took about 3.26 s, 4.47 s, 5.01 s, and 3.93 s. The 120-character case took 12.80 s. Escape returned in 0.54 s with A=1. These are emulated seconds at 1.5734375 MHz, not a listening score.
- PCM: checker WAVs are unmodified emulator output at 48 kHz. Peak level in
  `test.mjs` for `HELLO` was about 0.37. That is energy, not proof of speech.
- Heard: no human listening pass was done in this run. Phoneme traces for the
  public sentences were inspected in the VM, not by ear.
- Hardware: not run on a physical 3RIC or Mockingboard.
- Apple II compatibility is not claimed.
