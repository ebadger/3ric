; Alternate Reality for 3RIC - SD-card sector core shared by both games'
; RWTS replacements (city.s, dungeon.s). The converter appends this to a
; game front end and defines XORV (the game's on-disk data mask: $00 for
; The City, $87 for The Dungeon, whose RWTS stores every byte XOR $87).
;
; Each disk side is its original 140 KB image on the card, in DOS 3.3
; sector order: track T, logical sector S is byte (T*16+S)*256 of the file,
; i.e. half of the 512-byte card sector base + (T*16+S)/2. The loader proved
; every image contiguous and filled the port state in RAM2 (resident.s):
; per image its volume number and first card sector, and which image is
; "in" each drive. Both games name the disk they want by its volume number
; (they verify it, and ask for a disk swap when it is wrong), so a request
; with a volume selects that image and leaves it in the drive; volume 0
; uses the image already there. No swap prompt is ever needed.
;
; The ROM's sd_readsector/sd_writesector move 512 bytes between the card
; (LBA in $B0-$B3) and ($B8); they need the ROM mapped, and both games keep
; language-card RAM mapped. The last card sector read stays in SDBUF
; ($C800, RAM2, always visible) and is reused: the games read the two
; halves of a card sector one after the other. Game buffers may be in
; language-card RAM, so the copy happens with the game's mapping restored.
;
; In:  c_cmd (0 seek, 1 read, 2 write, 3+ format), c_drv (1 or 2), c_vol,
;      c_trk, c_sec, c_buf. Out: A = 0 ok, 1 no image with that volume,
;      2 track/sector out of range; c_found = volume of the image used.

SD_READ     = $E1B9
SD_WRITE    = $E21C
SDBUF       = $C800             ; ROM FAT32 sector buffer (512 bytes)
ZLBA        = $B0
ZBUF        = $B8
PORT_VOL    = $CFE0
PORT_CUR    = $CFE5
PORT_BASE   = $CFE8
NMI_PAGE    = $CF               ; high byte of the resident's NMI entry

core:
        ldx #9                  ; ROM zero page is the game's too
co_save:
        lda ZLBA,x
        sta zsave,x
        dex
        bpl co_save
        ldx c_drv               ; drive 2 -> 1, anything else -> 0
        cpx #2
        beq co_d2
        ldx #0
        bra co_drv
co_d2:
        ldx #1
co_drv:
        lda c_vol
        beq co_cur
        ldy #4
co_find:
        cmp PORT_VOL,y
        beq co_got
        dey
        bpl co_find
        lda #1                  ; no such disk
        jmp co_exit
co_got:
        tya
        sta PORT_CUR,x
co_cur:
        lda PORT_CUR,x
        tay
        lda PORT_VOL,y
        sta c_found
        tya
        asl a
        asl a
        sta c_base              ; offset of the image's base in PORT_BASE
        lda c_cmd
        beq co_okj              ; seek
        cmp #3
        bcc co_rw
co_okj:
        jmp co_ok               ; seek, or format: the image is always "formatted"
co_rw:
        lda c_trk
        cmp #35
        bcs co_range
        asl a
        asl a
        asl a                   ; T*8 (bit 8 in carry)
        sta lba
        lda #0
        rol a
        sta lba+1
        lda c_sec
        cmp #16
        bcs co_range
        lsr a                   ; S/2, carry = which half of the card sector
        lda #>SDBUF
        adc #0
        sta co_rd+2
        sta co_wr+2
        lda c_sec
        lsr a
        clc
        adc lba
        sta lba
        bcc co_nc
        inc lba+1
co_nc:
        ldx c_base              ; lba += image base (32-bit)
        clc
        lda lba
        adc PORT_BASE,x
        sta lba
        lda lba+1
        adc PORT_BASE+1,x
        sta lba+1
        lda PORT_BASE+2,x
        adc #0
        sta lba+2
        lda PORT_BASE+3,x
        adc #0
        sta lba+3
        ldx #3                  ; card sector already in SDBUF?
co_same:
        lda lba,x
        cmp cached,x
        bne co_load
        dex
        bpl co_same
        bra co_have
co_range:
        lda #2
        jmp co_exit
co_load:
        ldx #3
co_set:
        lda lba,x
        sta ZLBA,x
        lda #$FF                ; invalid until the read completes
        sta cached,x
        dex
        bpl co_set
        lda #<SD_READ
        ldx #>SD_READ
        jsr romcall
        ldx #3
co_mark:
        lda lba,x
        sta cached,x
        dex
        bpl co_mark
co_have:
        lda c_buf
        sta co_rdst+1
        sta co_wrsrc+1
        lda c_buf+1
        sta co_rdst+2
        sta co_wrsrc+2
        ldy #0
        lda c_cmd
        cmp #2
        beq co_write
co_rd:
        lda SDBUF,y             ; high byte patched: $C8 or $C9
        eor #XORV
co_rdst:
        sta $FFFF,y             ; game buffer, patched
        iny
        bne co_rd
        bra co_ok
co_write:
co_wrsrc:
        lda $FFFF,y             ; game buffer, patched
        eor #XORV
co_wr:
        sta SDBUF,y
        iny
        bne co_write
        ldx #3
co_wset:
        lda lba,x
        sta ZLBA,x
        dex
        bpl co_wset
        lda #<SD_WRITE
        ldx #>SD_WRITE
        jsr romcall
co_ok:
        lda #0
co_exit:
        pha
        ldx #9
co_rest:
        lda zsave,x
        sta ZLBA,x
        dex
        bpl co_rest
        pla
        rts

; Call the ROM routine at X:A with the ROM mapped and SDBUF as its buffer,
; then put back the game's mapping: language-card RAM (read/write bank 2)
; if the RAM vectors are ours, the ROM otherwise.
romcall:
        sta rc_jsr+1
        stx rc_jsr+2
        lda #<SDBUF
        sta ZBUF
        lda #>SDBUF
        sta ZBUF+1
        ldx #$82
        lda $FFFB
        cmp #NMI_PAGE
        bne rc_rom
        ldx #$83
rc_rom:
        stx rc_mode
        lda $C082               ; ROM reads, LC write-protected
rc_jsr:
        jsr $FFFF
        ldx rc_mode
        lda $C000,x
        lda $C000,x             ; second read re-enables LC writes
        rts

c_cmd:      .byte 0
c_drv:      .byte 0
c_vol:      .byte 0
c_trk:      .byte 0
c_sec:      .byte 0
c_buf:      .word 0
c_found:    .byte 0
c_base:     .byte 0
rc_mode:    .byte 0
lba:        .res 4
cached:     .byte $FF,$FF,$FF,$FF
zsave:      .res 10
core_end:
