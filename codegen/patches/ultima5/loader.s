; Ultima V for 3RIC - loader (U5.PRG). From the ROM DOS prompt, in the folder
; that holds U5.PRG and the eight disk directories:
;
;     BRUN U5.PRG 0800
;
; It stands in for DINKEYDOS's boot code: installs the resident page at
; $CF00, copies the SD shim into language-card bank 1 at $D000, clears
; bank 2 and $E000-$FFFF, points the language-card NMI/IRQ vectors at the
; resident forwarders, and runs STARTUP from the ULTIMA5 directory with
; bank 1 read/write - the state DINKEYDOS leaves for the game.
;
; Every language-card write happens with the ROM still selected for reads,
; so an NMI during setup always finds the ROM's vectors.

COUT        = $FDED
DOS_HOOK    = $03EA             ; ROM DOS: JSR hook_buffer_no_output; RTS
RES_SRC     = $0B00             ; resident image (256 bytes) in U5.PRG
SHIM_SRC    = $0C00             ; shim image (4 KB) in U5.PRG

        .org $0800

        cld
        lda COUT                ; COUT must be JMP ($0036)
        cmp #$6C
        bne bad_rom
        lda COUT+1
        cmp #$36
        bne bad_rom
        lda DOS_HOOK            ; and the ROM DOS hook installed
        cmp #$20
        bne bad_rom
        ldx #10                 ; ROM NMI proxy the PS/2 fast path shares
nmi_chk:                        ; state ($CE00/$CE01/$CE19) with
        lda $F1BB,x
        cmp nmi_proxy,x
        bne bad_rom
        dex
        bpl nmi_chk
        bra rom_ok
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
        brk                     ; BRUN enters with JMP: no return address

rom_ok:
        stz $CAFE               ; ROM NMI nest count 0, so its exit keeps BASIC off
        bit $C007               ; BASIC ROM off: $9000-$BFFF is RAM
        ldx #0
copy_res:
        lda RES_SRC,x
        sta RES_ORG,x
        inx
        bne copy_res
        jsr DOS_HOOK            ; CSW = ROM DOS command collector, muted
        lda $36
        sta ROMCSW_SRC          ; into the shim image before it is copied
        lda $37
        sta ROMCSW_SRC+1

        lda $C089               ; read ROM, write bank 1
        lda $C089
        lda #<SHIM_SRC
        sta $00
        lda #>SHIM_SRC
        sta $01
        lda #$00
        sta $02
        lda #$D0
        sta $03
        ldx #16
        ldy #0
copy_shim:
        lda ($00),y
        sta ($02),y
        iny
        bne copy_shim
        inc $01
        inc $03
        dex
        bne copy_shim

        lda $C081               ; read ROM, write bank 2 and $E000-$FFFF
        lda $C081
        lda #$D0
        sta $03
        ldx #48
        lda #0
        tay
clear_lc:
        sta ($02),y
        iny
        bne clear_lc
        inc $03
        dex
        bne clear_lc
        lda #<NMI_ENTRY
        sta $FFFA
        lda #>NMI_ENTRY
        sta $FFFB
        lda $FFFC               ; ROM reset vector (reads still see ROM)
        sta $FFFC
        lda $FFFD
        sta $FFFD
        lda #<IRQ_ENTRY
        sta $FFFE
        lda #>IRQ_ENTRY
        sta $FFFF

        lda $C08B               ; bank 1 read/write: the shim is live
        lda $C08B
        ldx #$FF
        txs
        lda #$60                ; DINKEYDOS boot zero page (slot 6, drive 1)
        sta $50
        sta $7F
        lda #1
        sta $78
        jsr $D01E
        .asciiz "/ULTIMA5"
        jsr $D006
        .asciiz "STARTUP"
        .word $8000
        lda $8000               ; STARTUP begins with JMP
        cmp #$4C
        bne boot_fail
        jmp $8000
boot_fail:
        lda $C082               ; ROM back, report and stop in the monitor
        jsr $FE93               ; SETVID: COUT to the screen again
        ldx #0
bf_loop:
        lda msg_boot,x
        beq bf_done
        ora #$80
        jsr COUT
        inx
        bne bf_loop
bf_done:
        brk

msg_rom:    .byte $8D
            .text "U5.PRG NEEDS THE 3RIC ROM DOS"
            .byte $8D,0
nmi_proxy:  .byte $EE,$FE,$CA,$2C,$06,$C0,$48,$DA,$4C,$A9,$B6
msg_boot:   .byte $8D
            .text "U5: ULTIMA5/STARTUP NOT FOUND"
            .byte $8D,0
loader_end:
