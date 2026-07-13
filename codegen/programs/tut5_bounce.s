; ============================================================================
; Lesson 5 — MOTION AND COLLISION   (tutorial: docs/tutorials/05-motion.md)
;
; A ball moves on its OWN every frame and bounces off the four walls. No key is
; needed to make it go -- this is the first program with a real "game loop".
;
;   Try it:   https://ebadger.github.io/3ric/?src=programs/tut5_bounce.s
;   Verify:   node codegen/tools/verify_run.cjs codegen/programs/tut5_bounce.s 0x0800 2000000 ...
;   Controls: Q quits.
; ============================================================================

        .org $0800

; ---- ball state -------------------------------------------------------------
bx      = $06               ; ball X (0..39)
by      = $07               ; ball Y (0..47)
vx      = $08               ; X velocity: $01 (right) or $FF (left)
vy      = $09               ; Y velocity: $01 (down)  or $FF (up)
bcol    = $0A               ; ball colour

; ---- plot arguments + scratch (kept separate from ball state) ---------------
px      = $10
py      = $11
pcolor  = $12
ptmp    = $13
sptr    = $14               ; (2)

KBD     = $C000
KBDSTRB = $C010
TXTCLR  = $C050
TXTSET  = $C051
FULLSCR = $C052
LOWSCR  = $C054
LORES   = $C056

BLACK   = 0
WHITE   = 15

XMAX    = 39
YMAX    = 47

        lda TXTCLR
        lda FULLSCR
        lda LORES
        lda LOWSCR
        lda KBDSTRB
        jsr clrscreen

        lda #5              ; start near the top-left, heading down-right
        sta bx
        sta by
        lda #$01
        sta vx
        sta vy
        lda #WHITE
        sta bcol

loop:   lda KBD             ; non-blocking quit check
        bpl move
        bit KBDSTRB
        and #$7F
        cmp #'Q'
        beq quit

move:   jsr eraseball

; --- X axis: step, and reflect at the walls --------------------------------
        lda vx
        bmi xneg
        lda bx              ; moving right
        cmp #XMAX
        bcc xinc            ; not at the wall yet
        lda #$FF            ; hit right wall -> go left
        sta vx
        dec bx
        bra ymove
xinc:   inc bx
        bra ymove
xneg:   lda bx              ; moving left
        beq xflip           ; at left wall (0)
        dec bx
        bra ymove
xflip:  lda #$01
        sta vx
        inc bx

; --- Y axis: same idea, top and bottom -------------------------------------
ymove:  lda vy
        bmi yneg
        lda by              ; moving down
        cmp #YMAX
        bcc yinc
        lda #$FF            ; hit bottom -> go up
        sta vy
        dec by
        bra draw
yinc:   inc by
        bra draw
yneg:   lda by              ; moving up
        beq yflip           ; at top (0)
        dec by
        bra draw
yflip:  lda #$01
        sta vy
        inc by

draw:   jsr drawball
        jsr delay
        bra loop

quit:   lda TXTSET
        brk

; ---- draw / erase the ball via the plot argument registers ------------------
drawball: lda bx
        sta px
        lda by
        sta py
        lda bcol
        sta pcolor
        jmp plot
eraseball: lda bx
        sta px
        lda by
        sta py
        lda #BLACK
        sta pcolor
        jmp plot

; ---- PLOT: one lo-res pixel (px,py) in pcolor (see Lesson 4) -----------------
plot:   lda py
        lsr a
        tax
        lda ROWL,x
        sta sptr
        lda ROWH,x
        sta sptr+1
        ldy px
        lda py
        and #1
        bne plodd
        lda (sptr),y
        and #$F0
        ora pcolor
        sta (sptr),y
        rts
plodd:  lda pcolor
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

; ---- a short delay so the eye can follow the ball ---------------------------
delay:  ldx #$40
dl1:    ldy #$FF
dl2:    dey
        bne dl2
        dex
        bne dl1
        rts

clrscreen: lda #0
        ldx #0
cs:     sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne cs
        rts

ROWL:   .byte $00,$80,$00,$80,$00,$80,$00,$80
        .byte $28,$A8,$28,$A8,$28,$A8,$28,$A8
        .byte $50,$D0,$50,$D0,$50,$D0,$50,$D0
ROWH:   .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07
