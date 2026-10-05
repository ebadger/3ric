; Resident adapter for one checked Archon image, not a standalone program.
        .org $CC00

prepare_ram:
        bit $C081
        bit $C081
        sta ram_mode
        lda #<nmi_entry
        sta $FFFA
        lda #>nmi_entry
        sta $FFFB
        rts

select_ram:
        phx
        tax
        lda $C080,x
state_pending:
        stx ram_mode
        lda $C080,x
        plx
        rts

; The NMI entry recognizes state_pending and takes the just-selected mode
; from saved X. Normal transitions never expose the old ROM interrupt handler.
ram2_read:
        php
        pha
        lda #0
        jsr select_ram
        pla
        plp
        bit $C080
        rts
ram2_write:
        php
        pha
        lda #3
        jsr select_ram
        pla
        plp
        bit $C083
        rts
ram1_write:
        php
        pha
        lda #11
        jsr select_ram
        pla
        plp
        bit $C08B
        rts
ram2_read_lda:
        php
        pha
        lda #0
        jsr prepare_ram
        pla
        plp
        lda $C080
        rts
ram2_write_lda:
        php
        pha
        lda #3
        jsr prepare_ram
        pla
        plp
        lda $C083
        rts

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

menu_pad:
        jsr scan_pads
        ldy #6
        jsr axis
        sta $A0
        ldy #4
        jsr axis
        sta $A1
        ldy #22
        jsr axis
        sta $A2
        ldy #20
        jsr axis
        sta $A3
        lda #$FF
        sta $33B3
        ldy #0
        rts

game_pad:
        jsr scan_pads
        lda $C061
        asl
        lda #0
        rol
        eor #1
        sta $D105
        lda $C062
        asl
        lda #0
        rol
        eor #1
        sta $D106
        lda $9FFB
        beq game_buttons_done
        ldy keyboard_side
        lda #0
        sta $D105,y
game_buttons_done:
        lda #$FF
        sta $D104
        ldx #1
game_direction:
        txa
        asl
        asl
        asl
        asl
        tay
        lda $CEE4,y
        ora $CEE5,y
        ora $CEE6,y
        ora $CEE7,y
        sta active_pad
        ora previous_pad,x
        beq keep_direction
        lda active_pad
        sta previous_pad,x
        txa
        pha
        tya
        clc
        adc #6
        tay
        jsr axis
        lsr
        lsr
        pha
        tya
        sec
        sbc #2
        tay
        jsr axis
        lsr
        lsr
        sta axis_y
        pla
        tax
        pla
        tay
        lda axis_y
        jsr $1F60
        tya
        tax
keep_direction:
        dex
        bpl game_direction
        lda $1E49
        beq game_pad_done
        ldy keyboard_side
        jsr $1FC7
game_pad_done:
        rts
previous_pad:
        .byte 0,0
active_pad:
        .byte 0
axis_y:
        .byte 0
menu_enter:
        stz $C000
        jsr ram2_write
        rts
menu_launch:
        php
        pha
        lda $17E5
        cmp #12
        beq keyboard_second
        cmp #16
        beq keyboard_second
        lda #0
        bra keyboard_selected
keyboard_second:
        lda #1
keyboard_selected:
        sta keyboard_side
        pla
        plp
        bit $C081
        rts
keyboard_side:
        .byte 0
adapter_end:

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
