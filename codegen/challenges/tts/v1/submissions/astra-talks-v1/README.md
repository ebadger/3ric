# Astra: Copper Voice

Original GPT-6 Astra entry for 3RIC Talks v1. Entry ID: `astra-talks-v1`.
Frozen platform: `bd795bee12c5fb73a7de9e733e19e0aad95fb57c`.

## Entry-local specification (written before implementation)

The complete image, state, input and synthetic phoneme tables must fit in
always-mapped RAM starting at `$0800` and ending before `$9000`. Text page 1,
the hardware stack, ROM variables, `$0300-$031F`, and upper ROM are not scratch.
No shared platform contract or file is changed.

Data flow: keyboard latch -> visible 120-character editor -> bounded ASCII
validation/normalization -> word boundaries -> small exception lexicon or general
contextual grapheme rules -> phoneme queue -> timed synthetic waveforms -> real
slot-4 VIA bus transitions -> AY amplitude DACs -> ordinary emulator PCM.
All text-dependent processing runs on the 65C02.

The voice uses original harmonic/formant phoneme waveforms and filtered synthetic
noise, never recorded speech. An offline, text-independent generator emits these
small building blocks and original pronunciation rules into self-contained `tts.s`.
Two summed AY channels encode each sample; both chips receive the same speech.
The third channel is silent. Tone and noise gates are disabled for amplitude-DAC
operation. A polled slot-4 timer, not a ROM vector or host clock, sets the cadence.
No writes to the system speaker or onboard VIA are permitted.

`TTS_INIT` must work before the UI, return normally and silence both chips.
`TTS_SPEAK` takes a NUL-string pointer in A/X, preserves all input bytes, validates
at most 121 characters before producing sound, and returns 0/1/2 for complete/
cancelled/invalid. Lowercase is normalized in private storage. Empty and space-only
strings produce no audio. `TTS_INPUT` reserves 122 bytes. Escape is polled during
playback and silences before returning. The routines restore borrowed zero page and
the caller's interrupt/decimal flags. They require exclusive use of the Mockingboard.

Bank contract: init and speak return with BASIC and upper ROM visible. Speak selects
`$C007` while reading the input, so a caller's string may also live in lower RAM
`$9000-$BFFF`; code, private buffers and tables never live there. `$C006` restores
BASIC at return. This is an explicit mapping, not a promise to preserve the caller's
BASIC selection: the baseline ROM keyboard NMI itself temporarily banks BASIC and
returns with it disabled. Upper ROM is never hidden.

The editor shows all 120 characters, supports Backspace/Delete/Left-arrow deletion,
rejects unsupported characters visibly, and reports a full buffer without truncating
it. Enter speaks, then clears the editor for another utterance. Escape while speaking
returns to editing; Escape while editing silences and exits through `BRK`. The
ROM's text-window bounds, I/O vectors and NMI facilities must remain intact.

## Implementation status

Implemented and emulator-exercised. The common checker passes all 16 calls. The
entry-local script passes 12 grouped checks and captures four additional runtime
sentences. **Intelligibility has not been listened to or established. Physical
hardware has not been tested.** These are not self-awarded conformance badges.

The original evaluated revision is recorded in the PR body and the check report's
`provenance.gitRevision`; `sourceSha256` identifies the exact assembly. Freeze the
original commit before external-model review. Any subsequent review-assisted edition
must be identified separately, not substituted for the original result.

## Controls

Run at native **1x**, activate browser sound with a normal pointer/key gesture,
then type letters, spaces, apostrophes, hyphens or `. , ? !`. The four editor rows
show the full buffer and an underscore cursor. Backspace, Delete and Left-arrow
(ASCII 8) delete the last character. Unsupported keys and the 120-character limit
produce visible status messages rather than losing text.

Enter speaks and clears the buffer on completion. Escape during translation or
speech cancels, silences and retains the text for editing/retry. Escape at input
clears the screen and executes `BRK`; the ROM monitor remains usable. No pitch/rate
controls or simultaneous music are provided.

## Callable ABI and ownership

| Symbol | Address | Contract |
|---|---|---|
| `TTS_INIT` | `$0803` | Independent init; normal `RTS`, both chips silent. |
| `TTS_SPEAK` | `$08A1` | A/X = low/high NUL-string address. Returns A=0 complete, 1 cancelled, 2 invalid. |
| `TTS_INPUT` | `$0EDA-$0F53` | 122 consecutive caller/editor bytes, including terminator/overlength probe. |

Use symbols from the assembler rather than hardcoding these addresses into callers.
Call `TTS_INIT` after loading. `TTS_SPEAK` also resets the sound hardware, so repeated
calls, including after cancellation/invalid input, do not depend on previous audio
state. It validates the entire input before speaking and preserves its bytes.
Input may be elsewhere in lower RAM through `$BFFF`, must not overlap engine-owned
code/workspace, and must terminate within 120 characters. A non-NUL character at
index 120 returns invalid; no unbounded scan occurs. An effective address at or
above `$C000` is rejected before reading MMIO. Empty, spaces-only and punctuation-only
inputs return complete without speech. Unsupported bytes, including high-bit ASCII,
return invalid.

A, X, Y and arithmetic/result flags are clobbered; the caller's I and D flags and
borrowed `$06-$0D` are restored. Non-reentrant; exclusive Mockingboard ownership.
Both VIA interrupt enables are cleared, not restored to another sound application's
configuration. Left T1/ACR and both VIA data-direction/control ports are owned.
No application IRQ handler is installed, no IRQ is enabled, and ROM vectors/onboard
`$C200` VIA remain untouched by application instructions. `SEI` protects the kernel;
ROM keyboard NMI remains enabled and upper ROM stays visible. Entry requires the
normal booted ROM environment and a valid hardware stack (allow at least 64 free
stack bytes for application plus ROM interrupt nesting).

Both exported routines explicitly select upper ROM using `$C082`. Init returns
with BASIC visible. Speak exposes BASIC-window RAM with `$C007`, reads the string,
and restores `$C006` on all returns. It does **not** preserve an incoming BASIC-off
mapping. The ordinary ROM keyboard NMI also manipulates that overlay; the engine
does not depend on BASIC remaining selected during its execution.

## Memory and physical loading

| Region | Use |
|---|---|
| `$0006-$000D` | Four borrowed pointers; saved/restored by speak. |
| `$0100-$01FF` | Normal CPU/ROM stack, not private storage. |
| `$0300-$031F` | Reserved for the checker; untouched. |
| `$0400-$07FF` | Text page 1, UI only; callable engine does not draw. |
| `$0800-$17FF` | Code, UI strings, private state and three 122-byte buffers, followed by image padding. |
| `$1800-$19FF` | Bounded 512-byte phoneme queue; at most 360 tokens for 120 input letters, plus sentinel. |
| `$1A00-$2023` | Rule records and waveform metadata; remaining space to `$3000` is image padding. |
| `$3000-$85FF` | Original synthetic waveform DAC tables, 22,016 bytes. |
| `$9000-$BFFF` | Optional caller input only, never loaded code or voice assets. |
| `$C800-$CFFF`, upper language-card RAM | Not used as scratch/storage. |

The complete headerless image is **32,256 bytes**, load/entry `$0800`, end-exclusive
`$8600`. All loaded bytes are below the BASIC overlay. No banked loader, relocation,
ROM patch, host asset or language-card sequence is needed. Copy the generated
`tts.prg` to the physical SD card as `TTS.PRG`, enter the ordinary DOS shell, and run:

```text
BRUN TTS.PRG 0800
```

This is the intended real-board procedure, **not a claim it was executed on hardware**.
Entry-local tests load every image byte through the emulator's bus-write path rather
than relying solely on bulk backing-memory injection; they still do not test the
physical FAT32/SD/ROM loader. No Apple II compatibility is claimed.

## Original pronunciation and synthesis

`generate.mjs` contains the complete numerical voice parameters and original rules.
It reads the original guest template `engine.inc` and emits standalone `tts.s`.
No includes, host preprocessing or generator are needed to run the resulting source
in the browser assembler. `--check` verifies byte-for-byte regeneration.

The guest normalizes text, recognizes word/punctuation boundaries, and searches
169 length-prioritized contextual rules. There are 38 small, whole-word exceptions
for common irregular/function words; other words use digraphs, suffixes, soft C/G,
silent-E, open-syllable and fallback letter-to-sound rules. The exceptions are phone
sequences, not recordings or precomputed sentence audio. Unknown words are synthesized,
not spelled or dropped. Apostrophes inside words are ignored after matching; hyphens
are boundaries. Commas and sentence punctuation get distinct pause durations.

The generator authors 37 phone/pause descriptors. Voiced tiles sum harmonics under
three resonance peaks; nasals reduce higher resonances. Noise uses a deterministic
xorshift stream and an original circular FIR bandpass mixture. Stops have an
exponentially decaying burst, voiced stops add periodic energy, and fricatives use
noise or mixed excitation. All resonance frequencies, gains, durations and random
seed derivation are explicit in the generator. These are heuristic design choices,
not imported human measurements, recordings, pretrained assets or another TTS
engine's tables. Basic formant/source-excitation concepts are general DSP knowledge.

Voiced/burst tiles contain 256 samples; noise/mixed tiles contain 512. Vowels repeat
tiles; stop closures, resonants and fricatives have separate durations. Diphthongs
use two shorter vowel phases (high-bit queue tokens select two repetitions).
There is no runtime floating point or convolution. The guest chooses and clocks
tiles at runtime; offline work never sees the input sentence.

AY register 7 is `$3F`: tone and noise gating disabled, permitting amplitude-DAC
output. Each sample is quantized to the nearest sum of two AY fixed-volume levels.
Channels A/B carry those two codes on **both** chips; channel C remains zero. Every
sample uses actual VIA port-A data and port-B address/data latch transitions
`7 -> 4` and `6 -> 4`; reset uses `0 -> 4` with an explicit hold. The writes are
instruction-timed, not host register pokes. Both channels contain substantially the
same voice, not six independent formant oscillators. The exported WAV is ordinary
unmodified VM stereo PCM.

The left VIA T1 polls a free-running latch of 199 with interrupts disabled.
At the frozen emulator's documented latch+1 cadence, the DAC runs at
**7,867.1875 samples/s**, nominal voiced fundamental **122.9248 Hz** (64 samples).
The physical VIA's precise reload convention and analog AY calibration still need
board measurement; a latch+2 implementation would be approximately 7,828.0473 Hz.
This small hardware uncertainty is not hidden by changing emulator timing.

Measured across 2,047 sample intervals including a phoneme transition: mean
**200.0049 CPU cycles**, min/max **166/244**, versus nominal 200. Translation is
performed before playback; transitions can delay an individual sample and the
polled timer catches up. ROM NMI can introduce additional jitter; this is not a
hard real-time claim under arbitrary external interrupt load. At native clock,
256-sample tiles last about 32.54 ms and 512-sample tiles about 65.08 ms.

## Reproduce and inspect

From the repository root, with Node 22+ and the documented Emscripten 6.0.1:

```powershell
pwsh -File web\build.ps1
node codegen\challenges\tts\v1\submissions\astra-talks-v1\generate.mjs --check
node codegen\tools\check-tts.mjs --entry astra-talks-v1
node codegen\challenges\tts\v1\submissions\astra-talks-v1\test.mjs
```

To regenerate after editing the template/parameters, run `generate.mjs` without
`--check`. Do not manually edit its generated data in `tts.s`.

All generated evidence is ignored, not committed:

- `codegen\out\tts-v1\astra-talks-v1\tts.prg`
- `codegen\out\tts-v1\astra-talks-v1\report.json`
- `codegen\out\tts-v1\astra-talks-v1\sentence-1.wav` through `sentence-4.wav`
- `codegen\out\tts-v1\astra-talks-v1\local\results.json`, `screen.txt`,
  and `new-1.wav` through `new-4.wav`

To stage a local workbench link:

```powershell
node codegen\tools\build-challenges.mjs
pwsh -File web\serve.ps1 -Port 8011
```

Open `http://localhost:8011/index.html?src=programs/tts-v1-astra-talks-v1.s`.
Use normal **1x playback**, not time-stretched playback of the WAVs. Captures are
**48,000 Hz, stereo PCM16LE**; the guest DAC rate is different from that capture rate.
Headless execution may finish faster than wall time, but no guest clock acceleration
or host audio synthesis is used.

### Executed evidence

The unchanged baseline `web\build.ps1` succeeded (existing C++ switch warnings).
Shared checks pass initialization, empty/spaces, 121-character rejection, all four
sentences twice, lowercase, 120-character input, Escape and recovery, with balanced
stack, preserved strings, upper-ROM visibility, PCM activity and settled silence.

| Public recording | Emulated call time |
|---|---:|
| `HELLO. THIS COMPUTER CAN TALK.` | 2.901 s |
| `WE MAKE NEW SOFTWARE FOR OLD COMPUTERS.` | 3.697 s |
| `THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.` | 3.788 s |
| `PLEASE TYPE A SENTENCE AND PRESS ENTER.` | 3.467 s |

The shared 120-character call took 11.473 s; Escape returned in 2,004 cycles
(approximately 1.274 ms) after injection in that test. These values describe
execution, **not speech quality**.

Entry-local checks cover input preservation, invalid/high-bit/unterminated input,
MMIO boundary rejection, worst-expansion 120-character input, lowercase equivalence,
general-rule phone regressions, exact I/D and zero-page restoration, explicit bank
mapping, PCM capture, post-call AY volume registers, IRQ/vector cleanup, visible
editing at the limit, cancellation with retained text, repeated Enter, and `BRK`
followed by a visible `0800` monitor examination command. An instruction-level I/O
trace of one new sentence checks application hardware accesses and absence of speaker
access; static source/layout checks complement it. That trace is not exhaustive
physical bus certification.

New runtime recordings:

```text
RED BIRDS SING IN THE GREEN GARDEN.
MY SMALL ROBOT WILL READ YOUR LETTER.
FRESH SNOW FALLS ON A QUIET WINDOW.
DON'T HIDE THE BLUE-GREEN KITE!
```

**Actually heard:** none; the authoring session has no auditory listening access.
**Physical hardware:** none. **Native Windows host:** not run; no shared core changes
were made. The original candidate needs human listening, pronunciation assessment,
and physical SD/Mockingboard testing before any quality/hardware claims.

## Limitations and provenance

Fixed pitch, simple duration rules, tile boundaries, limited spectral bandwidth,
periodic noise tiles and AY quantization make this intentionally synthetic.
There is no stress lexicon or continuous articulatory interpolation. English
orthography is ambiguous: e.g. the general rules currently misread `QUIET` and
`DON'T`, and do not choose between noun/verb `READ`, `WIND`, etc. Final consonant
voicing, reductions and complex morphology are approximate. Long input has an
audible-start delay while the CPU translates it; Escape is checked during that
translation as well as playback. Only the required ASCII subset is supported.

Model: **GPT-6 Astra, `gpt-6-astra`**, matching the coordinator's request.
Reasoning-effort configuration, temperature, seed and context tier are **unknown**
to this session. Authoring used GitHub Copilot App/CLI, Windows PowerShell, Node
v24.18.0, Emscripten 6.0.1, existing assembler and baseline WASM. The human/coordinator
provided requirements, not engine/rule/voice implementation. No other entrant or
existing speech engine was read. No implementation was delegated.

Read-only external-model review is a separate, post-freeze activity recorded in
the PR, not implementation assistance. The required pinned Gemini model
`gemini-3.1-pro-preview` is unavailable in this runtime's tool model choices; its
review must remain pending/unavailable, not silently substituted or marked passed.
The coordinator explicitly directed submission with that fact disclosed.

## References and licensing

All required references were accessible and read at the frozen baseline. Significant
3RIC references (no speech engine/voice references were used):

- [Canonical published prompt](https://ebadger.github.io/3ric/challenges/tts/v1/prompt.md)
  and [submission guide](https://ebadger.github.io/3ric/challenges/tts/v1/SUBMITTING.md).
- [Assembler/conventions](https://github.com/ebadger/3ric/blob/bd795bee12c5fb73a7de9e733e19e0aad95fb57c/codegen/platform/prompt-system.md),
  [platform reference](https://github.com/ebadger/3ric/blob/bd795bee12c5fb73a7de9e733e19e0aad95fb57c/codegen/platform/platform-ref.md)
  and companion `platform-ref.json` symbols.
- Baseline `specs\EMULATOR.md`, `specs\ROM-SOFTWARE.md`,
  `emulator\Badger6502VMLib\vm.h`, `vm.cpp`, and `web\test_debugger.cjs`:
  memory, ROM and banking semantics.
- [Groovebox hardware helpers](https://github.com/ebadger/3ric/blob/bd795bee12c5fb73a7de9e733e19e0aad95fb57c/codegen/programs/groovebox.s)
  and `web\test_mockingboard.cjs`: permitted VIA/AY reset, bus, clock and timer reference.
  Independently written dual-chip DAC routines implement the same required protocol;
  no Groovebox sequencer/music/synthesis code or data was reused.
- Baseline `codegen\tools\groovebox.test.mjs`, `harness.cjs`, `check-tts.mjs`:
  guest execution, assertions and ordinary PCM capture patterns.
- Baseline `status\SYSTEM-STATUS.md`, `web\README.md`: exact build environment.
- Baseline `emulator\Badger6502VMLib\ay38910.cpp`: 16 hardware DAC calibration
  constants, not synthesis/voice assets. Its zlib notice is preserved in `NOTICE.txt`.

Original guest source, generator, tests, pronunciation rules and generated synthetic
voice data are **MIT licensed**, explicitly including generated `tts.s`.
Documentation follows the repository's **CC BY-SA 4.0** license. `NOTICE.txt`
distinguishes the extracted hardware calibration constants and their license.
