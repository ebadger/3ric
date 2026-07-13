; ============================================================================
; Lesson 8 — HI-RES, AND WHERE TO GO NEXT   (tutorial: docs/tutorials/08-hires.md)
;
; A peek at the 3ric's 280x192 high-resolution mode: build the (famously weird)
; row-address table, draw three white rulers, and scatter a seeded starfield.
;
;   Try it:   https://ebadger.github.io/3ric/?src=programs/tut8_hires.s
;   Verify:   node codegen/tools/run6502.mjs codegen/programs/tut8_hires.s \
;                 --expect-mem 0x2000=0x7F --expect-mem 0x2228=0x7F \
;                 --expect-mem 0x3FD0=0x7F --expect-halt idle
;   Controls: Q quits.
; ============================================================================

        .org $0800

; ---- scratch (zero page) ----------------------------------------------------
ptr     = $06               ; (2) screen destination pointer
col     = $09
row     = $0A
seed    = $0B               ; RNG state (never 0)
tmpa    = $0C               ; build_rows scratch
tmpb    = $0D

; ---- big tables live in free RAM (not in the program image) -----------------
SCREEN  = $2000             ; hi-res page 1 ($2000-$3FFF)
ROWL    = $6000             ; 192 bytes: low  byte of each pixel row's address
ROWH    = $6100             ; 192 bytes: high byte of each pixel row's address

KBD     = $C000
KBDSTRB = $C010
TXTCLR  = $C050
TXTSET  = $C051
FULLSCR = $C052
LOWSCR  = $C054
HIRES   = $C057

        lda TXTCLR          ; graphics...
        lda FULLSCR         ; ...full screen...
        lda LOWSCR          ; ...page 1...
        lda HIRES           ; ...hi-res
        jsr build_rows      ; fill the 192-entry row-address table
        jsr clearhgr        ; blank the hi-res page

        lda #$5A            ; any non-zero RNG seed
        sta seed

        lda #0              ; three white rulers: top, middle, bottom
        jsr hline
        lda #96
        jsr hline
        lda #191
        jsr hline

        jsr starfield

spin:   lda KBD             ; rest here (detected as idle); Q returns to text
        bpl spin
        bit KBDSTRB
        and #$7F
        cmp #'Q'
        bne spin
        lda TXTSET
        brk

; ============================================================================
; hline — draw a full-width white line across pixel row A.
; Each hi-res byte holds 7 pixels; $7F lights all seven (bit 7 = palette).
; ============================================================================
hline:  tay
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        ldy #39
        lda #$7F
hl1:    sta (ptr),y
        dey
        bpl hl1
        rts

; ============================================================================
; starfield — scatter 96 seeded random dots. Choosing (row, col, bit) with the
; RNG means we never have to divide an X coordinate by 7.
; ============================================================================
starfield: ldx #96
sf1:    phx
        jsr rndrow
        sta row
        jsr rndcol
        sta col
        ldy row
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        jsr rndbit          ; A = a single-bit mask
        ldy col
        ora (ptr),y         ; OR it in so we don't erase neighbours
        sta (ptr),y
        plx
        dex
        bne sf1
        rts

rndrow: jsr rng             ; 0..191
        cmp #192
        bcs rndrow
        rts
rndcol: jsr rng             ; 0..39
        and #$3F
        cmp #40
        bcs rndcol
        rts
rndbit: jsr rng             ; a mask with one of bits 0..6 set
        and #7
        cmp #7
        beq rndbit
        tax
        lda BITMASK,x
        rts

; rng: 8-bit Galois LFSR (tap $B8)
rng:    lda seed
        lsr a
        bcc rn1
        eor #$B8
rn1:    sta seed
        rts

; ============================================================================
; build_rows — ROWL/ROWH[y] = address of pixel row y (y = 0..191).
; Hi-res rows are interleaved in memory; this reproduces the classic Apple-II
; formula so we never compute it again at draw time. (From the shipped swarm.s.)
; ============================================================================
build_rows: ldx #0
br_loop: txa
        and #7
        asl a
        asl a
        clc
        adc #$20
        sta tmpa            ; high base
        txa
        lsr a
        lsr a
        lsr a
        and #7
        sta tmpb
        lsr a
        clc
        adc tmpa
        sta ROWH,x
        lda #0
        sta tmpa
        lda tmpb
        and #1
        beq br_nolo
        lda #$80
        sta tmpa
br_nolo: txa
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        beq br_lowdone
        tay
br_add28: lda tmpa
        clc
        adc #$28
        sta tmpa
        dey
        bne br_add28
br_lowdone: lda tmpa
        sta ROWL,x
        inx
        cpx #192
        bne br_loop
        rts

; clearhgr — zero the whole hi-res page ($2000-$3FFF)
clearhgr: lda #>SCREEN
        sta ptr+1
        lda #0
        sta ptr
        ldx #$20            ; 32 pages
ch_pg:  ldy #0
        lda #0
ch_by:  sta (ptr),y
        iny
        bne ch_by
        inc ptr+1
        dex
        bne ch_pg
        rts

BITMASK: .byte $01,$02,$04,$08,$10,$20,$40
