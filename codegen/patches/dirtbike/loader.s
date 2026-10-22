; Dirt Bike for 3RIC - loader (DIRTBIKE.PRG). From the ROM DOS prompt, in
; the folder that holds it and the game files:
;
;     BRUN DIRTBIKE.PRG 0800
;
; Stands in for the disk's HELLO, which did BRUN DIRTBIKE: turns the BASIC
; overlay off so $9000-$BFFF is RAM, copies the resident (resident.s) to
; $B704, DOS 3.3's old RWTS space, and the patched game to $6000-$957E,
; then starts it at $6000 as DOS 3.3's BRUN did. Everything after that is
; the game's own code, apart from the patched calls into the resident.
;
; The tool defines RES_IMAGE/RES_SIZE and GAME_IMAGE/GAME_SIZE (where the
; resident and the game sit in this file), ROMCSW and TIMER_INIT (resident
; symbols).

COUT1       = $FDF0             ; print A to the screen, bypassing CSW
SETKBD      = $FE89
SETVID      = $FE93
DOS_HOOK    = $03EA             ; ROM DOS: JSR hook_buffer_no_output; RTS
MUTE_OUTPUT = $CE09
NMI_NEST    = $CAFE             ; ROM NMI proxy nest count
RES_ORG     = $B704
GAME_ORG    = $6000
SRC         = $00               ; copy pointers (the game sets up its own
DST         = $02               ; zero page)
CNT         = $04

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
        ldx #2                  ; the DOS entry the menu's QUIT returns to
dos_chk:
        lda $EDBC,x
        cmp dos_entry,x
        bne bad_rom
        dex
        bpl dos_chk
        bra rom_ok
bad_rom:
        ldx #0
br_loop:
        lda msg_rom,x
        beq br_done
        ora #$80
        jsr COUT1
        inx
        bne br_loop
br_done:
        brk                     ; BRUN enters with JMP: no return address

rom_ok:
        sei                     ; the game never uses IRQs; NMIs still run
        stz NMI_NEST            ; so every NMI exit selects RAM at $9000-$BFFF
        bit $C007               ; BASIC ROM off: $9000-$BFFF is RAM
        lda #<RES_IMAGE
        sta SRC
        lda #>RES_IMAGE
        sta SRC+1
        lda #<RES_ORG
        sta DST
        lda #>RES_ORG
        sta DST+1
        lda #<RES_SIZE
        sta CNT
        lda #>RES_SIZE
        sta CNT+1
        jsr copy
        lda #<GAME_IMAGE
        sta SRC
        lda #>GAME_IMAGE
        sta SRC+1
        lda #<GAME_ORG
        sta DST
        lda #>GAME_ORG
        sta DST+1
        lda #<GAME_SIZE
        sta CNT
        lda #>GAME_SIZE
        sta CNT+1
        jsr copy
        ldx DST                 ; clear the rest of the game's last page: the
        beq cleared             ; game copies three bytes past its end into
        ldy #0                  ; the text page, so make them deterministic
        lda #0
clear:
        sta (DST),y
        iny
        inx
        bne clear
cleared:

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
        jsr TIMER_INIT          ; Mockingboard Timer 1 for Apple II speed
        ldx #$FF
        txs
        jmp GAME_ORG

; Copy CNT bytes from (SRC) to (DST), upwards; leaves DST just past the end.
copy:
        ldy #0
cp_loop:
        lda CNT
        ora CNT+1
        beq cp_done
        lda (SRC),y
        sta (DST),y
        inc SRC
        bne cp_s
        inc SRC+1
cp_s:
        inc DST
        bne cp_d
        inc DST+1
cp_d:
        lda CNT
        bne cp_c
        dec CNT+1
cp_c:
        dec CNT
        bra cp_loop
cp_done:
        rts

nmi_proxy:  .byte $EE,$FE,$CA,$2C,$06,$C0,$48,$DA,$4C,$A9,$B6
            .byte $CE,$FE,$CA,$D0,$03,$2C,$07,$C0
dos_entry:  .byte $20,$32,$ED   ; dos: JSR install_dos_hook
msg_rom:    .byte $8D
            .text "DIRTBIKE.PRG NEEDS THE 3RIC ROM DOS"
            .byte $8D,0
loader_end:
