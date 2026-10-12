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

- **3RIC Talks v1:** the public challenge requests original English TTS implemented on
  the 65C02 and dual-AY Mockingboard, with typed input and reusable init/speak routines.
  Its complete, versioned contract is `codegen/challenges/tts/v1/prompt.md`; per-entry
  README/metadata document implementation status, memory, controls, ABI and provenance.
  There are no engines or physical-hardware results in the initial publication.
  Sources are independent PR submissions, not replacements for ordinary gallery samples.
  The target is 3RIC; Apple II compatibility requires a separately verified port.
  RAM includes always-mapped `$0000-$8FFF`, an additional `$9000-$BFFF` when `$C007`
  disables the BASIC overlay (`$C006` restores it), and language-card RAM over upper ROM.
  Using that last region requires safe ROM visibility, input and interrupt handling;
  `$C800-$CFFF` contains system state, not disposable scratch. No hardware map is changed.
- **System ROM:** `emulator/Data/badger6502.bin` (512 KB; first 64 KB mapped `$D000–$FFFF`
  plus banked regions). Contains the monitor, the DOS/FAT32 shell, the Disk II boot PROM
  (`$C600`), and Microsoft BASIC (`$9000–$BFFF`). Reset vector at `$FFFC/$FFFD`. Built with
  cc65/ca65; debug symbols in `badger6502.dbg` (consumed by `codegen/gen_platform_ref.mjs`).
- **Font ROM:** `emulator/Data/fontrom.dat`, loaded by the text renderer.
- **ROM entry points (contract for programs; curated in `codegen/platform/platform-ref.*`):**
  `COUT $FDED`, `COUT1 $FDF0`, `CROUT $FD8E`, `PRBYTE $FDDA`, `HOME $FC58`, `KEYIN $FD1B`;
  DOS shell `dos $EDBC` (mount + `>` prompt), verbs `BSAVE/BLOAD/BRUN/DIR/CAT/CD`, FAT32
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
- **Archon compatibility experiment:** an image-specific, disk-only adapter for the
  owner-supplied WOZ2 with SHA-256
  `a7722abdfc42ef7372b5183283b6f55464c3817b1c855256186cb5c30e600c8d`.
  It targets the unchanged repository ROM with SHA-256
  `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435`.
  The game and resulting disk are local inputs/outputs, not repository assets.
  - **Banking:** the original menu temporarily exposes language-card RAM; gameplay
    also uses both language-card banks. Neither preserves 3ric's ROM NMI vector.
    A resident adapter must keep a valid NMI entry when RAM is visible, preserve
    interrupted registers and the selected bank, and coexist with the game's loaded
    graphics/code. Forcing ROM permanently visible or suppressing input is not a fix.
    This profile reserves `$C800-$C9FF`, `$CC00-$CDFF`, `$CF00-$CFFF` and the shared
    language-card NMI vector at `$FFFA-$FFFB`; these are **not general free-RAM
    declarations**. Interactive menu drawing remains RAM-mapped. Bank-switch wrappers
    preserve the requested bank; a stop-bit interrupt at the switch/state-store
    boundary recovers the just-selected mode from the interrupted X register.
  - **Input:** retain keyboard gameplay and the game's options, and adapt the two
    onboard SNES pads through real VIA latch/clock/data pins. Avoid unnecessary
    paddle-timer/strobe NMIs and acknowledge serviced VIA sources without discarding
    an arriving PS/2 clock. Keyboard coverage must include real scan frames and
    bidirectional Caps/Num Lock command exchanges, not only browser `keyDown`.
    The D-pad supplies neutral/low/high digital axes; B or X selects/fires for each
    controller. Both two-player keyboard-side options retain their original side
    assignment. Keyboard direction latches and fire duration remain game-owned.
  - **Delivery:** reject other disk/ROM revisions, write a separate output file,
    preserve unrelated WOZ bits, track layout, metadata and sectors, and regenerate
    affected sector checksums and the container CRC. No firmware, VM, web bridge,
    generated platform-reference or hardware-decoder change is part of this port.
    The patcher checks the full ROM file fingerprint; the boot installer checks the
    relevant NMI proxy/input-code ABI, not a full physical-ROM readback.
  - **Acceptance:** cold-boot the actual output through the Disk II loader in native
    and WASM builds; exercise options, board input and combat, including mixed
    keyboard/pad traffic and bank restoration. Emulator results are not a physical
    board or complete-playthrough certification. The implementation is an
    emulator-verified hardware-trial candidate; commands, fingerprints, coverage and
    remaining limits are recorded in [`docs/porting-logs/archon.md`](../docs/porting-logs/archon.md).
- **MS-BASIC boot disk:** `codegen/tools/msbasic-woz.mjs` turns a ROM image into a
  5.25″ WOZ2 that boots with `C600G` and runs that ROM's own Microsoft BASIC from the
  12 KiB RAM under the `$9000–$BFFF` overlay. BASIC therefore starts even when that
  RAM was never seeded, as at a physical power-on. The disk embeds the third-party
  interpreter, so it is a generated local output, never a repository asset (`NOTICE`).
  - **Image:** the generating ROM's `$9000–$BFFF` (48 pages) occupies T0 S1–15,
    T1–T2 and T3 S0; the boot loader is T0 S0.
  - **Loader:** select upper ROM (`$C082`) and compare a Fletcher-16 (mod 255)
    checksum of `$D000–$FFFF` with the generating ROM. On mismatch, stop the drive,
    print `BASIC DISK/ROM MISMATCH` and `BRK` before touching the overlay RAM: the RAM
    interpreter and the ROM's OS/NMI code call each other at fixed addresses. Then
    expose RAM (`$C007`), stream the pages straight to `$9000–$BFFF` with the PROM's
    `ReadSector` (`$C65C`), stop the drive motor and jump to the image's start-up code.
  - **Start-up (physical keyboard):** the picodisk Disk II emulator freezes the CPU
    through READY while its drive model runs, which continues 1,023,000 cycles after
    motor-off. Wait 8 × `WAIT($FF)` (~1.33M cycles) so no stall reaches BASIC's input.
    Then, once the PS/2 clock (VIA1 PA6, read via `$C20F`) has stayed high for 512
    samples, reset the ROM decoder's frame state and prefix, lock-toggle and modifier
    flags (`$CE00`, `$CE03`, `$CE04`, `$CE18`, `$CE19`), the `$CB00` key-state page and
    `$C000`. These are among the variables the ROM's reset handler clears. Repeat if
    a frame overlapped the reset, then `JMP $E000` (`JMP COLD_START`). The generator
    refuses a ROM whose reset handler does not clear them.
  - **RAM-resident adaptation:** `MEMORY SIZE?` probes upward until a write fails,
    which would overwrite a RAM interpreter. Two `JSR` hooks in the image's unused,
    zero-filled top bytes stop the probe at `$9000` and clamp a typed size to `$9000`;
    Return reports `34815 BYTES FREE`. The start-up code and the `+` key reader below
    share those bytes (`$BF6B–$BFFF` for the shipped ROM). Apart from them, the message
    bytes and the `RESTART` hook below, no interpreter byte changes. The generator
    locates the generic probe code by its bytes and refuses unrecognized images. ROM,
    VM, memory map and platform reference are unchanged.
  - **Message line breaks:** in the shipped ROM, the `CR`/`LF` in BASIC's messages
    assemble as `$62`/`$66`, the low bytes of the Apple monitor's `CR`/`LF` labels.
    `OUTDO` special-cases `$62`: it calls the monitor's `CR` directly, then prints the
    byte anyway. That byte is the `"` (`b` in the emulator) before every `]` prompt.
    When that call scrolls, it also clobbers `Y` and garbles `BREAK`. The disk patches
    the three strings BASIC prints: `QT_OK` `$62`→`$0D`, `QT_BREAK` `$62 $66`→`$0D $80`,
    and the `$62` ending `QT_WRITTEN_BY` (the `A` credit at `MEMORY SIZE?`)→`$0D`. `$0D`
    takes `OUTDO`'s control-character path, a newline through `COUT`, which preserves
    `Y`. `$80` is the null `CRDO` sends after each newline (`CRLF_2`). The prompt is then
    a bare `]` laid out as in Applesoft II: `RESTART` prints one newline first, so output
    is followed by a blank line. The `$62` special case stays, so a printed lowercase `b`
    still becomes a newline, as in ROM BASIC. The generator finds each string by its
    exact bytes and refuses an image that lacks one.
  - **`+` from a PS/2 keyboard:** the ROM's PS/2 decoder has no `+` (see Behaviour /
    Rules). A `JSR` replaces `RESTART`'s first two instructions (`LSR Z14` /
    `LDA #<QT_OK`), so before every prompt the disk points `KSW` (`$38`) at a resident
    input routine. It does so only while `KSW` holds the monitor's `KEYIN`, which reset's
    `SETKBD` installs, and leaves any other input routine alone. The routine calls
    `KEYIN` and returns `+` (`$AB`) for an `=` (`$BD`) read while either Shift key is
    down (the decoder's key states at `$CB12`/`$CB59`). Line input, `INPUT` and `GET`
    read through `RDKEY`, so Shift+= types `+`; `PEEK(49152)` still sees `=`. An `=`
    typed ahead while a program is busy becomes `+` only if Shift is still down when
    BASIC reads it. Reset restores `KEYIN` until BASIC's next prompt. The generator
    finds `RESTART` (by its bytes and `QT_OK` operand) and `RDKEY`/`KEYIN` by their
    bytes, and refuses a ROM that lacks either.
  - **Interrupts:** the ROM NMI proxy (`$F1BB`) still banks BASIC ROM in for its
    handler and exposes RAM again on exit, so keyboard and gamepad NMIs return into
    the RAM interpreter, which survives later resets until overwritten or power-off.
  - **Limits:** a disk refuses to load unless the machine's upper ROM (`$D000–$FFFF`)
    matches the ROM that generated it (`--rom` selects the board's image); the BASIC ROM
    bank only runs the machine's own NMI handler and is not fingerprinted. `LOAD`/`SAVE`
    behave as in ROM BASIC; there is no Disk II file system. BASIC appears about one
    second after loading ends. The first physical boot garbled keys at `MEMORY SIZE?`
    (Return echoed `GG`); the start-up resync addresses the cause reproduced natively.
    A fixed physical-board boot is not yet confirmed.
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
    1,600 cycles for the current ROM scan and surrounding frame-loop overhead.
    Regression coverage measures idle, one-pad and two-pad scans as well as full
    combat load against the staged ROM; ROM timing changes must not be hidden by
    widening the cadence tolerance. Completion reads the counter's wrap,
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
- **PULSAR DUEL:** `emulator/AICodeGen/pulsar/pulsar.s` is a second, independent
  two-player gravity duel at `$0800`, written from scratch alongside STAR DUEL rather
  than derived from it. It shares only the un-copyrightable Spacewar-style premise — two
  ships, one gravity well, wrap, inertia, torpedoes, hyperspace — and differs in every
  implementation choice below.
  - **Playfield:** a 256×160 *logical* field, so logical x is a single byte and wraps mod
    256 for free; logical x maps to hi-res column x+12 to centre the 280-pixel line, and
    logical y is scanline 0..159 wrapped by hand. Four text HUD rows sit underneath. All
    working RAM and the `ROWL`/`ROWH`/`XBYTE`/`XMASK` tables are part of the image, which
    ends below `$2000` — nothing is scribbled at `$6000`.
  - **Gravity:** the pulsar sits at logical (128, 80), dead centre, so the vertical
    component never needs wrap correction. Distance is the octagonal norm
    `r ~= max(|dx|,|dy|) + min(|dx|,|dy|)/2` (about 6% error, and it guarantees
    `|d| <= r`). A 176-entry table holds `F[r] = round(G*65536/r^3)` with `G = 160`,
    clamped at 10,486 below `r = 10`; per-axis acceleration is `(|d| * F[r]) >> 8` in 8.8 via an
    8x16 shift-add multiply, giving a true inverse-square field with no division.
    Integration is semi-implicit Euler (velocity then position), so orbits are stable.
    Torpedoes fall into the well on exactly the same code path, so shots curve.
  - **Orbital opening:** both pilots spawn *in orbit*, not at rest — 48 logical pixels
    out on opposite sides, travelling 1.64 px/frame tangentially, in the same rotational
    sense. r = 48 keeps the whole path clear of the `y = 0/160` wrap seam; the orbit
    precesses between r = 47 and r = 61 and never falls in unattended.
  - **Rendering:** ships are XOR vector triangles plus an exhaust line, from per-heading
    vertex tables at 32 headings; erasing is literally redrawing the previous
    `(x, y, heading, thrust)`, so the starfield and pulsar survive underneath. Explosions
    are expanding eight-point rings. Lines use signed 8-bit Bresenham with a 48-step
    safety counter.
  - **Controls:** both SNES pads via `PTRIG` + `GAMEPAD1`/`GAMEPAD2` — D-pad left/right
    rotate, Up/B thrust, A/Y fire, Select hyperspace, Start begins or rematches; opposing
    D-pad directions cancel. The keyboard latch has no key-up, so every recognised press
    arms a hold timer that is replayed as held intent for several frames: P1 is A/D, W,
    S, X and P2 is J/L (or arrows), I (or Up), K, M. Q/Esc restores text, `HOME`s, and
    `BRK`s to the monitor. Hyperspace misjumps one time in eight and credits the
    opponent. First to 5 kills wins.
  Verified by `codegen/tools/pulsar.test.mjs`, whose headless hooks cover the row/column
  tables, XOR plot self-inversion, line drawing, the octagonal norm across the x seam,
  gravity sign and magnitude, 240 frames of orbit stability, turning, thrust, velocity
  caps, both wrap axes, per-player torpedo magazines and cooldown, torpedo curvature and
  expiry, pulsar/torpedo kills, spawn protection, respawn, match end, keyboard hold
  timers, dual-pad input, draw/erase round-tripping, HUD contents, and the per-frame
  cycle budget. No ROM, VM, memory-map, platform-ref, or hardware-decoder changes are
  required.
- **Disk & card images:** demo `.woz` (staged from `emulator/WozFileTestApp/testdata/`);
  `emulator/Data/sd.zip` → `web/data/sd.sparse` FAT32 image (`WEB-CLIENT.md`).

## Behaviour / Rules

- **Known limitation — no Applesoft.** The `$E000` BASIC is generic Microsoft BASIC (prompts
  `MEMORY SIZE?`). Disks whose boot auto-runs an Applesoft greeting (DOS 3.3 / Quick-DOS
  System Masters and games chaining through them) load DOS but then trap. Self-booting
  machine-code disks run fine. Treat this as a documented gap, not a bug to paper over.
- **Known gap — ROM BASIC startup relies on seeded RAM.** Reset exposes RAM at
  `$9000–$BFFF` (`$C007`) and the NMI proxy re-exposes it after every interrupt, so
  `E000G` runs `COLD_START` (`$B234`) from that RAM. The emulator's load recipe seeds it
  from the ROM image; no ROM code copies BASIC there. With that RAM scrubbed, as at a
  physical power-on, `E000G` executes garbage and `BRK`s. In the seeded emulator, pressing
  Return at `MEMORY SIZE?` probes into `$9000+` and overwrites the interpreter; type
  `36864` or less. The MS-BASIC boot disk loads a probe-safe RAM copy instead. Both
  observations are emulator reproductions; the ROM is unchanged.
- **Known gap — ROM BASIC message line breaks.** The shipped ROM's BASIC prints a stray
  `"` (`b` in the emulator) before each `]` prompt, and its `BREAK` message is garbled
  when the screen scrolls. In `message.s`/`init.s`, `CR`/`LF` resolve to the Apple
  monitor's labels (`$FC62`/`$FC66`), and `OUTDO`'s `$62` workaround calls the
  monitor's `CR`, then still prints the byte. The MS-BASIC boot disk corrects its own
  copy. The source fix belongs in the msbasic repository, followed by a ROM rebuild:
  emit the intended bytes in those strings and drop the workaround.
- **Known gap — no `+` from a PS/2 keyboard.** The ROM decoder's `ps2_ascii_shifted`
  table maps Shift+= (scan code `$55`) to `=` (`$BD`), keypad `+` (`$79`) is unmapped,
  and Ctrl+= stores `+` without bit 7, which `KEYIN` ignores. This affects the board and
  the Windows emulator app, which feeds host keys through that decoder; the browser
  build's `keyDown` bypasses PS/2. The MS-BASIC boot disk reads Shift+= as `+`.
  Everywhere else needs the ROM fix, `$AB` at `ps2_ascii_shifted+$55` (`$B5FE`) in
  `badger6502_extra.s`, then a reflash. No published msbasic branch matches the shipped
  ROM's sources, so the edit belongs in the tree that ROM was built from.
- **Known gap — disk activity can desynchronise physical PS/2 input.** The ROM decodes
  each PS/2 clock edge in an NMI that must sample VIA1 PA7 within about 70 cycles. The
  picodisk freezes the CPU through READY on disk accesses and, while its drive model
  runs, whenever 500 cycles pass without one. That lasts until 1,023,000 cycles after
  motor-off. A stalled edge can be misread or lost, and nothing in the decoder
  resynchronises: every later key decodes shifted until reset (Return becomes `GG`).
  Keys pressed or released during any disk boot are exposed; the Spy vs Spy keyboard
  wedge may be another instance. The VM does not model READY stalls, and browser
  `keyDown` bypasses PS/2; `codegen/tools/msbasic-woz.native.cpp` models both.
  Boot disks can wait out the spin-down and resync the decoder (MS-BASIC disk does).
  A general fix belongs in the ROM decoder (resync after an inter-frame gap) or the
  picodisk firmware.
- **Known gap — fast PS/2 keyboards race the decoder's Shift/Ctrl handling.** At a
  frame's parity edge the decoder compares the received code with `$12`, `$59` and `$14`
  and flags a modifier in `$CE19`. When the stop-edge NMI nests before that store, the
  key-down is handled unflagged: a Shift decodes as `$80`, a NUL that ends an input
  line, and Ctrl stores `$00`. The late flag then swallows the next key-down. In the
  `msbasic-woz.native.cpp` model, this happens at bit periods of 84–88 CPU cycles for
  left Shift, 84–94 for right Shift and 84–96 for Ctrl; at 80 or fewer, even typing
  `MON` fails. It has not been observed on the board. A fix belongs in the ROM decoder:
  flag modifiers when the key is processed, not at the parity edge.
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

For the MS-BASIC boot disk:
`ROM $9000–$BFFF + probe and prompt hooks + message line breaks → msbasic-woz.mjs → local WOZ → C600G →
PROM loads T0 S0 → upper-ROM guard → $C007 → 48 ReadSector pages into $9000–$BFFF → motor off →
spin-down wait → PS/2 decoder resync → JMP $E000 → COLD_START in RAM → MEMORY SIZE? (capped at
$9000) → BASIC prompt`; NMIs bank the ROM handler in and return to RAM.

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
For PULSAR DUEL:
`keyboard hold-timers or PTRIG + GAMEPAD1/GAMEPAD2 → rotate/thrust/fire/hyperspace intents
→ XOR erase of last frame's geometry → octagonal-norm inverse-square gravity via an `r^-3`
force table + 8x16 multiply → 8.8 semi-implicit Euler for ships and torpedoes → dual-axis wrap /
collisions / score → XOR draw on hi-res page 1 + mixed-mode HUD → frame pacing`; Q/Esc
selects text mode, `HOME`, then `BRK`.

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
| 3RIC Talks v1 challenge contract | Implemented; no engines yet | Original dual-AY TTS, bank-aware RAM rules, reusable ABI and separate source/PR submissions. No speech or hardware result claimed. |
| System ROM (monitor / DOS shell / FAT32) | Shipped | `badger6502.bin`; boots to monitor. |
| Microsoft BASIC | Shipped | `$9000–$BFFF`; not Applesoft (known gap). |
| Font ROM | Shipped | `fontrom.dat`. |
| Disk II boot PROM | Shipped | `$C600`; boots self-booting WOZ images. |
| MS-BASIC boot disk | Implemented / emulator-verified | `msbasic-woz.mjs` local generator. `msbasic-woz.test.mjs` round-trips the WOZ sectors and boots with scrubbed overlay RAM, even with BASIC ROM left selected. `COLD_START` runs only from RAM, at least 1,023,000 cycles after motor-off and with a poisoned PS/2 decoder reset. Return gives `34815 BYTES FREE`, the image survives the probe, programs and a gamepad NMI work, reset then `MON`/`E000G` restarts it, sizes clamp, and a mismatched ROM stops before loading. Every prompt is a bare `]` at the start of a line. `BREAK IN 10` survives a scroll, and the `A` credit line has no stray byte. Shift+= types `+` through the real PS/2 decoder (native, left Shift) and with either Shift simulated (WASM), plain `=` stays `=`, the reader returns after reset and `E000G`, and another `KSW` routine is left alone. `msbasic-woz.test.ps1` (native, MSVC) types through the real PS/2 decoder across 18 bit-period/READY-stall/Enter-release cases. The first physical boot garbled keys; the fixed disk is not yet confirmed on the board. |
| Archon disk-only compatibility adapter | Experimental / emulator-verified | Exact-image patcher; actual disk boot, options, keyboard and two-pad board/combat input, runtime mismatch guards, and native PS/2/LED/register/bank checks. Physical board and full-playthrough approval remain open; see the porting log. |
| 6502 program library | Ongoing | `codegen/programs/`, `emulator/AICodeGen/` (games/demos). |
| Bouncing Ball | Implemented / cycle-guarded | 5,376-byte standalone image; 419,704 mean / 438,580 worst cycles over 128 pixel-identical frames, an 11.47x mean speedup over PR #58 and 14% faster than the first optimized version. `codegen/tools/bouncing-ball.test.mjs` covers motion/page history, all signed-byte products, 4,096 independent angle pairs, 512 independent complete rasters, every restore alignment, extreme positions, memory boundaries, keyboard exit, and ROM WOZ boot. |
| 3RIC Groovebox | Shipped | Six-voice, 16-step Mockingboard sequencer; gamepad/keyboard editing and timer-driven stereo sound. `codegen/tools/groovebox.test.mjs` covers real stereo PCM, all controls, fractional tempo, clean exit, and a dense-step/input deadline below 6,556 cycles. |
| Built from Bits | Implemented | 3,460-byte four-scene showcase with rendering, 63,000-cycle cadence, audio, controls, and WOZ boot coverage. ROM window bounds are preserved; Q/Esc from every scene must leave a visible prompt that can execute and display a subsequent monitor command. |
| Matrix Rain | Shipped | `codegen/programs/matrix.s`; 1,079-byte `$0800` hi-res demo with staggered green trails, white heads, pause/quit controls, and focused rendering, timing, memory-boundary, and monitor-exit coverage in `codegen/tools/matrix.test.mjs`. |
| ROCK STORM vector game | Shipped / cycle-guarded | Opening-wave live frame is 133,262 cycles against a 175,000-cycle limit; both distributed `.prg` copies are generated from `rocks.s`. |
| SNES gamepad input | Shipped | ROM fills `GAMEPAD1/2` on a `$C070` touch; the shared emulator peripheral follows the same VIA serial protocol, and the browser maps two standard USB/Bluetooth controllers into it. |
| Jungle Quest — The Sunstone Run | Shipped | Six-screen `$0800` mixed-hi-res platformer; focused suite includes a complete successful expedition. |
| STAR DUEL | Shipped | Two-player `$0800` mixed-hi-res gravity duel; SNES pads + keyboard; `codegen/tools/spacewar.test.mjs` covers gravity, wrap, shots, collisions, and dual-pad input. |
| SUNSLING | Implemented | Separate original `$0800` two-player gravity duel. Current-ROM scan compensation preserves the strict 200-cycle cadence tolerance; idle/one-pad/two-pad/release coverage and the full-load/900-frame regression pass (worst work 49,833, period 52,536 cycles). `codegen/tools/sunsling.test.mjs` also exercises real-VM physics, both control paths, XOR rendering, simultaneous scoring, monitor restoration, and exported WOZ boot. |
| PULSAR DUEL | Shipped | Independent two-player `$0800` mixed-hi-res orbital duel, 5,632 bytes ending `$1E00`; 256×160 logical field, octagonal-norm inverse-square gravity via an `r^-3` force table, pilots spawn in a stable r=48 orbit, torpedoes curve; live frame measures ~8,600 cycles against the 26,224-cycle budget; `codegen/tools/pulsar.test.mjs` covers 66 checks including 240 frames of orbit stability and draw/erase round-tripping. |
