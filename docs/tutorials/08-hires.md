# Lesson 8 — Hi-res, and where to go next

> **You'll build:** a 280×192 hi-res starfield with three rulers, then get a map of the
> shipped games to study next.
> **New ideas:** hi-res mode and its interleaved row memory; precomputing an address table;
> reading real, finished 3ric games.
> **Program:** [`codegen/programs/tut8_hires.s`](../../codegen/programs/tut8_hires.s) ·
> **▶ Run it:** <https://ebadger.github.io/3ric/?src=programs/tut8_hires.s>

---

## 1. The idea

Lo-res gave us 40×48 chunky color. **Hi-res** gives us **280×192** — six times the detail —
and it's where the shipped 3ric games live. The trade-off is a stranger memory layout.

Hi-res page 1 is `$2000–$3FFF`. Each byte holds **7 horizontal pixels** (bits 0–6, bit 0 =
leftmost); bit 7 selects the color palette. So a full-width white line is `$7F` in every byte
across a row.

The catch is that **rows are interleaved** — row *y* is *not* simply `$2000 + y*40`. The
address is the famous Apple-II formula:

```
addr(y) = $2000 + (y & 7)*$400 + ((y>>3) & 7)*$80 + (y>>6)*$28
```

Computing that per pixel would be slow and error-prone, so we do it **once** into a 192-entry
lookup table and never think about it again.

## 2. The code

### Precomputing the row table

`build_rows` (lifted straight from the shipped `swarm.s`) fills `ROWL[y]`/`ROWH[y]` with the
low and high bytes of each row's address. We park those 192-byte tables in free RAM at
`$6000`/`$6100`, well clear of both our program (`$0800`) and the screen (`$2000`):

```asm
SCREEN  = $2000
ROWL    = $6000
ROWH    = $6100
```

After `jsr build_rows`, drawing to row *y* is just: read `ROWL/ROWH[y]` into a pointer, then
index by the byte column.

### A white line

```asm
hline:  tay
        lda ROWL,y          ; ptr = address of this pixel row
        sta ptr
        lda ROWH,y
        sta ptr+1
        ldy #39
        lda #$7F            ; all 7 pixels on
hl1:    sta (ptr),y
        dey
        bpl hl1
        rts
```

We call it for rows 0, 96, and 191 — top, middle, bottom rulers.

### A starfield without dividing by 7

To place a single pixel you normally need `column = x / 7` and `bit = x mod 7` — a division.
We sidestep it entirely: the starfield picks a **column (0–39)** and a **bit (0–6)** *directly*
from the RNG, so there's nothing to divide:

```asm
        jsr rndbit          ; A = a one-bit mask from BITMASK
        ldy col
        ora (ptr),y         ; OR it in (don't clobber nearby stars)
        sta (ptr),y
```

`BITMASK` is just `$01,$02,$04,$08,$10,$20,$40` — the seven pixel positions in a byte. Using
`ora` means each star lights its own pixel without erasing its neighbours.

> **Note the 65C02 touch:** the star loop uses `phx`/`plx` to save the counter across the
> subroutine calls — instructions the original 6502 didn't have. The 3ric is a 65C02, so
> they're fair game.

## 3. Run it

Open <https://ebadger.github.io/3ric/?src=programs/tut8_hires.s>: three crisp white lines and
a sprinkling of stars, at a resolution lo-res can't touch. **Q** returns to text.

Because the row table and pixel math are the whole point, we verify the rulers landed at the
*exact* interleaved addresses the formula predicts:

```sh
node codegen/tools/run6502.mjs codegen/programs/tut8_hires.s \
    --expect-mem 0x2000=0x7F --expect-mem 0x2228=0x7F \
    --expect-mem 0x3FD0=0x7F --expect-halt idle
```

Row 0 → `$2000`, row 96 → `$2228`, row 191 → `$3FD0`. If `build_rows` were even one bit off,
these would miss.

## 4. Where to go next

You now have the whole toolkit: text and lo-res and hi-res video, input, the game loop,
motion, collision, randomness, score, and state machines. The best next step is to **read
finished games** and modify them. They all live in `emulator/AICodeGen/` and run in the same
browser emulator (open one from the editor's sample picker):

| Game | File | What it teaches |
| --- | --- | --- |
| **Star Swarm** | `swarm/swarm.s` | The hi-res Space Invaders this series builds toward — sprite blitting, a HUD, bombs, a saucer. The "full version" of Lesson 7. |
| **Rock Storm** | `rocks/rocks.s` | Asteroids-style vector drawing, rotation, thrust, and wrap-around motion. |
| **Jungle Quest** | `jungle/jungle.s` | A six-screen hi-res platformer: fixed-point gravity, buffered/coyote jumps, one-way platforms, descriptor-driven terrain, sprite restoration, and AABB collision. |
| **Brick Buster** | `bricks/bricks.s` | Breakout in text mode — a compact take on ball/paddle/brick collision. |
| **Paddles** | `paddles/paddles.s` | Two-player Pong; the simplest place to study game *rules* and scoring. |
| **Minefield** | `mines/mines.s` | Minesweeper — grids, flood fill, and mouse-free cursor UI. |
| **Life** | `life/life.s` | Conway's Game of Life: neighbour counting and double-buffering. |
| **2048** | `2048/2048.s` | Sliding-tile logic and merging in a 4×4 grid. |

And the two reference docs that describe the machine precisely:

- [`codegen/platform/platform-ref.md`](../../codegen/platform/platform-ref.md) — the memory
  map, soft switches, and ROM entry points.
- [`codegen/platform/prompt-system.md`](../../codegen/platform/prompt-system.md) — the
  assembler dialect and calling conventions.

## 5. Make it yours

1. **Twinkle.** In the `spin` loop, plot one fresh random star per frame with a small delay so
   the field slowly fills.
2. **A box, not lines.** Add left/right edges (bit `$01` in column 0, `$40` in column 39, down
   every row) to frame the screen.
3. **A moving dot.** Track a star's `col` and `bit`; each frame shift the bit left, and when it
   passes bit 6 reset it to bit 0 and `inc col`. You've handled the /7 boundary by hand.
4. **Port a lo-res lesson.** Re-draw Lesson 5's bouncing ball in hi-res using this `plot`
   approach — the game logic doesn't change, only the drawing.

## The end

That's the series: from `HELLO` to Space Invaders to hi-res. You've written eight real
programs and verified every one on the actual machine. Now open a shipped game, change a
number, and see what happens — that's how everyone learned. Have fun.
