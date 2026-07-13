# Lesson 1 — Hello, 3ric

> **You'll build:** your first 65C02 program — it clears the screen and prints two lines.
> **New ideas:** the assemble-and-run loop, the CPU's registers, printing with a ROM
> routine, and a simple loop.
> **Program:** [`codegen/programs/tut1_hello.s`](../../codegen/programs/tut1_hello.s) ·
> **▶ Run it:** <https://ebadger.github.io/3ric/?src=programs/tut1_hello.s>

---

## 1. The idea

A 3ric program is just a list of bytes placed in memory that the CPU then executes, one
instruction at a time. To get *anything* on screen we need three things:

- **Registers** — the CPU's tiny built-in variables. We'll use **A** (the *accumulator* —
  where values pass through) and **X** (an *index/counter*). Each holds one byte, `0`–`255`.
- **A way to print** — the machine's ROM already contains a routine called **`COUT`** (at
  address `$FDED`) that takes whatever byte is in **A** and prints it as a character. We
  just hand it a letter and call it.
- **A loop** — to print a whole word we step through its letters one at a time, printing
  each, until we hit a marker that says "stop."

That's the entire program: *put a letter in A, call `COUT`, move to the next letter,
repeat.*

> **Hex, quickly.** Addresses and bytes are written in hexadecimal with a `$` prefix.
> `$FDED` is just a memory address; `$C8` is just the number 200. You never have to do hex
> math by hand — the assembler does it for you.

## 2. The code

Here's the whole program. Read the comments top to bottom — every instruction is
introduced the first time it appears.

```asm
        .org $0800          ; Load + run address. A .PRG starts executing here.

COUT    = $FDED             ; print the character in A to the screen (+ serial)
HOME    = $FC58             ; clear the text screen, cursor to the top-left

        jsr HOME            ; start on a clean screen

        ldx #0              ; X walks through the message, one byte at a time
print:  lda msg,x           ; A = the X-th byte of msg   (LDA addr,X = "indexed")
        beq done            ; a 0 byte marks the end of the text -> finished
        jsr COUT            ; print the character now in A
        inx                 ; advance to the next byte
        bne print           ; loop back (BNE is always taken until X would wrap)

done:   brk                 ; hand control back to the monitor: program finished

msg:
        .byte $C8,$C5,$CC,$CC,$CF,$AC,$A0      ; "HELLO, "
        .byte $B3,$D2,$C9,$C3                  ; "3RIC"
        .byte $8D                              ; new line
        .byte $CC,$C5,$D4,$A7,$D3,$A0          ; "LET'S "
        .byte $CD,$C1,$CB,$C5,$A0              ; "MAKE "
        .byte $C7,$C1,$CD,$C5,$D3,$AE          ; "GAMES."
        .byte $8D,$00                          ; new line, end marker
```

### Line by line

- **`.org $0800`** — a *directive* (an instruction to the assembler, not the CPU). It says
  "assemble this to run at address `$0800`." On the 3ric, a program is loaded at its `.org`
  and execution begins there, so **the load address is the entry point**. `$0800` is a
  convenient chunk of free RAM.
- **`COUT = $FDED`** / **`HOME = $FC58`** — *equates*: names for addresses so the code reads
  in English instead of hex. These two live in the ROM; their addresses come from the
  [platform reference](../../codegen/platform/platform-ref.md).
- **`jsr HOME`** — *Jump to SubRoutine*. It calls the ROM's screen-clear routine and comes
  back. `jsr` is how you call reusable code.
- **`ldx #0`** — *LoaD X* with the number `0`. The **`#`** means "the literal value 0"
  (this is *immediate* addressing). Without `#`, `ldx 0` would mean "load X from *memory
  address* 0" — a completely different thing. This is the most common beginner mix-up.
- **`print:`** — a *label*, a name for this spot in the code so we can branch back to it.
- **`lda msg,x`** — *LoaD A* from address `msg` **plus X**. When `X = 0` it reads the first
  byte of the message; when `X = 1`, the second; and so on. This `addr,X` form is *indexed*
  addressing — the workhorse of table and string handling.
- **`beq done`** — *Branch if EQual (to zero)*. `lda` sets the CPU's "zero" flag when the
  value it loaded was `0`, so this reads as "if we just loaded the `$00` end-marker, jump to
  `done`."
- **`jsr COUT`** — print the character currently in A.
- **`inx`** — *INcrement X* (add 1). Now `msg,x` points at the next letter.
- **`bne print`** — *Branch if Not Equal (to zero)*. `inx` leaves the zero flag clear for
  every value except when X rolls from 255 back to 0, so in practice this always loops back
  to `print`. The loop ends via the `beq done` above, not here.
- **`brk`** — stops the program and returns to the ROM **monitor**. It's the standard "I'm
  done" signal on the 3ric. (Don't use `rts` at the top level — there's no caller to return
  to.)

### Why the funny numbers?

`COUT` expects each character as **ASCII with the high bit set**. Normal ASCII `'H'` is
`$48`; setting the top bit gives `$48 + $80 = $C8`. So the message is spelled out in
high-bit bytes. `$8D` is a carriage return (`$0D | $80`) — it starts a new line. The
trailing **`$00`** is our own end-marker that `beq done` watches for.

You don't have to memorize the codes — later lessons let the assembler compute them for you
— but seeing them once makes the "high bit set" rule concrete.

## 3. Run it

**In the browser (easiest):** open
<https://ebadger.github.io/3ric/?src=programs/tut1_hello.s>. The page loads the source into
the **Assemble & Run** editor, assembles it in your browser with the very same assembler the
project uses, and runs it. You should see:

```
HELLO, 3RIC
LET'S MAKE GAMES.
```

Edit the text in the editor and press **Assemble & Run** again to see your change instantly.

**Headless (if you've cloned the repo):** the toolchain can run the program and *check* its
output, which is exactly how this lesson's code was verified:

```sh
node codegen/tools/run6502.mjs codegen/programs/tut1_hello.s \
    --expect-serial "HELLO, 3RIC" --expect-halt brk-monitor
```

`VERDICT: PASS` means the program halted cleanly and printed what we expected.

## 4. What just happened

After the two lines print, `brk` returns to the monitor, which prints a line like:

```
0812-    A=00 X=1E Y=00 P=32 S=EC
*
```

That's not your program — it's the **monitor** reporting the CPU's registers at the moment
you stopped, then showing its `*` prompt. Notice `X=1E` (that's 30 in decimal): X counted up
once per byte as the loop walked the whole 30-byte message. Seeing the registers "freeze" at
`brk` is a handy debugging habit we'll use again.

## 5. Make it yours

1. **Change the greeting.** Replace `"3RIC"` with your name. You'll need the high-bit codes:
   take normal ASCII and add `$80`, or just reuse the letters already in the message.
2. **Add a third line.** Insert another `$8D` and a few more letter bytes before the final
   `$00`.
3. **Print it twice.** Wrap the loop so it runs the whole message a second time. (Hint: keep
   a second counter, or reset `X` and jump back to `print` once.)
4. **Break it on purpose.** Delete the final `$00` and run it. What happens, and why? (Think
   about what `beq done` is now waiting for.)

## Next

You printed characters by *asking the ROM* to do it. In
**[Lesson 2 — Drawing on the text screen](02-text-screen.md)** you'll skip `COUT` and write
letters straight into screen memory yourself — the foundation of drawing anything, anywhere.
