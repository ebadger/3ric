# Lesson 5 — Motion and collision

> **You'll build:** a ball that moves by itself and bounces off all four walls.
> **New ideas:** the *game loop*; velocity; reflecting off boundaries; a delay for timing.
> **Program:** [`codegen/programs/tut5_bounce.s`](../../codegen/programs/tut5_bounce.s) ·
> **▶ Run it:** <https://ebadger.github.io/3ric/?src=programs/tut5_bounce.s>

---

## 1. The idea

Every game up to now moved something *only when you pressed a key*. Action games are
different: things move **on their own, every frame**. That "do a little bit, over and over,
forever" heartbeat is the **game loop**.

To move on its own, the ball needs a **velocity** as well as a position. We store four bytes:

```asm
bx = $06   ; position X, Y
by = $07
vx = $08   ; velocity X: $01 = right, $FF = left
vy = $09   ; velocity Y: $01 = down,  $FF = up
```

We use `$01` and `$FF` for the velocities because on the 6502 adding `$FF` is the same as
subtracting 1 (it wraps). So "move" is just `pos = pos + vel` — one add handles both
directions. The trick is stopping the ball from wrapping *past* a wall, which is where
**collision** comes in.

## 2. The code

### The loop skeleton

```asm
loop:   lda KBD             ; non-blocking quit check (don't wait!)
        bpl move
        bit KBDSTRB
        and #$7F
        cmp #'Q'
        beq quit

move:   jsr eraseball       ; 1. rub out the old ball
        ;   ... update X, then Y (below) ...
draw:   jsr drawball        ; 2. draw it at the new spot
        jsr delay           ; 3. pause so the eye can follow
        bra loop            ; 4. forever
```

Notice the key check uses `bpl move` and falls straight through — it **never waits**. If no
key is down we just keep animating. That's the difference between an *event* loop (Lesson 3)
and a *game* loop.

### Bouncing off a wall

For each axis: if we're heading toward a wall and already at it, flip the velocity and step
*away*; otherwise step normally. Here's X:

```asm
        lda vx
        bmi xneg            ; heading left?
        lda bx              ; heading right:
        cmp #XMAX
        bcc xinc            ;   not at the wall -> just move
        lda #$FF            ;   at right wall -> reverse
        sta vx
        dec bx
        bra ymove
xinc:   inc bx
        bra ymove
xneg:   lda bx              ; heading left:
        beq xflip           ;   at left wall (0) -> reverse
        dec bx
        bra ymove
xflip:  lda #$01
        sta vx
        inc bx
```

The Y axis is the identical shape with `YMAX` (47) instead of `XMAX` (39). Reflecting a ball
is exactly this: when it reaches an edge, negate the velocity on that axis. Horizontal and
vertical bounces are independent, which is why a corner hit reverses *both*.

### Timing

Computers are fast — without a pause the ball would blur across the screen in an instant.
`delay` just burns time in a nested countdown:

```asm
delay:  ldx #$40
dl1:    ldy #$FF
dl2:    dey
        bne dl2
        dex
        bne dl1
        rts
```

Change `#$40` to make the ball slower or faster. This is a crude timer; later you'd sync to
the video frame, but a delay loop is perfect for learning.

## 3. Run it

Open <https://ebadger.github.io/3ric/?src=programs/tut5_bounce.s>. A white dot sails from the
top-left, bounces around the box, and keeps going until you press **Q**.

Because the ball never stops on its own, we verify it with a **fixed cycle budget** instead of
waiting for a halt (that's what `verify_run.cjs` does — run exactly *N* cycles, then look):

```sh
node codegen/tools/verify_run.cjs codegen/programs/tut5_bounce.s 0x0800 2000000 \
    0x06=0x0C 0x07=0x1C 0x08=0xFF 0x09=0xFF
```

After 2,000,000 cycles the ball has bounced off the **right** wall (`vx` is now `$FF` =
left) and the **bottom** (`vy` is now `$FF` = up), sitting at (12, 28) heading up-left.
Checking the velocity bytes flipped is a neat way to prove the collision code actually fired.

## 4. What just happened

You wrote your first real game loop: erase → update → draw → delay → repeat. You gave an
object a velocity and made it obey the walls. Every arcade game — Pong, Breakout, Asteroids —
is this same loop with more objects and smarter rules.

## 5. Make it yours

1. **Speed and angle.** Start `vx`/`vy` at different times, or change the delay, to feel how
   timing changes the game.
2. **Leave a trail.** Delete the `jsr eraseball` call and watch the ball paint the whole
   screen like a bouncing-lines screensaver.
3. **A paddle.** Bring back Lesson 3's input to move a 1-pixel-wide paddle along the bottom
   row with A/D, and make the ball reverse `vy` only when it hits the paddle's column —
   you've started Breakout.
4. **Two balls.** Add `bx2/by2/vx2/vy2` and a second draw/update. How little code does a
   second ball actually take?

## Next

A ball that bounces forever is hypnotic but it's not a *game* yet — nothing is random and
there's no score. In **[Lesson 6 — Randomness and scoring](06-random.md)** we add a random
target to catch and an on-screen score, mixing lo-res graphics with a text HUD.
