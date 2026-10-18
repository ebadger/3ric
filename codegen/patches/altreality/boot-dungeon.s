; Alternate Reality: The Dungeon - the boot sector's work, appended to
; loader.s.
;
; The boot sector (track 0 sector 0, at $0800) read track 0 sectors 15..0
; to $4000-$4FFF (the RWTS and the game's loader), after its routine at
; $08C1 copied the monitor ROM's $F800-$FFFF into language-card RAM, kept
; the ROM's RESET vector at $03F2-$03F4 and selected that RAM; it then
; continued at $0844 with the slot in $2B. Here the same happens, except
; that the NMI/IRQ vectors are pointed at the resident before RAM is
; selected ($08C1 would expose the ROM's vector, whose target $F1BB is not
; copied). Track 0 carries the SD shim at $4517 and the copy-protection
; bypass at $49FD (written by the converter).

game_boot:
        lda #0                  ; sector 0 -> $0800
        ldx #$08
        jsr read_t0
        stz gb_s
gb_t0:
        lda #$4F                ; sector s -> page $4F - s
        sec
        sbc gb_s
        tax
        lda gb_s
        jsr read_t0
        inc gb_s
        lda gb_s
        cmp #16
        bne gb_t0
        lda #$60                ; slot 6 * 16, as the boot ROM leaves it
        sta $2B
        lda $C081               ; read ROM, write RAM: $F800-$FFFF -> LC
        lda $C081
        stz ZBUF
        lda #$F8
        sta ZBUF+1
        ldy #0
gb_copy:
        lda (ZBUF),y
        sta (ZBUF),y
        iny
        bne gb_copy
        inc ZBUF+1
        bne gb_copy
        lda $FFFC               ; the ROM's RESET vector, as $08C1 keeps it
        sta $03F2
        lda $FFFD
        sta $03F3
        eor #$FF
        sta $03F4
        jsr SETVEC              ; vectors first, while the CPU still reads ROM
        lda $C083               ; read/write bank 2 and $E000-$FFFF
        lda $C083
        jmp $0844

gb_s:       .byte 0
