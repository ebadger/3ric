; Exact-image adapter; the checked installer supplies the ROM-derived noise pool.
        .org $C800
read_key:
        php
        phx
        phy
        cld
        jsr scan_pads
        jsr menu_keys
        stz synthetic_key
        lda $C000
        bmi real_key
        ldx pending_key
        beq real_key
        inc synthetic_key
        txa
real_key:
        sta returned_key
        ply
        plx
        plp
        lda returned_key
        rts

ack_key:
        php
        pha
        lda synthetic_key
        beq ack_physical
        stz pending_key
        bra ack_done
ack_physical:
        stz $C000
ack_done:
        pla
        plp
        rts

scan_pads:
        lda port_base
        ora #$40
        sta $C200
        ldx #0
scan_bit:
        lda port_base
        sta $C200
        stz $CEE0,x
        stz $CEF0,x
        lda $C200
        and #$20
        bne first_up
        inc $CEE0,x
first_up:
        lda $C200
        and #$10
        bne second_up
        inc $CEF0,x
second_up:
        lda port_base
        ora #$80
        sta $C200
        inx
        cpx #16
        bne scan_bit
        lda port_base
        sta $C200
        rts

menu_keys:
        lda $CEE3
        ora $CEF3
        sta current_menu
        lda $CEE2
        ora $CEF2
        asl
        ora current_menu
        sta current_menu
        lda $CEE4
        ora $CEF4
        sta menu_axis
        lda $CEE5
        ora $CEF5
        eor menu_axis
        asl
        asl
        ora current_menu
        sta current_menu
        lda $CEE6
        ora $CEF6
        sta menu_axis
        lda $CEE7
        ora $CEF7
        eor menu_axis
        asl
        asl
        asl
        ora current_menu
        sta current_menu
        lda $CEE0
        ora $CEE9
        ora $CEF0
        ora $CEF9
        asl
        asl
        asl
        asl
        ora current_menu
        sta current_menu
        lda previous_menu
        eor #$FF
        and current_menu
        sta menu_edges
        lda current_menu
        sta previous_menu
        lda pending_key
        bne menu_done
        lda menu_edges
        and #1
        bne start_key
        lda menu_edges
        and #2
        bne escape_key
        lda intro_mode
        beq option_keys
        lda menu_edges
        and #$10
        bne space_key
        rts
start_key:
        lda intro_mode
        bne space_key
        lda $23
        and #$0B
        beq space_key
        lda #$8D
        bra queue_key
space_key:
        lda #$A0
        bra queue_key
escape_key:
        lda #$9B
        bra queue_key
option_keys:
        lda $23
        and #$0B
        beq menu_done
        lda menu_edges
        and #4
        beq option_value
        lda #$95
        bra queue_key
option_value:
        lda menu_edges
        and #8
        beq menu_done
        lda #$88
queue_key:
        sta pending_key
menu_done:
        rts
port_base:
        .byte 0
intro_mode:
        .byte 1
current_menu:
        .byte 0
previous_menu:
        .byte 0
menu_edges:
        .byte 0
menu_axis:
        .byte 0
pending_key:
        .byte 0
synthetic_key:
        .byte 0
returned_key:
        .byte 0
poll_end:

        .org $CC00
game_reset:
        cld
        ldx #$FF
        txs
        stz intro_mode
        stz pending_key
        stz synthetic_key
        jsr clear_keyboard
        jsr select_ram
        ldx #$FF
        jmp $0403

select_ram:
        ldx #3
        lda $C080,x
state_pending:
        stx ram_mode
        lda $C080,x
        rts

new_round:
        php
        pha
        jsr clear_keyboard
        pla
        plp
        jmp $0932
clear_keyboard:
        lda #$FF
        sta keyboard_direction
        sta keyboard_direction+1
        stz keyboard_fire
        stz keyboard_fire+1
        rts

prepare_fire:
        lda keyboard_fire
        sta $16
        lda keyboard_fire+1
        sta $17
        rts
prepare_direction:
        lda keyboard_direction
        sta $14
        lda keyboard_direction+1
        sta $15
        rts

apply_pads:
        phx
        phy
        lda $0296
        and #2
        beq second_mode
        lda #$FF
        sta $14
        stz $16
second_mode:
        lda $02A8
        and #2
        beq save_keyboard
        lda #$FF
        sta $15
        stz $17
save_keyboard:
        lda $14
        sta keyboard_direction
        lda $15
        sta keyboard_direction+1
        lda $16
        sta keyboard_fire
        lda $17
        sta keyboard_fire+1
        ldy #0
        jsr pad_direction
        cmp #$FF
        beq first_neutral
        sta $14
first_neutral:
        ldy #16
        jsr pad_direction
        cmp #$FF
        beq second_neutral
        sta $15
second_neutral:
        lda $CEE0
        ora $CEE9
        beq first_fire_up
        lda #$FF
        sta $16
first_fire_up:
        lda $CEF0
        ora $CEF9
        beq second_fire_up
        lda #$FF
        sta $17
second_fire_up:
        ply
        plx
game_pad_done:
        jmp $9953

pad_direction:
        lda $CEE4,y
        cmp $CEE5,y
        beq vertical_center
        ldx #0
        lda $CEE4,y
        bne vertical_done
        ldx #6
        bra vertical_done
vertical_center:
        ldx #3
vertical_done:
        lda $CEE6,y
        cmp $CEE7,y
        beq horizontal_center
        lda $CEE6,y
        bne direction_done
        inx
        bra horizontal_center
horizontal_center:
        inx
direction_done:
        lda directions,x
        rts
directions:
        .byte 1,0,7,2,$FF,6,3,4,5
keyboard_direction:
        .byte $FF,$FF
keyboard_fire:
        .byte 0,0
adapter_end:
