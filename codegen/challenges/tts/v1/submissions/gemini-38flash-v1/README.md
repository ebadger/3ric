# 3RIC Talks v1 — Gemini 3.8 Flash Speech Synthesizer

## Overview

This entry (`gemini-38flash-v1`) is an original 65C02 English text-to-speech engine targeting the 3RIC personal computer architecture and its Slot-4 dual AY-3-8910 Mockingboard sound card. It implements an English Grapheme-to-Phoneme (G2P) rule engine paired with an irregular word dictionary, translating ASCII text into phonetic acoustic parameters rendered in real time.

## Architecture & Synthesis Design

### 1. Acoustic Synthesis Model
The AY-3-8910 sound generator features 3 square-wave tone channels, 1 noise generator, and 1 hardware envelope generator per chip.
3RIC's master clock feeds the AY directly at $\Phi_2 = 1,573,437.5\text{ Hz}$ ($1.5734375$ MHz). The AY internal tone divider divides by 16, yielding a tone frequency of $f = 1,573,437.5 / (16 \times \text{period}) = 98,339.84 / \text{period}\text{ Hz}$.

The engine defines 42 distinct phoneme models categorized into three acoustic classes:
1. **Voiced Vowels, Glides, and Nasals** (`IY`, `IH`, `EY`, `EH`, `AE`, `AA`, `AO`, `OW`, `UH`, `UW`, `AH`, `ER`, `AY`, `AW`, `OY`, `L`, `R`, `W`, `Y`, `M`, `N`, `NG`):
   - Synthesized using a 2-formant parallel acoustic model. Channel A outputs Formant 1 (F1, 250–850 Hz), while Channel B outputs Formant 2 (F2, 700–2300 Hz).
   - Formant channels use hardware envelope volume modulation (volume bit 4 = 1) driven by an AY repeating sawtooth envelope (shape 8, $\approx 125$ Hz). This produces glottal pulse harmonic excitation, significantly reducing harsh square-wave buzz and producing vocal tract resonance coloration.
   - Channel C provides a low-frequency fundamental voice bar ($F_0 \approx 125$ Hz) for voiced stops and nasals.
   - Diphthongs (`AY`, `AW`, `OY`, `EY`, `OW`) dynamically glide their F1/F2 resonant poles midway through their duration toward their target vowel formant frequencies.
2. **Unvoiced Fricatives and Affricates** (`S`, `SH`, `F`, `TH`, `HH`, `CH`):
   - Tone channels are disabled; AY noise generator is enabled and tuned to appropriate noise pitch periods (e.g. high-frequency noise for `S`, broad mid-frequency noise for `SH`, low-amplitude noise for `F`/`TH`/`HH`).
3. **Plosives and Stops** (`P`, `T`, `K`, `B`, `D`, `G`, `JH`):
   - Implement a ~30 ms silent pre-closure interval followed by a short burst of noise or combined voice-bar tone and noise transient.

### 2. Grapheme-to-Phoneme (G2P) Engine
1. **Punctuation & Flow Control**:
   - Commas, semicolons, and colons insert clause pauses (~150 ms).
   - Periods, exclamation points, and question marks insert sentence boundary pauses (~300 ms).
   - Inter-word spaces insert natural word spacing (~60 ms).
2. **Exception Dictionary**:
   - A compact in-ROM prefix dictionary intercepts 30 high-frequency irregular English words (e.g. `THE`, `ARE`, `YOU`, `ONE`, `TWO`, `COME`, `HAVE`, `SAID`, `WOULD`, `COULD`, `DOES`, etc.) and maps them directly to exact phonetic sequences.
3. **Rule-Based Phonetic Decomposition**:
   - **Silent E Rule**: Detects vowel-consonant-E word endings (e.g., `NAME`, `LIKE`, `HOME`, `TUBE`) and converts the preceding vowel to its long counterpart (`EY`, `AY`, `OW`, `UW`), omitting the silent trailing `E`.
   - **Consonant Digraphs**: Translates `TH` (voiced word-initially, unvoiced internally), `SH`, `CH`, `PH`, `QU` (to `K W`), `WH`, `CK`, `NG`.
   - **Vowel Teams**: Translates `EE`/`EA` (`IY`), `OO` (`UW`), `OA` (`OW`), `OU`/`OW` (`AW`), `OI`/`OY` (`OY`), `AI`/`AY` (`EY`), `AR` (`AA R`), `OR` (`AO R`), `ER`/`IR`/`UR` (`ER`).
   - **Context-Sensitive Consonants**: Soft `C` and `G` before `E`, `I`, `Y`; hard `C` (`K`) and `G` elsewhere. Doubled consonants (e.g., `LL`, `TT`, `SS`) are coalesced into single phonetic releases.

### 3. Timing and Cancellation
- Acoustic frames are timed in software via calibrated cycle-delay loops (~15 ms per frame).
- During every frame delay, the Apple II keyboard strobe (`$C000`) is checked for keypresses.
- If the **Escape** key (`$1B` or `$9B`) is pressed, the synthesis loop immediately silences all sound channels (`AY_MUTE_ALL`), clears the strobe (`$C010`), and returns cleanly with status code `A = 1`.

## Callable ABI Specification

The entry provides three public entry points:

### `TTS_INIT`
- **Location**: In always-mapped RAM at `$0803` (called via `jsr TTS_INIT`).
- **Function**: Initializes the 6522 VIA DDR registers for Slot-4 Mockingboard Left (`$C400`) and Right (`$C480`), resets all AY registers to zero, sets mixer registers to disable all tones/noise, and sets all channel volumes to 0.
- **Registers Preserved**: Safely preserves zero-page and returns via `rts`.

### `TTS_SPEAK`
- **Location**: In always-mapped RAM at `$0815` (called via `jsr TTS_SPEAK`).
- **Calling Convention**:
  - `A`: Low byte of pointer to NUL-terminated ASCII input string.
  - `X`: High byte of pointer to NUL-terminated ASCII input string.
- **Return Values**:
  - `A = 0`: Speech finished successfully, or string was empty.
  - `A = 1`: Cancelled immediately by the user pressing Escape.
  - `A = 2`: Input string exceeded 120 characters without a terminating NUL (offset 120 $\neq 0$).
- **Guarantees**:
  - Never modifies the caller's input string buffer in place.
  - Leaves the CPU stack balanced across all return paths.
  - Restores all Mockingboard audio channels to complete silence before returning.

### `TTS_INPUT`
- **Location**: In always-mapped RAM at `$1589`.
- **Allocation**: 122 bytes reserved via `.res 122`.

## Interactive UI

Running the program from `$0800` (`JMP UI`) starts an interactive text console:
- Clears the screen and displays normal-video title and instruction banners.
- Displays a prompt (`> `).
- Accepts interactive keyboard input with full Backspace character deletion.
- Enforces the 120-character limit with an audible bell (`ROM_BELL`).
- On `Enter`, speaks the buffer using `TTS_SPEAK`.
- If `Escape` is pressed while speaking, speech halts instantly and `[CANCELLED]` is displayed.
- If `Escape` is pressed at the prompt, the program silences audio and exits with `BRK`.

## Memory Map

| Address Range | Allocation | Description |
|---|---|---|
| `$00E0`–`$00EF` | Zero Page | 16-byte workspace (string pointers, word indices, phoneme buffer pointers, AY cache) |
| `$0800`–`$0802` | Jump Vector | `jmp UI` (Interactive program entry) |
| `$0803`–`$0814` | Jump Vector | `jmp TTS_INIT` ABI entry |
| `$0815`–`$0823` | Jump Vector | `jmp TTS_SPEAK` ABI entry |
| `$0824`–`$1468` | Code & Data | G2P rule engine, AY control, phoneme acoustic tables, dictionary |
| `$1469`–`$1568` | RAM Buffer | `PHONEME_BUF` (256 bytes) |
| `$1569`–`$1588` | RAM Buffer | `WORD_BUF` (32 bytes) |
| `$1589`–`$1602` | RAM Buffer | `TTS_INPUT` (122 bytes) |
| `$C000`, `$C010`| MMIO | Apple II Keyboard data and clear-strobe |
| `$C051`, `$C052`, `$C054` | Soft Switches | Text, Fullscreen, Page 1 display mode |
| `$C400`–`$C40F` | MMIO | Slot-4 Mockingboard Left 6522 VIA |
| `$C480`–`$C48F` | MMIO | Slot-4 Mockingboard Right 6522 VIA |

## Test Commands

Assemble the source:
```sh
node codegen/tools/asm6502.mjs codegen/challenges/tts/v1/submissions/gemini-38flash-v1/tts.s -o codegen/challenges/tts/v1/submissions/gemini-38flash-v1/tts.prg
```

Run entrant-specific unit tests:
```sh
node codegen/challenges/tts/v1/submissions/gemini-38flash-v1/test.mjs
```

Run canonical challenge validation and audio synthesis check:
```sh
node codegen/tools/check-tts.mjs --entry gemini-38flash-v1
```

Run test suite across challenge entries:
```sh
node codegen/tools/tts-entry.test.mjs --runtime
```

## Known Limitations & Hardware Status

- **Physical Hardware**: This entry has been developed and verified in 3RIC's cycle-accurate Emscripten WebAssembly emulator and Node headless harness. It has not yet been flashed to physical ROM or tested on physical Apple II / 3RIC PCB hardware with discrete AY-3-8910 silicon.
- **Pitch & Intonation**: Fundamental frequency $F_0$ is held constant at $\approx 125$ Hz (sawtooth envelope period 49). It produces an intelligible classic robotic voice without prosodic pitch bends or question-intonation inflection.
- **Formant Count**: The acoustic model implements 2 formants (F1, F2) plus voice bar rather than a full 4-pole cascade model.
- **Vocabulary Scope**: Unmodeled foreign loanwords, French/Greek irregular spellings, and non-phonetic proper nouns will be rendered strictly according to standard English phonic rules.
