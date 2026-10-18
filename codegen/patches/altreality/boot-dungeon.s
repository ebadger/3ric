; Alternate Reality: The Dungeon - the boot sector's work, appended to
; loader.s.
;
; The boot sector (track 0 sector 0, at $0800) read track 0 sectors 15..0
; to $4000-$4FFF (the RWTS and the game's loader), after its routine at
; $08C1 copied the monitor ROM's top page range $F800-$FFFF into language-
; card RAM and selected that RAM; it then continued at $0844 with the slot
; in $2B. Here the same happens, with the NMI/IRQ vectors pointed at the
; resident. Track 0 carries the SD shim at $4517 and the copy-protection
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
        jsr $08C1               ; ROM $F800-$FFFF -> LC RAM, RAM selected
        jsr SETVEC
        jmp $0844

gb_s:       .byte 0
