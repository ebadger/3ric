; Merlin-8 for 3RIC - loader (MERLIN.PRG). From the ROM DOS prompt, in the
; folder that holds MERLIN.PRG, MERLIN.SYS, PARMS and ED:
;
;     BRUN MERLIN.PRG 0800
;
; Stands in for the ProDOS boot:
;   1. checks the ROM routines and variables the stand-in relies on (sums of
;      their code, taken from the repository ROM by port-merlin8.mjs);
;   2. installs the ProDOS stand-in (prodos.s) at STANDIN, its global page
;      at $BF00 and the NMI resident (resident.s) at $CF00;
;   3. records the card's geometry (sectors per cluster, last cluster, the
;      FSInfo free-cluster hint) and makes the folder it ran from the
;      ProDOS prefix (/SD/...), walking ".." entries up to the root;
;   4. loads MERLIN.SYS (MERLIN.SYSTEM, patched by port-merlin8.mjs) at
;      $2000 through the stand-in and starts it as ProDOS starts a SYS file.
;
; port-merlin8.mjs defines the image addresses (IMG_*), the stand-in's
; symbols (S_*) and the ROM check table rom_sums.

COUT1       = $FDF0
SETKBD      = $FE89
SETVID      = $FE93
DOS_PROMPT  = $EDE7
NMI_NEST    = $CAFE             ; ROM NMI proxy nest count
DATASTART   = $CC04
ROOTCL      = $CC08
CDCL        = $CC20             ; ROM current directory cluster
SPC         = $CC32
MLI         = $BF00
CBUF        = $AE00

SRC         = $00               ; loader zero page
DST         = $02
LEN         = $04
SUM1        = $06
SUM2        = $07
PIDX        = $08
CUR         = $10               ; 4: directory being named
PAR         = $14               ; 4: its parent
TMP         = $18               ; 4

        .org $0800

        cld
        ldx #0                  ; ROM fingerprints
rc_lp:  lda rom_sums,x
        sta SRC
        ora rom_sums+1,x
        beq rc_ok
        lda rom_sums+1,x
        sta SRC+1
        stz SUM1
        stz SUM2
rc_b:   lda (SRC)
        clc
        adc SUM1
        sta SUM1
        clc
        adc SUM2
        sta SUM2
        lda SRC
        cmp rom_sums+2,x
        bne rc_inc
        lda SRC+1
        cmp rom_sums+3,x
        beq rc_cmp
rc_inc: inc SRC
        bne rc_b
        inc SRC+1
        bra rc_b
rc_cmp: lda SUM1
        cmp rom_sums+4,x
        bne bad_rom
        lda SUM2
        cmp rom_sums+5,x
        bne bad_rom
        txa
        clc
        adc #6
        tax
        bra rc_lp
bad_rom: lda #<msg_rom
        ldy #>msg_rom
        jmp fail

rc_ok:  stz NMI_NEST            ; every NMI exit leaves BASIC off
        bit $C007               ; $9000-$BFFF is RAM
        lda #<IMG_SA            ; the stand-in
        ldx #>IMG_SA
        ldy #>S_STANDIN
        jsr setcopy
        lda #<(S_CODE_END-S_STANDIN)
        sta LEN
        lda #>(S_CODE_END-S_STANDIN)
        sta LEN+1
        jsr copy
        lda DST                 ; its variables start cleared
        sta SRC
        lda DST+1
        sta SRC+1
        ldy #0
cl_lp:  lda #0
        sta (SRC),y
        inc SRC
        bne cl_ck
        inc SRC+1
cl_ck:  lda SRC
        cmp #<S_VARS_END
        bne cl_lp
        lda SRC+1
        cmp #>S_VARS_END
        bne cl_lp
        lda #<IMG_GP            ; the global page
        ldx #>IMG_GP
        ldy #$BF
        jsr setcopy
        stz LEN
        lda #1
        sta LEN+1
        jsr copy
        lda #<IMG_RES           ; the NMI resident
        ldx #>IMG_RES
        ldy #$CF
        jsr setcopy
        lda #RES_SIZE
        sta LEN
        stz LEN+1
        jsr copy

        lda SPC                 ; sectors per cluster: shift and mask
        dec a
        sta S_SPCMASK
        lda SPC
        ldx #0
sh_lp:  lsr a
        bcs sh_ok
        inx
        bra sh_lp
sh_ok:  stx S_SPCSHIFT

        jsr lba0                ; MBR: the FAT32 partition (type $0C)
        jsr S_GETSEC
        ldx #0
pt_lp:  lda CBUF+$1C2,x
        cmp #$0C
        beq pt_ok
        txa
        clc
        adc #16
        tax
        cmp #64
        bcc pt_lp
        lda #<msg_card
        ldy #>msg_card
        jmp fail
pt_ok:  ldy #0                  ; LBA = partition start (the boot sector)
pt_st:  lda CBUF+$1C6,x
        sta S_LBA,y
        sta TMP,y
        inx
        iny
        cpy #4
        bne pt_st
        txa                     ; TMP = start + size (end of partition)
        tay
        ldx #0
        clc
pt_end: lda TMP,x
        adc CBUF+$1C6,y
        sta TMP,x
        iny
        inx
        txa
        eor #4
        bne pt_end
        ldx #0                  ; maxcl = (end - DATASTART) >> shift + 1
        ldy #4
        sec
mc_sub: lda TMP,x
        sbc DATASTART,x
        sta S_MAXCL,x
        inx
        dey
        bne mc_sub
        ldx S_SPCSHIFT
        beq mc_one
mc_sh:  lsr S_MAXCL+3
        ror S_MAXCL+2
        ror S_MAXCL+1
        ror S_MAXCL
        dex
        bne mc_sh
mc_one: inc S_MAXCL             ; clusters + 2 - 1
        bne hint
        inc S_MAXCL+1
        bne hint
        inc S_MAXCL+2

hint:   lda #2                  ; free-cluster hint: FSInfo, else 2
        sta S_HINT
        jsr S_GETSEC            ; boot sector (LBA = partition start)
        clc
        lda S_LBA
        adc CBUF+$30
        sta S_LBA
        lda S_LBA+1
        adc CBUF+$31
        sta S_LBA+1
        bcc fsi_rd
        inc S_LBA+2
        bne fsi_rd
        inc S_LBA+3
fsi_rd: jsr S_GETSEC
        lda CBUF+$1EC+3         ; 2 <= next free <= maxcl?
        cmp #$10
        bcs pfx
        ldx #3
fh_hi:  lda S_MAXCL,x
        cmp CBUF+$1EC,x
        bcc pfx
        bne fh_lo
        dex
        bpl fh_hi
fh_lo:  lda CBUF+$1EC+3
        ora CBUF+$1EC+2
        ora CBUF+$1EC+1
        bne fh_ok
        lda CBUF+$1EC
        cmp #2
        bcc pfx
fh_ok:  ldx #3
fh_cp:  lda CBUF+$1EC,x
        sta S_HINT,x
        dex
        bpl fh_cp

pfx:    ldx #3                  ; the prefix: the ROM's current directory
pf_cd:  lda CDCL,x
        sta CUR,x
        sta S_PREFCL,x
        dex
        bpl pf_cd
        lda #64
        sta PIDX
walk:   jsr isroot
        bne wk_up
        jmp named
wk_up:
        ldx #3                  ; its ".." entry (the second) -> parent
wk_d:   lda CUR,x
        sta S_DCL,x
        dex
        bpl wk_d
        jsr S_DIR_OPEN
        jsr S_DIR_NEXT
        jsr S_DIR_ENT
        jsr S_ENT_CL
        ldx #3
wk_p:   lda S_CCL,x
        sta PAR,x
        sta S_DCL,x
        dex
        bpl wk_p
        jsr S_DIR_OPEN          ; find CUR among the parent's directories
fn_lp:  jsr S_DIR_ENT
        jsr S_ENT_KIND
        beq deep
        cmp #3
        bne fn_nx
        ldy #11
        lda (S_T),y
        and #$10
        beq fn_nx
        jsr S_ENT_CL
        ldx #3
fn_cmp: lda S_CCL,x
        cmp CUR,x
        bne fn_nx
        dex
        bpl fn_cmp
        jsr S_FROM83            ; "NAME/" in front of the rest
        lda PIDX
        sec
        sbc S_NLEN
        bcc deep
        sbc #1
        bcc deep
        cmp #8                  ; room left for "/SD/"
        bcc deep
        sta PIDX
        tay
        ldx #0
fn_cp:  lda S_NBUF,x
        sta pbuf,y
        iny
        inx
        cpx S_NLEN
        bne fn_cp
        lda #'/'
        sta pbuf,y
        ldx #3
fn_up:  lda PAR,x
        sta CUR,x
        dex
        bpl fn_up
        jmp walk
fn_nx:  jsr S_DIR_NEXT
        bcc fn_lp
deep:   lda #<msg_dir
        ldy #>msg_dir
        jmp fail
named:  ldx #0                  ; prefix = "/SD/" + pbuf[PIDX..63]
nm_sd:  lda sdname,x
        sta S_PREFIX+1,x
        inx
        cpx #4
        bne nm_sd
        ldy PIDX
nm_cp:  cpy #64
        beq nm_end
        lda pbuf,y
        sta S_PREFIX+1,x
        inx
        iny
        bra nm_cp
nm_end: stx S_PREFIX

        jsr MLI                 ; ED loads at its aux type: tag it
        .byte $C3
        .word p_edinfo

        jsr MLI                 ; load MERLIN.SYS at $2000 like ProDOS
        .byte $C8
        .word p_open
        bcs no_sys
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
        bcs no_sys
        lda $2000               ; a ProDOS SYS file starts with JMP
        cmp #$4C
        bne no_sys
        stz $0280               ; no startup pathname
        jsr SETVID
        jsr SETKBD
        ldx #$FF
        txs
        jmp $2000
no_sys: lda #<msg_sys
        ldy #>msg_sys
fail:   sta SRC
        sty SRC+1
        ldy #0
fl_lp:  lda (SRC),y
        beq fl_x
        ora #$80
        jsr COUT1
        iny
        bne fl_lp
fl_x:   ldx #$FF
        txs
        jmp DOS_PROMPT

; Z set if CUR is the root directory (0 or the root cluster).
isroot: lda CUR
        ora CUR+1
        ora CUR+2
        ora CUR+3
        beq ir_x
        ldx #3
ir_lp:  lda CUR,x
        cmp ROOTCL,x
        bne ir_x
        dex
        bpl ir_lp
ir_x:   rts

lba0:   ldx #3
lz_lp:  stz S_LBA,x
        dex
        bpl lz_lp
        rts

; SRC = A/X, DST = Y * 256
setcopy: sta SRC
        stx SRC+1
        stz DST
        sty DST+1
        rts

; Copy LEN bytes from SRC to DST; DST ends past the copy.
copy:   ldy #0
cp_lp:  lda LEN
        ora LEN+1
        beq cp_x
        lda (SRC),y
        sta (DST),y
        inc SRC
        bne cp_d
        inc SRC+1
cp_d:   inc DST
        bne cp_n
        inc DST+1
cp_n:   lda LEN
        bne cp_l
        dec LEN+1
cp_l:   dec LEN
        bra cp_lp
cp_x:   rts

p_open:     .byte 3
            .word sysname
            .word CBUF          ; I/O buffer: unused by the stand-in
            .byte 0
p_read:     .byte 4,0
            .word $2000
            .word $6000
            .word 0
p_close:    .byte 1,0
p_edinfo:   .byte 7
            .word edname
            .byte $C3,$06       ; unlocked, BIN
            .word ED_ORG        ; aux type: ED's load address
            .byte 0,0,0,0,0,0,0
edname:     .byte 2
            .text "ED"
sysname:    .byte 13
            .text "MERLIN.SYSTEM"
sdname:     .text "/SD/"
msg_rom:    .byte $8D
            .text "MERLIN.PRG NEEDS THE 3RIC ROM DOS"
            .byte $8D,0
msg_card:   .byte $8D
            .text "MERLIN: NO FAT32 PARTITION"
            .byte $8D,0
msg_dir:    .byte $8D
            .text "MERLIN: FOLDER PATH TOO DEEP"
            .byte $8D,0
msg_sys:    .byte $8D
            .text "MERLIN: MERLIN.SYS NOT FOUND"
            .byte $8D,0
rom_sums:                       ; appended by port-merlin8.mjs
pbuf        = $0F00             ; 64 bytes: the prefix, built backwards
