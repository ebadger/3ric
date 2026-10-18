; Ultima V for 3RIC - game-side music interface in RAM2 ($CD80-$CDFF).
;
; With 128K, Ultima V's music driver lives in auxiliary memory and the game
; talks to it through aux zero page $80-$83 (play now, chain, playing,
; volume), mapping it in with STA $C009 and out with STA $C008, guarded by
; "LDA $EC / LSR / BCC" (bit 0 of $EC = music card present). 3RIC has no aux
; bank, so port-ultima5.mjs opens those guards and turns the two stores into
; JSR mus_in / JSR mus_out, which swap the game's own $80-$83 with the
; player's copy at IF80. The tick (music.s) sees the live copy either way.
; Everything here runs in any language-card state and preserves A, X, Y, P.

        .org $CD80

mus_in:
        php
        sei
        pha
        phx
        ldx #3
mi_loop:
        lda $80,x
        sta GSAVE,x
        lda IF80,x
        sta $80,x
        dex
        bpl mi_loop
        stx SWAPPED             ; $FF
        plx
        pla
        plp
        rts

mus_out:
        php
        sei
        pha
        phx
        ldx #3
mo_loop:
        lda $80,x
        sta IF80,x
        lda GSAVE,x
        sta $80,x
        dex
        bpl mo_loop
        stz SWAPPED
        plx
        pla
        plp
        rts

; TEMP.SUBS $15B9: play song X now and chain it to itself (X = 0: stop).
; The 128K original then waits for the driver to start it; the tick starts
; it within one timer period, so this returns at once.
mus_setx:
        stx IF80+1
        stx IF80
        rts

; MAIN.SUBS $EE46 dispatcher: X = $06 pause, $09 resume, $0C stop.
; Must preserve Y; A and X are restored by the dispatcher.
mus_ctl:
        lda #<MUS_CTL_B1
        jmp B1_CALL

glue_end:
