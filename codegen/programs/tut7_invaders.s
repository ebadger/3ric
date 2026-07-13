; ============================================================================
; Lesson 7 — SPACE INVADERS (capstone)   (tutorial: docs/tutorials/07-invaders.md)
;
; The whole series in one program: a marching alien fleet, a cannon you drive,
; a bullet, collision, score, and win/lose states. Lo-res + a text HUD.
;
;   Try it:   https://ebadger.github.io/3ric/?src=programs/tut7_invaders.s
;   Controls: A/D move, SPACE fire, R restart (after win/lose), Q quit.
;
; Fleet layout: 5 columns x 3 rows = 15 aliens, each 2 lo-res pixels wide.
; ============================================================================

        .org $0800

; ---- game state (zero page) -------------------------------------------------
cannonx = $06              ; cannon X (0..39)
state   = $07              ; 0 = playing, 1 = win, 2 = lose
bx      = $08              ; bullet X
by      = $09              ; bullet Y
bactive = $0A              ; bullet on screen? (0/1)
fleetx  = $0B              ; X of column 0
fleety  = $0C              ; Y of row 0
fleetdir = $0D             ; $01 = right, $FF = left
count   = $0E              ; aliens still alive
score   = $0F
tick    = $10              ; frame counter for fleet cadence
arow    = $11              ; loop scratch (alien row)
acol    = $12              ; loop scratch (alien col)

; ---- plot arguments + scratch -----------------------------------------------
px      = $14
py      = $15
pcolor  = $16
ptmp    = $17
sptr    = $18              ; (2)
msgptr  = $1A             ; (2) message pointer for win/lose text

KBD     = $C000
KBDSTRB = $C010
TXTCLR  = $C050
TXTSET  = $C051
MIXSET  = $C053
LOWSCR  = $C054
LORES   = $C056

BLACK   = 0
GREEN   = 12
YELLOW  = 13
WHITE   = 15

CANNONY = 39               ; bottom lo-res row (mixed mode)
FLEETPD = 64               ; frames between fleet steps (bigger = slower)

        lda TXTCLR
        lda MIXSET
        lda LORES
        lda LOWSCR
        lda KBDSTRB

; ---- (re)start a fresh game -------------------------------------------------
restart: ldx #14           ; all 15 aliens alive
rs1:    lda #1
        sta alive,x
        dex
        bpl rs1
        lda #15
        sta count
        lda #0
        sta score
        sta bactive
        sta tick
        sta state
        lda #6
        sta fleetx
        lda #2
        sta fleety
        lda #1
        sta fleetdir
        lda #20
        sta cannonx

; ---- main game loop ---------------------------------------------------------
play:   jsr input
        jsr movebullet
        jsr movefleet
        jsr hitcheck

        lda count           ; all dead -> win
        bne notwin
        jmp win
notwin: lda fleety          ; fleet reached the cannon -> lose
        clc
        adc #6
        cmp #38
        bcc draw
        jmp lose

draw:   jsr clrscreen
        jsr drawaliens
        jsr drawcannon
        jsr drawbullet
        jsr drawhud
        jsr delay
        jmp play

quit:   lda TXTSET
        brk

; ============================================================================
; INPUT — non-blocking. A/D move, SPACE fire, Q quit, R restart.
; ============================================================================
input:  lda KBD
        bpl in_done
        bit KBDSTRB
        and #$7F
        cmp #'Q'
        beq in_quit
        cmp #'A'
        beq in_left
        cmp #$08
        beq in_left
        cmp #'D'
        beq in_right
        cmp #$15
        beq in_right
        cmp #' '
        beq in_fire
        bra in_done
in_left: lda cannonx
        beq in_done
        dec cannonx
        rts
in_right: lda cannonx
        cmp #39
        bcs in_done
        inc cannonx
        rts
in_fire: lda bactive         ; only one bullet at a time
        bne in_done
        lda #1
        sta bactive
        lda cannonx
        sta bx
        lda #38
        sta by
in_done: rts
in_quit: jmp quit

; ============================================================================
; MOVEBULLET — travel up 2 rows/frame; drop it when it leaves the top.
; ============================================================================
movebullet: lda bactive
        beq mb_done
        lda by
        sec
        sbc #2
        bcs mb_ok
        lda #0              ; underflowed past the top edge
        sta bactive
        rts
mb_ok:  sta by
mb_done: rts

; ============================================================================
; MOVEFLEET — every FLEETPD frames step sideways; at an edge, drop and reverse.
; ============================================================================
movefleet: inc tick
        lda tick
        cmp #FLEETPD
        bcs mf_go
        rts
mf_go:  lda #0
        sta tick
        lda fleetdir
        bmi mf_left
        lda fleetx          ; heading right
        clc
        adc #13             ; right edge of the formation
        cmp #38
        bcc mf_right
        lda #$FF            ; hit right -> drop, go left
        sta fleetdir
        inc fleety
        rts
mf_right: inc fleetx
        rts
mf_left: lda fleetx          ; heading left
        beq mf_rev
        dec fleetx
        rts
mf_rev: lda #$01            ; hit left -> drop, go right
        sta fleetdir
        inc fleety
        rts

; ============================================================================
; HITCHECK — if the bullet overlaps any live alien, kill it and score.
; Aliens are 2 px wide, so the bullet matches ax OR ax+1. The bullet also climbs
; 2 rows/frame, so it can jump clean over a row: we match by OR by+1 as well, or
; an alien on an odd row (which happens after the fleet drops) could never be hit.
; ============================================================================
hitcheck: lda bactive
        beq hc_done
        lda #0
        sta arow
hc_r:   lda #0
        sta acol
hc_c:   jsr alienidx        ; X = row*5+col, A = alive[X]
        beq hc_next
        jsr alienx          ; A = ax
        sta ptmp            ; reuse ptmp as ax
        cmp bx
        beq hc_xok
        clc
        adc #1              ; ax+1 (2 px wide)
        cmp bx
        bne hc_next
hc_xok: jsr alieny          ; A = ay
        cmp by              ; ay == the bullet's row?
        beq hc_hit
        sec
        sbc #1              ; bullet climbs 2 rows/frame, so it can skip a row:
        cmp by              ; also count the row it jumped over (ay-1 == by)
        bne hc_next
hc_hit: jsr alienidx        ; X = this alien's index
        lda #0
        sta alive,x         ; kill it
        sta bactive
        dec count
        inc score
        rts
hc_next: inc acol
        lda acol
        cmp #5
        bne hc_c
        inc arow
        lda arow
        cmp #3
        bne hc_r
hc_done: rts

; helpers: compute index / positions from arow,acol -> return in A (X for idx)
alienidx: lda arow          ; index = arow*5 + acol
        asl a
        asl a
        clc
        adc arow
        clc
        adc acol
        tax
        lda alive,x
        rts
alienx: lda acol            ; ax = fleetx + acol*3
        asl a
        clc
        adc acol
        clc
        adc fleetx
        rts
alieny: lda arow            ; ay = fleety + arow*3
        asl a
        clc
        adc arow
        clc
        adc fleety
        rts

; ============================================================================
; DRAWING
; ============================================================================
drawaliens: lda #0
        sta arow
da_r:   lda #0
        sta acol
da_c:   jsr alienidx
        beq da_next
        jsr alienx
        sta px              ; left pixel
        jsr alieny
        sta py
        lda #GREEN
        sta pcolor
        jsr plot
        inc px              ; right pixel (2 px wide)
        jsr plot
da_next: inc acol
        lda acol
        cmp #5
        bne da_c
        inc arow
        lda arow
        cmp #3
        bne da_r
        rts

drawcannon: lda cannonx
        sta px
        lda #CANNONY
        sta py
        lda #WHITE
        sta pcolor
        jmp plot

drawbullet: lda bactive
        beq db_done
        lda bx
        sta px
        lda by
        sta py
        lda #YELLOW
        sta pcolor
        jmp plot
db_done: rts

; HUD: "SCORE: NN" in the text window (text row 20 = $0650)
drawhud: ldx #0
dh1:    lda hudlbl,x
        beq dh2
        ora #$80
        sta $0650,x
        inx
        bra dh1
dh2:    lda score
        ldx #0
dh3:    cmp #10
        bcc dh4
        sec
        sbc #10
        inx
        bra dh3
dh4:    sta ptmp
        txa
        ora #$B0
        sta $0657
        lda ptmp
        ora #$B0
        sta $0658
        rts

; ============================================================================
; WIN / LOSE — show a message, then wait for R (restart) or Q (quit).
; ============================================================================
win:    lda #1
        sta state
        ldx #<wintxt
        ldy #>wintxt
        jmp endmsg
lose:   lda #2
        sta state
        ldx #<losetxt
        ldy #>losetxt
        jmp endmsg

; endmsg: message pointer in X(lo)/Y(hi); paint it and wait for R/Q.
endmsg: stx msgptr
        sty msgptr+1
        jsr clrscreen
        jsr drawaliens
        ldy #0
em1:    lda (msgptr),y
        beq em2
        ora #$80
        sta $0650,y
        iny
        bra em1
em2:    jsr drawhud
ew1:    lda KBD
        bpl ew1
        bit KBDSTRB
        and #$7F
        cmp #'R'
        beq ew_r
        cmp #'Q'
        beq ew_q
        bra ew1
ew_r:   jmp restart
ew_q:   jmp quit

; ============================================================================
; PLOT — one lo-res pixel (px,py) in pcolor (see Lesson 4)
; ============================================================================
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

delay:  ldx #$20
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

hudlbl: .asciiz "SCORE: "
wintxt: .asciiz "YOU WIN!  R=PLAY AGAIN"
losetxt: .asciiz "INVADED!  R=PLAY AGAIN"

; per-alien alive flags (row-major, 5 cols x 3 rows); mutated at runtime
alive:  .byte 1,1,1,1,1
        .byte 1,1,1,1,1
        .byte 1,1,1,1,1

ROWL:   .byte $00,$80,$00,$80,$00,$80,$00,$80
        .byte $28,$A8,$28,$A8,$28,$A8,$28,$A8
        .byte $50,$D0,$50,$D0,$50,$D0,$50,$D0
ROWH:   .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07
