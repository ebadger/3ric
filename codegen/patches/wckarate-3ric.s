; Resident input adapter for the checked World Karate Championship disk.
        .org $CC00
select_ram:
        phx
        tax
        lda $C080,x
state_pending:
        stx ram_mode
        lda $C080,x
        plx
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

scan_pads:
        lda #$60
        sta $C20E
        sta $C20D
        stz $C200
        lda #$40
        sta $C200
        ; Twenty cycles of latch-high at 1.5734375 MHz exceed the 12 us pulse.
        nop
        nop
        nop
        nop
        nop
        nop
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

direction:
        stz direction_bits
        lda $CEE4,y
        cmp $CEE5,y
        beq horizontal
        lda $CEE4,y
        beq down
        lda #1
        bra vertical_done
down:
        lda #2
vertical_done:
        sta direction_bits
horizontal:
        lda $CEE6,y
        cmp $CEE7,y
        beq direction_done
        lda $CEE6,y
        beq right
        lda #4
        bra horizontal_done
right:
        lda #8
horizontal_done:
        ora direction_bits
        sta direction_bits
direction_done:
        lda direction_bits
        eor #$0F
        rts
direction_bits:
        .byte 0

pad1:
        jsr scan_pads
        ldy #0
        jsr direction
        ldx $C061
pad1_done:
        rts
pad2:
        jsr $6BEB
        pha
        phx
        jsr scan_pads
        lda $CEF4
        ora $CEF5
        ora $CEF6
        ora $CEF7
        ora $CEF0
        ora $CEF9
        tax
        ora previous_pad2
        beq keyboard2
        stx previous_pad2
        stz $6C23
        stz $6C24
        plx
        pla
        ldy #16
        jsr direction
        ldx $C062
pad2_done:
        rts
keyboard2:
        plx
        pla
        rts
previous_pad2:
        .byte 0

frame_input:
        php
        pha
        phx
        phy
        jsr scan_pads
        lda previous_start
        eor #$FF
        sta start_edges
        lda $CEF3
        asl
        ora $CEE3
        sta previous_start
        and start_edges
        beq frame_input_done
        ldx $C000
        bmi frame_input_done
        and #2
        bne start_two
        lda #$B1
        bra start_game
start_two:
        lda #$B2
start_game:
        sta $C000
frame_input_done:
        ply
        plx
        pla
        plp
        jmp $6DBB
previous_start:
        .byte 0
start_edges:
        .byte 0

button1:
        pha
        phx
        phy
        jsr scan_pads
        ply
        plx
        pla
        bit $C061
        rts

; The Apple II video bus used by the game is not a 3ric entropy source.
random:
        lda random_lo
        ora random_hi
        bne random_step
        inc random_hi
random_step:
        lsr random_hi
        ror random_lo
        bcc random_done
        lda random_hi
        eor #$B4
        sta random_hi
random_done:
        lda random_lo
        eor random_hi
        rts
random_lo:
        .byte $E1
random_hi:
        .byte $AC

; Match ROM WAIT without exposing its slower NMI receiver during a sound.
wait:
        sec
wait_outer:
        pha
wait_inner:
        sbc #1
        bne wait_inner
        pla
        sbc #1
        bne wait_outer
        rts
adapter_end:
