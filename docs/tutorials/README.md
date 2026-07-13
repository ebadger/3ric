# 3ric Game Programming Tutorials

> Learn to write games in **65C02 assembly** on the 3ric — with nothing to install.
> Every lesson runs in the in-browser **Assemble & Run** editor at
> <https://ebadger.github.io/3ric/>, so you can read, edit, re-assemble, and run each
> program with one click.

**Status: complete.** All eight lessons and their example programs are written and
**verified on the emulator**. Start with the live index at
<https://ebadger.github.io/3ric/tutorials.html> (or the **Tutorials** link in the site
header), or jump straight to **[Lesson 1 — Hello, 3ric](01-hello.md)**. Each lesson links a
one-click **▶ Run it** button that opens its program in the browser editor.

---

## Who this is for

You've programmed a little in *some* language (variables, loops, `if`) but have never
written assembly — or you've dabbled in 6502 and want to *make games* with it. You do
**not** need to own any hardware, install a toolchain, or know Apple II lore. If you can
open a web page, you can do every lesson.

By the end you'll be able to read the 3ric's shipped games (`snake`, `bricks`, `rocks`,
`swarm`, `jungle`, …) and write your own.

## How the series works

Each lesson is a short markdown page with four parts:

1. **The idea** — one new concept (drawing, input, motion, collision, randomness…),
   explained in plain language with a picture of the memory involved.
2. **The code** — a small, fully-commented `.s` program that *builds on the previous
   lesson's program*. We add one capability at a time; nothing is a black box.
3. **Run it** — a one-click link that opens the program in the browser editor and runs
   it: `https://ebadger.github.io/3ric/?src=programs/<name>.s`.
4. **Make it yours** — 2–4 exercises that change or extend the program, from
   one-liners to a small feature.

Because the lessons build on each other, by Lesson 7 you've assembled a complete little
game out of parts you wrote yourself.

### How the examples stay honest

Every example program lives in [`codegen/programs/`](../../codegen/programs) as a real
`.s` file. That means:

- It is **auto-staged to the live site** by `web/build.ps1`, so the "Run it" deep link
  always works (`?src=programs/<name>.s`).
- It is **verified headlessly** with the project harness before shipping — e.g.
  `node codegen/tools/run6502.mjs codegen/programs/<name>.s --expect-serial "…"` — so the
  code in the tutorial is guaranteed to assemble and run, never hand-waved. (This follows
  the project rule: *prove 6502 behavior on the emulator, never fake it.*)

If you've cloned the repo you can run any example locally exactly the way the site does;
if you haven't, the browser is all you need.

## What you'll need to know first (a 2-minute primer)

The 65C02 is an 8-bit CPU. The whole mental model for these lessons:

- **Three registers** you use constantly: **A** (accumulator — the "hands", where math
  and comparisons happen), **X** and **Y** (index registers — counters and offsets).
  Each holds one byte (0–255).
- **Memory** is one flat list of byte-addressable cells from `$0000` to `$FFFF` (`$` =
  hexadecimal). *Some* of those cells aren't RAM — they're the **screen**, the
  **keyboard**, and **soft switches** that flip the machine's modes. Writing a game is
  mostly "put the right byte in the right memory cell at the right time."
- **Instructions** are tiny: load a byte into a register (`LDA`), store it back to memory
  (`STA`), add/compare (`ADC`/`CMP`), jump/branch (`JMP`/`BNE`), call a subroutine
  (`JSR`/`RTS`). We introduce each one the first time we need it — you don't have to learn
  them up front.

Everything else (addressing modes, the status flags, the stack) we teach *just in time*,
in the lesson where it first earns its keep.

## The 3ric, as a game machine

The teaching subset of the hardware. Full detail is in the auto-generated
[`platform reference`](../../codegen/platform/platform-ref.md).

| Capability | What you get | Where it lives |
| --- | --- | --- |
| **Text** | 40 columns × 24 rows of characters | screen RAM at `$0400`–`$07FF` |
| **Lo-res color** | 40 × 48 blocks (or 40 × 40 + a 4-row text HUD in *mixed* mode), 16 colors | same `$0400` page, two pixels per byte |
| **Hi-res** | 280 × 192 dots | `$2000`–`$3FFF` (page 1) |
| **Keyboard** | last key at `$C000` (bit 7 = "a key is ready"); touch `$C010` to clear it | soft-switch page |
| **Mode switches** | text/graphics, lo/hi-res, full/mixed, page 1/2 | `$C050`–`$C057` |
| **ROM helpers** | `COUT` ($FDED) prints a char; `HOME` ($FC58) clears the text screen; and ~1800 more | Monitor ROM |

Two conventions used by every program in the series:

- A program is loaded at, and starts running from, its **`.org` address** (we use
  `$0800`, a chunk of free RAM). On real hardware that's `BRUN NAME.PRG 0800`.
- A program **ends with `BRK`**, which drops back to the monitor. (In the browser you just
  press Reset or run something else.)

---

## The lessons

A 40-second summary of the whole arc, then the detail. Each lesson adds one capability
and reuses the routines from the lessons before it.

| # | Title | The big new idea | You build | Mode |
| --- | --- | --- | --- | --- |
| 1 | [Hello, 3ric](01-hello.md) | assemble/run; registers; a loop; printing | a message on screen | text |
| 2 | [Drawing on the text screen](02-text-screen.md) | screen memory is just bytes | a titled, bordered scene + HUD | text |
| 3 | [Input and the game loop](03-input.md) | read the keyboard; the read→update→draw loop | a hero you walk around | text |
| 4 | [Color with lo-res graphics](04-lores.md) | mode switches; a `PLOT` routine | a movable color block | lo-res |
| 5 | [Motion and collision](05-motion.md) | velocity; bouncing off walls | a bouncing ball | lo-res |
| 6 | [Randomness and scoring](06-random.md) | an LFSR; spawning; keeping score | catch-the-food | lo-res |
| 7 | [Space Invaders](07-invaders.md) | game states; formation AI; win/lose/restart | Space Invaders, start to finish | lo-res |
| 8 | [Hi-res and beyond](08-hires.md) | hi-res dots; where to go next | a hi-res starfield | hi-res |

### Lesson 1 — Hello, 3ric
- **Goal:** get a program written, assembled, and running in the browser; understand the
  loop that prints text.
- **You'll learn:** the Assemble & Run editor; `.org` and the `.PRG`/`BRK` model;
  `LDA`/`STA` and immediate vs. loaded values; a simple `LDX`/`INX`/`BNE` loop; the `COUT`
  ROM routine; why screen/serial text uses **high-bit ASCII** (`'A'` → `$C1`) and `$8D`
  for a carriage return.
- **You'll build:** a program that prints a banner (e.g. `HELLO, 3RIC`) to the screen.
- **Program:** `codegen/programs/tut1_hello.s` — a fully-commented cousin of the existing
  [`hello.s`](../../codegen/programs/hello.s).
- **Verified by:** `--expect-serial "HELLO, 3RIC"`.
- **Make it yours:** change the message; print it twice; print your name on a second line.

### Lesson 2 — Drawing on the text screen
- **Goal:** stop using `COUT` and put bytes on the screen yourself — the foundation of all
  drawing.
- **You'll learn:** the text page at `$0400`; that rows are **not** stored back-to-back
  (the interleaved layout) and how a small **row-address table** solves that; writing a
  character by storing its (high-bit) code straight into screen RAM with indexed
  addressing (`STA base,X`); `HOME` to clear; **inverse** video for a highlighted HUD.
- **You'll build:** a static "game screen": a border box, a centered title, and a
  `SCORE: 000` HUD line.
- **Program:** `codegen/programs/tut2_screen.s`.
- **Verified by:** decoding the 40×24 text screen and matching the drawn text.
- **Make it yours:** move the box; change the border character; add a second HUD field.

### Lesson 3 — Input and the game loop
- **Goal:** make something *interactive* — the heart of every game.
- **You'll learn:** reading the keyboard at `$C000` (bit 7 = ready) and clearing the
  strobe at `$C010`; the universal **read → update → draw** loop; comparing the key with
  `CMP` and branching (`BEQ`/`BNE`) to handle W/A/S/D and the arrow keys; storing the
  player's X/Y in **zero-page** variables; erasing the old cell before drawing the new one;
  keeping the player inside the border.
- **You'll build:** a `@` hero you walk around inside the Lesson 2 box.
- **Program:** `codegen/programs/tut3_move.s`.
- **Verified by:** feeding scripted keypresses and asserting the hero's final position in
  memory.
- **Make it yours:** add diagonal keys; wrap around the edges instead of stopping; leave a
  trail.

### Lesson 4 — Color with lo-res graphics
- **Goal:** turn on color graphics and draw blocks.
- **You'll learn:** the mode **soft switches** (`$C050` graphics, `$C056` lo-res, `$C053`
  mixed, `$C054` page 1) and that you *touch* them, not write values; the lo-res memory
  model (each screen byte is **two stacked pixels** — low nibble on top, high nibble on
  the bottom) and how a lo-res row maps to a text row; a reusable **`PLOT` subroutine**
  (given X, Y, color) — the same nibble-packing idiom the shipped `snake.s` uses; the
  16-color palette.
- **You'll build:** a color swatch test, then a single block you move with the keyboard
  (Lesson 3's input, now in color).
- **Program:** `codegen/programs/tut4_lores.s`.
- **Verified by:** asserting the plotted screen bytes for a few known cells.
- **Make it yours:** cycle the block's color as it moves; draw a color gradient; plot your
  initials.

### Lesson 5 — Motion and collision
- **Goal:** make things move on their own and react to walls.
- **You'll learn:** representing **velocity** as a per-axis delta (`+1`/`−1`, stored as
  `$01`/`$FF`); advancing position every frame; detecting a wall hit with `CMP` and
  **reflecting** (flip the delta); pacing the loop so it's watchable; the erase-old /
  draw-new pattern applied to a moving object.
- **You'll build:** a ball that bounces around the lo-res field; a keypress nudges it.
- **Program:** `codegen/programs/tut5_bounce.s`.
- **Verified by:** running N frames headlessly and asserting the ball bounced (position /
  direction changed as expected).
- **Make it yours:** add gravity; speed the ball up on each bounce; add a second ball.

### Lesson 6 — Randomness and scoring
- **Goal:** add the two things that make a game a game — surprise and a score.
- **You'll learn:** why you need pseudo-randomness and how a tiny **LFSR** produces it
  (the `seedL`/`seedH` trick from `snake.s`); mapping a random byte into a field
  coordinate; spawning food and re-spawning it when eaten; simple "am I standing on it?"
  collision; incrementing a score and updating the HUD digits from Lesson 2.
- **You'll build:** a player block that chases randomly-placed food; each pickup scores
  and respawns the food.
- **Program:** `codegen/programs/tut6_catch.s`.
- **Verified by:** a fixed seed → deterministic food positions → scripted moves reach a
  known score.
- **Make it yours:** add a countdown timer; make some food worth more; add a "bad" cell to
  avoid.

### Lesson 7 — A complete game: Space Invaders
- **Goal:** assemble everything so far into a finished, replayable arcade game.
- **You'll learn:** a simple **game-state machine** (title → play → game-over → restart);
  driving a **formation** of invaders that marches side to side, drops a row at the edges,
  and speeds up as its ranks thin; a player cannon and a bullet that travels up the field
  (Lesson 5's motion); bullet-vs-invader and invader-vs-cannon collision (Lesson 6's
  collision); score and lives on the text HUD; a title screen and a restart key. It's built
  in **lo-res**, so every technique carries straight over from Lessons 4–6.
- **You'll build:** Space Invaders — slide a cannon along the bottom and clear a marching
  block of invaders before they reach you.
- **Program:** `codegen/programs/tut7_invaders.s`.
- **Verified by:** scripted play — a fired shot removes an invader and bumps the score;
  letting the formation reach the cannon triggers game-over.
- **The full version:** afterward you'll be able to read the shipped, hi-res
  [`swarm.s`](../../emulator/AICodeGen/swarm/swarm.s) (STAR SWARM) — the same game grown up
  with destructible shields, a bonus saucer, and hi-res sprites.
- **Make it yours:** add shields; a bonus saucer; let the invaders shoot back.

### Lesson 8 — Hi-res and beyond
- **Goal:** peek at the high-resolution screen and point the way to bigger projects.
- **You'll learn:** switching to **hi-res** (`$C057`, page 1 at `$2000`); the
  7-dots-per-byte layout and why hi-res math is trickier than lo-res; precomputing a
  192-entry **row-address table** so the interleaved memory map is a non-issue; plotting
  dots without ever dividing an X coordinate by 7.
- **You'll build:** a hi-res starfield with three rulers (with a twinkle as an exercise).
- **Program:** `codegen/programs/tut8_hires.s`.
- **Verified by:** asserting lit pixels in the hi-res page.
- **Where to go next:** a guided reading list of the shipped hi-res games — `swarm` (the
  hi-res Space Invaders you just built a lo-res version of), `rocks` (vector shooter), and
  `jungle` (platformer) — mapped to the concepts each one will teach you.

---

## Conventions used throughout

- **Assembler dialect:** the project's own `asm6502.mjs` (see the
  [code-generation guide](../../codegen/platform/prompt-system.md)). Labels `name:`,
  equates `NAME = expr`, `.org`, `.byte`/`.word`, `$hex`/`%bin`/`'c'`, `<`/`>` for
  low/high byte. Symbols are **case-insensitive** — the series keeps constant names
  distinct from variable names (a real footgun documented in the guide).
- **Program naming:** `tutN_shortname.s`, all in `codegen/programs/` so they auto-stage
  and each gets a `?src=programs/tutN_shortname.s` deep link.
- **Load address:** `$0800` unless a lesson says otherwise.
- **Every program is verified** with `run6502.mjs` before it ships in a lesson.

## Not covered (and why)

- **Sound** — kept out of the core arc until the emulator's audio path is confirmed
  end-to-end; a bonus lesson can be added if/when it's a first-class feature.
- **Disk / SD file I/O** — orthogonal to game logic; the browser's Load/Share flow covers
  distribution.
- **Deep hi-res techniques** (shape tables, page-flipping, precise color) — Lesson 8 opens
  the door and hands off to the shipped hi-res games as worked examples.

## Decisions (from review)

Locked in with ebadger:

1. **Scope:** 8 lessons.
2. **Capstone (Lesson 7):** **Space Invaders**, built in lo-res; the shipped hi-res
   [`swarm.s`](../../emulator/AICodeGen/swarm/swarm.s) is the "full version" to read next.
3. **Website surfacing:** add a **Tutorials** entry point on the live site
   (<https://ebadger.github.io/3ric/>) and a **Tutorials** optgroup in the Assemble & Run
   editor's sample picker, so each lesson's program is one click away. Each `tutN_*.s`
   auto-stages via `web/build.ps1`; the picker and entry point are wired in
   `web/index.html`.
4. **Teaching depth:** keep the **just-in-time** approach — introduce each 6502 concept in
   the lesson that first needs it; no separate up-front primer lesson.
