; M.U.L.E. for 3RIC - loader (MULE.PRG). From the ROM DOS prompt, in the
; folder the converter wrote:
;
;     BRUN MULE.PRG 2000
;
; Loads the pieces with ROM DOS FLOADs (one file each: FLOAD skips to a
; start offset byte by byte), puts the language-card images in place, and
; enters the last stage (rt.s boot_final, in RAM2) once no ROM call is left.
;
;   WIN.BIN  game $2000-$3FFF, moved -> LC $E000-$FFFF (with the vectors)
;   RTB2.BIN runtime, LC bank 2 $D000-$DFFF (register file, core, FP)
;   RTB1.BIN renderer, LC bank 1 $D000-$DFFF
;   RAM2.BIN font and bank-neutral runtime -> $C800-$CFFF (staged)
;   LOW.BIN  runtime pages $0300 and $0600-$08FF (staged)
;   CFG.BIN  $0000-$0FFF as the intro hands it to the main game (staged)
;   G1.BIN   game $1000-$1FFF
;   G2.BIN   game $4000-$B07F
;
; The converter prepends: BOOT_FINAL, the expected last byte of every file
; (LAST_WIN ... LAST_G2) and the command strings below.

COUT        = $FDED
SETVID      = $FE93
DOS_HOOK    = $03EA             ; ROM DOS: JSR hook_buffer_no_output; RTS
MUTE_OUTPUT = $CE09
CTRL_D      = $84
CR          = $8D
TEMP        = $4000
R2_STASH    = $2400
LOW_STASH   = $2C00

        .org $2000

        cld
        lda COUT                ; COUT must be JMP ($0036)
        cmp #$6C
        bne bad_rom
        lda COUT+1
        cmp #$36
        bne bad_rom
        lda DOS_HOOK            ; and the ROM DOS hook installed
        cmp #$20
        beq rom_ok
bad_rom:
        ldx #msg_rom-msgs
        jmp fail
rom_ok:
        bit $C007               ; BASIC ROM off: $9000-$BFFF is RAM
        lda $36
        sta savecsw
        lda $37
        sta savecsw+1
        jsr DOS_HOOK
        lda #$80
        sta MUTE_OUTPUT

        ldx #0                  ; WIN.BIN -> $E000 via TEMP
        jsr load
        lda $C081               ; read ROM, write bank 2 (and $E000-$FFFF)
        lda $C081
        lda #>TEMP
        ldx #$E0
        ldy #32
        jsr copy
        ldx #1                  ; RTB2.BIN -> bank 2
        jsr load
        lda $C081
        lda $C081
        lda #>TEMP
        ldx #$D0
        ldy #16
        jsr copy
        ldx #2                  ; RTB1.BIN -> bank 1
        jsr load
        lda $C089               ; read ROM, write bank 1
        lda $C089
        lda #>TEMP
        ldx #$D0
        ldy #16
        jsr copy
        lda $C082               ; ROM, write-protected
        ldx #3                  ; RAM2, LOW, CFG staged; G1 and G2 in place
nxt:    phx
        jsr load
        plx
        inx
        cpx #NPIECES
        bne nxt

        lda savecsw
        sta $36
        lda savecsw+1
        sta $37
        stz MUTE_OUTPUT
        sei                     ; no ROM from here on
        lda #>R2_STASH
        ldx #$C8
        ldy #8
        jsr copy
        lda #>LOW_STASH
        ldx #$03
        ldy #1
        jsr copy
        lda #>(LOW_STASH+$100)
        ldx #$06
        ldy #3
        jsr copy
        lda $C083               ; language card bank 2, read/write
        lda $C083
        jmp BOOT_FINAL

; Copy Y pages from page A to page X.
copy:   sta cp1+2
        stx cp2+2
cp0:    ldx #0
cp1:    lda $FF00,x
cp2:    sta $FF00,x
        inx
        bne cp1
        inc cp1+2
        inc cp2+2
        dey
        bne cp0
        rts

; FLOAD piece X; check its last byte arrived.
load:   stx piece
        lda last_lo,x
        sta ld_chk+1
        sta ld_set+1
        lda last_hi,x
        sta ld_chk+2
        sta ld_set+2
        lda last_val,x
        eor #$FF
ld_set: sta $FFFF               ; a missing file must not look loaded
        lda #CTRL_D
        jsr COUT
        ldx piece
        ldy cmd_off,x
ld1:    lda cmds,y
        beq ld2
        jsr COUT
        iny
        bne ld1
ld2:    lda #CR
        jsr COUT
        ldx piece
        lda last_val,x
ld_chk: cmp $FFFF
        bne missing
        rts
missing:
        ldx #msg_missing-msgs
fail:   phx
        lda savecsw
        sta $36
        lda savecsw+1
        sta $37
        stz MUTE_OUTPUT
        jsr SETVID
        lda #CR
        jsr COUT
        plx
fl1:    lda msgs,x
        beq fl2
        ora #$80
        jsr COUT
        inx
        bne fl1
fl2:    lda #CR
        jsr COUT
        brk

savecsw:    .word 0
piece:      .byte 0
msgs:
msg_rom:    .byte "MULE NEEDS THE 3RIC ROM DOS",0
msg_missing: .byte "A MULE FILE IS MISSING OR SHORT (CD TO THE MULE FOLDER)",0
loader_tables:
