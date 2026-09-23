# claude-opus-5-run-1 — summed-DAC formant synthesis

An original English text-to-speech engine for 3RIC. Everything that depends on the
text — letter-to-sound translation, phoneme timing, prosody and every audio sample —
is computed by the 65C02 at native 1x speed. Sound leaves the machine only as
AY-3-8910 register writes to the two Mockingboard 65C22/AY pairs at `$C400` and
`$C480`. There is no speech chip, no `$C030` speaker output, and nothing is
synthesised by the host, the browser or the network.

## Running it

Assemble and load the raw headerless image at `$0800` and jump to `$0800`:

```
node codegen/tools/asm6502.mjs \
  codegen/challenges/tts/v1/submissions/claude-opus-5-run-1/tts.s \
  --org 0x0800 --raw -o tts.prg
```

The image is 32848 bytes (`$0800`–`$884F`).

### The type-and-speak app

`$0800` enters a text-mode prompt.

| key | effect |
| --- | --- |
| printable ASCII | appended to the line and echoed; the line is capped at 120 characters |
| Backspace / Left arrow | delete the last character |
| Return | speak the line |
| Escape while speaking | cancel immediately and silence the chips |
| Escape at the prompt | leave the app with `BRK` (returns to the monitor) |

Speech runs with interrupts disabled at the CPU and with both VIA interrupt
enable registers cleared, so cancelling mid-utterance cannot leave a stuck tone
or a stray IRQ pending. On exit the mixers are muted, all six amplitudes are
zeroed and both `ACR`s are put back to 0.

## Engine API

All three labels are exported case-insensitively.

| label | address | contract |
| --- | --- | --- |
| `TTS_INIT` | `$4000` | Initialise both Mockingboard pairs and the engine. No arguments. Returns `A = 0`. Must be called once before `TTS_SPEAK`. |
| `TTS_SPEAK` | `$40B6` | `A` = low byte, `X` = high byte of a pointer to a NUL-terminated ASCII string. Returns `A = 0` spoken to completion, `A = 1` cancelled by Escape, `A = 2` invalid input (over 120 characters, or a character the engine cannot pronounce such as a digit). |
| `TTS_INPUT` | `$0803` | 122 reserved bytes of always-mapped RAM: 120 characters plus a NUL plus one guard byte. The bundled app writes here, but `TTS_SPEAK` accepts a pointer to any buffer. |

`TTS_TRANSLATE` (`$40ED`) is an extension used by the test suite: same pointer
convention, but it only runs the letter-to-sound stage and leaves the phoneme
string in `phonbuf` so the rules can be checked without synthesising audio.

### Clobbers, IRQ and timing

* `A`, `X`, `Y` and the flags are clobbered. Zero page `$06`–`$22` is used during
  synthesis and is **saved and restored** by every public entry point, so the
  caller sees zero page unchanged.
* No banking. The upper ROM stays visible for the whole run; no soft switch other
  than the text-mode ones the app already relies on is touched.
* Interrupts are disabled with `SEI` for the duration of an utterance and restored
  afterwards. Both VIA `IER`s are set to `$7F` (all sources disabled) at
  `TTS_INIT`, so the engine neither needs nor generates an IRQ. The sample clock is
  VIA 0 timer 1 in free-running mode, **polled** on `IFR` bit 6 — never via an
  interrupt.
* PHI2 = 1 573 437.5 Hz. The T1 sample period is **320 cycles**, giving a sample
  rate of **4917.0 Hz**. A control frame is 41 samples ≈ 8.34 ms.
* The sample loop must finish inside 320 cycles. Its worst-case path is the
  once-per-sample control task; if the loop ever overran, the pitch would drop
  below its nominal value, which is why the test suite asserts a measured F0 of
  ~107 Hz.

## How it works

### 1. Letter to sound (on the 6502)

`translate` walks the input left to right against an original table of
context-sensitive rules of the form *left-context / focus / right-context →
phonemes*, written for this entry from scratch. Contexts can test for a vowel, a
consonant, a word boundary, or a literal string. A small exception list
(`exctab`) handles the common irregular words that no compact rule set gets right
(`THE`, `OF`, `ONE`, `SAID`, `ARE`, `WAS`, …). Output is a compact one-byte-per
phoneme string in `phonbuf` (200 max), with `,` and `.` acting as pause markers.

No existing rule set, dictionary, phoneme table or voice was copied or ported.

### 2. Phonemes to segment records

Each phoneme maps to one or more *records* in the generated table: target F1, F2
and F3 bank indices, a gain, a noise period, a noise amplitude, a duration in
frames, and flags. Diphthongs and stops are chains of linked records. The
inventory lives in `records.mjs` as human-readable Hz values and is compiled into
the assembly by `generate.mjs`.

Prosody is a declining pitch contour: the glottal period starts at `T0BASE` and
lengthens toward `T0MAX` across the utterance, with punctuation inserting pauses.

### 3. Synthesis (parallel formants, on the 6502)

Three formants are generated in parallel as truncated impulse responses. At each
glottal pulse the phase counter resets; every sample the engine reads one byte
from each of three 256-byte impulse-response pages and sums them:

```
sum = f1[phase] + f2[phase] + f3[phase]
```

There are 24 F1 banks (180–1100 Hz), 32 F2 banks (550–2340 Hz) and 8 F3 banks
(1600–2380 Hz), spaced logarithmically, generated offline by `generate.mjs` as
damped sinusoids with per-formant bandwidths and peak amplitudes 64 / 36 / 17
(so the sum always fits a signed byte). Formant *indices* are smoothed toward
their targets once per frame with `cur += (tgt - cur) >> 1`, which is what makes
transitions between phonemes sound like coarticulation rather than splices.

Fricatives, aspiration and stop bursts use the AY's own hardware noise generator
on channel B, with the record's noise period and amplitude.

### 4. The DAC

The AY has no PCM path, so the three channel amplitude registers are used
**together as one summed logarithmic DAC**. The AY volume curve is logarithmic
(16 steps, roughly 1.5 dB apart), so any single channel is a terrible 4-bit DAC —
but the *sum* of two or three channels set to different codes lands on many more
distinct levels:

| channels | distinct levels | modelled SNR |
| --- | --- | --- |
| A + C (2) | 136 | 29.4 dB |
| A + B + C (3) | 816 | 44.6 dB |

So the engine keeps two sets of tables. When a record needs hardware noise,
channel B is the noise source and the DAC runs on A + C. When it does not
(all voiced sounds, which is most of the time), channel B joins the DAC and the
resolution jumps by ~15 dB. `nmode` selects between the two table sets at record
boundaries.

Each table is 16 gain steps × 256 entries × one AY code per channel, indexed by
the **signed** sample byte. The tables are not built by picking the nearest code
combination for each level independently: because the three registers are written
sequentially about 38 µs apart inside a 203 µs sample period, neighbouring
entries that use wildly different code combinations make the chip pass through
far-off intermediate states and glitch. `buildTable()` therefore walks the table
in level order and, among code combinations of nearly equal accuracy, prefers the
one closest to the previous entry (`MOVE_WEIGHT`).

Both chips are written with identical values, so the output is mono across the
Mockingboard's two outputs.

### Memory map

| range | contents |
| --- | --- |
| `$0800` | `JMP` to the type-and-speak app |
| `$0803`–`$087C` | `TTS_INPUT`, 122 bytes |
| `$0880`–`$0BFF` | engine variables, phoneme buffer, record buffer, zero-page save area |
| `$0C00`–`$3BFF` | formant impulse-response banks |
| `$3C00`–`$3EFF` | bank pointer tables and phoneme records |
| `$4000`–`$53xx` | engine and app code |
| `$6000`–`$87FF` | three-channel DAC tables and the noise-mode constant pages |
| `$8800`–`$884F` | DAC table pointer tables |

## Regenerating the tables

`tts.s` contains a generated block delimited by
`; ---8<--- GENERATED TABLES BEGIN` / `END`. Everything inside it — impulse
responses, DAC code tables, pointer tables and phoneme records — is produced from
`generate.mjs` and `records.mjs`, both of which are committed here with their
parameters. Nothing in them is derived from a recording, a pretrained model or
another TTS system.

```
cd codegen/challenges/tts/v1/submissions/claude-opus-5-run-1
node generate.mjs        # rewrites the generated block in tts.s
```

Edit `records.mjs` to retune the phoneme inventory (targets are plain Hz), or the
`BANKS` / `SAMPLE_PERIOD` / `GAIN_STEPS` constants at the top of `generate.mjs`
to change the acoustic grid, then re-run it.

## Verification

```
pwsh -File web/build.ps1                                   # Emscripten 6.0.1 runtime
node codegen/tools/check-tts.mjs --entry claude-opus-5-run-1
cd codegen/challenges/tts/v1/submissions/claude-opus-5-run-1
node test.mjs                                              # own suite, 55 checks
node test.mjs rules|behaviour|audio|vowels                 # one section
TTS_SHOW_ENVELOPE=1 node test.mjs vowels                   # print harmonic envelopes
node offline.mjs <f1> <f2> <f3> <gain> <t0>                # spectrum of one steady record
```

The official checker reports **passed (runtime)**.

`test.mjs` covers, beyond the official checks:

* **rules** — 17 letter-to-sound cases including all four public demo sentences,
  silent *e*, soft *c*/*g*, digraphs, and the exception list.
* **behaviour** — init, a full 120-character line, 121-character rejection, digit
  rejection, Escape cancellation and its return code, cancellation promptness,
  silence after cancellation, speaking again after a cancellation, and bit-exact
  repeatability of a repeated utterance.
* **audio** — each public sentence: completion code, plausible duration, usable
  peak level, voiced-frame ratio (so a click or a buzz cannot pass), and that F1
  and F2 both move through many distinct regions across the sentence.
* **vowels** — speaks `ME`, `MOO`, `LAW`, `MAN`, `MAY`, estimates F0 by
  autocorrelation, samples the spectrum **at harmonics of F0** and checks that the
  measured F1/F2 are near the record targets.

That last point is worth stating explicitly: the voice is strictly periodic, so
its spectrum is a comb of F0 harmonics. Reading formants off a fixed frequency
grid produces phantom peaks that are simply harmonics of the pitch, and an early
version of this test was fooled exactly that way.

`offline.mjs` reproduces the sample loop in JavaScript **from the assembled
tables in the image** and prints the ideal signal's harmonic envelope next to the
same signal pushed through the AY DAC model, which is how a DAC indexing bug in
an earlier revision was found.

## Limitations — honest list

* **No human has listened to this.** Every claim about it is based on automated
  spectral and waveform measurement inside the emulator. The measurements show a
  correct formant structure on sustained vowels and correct letter-to-sound output
  on the demo sentences; they do **not** establish that a listener would find the
  sentences intelligible.
* **Never run on physical hardware.** No real 3RIC, no real Mockingboard, no real
  AY-3-8910. Everything was verified against the emulator's AY/VIA model, which
  may be more forgiving than the real chip — in particular about how quickly the
  three amplitude registers settle relative to each other, which this DAC depends
  on.
* The 4917 Hz sample rate puts Nyquist at 2458 Hz, so F2 is capped at 2340 Hz and
  F3 at 2380 Hz. High front vowels and sibilants are consequently duller than they
  should be, and F3 carries little information.
* Prosody is only a declining pitch contour plus punctuation pauses. No question
  intonation, no lexical stress, no emphasis — so longer sentences sound flat and
  monotone.
* The rules plus a ~30-word exception list cover common English spelling. Irregular
  words outside that list, proper nouns and loanwords will be mispronounced.
* Digits and characters outside the supported punctuation set are rejected
  (`A = 2`) rather than spoken; there is no number-to-words stage.
* Caps: 120 input characters, 200 phonemes, 250 synthesis segments. A line that
  translates past those caps is truncated rather than rejected.
* Both chips are fed identical data, so there is no stereo and the second
  Mockingboard pair adds only loudness.
