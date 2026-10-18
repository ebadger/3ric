; Lode Runner for 3RIC - loader stage 2, run at $8C00 (above the game file).
;
; Loads GAME.BIN (the patched 33,024-byte LODE RUNNER file) at $0800 the way
; DOS 3.3's BRUN did, checks it matches this loader, checks that both disk
; folders have their HISCORE file, leaves MASTER as the current folder, gives
; the resident the ROM DOS collector and starts the game's own relocator at
; $2800 with the BASIC overlay off ($9000-$BFFF is game RAM).
;
; The tool defines GAME_SUM (16-bit sum of GAME.BIN) and ROMCSW_LOAD (the
; resident's romcsw variable as it sits in the loaded file).

COUT        = $FDED
COUT1       = $FDF0
MUTE_OUTPUT = $CE09
NMI_NEST    = $CAFE             ; ROM NMI proxy nest count
PTR         = $06               ; free zero page while the ROM DOS prompt runs

        .org $8C00

stage2:
        lda #$A5               ; GAME.BIN starts with JMP ($4C)
        sta $0800
        jsr cmd
        .byte "FLOAD GAME.BIN 0800 0000 80FF",0
        lda $0800
        cmp #$A5
        bne game_ok
        jmp no_game
game_ok:
        stz sum                 ; 16-bit sum of $0800-$88FF
        stz sum+1
        stz PTR
        lda #$08
        sta PTR+1
        ldy #0
sum_loop:
        lda (PTR),y
        clc
        adc sum
        sta sum
        bcc sum_next
        inc sum+1
sum_next:
        iny
        bne sum_loop
        inc PTR+1
        lda PTR+1
        cmp #$89
        bne sum_loop
        lda sum
        cmp #<GAME_SUM
        bne sum_bad
        lda sum+1
        cmp #>GAME_SUM
        beq sum_ok
sum_bad:
        jmp bad_game
sum_ok:

        jsr cmd
        .byte "CD DATA",0
        jsr hiscore
        bcc data_ok
        jmp no_data
data_ok:
        jsr cmd
        .byte "CD ..",0
        jsr cmd
        .byte "CD MASTER",0
        jsr hiscore
        bcc master_ok
        jmp no_master
master_ok:

        lda csw
        sta ROMCSW_LOAD
        lda csw+1
        sta ROMCSW_LOAD+1
        stz NMI_NEST            ; every NMI exit then selects RAM at $9000
        bit $C007               ; BASIC ROM off: $9000-$BFFF is RAM
        sei
        ldx #$FF
        txs
        jmp $2800               ; the game's RELOCATE0, as BRUN entered $0800

no_game:
        ldx #m_game-msgs
        bra fail
bad_game:
        ldx #m_sum-msgs
        bra fail
no_data:
        ldx #m_data-msgs
        bra fail
no_master:
        ldx #m_master-msgs
fail:   lda msgs,x
        beq fail_done
        ora #$80
        jsr COUT1
        inx
        bne fail
fail_done:
        brk

; FLOAD HISCORE; C = 1 unless it carries the "LODE RUNNER" marker.
hiscore:
        stz $8EF4
        jsr cmd
        .byte "FLOAD HISCORE 8E00 0000 00FF",0
        lda $8EF4
        cmp #$CC                ; 'L'
        clc
        beq hs_ok
        sec
hs_ok:  rts

; Send the inline text as a ROM DOS command (Ctrl-D ... CR) through the
; collector with the echo muted.
cmd:
        pla
        sta PTR
        pla
        sta PTR+1
        lda csw
        sta $36
        lda csw+1
        sta $37
        lda MUTE_OUTPUT
        pha
        lda #$80
        sta MUTE_OUTPUT
        lda #$84
        jsr COUT
        ldy #1
cmd_loop:
        lda (PTR),y
        beq cmd_end
        jsr COUT
        iny
        bne cmd_loop
cmd_end:
        tya                     ; return past the text (the command itself
        clc                     ; may use zero page)
        adc PTR
        sta ret
        lda PTR+1
        adc #0
        sta ret+1
        lda #$8D
        jsr COUT
        pla
        sta MUTE_OUTPUT
        lda ret+1
        pha
        lda ret
        pha
        rts

csw:        .word 0
sum:        .word 0
ret:        .word 0
msgs:
m_game:     .byte $8D
            .text "LR: GAME.BIN NOT FOUND"
            .byte $8D,0
m_sum:      .byte $8D
            .text "LR: GAME.BIN DOES NOT MATCH LR.PRG"
            .byte $8D,0
m_data:     .byte $8D
            .text "LR: DATA/HISCORE NOT FOUND"
            .byte $8D,0
m_master:   .byte $8D
            .text "LR: MASTER/HISCORE NOT FOUND"
            .byte $8D,0
stage2_end:
