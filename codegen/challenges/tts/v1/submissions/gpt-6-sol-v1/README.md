# Copper Voice — GPT-6 Sol / tts-v1

An original, stand-alone 3RIC English speech experiment. The source itself is
the specification and the loadable image: it starts at `$0800`, reads ASCII on
the 65C02, applies ordered letter/digraph rules, and articulates phonemes by
writing both slot-4 AY chips through their 6522 bus. No word recordings,
browser speech service, pretrained model, or host pronunciation pass is used.

## Interface and operation

`BRUN TTS.PRG 0800`, or Assemble & Run the staged source at 1x in the
browser. Click or press a key to activate browser audio. Type up to 120 ASCII
characters (letters, spaces, apostrophe, hyphen, `. , ? !`); Backspace/Delete
edits, Enter speaks and returns to a new input, Escape while speaking cancels,
and Escape while editing exits to the monitor with `BRK`. Unsupported characters
and a 121st character are rejected visibly. Lowercase is accepted without
modifying the caller's buffer. Blank lines make no sound.

`JSR TTS_INIT` requires the binary already loaded, returns without UI or input,
and resets both AY chips with all channels muted. `TTS_SPEAK` takes a
NUL-terminated ASCII RAM pointer in A (low), X (high), leaves the source
unchanged, returns A=0 on success/blank, A=1 on Escape, A=2 for unsupported
characters or a nonzero 121st byte. Call init before the first speak; repeated
calls are supported. The caller may use `TTS_INPUT` (122 bytes); it must place a
NUL within the first 121 bytes. A/X/Y and processor flags are clobbered, stack
balanced. Do not call reentrantly. CPU interrupt-mask state and vectors are not changed; init
disables **both slot-4 VIA interrupt enables** and leaves them disabled, so
do not call it while another application owns either VIA's IRQ. No application
IRQ is installed; the ROM's NMI remains enabled. Return paths leave upper
monitor ROM visible and AY sound silent.

## Synthesis and pronunciation design

An ordered orthographic transducer recognizes common two-letter sounds,
long-vowel final-e, vowel pairs and the remaining individual letters. No
fixed-word dictionary is necessary: unseen English text follows the same
rules. Each phoneme drives a low voiced fundamental, two changing
square-wave vowel resonances, or AY noise for breath/frication. Consonants
and punctuation insert timed articulations/pauses. Both AYs receive identical
register values (centered mono via the separate hardware stereo paths).
This is a formant *approximation* using square oscillators, not a sampled
vocal tract or human voice. The AYs oscillate at PHI2 (1,573,437.5 Hz);
tone A's period is `$02D8`, about 135 Hz. The 65C02 polls Escape and
counts a busy-wait tick of approximately 3,900 cycles (about 400 Hz) for
duration, not for digital PCM synthesis. No IRQ, timers, or browser frame
scheduling are involved; 48 kHz is the **emulator recording rate**, not
the phoneme update rate. Presets last 16–52 ticks (about 40–130 ms);
punctuation gaps are 72 ticks. These are estimates, not physical timing
measurements.

## Memory and hardware

`$0800-$0F11` contains the 1,810-byte executable image, phoneme presets,
messages, state and the labeled 122-byte `TTS_INPUT` at `$0E98-$0F11`;
no additional code/data banking or guest relocation is required. The ROM text page
`$0400-$07FF` and the usual stack are used through standard ROM calls;
`$06-$07` are the engine's text pointer. Backspace
uses ROM `BASCALC` to update `$24-$25` and `$28-$29` for cross-row screen
edits. `$0300-$031F` remains reserved for the caller. BASIC
window `$9000-$BFFF` and language-card `$D000-$FFFF` are never switched; the
monitor and its NMI/IRQ vectors stay mapped. The sound device is
`$C400/$C480`, via ORA (register 1), ORB (0), DDRA (3), DDRB (2):
address: ORA=register, ORB=7 then 4; data: ORA=value, ORB=6 then 4.
This matches the 3RIC falling-BDIR-edge bus. The AY clocks equal PHI2.
For physical 3RIC, copy the generated headerless `tts.prg` to FAT32 SD,
then `BRUN TTS.PRG 0800`; it loads only always-mapped RAM. No physical-board
run has been performed unless explicitly documented below.

## Reproduction and evidence

On Windows with Emscripten 6.0.1, Node 22+ and PowerShell:

```powershell
pwsh -File web\build.ps1
node codegen\tools\check-tts.mjs --entry gpt-6-sol-v1
node codegen\challenges\tts\v1\submissions\gpt-6-sol-v1\test.mjs
node codegen\tools\build-challenges.mjs
pwsh -File web\serve.ps1 -Port 8011
```

Open `http://localhost:8011/index.html?src=programs/tts-v1-gpt-6-sol-v1.s`.
The shared check writes `codegen/out/tts-v1/gpt-6-sol-v1/tts.prg`,
PCM-derived WAV files and a JSON report (ignored by Git). The extra local
tests exercise actual CPU execution, not a JavaScript speech implementation.
They also capture `unseen-blue-waves.wav` for
`BLUE WAVES WASH OVER SILENT STONES.`. The four public WAVs lasted
2.81, 3.63, 3.73 and 3.52 seconds respectively in the unmodified emulator;
their guest calls used 4.43M, 5.72M, 5.87M and 5.54M cycles. The unseen
utterance lasted approximately 3.38 seconds. The shared check and
entry-local UI/API tests passed; the locally staged source also assembled
and ran from the browser URL above at native 1x. The live Pages workbench
assembled and ran the **manually imported** same source at native 1x;
that is not a claim that this entry is deployed there. WAV headers and
changing PCM levels/frequencies were inspected, but **no audio was
actually listened to**, so intelligibility remains unverified.

## Provenance, rights and limitations

Designed and implemented by GPT-6 Sol for baseline
`bd795bee12c5fb73a7de9e733e19e0aad95fb57c`. The AY reset/register-write
bus sequencing is adapted from the baseline `codegen/programs/groovebox.s`
(3RIC hardware-access helper); keyboard/COUT conventions come from the
baseline platform reference. Pronunciation rules, formant choices, timing and
all source/data here are new. General phonetic ideas (voiced periodic excitation,
vowel resonances and aperiodic frication) are not copied from a TTS system.
New entry source, phoneme data, tests, and documentation: MIT license;
the reused 3RIC hardware helper remains under the repository's applicable
license. No external voice material.

English G2P is heuristic: stress, unstressed vowel reduction, irregular
spellings, homographs, numbers and non-English text are not solved. AY
square/noise spectra and coarse fixed-duration phonemes limit intelligibility;
no physical-hardware or Apple II compatibility is asserted. Check results
prove only their specified observations, not a listener's understanding.
