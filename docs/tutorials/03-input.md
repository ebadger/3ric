# Lesson 3 — Input and the game loop

> **You'll build:** a hero `@` you walk around the box with the keyboard.
> **New ideas:** reading the keyboard at `$C000`/`$C010`; the read→update→draw loop;
> comparing keys and branching; erase-then-draw; keeping inside bounds.
> **Program:** [`codegen/programs/tut3_move.s`](../../codegen/programs/tut3_move.s) ·
> **▶ Run it:** <https://ebadger.github.io/3ric/?src=programs/tut3_move.s>

---

## 1. The idea

Every game, from Pong to Zelda, runs the same loop forever:

```
READ input  →  UPDATE the world  →  DRAW the result  →  (repeat)
```

Lesson 2's `spin: bra spin` was that loop with the middle scooped out. Now we fill it in.

**Reading the keyboard** is two memory locations:

- **`$C000`** holds the last key. Its **bit 7** is a "a key is ready" flag: `1` when a fresh
  key is waiting, `0` when you've already consumed it. The low 7 bits are the ASCII code.
- **`$C010`** is the *strobe clear*. Touching it (any read) lowers bit 7 so you can detect
  the **next** press instead of reading the same key over and over.

So "get a key" is: wait until bit 7 of `$C000` is set, clear the strobe, and strip bit 7 to
get plain ASCII.

## 2. The code

### The loop

```asm
loop:   lda KBD             ; READ: bit 7 set means a key is waiting
        bpl loop            ;   not yet -> poll again (BPL = "branch if bit 7 clear")
        bit KBDSTRB         ;   clear the strobe (ready for the next press)
        and #$7F            ;   drop bit 7 -> plain ASCII in A
```

`bpl` ("branch if plus") tests bit 7: while it's clear the key isn't ready, so we loop. Once
a key arrives we clear the strobe with `bit KBDSTRB` (any access to `$C010` does it) and mask
off the ready bit.

### Dispatch on the key

We compare the key against each control and branch to a handler. `cmp #'W'` subtracts `'W'`
from A just to set the flags; `beq up` takes the branch when they matched.

```asm
        cmp #'W'
        beq up
        cmp #'S'
        beq down
        cmp #'A'
        beq left
        cmp #'D'
        beq right
        ; ...arrow-key codes handled the same way...
        bra redraw          ; unrecognized key: don't move
```

### Update with bounds, then draw

Before moving, we make sure the hero stays inside the border. `cmp #2` / `bcc` reads as "if
`hy` is below 2, skip" — a compare-and-branch is how you do "if less than" on the 6502.

```asm
up:     lda hy
        cmp #2
        bcc redraw          ; hy < 2  ->  already at the top, don't move
        dec hy
        bra redraw
```

Each frame we **erase the hero at its old cell, then draw it at the new one** — otherwise it
would leave a trail:

```asm
        pha                 ; keep the key while we erase
        lda #SPACE
        jsr putcell         ; blank the old cell
        pla
        ; ...update hx/hy...
redraw: lda #HERO
        jsr putcell         ; stamp the hero at the new cell
        bra loop
```

### The drawing primitive

`putcell` is Lesson 2's idea boiled down to one routine: *put the character in A at
`(hy, hx)`.* It looks the row base up in the tables and stores through the `sptr` pointer.

```asm
putcell: ldy hx
        ldx hy
        pha
        lda ROWL,x          ; sptr = base of row hy
        sta sptr
        lda ROWH,x
        sta sptr+1
        pla
        sta (sptr),y        ; screen[row hy, column hx] = A
        rts
```

Only `hx`/`hy` change from frame to frame; `putcell` turns them into the right screen
address every time.

## 3. Run it

Open <https://ebadger.github.io/3ric/?src=programs/tut3_move.s> and drive the `@` with
**W/A/S/D** (arrow keys work too). It won't walk through the border. Press **Q** to quit
back to the monitor.

Because keypresses are interactive, this program is verified two ways. The starting frame is
checked headlessly:

```sh
node codegen/tools/run6502.mjs codegen/programs/tut3_move.s \
    --expect-mem 0x063C=0xC0 --expect-halt idle
```

`mem[$063C]==$C0` confirms the `@` starts at row 12, column 20. The *movement* is checked by
a script that types keys and asserts the hero's `(hx, hy)` afterward — typing `DDDDSSWW`
lands it at column 24, row 12, exactly where it should be.

## 4. What just happened

You built the skeleton every later lesson hangs things on:

- **poll** for input (`$C000` / `$C010`),
- **decide** what it means (`cmp` + branch),
- **change state** with bounds (`hx`, `hy`),
- **redraw** the changed cells,
- **loop**.

Notice we only redraw the two cells that changed (erase old, draw new) — never the whole
screen. That "touch only what moved" habit is what keeps 1 MHz games smooth.

## 5. Make it yours

1. **Diagonals.** Add handlers so `Q`/`E`/`Z`/`C` move two axes at once. (Careful: you're
   already using `Q` to quit — pick free keys.)
2. **Wrap around.** Instead of stopping at the border, make leaving the right edge reappear
   on the left (set `hx` to 1 instead of blocking at 38).
3. **Leave a trail.** Skip the erase step and watch the hero paint the screen. Add a key
   that clears it (`jsr HOME` then redraw the border).
4. **Speed vs. wait.** Right now the loop *blocks* until a key is pressed. In Lesson 5 the
   loop will run every frame whether or not a key is down — peek ahead and think about why a
   game needs that.

## Next

Text is great, but games want color. In
**[Lesson 4 — Color with lo-res graphics](04-lores.md)** we flip the machine into lo-res
mode and write a `PLOT` routine that lights up colored blocks.
