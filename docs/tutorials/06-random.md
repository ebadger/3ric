# Lesson 6 — Randomness and scoring

> **You'll build:** a catch-the-food game with random targets and a live score.
> **New ideas:** mixed graphics+text mode; a pseudo-random number generator; collision by
> comparison; drawing a decimal number.
> **Program:** [`codegen/programs/tut6_catch.s`](../../codegen/programs/tut6_catch.s) ·
> **▶ Run it:** <https://ebadger.github.io/3ric/?src=programs/tut6_catch.s>

---

## 1. The idea

Two things separate a *toy* from a *game*: a goal that isn't the same every time (randomness)
and feedback that you're winning (a score). This lesson adds both.

We also want the score *visible*. The 3ric can show a **mixed** screen — lo-res graphics on
top with a **four-line text window** across the bottom — by touching one soft switch:

```asm
        lda TXTCLR          ; graphics on
        lda MIXSET          ; $C053 mixed: lo-res + 4 text rows at the bottom
        lda LORES
        lda LOWSCR
```

Now the top of the screen (lo-res rows 0–39) is our playfield and text rows 20–23 are a HUD.

## 2. The code

### Random numbers with an LFSR

There's no "random" instruction, so we make our own with a **linear-feedback shift register**
— shift the bits and, on certain shifts, flip a fixed pattern. It cycles through 255 values in
a scrambled order that *looks* random:

```asm
rng:    lda seed
        lsr a               ; shift right
        bcc rnods           ; if the bit that fell off was 1...
        eor #$B8            ; ...flip the "tap" bits
rnods:  sta seed
        rts
```

Seed it with any non-zero value and each call returns the next number. It's completely
deterministic (great for testing) but unpredictable enough for a game.

We need a coordinate in 0–39, but `rng` gives 0–255. **Rejection sampling** is the honest
way: mask to 0–63 and just re-roll anything too big.

```asm
randc:  jsr rng
        and #$3F            ; 0..63
        cmp #40
        bcs randc           ; >=40 -> throw it away, roll again
        rts
```

### Collision is just a comparison

Two 1-pixel objects collide when their coordinates match. After moving the player we check:

```asm
after:  lda hx
        cmp fx
        bne nocatch
        lda hy
        cmp fy
        bne nocatch
        inc score           ; hx==fx AND hy==fy -> caught!
        jsr drawhud
        jsr newfood
nocatch:
```

`newfood` rolls a fresh `fx,fy` and retries if it lands on the player, so the target never
appears under you.

### Drawing the score

Text cells want the **high bit set** for normal (bright) video, so we `ora #$80` on letters
and `ora #$B0` on digits (`$B0` is `'0'` with the high bit already on). To print the number we
split it into tens and ones by subtracting 10 until we can't:

```asm
dh3:    cmp #10
        bcc dh4
        sec
        sbc #10
        inx                 ; count the tens
        bra dh3
dh4:    ...                 ; A = ones digit, X = tens digit
```

We write the label and digits straight into text-row 20 at `$0650`.

## 3. Run it

Open <https://ebadger.github.io/3ric/?src=programs/tut6_catch.s>. Steer the white block with
**W/A/S/D** onto the yellow food; each catch bumps **SCORE** and drops new food. **Q** quits.

The RNG is seeded to a fixed value, so the *first* food always lands at (2, 1) — which makes
the game fully testable. We drive the player left 18 and up 19 to reach it and confirm the
score ticks to 1:

```sh
node verify_keys.cjs codegen/programs/tut6_catch.s 0x0800 \
    "AAAAAAAAAAAAAAAAAAWWWWWWWWWWWWWWWWWWW" 0x06=0x02 0x07=0x01 0x0A=0x01
```

The harness even shows `SCORE: 01` in the decoded text window — the HUD really is being drawn.

## 4. What just happened

You turned a mover into a *game*: a random goal, collision, and a score the player can see.
The LFSR is a workhorse you'll reuse for enemy placement, item drops, and screen effects. And
mixed mode — graphics plus a text HUD — is exactly how countless arcade and 8-bit games laid
out their screens.

## 5. Make it yours

1. **Countdown.** Add a second number to the HUD and decrement it every N moves; end the game
   at zero (jump to `quit`).
2. **Rotten food.** Occasionally (say when `rng` is even) make the food red and *subtract* a
   point if caught.
3. **Two foods.** Track `fx2,fy2` and draw both; catching either scores.
4. **Better randomness.** Re-seed `seed` from a fast-changing source — for example, read the
   keyboard-strobe or a counter that increments every loop — so the first food differs each run.

## Next

You now have every building block a small game needs: modes, drawing, input, motion,
collision, randomness, and score. In **[Lesson 7 — Space Invaders](07-invaders.md)** we put
them all together into the capstone: a formation of aliens, a cannon, a bullet, and win/lose
states.
