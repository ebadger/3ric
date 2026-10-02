; Hardware adapter for the fingerprinted Quarx shareware image.
; The builder supplies addresses for the converted owner-provided assets.
        .org $6000
        jmp select_song
        jmp render_frame
        .res $6011-*
palette_wheel:
        .res 16

init:
        sei
        cld
        bit $C007
        bit $C082
        jsr check_rom
        jsr detect_music
        sta $00
        lda #5
        sta $1A
        lda #$FF
        sta $10
        stz $12
        stz tile_bank
        lda #$4D
        sta $AB
        lda $03FE
        sta previous_irq
        lda $03FF
        sta previous_irq+1
        jsr shareware_notice
        cmp #$9B
        bne begin_music
        lda #$C0
        sta $00
begin_music:
        ldx #0
        jsr load_song
        jsr load_title
        bit $C050
        bit $C057
        bit $C052
        bit $C055
        cli
        jmp $0983

detect_music:
        lda $C404
        sta a:$006E
        lda $C404
        sec
        sbc $6E
        cmp #$F8
        beq music_present
        cmp #$F7
        beq music_present
        lda #$C0
        rts
music_present:
        lda #$C1
        rts

check_rom:
        ldx #11
check_irq_byte:
        lda $FA86,x
        cmp expected_irq,x
        bne wrong_rom
        dex
        bpl check_irq_byte
        ldx #26
check_nmi_byte:
        lda $F1BB,x
        cmp expected_nmi,x
        bne wrong_rom
        dex
        bpl check_nmi_byte
        rts
wrong_rom:
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
show_error:
        lda rom_message,x
        beq rom_halted
        ora #$80
        sta $0400,x
        inx
        bne show_error
rom_halted:
        jmp rom_halted
rom_message:
        .asciiz "3RIC ROM MISMATCH - RESET"

shareware_notice:
        bit $C051
        bit $C054
        jsr $FC58
        lda #<SHAREWARE
        sta $18
        lda #>SHAREWARE
        sta $19
notice_line:
        ldy #0
        lda ($18),y
        sta $14
        iny
        lda ($18),y
        sta $15
        clc
        lda $18
        adc #2
        sta $18
        bcc notice_start
        inc $19
notice_start:
        ldy #0
notice_text:
        lda ($18),y
        beq notice_next
        cmp #$FF
        beq notice_countdown
        sta ($14),y
        iny
        bra notice_text
notice_next:
        tya
        sec
        adc $18
        sta $18
        bcc notice_line
        inc $19
        bra notice_line
notice_countdown:
        lda #9
        sta hundreds
        sta tens
        sta ones
notice_tick:
        lda hundreds
        ora #$B0
        sta $07EC
        lda tens
        ora #$B0
        sta $07ED
        lda ones
        ora #$B0
        sta $07EE
        ldy #8
        ldx #0
notice_delay:
        dex
        bne notice_delay
        dey
        bne notice_delay
        dec ones
        bpl notice_tick
        lda #9
        sta ones
        dec tens
        bpl notice_tick
        sta tens
        dec hundreds
        bpl notice_tick
        jsr ack_key
notice_key:
        lda $C000
        bpl notice_key
        jsr ack_key
        rts

start_game:
        jsr MENU
        lda #<BACKGROUND_DATA
        sta DECOMP+$F0
        lda #>BACKGROUND_DATA
        sta DECOMP+$F1
        stz DECOMP+$DF
        lda #$20
        sta DECOMP+$E0
        jsr DECOMP
        jsr copy_screen
        lda #1
        sta $0A
        bit $C055
        jmp $1142

load_title:
        lda #<TITLE_DATA
        sta DECOMP+$F0
        lda #>TITLE_DATA
        sta DECOMP+$F1
        stz DECOMP+$DF
        lda #$20
        sta DECOMP+$E0
        jsr DECOMP
        jsr copy_screen
        lda #1
        sta $0A
        rts

copy_screen:
        ldx #0
        lda #$20
        sta copy_read+2
        lda #$40
        sta copy_write+2
copy_page:
copy_read:
        lda $2000,x
copy_write:
        sta $4000,x
        inx
        bne copy_page
        inc copy_read+2
        inc copy_write+2
        lda copy_read+2
        cmp #$40
        bne copy_page
return:
        rts

restore_title:
        ldx #66
restore_row:
        lda ROW_LO,x
        sta $50
        sta $52
        lda ROW_HI,x
        sta $51
        eor #$60
        sta $53
        ldy #39
restore_byte:
        lda ($50),y
        sta ($52),y
        dey
        bpl restore_byte
        inx
        cpx #129
        bne restore_row
        rts

select_tiles:
        asl
        asl
        sta tile_bank
        asl
        clc
        adc tile_bank
        sta tile_bank
        rts

draw_tile:
        lda $0C
        cmp #3
        bcc return
        asl
        asl
        asl
        sec
        sbc $0C
        sec
        sbc #20
        sta draw_y
        lda $0B
        asl
        asl
        clc
        adc #10
        sta draw_x
        bra draw_block

draw_preview:
        lda $0B
        sta draw_x
        lda $0C
        sta draw_y
draw_block:
        lda $0D
        clc
        adc tile_bank
        tax
        lda tile_low,x
        sta $52
        lda tile_high,x
        sta $53
        lda #14
        sta draw_count
        lda draw_y
        cmp #8
        bcs draw_row
        lda #28
        clc
        adc $52
        sta $52
        bcc tile_clipped
        inc $53
tile_clipped:
        lda #8
        sta draw_y
        lda #7
        sta draw_count
draw_row:
        ldx draw_y
        lda ROW_LO,x
        clc
        adc draw_x
        sta $50
        lda ROW_HI,x
        ldx $0A
        beq draw_page
        eor #$60
draw_page:
        sta $51
        ldy #0
        lda ($52),y
        sta ($50),y
        iny
        lda ($52),y
        sta ($50),y
        iny
        lda ($52),y
        sta ($50),y
        iny
        lda ($52),y
        sta ($50),y
        clc
        lda $52
        adc #4
        sta $52
        bcc draw_next
        inc $53
draw_next:
        inc draw_y
        dec draw_count
        bne draw_row
        rts

render_frame:
        lda $0A
        eor #1
        sta $0A
        eor #1
        tax
        lda $C054,x
        lda #4
        sta frame_row
        lda #5
        sta frame_index
frame_new_row:
        stz frame_col
frame_cell:
        ldx frame_index
        lda $08EB,x
        bmi empty_cell
        sta $0D
        lda frame_col
        sta $0B
        lda frame_row
        sta $0C
        jsr draw_tile
        bra frame_next
empty_cell:
        lda frame_col
        asl
        asl
        clc
        adc #10
        sta draw_x
        lda frame_row
        asl
        asl
        asl
        sec
        sbc frame_row
        sec
        sbc #20
        tax
        lda #14
        sta draw_count
empty_row:
        lda ROW_LO,x
        clc
        adc draw_x
        sta $50
        lda ROW_HI,x
        ldy $0A
        beq empty_page
        eor #$60
empty_page:
        sta $51
        ldy #3
        lda #0
empty_byte:
        sta ($50),y
        dey
        bpl empty_byte
        inx
        dec draw_count
        bne empty_row
frame_next:
        inc frame_index
        inc frame_col
        lda frame_col
        cmp #5
        bne frame_cell
        inc frame_row
        inc frame_row
        lda frame_row
        cmp #28
        bne frame_new_row
        rts

print_string:
        stx $18
        sty $19
        ldy #0
print_next:
        lda ($18),y
        beq return_text
        sta $11
        phy
        jsr print_char
        ply
        inc $0B
        iny
        bne print_next
return_text:
        rts

print_char:
        stz font_shift
        bra character
erase_char:
        lda #7
        sta font_shift
character:
        lda #0
        sta font_row
character_row:
        lda font_row
        clc
        adc $0C
        tax
        lda ROW_LO,x
        sta $50
        lda ROW_HI,x
        ldx $0A
        beq character_page
        eor #$60
character_page:
        sta $51
        lda font_row
        clc
        adc font_shift
        cmp #7
        bcs blank_row
        lsr
        clc
        adc #>FONT
        sta font_read+2
        lda font_row
        clc
        adc font_shift
        and #1
        beq font_even
        lda #$80
font_even:
        sta font_read+1
        ldx $11
font_read:
        lda FONT,x
        bra character_write
blank_row:
        lda #0
character_write:
        eor $12
        and #$7F
        ldy $0B
        sta ($50),y
        inc font_row
        lda font_row
        cmp #7
        bne character_row
        rts

print_animated:
        ldy #0
animated_next:
        lda ($18),y
        beq return_text
        sta $11
        lda ($E4),y
        and #7
        sta font_shift
        phy
        jsr character
        ply
        inc $0B
        iny
        bne animated_next
        rts

font_rows:
        ldx $0C
        ldy #0
font_row_pointer:
        lda ROW_LO,x
        sta $C4,y
        sta $D4,y
        lda ROW_HI,x
        sta $C5,y
        eor #$60
        sta $D5,y
        iny
        iny
        inx
        cpy #14
        bne font_row_pointer
        rts

copy_span:
        ldy #10
span_byte:
        lda ($14),y
        sta ($16),y
        iny
        cpy #30
        bne span_byte
        rts

select_song:
        inx
load_song:
        php
        sei
        stx selected_song
        jsr music_stop
        ldx selected_song
        lda song_low,x
        sta DECOMP+$F0
        lda song_high,x
        sta DECOMP+$F1
        stz DECOMP+$DF
        lda #>SONG_BUFFER
        sta DECOMP+$E0
        jsr DECOMP
        plp
        rts

music_prepare:
        php
        sei
        jsr music_stop
        stz $6F
        stz $6B
        jsr MUSIC+$E7E
        jsr MUSIC+$E8D
        lda #<music_irq
        sta $03FE
        lda #>music_irq
        sta $03FF
        lda #$40
        sta $C40B
        plp
        rts

music_start:
        php
        sei
        jsr MUSIC+$C44
        lda #<(MUSIC_PERIOD-1)
        sta $C404
        lda #>(MUSIC_PERIOD-1)
        sta $C405
        lda #$C0
        sta $C40E
        plp
        rts

music_stop:
        php
        sei
        lda #$7F
        sta $C40E
        jsr MUSIC+$ED3
        plp
        rts

music_irq:
        lda $C40D
        and #$40
        bne music_tick
        jmp (previous_irq)
music_tick:
        lda $45                 ; ROM IRQ dispatch saves the interrupted A here
        pha
        phx
        phy
        lda $AB
        pha
        inc music_ticks
        bne music_play
        inc music_ticks+1
music_play:
        jsr MUSIC+$77D
        pla
        sta $AB
        ply
        plx
        pla
        rti

music_write:
        sta $60
        cpx #6
        bcc tone_period
        cpx #11
        beq envelope_period
        cpx #12
        beq period_high
        cpx #6
        bne period_ready
        stz $61
        jsr scale_period
        lda $60
        cmp #32
        bcc write_scaled
        lda #31
        bra write_scaled
tone_period:
        txa
        lsr
        bcs period_high
        lda $75,x
        and #$0F
        sta $61
        jsr scale_period
        lda $61
        cmp #16
        bcc save_period
        lda #$0F
        sta $61
        lda #$FF
        sta $60
        bra save_period
envelope_period:
        lda $80
        sta $61
        jsr scale_period
        lda $62
        beq save_period
        lda #$FF
        sta $60
        sta $61
save_period:
        lda $61
        sta scaled_high
period_ready:
        lda $60
        bra write_scaled
period_high:
        lda scaled_high
write_scaled:
        stx $C401
        rts

; 20/13 differs from the measured clock ratio by under 0.001%.
scale_period:
        lda $60
        sta $64
        lda $61
        sta $65
        stz $62
        stz $66
        ldy #2
multiply_four:
        asl $64
        rol $65
        rol $66
        dey
        bne multiply_four
        ldy #4
multiply_sixteen:
        asl $60
        rol $61
        rol $62
        dey
        bne multiply_sixteen
        clc
        lda $60
        adc $64
        sta $60
        lda $61
        adc $65
        sta $61
        lda $62
        adc $66
        sta $62
        clc
        lda $60
        adc #6
        sta $60
        bcc divide_period
        inc $61
        bne divide_period
        inc $62
divide_period:
        stz $63
        ldy #24
divide_bit:
        asl $60
        rol $61
        rol $62
        rol $63
        lda $63
        cmp #13
        bcc divide_next
        sbc #13
        sta $63
        inc $60
divide_next:
        dey
        bne divide_bit
        rts

song_low:   .byte <SONG1,<SONG2,<SONG3
song_high:  .byte >SONG1,>SONG2,>SONG3
selected_song: .byte 0
previous_irq: .word 0
music_ticks: .word 0
scaled_high: .byte 0

tile_low:
        .byte <TILES,<(TILES+56),<(TILES+112),<(TILES+168),<(TILES+224),<(TILES+280)
        .byte <(TILES+672),<(TILES+728),<(TILES+784),<(TILES+840),<(TILES+896),<(TILES+952)
        .byte <(TILES+336),<(TILES+392),<(TILES+448),<(TILES+504),<(TILES+560),<(TILES+616)
        .byte <(TILES+672),<(TILES+728),<(TILES+784),<(TILES+840),<(TILES+896),<(TILES+952)
tile_high:
        .byte >TILES,>(TILES+56),>(TILES+112),>(TILES+168),>(TILES+224),>(TILES+280)
        .byte >(TILES+672),>(TILES+728),>(TILES+784),>(TILES+840),>(TILES+896),>(TILES+952)
        .byte >(TILES+336),>(TILES+392),>(TILES+448),>(TILES+504),>(TILES+560),>(TILES+616)
        .byte >(TILES+672),>(TILES+728),>(TILES+784),>(TILES+840),>(TILES+896),>(TILES+952)
tile_bank:  .byte 0
draw_x:     .byte 0
draw_y:     .byte 0
draw_count: .byte 0
frame_row:  .byte 0
frame_col:  .byte 0
frame_index: .byte 0
font_row:   .byte 0
font_shift: .byte 0
hundreds:   .byte 0
tens:       .byte 0
ones:       .byte 0

; $C000 is the same writable RAM latch the 3RIC ROM fills. Avoid the CB1
; strobe NMI whose blanket IFR clear can discard a pending PS/2 clock edge.
ack_key:
        php
        pha
        lda #$80
        trb $C000
        pla
        plp
        rts
