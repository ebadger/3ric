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

; Generated original rule and phoneme data. Regenerate with generate.mjs.
PH_GAP = 0
PH_COMMA = 1
PH_PERIOD = 2
PH_CLOSE = 3
PH_AA = 4
PH_AE = 5
PH_EH = 6
PH_IH = 7
PH_IY = 8
PH_AO = 9
PH_UH = 10
PH_UW = 11
PH_AH = 12
PH_ER = 13
PH_AX = 14
PH_L = 15
PH_R = 16
PH_W = 17
PH_Y = 18
PH_M = 19
PH_N = 20
PH_NG = 21
PH_B = 22
PH_D = 23
PH_G = 24
PH_P = 25
PH_T = 26
PH_K = 27
PH_F = 28
PH_V = 29
PH_TH = 30
PH_DH = 31
PH_S = 32
PH_Z = 33
PH_SH = 34
PH_ZH = 35
PH_HH = 36
rule_table:
; THROUGH -> TH R UW; context 3
        .byte 14,7,3,3,84,72,82,79,85,71,72,30,16,11
; SHOULD -> SH UH PD; context 3
        .byte 14,6,3,4,83,72,79,85,76,68,34,10,3,23
; THOUGH -> DH OW; context 3
        .byte 13,6,3,3,84,72,79,85,71,72,31,137,139
; ENOUGH -> IH N AH F; context 3
        .byte 14,6,3,4,69,78,79,85,71,72,7,20,12,28
; THESE -> DH IY Z; context 3
        .byte 12,5,3,3,84,72,69,83,69,31,8,33
; THOSE -> DH OW Z; context 3
        .byte 13,5,3,4,84,72,79,83,69,31,137,139,33
; THEIR -> DH EH R; context 3
        .byte 12,5,3,3,84,72,69,73,82,31,6,16
; THERE -> DH EH R; context 3
        .byte 12,5,3,3,84,72,69,82,69,31,6,16
; WOULD -> W UH PD; context 3
        .byte 13,5,3,4,87,79,85,76,68,17,10,3,23
; COULD -> PK UH PD; context 3
        .byte 14,5,3,5,67,79,85,76,68,3,27,10,3,23
; TIOUS -> SH AX S; context 2
        .byte 12,5,2,3,84,73,79,85,83,34,14,32
; CIOUS -> SH AX S; context 2
        .byte 12,5,2,3,67,73,79,85,83,34,14,32
; THIS -> DH IH S; context 3
        .byte 11,4,3,3,84,72,73,83,31,7,32
; THAT -> DH AE PT; context 3
        .byte 12,4,3,4,84,72,65,84,31,5,3,26
; THEY -> DH EY; context 3
        .byte 11,4,3,3,84,72,69,89,31,134,136
; YOUR -> Y AO R; context 3
        .byte 11,4,3,3,89,79,85,82,18,9,16
; WERE -> W ER; context 3
        .byte 10,4,3,2,87,69,82,69,17,13
; HAVE -> HH AE V; context 3
        .byte 11,4,3,3,72,65,86,69,36,5,29
; SAID -> S EH PD; context 3
        .byte 12,4,3,4,83,65,73,68,32,6,3,23
; SAYS -> S EH Z; context 3
        .byte 11,4,3,3,83,65,89,83,32,6,33
; SOME -> S AH M; context 3
        .byte 11,4,3,3,83,79,77,69,32,12,19
; COME -> PK AH M; context 3
        .byte 12,4,3,4,67,79,77,69,3,27,12,19
; DONE -> PD AH N; context 3
        .byte 12,4,3,4,68,79,78,69,3,23,12,20
; DOES -> PD AH Z; context 3
        .byte 12,4,3,4,68,79,69,83,3,23,12,33
; WHAT -> W AH PT; context 3
        .byte 12,4,3,4,87,72,65,84,17,12,3,26
; TION -> SH AX N; context 2
        .byte 11,4,2,3,84,73,79,78,34,14,20
; SION -> ZH AX N; context 2
        .byte 11,4,2,3,83,73,79,78,35,14,20
; TURE -> CH ER; context 2
        .byte 12,4,2,4,84,85,82,69,3,26,34,13
; SURE -> ZH ER; context 2
        .byte 10,4,2,2,83,85,82,69,35,13
; IGHT -> AY PT; context 2
        .byte 12,4,2,4,73,71,72,84,132,135,3,26
; OULD -> UH L PD; context 2
        .byte 12,4,2,4,79,85,76,68,10,15,3,23
; THE -> DH AX; context 3
        .byte 9,3,3,2,84,72,69,31,14
; YOU -> Y UW; context 3
        .byte 9,3,3,2,89,79,85,18,11
; ONE -> W AH N; context 3
        .byte 10,3,3,3,79,78,69,17,12,20
; TWO -> PT UW; context 3
        .byte 10,3,3,3,84,87,79,3,26,11
; WAS -> W AH Z; context 3
        .byte 10,3,3,3,87,65,83,17,12,33
; ARE -> AA R; context 3
        .byte 9,3,3,2,65,82,69,4,16
; WHO -> HH UW; context 3
        .byte 9,3,3,2,87,72,79,36,11
; NOW -> N AW; context 3
        .byte 10,3,3,3,78,79,87,20,133,139
; HOW -> HH AW; context 3
        .byte 10,3,3,3,72,79,87,36,133,139
; COW -> PK AW; context 3
        .byte 11,3,3,4,67,79,87,3,27,133,139
; ING -> IH NG; context 2
        .byte 9,3,2,2,73,78,71,7,21
; TED -> PT IH PD; context 66
        .byte 12,3,66,5,84,69,68,3,26,7,3,23
; DED -> PD IH PD; context 66
        .byte 12,3,66,5,68,69,68,3,23,7,3,23
; SES -> S IH Z; context 2
        .byte 10,3,2,3,83,69,83,32,7,33
; ZES -> Z IH Z; context 2
        .byte 10,3,2,3,90,69,83,33,7,33
; OUS -> AX S; context 2
        .byte 9,3,2,2,79,85,83,14,32
; TCH -> CH; context 0
        .byte 10,3,0,3,84,67,72,3,26,34
; DGE -> J; context 0
        .byte 10,3,0,3,68,71,69,3,23,35
; SCH -> S PK; context 0
        .byte 10,3,0,3,83,67,72,32,3,27
; IGH -> AY; context 0
        .byte 9,3,0,2,73,71,72,132,135
; WOR -> W ER; context 0
        .byte 9,3,0,2,87,79,82,17,13
; AIR -> EH R; context 0
        .byte 9,3,0,2,65,73,82,6,16
; ALK -> AO PK; context 0
        .byte 10,3,0,3,65,76,75,9,3,27
; ALL -> AO L; context 0
        .byte 9,3,0,2,65,76,76,9,15
; OLD -> OW L PD; context 0
        .byte 12,3,0,5,79,76,68,137,139,15,3,23
; OF -> AH V; context 3
        .byte 8,2,3,2,79,70,12,29
; TO -> PT UW; context 3
        .byte 9,2,3,3,84,79,3,26,11
; DO -> PD UW; context 3
        .byte 9,2,3,3,68,79,3,23,11
; ED -> PD; context 66
        .byte 8,2,66,2,69,68,3,23
; LY -> L IY; context 2
        .byte 8,2,2,2,76,89,15,8
; LE -> AX L; context 66
        .byte 8,2,66,2,76,69,14,15
; CH -> CH; context 0
        .byte 9,2,0,3,67,72,3,26,34
; SH -> SH; context 0
        .byte 7,2,0,1,83,72,34
; TH -> TH; context 0
        .byte 7,2,0,1,84,72,30
; PH -> F; context 0
        .byte 7,2,0,1,80,72,28
; WH -> W; context 0
        .byte 7,2,0,1,87,72,17
; QU -> PK W; context 0
        .byte 9,2,0,3,81,85,3,27,17
; CK -> PK; context 0
        .byte 8,2,0,2,67,75,3,27
; NG -> NG; context 0
        .byte 7,2,0,1,78,71,21
; NK -> NG PK; context 0
        .byte 9,2,0,3,78,75,21,3,27
; WR -> R; context 1
        .byte 7,2,1,1,87,82,16
; KN -> N; context 1
        .byte 7,2,1,1,75,78,20
; GN -> N; context 1
        .byte 7,2,1,1,71,78,20
; MB -> M; context 2
        .byte 7,2,2,1,77,66,19
; EE -> IY; context 0
        .byte 7,2,0,1,69,69,8
; EA -> IY; context 0
        .byte 7,2,0,1,69,65,8
; OO -> UW; context 0
        .byte 7,2,0,1,79,79,11
; AI -> EY; context 0
        .byte 8,2,0,2,65,73,134,136
; AY -> EY; context 0
        .byte 8,2,0,2,65,89,134,136
; OA -> OW; context 0
        .byte 8,2,0,2,79,65,137,139
; OE -> OW; context 0
        .byte 8,2,0,2,79,69,137,139
; OI -> OY; context 0
        .byte 8,2,0,2,79,73,137,135
; OY -> OY; context 0
        .byte 8,2,0,2,79,89,137,135
; AU -> AO; context 0
        .byte 7,2,0,1,65,85,9
; AW -> AO; context 0
        .byte 7,2,0,1,65,87,9
; OU -> AW; context 0
        .byte 8,2,0,2,79,85,133,139
; OW -> OW; context 2
        .byte 8,2,2,2,79,87,137,139
; OW -> AW; context 0
        .byte 8,2,0,2,79,87,133,139
; EW -> Y UW; context 0
        .byte 8,2,0,2,69,87,18,11
; UE -> UW; context 2
        .byte 7,2,2,1,85,69,11
; IE -> AY; context 2
        .byte 8,2,2,2,73,69,132,135
; IE -> IY; context 0
        .byte 7,2,0,1,73,69,8
; EI -> EY; context 0
        .byte 8,2,0,2,69,73,134,136
; GH -> (silent); context 66
        .byte 6,2,66,0,71,72
; AR -> AA R; context 0
        .byte 8,2,0,2,65,82,4,16
; OR -> AO R; context 0
        .byte 8,2,0,2,79,82,9,16
; ER -> ER; context 0
        .byte 7,2,0,1,69,82,13
; IR -> ER; context 0
        .byte 7,2,0,1,73,82,13
; UR -> ER; context 0
        .byte 7,2,0,1,85,82,13
; BB -> PB; context 0
        .byte 8,2,0,2,66,66,3,22
; CC -> PK; context 0
        .byte 8,2,0,2,67,67,3,27
; DD -> PD; context 0
        .byte 8,2,0,2,68,68,3,23
; FF -> F; context 0
        .byte 7,2,0,1,70,70,28
; GG -> PG; context 0
        .byte 8,2,0,2,71,71,3,24
; HH -> HH; context 0
        .byte 7,2,0,1,72,72,36
; JJ -> J; context 0
        .byte 9,2,0,3,74,74,3,23,35
; KK -> PK; context 0
        .byte 8,2,0,2,75,75,3,27
; LL -> L; context 0
        .byte 7,2,0,1,76,76,15
; MM -> M; context 0
        .byte 7,2,0,1,77,77,19
; NN -> N; context 0
        .byte 7,2,0,1,78,78,20
; PP -> PP; context 0
        .byte 8,2,0,2,80,80,3,25
; QQ -> PK; context 0
        .byte 8,2,0,2,81,81,3,27
; RR -> R; context 0
        .byte 7,2,0,1,82,82,16
; SS -> S; context 0
        .byte 7,2,0,1,83,83,32
; TT -> PT; context 0
        .byte 8,2,0,2,84,84,3,26
; VV -> V; context 0
        .byte 7,2,0,1,86,86,29
; WW -> W; context 0
        .byte 7,2,0,1,87,87,17
; XX -> PK S; context 0
        .byte 9,2,0,3,88,88,3,27,32
; ZZ -> Z; context 0
        .byte 7,2,0,1,90,90,33
; A -> AX; context 3
        .byte 6,1,3,1,65,14
; I -> AY; context 3
        .byte 7,1,3,2,73,132,135
; C -> S; context 4
        .byte 6,1,4,1,67,32
; G -> J; context 4
        .byte 8,1,4,3,71,3,23,35
; A -> EY; context 16
        .byte 7,1,16,2,65,134,136
; E -> IY; context 16
        .byte 6,1,16,1,69,8
; I -> AY; context 16
        .byte 7,1,16,2,73,132,135
; O -> OW; context 16
        .byte 7,1,16,2,79,137,139
; U -> Y UW; context 16
        .byte 7,1,16,2,85,18,11
; A -> EY; context 128
        .byte 7,1,128,2,65,134,136
; E -> IY; context 128
        .byte 6,1,128,1,69,8
; I -> AY; context 128
        .byte 7,1,128,2,73,132,135
; O -> OW; context 128
        .byte 7,1,128,2,79,137,139
; U -> Y UW; context 128
        .byte 7,1,128,2,85,18,11
; E -> (silent); context 66
        .byte 5,1,66,0,69
; E -> IY; context 2
        .byte 6,1,2,1,69,8
; O -> OW; context 2
        .byte 7,1,2,2,79,137,139
; Y -> Y; context 1
        .byte 6,1,1,1,89,18
; Y -> IY; context 66
        .byte 6,1,66,1,89,8
; Y -> AY; context 2
        .byte 7,1,2,2,89,132,135
; Y -> IH; context 0
        .byte 6,1,0,1,89,7
; S -> Z; context 34
        .byte 6,1,34,1,83,33
; ' -> (silent); context 0
        .byte 5,1,0,0,39
; A -> AE; context 0
        .byte 6,1,0,1,65,5
; B -> PB; context 0
        .byte 7,1,0,2,66,3,22
; C -> PK; context 0
        .byte 7,1,0,2,67,3,27
; D -> PD; context 0
        .byte 7,1,0,2,68,3,23
; E -> EH; context 0
        .byte 6,1,0,1,69,6
; F -> F; context 0
        .byte 6,1,0,1,70,28
; G -> PG; context 0
        .byte 7,1,0,2,71,3,24
; H -> HH; context 0
        .byte 6,1,0,1,72,36
; I -> IH; context 0
        .byte 6,1,0,1,73,7
; J -> J; context 0
        .byte 8,1,0,3,74,3,23,35
; K -> PK; context 0
        .byte 7,1,0,2,75,3,27
; L -> L; context 0
        .byte 6,1,0,1,76,15
; M -> M; context 0
        .byte 6,1,0,1,77,19
; N -> N; context 0
        .byte 6,1,0,1,78,20
; O -> AA; context 0
        .byte 6,1,0,1,79,4
; P -> PP; context 0
        .byte 7,1,0,2,80,3,25
; Q -> PK; context 0
        .byte 7,1,0,2,81,3,27
; R -> R; context 0
        .byte 6,1,0,1,82,16
; S -> S; context 0
        .byte 6,1,0,1,83,32
; T -> PT; context 0
        .byte 7,1,0,2,84,3,26
; U -> AH; context 0
        .byte 6,1,0,1,85,12
; V -> V; context 0
        .byte 6,1,0,1,86,29
; W -> W; context 0
        .byte 6,1,0,1,87,17
; X -> PK S; context 0
        .byte 8,1,0,3,88,3,27,32
; Y -> IH; context 0
        .byte 6,1,0,1,89,7
; Z -> Z; context 0
        .byte 6,1,0,1,90,33
        .byte 0
rule_table_end:
wave_low_pages:
        .byte >wave_GAP_a,>wave_COMMA_a,>wave_PERIOD_a,>wave_CLOSE_a,>wave_AA_a,>wave_AE_a,>wave_EH_a,>wave_IH_a,>wave_IY_a,>wave_AO_a,>wave_UH_a,>wave_UW_a,>wave_AH_a,>wave_ER_a,>wave_AX_a,>wave_L_a
        .byte >wave_R_a,>wave_W_a,>wave_Y_a,>wave_M_a,>wave_N_a,>wave_NG_a,>wave_B_a,>wave_D_a,>wave_G_a,>wave_P_a,>wave_T_a,>wave_K_a,>wave_F_a,>wave_V_a,>wave_TH_a,>wave_DH_a
        .byte >wave_S_a,>wave_Z_a,>wave_SH_a,>wave_ZH_a,>wave_HH_a
wave_high_pages:
        .byte >wave_GAP_b,>wave_COMMA_b,>wave_PERIOD_b,>wave_CLOSE_b,>wave_AA_b,>wave_AE_b,>wave_EH_b,>wave_IH_b,>wave_IY_b,>wave_AO_b,>wave_UH_b,>wave_UW_b,>wave_AH_b,>wave_ER_b,>wave_AX_b,>wave_L_b
        .byte >wave_R_b,>wave_W_b,>wave_Y_b,>wave_M_b,>wave_N_b,>wave_NG_b,>wave_B_b,>wave_D_b,>wave_G_b,>wave_P_b,>wave_T_b,>wave_K_b,>wave_F_b,>wave_V_b,>wave_TH_b,>wave_DH_b
        .byte >wave_S_b,>wave_Z_b,>wave_SH_b,>wave_ZH_b,>wave_HH_b
wave_pages:
        .byte 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1
        .byte 1,1,1,1,1,1,1,1,1,1,1,1,2,2,2,2
        .byte 2,2,2,2,2
wave_repeats:
        .byte 2,5,8,1,4,4,4,3,4,4,3,4,3,4,2,2
        .byte 2,2,2,3,3,3,1,1,1,1,1,1,1,1,1,1
        .byte 2,1,2,1,1
tables_end:
        .org $3000
wave_GAP_a:
wave_COMMA_a:
wave_PERIOD_a:
wave_CLOSE_a:
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
wave_GAP_b:
wave_COMMA_b:
wave_PERIOD_b:
wave_CLOSE_b:
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
wave_AA_a:
        .byte 14,14,15,13,15,13,10,13,13,11,14,14,14,15,15,14
        .byte 14,11,13,13,12,14,14,14,14,12,14,14,13,11,11,13
        .byte 14,14,14,14,14,14,13,13,13,12,13,11,14,14,14,14
        .byte 13,13,10,12,13,13,12,14,14,14,13,14,12,9,9,8
        .byte 14,14,15,13,15,13,10,13,13,11,14,14,14,15,15,14
        .byte 14,11,13,13,12,14,14,14,14,12,14,14,13,11,11,13
        .byte 14,14,14,14,14,14,13,13,13,12,13,11,14,14,14,14
        .byte 13,13,10,12,13,13,12,14,14,14,13,14,12,9,9,8
        .byte 14,14,15,13,15,13,10,13,13,11,14,14,14,15,15,14
        .byte 14,11,13,13,12,14,14,14,14,12,14,14,13,11,11,13
        .byte 14,14,14,14,14,14,13,13,13,12,13,11,14,14,14,14
        .byte 13,13,10,12,13,13,12,14,14,14,13,14,12,9,9,8
        .byte 14,14,15,13,15,13,10,13,13,11,14,14,14,15,15,14
        .byte 14,11,13,13,12,14,14,14,14,12,14,14,13,11,11,13
        .byte 14,14,14,14,14,14,13,13,13,12,13,11,14,14,14,14
        .byte 13,13,10,12,13,13,12,14,14,14,13,14,12,9,9,8
wave_AA_b:
        .byte 0,13,11,13,5,5,10,6,7,11,2,4,6,0,3,8
        .byte 5,11,5,6,10,5,7,7,6,11,3,0,8,11,11,8
        .byte 0,4,5,5,3,0,8,7,6,9,6,11,2,7,7,5
        .byte 7,2,10,7,6,8,10,5,6,6,11,7,6,8,0,3
        .byte 0,13,11,13,5,5,10,6,7,11,2,4,6,0,3,8
        .byte 5,11,5,6,10,5,7,7,6,11,3,0,8,11,11,8
        .byte 0,4,5,5,3,0,8,7,6,9,6,11,2,7,7,5
        .byte 7,2,10,7,6,8,10,5,6,6,11,7,6,8,0,3
        .byte 0,13,11,13,5,5,10,6,7,11,2,4,6,0,3,8
        .byte 5,11,5,6,10,5,7,7,6,11,3,0,8,11,11,8
        .byte 0,4,5,5,3,0,8,7,6,9,6,11,2,7,7,5
        .byte 7,2,10,7,6,8,10,5,6,6,11,7,6,8,0,3
        .byte 0,13,11,13,5,5,10,6,7,11,2,4,6,0,3,8
        .byte 5,11,5,6,10,5,7,7,6,11,3,0,8,11,11,8
        .byte 0,4,5,5,3,0,8,7,6,9,6,11,2,7,7,5
        .byte 7,2,10,7,6,8,10,5,6,6,11,7,6,8,0,3
wave_AE_a:
        .byte 14,14,14,15,14,15,14,13,11,13,14,14,14,12,15,12
        .byte 14,12,13,13,13,13,14,14,14,14,14,14,12,13,11,13
        .byte 14,14,14,13,14,12,11,13,13,13,13,13,14,14,14,14
        .byte 13,12,12,12,11,13,13,12,15,14,13,12,11,11,9,8
        .byte 14,14,14,15,14,15,14,13,11,13,14,14,14,12,15,12
        .byte 14,12,13,13,13,13,14,14,14,14,14,14,12,13,11,13
        .byte 14,14,14,13,14,12,11,13,13,13,13,13,14,14,14,14
        .byte 13,12,12,12,11,13,13,12,15,14,13,12,11,11,9,8
        .byte 14,14,14,15,14,15,14,13,11,13,14,14,14,12,15,12
        .byte 14,12,13,13,13,13,14,14,14,14,14,14,12,13,11,13
        .byte 14,14,14,13,14,12,11,13,13,13,13,13,14,14,14,14
        .byte 13,12,12,12,11,13,13,12,15,14,13,12,11,11,9,8
        .byte 14,14,14,15,14,15,14,13,11,13,14,14,14,12,15,12
        .byte 14,12,13,13,13,13,14,14,14,14,14,14,12,13,11,13
        .byte 14,14,14,13,14,12,11,13,13,13,13,13,14,14,14,14
        .byte 13,12,12,12,11,13,13,12,15,14,13,12,11,11,9,8
wave_AE_b:
        .byte 0,13,11,4,10,4,6,2,7,0,4,4,5,12,5,12
        .byte 6,10,8,8,7,8,3,6,7,6,5,2,10,8,11,8
        .byte 0,3,5,9,1,10,11,7,6,6,8,9,5,4,4,2
        .byte 7,8,6,8,11,8,8,12,8,8,6,6,8,9,9,3
        .byte 0,13,11,4,10,4,6,2,7,0,4,4,5,12,5,12
        .byte 6,10,8,8,7,8,3,6,7,6,5,2,10,8,11,8
        .byte 0,3,5,9,1,10,11,7,6,6,8,9,5,4,4,2
        .byte 7,8,6,8,11,8,8,12,8,8,6,6,8,9,9,3
        .byte 0,13,11,4,10,4,6,2,7,0,4,4,5,12,5,12
        .byte 6,10,8,8,7,8,3,6,7,6,5,2,10,8,11,8
        .byte 0,3,5,9,1,10,11,7,6,6,8,9,5,4,4,2
        .byte 7,8,6,8,11,8,8,12,8,8,6,6,8,9,9,3
        .byte 0,13,11,4,10,4,6,2,7,0,4,4,5,12,5,12
        .byte 6,10,8,8,7,8,3,6,7,6,5,2,10,8,11,8
        .byte 0,3,5,9,1,10,11,7,6,6,8,9,5,4,4,2
        .byte 7,8,6,8,11,8,8,12,8,8,6,6,8,9,9,3
wave_EH_a:
        .byte 14,14,13,14,14,14,13,12,13,12,13,12,12,13,14,14
        .byte 14,12,15,14,14,14,14,14,12,13,13,13,13,12,12,14
        .byte 14,14,14,14,14,14,14,14,14,12,13,13,13,13,12,13
        .byte 13,13,12,14,12,15,14,14,14,13,11,10,10,12,11,8
        .byte 14,14,13,14,14,14,13,12,13,12,13,12,12,13,14,14
        .byte 14,12,15,14,14,14,14,14,12,13,13,13,13,12,12,14
        .byte 14,14,14,14,14,14,14,14,14,12,13,13,13,13,12,13
        .byte 13,13,12,14,12,15,14,14,14,13,11,10,10,12,11,8
        .byte 14,14,13,14,14,14,13,12,13,12,13,12,12,13,14,14
        .byte 14,12,15,14,14,14,14,14,12,13,13,13,13,12,12,14
        .byte 14,14,14,14,14,14,14,14,14,12,13,13,13,13,12,13
        .byte 13,13,12,14,12,15,14,14,14,13,11,10,10,12,11,8
        .byte 14,14,13,14,14,14,13,12,13,12,13,12,12,13,14,14
        .byte 14,12,15,14,14,14,14,14,12,13,13,13,13,12,12,14
        .byte 14,14,14,14,14,14,14,14,14,12,13,13,13,13,12,13
        .byte 13,13,12,14,12,15,14,14,14,13,11,10,10,12,11,8
wave_EH_b:
        .byte 0,13,12,10,12,12,12,11,6,10,6,5,8,8,1,3
        .byte 7,12,0,8,7,7,6,0,10,8,8,8,8,10,10,0
        .byte 0,0,0,3,4,4,3,3,3,10,7,6,6,3,7,0
        .byte 6,8,10,3,12,6,6,0,6,7,7,0,0,3,7,3
        .byte 0,13,12,10,12,12,12,11,6,10,6,5,8,8,1,3
        .byte 7,12,0,8,7,7,6,0,10,8,8,8,8,10,10,0
        .byte 0,0,0,3,4,4,3,3,3,10,7,6,6,3,7,0
        .byte 6,8,10,3,12,6,6,0,6,7,7,0,0,3,7,3
        .byte 0,13,12,10,12,12,12,11,6,10,6,5,8,8,1,3
        .byte 7,12,0,8,7,7,6,0,10,8,8,8,8,10,10,0
        .byte 0,0,0,3,4,4,3,3,3,10,7,6,6,3,7,0
        .byte 6,8,10,3,12,6,6,0,6,7,7,0,0,3,7,3
        .byte 0,13,12,10,12,12,12,11,6,10,6,5,8,8,1,3
        .byte 7,12,0,8,7,7,6,0,10,8,8,8,8,10,10,0
        .byte 0,0,0,3,4,4,3,3,3,10,7,6,6,3,7,0
        .byte 6,8,10,3,12,6,6,0,6,7,7,0,0,3,7,3
wave_IH_a:
        .byte 14,15,15,14,15,15,13,15,15,13,14,11,14,11,13,13
        .byte 12,13,13,13,14,12,12,14,13,13,14,14,14,14,14,14
        .byte 14,12,11,13,12,12,13,13,13,13,13,13,12,12,14,14
        .byte 14,12,12,14,12,14,13,11,12,10,9,9,8,12,11,9
        .byte 14,15,15,14,15,15,13,15,15,13,14,11,14,11,13,13
        .byte 12,13,13,13,14,12,12,14,13,13,14,14,14,14,14,14
        .byte 14,12,11,13,12,12,13,13,13,13,13,13,12,12,14,14
        .byte 14,12,12,14,12,14,13,11,12,10,9,9,8,12,11,9
        .byte 14,15,15,14,15,15,13,15,15,13,14,11,14,11,13,13
        .byte 12,13,13,13,14,12,12,14,13,13,14,14,14,14,14,14
        .byte 14,12,11,13,12,12,13,13,13,13,13,13,12,12,14,14
        .byte 14,12,12,14,12,14,13,11,12,10,9,9,8,12,11,9
        .byte 14,15,15,14,15,15,13,15,15,13,14,11,14,11,13,13
        .byte 12,13,13,13,14,12,12,14,13,13,14,14,14,14,14,14
        .byte 14,12,11,13,12,12,13,13,13,13,13,13,12,12,14,14
        .byte 14,12,12,14,12,14,13,11,12,10,9,9,8,12,11,9
wave_IH_b:
        .byte 0,11,4,10,11,11,13,7,7,12,6,11,0,11,1,0
        .byte 9,6,6,7,2,11,11,6,10,10,7,7,7,6,5,3
        .byte 0,10,11,6,9,9,5,4,4,6,7,7,10,11,6,6
        .byte 7,12,12,5,10,5,6,7,0,9,8,1,7,3,9,5
        .byte 0,11,4,10,11,11,13,7,7,12,6,11,0,11,1,0
        .byte 9,6,6,7,2,11,11,6,10,10,7,7,7,6,5,3
        .byte 0,10,11,6,9,9,5,4,4,6,7,7,10,11,6,6
        .byte 7,12,12,5,10,5,6,7,0,9,8,1,7,3,9,5
        .byte 0,11,4,10,11,11,13,7,7,12,6,11,0,11,1,0
        .byte 9,6,6,7,2,11,11,6,10,10,7,7,7,6,5,3
        .byte 0,10,11,6,9,9,5,4,4,6,7,7,10,11,6,6
        .byte 7,12,12,5,10,5,6,7,0,9,8,1,7,3,9,5
        .byte 0,11,4,10,11,11,13,7,7,12,6,11,0,11,1,0
        .byte 9,6,6,7,2,11,11,6,10,10,7,7,7,6,5,3
        .byte 0,10,11,6,9,9,5,4,4,6,7,7,10,11,6,6
        .byte 7,12,12,5,10,5,6,7,0,9,8,1,7,3,9,5
wave_IY_a:
        .byte 14,13,14,13,15,13,15,14,15,13,15,14,12,14,14,14
        .byte 12,12,13,13,13,11,13,13,13,13,11,12,12,12,12,14
        .byte 14,12,14,14,14,14,14,14,13,14,14,14,14,14,14,14
        .byte 14,11,13,13,12,10,11,11,9,10,10,10,9,11,13,9
        .byte 14,13,14,13,15,13,15,14,15,13,15,14,12,14,14,14
        .byte 12,12,13,13,13,11,13,13,13,13,11,12,12,12,12,14
        .byte 14,12,14,14,14,14,14,14,13,14,14,14,14,14,14,14
        .byte 14,11,13,13,12,10,11,11,9,10,10,10,9,11,13,9
        .byte 14,13,14,13,15,13,15,14,15,13,15,14,12,14,14,14
        .byte 12,12,13,13,13,11,13,13,13,13,11,12,12,12,12,14
        .byte 14,12,14,14,14,14,14,14,13,14,14,14,14,14,14,14
        .byte 14,11,13,13,12,10,11,11,9,10,10,10,9,11,13,9
        .byte 14,13,14,13,15,13,15,14,15,13,15,14,12,14,14,14
        .byte 12,12,13,13,13,11,13,13,13,13,11,12,12,12,12,14
        .byte 14,12,14,14,14,14,14,14,13,14,14,14,14,14,14,14
        .byte 14,11,13,13,12,10,11,11,9,10,10,10,9,11,13,9
wave_IY_b:
        .byte 0,13,6,12,11,13,9,12,11,12,7,11,12,7,8,5
        .byte 10,10,8,6,6,11,7,6,8,8,11,10,10,10,10,0
        .byte 0,10,1,2,0,2,5,4,9,6,6,5,6,6,3,1
        .byte 3,11,2,5,7,8,7,6,6,0,6,4,1,6,6,8
        .byte 0,13,6,12,11,13,9,12,11,12,7,11,12,7,8,5
        .byte 10,10,8,6,6,11,7,6,8,8,11,10,10,10,10,0
        .byte 0,10,1,2,0,2,5,4,9,6,6,5,6,6,3,1
        .byte 3,11,2,5,7,8,7,6,6,0,6,4,1,6,6,8
        .byte 0,13,6,12,11,13,9,12,11,12,7,11,12,7,8,5
        .byte 10,10,8,6,6,11,7,6,8,8,11,10,10,10,10,0
        .byte 0,10,1,2,0,2,5,4,9,6,6,5,6,6,3,1
        .byte 3,11,2,5,7,8,7,6,6,0,6,4,1,6,6,8
        .byte 0,13,6,12,11,13,9,12,11,12,7,11,12,7,8,5
        .byte 10,10,8,6,6,11,7,6,8,8,11,10,10,10,10,0
        .byte 0,10,1,2,0,2,5,4,9,6,6,5,6,6,3,1
        .byte 3,11,2,5,7,8,7,6,6,0,6,4,1,6,6,8
wave_AO_a:
        .byte 14,15,15,14,15,15,14,13,13,11,11,13,13,12,14,14
        .byte 14,14,14,14,13,12,14,12,11,13,12,14,14,14,14,14
        .byte 14,12,13,13,12,14,14,14,14,14,12,13,13,13,13,11
        .byte 13,13,12,14,13,14,14,14,14,14,12,12,9,8,8,9
        .byte 14,15,15,14,15,15,14,13,13,11,11,13,13,12,14,14
        .byte 14,14,14,14,13,12,14,12,11,13,12,14,14,14,14,14
        .byte 14,12,13,13,12,14,14,14,14,14,12,13,13,13,13,11
        .byte 13,13,12,14,13,14,14,14,14,14,12,12,9,8,8,9
        .byte 14,15,15,14,15,15,14,13,13,11,11,13,13,12,14,14
        .byte 14,14,14,14,13,12,14,12,11,13,12,14,14,14,14,14
        .byte 14,12,13,13,12,14,14,14,14,14,12,13,13,13,13,11
        .byte 13,13,12,14,13,14,14,14,14,14,12,12,9,8,8,9
        .byte 14,15,15,14,15,15,14,13,13,11,11,13,13,12,14,14
        .byte 14,14,14,14,13,12,14,12,11,13,12,14,14,14,14,14
        .byte 14,12,13,13,12,14,14,14,14,14,12,13,13,13,13,11
        .byte 13,13,12,14,13,14,14,14,14,14,12,12,9,8,8,9
wave_AO_b:
        .byte 0,11,11,13,11,6,2,8,5,10,11,8,8,10,1,3
        .byte 6,8,8,8,10,11,1,10,11,8,10,0,2,4,4,2
        .byte 0,10,8,8,10,0,2,5,5,3,10,7,5,2,2,10
        .byte 6,8,10,0,9,3,5,8,7,3,10,5,0,3,6,3
        .byte 0,11,11,13,11,6,2,8,5,10,11,8,8,10,1,3
        .byte 6,8,8,8,10,11,1,10,11,8,10,0,2,4,4,2
        .byte 0,10,8,8,10,0,2,5,5,3,10,7,5,2,2,10
        .byte 6,8,10,0,9,3,5,8,7,3,10,5,0,3,6,3
        .byte 0,11,11,13,11,6,2,8,5,10,11,8,8,10,1,3
        .byte 6,8,8,8,10,11,1,10,11,8,10,0,2,4,4,2
        .byte 0,10,8,8,10,0,2,5,5,3,10,7,5,2,2,10
        .byte 6,8,10,0,9,3,5,8,7,3,10,5,0,3,6,3
        .byte 0,11,11,13,11,6,2,8,5,10,11,8,8,10,1,3
        .byte 6,8,8,8,10,11,1,10,11,8,10,0,2,4,4,2
        .byte 0,10,8,8,10,0,2,5,5,3,10,7,5,2,2,10
        .byte 6,8,10,0,9,3,5,8,7,3,10,5,0,3,6,3
wave_UH_a:
        .byte 14,15,15,15,14,15,12,15,15,15,14,12,13,10,13,13
        .byte 13,14,13,13,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,12,12,12,12,12,11,13,12,13,12,13,11,13,13,12
        .byte 14,14,14,15,14,14,12,10,12,12,12,12,10,9,9,9
        .byte 14,15,15,15,14,15,12,15,15,15,14,12,13,10,13,13
        .byte 13,14,13,13,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,12,12,12,12,12,11,13,12,13,12,13,11,13,13,12
        .byte 14,14,14,15,14,14,12,10,12,12,12,12,10,9,9,9
        .byte 14,15,15,15,14,15,12,15,15,15,14,12,13,10,13,13
        .byte 13,14,13,13,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,12,12,12,12,12,11,13,12,13,12,13,11,13,13,12
        .byte 14,14,14,15,14,14,12,10,12,12,12,12,10,9,9,9
        .byte 14,15,15,15,14,15,12,15,15,15,14,12,13,10,13,13
        .byte 13,14,13,13,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,12,12,12,12,12,11,13,12,13,12,13,11,13,13,12
        .byte 14,14,14,15,14,14,12,10,12,12,12,12,10,9,9,9
wave_UH_b:
        .byte 0,11,11,11,12,7,12,6,7,1,7,10,1,10,1,6
        .byte 8,2,9,9,5,6,7,7,7,6,5,3,1,0,0,0
        .byte 0,10,10,10,10,10,11,6,9,5,9,6,11,8,8,10
        .byte 4,6,8,2,8,0,9,10,0,4,8,0,0,6,1,1
        .byte 0,11,11,11,12,7,12,6,7,1,7,10,1,10,1,6
        .byte 8,2,9,9,5,6,7,7,7,6,5,3,1,0,0,0
        .byte 0,10,10,10,10,10,11,6,9,5,9,6,11,8,8,10
        .byte 4,6,8,2,8,0,9,10,0,4,8,0,0,6,1,1
        .byte 0,11,11,11,12,7,12,6,7,1,7,10,1,10,1,6
        .byte 8,2,9,9,5,6,7,7,7,6,5,3,1,0,0,0
        .byte 0,10,10,10,10,10,11,6,9,5,9,6,11,8,8,10
        .byte 4,6,8,2,8,0,9,10,0,4,8,0,0,6,1,1
        .byte 0,11,11,11,12,7,12,6,7,1,7,10,1,10,1,6
        .byte 8,2,9,9,5,6,7,7,7,6,5,3,1,0,0,0
        .byte 0,10,10,10,10,10,11,6,9,5,9,6,11,8,8,10
        .byte 4,6,8,2,8,0,9,10,0,4,8,0,0,6,1,1
wave_UW_a:
        .byte 14,15,13,14,15,15,15,15,15,15,12,13,15,14,14,13
        .byte 12,13,13,13,13,11,12,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,12,12,12,12,12,12,12,14,14,14,14,14,14
        .byte 14,13,13,13,12,10,12,12,12,12,12,10,9,10,10,11
        .byte 14,15,13,14,15,15,15,15,15,15,12,13,15,14,14,13
        .byte 12,13,13,13,13,11,12,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,12,12,12,12,12,12,12,14,14,14,14,14,14
        .byte 14,13,13,13,12,10,12,12,12,12,12,10,9,10,10,11
        .byte 14,15,13,14,15,15,15,15,15,15,12,13,15,14,14,13
        .byte 12,13,13,13,13,11,12,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,12,12,12,12,12,12,12,14,14,14,14,14,14
        .byte 14,13,13,13,12,10,12,12,12,12,12,10,9,10,10,11
        .byte 14,15,13,14,15,15,15,15,15,15,12,13,15,14,14,13
        .byte 12,13,13,13,13,11,12,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,12,12,12,12,12,12,12,14,14,14,14,14,14
        .byte 14,13,13,13,12,10,12,12,12,12,12,10,9,10,10,11
wave_UW_b:
        .byte 0,9,13,12,11,10,7,6,5,0,12,11,0,8,7,9
        .byte 10,7,6,6,7,11,10,0,2,3,3,2,0,0,0,0
        .byte 0,0,0,10,10,10,10,10,10,10,1,5,6,6,6,6
        .byte 2,8,6,3,7,10,8,7,6,5,0,2,1,1,5,1
        .byte 0,9,13,12,11,10,7,6,5,0,12,11,0,8,7,9
        .byte 10,7,6,6,7,11,10,0,2,3,3,2,0,0,0,0
        .byte 0,0,0,10,10,10,10,10,10,10,1,5,6,6,6,6
        .byte 2,8,6,3,7,10,8,7,6,5,0,2,1,1,5,1
        .byte 0,9,13,12,11,10,7,6,5,0,12,11,0,8,7,9
        .byte 10,7,6,6,7,11,10,0,2,3,3,2,0,0,0,0
        .byte 0,0,0,10,10,10,10,10,10,10,1,5,6,6,6,6
        .byte 2,8,6,3,7,10,8,7,6,5,0,2,1,1,5,1
        .byte 0,9,13,12,11,10,7,6,5,0,12,11,0,8,7,9
        .byte 10,7,6,6,7,11,10,0,2,3,3,2,0,0,0,0
        .byte 0,0,0,10,10,10,10,10,10,10,1,5,6,6,6,6
        .byte 2,8,6,3,7,10,8,7,6,5,0,2,1,1,5,1
wave_AH_a:
        .byte 14,14,15,14,15,14,14,14,11,13,13,12,13,14,15,15
        .byte 12,14,14,14,12,13,13,13,13,14,14,14,14,12,14,14
        .byte 14,12,13,13,13,13,13,12,14,14,13,14,14,12,13,13
        .byte 12,12,11,13,13,12,12,13,14,13,12,12,11,10,9,8
        .byte 14,14,15,14,15,14,14,14,11,13,13,12,13,14,15,15
        .byte 12,14,14,14,12,13,13,13,13,14,14,14,14,12,14,14
        .byte 14,12,13,13,13,13,13,12,14,14,13,14,14,12,13,13
        .byte 12,12,11,13,13,12,12,13,14,13,12,12,11,10,9,8
        .byte 14,14,15,14,15,14,14,14,11,13,13,12,13,14,15,15
        .byte 12,14,14,14,12,13,13,13,13,14,14,14,14,12,14,14
        .byte 14,12,13,13,13,13,13,12,14,14,13,14,14,12,13,13
        .byte 12,12,11,13,13,12,12,13,14,13,12,12,11,10,9,8
        .byte 14,14,15,14,15,14,14,14,11,13,13,12,13,14,15,15
        .byte 12,14,14,14,12,13,13,13,13,14,14,14,14,12,14,14
        .byte 14,12,13,13,13,13,13,12,14,14,13,14,14,12,13,13
        .byte 12,12,11,13,13,12,12,13,14,13,12,12,11,10,9,8
wave_AH_b:
        .byte 0,13,11,12,8,1,1,6,11,4,0,8,8,8,4,5
        .byte 12,6,3,1,10,8,8,7,8,1,5,6,6,11,4,1
        .byte 0,10,8,7,6,6,7,10,4,5,9,3,0,10,8,6
        .byte 8,6,9,3,9,12,12,10,5,7,10,10,7,0,2,3
        .byte 0,13,11,12,8,1,1,6,11,4,0,8,8,8,4,5
        .byte 12,6,3,1,10,8,8,7,8,1,5,6,6,11,4,1
        .byte 0,10,8,7,6,6,7,10,4,5,9,3,0,10,8,6
        .byte 8,6,9,3,9,12,12,10,5,7,10,10,7,0,2,3
        .byte 0,13,11,12,8,1,1,6,11,4,0,8,8,8,4,5
        .byte 12,6,3,1,10,8,8,7,8,1,5,6,6,11,4,1
        .byte 0,10,8,7,6,6,7,10,4,5,9,3,0,10,8,6
        .byte 8,6,9,3,9,12,12,10,5,7,10,10,7,0,2,3
        .byte 0,13,11,12,8,1,1,6,11,4,0,8,8,8,4,5
        .byte 12,6,3,1,10,8,8,7,8,1,5,6,6,11,4,1
        .byte 0,10,8,7,6,6,7,10,4,5,9,3,0,10,8,6
        .byte 8,6,9,3,9,12,12,10,5,7,10,10,7,0,2,3
wave_ER_a:
        .byte 14,15,15,13,15,14,15,14,15,12,11,12,12,13,13,13
        .byte 13,13,14,14,14,14,14,14,14,12,14,14,12,12,14,14
        .byte 14,14,14,14,14,14,13,13,13,13,13,13,13,13,13,13
        .byte 14,14,12,14,14,14,14,13,12,9,11,12,12,11,9,9
        .byte 14,15,15,13,15,14,15,14,15,12,11,12,12,13,13,13
        .byte 13,13,14,14,14,14,14,14,14,12,14,14,12,12,14,14
        .byte 14,14,14,14,14,14,13,13,13,13,13,13,13,13,13,13
        .byte 14,14,12,14,14,14,14,13,12,9,11,12,12,11,9,9
        .byte 14,15,15,13,15,14,15,14,15,12,11,12,12,13,13,13
        .byte 13,13,14,14,14,14,14,14,14,12,14,14,12,12,14,14
        .byte 14,14,14,14,14,14,13,13,13,13,13,13,13,13,13,13
        .byte 14,14,12,14,14,14,14,13,12,9,11,12,12,11,9,9
        .byte 14,15,15,13,15,14,15,14,15,12,11,12,12,13,13,13
        .byte 13,13,14,14,14,14,14,14,14,12,14,14,12,12,14,14
        .byte 14,14,14,14,14,14,13,13,13,13,13,13,13,13,13,13
        .byte 14,14,12,14,14,14,14,13,12,9,11,12,12,11,9,9
wave_ER_b:
        .byte 0,11,11,12,0,10,9,11,4,11,11,9,9,7,7,7
        .byte 7,8,4,7,7,7,6,6,6,11,4,0,10,10,0,0
        .byte 0,0,0,1,1,0,8,7,7,7,7,6,5,6,8,9
        .byte 6,6,11,6,7,7,5,7,6,9,2,2,7,7,1,5
        .byte 0,11,11,12,0,10,9,11,4,11,11,9,9,7,7,7
        .byte 7,8,4,7,7,7,6,6,6,11,4,0,10,10,0,0
        .byte 0,0,0,1,1,0,8,7,7,7,7,6,5,6,8,9
        .byte 6,6,11,6,7,7,5,7,6,9,2,2,7,7,1,5
        .byte 0,11,11,12,0,10,9,11,4,11,11,9,9,7,7,7
        .byte 7,8,4,7,7,7,6,6,6,11,4,0,10,10,0,0
        .byte 0,0,0,1,1,0,8,7,7,7,7,6,5,6,8,9
        .byte 6,6,11,6,7,7,5,7,6,9,2,2,7,7,1,5
        .byte 0,11,11,12,0,10,9,11,4,11,11,9,9,7,7,7
        .byte 7,8,4,7,7,7,6,6,6,11,4,0,10,10,0,0
        .byte 0,0,0,1,1,0,8,7,7,7,7,6,5,6,8,9
        .byte 6,6,11,6,7,7,5,7,6,9,2,2,7,7,1,5
wave_AX_a:
        .byte 14,13,14,15,15,15,15,15,14,13,12,13,13,13,12,13
        .byte 14,14,14,14,14,14,14,14,14,12,13,13,13,11,11,13
        .byte 14,14,14,14,13,13,14,14,13,13,12,13,12,13,13,13
        .byte 12,14,14,14,14,14,14,14,13,11,11,12,12,12,11,10
        .byte 14,13,14,15,15,15,15,15,14,13,12,13,13,13,12,13
        .byte 14,14,14,14,14,14,14,14,14,12,13,13,13,11,11,13
        .byte 14,14,14,14,13,13,14,14,13,13,12,13,12,13,13,13
        .byte 12,14,14,14,14,14,14,14,13,11,11,12,12,12,11,10
        .byte 14,13,14,15,15,15,15,15,14,13,12,13,13,13,12,13
        .byte 14,14,14,14,14,14,14,14,14,12,13,13,13,11,11,13
        .byte 14,14,14,14,13,13,14,14,13,13,12,13,12,13,13,13
        .byte 12,14,14,14,14,14,14,14,13,11,11,12,12,12,11,10
        .byte 14,13,14,15,15,15,15,15,14,13,12,13,13,13,12,13
        .byte 14,14,14,14,14,14,14,14,14,12,13,13,13,11,11,13
        .byte 14,14,14,14,13,13,14,14,13,13,12,13,12,13,13,13
        .byte 12,14,14,14,14,14,14,14,13,11,11,12,12,12,11,10
wave_AX_b:
        .byte 0,13,11,6,6,5,7,7,6,6,9,6,7,7,9,6
        .byte 0,6,7,7,7,7,7,6,4,10,8,8,8,11,11,8
        .byte 0,3,5,5,9,9,4,1,8,6,9,6,9,5,5,6
        .byte 10,6,7,6,6,7,7,6,6,7,7,6,4,4,6,5
        .byte 0,13,11,6,6,5,7,7,6,6,9,6,7,7,9,6
        .byte 0,6,7,7,7,7,7,6,4,10,8,8,8,11,11,8
        .byte 0,3,5,5,9,9,4,1,8,6,9,6,9,5,5,6
        .byte 10,6,7,6,6,7,7,6,6,7,7,6,4,4,6,5
        .byte 0,13,11,6,6,5,7,7,6,6,9,6,7,7,9,6
        .byte 0,6,7,7,7,7,7,6,4,10,8,8,8,11,11,8
        .byte 0,3,5,5,9,9,4,1,8,6,9,6,9,5,5,6
        .byte 10,6,7,6,6,7,7,6,6,7,7,6,4,4,6,5
        .byte 0,13,11,6,6,5,7,7,6,6,9,6,7,7,9,6
        .byte 0,6,7,7,7,7,7,6,4,10,8,8,8,11,11,8
        .byte 0,3,5,5,9,9,4,1,8,6,9,6,9,5,5,6
        .byte 10,6,7,6,6,7,7,6,6,7,7,6,4,4,6,5
wave_L_a:
        .byte 14,15,15,15,15,15,15,14,15,15,15,14,14,13,13,13
        .byte 13,13,13,11,13,12,14,14,14,14,14,14,14,12,13,14
        .byte 14,12,13,13,13,13,12,13,13,11,12,14,13,14,13,12
        .byte 14,14,13,14,12,13,11,12,12,12,12,11,11,9,11,11
        .byte 14,15,15,15,15,15,15,14,15,15,15,14,14,13,13,13
        .byte 13,13,13,11,13,12,14,14,14,14,14,14,14,12,13,14
        .byte 14,12,13,13,13,13,12,13,13,11,12,14,13,14,13,12
        .byte 14,14,13,14,12,13,11,12,12,12,12,11,11,9,11,11
        .byte 14,15,15,15,15,15,15,14,15,15,15,14,14,13,13,13
        .byte 13,13,13,11,13,12,14,14,14,14,14,14,14,12,13,14
        .byte 14,12,13,13,13,13,12,13,13,11,12,14,13,14,13,12
        .byte 14,14,13,14,12,13,11,12,12,12,12,11,11,9,11,11
        .byte 14,15,15,15,15,15,15,14,15,15,15,14,14,13,13,13
        .byte 13,13,13,11,13,12,14,14,14,14,14,14,14,12,13,14
        .byte 14,12,13,13,13,13,12,13,13,11,12,14,13,14,13,12
        .byte 14,14,13,14,12,13,11,12,12,12,12,11,11,9,11,11
wave_L_b:
        .byte 0,9,9,10,9,3,6,10,6,7,4,7,0,6,5,6
        .byte 7,7,8,11,8,10,1,5,6,7,7,7,6,11,9,2
        .byte 0,10,8,7,7,6,9,6,6,11,10,1,9,5,9,11
        .byte 6,7,10,6,10,6,9,0,4,3,5,9,3,7,3,2
        .byte 0,9,9,10,9,3,6,10,6,7,4,7,0,6,5,6
        .byte 7,7,8,11,8,10,1,5,6,7,7,7,6,11,9,2
        .byte 0,10,8,7,7,6,9,6,6,11,10,1,9,5,9,11
        .byte 6,7,10,6,10,6,9,0,4,3,5,9,3,7,3,2
        .byte 0,9,9,10,9,3,6,10,6,7,4,7,0,6,5,6
        .byte 7,7,8,11,8,10,1,5,6,7,7,7,6,11,9,2
        .byte 0,10,8,7,7,6,9,6,6,11,10,1,9,5,9,11
        .byte 6,7,10,6,10,6,9,0,4,3,5,9,3,7,3,2
        .byte 0,9,9,10,9,3,6,10,6,7,4,7,0,6,5,6
        .byte 7,7,8,11,8,10,1,5,6,7,7,7,6,11,9,2
        .byte 0,10,8,7,7,6,9,6,6,11,10,1,9,5,9,11
        .byte 6,7,10,6,10,6,9,0,4,3,5,9,3,7,3,2
wave_R_a:
        .byte 14,15,14,14,15,15,14,15,14,15,14,14,13,12,13,13
        .byte 11,11,13,13,13,14,12,14,14,14,14,14,14,12,14,14
        .byte 14,13,11,13,13,13,13,13,13,13,13,12,14,12,14,14
        .byte 14,12,14,14,14,13,11,11,12,11,12,11,11,11,9,10
        .byte 14,15,14,14,15,15,14,15,14,15,14,14,13,12,13,13
        .byte 11,11,13,13,13,14,12,14,14,14,14,14,14,12,14,14
        .byte 14,13,11,13,13,13,13,13,13,13,13,12,14,12,14,14
        .byte 14,12,14,14,14,13,11,11,12,11,12,11,11,11,9,10
        .byte 14,15,14,14,15,15,14,15,14,15,14,14,13,12,13,13
        .byte 11,11,13,13,13,14,12,14,14,14,14,14,14,12,14,14
        .byte 14,13,11,13,13,13,13,13,13,13,13,12,14,12,14,14
        .byte 14,12,14,14,14,13,11,11,12,11,12,11,11,11,9,10
        .byte 14,15,14,14,15,15,14,15,14,15,14,14,13,12,13,13
        .byte 11,11,13,13,13,14,12,14,14,14,14,14,14,12,14,14
        .byte 14,13,11,13,13,13,13,13,13,13,13,12,14,12,14,14
        .byte 14,12,14,14,14,13,11,11,12,11,12,11,11,11,9,10
wave_R_b:
        .byte 0,9,12,11,4,3,10,8,10,4,8,4,7,9,6,7
        .byte 11,11,7,7,8,2,11,6,6,6,6,6,6,11,5,3
        .byte 0,8,11,7,7,7,6,6,6,6,7,10,3,11,6,5
        .byte 5,11,7,7,5,8,10,9,1,7,3,9,9,6,6,6
        .byte 0,9,12,11,4,3,10,8,10,4,8,4,7,9,6,7
        .byte 11,11,7,7,8,2,11,6,6,6,6,6,6,11,5,3
        .byte 0,8,11,7,7,7,6,6,6,6,7,10,3,11,6,5
        .byte 5,11,7,7,5,8,10,9,1,7,3,9,9,6,6,6
        .byte 0,9,12,11,4,3,10,8,10,4,8,4,7,9,6,7
        .byte 11,11,7,7,8,2,11,6,6,6,6,6,6,11,5,3
        .byte 0,8,11,7,7,7,6,6,6,6,7,10,3,11,6,5
        .byte 5,11,7,7,5,8,10,9,1,7,3,9,9,6,6,6
        .byte 0,9,12,11,4,3,10,8,10,4,8,4,7,9,6,7
        .byte 11,11,7,7,8,2,11,6,6,6,6,6,6,11,5,3
        .byte 0,8,11,7,7,7,6,6,6,6,7,10,3,11,6,5
        .byte 5,11,7,7,5,8,10,9,1,7,3,9,9,6,6,6
wave_W_a:
        .byte 14,14,15,14,13,15,15,15,15,12,13,14,13,14,14,14
        .byte 12,14,14,12,11,13,13,13,11,13,12,12,12,14,14,14
        .byte 14,14,14,14,14,14,14,13,14,12,12,12,14,14,14,13
        .byte 13,13,13,12,13,13,13,13,12,12,10,11,10,11,11,12
        .byte 14,14,15,14,13,15,15,15,15,12,13,14,13,14,14,14
        .byte 12,14,14,12,11,13,13,13,11,13,12,12,12,14,14,14
        .byte 14,14,14,14,14,14,14,13,14,12,12,12,14,14,14,13
        .byte 13,13,13,12,13,13,13,13,12,12,10,11,10,11,11,12
        .byte 14,14,15,14,13,15,15,15,15,12,13,14,13,14,14,14
        .byte 12,14,14,12,11,13,13,13,11,13,12,12,12,14,14,14
        .byte 14,14,14,14,14,14,14,13,14,12,12,12,14,14,14,13
        .byte 13,13,13,12,13,13,13,13,12,12,10,11,10,11,11,12
        .byte 14,14,15,14,13,15,15,15,15,12,13,14,13,14,14,14
        .byte 12,14,14,12,11,13,13,13,11,13,12,12,12,14,14,14
        .byte 14,14,14,14,14,14,14,13,14,12,12,12,14,14,14,13
        .byte 13,13,13,12,13,13,13,13,12,12,10,11,10,11,11,12
wave_W_b:
        .byte 0,10,7,11,13,9,7,6,4,12,10,8,10,7,7,7
        .byte 11,3,0,10,11,7,7,7,11,8,10,10,10,0,0,0
        .byte 0,0,0,0,0,1,3,9,5,11,11,11,5,2,0,8
        .byte 7,6,6,9,4,4,5,0,6,5,9,1,5,6,7,4
        .byte 0,10,7,11,13,9,7,6,4,12,10,8,10,7,7,7
        .byte 11,3,0,10,11,7,7,7,11,8,10,10,10,0,0,0
        .byte 0,0,0,0,0,1,3,9,5,11,11,11,5,2,0,8
        .byte 7,6,6,9,4,4,5,0,6,5,9,1,5,6,7,4
        .byte 0,10,7,11,13,9,7,6,4,12,10,8,10,7,7,7
        .byte 11,3,0,10,11,7,7,7,11,8,10,10,10,0,0,0
        .byte 0,0,0,0,0,1,3,9,5,11,11,11,5,2,0,8
        .byte 7,6,6,9,4,4,5,0,6,5,9,1,5,6,7,4
        .byte 0,10,7,11,13,9,7,6,4,12,10,8,10,7,7,7
        .byte 11,3,0,10,11,7,7,7,11,8,10,10,10,0,0,0
        .byte 0,0,0,0,0,1,3,9,5,11,11,11,5,2,0,8
        .byte 7,6,6,9,4,4,5,0,6,5,9,1,5,6,7,4
wave_Y_a:
        .byte 14,13,14,15,15,14,13,13,15,14,15,14,14,12,14,14
        .byte 14,14,14,14,13,13,11,13,13,13,13,13,11,13,12,12
        .byte 14,14,14,14,14,12,14,14,14,12,14,14,14,14,12,12
        .byte 13,11,11,13,12,12,12,11,11,11,11,11,11,12,13,11
        .byte 14,13,14,15,15,14,13,13,15,14,15,14,14,12,14,14
        .byte 14,14,14,14,13,13,11,13,13,13,13,13,11,13,12,12
        .byte 14,14,14,14,14,12,14,14,14,12,14,14,14,14,12,12
        .byte 13,11,11,13,12,12,12,11,11,11,11,11,11,12,13,11
        .byte 14,13,14,15,15,14,13,13,15,14,15,14,14,12,14,14
        .byte 14,14,14,14,13,13,11,13,13,13,13,13,11,13,12,12
        .byte 14,14,14,14,14,12,14,14,14,12,14,14,14,14,12,12
        .byte 13,11,11,13,12,12,12,11,11,11,11,11,11,12,13,11
        .byte 14,13,14,15,15,14,13,13,15,14,15,14,14,12,14,14
        .byte 14,14,14,14,13,13,11,13,13,13,13,13,11,13,12,12
        .byte 14,14,14,14,14,12,14,14,14,12,14,14,14,14,12,12
        .byte 13,11,11,13,12,12,12,11,11,11,11,11,11,12,13,11
wave_Y_b:
        .byte 0,12,6,0,9,11,12,12,9,11,5,10,10,12,8,8
        .byte 6,2,0,0,8,7,11,7,6,7,7,7,11,8,10,10
        .byte 0,2,2,4,5,11,5,6,6,11,5,6,4,0,10,10
        .byte 6,10,10,0,3,1,6,6,0,7,7,5,4,7,6,6
        .byte 0,12,6,0,9,11,12,12,9,11,5,10,10,12,8,8
        .byte 6,2,0,0,8,7,11,7,6,7,7,7,11,8,10,10
        .byte 0,2,2,4,5,11,5,6,6,11,5,6,4,0,10,10
        .byte 6,10,10,0,3,1,6,6,0,7,7,5,4,7,6,6
        .byte 0,12,6,0,9,11,12,12,9,11,5,10,10,12,8,8
        .byte 6,2,0,0,8,7,11,7,6,7,7,7,11,8,10,10
        .byte 0,2,2,4,5,11,5,6,6,11,5,6,4,0,10,10
        .byte 6,10,10,0,3,1,6,6,0,7,7,5,4,7,6,6
        .byte 0,12,6,0,9,11,12,12,9,11,5,10,10,12,8,8
        .byte 6,2,0,0,8,7,11,7,6,7,7,7,11,8,10,10
        .byte 0,2,2,4,5,11,5,6,6,11,5,6,4,0,10,10
        .byte 6,10,10,0,3,1,6,6,0,7,7,5,4,7,6,6
wave_M_a:
        .byte 14,15,15,15,14,14,14,15,15,15,14,13,14,15,12,14
        .byte 14,14,14,14,12,11,13,13,13,13,13,13,13,11,13,12
        .byte 14,14,14,14,14,12,14,14,14,14,14,14,14,12,13,13
        .byte 12,13,12,12,12,11,11,11,11,11,10,9,11,11,12,12
        .byte 14,15,15,15,14,14,14,15,15,15,14,13,14,15,12,14
        .byte 14,14,14,14,12,11,13,13,13,13,13,13,13,11,13,12
        .byte 14,14,14,14,14,12,14,14,14,14,14,14,14,12,13,13
        .byte 12,13,12,12,12,11,11,11,11,11,10,9,11,11,12,12
        .byte 14,15,15,15,14,14,14,15,15,15,14,13,14,15,12,14
        .byte 14,14,14,14,12,11,13,13,13,13,13,13,13,11,13,12
        .byte 14,14,14,14,14,12,14,14,14,14,14,14,14,12,13,13
        .byte 12,13,12,12,12,11,11,11,11,11,10,9,11,11,12,12
        .byte 14,15,15,15,14,14,14,15,15,15,14,13,14,15,12,14
        .byte 14,14,14,14,12,11,13,13,13,13,13,13,13,11,13,12
        .byte 14,14,14,14,14,12,14,14,14,14,14,14,14,12,13,13
        .byte 12,13,12,12,12,11,11,11,11,11,10,9,11,11,12,12
wave_M_b:
        .byte 0,0,6,8,11,11,11,9,9,9,11,12,10,4,12,8
        .byte 7,6,4,0,10,11,7,7,7,7,7,7,7,11,8,10
        .byte 0,1,4,5,5,11,6,6,6,6,6,5,3,10,8,7
        .byte 9,3,8,6,2,6,5,1,0,4,8,9,6,7,4,7
        .byte 0,0,6,8,11,11,11,9,9,9,11,12,10,4,12,8
        .byte 7,6,4,0,10,11,7,7,7,7,7,7,7,11,8,10
        .byte 0,1,4,5,5,11,6,6,6,6,6,5,3,10,8,7
        .byte 9,3,8,6,2,6,5,1,0,4,8,9,6,7,4,7
        .byte 0,0,6,8,11,11,11,9,9,9,11,12,10,4,12,8
        .byte 7,6,4,0,10,11,7,7,7,7,7,7,7,11,8,10
        .byte 0,1,4,5,5,11,6,6,6,6,6,5,3,10,8,7
        .byte 9,3,8,6,2,6,5,1,0,4,8,9,6,7,4,7
        .byte 0,0,6,8,11,11,11,9,9,9,11,12,10,4,12,8
        .byte 7,6,4,0,10,11,7,7,7,7,7,7,7,11,8,10
        .byte 0,1,4,5,5,11,6,6,6,6,6,5,3,10,8,7
        .byte 9,3,8,6,2,6,5,1,0,4,8,9,6,7,4,7
wave_N_a:
        .byte 14,15,15,14,13,14,15,15,14,15,15,15,15,12,14,14
        .byte 14,14,12,13,13,13,13,13,11,11,13,13,13,12,12,12
        .byte 14,14,14,14,14,14,13,14,14,12,12,14,12,13,14,14
        .byte 12,11,12,13,12,12,12,11,10,11,10,11,11,12,12,12
        .byte 14,15,15,14,13,14,15,15,14,15,15,15,15,12,14,14
        .byte 14,14,12,13,13,13,13,13,11,11,13,13,13,12,12,12
        .byte 14,14,14,14,14,14,13,14,14,12,12,14,12,13,14,14
        .byte 12,11,12,13,12,12,12,11,10,11,10,11,11,12,12,12
        .byte 14,15,15,14,13,14,15,15,14,15,15,15,15,12,14,14
        .byte 14,14,12,13,13,13,13,13,11,11,13,13,13,12,12,12
        .byte 14,14,14,14,14,14,13,14,14,12,12,14,12,13,14,14
        .byte 12,11,12,13,12,12,12,11,10,11,10,11,11,12,12,12
        .byte 14,15,15,14,13,14,15,15,14,15,15,15,15,12,14,14
        .byte 14,14,12,13,13,13,13,13,11,11,13,13,13,12,12,12
        .byte 14,14,14,14,14,14,13,14,14,12,12,14,12,13,14,14
        .byte 12,11,12,13,12,12,12,11,10,11,10,11,11,12,12,12
wave_N_b:
        .byte 0,0,5,10,12,11,9,9,11,7,6,5,0,12,7,5
        .byte 2,0,10,8,7,7,7,7,11,11,8,8,8,10,10,10
        .byte 0,0,1,2,3,4,9,5,5,11,11,6,11,9,3,0
        .byte 10,11,9,1,7,6,4,7,8,0,7,6,7,3,6,7
        .byte 0,0,5,10,12,11,9,9,11,7,6,5,0,12,7,5
        .byte 2,0,10,8,7,7,7,7,11,11,8,8,8,10,10,10
        .byte 0,0,1,2,3,4,9,5,5,11,11,6,11,9,3,0
        .byte 10,11,9,1,7,6,4,7,8,0,7,6,7,3,6,7
        .byte 0,0,5,10,12,11,9,9,11,7,6,5,0,12,7,5
        .byte 2,0,10,8,7,7,7,7,11,11,8,8,8,10,10,10
        .byte 0,0,1,2,3,4,9,5,5,11,11,6,11,9,3,0
        .byte 10,11,9,1,7,6,4,7,8,0,7,6,7,3,6,7
        .byte 0,0,5,10,12,11,9,9,11,7,6,5,0,12,7,5
        .byte 2,0,10,8,7,7,7,7,11,11,8,8,8,10,10,10
        .byte 0,0,1,2,3,4,9,5,5,11,11,6,11,9,3,0
        .byte 10,11,9,1,7,6,4,7,8,0,7,6,7,3,6,7
wave_NG_a:
        .byte 14,14,15,14,14,15,15,14,15,15,15,12,14,13,14,12
        .byte 13,13,13,13,11,13,12,14,14,14,14,13,13,14,14,14
        .byte 14,12,12,13,13,13,13,13,12,14,14,13,14,12,12,14
        .byte 14,14,12,13,13,13,12,12,11,10,11,11,11,12,12,10
        .byte 14,14,15,14,14,15,15,14,15,15,15,12,14,13,14,12
        .byte 13,13,13,13,11,13,12,14,14,14,14,13,13,14,14,14
        .byte 14,12,12,13,13,13,13,13,12,14,14,13,14,12,12,14
        .byte 14,14,12,13,13,13,12,12,11,10,11,11,11,12,12,10
        .byte 14,14,15,14,14,15,15,14,15,15,15,12,14,13,14,12
        .byte 13,13,13,13,11,13,12,14,14,14,14,13,13,14,14,14
        .byte 14,12,12,13,13,13,13,13,12,14,14,13,14,12,12,14
        .byte 14,14,12,13,13,13,12,12,11,10,11,11,11,12,12,10
        .byte 14,14,15,14,14,15,15,14,15,15,15,12,14,13,14,12
        .byte 13,13,13,13,11,13,12,14,14,14,14,13,13,14,14,14
        .byte 14,12,12,13,13,13,13,13,12,14,14,13,14,12,12,14
        .byte 14,14,12,13,13,13,12,12,11,10,11,11,11,12,12,10
wave_NG_b:
        .byte 0,9,5,10,11,9,9,11,8,6,5,12,6,9,1,10
        .byte 7,7,7,7,11,8,10,0,2,3,4,9,9,4,3,1
        .byte 0,10,10,8,8,8,8,8,10,0,2,9,5,11,11,6
        .byte 5,2,10,8,6,0,6,4,7,8,2,0,6,3,6,10
        .byte 0,9,5,10,11,9,9,11,8,6,5,12,6,9,1,10
        .byte 7,7,7,7,11,8,10,0,2,3,4,9,9,4,3,1
        .byte 0,10,10,8,8,8,8,8,10,0,2,9,5,11,11,6
        .byte 5,2,10,8,6,0,6,4,7,8,2,0,6,3,6,10
        .byte 0,9,5,10,11,9,9,11,8,6,5,12,6,9,1,10
        .byte 7,7,7,7,11,8,10,0,2,3,4,9,9,4,3,1
        .byte 0,10,10,8,8,8,8,8,10,0,2,9,5,11,11,6
        .byte 5,2,10,8,6,0,6,4,7,8,2,0,6,3,6,10
        .byte 0,9,5,10,11,9,9,11,8,6,5,12,6,9,1,10
        .byte 7,7,7,7,11,8,10,0,2,3,4,9,9,4,3,1
        .byte 0,10,10,8,8,8,8,8,10,0,2,9,5,11,11,6
        .byte 5,2,10,8,6,0,6,4,7,8,2,0,6,3,6,10
wave_B_a:
        .byte 13,13,14,15,15,12,15,12,11,14,13,14,12,12,10,12
        .byte 15,12,12,14,12,11,11,15,15,14,11,12,14,14,13,12
        .byte 15,12,10,14,14,12,12,14,14,12,14,14,13,13,14,14
        .byte 13,14,13,14,13,13,14,14,14,14,13,13,12,11,10,13
        .byte 14,12,15,13,15,14,12,14,14,11,12,14,14,14,13,11
        .byte 12,13,13,14,14,14,13,12,14,12,14,12,12,14,14,11
        .byte 14,13,14,12,13,13,13,11,13,12,14,14,13,12,14,14
        .byte 14,14,13,14,13,13,13,13,13,13,13,13,12,13,13,10
        .byte 14,15,12,12,15,12,14,14,14,12,14,14,14,13,13,13
        .byte 13,12,12,14,13,14,14,13,14,14,14,14,14,14,14,14
        .byte 14,14,12,12,12,13,11,13,13,13,13,12,12,12,14,13
        .byte 14,12,12,14,12,11,13,13,13,13,13,13,12,12,12,12
        .byte 14,12,15,15,15,14,14,12,14,12,14,14,14,13,11,13
        .byte 13,13,12,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,12,12,13,13,13,13,13,13,13,12,12,12,14,13
        .byte 14,14,12,14,12,13,11,13,13,13,13,13,10,12,12,12
wave_B_b:
        .byte 3,5,7,7,3,12,6,10,10,10,12,0,12,12,8,5
        .byte 5,10,6,6,11,9,11,5,5,7,11,10,7,0,7,12
        .byte 5,9,10,4,4,7,9,8,1,8,1,8,5,0,6,7
        .byte 8,6,11,5,5,7,0,0,3,3,8,4,6,7,9,4
        .byte 6,12,5,12,5,6,11,6,0,11,10,5,5,0,8,11
        .byte 9,3,7,2,3,6,10,11,0,11,6,10,10,5,0,11
        .byte 1,9,1,10,8,7,7,11,8,10,4,1,8,10,2,2
        .byte 5,6,9,2,8,6,7,8,6,6,8,1,6,0,0,10
        .byte 0,4,12,12,4,12,5,6,7,11,5,5,0,8,7,6
        .byte 7,10,10,1,9,2,1,9,4,3,5,5,3,2,0,0
        .byte 0,0,10,10,10,8,11,8,8,8,8,10,10,10,2,9
        .byte 5,11,11,3,10,11,7,7,6,7,7,2,7,7,7,8
        .byte 0,12,0,1,2,8,6,11,6,11,5,5,1,8,11,7
        .byte 7,8,10,0,1,3,4,4,4,4,4,3,3,2,1,0
        .byte 0,0,10,10,8,8,8,8,8,8,8,10,10,10,1,9
        .byte 5,5,11,4,10,8,11,7,6,7,7,1,10,7,7,8
wave_D_a:
        .byte 15,13,12,14,12,12,14,14,15,14,12,14,13,11,13,11
        .byte 12,14,14,15,13,14,14,14,14,12,14,14,13,14,13,14
        .byte 13,13,12,14,14,14,12,11,14,13,12,13,13,12,11,13
        .byte 14,14,14,12,14,13,13,14,13,13,11,12,13,12,13,12
        .byte 11,15,14,14,14,12,15,14,14,14,14,12,13,13,13,12
        .byte 14,13,14,14,14,14,14,12,14,14,14,13,14,13,14,12
        .byte 11,14,12,14,12,13,14,13,13,13,11,14,13,13,12,12
        .byte 14,14,14,14,14,12,11,13,12,13,12,11,13,12,13,12
        .byte 14,13,13,13,13,15,15,14,14,14,14,12,13,13,12,12
        .byte 12,14,14,14,14,14,14,14,14,14,14,14,14,12,12,12
        .byte 12,14,14,14,14,14,14,12,13,13,11,13,11,13,13,14
        .byte 14,14,14,14,14,14,12,13,13,13,12,12,13,13,13,10
        .byte 14,13,14,14,13,14,15,12,13,14,14,13,13,11,13,12
        .byte 12,12,14,13,13,13,13,13,14,14,14,12,12,12,12,12
        .byte 14,14,14,14,14,14,14,12,12,13,13,13,13,13,13,14
        .byte 14,14,14,14,14,14,12,13,13,13,12,12,13,13,13,12
wave_D_b:
        .byte 6,8,12,10,10,12,8,0,0,3,8,7,6,11,10,9
        .byte 10,1,6,0,0,0,8,5,0,5,7,6,0,0,6,7
        .byte 9,5,11,6,3,3,10,11,5,7,9,7,6,10,11,8
        .byte 4,7,6,11,8,9,9,0,6,8,9,6,5,7,6,8
        .byte 11,4,8,8,8,12,4,7,4,1,3,10,7,7,7,10
        .byte 0,8,4,1,6,5,1,11,0,4,0,8,3,7,3,10
        .byte 11,5,10,3,10,8,6,8,8,8,11,2,7,8,10,10
        .byte 5,0,3,5,6,11,11,8,10,6,7,9,4,9,3,7
        .byte 2,11,10,10,10,3,0,5,4,2,1,10,7,7,10,10
        .byte 10,1,1,4,5,3,5,4,1,3,0,0,0,10,10,10
        .byte 10,2,0,0,1,0,0,10,8,8,11,8,11,8,8,0
        .byte 3,2,3,5,6,3,10,8,8,7,7,7,4,4,5,10
        .byte 0,11,7,8,10,9,0,11,9,3,1,8,6,11,8,10
        .byte 10,10,4,9,9,9,9,9,3,0,0,10,10,10,10,10
        .byte 0,0,0,1,0,0,0,10,10,8,8,8,8,8,8,0
        .byte 2,3,3,5,6,3,10,8,8,7,7,7,4,4,5,7
wave_G_a:
        .byte 10,14,15,11,15,13,13,13,13,12,13,11,13,13,13,14
        .byte 13,14,13,13,14,14,14,14,12,13,14,14,13,13,13,13
        .byte 15,14,12,14,14,13,14,14,11,11,13,12,12,13,12,14
        .byte 12,14,15,14,13,14,12,13,14,13,13,12,12,13,13,12
        .byte 13,15,13,13,12,15,14,12,14,14,13,14,12,13,13,12
        .byte 13,14,14,13,14,14,14,14,12,14,13,11,13,14,13,13
        .byte 14,12,12,14,14,14,12,13,12,12,13,13,13,12,14,14
        .byte 14,14,14,14,13,14,14,14,13,13,12,13,13,12,13,10
        .byte 14,15,12,14,13,14,12,12,14,13,12,14,12,13,13,11
        .byte 14,14,14,14,14,14,14,14,14,14,12,14,12,12,14,14
        .byte 14,14,14,14,14,14,12,14,12,11,13,13,11,13,12,12
        .byte 14,13,14,14,13,14,14,14,11,13,13,13,13,12,13,10
        .byte 14,15,14,14,14,14,14,14,14,13,14,14,13,11,11,13
        .byte 14,14,14,14,13,14,13,14,14,14,14,14,12,12,12,14
        .byte 14,14,14,14,14,14,12,12,12,13,11,11,13,12,12,12
        .byte 14,13,14,14,14,14,14,14,13,13,13,13,13,12,13,10
wave_G_b:
        .byte 9,12,6,10,5,12,6,4,10,11,8,11,1,7,10,4
        .byte 8,2,6,7,5,5,8,5,3,6,10,6,2,8,6,8
        .byte 5,6,8,0,5,8,1,0,11,11,5,10,11,7,10,6
        .byte 9,0,2,3,8,7,10,7,0,6,0,8,7,7,7,6
        .byte 8,4,10,9,12,4,7,11,8,0,6,2,10,6,8,10
        .byte 7,2,6,9,0,5,7,3,10,5,9,11,8,0,8,8
        .byte 0,10,10,1,1,1,10,8,10,10,8,7,7,10,0,0
        .byte 0,1,5,6,9,0,0,1,8,3,7,2,5,9,0,10
        .byte 0,2,12,7,10,8,12,12,4,8,10,0,10,8,7,11
        .byte 0,4,3,1,3,5,5,3,2,0,10,0,10,10,0,0
        .byte 0,1,0,0,2,0,10,0,10,11,8,8,11,8,10,10
        .byte 0,9,5,5,9,0,0,2,11,3,0,3,4,9,2,10
        .byte 0,2,8,7,8,8,8,8,5,8,0,0,8,11,11,8
        .byte 0,3,1,2,9,5,9,4,3,1,0,0,10,10,10,0
        .byte 0,0,1,1,0,0,10,10,10,8,11,11,8,10,10,10
        .byte 0,9,5,5,4,0,0,3,8,2,0,3,4,9,2,10
wave_P_a:
        .byte 15,11,15,14,11,13,13,10,13,14,13,12,12,13,12,13
        .byte 13,12,13,14,13,14,14,13,15,13,13,15,11,14,12,13
        .byte 13,14,12,12,14,12,14,14,13,12,14,11,14,12,13,12
        .byte 13,13,14,13,14,13,13,14,14,13,12,13,13,14,13,14
        .byte 14,12,14,13,12,14,14,14,13,13,14,14,14,12,13,14
        .byte 12,13,14,13,14,12,13,14,14,11,14,13,13,14,12,14
        .byte 14,12,14,14,12,14,14,12,14,13,13,14,12,12,14,11
        .byte 14,14,12,14,13,12,12,12,13,14,14,12,14,12,14,14
        .byte 12,14,12,12,14,12,14,14,12,14,12,14,14,12,14,14
        .byte 13,12,12,12,14,14,12,14,14,14,14,12,12,14,14,14
        .byte 14,12,12,14,14,14,14,12,12,14,14,14,14,12,14,14
        .byte 14,14,14,14,14,14,14,12,14,14,14,14,12,12,14,14
        .byte 14,14,12,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,12,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
wave_P_b:
        .byte 4,0,3,8,8,10,4,10,12,8,5,11,8,5,12,7
        .byte 9,11,5,0,0,6,7,8,6,4,6,0,9,3,12,3
        .byte 9,6,7,10,7,8,6,8,3,12,0,9,8,10,7,12
        .byte 7,6,8,7,0,10,5,2,5,6,11,8,7,3,8,7
        .byte 4,10,2,6,10,5,1,3,7,8,1,0,5,10,8,6
        .byte 10,8,4,6,4,11,7,5,0,11,5,8,8,4,10,0
        .byte 1,10,0,1,10,3,3,10,4,8,8,5,10,10,2,11
        .byte 0,4,10,3,9,10,10,10,8,5,1,10,0,10,1,3
        .byte 10,0,10,10,1,10,1,0,10,1,10,0,1,10,3,1
        .byte 8,10,10,10,3,0,10,0,0,0,1,10,10,1,0,0
        .byte 0,10,10,0,0,0,1,10,10,1,0,0,0,10,0,0
        .byte 0,0,0,0,0,0,0,10,0,1,0,0,10,10,0,0
        .byte 0,0,10,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,10,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
wave_T_a:
        .byte 14,11,12,13,15,13,12,12,12,14,12,12,13,14,13,14
        .byte 13,12,12,13,12,14,12,12,13,11,13,14,11,13,13,13
        .byte 12,12,13,14,13,13,14,14,14,13,13,13,14,13,14,11
        .byte 13,14,14,13,14,13,13,12,14,12,15,12,14,12,14,11
        .byte 14,13,14,14,14,13,14,12,13,14,12,12,14,12,14,12
        .byte 14,12,13,14,13,14,14,12,11,14,12,14,14,13,13,11
        .byte 13,13,14,13,14,13,14,14,14,13,14,13,14,14,13,12
        .byte 11,14,12,14,14,13,13,13,12,11,12,13,14,12,14,12
        .byte 14,14,11,14,12,14,14,12,12,14,12,14,14,14,12,12
        .byte 14,12,14,12,14,12,14,12,14,12,12,14,12,14,14,12
        .byte 14,12,14,14,14,12,14,14,12,14,14,12,14,12,14,12
        .byte 14,14,12,14,12,14,14,14,14,12,14,14,14,14,12,14
        .byte 14,14,14,14,12,14,14,12,14,12,14,14,14,14,14,14
        .byte 14,12,14,14,14,14,14,12,14,12,14,14,14,12,14,14
        .byte 14,14,12,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
wave_T_b:
        .byte 1,9,12,0,5,8,9,12,1,10,6,12,5,8,6,6
        .byte 8,8,12,8,10,8,9,7,12,7,11,1,11,8,10,0
        .byte 10,12,1,8,7,8,1,0,6,5,9,8,6,7,5,11
        .byte 8,6,0,6,6,7,9,10,7,7,0,8,7,10,1,11
        .byte 5,7,5,0,0,8,1,10,9,0,10,10,0,10,6,9
        .byte 7,9,9,3,8,3,0,10,11,7,9,6,0,8,9,11
        .byte 9,8,6,7,5,7,0,0,4,8,5,7,0,2,8,11
        .byte 11,3,10,0,3,8,9,7,11,11,11,7,3,10,3,10
        .byte 0,1,11,5,10,1,1,10,10,0,10,0,0,1,10,10
        .byte 1,10,4,10,0,10,3,10,1,10,10,0,10,1,0,10
        .byte 0,10,0,0,1,10,0,0,10,0,1,10,1,10,1,10
        .byte 1,0,10,0,10,0,0,0,0,10,0,0,0,0,10,0
        .byte 0,0,0,0,10,0,0,10,0,10,0,0,0,0,0,0
        .byte 0,10,0,0,0,0,0,10,0,10,0,0,0,10,0,0
        .byte 0,0,10,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
wave_K_a:
        .byte 15,9,13,14,13,12,13,9,15,15,9,11,14,12,14,14
        .byte 13,14,14,14,12,13,12,11,12,12,12,11,14,14,14,12
        .byte 14,10,13,14,14,13,12,14,14,13,13,12,12,12,14,12
        .byte 14,14,12,13,14,14,13,13,13,14,13,14,13,14,14,13
        .byte 14,14,12,13,13,14,14,13,14,12,14,14,13,13,12,14
        .byte 14,12,14,14,13,14,12,12,12,13,14,14,12,14,12,14
        .byte 12,13,14,14,12,14,14,14,12,14,14,14,14,13,14,14
        .byte 13,14,12,12,14,12,14,14,14,14,13,14,14,11,14,14
        .byte 13,14,14,13,14,12,12,14,14,14,12,12,14,12,12,14
        .byte 13,14,14,13,12,14,14,14,14,12,14,14,14,14,12,12
        .byte 14,14,12,14,14,12,14,14,12,14,14,14,14,14,14,14
        .byte 14,12,14,14,14,14,14,14,14,12,12,14,12,12,14,14
        .byte 14,14,12,14,14,14,12,14,14,12,14,14,14,14,14,14
        .byte 14,14,12,14,14,14,14,14,14,14,14,14,14,12,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14
wave_K_b:
        .byte 11,9,6,11,1,12,6,6,9,6,9,11,6,9,4,6
        .byte 5,1,7,6,12,9,10,10,6,10,10,11,6,6,8,12
        .byte 0,10,2,6,7,7,6,2,10,7,5,11,10,12,5,6
        .byte 4,3,9,10,7,3,5,3,10,0,6,4,8,8,6,0
        .byte 1,5,10,6,0,7,8,9,4,9,3,7,6,7,10,0
        .byte 0,10,6,2,8,3,10,10,10,8,5,3,10,1,10,0
        .byte 10,7,5,5,10,0,2,0,10,0,0,0,0,8,3,3
        .byte 8,2,10,10,3,10,3,2,0,1,8,1,3,11,1,1
        .byte 8,4,1,8,0,10,10,0,1,4,10,10,3,10,10,0
        .byte 8,2,4,8,10,0,0,3,0,10,0,0,0,0,10,10
        .byte 1,0,10,1,0,10,0,0,10,0,0,0,1,0,0,0
        .byte 0,10,0,0,0,0,0,0,1,10,10,1,10,10,1,0
        .byte 0,0,10,0,1,0,10,0,0,10,0,0,0,0,0,0
        .byte 0,0,10,0,0,0,0,0,0,0,0,0,0,10,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
wave_F_a:
        .byte 13,14,12,13,14,13,12,11,14,13,12,14,10,12,14,13
        .byte 14,11,14,12,12,14,11,14,13,13,15,13,13,13,15,13
        .byte 12,15,14,14,11,15,13,13,12,15,13,12,14,13,13,14
        .byte 12,13,12,14,13,13,14,14,15,13,12,15,13,13,12,12
        .byte 14,12,12,15,11,11,14,13,13,13,12,13,14,15,11,12
        .byte 13,13,14,12,14,12,14,12,13,14,13,14,12,14,15,12
        .byte 13,14,13,14,13,14,14,13,12,11,13,15,13,14,12,14
        .byte 14,12,14,12,14,14,13,15,13,12,13,14,11,14,14,14
        .byte 13,14,14,11,11,12,13,12,15,12,14,11,13,13,12,14
        .byte 14,14,10,13,14,13,13,14,14,13,14,13,14,12,14,11
        .byte 14,12,14,14,14,13,13,14,14,12,12,12,13,12,14,14
        .byte 12,14,14,13,12,14,15,11,13,12,13,13,14,14,13,14
        .byte 13,14,10,12,13,14,13,13,14,13,12,13,12,12,13,12
        .byte 12,13,13,12,12,12,14,12,14,14,14,13,12,13,12,14
        .byte 14,14,14,13,14,14,13,14,12,13,14,14,12,13,12,14
        .byte 11,12,14,13,14,11,14,14,14,14,14,14,11,14,14,14
        .byte 11,13,14,14,13,14,13,13,12,14,12,12,12,14,13,14
        .byte 13,12,14,13,12,13,13,13,14,11,13,14,14,13,12,12
        .byte 12,13,13,14,13,14,12,12,14,13,14,13,13,15,12,14
        .byte 12,14,14,12,14,13,12,13,14,14,12,12,14,13,13,13
        .byte 14,14,11,14,15,12,13,14,14,12,12,14,12,13,14,12
        .byte 15,11,14,13,15,13,12,15,12,14,11,14,12,14,12,12
        .byte 12,12,14,12,12,14,13,15,12,13,12,11,13,13,14,12
        .byte 15,14,10,14,10,14,11,15,14,13,14,14,14,12,14,13
        .byte 13,12,14,11,14,12,14,14,12,13,13,13,12,14,14,13
        .byte 13,14,12,14,13,13,13,13,13,12,11,12,14,14,12,12
        .byte 14,11,14,14,13,14,13,14,13,13,15,12,14,13,12,14
        .byte 14,14,12,15,12,12,13,14,14,13,12,12,13,14,14,14
        .byte 12,13,12,12,12,11,15,13,14,12,13,14,12,14,13,14
        .byte 14,13,12,12,14,14,13,14,12,13,13,14,14,12,11,11
        .byte 13,13,14,14,13,13,12,13,12,12,12,14,11,15,13,11
        .byte 13,13,14,11,14,13,14,13,13,14,13,13,14,14,13,13
wave_F_b:
        .byte 7,7,7,9,7,4,12,11,2,8,7,8,10,12,8,7
        .byte 8,10,6,7,10,6,11,8,5,7,4,3,9,3,5,7
        .byte 4,6,0,0,9,0,8,7,11,3,5,8,7,4,7,7
        .byte 12,10,5,7,8,4,0,6,4,6,6,5,5,0,10,12
        .byte 7,6,12,5,9,11,0,7,8,5,12,8,5,2,9,12
        .byte 7,7,3,6,11,2,8,10,5,7,3,7,10,4,1,8
        .byte 6,8,6,1,7,7,6,3,11,11,6,2,7,4,10,1
        .byte 6,1,6,10,7,2,8,5,2,10,0,7,10,5,7,0
        .byte 7,7,3,10,11,12,8,3,6,11,6,6,11,10,1,1
        .byte 6,10,10,9,8,5,1,0,6,7,5,10,8,4,6,11
        .byte 0,9,3,8,3,8,7,4,6,8,10,11,10,8,7,8
        .byte 6,5,0,10,6,8,5,7,9,10,10,0,6,8,0,8
        .byte 3,7,10,12,3,5,7,10,7,7,11,5,12,4,6,12
        .byte 10,9,7,12,10,6,10,5,9,0,6,6,4,12,6,2
        .byte 3,8,0,5,5,0,8,7,10,3,3,6,10,7,10,10
        .byte 11,7,6,6,6,6,10,6,3,0,3,5,9,2,0,3
        .byte 11,10,5,5,4,1,7,7,10,5,12,10,9,3,7,1
        .byte 7,12,7,6,11,3,8,7,7,11,8,6,7,7,10,12
        .byte 8,9,5,8,1,5,12,7,7,7,8,1,8,0,9,5
        .byte 10,2,0,8,8,8,12,7,5,0,9,8,5,11,0,10
        .byte 6,8,6,2,2,8,5,5,9,7,10,8,12,1,2,8
        .byte 6,7,7,5,7,7,8,7,4,10,6,11,6,6,10,8
        .byte 12,5,10,7,12,5,5,4,3,11,8,10,10,3,10,7
        .byte 6,2,10,8,10,7,9,5,7,2,4,5,3,6,7,10
        .byte 9,3,8,11,2,10,8,8,7,9,6,8,10,8,2,6
        .byte 7,6,10,0,10,10,5,5,0,12,9,12,7,4,11,8
        .byte 7,9,5,8,1,8,9,1,6,6,3,6,7,0,12,0
        .byte 0,5,7,6,3,11,9,8,0,3,11,10,6,6,4,1
        .byte 11,4,11,8,12,9,0,5,8,11,6,7,6,9,4,0
        .byte 7,7,11,7,0,6,8,7,10,10,7,0,0,10,11,11
        .byte 8,8,8,4,9,9,10,5,7,12,10,8,10,6,6,10
        .byte 6,6,10,6,11,6,8,5,8,0,0,9,5,5,8,10
wave_V_a:
        .byte 14,12,14,12,14,14,14,13,12,14,11,14,14,12,12,12
        .byte 13,14,14,14,14,10,11,13,13,14,13,13,15,12,14,14
        .byte 13,14,12,12,12,14,13,11,14,14,13,14,13,14,12,13
        .byte 13,13,13,14,14,14,12,14,14,14,13,13,13,13,13,13
        .byte 13,15,14,14,14,14,14,13,12,12,13,13,13,13,14,12
        .byte 14,14,14,12,13,12,13,13,14,12,11,14,11,14,14,13
        .byte 13,14,14,14,13,14,12,13,13,13,14,12,13,14,14,12
        .byte 13,13,12,13,11,14,14,13,14,13,13,13,13,13,12,12
        .byte 14,15,14,14,14,12,14,12,13,13,12,12,14,14,13,14
        .byte 12,14,12,14,13,14,14,13,14,14,14,14,13,12,14,14
        .byte 14,13,14,12,13,14,13,13,14,13,13,12,13,14,14,13
        .byte 11,11,14,14,13,14,14,14,14,11,13,12,13,13,13,11
        .byte 13,15,14,15,14,12,14,12,12,14,13,14,14,14,14,13
        .byte 14,14,13,13,13,14,14,13,14,12,11,14,14,13,14,14
        .byte 13,14,14,13,14,13,12,14,13,14,14,14,14,13,14,13
        .byte 12,14,12,13,14,13,12,14,14,12,12,13,13,13,13,12
        .byte 14,12,14,12,14,14,12,12,14,13,12,13,11,14,14,14
        .byte 14,14,13,14,13,13,13,13,13,14,14,14,13,12,14,13
        .byte 12,13,12,14,13,14,14,13,14,12,11,14,14,14,12,12
        .byte 12,11,13,13,14,14,12,14,13,13,14,13,13,14,12,12
        .byte 14,14,12,15,12,14,14,11,14,13,13,14,14,13,14,14
        .byte 14,12,11,14,14,12,13,13,14,14,13,14,14,13,14,12
        .byte 14,11,13,11,14,14,13,14,14,14,12,13,14,14,13,13
        .byte 14,14,11,13,13,14,12,13,14,12,14,13,13,13,13,13
        .byte 12,12,14,14,14,14,12,12,13,14,13,14,12,14,14,13
        .byte 14,14,11,14,13,14,12,12,13,13,13,14,12,13,14,14
        .byte 12,14,13,14,12,13,13,14,14,12,14,14,14,12,13,12
        .byte 13,13,13,13,14,14,13,14,14,11,12,13,13,12,12,13
        .byte 14,14,14,13,14,12,14,13,11,14,13,13,13,14,14,14
        .byte 14,14,14,13,13,12,13,11,11,13,11,14,14,14,14,12
        .byte 14,14,13,12,13,11,14,13,14,14,14,14,13,14,14,13
        .byte 13,13,12,14,13,13,14,12,12,12,13,13,13,12,13,13
wave_V_b:
        .byte 2,12,5,12,7,3,8,7,9,1,11,0,0,9,12,12
        .byte 5,6,6,3,7,10,11,10,2,4,8,7,2,10,0,6
        .byte 6,5,10,9,10,0,9,11,4,2,7,6,6,0,11,0
        .byte 9,8,2,5,0,4,11,0,6,6,5,1,8,5,5,4
        .byte 8,0,6,6,6,6,6,6,10,10,7,9,8,8,7,11
        .byte 0,6,2,10,9,10,7,7,6,10,11,6,11,7,1,5
        .byte 10,0,0,0,6,5,10,6,8,9,4,10,9,2,1,10
        .byte 5,8,10,6,11,6,0,9,8,8,7,8,7,6,6,8
        .byte 5,0,7,1,8,12,4,10,7,7,10,10,1,1,9,5
        .byte 11,3,10,0,6,1,5,6,3,1,5,6,7,11,5,4
        .byte 0,5,7,10,3,7,5,8,7,5,10,11,0,8,1,6
        .byte 11,10,3,0,6,4,0,5,8,11,6,10,0,8,7,7
        .byte 10,2,1,0,2,11,7,8,10,1,4,6,2,5,8,6
        .byte 7,6,6,9,6,4,7,5,1,11,11,3,0,7,6,5
        .byte 6,4,1,8,3,5,10,6,8,1,0,6,5,4,4,6
        .byte 9,0,7,9,7,7,12,0,6,12,7,7,5,0,8,6
        .byte 5,12,7,12,5,8,10,9,1,1,10,8,11,8,6,0
        .byte 8,6,8,0,7,7,10,5,8,8,0,6,6,10,7,7
        .byte 10,7,10,6,6,0,4,8,6,10,11,3,0,1,10,10
        .byte 10,11,8,6,2,6,9,6,10,8,0,0,0,2,8,7
        .byte 6,6,12,4,10,7,6,11,0,3,5,6,4,8,1,6
        .byte 7,11,11,1,6,10,7,6,3,0,8,7,3,9,2,10
        .byte 5,11,6,11,5,1,7,4,3,4,10,6,2,4,8,6
        .byte 0,5,11,7,7,4,11,8,4,11,0,6,6,7,1,0
        .byte 10,12,7,2,8,6,11,10,7,2,6,1,10,1,7,5
        .byte 8,7,11,8,2,0,12,7,8,9,7,8,10,3,8,6
        .byte 10,4,6,0,11,6,6,4,3,10,4,0,3,10,7,10
        .byte 6,7,7,7,7,5,8,8,7,11,10,0,4,10,5,4
        .byte 8,7,7,10,8,12,3,5,11,3,7,7,7,3,7,3
        .byte 1,0,7,10,7,10,9,11,11,7,11,5,3,0,6,11
        .byte 5,2,6,10,8,11,3,7,1,5,5,6,6,0,6,6
        .byte 2,6,10,0,8,7,8,12,10,11,7,6,8,7,4,1
wave_TH_a:
        .byte 14,13,12,13,13,15,10,14,14,14,14,12,12,13,13,13
        .byte 11,14,12,13,12,14,13,14,11,14,14,13,14,11,12,12
        .byte 12,12,12,12,14,11,15,12,14,12,13,12,13,13,15,13
        .byte 13,14,12,12,13,14,14,13,14,13,14,13,14,13,14,14
        .byte 12,14,14,13,14,12,14,14,12,14,12,14,14,12,13,11
        .byte 15,14,13,14,12,13,12,11,15,13,14,12,13,15,12,13
        .byte 12,12,14,13,12,14,14,12,13,15,13,14,13,12,15,11
        .byte 12,14,14,14,12,12,12,13,12,14,12,14,12,12,14,11
        .byte 13,14,13,15,13,13,15,12,14,12,13,12,13,14,14,13
        .byte 12,13,14,14,14,13,13,13,14,11,13,11,12,14,13,13
        .byte 13,14,13,12,14,13,14,13,14,13,14,12,12,15,13,12
        .byte 11,14,14,12,14,14,14,13,14,14,13,13,14,14,13,13
        .byte 12,14,12,11,12,14,13,14,14,13,14,12,12,13,12,14
        .byte 12,13,10,14,14,12,12,12,12,12,13,14,14,14,13,14
        .byte 13,13,13,14,14,13,14,14,14,13,13,14,13,14,13,11
        .byte 15,13,11,14,13,15,12,13,14,13,14,13,14,14,12,12
        .byte 14,13,13,13,13,14,11,14,14,11,14,14,12,13,13,12
        .byte 13,14,13,14,14,11,13,11,12,14,12,13,14,14,13,14
        .byte 12,14,13,14,14,12,12,11,12,13,14,14,13,13,12,15
        .byte 13,11,14,13,14,13,14,15,13,13,14,14,14,13,12,13
        .byte 13,14,15,12,15,12,13,14,10,15,14,13,12,12,14,13
        .byte 14,13,14,14,13,15,13,14,14,12,12,12,14,12,14,14
        .byte 13,14,13,14,13,13,12,12,14,13,13,14,13,14,14,12
        .byte 13,13,14,13,14,13,14,14,13,14,13,13,13,12,14,13
        .byte 14,13,14,12,13,12,13,14,13,14,14,13,14,14,12,14
        .byte 14,14,11,13,14,12,14,12,14,13,12,13,13,14,14,12
        .byte 13,13,13,15,13,13,12,12,14,12,12,15,11,15,13,14
        .byte 14,13,12,13,14,12,12,14,13,12,11,14,14,13,14,13
        .byte 12,14,13,12,11,14,12,12,14,14,12,12,14,13,14,15
        .byte 12,15,12,13,13,13,15,10,12,14,13,14,13,15,13,12
        .byte 12,12,14,13,13,15,12,14,13,11,14,14,13,14,13,12
        .byte 13,13,14,13,14,13,14,14,13,12,14,14,14,11,14,14
wave_TH_b:
        .byte 7,6,10,6,7,4,10,6,0,7,6,0,12,10,7,6
        .byte 11,7,10,3,12,7,6,6,9,6,3,5,10,7,12,12
        .byte 8,12,0,12,3,9,0,10,0,11,6,10,9,3,5,6
        .byte 8,8,5,12,5,7,5,4,8,7,6,0,1,10,0,4
        .byte 7,8,6,0,5,9,8,0,10,7,4,7,6,11,8,6
        .byte 7,7,0,6,6,12,10,6,7,4,6,10,4,6,8,7
        .byte 11,11,5,5,11,1,4,9,0,6,8,3,7,10,6,7
        .byte 10,1,7,8,8,11,10,7,10,3,10,6,10,10,8,9
        .byte 7,8,7,0,4,6,6,4,7,10,3,12,6,6,0,7
        .byte 11,6,2,6,3,6,1,10,8,11,8,10,12,2,1,10
        .byte 6,7,6,10,6,2,7,8,8,0,4,10,9,0,0,12
        .byte 10,5,6,6,8,4,4,6,1,7,3,7,7,5,8,7
        .byte 12,4,8,11,10,8,6,6,6,7,7,6,12,7,10,7
        .byte 6,12,10,7,6,8,12,6,12,10,3,3,3,8,9,4
        .byte 6,6,4,4,6,9,6,0,1,7,0,6,10,6,6,9
        .byte 0,7,11,5,9,5,6,7,5,8,5,8,2,1,10,10
        .byte 8,5,8,10,6,6,11,4,6,9,6,8,10,4,7,12
        .byte 9,0,7,7,0,10,8,11,12,1,11,3,4,1,8,7
        .byte 7,8,4,8,4,8,12,11,11,0,5,6,8,8,10,4
        .byte 2,11,1,8,7,0,1,0,6,6,7,0,5,5,6,12
        .byte 1,4,0,5,6,7,7,5,10,6,0,8,10,10,7,6
        .byte 5,6,0,1,0,0,2,8,5,9,12,6,8,9,3,6
        .byte 4,6,6,8,4,8,12,10,5,0,9,6,3,4,2,11
        .byte 7,8,5,6,6,8,7,0,7,6,0,8,8,12,6,6
        .byte 3,8,6,8,7,12,9,3,5,0,5,5,5,5,10,0
        .byte 0,8,9,6,6,12,7,4,8,8,10,8,6,7,4,11
        .byte 7,8,5,6,4,6,12,6,10,6,11,4,7,3,0,6
        .byte 4,1,12,6,8,8,10,6,8,12,9,7,7,5,0,0
        .byte 12,8,5,10,11,7,10,10,5,0,11,5,7,8,3,4
        .byte 5,7,5,7,10,0,6,9,12,8,3,1,0,5,8,7
        .byte 12,10,0,7,3,6,10,0,9,9,8,0,8,5,8,12
        .byte 3,3,5,10,1,6,6,6,7,7,3,6,3,11,4,5
wave_DH_a:
        .byte 13,14,15,14,12,14,13,14,14,12,13,14,14,14,13,13
        .byte 14,14,14,14,11,14,12,11,14,14,13,14,14,14,14,14
        .byte 13,14,14,13,12,13,13,14,14,13,14,14,14,14,13,13
        .byte 12,11,12,14,12,14,14,12,14,13,11,13,13,12,13,12
        .byte 11,15,14,12,14,14,14,14,13,12,12,13,14,14,14,14
        .byte 14,12,14,14,14,14,14,13,12,14,13,14,12,13,12,14
        .byte 12,14,13,11,12,14,12,14,12,13,14,14,13,11,13,13
        .byte 13,14,12,14,14,14,14,14,11,13,14,13,12,13,12,12
        .byte 14,14,14,14,14,13,12,14,12,14,13,13,14,13,13,14
        .byte 14,14,14,14,14,14,14,14,14,14,14,13,13,14,13,14
        .byte 13,11,14,14,14,13,12,13,13,14,13,13,14,13,11,13
        .byte 12,12,14,12,14,13,13,14,14,13,12,13,13,13,12,12
        .byte 12,15,12,14,14,14,14,14,11,13,12,13,12,14,13,14
        .byte 14,14,14,12,14,14,14,14,12,12,11,14,14,13,12,13
        .byte 13,14,13,13,14,14,14,14,11,12,14,12,13,13,13,13
        .byte 12,13,14,14,14,13,12,14,13,13,13,14,10,12,13,12
        .byte 12,14,13,12,12,14,15,14,13,14,11,12,14,13,13,12
        .byte 14,14,14,14,13,14,14,14,14,13,13,13,14,12,13,14
        .byte 12,14,14,14,12,12,14,12,14,14,13,14,14,13,14,13
        .byte 13,11,14,14,12,14,12,14,14,13,13,13,13,13,13,12
        .byte 14,14,13,15,14,14,13,14,12,13,13,13,14,13,14,13
        .byte 14,14,14,14,14,13,14,14,13,14,13,14,14,13,14,13
        .byte 12,14,12,11,14,14,14,14,12,11,13,14,11,12,12,13
        .byte 12,13,13,13,14,12,14,14,14,14,13,11,11,13,13,11
        .byte 13,15,12,13,12,14,13,14,11,12,13,12,14,12,14,14
        .byte 14,14,13,14,14,13,14,13,13,14,12,13,14,12,13,12
        .byte 14,13,14,13,13,14,14,14,14,13,13,14,13,13,12,13
        .byte 13,14,14,14,14,14,14,14,14,13,13,13,12,13,13,12
        .byte 13,12,14,14,14,13,14,14,13,13,13,13,14,14,12,12
        .byte 14,14,14,13,13,12,14,14,14,12,11,14,13,12,14,14
        .byte 14,12,13,14,12,14,13,14,14,12,14,13,13,14,12,13
        .byte 14,13,14,14,14,14,12,14,12,12,13,12,14,13,12,13
wave_DH_b:
        .byte 6,7,7,6,10,7,9,8,6,8,6,3,0,3,7,7
        .byte 7,6,5,4,11,3,11,11,3,4,6,0,4,1,7,0
        .byte 6,1,2,8,10,7,8,6,0,8,3,1,0,3,8,6
        .byte 10,11,10,6,10,0,6,10,6,8,9,8,6,8,8,7
        .byte 11,6,6,11,8,0,7,6,6,10,10,7,1,0,0,6
        .byte 5,10,0,7,5,5,3,5,10,5,8,5,10,6,11,4
        .byte 10,3,7,11,11,5,10,0,10,8,5,0,6,11,7,6
        .byte 8,0,10,4,6,0,5,7,11,7,0,5,9,8,7,8
        .byte 6,6,7,9,3,9,12,4,10,4,6,6,0,6,8,6
        .byte 3,1,3,3,6,6,0,2,2,0,1,7,7,4,9,0
        .byte 7,11,2,7,5,6,10,9,9,6,7,7,2,7,11,7
        .byte 9,10,0,10,4,9,9,6,3,6,9,7,7,7,9,8
        .byte 10,4,12,7,7,2,5,7,11,6,10,7,10,4,8,1
        .byte 5,0,6,11,0,5,0,0,11,10,11,5,5,8,10,7
        .byte 8,6,8,7,0,0,6,4,11,10,1,10,7,6,6,8
        .byte 10,7,1,6,4,10,11,0,10,7,1,1,10,8,8,3
        .byte 11,10,8,12,12,0,4,5,2,4,11,9,2,7,7,11
        .byte 0,0,6,6,9,3,2,1,3,9,8,7,0,10,8,0
        .byte 10,1,5,4,10,10,3,10,0,0,7,0,0,8,0,8
        .byte 7,11,3,4,10,5,10,4,7,5,6,6,1,8,3,7
        .byte 5,7,10,0,6,4,10,6,10,8,5,6,0,9,4,7
        .byte 3,7,0,7,3,6,6,1,8,0,7,5,5,8,1,7
        .byte 10,7,10,11,1,0,5,5,10,11,8,4,11,9,10,7
        .byte 10,9,7,9,7,10,5,5,4,3,1,10,11,7,7,9
        .byte 6,0,12,10,11,0,10,8,11,9,7,10,0,10,0,3
        .byte 7,7,8,6,6,8,4,8,7,5,10,6,0,11,8,10
        .byte 3,8,7,9,5,5,2,0,7,6,6,5,7,8,10,4
        .byte 8,3,1,3,2,6,5,6,6,4,7,7,8,7,4,7
        .byte 9,12,7,7,6,9,7,7,8,7,7,8,6,3,10,10
        .byte 0,6,6,9,8,10,3,0,5,10,11,2,8,10,5,1
        .byte 2,10,8,1,11,1,6,0,1,10,7,6,4,6,9,7
        .byte 3,5,0,6,3,3,11,6,10,10,6,7,0,8,7,4
wave_S_a:
        .byte 15,11,14,14,13,14,13,13,13,10,13,10,14,12,14,12
        .byte 14,13,12,13,12,12,13,9,15,11,14,13,14,13,14,13
        .byte 12,12,15,12,15,13,12,13,14,13,14,9,15,10,13,10
        .byte 15,12,14,11,15,13,12,13,14,13,14,11,15,11,13,9
        .byte 15,11,13,11,15,11,15,10,14,12,12,14,13,15,13,13
        .byte 15,11,15,13,13,15,12,14,12,15,12,15,11,12,14,13
        .byte 13,13,12,13,13,14,12,11,12,13,13,13,14,12,14,11
        .byte 14,12,15,12,12,13,12,13,12,14,13,11,14,13,13,14
        .byte 12,11,13,12,15,12,13,12,14,14,13,14,13,14,13,13
        .byte 13,15,12,15,13,14,14,11,15,13,13,12,12,15,13,14
        .byte 14,13,14,13,13,13,15,12,15,12,12,11,13,14,14,13
        .byte 15,11,15,11,15,11,13,10,15,12,14,13,13,12,14,11
        .byte 14,13,13,15,10,13,11,15,12,13,13,14,12,12,14,11
        .byte 14,12,12,11,14,14,13,14,13,13,12,14,13,14,12,13
        .byte 14,12,14,13,13,13,14,13,14,14,13,13,12,15,11,14
        .byte 14,14,14,13,13,14,13,11,15,12,15,12,14,13,13,13
        .byte 15,10,14,12,14,12,13,14,11,14,13,14,11,14,10,14
        .byte 12,14,13,13,12,12,14,13,14,14,12,15,12,13,12,14
        .byte 14,12,14,11,13,12,13,14,13,13,15,13,14,10,13,15
        .byte 13,12,14,14,14,13,13,14,13,15,10,15,10,14,13,14
        .byte 13,14,13,14,13,12,15,11,12,14,12,12,12,13,14,13
        .byte 14,12,14,13,14,13,12,13,14,13,14,12,14,13,14,14
        .byte 14,13,11,14,14,14,11,15,11,14,10,15,12,12,12,15
        .byte 13,12,13,14,11,14,10,15,10,15,11,14,13,14,14,12
        .byte 14,12,14,10,13,11,15,11,13,14,9,14,11,15,11,14
        .byte 13,14,11,13,13,13,13,14,13,14,14,10,15,10,14,14
        .byte 12,15,13,13,15,11,15,10,14,12,13,12,15,11,14,11
        .byte 13,12,13,15,12,14,14,12,12,12,15,13,13,14,13,12
        .byte 10,14,14,13,15,10,13,11,14,12,14,13,15,13,14,13
        .byte 13,15,11,13,12,13,15,10,12,13,13,14,12,13,14,14
        .byte 14,12,12,14,14,13,13,13,11,14,13,15,10,15,13,12
        .byte 11,14,13,14,11,13,12,12,14,12,12,14,11,13,14,11
wave_S_b:
        .byte 6,9,5,7,6,7,6,6,12,6,13,4,11,8,5,10
        .byte 4,7,11,7,12,2,12,9,9,6,9,7,0,8,5,7
        .byte 12,4,7,2,5,6,10,8,7,0,11,1,11,6,13,5
        .byte 8,6,10,8,0,6,11,8,1,7,9,6,9,1,13,8
        .byte 9,3,13,1,8,7,9,7,11,2,12,0,0,5,3,7
        .byte 0,9,4,2,7,5,6,9,5,7,5,3,9,12,0,6
        .byte 8,11,5,11,3,3,12,7,12,8,9,7,6,7,11,3
        .byte 10,5,8,0,12,4,12,5,10,0,10,10,4,9,7,6
        .byte 10,11,10,5,8,7,9,10,0,6,6,0,9,0,6,10
        .byte 1,4,2,6,3,3,7,9,3,6,7,12,5,6,2,1
        .byte 5,7,7,1,10,4,3,5,0,8,12,11,7,4,6,2
        .byte 5,6,9,3,9,2,13,0,9,7,4,9,6,11,8,7
        .byte 10,5,8,5,6,13,7,7,5,10,7,6,11,6,10,8
        .byte 10,8,11,11,0,6,7,0,9,8,10,6,6,7,7,10
        .byte 7,7,8,2,11,0,7,6,6,1,6,10,7,6,9,6
        .byte 0,1,0,8,8,8,5,11,5,0,4,6,10,4,7,7
        .byte 6,10,8,2,10,10,1,6,11,7,5,7,9,11,6,11
        .byte 8,1,9,5,12,9,1,8,6,5,8,0,5,12,5,6
        .byte 2,8,11,3,12,0,11,3,7,1,6,3,8,10,9,3
        .byte 0,10,0,6,1,6,8,8,1,0,9,8,10,6,8,6
        .byte 6,6,0,7,10,5,0,10,11,7,6,12,10,7,7,0
        .byte 7,10,1,6,7,4,12,4,1,9,0,10,3,8,0,4
        .byte 1,8,11,4,5,6,7,9,7,11,4,9,2,12,8,0
        .byte 6,10,5,11,1,11,5,11,3,9,6,10,2,3,4,10
        .byte 0,10,7,10,12,7,0,11,4,11,5,12,1,9,7,8
        .byte 7,7,11,6,10,7,9,0,7,4,6,10,5,10,6,7
        .byte 6,5,5,6,6,2,10,5,11,5,11,6,8,6,11,6
        .byte 11,10,6,0,6,8,2,9,12,4,5,7,7,7,4,12
        .byte 10,6,6,4,5,6,13,3,11,4,7,1,5,3,6,7
        .byte 6,6,9,10,10,0,6,10,12,3,8,8,10,6,1,0
        .byte 4,10,10,3,3,1,11,7,11,0,8,6,8,2,6,12
        .byte 9,8,5,10,6,10,12,6,9,6,12,0,11,6,9,9
wave_Z_a:
        .byte 12,15,14,13,14,12,15,14,13,13,13,14,15,13,14,13
        .byte 13,15,14,13,13,12,11,14,13,13,14,11,12,13,13,14
        .byte 13,14,12,14,13,14,14,13,14,13,13,14,13,14,13,14
        .byte 13,14,11,13,13,13,14,13,14,12,13,13,14,14,12,12
        .byte 13,15,14,14,10,12,14,15,10,14,13,14,15,13,14,11
        .byte 14,14,14,10,14,12,13,14,13,13,14,14,12,14,14,13
        .byte 14,13,12,13,12,13,14,12,13,14,12,13,14,13,13,14
        .byte 12,13,13,14,10,14,14,12,14,12,13,12,14,14,13,11
        .byte 14,15,13,14,11,12,15,14,14,13,12,13,12,14,12,14
        .byte 13,14,12,13,14,12,14,14,14,13,13,14,13,14,13,14
        .byte 13,14,14,13,14,11,12,14,12,13,13,13,14,15,12,14
        .byte 13,13,12,13,12,13,14,14,13,14,12,12,14,14,14,12
        .byte 14,12,14,12,13,12,14,14,13,14,13,12,14,11,14,13
        .byte 14,12,14,11,13,12,14,14,11,12,14,14,11,14,14,13
        .byte 14,13,13,14,12,13,13,12,11,13,14,13,14,13,13,13
        .byte 14,12,13,14,12,14,14,13,12,12,13,14,14,13,14,11
        .byte 14,13,13,14,13,13,12,13,13,12,13,14,14,13,14,11
        .byte 14,13,14,13,14,13,14,14,14,12,14,14,13,15,11,14
        .byte 13,14,13,14,12,13,14,14,12,13,13,12,15,13,14,14
        .byte 13,14,12,15,13,13,14,11,14,11,13,13,14,13,13,13
        .byte 14,12,14,13,11,14,14,14,14,13,13,14,12,13,14,12
        .byte 11,14,14,13,12,13,12,14,14,13,14,14,14,12,14,12
        .byte 13,13,13,13,13,13,14,14,12,13,14,13,12,14,13,13
        .byte 14,13,14,14,13,13,14,14,14,13,12,12,14,14,14,10
        .byte 14,14,13,13,12,13,14,15,13,14,11,12,13,14,14,12
        .byte 13,14,13,13,13,13,14,14,12,13,14,13,14,14,12,14
        .byte 13,14,13,14,12,13,14,13,12,13,13,13,14,13,11,15
        .byte 12,14,13,14,13,14,14,11,14,13,13,14,13,14,11,13
        .byte 14,15,12,14,13,14,12,12,12,14,13,14,14,13,12,12
        .byte 14,14,14,13,14,11,14,11,14,13,14,14,14,12,14,11
        .byte 14,14,13,14,13,13,14,14,13,12,13,13,14,14,12,14
        .byte 12,13,14,12,14,13,14,14,13,13,12,14,14,12,12,13
wave_Z_b:
        .byte 7,7,8,4,0,8,5,0,10,0,7,6,3,6,0,7
        .byte 8,0,3,7,4,12,11,8,8,3,7,11,12,7,6,6
        .byte 6,7,10,4,0,5,5,7,7,5,7,3,9,2,5,5
        .byte 3,7,11,9,7,2,8,6,8,7,8,7,8,7,8,9
        .byte 6,6,0,6,10,11,1,6,10,7,5,2,6,3,6,10
        .byte 8,0,8,10,7,10,9,7,6,7,5,5,10,4,2,5
        .byte 7,8,10,9,10,7,2,11,4,3,11,3,8,6,8,0
        .byte 10,9,4,8,10,4,4,10,2,9,0,12,5,0,8,7
        .byte 1,9,6,0,11,6,6,7,0,7,10,6,12,7,9,7
        .byte 1,5,12,5,5,10,2,4,5,7,7,8,6,7,1,7
        .byte 6,6,6,5,2,11,10,7,10,7,8,7,3,0,6,6
        .byte 5,8,12,5,10,2,6,5,7,5,4,12,0,0,4,5
        .byte 0,12,7,9,9,9,6,9,3,4,7,11,8,11,0,6
        .byte 7,11,3,11,9,10,0,8,10,11,0,3,11,5,5,3
        .byte 6,9,8,0,10,7,9,11,11,7,0,8,6,7,9,3
        .byte 6,10,7,8,6,3,6,5,12,7,4,6,7,8,1,7
        .byte 1,12,7,3,4,8,12,10,2,11,6,7,7,6,4,11
        .byte 6,8,8,5,6,7,4,5,4,9,6,1,4,6,9,7
        .byte 8,5,7,6,10,4,5,0,11,5,10,4,0,7,1,0
        .byte 0,8,7,2,0,7,6,11,3,11,5,8,9,7,7,0
        .byte 0,12,8,8,9,7,5,5,7,6,8,1,12,4,7,10
        .byte 11,7,6,7,10,9,10,5,6,5,0,6,1,10,5,9
        .byte 8,11,1,9,9,0,6,4,10,5,7,5,10,8,6,6
        .byte 4,8,3,5,4,5,7,2,4,6,5,12,6,3,2,7
        .byte 7,8,11,4,10,6,2,5,6,7,9,12,8,7,2,10
        .byte 6,7,9,9,8,8,2,0,12,0,5,7,6,6,9,6
        .byte 3,8,7,6,9,7,8,6,11,8,7,8,6,9,9,3
        .byte 6,8,7,3,1,5,3,11,5,5,5,8,7,5,11,0
        .byte 1,4,9,6,6,0,12,10,10,0,8,4,8,8,10,10
        .byte 2,3,8,6,2,11,8,11,6,7,1,0,6,10,2,11
        .byte 0,0,9,5,6,7,1,6,8,10,7,8,1,8,6,2
        .byte 11,4,9,7,1,2,8,0,8,8,7,6,7,11,8,8
wave_SH_a:
        .byte 13,12,13,12,14,15,13,12,12,13,12,14,14,13,14,12
        .byte 13,13,12,15,14,11,14,14,11,14,12,11,14,12,14,13
        .byte 13,14,12,13,15,9,15,15,9,15,13,12,15,12,14,12
        .byte 13,15,11,14,15,10,13,12,10,13,12,12,15,10,13,12
        .byte 10,13,12,14,15,10,15,13,10,14,13,12,13,13,13,13
        .byte 13,12,12,14,13,11,14,12,12,13,13,13,13,12,13,14
        .byte 13,13,12,15,11,12,15,11,14,14,12,14,11,13,13,14
        .byte 15,11,14,13,9,14,14,11,14,10,14,15,10,14,15,12
        .byte 13,12,14,14,12,12,14,12,14,12,15,12,12,14,13,11
        .byte 12,13,14,14,14,13,13,14,14,12,13,14,13,14,14,10
        .byte 15,14,12,15,10,13,15,11,14,14,13,13,14,12,13,15
        .byte 13,13,14,14,12,13,13,12,14,14,14,13,14,12,12,13
        .byte 13,14,15,11,14,14,11,14,14,12,14,12,15,12,13,13
        .byte 12,12,14,13,14,11,14,15,12,12,12,14,12,11,12,14
        .byte 11,13,15,11,12,13,13,13,13,14,13,15,14,12,15,13
        .byte 12,14,13,12,14,13,13,15,12,10,14,12,13,14,14,14
        .byte 12,13,13,13,10,13,13,12,14,12,14,15,12,14,12,10
        .byte 15,12,12,15,12,14,15,12,12,12,13,11,13,13,13,13
        .byte 9,14,15,10,14,14,12,12,11,12,13,12,14,13,14,13
        .byte 13,14,14,14,14,15,13,11,15,11,12,15,13,14,14,11
        .byte 14,14,12,15,12,14,14,11,13,12,14,12,15,14,12,15
        .byte 12,13,14,11,15,14,11,15,13,13,14,11,15,13,13,15
        .byte 14,12,12,10,14,11,12,13,12,13,14,14,14,13,13,12
        .byte 13,13,14,13,14,14,12,14,13,12,14,12,15,15,10,13
        .byte 14,12,15,12,14,15,11,14,14,10,15,13,11,13,12,9
        .byte 13,14,9,14,12,14,12,13,15,12,11,14,14,13,12,14
        .byte 14,14,10,13,13,11,15,14,12,15,14,12,11,14,14,10
        .byte 13,15,14,14,11,11,14,11,12,12,13,15,13,14,14,13
        .byte 12,9,13,15,10,14,15,13,15,12,13,15,12,13,14,15
        .byte 11,12,14,14,12,12,13,14,12,13,13,15,12,14,15,12
        .byte 12,12,12,12,12,14,14,11,15,13,13,14,13,15,13,11
        .byte 15,13,11,14,13,13,12,13,14,15,12,12,15,13,13,15
wave_SH_b:
        .byte 5,10,10,6,7,2,0,11,12,0,7,7,6,1,1,12
        .byte 9,7,8,4,5,6,11,5,6,10,10,9,7,10,4,8
        .byte 6,11,7,6,6,8,6,0,9,9,3,7,3,2,8,12
        .byte 0,0,9,0,6,5,12,12,5,12,0,10,9,2,13,11
        .byte 4,12,3,1,7,10,2,6,10,8,1,11,11,9,6,5
        .byte 11,7,2,12,6,7,11,9,10,8,2,12,0,8,11,1
        .byte 7,3,12,4,7,9,4,11,6,3,10,8,6,6,9,5
        .byte 6,6,10,12,5,7,2,11,6,9,10,6,4,7,6,8
        .byte 9,9,4,8,6,12,3,9,5,6,2,12,9,7,4,11
        .byte 10,5,7,8,1,7,7,5,5,10,8,4,4,1,6,10
        .byte 6,6,6,6,10,0,5,10,1,8,7,9,6,5,7,6
        .byte 8,7,7,1,10,0,5,12,3,6,5,0,8,7,8,12
        .byte 0,7,6,7,6,7,9,1,1,10,1,10,2,10,5,10
        .byte 7,9,7,8,7,11,3,6,8,7,11,7,10,8,12,11
        .byte 8,7,6,11,7,7,10,7,8,6,6,4,4,7,2,8
        .byte 7,0,6,10,10,6,4,9,5,8,11,10,2,3,6,8
        .byte 3,7,12,3,10,12,3,5,11,7,1,2,1,11,9,8
        .byte 9,6,7,9,9,0,2,7,8,12,7,10,12,4,4,12
        .byte 9,6,9,0,7,7,8,12,11,12,8,9,6,3,6,6
        .byte 6,8,0,2,0,0,6,6,5,11,8,7,7,7,0,4
        .byte 11,4,4,0,10,0,0,11,7,11,6,4,6,8,4,5
        .byte 5,8,10,5,0,8,7,6,9,9,3,4,4,6,0,8
        .byte 1,12,5,10,11,7,9,13,8,3,8,0,5,8,6,11
        .byte 4,8,7,8,9,1,7,8,8,9,7,5,3,6,2,12
        .byte 5,1,8,4,6,6,7,8,3,8,6,10,4,13,12,5
        .byte 12,5,9,8,10,7,11,2,6,11,5,6,6,1,12,6
        .byte 0,0,10,9,9,10,5,6,0,0,10,3,9,8,6,10
        .byte 8,5,7,5,9,11,10,9,9,11,6,3,7,3,7,6
        .byte 12,9,6,9,9,7,0,5,0,5,2,4,10,5,1,5
        .byte 10,6,10,8,8,9,10,3,6,1,12,3,4,7,5,6
        .byte 7,9,12,12,3,10,8,1,3,8,5,6,0,7,7,7
        .byte 9,9,6,3,10,7,10,8,8,6,5,8,7,0,0,6
wave_ZH_a:
        .byte 13,14,14,12,12,13,14,11,12,13,14,13,15,14,13,14
        .byte 11,13,13,13,13,14,11,12,14,13,14,14,13,14,14,14
        .byte 12,13,14,13,13,14,14,13,14,14,13,14,14,14,11,11
        .byte 14,12,14,14,12,13,14,13,13,14,14,14,12,12,13,10
        .byte 14,15,13,14,14,14,12,11,11,12,14,14,13,14,14,13
        .byte 13,14,13,14,14,12,12,12,14,12,14,12,13,14,14,13
        .byte 12,13,12,14,14,11,14,13,14,14,13,14,12,11,12,13
        .byte 13,13,13,13,13,13,14,14,13,14,14,12,13,13,13,12
        .byte 14,13,14,14,14,14,11,13,12,14,12,15,14,13,14,13
        .byte 13,14,11,11,12,14,13,13,13,14,14,13,12,14,14,13
        .byte 14,14,13,14,13,13,13,14,14,14,14,11,13,14,13,13
        .byte 12,14,13,11,13,14,13,12,13,14,14,12,11,14,14,10
        .byte 14,13,13,14,13,13,12,12,11,12,13,14,14,14,14,13
        .byte 11,12,13,13,12,13,11,14,13,13,12,13,14,14,13,13
        .byte 12,13,13,12,14,12,13,13,14,14,13,12,13,13,12,13
        .byte 14,14,13,13,12,12,13,11,14,14,12,12,13,11,12,12
        .byte 13,15,14,12,14,13,14,13,13,14,14,12,14,13,13,13
        .byte 14,13,14,14,14,13,13,14,13,13,14,13,14,12,13,14
        .byte 13,13,14,13,13,14,14,14,14,13,12,13,13,12,14,13
        .byte 12,14,12,13,14,13,13,13,14,12,12,12,14,13,13,13
        .byte 13,14,14,12,12,13,13,11,13,14,14,14,12,13,14,13
        .byte 12,14,14,14,14,12,12,11,12,14,13,14,14,14,14,13
        .byte 12,13,13,14,13,14,14,13,12,14,13,13,14,13,14,14
        .byte 11,14,14,13,14,12,13,12,13,14,14,13,13,14,13,11
        .byte 14,15,14,12,14,13,14,12,13,14,14,14,14,13,13,14
        .byte 13,11,12,14,13,14,11,12,14,14,13,12,13,14,13,12
        .byte 12,13,12,14,12,13,14,13,13,14,13,13,14,11,11,13
        .byte 13,13,14,14,11,13,13,13,14,14,14,13,13,12,12,11
        .byte 13,15,14,13,14,13,14,14,12,14,12,13,14,14,13,11
        .byte 12,14,14,14,12,12,14,14,13,13,12,14,12,14,14,14
        .byte 13,14,12,11,11,12,14,12,14,13,12,14,13,13,14,14
        .byte 14,14,14,14,13,13,13,11,14,12,14,14,12,13,13,11
wave_ZH_b:
        .byte 9,8,7,12,11,5,1,11,7,10,7,7,0,5,6,8
        .byte 10,6,11,6,8,8,11,10,1,8,6,3,7,2,7,4
        .byte 9,7,6,8,6,6,0,6,6,2,7,1,3,0,11,11
        .byte 0,10,0,4,9,7,2,8,9,6,0,3,10,9,0,10
        .byte 5,1,10,7,2,4,10,10,11,10,6,7,8,7,1,4
        .byte 10,0,5,6,6,11,10,9,3,11,5,10,6,5,5,7
        .byte 10,7,10,8,0,11,5,8,3,1,0,0,10,11,12,6
        .byte 7,11,6,6,8,0,5,3,7,8,7,10,5,5,6,4
        .byte 0,12,7,4,6,1,11,2,10,3,10,0,6,6,7,7
        .byte 6,8,11,11,12,5,8,8,8,5,0,8,10,5,5,7
        .byte 2,3,7,5,9,6,8,2,4,4,1,11,8,4,2,6
        .byte 12,4,8,11,6,7,6,6,10,8,5,10,9,6,2,5
        .byte 5,12,8,8,10,7,10,8,11,12,8,2,7,0,6,6
        .byte 11,12,6,8,12,8,11,0,8,9,10,8,7,6,7,8
        .byte 11,8,6,10,6,11,7,7,0,0,9,10,7,8,10,7
        .byte 0,7,8,7,11,10,3,10,7,8,10,11,7,10,10,6
        .byte 8,4,6,12,0,5,5,6,7,7,3,11,7,8,7,9
        .byte 2,7,5,7,6,8,7,6,7,6,7,7,1,12,6,0
        .byte 9,6,5,7,7,6,0,3,0,6,11,9,4,10,1,6
        .byte 11,6,9,9,4,5,7,7,0,11,10,11,3,4,7,0
        .byte 6,10,7,9,12,10,1,10,8,6,8,0,10,10,3,4
        .byte 10,3,1,7,0,10,11,11,10,3,8,0,3,7,0,6
        .byte 11,7,6,6,8,5,7,5,10,6,6,7,1,8,3,5
        .byte 11,3,1,6,0,10,7,10,8,5,7,7,6,3,4,7
        .byte 7,6,0,12,6,7,6,8,3,7,0,7,8,8,9,0
        .byte 6,11,10,6,10,0,11,10,3,0,7,10,10,2,8,11
        .byte 10,5,10,5,10,8,7,9,6,1,8,6,3,11,11,10
        .byte 9,7,0,0,11,7,4,7,7,6,5,9,6,10,10,7
        .byte 8,6,0,10,6,1,6,6,8,0,12,9,5,3,7,11
        .byte 10,3,4,1,11,11,5,4,7,6,10,4,10,0,7,3
        .byte 7,3,10,11,11,10,6,11,0,7,10,6,3,5,5,0
        .byte 5,2,0,5,7,5,5,11,6,11,7,1,9,8,3,9
wave_HH_a:
        .byte 14,14,15,12,10,14,14,10,13,14,13,14,14,11,13,12
        .byte 14,12,13,14,14,13,14,11,13,14,14,13,13,13,15,14
        .byte 14,14,14,13,14,14,12,13,14,13,13,14,11,12,15,14
        .byte 12,14,14,11,15,14,12,12,13,11,15,14,12,15,14,12
        .byte 15,14,11,14,12,12,12,12,12,14,15,14,13,14,14,13
        .byte 12,14,13,11,11,13,12,14,14,14,12,14,15,14,11,13
        .byte 11,12,14,14,14,13,13,13,13,14,13,14,14,13,14,14
        .byte 12,12,14,14,14,13,10,13,12,14,14,12,14,14,14,14
        .byte 13,12,13,13,13,14,12,13,13,14,12,13,13,12,11,13
        .byte 13,13,13,14,13,13,14,13,14,14,12,14,14,12,14,14
        .byte 12,13,14,13,13,13,13,13,14,12,12,14,14,12,13,15
        .byte 11,14,15,12,13,15,13,13,12,14,14,11,10,14,14,12
        .byte 14,15,13,14,12,12,11,12,14,13,14,14,13,13,15,14
        .byte 12,13,12,12,13,12,13,14,12,10,12,12,12,14,13,13
        .byte 13,13,14,13,14,13,12,14,14,11,12,14,11,14,12,12
        .byte 14,15,12,13,15,12,13,15,14,12,14,13,10,13,14,13
        .byte 13,12,14,12,12,14,14,12,14,14,13,13,12,14,14,14
        .byte 13,13,14,12,13,13,13,13,14,12,11,15,14,13,14,13
        .byte 11,12,13,13,14,12,11,15,12,13,14,13,13,15,15,12
        .byte 13,14,13,12,15,12,13,15,14,11,14,14,13,14,12,13
        .byte 12,14,11,12,13,11,14,14,12,12,11,13,14,14,14,12
        .byte 14,13,12,14,13,12,13,12,14,12,11,14,14,12,14,12
        .byte 13,14,14,13,13,14,14,13,12,11,13,12,14,14,13,14
        .byte 11,11,14,15,13,13,14,13,13,15,14,13,12,14,12,14
        .byte 15,14,12,14,13,12,15,14,10,13,14,12,13,14,12,12
        .byte 14,14,14,13,12,14,13,11,12,14,10,14,14,13,13,14
        .byte 13,13,14,14,13,14,14,12,14,13,12,13,12,15,14,12
        .byte 14,14,13,13,12,13,13,12,12,13,13,14,13,14,14,13
        .byte 13,14,12,14,13,13,13,13,14,14,12,12,12,14,13,14
        .byte 11,13,13,14,14,14,13,13,12,13,13,12,11,11,12,12
        .byte 13,14,13,13,12,15,14,12,13,13,13,13,13,13,13,13
        .byte 12,14,13,14,14,13,14,14,13,13,13,13,14,12,13,13
wave_HH_b:
        .byte 0,3,3,11,10,6,8,10,5,1,8,8,8,10,5,12
        .byte 8,7,5,8,3,8,2,10,8,8,0,5,0,8,0,7
        .byte 0,6,0,8,8,6,8,6,6,2,6,10,11,5,4,0
        .byte 2,9,6,9,1,7,7,12,8,7,0,5,6,6,7,7
        .byte 3,2,7,8,12,7,10,10,8,2,2,7,7,2,4,8
        .byte 11,3,7,11,10,7,12,5,4,3,7,0,5,5,11,5
        .byte 10,11,7,6,5,7,6,6,8,0,7,1,6,8,8,8
        .byte 7,9,6,6,7,7,10,7,11,6,6,10,3,7,6,4
        .byte 7,9,8,3,7,8,11,6,5,0,12,9,7,11,11,6
        .byte 10,7,3,7,8,8,7,8,2,6,10,6,4,9,6,5
        .byte 7,7,6,8,7,8,7,6,6,12,10,5,8,7,6,0
        .byte 11,3,0,8,7,2,0,3,12,2,1,11,10,7,6,7
        .byte 6,0,6,7,12,5,9,12,5,4,3,5,7,9,5,1
        .byte 7,10,12,7,4,10,6,8,12,10,8,12,12,1,8,1
        .byte 1,10,8,8,6,8,6,6,7,10,12,8,9,7,12,4
        .byte 3,5,6,5,4,9,5,6,6,9,7,8,10,8,6,9
        .byte 7,9,3,10,10,7,0,10,7,6,7,5,10,4,5,6
        .byte 6,6,8,10,6,10,7,6,8,7,9,5,5,6,8,8
        .byte 11,12,8,6,4,7,11,3,10,8,8,6,0,4,0,7
        .byte 6,7,4,10,0,9,4,3,0,9,4,0,5,7,10,3
        .byte 12,7,11,12,5,9,8,3,10,12,10,0,6,0,4,12
        .byte 0,4,10,4,8,10,5,7,7,12,11,7,3,5,7,12
        .byte 2,1,6,0,8,8,3,9,11,11,6,10,6,6,8,2
        .byte 11,9,6,4,3,6,8,5,5,3,7,2,10,0,8,0
        .byte 6,1,9,4,6,10,6,6,10,8,0,9,9,6,9,10
        .byte 8,7,6,8,9,2,6,10,12,3,10,7,8,1,8,7
        .byte 6,8,8,0,6,2,8,12,3,5,9,3,10,3,0,6
        .byte 0,8,9,8,10,6,5,12,12,2,7,5,8,7,7,1
        .byte 0,1,12,6,0,8,9,8,8,5,8,10,11,0,10,6
        .byte 10,0,8,7,8,4,2,0,12,10,5,11,11,9,12,12
        .byte 5,1,8,1,12,5,2,9,3,7,9,8,7,8,6,8
        .byte 12,7,7,6,7,3,0,8,7,6,8,0,3,12,7,7
program_end:
