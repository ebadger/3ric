; Alternate Reality (The City / The Dungeon) for 3RIC - resident glue in
; RAM2 ($CF00-$CFFF), shared by both games.
;
; Both games copy the monitor ROM into language-card RAM (bank 2 and
; $E000-$FFFF) and play with that RAM mapped, so the CPU takes NMI/IRQ
; vectors from the RAM copy. On 3RIC every PS/2 clock edge, $C010 strobe and
; $C070 joystick trigger is an NMI from VIA1. The copied vector points at the
; ROM's NMI proxy ($F1BB), which The City then overwrites with its own code
; ($F000-$F7FF): the first keypress BRKs. The loader, and a patch after The
; City's own ROM copy (fixvec below), point both vectors here.
;
; The NMI/IRQ paths are the Ultima V / Seven Cities resident's: PS/2 start,
; data and parity edges and the $C010 strobe are serviced before any bank
; work; everything else (stop bit, ACIA, joystick scan, timers) goes to the
; ROM handler with ROM selected. Neither game ever maps language-card bank 1
; and the CPU only reaches these entries through the RAM vectors, so the
; mapped state on entry is always bank 2 RAM; $C083 twice restores it
; (read RAM, write enabled - the only RAM mode either game uses).
;
; $CFE0-$CFFF is the port state shared with the loader and the SD shim (see
; sdcore.s). The ROM's reset clears $CB00-$CEFF but not this page.

VIA_IFR     = $C20D
VIA_PA_NH   = $C20F             ; PORTA without handshake (PS/2 DATA = PA7)
KBSTATE     = $CE00             ; ROM PS/2 receiver: 0 start, 1 data, 2 parity, 3 stop
KBTEMP      = $CE01
KBD_NONPRINT = $CE19
LC_ROM      = $C082             ; read ROM, write-protect
LC_RAM2     = $C083             ; read/write bank 2 (twice to enable writes)

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
        lda #>lc_resume
        pha
        lda #<lc_resume
        pha
        lda #$04                ; fake P: I set, B clear
        pha
        lda LC_ROM
        jmp ($FFFA)             ; ROM NMI handler; its RTI returns below
lc_resume:
        lda LC_RAM2
        lda LC_RAM2             ; second read enables writes
        ply
        plx
        bra nmi_more

irq_entry:
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
        lda LC_RAM2
        lda LC_RAM2
        pla
        rti

; The City copies the whole ROM into bank 2 again before the title menu
; ($687B-$68E2), restoring the ROM's vectors, then selects RAM with
; BIT $C083 twice. That pair becomes JSR fixvec.
fixvec:
        bit LC_RAM2
        bit LC_RAM2
setvec:
        pha
        lda #<nmi_entry
        sta $FFFA
        lda #>nmi_entry
        sta $FFFB
        lda #<irq_entry
        sta $FFFE
        lda #>irq_entry
        sta $FFFF
        pla
        rts

resident_end:

        .res $CFE0-resident_end
port_vol:   .res 5              ; volume number of each image
port_cur:   .res 2              ; image "in" drive 1 / drive 2
port_n:     .byte 0             ; number of images
port_base:  .res 20             ; first SD sector (LBA) of each image, 4 bytes each
port_end:
