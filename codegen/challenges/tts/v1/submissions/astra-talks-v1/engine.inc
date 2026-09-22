; SPDX-License-Identifier: MIT
; COPPER VOICE - original GPT-6 Astra 65C02 speech engine.
; Source template for generate.mjs; generated tts.s is standalone.
; AY protocol follows the permitted 3RIC Groovebox hardware reference.
        .org $0800
        jmp app_start

SRC = $06
RULE = $08
OUT = $0A
PLAY = $0C
MB = $C400
KBD = $C000
STROBE = $C010

TTS_INIT:
        php
        sei
        cld
        bit $C082
        ldx #0
        jsr chip_init
        ldx #$80
        jsr chip_init
        jsr silence
        bit $C006
        plp
        rts

chip_init:
        lda #$7F
        sta MB+14,x
        sta MB+13,x
        stz MB+11,x
        stz MB,x
        lda #$FF
        sta MB+3,x
        lda #7
        sta MB+2,x
        stz MB,x
        nop
        nop
        lda #4
        sta MB,x
        rts

; Y register, A value; simultaneous identical writes to both AYs.
ay_write:
        sta ay_data
        tya
        sta MB+1
        sta MB+$81
        lda #7
        sta MB
        sta MB+$80
        lda #4
        sta MB
        sta MB+$80
        lda ay_data
        sta MB+1
        sta MB+$81
        lda #6
        sta MB
        sta MB+$80
        lda #4
        sta MB
        sta MB+$80
        rts

silence:
        ldy #8
        lda #0
        jsr ay_write
        iny
        lda #0
        jsr ay_write
        iny
        lda #0
        jsr ay_write
        ldy #7
        lda #$3F
        jsr ay_write
        lda #$7F
        sta MB+14
        sta MB+$8E
        sta MB+13
        sta MB+$8D
        stz MB+11
        bit MB+4
        rts

TTS_SPEAK:
        sta supplied_low
        stx supplied_high
        php
        sei
        cld
        jsr TTS_INIT
        ldx #7
save_zp:
        lda SRC,x
        sta saved_zp,x
        dex
        bpl save_zp
        lda supplied_low
        sta SRC
        lda supplied_high
        sta SRC+1
        stz result_code
        stz has_letters
        bit $C007
        ldy #0
validate_loop:
        tya
        clc
        adc SRC
        lda SRC+1
        adc #0
        cmp #$C0
        bcs invalid_input
        lda (SRC),y
        beq validated
        cpy #120
        beq invalid_input
        jsr normalize
        jsr allowed
        bcs invalid_input
        sta normalized,y
        cmp #'A'
        bcc validate_next
        cmp #'Z'+1
        bcs validate_next
        inc has_letters
validate_next:
        iny
        bra validate_loop
invalid_input:
        lda #2
        sta result_code
        jmp speak_done
validated:
        lda #0
        sta normalized,y
        lda has_letters
        beq empty_input
        lda #<phone_queue
        sta OUT
        lda #>phone_queue
        sta OUT+1
        stz text_pos
        jsr compile_text
        lda #$FF
        jsr emit_phone
        lda result_code
        bne empty_input
        lda #<phone_queue
        sta PLAY
        lda #>phone_queue
        sta PLAY+1
        lda #$40
        sta MB+11
        lda #199
        sta MB+4
        lda #0
        sta MB+5
        jsr play_queue
empty_input:
        jmp speak_done
speak_done:
        jsr silence
        ldx #7
restore_zp:
        lda saved_zp,x
        sta SRC,x
        dex
        bpl restore_zp
        bit $C006
        plp
        lda result_code
        rts

normalize:
        cmp #'a'
        bcc normalize_done
        cmp #'z'+1
        bcs normalize_done
        and #$DF
normalize_done:
        rts

; Preserve A, X, Y; carry is set for unsupported bytes.
allowed:
        cmp #'A'
        bcc allowed_punctuation
        cmp #'Z'+1
        bcc allowed_yes
allowed_punctuation:
        cmp #' '
        beq allowed_yes
        cmp #39
        beq allowed_yes
        cmp #'-'
        beq allowed_yes
        cmp #'.'
        beq allowed_yes
        cmp #','
        beq allowed_yes
        cmp #'?'
        beq allowed_yes
        cmp #'!'
        beq allowed_yes
        sec
        rts
allowed_yes:
        clc
        rts

; A letter/apostrophe is part of a word; other supported bytes are boundaries.
word_character:
        cmp #39
        beq word_yes
        cmp #'A'
        bcc word_no
        cmp #'Z'+1
        bcs word_no
word_yes:
        sec
        rts
word_no:
        clc
        rts

compile_text:
        jsr check_cancel
        bcc compile_continue
        rts
compile_continue:
        ldx text_pos
        lda normalized,x
        bne compile_nonempty
        rts
compile_nonempty:
        jsr word_character
        bcs collect_word
        inc text_pos
        cmp #','
        beq compile_comma
        cmp #'.'
        beq compile_period
        cmp #'?'
        beq compile_period
        cmp #'!'
        beq compile_period
        lda #PH_GAP
        bra compile_pause
compile_comma:
        lda #PH_COMMA
        bra compile_pause
compile_period:
        lda #PH_PERIOD
compile_pause:
        jsr emit_phone
        bra compile_text
collect_word:
        ldy #0
collect_loop:
        lda normalized,x
        jsr word_character
        bcc word_collected
        sta word_buffer,y
        iny
        inx
        bra collect_loop
word_collected:
        stx text_pos
        sty word_length
        lda #0
        sta word_buffer,y
        stz word_pos
compile_word:
        jsr check_cancel
        bcc compile_word_continue
        rts
compile_word_continue:
        lda #<rule_table
        sta RULE
        lda #>rule_table
        sta RULE+1
try_rule:
        ldy #0
        lda (RULE),y
        bne rule_exists
        ; All validated letters have a fallback. Fail explicitly if data is broken.
        lda #2
        sta result_code
        rts
rule_exists:
        sta record_size
        iny
        lda (RULE),y
        sta match_length
        clc
        adc word_pos
        sta match_end
        cmp word_length
        bcc match_fits
        beq match_fits
        jmp next_rule
match_fits:
        iny
        lda (RULE),y
        sta rule_flags
        ldx word_pos
        ldy #4
        stz matched_count
match_letters:
        lda (RULE),y
        cmp word_buffer,x
        bne next_rule
        inx
        iny
        inc matched_count
        lda matched_count
        cmp match_length
        bne match_letters
        jsr match_context
        bcc next_rule
        ldy #3
        lda (RULE),y
        sta output_remaining
        lda match_length
        clc
        adc #4
        tay
rule_output:
        lda output_remaining
        beq rule_finished
        lda (RULE),y
        jsr emit_phone
        iny
        dec output_remaining
        bra rule_output
rule_finished:
        lda match_end
        sta word_pos
        cmp word_length
        beq compiled_word
        jmp compile_word
compiled_word:
        jmp compile_text
next_rule:
        clc
        lda RULE
        adc record_size
        sta RULE
        bcc next_rule_ready
        inc RULE+1
next_rule_ready:
        jmp try_rule

match_context:
        lda rule_flags
        and #1
        beq context_end
        lda word_pos
        beq context_end
        clc
        rts
context_end:
        lda rule_flags
        and #2
        beq context_front
        lda match_end
        cmp word_length
        bne context_reject_early
context_front:
        lda rule_flags
        and #4
        beq context_vowel
        ldx match_end
        lda word_buffer,x
        cmp #'E'
        beq context_vowel
        cmp #'I'
        beq context_vowel
        cmp #'Y'
        bne context_reject_early
context_vowel:
        lda rule_flags
        and #8
        beq context_magic_e
        ldx match_end
        lda word_buffer,x
        jsr is_vowel
        bcc context_reject_early
context_magic_e:
        lda rule_flags
        and #16
        beq context_previous
        ldx match_end
        lda word_buffer,x
        jsr is_vowel
        bcs context_no
        cmp #'A'
        bcc context_no
        cmp #'Z'+1
        bcs context_no
        inx
        lda word_buffer,x
        cmp #'E'
        bne context_no
        inx
        cpx word_length
        bne context_no
        bra context_previous
context_reject_early:
        clc
        rts
context_previous:
        lda rule_flags
        and #32
        beq context_noninitial
        ldx word_pos
        beq context_no
        dex
        lda word_buffer,x
        jsr is_vowel
        bcc context_no
context_noninitial:
        lda rule_flags
        and #64
        beq context_open
        ldx word_pos
context_prior_loop:
        cpx #0
        beq context_no
        dex
        lda word_buffer,x
        jsr is_vowel
        bcc context_prior_loop
context_open:
        lda rule_flags
        and #128
        beq context_yes
        ldx match_end
        lda word_buffer,x
        jsr is_vowel
        bcs context_no
        cmp #'A'
        bcc context_no
        cmp #'Z'+1
        bcs context_no
        inx
        lda word_buffer,x
        jsr is_vowel
        bcc context_no
context_yes:
        sec
        rts
context_no:
        clc
        rts
is_vowel:
        cmp #'A'
        beq vowel_yes
        cmp #'E'
        beq vowel_yes
        cmp #'I'
        beq vowel_yes
        cmp #'O'
        beq vowel_yes
        cmp #'U'
        beq vowel_yes
        cmp #'Y'
        beq vowel_yes
        clc
        rts
vowel_yes:
        sec
        rts

emit_phone:
        phx
        phy
        ldx OUT+1
        cpx #>phone_queue_end
        bcs queue_overflow
        ldy #0
        sta (OUT),y
        inc OUT
        bne emit_done
        inc OUT+1
emit_done:
        ply
        plx
        rts
queue_overflow:
        lda #2
        sta result_code
        bra emit_done

check_cancel:
        lda KBD
        cmp #$9B
        bne no_cancel
        bit STROBE
        lda #1
        sta result_code
        sec
        rts
no_cancel:
        clc
        rts

play_queue:
        ldy #0
        lda (PLAY),y
        cmp #$FF
        bne play_phone
        rts
play_phone:
        tax
        and #$7F
        sta current_phone
        tay
        lda wave_repeats,y
        cpx #$80
        bcc duration_ready
        lda #2
duration_ready:
        sta repetitions
repeat_wave:
        ldy current_phone
        lda wave_low_pages,y
        sta sample_a+2
        lda wave_high_pages,y
        sta sample_b+2
        lda wave_pages,y
        sta pages_remaining
        ldx #0
sample_wait:
        lda KBD
        bpl sample_clock
        and #$7F
        cmp #27
        bne sample_discard
        jmp play_cancel
sample_discard:
        bit STROBE
sample_clock:
        lda MB+13
        and #$40
        beq sample_wait
        bit MB+4
sample_tick:
        lda #8
        sta MB+1
        sta MB+$81
        lda #7
        sta MB
        sta MB+$80
        lda #4
        sta MB
        sta MB+$80
sample_a:
        lda $3000,x
        sta MB+1
        sta MB+$81
        lda #6
        sta MB
        sta MB+$80
        lda #4
        sta MB
        sta MB+$80
        lda #9
        sta MB+1
        sta MB+$81
        lda #7
        sta MB
        sta MB+$80
        lda #4
        sta MB
        sta MB+$80
sample_b:
        lda $3100,x
        sta MB+1
        sta MB+$81
        lda #6
        sta MB
        sta MB+$80
        lda #4
        sta MB
        sta MB+$80
        inx
        bne sample_wait
        dec pages_remaining
        beq wave_finished
        inc sample_a+2
        inc sample_b+2
        jmp sample_wait
wave_finished:
        dec repetitions
        beq phone_finished
        jmp repeat_wave
phone_finished:
        inc PLAY
        bne queue_next
        inc PLAY+1
queue_next:
        jmp play_queue
play_cancel:
        bit STROBE
        lda #1
        sta result_code
        rts

app_start:
        jsr TTS_INIT
        bit $C051
        bit $C054
        bit $C052
        bit STROBE
        ldx #0
        lda #$A0
clear_screen:
        sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne clear_screen
        ldx #0
draw_header:
        lda title_text,x
        ora #$80
        sta $0400,x
        lda help_text,x
        ora #$80
        sta $0480,x
        inx
        cpx #40
        bne draw_header
        stz input_length
        stz TTS_INPUT
        jsr ready_status
        jsr draw_input
input_wait:
        lda KBD
        bpl input_wait
        and #$7F
        bit STROBE
        cmp #27
        bne input_not_exit
        jsr silence
        jsr $FC58
        brk
input_not_exit:
        cmp #13
        beq input_speak
        cmp #8
        beq input_delete
        cmp #127
        beq input_delete
        jsr normalize
        jsr allowed
        bcs input_bad
        ldx input_length
        cpx #120
        beq input_full
        sta TTS_INPUT,x
        inx
        stx input_length
        stz TTS_INPUT,x
        jsr ready_status
        jsr draw_input
        bra input_wait
input_delete:
        ldx input_length
        beq input_wait
        dex
        stx input_length
        stz TTS_INPUT,x
        jsr ready_status
        jsr draw_input
        bra input_wait
input_bad:
        ldx #80
        jsr show_status
        bra input_wait
input_full:
        ldx #40
        jsr show_status
        bra input_wait
input_speak:
        ldx #120
        jsr show_status
        lda #<TTS_INPUT
        ldx #>TTS_INPUT
        jsr TTS_SPEAK
        cmp #1
        beq input_cancelled
        cmp #2
        beq input_bad
        stz input_length
        stz TTS_INPUT
        jsr ready_status
        jsr draw_input
        jmp input_wait
input_cancelled:
        ldx #160
        jsr show_status
        jmp input_wait
ready_status:
        ldx #0
show_status:
        ldy #0
status_loop:
        lda status_text,x
        ora #$80
        sta $0500,y
        inx
        iny
        cpy #40
        bne status_loop
        rts

draw_input:
        stz draw_row
        stz draw_index
draw_row_start:
        ldx draw_row
        lda input_rows_low,x
        sta screen_store+1
        lda input_rows_high,x
        sta screen_store+2
        ldy #0
draw_cell:
        ldx draw_index
        cpx input_length
        bcc draw_letter
        beq draw_cursor
        lda #$A0
        bra draw_store
draw_cursor:
        lda #$DF
        bra draw_store
draw_letter:
        lda TTS_INPUT,x
        ora #$80
draw_store:
screen_store:
        sta $0700,y
        inc draw_index
        iny
        cpy #40
        bne draw_cell
        inc draw_row
        lda draw_row
        cmp #4
        bne draw_row_start
        rts

title_text: .text "ASTRA / COPPER VOICE - 3RIC TALKS V1    "
help_text: .text "ENTER SPEAKS   DELETE EDITS   ESC EXITS "
status_text:
        .text "READY: A-Z SPACE ' - . , ? !            "
        .text "FULL: 120 CHARACTERS. DELETE TO EDIT.   "
        .text "INVALID KEY: USE LETTERS OR PUNCTUATION."
        .text "SPEAKING... ESC CANCELS                 "
        .text "CANCELLED. EDIT OR PRESS ENTER AGAIN.   "
input_rows_low: .byte <$0700,<$0780,<$0428,<$04A8
input_rows_high: .byte >$0700,>$0780,>$0428,>$04A8
ay_data: .byte 0
supplied_low: .byte 0
supplied_high: .byte 0
saved_zp: .res 8
result_code: .byte 0
has_letters: .byte 0
text_pos: .byte 0
word_length: .byte 0
word_pos: .byte 0
record_size: .byte 0
match_length: .byte 0
match_end: .byte 0
rule_flags: .byte 0
matched_count: .byte 0
output_remaining: .byte 0
current_phone: .byte 0
repetitions: .byte 0
pages_remaining: .byte 0
input_length: .byte 0
draw_row: .byte 0
draw_index: .byte 0
TTS_INPUT: .res 122
normalized: .res 122
word_buffer: .res 122
        .org $1800
phone_queue: .res 512
phone_queue_end:
