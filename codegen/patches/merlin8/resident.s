; Merlin-8 for 3RIC - resident NMI glue in RAM2 ($CF00-$CFFF).
;
; Merlin-8 2.58 runs its editor and assembler from language-card RAM (bank 1
; read/write, or bank 2 read-only; briefly bank 2 read/write), so the CPU
; fetches the NMI vector from Merlin's RAM copy of the monitor. On 3RIC every
; PS/2 clock edge and $C010 keyboard strobe is an NMI from VIA1; the loader
; points the RAM vector at $FFFA here.
;
; PS/2 start, data and parity edges and the $C010 strobe (CB1) are serviced
; right here without bank work (the Ultima V / Wizardry I receiver: ROM state
; KBSTATE $CE00, KBTEMP $CE01, KBD_NONPRINT $CE19, DATA through PORTA's
; no-handshake alias $C20F, only the serviced IFR bit acknowledged). The stop
; bit and anything else go to the ROM handler through a fake RTI frame: the
; language-card mode is recorded by lc_mode, ROM is selected, and lc_resume
; restores the mode afterwards.
;
; lc_mode is also used by the ProDOS stand-in around every MLI call.

VIA_IFR     = $C20D
VIA_PA_NH   = $C20F             ; PORTA without handshake (PS/2 DATA = PA7)
KBSTATE     = $CE00             ; ROM PS/2 receiver: 0 start, 1 data, 2 parity, 3 stop
KBTEMP      = $CE01
KBD_NONPRINT = $CE19
LC_ROM      = $C082             ; read ROM, write-protect
BANKSIG     = $DFFF             ; bank 2 holds Merlin's RTS ($60) here, bank 1 not

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
        phy                     ; the ROM handler can change Y
        ldx BANKSIG             ; lc_mode, inline (see below)
        txa
        eor #$FF
        sta BANKSIG
        eor BANKSIG             ; 0 if the write went through, else $FF
        stx BANKSIG
        and #$03
        eor #$83                ; $83 read/write, $80 read-only
        tay
        txa
        and #$40
        bne nr_mode             ; bank 2
        tya
        ora #$08                ; bank 1
        tay
nr_mode: phy                    ; mode to restore
        lda #>lc_resume
        pha
        lda #<lc_resume
        pha
        lda #$04                ; fake P: I set, B clear
        pha
        lda LC_ROM
        jmp ($FFFA)             ; ROM handler; its RTI returns below
lc_resume:
        pla
        tax
        lda $C000,x             ; read twice: a read/write mode needs both,
        lda $C000,x             ; a read-only one is unchanged by the second
        ply
        plx
        bra nmi_more            ; also catches a VIA source that raised no edge

; Language-card RAM is read-mapped: return in A the soft switch that
; re-selects it ($80/$88 read-only, $83/$8B read/write; bank 2 if BANKSIG
; bit 6 is set). Writes are tested by flipping BANKSIG and restoring it.
; Preserves X and Y.
lc_mode:
        phx
        ldx BANKSIG
        txa
        eor #$FF
        sta BANKSIG
        cmp BANKSIG
        stx BANKSIG
        php                     ; Z set: the write went through
        txa
        asl a                   ; bit 6 -> N
        bmi lm_bank2
        lda #$88
        bra lm_rw
lm_bank2:
        lda #$80
lm_rw:
        plp
        bne lm_done
        ora #$03
lm_done:
        plx
        rts

resident_end:
