# 3RIC Talks: the same-prompt speech challenge

Challenge: **tts-v1**. Frozen repository baseline: **{{BASELINE}}**.

## Your challenge

**Make my homebrew computer talk.**

Build an original English text-to-speech engine for **3RIC**, a real 65C02 computer,
using its **Mockingboard's two AY-3-8910 sound chips**. Deliver a working program
that lets a person type a sentence and hear it spoken.

This is part of a public video series. People will try the programs and choose
their favorite. The goal is understandable, enjoyable speech and useful software
that people can keep, study and use in other 3RIC programs. A distinctive retro
robot voice is welcome; natural human speech is not expected.

Implement, assemble, run and improve your entry. Do not stop at a design, pseudocode,
an explanation or a tone demo. If something is incomplete, deliver what you have
and identify the gap honestly.

## Shared starting point

Repository: https://github.com/ebadger/3ric

Use the exact baseline commit above in a separate checkout/worktree on your own
feature branch, not on main. If a dedicated session branch is already provided,
verify that it starts at this baseline. Do not update the platform or use another
entrant's implementation. The host supplies the same development limits and tool
access to official entrants; no development budget is implied by this brief.

Read the [submission guide](https://ebadger.github.io/3ric/challenges/tts/v1/SUBMITTING.md).
Choose a unique entry ID and put your implementation in
`codegen\challenges\tts\v1\submissions\<entry-id>\`.

Follow the repository's instructions and read these baseline-pinned references:

- [Assembler dialect and entry/exit conventions]({{SOURCE}}/codegen/platform/prompt-system.md).
- [Generated platform reference]({{SOURCE}}/codegen/platform/platform-ref.md) and [JSON symbols]({{SOURCE}}/codegen/platform/platform-ref.json).
- [Emulator spec, including the slot-4 Mockingboard contract]({{SOURCE}}/specs/EMULATOR.md).
- [Memory-map definitions]({{SOURCE}}/emulator/Badger6502VMLib/vm.h) and [bank-switch implementation]({{SOURCE}}/emulator/Badger6502VMLib/vm.cpp).
- [Banking/debugger examples]({{SOURCE}}/web/test_debugger.cjs).
- [ROM/software conventions]({{SOURCE}}/specs/ROM-SOFTWARE.md).
- [Groovebox: working AY initialization, register writes and timers]({{SOURCE}}/codegen/programs/groovebox.s).
- [Mockingboard bus and timing checks]({{SOURCE}}/web/test_mockingboard.cjs).
- [Guest execution and PCM capture example]({{SOURCE}}/codegen/tools/groovebox.test.mjs).
- [Build/run environment]({{SOURCE}}/status/SYSTEM-STATUS.md) and [web build instructions]({{SOURCE}}/web/README.md).

If you cannot access a reference or execute a tool, say so; do not invent its behavior.
Local source versions of this brief contain publication tokens. The published download
resolves them; the launch commit can also be printed with
`node codegen\tools\build-challenges.mjs --print-baseline`.

## Actual hardware and RAM

- WDC 65C02 CPU at **1,573,437.5 Hz**, native 1x speed.
- **36 KiB always-mapped RAM** at `$0000-$8FFF`.
- **Another 12 KiB at `$9000-$BFFF`** when the BASIC ROM overlay is disabled:
  access `$C007` to expose RAM; access `$C006` to restore BASIC ROM. This gives
  **48 KiB of contiguous lower RAM** while keeping upper monitor/OS ROM visible.
  Stack, screen and ROM-owned state still consume part of that space.
- **Language-card RAM** via `$C080-$C08F`: two alternate 4 KiB banks at `$D000-$DFFF`
  and shared 8 KiB at `$E000-$FFFF`, overlaying upper ROM. Read selection and write
  enabling have distinct switch/sequence semantics.
- Prefer lower 48 KiB RAM with upper ROM visible. Any language-card use must handle
  ROM-dependent input/output, vectors, interrupts, cancellation and monitor return.
  `SEI` does not mask NMI.
- Text page 1 is `$0400-$07FF`. `$C800-$CFFF` contains system/ROM state, not disposable
  application scratch. Reserve `$0300-$031F` for the shared check's caller trampoline.
- Two 65C22 VIA/AY pairs in slot 4: `$C400` left, `$C480` right. A0-A3 select VIA
  registers; A4-A6 mirror them; A7 selects the pair.
- Each AY has three tone channels, shared noise, an envelope generator and stepped,
  nonlinear amplitude controls. Both AY clocks are **1,573,437.5 Hz**.
- VIA port A is the AY data bus. Port B bits 0/1/2 are BC1, BDIR and active-low reset;
  BC2 is tied high. Follow the documented bus transitions, not guessed register writes.
- **No SSI-263, SC-01 or other dedicated speech chip is present.**
- The onboard VIA at `$C200` is not a Mockingboard VIA. Respect its ROM/NMI behavior.

All processing that depends on input text must execute on the 65C02. Speech must
leave through real Mockingboard register writes. Use one or both AYs and any original
synthesis strategy that fits; all six channels need not be used.

No browser SpeechSynthesis API, host-side synthesis, network TTS, external sound device,
accelerated CPU, or `$C030` speaker-based speech. Do not modify the emulator, ROM,
bridge, assembler or shared checks. Report suspected platform defects separately.
The browser may play normal emulator PCM, not process text or synthesize your voice.

## Originality and permitted reuse

Create your own pronunciation rules, synthesis engine and voice data. General phonetics,
DSP ideas and hardware documentation may inform the design; cite significant references.

Existing **3RIC hardware-access helpers** may be reused or adapted: AY writes,
initialization, timers, keyboard and text output. Identify reused routines and
preserve applicable notices.

Do not copy, port or transliterate an existing TTS engine, pronunciation rules, voice
tables or recordings. Do not use another TTS system or pretrained speech model to
generate assets. No human voice recordings, canned words/sentences or precomputed
demonstration/evaluation audio.

Original small synthetic waveform/phoneme tables are allowed. Include their generator
and parameters if made offline, and include the generated assembly data in the source.
A small original pronunciation-exception table may supplement general rules, not
replace general text-to-speech with a fixed vocabulary.

## Required application

1. Speak newly supplied ordinary English words and word sequences. Best-effort
   pronunciation is acceptable; routinely spelling words or silently omitting
   unfamiliar words is not a substitute for TTS.
2. Provide a text-mode UI with visible input, deletion and up to 120 characters.
   Enter speaks; completion returns to input for another sentence.
3. Required input is letters A-Z, spaces, apostrophes, hyphens and `. , ? !`.
   Normalize lowercase ASCII in the reusable API. Treat boundaries and punctuation
   sensibly. Numbers, abbreviations and non-English text are optional.
4. Handle empty/space-only input without speech or hanging. Report input limits
   instead of overflowing or silently losing part of the sentence. Reject or clearly
   explain unsupported characters.
5. Escape during speech cancels and silences sound, returning to input. Escape at
   input exits with `BRK`. Leave the keyboard/text output usable, no stuck sound,
   and no stray application-owned IRQ.
6. Separate UI from the reusable engine using the ABI below. A blocking engine is
   enough; concurrent game audio is not required.

Prioritize intelligibility and correct runtime behavior. Pitch/rate/voice controls
are optional after the required app works.

## Common callable interface

Export these case-insensitive assembler labels so shared checks and other programs
can call the engine without an implementation-specific host adapter:

- `TTS_INIT`: a subroutine callable immediately after loading the PRG, without first
  running the interactive UI. Establish required banks, tables and chip state.
  Return normally with `RTS`; do not wait for input.
- `TTS_SPEAK`: a subroutine taking a pointer to NUL-terminated ASCII in RAM, low byte
  in A and high byte in X. Preserve the input string. Return with `RTS`, A=0 for
  completion (including empty input), A=1 for cancellation or A=2 for invalid input.
  Detect overlength input using the 121st character without unbounded scanning.
- `TTS_INPUT`: reserve 122 consecutive bytes of always-mapped application RAM for
  callers/tests to supply text, including the overlength check and terminator.
  The application may use the same buffer. Do not overlap it with code or tables.

Keep the two callable entry labels in the loaded, always-mapped image. They may
delegate to banked code. Return with upper ROM visible and sound silent. Document
clobbered registers/flags, scratch, mappings, IRQ requirements and timing.

Shared checks allow 2 emulated seconds for initialization/empty/invalid calls,
90 seconds per spoken sentence, and at most 1 second to return after Escape.
These are runtime safety bounds, not a development-time allowance or a quality score.

## Memory, assembly and delivery

- Use the project's `asm6502.mjs` dialect, not ca65 or invented directives.
  Symbols are case-insensitive.
- Deliver one self-contained `tts.s` in your own submission directory, assembling
  both in Node and the existing browser workbench. Include `entry.json` and `README.md`.
- Start at `.org $0800` with startup code in always-mapped RAM. Use lower RAM through
  `$BFFF` by explicitly selecting RAM in the BASIC window when needed.
- Banking is allowed; the entire 64 KiB space is not flat RAM. Document all regions,
  mapping transitions and any language-card ROM/interrupt safety strategy.
- Establish bank state explicitly. Browser bulk loading fills backing memory directly;
  that is not proof physical `BRUN` loaded a bank. Include guest-side staging/relocation
  if needed and document a reproducible physical loading procedure.
- Respect live ROM variables, vectors, stack and display. Document scratch and restore
  shared state when needed.
- Emit a raw headerless `tts.prg`, load/entry `$0800`. The usual physical launch is
  `BRUN TTS.PRG 0800`; explain any additional bank-loading preparation.
- No runtime assets downloaded or input-dependent preprocessing on the host.
- State synthesis update/sample rate and memory/cycle budget, separating estimates
  from measured results. Keep addresses and clock assumptions identifiable for a port.
- **An Apple II port is not required.** WOZ export does not prove Apple II compatibility.

## Demonstration and verification

Use these public sentences and make the results reproducible:

- `HELLO. THIS COMPUTER CAN TALK.`
- `WE MAKE NEW SOFTWARE FOR OLD COMPUTERS.`
- `THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.`
- `PLEASE TYPE A SENTENCE AND PRESS ENTER.`

The host/viewers will also supply new ordinary English after the edition is frozen.
Process it at runtime without changing source.

Run `node codegen\tools\check-tts.mjs --entry <entry-id>` after building the WASM
runtime. Add your own tests for UI editing, input limits, repeated utterances,
bank visibility, cancellation, silencing, IRQ cleanup and a usable monitor return.
Include exact commands for generators and additional tests/recordings.

The shared checker assembles, exercises the callable ABI and captures normal emulator
PCM. It does **not** establish intelligibility, AY-only compliance, interactive UI
correctness, real ROM/SD loading or physical-hardware success. These need separate
inspection/listening/testing. Nonzero PCM or plausible phoneme labels are not proof
of speech. The generic `harness.cjs` treats `WAI` as a halt; do not use that as speech proof.

Capture the unmodified emulator running the actual 65C02 program. Host code may collect
PCM, never generate or improve speech. Report sample rate and use normal playback speed.
For browser listening, use native 1x and activate sound with a user gesture.

## Commit and submit

Commit source, metadata, documentation, generators and tests in your entry directory.
Generated PRGs/WAVs belong in ignored build output and downloadable check artifacts,
not large binary commits. Record model identity/settings when known, agent environment,
assistance, references and explicit licensing for new source/data.

Open an independent pull request to `ebadger/3ric`, using the repository's template.
Do not overwrite another entry, modify shared checks/rules, push directly to main,
self-merge or deploy. Follow required reviews; preserve the original candidate commit
and identify any later human/second-model-assisted edition.

Return the PR URL, evaluated commit, reproduction instructions and an honest list of
what was run, captured, heard, hardware-tested or left incomplete. If credentials
prevent pushing/opening a PR, supply the local commit or patch and state the blocker.
Do not claim a PR, review, test or published app that does not exist.

Human listeners make the main judgment: **Can we understand it, and would we want this
voice in our own 3RIC software?** Leave something people can inspect, rebuild and improve.
