; 3RIC GROOVEBOX -- six voices, two AY chips, sixteen steps.
; Assemble & Run in 3RIC Studio, or BRUN GROOVEBOX.PRG 0800.
;
; SNES P1: D-pad move, A step, B/Y note +/-, X mute, Select sound,
;          Start stop/restart, L/R tempo. Face buttons are edge-triggered.
; Keys: arrows/WASD move, Space step, +/- note, M mute, I sound,
;       Enter stop/restart, [/] tempo, Q exit. Edits are RAM-only.
; Browser audio needs native 1x and one click/key to unlock sound.
;
; Left AY: bass, lead, arp. Right AY: kick, snare, hat.
; Snare/hat share the right AY noise generator, as on the physical board.
; Periods and Timer 1 use 3RIC PHI2 = 25.175 MHz / 16, not Apple II timing.

        .org $0800

KBD             = $C000
KBD_STROBE      = $C010
TEXT_SW         = $C051
FULL_SW         = $C052
PAGE1_SW        = $C054
PTRIG           = $C070
JOYMODE         = $CE15
GAMEPAD1        = $CEE0
MB              = $C400
ORB             = 0
ORA             = 1
DDRB            = 2
DDRA            = 3
T1CL            = 4
T1CH            = 5
ACR             = 11
IFR             = 13
IER             = 14
TIMER_LATCH     = 6555
STEP_PHASE      = 3600
BPM_MIN         = 60
BPM_MAX         = 180
NOTE_MAX        = 24
VOICE_COUNT     = 6
STEP_COUNT      = 16
NAV_DELAY       = 18
NAV_REPEAT      = 5

SCREEN_PTR      = $06
STRING_PTR      = $08
STATUS_LINE     = $0500
PLAYHEAD_LINE   = $0600
EDIT_LINE       = $06A8
SOUND_LINE      = $0728

; Separate workspace: the program image must end before $6000.
STATE           = $6000
step_notes      = STATE
step_on         = STATE+$60
muted           = STATE+$C0
presets         = STATE+$C6
volumes         = STATE+$CC
envelope_count  = STATE+$D2
envelope_gap    = STATE+$D8
tone_low        = STATE+$DE
tone_high       = STATE+$E4
pad_previous    = STATE+$EA
pad_edges       = STATE+$F6
saved_joymode   = STATE+$110
cursor_track    = STATE+$111
cursor_step     = STATE+$112
play_step       = STATE+$113
playing         = STATE+$114
bpm             = STATE+$115
phase_low       = STATE+$116
phase_high      = STATE+$117
tick_counter    = STATE+$118
nav_direction   = STATE+$119
nav_countdown   = STATE+$11A
editor_dirty    = STATE+$11B
quit_requested  = STATE+$11C
ay_value        = STATE+$130
draw_step       = STATE+$131
draw_inverse    = STATE+$132
draw_glyph      = STATE+$133
init_remaining  = STATE+$134
screen_row      = STATE+$135
next_direction  = STATE+$136
step_triggered  = STATE+$137
patch_offset    = STATE+$138

start:
        php
        sei
        cld
        ldx #0
clear_state:
        stz STATE,x
        stz STATE+$100,x
        inx
        bne clear_state
        lda JOYMODE
        sta saved_joymode
        stz JOYMODE
        bit KBD_STROBE
        bit TEXT_SW
        bit FULL_SW
        bit PAGE1_SW
        jsr init_sound
        jsr init_pattern
        lda #120
        sta bpm
        lda #1
        sta playing
        jsr draw_screen
        jsr draw_pattern
        jsr render_editor
        jsr play_current_step
        jsr show_playhead

        ; The ROM NMI performs the real SNES serial scan, even under SEI.
        bit PTRIG
        ldx #11
seed_pad:
        lda GAMEPAD1,x
        sta pad_previous,x
        dex
        bpl seed_pad

        lda #$40
        sta MB+ACR
        lda #<TIMER_LATCH
        sta MB+T1CL
        lda #>TIMER_LATCH
        sta MB+T1CH
        lda #$C0
        sta MB+IER

        ; Masked IRQ wakes a 65C02 WAI without entering the ROM IRQ handler.
        ; Other NMI wakeups must not be mistaken for a Timer 1 tick.
main_wait:
        wai
        lda MB+IFR
        and #$40
        beq main_wait
        bit MB+T1CL
        inc tick_counter
        stz step_triggered
        jsr tick_envelopes
        jsr tick_transport
        lda tick_counter
        and #3
        bne input_done
        jsr poll_keyboard
        jsr poll_gamepad
        ; Defer detail fields when a six-voice trigger used this tick's budget.
        lda step_triggered
        bne input_done
        lda editor_dirty
        beq input_done
        jsr render_editor
input_done:
        lda quit_requested
        beq main_wait
        jsr silence_all
        lda #$7F
        sta MB+IER
        sta MB+$80+IER
        stz MB+ACR
        bit MB+T1CL
        lda saved_joymode
        sta JOYMODE
        plp
        brk

init_sound:
        ldx #0
        jsr reset_chip
        ldx #$80
        jsr reset_chip
        ldx #0
        ldy #7
        lda #$38
        jsr ay_write
        ldx #3
        lda #$0C
        jsr ay_write
        ldy #6
        lda #8
        jmp ay_write

reset_chip:
        lda #$7F
        sta MB+IER,x
        sta MB+IFR,x
        stz MB+ACR,x
        stz MB+ORB,x
        lda #$FF
        sta MB+DDRA,x
        lda #7
        sta MB+DDRB,x
        stz MB+ORB,x
        lda #4
        sta MB+ORB,x
        rts

; X = voice, Y = AY register, A = data. Preserve X/Y.
; BDIR falling edges latch both the register address and its data.
ay_write:
        sta ay_value
        phx
        lda chip_offsets,x
        tax
        tya
        sta MB+ORA,x
        lda #7
        sta MB+ORB,x
        lda #4
        sta MB+ORB,x
        lda ay_value
        sta MB+ORA,x
        lda #6
        sta MB+ORB,x
        lda #4
        sta MB+ORB,x
        plx
        rts

write_tone:
        ldy tone_registers,x
        lda tone_low,x
        jsr ay_write
        iny
        lda tone_high,x
        jmp ay_write

write_volume:
        ldy volume_registers,x
        lda volumes,x
        jsr ay_write
        jmp draw_meter

silence_all:
        ldx #5
silence_voice:
        stz volumes,x
        stz envelope_count,x
        jsr write_volume
        dex
        bpl silence_voice
        rts

init_pattern:
        ldx #0
init_track:
        ldy track_offsets,x
        lda #16
        sta init_remaining
init_cell:
        lda demo_steps,y
        beq init_rest
        sta step_notes,y
        lda #1
        sta step_on,y
        bra init_next
init_rest:
        lda default_notes,x
        sta step_notes,y
init_next:
        iny
        dec init_remaining
        bne init_cell
        inx
        cpx #VOICE_COUNT
        bne init_track
        rts

; X = voice, A = note (1..24). Hats use the value as a noise period.
trigger_voice:
        ldy muted,x
        bne trigger_done
        cpx #5
        beq trigger_noise
        dec a
        clc
        adc note_offsets,x
        tay
        lda period_low,y
        sta tone_low,x
        lda period_high,y
        sta tone_high,x
        jsr write_tone
        bra trigger_envelope
trigger_noise:
        ldy #6
        jsr ay_write
trigger_envelope:
        lda decay_gaps,x
        ldy presets,x
        cpy #1
        beq soft_gap
        cpy #2
        bne store_gap
        asl a
        bra store_gap
soft_gap:
        inc a
store_gap:
        sta envelope_gap,x
        sta envelope_count,x
        lda peak_volumes,x
        cpy #1
        bne store_peak
        sec
        sbc #3
store_peak:
        sta volumes,x
        jmp write_volume
trigger_done:
        rts

tick_envelopes:
        ldx #5
envelope_voice:
        lda volumes,x
        beq envelope_next
        dec envelope_count,x
        bne envelope_pitch
        lda envelope_gap,x
        sta envelope_count,x
        dec volumes,x
        jsr write_volume
envelope_pitch:
        cpx #3
        bne envelope_next
        lda volumes,x
        beq envelope_next
        clc
        lda tone_low,x
        adc #32
        sta tone_low,x
        bcc kick_period_ready
        inc tone_high,x
kick_period_ready:
        jsr write_tone
envelope_next:
        dex
        bpl envelope_voice
        rts

tick_transport:
        lda playing
        beq transport_done
        clc
        lda phase_low
        adc bpm
        sta phase_low
        lda phase_high
        adc #0
        sta phase_high
        cmp #>STEP_PHASE
        bcc transport_done
        bne next_step
        lda phase_low
        cmp #<STEP_PHASE
        bcc transport_done
next_step:
        sec
        lda phase_low
        sbc #<STEP_PHASE
        sta phase_low
        lda phase_high
        sbc #>STEP_PHASE
        sta phase_high
        jsr hide_playhead
        inc play_step
        lda play_step
        and #15
        sta play_step
        jsr play_current_step
        jmp show_playhead
transport_done:
        rts

play_current_step:
        inc step_triggered
        ldx #0
play_voice:
        lda track_offsets,x
        clc
        adc play_step
        tay
        lda step_on,y
        beq play_next
        lda step_notes,y
        jsr trigger_voice
play_next:
        inx
        cpx #VOICE_COUNT
        bne play_voice
        rts

poll_keyboard:
        lda KBD
        bpl keyboard_done
        bit KBD_STROBE
        and #$7F
        ldx #17
find_key:
        cmp keyboard_keys,x
        beq found_key
        dex
        bpl find_key
keyboard_done:
        rts
found_key:
        lda keyboard_actions,x
        jmp dispatch_action

poll_gamepad:
        bit PTRIG
        ldx #11
read_pad:
        lda GAMEPAD1,x
        eor pad_previous,x
        and GAMEPAD1,x
        sta pad_edges,x
        lda GAMEPAD1,x
        sta pad_previous,x
        dex
        bpl read_pad
        jsr navigate_pad
        ; At most one fresh face/shoulder action per scan; held buttons
        ; never retrigger. Directions have their own timed repeat.
        ldx #11
find_pad_action:
        cpx #4
        bcc check_pad_edge
        cpx #8
        bcc next_pad_action
check_pad_edge:
        lda pad_edges,x
        beq next_pad_action
        lda pad_actions,x
        jmp dispatch_action
next_pad_action:
        dex
        bpl find_pad_action
        rts

navigate_pad:
        stz next_direction
        lda GAMEPAD1+4
        eor GAMEPAD1+5
        beq pad_horizontal
        lda #1
        ldx GAMEPAD1+4
        bne pad_direction_ready
        lda #2
        bra pad_direction_ready
pad_horizontal:
        lda GAMEPAD1+6
        eor GAMEPAD1+7
        beq pad_direction_ready
        lda #3
        ldx GAMEPAD1+6
        bne pad_direction_ready
        lda #4
pad_direction_ready:
        sta next_direction
        cmp nav_direction
        bne pad_new_direction
        cmp #0
        beq navigation_done
        dec nav_countdown
        bne navigation_done
        lda #NAV_REPEAT
        sta nav_countdown
        bra navigate_now
pad_new_direction:
        sta nav_direction
        lda #NAV_DELAY
        sta nav_countdown
        lda next_direction
        beq navigation_done
navigate_now:
        lda next_direction
        dec a
        jmp dispatch_action
navigation_done:
        rts

dispatch_action:
        asl a
        tax
        jmp (action_table,x)

move_up:
        jsr erase_cursor
        lda cursor_track
        bne up_no_wrap
        lda #VOICE_COUNT
up_no_wrap:
        dec a
        sta cursor_track
        bra cursor_changed
move_down:
        jsr erase_cursor
        inc cursor_track
        lda cursor_track
        cmp #VOICE_COUNT
        bcc cursor_changed
        stz cursor_track
        bra cursor_changed
move_left:
        jsr erase_cursor
        dec cursor_step
        bra wrap_step
move_right:
        jsr erase_cursor
        inc cursor_step
wrap_step:
        lda cursor_step
        and #15
        sta cursor_step
cursor_changed:
        lda #1
        sta editor_dirty
        jmp draw_cursor

selected_index:
        ldx cursor_track
        lda track_offsets,x
        clc
        adc cursor_step
        tay
        rts

toggle_step:
        jsr selected_index
        lda step_on,y
        eor #1
        sta step_on,y
        bra note_changed
note_up:
        jsr selected_index
        lda step_notes,y
        cmp #NOTE_MAX
        bcs enable_note
        inc a
        sta step_notes,y
        bra enable_note
note_down:
        jsr selected_index
        lda step_notes,y
        cmp #1
        beq enable_note
        dec a
        sta step_notes,y
enable_note:
        lda #1
        sta step_on,y
note_changed:
        jsr draw_cursor
        jsr audition_selected
        lda #1
        sta editor_dirty
        rts

audition_selected:
        lda playing
        bne audition_done
        jsr selected_index
        lda step_on,y
        beq audition_done
        lda step_notes,y
        jmp trigger_voice
audition_done:
        rts

toggle_mute:
        ldx cursor_track
        lda muted,x
        eor #1
        sta muted,x
        beq unmute_voice
        stz volumes,x
        stz envelope_count,x
        jsr write_volume
unmute_voice:
        jsr draw_mute
        jsr audition_selected
        lda #1
        sta editor_dirty
        rts

cycle_preset:
        ldx cursor_track
        inc presets,x
        lda presets,x
        cmp #3
        bcc preset_ready
        stz presets,x
preset_ready:
        jsr audition_selected
        lda #1
        sta editor_dirty
        rts

toggle_play:
        jsr hide_playhead
        jsr silence_all
        stz phase_low
        stz phase_high
        stz play_step
        lda playing
        eor #1
        sta playing
        beq play_state_ready
        jsr play_current_step
        jsr show_playhead
play_state_ready:
        lda #1
        sta editor_dirty
        rts

tempo_down:
        lda bpm
        cmp #BPM_MIN
        beq tempo_done
        sec
        sbc #5
        bra set_tempo
tempo_up:
        lda bpm
        cmp #BPM_MAX
        beq tempo_done
        clc
        adc #5
set_tempo:
        sta bpm
        lda #1
        sta editor_dirty
tempo_done:
        rts

request_quit:
        lda #1
        sta quit_requested
        rts

; Rendering touches only changed cells/fields after startup, so it fits
; between 240-Hz timer events even while scanning the ROM gamepad path.
draw_screen:
        ldx #0
        lda #$A0
clear_screen:
        sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne clear_screen
        lda #<screen_text
        sta STRING_PTR
        lda #>screen_text
        sta STRING_PTR+1
        stz screen_row
draw_text_row:
        ldx screen_row
        lda text_row_low,x
        sta SCREEN_PTR
        lda text_row_high,x
        sta SCREEN_PTR+1
        ldy #0
draw_text_char:
        lda (STRING_PTR),y
        beq text_row_done
        ora #$80
        sta (SCREEN_PTR),y
        iny
        bra draw_text_char
text_row_done:
        iny
        tya
        clc
        adc STRING_PTR
        sta STRING_PTR
        bcc text_pointer_ready
        inc STRING_PTR+1
text_pointer_ready:
        inc screen_row
        lda screen_row
        cmp #24
        bne draw_text_row
        rts

track_row:
        lda text_row_low+6,x
        sta SCREEN_PTR
        lda text_row_high+6,x
        sta SCREEN_PTR+1
        rts

draw_pattern:
        ldx #0
draw_pattern_track:
        ldy #0
draw_pattern_cell:
        phy
        lda #0
        jsr draw_cell
        ply
        iny
        cpy #STEP_COUNT
        bne draw_pattern_cell
        inx
        cpx #VOICE_COUNT
        bne draw_pattern_track
        rts

; X = track, Y = step, A = inverse selection flag. Preserve X.
draw_cell:
        sta draw_inverse
        sty draw_step
        jsr track_row
        tya
        clc
        adc track_offsets,x
        tay
        lda step_on,y
        beq draw_rest
        lda #'X'
        bra cell_character
draw_rest:
        lda #'.'
cell_character:
        ora #$80
        ldy draw_inverse
        beq cell_normal
        and #$3F
cell_normal:
        sta draw_glyph
        lda draw_step
        asl a
        clc
        adc #7
        tay
        lda draw_glyph
        sta (SCREEN_PTR),y
        rts

erase_cursor:
        ldx cursor_track
        ldy cursor_step
        lda #0
        jsr draw_cell
        ldy #0
        lda #$A0
        sta (SCREEN_PTR),y
        rts
draw_cursor:
        ldx cursor_track
        ldy cursor_step
        lda #1
        jsr draw_cell
        ldy #0
        lda #$BE
        sta (SCREEN_PTR),y
        rts

hide_playhead:
        lda #$A0
        bra draw_playhead
show_playhead:
        lda #$BE
draw_playhead:
        pha
        lda play_step
        asl a
        clc
        adc #7
        tay
        pla
        sta PLAYHEAD_LINE,y
        rts

draw_meter:
        jsr track_row
        ldy volumes,x
        lda volume_glyphs,y
        ora #$80
        ldy #39
        sta (SCREEN_PTR),y
        rts

draw_mute:
        jsr track_row
        lda muted,x
        beq draw_live_track
        lda #$CD
        bra draw_mute_marker
draw_live_track:
        lda #$A0
draw_mute_marker:
        ldy #5
        sta (SCREEN_PTR),y
        rts

; A = 0..99; return two normal-video decimal digits in X/Y.
decimal_pair:
        ldx #$B0
decimal_tens:
        cmp #10
        bcc decimal_ones
        sec
        sbc #10
        inx
        bra decimal_tens
decimal_ones:
        ora #$B0
        tay
        rts

render_editor:
        stz editor_dirty
        jsr draw_cursor
        ldx #0
        lda playing
        bne status_word
        ldx #7
status_word:
        ldy #0
status_character:
        lda transport_words,x
        ora #$80
        sta STATUS_LINE+1,y
        inx
        iny
        cpy #7
        bne status_character
        ldx #$B0
        lda bpm
        cmp #100
        bcc bpm_digits
        inx
        sec
        sbc #100
bpm_digits:
        stx STATUS_LINE+16
        jsr decimal_pair
        stx STATUS_LINE+17
        sty STATUS_LINE+18

        lda cursor_track
        asl a
        asl a
        tax
        ldy #0
track_name_character:
        lda track_names,x
        ora #$80
        sta EDIT_LINE+8,y
        inx
        iny
        cpy #4
        bne track_name_character
        lda cursor_step
        inc a
        jsr decimal_pair
        stx EDIT_LINE+21
        sty EDIT_LINE+22

        jsr selected_index
        lda step_notes,y
        cpx #5
        beq display_noise
        dec a
        clc
        adc note_offsets,x
        ldx #$B2
display_octave:
        cmp #12
        bcc display_note
        sec
        sbc #12
        inx
        bra display_octave
display_note:
        stx EDIT_LINE+34
        asl a
        tax
        lda note_names,x
        ora #$80
        sta EDIT_LINE+32
        lda note_names+1,x
        ora #$80
        sta EDIT_LINE+33
        bra display_preset
display_noise:
        jsr decimal_pair
        lda #$CE
        sta EDIT_LINE+32
        stx EDIT_LINE+33
        sty EDIT_LINE+34
display_preset:
        ldx cursor_track
        lda presets,x
        sta patch_offset
        asl a
        asl a
        clc
        adc patch_offset
        tax
        ldy #0
preset_character:
        lda preset_names,x
        ora #$80
        sta SOUND_LINE+8,y
        inx
        iny
        cpy #5
        bne preset_character

        jsr selected_index
        lda step_on,y
        beq display_step_off
        ldx #0
        bra step_word
display_step_off:
        ldx #3
step_word:
        ldy #0
step_character:
        lda step_words,x
        ora #$80
        sta SOUND_LINE+22,y
        inx
        iny
        cpy #3
        bne step_character
        ldx cursor_track
        lda muted,x
        beq display_unmuted
        ldx #4
        bra mute_word
display_unmuted:
        ldx #0
mute_word:
        ldy #0
mute_character:
        lda mute_words,x
        ora #$80
        sta SOUND_LINE+35,y
        inx
        iny
        cpy #4
        bne mute_character
        rts

action_table:
        .word move_up,move_down,move_left,move_right
        .word toggle_step,note_up,note_down,toggle_mute
        .word cycle_preset,toggle_play,tempo_down,tempo_up,request_quit
keyboard_keys:
        .byte $0B,$0A,$08,$15,"WSAD ","+=","-MI",$0D,"[]Q"
keyboard_actions:
        .byte 0,1,2,3,0,1,2,3,4,5,5,6,7,8,9,10,11,12
pad_actions:
        .byte 5,6,8,9,0,1,2,3,4,7,10,11
track_offsets:
        .byte 0,16,32,48,64,80
chip_offsets:
        .byte 0,0,0,$80,$80,$80
tone_registers:
        .byte 0,2,4,0,2,4
volume_registers:
        .byte 8,9,10,8,9,10
note_offsets:
        .byte 0,24,12,0,0,0
default_notes:
        .byte 1,13,1,13,13,4
peak_volumes:
        .byte 12,11,10,15,12,8
decay_gaps:
        .byte 2,3,2,1,2,1
volume_glyphs:
        .byte ".123456789ABCDEF"
track_names:
        .byte "BASSLEADARP KICKSNARHATS"
preset_names:
        .byte "PLUCKSOFT LONG "
note_names:
        .byte "C-C#D-D#E-F-F#G-G#A-A#B-"
transport_words:
        .byte "PLAYINGSTOPPED"
step_words:
        .byte "ON OFF"
mute_words:
        .byte "LIVEMUTE"

; Original C-minor groove. Zero means an initially disabled step.
demo_steps:
        .byte 1,0,0,0,1,0,8,0,9,0,0,0,6,0,8,0
        .byte 13,0,0,16,0,20,0,0,18,0,16,0,15,0,8,0
        .byte 1,8,13,8,4,11,16,11,9,16,21,16,6,13,18,8
        .byte 13,0,0,0,0,0,13,0,13,0,0,13,0,0,0,0
        .byte 0,0,0,0,13,0,0,0,0,0,0,0,13,0,0,0
        .byte 4,0,4,0,4,0,4,4,4,0,4,0,4,0,4,4

; C2..B5, rounded PHI2 / (16 * equal-tempered frequency).
period_low:
        .byte $E0,$8B,$3B,$F0,$A9,$66,$27,$EB,$B3,$7E,$4C,$1C
        .byte $F0,$C6,$9E,$78,$55,$33,$14,$F6,$DA,$BF,$A6,$8E
        .byte $78,$63,$4F,$3C,$2A,$1A,$0A,$FB,$ED,$DF,$D3,$C7
        .byte $BC,$B1,$A7,$9E,$95,$8D,$85,$7D,$76,$70,$69,$64
period_high:
        .byte $05,$05,$05,$04,$04,$04,$04,$03,$03,$03,$03,$03
        .byte $02,$02,$02,$02,$02,$02,$02,$01,$01,$01,$01,$01
        .byte $01,$01,$01,$01,$01,$01,$01,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00

text_row_low:
        .byte $00,$80,$00,$80,$00,$80,$00,$80
        .byte $28,$A8,$28,$A8,$28,$A8,$28,$A8
        .byte $50,$D0,$50,$D0,$50,$D0,$50,$D0
text_row_high:
        .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07
screen_text:
        .byte "           3RIC GROOVEBOX",0
        .byte " SIX VOICES / TWO AY CHIPS / 16 STEPS",0
        .byte " PLAYING    BPM 120       NATIVE 1X",0
        .byte "       1 . . . 2 . . . 3 . . . 4 . . .",0
        .byte "",0
        .byte " VOICE                               VOL",0
        .byte " BASS L",0
        .byte " LEAD L",0
        .byte " ARP  L",0
        .byte " KICK R",0
        .byte " SNAR R",0
        .byte " HATS R",0
        .byte " LEFT: MELODY      RIGHT: DRUMS",0
        .byte " VOICE: BASS   STEP: 01   NOTE: C-2",0
        .byte " SOUND: PLUCK   STEP: ON    TRACK: LIVE",0
        .byte " DPAD: MOVE  A: STEP  B/Y: NOTE +/-",0
        .byte " X: MUTE  SELECT: SOUND  START: PLAY",0
        .byte " L/R: BPM   (SNES BUTTON LABELS)",0
        .byte "",0
        .byte " ARROWS/WASD: MOVE   SPACE: STEP",0
        .byte " +/-: NOTE   I: SOUND   M: MUTE",0
        .byte " ENTER: PLAY/STOP  [/]: BPM  Q: EXIT",0
        .byte " EDITS ARE RAM ONLY. RELOAD = DEMO.",0
        .byte " BROWSER: CLICK FOR SOUND; USE 1X.",0
program_end:
