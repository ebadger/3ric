# Lesson 2 — Drawing on the text screen

> **You'll build:** a titled, bordered "game screen" with a score/lives HUD — drawn by
> writing straight into screen memory.
> **New ideas:** the text screen *is* memory at `$0400`; rows are interleaved; zero-page
> pointers; indirect-indexed addressing; ending with a loop instead of `BRK`.
> **Program:** [`codegen/programs/tut2_screen.s`](../../codegen/programs/tut2_screen.s) ·
> **▶ Run it:** <https://ebadger.github.io/3ric/?src=programs/tut2_screen.s>

---

## 1. The idea

In Lesson 1 we asked the ROM to print for us. Games can't afford that — they draw thousands
of cells per second, anywhere on screen. So we write **directly to screen memory**.

The text screen lives at **`$0400`–`$07FF`**. Each byte is one of the 40×24 character
cells. Store a character code into one of those bytes and it appears instantly.

Two things you must know to place a character:

- **Normal video means the high bit is set.** Just like `COUT`, screen memory shows `'A'`
  as `$C1` (`$41 | $80`), not `$41`. (Codes `$00`–`$7F` show as inverse/flashing — a bonus
  at the end.)
- **Rows are not stored back-to-back.** Row 0 is the 40 bytes `$0400`–`$0427`. You'd expect
  row 1 at `$0428` — but it's actually at **`$0480`**. The rows are *interleaved* for
  hardware reasons. Rather than fight the formula, we keep a small **table** of each row's
  start address and look it up.

## 2. The code

The program clears the screen, draws the border, then stamps the title and HUD. The full
listing (including the 24-entry row tables) is in the source file; here are the important
pieces.

**A zero-page pointer to a row.** `setrow` copies a row's base address out of the tables
into `sptr` (two bytes in zero page). Once `sptr` holds an address, `sta (sptr),y` stores
into "the byte `Y` columns into that row" — this is **indirect-indexed** addressing, the
tool you'll use for almost all drawing.

```asm
sptr    = $08               ; a 2-byte pointer living in zero page

setrow: lda ROWL,x          ; X = row number (0..23); look up its base address
        sta sptr            ;   low byte
        lda ROWH,x
        sta sptr+1          ;   high byte
        rts
```

**Filling a row** walks the 40 columns with `Y` as the column index:

```asm
fillrow: ldy #39
        lda #BORDER         ; '#', already high-bit ($A3)
fr:     sta (sptr),y        ; screen[row base + Y] = '#'
        dey
        bpl fr              ; ...down to column 0 (BPL = "branch while >= 0")
        rts
```

**Drawing a string** (`puts`) slides `sptr` right to the start column, then copies bytes
until the `0` terminator, setting the high bit on each so the text is normal video:

```asm
puts:   clc
        adc sptr            ; sptr = row base + start column (passed in A)
        sta sptr
        bcc pnc
        inc sptr+1
pnc:    ldy #0
pl:     lda (strp),y        ; next character of the string
        beq pdone           ; 0 ends it
        ora #$80            ; force normal video
        sta (sptr),y        ; place it on screen
        iny
        bne pl
pdone:  rts
```

The strings themselves are readable text — `puts` adds the high bit, so we don't hand-encode
like we did in Lesson 1:

```asm
title:  .asciiz "3RIC ADVENTURE"     ; .asciiz = the bytes, then a 0 terminator
hud:    .asciiz "SCORE:000  LIVES:3"
```

### New instructions and ideas

- **`sta (sptr),y` (indirect-indexed).** Take the 16-bit address stored in the zero-page
  pair `sptr`/`sptr+1`, add `Y`, and store there. This is how you point at *any* address
  computed at run time. (In Lesson 1, `lda msg,x` used a *fixed* address `msg`; here the
  address is a variable.)
- **`<label` / `>label`.** The low and high byte of an address. `lda #<title` /
  `lda #>title` loads `title`'s address into a pointer.
- **`bpl` / `dey`.** `dey` counts `Y` down; `bpl` ("branch if plus") loops while `Y` is still
  0 or more, so the fill runs column 39 → 0.
- **The row tables** `ROWL`/`ROWH` are just 24 low bytes and 24 high bytes — the interleaved
  start address of every text row, looked up with `lda ROWL,x`.

### Why it ends with a loop, not `brk`

Lesson 1 finished with `brk`, which hands control back to the monitor — and the monitor
immediately prints its register dump *over your screen*. A program that draws something
wants the picture to **stay up**, so instead we spin in place:

```asm
spin:   bra spin            ; loop here forever; the drawing remains on screen
```

The headless runner reports this as `halt: idle` — a normal, clean stop. Every visual
program from here on ends this way, and in Lesson 3 that idle loop becomes the **game loop**.

## 3. Run it

Open <https://ebadger.github.io/3ric/?src=programs/tut2_screen.s>. You should see a boxed
screen with `3RIC ADVENTURE` centered near the top and `SCORE:000  LIVES:3` near the bottom.

To verify headlessly, assert a few screen bytes (note the `0x` prefixes):

```sh
node codegen/tools/run6502.mjs codegen/programs/tut2_screen.s \
    --expect-mem 0x0400=0xA3 --expect-mem 0x050D=0xB3 --expect-halt idle
```

`mem[$0400]==$A3` confirms the top-left border cell; `mem[$050D]==$B3` confirms the `'3'` of
the title landed at row 2, column 13.

## 4. What just happened

You computed addresses at run time and wrote characters into them — the whole basis of
drawing. `setrow` + `(sptr),y` is a *put-character-anywhere* primitive; `fillrow` and `puts`
are built on top of it. Everything visual in this series (even the lo-res blocks in Lesson 4)
is the same move: figure out the address of a cell, store a byte.

## 5. Make it yours

1. **Rename the game.** Change the `title` string. If it isn't 14 characters, adjust the
   start column (`lda #13`) so it stays centered: `col = (40 − length) / 2`.
2. **Move the HUD.** Draw it on a different row by changing the `ldx #21` before the HUD
   block. (Watch the row tables do the work.)
3. **Add a subtitle** on row 4 — a second string, a second `puts` call.
4. **Try inverse video.** Store a letter code *without* the high bit (e.g. `$01` for an
   inverse `A`, or `$20` for a solid inverse block) and see it flip to a black-on-white
   cell. Make an inverse title bar out of solid blocks.

## Next

The screen is drawn, but nothing moves. In
**[Lesson 3 — Input and the game loop](03-input.md)** we read the keyboard and turn that
`spin` loop into a real game loop that walks a hero around this box.
