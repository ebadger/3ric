; Seven Cities of Gold for 3RIC - loader final stage, copied to $CA00.
;
; Reads GAME.BIN (92 SD sectors, contiguous, first sector in game_lba)
; into $0800-$BFFF - over the loader itself, hence this separate stage in
; RAM2 ($CA00-$CABF is not used by the ROM) - and enters the game at $4000
; with the ROM selected, as Electronic Arts' boot loader did.

SD_READ     = $E1B9
ZLBA        = $B0
ZBUF        = $B8

        .org $CA00

final:
        ldx #3
fs_lba:
        lda game_lba,x
        sta ZLBA,x
        dex
        bpl fs_lba
        stz ZBUF
        lda #$08
        sta ZBUF+1
fs_loop:
        jsr SD_READ
        inc ZLBA
        bne fs_next
        inc ZLBA+1
        bne fs_next
        inc ZLBA+2
        bne fs_next
        inc ZLBA+3
fs_next:
        inc ZBUF+1
        inc ZBUF+1
        lda ZBUF+1
        cmp #$C0
        bne fs_loop
        jmp $4000

game_lba:   .res 4
final_end:
