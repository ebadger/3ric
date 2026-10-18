; Alternate Reality: The City - the boot sector's work, appended to loader.s.
;
; The boot sector read track 0 sectors 0-13 to $0800-$15FF, copied the
; monitor ROM into language-card bank 2 ($D000-$FFFF), selected that RAM,
; pointed the reset vector at a memory-wiping stub and jumped to the crack's
; loader at $1000 with the slot in $2B. Here the reset vector stays the ROM's
; (so RESET returns to 3RIC) and the NMI/IRQ vectors point at the resident.
; Track 0 of side 1 carries the SD shim at $0D00 (written by the converter).

game_boot:
        stz gb_s
gb_t0:
        lda gb_s
        clc
        adc #$08
        tax
        lda gb_s
        jsr read_t0
        inc gb_s
        lda gb_s
        cmp #14
        bne gb_t0
        lda $C081               ; read ROM, write bank 2 and $E000-$FFFF
        lda $C081
        stz ZBUF
        lda #$D0
        sta ZBUF+1
        ldy #0
gb_copy:
        lda (ZBUF),y
        sta (ZBUF),y
        iny
        bne gb_copy
        inc ZBUF+1
        bne gb_copy
        jsr SETVEC              ; vectors first, while the CPU still reads ROM
        lda $C083               ; read/write bank 2
        lda $C083
        lda #$60                ; slot 6 * 16, as the boot ROM leaves it
        sta $2B
        jmp $1000

gb_s:       .byte 0
