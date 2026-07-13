; ============================================================================
; Lesson 2 — DRAWING ON THE TEXT SCREEN     (tutorial: docs/tutorials/02-text-screen.md)
;
; The text screen is just memory at $0400. This program clears it, then draws a
; bordered box, a centered title, and a HUD line -- all by storing bytes into
; screen RAM directly (no COUT).
;
;   Try it:   https://ebadger.github.io/3ric/?src=programs/tut2_screen.s
;   Verify:   node codegen/tools/run6502.mjs codegen/programs/tut2_screen.s \
;                 --expect-mem 0400=A3 --expect-mem 050D=B3 --expect-halt idle
; ============================================================================

        .org $0800

; ---- zero-page pointers (2 bytes each) --------------------------------------
sptr    = $08               ; points at the base of a text row
strp    = $0A               ; points at a string to draw

; ---- ROM ---------------------------------------------------------------------
HOME    = $FC58             ; clear the text screen to spaces

; ---- screen character codes (normal video = high bit set) -------------------
BORDER  = $A3               ; '#'  ($23 | $80)

        jsr HOME

; --- top and bottom border rows (fill all 40 columns) ------------------------
        ldx #0
        jsr setrow
        jsr fillrow
        ldx #23
        jsr setrow
        jsr fillrow

; --- left and right border columns on the interior rows 1..22 ----------------
        ldx #1
sides:  jsr setrow
        lda #BORDER
        ldy #0
        sta (sptr),y        ; left edge, column 0
        ldy #39
        sta (sptr),y        ; right edge, column 39
        inx
        cpx #23
        bne sides

; --- centered title on row 2 -------------------------------------------------
        ldx #2
        jsr setrow
        lda #<title
        sta strp
        lda #>title
        sta strp+1
        lda #13             ; start column (centers the 14-char title)
        jsr puts

; --- HUD on row 21 -----------------------------------------------------------
        ldx #21
        jsr setrow
        lda #<hud
        sta strp
        lda #>hud
        sta strp+1
        lda #2
        jsr puts

spin:   bra spin            ; keep the picture on screen (a game never "returns")

; ============================================================================
; Helpers
; ============================================================================

; setrow: sptr = base address of text row X (0..23), read from the row tables.
; Rows are NOT stored back-to-back in memory, so we look the base up in a table.
setrow: lda ROWL,x
        sta sptr
        lda ROWH,x
        sta sptr+1
        rts

; fillrow: fill all 40 columns of the row at sptr with the border character.
fillrow: ldy #39
        lda #BORDER
fr:     sta (sptr),y
        dey
        bpl fr
        rts

; puts: draw the NUL-terminated string at strp onto row sptr, starting at the
;       column passed in A. Sets the high bit so the text shows in normal video.
puts:   clc
        adc sptr            ; slide the row pointer right to the start column
        sta sptr
        bcc pnc
        inc sptr+1
pnc:    ldy #0
pl:     lda (strp),y        ; next source character
        beq pdone           ; 0 marks the end of the string
        ora #$80            ; normal-video (high bit set)
        sta (sptr),y        ; store into screen memory
        iny
        bne pl
pdone:  rts

; ---- data -------------------------------------------------------------------
title:  .asciiz "3RIC ADVENTURE"
hud:    .asciiz "SCORE:000  LIVES:3"

; text-row base addresses (low bytes, then high bytes), rows 0..23
ROWL:   .byte $00,$80,$00,$80,$00,$80,$00,$80
        .byte $28,$A8,$28,$A8,$28,$A8,$28,$A8
        .byte $50,$D0,$50,$D0,$50,$D0,$50,$D0
ROWH:   .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07
