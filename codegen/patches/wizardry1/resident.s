; Wizardry I for 3RIC - resident glue in RAM2 ($CF00-$CFFF).
;
; Wizardry deliberately maps the (empty) language-card RAM while it plays,
; so a RESET or BRK on an Apple II finds zero vectors. On 3RIC every PS/2
; clock edge, $C010 keyboard strobe and $C070 paddle trigger is an NMI from
; VIA1, so the CPU would fetch the NMI vector from that RAM. The loader
; fills the language card's $FFFA/$FFFE with this page's entry points.
;
; NMI: the same receiver as the Ultima V port. PS/2 start, data and parity
; edges and the $C010 strobe (CB1) are serviced here without bank work,
; mirroring the ROM's state (KBSTATE $CE00, KBTEMP $CE01, KBD_NONPRINT
; $CE19), reading DATA through PORTA's no-handshake alias $C20F and
; acknowledging only the serviced IFR bit; a bank switch first would sample
; DATA after the keyboard had moved on. The stop bit, ACIA, paddles and
; timers go to the ROM handler through a fake RTI frame; the language-card
; bank to restore comes from the signature byte at $DFFF (bank 1 holds
; BANKSIG_VALUE). The game only reads RAM in either bank with writes
; enabled, so $C083/$C08B read twice restores its state.
;
; disk_entry replaces the body of the Pascal BIOS DISKREAD/DISKWRITE
; ($AF31 in RTSTRP.APPLE, after LDY #op / STY $03AC). It records how
; $D000-$FFFF is mapped (ROM before WIZARDRY.CODE starts, RAM bank 1 or 2
; afterwards), runs the SD shim in language-card RAM, restores the mapping,
; drops the BIOS parameters and returns X = IORESULT like the original.
;
; rom_sd calls the ROM's sd_readsector/sd_writesector (through sd_vec)
; with the ROM selected for reads and language-card bank 1 for writes.

VIA_IFR     = $C20D
VIA_PA_NH   = $C20F             ; PORTA without handshake (PS/2 DATA = PA7)
KBSTATE     = $CE00             ; ROM PS/2 receiver: 0 start, 1 data, 2 parity, 3 stop
KBTEMP      = $CE01
KBD_NONPRINT = $CE19
LC_ROM      = $C082             ; read ROM, write-protect
LC_RW_B1    = $C08B             ; read/write bank 1 (needs two reads)
BANKSIG     = $DFFF             ; bank-1 signature byte
LC_ROM_WB1  = $C089             ; read ROM, write bank 1 (needs two reads)

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
        jsr ram_mode            ; A = $83 or $8B
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
        jsr ram_mode
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

; Language-card RAM is read-mapped: A = $8B for bank 1, $83 for bank 2.
ram_mode:
        lda BANKSIG
        cmp #BANKSIG_VALUE
        beq rm_bank1
        lda #$83
        rts
rm_bank1:
        lda #$8B
        rts

; Pascal BIOS disk entry. Stack: return address, block, byte count,
; buffer, drive, flags (two bytes each); $03AC = 1 read, 2 write.
disk_entry:
        lda $FFFA               ; the ROM's vector or the loader's RAM vector?
        cmp #<nmi_entry
        beq de_ram
        lda #$82                ; ROM was selected (write-protected)
        bra de_go
de_ram:
        jsr ram_mode
de_go:
        pha                     ; mode to restore
        lda LC_RW_B1
        lda LC_RW_B1            ; shim (high RAM) and its save area (bank 1)
        jsr SHIM_DISK           ; reads the parameters, sets disk_err
de_back:
        pla
        tay
        lda $C000,y             ; $C082: ROM; $C083/$C08B twice: RAM + writes
        lda $C000,y
        tsx                     ; move the caller's return address over the
        lda $0101,x             ; ten parameter bytes and drop them
        sta $010B,x
        lda $0102,x
        sta $010C,x
        txa
        clc
        adc #10
        tax
        txs
        ldx disk_err
        rts

disk_err:   .byte 0             ; IORESULT, set by the shim

; Call the ROM sector routine at sd_vec (LBA in $B0-$B3, buffer at ($B8))
; with ROM reads and bank-1 writes; called from the shim in bank 1, returns
; with bank 1 read/write again.
rom_sd:
        lda LC_ROM_WB1
        lda LC_ROM_WB1
        jsr rs_call
        lda LC_RW_B1
        lda LC_RW_B1
        rts
rs_call:
        jmp (sd_vec)

sd_vec:     .word 0

resident_end:
