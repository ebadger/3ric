; Seven Cities of Gold for 3RIC - SD-card replacement for the game's RWTS.
;
; The game (and its World Maker) carry Ozark's DOS 3.3 style RWTS with a
; fixed IOB: +2 drive, +4 track, +5 sector, +$0C command (0 seek, 1 read,
; 2 write, 4 format), +$0D status. Its buffer is not the IOB's +8/+9: the
; read and write loops address a page through operands patched in place
; (the map layer points writes at its own page, the World Maker load moves
; reads to $5F00), so the shim takes the read page from RD_PAGE and the
; write page from WR_PAGE - the high bytes of the original loops' operands,
; which still live below the shim. Every disk access in play goes through
; the RWTS's PHP/SEI entry, which the converter turns into JMP shim_entry.
; The converter prepends SHIM_ORG, IOB, RD_PAGE and WR_PAGE for each copy.
;
; The two disks are the original 140 KB images on the card (PROGRAM.DSK,
; MAP.DSK), in DOS 3.3 sector order, so track T, logical sector S is byte
; (T*16+S)*256 of the file. The loader proved each file contiguous and
; stored its first SD sector in port_base0/1; a 256-byte sector is half of
; SD sector base + (T*16+S)/2. The ROM's sd_readsector/sd_writesector
; transfer 512 bytes between the card (LBA in $B0-$B3) and ($B8). A write
; is a read-modify-write of that 512-byte sector; a format zeroes MAP.DSK.
; The game is single-drive: port_disk says which disk is "in drive 1".
;
; The game keeps language-card RAM mapped; the ROM routines need ROM
; selected. The mapped state is read from the bank signature at $DFFF
; ($A5 bank 1, $5A bank 2, ROM $00) and restored. ROM zero page $B0-$B9
; is the game's too, so it is saved.

SD_READ     = $E1B9
SD_WRITE    = $E21C
SDBUF       = $C800             ; ROM FAT32 sector buffer (512 bytes)
ZLBA        = $B0
ZBUF        = $B8
BANKSIG     = $DFFF
PORT_BASE   = $CFF0
PORT_DISK   = $CFF8
DSK_SECTORS = 280               ; 512-byte SD sectors per 140 KB image

        .org SHIM_ORG

shim_entry:
        php
        sei
        ldx #9
sh_save:
        lda ZLBA,x
        sta zsave,x
        dex
        bpl sh_save
        ldx #$82                ; ROM, unless a bank signature says otherwise
        lda BANKSIG
        cmp #$A5
        bne sh_not1
        ldx #$8B
        bra sh_mode
sh_not1:
        cmp #$5A
        bne sh_mode
        ldx #$83
sh_mode:
        stx lcmode
        lda $C082               ; ROM reads, LC write-protected
        lda #<SDBUF
        sta ZBUF
        lda #>SDBUF
        sta ZBUF+1
        lda PORT_DISK           ; base LBA of the disk in "drive 1"
        asl a
        asl a
        tax
        lda IOB+$0C
        bne sh_cmd
        jmp sh_ok               ; seek: nothing to do
sh_badj:
        jmp sh_bad
sh_cmd:
        cmp #4
        bne sh_rw
        jmp sh_format
sh_rw:
        cmp #3
        bcs sh_badj
        lda IOB+4               ; track
        cmp #35
        bcs sh_badj
        asl a
        asl a
        asl a                   ; T*8, bit 8 in carry
        sta ZLBA
        lda #0
        rol a
        sta ZLBA+1
        lda IOB+5               ; sector
        cmp #16
        bcs sh_badj
        lsr a                   ; S/2, carry = which half of the SD sector
        lda #>SDBUF
        adc #0
        sta sh_rd+2             ; $C8 or $C9
        sta sh_wr+2
        lda IOB+5
        lsr a
        clc
        adc ZLBA
        sta ZLBA
        lda ZLBA+1
        adc #0
        sta ZLBA+1
        jsr add_base
        jsr SD_READ
        stz ZBUF                ; the RWTS's own buffer page, not the IOB's
        ldy #0
        lda IOB+$0C
        cmp #2
        beq sh_write
        lda RD_PAGE
        sta ZBUF+1
sh_rd:
        lda SDBUF,y             ; high byte patched above
        sta (ZBUF),y
        iny
        bne sh_rd
        bra sh_ok
sh_write:
        lda WR_PAGE
        sta ZBUF+1
sh_wl:
        lda (ZBUF),y
sh_wr:
        sta SDBUF,y             ; high byte patched above
        iny
        bne sh_wl
        lda #<SDBUF
        sta ZBUF
        lda #>SDBUF
        sta ZBUF+1
        jsr SD_WRITE
        bra sh_ok

sh_format:                      ; the blank disk the World Maker asked for: zero
        lda #1                  ; the whole map image (DOS formats all tracks)
        sta PORT_DISK
        ldx #4
        ldy #0
        tya
sh_fz:
        sta SDBUF,y
        sta SDBUF+256,y
        iny
        bne sh_fz
        stz ZLBA
        stz ZLBA+1
        jsr add_base
        lda #<DSK_SECTORS
        sta fcount
        lda #>DSK_SECTORS
        sta fcount+1
sh_floop:
        jsr SD_WRITE
        inc ZLBA
        bne sh_fnext
        inc ZLBA+1
        bne sh_fnext
        inc ZLBA+2
        bne sh_fnext
        inc ZLBA+3
sh_fnext:
        lda fcount
        bne sh_fdec
        dec fcount+1
sh_fdec:
        dec fcount
        lda fcount
        ora fcount+1
        bne sh_floop

sh_ok:
        lda #0
        bra sh_done
sh_bad:
        lda #$40                ; DOS RWTS "drive error"
sh_done:
        sta IOB+$0D
        ldx lcmode
        lda $C000,x
        lda $C000,x             ; second read re-enables LC writes
        ldx #9
sh_rest:
        lda zsave,x
        sta ZLBA,x
        dex
        bpl sh_rest
        lda IOB+$0D
        plp
        cmp #1                  ; carry set on error
        rts

; ZLBA (16-bit sector index within the image, upper bytes ignored) +=
; base LBA of the disk whose offset (0 or 4) is in X; result 32-bit.
add_base:
        clc
        lda ZLBA
        adc PORT_BASE,x
        sta ZLBA
        lda ZLBA+1
        adc PORT_BASE+1,x
        sta ZLBA+1
        lda PORT_BASE+2,x
        adc #0
        sta ZLBA+2
        lda PORT_BASE+3,x
        adc #0
        sta ZLBA+3
        rts

lcmode:     .byte 0
fcount:     .word 0
zsave:      .res 10
shim_end:
