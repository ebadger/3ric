; Flight Simulator II for 3RIC - resident NMI forwarder in RAM2 ($CF00-$CFFE).
;
; After its title, Flight Simulator II keeps language-card RAM mapped
; read/write (bank 2, or bank 1 for some scenery work) and points the RAM
; NMI, RESET and IRQ vectors at its own restart code ($A7E2). An Apple II
; never raises NMI, but 3RIC delivers every PS/2 clock edge, $C010 strobe
; clear and $C070 paddle trigger as an NMI from VIA1, so the first key the
; game acknowledged restarted the loader in an endless loop.
;
; The patched disk points only the RAM NMI vector here; RESET and IRQ keep
; the game's handler. The NMI path follows codegen/patches/ultima5/resident.s:
;
; - Fast path, no bank work: PS/2 start, data and parity edges and the
;   $C010 strobe (CB1) are serviced here with the ROM receiver's own state
;   (KBSTATE $CE00, KBTEMP $CE01, KBD_NONPRINT $CE19), reading DATA through
;   PORTA's no-handshake alias $C20F. A bank switch before the ROM's DATA
;   sample would let the keyboard move on to the next bit.
; - ROM path: the stop bit (scan-code decode), ACIA, paddles and timers go to
;   the ROM handler through a fake RTI frame with ROM selected, then the
;   language card is re-selected read/write in the game's bank.
;
; The game's bank flag FS2_BANK ($0E43) is set (bank 1) or cleared (bank 2)
; by its only bank-switch helpers ($F8B0/$F8BC) immediately BEFORE the two
; $C08B/$C083 reads. An NMI landing in between therefore restores the bank
; the game is about to select, which those reads then select again.

COUT        = $FDED
VIA_IFR     = $C20D
VIA_PA_NH   = $C20F             ; PORTA without handshake (PS/2 DATA = PA7)
KBSTATE     = $CE00             ; ROM PS/2 receiver: 0 start, 1 data, 2 parity, 3 stop
KBTEMP      = $CE01
KBD_NONPRINT = $CE19
BANKING_MODE = $CAFE            ; ROM NMI nest count; 0 on exit = BASIC overlay off
ROM_NMI     = $F1BB             ; ROM NMI handler (its proxy is checked at boot)
LC_ROM      = $C082             ; read ROM, write-protect
LC_ROM_WB2  = $C081             ; read ROM, write bank 2 + $E000-$FFFF (two reads)
LC_RW_B2    = $C083             ; read/write bank 2 (two reads)
FS2_BANK    = $0E43             ; game's flag: nonzero = bank 1, zero = bank 2

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
        lda #$83                ; bank 2 read/write
        ldx FS2_BANK
        beq nmi_save
        lda #$8B                ; bank 1 read/write
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

; Replaces the game's first "LDA $C083 / LDA $C083" ($AC9A). The RAM NMI
; vector is written while reads still see the ROM, so it is valid from the
; first cycle that language-card RAM is visible. The bank flag is cleared
; first so it names bank 2 regardless of power-on RAM or a warm restart.
; (nmi_entry is page-aligned: the patcher checks its low byte is zero.)
lc_on:
        stz FS2_BANK
        lda LC_ROM_WB2
        lda LC_ROM_WB2
        stz $FFFA
        lda #>nmi_entry
        sta $FFFB
        lda LC_RW_B2
        lda LC_RW_B2
        rts

; Replaces "STA $FFFA / STX $FFFB" in the game's vector setup ($AD17).
; A and X still hold the game's restart address for RESET and IRQ.
set_nmi:
        stz $FFFA
        pha
        lda #>nmi_entry
        sta $FFFB
        pla
        rts

; Called once by the boot hook with the ROM visible. Refuses a ROM whose NMI
; proxy differs from the one whose receiver state the fast path shares.
boot_init:
        lda $FFFA
        cmp #<ROM_NMI
        bne bad_rom
        lda $FFFB
        cmp #>ROM_NMI
        bne bad_rom
        ldx #10
bi_chk:
        lda ROM_NMI,x
        cmp nmi_proxy,x
        bne bad_rom
        dex
        bpl bi_chk
        stz BANKING_MODE        ; so the ROM handler's exit keeps BASIC off
        bit $C007               ; BASIC ROM off: the game needs RAM to $BFFF
        rts
bad_rom:
        ldx #0
br_loop:
        lda msg_rom,x
        beq br_done
        ora #$80
        jsr COUT
        inx
        bne br_loop
br_done:
        brk                     ; stop in the monitor

nmi_proxy:  .byte $EE,$FE,$CA,$2C,$06,$C0,$48,$DA,$4C,$A9,$B6
msg_rom:    .byte $8D
            .text "FS2: ROM MISMATCH"
            .byte $8D,0
resident_end:
