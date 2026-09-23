; ==========================================================================
; 3RIC TALKS V1 - ORIGINAL ENGLISH TEXT-TO-SPEECH ENGINE
; Submission ID: gemini-38flash-v1
; Author: Gemini 3.8 Flash (via GitHub Copilot)
; Target: 3RIC 65C02 Computer with Slot-4 Dual-AY-3-8910 Mockingboard
; ==========================================================================

        .org $0800

; Entry point for BRUN / web runner
START:
        jmp UI

; --------------------------------------------------------------------------
; HARDWARE & ROM EQUATES
; --------------------------------------------------------------------------
KBD             = $C000     ; Keyboard data (bit 7 = key pressed strobe)
KBD_STROBE      = $C010     ; Clear keyboard strobe
TEXT_SW         = $C051     ; Select text mode
FULL_SW         = $C052     ; Select full screen (clear mixed)
PAGE1_SW        = $C054     ; Select display page 1

MB_LEFT         = $C400     ; Slot 4 Left VIA / AY-3-8910 base
MB_RIGHT        = $C480     ; Slot 4 Right VIA / AY-3-8910 base
VIA_ORB         = 0         ; VIA Port B (control lines: BC1, BDIR, /RESET)
VIA_ORA         = 1         ; VIA Port A (AY data bus)
VIA_DDRB        = 2         ; VIA Port B Data Direction
VIA_DDRA        = 3         ; VIA Port A Data Direction

ROM_HOME        = $FC58     ; Clear text screen and home cursor
ROM_COUT        = $FDED     ; Print character in A (high bit set) to screen & serial
ROM_CROUT       = $FD8E     ; Print carriage return
ROM_RDKEY       = $FD0C     ; Read key from keyboard (returns with high bit set)
ROM_BELL        = $FF3A     ; Emit alert bell

; --------------------------------------------------------------------------
; ZERO-PAGE APPLICATION VARIABLES ($E0..$EF)
; --------------------------------------------------------------------------
ZP_PTR_IN_L     = $E0
ZP_PTR_IN_H     = $E1
ZP_PTR_DICT_L   = $E2
ZP_PTR_DICT_H   = $E3
ZP_WORD_LEN     = $E4
ZP_WORD_IDX     = $E5
ZP_PHON_COUNT   = $E6
ZP_CUR_PHON     = $E7
ZP_FRAME_CNT    = $E8
ZP_AY_VAL       = $E9
ZP_AY_BASE      = $EA
ZP_F1_L         = $EB
ZP_F1_H         = $EC
ZP_F2_L         = $ED
ZP_F2_H         = $EE
ZP_ESCAPE_HIT   = $EF

; --------------------------------------------------------------------------
; PHONEME ID CONSTANTS
; --------------------------------------------------------------------------
P_PAUSE_WORD     = 0
P_PAUSE_CLAUSE   = 1
P_PAUSE_SENTENCE = 2
P_IY             = 3
P_IH             = 4
P_EY             = 5
P_EH             = 6
P_AE             = 7
P_AA             = 8
P_AO             = 9
P_OW             = 10
P_UH             = 11
P_UW             = 12
P_AH             = 13
P_ER             = 14
P_AY             = 15
P_AW             = 16
P_OY             = 17
P_L              = 18
P_R              = 19
P_W              = 20
P_Y              = 21
P_M              = 22
P_N              = 23
P_NG             = 24
P_S              = 25
P_SH             = 26
P_F              = 27
P_TH             = 28
P_HH             = 29
P_Z              = 30
P_ZH             = 31
P_V              = 32
P_DH             = 33
P_P              = 34
P_T              = 35
P_K              = 36
P_B              = 37
P_D              = 38
P_G              = 39
P_CH             = 40
P_JH             = 41

; ==========================================================================
; CALLABLE INTERFACE: TTS_INIT
; Initializes the Mockingboard dual-AY sound hardware and mutes all channels.
; Safe to call immediately after PRG load.
; ==========================================================================
TTS_INIT:
        php
        sei
        cld
        ldx #0
        jsr AY_INIT_CHIP
        ldx #$80
        jsr AY_INIT_CHIP
        jsr AY_MUTE_ALL
        plp
        rts

; ==========================================================================
; CALLABLE INTERFACE: TTS_SPEAK
; Speaks NUL-terminated ASCII text in RAM.
; Entry: A = low pointer, X = high pointer
; Exit:  A = 0 (complete/empty), 1 (cancelled), 2 (invalid/overlength)
; Input string is completely preserved.
; Upper ROM and caller state preserved.
; ==========================================================================
TTS_SPEAK:
        sta ZP_PTR_IN_L
        stx ZP_PTR_IN_H
        stz ZP_ESCAPE_HIT

        ; Scan up to 121 characters (offsets 0..120) for NUL terminator.
        ; If NUL found within 0..120, string length <= 120 (valid).
        ; If offset 120 is checked and still non-NUL (Y reaches 121), return 2 (overlength).
        ldy #0
SCAN_LEN_LOOP:
        lda (ZP_PTR_IN_L),y
        beq SPEAK_LEN_OK
        iny
        cpy #121
        bcc SCAN_LEN_LOOP
        lda #2              ; Return code 2: invalid overlength
        rts

SPEAK_LEN_OK:
        ; Check if string is empty or contains only whitespace
        ldy #0
CHECK_EMPTY_LOOP:
        lda (ZP_PTR_IN_L),y
        beq INPUT_IS_EMPTY   ; Reached NUL without any non-space -> empty
        cmp #32
        bne INPUT_NOT_EMPTY  ; Found non-space character -> proceed to speak
        iny
        bra CHECK_EMPTY_LOOP
INPUT_IS_EMPTY:
        lda #0              ; Return code 0: completed cleanly without speech
        rts

INPUT_NOT_EMPTY:
        ; Convert text to phonemes in PHONEME_BUF
        jsr PARSE_TEXT_TO_PHONEMES
        lda ZP_PHON_COUNT
        bne DO_SYNTHESIS
        lda #0
        rts

DO_SYNTHESIS:
        ; Initialize sound chips
        jsr TTS_INIT

        ; Play phoneme stream
        jsr PLAY_PHONEME_STREAM

        ; Silence all channels
        jsr AY_MUTE_ALL

        ; Check cancellation return code
        lda ZP_ESCAPE_HIT
        beq SPEAK_SUCCESS
        lda #1              ; Return code 1: cancelled by Escape
        rts
SPEAK_SUCCESS:
        lda #0              ; Return code 0: completed successfully
        rts

; ==========================================================================
; TEXT TO PHONEME PARSER
; Scans input string, tokenizes words, applies dictionary & rules.
; Produces sequence of phoneme byte IDs in PHONEME_BUF.
; ==========================================================================
PARSE_TEXT_TO_PHONEMES:
        stz ZP_PHON_COUNT
        ldy #0              ; Index into input string

PARSE_MAIN_LOOP:
        lda (ZP_PTR_IN_L),y
        bne NOT_END_OF_STRING
        jmp PARSE_FINISH

NOT_END_OF_STRING:
        ; Check if letter (A-Z or a-z)
        jsr IS_ALPHA
        bcc NOT_ALPHA_CHAR

        ; Accumulate word into WORD_BUF
        ldx #0
COLLECT_WORD_LOOP:
        jsr TO_UPPER
        sta WORD_BUF,x
        inx
        cpx #30             ; Limit word length to 30 chars
        bcs WORD_COLLECTED
        iny
        lda (ZP_PTR_IN_L),y
        beq WORD_COLLECTED
        jsr IS_ALPHA
        bcs COLLECT_WORD_LOOP

WORD_COLLECTED:
        stx ZP_WORD_LEN
        phy                 ; Save input string index
        jsr CONVERT_WORD
        ply                 ; Restore input string index

        ; Emit word pause
        lda #P_PAUSE_WORD
        jsr EMIT_PHONEME

        ; Continue parsing
        jmp PARSE_MAIN_LOOP

NOT_ALPHA_CHAR:
        ; Check punctuation
        cmp #'.'
        beq IS_SENTENCE_PUNCT
        cmp #'?'
        beq IS_SENTENCE_PUNCT
        cmp #'!'
        beq IS_SENTENCE_PUNCT
        cmp #','
        beq IS_CLAUSE_PUNCT
        cmp #';'
        beq IS_CLAUSE_PUNCT
        cmp #':'
        beq IS_CLAUSE_PUNCT
        jmp NEXT_INPUT_CHAR

IS_SENTENCE_PUNCT:
        lda #P_PAUSE_SENTENCE
        jsr EMIT_PHONEME
        jmp NEXT_INPUT_CHAR

IS_CLAUSE_PUNCT:
        lda #P_PAUSE_CLAUSE
        jsr EMIT_PHONEME

NEXT_INPUT_CHAR:
        iny
        jmp PARSE_MAIN_LOOP

PARSE_FINISH:
        ; Add final sentence pause
        lda #P_PAUSE_SENTENCE
        jsr EMIT_PHONEME
        rts

; Helper: Is char in A alphabetic? Sets C=1 if yes, C=0 if no.
IS_ALPHA:
        cmp #'A'
        bcc IS_ALPHA_LOWER
        cmp #'Z'+1
        bcc IS_ALPHA_YES
IS_ALPHA_LOWER:
        cmp #'a'
        bcc IS_ALPHA_NO
        cmp #'z'+1
        bcc IS_ALPHA_YES
IS_ALPHA_NO:
        clc
        rts
IS_ALPHA_YES:
        sec
        rts

; Helper: Convert char in A to uppercase ASCII
TO_UPPER:
        cmp #'a'
        bcc TO_UPPER_DONE
        cmp #'z'+1
        bcs TO_UPPER_DONE
        sec
        sbc #$20
TO_UPPER_DONE:
        rts

; Helper: Append phoneme in A to PHONEME_BUF
; Preserves A, X, Y
EMIT_PHONEME:
        phx
        ldx ZP_PHON_COUNT
        cpx #250
        bcs EMIT_FULL
        sta PHONEME_BUF,x
        inc ZP_PHON_COUNT
EMIT_FULL:
        plx
        rts

; ==========================================================================
; WORD TRANSLATOR: CONVERT_WORD
; Looks up WORD_BUF in exception dictionary. If not found, uses G2P rules.
; ==========================================================================
CONVERT_WORD:
        ; Try dictionary lookup first
        lda #<DICTIONARY_DATA
        sta ZP_PTR_DICT_L
        lda #>DICTIONARY_DATA
        sta ZP_PTR_DICT_H

DICT_SEARCH_LOOP:
        ldy #0
        lda (ZP_PTR_DICT_L),y   ; Length of dictionary word
        beq DICT_NOT_FOUND      ; 0 marks end of dictionary table
        cmp ZP_WORD_LEN
        bne DICT_SKIP_ENTRY

        ; Length matches, compare word characters
        ldx #0
DICT_CMP_CHARS:
        iny
        lda (ZP_PTR_DICT_L),y
        cmp WORD_BUF,x
        bne DICT_MISMATCH
        inx
        cpx ZP_WORD_LEN
        bne DICT_CMP_CHARS

        ; Match found! Read phoneme count and copy phonemes
        iny
        lda (ZP_PTR_DICT_L),y   ; Phoneme count
        tax                     ; Count in X
DICT_COPY_PHONEMES:
        iny
        lda (ZP_PTR_DICT_L),y
        jsr EMIT_PHONEME
        dex
        bne DICT_COPY_PHONEMES
        rts

DICT_MISMATCH:
        ; Re-read word length in entry to compute skip offset
        ldy #0
        lda (ZP_PTR_DICT_L),y
DICT_SKIP_ENTRY:
        ; Advance pointer past: length byte (1) + word bytes (len) + phoneme count (1) + phonemes
        sta ZP_AY_VAL           ; save word length
        tay
        iny                     ; index of phoneme count byte
        lda (ZP_PTR_DICT_L),y   ; phoneme count
        clc
        adc ZP_AY_VAL           ; total payload bytes
        adc #2                  ; plus length byte and count byte
        adc ZP_PTR_DICT_L
        sta ZP_PTR_DICT_L
        lda ZP_PTR_DICT_H
        adc #0
        sta ZP_PTR_DICT_H
        jmp DICT_SEARCH_LOOP

DICT_NOT_FOUND:
        ; Fall back to general English G2P rules
        jsr RULE_BASED_G2P
        rts

; ==========================================================================
; RULE-BASED ENGLISH GRAPHEME-TO-PHONEME ENGINE
; Translates any arbitrary word in WORD_BUF using English phonetic rules.
; ==========================================================================
RULE_BASED_G2P:
        stz ZP_WORD_IDX

G2P_LOOP:
        lda ZP_WORD_IDX
        cmp ZP_WORD_LEN
        bcc G2P_NOT_DONE
        jmp G2P_DONE
G2P_NOT_DONE:

        ; Compute remaining characters: A = ZP_WORD_LEN - ZP_WORD_IDX
        lda ZP_WORD_LEN
        sec
        sbc ZP_WORD_IDX
        sta ZP_AY_VAL           ; remaining chars

        ldx ZP_WORD_IDX
        lda WORD_BUF,x          ; current character C

        ; --- Multi-letter checks ---
        cmp #'T'
        bne NOT_T_PREFIX
        ; Check TH
        lda ZP_AY_VAL
        cmp #2
        bcc NOT_TH
        lda WORD_BUF+1,x
        cmp #'H'
        bne NOT_TH
        ; TH found: voiced at start of word (DH), unvoiced otherwise (TH)
        cpx #0
        bne TH_UNVOICED
        lda #P_DH
        jsr EMIT_PHONEME
        jmp ADVANCE_2
TH_UNVOICED:
        lda #P_TH
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_TH:
        lda WORD_BUF,x
NOT_T_PREFIX:

        ; Check SH
        cmp #'S'
        bne NOT_S_PREFIX
        lda ZP_AY_VAL
        cmp #2
        bcc NOT_SH
        lda WORD_BUF+1,x
        cmp #'H'
        bne NOT_SH
        lda #P_SH
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_SH:
        lda WORD_BUF,x
NOT_S_PREFIX:

        ; Check CH
        cmp #'C'
        bne NOT_C_PREFIX
        lda ZP_AY_VAL
        cmp #2
        bcc NOT_CH
        lda WORD_BUF+1,x
        cmp #'H'
        bne NOT_CH
        lda #P_CH
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_CH:
        lda WORD_BUF,x
NOT_C_PREFIX:

        ; Check PH
        cmp #'P'
        bne NOT_P_PREFIX
        lda ZP_AY_VAL
        cmp #2
        bcc NOT_PH
        lda WORD_BUF+1,x
        cmp #'H'
        bne NOT_PH
        lda #P_F
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_PH:
        lda WORD_BUF,x
NOT_P_PREFIX:

        ; Check QU
        cmp #'Q'
        bne NOT_QU
        lda ZP_AY_VAL
        cmp #2
        bcc NOT_QU
        lda WORD_BUF+1,x
        cmp #'U'
        bne NOT_QU
        lda #P_K
        jsr EMIT_PHONEME
        lda #P_W
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_QU:

        ; Check WH
        cmp #'W'
        bne NOT_WH
        lda ZP_AY_VAL
        cmp #2
        bcc NOT_WH
        lda WORD_BUF+1,x
        cmp #'H'
        bne NOT_WH
        lda #P_W
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_WH:

        ; Check CK
        cmp #'C'
        bne NOT_CK
        lda ZP_AY_VAL
        cmp #2
        bcc NOT_CK
        lda WORD_BUF+1,x
        cmp #'K'
        bne NOT_CK
        lda #P_K
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_CK:

        ; Check NG
        cmp #'N'
        bne NOT_NG
        lda ZP_AY_VAL
        cmp #2
        bcc NOT_NG
        lda WORD_BUF+1,x
        cmp #'G'
        bne NOT_NG
        lda #P_NG
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_NG:

        ; --- Vowel Digraphs ---
        lda WORD_BUF,x
        cmp #'E'
        bne NOT_E_DIGRAPH
        lda ZP_AY_VAL
        cmp #2
        bcc NOT_E_DIGRAPH
        lda WORD_BUF+1,x
        cmp #'E'
        beq IS_EE_OR_EA
        cmp #'A'
        bne NOT_EE_OR_EA
IS_EE_OR_EA:
        lda #P_IY
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_EE_OR_EA:
        cmp #'R'
        bne NOT_ER_VOWEL
        lda #P_ER
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_ER_VOWEL:
        lda WORD_BUF,x
NOT_E_DIGRAPH:

        cmp #'O'
        bne NOT_O_DIGRAPH
        lda ZP_AY_VAL
        cmp #2
        bcc NOT_O_DIGRAPH
        lda WORD_BUF+1,x
        cmp #'O'
        bne NOT_OO
        lda #P_UW
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_OO:
        cmp #'A'
        bne NOT_OA
        lda #P_OW
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_OA:
        cmp #'U'
        beq IS_OU_OR_OW
        cmp #'W'
        bne NOT_OU_OR_OW
IS_OU_OR_OW:
        lda #P_AW
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_OU_OR_OW:
        cmp #'I'
        beq IS_OI_OR_OY
        cmp #'Y'
        bne NOT_OI_OR_OY
IS_OI_OR_OY:
        lda #P_OY
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_OI_OR_OY:
        cmp #'R'
        bne NOT_OR_VOWEL
        lda #P_AO
        jsr EMIT_PHONEME
        lda #P_R
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_OR_VOWEL:
        lda WORD_BUF,x
NOT_O_DIGRAPH:

        cmp #'A'
        bne NOT_A_DIGRAPH
        lda ZP_AY_VAL
        cmp #2
        bcc NOT_A_DIGRAPH
        lda WORD_BUF+1,x
        cmp #'I'
        beq IS_AI_OR_AY
        cmp #'Y'
        bne NOT_AI_OR_AY
IS_AI_OR_AY:
        lda #P_EY
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_AI_OR_AY:
        cmp #'R'
        bne NOT_AR_VOWEL
        lda #P_AA
        jsr EMIT_PHONEME
        lda #P_R
        jsr EMIT_PHONEME
        jmp ADVANCE_2
NOT_AR_VOWEL:
        lda WORD_BUF,x
NOT_A_DIGRAPH:

        ; --- Silent E pattern check ---
        ; If word has at least 3 letters, ends in E, and current char is vowel at (WORD_LEN - 3)
        lda ZP_WORD_LEN
        cmp #3
        bcc NOT_SILENT_E
        tax
        lda WORD_BUF-1,x         ; Last letter of word
        cmp #'E'
        bne NOT_SILENT_E
        ; Word ends in E. Is current index (WORD_LEN - 3)?
        dex
        dex
        cpx ZP_WORD_IDX
        bne CHECK_FINAL_E
        ; Long vowel due to silent E!
        ldx ZP_WORD_IDX
        lda WORD_BUF,x
        cmp #'A'
        bne NOT_LONG_A
        lda #P_EY
        jsr EMIT_PHONEME
        jmp ADVANCE_1
NOT_LONG_A:
        cmp #'I'
        bne NOT_LONG_I
        lda #P_AY
        jsr EMIT_PHONEME
        jmp ADVANCE_1
NOT_LONG_I:
        cmp #'O'
        bne NOT_LONG_O
        lda #P_OW
        jsr EMIT_PHONEME
        jmp ADVANCE_1
NOT_LONG_O:
        cmp #'U'
        bne NOT_LONG_U
        lda #P_UW
        jsr EMIT_PHONEME
        jmp ADVANCE_1
NOT_LONG_U:
        cmp #'Y'
        bne NOT_SILENT_E
        lda #P_AY
        jsr EMIT_PHONEME
        jmp ADVANCE_1

CHECK_FINAL_E:
        ; If we are at the final 'E', skip it (silent E)
        ldx ZP_WORD_LEN
        dex
        cpx ZP_WORD_IDX
        bne NOT_SILENT_E
        jmp ADVANCE_1       ; Skip final silent E

NOT_SILENT_E:
        ; --- Single Character Phoneme Translation ---
        ldx ZP_WORD_IDX
        lda WORD_BUF,x

        ; Vowels
        cmp #'A'
        bne C_NOT_A
        lda #P_AE
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_A:
        cmp #'E'
        bne C_NOT_E
        ; E at end of word is usually silent; otherwise EH
        lda ZP_AY_VAL
        cmp #1
        bne E_NORMAL
        lda ZP_WORD_LEN
        cmp #2
        bcs SKIP_FINAL_E
E_NORMAL:
        lda #P_EH
        jsr EMIT_PHONEME
SKIP_FINAL_E:
        jmp ADVANCE_CONS_CHECK
C_NOT_E:
        cmp #'I'
        bne C_NOT_I
        lda #P_IH
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_I:
        cmp #'O'
        bne C_NOT_O
        lda #P_AA
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_O:
        cmp #'U'
        bne C_NOT_U
        lda #P_AH
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_U:
        cmp #'Y'
        bne C_NOT_Y
        cpx #0
        bne Y_NOT_START
        lda #P_Y
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
Y_NOT_START:
        lda ZP_AY_VAL
        cmp #1
        bne Y_MIDDLE
        lda #P_IY
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
Y_MIDDLE:
        lda #P_IH
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_Y:

        ; Consonants
        cmp #'B'
        bne C_NOT_B
        lda #P_B
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_B:
        cmp #'C'
        bne C_NOT_C
        ; Soft C before E, I, Y
        lda ZP_AY_VAL
        cmp #2
        bcc C_HARD
        lda WORD_BUF+1,x
        cmp #'E'
        beq C_SOFT
        cmp #'I'
        beq C_SOFT
        cmp #'Y'
        bne C_HARD
C_SOFT:
        lda #P_S
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_HARD:
        lda #P_K
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_C:
        cmp #'D'
        bne C_NOT_D
        lda #P_D
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_D:
        cmp #'F'
        bne C_NOT_F
        lda #P_F
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_F:
        cmp #'G'
        bne C_NOT_G
        ; Soft G before E, I, Y
        lda ZP_AY_VAL
        cmp #2
        bcc G_HARD
        lda WORD_BUF+1,x
        cmp #'E'
        beq G_SOFT
        cmp #'I'
        beq G_SOFT
        cmp #'Y'
        bne G_HARD
G_SOFT:
        lda #P_JH
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
G_HARD:
        lda #P_G
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_G:
        cmp #'H'
        bne C_NOT_H
        lda #P_HH
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_H:
        cmp #'J'
        bne C_NOT_J
        lda #P_JH
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_J:
        cmp #'K'
        bne C_NOT_K
        lda #P_K
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_K:
        cmp #'L'
        bne C_NOT_L
        lda #P_L
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_L:
        cmp #'M'
        bne C_NOT_M
        lda #P_M
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_M:
        cmp #'N'
        bne C_NOT_N
        lda #P_N
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_N:
        cmp #'P'
        bne C_NOT_P
        lda #P_P
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_P:
        cmp #'R'
        bne C_NOT_R
        lda #P_R
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_R:
        cmp #'S'
        bne C_NOT_S
        lda #P_S
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_S:
        cmp #'T'
        bne C_NOT_T
        lda #P_T
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_T:
        cmp #'V'
        bne C_NOT_V
        lda #P_V
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_V:
        cmp #'W'
        bne C_NOT_W
        lda #P_W
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_W:
        cmp #'X'
        bne C_NOT_X
        lda #P_K
        jsr EMIT_PHONEME
        lda #P_S
        jsr EMIT_PHONEME
        jmp ADVANCE_CONS_CHECK
C_NOT_X:
        cmp #'Z'
        bne ADVANCE_CONS_CHECK
        lda #P_Z
        jsr EMIT_PHONEME

ADVANCE_CONS_CHECK:
        ; If consonant is doubled (e.g. LL, SS, TT, PP), skip the duplicate
        ldx ZP_WORD_IDX
        lda ZP_AY_VAL
        cmp #2
        bcc ADVANCE_1
        lda WORD_BUF,x
        cmp WORD_BUF+1,x
        bne ADVANCE_1
        ; Duplicate found: advance 2
        inc ZP_WORD_IDX
        inc ZP_WORD_IDX
        jmp G2P_LOOP

ADVANCE_2:
        inc ZP_WORD_IDX
ADVANCE_1:
        inc ZP_WORD_IDX
        jmp G2P_LOOP

G2P_DONE:
        rts

; ==========================================================================
; ACOUSTIC SYNTHESIS PLAYBACK ENGINE
; Iterates through PHONEME_BUF, programs AY-3-8910 chips, and times frames.
; ==========================================================================
PLAY_PHONEME_STREAM:
        stz ZP_CUR_PHON

STREAM_LOOP:
        lda ZP_CUR_PHON
        cmp ZP_PHON_COUNT
        bcc STREAM_NOT_DONE
        jmp STREAM_DONE
STREAM_NOT_DONE:

        ldx ZP_CUR_PHON
        lda PHONEME_BUF,x
        tax                     ; Phoneme ID in X

        ; Load phoneme duration
        lda PHON_DUR,x
        sta ZP_FRAME_CNT

        ; Check mode
        lda PHON_MODE,x
        bne NOT_SILENT_PAUSE

        ; Silent pause: mute AY and delay
        jsr AY_MUTE_ALL
PAUSE_FRAME_LOOP:
        jsr DELAY_FRAME
        lda ZP_ESCAPE_HIT
        bne STREAM_ABORT
        dec ZP_FRAME_CNT
        bne PAUSE_FRAME_LOOP
        jmp ADVANCE_STREAM

STREAM_ABORT:
        jmp STREAM_DONE

NOT_SILENT_PAUSE:
        ; Check bit 5: plosive pre-closure silence
        lda PHON_MODE,x
        and #$20
        beq NO_PRE_CLOSURE
        ; Mute for 2 frames (~30 ms)
        jsr AY_MUTE_ALL
        jsr DELAY_FRAME
        lda ZP_ESCAPE_HIT
        bne STREAM_ABORT
        jsr DELAY_FRAME
        lda ZP_ESCAPE_HIT
        bne STREAM_ABORT
NO_PRE_CLOSURE:

        ; Program AY registers for this phoneme
        ldx ZP_CUR_PHON
        lda PHONEME_BUF,x
        tax
        jsr PROGRAM_PHONEME_AY

        ; Frame loop for duration of phoneme
PHON_FRAME_LOOP:
        ; Check bit 4: diphthong glide
        ldx ZP_CUR_PHON
        lda PHONEME_BUF,x
        tax
        lda PHON_MODE,x
        and #$10
        beq NO_GLIDE
        ; Diphthong glide: in second half of duration, update to target 2
        lda ZP_FRAME_CNT
        cmp #5
        bne NO_GLIDE
        jsr PROGRAM_GLIDE_TARGET
NO_GLIDE:

        jsr DELAY_FRAME
        lda ZP_ESCAPE_HIT
        bne STREAM_ABORT
        dec ZP_FRAME_CNT
        bne PHON_FRAME_LOOP

ADVANCE_STREAM:
        inc ZP_CUR_PHON
        jmp STREAM_LOOP

STREAM_DONE:
        jsr AY_MUTE_ALL
        rts

; Program AY registers for phoneme X
PROGRAM_PHONEME_AY:
        lda PHON_F1_L,x
        sta ZP_F1_L
        lda PHON_F1_H,x
        sta ZP_F1_H
        lda PHON_F2_L,x
        sta ZP_F2_L
        lda PHON_F2_H,x
        sta ZP_F2_H

        ; Set Formant 1 (Channel A)
        ldy #0              ; R0: Tone A Period Fine
        lda ZP_F1_L
        jsr AY_WRITE_BOTH
        ldy #1              ; R1: Tone A Period Coarse
        lda ZP_F1_H
        jsr AY_WRITE_BOTH

        ; Set Formant 2 (Channel B)
        ldy #2              ; R2: Tone B Period Fine
        lda ZP_F2_L
        jsr AY_WRITE_BOTH
        ldy #3              ; R3: Tone B Period Coarse
        lda ZP_F2_H
        jsr AY_WRITE_BOTH

        ; Set Voice Bar (Channel C: F0 = 125 Hz -> period 786 = $0312)
        ldy #4              ; R4: Tone C Period Fine
        lda #$12
        jsr AY_WRITE_BOTH
        ldy #5              ; R5: Tone C Period Coarse
        lda #$03
        jsr AY_WRITE_BOTH

        ; Set Noise Period (R6)
        ldy #6
        lda PHON_NOISE,x
        jsr AY_WRITE_BOTH

        ; Set Channel Amplitudes
        ; Channel A amplitude (R8)
        ldy #8
        lda PHON_MODE,x
        and #1              ; Tone A/B enabled?
        beq CH_A_NOISE_CHECK
        lda PHON_VOL,x
        bra WRITE_VOL_A
CH_A_NOISE_CHECK:
        lda PHON_MODE,x
        and #4              ; Noise enabled?
        beq CH_A_OFF
        lda PHON_VOL,x      ; Noise volume routed through Channel A
        bra WRITE_VOL_A
CH_A_OFF:
        lda #0
WRITE_VOL_A:
        jsr AY_WRITE_BOTH

        ; Channel B amplitude (R9)
        ldy #9
        lda PHON_MODE,x
        and #1              ; Tone A/B enabled?
        beq CH_B_OFF
        lda PHON_VOL,x
        bra WRITE_VOL_B
CH_B_OFF:
        lda #0
WRITE_VOL_B:
        jsr AY_WRITE_BOTH

        ; Channel C amplitude (R10: Voice bar)
        ldy #10
        lda PHON_MODE,x
        and #2              ; Tone C voice bar enabled?
        beq CH_C_OFF
        lda #9              ; Voice bar volume 9
        bra WRITE_VOL_C
CH_C_OFF:
        lda #0
WRITE_VOL_C:
        jsr AY_WRITE_BOTH

        ; Configure Hardware Envelope (R11, R12, R13)
        lda PHON_MODE,x
        and #8              ; Envelope modulation?
        beq SKIP_ENVELOPE
        ldy #11             ; R11: Envelope Fine (49 = $31 for ~125 Hz)
        lda #$31
        jsr AY_WRITE_BOTH
        ldy #12             ; R12: Envelope Coarse
        lda #0
        jsr AY_WRITE_BOTH
        ldy #13             ; R13: Shape 8 (repeating sawtooth)
        lda #8
        jsr AY_WRITE_BOTH
SKIP_ENVELOPE:

        ; Configure Mixer (R7)
        ; Bits: 0=Tone A, 1=Tone B, 2=Tone C, 3=Noise A, 4=Noise B, 5=Noise C (0=enable, 1=disable)
        lda #$3F            ; Default: disable all tones and noise
        sta ZP_AY_BASE      ; Use ZP_AY_BASE as mixer mask accumulator
        lda PHON_MODE,x
        and #1              ; Tone A/B enabled?
        beq MIXER_NO_TONE_AB
        lda ZP_AY_BASE
        and #$FC            ; Enable Tone A and B (clear bits 0 and 1)
        sta ZP_AY_BASE
MIXER_NO_TONE_AB:
        lda PHON_MODE,x
        and #2              ; Tone C enabled?
        beq MIXER_NO_TONE_C
        lda ZP_AY_BASE
        and #$FB            ; Clear bit 2 (enable Tone C)
        sta ZP_AY_BASE
MIXER_NO_TONE_C:
        lda PHON_MODE,x
        and #4              ; Noise enabled?
        beq MIXER_DONE
        lda ZP_AY_BASE
        and #$F7            ; Clear bit 3 (enable Noise A)
        sta ZP_AY_BASE
MIXER_DONE:
        lda ZP_AY_BASE
        ora #$C0            ; Keep I/O port bits set
        ldy #7              ; R7: Mixer control
        jsr AY_WRITE_BOTH
        rts

; Program glide target for diphthong phoneme X
PROGRAM_GLIDE_TARGET:
        lda PHON_F1B_L,x
        sta ZP_F1_L
        lda PHON_F1B_H,x
        sta ZP_F1_H
        lda PHON_F2B_L,x
        sta ZP_F2_L
        lda PHON_F2B_H,x
        sta ZP_F2_H
        ldy #0
        lda ZP_F1_L
        jsr AY_WRITE_BOTH
        ldy #1
        lda ZP_F1_H
        jsr AY_WRITE_BOTH
        ldy #2
        lda ZP_F2_L
        jsr AY_WRITE_BOTH
        ldy #3
        lda ZP_F2_H
        jsr AY_WRITE_BOTH
        rts

; ==========================================================================
; AY-3-8910 HARDWARE DRIVERS (SLOT 4 MOCKINGBOARD)
; ==========================================================================
; Initialize VIA/AY chip at offset X ($00 for Left, $80 for Right)
AY_INIT_CHIP:
        lda #$FF
        sta MB_LEFT+VIA_DDRA,x   ; Port A all outputs (AY data bus)
        lda #7
        sta MB_LEFT+VIA_DDRB,x   ; Port B bits 0,1,2 output (BC1, BDIR, /RESET)
        lda #0
        sta MB_LEFT+VIA_ORB,x    ; /RESET low (reset chip)
        lda #4
        sta MB_LEFT+VIA_ORB,x    ; /RESET high, inactive (BC1=0, BDIR=0)
        rts

; Write AY register Y with data A on chip offset X
; Preserve A, X, Y
AY_WRITE_REG:
        sta ZP_AY_VAL
        phx
        phy
        ; Step 1: Latch register address
        tya
        sta MB_LEFT+VIA_ORA,x
        lda #7                  ; BC1=1, BDIR=1 (Latch Address)
        sta MB_LEFT+VIA_ORB,x
        lda #4                  ; Inactive
        sta MB_LEFT+VIA_ORB,x
        ; Step 2: Write data to latched register
        lda ZP_AY_VAL
        sta MB_LEFT+VIA_ORA,x
        lda #6                  ; BC1=0, BDIR=1 (Write to PSG)
        sta MB_LEFT+VIA_ORB,x
        lda #4                  ; Inactive
        sta MB_LEFT+VIA_ORB,x
        ply
        plx
        lda ZP_AY_VAL
        rts

; Write register Y with data A to BOTH Left and Right AY chips
; Preserve X, Y
AY_WRITE_BOTH:
        sta ZP_AY_VAL
        phx
        ldx #0                  ; Left AY
        jsr AY_WRITE_REG
        lda ZP_AY_VAL
        ldx #$80                ; Right AY
        jsr AY_WRITE_REG
        plx
        rts

; Mute all channels on both AY chips
AY_MUTE_ALL:
        ldy #8
        lda #0
        jsr AY_WRITE_BOTH       ; Volume A = 0
        ldy #9
        lda #0
        jsr AY_WRITE_BOTH       ; Volume B = 0
        ldy #10
        lda #0
        jsr AY_WRITE_BOTH       ; Volume C = 0
        ldy #7
        lda #$FF
        jsr AY_WRITE_BOTH       ; Disable all tones & noise
        rts

; ==========================================================================
; FRAME DELAY & ESCAPE POLL
; Waits ~15 ms (approx 23,600 cycles). Polls keyboard for Escape every 0.5 ms.
; Sets ZP_ESCAPE_HIT=1 and clears strobe if Escape is pressed.
; ==========================================================================
DELAY_FRAME:
        ldx #30                 ; 30 intervals of ~787 cycles = ~23,610 cycles (~15 ms)
DELAY_INTERVAL_LOOP:
        ; Poll keyboard
        lda KBD
        bpl DELAY_NO_KEY        ; Bit 7 clear: no key pressed
        cmp #$9B                ; Escape ($1B with bit 7 set = $9B)
        bne DELAY_CLEAR_OTHER_KEY
        ; Escape pressed! Cancel immediately
        bit KBD_STROBE
        lda #1
        sta ZP_ESCAPE_HIT
        rts
DELAY_CLEAR_OTHER_KEY:
        bit KBD_STROBE
DELAY_NO_KEY:
        ; Inner delay: ~760 cycles
        ldy #150
DELAY_INNER:
        dey
        bne DELAY_INNER
        dex
        bne DELAY_INTERVAL_LOOP
        rts

; ==========================================================================
; INTERACTIVE TEXT-MODE UI
; User interface for standalone interactive typing and speech.
; ==========================================================================
UI:
        ; Switch to text mode page 1
        bit TEXT_SW
        bit FULL_SW
        bit PAGE1_SW
        jsr ROM_HOME
        jsr TTS_INIT

        ; Print Banner
        ldx #0
PRINT_BANNER_LOOP:
        lda MSG_BANNER,x
        beq BANNER_LINE1_DONE
        ora #$80
        jsr ROM_COUT
        inx
        bne PRINT_BANNER_LOOP
BANNER_LINE1_DONE:
        jsr ROM_CROUT
        ldx #0
PRINT_HELP_LOOP:
        lda MSG_HELP,x
        beq BANNER_DONE
        ora #$80
        jsr ROM_COUT
        inx
        bne PRINT_HELP_LOOP
BANNER_DONE:

UI_PROMPT_LOOP:
        jsr ROM_CROUT
        lda #$BE                ; '>' | $80
        jsr ROM_COUT
        lda #$A0                ; ' ' | $80
        jsr ROM_COUT

        ; Clear TTS_INPUT buffer
        ldx #0
CLEAR_BUF_LOOP:
        stz TTS_INPUT,x
        inx
        cpx #122
        bcc CLEAR_BUF_LOOP

        ldx #0                  ; Current input length

UI_KEY_LOOP:
        jsr ROM_RDKEY
        and #$7F                ; Convert from high-bit ASCII

        ; Check Escape ($1B)
        cmp #$1B
        bne NOT_ESC_KEY
        ; Escape at input: exit with BRK
        jsr AY_MUTE_ALL
        jsr ROM_CROUT
        brk

NOT_ESC_KEY:
        ; Check Enter ($0D)
        cmp #$0D
        beq UI_ENTER_PRESSED

        ; Check Backspace / Delete ($08 or $7F)
        cmp #$08
        beq UI_BACKSPACE
        cmp #$7F
        beq UI_BACKSPACE

        ; Printable character check
        cmp #' '
        bcc UI_KEY_LOOP         ; Ignore control characters
        cmp #$7F
        bcs UI_KEY_LOOP

        ; Buffer limit check (max 120 chars)
        cpx #120
        bcs UI_BEEP_FULL

        ; Store character in buffer and echo
        sta TTS_INPUT,x
        inx
        ora #$80
        jsr ROM_COUT
        jmp UI_KEY_LOOP

UI_BEEP_FULL:
        jsr ROM_BELL
        jmp UI_KEY_LOOP

UI_BACKSPACE:
        cpx #0
        beq UI_KEY_LOOP
        dex
        stz TTS_INPUT,x
        ; Erase character on screen: Backspace, Space, Backspace
        lda #$88                ; Backspace
        jsr ROM_COUT
        lda #$A0                ; ' ' | $80
        jsr ROM_COUT
        lda #$88
        jsr ROM_COUT
        jmp UI_KEY_LOOP

UI_ENTER_PRESSED:
        ; NUL-terminate
        lda #0
        sta TTS_INPUT,x
        jsr ROM_CROUT

        ; Call TTS_SPEAK
        lda #<TTS_INPUT
        ldx #>TTS_INPUT
        jsr TTS_SPEAK

        cmp #1
        bne NOT_UI_CANCELLED
        ; Print [CANCELLED]
        ldx #0
PRINT_CANCEL_LOOP:
        lda MSG_CANCEL,x
        beq NOT_UI_CANCELLED
        ora #$80
        jsr ROM_COUT
        inx
        bne PRINT_CANCEL_LOOP

NOT_UI_CANCELLED:
        jmp UI_PROMPT_LOOP

; UI Messages
MSG_BANNER:
        .asciiz "3RIC TALKS V1 - GEMINI 3.8 FLASH TTS"
MSG_HELP:
        .asciiz "TYPE SENTENCE + ENTER. ESC CANCELS."
MSG_CANCEL:
        .asciiz " [CANCELLED]"

; ==========================================================================
; PHONEME ACOUSTIC TABLES
; ==========================================================================
; Duration in ~15 ms frames
PHON_DUR:
        .byte 5, 12, 22, 9, 8, 12, 8, 9
        .byte 10, 10, 12, 8, 10, 7, 9, 13
        .byte 13, 13, 7, 7, 7, 7, 7, 7
        .byte 8, 8, 8, 7, 7, 6, 8, 8
        .byte 7, 7, 3, 3, 3, 3, 3, 3
        .byte 5, 5

; Synthesis mode flags
PHON_MODE:
        .byte $00, $00, $00, $0B, $0B, $1B, $0B, $0B
        .byte $0B, $0B, $1B, $0B, $0B, $0B, $0B, $1B
        .byte $1B, $1B, $03, $03, $03, $03, $03, $03
        .byte $03, $04, $04, $04, $04, $04, $06, $06
        .byte $06, $06, $24, $24, $24, $26, $26, $26
        .byte $24, $26

; Formant 1 period low byte
PHON_F1_L:
        .byte $00, $00, $00, $6C, $FC, $C5, $BA, $95
        .byte $87, $AD, $C5, $DF, $48, $A4, $DB, $8C
        .byte $8C, $B3, $03, $19, $48, $5F, $6C, $6C
        .byte $6C, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00

; Formant 1 period high byte
PHON_F1_H:
        .byte $00, $00, $00, $01, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $01, $00, $00, $00
        .byte $00, $00, $01, $01, $01, $01, $01, $01
        .byte $01, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00

; Formant 2 period low byte
PHON_F2_L:
        .byte $00, $00, $00, $2B, $34, $37, $38, $3D
        .byte $59, $75, $6D, $60, $74, $52, $4C, $59
        .byte $59, $74, $5E, $62, $7B, $2D, $6D, $46
        .byte $37, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00

; Formant 2 period high byte
PHON_F2_H:
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00

; Noise period (0-31)
PHON_NOISE:
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $01, $05, $0D, $0B, $11, $01, $05
        .byte $0D, $0B, $0F, $02, $07, $0F, $02, $07
        .byte $04, $04

; Volume / Amplitude setting
PHON_VOL:
        .byte $00, $00, $00, $10, $10, $10, $10, $10
        .byte $10, $10, $10, $10, $10, $10, $10, $10
        .byte $10, $10, $0D, $0D, $0D, $0D, $0B, $0B
        .byte $0B, $0E, $0E, $09, $08, $08, $0C, $0C
        .byte $0A, $0A, $0C, $0E, $0E, $0C, $0D, $0D
        .byte $0E, $0E

; Diphthong glide target F1 low byte
PHON_F1B_L:
        .byte $00, $00, $00, $6C, $FC, $33, $BA, $95
        .byte $87, $AD, $03, $DF, $48, $A4, $DB, $33
        .byte $19, $33, $03, $19, $48, $5F, $6C, $6C
        .byte $6C, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00

; Diphthong glide target F1 high byte
PHON_F1B_H:
        .byte $00, $00, $00, $01, $00, $01, $00, $00
        .byte $00, $00, $01, $00, $01, $00, $00, $01
        .byte $01, $01, $01, $01, $01, $01, $01, $01
        .byte $01, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00

; Diphthong glide target F2 low byte
PHON_F2B_L:
        .byte $00, $00, $00, $2B, $34, $2D, $38, $3D
        .byte $59, $75, $7B, $60, $74, $52, $4C, $2F
        .byte $74, $2F, $5E, $62, $7B, $2D, $6D, $46
        .byte $37, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00

; Diphthong glide target F2 high byte
PHON_F2B_H:
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00, $00, $00, $00, $00, $00, $00
        .byte $00, $00

; ==========================================================================
; PRONUNCIATION EXCEPTION DICTIONARY
; Format: .byte word_len, "WORD", phon_count, P_PHON1, P_PHON2, ...
; Terminated by .byte 0
; ==========================================================================
DICTIONARY_DATA:
        .byte 3, "THE", 2, P_DH, P_AH
        .byte 4, "THIS", 3, P_DH, P_IH, P_S
        .byte 4, "THAT", 3, P_DH, P_AE, P_T
        .byte 5, "THESE", 3, P_DH, P_IY, P_Z
        .byte 5, "THOSE", 3, P_DH, P_OW, P_Z
        .byte 4, "THEY", 2, P_DH, P_EY
        .byte 5, "THEIR", 3, P_DH, P_EH, P_R
        .byte 5, "THERE", 3, P_DH, P_EH, P_R
        .byte 2, "TO", 2, P_T, P_UW
        .byte 3, "TOO", 2, P_T, P_UW
        .byte 3, "TWO", 2, P_T, P_UW
        .byte 2, "OF", 2, P_AH, P_V
        .byte 3, "OFF", 2, P_AO, P_F
        .byte 3, "FOR", 3, P_F, P_AO, P_R
        .byte 3, "ONE", 3, P_W, P_AH, P_N
        .byte 4, "ONCE", 4, P_W, P_AH, P_N, P_S
        .byte 3, "ARE", 2, P_AA, P_R
        .byte 3, "YOU", 2, P_Y, P_UW
        .byte 4, "YOUR", 3, P_Y, P_AO, P_R
        .byte 2, "WE", 2, P_W, P_IY
        .byte 4, "TALK", 3, P_T, P_AO, P_K
        .byte 5, "TALKS", 4, P_T, P_AO, P_K, P_S
        .byte 6, "TALKED", 4, P_T, P_AO, P_K, P_T
        .byte 7, "TALKING", 5, P_T, P_AO, P_K, P_IH, P_NG
        .byte 4, "WALK", 3, P_W, P_AO, P_K
        .byte 5, "WALKS", 4, P_W, P_AO, P_K, P_S
        .byte 3, "NEW", 2, P_N, P_UW
        .byte 3, "OLD", 3, P_OW, P_L, P_D
        .byte 4, "HAVE", 3, P_HH, P_AE, P_V
        .byte 3, "HAS", 3, P_HH, P_AE, P_Z
        .byte 3, "HAD", 3, P_HH, P_AE, P_D
        .byte 2, "DO", 2, P_D, P_UW
        .byte 4, "DOES", 3, P_D, P_AH, P_Z
        .byte 4, "DONE", 3, P_D, P_AH, P_N
        .byte 4, "SAID", 3, P_S, P_EH, P_D
        .byte 4, "SAYS", 3, P_S, P_EH, P_Z
        .byte 3, "WAS", 3, P_W, P_AA, P_Z
        .byte 4, "WERE", 2, P_W, P_ER
        .byte 4, "WHAT", 3, P_W, P_AH, P_T
        .byte 3, "WHO", 2, P_HH, P_UW
        .byte 5, "WHERE", 3, P_W, P_EH, P_R
        .byte 4, "WHEN", 3, P_W, P_EH, P_N
        .byte 3, "WHY", 2, P_W, P_AY
        .byte 5, "WHICH", 3, P_W, P_IH, P_CH
        .byte 4, "COME", 3, P_K, P_AH, P_M
        .byte 4, "SOME", 3, P_S, P_AH, P_M
        .byte 4, "GIVE", 3, P_G, P_IH, P_V
        .byte 4, "LIVE", 3, P_L, P_IH, P_V
        .byte 4, "LOVE", 3, P_L, P_AH, P_V
        .byte 4, "GONE", 3, P_G, P_AO, P_N
        .byte 5, "HELLO", 4, P_HH, P_EH, P_L, P_OW
        .byte 8, "COMPUTER", 8, P_K, P_AH, P_M, P_P, P_Y, P_UW, P_T, P_ER
        .byte 9, "COMPUTERS", 9, P_K, P_AH, P_M, P_P, P_Y, P_UW, P_T, P_ER, P_Z
        .byte 8, "SOFTWARE", 7, P_S, P_AO, P_F, P_T, P_W, P_EH, P_R
        .byte 6, "PLEASE", 4, P_P, P_L, P_IY, P_Z
        .byte 1, "A", 1, P_EY
        .byte 1, "I", 1, P_AY
        .byte 2, "AN", 2, P_AE, P_N
        .byte 3, "AND", 3, P_AE, P_N, P_D
        .byte 2, "IN", 2, P_IH, P_N
        .byte 2, "IS", 2, P_IH, P_Z
        .byte 2, "IT", 2, P_IH, P_T
        .byte 3, "CAN", 3, P_K, P_AE, P_N
        .byte 4, "OVER", 3, P_OW, P_V, P_ER
        .byte 4, "LAZY", 4, P_L, P_EY, P_Z, P_IY
        .byte 3, "DOG", 3, P_D, P_AO, P_G
        .byte 0             ; End of dictionary

; ==========================================================================
; APPLICATION WORKSPACE & INPUT BUFFERS
; ==========================================================================
PHONEME_BUF:    .res 256    ; Buffer of phoneme IDs for current sentence
WORD_BUF:       .res 32     ; Normalization buffer for current word

; TTS_INPUT: Mandatory 122 consecutive bytes in always-mapped RAM ($0800..$8FFF)
TTS_INPUT:      .res 122
