; ============================================================================
; Lesson 3 — INPUT AND THE GAME LOOP     (tutorial: docs/tutorials/03-input.md)
;
; Read the keyboard and walk a hero '@' around a bordered box. This is the
; universal game loop: READ a key -> UPDATE the world -> DRAW it -> repeat.
;
;   Try it:   https://ebadger.github.io/3ric/?src=programs/tut3_move.s
;   Verify:   node codegen/tools/run6502.mjs codegen/programs/tut3_move.s \
;                 --expect-mem 0x063C=0xC0 --expect-halt idle
;   Controls: W/A/S/D (or arrow keys) move, Q quits.
; ============================================================================

        .org $0800

; ---- variables (zero page) --------------------------------------------------
hx      = $06               ; hero column (1..38)
hy      = $07               ; hero row    (1..22)
sptr    = $08               ; (2) screen row pointer
strp    = $0A               ; (2) string pointer

; ---- hardware / ROM ---------------------------------------------------------
KBD     = $C000             ; keyboard data; bit 7 = a key is ready
KBDSTRB = $C010             ; touch to clear the key-ready strobe
HOME    = $FC58

; ---- character codes (normal video) -----------------------------------------
HERO    = $C0               ; '@'
SPACE   = $A0
BORDER  = $A3               ; '#'

        jsr HOME
        jsr drawborder

        ; instructions, tucked into the top border row
        ldx #0
        jsr setrow
        lda #<hint
        sta strp
        lda #>hint
        sta strp+1
        lda #10
        jsr puts

        ; place the hero in the middle and draw it
        lda #20
        sta hx
        lda #12
        sta hy
        lda #HERO
        jsr putcell

; ---- THE GAME LOOP ----------------------------------------------------------
loop:   lda KBD             ; READ: is a key waiting?
        bpl loop            ;   bit 7 clear -> none yet, keep polling
        bit KBDSTRB         ;   clear the strobe so we'll see the next press
        and #$7F            ;   drop the ready bit -> plain ASCII

        cmp #'Q'            ; quit?
        beq quit

        pha                 ; remember the key
        lda #SPACE
        jsr putcell         ; erase the hero at its CURRENT cell
        pla

        ; UPDATE: pick a direction from the key (WASD or arrow codes)
        cmp #'W'
        beq up
        cmp #'S'
        beq down
        cmp #'A'
        beq left
        cmp #'D'
        beq right
        cmp #$0B            ; up-arrow
        beq up
        cmp #$0A            ; down-arrow
        beq down
        cmp #$08            ; left-arrow
        beq left
        cmp #$15            ; right-arrow
        beq right
        bra redraw          ; some other key: don't move

up:     lda hy
        cmp #2
        bcc redraw          ; already at the top interior row
        dec hy
        bra redraw
down:   lda hy
        cmp #22
        bcs redraw          ; already at the bottom interior row
        inc hy
        bra redraw
left:   lda hx
        cmp #2
        bcc redraw
        dec hx
        bra redraw
right:  lda hx
        cmp #38
        bcs redraw
        inc hx

redraw: lda #HERO           ; DRAW: stamp the hero at its new cell
        jsr putcell
        bra loop            ; ...and around we go

quit:   brk

; ============================================================================
; Helpers
; ============================================================================

; putcell: draw the character in A at (row = hy, column = hx).
putcell: ldy hx
        ldx hy
        pha
        lda ROWL,x
        sta sptr
        lda ROWH,x
        sta sptr+1
        pla
        sta (sptr),y
        rts

drawborder: ldx #0
        jsr setrow
        jsr fillrow
        ldx #23
        jsr setrow
        jsr fillrow
        ldx #1
db:     jsr setrow
        lda #BORDER
        ldy #0
        sta (sptr),y
        ldy #39
        sta (sptr),y
        inx
        cpx #23
        bne db
        rts

setrow: lda ROWL,x
        sta sptr
        lda ROWH,x
        sta sptr+1
        rts

fillrow: ldy #39
        lda #BORDER
fr:     sta (sptr),y
        dey
        bpl fr
        rts

puts:   clc
        adc sptr
        sta sptr
        bcc pnc
        inc sptr+1
pnc:    ldy #0
pl:     lda (strp),y
        beq pdone
        ora #$80
        sta (sptr),y
        iny
        bne pl
pdone:  rts

hint:   .asciiz " MOVE: WASD   QUIT: Q "

ROWL:   .byte $00,$80,$00,$80,$00,$80,$00,$80
        .byte $28,$A8,$28,$A8,$28,$A8,$28,$A8
        .byte $50,$D0,$50,$D0,$50,$D0,$50,$D0
ROWH:   .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07
