scan_pads:
        lda #$60
        sta $C20E
        sta $C20D
        stz $C200
        lda #$40
        sta $C200
        ldx #0
scan_bit:
        lda #0
        sta $C200
        sta $CEE0,x
        sta $CEF0,x
        lda $C200
        and #$20
        bne pad1_up
        inc $CEE0,x
pad1_up:
        lda $C200
        and #$10
        bne pad2_up
        inc $CEF0,x
pad2_up:
        lda #$80
        sta $C200
        inx
        cpx #16
        bne scan_bit
        stz $C200
        lda $CEE0
        ora $CEE9
        lsr
        ror
        sta $C061
        lda $CEF0
        ora $CEF9
        lsr
        ror
        sta $C062
        rts

axis:
        lda $CEE0,y
        cmp $CEE1,y
        beq axis_center
        lda $CEE0,y
        bne axis_low
        lda #31
        rts
axis_center:
        lda #16
        rts
axis_low:
        lda #0
        rts
