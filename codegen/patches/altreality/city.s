; Alternate Reality: The City for 3RIC - SD-card replacement for the game's
; RWTS. The converter assembles this with sdcore.s appended (XORV = 0) and
; writes it over the original RWTS entry page on track 0 of side 1, so the
; boot loads it at $0D00.
;
; The crack this port is built on boots a relocated DOS 3.3 RWTS ($0800-
; $0FFF, entry $0D00) and every disk access in the game goes through it: the
; boot loader, the module loader at $1049/$10DB, the title menu ($753F),
; the character disk code and the in-game loader at $8A20 all JSR $1067
; (SEI; JMP $0D00) or JMP $0D00 with A:Y = the IOB at $106B. IOB: +1 slot*16,
; +2 drive, +3 volume (0 = any), +4 track, +5 sector, +6/7 DCT, +8/9 buffer,
; +$0C command (0 seek, 1 read, 2 write, 4 format), +$0D status, +$0E volume
; found, +$0F/$10 last slot/drive. Errors set carry: $20 wrong volume
; (the game then asks for that disk), $40 drive error. The game names the
; side it needs by volume: 2 side 1, 3 side 2, 253 the character disk.

        .org $0D00

rwts:
        sty $48                 ; IOB pointer, as the original leaves it
        sta $49
        ldy #2
        lda ($48),y
        sta c_drv
        iny
        lda ($48),y
        sta c_vol
        iny
        lda ($48),y
        sta c_trk
        iny
        lda ($48),y
        sta c_sec
        ldy #6                  ; DCT and buffer to $3C-$3F, as the original
cr_zp:
        lda ($48),y
        sta $0036,y
        iny
        cpy #$0A
        bne cr_zp
        ldy #8
        lda ($48),y
        sta c_buf
        iny
        lda ($48),y
        sta c_buf+1
        ldy #$0C
        lda ($48),y
        sta c_cmd
        jsr core
        tax
        beq cr_ok
        lda #$20                ; volume mismatch
        dex
        beq cr_err
        lda #$40                ; drive error
cr_err:
        ldy #$0D
        sta ($48),y
        sec
        bra cr_last
cr_ok:
        ldy #$0D
        sta ($48),y
        iny
        lda c_found
        sta ($48),y
        clc
cr_last:
        php
        ldy #1                  ; last slot / drive used
        lda ($48),y
        ldy #$0F
        sta ($48),y
        ldy #2
        lda ($48),y
        ldy #$10
        sta ($48),y
        plp
        rts

