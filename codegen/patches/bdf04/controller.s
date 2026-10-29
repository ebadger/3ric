; BDF04 copies this routine to $0284. Keep its original direction codes:
; 1=left, 2=right, 3=up, 4=down.
        .org $0284
        phy
        ldx #$07
        ldy #$04
scan:
        lda $CEE0,x
        bne found
        dex
        dey
        bne scan
        beq done
found:
        txa
        and #$03
        eor #$02
        sta $0F
        inc $0F
        lda $0F
done:
        ply
        sta $0F
