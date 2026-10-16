# Adventure: Language Card BASIC relocation, Applesoft dialect bridge, and KIM-1 `FMULT` fix

**2026-10-08. Experimental emulator-verified image; physical-board confirmation remains open.**
The owner supplied `adventure.dsk` (*Adventure* by Peter Schmuckal & Leonard Barshack / A Bit Better Associates, 1980, running on Pronto-DOS / DOS 3.3) and asked to make it boot and run on 3ric.

## Exact artifacts

The input may be the original 143,360-byte DOS 3.3 `.dsk` image or its 234,496-byte `.woz` encoding. Both the original disk and the patched output remain local; this repository contains only the guarded patcher (`codegen/tools/patch-adventure.mjs`) and test suite (`codegen/tools/patch-adventure.test.mjs`).

| Artifact | SHA-256 |
|----------|---------|
| Original owner-supplied `adventure.dsk` (143,360 bytes) | `7d429cfd7d1999db3b42d1f4f149efdb16fda67685b282e68208ee4131b37e1d` |
| Deterministically encoded `adventure.woz` (234,496 bytes) | `426af3b3e925d6c53d98ff239cb5e15b4246de439c61d6bba4960a36da17e075` |
| `adventure-3ric.woz` candidate (234,496 bytes) | `563de7534700b6c60bdc4cc74d05897e9c5dac5daa3bd553ad58c7026443626a` |
| Unchanged repository `badger6502.bin` | `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435` |
| Unchanged repository `badger6502.dbg` (LF-normalized) | `995e7558dc0c8657e1c98cf115a5e776b1b2f29f5100936643bd796c31d936a3` |

## Why the original fails on 3ric

1. **RAM vs. BASIC ROM address collision (`$9D00-$BFFF` vs. `$9000-$BFFF`):**
   DOS 3.3 / Pronto-DOS loads into main RAM at `$9D00-$BFFF` and expects Applesoft BASIC in ROM at `$D000-$F7FF`. On 3ric, Microsoft BASIC resides in banked ROM at `$9000-$BFFF` (`$C006`/`$C007`), directly overlapping DOS 3.3 in RAM, while `$D000-$FFFF` holds the 3ric OS and Apple II Monitor.
2. **DOS 3.3 boot Language Card check:**
   At boot, `T0S9` (`$BFC8`) enables Language Card RAM write (`LDA $C081` twice), writes `$00` to `$E000`, and jumps to `$B744`, which checks if `$E000` is `$4C` (`JMP`, the first byte of Applesoft ROM) and halts if absent.
3. **DOS 3.3 and `CHAIN` Applesoft entry-point and zero-page dependencies:**
   DOS 3.3 (`$9D5A-$9D77`, `$9DCC`, `$A3AB-$A843`) and the machine-language `CHAIN` binary (`$0208-$03CF`, `T6S13-T6S12`) call Applesoft ROM entry points (`$D43C`, `$E000`, `$D52C`, `$D808`, `$DAFB`, `$D665`, `$D7D2`, `$D39A`, `$E484`, `$D393`) and manipulate Applesoft zero-page pointers (`TXTTAB $67/$68` through `CURLIN $75/$76`, `PRGEND $AF/$B0`, `TXTPTR $B8/$B9`). In 3ric's MSBASIC (built with `CONFIG_2A` + `SYNCHKTMP` + `USR`), zero-page variables from `TXTTAB` (`$6A/$6B`) upward are shifted by `+3` bytes, and `GARBAG` uses a 7-byte variable stride unless configured for 5-byte entries.
4. **Applesoft token numbers and runtime statements:**
   Both `ADVENTURE` (`T18S15`, 16 sectors) and `ADVENTURE^Q PART TWO` (`T19S15`, 76 sectors) are tokenized in Applesoft BASIC, which inserts seven graphics tokens (`HGR2`..`SHLOAD`) at `$91-$97`, shifting statement and function tokens relative to 3ric MSBASIC. The programs also use Applesoft statements (`HOME`, `CLEAR`, `CALL`, `HTAB`, `VTAB`, `HIMEM:`, `SPEED=`, `ONERR GOTO`, `RESUME`, `POP`), `PEEK(107)`/`PEEK(108)`, `PEEK(222)`, and `PEEK`/`POKE -16368` (`$C000`/`$C010`).
5. **Applesoft number formatting (`FOUT`), boolean (`+1`/`0`), and the 1977 KIM-1 `FMULT` bug:**
   - `ADVENTURE` reads random-access disk records via `PRINT CHR$(4);"READ OBDS,R";B` where `FOUT` in 3ric MSBASIC prepends a leading `' '` (`$20`) for positive numbers, causing DOS 3.3 to parse `R 1` as `R0`.
   - `ADVENTURE^Q PART TWO` uses arithmetic expressions on boolean comparisons such as `(PL%(N)=LO)+(PL%(N)=-1)` and `N=1 AND ...`, which require Applesoft's `+1`/`0` boolean representation rather than MSBASIC's `-1`/`0` bitwise representation.
   - `ADVENTURE^Q PART TWO` encodes room travel destinations as 8-digit floats (e.g. `B = 15008023`) and extracts the low 3 digits via `FNM(B) = B - INT(B / 1000) * 1000` (`MD = 1000`). 3ric's `msbasic` (`float.s` line 321, under `.ifndef CONFIG_11`) inherits the 1977 KIM-1 mask-ROM bug at `FMULT` (`$A5C7`): `adc #$00; .byte $67,$67` (`RRA $67` on NMOS 6502, a 2-byte `NOP` on 65C02) instead of `ror RESULT+2` (`$66 $67`). That leaves bit 7 of mantissa byte 3 unshifted whenever `RESULT` has bit 0 set (`INT(15008023/1000)*1000 = 15008064` instead of `15008000`), sending `DOWN` at the unlocked grate to room 63 (`DEAD END`) instead of room 8 (`BELOW THE GRATE`).

## What the candidate changes

- **CA65-driven `+$4000` MSBASIC relocation into Language Card RAM (`$D000-$F0FF`):**
  Using `badger6502.dbg` spans and fixups for segments `0..13` (`BASIC`), the patcher relocates 3ric's MSBASIC (`$9000-$B0FF`) by `+$4000` into `$D000-$F0FF` (33 sectors stored on unused `T3S0-T5S0`), leaving `$9D00-$BFFF` in main RAM free for DOS 3.3 and `$0800-$95FF` free for the 76-sector `ADVENTURE^Q PART TWO` program and its arrays/strings.
- **Guarded boot loader (`T0S9`, `T0S1`, `T5S1`) and VTOC reservation (`T17S0`):**
  `T0S9` (`$BFC8-$BFDB` and `$BFA8-$BFB6`) loads the 1-sector stage-2 installer from `T5S1` into `$0800`. Stage 2 verifies the 27-byte ROM NMI proxy (`$F1BB-$F1D5`) and a 16-bit checksum across `$B500-$BDFF` (halting with `3RIC ROM MISMATCH - RESET` on failure), copies `$F100-$FFFF` into Language Card RAM, installs the NMI vector at `$FFFA/$FFFB` (`LC_NMI $F040`, which services PS/2 start/data/parity edges and `$C010` CB1 strobes in-place without bank switching and forwards stop-bit/other NMIs through `$B78D` (`BIT $C082 / JMP $F1BB`) -> `$BFB1` (`BIT $C080 / JMP LC_RESUME`)), loads the 33 relocated BASIC sectors into `$D000-$F0FF`, enables Language Card Bank 2 read-only (`$C080`), and resumes DOS boot at `$B744`. All 34 sectors (`T3S0-T5S1`) are marked allocated in the Track 17 Sector 0 VTOC.
- **Applesoft runtime extension (`$EE10-$EFBA`), dialect fixes, and `FMULT` patch (`$E5C7`):**
  Installs Applesoft statement handlers (`HOME`, `CLEAR`, `CALL`, `HTAB`, `VTAB`, `HIMEM:`, `SPEED=`, `ONERR GOTO`, `RESUME`, `POP`), `PEEK`/`POKE` compatibility hooks, `INLIN` backspace/high-bit handling, single-line `INPUT` retry, 5-byte `GARBAG` variable stride (`$DDBE`), Applesoft `+1`/`0` boolean operators (`$DBE6`, `$DAAF`, `$DB52`), Applesoft `FOUT` formatting (`$E923`), and patches `$E5C7` from `$67` to `$66` (`ROR RESULT+2`).
- **DOS 3.3, `CHAIN`, and token table updates:**
  Updates DOS 3.3's Applesoft vector table and zero-page references, patches `CHAIN` (`T6S13-T6S12`) with relocated MSBASIC addresses, `+3` zero-page offsets, `VARTAB+1` (`$6D`) string-literal threshold at `$0298`, and `CHAIN_BLTU2`, and retokenizes `ADVENTURE` (`T18S15`, 16 sectors) and `ADVENTURE^Q PART TWO` (`T19S15`, 76 sectors) in place.

Only **134 sector data fields and the WOZ CRC** change. All 560 sectors validate, and reversing the 134 sector edits reproduces the baseline WOZ image byte for byte.

## Generate and run

With the exact original `adventure.dsk` (or `adventure.woz`) available locally:

```powershell
node codegen\tools\patch-adventure.mjs .\adventure.dsk .\adventure-3ric.woz
```

Cold-reset/power-cycle, insert `adventure-3ric.woz` into Drive 1, enter `MON` at the `>` shell prompt, and run `C600G`. The disk boots DOS 3.3, runs `HELLO` and `ADVENTURE`, displays the hi-res splash screen (`AN EXERCISE IN FANTASY`), loads `VOCEB` and `OBDW.OBJ`, prompts `WOULD YOU LIKE TO CONTINUE A GAME PREVIOUSLY SAVED ON DISK?`, and on `N` chains via `BLOAD CHAIN,A520` into `ADVENTURE^Q PART TWO`.

## Executed coverage and limits

```powershell
node codegen\tools\patch-adventure.test.mjs
node codegen\tools\patch-adventure.test.mjs --dsk .\adventure.dsk
node codegen\tools\asm6502.test.mjs
node web\test_boot.cjs
```

- Without `--dsk`/`--woz`, `patch-adventure.test.mjs` runs synthetic checks for CA65-driven MSBASIC relocation, the `$E5C7` `FMULT` fix, payload bounds, and Applesoft retokenization.
- With `--dsk` or `--woz`, it additionally verifies input/ROM hash guards, reversibility across all 560 sectors, on-machine `3RIC ROM MISMATCH - RESET` rejection, real hardware VIA1 Timer 1 NMI routing through `LC_NMI` (`$F040`) -> `$B78D` -> `$F1BB` -> `$B6A9` -> `$BFB1` (`BIT $C080 / JMP LC_RESUME`) with register (`A`, `X`, `Y`, `P`, `S`) and Language Card bank preservation, cold `C600G` boot, hi-res splash screen (`textMode === 0`, `lores === 0`) and text restoration (`textMode === 1`), `CHAIN` into `ADVENTURE^Q PART TWO`, above-ground and underground exploration (`EAST`, `TAKE KEYS`, `TAKE LAMP`, `WEST`, `SOUTH`×3, `UNLOCK GRATE`, `DOWN`, `LAMP ON`, `WEST`, `TAKE CAGE`, `WEST`, `TAKE ROD`, `WEST`×2, `DROP ROD`, `TAKE BIRD`, `TAKE ROD`, `PR#1` (`POP` -> `NO PRINTER AVAILABLE`), `INVENTORY`, `SCORE`), and `SAVE` (`ONERR GOTO 9000` -> `SAVING 'ADGMTEST'...` -> `NEW : END`) followed by `RUN ADVENTURE`.
- Because `WozLib` does not implement Disk II sector writes, `SAVE` completes through DOS 3.3 in memory without persisting sectors back to the `.woz` image. Physical-board verification remains open.
