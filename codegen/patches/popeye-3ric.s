; Disk-only supervisor. File descriptors and FILE_* constants come from the
; exact-image converter. The original game occupies $1300-$152C and $1F70-$95FF.
        .org $A000
start:
        sei
        cld
        bit $C082
        bit $C007
        lda $2B
        sta slot
        stz half_track
        lda #$4C
        sta $0801
        lda #<sector_done
        sta $0802
        lda #>sector_done
        sta $0803
        lda $03FE
        sta saved_irq
        lda $03FF
        sta saved_irq+1
        lda $C20E
        sta saved_via_ier
        lda #$60
        sta $C20E
        sta $C20D
        lda #$69
        sta key_x
        sta key_y
        stz key_fire
        stz exit_requested
        lda #$E1
        sta random_state
        lda #$AC
        sta random_state+1
        lda #FILE_TITLE
        jsr load_file
        lda #FILE_MUSIC
        jsr load_file
        lda #FILE_MINUET
        jsr load_file
        jsr motor_off
        jsr clear_text
        ldx #0
title_text:
        lda controls,x
        ora #$80
        sta $0650,x
        lda controls+40,x
        ora #$80
        sta $06D0,x
        lda controls+80,x
        ora #$80
        sta $0750,x
        lda controls+120,x
        ora #$80
        sta $07D0,x
        inx
        cpx #40
        bne title_text
        bit $C050
        bit $C057
        bit $C054
        bit $C053
        jsr $8503
        stz $C000
title_wait:
        inc random_state
        bit $C40D
        bvc title_input
        jsr $8500
title_input:
        jsr start_pressed
        beq title_wait
        jsr $850C
        jsr silence
        lda saved_irq
        sta $03FE
        lda saved_irq+1
        sta $03FF
        ldx #9
clear_scores:
        stz $E0,x
        dex
        bpl clear_scores
        lda #20
        sta goal
new_game:
        lda #1
        sta level
        lda #17
        sta lives_glyph
        lda #40
        sta speed
        lda #60
        sta difficulty
        stz key_fire
        lda #$69
        sta key_x
        sta key_y
        jsr load_level
        stz $EB
        stz $ED
        lda #2
        sta $EC
        jsr draw_initial_hud
        lda #10
        sta $94A0
        stz $94A1
        lda #159
        sta $94A2
        jsr configure_level
        jsr draw_scores
game_call:
        jsr $6000
game_event:
        lda exit_requested
        bne quit
        lda $FD
        cmp #2
        beq next_level
        cmp #1
        bne game_call
        jsr death
        lda $ED
        cmp #10
        bcs timeout_game_over
        dec lives_glyph
        lda lives_glyph
        cmp #14
        bcc last_life
        jsr draw_lives
        jmp game_call
timeout_game_over:
        lda #40
        bra show_game_over
last_life:
        lda #20
show_game_over:
        sta goal
        jsr game_over
        jmp new_game
next_level:
        inc level
        lda level
        cmp #4
        bcc next_level_ready
        lda #1
        sta level
next_level_ready:
        lda #20
        sta goal
        jsr load_level
        lda speed
        sec
        sbc #10
        bcs speed_positive
        lda #1
speed_positive:
        bne speed_ready
        lda #1
speed_ready:
        sta speed
        lda difficulty
        sec
        sbc #5
        bcc difficulty_min
        cmp #2
        bcs difficulty_ready
difficulty_min:
        lda #1
difficulty_ready:
        sta difficulty
        stz $ED
        stz $FD
        lda #2
        sta $EC
        jsr draw_initial_hud
        jsr configure_level
        jsr draw_scores
        jmp game_call

quit:
        jsr silence
        jsr motor_off
        lda #$60
        sta $C20D
        lda saved_via_ier
        sta $C20E
        jsr clear_text
        bit $C054
        bit $C052
        bit $C051
        stz $C000
        brk

load_level:
        bit $C051
        jsr clear_text
        ldx #0
loading_text:
        lda loading_message,x
        beq loading_ready
        ora #$80
        sta $0400,x
        inx
        bne loading_text
loading_ready:
        lda #FILE_UNPACK
        jsr load_file
        lda level
        dec
        clc
        adc #FILE_PICTURE_1
        jsr load_file
        jsr $1F70
        lda #$40
        sta $1F83
        lda #$60
        sta $1FA9
        sta $1FE9
        jsr $1F70
        lda #FILE_SOUND
        jsr load_file
        lda level
        dec
        clc
        adc #FILE_ENGINE_1
        jsr load_file
        lda #FILE_ANIMATION
        jsr load_file
        jsr motor_off
        jsr $1300
        jsr $132C
        lda goal
        sta $EA
        rts

configure_level:
        lda speed
        sta $FC
        lda difficulty
        sta $FB
        lda level
        cmp #3
        beq third_level
        lda #254
        sta $9458
        lda #100
        sta $94B8
        lda level
        cmp #2
        bne configured
        lda #12
        bra set_objects
third_level:
        ; Preserve the supplied BASIC's POKE PBLOC,0 (PBLOC defaults to zero).
        stz $00
        lda #28
        sta $94BA
        lda #13
set_objects:
        sta $9401
        sta $9402
        sta $9403
configured:
        rts

draw_initial_hud:
        jsr draw_lives
        lda #39
        sta $00
        stz $01
        lda #12
        sta $02
        lda #14
        sta $03
        jmp $8F00
draw_lives:
        lda #39
        sta $00
        stz $01
        lda #1
        sta $02
        lda lives_glyph
        sta $03
        jmp $8F00
draw_scores:
        jsr $602D
        jsr $60A0
        bit $C050
        bit $C057
        bit $C052
        bit $C054
        rts

death:
        ldx #15
death_registers:
        lda death_sound,x
        sta $0300,x
        dex
        bpl death_registers
        stz $08
        stz $0A
        lda #3
        sta $09
        sta $0B
        lda #4
        sta sound_sweeps
death_sweep:
        lda #1
        sta sound_step
death_note:
        lda sound_step
        sta $0306
        jsr $1358
        jsr $1374
        inc sound_step
        lda sound_step
        cmp #32
        bne death_note
        dec sound_sweeps
        bne death_sweep
        jsr $1321
        jsr $134D
        lda $94A0
        sta $00
        lda $94A1
        sta $01
        lda $94A2
        sta $02
        stz $03
        jsr $8FA2
        lda $94AC
        sta $00
        lda $94AD
        sta $01
        lda $94AE
        sta $02
        lda #5
        sta $03
        jsr $8FA2
        stz enemy_index
erase_enemy:
        ldx enemy_index
        lda $9405,x
        sta $03
        ldx enemy_index
        lda enemy_positions,x
        tax
        lda $9400,x
        sta $00
        lda $9401,x
        sta $01
        lda $9402,x
        sta $02
        jsr $8FA2
        inc enemy_index
        lda enemy_index
        cmp #3
        bne erase_enemy
        lda #10
        sta $94A0
        sta $94AC
        stz $94A1
        stz $94AD
        lda #159
        sta $94A2
        lda #79
        sta $94AE
        lda #2
        sta $8EFC
        stz $945B
        lda #128
        sta $94AF
        lda #144
        sta $94B2
        lda #112
        sta $94B5
        rts

game_over:
        jsr silence
        jsr clear_text
        bit $C051
        ldx #0
over_text:
        lda game_over_message,x
        beq over_wait
        ora #$80
        sta $0400,x
        inx
        bne over_text
over_wait:
        stz $C000
        jsr wait_release
restart_wait:
        jsr start_pressed
        beq restart_wait
        ldx #4
compare_score:
        lda $E0,x
        cmp $E5,x
        bcc retain_score
        bne new_high_score
        dex
        bpl compare_score
        bra retain_score
new_high_score:
        ldx #4
copy_score:
        lda $E0,x
        sta $E5,x
        dex
        bpl copy_score
retain_score:
        ldx #4
reset_score:
        stz $E0,x
        dex
        bpl reset_score
        rts

; Only the SNES latch/clock outputs are driven. No paddle timers or strobe
; interrupts are needed; the ROM continues to receive real PS/2 NMIs.
scan_pad:
        lda #0
        sta $C200
        lda #$40
        sta $C200
        ldx #0
pad_bit:
        lda #0
        sta $C200
        lda $C200
        and #$20
        cmp #1
        lda #0
        rol
        eor #1
        sta $CEE0,x
        lda #$80
        sta $C200
        inx
        cpx #16
        bne pad_bit
        stz $C200
        rts

start_pressed:
        jsr scan_pad
        lda $C000
        bpl start_pad
        stz $C000
        lda #1
        rts
start_pad:
        lda $CEE0
        ora $CEE3
        ora $CEE8
        ora $CEE9
        rts
wait_release:
        jsr scan_pad
        lda $CEE0
        ora $CEE3
        ora $CEE8
        ora $CEE9
        bne wait_release
        rts

read_fire:
        jsr poll_input
input_ready:
        lda exit_requested
        beq fire_pad
        lda #3
        sta $FD
fire_pad:
        lda $CEE0
        ora $CEE8
        ora $CEE9
        bne firing
        lda key_fire
        beq not_firing
        dec key_fire
firing:
        lda #$80
        rts
not_firing:
        lda #0
        rts
poll_input:
        jsr scan_pad
        lda $CEE4
        ora $CEE5
        ora $CEE6
        ora $CEE7
        beq keyboard
        lda #$69
        sta key_x
        sta key_y
keyboard:
        lda $C000
        bpl input_done
        stz $C000
        and #$7F
        cmp #'Q'
        beq request_exit
        cmp #27
        beq request_exit
        cmp #' '
        beq punch_key
        cmp #'X'
        beq stop_key
        ldx #7
direction_key:
        cmp direction_keys,x
        beq use_direction
        dex
        bpl direction_key
        rts
use_direction:
        lda keyboard_x,x
        sta key_x
        lda keyboard_y,x
        sta key_y
input_done:
        rts
punch_key:
        lda #6
        sta key_fire
        rts
stop_key:
        lda #$69
        sta key_x
        sta key_y
        rts
request_exit:
        lda #1
        sta exit_requested
        rts

read_axes:
        lda key_x
        ldx $CEE6
        cpx $CEE7
        beq axis_x_done
        lda #127
        cpx #0
        bne axis_x_done
        lda #0
axis_x_done:
        sta $6004
        lda key_y
        ldx $CEE4
        cpx $CEE5
        beq axis_y_done
        lda #127
        cpx #0
        bne axis_y_done
        lda #0
axis_y_done:
        sta $6005
        rts

; The engine consumes only RND's byte at $9E, not an Applesoft float.
random_byte:
        lsr random_state+1
        ror random_state
        bcc random_ready
        lda random_state+1
        eor #$B4
        sta random_state+1
random_ready:
        lda random_state
        sta $9E
        rts

silence:
        sei
        lda #$7F
        sta $C40E
        sta $C48E
        sta $C40D
        sta $C48D
        lda #$FF
        sta $C403
        sta $C483
        lda #7
        sta $C402
        sta $C482
        lda #0
        sta $C400
        sta $C480
        lda #4
        sta $C400
        sta $C480
        rts
clear_text:
        lda #$A0
        ldx #0
clear_byte:
        sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne clear_byte
        rts

; Descriptors: destination word, payload length word, DOS sector coordinates.
; A single $0900 buffer strips the DOS binary header and supports unaligned
; destinations. Game counters at $E0-$FF survive subsequent level loads.
load_file:
        asl
        tax
        lda file_table,x
        sta $08
        lda file_table+1,x
        sta $09
        ldy #0
        lda ($08),y
        sta $06
        iny
        lda ($08),y
        sta $07
        iny
        lda ($08),y
        sta $0A
        iny
        lda ($08),y
        sta $0B
        iny
        sty descriptor_offset
        lda #4
        sta buffer_offset
file_sector:
        ldy descriptor_offset
        lda ($08),y
        sta requested_track
        iny
        lda ($08),y
        sta requested_sector
        iny
        sty descriptor_offset
        jsr read_sector
        ldx buffer_offset
        ldy #0
copy_byte:
        lda $0900,x
        sta ($06),y
        inc $06
        bne copied
        inc $07
copied:
        lda $0A
        bne count_byte
        dec $0B
count_byte:
        dec $0A
        lda $0A
        ora $0B
        beq file_done
        inx
        bne copy_byte
        stz buffer_offset
        bra file_sector
file_done:
        rts

read_sector:
        ldx slot
        stx $2B
        lda $C08A,x
        lda $C08E,x
        lda $C08C,x
        lda $C089,x
        lda requested_track
        asl
        sta wanted_half
seek_track:
        lda half_track
        cmp wanted_half
        beq at_track
        and #3
        asl
        ora slot
        tax
        lda $C080,x
        lda half_track
        cmp wanted_half
        bcs seek_out
        inc half_track
        bra seek_phase
seek_out:
        dec half_track
seek_phase:
        lda half_track
        and #3
        asl
        ora #1
        ora slot
        tax
        lda $C080,x
        lda #$FF
        jsr $FCA8
        bra seek_track
at_track:
        lda requested_sector
        sta $3D
        inc
        sta $0800
        lda requested_track
        sta $41
        stz $26
        lda #9
        sta $27
        ldx slot
        jmp $C65C
sector_done:
        rts
motor_off:
        ldx slot
        lda $C088,x
        rts

slot:             .byte 0
half_track:       .byte 0
wanted_half:      .byte 0
requested_track:  .byte 0
requested_sector: .byte 0
descriptor_offset:.byte 0
buffer_offset:    .byte 0
saved_irq:        .word 0
saved_via_ier:    .byte 0
random_state:     .word 0
level:            .byte 0
lives_glyph:      .byte 0
speed:            .byte 0
difficulty:       .byte 0
goal:             .byte 0
key_x:            .byte 0
key_y:            .byte 0
key_fire:         .byte 0
exit_requested:   .byte 0
sound_sweeps:     .byte 0
sound_step:       .byte 0
enemy_index:      .byte 0
enemy_positions:  .byte $AF,$B2,$B5
direction_keys:   .byte 'A','D','W','S',8,21,11,10
keyboard_x:       .byte 127,0,105,105,127,0,105,105
keyboard_y:       .byte 105,105,127,0,105,105,127,0
death_sound:      .byte 0,0,0,0,0,0,0,7,15,15,15,0,16,0,0,0
loading_message:  .asciiz "LOADING POPEYE - RELEASE KEYS"
game_over_message:.asciiz "GAME OVER - PRESS A KEY OR START"
controls:
        .text "  POPEYE FOR 3RIC - PRESS A KEY/START   "
        .text "  WASD/ARROWS: MOVE   X: STOP           "
        .text "  SPACE: PUNCH   Q/ESC: EXIT            "
        .text "  SNES: D-PAD + B/A/X                   "
; Generated file_table and descriptors follow.
