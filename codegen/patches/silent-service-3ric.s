; Resident adapter for the checked Silent Service disk and 3ric ROM.
        .org $C800
cold_start:
        jsr $FD0C            ; DOS's installed input hook runs the binary greeting
        jmp cold_start

string_out:
        sta string_byte+1
        sty string_byte+2
string_byte:
        lda $FFFF
        beq string_done
        phx
        phy
        jsr firmware_fded
        ply
        plx
        inc string_byte+1
        bne string_byte
        inc string_byte+2
        bra string_byte
string_done:
        rts

read_key:
        jsr ram2_write_lda
wait_key:
        lda $C000
        bpl wait_key
        stz $C000
        cmp #$9B
        beq wait_key
        rts

ram_resume:
        php
        pha
        phx
        ldx #3
        jsr select_ram
        plx
        pla
        plp
        rts

finish_irq_vector:
        sta $FFFF
        jmp ram_resume

return_address:
; Capture the return PC before RTS makes those stack bytes available to NMI.
        php
        pha
        phx
        tsx
        lda $0104,x
        sta captured_low
        lda $0105,x
        sta captured_high
        plx
        pla
        plp
        rts
captured_low:
        .byte 0
captured_high:
        .byte 0

machine_call:
        php
        pha
        lda $BB
        cmp #$D0
        bcc call_ready
        bit $C081
call_ready:
        pla
        plp
        jsr call_indirect
        jmp ram_resume
call_indirect:
        jmp ($BA)
startup_end:

        .org $C880
game_paddle:
        stx $A4E2
        jsr scan_pads
        ldy #4
        jsr signed_axis
        sty $4044
        sta $4045
        ldx $A4E2
        jsr $AD4E
        phx
        ldy #6
        jsr signed_axis
        sty $4042
        sta $4043
        plx
        jmp $AD4E
signed_axis:
        jsr axis
        cmp #16
        beq signed_center
        bcc signed_low
        ldy #1
        lda #0
        rts
signed_low:
        ldy #$FF
        lda #$FF
        rts
signed_center:
        ldy #0
        lda #0
        rts
game_paddle_end:

        .org $C900
next_loop:
; The original NEXT pops this frame, then reads and reuses the discarded bytes.
; Keep it live until the loop finishes or an enclosing frame must be searched.
        tsx
        cpx #$FF
        bne next_frame
        jmp $1224
next_frame:
        sei
        lda $0101,x
        ldy #1
        cmp ($B0),y
        bne next_skip
        sta $BA
        lda $0102,x
        iny
        cmp ($B0),y
        bne next_skip
        sta $BB
        ldy #0
        clc
        lda $0105,x
        adc ($BA),y
        sta ($BA),y
        iny
        lda $0106,x
        sta $C1
        adc ($BA),y
        sta ($BA),y
        dey
        sec
        lda $0107,x
        sbc ($BA),y
        beq next_equal_low
        iny
        lda $0108,x
        sbc ($BA),y
        eor $C1
        bmi next_finished
next_continue:
        lda $0104,x
        sta $B0
        lda $0103,x
        sta $B1
        cli
        jmp $00AF
next_equal_low:
        iny
        lda $0108,x
        sbc ($BA),y
        beq next_continue
        eor $C1
        bpl next_continue
next_finished:
        txa
        clc
        adc #10
        tax
        txs
        cli
        lda #3
        jmp $00A8
next_skip:
        txa
        clc
        adc #10
        tax
        txs
        jmp next_loop
next_end:
; @shared-snes-poll
poll_end:

        .org $CC00
ram2_read_store:
        php
        pha
        phx
        ldx #0
        jsr select_ram
        plx
        pla
        plp
        sta $C080
        rts
ram2_write_lda:
        php
        pha
        phx
        ldx #3
        jsr select_ram
        plx
        pla
        plp
        lda $C083
        rts
ram2_write_bit:
        php
        pha
        phx
        ldx #3
        jsr select_ram
        plx
        pla
        plp
        bit $C083
        rts
ram1_write_lda:
        php
        pha
        phx
        ldx #11
        jsr select_ram
        plx
        pla
        plp
        lda $C08B
        rts
ram1_write_bit:
        php
        pha
        phx
        ldx #11
        jsr select_ram
        plx
        pla
        plp
        bit $C08B
        rts
select_ram:
        bit $C081
        bit $C081
        lda #<nmi_entry
        sta $FFFA
        lda #>nmi_entry
        sta $FFFB
        lda $C080,x
state_pending:
        stx ram_mode
        lda $C080,x
        rts
banking_end:

        .org $CC70
select_rom:
        php
        bit $C081
        plp
        rts

; S6 rewrites only the low byte of DOS's bank operands while reading overlays.
        .org $CC81
dos_rom:
        bra select_rom
        .org $CC83
dos_bank2:
        jmp ram2_write_bit
        .org $CC8B
dos_bank1:
        jmp ram1_write_bit
dos_banks_end:
