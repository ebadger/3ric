# Pulse-Reset Formant Voice (`claude-opus-5-5-run-1`)

An original English text-to-speech program for 3RIC. Everything that depends on the
input text runs on the 65C02: letter-to-sound rules, stress, prosody and synthesis.
The sound leaves only through register writes to the slot-4 Mockingboard's two
AY-3-8910 chips. The voice is a deliberately retro, buzzy robot.

- Entry ID: `claude-opus-5-5-run-1`, challenge `tts-v1`, baseline
  `bd795bee12c5fb73a7de9e733e19e0aad95fb57c`.
- Author: Claude Opus 5.5 via GitHub Copilot, for ebadger. The model was
  `claude-opus-5.5`. Reasoning effort, temperature, seed and context tier are unknown.
- Agent: GitHub Copilot app coding agent in autopilot mode, working in an isolated git worktree.
- Assistance: none on code, rules or voice data. See `entry.json`.

## Files

| File | Purpose |
| --- | --- |
| `tts.s` | The whole program: engine, UI and generated tables. It is self-contained asm6502 source. |
| `generate.mjs` | Makes the phoneme templates, rules, DAC maps and sine level pages, and splices them into `tts.s`. It also contains the reference letter-to-sound model. |
| `test.mjs` | Entry-local tests: generated data in sync, 6502-vs-reference G2P parity, ABI, UI, cancel, BRK and monitor. |
| `entry.json` | Challenge metadata. |

## Controls (interactive program)

To run it on hardware, load and run `tts.prg` at `$0800` with `BRUN TTS.PRG 0800`.
No bank preparation is needed. In the workbench, assemble and run the source.

| Key | Action |
| --- | --- |
| letters, digits, space, `' - . , ? ! ; :` | Type into the 120-character field. The count is shown. |
| Delete / Backspace / Left arrow | Erase the last character. |
| Ctrl-X | Clear the field. |
| Enter | Speak the text. The field clears and the program returns to input when speech finishes. |
| Escape while speaking | Stop at once. Sound is silenced and `STOPPED.` is shown. |
| Escape at input | Print `EXIT TO MONITOR (BRK).`, move the cursor to row 16 and execute `BRK`. The monitor register dump appears below the UI. |

- A key outside the supported set shows `UNSUPPORTED KEY` rather than being inserted.
- Typing past 120 characters shows a limit message; nothing is truncated silently.

## Callable ABI

| Label | Address | Contract |
| --- | --- | --- |
| `TTS_INIT` | `$0803` | Silences both AYs, disables VIA interrupts, clears flags and fills the word buffer. It is callable straight after loading. Returns with `RTS`, and P is restored. |
| `TTS_SPEAK` | `$08A7` | Takes A = low byte and X = high byte of NUL-terminated ASCII. Blocking. Returns A=0 when done (including empty or punctuation-only input), A=1 when Escape cancelled, A=2 when invalid. |
| `TTS_INPUT` | `$16D9` | 122 bytes of always-mapped RAM for callers and the UI. |
| `TTS_G2P` | `$08FC` | Test hook: validates the input and writes phoneme codes to `$4000` (NUL-terminated) without sound. |

`TTS_SPEAK` details:

- **Input rules:**
  - Lowercase is normalised.
  - Allowed characters are `A-Z a-z 0-9 ' - space . , ? ! ; :`. Any other character, or no NUL within the first 121 bytes, returns A=2 with no sound.
  - The scan is bounded. The 121st byte (index 120) must be NUL.
  - The input string is never written.
- **Clobbers** A, X and Y. P is restored, including the I flag as it was on entry. D is cleared.
- **Zero page:** `$60-$9F` is saved into the image on entry and restored on exit.
- **Interrupts:** IRQs are masked with `SEI` only while sound is produced. The engine enables no VIA interrupt, and on return IER has interrupts disabled with flags cleared.
- **Timer:** the left VIA's T1 free-runs at 256 cycles during speech, and ACR is set back to 0 afterwards.
- **Sound on return:** both AYs have volumes 0 and the mixer set to `$3F`.
- **ROM mapping:** it is never changed.
- **Timing (measured in the emulator at 1x):**
  - The public sentences take 3.3-3.9 s per call, and a 120-character input takes 10-12 s.
  - Text analysis runs before any sound. The first output (a 41 ms DAC ramp to mid-scale) starts 0.07-0.14 s after the call for typical sentences, and about 0.30 s after the call for 120 characters.
  - Escape is polled per character and per phoneme during analysis, and at every synthesis frame (at most about 8 ms apart). Measured return after Escape: 18-26 ms in 	est.mjs.

## Memory map

| Region | Use |
| --- | --- |
| `$0060-$009F` | Engine zero page. It is saved and restored by `TTS_SPEAK`. The UI uses `$60-$63` between calls. |
| `$0300-$031F` | Not used. It is reserved for the shared caller trampoline. |
| `$0400-$07FF` | Text page 1. Only the UI draws here; the engine does not. |
| `$0800-$3EFF` | The loaded image: code, messages, `TTS_INPUT` (`$16D9`), the word buffer (`$1800`), templates, rules, DAC maps, and 16 page-aligned sine level pages (`$2F00-$3EFF`). |
| `$4000-$47FF` | Phoneme buffer. Writes are bounds-checked. |
| `$4800-$6FFF` | Segment buffer: 16-byte records, bounds-checked with a guard at `$6FE0`. |
| `$7000-$BFFF` | Not used. |

There is no banking:

- The BASIC overlay switches (`$C006`/`$C007`) and the language card are never touched.
- `$D000-$FFFF` stays as the boot ROM.
- The UI calls the ROM `BASCALC` (`$FBC1`) once, before `BRK`.

## Synthesis design

1. **Letter-to-sound.** There are 420 original rules in `generate.mjs`, written in the form `left[match]right=PHONEMES`.
   - Context classes:
     - `|` word boundary
     - `#` one or more vowels
     - `.` one consonant
     - `:` zero or more consonants
     - `+` E/I/Y
     - `%` voiceless letter
     - `&` voiced letter
     - `@` weak ending such as E, ES, ED, ING, ABLE
   - Rules are compiled into per-letter lists: the left context is stored reversed, and phoneme bytes follow.
   - The 6502 scans each word left to right, and the first matching rule wins.
   - A small set of whole-word rules marks function words as unstressed (`NS`). Words without explicit stress get it on the first full vowel.
   - Digits are read as their names.
   - The rules were written for this entry, not copied from any existing TTS rule set.
2. **Prosody.** Each phoneme expands into one to three 16-byte segment records. A record holds:
   - F1/F2/F3 increments
   - three levels in 3 dB steps
   - excitation mode
   - noise volume and period
   - duration
   - glide rates
   - pitch

   The pitch contour declines across each phrase and resets after `. ? !`. Adjustments by position:

   | Condition | Pitch | Duration |
   | --- | --- | --- |
   | Stressed vowel | Raised | ×1.25 |
   | Function word | — | ×0.75 |
   | Phrase-final vowel | Falls (rises for `?`) | ×1.5 |

   Stops and `HH` borrow the following vowel's formants.
3. **Synthesis.** VIA T1 gives exactly 256 CPU cycles per sample, so the rate is 1,573,437.5 / 256 = 6146.2 Hz.
   - **Glottal pulse:** each voiced pulse (base period 48 samples, about 128 Hz) restarts three sine oscillators at phase 0 at their current levels.
   - **Decay:** every 3 samples each formant's level page steps down 3 dB. F3 steps every event, F2 every second event, F1 every fourth. This gives bandwidths of roughly 56, 113 and 226 Hz.
   - **Aspiration:** aspirated segments restart at random short intervals with random phases.
   - **Output:** the three table lookups are summed. The DAC maps turn the sum into a pair of AY volumes for registers 8 and 9, written to both AYs.
   - **Noise:** AY channel C carries the noise generator for fricatives and bursts.
   - **Frames:** at most every 48 samples, at a pulse, the engine polls the keyboard. It also advances segments and glides seven parameters toward their targets.
4. **DAC tuning.**
   - **The problem:** register 8 is latched about 31 cycles before register 9. An unconstrained nearest-pair map therefore produces large transient mismatches: a modelled SNR of about 10 dB.
   - **The fix:** the map limits register 9 to volumes 0-6 and uses a 0.7 full scale in the AY volume sum. The modelled SNR becomes about 28 dB (see `generate.mjs`). This was the single largest measured improvement in the offline recognition proxy.

**Budgets.**
- Measured:
  - The image is 14,080 bytes.
  - Sentences take 2.8-5.0 s in the emulator.
  - Changing the decay interval from 4 to 3 samples did not change the sample count.
  - At 2 samples, sentences grew about 2% longer, which shows sample overruns.
- Estimated from instruction counts: the common per-sample path is about 237 of 256 cycles. Pulse, decay and frame work is spread across samples, sometimes finishing a sample late while T1 keeps the average rate.

## References

- General formant-synthesis ideas: source-filter theory, and pulse-excited decaying resonators as in classic formant synthesizers.
- Published average vowel formant frequencies (Peterson & Barney style tables), used only as starting values for hand-tuned templates.
- 3RIC `codegen/programs/groovebox.s`: the AY bus-write pattern (address strobe 7→4, data 6→4) was adapted from this repository helper (MIT).
- 3RIC `specs/EMULATOR.md`, `codegen/platform/platform-ref.md`, and `emulator/Badger6502VMLib/mockingboard.cpp` / `ay38910.cpp` (the BDIR falling-edge latch and the volume table).

No existing TTS engine, rule set, voice table, recording or speech model was used to
create assets.

## License

MIT (the repository license) covers all new source, rules, tables and the generator.

## Reproduce

From the repository root, after `pwsh -File web\build.ps1`:

```text
node codegen\challenges\tts\v1\submissions\claude-opus-5-5-run-1\generate.mjs
node codegen\tools\check-tts.mjs --entry claude-opus-5-5-run-1
node codegen\challenges\tts\v1\submissions\claude-opus-5-5-run-1\test.mjs --wav
```

- `generate.mjs` rewrites the generated block. If you haven't edited anything, `tts.s` should be unchanged.
- `node generate.mjs --word "any text"` prints the reference phonemes.
- The checker writes to `codegen\out\tts-v1\claude-opus-5-5-run-1\`. `test.mjs --wav` adds WAVs of new sentences under `entry-tests\`.

`test.mjs` covers:

- the generated block matching the generator;
- G2P parity between the 6502 and `generate.mjs` on 12 varied sentences;
- speaking public and new sentences, including repeats, while checking:
  - ROM mapping, VIA IER and post-return silence after each call;
- Escape cancel during analysis of a 120-character input and mid-sentence: A=1, 18-26 ms latency, then silence and the next sentence works;
- ABI codes for empty, space, punctuation-only, 121 characters, tab and `%`;
- the UI: typing, delete, Ctrl-X, the 120 limit, unsupported keys, Enter speaks and returns, Escape cancels;
- Escape at input: BRK with a monitor dump below the UI, and the monitor accepting a command.

## Known shortcomings

- **No human has listened** to this entry. The only intelligibility evidence is an offline Windows System.Speech dictation proxy:
  - This voice: about 8-17% of words in 8 sentences, depending on the build and run (12% for the submitted build).
  - Windows' own voice: about 90%.
  - Windows' own voice after an offline model of this 6 kHz two-register DAC path: about 60%.
- Fricatives share one unshaped noise spectrum. Stops are simple, and pitch is monotone apart from the rule-based contour.
- Pronunciation is rule-based best-effort: names, heteronyms and irregular words are often wrong. Abbreviations are not expanded, and numbers are read digit by digit.
- Not tested on physical 3RIC hardware, a real Mockingboard, or SD/ROM loading. The DAC glitch analysis assumes the emulator's bus model.
