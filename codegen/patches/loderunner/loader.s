; Lode Runner for 3RIC - loader (LR.PRG). From the ROM DOS prompt, in the
; LODERUN folder:
;
;     BRUN LR.PRG 0800
;
; Checks the ROM interfaces the port relies on and that the Mockingboard
; answers, captures the ROM DOS command collector (from the $03EA hook),
; then copies stage 2 (stage2.s) to $8C00, above where the game loads, and
; runs it. The tool appends stage 2's image (STAGE2_IMAGE, STAGE2_PAGES)
; and defines S2_CSW, the collector variable inside stage 2.

COUT1       = $FDF0
SETKBD      = $FE89
SETVID      = $FE93
DOS_HOOK    = $03EA             ; ROM DOS: JSR hook_buffer_no_output; RTS
MUTE_OUTPUT = $CE09
MB1_DDRA    = $C403
MB2_DDRA    = $C483
STAGE2      = $8C00

        .org $0800

        cld
        sei
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
        ldx #0                  ; both Mockingboard VIAs answer
mb_chk: lda mb_pat,x
        sta MB1_DDRA
        sta MB2_DDRA
        cmp MB1_DDRA
        bne no_mb
        cmp MB2_DDRA
        bne no_mb
        inx
        cpx #2
        bne mb_chk
        ldx #0
copy:   lda STAGE2_IMAGE,x      ; stage 2 -> $8C00
        sta STAGE2,x
        lda STAGE2_IMAGE+$100,x
        sta STAGE2+$100,x
        inx
        bne copy
        lda MUTE_OUTPUT
        pha
        jsr DOS_HOOK            ; CSW = the ROM DOS command collector
        lda $36
        sta S2_CSW
        lda $37
        sta S2_CSW+1
        pla
        sta MUTE_OUTPUT
        jsr SETVID              ; COUT and RDKEY back to screen/keyboard
        jsr SETKBD
        jmp STAGE2

bad_rom:
        ldx #0
        bra fail
no_mb:  ldx #msg_mb-msg_rom
fail:   lda msg_rom,x
        beq fail_done
        ora #$80
        jsr COUT1
        inx
        bne fail
fail_done:
        brk                     ; BRUN enters with JMP: no return address

mb_pat:     .byte $55,$AA
nmi_proxy:  .byte $EE,$FE,$CA,$2C,$06,$C0,$48,$DA,$4C,$A9,$B6
            .byte $CE,$FE,$CA,$D0,$03,$2C,$07,$C0
msg_rom:    .byte $8D
            .text "LR.PRG NEEDS THE 3RIC ROM DOS"
            .byte $8D,0
msg_mb:     .byte $8D
            .text "LR.PRG NEEDS THE 3RIC MOCKINGBOARD"
            .byte $8D,0
