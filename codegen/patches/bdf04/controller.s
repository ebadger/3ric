; BDF04 copies this 30-byte block to $0284. The speaker loop calls the first
; routine; after its last delay, A=0 falls through to the D-pad mapper.
        .org $0284
sweep_delay:
        beq mapper
        ; The final LSR carry rounds X/4 up before ADC adds the saved X.
        sta $D2
        inc a
        lsr a
        lsr a
        adc $D2
        jmp $03BF

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
