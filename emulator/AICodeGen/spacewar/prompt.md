# STAR DUEL — codegen prompt

- **Model:** Grok 4.6 (GitHub Copilot CLI)
- **Date:** 2026-09-16
- **Target:** 3ric (65C02, Apple-II compatible)
- **Load / entry address:** `$0800` → `BRUN SPACEWAR.PRG 0800`

## Prompt

> Please generate a 6502 assembly game for the 3RIC machine. 2 player space war
> where SNES controllers or keyboard can control 2 ships. Please include a
> gravity effect much like the original spacewar game.

## Scope & originality

**STAR DUEL** is an original two-player gravity-duel inspired by the un-copyrightable
Spacewar conventions: two ships, a central sun, inverse-distance gravity, screen wrap,
thrust with inertia, and torpedoes. It does not reproduce any third-party ROM, code,
vector art, trademark, music, or sampled sound. The name, wedge silhouettes, HUD copy,
and 65C02 implementation are original to 3RIC Studio.

## Result

- **`spacewar.s`** — 65C02 source.
- **`spacewar.prg`** — assembled raw image (load and run at `$0800`).

Runs in mixed hi-res (280×160 XOR ships over a persistent sun and starfield, plus a
4-line text HUD). Gravity uses a Manhattan-distance lookup toward (140, 80). First
player to 5 kills wins.

## Build & test

```sh
node codegen/tools/asm6502.mjs emulator/AICodeGen/spacewar/spacewar.s emulator/AICodeGen/spacewar/spacewar.prg --org 0x0800
node codegen/tools/spacewar.test.mjs
```

## Controls

- **P1 keyboard:** A/D or arrows rotate, W/Up thrust, S/Space fire, H hyperspace
- **P2 keyboard:** J/L rotate, I thrust, K/U fire, N hyperspace
- **SNES pad 1/2:** D-pad left/right rotate, Up/B thrust, A/Y fire, Select hyperspace, Start play/rematch
- **Q / Esc:** text mode, HOME, monitor `BRK`
