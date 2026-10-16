; Ultima II for 3RIC - loader (U2.PRG). From the ROM DOS prompt, in the
; folder that holds U2.PRG and the PROGRAM, PLAYER and GALACTIC folders:
;
;     BRUN U2.PRG 0800
;
; It stands in for the Ultima II boot disk's DOS 3.3: turns the BASIC ROM
; overlay off (the game uses RAM up to $95FF), installs the DOS command
; translator at $9600 as the output hook (CSW), selects the PROGRAM folder
; and runs HELLO through the translator, as the boot disk's DOS did.

COUT        = $FDED
DOS_HOOK    = $03EA             ; ROM DOS: JSR hook_buffer_no_output; RTS
RES_SRC     = $0900             ; resident image in U2.PRG

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
        lda #<RES_SRC           ; copy RES_PAGES pages to RES_ORG
        sta $00
        lda #>RES_SRC
        sta $01
        lda #<RES_ORG
        sta $02
        lda #>RES_ORG
        sta $03
        ldx #RES_PAGES
        ldy #0
copy_res:
        lda ($00),y
        sta ($02),y
        iny
        bne copy_res
        inc $01
        inc $03
        dex
        bne copy_res

        lda $36                 ; output hook before the port (error path)
        sta RES_ORIGCSW
        lda $37
        sta RES_ORIGCSW+1
        jsr DOS_HOOK            ; CSW = ROM DOS command collector
        lda $36
        sta RES_ROMCSW
        lda $37
        sta RES_ROMCSW+1
        lda #<RES_ORG           ; CSW = the translator
        sta $36
        lda #>RES_ORG
        sta $37
        ldx #$FF
        txs
        bit $C051               ; text, page 1, as after a DOS 3.3 boot
        bit $C054
        lda #1                  ; PROGRAM folder
        jsr RES_ORG+3
        stz $6000               ; if HELLO fails to load, BRUN meets a BRK
        ldx #0
boot:                           ; Ctrl-D BRUN HELLO through the translator
        lda cmd_hello,x
        jsr COUT
        inx
        cmp #$8D
        bne boot
        brk                     ; not reached: BRUN jumps to HELLO

msg_rom:    .byte $8D
            .text "U2.PRG NEEDS THE 3RIC ROM DOS"
            .byte $8D,0
cmd_hello:  .byte $84
            .text "BRUN HELLO"
            .byte $8D
loader_end:
