; Alternate Reality for 3RIC - loader (CITY.PRG / DUNGEON.PRG). From the ROM
; DOS prompt, in the folder holding the disk images:
;
;     BRUN CITY.PRG 6000        or        BRUN DUNGEON.PRG 6000
;
; It installs the resident page at $CF00, finds the game's disk images on
; the card, then does what the game's boot sector did (game_boot, appended
; by the converter from boot-city.s or boot-dungeon.s): load track 0, copy
; the monitor ROM into language-card RAM, enter the game's loader.
;
; Disk access during play bypasses the ROM DOS: the SD shim reads 512-byte
; card sectors with the ROM's sd_readsector/sd_writesector, so each image
; must be contiguous on the card. The loader learns a file's first cluster
; from the ROM's FAT32 variables after an FLOAD of its first 256 bytes,
; checks that the computed sector really holds those bytes, and walks the
; FAT to prove the chain is unbroken. All FLOADs come first: the raw reads
; reuse the ROM's sector buffer at $C800 and no DOS command follows them.
;
; The converter prepends: SDSUM (16-bit sum of the ROM's $E141-$E279),
; SETVEC (resident routine pointing the RAM vectors at the resident),
; RES_LEN, NFILES; it appends names, f_vols, cur_init, game_boot and
; res_image. The loader runs at $6000-$6FFF with scratch pages at $7000:
; neither game's boot code touches them before it starts loading.

COUT        = $FDED
SETVID      = $FE93
DOS_HOOK    = $03EA             ; ROM DOS: JSR hook_buffer_no_output; RTS
MUTE_OUTPUT = $CE09
SD_READ     = $E1B9
ZLBA        = $B0
ZBUF        = $B8
FAT_START   = $CC00             ; ROM FAT32 variables (32-bit, little-endian)
DATA_START  = $CC04
FILE_CL     = $CC18
FAT_SPC     = $CC32             ; sectors per cluster (power of two)
SDBUF       = $C800
SCRATCH     = $7000             ; first 256 bytes of each file, one page each
RES_ORG     = $CF00
PORT_VOL    = $CFE0
PORT_CUR    = $CFE5
PORT_N      = $CFE7
PORT_BASE   = $CFE8
DSK_SECTORS = 280               ; 512-byte card sectors per 140 KB image
CTRL_D      = $84
CR          = $8D

        .org $6000

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
        stz sum                 ; the SD routines the shim calls
        stz sum+1
        ldx #0
sum_lo:
        lda $E141,x             ; $E141-$E240
        jsr add_sum
        inx
        bne sum_lo
sum_hi:
        lda $E241,x             ; $E241-$E279
        jsr add_sum
        inx
        cpx #$39
        bne sum_hi
        lda sum
        cmp #<SDSUM
        bne bad_rom
        lda sum+1
        cmp #>SDSUM
        beq rom_ok
bad_rom:
        ldx #msg_rom-msgs
        jmp fail

add_sum:
        clc
        adc sum
        sta sum
        bcc as_done
        inc sum+1
as_done:
        rts

rom_ok:
        stz $CAFE               ; ROM NMI nest count 0, so its exit keeps BASIC off
        bit $C007               ; BASIC ROM off: $9000-$BFFF is RAM
        ldx #0
copy_res:
        lda res_image,x
        sta RES_ORG,x
        inx
        cpx #RES_LEN
        bne copy_res
        ldx #PORT_BASE+20-PORT_VOL-1
clr_port:
        stz PORT_VOL,x
        dex
        bpl clr_port

        ; ---- 1. FLOAD the first 256 bytes of each file, keep its FAT facts
        lda $36
        sta savecsw
        lda $37
        sta savecsw+1
        jsr DOS_HOOK            ; CSW = ROM DOS command collector
        lda #$80
        sta MUTE_OUTPUT
        stz fidx
fl_loop:
        lda fidx
        clc
        adc #>SCRATCH
        sta fl_clr+2
        sta cmd_page            ; destination page, as two hex digits
        ldy #0
        tya
fl_clr:
        sta SCRATCH,y           ; a missing file must not look loaded
        iny
        bne fl_clr
        ldx #3
fl_z:
        stz FILE_CL,x
        dex
        bpl fl_z
        lda #CTRL_D
        jsr COUT
        ldx #0
fl_s1:
        lda s_fload,x
        beq fl_name
        jsr COUT
        inx
        bne fl_s1
fl_name:
        jsr name_ptr
fl_s2:
        lda names,x
        beq fl_addr
        jsr COUT
        inx
        bne fl_s2
fl_addr:
        lda #' '
        jsr COUT
        lda cmd_page
        lsr a
        lsr a
        lsr a
        lsr a
        jsr hexdig
        lda cmd_page
        and #$0F
        jsr hexdig
        ldx #0
fl_s3:
        lda s_range,x
        beq fl_go
        jsr COUT
        inx
        bne fl_s3
fl_go:
        lda #CR
        jsr COUT
        lda fidx                ; keep this file's FAT facts
        asl a
        asl a
        tay
        ldx #0
fl_keep:
        lda FILE_CL,x
        sta f_clus,y
        iny
        inx
        cpx #4
        bne fl_keep
        inc fidx
        lda fidx
        cmp #NFILES
        beq fl_done
        jmp fl_loop
fl_done:
        ldx #3                  ; shared by all files
fl_vol:
        lda FAT_START,x
        sta fatstart,x
        lda DATA_START,x
        sta datastart,x
        dex
        bpl fl_vol
        lda FAT_SPC
        sta spc
        stz MUTE_OUTPUT
        lda savecsw
        sta $36
        lda savecsw+1
        sta $37

        ; ---- 2. locate and prove each file with raw sector reads
        stz fidx
loc_loop:
        lda fidx
        asl a
        asl a
        tay
        ldx #0
lc_get:
        lda f_clus,y
        sta clus,x
        iny
        inx
        cpx #4
        bne lc_get
        lda clus+1              ; a cluster number below 2 means FLOAD failed
        ora clus+2
        ora clus+3
        bne lc_have
        lda clus
        cmp #2
        bcs lc_have
        jmp missing
lc_have:
        ; base = datastart + (clus - 2) * spc
        sec
        lda clus
        sbc #2
        sta base
        lda clus+1
        sbc #0
        sta base+1
        lda clus+2
        sbc #0
        sta base+2
        lda clus+3
        sbc #0
        sta base+3
        lda spc
lc_mul:
        lsr a
        beq lc_mdone
        asl base
        rol base+1
        rol base+2
        rol base+3
        bra lc_mul
lc_mdone:
        clc
        lda base
        adc datastart
        sta base
        lda base+1
        adc datastart+1
        sta base+1
        lda base+2
        adc datastart+2
        sta base+2
        lda base+3
        adc datastart+3
        sta base+3
        jsr read_base           ; that sector must start with the FLOADed bytes
        lda fidx
        clc
        adc #>SCRATCH
        sta lc_cmp+2
        ldy #0
lc_cmp_l:
        lda SDBUF,y
lc_cmp:
        cmp SCRATCH,y
        bne bad_place
        iny
        bne lc_cmp_l
        jsr walk_chain
        bcs bad_frag
        lda fidx                ; base and volume where the shim looks
        tax
        lda f_vols,x
        sta PORT_VOL,x
        txa
        asl a
        asl a
        tay
        ldx #0
lc_put:
        lda base,x
        sta PORT_BASE,y
        iny
        inx
        cpx #4
        bne lc_put
        inc fidx
        lda fidx
        cmp #NFILES
        beq located
        jmp loc_loop

bad_place:
        ldx #msg_place-msgs
        bra fail_name
bad_frag:
        ldx #msg_frag-msgs
        bra fail_name
missing:
        ldx #msg_missing-msgs
fail_name:
        phx
        jsr SETVID
        lda #CR
        jsr COUT
        jsr name_ptr
fn_loop:
        lda names,x
        beq fn_done
        ora #$80
        jsr COUT
        inx
        bne fn_loop
fn_done:
        plx
        bra fail_msg
fail:
        phx
        jsr SETVID
        lda #CR
        jsr COUT
        plx
fail_msg:
        lda msgs,x
        beq fail_end
        ora #$80
        jsr COUT
        inx
        bne fail_msg
fail_end:
        lda #CR
        jsr COUT
        brk                     ; BRUN enters with JMP: no return address

located:
        lda #NFILES
        sta PORT_N
        lda cur_init
        sta PORT_CUR
        lda cur_init+1
        sta PORT_CUR+1
        jmp game_boot

; X = offset of the current file's name in names.
name_ptr:
        ldx #0
        ldy fidx
np_loop:
        dey
        bmi np_done
np_skip:
        lda names,x
        inx
        cmp #0
        bne np_skip
        bra np_loop
np_done:
        rts

hexdig:
        ora #'0'
        cmp #'9'+1
        bcc hd_out
        adc #6
hd_out:
        jmp COUT

; Read SD sector base into SDBUF.
read_base:
        ldx #3
rb_loop:
        lda base,x
        sta ZLBA,x
        dex
        bpl rb_loop
read_lba:
        lda #<SDBUF
        sta ZBUF
        lda #>SDBUF
        sta ZBUF+1
        jmp SD_READ

; Raw read (no data mask) of track 0, sector A of image 0 into page X.
read_t0:
        stx rt_dst+2
        pha
        lsr a                   ; card sector = base + S/2
        clc
        adc PORT_BASE
        sta ZLBA
        lda PORT_BASE+1
        adc #0
        sta ZLBA+1
        lda PORT_BASE+2
        adc #0
        sta ZLBA+2
        lda PORT_BASE+3
        adc #0
        sta ZLBA+3
        jsr read_lba
        pla
        lsr a                   ; carry = second half
        lda #>SDBUF
        adc #0
        sta rt_src+2
        ldy #0
rt_copy:
rt_src:
        lda SDBUF,y
rt_dst:
        sta $FF00,y
        iny
        bne rt_copy
        rts

; Prove clus, clus+1, ... is the file's whole FAT chain: each entry points to
; the next cluster and the last one is end-of-chain. Carry set if not.
walk_chain:
        lda #$FF                ; no FAT sector cached
        sta fatsec+3
        lda #<DSK_SECTORS       ; every file is a 140 KB image
        sta left
        lda #>DSK_SECTORS
        sta left+1
wc_loop:
        sec                     ; left -= spc
        lda left
        sbc spc
        sta left
        lda left+1
        sbc #0
        sta left+1
        bcc wc_last             ; this cluster holds the end of the file
        ora left
        beq wc_last
        jsr fat_entry           ; more to come: entry must be clus+1
        inc clus
        bne wc_cmp
        inc clus+1
        bne wc_cmp
        inc clus+2
        bne wc_cmp
        inc clus+3
wc_cmp:
        ldx #3
wc_c:
        lda entry,x
        cmp clus,x
        bne wc_bad
        dex
        bpl wc_c
        bra wc_loop
wc_last:
        jsr fat_entry           ; end of chain: $0FFFFFF8-$0FFFFFFF
        lda entry+3
        cmp #$0F
        bne wc_bad
        lda entry+2
        and entry+1
        cmp #$FF
        bne wc_bad
        lda entry
        cmp #$F8
        bcc wc_bad
        clc
        rts
wc_bad:
        sec
        rts

; entry = FAT[clus] (32-bit). Sector fatstart + clus/128, offset (clus%128)*4.
fat_entry:
        lda clus                ; t = clus << 1, sector index = t >> 8
        asl a
        lda clus+1
        rol a
        sta tmp
        lda clus+2
        rol a
        sta tmp+1
        lda clus+3
        rol a
        sta tmp+2
        clc
        lda fatstart
        adc tmp
        sta tmp
        lda fatstart+1
        adc tmp+1
        sta tmp+1
        lda fatstart+2
        adc tmp+2
        sta tmp+2
        lda fatstart+3
        adc #0
        sta tmp+3
        ldx #3
fe_same:
        lda tmp,x
        cmp fatsec,x
        bne fe_read
        dex
        bpl fe_same
        bra fe_pick
fe_read:
        ldx #3
fe_set:
        lda tmp,x
        sta fatsec,x
        sta ZLBA,x
        dex
        bpl fe_set
        jsr read_lba
fe_pick:
        lda clus                ; offset = (clus & $7F) * 4
        and #$7F
        asl a
        asl a
        tax                     ; low byte; carry = upper half of the sector
        lda #>SDBUF
        adc #0
        sta fe_get+2
        ldy #0
fe_copy:
fe_get:
        lda SDBUF,x
        sta entry,y
        inx
        iny
        cpy #4
        bne fe_copy
        lda entry+3             ; FAT32: the top four bits are reserved
        and #$0F
        sta entry+3
        rts

s_fload:    .asciiz "FLOAD "
s_range:    .asciiz "00 0000 00FF"
nmi_proxy:  .byte $EE,$FE,$CA,$2C,$06,$C0,$48,$DA,$4C,$A9,$B6
msgs:
msg_rom:    .byte "NEEDS THE 3RIC ROM (DOS AND SD ROUTINES)",0
msg_missing: .byte " IS MISSING (CD TO THE GAME FOLDER)",0
msg_place:  .byte ": CANNOT LOCATE ON THE CARD",0
msg_frag:   .byte " IS FRAGMENTED: COPY THE FOLDER TO A FRESH CARD",0

savecsw:    .word 0
sum:        .word 0
fidx:       .byte 0
cmd_page:   .byte 0
spc:        .byte 0
fatstart:   .res 4
datastart:  .res 4
f_clus:     .res 20
clus:       .res 4
base:       .res 4
entry:      .res 4
fatsec:     .res 4
tmp:        .res 4
left:       .word 0
