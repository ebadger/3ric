; Ultima V for 3RIC - resident glue in RAM2 ($CF00-$CFFF).
;
; Ultima V keeps language-card RAM mapped while it plays, so the CPU fetches
; the NMI/IRQ vectors from the game's RAM at $FFFA/$FFFE instead of the ROM.
; 3RIC delivers every PS/2 clock edge, keyboard strobe and paddle trigger as
; an NMI from VIA1, so the loader points those RAM vectors here.
;
; PS/2 timing decides the shape of the NMI path. The keyboard changes DATA
; while CLK is high, so a bit must be sampled soon after the falling edge.
; Natively the ROM samples ~50 cycles after the NMI; any bank work in front
; of it pushes the sample into the next bit. So the start, data and parity
; edges, and the $C010 strobe (CB1), are serviced right here with the game's
; banks untouched, mirroring the ROM's own state machine (KBSTATE $CE00,
; KBTEMP $CE01, KBD_NONPRINT $CE19). DATA is read through PORTA's
; no-handshake alias $C20F, only the serviced IFR bit is acknowledged, and
; IFR is re-checked before RTI so an edge that arrived meanwhile is not lost.
;
; Everything else - the stop bit (scan-code decode), ACIA, paddles, timers -
; goes to the ROM handler: record the mapped $D000 bank from a signature byte
; at $DFFF, select ROM, and enter the ROM vector with a fake RTI frame that
; returns to lc_resume, which re-selects $C083/$C08B. The game only maps the
; language card read/write, so that restores its state. The ROM handler
; saves A and X but can change Y, so Y is saved here.
;
; rom_send runs the ROM DOS command in cmdbuf through COUT with ROM reads and
; bank-1 writes (the shim prepares CSW and zero page around it).

COUT        = $FDED
VIA_IFR     = $C20D
VIA_PA_NH   = $C20F             ; PORTA without handshake (PS/2 DATA = PA7)
KBSTATE     = $CE00             ; ROM PS/2 receiver: 0 start, 1 data, 2 parity, 3 stop
KBTEMP      = $CE01
KBD_NONPRINT = $CE19
LC_ROM      = $C082             ; read ROM, write-protect
LC_ROM_WB1  = $C089             ; read ROM, write bank 1 (needs two reads)
LC_RW_B1    = $C08B             ; read/write bank 1 (needs two reads)
BANKSIG     = $DFFF             ; bank-1 signature byte (see shim.s)

        .org $CF00

nmi_entry:
        pha
nmi_dispatch:
        lda VIA_IFR
        lsr a                   ; CA2 (PS/2 clock) -> carry
        bcs ps2_edge
        and #$08                ; CB1: a $C010 strobe clear
        beq nmi_rom
        lda $C000
        and #$7F
        sta $C000
        lda #$10
        bra nmi_ack
ps2_edge:
        lda KBSTATE
        beq ps2_start
        dec a
        beq ps2_data
        dec a
        bne nmi_rom             ; stop bit: let the ROM decode the scan code
        inc KBSTATE             ; parity -> stop
        lda KBTEMP
        cmp #$12                ; left shift
        beq ps2_mod
        cmp #$59                ; right shift
        beq ps2_mod
        cmp #$14                ; ctrl
        bne ps2_done
ps2_mod:
        sta KBD_NONPRINT
        bra ps2_done
ps2_data:
        lda VIA_PA_NH
        asl a
        ror KBTEMP
        bcc ps2_done
        bra ps2_next            ; eighth bit shifted in -> parity
ps2_start:
        lda #$80
        sta KBTEMP
ps2_next:
        inc KBSTATE
ps2_done:
        lda #$01
nmi_ack:
        sta VIA_IFR
nmi_more:
        lda VIA_IFR
        bmi nmi_dispatch
        pla
        rti

nmi_rom:
        phx
        phy
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
        lda #$04                ; fake P: I set, B clear
        pha
        lda LC_ROM
        jmp ($FFFA)             ; ROM NMI handler; its RTI returns below
lc_resume:
        pla                     ; saved mode ($83 or $8B)
        tax
        lda $C000,x
        lda $C000,x             ; second read enables writes
        ply
        plx
        bra nmi_more

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
        lda #>irq_resume
        pha
        lda #<irq_resume
        pha
        lda #$04
        pha
        lda LC_ROM
        jmp ($FFFE)
irq_resume:
        pla
        phx
        tax
        lda $C000,x
        lda $C000,x
        plx
        pla
        rti

; Send cmdbuf (Ctrl-D ... CR) through COUT with ROM reads and bank-1 writes.
; Called from the shim in bank 1; returns with bank 1 read/write again.
rom_send:
        lda LC_ROM_WB1
        lda LC_ROM_WB1
        ldx #0
rs_loop:
        lda cmdbuf,x
        jsr COUT
        inx
        cmp #$8D
        bne rs_loop
        lda LC_RW_B1
        lda LC_RW_B1
        rts

cmdbuf:     .res 32
resident_end:
