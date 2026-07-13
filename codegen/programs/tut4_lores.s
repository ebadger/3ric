; ============================================================================
; Lesson 4 — COLOR WITH LO-RES GRAPHICS   (tutorial: docs/tutorials/04-lores.md)
;
; Switch the machine into 40x48 lo-res colour, draw a 16-colour palette, then
; steer a colour-cycling block around the screen with the keyboard.
;
;   Try it:   https://ebadger.github.io/3ric/?src=programs/tut4_lores.s
;   Verify:   node codegen/tools/run6502.mjs codegen/programs/tut4_lores.s \
;                 --expect-mem 0x050F=0x33 --expect-mem 0x063C=0x0F --expect-halt idle
;   Controls: W/A/S/D move, Q quits.
; ============================================================================

        .org $0800

; ---- plot arguments + scratch (zero page) -----------------------------------
px      = $06               ; plot X (0..39)
py      = $07               ; plot Y (0..47)
pcolor  = $08               ; plot colour (0..15)
ptmp    = $09               ; plot scratch
sptr    = $0A               ; (2) screen row pointer

; ---- player state -----------------------------------------------------------
plx     = $0C               ; player X
ply     = $0D               ; player Y
plcol   = $0E               ; player colour

; ---- soft switches (touch with LDA; any access selects) ---------------------
KBD     = $C000
KBDSTRB = $C010
TXTCLR  = $C050             ; graphics on (text off)
TXTSET  = $C051             ; text on
FULLSCR = $C052             ; full screen (no mixed text window)
LOWSCR  = $C054             ; display page 1
LORES   = $C056             ; lo-res graphics

; ---- a few lo-res colours (index 0..15 into the palette) --------------------
BLACK   = 0
WHITE   = 15

        lda TXTCLR          ; graphics...
        lda FULLSCR         ; ...full screen...
        lda LORES           ; ...lo-res...
        lda LOWSCR          ; ...page 1
        lda KBDSTRB         ; clear any stray key
        jsr clrscreen       ; paint the whole field black

; --- draw a 16-colour palette: cols 12..27, rows 4..7, colour = col-12 -------
        lda #4
        sta py
prow:   lda #12
        sta px
pcol:   lda px
        sec
        sbc #12
        sta pcolor          ; colour = px - 12  (0..15)
        jsr plot
        inc px
        lda px
        cmp #28
        bne pcol
        inc py
        lda py
        cmp #8
        bne prow

; --- place the player block and enter the loop -------------------------------
        lda #20
        sta plx
        lda #24
        sta ply
        lda #WHITE
        sta plcol
        jsr drawplayer

loop:   lda KBD
        bpl loop
        bit KBDSTRB
        and #$7F
        cmp #'Q'
        beq quit

        pha
        jsr eraseplayer     ; blank the old cell (plot BLACK)
        pla

        cmp #'W'
        beq up
        cmp #'S'
        beq down
        cmp #'A'
        beq left
        cmp #'D'
        beq right
        cmp #$0B
        beq up
        cmp #$0A
        beq down
        cmp #$08
        beq left
        cmp #$15
        beq right
        bra redraw

up:     lda ply
        beq redraw
        dec ply
        bra redraw
down:   lda ply
        cmp #47
        bcs redraw
        inc ply
        bra redraw
left:   lda plx
        beq redraw
        dec plx
        bra redraw
right:  lda plx
        cmp #39
        bcs redraw
        inc plx

redraw: inc plcol           ; cycle the colour, skipping black (0)
        lda plcol
        cmp #16
        bne rdok
        lda #1
        sta plcol
rdok:   jsr drawplayer
        bra loop

quit:   lda TXTSET          ; back to text so the monitor is readable
        brk

; ============================================================================
; PLOT — light one lo-res pixel (px, py) in colour pcolor.
;
; Lo-res shares the text page: each screen byte is TWO stacked pixels. The low
; nibble is the upper pixel (even Y), the high nibble the lower one (odd Y). So
; a lo-res row Y lives in text row Y/2, and we edit just one nibble.
; ============================================================================
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
        lda (sptr),y        ; even Y -> replace the LOW nibble
        and #$F0
        ora pcolor
        sta (sptr),y
        rts
plodd:  lda pcolor          ; odd Y -> replace the HIGH nibble (colour << 4)
        asl a
        asl a
        asl a
        asl a
        sta ptmp
        lda (sptr),y
        and #$0F
        ora ptmp
        sta (sptr),y
        rts

; draw / erase the player using the plot argument registers
drawplayer: lda plx
        sta px
        lda ply
        sta py
        lda plcol
        sta pcolor
        jmp plot
eraseplayer: lda plx
        sta px
        lda ply
        sta py
        lda #BLACK
        sta pcolor
        jmp plot

; clear the whole lo-res field ($0400-$07FF) to black
clrscreen: lda #0
        ldx #0
cs:     sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne cs
        rts

; text-row base addresses (low, then high), rows 0..23
ROWL:   .byte $00,$80,$00,$80,$00,$80,$00,$80
        .byte $28,$A8,$28,$A8,$28,$A8,$28,$A8
        .byte $50,$D0,$50,$D0,$50,$D0,$50,$D0
ROWH:   .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07
