; M.U.L.E. for 3RIC - loader (MULE.PRG). From the ROM DOS prompt, in the
; folder the converter wrote:
;
;     BRUN MULE.PRG 2000
;
; Works through the converter's piece table (port-mule.mjs SEQUENCE) with
; ROM DOS FLOADs (one file each: FLOAD skips to a start offset byte by
; byte). A piece's kind says where it goes:
;   0  in place
;   1  staged at TEMP, then into language-card bank 2 ($D000, 4 KB)
;   2  staged at TEMP, then into bank 1 ($D000, 4 KB)
;   3  staged at TEMP, then into $E000-$FFFF (8 KB, with the vectors)
;   4  no file: run the intro (intro.s). snap_take saves what the ROM DOS
;      and this loader need; the intro's warm start puts it back, stashes
;      the players' choices ($0000-$0FFF) at $3000 and returns here again.
; Phase 1 loads the runtime, the intro's renderer, its OS layer and the
; intro and runs it; phase 2 loads the main game, its renderer and the
; runtime's RAM2 and low pages (staged), then enters rt.s boot_final, in
; language-card bank 2, once no ROM call is left.
;
; The converter prepends BOOT_FINAL, SNAP_TAKE, INTRO_LAUNCH and TEMP and
; appends the tables: command offsets, each file's expected last byte, the
; kinds and the command strings.

COUT        = $FDED
SETVID      = $FE93
DOS_HOOK    = $03EA             ; ROM DOS: JSR hook_buffer_no_output; RTS
MUTE_OUTPUT = $CE09
CTRL_D      = $84
CR          = $8D
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

        ldx #0
nxt:    stx piece
        lda p_kind,x
        cmp #4
        beq run_intro
        jsr load
        ldx piece
        lda p_kind,x
        beq nx1
        jsr lcput
nx1:    ldx piece
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

run_intro:
        jsr SNAP_TAKE           ; carry clear now; set when the intro is done
        bcs nx1
        jmp INTRO_LAUNCH

; Piece of kind A (1-3) from TEMP into the language card.
lcput:  cmp #2
        bne lp1
        lda $C089               ; read ROM, write bank 1
        lda $C089
        ldx #$D0
        ldy #16
        bra lp3
lp1:    pha
        lda $C081               ; read ROM, write bank 2 (and $E000-$FFFF)
        lda $C081
        ldx #$D0
        ldy #16
        pla
        cmp #3
        bne lp3
        ldx #$E0
        ldy #32
lp3:    lda #>TEMP
        jsr copy
        lda $C082               ; ROM, write-protected
        rts

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
        lda cmd_lo,x
        sta ld1+1
        lda cmd_hi,x
        sta ld1+2
        ldy #0
ld1:    lda $FFFF,y
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
