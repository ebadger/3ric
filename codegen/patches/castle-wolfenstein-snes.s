; Resident for the checked French disk and 3RIC ROM, not general-purpose RAM.
        .org $C800

KEYBOARD = $C000
PORTB = $C200
MOVE_DIR = $4341
AIM_DIR = $4342

init:
        stz pending_key
        stz previous_motion
        stz previous_chord
        stz suppress_l
        jsr scan_pad
        lda pad+2
        sta previous_select
        sta select_used
        lda pad+3
        sta previous_start
        lda pad+11
        sta previous_r
        rts

; Do not trigger the ROM's paddle timers. PS/2 NMIs remain enabled.
scan_pad:
        lda PORTB
        and #$0F
        sta port_low
        ora #$40
        sta PORTB
        ldy #4
latch_delay:
        dey
        bne latch_delay
        ldx #0
scan_bit:
        lda port_low
        sta PORTB
        nop
        nop
        nop
        lda PORTB
        and #$20
        beq pressed
        lda #0
        bra store_button
pressed:
        lda #1
store_button:
        sta pad,x
        lda port_low
        ora #$80
        sta PORTB
        inx
        cpx #16
        bne scan_bit
        lda port_low
        sta PORTB
        rts

start_edge:
        lda pad+3
        tax
        eor previous_start
        stx previous_start
        and pad+3
        rts

read_title:
        phx
        phy
        jsr scan_pad
        jsr start_edge
        beq title_key
        lda KEYBOARD
        bmi title_key
        lda #$8D
        sta KEYBOARD
title_key:
        ply
        plx
        lda KEYBOARD
        rts

wait_menu:
        pha
        lda #$CB
        jsr wait_key
        pla
        jmp $FD0C

wait_continue:
        pha
        lda #$8D
        jsr wait_key
        pla
        jmp $FD1B

wait_key:
        phx
        phy
        sta start_key
wait_poll:
        jsr scan_pad
        jsr start_edge
        beq check_key
        lda KEYBOARD
        bmi check_key
        lda start_key
        sta KEYBOARD
check_key:
        lda KEYBOARD
        bpl wait_poll
        ply
        plx
        rts

game_input:
        phy
        jsr $1F0B
; A fresh keyboard movement must survive releasing a previously active D-pad.
        cpx #9
        bcs scan_input
        stz previous_motion
scan_input:
        jsr scan_pad
        jsr buttons
        ldx #3
        jsr direction
        sta next_motion
        lda raw_direction
        ora previous_motion
        beq keep_keyboard_motion
        lda next_motion
        sta MOVE_DIR
keep_keyboard_motion:
        lda raw_direction
        sta previous_motion
        ldx #7
        jsr direction
        beq keep_aim
        sta AIM_DIR
keep_aim:
        lda pending_key
        ora pad+11
        beq input_done
        stz MOVE_DIR
input_done:
        ply
        rts

; X=3 selects D-pad; X=7 selects face buttons. Opposites cancel per axis.
direction:
        stz raw_direction
direction_bit:
        ldy button_order,x
        lda pad,y
        lsr
        rol raw_direction
        dex
        txa
        and #3
        cmp #3
        bne direction_bit
        ldx raw_direction
        lda directions,x
        rts

buttons:
        lda pad+10
        bne l_held
        stz suppress_l
l_held:
        stz chord
        lda pad+2
        beq select_up
        lda previous_select
        bne select_held
        stz select_used
select_held:
        lda pad+10
        ora suppress_l
        sta suppress_l
        lda pad+3
        bne quit_chord
        lda pad+11
        bne use_chord
        lda pad+10
        beq compare_chord
        lda #$D4
        bra have_chord
quit_chord:
        lda #$9B
        bra have_chord
use_chord:
        lda #$D5
have_chord:
        sta chord
        lda #1
        sta select_used
        bra compare_chord
select_up:
        lda previous_select
        beq ordinary_r
        lda select_used
        bne ordinary_r
        lda #$8D
        jsr queue_key
ordinary_r:
        lda pad+11
        beq compare_chord
        lda previous_r
        bne compare_chord
        lda #$A0
        jsr queue_key
compare_chord:
        lda chord
        cmp previous_chord
        beq remember_buttons
        sta previous_chord
        cmp #0
        beq remember_buttons
        jsr queue_key
remember_buttons:
        lda pad+2
        sta previous_select
        lda pad+3
        sta previous_start
        lda pad+11
        sta previous_r
        rts

queue_key:
        cmp #$9B
        beq store_key
        ldx pending_key
        bne queue_full
store_key:
        sta pending_key
queue_full:
        rts

; Called where the game polls action keys, after both movement/aim scans.
read_action:
        phx
        jsr $1F0B
        plx
        lda KEYBOARD
        bmi action_done
        lda pending_key
        beq action_done
        stz pending_key
; A rejected T is not acknowledged by the game; do not latch synthetic T.
        cmp #$D4
        beq action_done
        sta KEYBOARD
action_done:
        ora #0
        rts

game_fire:
        jsr $1F8D
        pha
        lda pad+2
        ora suppress_l
        bne keyboard_fire
        lda pad+10
        beq keyboard_fire
        pla
        lda #$80
        rts
keyboard_fire:
        pla
        rts

button_order:
        .byte 5,4,6,7,0,9,1,8
directions:
        .byte 0,1,2,0,4,5,6,4,8,9,10,8,0,1,2,0
port_low:        .byte 0
raw_direction:   .byte 0
next_motion:     .byte 0
previous_motion: .byte 0
previous_select: .byte 0
previous_start:  .byte 0
previous_r:      .byte 0
previous_chord:  .byte 0
suppress_l:      .byte 0
select_used:     .byte 0
chord:           .byte 0
pending_key:     .byte 0
start_key:       .byte 0
pad:            .res 16
resident_end:
