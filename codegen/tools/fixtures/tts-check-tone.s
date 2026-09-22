; TOOLING-ONLY NON-SPEECH FIXTURE. NOT A TTS IMPLEMENTATION OR PUBLIC ENTRY.
; This deliberately uses the system speaker, NOT the required AY speech source.
; Passing the checker cannot prove intelligibility or AY-only compliance.
; Constants are changed by the checker's negative tests, never by entrant scripts.
SILENT = 0
MUTATE = 0
BAD_INVALID = 0
BAD_CANCEL = 0
IGNORE_ESCAPE = 0
HANG = 0
WAIT = 0
FAST = 0
LEAK = 0
HIDE_ROM = 0
CLOBBER_CALLER = 0

        .org $0800
        jmp UI
UI:     bra UI

TTS_INIT:
        lda #0
        rts

TTS_SPEAK:
        sta $e0
        stx $e1
        lda #MUTATE
        beq scanStart
        ldy #0
        lda #'!'
        sta ($e0),y
scanStart:
        ldy #0
        sty $e2
scan:   lda ($e0),y
        beq scanned
        cpy #120
        bcs invalid
        cmp #32
        beq next
        inc $e2
next:   iny
        bra scan
invalid:
        lda #BAD_INVALID
        beq invalidCorrect
        lda #0
        rts
invalidCorrect:
        lda #2
        rts
scanned:
        lda $e2
        bne sound
        lda #0
        rts
sound:
        lda #HANG
        beq waitCheck
spin:   bra spin
waitCheck:
        lda #WAIT
        beq fastCheck
        sei
waitForever:
        wai
        bra waitForever
fastCheck:
        lda #FAST
        beq startTone
        lda #0
        rts
startTone:
        lda #0
        sta $e3
        lda #4
        sta $e4
tone:
        lda #IGNORE_ESCAPE
        bne noEscape
        lda $c000
        cmp #$9b
        beq cancelled
noEscape:
        lda #SILENT
        bne noToggle
        bit $c030
noToggle:
        ldx #32
delay:  dex
        bne delay
        lda $e3
        bne lowCount
        dec $e4
lowCount:
        dec $e3
        lda $e3
        ora $e4
        bne tone
        lda #LEAK
        beq romCheck
        jsr leakTone
romCheck:
        lda #HIDE_ROM
        beq complete
        bit $c080
complete:
        lda #CLOBBER_CALLER
        beq returnSuccess
        sta $031f
returnSuccess:
        lda #0
        rts
cancelled:
        bit $c010
        lda #BAD_CANCEL
        beq cancelCorrect
        lda #0
        rts
cancelCorrect:
        lda #1
        rts

; Deliberately leak a continuous AY tone for the post-return silence negative test.
leakTone:
        lda #$ff
        sta $c403
        lda #7
        sta $c402
        lda #4
        sta $c400
        ldy #0
        ldx #100
        jsr writeAY
        ldy #1
        ldx #0
        jsr writeAY
        ldy #7
        ldx #$3e
        jsr writeAY
        ldy #8
        ldx #15
writeAY:
        sty $c401
        lda #7
        sta $c400
        lda #4
        sta $c400
        stx $c401
        lda #6
        sta $c400
        lda #4
        sta $c400
        rts

TTS_INPUT:
        .res 122
