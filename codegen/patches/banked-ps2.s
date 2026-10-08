; Shared receiver for the checked 3ric ROM. The caller supplies state_pending.
        .org $CF00
nmi_entry:
        pha
nmi_dispatch:
        lda $C20D
        lsr
        bcs ps2_edge
        and #$08
        beq nmi_rom
        lda $C000
        and #$7F
        sta $C000
        lda #$10
        bra nmi_ack
ps2_edge:
        lda $CE00
        beq ps2_start
        dec
        beq ps2_data
        dec
        bne nmi_rom
        inc $CE00
        lda $CE01
        cmp #$12
        beq ps2_modifier
        cmp #$59
        beq ps2_modifier
        cmp #$14
        bne ps2_done
ps2_modifier:
        sta $CE19
        bra ps2_done
ps2_data:
        lda $C20F             ; sample DATA without acknowledging another VIA source
        asl
        ror $CE01
        bcc ps2_done
        bra ps2_advance
ps2_start:
        lda #$80
        sta $CE01
ps2_advance:
        inc $CE00
ps2_done:
        lda #1
nmi_ack:
        sta $C20D
        lda $C20D
        bmi nmi_dispatch
nmi_return:
        pla
        rti
nmi_rom:
        phy
        phx
        tsx
        lda $0105,x
        cmp #<state_pending
        bne bank_recorded
        lda $0106,x
        cmp #>state_pending
        bne bank_recorded
        lda $0101,x
        sta ram_mode
bank_recorded:
        lda ram_mode
        pha
        lda #>nmi_resume
        pha
        lda #<nmi_resume
        pha
        php
        inc $CAFE
        bit $C006
        pha
        phx
        bit $C082
        jmp $B6E9
nmi_resume:
        pla
        sta ram_mode
        tax
        lda $C080,x
        lda $C080,x
        plx
        ply
        lda $C20D
        bpl nmi_restored
        jmp nmi_dispatch
nmi_restored:
        bra nmi_return
ram_mode:
        .byte 0
nmi_end:
