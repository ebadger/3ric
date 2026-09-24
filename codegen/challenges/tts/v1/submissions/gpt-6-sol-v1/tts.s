        .org $0800
; Copper Voice. Original orthographic rules and AY voice data.
; AY bus sequencing adapted from baseline codegen/programs/groovebox.s.
COUT    = $FDED
HOME    = $FC58
RDKEY   = $FD0C
BASCALC = $FBC1
KEY     = $C000
KCLR    = $C010
MB      = $C400
PTR     = $06

        jmp application

; Callable without running the UI. Both VIA interrupt enables are cleared;
; no IRQ vector, onboard VIA, or ROM banking is changed.
TTS_INIT:
        ldx #0
        jsr reset_ay
        ldx #$80
        jsr reset_ay
        lda #$d8
        ldy #0
        jsr ay_write
        lda #2
        iny
        jsr ay_write
        lda #$38
        ldy #7
        jsr ay_write
        jmp silence

reset_ay:
        lda #$7f
        sta MB+$0e,x
        sta MB+$0d,x
        stz MB+$0b,x
        stz MB,x
        lda #$ff
        sta MB+3,x
        lda #7
        sta MB+2,x
        stz MB,x
        lda #4
        sta MB,x
        rts

; A = value, Y = AY register. Writes the two AYs (centered stereo).
; Latches on the BDIR falling edge; preserves X and Y.
ay_write:
        sta ay_data
        phx
        ldx #0
ay_pair:
        tya
        sta MB+1,x
        lda #7
        sta MB,x
        lda #4
        sta MB,x
        lda ay_data
        sta MB+1,x
        lda #6
        sta MB,x
        lda #4
        sta MB,x
        cpx #$80
        beq ay_done
        ldx #$80
        bra ay_pair
ay_done:
        plx
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
        jmp ay_write

; A/X = pointer to zero-terminated RAM text. Status A: 0 / 1 / 2.
TTS_SPEAK:
        sta PTR
        stx PTR+1
        jsr silence
        ldy #0
validate:
        lda (PTR),y
        beq valid
        cpy #120
        bcs invalid
        jsr normalized
        cmp #'A'
        bcc validate_punct
        cmp #'Z'+1
        bcc validate_next
validate_punct:
        cmp #' '
        beq validate_next
        cmp #$27
        beq validate_next
        cmp #'-'
        beq validate_next
        cmp #'.'
        beq validate_next
        cmp #','
        beq validate_next
        cmp #'?'
        beq validate_next
        cmp #'!'
        bne invalid
validate_next:
        iny
        bra validate
invalid:
        jsr silence
        lda #2
        rts
valid:
        stz position
next_letter:
        ldy position
        jsr get_char
        beq completed
        sta letter
        iny
        jsr get_char
        sta lookahead
        lda letter
        cmp #' '
        beq gap
        cmp #'-'
        beq gap
        cmp #$27
        beq gap
        cmp #'.'
        beq long_gap
        cmp #'?'
        beq long_gap
        cmp #'!'
        beq long_gap
        cmp #','
        beq long_gap
        jsr choose_sound
        cmp #0
        beq advance
        jsr phoneme
        bcs cancelled
advance:
        inc position
        bra next_letter
gap:
        jsr silence
        lda #32
        bra say_gap
long_gap:
        jsr silence
        lda #72
say_gap:
        jsr pause_ticks
        bcs cancelled
        bra advance
completed:
        jsr silence
        lda #0
        rts
cancelled:
        bit KCLR
        jsr silence
        lda #1
        rts

; Read uppercased input at Y. Validation is performed on the original bytes.
get_char:
        lda (PTR),y
normalized:
        cmp #'a'
        bcc character_ready
        cmp #'z'+1
        bcs character_ready
        and #$df
character_ready:
        ora #0
        rts

; Ordered general grapheme rules. Additional consumed characters advance
; position here; every remaining letter is handled by the fallback map.
choose_sound:
        lda letter
        cmp #'A'
        beq vowel_jump
        cmp #'E'
        beq vowel_jump
        cmp #'I'
        beq vowel_jump
        cmp #'O'
        beq vowel_jump
        cmp #'U'
        beq vowel_jump
        cmp #'Y'
        beq vowel_y
        cmp #'T'
        beq rule_t
        cmp #'S'
        bne check_c
        jmp rule_s
check_c:
        cmp #'C'
        bne check_p
        jmp rule_c
check_p:
        cmp #'P'
        bne check_n
        jmp rule_p
check_n:
        cmp #'N'
        bne check_q
        jmp rule_n
check_q:
        cmp #'Q'
        bne check_g
        jmp rule_q
check_g:
        cmp #'G'
        bne check_w
        jmp rule_g
check_w:
        cmp #'W'
        bne check_d
        jmp rule_w
check_d:
        cmp #'D'
        bne no_rule
        jmp rule_d
no_rule:
        jmp simple_letter
vowel_jump:
        jmp vowel
vowel_y:
        lda #3
        rts
simple_letter:
        lda letter
        sec
        sbc #'A'
        tax
        lda letter_map,x
        rts
rule_w:
        lda lookahead
        cmp #'H'
        bne simple_letter
        inc position
        lda #39
        rts
rule_g:
        lda lookahead
        cmp #'E'
        beq g_soft
        cmp #'I'
        beq g_soft
        cmp #'Y'
        bne simple_letter
g_soft:
        lda #33
        rts
rule_d:
        lda lookahead
        cmp #'G'
        bne simple_letter
        inc position
        lda #33
        rts
rule_t:
        lda lookahead
        cmp #'H'
        bne simple_letter
        inc position
        lda #31
        rts
rule_s:
        lda lookahead
        cmp #'H'
        bne simple_letter
        inc position
        lda #29
        rts
rule_c:
        lda lookahead
        cmp #'H'
        bne c_soft
        inc position
        lda #30
        rts
c_soft:
        cmp #'E'
        beq c_s
        cmp #'I'
        beq c_s
        cmp #'Y'
        bne simple_letter
c_s:
        lda #27
        rts
rule_p:
        lda lookahead
        cmp #'H'
        bne simple_letter
        inc position
        lda #25
        rts
rule_n:
        lda lookahead
        cmp #'G'
        beq n_ng
        jmp simple_letter
n_ng:
        inc position
        lda #35
        rts
rule_q:
        lda lookahead
        cmp #'U'
        beq q_u
        jmp simple_letter
q_u:
        inc position
        lda #21
        rts
; IDs 1-12 are vowels. 13+ consonants. A final e after a consonant
; is normally silent, except the vowel in THE (and other final -he).
vowel:
        lda letter
        cmp #'E'
        bne vowel_pair
        lda lookahead
        bne vowel_pair
        lda position
        beq vowel_pair
        tay
        dey
        jsr get_char
        cmp #'H'
        beq vowel_pair
        cmp #' '
        beq vowel_pair
        lda #0
        rts
vowel_pair:
        lda letter
        cmp #'E'
        bne pair_a
        lda lookahead
        cmp #'E'
        beq pair_long_e
        cmp #'A'
        beq pair_long_e
        cmp #'R'
        beq pair_er
        bra inspect_long
pair_a:
        cmp #'A'
        bne pair_o
        lda lookahead
        cmp #'I'
        beq pair_long_a
        cmp #'Y'
        beq pair_long_a
        cmp #'R'
        beq pair_ar
        bra inspect_long
pair_o:
        cmp #'O'
        bne pair_i
        lda lookahead
        cmp #'O'
        beq pair_oo
        cmp #'W'
        beq pair_ow
        cmp #'U'
        beq pair_ow
        cmp #'I'
        beq pair_oi
        cmp #'R'
        beq pair_or
        bra inspect_long
pair_i:
        cmp #'I'
        bne inspect_long
        lda lookahead
        cmp #'E'
        beq pair_long_i
        bra inspect_long
pair_long_e:
        inc position
        lda #7
        rts
pair_long_a:
        inc position
        lda #6
        rts
pair_er:
        inc position
        lda #11
        rts
pair_ar:
        inc position
        lda #1
        rts
pair_oo:
        inc position
        lda #10
        rts
pair_ow:
        inc position
        lda #9
        rts
pair_oi:
        inc position
        lda #12
        rts
pair_or:
        inc position
        lda #4
        rts
pair_long_i:
        inc position
        lda #8
        rts
inspect_long:
        ; vowel + single consonant + terminal e: MAKE, TYPE, VOICE
        lda lookahead
        cmp #'A'
        bcc vowel_short
        cmp #'Z'+1
        bcs vowel_short
        ldy position
        iny
        iny
        jsr get_char
        cmp #'E'
        bne vowel_short
        iny
        jsr get_char
        bne vowel_short
        lda letter
        cmp #'A'
        beq long_a
        cmp #'I'
        beq long_i
        cmp #'O'
        beq long_o
        cmp #'U'
        beq long_u
        bra vowel_short
long_a:
        lda #6
        rts
long_i:
        lda #8
        rts
long_o:
        lda #9
        rts
long_u:
        lda #10
        rts
vowel_short:
        lda letter
        sec
        sbc #'A'
        tax
        lda vowel_map,x
        rts

; Each preset has: 2.5ms ticks, mixer, two resonator periods,
; voiced level, first-resonance level, second-resonance/noise level, pad.
; Tone A period $02d8 ~= 135 Hz. B/C are independently retuned.
phoneme:
        phy
        asl a
        asl a
        asl a
        tax
        lda presets,x
        sta ticks_left
        lda presets+1,x
        sta mode_byte
        lda presets+2,x
        ldy #2
        jsr ay_write
        lda #0
        iny
        jsr ay_write
        lda presets+3,x
        iny
        jsr ay_write
        lda #0
        iny
        jsr ay_write
        lda #8
        iny
        jsr ay_write
        lda mode_byte
        iny
        jsr ay_write
        lda presets+4,x
        iny
        jsr ay_write
        lda presets+5,x
        iny
        jsr ay_write
        lda presets+6,x
        iny
        jsr ay_write
        lda ticks_left
        jsr pause_ticks
        ply
        rts

; A ticks; ~3,900 CPU cycles each at native 1x (~400 ticks/second).
; Check Escape every tick, including silent punctuation gaps.
pause_ticks:
        sta ticks_left
        beq pause_done
tick:
        phx
        phy
        ldx #3
tick_outer:
        ldy #0
tick_inner:
        dey
        bne tick_inner
        dex
        bne tick_outer
        ply
        plx
        lda KEY
        bpl no_key
        cmp #$9b
        beq escape_tick
        bit KCLR
no_key:
        dec ticks_left
        bne tick
pause_done:
        clc
        rts
escape_tick:
        sec
        rts

application:
        jsr TTS_INIT
        bit $c051
        bit $c054
        jsr HOME
        ldx #<banner
        ldy #>banner
        jsr print
again:
        stz length
        stz TTS_INPUT
        ldx #<prompt
        ldy #>prompt
        jsr print
editing:
        jsr RDKEY
        cmp #$9b
        bne edit_return
        jmp leave
edit_return:
        cmp #$8d
        bne edit_delete
        jmp speak_line
edit_delete:
        cmp #$88
        beq erase
        cmp #$ff
        beq erase
        and #$7f
        cmp #'a'
        bcc edit_upper
        cmp #'z'+1
        bcs edit_upper
        and #$df
edit_upper:
        cmp #'A'
        bcc edit_punct
        cmp #'Z'+1
        bcc append
edit_punct:
        cmp #' '
        beq append
        cmp #$27
        beq append
        cmp #'-'
        beq append
        cmp #'.'
        beq append
        cmp #','
        beq append
        cmp #'!'
        beq append
        cmp #'?'
        bne edit_error
append:
        sta new_key
        ldx length
        cpx #120
        bcs full_line
        sta TTS_INPUT,x
        inx
        stx length
        stz TTS_INPUT,x
        lda new_key
        ora #$80
        jsr COUT
        bra editing
erase:
        lda length
        beq editing
        dec length
        tax
        stz TTS_INPUT,x
        lda $24
        bne erase_same_row
        dec $25
        lda #39
        sta $24
        lda $25
        jsr BASCALC
        bra erase_cell
erase_same_row:
        dec $24
erase_cell:
        ldy $24
        lda #$a0
        sta ($28),y
        jmp editing
edit_error:
        ldx #<unsupported
        ldy #>unsupported
        bra message
full_line:
        ldx #<limit_msg
        ldy #>limit_msg
message:
        jsr print
        jsr redraw_line
        jmp editing
redraw_line:
        ldx #<prompt
        ldy #>prompt
        jsr print
        ldy #0
redraw_next:
        cpy length
        beq redraw_done
        lda TTS_INPUT,y
        ora #$80
        phy
        jsr COUT
        ply
        iny
        bra redraw_next
redraw_done:
        rts
speak_line:
        lda #$8d
        jsr COUT
        lda #<TTS_INPUT
        ldx #>TTS_INPUT
        jsr TTS_SPEAK
        cmp #2
        beq speak_error
        jmp again
speak_error:
        ldx #<unsupported
        ldy #>unsupported
        jsr print
        jmp again
leave:
        jsr silence
        bit KCLR
        lda #$8d
        jsr COUT
        brk

; X/Y = NUL-terminated string pointer. ROM COUT owns the screen/serial.
print:
        stx PTR
        sty PTR+1
        ldy #0
print_char:
        lda (PTR),y
        beq print_done
        ora #$80
        phy
        jsr COUT
        ply
        iny
        bra print_char
print_done:
        rts

vowel_map:
        .byte 1,0,0,0,2,0,0,0,3,0,0,0,0,0,4,0,0,0,0,0,5
letter_map:
        .byte 1,13,18,14,2,25,15,20,3,33,18,36,34
        .byte 34,4,16,21,37,27,17,5,23,38,27,3,28

; id 0 is silent, 1-12 vowel colors, 13-39 consonants. Periods
; correspond to approximate resonances, not prerecorded waveforms.
presets:
        .byte 0,$3f,0,0,0,0,0,0
        .byte 39,$38,122,49,11,9,6,0     ; a: CAT
        .byte 34,$38,175,44,10,8,6,0     ; e: BED
        .byte 31,$38,217,39,9,7,5,0      ; i: SIT
        .byte 40,$38,113,82,12,9,6,0     ; o: DOG
        .byte 34,$38,147,75,11,8,5,0     ; u: CUT
        .byte 48,$38,145,62,11,9,6,0     ; a: DAY
        .byte 48,$38,202,42,10,8,6,0     ; e: SEE
        .byte 52,$38,194,43,11,8,5,0     ; i: TIME
        .byte 50,$38,170,88,11,9,6,0     ; o: GO
        .byte 48,$38,213,96,11,8,6,0     ; oo: MOON
        .byte 34,$38,190,70,10,7,5,0     ; er
        .byte 50,$38,113,51,11,9,6,0     ; oi
        .byte 19,$38,158,64,10,7,4,0     ; b
        .byte 19,$38,148,57,10,7,4,0     ; d
        .byte 20,$38,132,63,10,7,4,0     ; g
        .byte 16,$1f,90,30,0,0,10,0      ; p burst
        .byte 16,$1f,110,27,0,0,10,0     ; t burst
        .byte 18,$1f,100,31,0,0,10,0     ; k burst
        .byte 32,$1f,80,28,0,0,10,0      ; p/f region
        .byte 28,$1f,90,28,0,0,9,0       ; h/air
        .byte 18,$1f,110,32,0,0,11,0     ; k/qu
        .byte 25,$38,118,50,10,7,4,0     ; v-like voiced
        .byte 25,$38,143,57,10,7,4,0     ; v
        .byte 26,$38,130,49,11,7,4,0     ; z
        .byte 29,$1f,100,25,0,0,9,0      ; f
        .byte 25,$38,152,51,10,6,3,0     ; v variant
        .byte 32,$1f,92,22,0,0,11,0      ; s
        .byte 29,$38,119,39,10,7,5,0     ; z
        .byte 34,$1f,100,43,0,0,10,0     ; sh
        .byte 28,$1f,95,39,0,0,11,0      ; ch
        .byte 29,$1f,101,35,0,0,9,0      ; th
        .byte 31,$38,127,54,10,8,4,0     ; dh / voiced th
        .byte 25,$38,141,47,10,8,5,0     ; j
        .byte 35,$38,186,76,11,6,3,0     ; m/n nasal
        .byte 34,$38,175,78,10,6,3,0     ; ng
        .byte 31,$38,155,57,10,7,4,0     ; l
        .byte 30,$38,162,58,10,7,4,0     ; r
        .byte 30,$38,184,83,11,7,4,0     ; w
        .byte 28,$38,194,48,10,7,4,0     ; h/y

banner:     .byte "COPPER VOICE - ESC EXITS",$0d,0
prompt:     .byte $0d,"SAY> ",0
unsupported:.byte $0d,"USE LETTERS, SPACE, ' - . , ? !",$0d,0
limit_msg:  .byte $0d,"120 CHARACTER LIMIT",$0d,0
ay_data:    .byte 0
ticks_left: .byte 0
mode_byte:  .byte 0
position:   .byte 0
letter:     .byte 0
lookahead:  .byte 0
length:     .byte 0
new_key:    .byte 0
TTS_INPUT:  .res 122
