; ============================================================================
; Lesson 6 — RANDOMNESS AND SCORING   (tutorial: docs/tutorials/06-random.md)
;
; Catch the food! Steer the white block onto the yellow food pixel; each catch
; scores a point and drops new food at a random spot. Uses MIXED mode: lo-res
; graphics up top with a 4-line TEXT window at the bottom for the score.
;
;   Try it:   https://ebadger.github.io/3ric/?src=programs/tut6_catch.s
;   Verify:   node verify_keys.cjs codegen/programs/tut6_catch.s 0x0800 "<keys>" ...
;   Controls: W/A/S/D move, Q quits.
; ============================================================================

        .org $0800

; ---- game state -------------------------------------------------------------
hx      = $06               ; player X (0..39)
hy      = $07               ; player Y (0..39, mixed mode)
fx      = $08               ; food X
fy      = $09               ; food Y
score   = $0A               ; 0..99
seed    = $0B               ; RNG state (never 0)
tmp     = $0C

; ---- plot arguments + scratch -----------------------------------------------
px      = $10
py      = $11
pcolor  = $12
ptmp    = $13
sptr    = $14               ; (2)

KBD     = $C000
KBDSTRB = $C010
TXTCLR  = $C050
TXTSET  = $C051
MIXSET  = $C053             ; mixed: lo-res + 4 text rows at the bottom
LOWSCR  = $C054
LORES   = $C056

BLACK   = 0
YELLOW  = 13
WHITE   = 15

PMAX    = 39                ; playfield is 40 wide and (mixed) 40 tall

        lda TXTCLR
        lda MIXSET
        lda LORES
        lda LOWSCR
        lda KBDSTRB
        jsr clrscreen

        lda #$A5            ; any non-zero RNG seed
        sta seed
        lda #0
        sta score
        jsr drawhud         ; "SCORE: 0" in the text window

        lda #20             ; player starts in the middle
        sta hx
        sta hy
        jsr newfood         ; first food
        jsr drawplayer

loop:   lda KBD
        bpl loop
        bit KBDSTRB
        and #$7F
        cmp #'Q'
        beq quit

        pha
        jsr eraseplayer
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
        bra after

up:     lda hy
        beq after
        dec hy
        bra after
down:   lda hy
        cmp #PMAX
        bcs after
        inc hy
        bra after
left:   lda hx
        beq after
        dec hx
        bra after
right:  lda hx
        cmp #PMAX
        bcs after
        inc hx

after:  lda hx              ; did we land on the food?
        cmp fx
        bne nocatch
        lda hy
        cmp fy
        bne nocatch
        inc score           ; caught it!
        jsr drawhud
        jsr newfood

nocatch: jsr drawfood       ; keep food lit (player may have sat on its cell)
        jsr drawplayer
        bra loop

quit:   lda TXTSET
        brk

; ---- place new random food, never on the player -----------------------------
newfood: jsr randc
        sta fx
        jsr randc
        sta fy
        lda fx
        cmp hx
        bne nfok
        lda fy
        cmp hy
        beq newfood         ; landed on player -> try again
nfok:   rts

; randc: a pseudo-random coordinate in 0..39 (rejection sampling)
randc:  jsr rng
        and #$3F            ; 0..63
        cmp #40
        bcs randc           ; >=40 -> reject and reroll
        rts

; rng: 8-bit Galois LFSR (tap $B8). Returns next value in A and seed.
rng:    lda seed
        lsr a
        bcc rnods
        eor #$B8
rnods:  sta seed
        rts

; ---- drawing helpers --------------------------------------------------------
drawplayer: lda hx
        sta px
        lda hy
        sta py
        lda #WHITE
        sta pcolor
        jmp plot
eraseplayer: lda hx
        sta px
        lda hy
        sta py
        lda #BLACK
        sta pcolor
        jmp plot
drawfood: lda fx
        sta px
        lda fy
        sta py
        lda #YELLOW
        sta pcolor
        jmp plot

; ---- HUD: "SCORE: NN" written into the bottom text window (row 20) ----------
drawhud: ldx #0
dh1:    lda label,x         ; copy the "SCORE: " label
        beq dh2
        ora #$80            ; normal video = high bit set
        sta $0650,x
        inx
        bra dh1
dh2:    lda score           ; split score into tens + ones
        ldx #0
dh3:    cmp #10
        bcc dh4
        sec
        sbc #10
        inx
        bra dh3
dh4:    sta tmp             ; A = ones, X = tens
        txa
        ora #$B0            ; '0' + tens, normal video
        sta $0657
        lda tmp
        ora #$B0
        sta $0658
        rts
label:  .asciiz "SCORE: "

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
