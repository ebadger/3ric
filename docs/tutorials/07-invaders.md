# Lesson 7 — Space Invaders (capstone)

> **You'll build:** a playable lo-res Space Invaders — a marching fleet, a cannon, a bullet,
> collision, score, and win/lose screens.
> **New ideas:** a game *state machine*; storing a fleet as data (origin + per-alien flags);
> edge-detect-and-reverse movement; tying every earlier lesson together.
> **Program:** [`codegen/programs/tut7_invaders.s`](../../codegen/programs/tut7_invaders.s) ·
> **▶ Run it:** <https://ebadger.github.io/3ric/?src=programs/tut7_invaders.s>

---

## 1. The idea

This is the whole series in one program. Nothing here is *new* except how the pieces fit
together:

| From | We reuse |
| --- | --- |
| Lesson 3 | non-blocking keyboard input |
| Lesson 4 | `plot` + lo-res color |
| Lesson 5 | the game loop and per-frame motion |
| Lesson 6 | mixed mode, a text HUD, collision-by-compare |

The design work is **data layout** and a tiny **state machine** (playing → win/lose →
restart). Get those right and the code almost writes itself.

## 2. The design

### The fleet is data, not code

We never hard-code where the aliens are. We store a **formation origin** and let math place
each alien:

```asm
fleetx  = $0B   ; X of the left column
fleety  = $0C   ; Y of the top row
alive:  .byte 1,1,1,1,1   ; 5 columns x 3 rows, row-major
        .byte 1,1,1,1,1
        .byte 1,1,1,1,1
```

Alien `(row, col)` lives at `ax = fleetx + col*3`, `ay = fleety + row*3`, and it's on screen
only if `alive[row*5 + col]` is non-zero. To move the *entire* fleet we change **two bytes**
(`fleetx`, `fleety`); to kill one alien we clear **one byte**. That's the power of separating
data from drawing — three little helpers turn `(row,col)` into an index or a position:

```asm
alienidx: lda arow          ; index = arow*5 + acol
        asl a
        asl a
        clc
        adc arow
        clc
        adc acol
        tax
        lda alive,x
        rts
```

### Marching: step, and reverse at the edge

Every `FLEETPD` frames the fleet steps sideways. When the formation reaches a wall it drops
one row and reverses — the signature Space Invaders move:

```asm
        lda fleetx          ; heading right
        clc
        adc #13             ; right edge of the formation
        cmp #38
        bcc mf_right        ; room left -> just step right
        lda #$FF            ; at the wall -> reverse...
        sta fleetdir
        inc fleety          ; ...and drop a row
```

`FLEETPD` is the difficulty knob: smaller = faster fleet. Classic games shrink it as aliens
die; try that in the exercises.

### Firing and collision

The cannon fires **one** bullet at a time. `hitcheck` walks the fleet each frame. Aliens are
two pixels wide, so it matches the bullet against `ax` *or* `ax+1`. And because the bullet
climbs **two rows per frame**, it can jump clean over a row — so we accept `by` *or* `by+1`
too. Without that, an alien on an odd row (which is exactly what happens after the fleet
drops) could never be hit: the bullet's row stays even and steps right past it.

```asm
        jsr alienx          ; A = ax
        sta ptmp
        cmp bx
        beq hc_xok
        clc
        adc #1              ; ax+1  (aliens are 2 px wide)
        cmp bx
        bne hc_next
hc_xok: jsr alieny          ; A = ay
        cmp by              ; the bullet's row...
        beq hc_hit
        sec
        sbc #1              ; ...or the row it skipped (ay-1 == by)
        cmp by
        bne hc_next
hc_hit: ; hit! clear alive[i], stop the bullet, score++
```

### The state machine

A single byte `state` (0 = playing, 1 = win, 2 = lose) drives everything. The loop checks two
end conditions each frame:

```asm
        lda count           ; no aliens left -> win
        bne notwin
        jmp win
notwin: lda fleety          ; fleet reached the cannon -> lose
        clc
        adc #6
        cmp #38
        bcc draw
        jmp lose
```

`win` and `lose` paint a message into the HUD and wait for **R** (jump back to `restart`,
which re-fills `alive` and resets the counters) or **Q**. `restart` is just the setup code with
a label on it — reusing it for "new game" costs nothing.

## 3. Run it

Open <https://ebadger.github.io/3ric/?src=programs/tut7_invaders.s>. Move with **A/D**, fire
with **SPACE**, and clear the fleet before it lands. After a win or loss, press **R** to play
again or **Q** to quit.

Two headless checks pin down the core mechanics. First, the fresh-game state:

```sh
node codegen/tools/verify_keys.cjs codegen/programs/tut7_invaders.s 0x0800 "" \
    0x0E=0x0F 0x0F=0x00 0x07=0x00 0x06=0x14
```

`count == 15`, `score == 0`, `state == 0`, cannon centered. Then an aligned shot — slide the
cannon under the right column and fire:

```sh
node codegen/tools/verify_keys.cjs codegen/programs/tut7_invaders.s 0x0800 "AA ZZZZZZZZ" \
    0x06=0x12 0x0E=0x0E 0x0F=0x01 0x0A=0x00
```

The bullet climbs, an alien dies (`count` 15 → 14), `score` ticks to 1, and the bullet is
consumed (`bactive == 0`). The HUD even shows `SCORE: 01`.

## 4. What just happened

You shipped a game. More importantly, you used the pattern every game is built on: **state
lives in a few bytes, the loop reads input → updates state → draws, and "objects" are just
data your routines interpret.** A 15-alien fleet took two origin bytes and a 15-byte array.
Scale that idea up — more arrays, more state — and you have any game you can imagine.

## 5. Make it yours

1. **Ramp the difficulty.** Lower `FLEETPD` as `count` drops so the fleet speeds up — the
   trademark Space Invaders panic.
2. **Aliens shoot back.** Give the fleet its own bullet: pick a random live column (Lesson 6's
   RNG), drop a bullet from its bottom alien, and check it against the cannon.
3. **Lives and levels.** Add a `lives` byte to the HUD; on a win, `jmp restart` but keep the
   score to make a level 2.
4. **Bunkers.** Draw a few grey blocks above the cannon and let both bullets chip them away
   (clear a pixel on contact).

## Next

You've built a complete game in lo-res. In **[Lesson 8 — Hi-res and where to go
next](08-hires.md)** we peek at the 3ric's high-resolution mode, then map the shipped games
(`swarm`, `rocks`, `jungle`) so you can keep learning from real, finished code.
