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
  `codegen/platform/platform-ref.*`. The ROM scan also reloads VIA1 Timer 1 and
  Timer 2; a guest borrowing either timer must account for that reload and for
  the ROM NMI handler acknowledging timer flags.
- **`.PRG` programs:** assembled by the codegen toolchain (`CODEGEN.md`). Sources: tracked
  `.s` files (`codegen/programs/hello.s`, `emulator/AICodeGen/<name>/<name>.s`); assembled
  `.prg` images are git-ignored (regenerated). Run on hardware/SD via `BRUN NAME.PRG <org>`,
  or in the browser via **Load .PRG** / **Assemble & Run**.
- **Bouncing Ball (scottybe's community contribution):** the canonical source remains
  `web/programs/bouncing-ball.s`, loaded at `$0800` by the gallery, assembler, or
  `BRUN BOUNCE.PRG 0800`. Its 114-vertex, 128-face checkerboard sphere is transformed,
  back-face culled, filled, and outlined on the 65C02 every frame; it is not a
  prerecorded sprite animation.
  - **Preserved presentation:** the perspective room grid, opaque black/white faces,
    mesh outlines, 64-step two-axis rotation, gravity, wall/floor bounces, and alternating
    hi-res pages retain the contribution's frame-by-frame pixels and motion. Any key
    acknowledges `$C010` and executes `BRK`, as in the original.
  - **Hardware performance:** cache the static room once, restore only the old ball's
    rectangle on the hidden page, and use integer lookup arithmetic, incremental
    polygon-edge intersections, and byte-wide spans instead of per-pixel division.
    Over a 128-frame regression sequence, including both page initializations, mean
    live-frame cost must be at most **one tenth** of the original mean; every individual
    frame must be at least **nine times faster** and stay below **520,000 cycles**.
    The baseline is PR #58's merge `fc4d46e`, averaging 4,814,984 cycles per frame.
    Measure emulated 65C02 cycles, not host time or an increased emulator clock.
    Further optimization must retain fully live transformation and rasterization,
    the existing resolution/mesh detail, and the original pixels. Static arithmetic
    tables are allowed; cached rotation poses, visibility frames, and rendered ball
    animations are not. The user prioritizes this appearance over a second tenfold gain.
  - **Memory and delivery:** the raw image ends below `$2000`; the two display pages
    stay at `$2000-$5FFF`. Scratch state uses `$06-$0F` and `$50-$AF`, outside the ROM's
    text-window and I/O vectors. Tables use `$6000-$6FFF`, and the immutable room cache occupies
    `$7000-$8FFF`, below BASIC ROM. The standalone source builds through the existing
    assembler and `.PRG`/bootable `.woz` exports without assets or a new loader.
    No ROM, VM, bridge, platform-reference, or hardware-decoder contract changes are
    required. Emulator cycle measurements are not a physical-board benchmark.
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
- **STAR DUEL:** `emulator/AICodeGen/spacewar/spacewar.s` is an original two-player
  mixed-hi-res gravity-duel loaded at `$0800`. It reuses only un-copyrightable Spacewar-style
  conventions — two ships, a central sun, inverse-distance gravity, wrap, thrust inertia,
  and torpedoes — with original names, silhouettes, HUD copy, and 65C02 code.
  - **Playfield:** mixed hi-res (280×160 XOR vector ships over a persistent sun/starfield)
    plus four text HUD rows. The image ends below `$2000`; row tables live at `$6000/$6100`,
    working RAM at `$6200`, and ship/shot structs at `$6300`.
  - **Gravity:** each live ship is pulled toward the sun at (140, 80) with a 32-entry
    magnitude table indexed by Manhattan distance. Near-sun Chebyshev range 6 is fatal;
    the opponent scores if the match is underway. Ships spawn off the sun's row so the
    opening volley is not eaten by the well. Torpedoes use a Chebyshev box that covers the
    wedge silhouette (radius 10) plus shot step, and die on a ship or the sun.
  - **Controls:** SNES pad 1 and pad 2 both go through `PTRIG` + `GAMEPAD1`/`GAMEPAD2`.
    D-pad left/right rotate, Up/B thrust, A/Y fire, Select hyperspace, Start starts or
    rematches. Opposing D-pad directions cancel. Keyboard P1 is A/D or arrows to rotate,
    W/Up to thrust, S/Space to fire, H for hyperspace; P2 is J/L, I, K/U, N. Q/Esc restores
    page-1 text and `HOME`s to the monitor with `BRK`. First player to 5 kills wins.
  Focused headless hooks cover the row table, XOR plot, gravity sign/magnitude, wrap,
  thrust, firing, sun/ship/shot collisions, scoring, and dual-pad input. No ROM, VM,
  memory-map, platform-ref, or hardware-decoder changes are required.
- **SUNSLING:** `codegen/programs/sunsling.s` is a separate, original two-player
  Spacewar-style game, not a revision or copy of STAR DUEL. It loads at `$0800`.
  - **Flight and combat:** two distinct vector ships duel around a central sun in a
    wrapping 256x160 arena inset within mixed hi-res video. Signed 8.8 velocities,
    16 headings, thrust, and a softened inverse-square gravity approximation run on
    the 65C02. Gravity bends torpedoes as well as ships. Each pilot has four torpedo
    slots; shots inherit launch velocity, expire, and cannot hit their owner. The sun,
    enemy torpedoes, and ship-to-ship contact are lethal. The opponent earns one point
    per death; simultaneous deaths are resolved together, including a 5-5 draw.
    First to five wins. Respawning includes a brief shield against enemy contact,
    but never protection from the sun.
  - **Controls:** each SNES pad uses Left/Right to turn, Up/B to thrust, A/Y to fire,
    Select for a safe-perimeter hyperspace escape (eight-second cooldown), and a fresh
    Start press to start/pause/resume/rematch. Opposing directions cancel; releasing or
    disconnecting a controller releases its level controls.
    Keyboard P1 uses A/D (or Left/Right) to turn, W/S (or Up/Down) for burn/coast,
    F/Space for a short torpedo burst, and E for hyperspace. P2 uses J/L, I/K, U, O.
    Keyboard throttle is explicitly latched on/off, not a fabricated key-up interface:
    both pilots can keep burning while independently steering or firing. Enter starts
    or rematches, P pauses/resumes, M mutes effects, and Q/Esc quits. Pausing freezes
    physics, lifetimes, respawns, and cooldowns; held Start/Select never retrigger.
  - **Presentation and timing:** an original pixel title, persistent starfield/sun,
    XOR ship outlines, exhaust, expanding explosion particles, and four text HUD rows.
    Brief effects toggle the real `$C030` speaker. A polled onboard VIA Timer 2 targets
    30 Hz at native 1x; steady-state work must fit a 52,448-cycle frame, including
    two active pilots and eight torpedoes. The ROM's SNES scan reloads both onboard
    timers, so the frame countdown is armed immediately after that scan, allowing
    1,280 cycles for its bounded overhead. Completion reads the counter's wrap,
    not an IFR bit that a later ROM NMI can acknowledge. Frame periods stay within
    200 cycles of 52,448. The timer interrupt is disabled without
    disabling unrelated VIA interrupts. Prior ACR, Timer-2 interrupt enable, joystick
    mode, and CPU flags are restored on exit, then text page 1, `HOME`, and `BRK`
    return to a usable monitor. ROM text-window bytes and vectors remain untouched.
  - **Memory and delivery:** the raw image ends below `$2000`; hi-res page 1 is
    `$2000-$3FFF`, lookup tables `$6000-$63FF`, state `$6400-$65FF`, and scratch
    zero page `$50-$7F`. The gallery/editor stages the canonical source with the
    existing wildcard and exports ordinary `.PRG` and bootable `.woz` files.
    No ROM, VM, bridge, memory-map, platform-ref, or hardware-decoder changes are
    needed. Emulator measurements do not claim a physical-board playtest.
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

For Bouncing Ball:
`gallery source / raw PRG / bootable WOZ -> $0800 program -> gravity + rotation ->
cached room restore + live vertex transforms, face visibility, polygon fills, and mesh ->
hidden hi-res page -> $C054/$C055 page flip -> existing hardware/native/WASM display`.
Keyboard input follows the existing `$C000/$C010 -> BRK` path.

For Built from Bits:
`Hackaday landing page / gallery / sample -> existing browser assembler or BRUN -> $0800
program -> keyboard + polled VIA Timer 2 -> scene/score state -> text/lo-res/hi-res RAM
and slot-4 VIA/AY writes -> shared native/WASM video and audio outputs`.

For Jungle Quest:
`keyboard event or SNES poll → movement/jump/duck latches → 8.8 physics → terrain/platform/
hazard/item collision → lives/time/glyph/score state → BG restore + sprite redraw → hi-res
page and mixed-mode HUD`; a screen-edge transition loads the next descriptor, while death
reloads the same descriptor at its checkpoint.

For STAR DUEL:
`keyboard hold-timers or PTRIG + GAMEPAD1/GAMEPAD2 → rotate/thrust/fire/hyperspace intents
→ 8.8 inertia + Manhattan gravity toward the sun → wrap/collisions/score → XOR erase/draw
on hi-res page 1 + mixed-mode HUD`; Q/Esc selects text mode, `HOME`, then `BRK`.

For SUNSLING:
`gallery/editor or raw PRG/WOZ -> $0800 -> keyboard burn/coast and burst latches or
PTRIG/ROM scans of both SNES pads -> timer-paced 8.8 ship/torpedo gravity and inertia
-> toroidal collisions, simultaneous scoring, respawn/shield/cooldown state -> XOR
hi-res vectors + text HUD + $C030 -> existing native/WASM video/audio`.
Pause holds simulation state; quitting restores the borrowed I/O settings and monitor.

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
| Bouncing Ball | Implemented / cycle-guarded | 5,376-byte standalone image; 419,704 mean / 438,580 worst cycles over 128 pixel-identical frames, an 11.47x mean speedup over PR #58 and 14% faster than the first optimized version. `codegen/tools/bouncing-ball.test.mjs` covers motion/page history, all signed-byte products, 4,096 independent angle pairs, 512 independent complete rasters, every restore alignment, extreme positions, memory boundaries, keyboard exit, and ROM WOZ boot. |
| 3RIC Groovebox | Shipped | Six-voice, 16-step Mockingboard sequencer; gamepad/keyboard editing and timer-driven stereo sound. `codegen/tools/groovebox.test.mjs` covers real stereo PCM, all controls, fractional tempo, clean exit, and a dense-step/input deadline below 6,556 cycles. |
| Built from Bits | Implemented | 3,460-byte four-scene showcase with rendering, 63,000-cycle cadence, audio, controls, and WOZ boot coverage. ROM window bounds are preserved; Q/Esc from every scene must leave a visible prompt that can execute and display a subsequent monitor command. |
| Matrix Rain | Shipped | `codegen/programs/matrix.s`; 1,079-byte `$0800` hi-res demo with staggered green trails, white heads, pause/quit controls, and focused rendering, timing, memory-boundary, and monitor-exit coverage in `codegen/tools/matrix.test.mjs`. |
| ROCK STORM vector game | Shipped / cycle-guarded | Opening-wave live frame is 133,262 cycles against a 175,000-cycle limit; both distributed `.prg` copies are generated from `rocks.s`. |
| SNES gamepad input | Shipped | ROM fills `GAMEPAD1/2` on a `$C070` touch; the shared emulator peripheral follows the same VIA serial protocol, and the browser maps two standard USB/Bluetooth controllers into it. |
| Jungle Quest — The Sunstone Run | Shipped | Six-screen `$0800` mixed-hi-res platformer; focused suite includes a complete successful expedition. |
| STAR DUEL | Shipped | Two-player `$0800` mixed-hi-res gravity duel; SNES pads + keyboard; `codegen/tools/spacewar.test.mjs` covers gravity, wrap, shots, collisions, and dual-pad input. |
| SUNSLING | Implemented | Separate original `$0800` two-player gravity duel. `codegen/tools/sunsling.test.mjs` exercises real-VM physics, both control paths, XOR rendering, simultaneous scoring, all heading pairs under full combat load, native cadence, monitor restoration, and exported WOZ boot. |
