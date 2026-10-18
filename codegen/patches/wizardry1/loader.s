; Wizardry I for 3RIC - loader (WIZ1.PRG). From the ROM DOS prompt, in the
; folder that holds WIZ1.PRG and WIZ1.VOL:
;
;     BRUN WIZ1.PRG 0800
;
; It stands in for the Apple Pascal boot blocks:
;   1. checks the ROM: COUT, the NMI proxy the resident shares state with,
;      and Fletcher sums of the SD/FAT32 code whose routines and variables
;      the glue relies on (sd_readsector, sd_writesector, the cluster->LBA
;      code that defines $CC00/$CC04/$CC32, and the directory-entry code
;      that defines $CC20 and $CC08);
;   2. finds WIZ1.VOL (exact size) among the current directory's entries
;      with sd_readsector - a failed FLOAD does not return cleanly;
;   3. installs the resident page at $CF00, fills the (otherwise unused)
;      language card with the shim ($E000), the file's cluster table
;      (CLTAB, one LBA per cluster, from the FAT chain), the bank
;      signatures and the NMI/IRQ vectors, and checks the Pascal volume
;      header in block 2 read through the shim;
;   4. reads the first 45 pages of RTSTRP.APPLE to $9200 through the BIOS
;      entry the runtime will use, checks and patches the runtime's
;      DISKREAD/DISKWRITE body, and enters it as the boot block does
;      (X = $60, ROM selected, JMP ($BEFE)).
;
; Every language-card write happens with the ROM still selected for reads,
; so an NMI during setup always finds the ROM's vectors.

COUT        = $FDED
SETVID      = $FE93
SD_READ     = $E1B9             ; ROM sd_readsector: LBA $B0-$B3 -> ($B8)
FAT_START   = $CC00             ; fat32_fatstart: LBA of the FAT
DATA_START  = $CC04             ; fat32_datastart: LBA of cluster 2
ROOT_CLUSTER = $CC08            ; fat32_rootcluster
CD_CLUSTER  = $CC20             ; zp_sd_cd_cluster: current directory (0 = root)
SPC         = $CC32             ; fat32_sectorspercluster
BIOS_OP     = $03AC
VOLBUF      = $4000             ; directory sectors, then block 2 through the shim
FATBUF      = $4400             ; one FAT sector
RT_LOAD     = $9200             ; RTSTRP.APPLE load address, 45 pages
RT_PAGES    = 45
BIOS_BODY   = $AF31             ; after LDY #op / STY $03AC

PTR         = $00               ; loader zero page
DST         = $02
CL          = $06               ; current cluster (4 bytes)
LBA         = $0A               ; computed LBA (4 bytes)
TABP        = $0E               ; CLTAB write pointer
NLEFT       = $10               ; clusters still to map (2 bytes)
FATLBA      = $12               ; FAT sector held in FATBUF (4 bytes)
SHIFT       = $16
SUM1        = $17
SUM2        = $18
SECT        = $19               ; sector within a directory cluster

        .org $0800

        cld
        lda COUT                ; COUT must be JMP ($0036)
        cmp #$6C
        bne bad_rom
        lda COUT+1
        cmp #$36
        bne bad_rom
        lda $FFFA               ; the ROM's NMI vector must differ from ours
        cmp #<NMI_ENTRY
        beq bad_rom
        ldx #10                 ; ROM NMI proxy whose receiver state the
nmi_chk:                        ; resident's PS/2 path shares
        lda $F1BB,x
        cmp nmi_proxy,x
        bne bad_rom
        dex
        bpl nmi_chk
        ldx #0
fp_range:                       ; Fletcher sums of the routines we call
        lda fptab,x
        sta PTR
        lda fptab+1,x
        sta PTR+1
        stz SUM1
        stz SUM2
fp_loop:
        lda PTR
        cmp fptab+2,x
        bne fp_add
        lda PTR+1
        cmp fptab+3,x
        beq fp_end
fp_add:
        lda (PTR)
        clc
        adc SUM1
        adc #0
        sta SUM1
        clc
        adc SUM2
        adc #0
        sta SUM2
        inc PTR
        bne fp_loop
        inc PTR+1
        bra fp_loop
fp_end:
        lda SUM1
        cmp fptab+4,x
        bne bad_rom
        lda SUM2
        cmp fptab+5,x
        bne bad_rom
        txa
        clc
        adc #6
        tax
        cpx #FP_BYTES
        bne fp_range
        bra rom_ok
bad_rom:
        ldx #msg_rom-msgs
        jmp fail
bad_vol:
        ldx #msg_vol-msgs
        jmp fail

rom_ok:
        stz $CAFE               ; ROM NMI nest count 0, so its exit keeps BASIC off
        bit $C007               ; BASIC ROM off: $9000-$BFFF is RAM
        ldx #0
copy_res:
        lda RES_SRC,x
        sta $CF00,x
        inx
        bne copy_res

        lda #$FF                ; no FAT sector held yet
        sta FATLBA
        sta FATLBA+1
        sta FATLBA+2
        sta FATLBA+3
        lda SPC                 ; sectors per cluster: a power of two
        beq bad_vol
        ldx #0
spc_bit:
        lsr a
        bcs spc_one
        inx
        bra spc_bit
spc_one:
        bne bad_vol
        stx SHIFT
        stx CLSHIFT_SRC         ; into the shim image before it is copied
        lda SPC
        dec a
        sta CLMASK_SRC
        ldx #3                  ; find WIZ1.VOL in the current directory
fv_cd:
        lda CD_CLUSTER,x
        sta CL,x
        dex
        bpl fv_cd
        lda CL
        ora CL+1
        ora CL+2
        ora CL+3
        bne fv_dir
        ldx #3                  ; cluster 0: the root directory
fv_root:
        lda ROOT_CLUSTER,x
        sta CL,x
        dex
        bpl fv_root
fv_dir:
        jsr cl_lba              ; carry: end of the directory's chain
        bcs bad_vol
        stz SECT
fv_sector:
        clc
        ldx #0
        ldy #4
        lda SECT
fv_lba:
        adc LBA,x
        sta $B0,x
        lda #0
        inx
        dey
        bne fv_lba
        lda #<VOLBUF
        sta $B8
        sta PTR
        lda #>VOLBUF
        sta $B9
        sta PTR+1
        jsr SD_READ
fv_entry:
        lda (PTR)
        beq bad_volb             ; end of the directory
        cmp #$E5                ; deleted
        beq fv_skip
        ldy #11
        lda (PTR),y
        and #$18                ; directory, volume label or long-name entry
        bne fv_skip
        ldy #10
fv_cmp:
        lda (PTR),y
        cmp vol_name,y
        bne fv_skip
        dey
        bpl fv_cmp
        bra fv_found
fv_skip:
        clc
        lda PTR
        adc #32
        sta PTR
        bcc fv_next
        inc PTR+1
fv_next:
        lda PTR+1
        cmp #>VOLBUF+2
        bne fv_entry
        inc SECT
        lda SECT
        cmp SPC
        bne fv_sector
        jsr fat_next
        bra fv_dir
fv_found:
        ldy #$1F                ; exact size
        ldx #3
fv_size:
        lda (PTR),y
        cmp vol_bytes,x
        bne bad_volb
        dey
        dex
        bpl fv_size
        ldy #$1A                ; first cluster: $1A/$1B low, $14/$15 high
        lda (PTR),y
        sta CL
        iny
        lda (PTR),y
        sta CL+1
        ldy #$14
        lda (PTR),y
        sta CL+2
        iny
        lda (PTR),y
        sta CL+3
        bra lc_setup
bad_volb:
        ldx #msg_vol-msgs
        jmp fail

lc_setup:
        lda $C089               ; read ROM, write bank 1
        lda $C089
        lda #0
        jsr clear_d000
        lda #BANKSIG_VALUE
        sta $DFFF
        lda $C081               ; read ROM, write bank 2 and $E000-$FFFF
        lda $C081
        lda #0
        jsr clear_d000
        lda #BANK2SIG_VALUE
        sta $DFFF
        lda #<SHIM_SRC          ; shim -> $E000, rest of high RAM cleared
        sta PTR
        lda #>SHIM_SRC
        sta PTR+1
        stz DST
        lda #$E0
        sta DST+1
        ldx #32
        ldy #0
copy_shim:
        lda PTR+1
        cmp #>SHIM_END_SRC
        bcc cs_byte
        lda #0
        bra cs_store
cs_byte:
        lda (PTR),y
cs_store:
        sta (DST),y
        iny
        bne copy_shim
        inc PTR+1
        inc DST+1
        dex
        bne copy_shim
        bra map_vol

bad_map:
        jmp bad_vol

map_vol:                        ; CLTAB = LBA of each cluster of WIZ1.VOL
        clc                     ; NLEFT = (VOL_BLOCKS + spc - 1) >> SHIFT
        lda #<VOL_BLOCKS
        adc CLMASK_SRC
        sta NLEFT
        lda #>VOL_BLOCKS
        adc #0
        sta NLEFT+1
        ldx SHIFT
nl_shift:
        beq nl_done
        lsr NLEFT+1
        ror NLEFT
        dex
        bra nl_shift
nl_done:
        lda #<CLTAB
        sta TABP
        lda #>CLTAB
        sta TABP+1
        lda #$FF
        sta FATLBA
        sta FATLBA+1
        sta FATLBA+2
        sta FATLBA+3
map_loop:
        jsr cl_lba
        bcs bad_map
        ldy #3
map_store:
        lda LBA,y
        sta (TABP),y
        dey
        bpl map_store
        clc
        lda TABP
        adc #4
        sta TABP
        bcc map_next
        inc TABP+1
map_next:
        lda TABP+1              ; keep clear of the vectors
        cmp #$FF
        bcs bad_map
        jsr fat_next
        lda NLEFT
        bne map_dec
        dec NLEFT+1
map_dec:
        dec NLEFT
        lda NLEFT
        ora NLEFT+1
        bne map_loop
        lda CL+3                ; the chain must end exactly here
        cmp #$0F
        bne bad_map
        lda CL+2
        and CL+1
        cmp #$FF
        bne bad_map
        lda CL
        cmp #$F8
        bcc bad_map

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
        lda $C082               ; ROM, write-protected: the boot block's state

        lda #<VOLBUF            ; block 2 through the shim: the volume header
        ldx #>VOLBUF
        ldy #2
        jsr read_block
        bne bad_vol2
        ldx #DIRSIG_LEN-1
dir_chk:
        lda VOLBUF,x
        cmp dirsig,x
        bne bad_vol2
        dex
        bpl dir_chk

        lda #1                  ; DISKREAD(block, 45 pages, $9200, unit 4)
        sta BIOS_OP
        lda #0
        pha                     ; flags
        pha
        pha                     ; drive 0 = slot 6 drive 1
        pha
        lda #>RT_LOAD
        pha
        lda #<RT_LOAD
        pha
        lda #RT_PAGES
        pha                     ; byte count high
        lda #0
        pha
        lda #>RT_BLOCK
        pha
        lda #<RT_BLOCK
        pha
        jsr DISK_ENTRY
        txa
        bne bad_rt
        ldx #rt_sig_end-rt_sig-1
rt_chk:                         ; BIOS DISKWRITE/DISKREAD bodies and table
        lda $AF28,x
        cmp rt_sig,x
        bne bad_rt
        dex
        bpl rt_chk
        ldx #5
jt_chk:
        lda $BDC5,x
        cmp jt_sig,x
        bne bad_rt
        dex
        bpl jt_chk
        lda #$4C                ; JMP disk_entry
        sta BIOS_BODY
        lda #<DISK_ENTRY
        sta BIOS_BODY+1
        lda #>DISK_ENTRY
        sta BIOS_BODY+2

        ldx #$FF
        txs
        ldx #$60                ; boot slot 6, as the Pascal boot block leaves it
        lda $C082
        jmp ($BEFE)

bad_vol2:
        ldx #msg_vol-msgs
        bra fail
bad_rt:
        ldx #msg_rt-msgs
fail:
        lda $C082               ; ROM back, report and stop in the monitor
        phx
        jsr SETVID              ; COUT to the screen again
        plx
f_loop:
        lda msgs,x
        beq f_done
        ora #$80
        jsr COUT
        inx
        bne f_loop
f_done:
        brk                     ; BRUN enters with JMP: no return address

; LBA = DATA_START + (CL - 2) << SHIFT. Carry set if CL is not a data cluster.
cl_lba:
        lda CL+3
        cmp #$10
        bcs cl_bad
        lda CL+3                ; $0FFFFFF0 and up: reserved, bad, end of chain
        cmp #$0F
        bne cl_low
        lda CL+2
        and CL+1
        cmp #$FF
        bne cl_low
        lda CL
        cmp #$F0
        bcs cl_bad
cl_low:
        lda CL+3
        ora CL+2
        ora CL+1
        bne cl_ok
        lda CL
        cmp #2
        bcc cl_bad
cl_ok:
        sec
        lda CL
        sbc #2
        sta LBA
        lda CL+1
        sbc #0
        sta LBA+1
        lda CL+2
        sbc #0
        sta LBA+2
        lda CL+3
        sbc #0
        sta LBA+3
        ldx SHIFT
cl_shift:
        beq cl_add
        asl LBA
        rol LBA+1
        rol LBA+2
        rol LBA+3
        dex
        bra cl_shift
cl_add:
        clc
        ldx #0
        ldy #4
cl_sum:
        lda LBA,x
        adc DATA_START,x
        sta LBA,x
        inx
        dey
        bne cl_sum
        clc
        rts
cl_bad:
        sec
        rts

; CL = FAT[CL] (28 bits), reading the FAT sector FAT_START + CL >> 7.
fat_next:
        lda CL
        asl a
        lda CL+1
        rol a
        sta LBA
        lda CL+2
        rol a
        sta LBA+1
        lda CL+3
        rol a
        sta LBA+2
        stz LBA+3
        clc
        ldx #0
        ldy #4
fn_sum:
        lda LBA,x
        adc FAT_START,x
        sta LBA,x
        inx
        dey
        bne fn_sum
        ldx #3
fn_cmp:
        lda LBA,x
        cmp FATLBA,x
        bne fn_read
        dex
        bpl fn_cmp
        bra fn_entry
fn_read:
        ldx #3
fn_set:
        lda LBA,x
        sta FATLBA,x
        sta $B0,x
        dex
        bpl fn_set
        lda #<FATBUF
        sta $B8
        lda #>FATBUF
        sta $B9
        jsr SD_READ
fn_entry:
        lda CL                  ; entry offset (CL & $7F) * 4
        and #$7F
        asl a
        asl a
        tay
        bcs fn_high
        ldx #0
fn_lo:
        lda FATBUF,y
        sta CL,x
        iny
        inx
        cpx #4
        bne fn_lo
        bra fn_mask
fn_high:
        ldx #0
fn_hi:
        lda FATBUF+256,y
        sta CL,x
        iny
        inx
        cpx #4
        bne fn_hi
fn_mask:
        lda CL+3
        and #$0F
        sta CL+3
        rts

; DISKREAD of one block (Y, below 256) to X:A through the BIOS entry.
; Returns the IORESULT in A (flags set).
read_block:
        sta PTR
        lda #1
        sta BIOS_OP
        pla                     ; our return address goes back on top
        sta DST
        pla
        sta DST+1
        lda #0
        pha                     ; flags
        pha
        pha                     ; drive 0
        pha
        phx                     ; buffer
        lda PTR
        pha
        lda #2                  ; 512 bytes
        pha
        lda #0
        pha
        pha                     ; block high
        phy
        jsr DISK_ENTRY
        lda DST+1
        pha
        lda DST
        pha
        txa
        rts

; Fill $D000-$DFFF of the write-selected bank with A.
clear_d000:
        ldy #$D0
        sty DST+1
        ldy #0
        sty DST
        ldx #16
cd_loop:
        sta (DST),y
        iny
        bne cd_loop
        inc DST+1
        dex
        bne cd_loop
        rts

vol_name:   .text "WIZ1    VOL"
nmi_proxy:  .byte $EE,$FE,$CA,$2C,$06,$C0,$48,$DA,$4C,$A9,$B6
rt_sig:     .byte $A0,$02,$D0,$02,$A0,$01,$8C,$AC,$03,$68,$85,$C0
rt_sig_end:
jt_sig:     .byte $4C,$28,$AF,$4C,$2C,$AF
msgs:
msg_rom:    .byte $8D
            .text "WIZ1.PRG NEEDS THE 3RIC ROM DOS"
            .byte $8D,0
msg_vol:    .byte $8D
            .text "WIZ1: WIZ1.VOL MISSING OR DAMAGED"
            .byte $8D,0
msg_rt:     .byte $8D
            .text "WIZ1: RTSTRP.APPLE UNEXPECTED"
            .byte $8D,0
; The tool appends fptab: start.w, end.w, Fletcher sum1, sum2 per range.
