; Ultima I for 3RIC - loader (U1.PRG). From the ROM DOS prompt, in the
; folder that holds U1.PRG and the game files:
;
;     BRUN U1.PRG 0800
;
; Stands in for the ProDOS boot: installs the ProDOS stand-in (prodos.s) at
; $BB00-$BFFF and the SNES pad glue (pad.s) at $0300, then loads U1.SYSTEM
; at $2000 through the stand-in and starts it the way ProDOS starts a SYS
; file. Everything after that is Origin's code.
;
; The tool defines MLI_IMAGE and PAD_IMAGE/PAD_SIZE (where the stand-in and
; pad glue sit in this file), ROMCSW and IRQ_RETURN (symbols in the stand-in).

COUT1       = $FDF0             ; print A to the screen, bypassing CSW
SETKBD      = $FE89
SETVID      = $FE93
DOS_HOOK    = $03EA             ; ROM DOS: JSR hook_buffer_no_output; RTS
MUTE_OUTPUT = $CE09
NMI_NEST    = $CAFE             ; ROM NMI proxy nest count
MLI         = $BF00

        .org $0800

        cld
        lda $FDED               ; COUT must be JMP ($0036)
        cmp #$6C
        bne bad_rom
        lda $FDEE
        cmp #$36
        bne bad_rom
        lda DOS_HOOK            ; and the ROM DOS hook installed
        cmp #$20
        bne bad_rom
        ldx #18                 ; the NMI proxy that leaves BASIC off when
nmi_chk:                        ; its nest count returns to zero
        lda $F1BB,x
        cmp nmi_proxy,x
        bne bad_rom
        dex
        bpl nmi_chk
        bra rom_ok
bad_rom:
        lda #<msg_rom
        ldy #>msg_rom
        jmp fail
rom_ok:
        stz NMI_NEST            ; so every NMI exit selects RAM at $9000-$BFFF
        bit $C007               ; BASIC ROM off: $9000-$BFFF is RAM
        ldx #0
copy_mli:                       ; 5 pages -> $BB00-$BFFF
        lda MLI_IMAGE,x
        sta $BB00,x
        lda MLI_IMAGE+$100,x
        sta $BC00,x
        lda MLI_IMAGE+$200,x
        sta $BD00,x
        lda MLI_IMAGE+$300,x
        sta $BE00,x
        lda MLI_IMAGE+$400,x
        sta $BF00,x
        inx
        bne copy_mli
        ldx #PAD_SIZE-1         ; SNES pad glue -> $0300-$03BF
copy_pad:
        lda PAD_IMAGE,x
        sta $0300,x
        dex
        cpx #$FF
        bne copy_pad

        lda MUTE_OUTPUT
        pha
        jsr DOS_HOOK            ; CSW = ROM DOS command collector
        lda $36
        sta ROMCSW
        lda $37
        sta ROMCSW+1
        pla
        sta MUTE_OUTPUT
        jsr SETVID              ; COUT and RDKEY back to screen/keyboard
        jsr SETKBD
        lda #<IRQ_RETURN
        sta $03FE
        lda #>IRQ_RETURN
        sta $03FF

        jsr MLI                 ; load U1.SYSTEM at $2000 like ProDOS
        .byte $C8
        .word p_open
        bcs no_system
        lda p_open+5
        sta p_read+1
        sta p_close+1
        jsr MLI
        .byte $CA
        .word p_read
        php
        jsr MLI
        .byte $CC
        .word p_close
        plp
        bcs no_system
        lda $2000               ; a ProDOS SYS file starts with JMP
        cmp #$4C
        bne no_system
        ldx #$FF
        txs
        jmp $2000
no_system:
        lda #<msg_sys
        ldy #>msg_sys
fail:
        sta $00
        sty $01
        ldy #0
fail_loop:
        lda ($00),y
        beq fail_done
        ora #$80
        jsr COUT1
        iny
        bne fail_loop
fail_done:
        brk                     ; BRUN enters with JMP: no return address

p_open:     .byte 3
            .word path
            .word $BB00         ; io buffer: unused by the stand-in
            .byte 0
p_read:     .byte 4,0
            .word $2000
            .word $9B00         ; at most up to $BAFF
            .word 0
p_close:    .byte 1,0
path:       .byte 9
            .text "U1.SYSTEM"

nmi_proxy:  .byte $EE,$FE,$CA,$2C,$06,$C0,$48,$DA,$4C,$A9,$B6
            .byte $CE,$FE,$CA,$D0,$03,$2C,$07,$C0
msg_rom:    .byte $8D
            .text "U1.PRG NEEDS THE 3RIC ROM DOS"
            .byte $8D,0
msg_sys:    .byte $8D
            .text "U1: U1SYSTEM NOT FOUND"
            .byte $8D,0
loader_end:
