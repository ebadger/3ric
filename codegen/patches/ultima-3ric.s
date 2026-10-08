; Resident for the fingerprinted Ultima/ProDOS image, not general-purpose RAM.
        .org $CC00

io_lock:
        php
        pha
        inc io_depth
        lda io_depth
        cmp #1
        bne lock_done
        phx
        ldx #0
wait_input:
        lda $CE00
        beq input_idle
        dex
        bne wait_input
        jmp input_timeout
input_idle:
        plx
        lda $C20E
        sta saved_ier
        lda #$7F
        sta $C20E
        lda $C203
        sta saved_ddra
        lda $C20F
        and #$BF
        sta $C20F
        lda saved_ddra
        ora #$40
        sta $C203
        phx
        ldx #40
inhibit_delay:
        dex
        bne inhibit_delay
        plx
lock_done:
        pla
        plp
        rts

io_unlock:
        php
        pha
        dec io_depth
        bne unlock_done
        stz $CE00
        lda #1
        sta $C20D
        lda saved_ddra
        sta $C203
        lda saved_ier
        ora #$80
        sta $C20E
unlock_done:
        pla
        plp
        rts

; Copy the inline MLI parameters, retaining its original caller/return ABI.
mli:
        php
        pha
        phx
        phy
        tsx
        clc
        lda $0105,x
        adc #1
        sta read_parameter+1
        lda $0106,x
        adc #0
        sta read_parameter+2
        clc
        lda $0105,x
        adc #3
        sta $0105,x
        bcc return_ready
        inc $0106,x
return_ready:
        ldy #2
read_parameter:
        lda $FFFF,y
        sta mli_parameters,y
        dey
        bpl read_parameter
        ply
        plx
        pla
        plp
        jsr io_lock
        jsr $BFB7
mli_parameters:
        .byte 0,0,0
mli_return:
        jsr io_unlock
        rts

save_character:
        phx
        phy
        ldy #0
save_page:
        lda $7E6D,y
        sta $C800,y
        iny
        bne save_page
save_tail:
        lda $7F6D,y
        sta $C900,y
        iny
        cpy #202
        bne save_tail
        lda #1
        sta save_valid
        ply
        tsx
        clc
        lda $0102,x
        adc #6
        sta $0102,x
        bcc save_return
        inc $0103,x
save_return:
        plx
        lda #0
        clc
        rts

load_character:
        phx
        phy
        lda save_valid
        beq load_empty
        ldy #0
load_page:
        lda $C800,y
        sta $6000,y
        iny
        bne load_page
load_tail:
        lda $C900,y
        sta $6100,y
        iny
        cpy #202
        bne load_tail
load_empty:
        ply
        tsx
        clc
        lda $0102,x
        adc #4
        sta $0102,x
        bcc load_return
        inc $0103,x
load_return:
        plx
        lda save_valid
        cmp #1
        bne no_character
        lda #0
        clc
        rts
no_character:
        lda #$06
        sec
        rts

startup:
        jsr io_unlock
        jmp $2088

return_menu:
        lda #0
        jmp $88FD

input_timeout:
        bit $C051
        bit $C054
        ldx #0
show_timeout:
        lda timeout_message,x
        beq timeout_halted
        sta $0400,x
        inx
        bne show_timeout
timeout_halted:
        jmp timeout_halted
timeout_message:
        .byte $D0,$D3,$AF,$B2,$A0,$D4,$C9,$CD,$C5,$CF,$D5,$D4,$A0,$AD,$A0
        .byte $D2,$C5,$D3,$C5,$D4,0

io_depth:
        .byte 0
saved_ier:
        .byte 0
saved_ddra:
        .byte 0
save_valid:
        .byte 0
resident_end:
