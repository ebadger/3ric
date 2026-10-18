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
; rom_call runs one ROM FAT32 routine for the shim with ROM reads and bank-1
; writes. b1_call lets game code that runs in bank 2 (pad_key, the music
; pause/resume hook in glue.s) reach the bank-1 shim.

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
        ldx #0                  ; JMP ($FFFA)
lc_forward:
        lda BANKSIG
        cmp #BANKSIG_VALUE
        beq lc_bank1
        lda #$83
        bra lc_save
lc_bank1:
        lda #$8B
lc_save:
        pha                     ; mode to restore
        lda #>lc_resume
        pha
        lda #<lc_resume
        pha
        lda #$04                ; fake P: I set, B clear
        pha
        lda LC_ROM
        jmp ($FFFA,x)           ; ROM handler; its RTI returns below
lc_resume:
        pla                     ; saved mode ($83 or $8B)
        tax
        lda $C000,x
        lda $C000,x             ; second read enables writes
        ply
        plx
        bra nmi_more            ; also catches a VIA source that raised no edge

; Mockingboard music: the timer tick (VIA $C400 T1) runs the bank-1 player
; with the game's bank restored afterwards; any other IRQ goes to the ROM.
; With no Mockingboard the loader leaves the BIT on mb_none (bit 6 clear).
irq_entry:
        pha
        phx
        phy
irq_mb: bit mb_none             ; loader: BIT $C40D (VIA IFR, T1 = bit 6)
        bvc irq_rom
        lda BANKSIG
        cmp #BANKSIG_VALUE
        beq irq_b1
        lda LC_RW_B1            ; game in bank 2: borrow bank 1
        lda LC_RW_B1
        jsr MUS_TICK
        lda $C083
        lda $C083
        bra irq_out
irq_b1:
        jsr MUS_TICK
irq_out:
        ply
        plx
        pla
        rti
irq_rom:
        ldx #4                  ; JMP ($FFFE)
        bra lc_forward

; Replaces the game's LDA $C000 keyboard reads (see port-ultima5.mjs).
; Lets the SNES pads type a mapped key into $C000, then reads it like the
; original instruction. Preserves X, Y and all flags except N and Z.
pad_key:
        php
        lda #<PAD_POLL
        jsr b1_call
        plp
        lda $C000
        rts

; Game foreground calls into bank 1: A = low byte of a $D0xx jump-table
; slot. Maps bank 1 if the game is in bank 2 and restores it afterwards.
; Preserves X and Y. Not used by the IRQ path (b1_jmp is modified here).
b1_call:
        sta b1_jmp+1
        lda BANKSIG
        cmp #BANKSIG_VALUE
        beq b1_jmp
        lda LC_RW_B1
        lda LC_RW_B1
        jsr b1_jmp
        lda $C083
        lda $C083
        rts
b1_jmp: jmp $D000

; JSR the ROM routine at X (low) / Y (high) with ROM reads and bank-1
; writes; called from the shim in bank 1, returns with bank 1 read/write
; again and the routine's carry.
rom_call:
        stx rc_jsr+1
        sty rc_jsr+2
        lda LC_ROM_WB1
        lda LC_ROM_WB1
rc_jsr: jsr $FFFF
        php
        lda LC_RW_B1
        lda LC_RW_B1
        plp
        rts

mb_none:    .byte 0
resident_end:
