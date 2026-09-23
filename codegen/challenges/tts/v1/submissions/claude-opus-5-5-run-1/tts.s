; =============================================================================
; 3RIC Talks v1 -- "Pulse-Reset Formant Voice"
; entry: claude-opus-5-5-run-1
; Copyright (c) 2026 Claude Opus 5.5 via GitHub Copilot, for ebadger.
; MIT License (see repository LICENSE).
;
; An original English text-to-speech engine for the 3RIC 65C02 computer.
;   * letter-to-sound rules (original, generated table below) -> phonemes
;   * prosody/expansion -> 16-byte synthesis segments
;   * a pulse-reset formant synthesizer: at every glottal pulse three sine
;     oscillators (F1/F2/F3) restart at phase 0 and decay in 3 dB steps,
;     summed and played through the Mockingboard AY-3-8910 volume
;     registers used as a 2-channel DAC (channels A+B on both AYs, so the
;     left and right chips carry the same signal); channel C of both AYs
;     carries AY hardware noise for fricatives and stop bursts.
;   * sample rate: PHI2/256 = 6146 Hz, paced by polling VIA T1 (left
;     Mockingboard VIA at $C400); no IRQs are enabled.
;
; AY register-write sequence (latch address ORB=7->4, write data ORB=6->4)
; and reset/DDR setup follow the 3RIC groovebox.s helper pattern
; (codegen/programs/groovebox.s, same repository/MIT license).
;
; Build:   node codegen/challenges/tts/v1/submissions/claude-opus-5-5-run-1/generate.mjs
;          node codegen/tools/asm6502.mjs <this file> ...   (or the shared checker)
; Launch:  BRUN TTS.PRG 0800
; =============================================================================

        .org $0800

; ----------------------------------------------------------------- hardware
KBD      = $C000
KBDSTRB  = $C010
AY1      = $C400            ; left Mockingboard VIA  (ORB=+0, ORA=+1)
AY2      = $C480            ; right Mockingboard VIA
ORB1     = AY1+0
ORA1     = AY1+1
DDRB1    = AY1+2
DDRA1    = AY1+3
T1CL1    = AY1+4
T1CH1    = AY1+5
ACR1     = AY1+11
IFR1     = AY1+13
IER1     = AY1+14
ORB2     = AY2+0
ORA2     = AY2+1
DDRB2    = AY2+2
DDRA2    = AY2+3
ACR2     = AY2+11
IFR2     = AY2+13
IER2     = AY2+14

; ----------------------------------------------------------------- RAM map
PHB      = $4000            ; phoneme stream  $4000-$47FF
PHBEND   = $4800
SEGBUF   = $4800            ; segment records $4800-$6FFF (640 x 16 bytes)
SEGEND   = $6FE0            ; last usable record start (keeps room for tail)

; ----------------------------------------------------------------- zero page
; $60-$9F are used only inside TTS_SPEAK/TTS_INIT and restored on return.
DCN      = 3               ; samples per formant-decay event
ZPBASE   = $60
UBAS     = $60             ; UI-only pointers (between TTS_SPEAK calls)
UMSG     = $62
SEGPRE   = SEGBUF-16
ZPLEN    = 64
CUR      = $60              ; current: F1 F2 F3 A1 A2 A3 pitch  ($60-$66)
CF1      = $60
CA1      = $63
CA2      = $64
CA3      = $65
CPIT     = $66
TGT      = $67              ; targets, same order ($67-$6D)
TPIT     = $6D
PH1      = $6E
PH2      = $6F
PH3      = $70
P1       = $71              ; formant table pointers (low byte always 0)
P2       = $73
P3       = $75
VA       = $77
VB       = $78
PCNT     = $79
DCNT     = $7A
DS       = $7B
FEL      = $7C
REML     = $7D
REMH     = $7E
SP       = $7F              ; segment pointer (2)
MODE     = $81
RATE     = $82
NVOL     = $83
NPER     = $84
RND      = $85
TMP      = $86
TMP2     = $87
INP      = $88              ; caller string (2)
WI       = $8A
JJ       = $8B
KK       = $8C
RP       = $8D              ; rule pointer (2)
PP       = $8F              ; phoneme write/read pointer (2)
QQ       = $91              ; scan pointer (2)
CNT      = $93
WBEG     = $94              ; (2)
TP       = $96              ; template pointer (2)
WORDI    = $98
FNW      = $99
PIT      = $9A
DMODE    = $9B
YS       = $9C
IP       = $9D
MK       = $9E
KS       = $9F

; =============================================================================
; program entry: interactive UI
; =============================================================================
START:
        jmp UI_MAIN

; =============================================================================
; TTS_INIT -- establish chip state.  Clobbers A,X,Y, flags.  ~3 ms.
; No banking is needed: everything lives in always-mapped RAM $0800-$6FFF.
; =============================================================================
TTS_INIT:
        php
        sei
        cld
        lda #$FF
        sta DDRA1
        sta DDRA2
        lda #$07
        sta DDRB1
        sta DDRB2
        lda #$00                ; AY /RESET low
        sta ORB1
        sta ORB2
        lda #$04                ; inactive, out of reset
        sta ORB1
        sta ORB2
        lda #$7F                ; no VIA interrupts from these VIAs
        sta IER1
        sta IER2
        lda #$00
        sta ACR1
        sta ACR2
        jsr AYQUIET
        lda T1CL1               ; clear any T1 flag
        lda #$7F
        sta IFR1
        sta IFR2
        ldx #0                  ; word buffer = spaces
        lda #$20
TI1:    sta WBUF,x
        inx
        bne TI1
        lda #$A5
        sta INITED
        plp
        rts

; all volumes 0, tone+noise disabled on both chips
AYQUIET:
        ldx #8
        lda #0
        jsr AYW
        ldx #9
        lda #0
        jsr AYW
        ldx #10
        lda #0
        jsr AYW
        ldx #7
        lda #$3F
        jsr AYW
        rts

; write A to AY register X on both chips.  Clobbers Y.
AYW:
        stx ORA1
        ldy #7
        sty ORB1
        ldy #4
        sty ORB1
        sta ORA1
        ldy #6
        sty ORB1
        ldy #4
        sty ORB1
        stx ORA2
        ldy #7
        sty ORB2
        ldy #4
        sty ORB2
        sta ORA2
        ldy #6
        sty ORB2
        ldy #4
        sty ORB2
        rts

; =============================================================================
; TTS_SPEAK -- A=lo X=hi of NUL-terminated ASCII (max 120 chars).
; Returns A=0 done/empty, 1 cancelled by Escape, 2 invalid/overlength.
; Clobbers X,Y; P restored (I flag as on entry); D cleared on entry.
; Blocking.  IRQs are masked only while sound is produced.
; =============================================================================
TTS_SPEAK:
        php
        cld
        sta ARGL
        stx ARGH
        ldx #0
TS1:    lda ZPBASE,x
        sta ZSAVE,x
        inx
        cpx #ZPLEN
        bne TS1
        lda INITED
        cmp #$A5
        beq TS2
        jsr TTS_INIT
TS2:    lda ARGL
        sta INP
        lda ARGH
        sta INP+1
        jsr VALIDATE            ; A = 0 ok, 2 invalid, 3 nothing to say
        cmp #0
        beq TS3
        cmp #2
        beq TSX
        lda #0
        jmp TSX
TS3:    tsx                     ; for ESCCHK unwinding
        stx SAVSP
        lda #$80
        sta ESCOK
        jsr G2PALL
        jsr EXPAND
        jsr SYNTH               ; A = 0 or 1
TSX:    sta RESULT
        lda #0
        sta ESCOK
        ldx #0
TS4:    lda ZSAVE,x
        sta ZPBASE,x
        inx
        cpx #ZPLEN
        bne TS4
        plp
        lda RESULT
        rts

; Escape during text analysis (before any sound): unwind to TTS_SPEAK, A=1.
; Preserves A, X, Y when no Escape is pending.  Only used under TTS_SPEAK.
ESCCHK: bit ESCOK
        bpl EK9
        bit KBD
        bpl EK9
        pha
        lda KBD
        cmp #$9B
        beq EK1
        pla
EK9:    rts
EK1:    bit KBDSTRB
        ldx SAVSP
        txs
        lda #1
        jmp TSX
; debug/test entry: validation + letter-to-sound only (phonemes at PHB).
TTS_G2P:
        php
        cld
        sta INP
        stx INP+1
        lda INITED
        cmp #$A5
        beq TG0
        jsr TTS_INIT
TG0:    jsr VALIDATE
        cmp #0
        bne TG1
        jsr G2PALL
        lda #0
TG1:    plp
        rts

; ----------------------------------------------------------------- validate
; bounded scan: a NUL must appear within the first 121 bytes.
VALIDATE:
        lda #0
        sta CNT                 ; nonzero once a speakable char is seen
        ldy #0
VA1:    lda (INP),y
        beq VA9
        cpy #120
        bcs VABAD
        jsr CHCLASS             ; A=char -> X class 0 bad,1 word,2 punct/space
        cpx #0
        beq VABAD
        cpx #1
        bne VA2
        stx CNT
VA2:    iny
        jmp VA1
VA9:    lda CNT
        bne VAOK
        lda #3
        rts
VAOK:   lda #0
        rts
VABAD:  lda #2
        rts

; A = char; returns A = uppercased char, X = 0 invalid, 1 letter/'/digit, 2 other allowed
CHCLASS:
        cmp #'a'
        bcc CC1
        cmp #'z'+1
        bcs CC0
        sec
        sbc #$20
CC1:    cmp #'A'
        bcc CC2
        cmp #'Z'+1
        bcs CC0
        ldx #1
        rts
CC2:    cmp #'0'
        bcc CC3
        cmp #'9'+1
        bcs CC4
        ldx #1
        rts
CC3:    cmp #$27
        bne CC5
        ldx #1
        rts
CC4:    cmp #':'
        beq CCP
        cmp #';'
        beq CCP
        cmp #'?'
        beq CCP
CC0:    ldx #0
        rts
CC5:    cmp #' '
        beq CCP
        cmp #'-'
        beq CCP
        cmp #'.'
        beq CCP
        cmp #','
        beq CCP
        cmp #'!'
        beq CCP
        ldx #0
        rts
CCP:    ldx #2
        rts

; ----------------------------------------------------------------- text -> phonemes
G2PALL:
        lda #<PHB
        sta PP
        lda #>PHB
        sta PP+1
        lda #0
        sta IP
GA1:    jsr ESCCHK
        ldy IP
        lda (INP),y
        bne GA2
        jmp GA9
GA2:    jsr CHCLASS
        cpx #1
        beq GAW
        inc IP                  ; punctuation / space / hyphen
        ldx #PH_PCOMMA
        cmp #','
        beq GAE
        cmp #';'
        beq GAE
        cmp #':'
        beq GAE
        ldx #PH_PPERIOD
        cmp #'.'
        beq GAE
        ldx #PH_PQUEST
        cmp #'?'
        beq GAE
        ldx #PH_PEXCL
        cmp #'!'
        beq GAE
        jmp GA1
GAE:    txa
        jsr EMIT
        jmp GA1
GAW:    jsr WCLEAR
        cmp #'0'
        bcc GAL
        cmp #'9'+1
        bcs GAL
        sec                     ; digit -> its name
        sbc #'0'
        tax
        lda DIGL,x
        sta QQ
        lda DIGH,x
        sta QQ+1
        ldy #0
GAD:    lda (QQ),y
        beq GAD2
        sta WBUF+1,y
        iny
        jmp GAD
GAD2:   inc IP
        jmp GAWORD
GAL:    ldx #1                  ; letters / apostrophes, at most 60 per word
GAL1:   ldy IP
        lda (INP),y
        beq GAWORD
        jsr CHCLASS
        cpx #1
        bne GAWORD
        cmp #'0'
        bcc GAL2
        cmp #'9'+1
        bcc GAWORD
GAL2:   ldx KS
        sta WBUF,x
        inc IP
        inx
        stx KS
        cpx #61
        bcc GAL1
GAWORD: jsr G2PWORD
        lda #PH_WB
        jsr EMIT
        jmp GA1
GA9:    lda #0                  ; terminator
        ldy #0
        sta (PP),y
        rts

WCLEAR: pha
        ldx #1
        stx KS
        lda #$20
WC1:    sta WBUF,x
        inx
        cpx #76
        bne WC1
        pla
        rts

; append phoneme A at PP (bounded).  Preserves X,Y.
EMIT:
        sty YS
        ldy PP+1
        cpy #>PHBEND-1
        bcc EM1
        ldy PP
        cpy #$FE
        bcs EM2
EM1:    ldy #0
        sta (PP),y
        inc PP
        bne EM2
        inc PP+1
EM2:    ldy YS
        rts

; ----------------------------------------------------------------- one word in WBUF[1..]
G2PWORD:
        lda PP
        sta WBEG
        lda PP+1
        sta WBEG+1
        lda #1
        sta WI
GW1:    ldx WI
        lda WBUF,x
        cmp #$20
        bne GW2
        jmp GWSTRESS
GW2:    cmp #$27
        bne GW3
        lda #26
        jmp GW4
GW3:    sec
        sbc #'A'
GW4:    tax
        lda RIDXL,x
        sta RP
        lda RIDXH,x
        sta RP+1
GRULE:  ldy #0
        lda (RP),y
        bne GR1
        inc WI                  ; no rule: skip letter
        jmp GW1
GR1:    ldx WI
        dex
        stx JJ
GLFT:   lda (RP),y
        cmp #1
        beq GLOK
        jsr CTXL
        bcc GFAIL
        iny
        jmp GLFT
GLOK:   iny
        ldx WI
        inx
        stx KK
GMAT:   lda (RP),y
        cmp #2
        beq GMOK
        ldx KK
        cmp WBUF,x
        bne GFAIL
        inc KK
        iny
        jmp GMAT
GMOK:   iny
        lda KK
        sta MK
GRGT:   lda (RP),y
        cmp #3
        beq GROK
        jsr CTXR
        bcc GFAIL
        iny
        jmp GRGT
GROK:   iny
GEM:    lda (RP),y
        cmp #$FF
        beq GEDONE
        jsr EMIT
        iny
        jmp GEM
GEDONE: lda MK
        sta WI
        jmp GW1
GFAIL:  lda (RP),y
        cmp #$FF
        beq GF2
        iny
        jmp GFAIL
GF2:    iny
        tya
        clc
        adc RP
        sta RP
        bcc GF3
        inc RP+1
GF3:    jmp GRULE

; default stress: keep explicit stress / NS; else first full vowel, else first vowel
GWSTRESS:
        sec
        lda PP
        sbc WBEG
        sta CNT
        beq GS9
        ldy #0
GS1:    lda (WBEG),y
        bmi GS9
        cmp #PH_NS
        beq GS9
        iny
        cpy CNT
        bne GS1
        ldx #2
        jsr GSFIND
        bcs GS9
        ldx #1
        jsr GSFIND
GS9:    rts
; mark first phoneme whose PFLAGS has mask X; C=1 if marked
GSFIND: stx TMP
        ldy #0
GSF1:   lda (WBEG),y
        tax
        lda PFLAGS,x
        and TMP
        bne GSF2
        iny
        cpy CNT
        bne GSF1
        clc
        rts
GSF2:   lda (WBEG),y
        ora #$80
        sta (WBEG),y
        sec
        rts

; left context element A at WBUF[JJ]; C=1 match (JJ moves left).  Keeps Y.
CTXL:
        cmp #$81
        beq CLV
        cmp #$83
        beq CLC0
        cmp #$80
        bcs CLS
        ldx JJ
        cmp WBUF,x
        bne CFAIL
        dec JJ
        sec
        rts
CLV:    ldx JJ
        jsr ISVOW
        bcc CFAIL
CLV1:   dex
        jsr ISVOW
        bcs CLV1
        stx JJ
        sec
        rts
CLC0:   ldx JJ
CLC1:   jsr ISCON
        bcc CLC2
        dex
        jmp CLC1
CLC2:   stx JJ
        sec
        rts
CLS:    ldx JJ
        jsr ISCLS
        bcc CFAIL
        dec JJ
        sec
        rts
CFAIL:  clc
        rts

; right context element A at WBUF[KK]; C=1 match (KK moves right).  Keeps Y.
CTXR:
        cmp #$81
        beq CRV
        cmp #$83
        beq CRC0
        cmp #$86
        beq CRSUF
        cmp #$80
        bcs CRS
        ldx KK
        cmp WBUF,x
        bne CFAIL
        inc KK
        sec
        rts
CRV:    ldx KK
        jsr ISVOW
        bcc CFAIL
CRV1:   inx
        jsr ISVOW
        bcs CRV1
        stx KK
        sec
        rts
CRC0:   ldx KK
CRC1:   jsr ISCON
        bcc CRC2
        inx
        jmp CRC1
CRC2:   stx KK
        sec
        rts
CRS:    ldx KK
        jsr ISCLS
        bcc CFAIL
        inc KK
        sec
        rts
CRSUF:  sty YS
        ldx #0
SU1:    lda SUFTAB,x
        cmp #$FF
        beq SUNO
        ldy KK
SU2:    lda SUFTAB,x
        beq SUYES
        cmp #$20
        bne SU3
        lda WBUF,y              ; boundary: must not be a letter
        stx TMP
        tax
        lda CCLASS-$20,x
        ldx TMP
        and #32
        bne SUNX
        jmp SU4
SU3:    cmp WBUF,y
        bne SUNX
SU4:    iny
        inx
        jmp SU2
SUNX:   lda SUFTAB,x
        beq SUNX2
        inx
        jmp SUNX
SUNX2:  inx
        jmp SU1
SUYES:  ldy YS
        sec
        rts
SUNO:   ldy YS
        clc
        rts

; class tests on WBUF[X] (X preserved). C=1 if in class.
ISVOW:  lda #1
        jmp ISC
ISCON:  lda #2
ISC:    sta TMP
        stx TMP2
        lda WBUF,x
        tax
        lda CCLASS-$20,x
        ldx TMP2
        and TMP
        beq ISN
        sec
        rts
ISN:    clc
        rts
; A = class code $82/$84/$85/$87
ISCLS:  and #$07
        stx TMP2
        tax
        lda CMASK,x
        ldx TMP2
        jmp ISC
CMASK:  .byte 0,1,2,2,4,8,0,16

; ----------------------------------------------------------------- prosody + expansion
BASEP    = 48               ; base pitch period in samples (~128 Hz)

EXPAND:
        lda #<SEGBUF
        sta SP
        lda #>SEGBUF
        sta SP+1
        ldx #15                 ; leading silence
EXL0:   lda SEGLEAD,x
        ldy SEGIDX,x
        sta (SP),y
        dex
        bpl EXL0
        jsr SPNEXT
        lda #0
        sta WORDI
        sta FNW
        lda #<PHB
        sta QQ
        lda #>PHB
        sta QQ+1
EX1:    jsr ESCCHK
        ldy #0
        lda (QQ),y
        bne EX2
        jmp EXEND
EX2:    sta TMP2                ; raw code (with stress)
        and #$7F
        tax
        cpx #PH_WB
        bne EX3
        lda WORDI
        cmp #10
        bcs EX2B
        inc WORDI
EX2B:   lda #0
        sta FNW
        jmp EXNEXT
EX3:    cpx #PH_NS
        bne EX4
        lda #1
        sta FNW
        jmp EXNEXT
EX4:    stx KS                  ; phoneme index
        lda WORDI
        clc
        adc #BASEP
        sta PIT
        lda #0
        sta DMODE               ; bit0 long, bit1 short, bit2 final
        lda PFLAGS,x
        and #1
        beq EX6
        lda FNW
        beq EX4A
        lda #2
        sta DMODE
        jmp EX4B
EX4A:   lda TMP2
        bpl EX4B
        lda #1
        sta DMODE
        lda PIT
        sec
        sbc #6
        sta PIT
EX4B:   jsr FINALT              ; A: 0 none 1 fall 2 rise 3 comma
        cmp #0
        beq EX6
        pha
        lda DMODE
        ora #4
        sta DMODE
        pla
        cmp #1
        bne EX5
        lda PIT
        clc
        adc #8
        sta PIT
        jmp EX6
EX5:    cmp #2
        bne EX5B
        lda PIT
        sec
        sbc #12
        sta PIT
        jmp EX6
EX5B:   lda PIT
        sec
        sbc #3
        sta PIT
EX6:    ldx KS                  ; emit templates
        lda PTCNT,x
        bne EX6A
        jmp EXPOST
EX6A:   sta CNT
        lda PTIDX,x
        sta TP
        lda #0
        sta TP+1
        asl TP                  ; *16
        rol TP+1
        asl TP
        rol TP+1
        asl TP
        rol TP+1
        asl TP
        rol TP+1
        clc
        lda TP
        adc #<TEMPL
        sta TP
        lda TP+1
        adc #>TEMPL
        sta TP+1
EX7:    ldy #10
EX7A:   lda (TP),y
        sta (SP),y
        dey
        bpl EX7A
        ldy #11
        lda PIT
        sta (SP),y
        lda (TP),y              ; template flags
        sta MK
        and #1
        beq EX8
        jsr INHF
        bcs EX9
        lda #2
        sta MK
EX8:    lda MK
        and #2
        beq EX9
        jsr KEEPF
EX9:    lda MK
        and #4
        beq EX10
        ldy #9                  ; vowel duration prosody
        lda (SP),y
        sta TMP
        lsr
        lsr
        sta YS                  ; d/4
        lda DMODE
        and #1
        beq EX9A
        lda TMP
        clc
        adc YS
        sta TMP
EX9A:   lda DMODE
        and #2
        beq EX9B
        lda TMP
        sec
        sbc YS
        sta TMP
EX9B:   lda DMODE
        and #4
        beq EX9C
        lda TMP
        lsr
        clc
        adc TMP
        sta TMP
EX9C:   lda TMP
        sta (SP),y
EX10:   jsr SPNEXT
        clc
        lda TP
        adc #16
        sta TP
        bcc EX10A
        inc TP+1
EX10A:  dec CNT
        bne EX7
EXPOST: ldx KS                  ; sentence end resets declination
        cpx #PH_PPERIOD
        beq EXRS
        cpx #PH_PQUEST
        beq EXRS
        cpx #PH_PEXCL
        bne EXNEXT
EXRS:   lda #0
        sta WORDI
EXNEXT: inc QQ
        bne EXN2
        inc QQ+1
EXN2:   jmp EX1
EXEND:  ldx #15                 ; trailing silence then terminator
EXE1:   lda SEGTAIL,x
        ldy SEGIDX,x
        sta (SP),y
        dex
        bpl EXE1
        jsr KEEPF
        jsr SPNEXT0
        ldy #9
        lda #0
        sta (SP),y
        rts

; advance SP by one record, bounded (drops segments if the buffer is full)
SPNEXT:
        lda SP+1
        cmp #>SEGEND
        bcc SPNEXT0
        rts
SPNEXT0:
        clc
        lda SP
        adc #16
        sta SP
        bcc SPN1
        inc SP+1
SPN1:   rts

; copy previous record's formants into (SP)
KEEPF:
        sec
        lda SP
        sbc #16
        sta RP
        lda SP+1
        sbc #0
        sta RP+1
        ldy #2
KF1:    lda (RP),y
        sta (SP),y
        dey
        bpl KF1
        rts

; next sounding phoneme's first-template formants -> (SP); C=1 ok
INHF:
        lda QQ
        sta WBEG
        lda QQ+1
        sta WBEG+1
IH1:    inc WBEG
        bne IH2
        inc WBEG+1
IH2:    ldy #0
        lda (WBEG),y
        beq IHNO
        and #$7F
        tax
        lda PFLAGS,x
        and #4
        bne IHNO
        lda PFLAGS,x
        and #8
        bne IH1
        lda PTIDX,x             ; first template of that phoneme
        sta RP
        lda #0
        sta RP+1
        asl RP
        rol RP+1
        asl RP
        rol RP+1
        asl RP
        rol RP+1
        asl RP
        rol RP+1
        clc
        lda RP
        adc #<TEMPL
        sta RP
        lda RP+1
        adc #>TEMPL
        sta RP+1
        ldy #11
        lda (RP),y
        and #3
        bne IHNO
        ldy #2
IH3:    lda (RP),y
        sta (SP),y
        dey
        bpl IH3
        sec
        rts
IHNO:   clc
        rts

; phrase position of the vowel at QQ: 0 none, 1 fall, 2 rise, 3 comma
FINALT:
        lda QQ
        sta WBEG
        lda QQ+1
        sta WBEG+1
FT1:    inc WBEG
        bne FT2
        inc WBEG+1
FT2:    ldy #0
        lda (WBEG),y
        beq FTFALL
        and #$7F
        tax
        lda PFLAGS,x
        and #1
        bne FTNONE
        cpx #PH_PPERIOD
        beq FTFALL
        cpx #PH_PEXCL
        beq FTFALL
        cpx #PH_PQUEST
        beq FTRISE
        cpx #PH_PCOMMA
        beq FTCOM
        jmp FT1
FTNONE: lda #0
        rts
FTFALL: lda #1
        rts
FTRISE: lda #2
        rts
FTCOM:  lda #3
        rts

SEGIDX: .byte 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15
SEGLEAD: .byte 21,62,104,0,0,0,1,0,1,8,$11,BASEP,0,0,0,0
SEGTAIL: .byte 21,62,104,0,0,0,1,0,1,24,$11,BASEP+8,0,0,0,0

; =============================================================================
; synthesizer
; =============================================================================
SYNTH:
        php
        sei
        lda #0
        sta VA
        sta VB
        ldx #6                  ; initial state = neutral silence
SY0:    lda SEGLEAD,x
        sta CUR,x
        sta TGT,x
        dex
        bpl SY0
        lda #BASEP
        sta CPIT
        sta TPIT
        lda #0
        sta NVOL
        sta PH1
        sta PH2
        sta PH3
        sta P1
        sta P2
        sta P3
        sta REML
        sta REMH
        lda #1
        sta NPER
        sta MODE
        sta PCNT
        lda #$11
        sta RATE
        lda #$5B
        sta RND
        lda #DCN
        sta DCNT
        lda #48
        sta FEL
        jsr SETPG
        lda #<SEGPRE
        sta SP
        lda #>SEGPRE
        sta SP+1
        ldx #6                  ; noise period 1
        lda #1
        jsr AYW
        ldx #7                  ; A,B constant (DAC), C = noise
        lda #$1F
        jsr AYW
        lda #$40                ; T1 free-running, period 256 cycles
        sta ACR1
        lda #$FF
        sta T1CL1
        lda #$00
        sta T1CH1
        ldx #0                  ; ramp DAC 0 -> centre (~41 ms)
SYR1:   lda DACA,x
        sta VA
        lda DACB,x
        sta VB
        jsr WOUT
        jsr WOUT
        inx
        cpx #127
        bne SYR1

; ---- per-sample loop: ~237 of 256 cycles on the common path
SLOOP:
        bit IFR1
        bvc SLOOP
        lda T1CL1
        ldx #7
        ldy #4
        lda #8
        sta ORA1
        stx ORB1
        sty ORB1
        lda VA
        sta ORA1
        lda #6
        sta ORB1
        sty ORB1
        lda #9
        sta ORA1
        stx ORB1
        sty ORB1
        lda VB
        sta ORA1
        lda #6
        sta ORB1
        sty ORB1
        lda #8
        sta ORA2
        stx ORB2
        sty ORB2
        lda VA
        sta ORA2
        lda #6
        sta ORB2
        sty ORB2
        lda #9
        sta ORA2
        stx ORB2
        sty ORB2
        lda VB
        sta ORA2
        lda #6
        sta ORB2
        sty ORB2
        lda PH1                 ; three formant oscillators
        adc CF1
        sta PH1
        tay
        lda (P1),y
        sta TMP
        lda PH2
        adc CF1+1
        sta PH2
        tay
        lda (P2),y
        clc
        adc TMP
        sta TMP
        lda PH3
        adc CF1+2
        sta PH3
        tay
        lda (P3),y
        clc
        adc TMP
        tax
        lda DACA,x
        sta VA
        lda DACB,x
        sta VB
        dec PCNT
        bne PDONE
        jmp PULSE
PDONE:  dec DCNT
        beq DECAY
        jmp SLOOP

; ---- formant decay: F3 every 4 samples, F2 every 8, F1 every 16 (3 dB steps)
DECAY:
        lda #DCN
        sta DCNT
        inc DS
        lda P3+1
        cmp #>LEVELS
        beq DC2
        dec P3+1
DC2:    lda DS
        lsr
        bcs DC9
        lda P2+1
        cmp #>LEVELS
        beq DC1
        dec P2+1
DC1:    lda DS
        and #3
        bne DC9
        lda P1+1
        cmp #>LEVELS
        beq DC9
        dec P1+1
DC9:    jmp SLOOP

; ---- glottal pulse (voiced) or random excitation (aspirated)
PULSE:
        lda MODE
        cmp #2
        beq PASP
        lda CPIT
        sta PCNT
        clc
        adc FEL
        sta FEL
        lda #0
        sta PH1
        sta PH2
        sta PH3
        sta DS
        lda #DCN
        sta DCNT
        jsr SETPG
        lda FEL
        cmp #48
        bcs FRAME
        jmp SLOOP
PASP:   jsr RAND
        and #7
        clc
        adc #2
        sta PCNT
        clc
        adc FEL
        sta FEL
        jsr RAND
        sta PH1
        jsr RAND
        sta PH2
        jsr RAND
        sta PH3
        jsr SETPG
        lda FEL
        cmp #48
        bcs FRAME
        jmp SLOOP

SETPG:  lda #>LEVELS
        clc
        adc CA1
        sta P1+1
        lda #>LEVELS
        clc
        adc CA2
        sta P2+1
        lda #>LEVELS
        clc
        adc CA3
        sta P3+1
        rts

RAND:   lda RND
        asl
        bcc RA1
        eor #$1D
RA1:    sta RND
        rts

; ---- frame update (every >= 48 samples, at a pulse)
FRAME:
        lda KBD
        cmp #$9B
        bne FR0
        bit KBDSTRB
        jmp CANCEL
FR0:    sec
        lda REML
        sbc FEL
        sta REML
        lda REMH
        sbc #0
        sta REMH
        lda #0
        sta FEL
FADV:   lda REMH
        bmi NEXTSEG
        bne FSM
        lda REML
        beq NEXTSEG
FSM:    ldx #0                  ; smooth current toward targets
FSM1:   lda RATE
        cpx #3
        bcc FSM2
        lsr
        lsr
        lsr
        lsr
        cpx #6
        bcc FSM2
        lda #2
FSM2:   and #$0F
        tay
        lda TGT,x
        sec
        sbc CUR,x
        beq FSM6
        cpy #0
        beq FSMJ
        sta TMP
FSM3:   cmp #$80
        ror
        dey
        bne FSM3
        cmp #0
        bne FSM5
        lda TMP
        bmi FSM4
        lda #1
        jmp FSM5
FSM4:   lda #$FF
FSM5:   clc
        adc CUR,x
        sta CUR,x
        jmp FSM6
FSMJ:   lda TGT,x
        sta CUR,x
FSM6:   inx
        cpx #7
        bne FSM1
        jmp SLOOP

NEXTSEG:
        clc
        lda SP
        adc #16
        sta SP
        bcc NS1
        inc SP+1
NS1:    ldy #9
        lda (SP),y
        bne NS2
        jmp SPEND
NS2:    sta TMP                 ; remaining += dur*16
        lda #0
        sta TMP2
        asl TMP
        rol TMP2
        asl TMP
        rol TMP2
        asl TMP
        rol TMP2
        asl TMP
        rol TMP2
        clc
        lda REML
        adc TMP
        sta REML
        lda REMH
        adc TMP2
        sta REMH
        ldy #5
NS3:    lda (SP),y
        sta TGT,y
        dey
        bpl NS3
        ldy #11
        lda (SP),y
        sta TPIT
        ldy #6
        lda (SP),y
        sta MODE
        ldy #10
        lda (SP),y
        sta RATE
        ldy #7
        lda (SP),y
        cmp NVOL
        beq NS4
        sta NVOL
        ldx #10
        jsr AYW
NS4:    ldy #8
        lda (SP),y
        cmp NPER
        beq NS5
        sta NPER
        ldx #6
        jsr AYW
NS5:    jmp FADV

; wait for the next sample tick and output VA/VB on both chips
WOUT:   bit IFR1
        bvc WOUT
        lda T1CL1
        lda #8
        ldy VA
        jsr WOUTR
        lda #9
        ldy VB
WOUTR:  sta ORA1
        sta ORA2
        pha
        lda #7
        sta ORB1
        sta ORB2
        lda #4
        sta ORB1
        sta ORB2
        sty ORA1
        sty ORA2
        lda #6
        sta ORB1
        sta ORB2
        lda #4
        sta ORB1
        sta ORB2
        pla
        rts

SPEND:  lda #0
        jmp SYOFF
CANCEL: lda #1
SYOFF:  sta RESULT
        ldx #126                ; ramp centre -> 0 (~20 ms)
SYR2:   lda DACA,x
        sta VA
        lda DACB,x
        sta VB
        jsr WOUT
        dex
        bpl SYR2
        jsr AYQUIET
        lda #$00                ; T1 back to one-shot, flags clear
        sta ACR1
        lda T1CL1
        lda #$7F
        sta IFR1
        plp
        lda RESULT
        rts

; =============================================================================
; interactive UI (separate from the engine; uses only the ABI above)
; =============================================================================
UI_MAIN:
        cld
        jsr TTS_INIT
        lda #0
        sta ULEN
        sta TTS_INPUT
        jsr UCLS
        ldx #0
        ldy #0
        lda #<M_TITLE
        ldx #>M_TITLE
        ldy #0
        jsr UPRT
        lda #<M_HELP1
        ldx #>M_HELP1
        ldy #2
        jsr UPRT
        lda #<M_HELP2
        ldx #>M_HELP2
        ldy #3
        jsr UPRT
        lda #<M_HELP3
        ldx #>M_HELP3
        ldy #4
        jsr UPRT
        lda #<M_HELP4
        ldx #>M_HELP4
        ldy #5
        jsr UPRT
        lda #<M_TEXT
        ldx #>M_TEXT
        ldy #8
        jsr UPRT
        lda #<M_READY
        jsr USTAT
UI_LOOP:
        jsr UDRAW
UI_KEY: lda KBD
        bpl UI_KEY
        bit KBDSTRB
        and #$7F
        cmp #$1B
        bne UK1
        lda #<M_BYE
        jsr USTAT
        lda #16                 ; monitor output continues below the UI
        sta $25                 ; CV
        jsr $FBC1               ; BASCALC
        lda #0
        sta $24                 ; CH
        brk
        .byte $00
        jmp UI_MAIN
UK1:    cmp #$0D
        bne UK2
        jmp USPEAK
UK2:    cmp #$08
        beq UDEL
        cmp #$7F
        beq UDEL
        cmp #$18
        bne UK3
        lda #0
        sta ULEN
        sta TTS_INPUT
        lda #<M_READY
        jsr USTAT
        jmp UI_LOOP
UK3:    cmp #$20
        bcc UI_KEY
        sta UCH
        jsr CHCLASS
        cpx #0
        bne UK4
        lda #<M_BADCH
        jsr USTAT
        jmp UI_LOOP
UK4:    ldx ULEN
        cpx #120
        bcc UK5
        lda #<M_LIMIT
        jsr USTAT
        jmp UI_LOOP
UK5:    lda UCH
        sta TTS_INPUT,x
        inx
        stx ULEN
        lda #0
        sta TTS_INPUT,x
        lda #<M_READY
        jsr USTAT
        jmp UI_LOOP
UDEL:   ldx ULEN
        beq UD1
        dex
        stx ULEN
        lda #0
        sta TTS_INPUT,x
UD1:    lda #<M_READY
        jsr USTAT
        jmp UI_LOOP

USPEAK: ldx ULEN
        lda #0
        sta TTS_INPUT,x
        lda #<M_SPEAK
        jsr USTAT
        lda #<TTS_INPUT
        ldx #>TTS_INPUT
        jsr TTS_SPEAK
        cmp #1
        beq USP1
        cmp #2
        beq USP2
        lda #0
        sta ULEN
        sta TTS_INPUT
        lda #<M_DONE
        jsr USTAT
        jmp UI_LOOP
USP1:   lda #0
        sta ULEN
        sta TTS_INPUT
        lda #<M_STOP
        jsr USTAT
        jmp UI_LOOP
USP2:   lda #<M_INVAL
        jsr USTAT
        jmp UI_LOOP

; clear screen rows 0..23 (direct text-page writes)
UCLS:   ldx #23
UC1:    txa
        tay
        jsr UROW
        ldy #39
        lda #$A0
UC2:    sta (UBAS),y
        dey
        bpl UC2
        dex
        bpl UC1
        rts

; UBAS <- text row Y base (Y preserved)
UROW:   lda ROWL,y
        sta UBAS
        lda ROWH,y
        sta UBAS+1
        rts

; print NUL-terminated message A/X at row Y, column 0, then clear to col 39
UPRT:   sta UMSG
        stx UMSG+1
        jsr UROW
        ldy #0
UP1:    lda (UMSG),y
        beq UP2
        ora #$80
        sta (UBAS),y
        iny
        cpy #40
        bne UP1
        rts
UP2:    lda #$A0
UP3:    sta (UBAS),y
        iny
        cpy #40
        bne UP3
        rts

; status line (row 14): A = low byte of a message in the M_ page
USTAT:  ldx #>M_READY
        ldy #14
        jmp UPRT

; draw the 120-character edit field on rows 9..11, cursor '_', and count
UDRAW:  ldx #0
        ldy #9
UDR1:   jsr UROW
        stx UTMP
        ldy #0
UDR2:   ldx UTMP
        cpx ULEN
        bcc UDR3
        lda #$A0
        bne UDR4
UDR3:   lda TTS_INPUT,x
        cmp #'a'
        bcc UDR3A
        cmp #'z'+1
        bcs UDR3A
        and #$DF
UDR3A:  ora #$80
UDR4:   cpx ULEN
        bne UDR5
        cpx #120
        beq UDR5
        lda #$DF                ; cursor '_'
UDR5:   sta (UBAS),y
        inc UTMP
        iny
        cpy #40
        bne UDR2
        ldx UTMP
        lda UROWN
        clc
        adc #1
        sta UROWN
        cpx #120
        bne UDR6
        jmp UDCNT
UDR6:   ldy UROWN
        jmp UDR1
UDCNT:  lda #9
        sta UROWN
        ldy #12                 ; "nnn/120"
        jsr UROW
        lda ULEN
        ldy #0
        ldx #0
UDC1:   cmp #100
        bcc UDC2
        sbc #100
        inx
        jmp UDC1
UDC2:   pha
        txa
        ora #$B0
        sta (UBAS),y
        iny
        pla
        ldx #0
UDC3:   cmp #10
        bcc UDC4
        sbc #10
        inx
        jmp UDC3
UDC4:   pha
        txa
        ora #$B0
        sta (UBAS),y
        iny
        pla
        ora #$B0
        sta (UBAS),y
        iny
        ldx #0
UDC5:   lda M_OF120,x
        beq UDC6
        ora #$80
        sta (UBAS),y
        iny
        inx
        jmp UDC5
UDC6:   rts


ROWL:   .byte $00,$80,$00,$80,$00,$80,$00,$80,$28,$A8,$28,$A8,$28,$A8,$28,$A8
        .byte $50,$D0,$50,$D0,$50,$D0,$50,$D0
ROWH:   .byte $04,$04,$05,$05,$06,$06,$07,$07,$04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07

M_OF120: .byte "/120 CHARACTERS",0

        .res <(0-*)            ; status messages share one page (USTAT)
M_READY: .byte "READY. ENTER SPEAKS.",0
M_SPEAK: .byte "SPEAKING... (ESC STOPS)",0
M_DONE:  .byte "DONE. TYPE ANOTHER SENTENCE.",0
M_STOP:  .byte "STOPPED.",0
M_INVAL: .byte "NOT SPOKEN: UNSUPPORTED INPUT.",0
M_BADCH: .byte "UNSUPPORTED KEY. USE A-Z 0-9 ' - .,?!;:",0
M_LIMIT: .byte "LIMIT REACHED: 120 CHARACTERS MAX.",0
M_BYE:   .byte "EXIT TO MONITOR (BRK).",0
M_TITLE: .byte "3RIC TALKS: PULSE-RESET FORMANT VOICE",0
M_HELP1: .byte "TYPE ENGLISH TEXT, UP TO 120 CHARACTERS",0
M_HELP2: .byte "ENTER=SPEAK  DELETE/LEFT=ERASE",0
M_HELP3: .byte "CTRL-X=CLEAR  ESC=STOP SPEECH OR QUIT",0
M_HELP4: .byte "KEYS: A-Z 0-9 SPACE ' - . , ? ! ; :",0
M_TEXT:  .byte "TEXT:",0

; ----------------------------------------------------------------- engine RAM
INITED:  .byte 0
ESCOK:   .byte 0
SAVSP:   .byte 0
RESULT:  .byte 0
ARGL:    .byte 0
ARGH:    .byte 0
ULEN:    .byte 0
UCH:     .byte 0
UTMP:    .byte 0
UROWN:   .byte 9
ZSAVE:   .res 64
TTS_INPUT:
         .res 122
         .res <(0-*)
WBUF:    .res 256

; >>> GENERATED DATA (generate.mjs)
; ---- generated by generate.mjs; do not edit by hand ----
; synthesis rate 6146.2 Hz (256 cycles at 1573437.5 Hz)
PH_IY = 1
PH_IH = 2
PH_EY = 3
PH_EH = 4
PH_AE = 5
PH_AA = 6
PH_AO = 7
PH_OW = 8
PH_UH = 9
PH_UW = 10
PH_AH = 11
PH_AX = 12
PH_IX = 13
PH_ER = 14
PH_AY = 15
PH_AW = 16
PH_OY = 17
PH_P = 18
PH_B = 19
PH_T = 20
PH_D = 21
PH_K = 22
PH_G = 23
PH_F = 24
PH_V = 25
PH_TH = 26
PH_DH = 27
PH_S = 28
PH_Z = 29
PH_SH = 30
PH_ZH = 31
PH_HH = 32
PH_CH = 33
PH_JH = 34
PH_M = 35
PH_N = 36
PH_NG = 37
PH_L = 38
PH_R = 39
PH_W = 40
PH_Y = 41
PH_WB = 42
PH_PCOMMA = 43
PH_PPERIOD = 44
PH_PQUEST = 45
PH_PEXCL = 46
PH_NS = 47
PFLAGS:
        .byte $00,$13,$13,$13,$13,$13,$13,$13,$13,$13,$13,$13,$11,$11,$13,$13
        .byte $13,$13,$10,$10,$10,$10,$10,$10,$10,$10,$10,$10,$10,$10,$10,$10
        .byte $10,$10,$10,$10,$10,$10,$10,$10,$10,$10,$08,$04,$04,$04,$04,$08
PTIDX:
        .byte $00,$00,$01,$02,$04,$05,$06,$07,$08,$0A,$0B,$0C,$0D,$0E,$0F,$10
        .byte $12,$14,$16,$19,$1B,$1E,$20,$23,$25,$26,$27,$28,$29,$2A,$2B,$2C
        .byte $2D,$2E,$31,$34,$35,$36,$37,$38,$39,$3A,$3B,$3B,$3C,$3D,$3E,$3F
PTCNT:
        .byte $00,$01,$01,$02,$01,$01,$01,$01,$02,$01,$01,$01,$01,$01,$01,$02
        .byte $02,$02,$03,$02,$03,$02,$03,$02,$01,$01,$01,$01,$01,$01,$01,$01
        .byte $01,$03,$03,$01,$01,$01,$01,$01,$01,$01,$00,$01,$01,$01,$01,$00
; template records: F1inc F2inc F3inc A1 A2 A3 mode nvol nper dur16 rate flags(1 inh,2 keep,4 vowel), 16 bytes each
TEMPL:
        .byte $0B,$5E,$78,$0E,$0D,$0C,$01,$00,$01,$2A,$11,$04,$00,$00,$00,$00
        .byte $11,$4F,$6A,$0F,$0E,$0B,$01,$00,$01,$1E,$11,$04,$00,$00,$00,$00
        .byte $14,$4D,$68,$0F,$0E,$0B,$01,$00,$01,$26,$11,$04,$00,$00,$00,$00
        .byte $0D,$5A,$73,$0E,$0D,$0C,$01,$00,$01,$19,$12,$04,$00,$00,$00,$00
        .byte $17,$4A,$68,$0F,$0E,$0B,$01,$00,$01,$22,$11,$04,$00,$00,$00,$00
        .byte $1C,$45,$66,$0F,$0E,$0B,$01,$00,$01,$2E,$11,$04,$00,$00,$00,$00
        .byte $1E,$2E,$66,$0F,$0E,$09,$01,$00,$01,$2E,$11,$04,$00,$00,$00,$00
        .byte $18,$25,$68,$0F,$0E,$09,$01,$00,$01,$2E,$11,$04,$00,$00,$00,$00
        .byte $16,$28,$64,$0F,$0E,$09,$01,$00,$01,$22,$11,$04,$00,$00,$00,$00
        .byte $0F,$20,$60,$0F,$0E,$09,$01,$00,$01,$19,$12,$04,$00,$00,$00,$00
        .byte $12,$2B,$5E,$0F,$0E,$09,$01,$00,$01,$1E,$11,$04,$00,$00,$00,$00
        .byte $0D,$25,$5E,$0F,$0D,$08,$01,$00,$01,$2A,$11,$04,$00,$00,$00,$00
        .byte $1A,$32,$6A,$0F,$0E,$09,$01,$00,$01,$1E,$11,$04,$00,$00,$00,$00
        .byte $15,$3C,$68,$0E,$0D,$0A,$01,$00,$01,$13,$11,$04,$00,$00,$00,$00
        .byte $11,$49,$68,$0E,$0D,$0A,$01,$00,$01,$13,$11,$04,$00,$00,$00,$00
        .byte $14,$38,$45,$0F,$0E,$0C,$01,$00,$01,$2A,$11,$04,$00,$00,$00,$00
        .byte $1D,$32,$66,$0F,$0E,$09,$01,$00,$01,$26,$11,$04,$00,$00,$00,$00
        .byte $10,$55,$6E,$0E,$0D,$0C,$01,$00,$01,$22,$12,$04,$00,$00,$00,$00
        .byte $1D,$32,$66,$0F,$0E,$09,$01,$00,$01,$26,$11,$04,$00,$00,$00,$00
        .byte $11,$25,$62,$0F,$0E,$09,$01,$00,$01,$22,$12,$04,$00,$00,$00,$00
        .byte $17,$25,$66,$0F,$0E,$09,$01,$00,$01,$22,$11,$04,$00,$00,$00,$00
        .byte $10,$51,$6C,$0E,$0D,$0C,$01,$00,$01,$22,$12,$04,$00,$00,$00,$00
        .byte $0A,$25,$5C,$00,$00,$00,$01,$00,$01,$19,$01,$00,$00,$00,$00,$00
        .byte $15,$3E,$68,$00,$00,$00,$01,$0A,$08,$04,$01,$02,$00,$00,$00,$00
        .byte $15,$3E,$68,$0A,$09,$08,$02,$00,$01,$11,$01,$01,$00,$00,$00,$00
        .byte $0A,$25,$5C,$09,$00,$00,$01,$00,$01,$15,$01,$00,$00,$00,$00,$00
        .byte $15,$3E,$68,$09,$00,$00,$01,$07,$08,$04,$01,$02,$00,$00,$00,$00
        .byte $0C,$47,$6C,$00,$00,$00,$01,$00,$01,$17,$01,$00,$00,$00,$00,$00
        .byte $15,$3E,$68,$00,$00,$00,$01,$0C,$01,$04,$01,$02,$00,$00,$00,$00
        .byte $15,$3E,$68,$0A,$0A,$09,$02,$00,$01,$11,$01,$01,$00,$00,$00,$00
        .byte $0C,$47,$6C,$09,$00,$00,$01,$00,$01,$13,$01,$00,$00,$00,$00,$00
        .byte $15,$3E,$68,$09,$00,$00,$01,$09,$01,$04,$01,$02,$00,$00,$00,$00
        .byte $0C,$4F,$64,$00,$00,$00,$01,$00,$01,$19,$01,$00,$00,$00,$00,$00
        .byte $15,$3E,$68,$00,$00,$00,$01,$0C,$03,$06,$01,$02,$00,$00,$00,$00
        .byte $15,$3E,$68,$0A,$0A,$09,$02,$00,$01,$13,$01,$01,$00,$00,$00,$00
        .byte $0C,$4F,$64,$09,$00,$00,$01,$00,$01,$15,$01,$00,$00,$00,$00,$00
        .byte $15,$3E,$68,$09,$00,$00,$01,$09,$03,$05,$01,$02,$00,$00,$00,$00
        .byte $15,$3E,$68,$00,$00,$00,$01,$08,$01,$26,$01,$02,$00,$00,$00,$00
        .byte $0C,$2E,$60,$0B,$04,$02,$01,$06,$01,$19,$11,$00,$00,$00,$00,$00
        .byte $15,$3E,$68,$00,$00,$00,$01,$07,$01,$22,$01,$02,$00,$00,$00,$00
        .byte $0C,$3E,$68,$0B,$04,$02,$01,$05,$01,$13,$11,$00,$00,$00,$00,$00
        .byte $15,$3E,$68,$00,$00,$00,$01,$0C,$01,$2A,$01,$02,$00,$00,$00,$00
        .byte $0C,$43,$68,$0B,$03,$02,$01,$0A,$01,$20,$11,$00,$00,$00,$00,$00
        .byte $11,$4B,$68,$00,$0B,$0A,$02,$0A,$03,$2A,$00,$00,$00,$00,$00,$00
        .byte $0C,$4B,$68,$0B,$05,$03,$01,$09,$03,$1E,$11,$00,$00,$00,$00,$00
        .byte $15,$3E,$68,$0C,$0B,$0A,$02,$00,$01,$17,$00,$01,$00,$00,$00,$00
        .byte $0C,$4B,$68,$00,$00,$00,$01,$00,$01,$15,$01,$00,$00,$00,$00,$00
        .byte $15,$3E,$68,$00,$00,$00,$01,$0B,$01,$03,$01,$02,$00,$00,$00,$00
        .byte $11,$4B,$68,$00,$0B,$0A,$02,$0A,$03,$19,$00,$00,$00,$00,$00,$00
        .byte $0C,$4B,$68,$09,$00,$00,$01,$00,$01,$11,$01,$00,$00,$00,$00,$00
        .byte $15,$3E,$68,$09,$00,$00,$01,$08,$01,$03,$01,$02,$00,$00,$00,$00
        .byte $0C,$4B,$68,$0A,$05,$03,$01,$09,$03,$15,$00,$00,$00,$00,$00,$00
        .byte $0B,$2A,$5C,$0D,$06,$04,$01,$00,$01,$19,$10,$00,$00,$00,$00,$00
        .byte $0B,$45,$6C,$0D,$07,$05,$01,$00,$01,$17,$10,$00,$00,$00,$00,$00
        .byte $0B,$57,$70,$0D,$06,$04,$01,$00,$01,$19,$10,$00,$00,$00,$00,$00
        .byte $0F,$2A,$70,$0E,$09,$06,$01,$00,$01,$17,$11,$00,$00,$00,$00,$00
        .byte $11,$30,$3E,$0E,$0A,$08,$01,$00,$01,$17,$11,$00,$00,$00,$00,$00
        .byte $0C,$1D,$5C,$0E,$08,$04,$01,$00,$01,$15,$11,$00,$00,$00,$00,$00
        .byte $0C,$5C,$79,$0E,$0A,$08,$01,$00,$01,$13,$11,$00,$00,$00,$00,$00
        .byte $15,$3E,$68,$00,$00,$00,$01,$00,$01,$4C,$11,$02,$00,$00,$00,$00
        .byte $15,$3E,$68,$00,$00,$00,$01,$00,$01,$87,$11,$02,$00,$00,$00,$00
        .byte $15,$3E,$68,$00,$00,$00,$01,$00,$01,$87,$11,$02,$00,$00,$00,$00
        .byte $15,$3E,$68,$00,$00,$00,$01,$00,$01,$87,$11,$02,$00,$00,$00,$00
TEMPL_COUNT = 63
RL_0:
        .byte $20,$01,$02,$20,$03,$0C,$2F,$FF   ; |[A]|=AX NS
        .byte $20,$01,$52,$45,$02,$20,$03,$06,$27,$2F,$FF   ; |[ARE]|=AA R NS
        .byte $20,$01,$53,$02,$20,$03,$05,$1D,$2F,$FF   ; |[AS]|=AE Z NS
        .byte $20,$01,$54,$02,$20,$03,$05,$14,$2F,$FF   ; |[AT]|=AE T NS
        .byte $20,$01,$4E,$02,$20,$03,$05,$24,$2F,$FF   ; |[AN]|=AE N NS
        .byte $20,$01,$4E,$44,$02,$20,$03,$05,$24,$15,$2F,$FF   ; |[AND]|=AE N D NS
        .byte $20,$01,$4E,$59,$02,$20,$03,$84,$24,$01,$FF   ; |[ANY]|=EH1 N IY
        .byte $20,$01,$47,$41,$49,$4E,$02,$20,$03,$0C,$17,$84,$24,$FF   ; |[AGAIN]|=AX G EH1 N
        .byte $20,$01,$4C,$57,$41,$59,$53,$02,$20,$03,$87,$26,$28,$03,$1D,$FF   ; |[ALWAYS]|=AO1 L W EY Z
        .byte $20,$01,$4C,$53,$4F,$02,$20,$03,$87,$26,$1C,$08,$FF   ; |[ALSO]|=AO1 L S OW
        .byte $20,$01,$42,$4F,$55,$54,$02,$20,$03,$0C,$13,$90,$14,$FF   ; |[ABOUT]|=AX B AW1 T
        .byte $20,$01,$46,$54,$45,$52,$02,$20,$03,$85,$18,$14,$0E,$FF   ; |[AFTER]|=AE1 F T ER
        .byte $20,$01,$02,$42,$4F,$55,$03,$0C,$FF   ; |[A]BOU=AX
        .byte $20,$01,$02,$47,$4F,$03,$0C,$FF   ; |[A]GO=AX
        .byte $20,$01,$02,$47,$41,$49,$4E,$03,$0C,$FF   ; |[A]GAIN=AX
        .byte $20,$01,$02,$57,$41,$59,$03,$0C,$FF   ; |[A]WAY=AX
        .byte $20,$01,$02,$4C,$4F,$4E,$45,$03,$0C,$FF   ; |[A]LONE=AX
        .byte $20,$01,$02,$4C,$4F,$4E,$47,$03,$0C,$FF   ; |[A]LONG=AX
        .byte $20,$01,$02,$4D,$4F,$4E,$47,$03,$0C,$FF   ; |[A]MONG=AX
        .byte $20,$01,$02,$52,$4F,$55,$4E,$44,$03,$0C,$FF   ; |[A]ROUND=AX
        .byte $20,$01,$02,$4C,$49,$56,$45,$03,$0C,$FF   ; |[A]LIVE=AX
        .byte $20,$01,$02,$48,$45,$41,$44,$03,$0C,$FF   ; |[A]HEAD=AX
        .byte $01,$49,$52,$02,$03,$04,$27,$FF   ; [AIR]=EH R
        .byte $01,$49,$02,$03,$03,$FF   ; [AI]=EY
        .byte $01,$59,$02,$03,$03,$FF   ; [AY]=EY
        .byte $01,$55,$47,$48,$02,$03,$07,$FF   ; [AUGH]=AO
        .byte $01,$55,$02,$03,$07,$FF   ; [AU]=AO
        .byte $01,$57,$02,$03,$07,$FF   ; [AW]=AO
        .byte $01,$52,$02,$45,$20,$03,$04,$27,$FF   ; [AR]E|=EH R
        .byte $01,$02,$52,$52,$03,$05,$FF   ; [A]RR=AE
        .byte $57,$01,$52,$02,$03,$07,$27,$FF   ; W[AR]=AO R
        .byte $01,$52,$02,$81,$03,$04,$27,$FF   ; [AR]#=EH R
        .byte $01,$52,$02,$03,$06,$27,$FF   ; [AR]=AA R
        .byte $01,$4C,$4B,$02,$03,$07,$16,$FF   ; [ALK]=AO K
        .byte $01,$4C,$4C,$02,$03,$07,$26,$FF   ; [ALL]=AO L
        .byte $01,$4C,$02,$54,$03,$07,$26,$FF   ; [AL]T=AO L
        .byte $01,$4C,$02,$44,$03,$07,$26,$FF   ; [AL]D=AO L
        .byte $01,$4C,$4D,$02,$03,$06,$23,$FF   ; [ALM]=AA M
        .byte $20,$01,$4C,$02,$4D,$03,$07,$26,$FF   ; |[AL]M=AO L
        .byte $83,$81,$01,$4C,$02,$20,$03,$0C,$26,$FF   ; #:[AL]|=AX L
        .byte $01,$02,$4E,$47,$45,$03,$03,$FF   ; [A]NGE=EY
        .byte $01,$02,$53,$54,$45,$03,$03,$FF   ; [A]STE=EY
        .byte $01,$02,$54,$49,$4F,$4E,$03,$03,$FF   ; [A]TION=EY
        .byte $01,$02,$42,$4C,$45,$20,$03,$03,$FF   ; [A]BLE|=EY
        .byte $01,$02,$42,$4C,$45,$53,$20,$03,$03,$FF   ; [A]BLES|=EY
        .byte $01,$02,$82,$86,$03,$03,$FF   ; [A].@=EY
        .byte $01,$02,$82,$59,$20,$03,$03,$FF   ; [A].Y|=EY
        .byte $55,$51,$01,$02,$4C,$03,$06,$FF   ; QU[A]L=AA
        .byte $55,$51,$01,$02,$4E,$03,$06,$FF   ; QU[A]N=AA
        .byte $57,$01,$02,$53,$03,$06,$FF   ; W[A]S=AA
        .byte $57,$01,$02,$54,$03,$06,$FF   ; W[A]T=AA
        .byte $57,$01,$02,$4E,$54,$03,$06,$FF   ; W[A]NT=AA
        .byte $57,$01,$02,$4E,$44,$03,$06,$FF   ; W[A]ND=AA
        .byte $83,$81,$01,$02,$20,$03,$0C,$FF   ; #:[A]|=AX
        .byte $01,$02,$03,$05,$FF   ; [A]=AE
        .byte $00
RL_1:
        .byte $20,$01,$45,$02,$20,$03,$13,$01,$2F,$FF   ; |[BE]|=B IY NS
        .byte $20,$01,$59,$02,$20,$03,$13,$0F,$2F,$FF   ; |[BY]|=B AY NS
        .byte $20,$01,$55,$54,$02,$20,$03,$13,$0B,$14,$2F,$FF   ; |[BUT]|=B AH T NS
        .byte $20,$01,$45,$45,$4E,$02,$20,$03,$13,$02,$24,$2F,$FF   ; |[BEEN]|=B IH N NS
        .byte $20,$01,$45,$43,$41,$55,$53,$45,$02,$20,$03,$13,$0D,$16,$87,$1D,$FF   ; |[BECAUSE]|=B IX K AO1 Z
        .byte $20,$01,$55,$53,$59,$02,$20,$03,$13,$82,$1D,$01,$FF   ; |[BUSY]|=B IH1 Z IY
        .byte $20,$01,$55,$53,$49,$4E,$45,$53,$53,$02,$20,$03,$13,$82,$1D,$24,$0D,$1C,$FF   ; |[BUSINESS]|=B IH1 Z N IX S
        .byte $20,$01,$55,$49,$4C,$44,$02,$03,$13,$02,$26,$15,$FF   ; |[BUILD]=B IH L D
        .byte $20,$01,$59,$45,$02,$20,$03,$13,$0F,$FF   ; |[BYE]|=B AY
        .byte $20,$01,$45,$47,$49,$4E,$02,$03,$13,$0D,$17,$82,$24,$FF   ; |[BEGIN]=B IX G IH1 N
        .byte $20,$01,$45,$02,$43,$03,$13,$0D,$FF   ; |[BE]C=B IX
        .byte $20,$01,$45,$02,$46,$03,$13,$0D,$FF   ; |[BE]F=B IX
        .byte $20,$01,$45,$02,$47,$03,$13,$0D,$FF   ; |[BE]G=B IX
        .byte $20,$01,$45,$02,$48,$03,$13,$0D,$FF   ; |[BE]H=B IX
        .byte $20,$01,$45,$02,$4C,$81,$03,$13,$0D,$FF   ; |[BE]L#=B IX
        .byte $20,$01,$45,$02,$54,$57,$03,$13,$0D,$FF   ; |[BE]TW=B IX
        .byte $20,$01,$45,$02,$59,$03,$13,$0D,$FF   ; |[BE]Y=B IX
        .byte $20,$01,$45,$02,$53,$49,$44,$45,$03,$13,$0D,$FF   ; |[BE]SIDE=B IX
        .byte $4D,$01,$02,$20,$03,$FF   ; M[B]|=
        .byte $55,$4F,$01,$02,$54,$03,$FF   ; OU[B]T=
        .byte $45,$01,$02,$54,$03,$FF   ; E[B]T=
        .byte $01,$42,$02,$03,$13,$FF   ; [BB]=B
        .byte $01,$02,$03,$13,$FF   ; [B]=B
        .byte $00
RL_2:
        .byte $53,$01,$48,$02,$03,$16,$FF   ; S[CH]=K
        .byte $01,$48,$02,$52,$03,$16,$FF   ; [CH]R=K
        .byte $01,$48,$02,$49,$4E,$45,$03,$1E,$FF   ; [CH]INE=SH
        .byte $01,$48,$02,$03,$21,$FF   ; [CH]=CH
        .byte $01,$49,$02,$41,$03,$1E,$FF   ; [CI]A=SH
        .byte $01,$49,$02,$4F,$03,$1E,$FF   ; [CI]O=SH
        .byte $01,$49,$02,$45,$4E,$03,$1E,$FF   ; [CI]EN=SH
        .byte $53,$01,$02,$84,$03,$FF   ; S[C]+=
        .byte $01,$02,$84,$03,$1C,$FF   ; [C]+=S
        .byte $01,$4B,$02,$03,$16,$FF   ; [CK]=K
        .byte $01,$43,$02,$84,$03,$16,$1C,$FF   ; [CC]+=K S
        .byte $01,$43,$02,$03,$16,$FF   ; [CC]=K
        .byte $01,$02,$03,$16,$FF   ; [C]=K
        .byte $00
RL_3:
        .byte $20,$01,$4F,$02,$20,$03,$15,$0A,$2F,$FF   ; |[DO]|=D UW NS
        .byte $20,$01,$4F,$45,$53,$02,$20,$03,$15,$0B,$1D,$FF   ; |[DOES]|=D AH Z
        .byte $20,$01,$4F,$4E,$45,$02,$20,$03,$15,$0B,$24,$FF   ; |[DONE]|=D AH N
        .byte $20,$01,$4F,$49,$4E,$47,$02,$20,$03,$15,$8A,$02,$25,$FF   ; |[DOING]|=D UW1 IH NG
        .byte $01,$47,$02,$03,$22,$FF   ; [DG]=JH
        .byte $01,$44,$02,$03,$15,$FF   ; [DD]=D
        .byte $01,$02,$03,$15,$FF   ; [D]=D
        .byte $00
RL_4:
        .byte $20,$01,$59,$45,$02,$20,$03,$0F,$FF   ; |[EYE]|=AY
        .byte $20,$01,$56,$45,$52,$59,$02,$03,$84,$19,$27,$01,$FF   ; |[EVERY]=EH1 V R IY
        .byte $20,$01,$56,$45,$4E,$02,$20,$03,$81,$19,$0C,$24,$FF   ; |[EVEN]|=IY1 V AX N
        .byte $83,$20,$01,$02,$20,$03,$01,$FF   ; |:[E]|=IY
        .byte $83,$20,$01,$02,$44,$20,$03,$04,$FF   ; |:[E]D|=EH
        .byte $54,$01,$44,$02,$20,$03,$0D,$15,$FF   ; T[ED]|=IX D
        .byte $44,$01,$44,$02,$20,$03,$0D,$15,$FF   ; D[ED]|=IX D
        .byte $85,$01,$44,$02,$20,$03,$14,$FF   ; %[ED]|=T
        .byte $83,$81,$01,$44,$02,$20,$03,$15,$FF   ; #:[ED]|=D
        .byte $48,$43,$01,$02,$53,$20,$03,$0D,$FF   ; CH[E]S|=IX
        .byte $48,$53,$01,$02,$53,$20,$03,$0D,$FF   ; SH[E]S|=IX
        .byte $53,$01,$02,$53,$20,$03,$0D,$FF   ; S[E]S|=IX
        .byte $58,$01,$02,$53,$20,$03,$0D,$FF   ; X[E]S|=IX
        .byte $5A,$01,$02,$53,$20,$03,$0D,$FF   ; Z[E]S|=IX
        .byte $43,$01,$02,$53,$20,$03,$0D,$FF   ; C[E]S|=IX
        .byte $47,$01,$02,$53,$20,$03,$0D,$FF   ; G[E]S|=IX
        .byte $83,$81,$01,$02,$53,$20,$03,$FF   ; #:[E]S|=
        .byte $83,$81,$01,$02,$20,$03,$FF   ; #:[E]|=
        .byte $83,$81,$01,$02,$4C,$59,$20,$03,$FF   ; #:[E]LY|=
        .byte $83,$81,$01,$02,$4D,$45,$4E,$54,$03,$FF   ; #:[E]MENT=
        .byte $83,$81,$01,$02,$46,$55,$4C,$03,$FF   ; #:[E]FUL=
        .byte $83,$81,$01,$02,$4E,$45,$53,$53,$03,$FF   ; #:[E]NESS=
        .byte $83,$81,$01,$02,$4E,$43,$45,$20,$03,$0C,$FF   ; #:[E]NCE|=AX
        .byte $83,$81,$01,$02,$4E,$54,$20,$03,$0C,$FF   ; #:[E]NT|=AX
        .byte $83,$81,$01,$02,$53,$53,$20,$03,$0D,$FF   ; #:[E]SS|=IX
        .byte $83,$81,$01,$4E,$02,$20,$03,$0C,$24,$FF   ; #:[EN]|=AX N
        .byte $83,$81,$01,$4C,$02,$20,$03,$0C,$26,$FF   ; #:[EL]|=AX L
        .byte $01,$49,$47,$48,$02,$03,$03,$FF   ; [EIGH]=EY
        .byte $01,$45,$02,$03,$01,$FF   ; [EE]=IY
        .byte $01,$41,$52,$02,$4E,$03,$0E,$FF   ; [EAR]N=ER
        .byte $01,$41,$52,$02,$4C,$03,$0E,$FF   ; [EAR]L=ER
        .byte $01,$41,$52,$02,$54,$48,$03,$0E,$FF   ; [EAR]TH=ER
        .byte $01,$41,$52,$02,$44,$03,$0E,$FF   ; [EAR]D=ER
        .byte $01,$41,$52,$02,$43,$48,$03,$0E,$FF   ; [EAR]CH=ER
        .byte $01,$41,$02,$52,$20,$03,$01,$FF   ; [EA]R|=IY
        .byte $52,$01,$41,$02,$44,$49,$03,$01,$FF   ; R[EA]DI=IY
        .byte $01,$41,$02,$44,$03,$04,$FF   ; [EA]D=EH
        .byte $01,$41,$02,$54,$48,$03,$04,$FF   ; [EA]TH=EH
        .byte $01,$41,$02,$4C,$54,$48,$03,$04,$FF   ; [EA]LTH=EH
        .byte $01,$41,$02,$03,$01,$FF   ; [EA]=IY
        .byte $01,$49,$02,$03,$01,$FF   ; [EI]=IY
        .byte $01,$59,$02,$20,$03,$01,$FF   ; [EY]|=IY
        .byte $01,$59,$02,$03,$03,$FF   ; [EY]=EY
        .byte $01,$57,$02,$03,$0A,$FF   ; [EW]=UW
        .byte $01,$02,$52,$45,$20,$03,$01,$FF   ; [E]RE|=IY
        .byte $83,$20,$01,$02,$52,$59,$03,$04,$FF   ; |:[E]RY=EH
        .byte $01,$52,$02,$20,$03,$0E,$FF   ; [ER]|=ER
        .byte $01,$52,$02,$81,$03,$04,$27,$FF   ; [ER]#=EH R
        .byte $01,$52,$02,$03,$0E,$FF   ; [ER]=ER
        .byte $01,$02,$03,$04,$FF   ; [E]=EH
        .byte $00
RL_5:
        .byte $20,$01,$4F,$52,$02,$20,$03,$18,$07,$27,$2F,$FF   ; |[FOR]|=F AO R NS
        .byte $20,$01,$52,$4F,$4D,$02,$20,$03,$18,$27,$0B,$23,$2F,$FF   ; |[FROM]|=F R AH M NS
        .byte $20,$01,$52,$49,$45,$4E,$44,$02,$03,$18,$27,$04,$24,$15,$FF   ; |[FRIEND]=F R EH N D
        .byte $83,$81,$01,$55,$4C,$02,$03,$18,$0C,$26,$FF   ; #:[FUL]=F AX L
        .byte $01,$46,$02,$03,$18,$FF   ; [FF]=F
        .byte $01,$02,$03,$18,$FF   ; [F]=F
        .byte $00
RL_6:
        .byte $20,$01,$49,$56,$45,$02,$20,$03,$17,$02,$19,$FF   ; |[GIVE]|=G IH V
        .byte $20,$01,$49,$02,$56,$03,$17,$02,$FF   ; |[GI]V=G IH
        .byte $20,$01,$45,$54,$02,$03,$17,$04,$14,$FF   ; |[GET]=G EH T
        .byte $20,$01,$4F,$4E,$45,$02,$20,$03,$17,$07,$24,$FF   ; |[GONE]|=G AO N
        .byte $20,$01,$02,$45,$4E,$03,$22,$FF   ; |[G]EN=JH
        .byte $20,$01,$02,$45,$4D,$03,$22,$FF   ; |[G]EM=JH
        .byte $20,$01,$02,$45,$52,$4D,$03,$22,$FF   ; |[G]ERM=JH
        .byte $20,$01,$48,$02,$03,$17,$FF   ; |[GH]=G
        .byte $01,$48,$02,$03,$18,$FF   ; [GH]=F
        .byte $01,$47,$02,$03,$17,$FF   ; [GG]=G
        .byte $20,$01,$02,$4E,$03,$FF   ; |[G]N=
        .byte $01,$02,$4E,$20,$03,$FF   ; [G]N|=
        .byte $01,$02,$45,$20,$03,$22,$FF   ; [G]E|=JH
        .byte $01,$02,$45,$53,$20,$03,$22,$FF   ; [G]ES|=JH
        .byte $01,$02,$45,$44,$20,$03,$22,$FF   ; [G]ED|=JH
        .byte $01,$02,$59,$03,$22,$FF   ; [G]Y=JH
        .byte $4E,$01,$02,$45,$03,$22,$FF   ; N[G]E=JH
        .byte $81,$01,$02,$49,$03,$22,$FF   ; #[G]I=JH
        .byte $01,$02,$03,$17,$FF   ; [G]=G
        .byte $00
RL_7:
        .byte $20,$01,$41,$56,$45,$02,$20,$03,$20,$05,$19,$2F,$FF   ; |[HAVE]|=HH AE V NS
        .byte $20,$01,$41,$53,$02,$20,$03,$20,$05,$1D,$2F,$FF   ; |[HAS]|=HH AE Z NS
        .byte $20,$01,$41,$44,$02,$20,$03,$20,$05,$15,$2F,$FF   ; |[HAD]|=HH AE D NS
        .byte $20,$01,$45,$02,$20,$03,$20,$01,$2F,$FF   ; |[HE]|=HH IY NS
        .byte $20,$01,$45,$52,$02,$20,$03,$20,$0E,$2F,$FF   ; |[HER]|=HH ER NS
        .byte $20,$01,$49,$53,$02,$20,$03,$20,$02,$1D,$2F,$FF   ; |[HIS]|=HH IH Z NS
        .byte $20,$01,$49,$4D,$02,$20,$03,$20,$02,$23,$2F,$FF   ; |[HIM]|=HH IH M NS
        .byte $20,$01,$4F,$55,$52,$02,$03,$10,$0E,$FF   ; |[HOUR]=AW ER
        .byte $01,$02,$81,$03,$20,$FF   ; [H]#=HH
        .byte $01,$02,$03,$FF   ; [H]=
        .byte $00
RL_8:
        .byte $20,$01,$02,$20,$03,$8F,$FF   ; |[I]|=AY1
        .byte $20,$01,$53,$02,$20,$03,$02,$1D,$2F,$FF   ; |[IS]|=IH Z NS
        .byte $20,$01,$4E,$02,$20,$03,$02,$24,$2F,$FF   ; |[IN]|=IH N NS
        .byte $20,$01,$54,$02,$20,$03,$02,$14,$2F,$FF   ; |[IT]|=IH T NS
        .byte $20,$01,$46,$02,$20,$03,$02,$18,$2F,$FF   ; |[IF]|=IH F NS
        .byte $20,$01,$4E,$54,$4F,$02,$20,$03,$82,$24,$14,$0A,$FF   ; |[INTO]|=IH1 N T UW
        .byte $01,$47,$48,$02,$03,$0F,$FF   ; [IGH]=AY
        .byte $83,$20,$01,$45,$02,$20,$03,$0F,$FF   ; |:[IE]|=AY
        .byte $83,$20,$01,$45,$02,$53,$20,$03,$0F,$1D,$FF   ; |:[IE]S|=AY Z
        .byte $83,$20,$01,$45,$02,$44,$20,$03,$0F,$15,$FF   ; |:[IE]D|=AY D
        .byte $01,$45,$02,$53,$20,$03,$01,$1D,$FF   ; [IE]S|=IY Z
        .byte $01,$45,$02,$44,$20,$03,$01,$15,$FF   ; [IE]D|=IY D
        .byte $01,$45,$02,$03,$01,$FF   ; [IE]=IY
        .byte $48,$43,$01,$02,$4E,$45,$03,$01,$FF   ; CH[I]NE=IY
        .byte $01,$02,$4E,$44,$20,$03,$0F,$FF   ; [I]ND|=AY
        .byte $01,$02,$4E,$44,$53,$20,$03,$0F,$FF   ; [I]NDS|=AY
        .byte $01,$02,$4C,$44,$03,$0F,$FF   ; [I]LD=AY
        .byte $01,$02,$47,$4E,$03,$0F,$FF   ; [I]GN=AY
        .byte $01,$52,$02,$45,$03,$0F,$27,$FF   ; [IR]E=AY R
        .byte $01,$52,$02,$03,$0E,$FF   ; [IR]=ER
        .byte $83,$81,$01,$02,$56,$45,$20,$03,$02,$FF   ; #:[I]VE|=IH
        .byte $83,$81,$01,$02,$43,$45,$20,$03,$02,$FF   ; #:[I]CE|=IH
        .byte $01,$02,$82,$86,$03,$0F,$FF   ; [I].@=AY
        .byte $01,$02,$41,$03,$01,$FF   ; [I]A=IY
        .byte $01,$02,$4F,$55,$53,$03,$01,$FF   ; [I]OUS=IY
        .byte $01,$02,$4F,$03,$01,$FF   ; [I]O=IY
        .byte $01,$02,$03,$02,$FF   ; [I]=IH
        .byte $00
RL_9:
        .byte $01,$02,$03,$22,$FF   ; [J]=JH
        .byte $00
RL_10:
        .byte $20,$01,$02,$4E,$03,$FF   ; |[K]N=
        .byte $01,$02,$03,$16,$FF   ; [K]=K
        .byte $00
RL_11:
        .byte $01,$4C,$02,$03,$26,$FF   ; [LL]=L
        .byte $82,$01,$45,$02,$20,$03,$0C,$26,$FF   ; .[LE]|=AX L
        .byte $82,$01,$45,$02,$53,$20,$03,$0C,$26,$FF   ; .[LE]S|=AX L
        .byte $82,$01,$45,$02,$44,$20,$03,$0C,$26,$FF   ; .[LE]D|=AX L
        .byte $01,$02,$03,$26,$FF   ; [L]=L
        .byte $00
RL_12:
        .byte $20,$01,$41,$4E,$59,$02,$20,$03,$23,$84,$24,$01,$FF   ; |[MANY]|=M EH1 N IY
        .byte $01,$4D,$02,$03,$23,$FF   ; [MM]=M
        .byte $01,$02,$03,$23,$FF   ; [M]=M
        .byte $00
RL_13:
        .byte $20,$01,$4F,$02,$20,$03,$24,$08,$FF   ; |[NO]|=N OW
        .byte $20,$01,$4F,$54,$02,$20,$03,$24,$06,$14,$FF   ; |[NOT]|=N AA T
        .byte $41,$01,$02,$47,$45,$03,$24,$FF   ; A[N]GE=N
        .byte $45,$01,$02,$47,$45,$03,$24,$FF   ; E[N]GE=N
        .byte $01,$47,$02,$4C,$03,$25,$17,$FF   ; [NG]L=NG G
        .byte $01,$47,$02,$03,$25,$FF   ; [NG]=NG
        .byte $01,$02,$4B,$03,$25,$FF   ; [N]K=NG
        .byte $01,$4E,$02,$03,$24,$FF   ; [NN]=N
        .byte $01,$02,$03,$24,$FF   ; [N]=N
        .byte $00
RL_14:
        .byte $20,$01,$46,$02,$20,$03,$0C,$19,$2F,$FF   ; |[OF]|=AX V NS
        .byte $20,$01,$4E,$02,$20,$03,$06,$24,$2F,$FF   ; |[ON]|=AA N NS
        .byte $20,$01,$52,$02,$20,$03,$07,$27,$2F,$FF   ; |[OR]|=AO R NS
        .byte $20,$01,$4E,$45,$02,$20,$03,$28,$0B,$24,$FF   ; |[ONE]|=W AH N
        .byte $20,$01,$4E,$45,$53,$02,$20,$03,$28,$0B,$24,$1D,$FF   ; |[ONES]|=W AH N Z
        .byte $20,$01,$4E,$43,$45,$02,$20,$03,$28,$0B,$24,$1C,$FF   ; |[ONCE]|=W AH N S
        .byte $20,$01,$4E,$4C,$59,$02,$20,$03,$88,$24,$26,$01,$FF   ; |[ONLY]|=OW1 N L IY
        .byte $20,$01,$55,$52,$02,$20,$03,$10,$0E,$FF   ; |[OUR]|=AW ER
        .byte $20,$01,$48,$02,$20,$03,$08,$FF   ; |[OH]|=OW
        .byte $20,$01,$54,$48,$45,$52,$02,$03,$8B,$1B,$0E,$FF   ; |[OTHER]=AH1 DH ER
        .byte $43,$20,$01,$02,$4D,$45,$03,$0B,$FF   ; |C[O]ME=AH
        .byte $43,$20,$01,$02,$4D,$49,$4E,$47,$03,$0B,$FF   ; |C[O]MING=AH
        .byte $43,$20,$01,$02,$4D,$82,$03,$0C,$FF   ; |C[O]M.=AX
        .byte $43,$20,$01,$02,$4E,$82,$03,$0C,$FF   ; |C[O]N.=AX
        .byte $01,$55,$47,$48,$54,$02,$03,$07,$14,$FF   ; [OUGHT]=AO T
        .byte $01,$55,$47,$48,$02,$03,$0B,$18,$FF   ; [OUGH]=AH F
        .byte $01,$55,$4C,$02,$44,$03,$09,$FF   ; [OUL]D=UH
        .byte $01,$55,$52,$02,$03,$07,$27,$FF   ; [OUR]=AO R
        .byte $83,$81,$01,$55,$53,$02,$20,$03,$0C,$1C,$FF   ; #:[OUS]|=AX S
        .byte $01,$55,$02,$50,$03,$0A,$FF   ; [OU]P=UW
        .byte $01,$55,$02,$03,$10,$FF   ; [OU]=AW
        .byte $01,$4F,$02,$4B,$03,$09,$FF   ; [OO]K=UH
        .byte $47,$01,$4F,$02,$44,$03,$09,$FF   ; G[OO]D=UH
        .byte $57,$01,$4F,$02,$44,$03,$09,$FF   ; W[OO]D=UH
        .byte $54,$01,$4F,$02,$44,$03,$09,$FF   ; T[OO]D=UH
        .byte $46,$01,$4F,$02,$54,$03,$09,$FF   ; F[OO]T=UH
        .byte $01,$4F,$02,$52,$03,$07,$27,$FF   ; [OO]R=AO R
        .byte $01,$4F,$02,$03,$0A,$FF   ; [OO]=UW
        .byte $01,$41,$02,$03,$08,$FF   ; [OA]=OW
        .byte $01,$02,$49,$4E,$47,$03,$08,$FF   ; [O]ING=OW
        .byte $01,$49,$02,$03,$11,$FF   ; [OI]=OY
        .byte $01,$59,$02,$03,$11,$FF   ; [OY]=OY
        .byte $48,$20,$01,$57,$02,$20,$03,$10,$FF   ; |H[OW]|=AW
        .byte $4E,$20,$01,$57,$02,$20,$03,$10,$FF   ; |N[OW]|=AW
        .byte $43,$20,$01,$57,$02,$20,$03,$10,$FF   ; |C[OW]|=AW
        .byte $57,$20,$01,$57,$02,$20,$03,$10,$FF   ; |W[OW]|=AW
        .byte $83,$81,$01,$57,$02,$20,$03,$08,$FF   ; #:[OW]|=OW
        .byte $01,$57,$02,$20,$03,$08,$FF   ; [OW]|=OW
        .byte $20,$01,$57,$4E,$02,$03,$08,$24,$FF   ; |[OWN]=OW N
        .byte $4E,$4B,$01,$57,$4E,$02,$03,$08,$24,$FF   ; KN[OWN]=OW N
        .byte $48,$53,$01,$57,$4E,$02,$03,$08,$24,$FF   ; SH[OWN]=OW N
        .byte $52,$47,$01,$57,$4E,$02,$03,$08,$24,$FF   ; GR[OWN]=OW N
        .byte $4C,$42,$01,$57,$4E,$02,$03,$08,$24,$FF   ; BL[OWN]=OW N
        .byte $52,$48,$54,$01,$57,$4E,$02,$03,$08,$24,$FF   ; THR[OWN]=OW N
        .byte $4C,$46,$01,$57,$4E,$02,$03,$08,$24,$FF   ; FL[OWN]=OW N
        .byte $01,$57,$02,$4E,$03,$10,$FF   ; [OW]N=AW
        .byte $01,$57,$02,$45,$52,$03,$10,$FF   ; [OW]ER=AW
        .byte $01,$57,$02,$45,$4C,$03,$10,$FF   ; [OW]EL=AW
        .byte $20,$01,$57,$4C,$02,$03,$10,$26,$FF   ; |[OWL]=AW L
        .byte $01,$57,$02,$03,$08,$FF   ; [OW]=OW
        .byte $01,$02,$4C,$44,$03,$08,$FF   ; [O]LD=OW
        .byte $01,$02,$4C,$54,$03,$08,$FF   ; [O]LT=OW
        .byte $4D,$01,$02,$53,$54,$03,$08,$FF   ; M[O]ST=OW
        .byte $50,$01,$02,$53,$54,$03,$08,$FF   ; P[O]ST=OW
        .byte $48,$01,$02,$53,$54,$03,$08,$FF   ; H[O]ST=OW
        .byte $57,$20,$01,$52,$02,$82,$03,$0E,$FF   ; |W[OR].=ER
        .byte $83,$81,$01,$52,$02,$20,$03,$0E,$FF   ; #:[OR]|=ER
        .byte $01,$52,$02,$03,$07,$27,$FF   ; [OR]=AO R
        .byte $4C,$01,$02,$56,$45,$03,$0B,$FF   ; L[O]VE=AH
        .byte $42,$01,$02,$56,$45,$03,$0B,$FF   ; B[O]VE=AH
        .byte $4D,$01,$02,$56,$45,$03,$0A,$FF   ; M[O]VE=UW
        .byte $52,$50,$01,$02,$56,$45,$03,$0A,$FF   ; PR[O]VE=UW
        .byte $53,$20,$01,$02,$4D,$45,$03,$0B,$FF   ; |S[O]ME=AH
        .byte $83,$81,$01,$4E,$02,$20,$03,$0C,$24,$FF   ; #:[ON]|=AX N
        .byte $83,$81,$01,$4D,$02,$20,$03,$0C,$23,$FF   ; #:[OM]|=AX M
        .byte $01,$02,$82,$86,$03,$08,$FF   ; [O].@=OW
        .byte $01,$02,$20,$03,$08,$FF   ; [O]|=OW
        .byte $01,$45,$02,$20,$03,$08,$FF   ; [OE]|=OW
        .byte $01,$02,$03,$06,$FF   ; [O]=AA
        .byte $00
RL_15:
        .byte $20,$01,$45,$4F,$50,$4C,$45,$02,$03,$12,$81,$12,$0C,$26,$FF   ; |[PEOPLE]=P IY1 P AX L
        .byte $01,$48,$02,$03,$18,$FF   ; [PH]=F
        .byte $20,$01,$02,$53,$03,$FF   ; |[P]S=
        .byte $01,$50,$02,$03,$12,$FF   ; [PP]=P
        .byte $01,$02,$03,$12,$FF   ; [P]=P
        .byte $00
RL_16:
        .byte $01,$55,$02,$45,$20,$03,$16,$FF   ; [QU]E|=K
        .byte $01,$55,$02,$03,$16,$28,$FF   ; [QU]=K W
        .byte $01,$02,$03,$16,$FF   ; [Q]=K
        .byte $00
RL_17:
        .byte $01,$52,$02,$03,$27,$FF   ; [RR]=R
        .byte $01,$02,$03,$27,$FF   ; [R]=R
        .byte $00
RL_18:
        .byte $20,$01,$41,$49,$44,$02,$20,$03,$1C,$04,$15,$FF   ; |[SAID]|=S EH D
        .byte $20,$01,$41,$59,$53,$02,$20,$03,$1C,$04,$1D,$FF   ; |[SAYS]|=S EH Z
        .byte $20,$01,$48,$45,$02,$20,$03,$1E,$01,$2F,$FF   ; |[SHE]|=SH IY NS
        .byte $20,$01,$4F,$02,$20,$03,$1C,$08,$FF   ; |[SO]|=S OW
        .byte $20,$01,$55,$52,$45,$02,$03,$1E,$09,$27,$FF   ; |[SURE]=SH UH R
        .byte $01,$48,$02,$03,$1E,$FF   ; [SH]=SH
        .byte $01,$53,$49,$02,$4F,$4E,$03,$1E,$FF   ; [SSI]ON=SH
        .byte $81,$01,$49,$02,$4F,$4E,$03,$1F,$FF   ; #[SI]ON=ZH
        .byte $01,$49,$02,$4F,$4E,$03,$1E,$FF   ; [SI]ON=SH
        .byte $81,$01,$02,$55,$52,$03,$1F,$FF   ; #[S]UR=ZH
        .byte $81,$01,$02,$55,$41,$4C,$03,$1F,$FF   ; #[S]UAL=ZH
        .byte $01,$53,$02,$03,$1C,$FF   ; [SS]=S
        .byte $55,$4F,$01,$02,$45,$03,$1C,$FF   ; OU[S]E=S
        .byte $41,$45,$01,$02,$45,$20,$03,$1D,$FF   ; EA[S]E|=Z
        .byte $41,$83,$20,$01,$02,$45,$20,$03,$1C,$FF   ; |:A[S]E|=S
        .byte $4F,$4F,$01,$02,$45,$03,$1C,$FF   ; OO[S]E=S
        .byte $81,$01,$02,$81,$03,$1D,$FF   ; #[S]#=Z
        .byte $27,$01,$02,$20,$03,$1D,$FF   ; '[S]|=Z
        .byte $45,$4B,$01,$02,$20,$03,$1C,$FF   ; KE[S]|=S
        .byte $45,$50,$01,$02,$20,$03,$1C,$FF   ; PE[S]|=S
        .byte $45,$54,$01,$02,$20,$03,$1C,$FF   ; TE[S]|=S
        .byte $45,$46,$01,$02,$20,$03,$1C,$FF   ; FE[S]|=S
        .byte $45,$01,$02,$20,$03,$1D,$FF   ; E[S]|=Z
        .byte $87,$01,$02,$20,$03,$1D,$FF   ; &[S]|=Z
        .byte $01,$02,$03,$1C,$FF   ; [S]=S
        .byte $00
RL_19:
        .byte $20,$01,$48,$45,$02,$20,$03,$1B,$0C,$2F,$FF   ; |[THE]|=DH AX NS
        .byte $20,$01,$4F,$02,$20,$03,$14,$0A,$2F,$FF   ; |[TO]|=T UW NS
        .byte $20,$01,$48,$41,$54,$02,$20,$03,$1B,$05,$14,$2F,$FF   ; |[THAT]|=DH AE T NS
        .byte $20,$01,$48,$49,$53,$02,$20,$03,$1B,$02,$1C,$FF   ; |[THIS]|=DH IH S
        .byte $20,$01,$48,$41,$4E,$02,$20,$03,$1B,$05,$24,$2F,$FF   ; |[THAN]|=DH AE N NS
        .byte $20,$01,$48,$45,$4E,$02,$20,$03,$1B,$04,$24,$FF   ; |[THEN]|=DH EH N
        .byte $20,$01,$48,$45,$4D,$02,$20,$03,$1B,$04,$23,$2F,$FF   ; |[THEM]|=DH EH M NS
        .byte $20,$01,$48,$45,$59,$02,$20,$03,$1B,$03,$2F,$FF   ; |[THEY]|=DH EY NS
        .byte $20,$01,$48,$45,$52,$45,$02,$20,$03,$1B,$04,$27,$FF   ; |[THERE]|=DH EH R
        .byte $20,$01,$48,$45,$49,$52,$02,$20,$03,$1B,$04,$27,$FF   ; |[THEIR]|=DH EH R
        .byte $20,$01,$48,$45,$53,$45,$02,$20,$03,$1B,$01,$1D,$FF   ; |[THESE]|=DH IY Z
        .byte $20,$01,$48,$4F,$53,$45,$02,$20,$03,$1B,$08,$1D,$FF   ; |[THOSE]|=DH OW Z
        .byte $20,$01,$48,$55,$53,$02,$20,$03,$1B,$0B,$1C,$FF   ; |[THUS]|=DH AH S
        .byte $20,$01,$48,$4F,$55,$47,$48,$02,$20,$03,$1B,$08,$FF   ; |[THOUGH]|=DH OW
        .byte $20,$01,$48,$52,$4F,$55,$47,$48,$02,$20,$03,$1A,$27,$0A,$FF   ; |[THROUGH]|=TH R UW
        .byte $20,$01,$57,$4F,$02,$20,$03,$14,$0A,$FF   ; |[TWO]|=T UW
        .byte $20,$01,$4F,$02,$44,$41,$59,$03,$14,$0C,$FF   ; |[TO]DAY=T AX
        .byte $20,$01,$4F,$02,$47,$45,$54,$48,$45,$52,$03,$14,$0C,$FF   ; |[TO]GETHER=T AX
        .byte $81,$01,$48,$02,$45,$52,$03,$1B,$FF   ; #[TH]ER=DH
        .byte $01,$48,$02,$45,$20,$03,$1B,$FF   ; [TH]E|=DH
        .byte $01,$48,$02,$03,$1A,$FF   ; [TH]=TH
        .byte $01,$49,$02,$4F,$4E,$03,$1E,$FF   ; [TI]ON=SH
        .byte $01,$49,$02,$41,$03,$1E,$FF   ; [TI]A=SH
        .byte $01,$49,$02,$45,$4E,$03,$1E,$FF   ; [TI]EN=SH
        .byte $01,$55,$52,$45,$02,$03,$21,$0E,$FF   ; [TURE]=CH ER
        .byte $01,$55,$02,$41,$03,$21,$0A,$FF   ; [TU]A=CH UW
        .byte $01,$43,$48,$02,$03,$21,$FF   ; [TCH]=CH
        .byte $53,$01,$02,$45,$4E,$20,$03,$FF   ; S[T]EN|=
        .byte $53,$01,$02,$4C,$45,$20,$03,$FF   ; S[T]LE|=
        .byte $01,$54,$02,$03,$14,$FF   ; [TT]=T
        .byte $01,$02,$03,$14,$FF   ; [T]=T
        .byte $00
RL_20:
        .byte $20,$01,$50,$02,$20,$03,$0B,$12,$FF   ; |[UP]|=AH P
        .byte $20,$01,$53,$02,$20,$03,$0B,$1C,$FF   ; |[US]|=AH S
        .byte $20,$01,$02,$4E,$49,$03,$29,$0A,$FF   ; |[U]NI=Y UW
        .byte $20,$01,$4E,$02,$03,$0B,$24,$FF   ; |[UN]=AH N
        .byte $01,$52,$02,$45,$20,$03,$29,$09,$27,$FF   ; [UR]E|=Y UH R
        .byte $01,$52,$02,$81,$03,$09,$27,$FF   ; [UR]#=UH R
        .byte $01,$52,$02,$03,$0E,$FF   ; [UR]=ER
        .byte $20,$01,$02,$82,$86,$03,$29,$0A,$FF   ; |[U].@=Y UW
        .byte $52,$01,$02,$82,$86,$03,$0A,$FF   ; R[U].@=UW
        .byte $4C,$01,$02,$82,$86,$03,$0A,$FF   ; L[U].@=UW
        .byte $4A,$01,$02,$82,$86,$03,$0A,$FF   ; J[U].@=UW
        .byte $54,$01,$02,$82,$86,$03,$0A,$FF   ; T[U].@=UW
        .byte $44,$01,$02,$82,$86,$03,$0A,$FF   ; D[U].@=UW
        .byte $4E,$01,$02,$82,$86,$03,$0A,$FF   ; N[U].@=UW
        .byte $53,$01,$02,$82,$86,$03,$0A,$FF   ; S[U].@=UW
        .byte $01,$02,$82,$86,$03,$29,$0A,$FF   ; [U].@=Y UW
        .byte $4D,$01,$02,$53,$49,$43,$03,$29,$0A,$FF   ; M[U]SIC=Y UW
        .byte $01,$49,$02,$03,$0A,$FF   ; [UI]=UW
        .byte $01,$45,$02,$20,$03,$0A,$FF   ; [UE]|=UW
        .byte $42,$01,$02,$4C,$4C,$03,$09,$FF   ; B[U]LL=UH
        .byte $50,$01,$02,$4C,$4C,$03,$09,$FF   ; P[U]LL=UH
        .byte $46,$01,$02,$4C,$4C,$03,$09,$FF   ; F[U]LL=UH
        .byte $50,$01,$02,$53,$48,$03,$09,$FF   ; P[U]SH=UH
        .byte $42,$01,$02,$53,$48,$03,$09,$FF   ; B[U]SH=UH
        .byte $50,$01,$02,$54,$20,$03,$09,$FF   ; P[U]T|=UH
        .byte $01,$59,$02,$03,$0F,$FF   ; [UY]=AY
        .byte $01,$02,$03,$0B,$FF   ; [U]=AH
        .byte $00
RL_21:
        .byte $01,$02,$03,$19,$FF   ; [V]=V
        .byte $00
RL_22:
        .byte $20,$01,$41,$53,$02,$20,$03,$28,$06,$1D,$2F,$FF   ; |[WAS]|=W AA Z NS
        .byte $20,$01,$45,$02,$20,$03,$28,$01,$2F,$FF   ; |[WE]|=W IY NS
        .byte $20,$01,$45,$52,$45,$02,$20,$03,$28,$0E,$2F,$FF   ; |[WERE]|=W ER NS
        .byte $20,$01,$48,$45,$52,$45,$02,$20,$03,$28,$04,$27,$FF   ; |[WHERE]|=W EH R
        .byte $20,$01,$49,$54,$48,$02,$20,$03,$28,$02,$1B,$2F,$FF   ; |[WITH]|=W IH DH NS
        .byte $20,$01,$48,$4F,$02,$03,$20,$0A,$FF   ; |[WHO]=HH UW
        .byte $20,$01,$48,$02,$4F,$4C,$45,$03,$20,$FF   ; |[WH]OLE=HH
        .byte $20,$01,$4F,$4D,$41,$4E,$02,$20,$03,$28,$89,$23,$0C,$24,$FF   ; |[WOMAN]|=W UH1 M AX N
        .byte $20,$01,$4F,$4D,$45,$4E,$02,$20,$03,$28,$82,$23,$0D,$24,$FF   ; |[WOMEN]|=W IH1 M IX N
        .byte $20,$01,$41,$54,$45,$52,$02,$20,$03,$28,$87,$14,$0E,$FF   ; |[WATER]|=W AO1 T ER
        .byte $20,$01,$52,$02,$03,$27,$FF   ; |[WR]=R
        .byte $01,$48,$02,$03,$28,$FF   ; [WH]=W
        .byte $01,$02,$03,$28,$FF   ; [W]=W
        .byte $00
RL_23:
        .byte $20,$01,$02,$03,$1D,$FF   ; |[X]=Z
        .byte $01,$02,$03,$16,$1C,$FF   ; [X]=K S
        .byte $00
RL_24:
        .byte $20,$01,$4F,$55,$02,$20,$03,$29,$0A,$FF   ; |[YOU]|=Y UW
        .byte $20,$01,$4F,$55,$52,$02,$20,$03,$29,$07,$27,$FF   ; |[YOUR]|=Y AO R
        .byte $20,$01,$4F,$55,$4E,$47,$02,$03,$29,$0B,$25,$FF   ; |[YOUNG]=Y AH NG
        .byte $20,$01,$45,$53,$02,$20,$03,$29,$04,$1C,$FF   ; |[YES]|=Y EH S
        .byte $83,$20,$01,$02,$20,$03,$0F,$FF   ; |:[Y]|=AY
        .byte $20,$01,$02,$03,$29,$FF   ; |[Y]=Y
        .byte $01,$02,$82,$86,$03,$0F,$FF   ; [Y].@=AY
        .byte $83,$81,$01,$02,$20,$03,$01,$FF   ; #:[Y]|=IY
        .byte $01,$02,$03,$02,$FF   ; [Y]=IH
        .byte $00
RL_25:
        .byte $01,$5A,$02,$03,$1D,$FF   ; [ZZ]=Z
        .byte $01,$02,$03,$1D,$FF   ; [Z]=Z
        .byte $00
RL_26:
        .byte $01,$02,$03,$FF   ; [']=
        .byte $00
RIDXL:
        .byte <RL_0,<RL_1,<RL_2,<RL_3,<RL_4,<RL_5,<RL_6,<RL_7,<RL_8,<RL_9,<RL_10,<RL_11,<RL_12,<RL_13,<RL_14,<RL_15,<RL_16,<RL_17,<RL_18,<RL_19,<RL_20,<RL_21,<RL_22,<RL_23,<RL_24,<RL_25,<RL_26
RIDXH:
        .byte >RL_0,>RL_1,>RL_2,>RL_3,>RL_4,>RL_5,>RL_6,>RL_7,>RL_8,>RL_9,>RL_10,>RL_11,>RL_12,>RL_13,>RL_14,>RL_15,>RL_16,>RL_17,>RL_18,>RL_19,>RL_20,>RL_21,>RL_22,>RL_23,>RL_24,>RL_25,>RL_26
SUFTAB:
        .byte $45,$20,$00
        .byte $45,$53,$20,$00
        .byte $45,$44,$20,$00
        .byte $45,$52,$20,$00
        .byte $45,$52,$53,$20,$00
        .byte $45,$4E,$20,$00
        .byte $45,$4C,$59,$00
        .byte $45,$4D,$45,$4E,$54,$00
        .byte $45,$46,$55,$4C,$00
        .byte $45,$4E,$45,$53,$53,$00
        .byte $49,$4E,$47,$00
        .byte $41,$42,$4C,$45,$00
        .byte $FF
CCLASS:
        .byte $00,$00,$00,$00,$00,$00,$00,$20,$00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$21,$32,$2A,$32,$25,$2A,$32,$2A,$25,$22,$2A,$32,$32,$32,$21
        .byte $2A,$22,$32,$2A,$2A,$21,$32,$32,$2A,$35,$22,$00,$00,$00,$00,$00
DIGL:
        .byte <DIG_0,<DIG_1,<DIG_2,<DIG_3,<DIG_4,<DIG_5,<DIG_6,<DIG_7,<DIG_8,<DIG_9
DIGH:
        .byte >DIG_0,>DIG_1,>DIG_2,>DIG_3,>DIG_4,>DIG_5,>DIG_6,>DIG_7,>DIG_8,>DIG_9
DIG_0: .byte $5A,$45,$52,$4F,$00
DIG_1: .byte $4F,$4E,$45,$00
DIG_2: .byte $54,$57,$4F,$00
DIG_3: .byte $54,$48,$52,$45,$45,$00
DIG_4: .byte $46,$4F,$55,$52,$00
DIG_5: .byte $46,$49,$56,$45,$00
DIG_6: .byte $53,$49,$58,$00
DIG_7: .byte $53,$45,$56,$45,$4E,$00
DIG_8: .byte $45,$49,$47,$48,$54,$00
DIG_9: .byte $4E,$49,$4E,$45,$00
; AY volume pairs approximating index/252*1.2 (two channels summed)
DACA:
        .byte $00,$00,$01,$01,$01,$02,$02,$01,$03,$02,$02,$04,$03,$03,$04,$03
        .byte $04,$05,$04,$04,$05,$05,$04,$06,$05,$05,$06,$06,$06,$06,$06,$06
        .byte $05,$05,$06,$06,$06,$07,$07,$07,$06,$07,$07,$07,$07,$08,$07,$06
        .byte $08,$08,$07,$08,$08,$08,$08,$07,$08,$08,$08,$08,$07,$07,$08,$08
        .byte $08,$08,$08,$08,$08,$08,$08,$08,$09,$09,$09,$09,$09,$09,$09,$09
        .byte $09,$09,$09,$09,$09,$09,$09,$09,$09,$09,$09,$09,$09,$09,$09,$09
        .byte $09,$09,$09,$09,$09,$09,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A
        .byte $0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A,$0A
        .byte $0A,$0A,$0A,$0A,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B
        .byte $0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B
        .byte $0B,$0B,$0B,$0B,$0B,$0B,$0B,$0B,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C
        .byte $0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C
        .byte $0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C
        .byte $0C,$0C,$0C,$0C,$0C,$0C,$0C,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D
        .byte $0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D
        .byte $0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D,$0D
DACB:
        .byte $00,$00,$00,$00,$00,$00,$00,$01,$00,$01,$02,$00,$02,$02,$01,$03
        .byte $02,$00,$03,$03,$01,$02,$04,$00,$03,$03,$01,$01,$02,$02,$03,$03
        .byte $05,$05,$04,$04,$04,$00,$00,$00,$05,$01,$01,$01,$02,$00,$03,$06
        .byte $01,$01,$04,$02,$03,$03,$03,$05,$04,$04,$04,$04,$06,$06,$05,$05
        .byte $05,$05,$06,$06,$06,$06,$06,$06,$00,$00,$00,$00,$01,$01,$01,$02
        .byte $02,$03,$03,$03,$04,$04,$04,$04,$05,$05,$05,$05,$05,$05,$06,$06
        .byte $06,$06,$06,$06,$06,$06,$00,$00,$00,$00,$00,$01,$01,$01,$02,$02
        .byte $03,$03,$03,$04,$04,$04,$04,$05,$05,$05,$05,$05,$05,$05,$06,$06
        .byte $06,$06,$06,$06,$00,$00,$00,$00,$00,$01,$01,$02,$02,$03,$03,$03
        .byte $04,$04,$04,$04,$05,$05,$05,$05,$05,$05,$05,$06,$06,$06,$06,$06
        .byte $06,$06,$06,$06,$06,$06,$06,$06,$00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$01,$01,$02,$02,$03,$03,$03,$04,$04,$04,$04,$04
        .byte $05,$05,$05,$05,$05,$05,$06,$06,$06,$06,$06,$06,$06,$06,$06,$06
        .byte $06,$06,$06,$06,$06,$06,$06,$00,$00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$01,$01,$01,$02,$02,$03,$03,$03,$04
        .byte $04,$04,$04,$05,$05,$05,$05,$05,$05,$06,$06,$06,$06,$06,$06,$06
; formant level pages: page k = 42 + 42*10^(-(15-k)*3/20)*sin(2*pi*n/256); page 0 = constant 42
        .res <(0-*)
LEVELS:
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C
        .byte $2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C
        .byte $2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C
        .byte $2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28
        .byte $28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28
        .byte $28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28
        .byte $28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2C,$2C,$2C,$2C,$2C,$2C,$2C
        .byte $2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C
        .byte $2C,$2C,$2C,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D
        .byte $2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2C,$2C
        .byte $2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C
        .byte $2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$28,$28,$28,$28,$28,$28,$28
        .byte $28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28
        .byte $28,$28,$28,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27
        .byte $27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$28,$28
        .byte $28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28
        .byte $28,$28,$28,$28,$28,$28,$28,$28,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$2A,$2A,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
        .byte $2B,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2D,$2D
        .byte $2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D
        .byte $2D,$2D,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E
        .byte $2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2D
        .byte $2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D
        .byte $2D,$2D,$2D,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C
        .byte $2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2A,$2A,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29
        .byte $29,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$27,$27
        .byte $27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27
        .byte $27,$27,$26,$26,$26,$26,$26,$26,$26,$26,$26,$26,$26,$26,$26,$26
        .byte $26,$26,$26,$26,$26,$26,$26,$26,$26,$26,$26,$26,$26,$26,$26,$27
        .byte $27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27,$27
        .byte $27,$27,$27,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28,$28
        .byte $29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$29,$2A,$2A,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2C,$2C,$2C,$2C
        .byte $2C,$2C,$2C,$2C,$2C,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2E,$2E
        .byte $2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2F,$2F,$2F,$2F,$2F,$2F
        .byte $2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F
        .byte $2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F
        .byte $2F,$2F,$2F,$2F,$2F,$2F,$2F,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2E
        .byte $2E,$2E,$2E,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2C,$2C,$2C,$2C
        .byte $2C,$2C,$2C,$2C,$2C,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2A,$29,$29,$29,$29,$29,$29,$29,$29,$28,$28,$28,$28
        .byte $28,$28,$28,$28,$28,$27,$27,$27,$27,$27,$27,$27,$27,$27,$26,$26
        .byte $26,$26,$26,$26,$26,$26,$26,$26,$26,$26,$25,$25,$25,$25,$25,$25
        .byte $25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25
        .byte $25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25
        .byte $25,$25,$25,$25,$25,$25,$25,$26,$26,$26,$26,$26,$26,$26,$26,$26
        .byte $26,$26,$26,$27,$27,$27,$27,$27,$27,$27,$27,$27,$28,$28,$28,$28
        .byte $28,$28,$28,$28,$28,$29,$29,$29,$29,$29,$29,$29,$29,$2A,$2A,$2A
        .byte $2A,$2A,$2A,$2B,$2B,$2B,$2B,$2B,$2B,$2C,$2C,$2C,$2C,$2C,$2D,$2D
        .byte $2D,$2D,$2D,$2D,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2F,$2F,$2F,$2F,$2F
        .byte $2F,$2F,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$31,$31,$31,$31
        .byte $31,$31,$31,$31,$31,$31,$31,$31,$31,$31,$31,$31,$31,$31,$31,$31
        .byte $31,$31,$31,$31,$31,$31,$31,$31,$31,$31,$31,$31,$31,$31,$31,$31
        .byte $31,$31,$31,$31,$31,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$2F
        .byte $2F,$2F,$2F,$2F,$2F,$2F,$2E,$2E,$2E,$2E,$2E,$2E,$2E,$2D,$2D,$2D
        .byte $2D,$2D,$2D,$2C,$2C,$2C,$2C,$2C,$2B,$2B,$2B,$2B,$2B,$2B,$2A,$2A
        .byte $2A,$2A,$2A,$29,$29,$29,$29,$29,$29,$28,$28,$28,$28,$28,$27,$27
        .byte $27,$27,$27,$27,$26,$26,$26,$26,$26,$26,$26,$25,$25,$25,$25,$25
        .byte $25,$25,$24,$24,$24,$24,$24,$24,$24,$24,$24,$24,$23,$23,$23,$23
        .byte $23,$23,$23,$23,$23,$23,$23,$23,$23,$23,$23,$23,$23,$23,$23,$23
        .byte $23,$23,$23,$23,$23,$23,$23,$23,$23,$23,$23,$23,$23,$23,$23,$23
        .byte $23,$23,$23,$23,$23,$24,$24,$24,$24,$24,$24,$24,$24,$24,$24,$25
        .byte $25,$25,$25,$25,$25,$25,$26,$26,$26,$26,$26,$26,$26,$27,$27,$27
        .byte $27,$27,$27,$28,$28,$28,$28,$28,$29,$29,$29,$29,$29,$29,$2A,$2A
        .byte $2A,$2A,$2B,$2B,$2B,$2B,$2C,$2C,$2C,$2C,$2D,$2D,$2D,$2D,$2E,$2E
        .byte $2E,$2E,$2F,$2F,$2F,$2F,$2F,$30,$30,$30,$30,$30,$31,$31,$31,$31
        .byte $31,$32,$32,$32,$32,$32,$32,$33,$33,$33,$33,$33,$33,$33,$34,$34
        .byte $34,$34,$34,$34,$34,$34,$34,$34,$34,$34,$34,$34,$34,$35,$35,$35
        .byte $35,$35,$35,$35,$34,$34,$34,$34,$34,$34,$34,$34,$34,$34,$34,$34
        .byte $34,$34,$34,$33,$33,$33,$33,$33,$33,$33,$32,$32,$32,$32,$32,$32
        .byte $31,$31,$31,$31,$31,$30,$30,$30,$30,$30,$2F,$2F,$2F,$2F,$2F,$2E
        .byte $2E,$2E,$2E,$2D,$2D,$2D,$2D,$2C,$2C,$2C,$2C,$2B,$2B,$2B,$2B,$2A
        .byte $2A,$2A,$29,$29,$29,$29,$28,$28,$28,$28,$27,$27,$27,$27,$26,$26
        .byte $26,$26,$25,$25,$25,$25,$25,$24,$24,$24,$24,$24,$23,$23,$23,$23
        .byte $23,$22,$22,$22,$22,$22,$22,$21,$21,$21,$21,$21,$21,$21,$20,$20
        .byte $20,$20,$20,$20,$20,$20,$20,$20,$20,$20,$20,$20,$20,$1F,$1F,$1F
        .byte $1F,$1F,$1F,$1F,$20,$20,$20,$20,$20,$20,$20,$20,$20,$20,$20,$20
        .byte $20,$20,$20,$21,$21,$21,$21,$21,$21,$21,$22,$22,$22,$22,$22,$22
        .byte $23,$23,$23,$23,$23,$24,$24,$24,$24,$24,$25,$25,$25,$25,$25,$26
        .byte $26,$26,$26,$27,$27,$27,$27,$28,$28,$28,$28,$29,$29,$29,$29,$2A
        .byte $2A,$2A,$2B,$2B,$2B,$2C,$2C,$2D,$2D,$2D,$2E,$2E,$2E,$2F,$2F,$2F
        .byte $30,$30,$30,$31,$31,$31,$32,$32,$32,$33,$33,$33,$33,$34,$34,$34
        .byte $35,$35,$35,$35,$36,$36,$36,$36,$36,$37,$37,$37,$37,$37,$37,$38
        .byte $38,$38,$38,$38,$38,$38,$38,$39,$39,$39,$39,$39,$39,$39,$39,$39
        .byte $39,$39,$39,$39,$39,$39,$39,$39,$39,$39,$38,$38,$38,$38,$38,$38
        .byte $38,$38,$37,$37,$37,$37,$37,$37,$36,$36,$36,$36,$36,$35,$35,$35
        .byte $35,$34,$34,$34,$33,$33,$33,$33,$32,$32,$32,$31,$31,$31,$30,$30
        .byte $30,$2F,$2F,$2F,$2E,$2E,$2E,$2D,$2D,$2D,$2C,$2C,$2B,$2B,$2B,$2A
        .byte $2A,$2A,$29,$29,$29,$28,$28,$27,$27,$27,$26,$26,$26,$25,$25,$25
        .byte $24,$24,$24,$23,$23,$23,$22,$22,$22,$21,$21,$21,$21,$20,$20,$20
        .byte $1F,$1F,$1F,$1F,$1E,$1E,$1E,$1E,$1E,$1D,$1D,$1D,$1D,$1D,$1D,$1C
        .byte $1C,$1C,$1C,$1C,$1C,$1C,$1C,$1B,$1B,$1B,$1B,$1B,$1B,$1B,$1B,$1B
        .byte $1B,$1B,$1B,$1B,$1B,$1B,$1B,$1B,$1B,$1B,$1C,$1C,$1C,$1C,$1C,$1C
        .byte $1C,$1C,$1D,$1D,$1D,$1D,$1D,$1D,$1E,$1E,$1E,$1E,$1E,$1F,$1F,$1F
        .byte $1F,$20,$20,$20,$21,$21,$21,$21,$22,$22,$22,$23,$23,$23,$24,$24
        .byte $24,$25,$25,$25,$26,$26,$26,$27,$27,$27,$28,$28,$29,$29,$29,$2A
        .byte $2A,$2B,$2B,$2C,$2C,$2D,$2D,$2E,$2E,$2F,$2F,$30,$30,$31,$31,$32
        .byte $32,$33,$33,$33,$34,$34,$35,$35,$36,$36,$37,$37,$37,$38,$38,$39
        .byte $39,$39,$3A,$3A,$3A,$3B,$3B,$3B,$3C,$3C,$3C,$3C,$3D,$3D,$3D,$3D
        .byte $3D,$3E,$3E,$3E,$3E,$3E,$3E,$3F,$3F,$3F,$3F,$3F,$3F,$3F,$3F,$3F
        .byte $3F,$3F,$3F,$3F,$3F,$3F,$3F,$3F,$3F,$3F,$3E,$3E,$3E,$3E,$3E,$3E
        .byte $3D,$3D,$3D,$3D,$3D,$3C,$3C,$3C,$3C,$3B,$3B,$3B,$3A,$3A,$3A,$39
        .byte $39,$39,$38,$38,$37,$37,$37,$36,$36,$35,$35,$34,$34,$33,$33,$33
        .byte $32,$32,$31,$31,$30,$30,$2F,$2F,$2E,$2E,$2D,$2D,$2C,$2C,$2B,$2B
        .byte $2A,$29,$29,$28,$28,$27,$27,$26,$26,$25,$25,$24,$24,$23,$23,$22
        .byte $22,$21,$21,$21,$20,$20,$1F,$1F,$1E,$1E,$1D,$1D,$1D,$1C,$1C,$1B
        .byte $1B,$1B,$1A,$1A,$1A,$19,$19,$19,$18,$18,$18,$18,$17,$17,$17,$17
        .byte $17,$16,$16,$16,$16,$16,$16,$15,$15,$15,$15,$15,$15,$15,$15,$15
        .byte $15,$15,$15,$15,$15,$15,$15,$15,$15,$15,$16,$16,$16,$16,$16,$16
        .byte $17,$17,$17,$17,$17,$18,$18,$18,$18,$19,$19,$19,$1A,$1A,$1A,$1B
        .byte $1B,$1B,$1C,$1C,$1D,$1D,$1D,$1E,$1E,$1F,$1F,$20,$20,$21,$21,$21
        .byte $22,$22,$23,$23,$24,$24,$25,$25,$26,$26,$27,$27,$28,$28,$29,$29
        .byte $2A,$2B,$2B,$2C,$2D,$2E,$2E,$2F,$30,$31,$31,$32,$33,$33,$34,$35
        .byte $35,$36,$37,$37,$38,$39,$39,$3A,$3B,$3B,$3C,$3C,$3D,$3D,$3E,$3F
        .byte $3F,$40,$40,$41,$41,$41,$42,$42,$43,$43,$44,$44,$44,$45,$45,$45
        .byte $45,$46,$46,$46,$46,$47,$47,$47,$47,$47,$47,$48,$48,$48,$48,$48
        .byte $48,$48,$48,$48,$48,$48,$47,$47,$47,$47,$47,$47,$46,$46,$46,$46
        .byte $45,$45,$45,$45,$44,$44,$44,$43,$43,$42,$42,$41,$41,$41,$40,$40
        .byte $3F,$3F,$3E,$3D,$3D,$3C,$3C,$3B,$3B,$3A,$39,$39,$38,$37,$37,$36
        .byte $35,$35,$34,$33,$33,$32,$31,$31,$30,$2F,$2E,$2E,$2D,$2C,$2B,$2B
        .byte $2A,$29,$29,$28,$27,$26,$26,$25,$24,$23,$23,$22,$21,$21,$20,$1F
        .byte $1F,$1E,$1D,$1D,$1C,$1B,$1B,$1A,$19,$19,$18,$18,$17,$17,$16,$15
        .byte $15,$14,$14,$13,$13,$13,$12,$12,$11,$11,$10,$10,$10,$0F,$0F,$0F
        .byte $0F,$0E,$0E,$0E,$0E,$0D,$0D,$0D,$0D,$0D,$0D,$0C,$0C,$0C,$0C,$0C
        .byte $0C,$0C,$0C,$0C,$0C,$0C,$0D,$0D,$0D,$0D,$0D,$0D,$0E,$0E,$0E,$0E
        .byte $0F,$0F,$0F,$0F,$10,$10,$10,$11,$11,$12,$12,$13,$13,$13,$14,$14
        .byte $15,$15,$16,$17,$17,$18,$18,$19,$19,$1A,$1B,$1B,$1C,$1D,$1D,$1E
        .byte $1F,$1F,$20,$21,$21,$22,$23,$23,$24,$25,$26,$26,$27,$28,$29,$29
        .byte $2A,$2B,$2C,$2D,$2E,$2F,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39
        .byte $3A,$3B,$3C,$3D,$3E,$3F,$40,$40,$41,$42,$43,$44,$45,$45,$46,$47
        .byte $48,$48,$49,$4A,$4A,$4B,$4C,$4C,$4D,$4D,$4E,$4F,$4F,$50,$50,$50
        .byte $51,$51,$52,$52,$52,$52,$53,$53,$53,$53,$54,$54,$54,$54,$54,$54
        .byte $54,$54,$54,$54,$54,$54,$54,$53,$53,$53,$53,$52,$52,$52,$52,$51
        .byte $51,$50,$50,$50,$4F,$4F,$4E,$4D,$4D,$4C,$4C,$4B,$4A,$4A,$49,$48
        .byte $48,$47,$46,$45,$45,$44,$43,$42,$41,$40,$40,$3F,$3E,$3D,$3C,$3B
        .byte $3A,$39,$38,$37,$36,$35,$34,$33,$32,$31,$30,$2F,$2E,$2D,$2C,$2B
        .byte $2A,$29,$28,$27,$26,$25,$24,$23,$22,$21,$20,$1F,$1E,$1D,$1C,$1B
        .byte $1A,$19,$18,$17,$16,$15,$14,$14,$13,$12,$11,$10,$0F,$0F,$0E,$0D
        .byte $0C,$0C,$0B,$0A,$0A,$09,$08,$08,$07,$07,$06,$05,$05,$04,$04,$04
        .byte $03,$03,$02,$02,$02,$02,$01,$01,$01,$01,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$01,$01,$01,$01,$02,$02,$02,$02,$03
        .byte $03,$04,$04,$04,$05,$05,$06,$07,$07,$08,$08,$09,$0A,$0A,$0B,$0C
        .byte $0C,$0D,$0E,$0F,$0F,$10,$11,$12,$13,$14,$14,$15,$16,$17,$18,$19
        .byte $1A,$1B,$1C,$1D,$1E,$1F,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
; ---- end generated ----
; <<< GENERATED DATA

IMAGE_END:
