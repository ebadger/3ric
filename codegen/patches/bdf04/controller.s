; BDF04 copies this 30-byte block to $0284. Keep the zero-count sweep exit routed
; to the mapper; the title-music loop calls the flag-preserving helper at $028E.
        .org $0284
sweep_delay:
        beq mapper
        ; Only the upper half of the 1-26 sweep needs one extra count.
        cmp #$11
        bcc delay
        inc a
delay:
        jmp $03BF

music_delay:
        nop
        rts

mapper:
        ldx #$83
scan:
        lda $CE64,x
        beq next
        txa
        eor #$82
        inc a
        bne done
next:
        dex
        bmi scan
done:
        sta $0F
