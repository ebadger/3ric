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
- **Ultima V SD-card port:** `codegen/tools/port-ultima5.mjs` converts the eight
  owner-supplied ProDOS disk sides into a `U5/` folder for the micro-SD card
  (`CD U5`, `BRUN U5.PRG 0800`). The game data stays local; the repository holds
  the converter and glue (`codegen/patches/ultima5/`).
  - **Loader contract:** Origin's DINKEYDOS is replaced in language-card bank 1 at
    `$D000` by a shim with the same 14-entry jump table, inline parameters, zero
    page (`$52-$55`, `$60-$7F`), `$D600` block buffer and return codes. Each disk is a
    folder; ProDOS names become dot-less 8-character keys looked up only among the
    current disk's files. Loads use `FLOAD key addr 0000 eof-1`, writes use `OWRITE`
    on existing files only, block `n` is bytes `(n&7)*512` of `RAWnn` (`n/8`, hex).
  - **Banking and interrupts:** the game runs with the BASIC overlay off (`$CAFE`
    nest count 0) and language-card RAM read/write in bank 1 or 2. The loader points
    the RAM `$FFFA/$FFFE` vectors at a resident in `$CF00-$CFFF`. PS/2 start/data/
    parity edges and the `$C010` strobe (CB1) are serviced there without bank work,
    sharing the ROM receiver state `$CE00/$CE01/$CE19` and reading DATA via `$C20F`;
    the bank switch would otherwise delay the DATA sample past the next bit. Other
    sources record the bank from a `$DFFF` signature, enter the ROM handler through
    a fake RTI frame, and restore `$C083`/`$C08B` and X/Y. The loader refuses a ROM
    whose NMI proxy `$F1BB-$F1C5` differs. ROM DOS commands run with ROM reads and
    bank-1 writes; `$B0-$BF` and `$36/$37` are preserved. `$CF00-$CFFF` is
    reserved for this profile, not a general free-RAM declaration.
  - **Trust:** ROM DOS command failures are not detected (the ROM reports them only
    as text); the generated card contents are assumed complete.
  - **Machine:** 64 KB play; the game's 128 KB music path stays off because `$FBB3` is
    not `$06`. `STARTUP`'s unconditional IIe aux/RamWorks writes are removed by one
    byte-verified patch. No ROM, VM, web bridge or hardware change is part of the port.
  - **Acceptance and limits:** see [`docs/porting-logs/ultima-v.md`](../docs/porting-logs/ultima-v.md).
- **Ultima III SD-card port:** `codegen/tools/port-ultima3.mjs` converts the two
  owner-supplied DOS-order disk images of the supported release (side 1 boots a memory
  image carrying the game's own resident DOS; side 2 is the player disk) into a `U3/`
  folder (`CD U3`, `BRUN U3.PRG 0800`). The game data stays local; the repository holds
  the converter and glue (`codegen/patches/ultima3/`).
  - **Loader contract:** the game prints `Ctrl-D BLOAD/BRUN/BSAVE NAME` through `COUT`
    to its own DOS (`CSW = $B44A`), which finds the name in a 96-entry track/sector
    table at `$AF80`. That DOS (`$AF80-$BFFF`, SHA-256-checked) is kept byte for byte,
    because the game checksums `$B42D-$B4AD`, `$B5A8-$B628`, `$B610-$B690` and
    `$B731-$B74C`, reads `$B44A`/`$B766-$B76F` and needs `$03F1 = $B7`. Only its
    DOS 3.3 RWTS is replaced: `$BD00` jumps to a shim at `$BE40-$BFFF` (clear of the
    `$BE3D` byte count and the `$B8E7-$BB28` nibble tables the DOS still writes). The
    first RWTS call of a command (`$48/$49` still at the table entry) moves the whole
    file with `FLOAD NAME addr 0000 len-1` or `OWRITE NAME addr len`; later sector
    calls return at once (`$48/$49` left at the IOB, as RWTS leaves them). All 96
    files share one folder under their own names; side and drive arguments no longer
    matter. `ROST PLRS PRTY SOSA SOSM` must exist for `OWRITE`.
  - **Machine:** 48 KB play, BASIC overlay off (`$CAFE = 0`), no language card, so the
    ROM's NMI/IRQ vectors stay in effect (IRQ → `$03FE`). ROM commands run under `SEI`
    with `$B0-$BF` and `CSW` restored: the music driver keeps its pointers in the
    FAT32 zero page. `MBS` is the one modified game file: its VIA T1 latch (`$411A` →
    `$6429`) and 96 AY note periods are scaled by `1.538472` so tempo and pitch match
    the Apple, and its two `$03FE/$03FF` stores are redirected to the gamepad tick's
    `next_irq` link. Other speaker/delay-loop timing runs ~1.54x faster. No ROM, VM,
    web bridge or hardware change is part of the port.
  - **SNES gamepads:** the loader starts with `SEI`, turns off and clears both
    Mockingboard VIAs' interrupts and resets both AYs (whatever a previous run left
    running; the game itself only resets the first), then runs the second VIA's Timer 1
    (`$C480`) free at ~61 Hz with `$03FE` → a tick in the dead RWTS code at
    `$BD03-$BE3C`. The tick services only its own T1 flag (otherwise `JMP (next_irq)`:
    MBS's handler, or `LDA $45 / RTI`), reads both pads itself through VIA1 port B as
    the ROM scan does (PB6 latch, PB7 clock, active-low PB5/PB4) rather than through
    `PTRIG $C070`, whose ROM NMI scan exits by clearing every VIA1 flag and could drop a
    PS/2 edge, and turns presses (either pad) into keys in `$C000` once the
    previous key was taken: D-pad → Return / `/` / ← / → (north/south/west/east, held
    repeats after ~0.3 s every ~0.15 s), B Space, A `A`ttack, X `E`nter, Y `T`ransact,
    L `K`limb, R `D`escend, Select `I`gnite, Start `G`et. Keyboard input is unchanged.
  - **Acceptance and limits:** see [`docs/porting-logs/ultima-iii.md`](../docs/porting-logs/ultima-iii.md).
- **ROM DOS load/write semantics (observed, unchanged):** `FLOAD name addr start end`
  takes an inclusive end offset and skips to `start` byte by byte; `BLOAD` stores one
  byte past EOF; `OWRITE` writes whole sectors in place and, for a missing file, falls
  back to `BSAVE` code in the BASIC bank (`$ACFD`), which is unsafe with the overlay off.
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
| Archon disk-only compatibility adapter | Experimental / emulator-verified | Exact-image patcher; actual disk boot, options, keyboard and two-pad board/combat input, runtime mismatch guards, and native PS/2/LED/register/bank checks. Physical board and full-playthrough approval remain open; see the porting log. |
| Ultima V SD-card port | Experimental / emulator-verified | `codegen/tools/port-ultima5.test.mjs` drives the real loader/resident/shim on the ROM DOS with synthetic volumes (and boots the original disks to the title with `U5_DISKS`); `port-ultima5.native.ps1` decodes real PS/2 frames at 94-160-cycle periods with language-card RAM mapped, including Caps Lock LED exchanges and a `` strobe on a stop-bit edge. Manual WASM play covered creation, save, overworld, combat, towne entry. First board trial: title shown, keyboard failed (fixed since, re-trial pending). Dialogue, dungeons, endgame and music (needs 128 KB) are open; ROM DOS command failures are not detected (card contents trusted); block reads cost ~1.7 M cycles. |
| Ultima III SD-card port | Experimental / emulator-verified | `codegen/tools/port-ultima3.test.mjs` reconstructs a synthetic boot image and drives the real loader/RWTS shim on the ROM DOS (whole-file loads, zero-page load, write and read-back, IOB/flag state); with `U3_DISKS` it plays the original disks through Mockingboard set-up, title, character creation, party, world, Lord British's castle, a dungeon and an autosave resume after reset, and checks the 61.5 Hz music IRQ; the gamepad tick is checked synthetically (buttons type keys, held directions repeat) and SNES Up walks the real party north. Talking, shops, Moongates, the endgame and the physical board (including pad scans alongside PS/2 typing) are open; ROM DOS command failures are not detected (card contents trusted); loads run ~2 KB/s in the emulator (boot ~30 s). |
| ROM `BLOAD` stores one byte past EOF | Known gap (ROM) | Observed in `fat32_file_read`; programs loading below live data must use `FLOAD 0000 eof-1`. ROM source is not in this repository. |
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
