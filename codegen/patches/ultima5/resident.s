; Ultima V for 3RIC - resident glue in RAM2 ($CF00-$CFFF).
;
; Ultima V keeps language-card RAM mapped while it plays, so the CPU fetches
; the NMI/IRQ vectors from the game's RAM at $FFFA/$FFFE instead of the ROM.
; 3RIC delivers every PS/2 bit, keyboard strobe and paddle trigger as an NMI,
; so the loader points those RAM vectors here. Each entry records which
; $D000 bank was mapped, selects the ROM, and enters the ROM's own handler
; with a fake RTI frame that returns to lc_resume, which re-selects the
; game's bank. The game only maps language-card RAM read/write ($C083 or
; $C08B), so restoring one of those two modes restores its state exactly.
;
; rom_cmd sends one ROM DOS command (Ctrl-D prefixed, CR terminated, in
; cmdbuf) through COUT, exactly like the Ultima IV port. It runs here, below
; $D000, because the ROM must be selected while the command executes.
; Loads are written through to language-card bank 1 and $E000-$FFFF.

COUT        = $FDED
CSWL        = $36
MUTE_OUTPUT = $CE09             ; ROM: suppress screen echo of DOS output
LC_ROM      = $C082             ; read ROM, write-protect
LC_ROM_WB1  = $C089             ; read ROM, write bank 1 (needs two reads)
LC_RW_B1    = $C08B             ; read/write bank 1 (needs two reads)
BANKSIG     = $DFFF             ; bank-1 signature byte (see shim.s)

        .org $CF00

romcsw:     .word 0             ; ROM DOS COUT hook, captured by the loader
nmi_entry:
        pha
        lda BANKSIG
        cmp #BANKSIG_VALUE
        beq nmi_bank1
        lda #$83
        bra nmi_save
nmi_bank1:
        lda #$8B
nmi_save:
        pha                     ; mode to restore
        lda #>lc_resume
        pha
        lda #<lc_resume
        pha
        lda #$04                ; fake P: I set, B clear (ROM IRQ tests B)
        pha
        lda LC_ROM
        jmp ($FFFA)             ; ROM NMI handler; its RTI returns below

irq_entry:
        pha
        lda BANKSIG
        cmp #BANKSIG_VALUE
        beq irq_bank1
        lda #$83
        bra irq_save
irq_bank1:
        lda #$8B
irq_save:
        pha
        lda #>lc_resume
        pha
        lda #<lc_resume
        pha
        lda #$04
        pha
        lda LC_ROM
        jmp ($FFFE)

lc_resume:
        pla                     ; saved mode ($83 or $8B)
        phx
        tax
        lda $C000,x
        lda $C000,x             ; second read enables writes
        plx
        pla
        rti

; Run the command in cmdbuf through the ROM DOS. Preserves nothing but the
; caller's zero page; returns with language-card bank 1 read/write.
rom_cmd:
        ldx #$0F
rc_save:
        lda $B0,x               ; ROM DOS / FAT32 zero page
        sta zsave,x
        dex
        bpl rc_save
        lda CSWL
        sta zsave+16
        lda CSWL+1
        sta zsave+17
        lda romcsw
        sta CSWL
        lda romcsw+1
        sta CSWL+1
        lda #$80
        sta MUTE_OUTPUT
        lda LC_ROM_WB1
        lda LC_ROM_WB1
        ldx #0
rc_send:
        lda cmdbuf,x
        jsr COUT
        inx
        cmp #$8D
        bne rc_send
        lda LC_RW_B1
        lda LC_RW_B1
        lda zsave+16
        sta CSWL
        lda zsave+17
        sta CSWL+1
        ldx #$0F
rc_restore:
        lda zsave,x
        sta $B0,x
        dex
        bpl rc_restore
        rts

zsave:      .res 18
cmdbuf:     .res 48
resident_end:
