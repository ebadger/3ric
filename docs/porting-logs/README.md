# 3ric porting logs

These are historical engineering notes for getting existing Apple II titles running
on 3ric: what failed, what changed, why an experiment was rejected, and what a future
session can actually rely on. They also preserve the story behind the working images.
The record was assembled on **2026-09-30**, when the owner identified all four titles
below as working on the physical machine.

| Title | Main lesson | Evidence boundary |
|-------|-------------|-------------------|
| [A2Robots](a2robots.md) | Bank-safe keyboard interrupts, native SNES adaptation, and preserving the exact hardware-tested startup profile | Explicit board confirmation of keyboard/menu, Return-to-start, and controller-1 movement; not a full playthrough |
| [Spy vs Spy](spy-vs-spy.md) | A splash-only patch is not a demonstrated fix for an interrupt race | Owner lists it as working on 2026-09-30; earlier detailed coverage is emulator boot/input testing |
| [Spy Hunter](spy-hunter.md) | Refresh software-backed joystick state and never destructively sample its registers | Owner lists it as working on 2026-09-30; earlier detailed coverage is real-ROM emulator testing |
| [Pitfall II](pitfall-ii.md) | Avoid probing the input VIA as a sound card; then separate audio-clock correction from tonal quality | Explicit board confirmation of gamepad control and music with the direct-slot-4 patch; later tuning has separate caveats |

## Current experiments

| Title | Main lesson | Evidence boundary |
|-------|-------------|-------------------|
| [Archon](archon.md) (2026-10-05) | Preserve input interrupts across both language-card banks, and avoid paddle-timer traffic in a digital-controller adapter | Reproducible disk patcher with native PS/2 and WASM board/combat coverage; physical-board confirmation remains open |
| [Ultima V](ultima-v.md) (2026-10-15) | Replace a game's own disk loader under unmodified binaries; decode PS/2 bits before any bank work; read the ROM DOS's exact load/write semantics | Converter, glue, synthetic-volume and native PS/2 tests; WASM play through creation, overworld, combat, towne entry and save; first board trial failed on keyboard (fixed, re-trial pending) |
| [Seven Cities of Gold](seven-cities-of-gold.md) (2026-10-16) | Replace a game's RWTS with direct SD sector access to the original disk images; find the buffer the RWTS really uses (patched operands, not the IOB); 3RIC buttons need a `$C070` scan | Converter, loader, resident and shim tests on synthetic cards (two cluster sizes, refusals); native PS/2 on the resident; WASM play through sailing, landing and natives; World Maker made a new world that played; save at the Pub and the board are open |
| [Ultima I](ultima-i.md) (2026-10-15) | Replace only ProDOS (global page + MLI) under an unmodified ProDOS game; the ROM DOS reuses `$B0-$BF`, so keep scratch across each command; test the parameter block, not just the loaded bytes; feed SNES buttons in at the game's own keyboard read, and clock the pads directly - a `PTRIG` scan corrupts PS/2 frames | Converter, synthetic stand-in and pad tests on the ROM DOS; scripted WASM play of the original disk through creation, save/continue, town, castle, combat and a dungeon (also pad-only); owner's first SD-card run reached character creation |
| [Ultima II](ultima-ii.md) (2026-10-15) | A game that only speaks DOS 3.3 through Ctrl-D text needs a command translator on `CSW`, not a loader rewrite; patch "insert disk" prompts into folder switches; feed SNES pads in as keystrokes from a timer IRQ | Converter, translator and patch tests on synthetic disks; real-disk WASM play through creation, save, overworld, dungeon entry, reload, both space disk swaps and SNES-pad keys; no board trial yet |
| [Ultima III](ultima-iii.md) (2026-10-15) | When a game checksums its loader, keep the loader and replace the layer under it; move whole files on the first sector call | Converter, glue and synthetic RWTS test; WASM play of the original disks through set-up, creation, world, castle, combat, dungeon and save/resume with retimed music, plus SNES pad input; board: music confirmed working on a later run, gamepad untried |
| [Adventure](adventure.md) (2026-10-08) | Relocate 3ric's MSBASIC (`+$4000`) into Language Card RAM above DOS 3.3, bridge Applesoft tokens/boolean/formatting semantics, and fix the 1977 KIM-1 `FMULT` bug (`ROR RESULT+2`) | Reproducible DSK/WOZ patcher verified in WASM across cold boot, `CHAIN`, hi-res title, underground traversal, bird capture, `POP`, `SCORE`, `SAVE`, and NMI bank preservation; physical-board confirmation remains open |
| [Wizardry I](wizardry-i.md) (2026-10-16) | An Apple Pascal game ports at the BIOS block interface: one combined volume, direct ROM sector I/O through a cluster table, and the empty language card it maps on purpose needs the resident's vectors | Converter, glue, synthetic-volume tests on three cluster layouts, native PS/2 test; WASM play from title through castle, tavern write and maze entry; no board trial yet |
| [Dirt Bike](dirt-bike.md) (2026-10-22) | A game that reads raw sectors through its own T/S tables ports as raw-sector card files behind `FLOAD`/`OWRITE`, checked by their DOS header; Apple II speed comes back by pacing each frame's measured work on the Mockingboard's Timer 1 and retiming the speaker loops and `WAIT`s | Converter, loader and resident tests on synthetic files (loads, a missing file, hall-of-fame round trip, pads, timing); real-disk WASM play of the title, a pad race at Apple II speed (300 frames within 0.5%), the menu setting saved across a re-run and a staged record with initials; no board trial yet |

## Scope and evidence

This directory is **narrative documentation, not a new specification or a patch
distribution**. It changes no ROM, emulator, hardware, tooling, or game behavior.
The four September logs describe **prior-session evidence**, not tests rerun while
writing those notes. New experiments state their own executed coverage. Calculated pitch errors are not listening
tests, and successful browser input is not proof of a physical PS/2 exchange.

The games and patched images were owner-supplied/local artifacts. No game bytes,
disk images, commercial assets, replacement firmware, or private diagnostic media
are included or offered for download here. Short instruction changes describe the
engineering intervention, not a redistribution of the games.

Historical patchers and runbooks named in the four September logs are **not present
in this checkout**. The newer Archon, Ultima V, Ultima I, Ultima II, Ultima III, Wizardry I and Dirt Bike experiments include their own
converters and tests, but none of the original or converted game data. Local commit IDs identify retained development history;
they may not be reachable from `origin` or available in a fresh clone. They are
intentionally not GitHub commit links. The offsets, transformations, hashes, and
evidence in each log remain useful without those tools.

## Shared machine baseline

The reference ROM is the repository's
[`emulator/Data/badger6502.bin`](../../emulator/Data/badger6502.bin), SHA-256:

```text
fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435
```

That identifies the **canonical file**, not a verified readback of the physical
board's entire installed ROM. No full board-ROM readback was recorded.

| Area | Relevant contract in these investigations |
|------|-------------------------------------------|
| Clocks | 3ric CPU/AY: `25,175,000 / 16 = 1,573,437.5 Hz`; Apple II reference: `14,318,180 / 14 = 1,022,727.14 Hz`. Their ratio is approximately `1.538472418`. |
| Physical keyboard | VIA1 at `$C200`: PS/2 clock interrupt on CA2, DATA on PA7, CLOCK on PA6. `$C010` raises the CB1 strobe-clear path. `SEI` does not mask NMI. |
| Controllers | `$C070` raises CB2 for the ROM scan. Controller tables are `$CEE0`/`$CEF0`; the ROM maintains `$C061-$C063` buttons and paddle bit 7 at `$C064-$C067`, with onboard VIA timers providing paddle timing. |
| Serial | ACIA at `$C100` is the serial device, **not** the joystick timer. |
| Sound | The fixed slot-4 Mockingboard uses the two VIAs at `$C400` and `$C480`; these are not the onboard input VIA. |
| Banking | Language-card RAM can hide upper ROM without erasing it. Effective vectors and the bank visible at interrupt entry matter. |
| Browser input | `keyDown` can inject `$C000` directly, bypassing the actual PS/2 receiver, edge timing, and keyboard LED-command exchange. |

The final **74-series KiCad design**, not the historical `22v10` experiments, is the
hardware reference. ACIA, VIA1, and external NMI join CPU NMI; Mockingboard and external
IRQ join CPU IRQ. The VM's `IRQAsserted()` instead groups ACIA with Mockingboard.
That mismatch is a future investigation lead, **not a demonstrated physical cause**
of any failure in these logs.

Current architectural context lives in [SYSTEM](../../specs/SYSTEM.md), the
[platform reference](../../codegen/platform/platform-ref.md), and the
[build/run status](../../status/SYSTEM-STATUS.md). Those describe the current repo;
the title logs pin the historical image and experiment instead.

## Useful habits recovered from the work

- **Preserve the exact accepted artifact.** A renamed file with the same hash is
  the same result; a cleaned-up loader with different bytes is another experiment.
- **Keep addresses in their coordinate system.** Distinguish raw-file offsets,
  loaded addresses, relocated addresses, and decoded physical disk-sector offsets.
- **Exercise the whole input path.** Key injection, pad-table pokes, and a hand-fixed
  RAM image cannot establish that a cold boot and real interrupt traffic work.
- **Use physical evidence to challenge the model.** A failing board outranks a passing
  fixture; a diagnostic that changes startup state can also change the outcome.
- **Separate narrow success from unresolved causes.** Keep rejected images and their
  fingerprints recognizable, without promoting them to approved alternatives.
