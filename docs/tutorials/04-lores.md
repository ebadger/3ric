# Lesson 4 — Color with lo-res graphics

> **You'll build:** a 16-color palette and a color-cycling block you steer around the screen.
> **New ideas:** soft switches to change video mode; the lo-res memory layout (two pixels per
> byte); a reusable `PLOT` routine; 16 colors.
> **Program:** [`codegen/programs/tut4_lores.s`](../../codegen/programs/tut4_lores.s) ·
> **▶ Run it:** <https://ebadger.github.io/3ric/?src=programs/tut4_lores.s>

---

## 1. The idea

So far we've been in text mode. The 3ric can also show **lo-res graphics**: a 40×48 grid of
chunky blocks in **16 colors**. Same screen memory (`$0400`), different interpretation.

**Switching modes** is done with *soft switches* — special addresses in the `$C05x` range.
You don't store a value; you just *touch* the address (any read) and the hardware flips. Four
touches put us in full-screen lo-res:

```asm
        lda TXTCLR          ; $C050 graphics on (text off)
        lda FULLSCR         ; $C052 full screen (no text window)
        lda LORES           ; $C056 lo-res
        lda LOWSCR          ; $C054 show page 1
```

**The lo-res memory layout** is the one thing to wrap your head around. Lo-res *reuses* the
text page, and each screen byte holds **two stacked pixels**:

- the **low nibble** (bottom 4 bits) is the **upper** pixel,
- the **high nibble** (top 4 bits) is the **lower** pixel.

Because two vertical pixels share one byte, a lo-res row `Y` lives in **text row `Y / 2`**.
To light one pixel we look up that text row, then change *just one nibble* of the byte —
leaving its neighbor alone. A nibble holds `0`–`15`: the color.

## 2. The code

### PLOT — the one routine that matters

```asm
plot:   lda py
        lsr a               ; text row = py / 2
        tax
        lda ROWL,x          ; sptr = base of that text row
        sta sptr
        lda ROWH,x
        sta sptr+1
        ldy px
        lda py
        and #1
        bne plodd
        lda (sptr),y        ; even Y -> keep high nibble, set LOW nibble
        and #$F0
        ora pcolor
        sta (sptr),y
        rts
plodd:  lda pcolor          ; odd Y -> keep low nibble, set HIGH nibble
        asl a               ; color << 4 moves it into the high nibble
        asl a
        asl a
        asl a
        sta ptmp
        lda (sptr),y
        and #$0F
        ora ptmp
        sta (sptr),y
        rts
```

The pattern is **read-modify-write**: load the byte, mask off the half we're changing (`and
#$F0` keeps the high nibble; `and #$0F` keeps the low), OR in the new color, store it back.
`lsr a` divides `py` by 2 to find the text row; `and #1` tells us which nibble.

With `plot` in hand, everything else is just *calling it in loops*.

### Drawing the palette

Sixteen colors, drawn as a 16-wide × 4-tall band, color equal to the column offset:

```asm
        lda #4
        sta py
prow:   lda #12
        sta px
pcol:   lda px
        sec
        sbc #12
        sta pcolor          ; color = px - 12  (0..15)
        jsr plot
        inc px
        lda px
        cmp #28
        bne pcol
        inc py
        lda py
        cmp #8
        bne prow
```

### The player, reusing Lesson 3's loop

The game loop is exactly Lesson 3's — poll the key, erase, move, redraw — but now "draw"
means `plot` a colored block, and every step cycles the color:

```asm
redraw: inc plcol           ; cycle the color, skipping black (0)
        lda plcol
        cmp #16
        bne rdok
        lda #1
        sta plcol
rdok:   jsr drawplayer
        bra loop
```

> **A subtle gotcha.** We clear the keyboard strobe with **`bit KBDSTRB`**, not `lda
> KBDSTRB`. Both touch `$C010`, but `lda` would overwrite the key we *just* read into `A`.
> `bit` clears the strobe while leaving `A` alone. (This one bites everybody once.)

`clrscreen` blanks the field by storing `0` across all four pages of `$0400`–`$07FF` — black
is color `0`, so zero-fill is a clear screen.

## 3. Run it

Open <https://ebadger.github.io/3ric/?src=programs/tut4_lores.s>. You'll see the palette
strip near the top and a white block in the middle. **W/A/S/D** moves it and it changes color
as it goes; **Q** returns to text and the monitor.

Headless verification checks two plotted bytes:

```sh
node codegen/tools/run6502.mjs codegen/programs/tut4_lores.s \
    --expect-mem 0x050F=0x33 --expect-mem 0x063C=0x0F --expect-halt idle
```

`mem[$050F]==$33` is a palette cell where both stacked pixels are color 3 (`$3` in each
nibble); `mem[$063C]==$0F` is the white (`$F`) player block. (In the harness's *text* decode
these bytes look like gibberish — that's just color data being shown as characters.)

## 4. What just happened

You changed the machine's video mode with a few memory touches, and you wrote the single
primitive — `plot(x, y, color)` — that every lo-res game is built from. Notice how little new
there is: the loop, the erase/redraw, the bounds checks all came straight from Lesson 3. Only
the *drawing* changed.

## 5. Make it yours

1. **Bigger player.** Draw the player as a 2×2 block (four `plot` calls at `x,y`, `x+1,y`,
   `x,y+1`, `x+1,y+1`). Remember to erase all four.
2. **Paint mode.** Remove the erase step and hold a direction to draw lines — an
   Etch-A-Sketch.
3. **Pick your color.** Instead of auto-cycling, map number keys `1`–`8` to set `plcol`
   directly.
4. **A framed arena.** Before the loop, `plot` a border of color 5 (grey) around the field,
   and add bounds so the player can't cross it (compare against 1 and 38 like Lesson 3).

## Next

The player only moves when you press a key. Real action games move things *every frame*. In
**[Lesson 5 — Motion and collision](05-motion.md)** we give a ball its own velocity and make
it bounce off the walls on its own.
