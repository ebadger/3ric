# 3ric — ROM & Software Spec (ROM-SOFTWARE.md)

> The 512 KB system ROM (monitor, DOS shell, BASIC), the character/font ROM, and the 6502
> programs that run on 3ric. This is the software the CPU actually executes; the emulator
> (`EMULATOR.md`) and hardware (`HARDWARE.md`) exist to run it.

---

## Purpose

Provide the machine's firmware and application software: power-on monitor, a FAT32 DOS
shell, Microsoft BASIC, and a growing library of 65C02 programs (games, demos) that load
from a micro-SD card, a Disk II floppy, or the in-browser assembler.

## Contracts / Interfaces

- **System ROM:** `emulator/Data/badger6502.bin` (512 KB; first 64 KB mapped `$D000–$FFFF`
  plus banked regions). Contains the monitor, the DOS/FAT32 shell, the Disk II boot PROM
  (`$C600`), and Microsoft BASIC (`$9000–$BFFF`). Reset vector at `$FFFC/$FFFD`. Built with
  cc65/ca65; debug symbols in `badger6502.dbg` (consumed by `codegen/gen_platform_ref.mjs`).
- **Font ROM:** `emulator/Data/fontrom.dat`, loaded by the text renderer.
- **ROM entry points (contract for programs; curated in `codegen/platform/platform-ref.*`):**
  `COUT $FDED`, `COUT1 $FDF0`, `CROUT $FD8E`, `PRBYTE $FDDA`, `HOME $FC58`, `KEYIN $FD1B`;
  DOS shell `dos $EC5C` (mount + `>` prompt), verbs `BSAVE/BLOAD/BRUN/DIR/CAT/CD`, FAT32
  `fat32_file_read/write`.
- **SNES gamepad (contract for programs):** the ROM scans the two SNES pads from an
  interrupt raised on the VIA CB2 edge. A program touches **`PTRIG $C070`** to raise that
  edge (→ NMI pad scan; the NMI is non-maskable, so a program may poll the pad while running
  under `sei`), then reads **`GAMEPAD1 $CEE0`** / `GAMEPAD2 $CEF0` — 16-byte tables, one byte
  per button (`1` = pressed): `B`=0, `Y`=1, `SELECT`=2, `START`=3, `UP`=4, `DOWN`=5,
  `LEFT`=6, `RIGHT`=7, `A`=8, `X`=9, `L`=$A, `R`=$B. `JOYSTICK_MODE $CE15` must be `0`
  (pads — the power-on default). The emulator models the same two active-low SNES shift
  registers on VIA1, so host-supplied controller masks flow through the unmodified ROM scan;
  a disconnected controller reports no buttons. Programs may still reject impossible states
  such as `LEFT`+`RIGHT` defensively. Addresses are exported in
  `codegen/platform/platform-ref.*`.
- **`.PRG` programs:** assembled by the codegen toolchain (`CODEGEN.md`). Sources: tracked
  `.s` files (`codegen/programs/hello.s`, `emulator/AICodeGen/<name>/<name>.s`); assembled
  `.prg` images are git-ignored (regenerated). Run on hardware/SD via `BRUN NAME.PRG <org>`,
  or in the browser via **Load .PRG** / **Assemble & Run**.
- **3RIC Groovebox:** `codegen/programs/groovebox.s` is a standalone `$0800` 65C02
  music app, not a browser synthesizer. Its 40x24 text interface edits a looping 16-step
  pattern for six voices: bass, lead, and arpeggio on the left AY; kick, snare, and hi-hat
  on the right AY. It starts playing an original demo at 120 BPM.
  - **Sound:** all synthesis uses the existing slot-4 `$C400/$C480` VIA/AY interface,
    with tone periods calculated for 3RIC's 1.5734375 MHz clock. Each voice has independent
    step enables, pitches, mute, and a Pluck/Soft/Long software-envelope preset. Kick has
    a descending pitch sweep; snare mixes tone and noise; hi-hat uses noise. The right
    chip's noise generator is physically shared: a hat's noise-period setting also
    colors a simultaneously sounding snare. No independent noise generators are faked.
  - **Timing:** left-VIA Timer 1 free-runs at approximately 240 Hz. With IRQ masked,
    `WAI` wakes on its IRQ and the program acknowledges the timer directly; it does not
    replace the ROM IRQ/NMI vectors or disturb the onboard VIA's gamepad wiring. A
    fractional accumulator schedules sixteenth notes at 60-180 BPM in 5-BPM increments,
    independently of drawing and host display refresh. Envelopes and controller
    debouncing use the same hardware timebase. Detail-field redraws defer to the next
    input scan when a six-voice trigger uses the current tick's budget.
  - **Controls:** the first SNES pad uses D-pad to select a voice/step, A to toggle the
    step, B/Y to raise/lower its note, X to mute the voice, Select to cycle its envelope,
    Start to stop/restart from step 1, and L/R to decrease/increase BPM. Navigation
    repeats after a hold delay; other pad actions require a fresh press, including after
    startup. Opposing D-pad directions cancel. Keyboard equivalents are arrows/WASD,
    Space, `+`/`-`, M, I, Return, and `[`/`]`; Q silences the chips and returns to the
    monitor. Gamepad input goes through `PTRIG` and the ROM's `GAMEPAD1` table.
  - **Editing:** disabling a step retains its pitch. Note editing enables the selected
    step and clamps to a two-octave range; the hat instead selects noise periods 1-24.
    Enabled, unmuted edits can be auditioned while stopped. Mute and stop silence voices
    immediately. The selected cell, playback position, voice activity, BPM, note/noise
    period, and envelope remain visible. Edits are RAM-only; reloading restores the demo.
  The raw image ends below its `$6000-$61FF` workspace and uses text page 1, leaving
  the memory map, ROM, core, bridge, and hardware-decoder contracts unchanged. Browser sound still
  requires native 1x speed and an initial pointer/keyboard gesture.
- **Built from Bits (Hackaday showcase):** `codegen/programs/hackaday.s` is an original,
  self-running `$0800` 65C02 showreel, not a browser animation or a prerecorded video.
  - **Four scenes:** a hi-res 3RIC title and moving starfield; a 16-color lo-res plasma;
    a software-rasterized rotating wireframe cube; and a six-channel musical sequencer
    display. The bottom four text rows explain the active hardware technique and controls.
    Scene changes are automatic, with a complete loop of approximately one minute at 1x.
  - **Sound:** an original looping composition programs the two slot-4 AY chips through
    their 6522 ports at `$C400` / `$C480`. Six pitch/level indicators reflect the values
    sent to the chips, not fabricated audio measurements. Music is optional on physical
    machines without the sound expansion; video timing never depends on its presence.
  - **Controls:** 1-4 selects a scene; N/Right advances and Left goes back; Space freezes
    animation and the score and silences sound; M toggles music without freezing the demo.
    Q/Esc silences both AYs, restores page-1 text mode, and returns to the monitor with
    `BRK`. These are ordinary `$C000` / `$C010` keyboard inputs, including the browser's
    existing virtual keyboard.
  - **Timing and memory:** the onboard VIA at `$C200` reserves Timer 2 for a polled
    approximately 25 Hz cadence. Its Timer-2 interrupt is disabled without disabling
    unrelated VIA interrupts; previous ACR/IER settings are restored on exit. Drawing
    must fit within a 63,000-cycle steady-state frame budget. The image ends below
    `$2000`; graphics use page 1 (`$2000-$3FFF`) and the normal text/lo-res page
    (`$0400-$07FF`); lookup tables and working data live in `$6000-$67FF`.
  All pixels, musical register writes, sequencing, and input handling execute on the
  65C02 through existing contracts. No ROM, VM, memory-map, platform-ref, or hardware-decoder changes
  are required. A hardware-compatible binary is not a claim of a physical-board test.
  The ROM's text-window bounds at `$20-$23` (`WNDLFT`/`WNDWDTH`/`WNDTOP`/`WNDBTM`)
  remain untouched throughout the demo. Drawing coordinates use `$58-$5B` instead.
  Q/Esc must restore a usable visible monitor after every scene, not merely produce a
  serial BRK dump; exit coverage includes the on-screen prompt and a subsequent memory
  examination command.
- **Matrix Rain:** `codegen/programs/matrix.s` is a self-running `$0800` hi-res demo:
  - **Presentation:** 40 independent streams of original 3x5 letter/digit glyphs fall
    through 32 character rows. White heads leave green trails whose last two characters
    fade with spatial dithering before being erased. The screen starts populated, without
    a title screen, HUD, or audio.
  - **Motion:** a nonzero 16-bit LFSR chooses glyphs, initial positions, lengths of 8-23
    characters, per-column movement periods of 2-5 animation ticks, and restart gaps of
    4-19 ticks. A stream's entire tail leaves the bottom before that column restarts.
    Incremental cell updates and a short CPU delay pace the demo for native 1x speed;
    selecting a faster emulator clock intentionally speeds it up.
  - **Controls:** Space pauses/resumes both motion and glyph changes; Q or Esc restores
    page-1 text mode, clears the screen, and returns to the ROM monitor with `BRK`.
  - **Memory and portability:** the image ends below `$2000`; hi-res page 1 occupies
    `$2000-$3FFF`, glyph history `$6000-$64FF`, and scanline tables `$6500-$66BF`.
    Off-screen cells are clipped, never wrapped. All animation, keyboard handling, and
    artifact-color selection execute on the CPU using existing machine contracts, with
    no browser-specific drawing or emulator changes.
- **Jungle Quest — The Sunstone Run:** `emulator/AICodeGen/jungle/jungle.s` is an original
  mixed-hi-res action platformer loaded at `$0800`. Its six flip-screens form one authored
  expedition rather than interchangeable obstacle rooms:
  - **Movement:** A/D or Left/Right runs; W/Up/Space jumps; S/Down ducks. Input includes a
    short movement latch for the keyboard's event-driven interface, a four-frame coyote
    window, a five-frame jump buffer, and a low ducking hitbox. A grabbed vine follows a
    pendulum arc and Jump releases it without immediately re-catching; it also releases
    safely over the far bank.
  - **Hardware controls:** SNES D-pad moves/ducks and A/B jumps via the ROM's
    `PTRIG`/`GAMEPAD1` contract. The browser maps standard USB/Bluetooth controllers through
    the emulator's SNES/VIA peripheral; impossible opposing directions remain rejected.
    End screens ignore repeated gameplay keys: Return restarts from the keyboard, while
    Start/A/B must be released before a fresh pad restart press.
  - **World:** screen descriptors define up to two ground gaps, two raised platforms, one
    vine, a checkpoint, and a distinct moving threat. The route teaches a boulder jump,
    platform traversal, an active vine crossing, and ducking under a bat before combining
    those verbs at the ruins and temple.
  - **Objective and rewards:** four mandatory glyphs on the first four screens unlock the
    temple; optional fruit awards score and restores time. The final Sunstone ends the run.
    Death costs one of three lives and five clock units but respawns at the current screen's
    checkpoint with collected items preserved. The initial gameplay clock is 90 units.
  - **Presentation:** a textured jungle/ruins background, water-filled gaps, raised masonry
    and animated player/threat sprites make each screen readable. The mixed-mode HUD shows
    score, time, lives, glyph progress, and contextual gate/status messages.
  Focused headless hooks verify renderer primitives, buffered/coyote jumps, platform and
  gap collision, duck-vs-bat behavior, item effects, checkpoint death, gate progression,
  vine release, timer states, restart input gating, and final victory. The assembled image
  must end below the hi-res page at `$2000`.
- **Disk & card images:** demo `.woz` (staged from `emulator/WozFileTestApp/testdata/`);
  `emulator/Data/sd.zip` → `web/data/sd.sparse` FAT32 image (`WEB-CLIENT.md`).

## Behaviour / Rules

- **Known limitation — no Applesoft.** The `$E000` BASIC is generic Microsoft BASIC (prompts
  `MEMORY SIZE?`). Disks whose boot auto-runs an Applesoft greeting (DOS 3.3 / Quick-DOS
  System Masters and games chaining through them) load DOS but then trap. Self-booting
  machine-code disks run fine. Treat this as a documented gap, not a bug to paper over.
- **The ROM defines the memory-map contract in practice.** ROM routines assume the `MM_*`
  layout in `vm.h`; a memory-map change means rebuilding/re-verifying the ROM and
  regenerating `platform-ref.*`.
- 6502 sources target the `asm6502.mjs` dialect and conventions in
  `codegen/platform/prompt-system.md`.
- **ROCK STORM performance contract.** An opening-wave live frame (compose the hidden
  page and flip it) must complete in at most **175,000 65C02 cycles** in the headless
  emulator. The live loop must not add a fixed busy-wait when rendering already consumes
  the available frame time. Its cycle check and pixel/gameplay tests live in
  `codegen/tools/rocks.test.mjs`.

## Data flow

`badger6502.bin → mapped $D000–$FFFF + banks; reset → monitor → (Disk II C600G | DOS EC5CG |
BRUN) → user program runs → COUT/screen/serial output`.

For Matrix Rain:
`gallery/sample source → assembler → $0800 program → $C000/$C010 pause/quit input +
LFSR/column timers → glyph history and clipped hi-res cell writes → existing native/WASM
artifact-color renderer → display`; quitting selects text mode and executes ROM `HOME`
then `BRK`.

For Built from Bits:
`Hackaday landing page / gallery / sample -> existing browser assembler or BRUN -> $0800
program -> keyboard + polled VIA Timer 2 -> scene/score state -> text/lo-res/hi-res RAM
and slot-4 VIA/AY writes -> shared native/WASM video and audio outputs`.

For Jungle Quest:
`keyboard event or SNES poll → movement/jump/duck latches → 8.8 physics → terrain/platform/
hazard/item collision → lives/time/glyph/score state → BG restore + sprite redraw → hi-res
page and mixed-mode HUD`; a screen-edge transition loads the next descriptor, while death
reloads the same descriptor at its checkpoint.

For Groovebox:
`keyboard or SNES/VIA/ROM scan -> sequencer edits -> Timer 1 IRQ/WAI tick -> step and
software-envelope state -> real VIA/AY register writes -> shared VM stereo PCM -> host
audio`; the program separately writes its editor and playhead into text video RAM.

## Dependencies

- **Upstream:** the assembler/build (cc65/ca65 for the ROM; `CODEGEN.md` for programs).
- **Downstream:** the emulator loads and executes it (`EMULATOR.md`); the platform reference
  is derived from its symbols (`CODEGEN.md`).

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| System ROM (monitor / DOS shell / FAT32) | Shipped | `badger6502.bin`; boots to monitor. |
| Microsoft BASIC | Shipped | `$9000–$BFFF`; not Applesoft (known gap). |
| Font ROM | Shipped | `fontrom.dat`. |
| Disk II boot PROM | Shipped | `$C600`; boots self-booting WOZ images. |
| 6502 program library | Ongoing | `codegen/programs/`, `emulator/AICodeGen/` (games/demos). |
| 3RIC Groovebox | Shipped | Six-voice, 16-step Mockingboard sequencer; gamepad/keyboard editing and timer-driven stereo sound. `codegen/tools/groovebox.test.mjs` covers real stereo PCM, all controls, fractional tempo, clean exit, and a dense-step/input deadline below 6,556 cycles. |
| Built from Bits | Implemented | 3,460-byte four-scene showcase with rendering, 63,000-cycle cadence, audio, controls, and WOZ boot coverage. ROM window bounds are preserved; Q/Esc from every scene must leave a visible prompt that can execute and display a subsequent monitor command. |
| Matrix Rain | Shipped | `codegen/programs/matrix.s`; 1,079-byte `$0800` hi-res demo with staggered green trails, white heads, pause/quit controls, and focused rendering, timing, memory-boundary, and monitor-exit coverage in `codegen/tools/matrix.test.mjs`. |
| ROCK STORM vector game | Shipped / cycle-guarded | Opening-wave live frame is 133,262 cycles against a 175,000-cycle limit; both distributed `.prg` copies are generated from `rocks.s`. |
| SNES gamepad input | Shipped | ROM fills `GAMEPAD1/2` on a `$C070` touch; the shared emulator peripheral follows the same VIA serial protocol, and the browser maps two standard USB/Bluetooth controllers into it. |
| Jungle Quest — The Sunstone Run | Shipped | Six-screen `$0800` mixed-hi-res platformer; focused suite includes a complete successful expedition. |
