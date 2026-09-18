# PULSAR DUEL — codegen prompt

- **Model:** Claude Opus 5 (GitHub Copilot CLI)
- **Date:** 2026-09-17
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` → `BRUN PULSAR.PRG 0800`

## Prompt

> Please generate a 6502 assembly game for the 3RIC machine. 2 player space war
> where SNES controllers or keyboard can control 2 ships. Please include a
> gravity effect much like the original spacewar game. This is a model
> benchmark, so please skip the normal model code review requirements.

A previous run of this benchmark had already shipped **STAR DUEL**
(`emulator/AICodeGen/spacewar/`) for the same prompt. Asked how to proceed, the
maintainer chose *"build a fresh game alongside it under a new name"* — so
PULSAR DUEL was designed and written from scratch rather than derived from the
existing implementation. `spacewar.s` was consulted only for platform contracts
that any program on this machine must honour (the `PTRIG` + `GAMEPAD1/2` scan
sequence, the keyboard hold-timer idiom forced by the latch having no key-up,
and the monitor-safe zero-page window at `$06..$0F`).

## Scope & originality

**PULSAR DUEL** is an original two-player orbital duel. It reuses only the
un-copyrightable Spacewar premise — two ships, one gravity well, a wrapping
playfield, thrust with inertia, torpedoes, and hyperspace. It reproduces no
third-party ROM, code, vector art, trademark, music, or sampled sound. The
name, silhouettes, HUD copy, physics model, and 65C02 implementation are
original to 3RIC Studio.

Every implementation choice differs from STAR DUEL:

| | STAR DUEL | PULSAR DUEL |
|---|---|---|
| Field | 280×160 screen coordinates | 256×160 *logical*, x wraps mod 256 for free, mapped to column x+12 |
| Distance | Manhattan | octagonal norm `max + min/2` |
| Force | 32-entry magnitude table | 176-entry `F[r] = G·65536/r³` + 8×16 multiply → true inverse-square |
| Opening | ships at rest off the sun's row | both pilots spawn **in orbit**, r = 48, same rotational sense |
| Torpedoes | ballistic | fall into the well on the same code path, so shots curve |
| Working RAM | `$6000`–`$63xx` | entirely inside the image, which ends below `$2000` |

## Design notes

- **Logical playfield.** Logical x is one byte and wraps for free; logical y is
  scanline 0..159 and is folded by hand. The pulsar sits dead centre at
  (128, 80), which makes `STARY - y` always the shortest wrapped path, so the
  vertical axis needs no wrap correction in the distance code.
- **Gravity without division.** `F[r] = round(160·65536/r³)` is tabulated for
  r = 0..175, clamped below r = 10 and capped at 16383. Per-axis acceleration is
  `(|d| · F[r]) >> 8` in 8.8 fixed point, computed with a shift-add 8×16→24
  multiply. Because the octagonal norm guarantees `|d| ≤ r`, the product always
  fits 24 bits. Integrating velocity before position (semi-implicit Euler) keeps
  orbits from spiralling.
- **The wrap seam matters.** An r = 80 orbit would graze `y = 0/160`, where a
  wrapped field stops behaving like a plane and the orbit collapses into the
  star. r = 48 keeps the entire path clear; measured over 400 frames the orbit
  precesses between r = 47.4 and r = 61.3 and visits all four quadrants.
- **Erase by redrawing.** Everything moving is XOR'd, and the previous frame's
  `(x, y, heading, thrust)` is kept per ship, so erasing is drawing the same
  geometry again. The starfield and pulsar are painted once and are restored
  exactly — a test asserts the page is byte-identical after draw then erase.
- **Keyboard has no key-up.** Every recognised press arms a hold timer that is
  replayed as held intent for several frames, so a key feels held even though
  the latch only reports edges. Pads report live state and feed intents directly.

## Result

- **`pulsar.s`** — 65C02 source.
- **`pulsar.prg`** — assembled raw image, 5,632 bytes, `$0800`–`$1E00`.

A live frame measures about 8,600 cycles against the 26,224-cycle budget at
1.5734 MHz; the remainder is burned in `pace` so the game runs at a steady rate.

## Build & test

```sh
node codegen/tools/run6502.mjs emulator/AICodeGen/pulsar/pulsar.s --out emulator/AICodeGen/pulsar/pulsar.prg
node codegen/tools/pulsar.test.mjs
```

## Controls

- **P1 keyboard:** A/D rotate, W thrust, S fire, X hyperspace
- **P2 keyboard:** J/L or ←/→ rotate, I or ↑ thrust, K fire, M hyperspace
- **SNES pad 1/2:** D-pad left/right rotate, Up or B thrust, A or Y fire,
  Select hyperspace, Start play/rematch
- **Space / Return:** start or rematch (and fire for P1 during play)
- **Q / Esc:** text mode, HOME, monitor `BRK`

Hyperspace jumps to a random point and misjumps one time in eight, which
credits the opponent. First pilot to 5 kills wins.
