; The Disk II loader places the packed program below $9000. This temporary
; NMOS-only loader expands lower RAM, shadows the installed ROM, then installs
; compatibility stubs below the retained $F800-$FFFF monitor and vectors.
        .org $0200
        sei
        cld
        ldx #$FF
        txs
        bit $C0E8
        lda #<PACKED_END
        sta $50
        lda #>PACKED_END
        sta $51
        lda #$FF
        sta $52
        lda #$BF
        sta $53
packet:
        jsr read_byte
        bmi repeat
        tax
        inx
literal:
        jsr read_byte
        jsr write_byte
        dex
        bne literal
        jmp next_packet
repeat:
        and #$7F
        clc
        adc #3
        tax
        jsr read_byte
        sta $54
repeat_byte:
        lda $54
        jsr write_byte
        dex
        bne repeat_byte
next_packet:
        lda $53
        cmp #9
        bcs packet
        ldx #0
        lda #0
clear_header:
        sta $0800,x
        inx
        bne clear_header
        lda #$4C
        sta $0800
        lda #<ENTRY
        sta $0801
        lda #>ENTRY
        sta $0802
        lda #<soft_reset
        sta $03F2
        lda #>soft_reset
        sta $03F3
        eor #$A5
        sta $03F4
        jmp install_language_card
read_byte:
        ldy #0
        lda ($50),y
        ldy $50
        bne read_low
        dec $51
read_low:
        dec $50
        ora #0
        rts
write_byte:
        ldy #0
        sta ($52),y
        ldy $52
        bne write_low
        dec $53
write_low:
        dec $52
        rts

install_language_card:
        bit $C083
        bit $C083
        lda #$55
        sta $D000
        cmp $D000
        bne missing_card
        asl
        sta $D000
        cmp $D000
        bne missing_card
        bit $C081
        bit $C081
        ldy #48
        ldx #0
copy_rom:
        lda $D000,x
        sta $D000,x
        inx
        bne copy_rom
        inc copy_rom+2
        inc copy_rom+5
        dey
        bne copy_rom
        lda $FFFC
        sta original_reset
        lda $FFFD
        sta original_reset+1
        lda $FFFE
        sta original_irq
        lda $FFFF
        sta original_irq+1
        bit $C083
        bit $C083
        lda #<reset_entry
        sta $FFFC
        lda #>reset_entry
        sta $FFFD
        lda #<IRQ_ENTRY
        sta $FFFE
        lda #>IRQ_ENTRY
        sta $FFFF
        ldy #STUB_PAGES
copy_stubs:
        lda $2000,x
        sta $D000,x
        inx
        bne copy_stubs
        inc copy_stubs+2
        inc copy_stubs+5
        dey
        bne copy_stubs
        jmp ENTRY

missing_card:
        bit $C082
        bit $C051
        bit $C054
        ldx #0
        lda #$A0
clear_error:
        sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne clear_error
write_error:
        lda error_text,x
        beq halted
        ora #$80
        sta $0400,x
        inx
        bne write_error
halted:
        jmp halted
error_text:
        .asciiz "64K LANGUAGE CARD REQUIRED"

        .res $03A0-*
soft_reset:
        jsr silence
        bit $C082
        jmp $FF69
silence:
        lda #$7F
        sta $C40E
        sta $C48E
        lda #0
        sta $C400
        sta $C480
        rts

        .res $03C0-*
irq_restore:
        jsr silence
        bit $C082
        lda $45
        jmp (original_irq)
original_irq:
        .word 0

        .res $03E0-*
reset_entry:
        bit $C082
        jmp (original_reset)
original_reset:
        .word 0
