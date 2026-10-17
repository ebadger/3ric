; Wizardry I for 3RIC - SD-card block driver for the Pascal BIOS.
;
; Lives in language-card high RAM at $E000 (Wizardry leaves the whole
; language card empty) and is entered from the resident's disk_entry with
; RAM bank 1 read/write. It serves the Apple Pascal 1.1 BIOS DISKREAD and
; DISKWRITE calls for unit 4 (slot 6, drive 1) from WIZ1.VOL, one Pascal
; volume holding the boot disk's system files and the scenario disk.
;
; The loader resolved WIZ1.VOL's FAT32 cluster chain into cltab (one LBA
; per cluster, four bytes each, at CLTAB) and stored the card's cluster size
; in clshift/clmask. Pascal block n is file sector n:
; LBA = cltab[n >> clshift] + (n & clmask). Each block
; is moved by the ROM's sd_readsector/sd_writesector through the resident's
; rom_sd: whole blocks straight to or from the caller's buffer, a final
; partial block through BLKBUF in bank 1.
;
; IORESULT: 0 ok, 8 block outside the volume, 9 not unit 4, 16 write-
; protected. Writes are allowed only to blocks WR_FIRST..WR_END-1 (the
; blocks that came from the scenario disk) and only in whole blocks; the
; boot disk was write-protected, and WIZBOOT checks that its block-0 write
; returns 16.
;
; Zero page: only the ROM routines' $B0-$B3 (LBA) and $B8/$B9 (buffer),
; saved and restored around each call.

BLKBUF      = $D000             ; bank 1: one block for partial reads
BIOS_OP     = $03AC             ; Pascal BIOS: 1 read, 2 write
ROM_SDREAD  = $E1B9             ; ROM sd_readsector
ROM_SDWRITE = $E21C             ; ROM sd_writesector

        .org $E000

; Stack on entry: return to the resident, saved mode, the BIOS caller's
; return address, then block, count, buffer, drive and flags (words).
shim_disk:
        tsx
        lda $0106,x
        sta blk
        lda $0107,x
        sta blk+1
        lda $0108,x
        sta cnt
        lda $0109,x
        sta cnt+1
        lda $010A,x
        sta buf
        lda $010B,x
        sta buf+1
        lda #9                  ; drive word: only 0 (slot 6 drive 1) exists
        ldy $010C,x
        bne sd_done
        ldy $010D,x
        bne sd_done
        ldx #5                  ; the ROM routines' zero page
sv_zp:
        lda $B0,x
        sta zsave,x
        lda $B8,x
        sta zsave+6,x
        dex
        bpl sv_zp
        lda BIOS_OP
        cmp #2
        beq sd_op_write
        jsr do_read
        bra sd_restore
sd_op_write:
        jsr do_write
sd_restore:
        ldx #5
rs_zp:
        ldy zsave,x
        sty $B0,x
        ldy zsave+6,x
        sty $B8,x
        dex
        bpl rs_zp
sd_done:
        sta DISK_ERR
        rts

; ---------------------------------------------------------------------------

do_read:
dr_loop:
        lda cnt
        ora cnt+1
        beq io_ok
        jsr set_lba
        bcs io_range
        lda cnt+1               ; a whole block left?
        cmp #2
        bcc dr_part
        lda buf
        ldy buf+1
        jsr sd_read
        inc buf+1
        inc buf+1
        dec cnt+1
        dec cnt+1
        jsr next_blk
        bra dr_loop
dr_part:                        ; last 1-511 bytes: through BLKBUF
        lda #<BLKBUF
        ldy #>BLKBUF
        jsr sd_read
        lda buf
        sta cp_dst+1
        lda buf+1
        sta cp_dst+2
        lda #>BLKBUF
        sta cp_src+2
        ldy #0
cp_loop:
cp_src: lda BLKBUF,y
cp_dst: sta $FFFF,y
        iny
        bne cp_count
        inc cp_src+2
        inc cp_dst+2
cp_count:
        lda cnt
        bne cp_dec
        dec cnt+1
cp_dec:
        dec cnt
        lda cnt
        ora cnt+1
        bne cp_loop
io_ok:
        lda #0
        rts
io_range:
        lda #8
        rts
io_protect:
        lda #16
        rts

do_write:
        lda cnt                 ; whole blocks only
        bne io_protect
        lsr cnt+1               ; cnt -> blocks
        bcs io_protect
        lda blk                 ; WR_FIRST <= blk
        cmp #<WR_FIRST
        lda blk+1
        sbc #>WR_FIRST
        bcc io_protect
        clc                     ; blk + blocks <= WR_END
        lda blk
        adc cnt+1
        sta tmp
        lda blk+1
        adc #0
        sta tmp+1
        bcs io_protect          ; wrapped (a negative Pascal block number)
        lda #<WR_END
        cmp tmp
        lda #>WR_END
        sbc tmp+1
        bcc io_protect
dw_loop:
        lda cnt+1
        beq io_ok
        jsr set_lba
        bcs io_range
        lda buf
        ldy buf+1
        jsr sd_write
        inc buf+1
        inc buf+1
        dec cnt+1
        jsr next_blk
        bra dw_loop

; ---------------------------------------------------------------------------
; set_lba: $B0-$B3 = LBA of block blk. Carry set if blk is past the volume.

set_lba:
        lda blk
        cmp #<VOL_BLOCKS
        lda blk+1
        sbc #>VOL_BLOCKS
        bcs sl_done
        lda blk                 ; cluster index = blk >> CLSHIFT
        sta tmp
        lda blk+1
        sta tmp+1
        ldx clshift
sl_shift:
        beq sl_index
        lsr tmp+1
        ror tmp
        dex
        bra sl_shift
sl_index:
        asl tmp                 ; * 4 -> offset into cltab
        rol tmp+1
        asl tmp
        rol tmp+1
        clc
        lda tmp
        adc #<CLTAB
        sta sl_get+1
        lda tmp+1
        adc #>CLTAB
        sta sl_get+2
        ldx #0
sl_copy:
sl_get: lda CLTAB,x
        sta $B0,x
        inx
        cpx #4
        bne sl_copy
        lda blk                 ; + sector within the cluster
        and clmask
        clc
        adc $B0
        sta $B0
        bcc sl_ok
        inc $B1
        bne sl_ok
        inc $B2
        bne sl_ok
        inc $B3
sl_ok:
        clc
sl_done:
        rts

next_blk:
        inc blk
        bne nb_done
        inc blk+1
nb_done:
        rts

; A/Y = buffer; run the ROM routine through the resident.
sd_read:
        ldx #<ROM_SDREAD
        stx SD_VEC
        ldx #>ROM_SDREAD
        bra sd_call
sd_write:
        ldx #<ROM_SDWRITE
        stx SD_VEC
        ldx #>ROM_SDWRITE
sd_call:
        stx SD_VEC+1
        sta $B8
        sty $B9
        jmp ROM_SD

clshift:    .byte 0             ; log2(sectors per cluster), set by the loader
clmask:     .byte 0             ; sectors per cluster - 1
blk:        .word 0
cnt:        .word 0
buf:        .word 0
tmp:        .word 0
zsave:      .res 12

; The loader writes the cluster table at CLTAB.
