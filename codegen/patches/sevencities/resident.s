; Seven Cities of Gold for 3RIC - resident glue in RAM2 ($CF00-$CFFF).
;
; The game runs with language-card RAM mapped (bank 2, bank 1 for some
; calls), so the CPU takes NMI/IRQ vectors from the game's RAM at
; $FFFA/$FFFE. On 3RIC every PS/2 clock edge, $C010 strobe and $C070
; joystick trigger is an NMI from VIA1; the original game leaves the NMI
; vector at whatever LC RAM held and points IRQ/BRK at its RESTART stub.
; The loader and two game patches point both vectors here.
;
; The NMI/IRQ paths are the Ultima V resident's (codegen/patches/ultima5/
; resident.s), which decodes PS/2 start/data/parity edges and the $C010
; strobe before any bank work and was checked natively with real PS/2
; frames. Everything else - stop bit, ACIA, the joystick scan, timers -
; goes to the ROM handler with ROM selected, then the mapped bank
; ($C083 or $C08B, both read/write: the only two modes the game plays in)
; is restored. Bank 1 carries the signature $A5 at $DFFF, bank 2 $5A.
;
; $CFF0-$CFF8 is the port state shared with the loader and both copies of
; the SD shim (see shim.s). The ROM's reset clears $CB00-$CEFF but not
; this page.

VIA_IFR     = $C20D
VIA_PA_NH   = $C20F             ; PORTA without handshake (PS/2 DATA = PA7)
KBSTATE     = $CE00             ; ROM PS/2 receiver: 0 start, 1 data, 2 parity, 3 stop
KBTEMP      = $CE01
KBD_NONPRINT = $CE19
LC_ROM      = $C082             ; read ROM, write-protect
BANKSIG     = $DFFF
SIG_BANK1   = $A5

        .org $CF00

nmi_entry:
        pha
nmi_dispatch:
        lda VIA_IFR
        lsr a                   ; CA2 (PS/2 clock) -> carry
        bcs ps2_edge
        and #$08                ; CB1: a $C010 strobe clear
        beq nmi_rom
        bra cb1_clear
ps2_edge:
        lda KBSTATE
        beq ps2_start
        dec a
        beq ps2_data
        dec a
        bne ps2_stop            ; state 3: stop bit
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
        bra nmi_ack
ps2_stop:
        ; The ROM decodes the scan code, then leaves through $F1C6, which
        ; writes $7F to IFR. Service a pending $C010 strobe (CB1) first so
        ; that write cannot discard it; CA2 stays pending and returns here.
        lda VIA_IFR
        and #$10
        beq nmi_rom
cb1_clear:
        lda $C000
        and #$7F
        sta $C000
        lda #$10
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
        cmp #SIG_BANK1
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
        cmp #SIG_BANK1
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

resident_end:

        .res $CFF0-resident_end
port_base0: .res 4              ; PROGRAM.DSK first sector (LBA, little-endian)
port_base1: .res 4              ; MAP.DSK first sector
port_disk:  .byte 1             ; disk in "drive 1": 0 program, 1 map
