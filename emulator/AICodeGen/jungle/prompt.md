# Jungle Quest: The Sunstone Run — replacement brief

- **Replacement model:** GPT-5.6 Sol (GitHub Copilot CLI)
- **Date:** 2026-07-13
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` &nbsp;→&nbsp; `BRUN JUNGLE.PRG 0800`
- **Replaces:** the 2026-07-10 Claude Opus 4.8 four-screen prototype

## Prompt

> Take a look at the Jungle Quest game. It was intended as a classic
> jungle-runner, but can you build a replacement that is actually fun and
> interesting?

## Design brief

Keep the useful 3ric-specific renderer, but replace the prototype's flat,
interchangeable rooms and automatic interactions with a short authored
expedition:

- responsive movement despite the event-driven keyboard;
- mechanics introduced separately, then combined;
- optional risk/reward instead of six identical mandatory pickups;
- deaths that cost something without erasing the whole run;
- a visible objective and a real finale;
- original art, levels, names, and code.

## Scope & originality

**JUNGLE QUEST: THE SUNSTONE RUN** is an original game inspired by the broad
jungle-platformer genre.
It reuses only the un-copyrightable **mechanics and genre conventions** — run and
jump, duck, leap pits, dodge threats, grab a vine, collect artifacts, race a
timer, and cross flip-screens. It does not reproduce any third-party ROM, code,
character, sprite, level layout, trademark, music, or sampled sound.

## Result

- **`jungle.s`** — 65C02 source.
- **`jungle.prg`** — assembled raw image (load and run at `$0800`).

The replacement runs in mixed hi-res mode (160px playfield + a four-line text
HUD). The engine
builds a 192-entry hi-res row-address table, blits OR-masked sprites with a
single x/7 division each, and erases by copying from a clean background buffer.
The assembled 5.3 KB image ends below the hi-res page at `$2000`.

- **Responsive traversal:** 8.8 gravity, four-frame coyote time, five-frame jump
  buffering, useful keyboard run impulses, one-way raised platforms, and a
  duck/brake with a genuinely smaller collision box.
- **Six authored screens:** Trailhead, Broken Steps, Blackwater, Bat Canopy,
  Fallen Ruins, and Sun Temple. Descriptor data supplies two gaps, two
  platforms, a checkpoint, a vine, and a threat per screen.
- **Distinct decisions:** jump boulders and snakes, duck under an animated bat,
  catch the Blackwater vine and press Jump to release it, then combine those
  skills in the ruins and temple.
- **Progression:** four glyphs open the sealed temple. Optional fruit awards 500
  points and restores five clock units. Reaching the Sunstone, not exhausting a
  generic pickup list, wins.
- **Fair failure:** three lives and a 90-unit gameplay clock. Death costs a
  life and five clock units, but keeps collected items and respawns at the current
  screen checkpoint with brief collision grace.
- **Presentation:** animated player/threat poses, textured canopy and soil,
  water-filled gaps, raised masonry, temple architecture, named screens, and
  contextual HUD messages.
- **Real hardware:** SNES D-pad plus A/B controls use the ROM's
  `PTRIG`/`GAMEPAD1` contract. Impossible opposing inputs reject the emulator's
  all-buttons-pressed placeholder, leaving keyboard play unchanged in WASM.

The focused test suite includes a deterministic complete expedition. It reaches
all six screens, collects all four glyphs, opens the temple, and claims the
Sunstone with lives and time remaining.

## Build & test

```sh
# assemble
node codegen/tools/asm6502.mjs emulator/AICodeGen/jungle/jungle.s emulator/AICodeGen/jungle/jungle.prg --org 0x0800

# renderer, physics, terrain, hazards, rewards, gate, vine, timer, pad guard,
# and a complete six-screen playthrough
node codegen/tools/jungle.test.mjs
```

## Run it

- **Hardware / disk:** `BRUN JUNGLE.PRG 0800`.
- **Hosted emulator:** deep link `?prg=programs/jungle.prg&org=0800`, or use
  **Load .PRG…** at address `0800`. Native **1×** is the tuned speed.

### Controls

- **A / Left, D / Right** — run; tap again to extend a keyboard run.
- **W / Up / Space** — jump; while swinging, release the vine.
- **S / Down** — duck under bats and brake precisely.
- **SNES D-pad + A/B** — equivalent controls on real hardware.
- **Space or pad Start/A/B** — begin.
- **Return or a fresh pad Start/A/B press** — restart after an end screen.
