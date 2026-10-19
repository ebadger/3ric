; M.U.L.E. for 3RIC - floating point for the game's Atari math-pack calls.
;
; The Atari version calls eleven entry points of the Atari OS floating-point
; ROM ($D800-$DFFF), which is not on the disk. This is an independent
; implementation of the same documented interface, written for this port:
; six-byte numbers, a sign bit and an excess-64 power-of-100 exponent in
; byte 0 and ten BCD digits in bytes 1-5,
; value = M0.M1M2M3M4 x 100^(exp-64), zero = all bytes 0.
;
;   FASC  $D8E6  FR0 -> ASCII at LBUFF, INBUFF -> LBUFF, last char bit 7 set
;   IFP   $D9AA  FR0 (16-bit integer) -> FR0
;   FPI   $D9D2  FR0 -> FR0 (16-bit integer, rounded); carry set if out of range
;   FSUB  $DA60  FR0 = FR0 - FR1      FADD $DA66  FR0 = FR0 + FR1
;   FMUL  $DADB  FR0 = FR0 * FR1      FDIV $DB28  FR0 = FR0 / FR1 (carry = /0)
;   FLD0R $DD89  FR0 = (Y:X)          FLD1R $DD98  FR1 = (Y:X)
;   FST0R $DDA7  (Y:X) = FR0          FMOVE $DDB6  FR1 = FR0
;
; Results are rounded to ten digits. Only FR0/FR1, FLPTR, INBUFF and LBUFF
; are touched in game memory; all scratch lives at FPW (prepended by the
; converter, 40 bytes). The stubs sit at the Atari addresses in language-card
; bank 2 and the code fills gaps between them and the unused part of the
; register file (FP_A ... FP_E); the
; converter checks that no chunk runs into a stub.

FP_A    = $DB2B               ; to $DD88
FP_B    = $DDB9               ; to $DFFE ($DFFF is the bank signature)
FP_C    = $D020               ; to $D1FF (register-file space the game never uses)
FP_D    = $D9D5               ; to $DA5F
FP_E    = $D8E9               ; to $D9A9

FR0     = $D4
FR1     = $E0
INBUFF  = $F3
FLPTR   = $FC
LBUFF   = $0580

FW      = FPW               ; 12-byte base-100 work register
FV      = FPW+12            ; 12-byte addend / remainder
FD      = FPW+24            ; 6-byte divisor (FPI: multiply scratch)
FSGN    = FPW+30
FEXL    = FPW+31            ; exponent byte value (excess 64) of FW[0], 16-bit
FEXH    = FPW+32
FCNT    = FPW+33
FT1     = FPW+34
FT2     = FPW+35
FT3     = FPW+36
FT4     = FPW+37
FDIG    = FPW+38

        .org $D8E6
        jmp fasc
        .org $D9AA
        jmp ifp
        .org $D9D2
        jmp fpi
        .org $DA60
        jmp fsub
        .org $DA66
        jmp fadd
        .org $DADB
        jmp fmul
        .org $DB28
        jmp fdiv
        .org $DD89
        jmp fld0r
        .org $DD98
        jmp fld1r
        .org $DDA7
        jmp fst0r
        .org $DDB6
        jmp fmove

        .org FP_B

fld0r:  stx FLPTR
        sty FLPTR+1
        ldy #5
fl0:    lda (FLPTR),y
        sta FR0,y
        dey
        bpl fl0
        clc
        rts
fld1r:  stx FLPTR
        sty FLPTR+1
        ldy #5
fl1:    lda (FLPTR),y
        sta FR1,y
        dey
        bpl fl1
        clc
        rts
fst0r:  stx FLPTR
        sty FLPTR+1
        ldy #5
fs0:    lda FR0,y
        sta (FLPTR),y
        dey
        bpl fs0
        clc
        rts
fmove:  ldx #5
fmv:    lda FR0,x
        sta FR1,x
        dex
        bpl fmv
        clc
        rts

fp_b1:
        .org FP_A

clr_wv: ldx #11
        lda #0
cwv:    sta FW,x
        sta FV,x
        dex
        bpl cwv
        rts

; ---- FW (sign FSGN, exponent FEXL/H of FW[0]) -> FR0, normalised, rounded
norm:   ldx #0
nm1:    lda FW,x
        bne nm2
        inx
        cpx #12
        bne nm1
zero0:  lda #0
        ldx #5
nz0:    sta FR0,x
        dex
        bpl nz0
        clc
        rts
nm2:    stx FT1
        sec
        lda FEXL
        sbc FT1
        sta FEXL
        lda FEXH
        sbc #0
        sta FEXH
        ldy #0
nm3:    cpx #12
        bcs nm3z
        lda FW,x
        bcc nm3s
nm3z:   lda #0
nm3s:   sta FR0+1,y
        inx
        iny
        cpy #5
        bne nm3
        lda #0
        cpx #12
        bcs nm4
        lda FW,x
nm4:    cmp #$50
        bcc nm5
        sed
        sec
        ldy #4
nm4a:   lda FR0+1,y
        adc #0
        sta FR0+1,y
        dey
        bpl nm4a
        cld
        bcc nm5
        lda #1
        sta FR0+1
        inc FEXL
        bne nm5
        inc FEXH
nm5:    lda FEXH
        bmi zero0
        bne fovf
        lda FEXL
        bmi fovf
        beq zero0
        ora FSGN
        sta FR0
        clc
        rts
fovf:   sec
        rts

; ---- FADD / FSUB
fsub:   lda FR1+1
        beq fadd
        lda FR1
        eor #$80
        sta FR1
fadd:   lda FR1+1
        bne fa1
        clc
        rts
fa1:    lda FR0+1
        bne fa2
        ldx #5
fa1c:   lda FR1,x
        sta FR0,x
        dex
        bpl fa1c
        clc
        rts
fa2:    lda FR0
        and #$7F
        sta FT1
        lda FR1
        and #$7F
        cmp FT1
        bcc fa3
        beq fa3
        ldx #5                  ; FR1 has the larger exponent: swap
fasw:   lda FR0,x
        ldy FR1,x
        sta FR1,x
        sty FR0,x
        dex
        bpl fasw
        lda FR0
        and #$7F
        sta FT1
fa3:    lda FR1
        and #$7F
        sta FT2
        sec
        lda FT1
        sbc FT2
        cmp #7
        bcc fa4
        clc                     ; FR1 is below the last digit
        rts
fa4:    sta FCNT
        jsr clr_wv
        ldx #4
fa5:    lda FR0+1,x
        sta FW+1,x
        dex
        bpl fa5
        ldy FCNT
        iny
        ldx #0
fa6:    lda FR1+1,x
        sta FV,y
        iny
        inx
        cpx #5
        bne fa6
        lda FT1
        clc
        adc #1
        sta FEXL
        lda #0
        sta FEXH
        lda FR0
        and #$80
        sta FSGN
        lda FR0
        eor FR1
        bmi fa_sub
        sed
        clc
        ldx #11
fa7:    lda FW,x
        adc FV,x
        sta FW,x
        dex
        bpl fa7
        cld
        jmp norm
fa_sub: sed
        sec
        ldx #11
fa8:    lda FW,x
        sbc FV,x
        sta FW,x
        dex
        bpl fa8
        cld
        bcs fa10
        sed                     ; |FR1| > |FR0|: negate, FR1's sign
        sec
        ldx #11
fa9:    lda #0
        sbc FW,x
        sta FW,x
        dex
        bpl fa9
        cld
        lda FSGN
        eor #$80
        sta FSGN
fa10:   jmp norm

; ---- FMUL
fzero:  jmp zero0
fmul:   lda FR0+1
        beq fzero
        lda FR1+1
        beq fzero
        lda FR0
        eor FR1
        and #$80
        sta FSGN
        lda FR0
        and #$7F
        sta FT1
        lda FR1
        and #$7F
        clc
        adc FT1
        sta FEXL
        lda #0
        adc #0
        sta FEXH
        sec                     ; exponent of FW[0] = e0 + e1 - 61
        lda FEXL
        sbc #61
        sta FEXL
        lda FEXH
        sbc #0
        sta FEXH
        jsr clr_wv
        ldx #0
fm1:    lda FR1+1,x
        lsr a
        lsr a
        lsr a
        lsr a
        jsr fm_dig
        lda FR1+1,x
        and #$0F
        jsr fm_dig
        inx
        cpx #5
        bne fm1
        jmp norm
fm_dig: sta FCNT                ; FW = FW*10 + FR0 mantissa * digit
        stx FT2
        jsr shl_fw
fm2:    lda FCNT
        beq fm4
        sed
        clc
        ldx #4
        ldy #11
fm3:    lda FW,y
        adc FR0+1,x
        sta FW,y
        dey
        dex
        bpl fm3
fm3c:   lda FW,y
        adc #0
        sta FW,y
        dey
        bpl fm3c
        cld
        dec FCNT
        jmp fm2
fm4:    ldx FT2
        rts

shl_fw: lda #4                  ; FW *= 10 (one BCD digit left)
        sta FT1
sf1:    clc
        ldx #11
sf2:    rol FW,x
        dex
        bpl sf2
        dec FT1
        bne sf1
        rts

fp_a_end:
        .org FP_C

; ---- FDIV: 22 quotient digits by long division
fdiv:   lda FR1+1
        bne fd1
        sec
        rts
fd1:    lda FR0+1
        bne fd2
        clc
        rts
fd2:    lda FR0
        eor FR1
        and #$80
        sta FSGN
        lda FR0
        and #$7F
        clc
        adc #69
        sta FEXL
        lda #0
        adc #0
        sta FEXH
        lda FR1
        and #$7F
        sta FT1
        sec
        lda FEXL
        sbc FT1
        sta FEXL
        lda FEXH
        sbc #0
        sta FEXH
        jsr clr_wv              ; FW = quotient, FV[0..5] = remainder
        lda #0
        sta FD
        ldx #4
fd3:    lda FR1+1,x
        sta FD+1,x
        dex
        bpl fd3
        lda #0
        sta FDIG                ; dividend digit index 0..21
fd4:    lda #4                  ; remainder *= 10
        sta FT1
fd5:    clc
        ldx #5
fd6:    rol FV,x
        dex
        bpl fd6
        dec FT1
        bne fd5
        lda FDIG                ; + next dividend digit (0 past the mantissa)
        cmp #10
        bcs fd8
        lsr a
        tax
        lda FR0+1,x
        bcs fd7
        lsr a
        lsr a
        lsr a
        lsr a
fd7:    and #$0F
        ora FV+5
        sta FV+5
fd8:    lda #0
        sta FCNT
fd9:    ldx #0                  ; while remainder >= divisor: subtract
fd10:   lda FV,x
        cmp FD,x
        bcc fd12
        bne fd11
        inx
        cpx #6
        bne fd10
fd11:   sed
        sec
        ldx #5
fd11a:  lda FV,x
        sbc FD,x
        sta FV,x
        dex
        bpl fd11a
        cld
        inc FCNT
        bne fd9
fd12:   jsr shl_fw              ; quotient = quotient*10 + digit
        lda FW+11
        ora FCNT
        sta FW+11
        inc FDIG
        lda FDIG
        cmp #22
        bne fd4
        jmp norm

fp_c_end:
        .org fp_b1

; ---- IFP: 16-bit integer in FR0/FR0+1
ifp:    lda FR0
        sta FT1
        lda FR0+1
        sta FT2
        jsr clr_wv
        sed
        ldy #16
if1:    asl FT1
        rol FT2
        lda FW+11
        adc FW+11
        sta FW+11
        lda FW+10
        adc FW+10
        sta FW+10
        lda FW+9
        adc FW+9
        sta FW+9
        dey
        bne if1
        cld
        lda #0
        sta FSGN
        sta FEXH
        lda #75
        sta FEXL
        jmp norm

fp_b2_end:
        .org FP_D

; ---- FPI: FR0 -> 16-bit integer, rounded
fpi:    lda FR0+1
        bne fp1
        sta FR0
        clc
        rts
fp1:    lda FR0
        bmi fperr
        sec
        sbc #64
        bmi fpfrac
        cmp #3
        bcs fperr
        sta FCNT                ; integer bytes - 1
        lda #0
        sta FT1
        sta FT2
        sta FT3
        ldx #0
fp2:    jsr mul100
        lda FR0+1,x
        jsr bcd2bin
        clc
        adc FT1
        sta FT1
        bcc fp3
        inc FT2
        bne fp3
        inc FT3
fp3:    cpx FCNT
        beq fp4
        inx
        bne fp2
fp4:    inx                     ; round on the next byte
        cpx #5
        bcs fp5
        lda FR0+1,x
        cmp #$50
        bcc fp5
        inc FT1
        bne fp5
        inc FT2
        bne fp5
        inc FT3
fp5:    lda FT3
        bne fperr
        lda FT1
        sta FR0
        lda FT2
        sta FR0+1
        clc
        rts
fpfrac: cmp #$FF                ; 0.01 <= x < 1 rounds to 0 or 1
        bne fp6
        lda FR0+1
        cmp #$50
        bcc fp6
        lda #1
        bne fp7
fp6:    lda #0
fp7:    sta FR0
        lda #0
        sta FR0+1
        clc
        rts
fperr:  sec
        rts

fp_d_end:
        .org FP_E

mul100: asl FT1                 ; FT1..3 *= 100 (= x64 + x32 + x4)
        rol FT2
        rol FT3
        asl FT1
        rol FT2
        rol FT3
        lda FT1                 ; FD..FD+2 = x4
        sta FD
        lda FT2
        sta FD+1
        lda FT3
        sta FD+2
        ldy #3
m1:     asl FT1                 ; x32
        rol FT2
        rol FT3
        dey
        bne m1
        lda FT1                 ; FD+3..5 = x32
        sta FD+3
        lda FT2
        sta FD+4
        lda FT3
        sta FD+5
        asl FT1                 ; x64
        rol FT2
        rol FT3
        clc
        lda FT1
        adc FD+3
        sta FT1
        lda FT2
        adc FD+4
        sta FT2
        lda FT3
        adc FD+5
        sta FT3
        clc
        lda FT1
        adc FD
        sta FT1
        lda FT2
        adc FD+1
        sta FT2
        lda FT3
        adc FD+2
        sta FT3
        rts

bcd2bin: pha
        and #$F0
        lsr a
        sta FT4
        lsr a
        lsr a
        clc
        adc FT4
        sta FT4
        pla
        and #$0F
        adc FT4
        rts

fp_e_end:
        .org fp_b2_end

; ---- FASC
fdigit: tya                     ; A = mantissa digit Y (0..9), Z set if 0
        lsr a
        tax
        lda FR0+1,x
        bcs fdg1
        lsr a
        lsr a
        lsr a
        lsr a
fdg1:   and #$0F
        rts
fput:   ldx FCNT                ; LBUFF[FCNT++] = A
        sta LBUFF,x
        inc FCNT
        rts

fasc:   lda #0
        sta FCNT
        lda FR0+1
        bne fc1
        lda #'0'
        jsr fput
        jmp fcend
fc1:    lda FR0
        bpl fc2
        lda #'-'
        jsr fput
fc2:    lda FR0
        and #$7F
        sec
        sbc #64
        sta FT1                 ; E
        bmi fcneg
        cmp #5
        bcs fcsci
        bcc fcfix
fcneg:  cmp #$FF
        bne fcsci
fcfix:  lda FT1                 ; integer digits = 2 + 2E
        asl a
        clc
        adc #2
        sta FT2
        lda #0
        sta FT3                 ; digits emitted
        ldy #0
fx1:    cpy FT2
        beq fx3
        jsr fdigit
        bne fx2
        ldx FT3
        beq fx2b
fx2:    ora #'0'
        jsr fput
        inc FT3
fx2b:   iny
        bne fx1
fx3:    ldy #9                  ; last non-zero fraction digit
fx4:    cpy FT2
        bcc fx5
        jsr fdigit
        bne fx6
        dey
        bpl fx4
fx5:    lda FT3                 ; nothing printed: "0"
        bne fxdone
        lda #'0'
        jsr fput
        jmp fcend
fx6:    sty FT4
        lda #'.'
        jsr fput
        ldy FT2
fx7:    jsr fdigit
        ora #'0'
        jsr fput
        cpy FT4
        beq fxdone
        iny
        bne fx7
fxdone: jmp fcend

fcsci:  ldy #0                  ; d.ddddE+xx
        lda FR0+1
        cmp #$10
        bcs fs1
        iny                     ; M0 < 10: first digit is its low nibble
fs1:    sty FT2
        lda FT1                 ; decimal exponent = 2E + 1 - first
        asl a
        sec
        adc #0
        sec
        sbc FT2
        sta FT3
        jsr fdigit
        ora #'0'
        jsr fput
        ldy #9
fs2:    cpy FT2
        beq fs4
        jsr fdigit
        bne fs3
        dey
        bpl fs2
fs3:    sty FT4
        lda #'.'
        jsr fput
        ldy FT2
fs3a:   iny
        jsr fdigit
        ora #'0'
        jsr fput
        cpy FT4
        bne fs3a
fs4:    lda #'E'
        jsr fput
        lda FT3
        bpl fs5
        eor #$FF
        clc
        adc #1
        sta FT3
        lda #'-'
        bne fs6
fs5:    lda #'+'
fs6:    jsr fput
        ldx #0
fs7:    lda FT3
        cmp #10
        bcc fs8
        sbc #10
        sta FT3
        inx
        bne fs7
fs8:    txa
        ora #'0'
        jsr fput
        lda FT3
        ora #'0'
        jsr fput

fcend:  ldx FCNT
        lda LBUFF-1,x
        ora #$80
        sta LBUFF-1,x
        lda #<LBUFF
        sta INBUFF
        lda #>LBUFF
        sta INBUFF+1
        clc
        rts
fp_end:
