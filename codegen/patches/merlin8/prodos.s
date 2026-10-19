; Merlin-8 for 3RIC - a ProDOS stand-in on the 3RIC micro-SD card (FAT32).
;
; Merlin-8 2.58 is a ProDOS-8 program: every file it touches goes through
; the MLI (JSR $BF00 / .byte cmd / .word params). This replaces ProDOS with
; a small FAT32 file layer over the ROM's sd_readsector/sd_writesector, so
; Merlin loads, saves, creates, deletes, renames and catalogs real files on
; the card the 3RIC ROM DOS also uses.
;
;   $8500-$9DB5  this code and its variables (STANDIN; ED, Merlin's editor
;                module, starts at $9DB6; port-merlin8.mjs moves Merlin's
;                source, symbol and object areas below it)
;   $AE00-$AFFF  data sector cache (Merlin only ever gives ProDOS this page
;                as a 1 KB OPEN buffer, which the stand-in never needs)
;   $B000-$B1FF  FAT sector cache
;   $BF00-$BFFF  ProDOS global page
;
; The ProDOS volume is the whole card, named /SD. Names map to FAT 8.3 by
; their last dot: PI.START.S is PISTART.S, a name without a dot has no
; extension. Files the stand-in creates keep their ProDOS type and aux type
; in the FAT entry's creation-time bytes 13-15, marked by a creation date of
; 1980-01-01 ($0021); other files are TXT ($04) if their extension is S, a
; DIR if they are directories, otherwise BIN ($06) with aux $0000.
;
; Calls follow ProDOS: A = error (0 = none), carry set on error, Z/N follow
; A, X/Y preserved. Every call runs with the ROM selected (the language card
; is put back as it was, see lc_mode in resident.s) and saves $B0-$BF, which
; it uses as scratch alongside the ROM's SD routines.

SD_READ     = $E1B9             ; ROM: read sector LBA $B0-$B3 to ($B8)
SD_WRITE    = $E21C             ; ROM: write sector LBA $B0-$B3 from ($B8)
COUT_HOOK   = $ED32             ; ROM: setup_cout_hook (ROM DOS output)
DOS_PROMPT  = $EDE7             ; ROM: newprompt (DOS '>' prompt, no remount)
SETKBD      = $FE89
SETVID      = $FE93
FATSTART    = $CC00             ; ROM fat32_fatstart: LBA of the first FAT
DATASTART   = $CC04             ; ROM fat32_datastart: LBA of cluster 2
ROOTCL      = $CC08             ; ROM fat32_rootcluster
ROMFATSEC   = $CC14             ; ROM fat32_lastsector (its FAT cache tag)
SECPERFAT   = $CC1C             ; ROM fat32_sectorsperfat
SPC         = $CC32             ; ROM fat32_sectorspercluster
NUMFATS     = $CC34             ; ROM fat32_numfats
CBUF        = $AE00             ; data sector cache
FBUF        = $B000             ; FAT sector cache

LBA         = $B0               ; 4: sector for the ROM routines
P           = $B4               ; parameter block
U           = $B6               ; caller's buffer
SBUF        = $B8               ; ROM sector buffer pointer
T           = $BA               ; directory entry / source pointer
Q           = $BC               ; path / destination pointer
W           = $BE               ; 2 bytes scratch

E_BADCALL   = $01
E_INTFULL   = $25
E_IO        = $27
E_NODEV     = $28
E_BADPATH   = $40
E_TOOMANY   = $42
E_BADREF    = $43
E_NOPATH    = $44
E_NOVOL     = $45
E_NOFILE    = $46
E_DUP       = $47
E_FULL      = $48
E_EOF       = $4C
E_RANGE     = $4D
E_ACCESS    = $4E
E_BUSY      = $50

NFCB        = 3                 ; open files
F_REF       = 0                 ; 0 = free, else ref num
F_FLAGS     = 1                 ; bit 7 directory, bit 6 entry needs update
F_FIRST     = 2                 ; 4: first cluster (0 = none)
F_CUR       = 6                 ; 4: cluster F_IDX of the file
F_IDX       = 10                ; 2: $FFFF = F_CUR not valid
F_MARK      = 12                ; 3
F_EOF       = 15                ; 3
F_DLBA      = 18                ; 4: sector holding the directory entry
F_DIDX      = 22                ; entry 0-15 in that sector ($FF: volume)
F_NLMASK    = 23
F_NLCHAR    = 24
F_DCOUNT    = 25                ; 2: directory: entries
F_NAME      = 27                ; 11: directory: 8.3 name
FCBSIZE     = 38
FCBTOT      = FCBSIZE+FCBSIZE+FCBSIZE

        .org STANDIN

mli:
        cld
        stx savx
        sty savy
        lda $FFFB               ; language card read-mapped? (its NMI
        cmp #>NMI_ENTRY         ; vector points at the resident)
        bne m_rom
        lda $FFFA
        cmp #<NMI_ENTRY
        bne m_rom
        jsr LC_MODE
        bra m_mode
m_rom:  lda #$82
m_mode: sta lcmode
        lda $C082
        ldx #15
m_save: lda LBA,x
        sta zsave,x
        dex
        bpl m_save
        pla                     ; caller's JSR address + 2
        sta T
        pla
        sta T+1
        ldy #1
        lda (T),y
        sta cmd
        iny
        lda (T),y
        sta P
        iny
        lda (T),y
        sta P+1
        tya                     ; return past the 3 inline bytes
        clc
        adc T
        tax
        lda T+1
        adc #0
        pha
        phx
        tsx
        stx spsave
        lda cmd
        ldx #0
m_find: ldy cmdtab,x
        beq m_bad
        cmp cmdtab,x
        beq m_go
        inx
        bra m_find
m_go:   txa
        asl a
        tax
        jmp (jmptab,x)
m_bad:  lda #E_BADCALL
        bra fail
ok:     lda #0
fail:   sta result
        ldx spsave
        txs
        jsr flush
        ldx #15
m_rest: lda zsave,x
        sta LBA,x
        dex
        bpl m_rest
        ldx lcmode
        lda $C000,x
        lda $C000,x
        ldx savx
        ldy savy
        lda result
        clc
        beq m_ret
        sec
m_ret:  rts

; ---------------------------------------------------------------------------
; Sector caches. getsec reads LBA into CBUF unless it is already there;
; cflush/fflush write back a modified sector (the FAT to every copy).

getsec: ldx #3
gs_cmp: lda LBA,x
        cmp clba,x
        bne gs_miss
        dex
        bpl gs_cmp
        lda cvalid
        beq gs_miss
        rts
gs_miss: jsr cflush
        ldx #3
gs_cp:  lda LBA,x
        sta clba,x
        dex
        bpl gs_cp
        jsr setcbuf
        jsr SD_READ
        lda #1
        sta cvalid
        rts

setcbuf: lda #<CBUF
        sta SBUF
        lda #>CBUF
        sta SBUF+1
        rts

; FAT sectors always reach the card before a dirty cached sector: an
; interrupted call can leak a cluster, but never leaves a directory entry
; pointing at a cluster the FAT still calls free.
flush:  jsr cflush
        jmp fflush

cflush: lda cdirty
        beq cf_x
        stz cdirty
        jsr fflush
        jsr swaplba
        jsr setcbuf
        jsr SD_WRITE
swaplba: ldx #3                 ; LBA <-> clba
sw_lp:  lda LBA,x
        ldy clba,x
        sta clba,x
        sty LBA,x
        dex
        bpl sw_lp
cf_x:   rts

fflush: lda fdirty
        beq cf_x
        stz fdirty
        ldx #3
ff_sv:  lda LBA,x
        sta lsave,x
        dex
        bpl ff_sv
        jsr fatlba
        lda NUMFATS
        sta W
ff_lp:  lda #<FBUF
        sta SBUF
        lda #>FBUF
        sta SBUF+1
        jsr SD_WRITE
        dec W
        beq ff_done
        ldx #0                  ; next FAT copy
        ldy #4
        clc
ff_add: lda LBA,x
        adc SECPERFAT,x
        sta LBA,x
        inx
        dey
        bne ff_add
        bra ff_lp
ff_done: ldx #3
ff_rs:  lda lsave,x
        sta LBA,x
        dex
        bpl ff_rs
        rts

fatlba: ldx #0                  ; LBA = FATSTART + fcur
        ldy #4
        clc
fl_lp:  lda FATSTART,x
        adc fcur,x
        sta LBA,x
        inx
        dey
        bne fl_lp
        rts

; ---------------------------------------------------------------------------
; FAT. fat_rd reads the entry of cluster fcl into fval (28 bits); fat_wr
; writes fval there (keeping the reserved top bits). T points at the entry.

fat_sec: lda fcl                ; FAT sector = fcl >> 7
        asl a
        lda fcl+1
        rol a
        sta fsec
        lda fcl+2
        rol a
        sta fsec+1
        lda fcl+3
        rol a
        sta fsec+2
        ldx #2
fs_cmp: lda fsec,x
        cmp fcur,x
        bne fs_miss
        dex
        bpl fs_cmp
        lda fvalid
        bne fs_hit
fs_miss: jsr fflush
        ldx #3
fs_sv:  lda LBA,x
        sta lsave,x
        dex
        bpl fs_sv
        ldx #2
fs_cp:  lda fsec,x
        sta fcur,x
        dex
        bpl fs_cp
        jsr fatlba
        lda #<FBUF
        sta SBUF
        lda #>FBUF
        sta SBUF+1
        jsr SD_READ
        lda #1
        sta fvalid
        ldx #3
fs_rs:  lda lsave,x
        sta LBA,x
        dex
        bpl fs_rs
fs_hit: lda fcl                 ; T = FBUF + (fcl & $7F) * 4
        and #$3F
        asl a
        asl a
        sta T
        lda fcl
        and #$40
        beq fs_lo
        lda #1
fs_lo:  clc
        adc #>FBUF
        sta T+1
        rts

fat_rd: jsr fat_sec
        ldy #3
fr_lp:  lda (T),y
        sta fval,y
        dey
        bpl fr_lp
        lda fval+3
        and #$0F
        sta fval+3
        rts

fat_wr: jsr fat_sec
        ldy #3
        lda (T),y
        and #$F0
        ora fval+3
        sta (T),y
        dey
fw_lp:  lda fval,y
        sta (T),y
        dey
        bpl fw_lp
        lda #1
        sta fdirty
        rts

; C set if fval ends a chain (end of chain, free or reserved value).
iseoc:  lda fval+3
        ora fval+2
        ora fval+1
        bne ie_hi
        lda fval
        cmp #2
        bcc ie_yes
ie_hi:  lda fval+3
        cmp #$0F
        bne ie_no
        lda fval+2
        and fval+1
        cmp #$FF
        bne ie_no
        lda fval
        cmp #$F7
        bcs ie_yes
ie_no:  clc
        rts
ie_yes: sec
        rts

; LBA = DATASTART + (ccl - 2) * sectors per cluster
cl2lba: ldx #0
        ldy #4
        sec
cl_sub: lda ccl,x
        sbc c2,x
        sta LBA,x
        inx
        dey
        bne cl_sub
        ldx spcshift
        beq cl_add
cl_sh:  asl LBA
        rol LBA+1
        rol LBA+2
        rol LBA+3
        dex
        bne cl_sh
cl_add: ldx #0
        ldy #4
        clc
cl_a:   lda LBA,x
        adc DATASTART,x
        sta LBA,x
        inx
        dey
        bne cl_a
        rts

; Allocate a free cluster (marked end of chain) from the hint: newcl.
alloc:  ldx #3
al_hn:  lda hint,x
        sta fcl,x
        dex
        bpl al_hn
        stz wrapped
al_lp:  ldx #3                  ; past the last cluster? wrap to 2 once
al_cmp: lda maxcl,x
        cmp fcl,x
        bcc al_wrap
        bne al_chk
        dex
        bpl al_cmp
        bra al_chk
al_wrap: lda wrapped
        bne al_full
        inc wrapped
        ldx #3
al_w2:  lda c2,x
        sta fcl,x
        dex
        bpl al_w2
al_chk: jsr fat_rd
        lda fval
        ora fval+1
        ora fval+2
        ora fval+3
        beq al_got
        ldx #0
al_inc: inc fcl,x
        bne al_lp
        inx
        bra al_inc
al_full: lda #E_FULL            ; C set: the card is full
        sec
        rts
al_got: lda #$FF
        sta fval
        sta fval+1
        sta fval+2
        lda #$0F
        sta fval+3
        jsr fat_wr
        ldx #3
al_cp:  lda fcl,x
        sta newcl,x
        sta hint,x
        dex
        bpl al_cp
        ldx #0
al_hi:  inc hint,x
        bne al_x
        inx
        cpx #4
        bne al_hi
al_x:   clc
        rts

; alloc, or fail the call with E_FULL.
allocf: jsr alloc
        bcs af_full
        rts
af_full: jmp fail

; FAT[fcl] = newcl
link:   ldx #3
lk_cp:  lda newcl,x
        sta fval,x
        dex
        bpl lk_cp
        jmp fat_wr

; Free the chain starting at fcl.
freechain:
        ldx #3
fc_cp:  lda fcl,x
        sta fval,x
        dex
        bpl fc_cp
        jsr iseoc               ; nothing (more) to free
        bcs fc_x
        jsr fat_rd              ; fval = next
        ldx #3
fc_nx:  lda fval,x
        pha
        stz fval,x
        dex
        bpl fc_nx
        jsr fat_wr
        ldx #0
fc_pl:  pla
        sta fcl,x
        inx
        cpx #4
        bne fc_pl
        bra freechain
fc_x:   rts

; ---------------------------------------------------------------------------
; Directories. dir_open starts at the first entry of directory cluster dcl
; (0 = root); dir_ent loads its sector and points T at it; dir_next moves on
; (carry set past the end of the chain).

dir_open:
        lda dcl
        ora dcl+1
        ora dcl+2
        ora dcl+3
        bne do_cl
        ldx #3
do_rt:  lda ROOTCL,x
        sta dcl,x
        dex
        bpl do_rt
do_cl:  ldx #3
do_cp:  lda dcl,x
        sta itcl,x
        dex
        bpl do_cp
        stz itsec
        stz itidx
it_lba: ldx #3
il_cp:  lda itcl,x
        sta ccl,x
        dex
        bpl il_cp
        jsr cl2lba
        lda LBA
        clc
        adc itsec
        sta LBA
        bcc il_sv
        jsr incl1               ; carry into the upper bytes
il_sv:  ldx #3
il_s2:  lda LBA,x
        sta itlba,x
        dex
        bpl il_s2
        rts

dir_ent: ldx #3
de_cp:  lda itlba,x
        sta LBA,x
        dex
        bpl de_cp
        jsr getsec
        lda itidx
entptr: pha                     ; T = CBUF + A * 32
        lsr a
        lsr a
        lsr a
        clc
        adc #>CBUF
        sta T+1
        pla
        asl a
        asl a
        asl a
        asl a
        asl a
        sta T
        rts

dir_next:
        inc itidx
        lda itidx
        cmp #16
        bcc dn_ok
        stz itidx
        inc itsec
        lda itsec
        cmp SPC
        bcc dn_sec
        stz itsec
        ldx #3
dn_cp:  lda itcl,x
        sta fcl,x
        dex
        bpl dn_cp
        jsr fat_rd
        jsr iseoc
        bcs dn_x
        ldx #3
dn_nx:  lda fval,x
        sta itcl,x
        dex
        bpl dn_nx
dn_sec: jsr it_lba
dn_ok:  clc
dn_x:   rts

; Classify the entry at T: A = 0 end of directory, 1 free, 2 skip
; (long-name piece, volume label, "." or ".."), 3 file or directory.
ent_kind:
        ldy #0
        lda (T),y
        beq ek_x
        cmp #$E5
        beq ek_free
        cmp #'.'
        beq ek_skip
        ldy #11
        lda (T),y
        cmp #$0F
        beq ek_skip
        and #$08
        bne ek_skip
        lda #3
        rts
ek_free: lda #1
ek_x:   rts
ek_skip: lda #2
        rts

; Look for fname in directory dcl. Found: carry clear, T -> entry, its
; place in eloc/eidx. Not found: carry set; slotf/slot/sidx give a free
; entry if there was one, and itcl is the directory's last cluster.
dir_find:
        jsr dir_open
        stz slotf
df_lp:  jsr dir_ent
        jsr ent_kind
        beq df_end
        cmp #1
        beq df_free
        cmp #3
        bne df_nx
        ldy #10
df_cmp: lda (T),y
        cmp fname,y
        bne df_nx
        dey
        bpl df_cmp
        ldx #3
df_loc: lda itlba,x
        sta eloc,x
        dex
        bpl df_loc
        lda itidx
        sta eidx
        clc
        rts
df_free: jsr df_slot
df_nx:  jsr dir_next
        bcc df_lp
        rts
df_end: jsr df_slot
        sec
        rts
df_slot: lda slotf
        bne ds_x
        inc slotf
        ldx #3
ds_cp:  lda itlba,x
        sta slot,x
        dex
        bpl ds_cp
        lda itidx
        sta sidx
ds_x:   rts

; Make sure dir_find left a free slot: grow the directory by one zeroed
; cluster when it had none.
need_slot:
        lda slotf
        bne ns_x
        jsr allocf
        ldx #3
ns_cp:  lda itcl,x
        sta fcl,x
        dex
        bpl ns_cp
        jsr link
        jsr zero_new
        ldx #3
ns_sl:  lda LBA,x
        sta slot,x
        dex
        bpl ns_sl
        stz sidx
ns_x:   rts

; Zero every sector of cluster newcl; returns LBA = its first sector.
zero_new:
        jsr cflush
        ldx #3
zn_cp:  lda newcl,x
        sta ccl,x
        dex
        bpl zn_cp
        jsr cl2lba
        ldx #0
zn_clr: stz CBUF,x
        stz CBUF+$100,x
        inx
        bne zn_clr
        lda SPC
        sta W
zn_lp:  jsr setcbuf
        jsr SD_WRITE
        jsr inclba
        dec W
        bne zn_lp
        stz cvalid
        jmp cl2lba

inclba: inc LBA
        bne il_x
incl1:  inc LBA+1
        bne il_x
        inc LBA+2
        bne il_x
        inc LBA+3
il_x:   rts

; Directory entry cluster at T -> ccl.
ent_cl: ldy #26
        lda (T),y
        sta ccl
        iny
        lda (T),y
        sta ccl+1
        ldy #20
        lda (T),y
        sta ccl+2
        iny
        lda (T),y
        sta ccl+3
        rts

; ---------------------------------------------------------------------------
; Paths. resolve takes the ProDOS pathname at Q (relative to the prefix, or
; /SD/...) to its parent directory dcl and its last name as 8.3 in fname;
; isvol is set for /SD itself. Intermediate names must be directories.

resolve:
        stz isvol
        ldy #0
        lda (Q),y
        sta plen
        beq rs_bad
        lda #1
        sta pos
        iny
        lda (Q),y
        and #$7F
        cmp #'/'
        bne rs_rel
        inc pos
        jsr comp                ; volume name
        jsr to83
        ldx #10
rs_vn:  lda fname,x
        cmp vname,x
        bne rs_novol
        dex
        bpl rs_vn
        ldx #3
rs_r0:  stz dcl,x
        dex
        bpl rs_r0
        jsr comp
        bne rs_lp
        lda plen                ; "/SD/" or "/SD", not "/SD//..."
        cmp pos
        bcs rs_bad
        inc isvol
        rts
rs_rel: lda prefix
        beq rs_bad
        ldx #3
rs_pc:  lda prefcl,x
        sta dcl,x
        dex
        bpl rs_pc
        jsr comp
rs_lp:  jsr to83
        lda plen
        cmp pos
        bcc rs_x                ; that was the last name
        jsr dir_find
        bcs rs_nopath
        ldy #11
        lda (T),y
        and #$10
        beq rs_nopath
        jsr ent_cl
        ldx #3
rs_dc:  lda ccl,x
        sta dcl,x
        dex
        bpl rs_dc
        jsr comp
        bne rs_lp
rs_bad: lda #E_BADPATH
        jmp fail
rs_novol: lda #E_NOVOL
        jmp fail
rs_nopath: lda #E_NOPATH
        jmp fail
rs_x:   rts

; Next name of the path (from pos) to cname/clen, upper case; pos moves
; past it and its '/'. A = Z = clen.
comp:   ldx #0
cp_lp:  ldy pos
        cpy plen
        beq cp_ch
        bcs cp_end
cp_ch:  lda (Q),y
        inc pos
        and #$7F
        cmp #'/'
        beq cp_end
        cmp #'a'
        bcc cp_ck
        cmp #'z'+1
        bcs cp_ck
        and #$DF
cp_ck:  cmp #'.'                ; ProDOS letters, digits and '.' (and the
        beq cp_st               ; FAT name characters - _ ~)
        cmp #'-'
        beq cp_st
        cmp #'_'
        beq cp_st
        cmp #'~'
        beq cp_st
        cmp #'0'
        bcc cp_bad
        cmp #'9'+1
        bcc cp_st
        cmp #'A'
        bcc cp_bad
        cmp #'Z'+1
        bcs cp_bad
cp_st:  cpx #15
        bcs cp_lp
        sta cname,x
        inx
        bra cp_lp
cp_bad: jmp rs_bad
cp_end: stx clen
        txa
        rts

; cname/clen -> fname: the part before the last dot (other dots dropped,
; 8 characters) and up to 3 after it.
to83:   ldx #10
        lda #' '
t8_sp:  sta fname,x
        dex
        bpl t8_sp
        ldx clen
        stx dotp
t8_fd:  dex
        bmi t8_base
        lda cname,x
        cmp #'.'
        bne t8_fd
        stx dotp
t8_base: ldx #0
        ldy #0
t8_b:   cpx dotp
        bcs t8_ext
        lda cname,x
        inx
        cmp #'.'
        beq t8_b
        cpy #8
        bcs t8_b
        sta fname,y
        iny
        bra t8_b
t8_ext: inx
        ldy #8
t8_e:   cpx clen
        bcs t8_x
        cpy #11
        bcs t8_x
        lda cname,x
        inx
        sta fname,y
        iny
        bra t8_e
t8_x:   lda fname               ; no name before the last dot
        cmp #' '
        beq t8_bad
        rts
t8_bad: jmp rs_bad

; Q = the path pointer at (P),Y.
pathq:  lda (P),y
        sta Q
        iny
        lda (P),y
        sta Q+1
        rts

; Resolve the path at Q and find it: isvol, or T -> its entry.
lookup: jsr resolve
        lda isvol
        bne lk_x
        jsr dir_find
        bcc lk_x
        lda #E_NOFILE
        jmp fail
lk_x:   rts

; Entry at T -> ProDOS name in nbuf, length in nlen.
from83: ldy #0
        ldx #0
f8_b:   lda (T),y
        cmp #' '
        beq f8_ext
        sta nbuf,x
        inx
        iny
        cpy #8
        bne f8_b
f8_ext: ldy #8
        lda (T),y
        cmp #' '
        beq f8_x
        lda #'.'
        sta nbuf,x
        inx
f8_e:   lda (T),y
        cmp #' '
        beq f8_x
        sta nbuf,x
        inx
        iny
        cpy #11
        bne f8_e
f8_x:   stx nlen
        rts

; Entry at T -> ProDOS view: i_acc, i_type, i_aux, i_stor, i_blk, i_eof,
; i_date/i_time (from the FAT write date/time).
einfo:  ldx #i_end-i_acc-1
ei_z:   stz i_acc,x
        dex
        bpl ei_z
        ldy #11
        lda (T),y
        lsr a                   ; read-only -> locked
        lda #$E3
        bcc ei_acc
        lda #$21
ei_acc: sta i_acc
        lda (T),y
        and #$10
        beq ei_file
        lda #$0F
        sta i_type
        lda #$0D
        sta i_stor
        inc i_blk
        lda #2                  ; one 512-byte block
        sta i_eof+1
        jmp ei_date
ei_file: ldy #28
        lda (T),y
        sta i_eof
        iny
        lda (T),y
        sta i_eof+1
        iny
        lda (T),y
        sta i_eof+2
        iny
        lda (T),y               ; 16 MB or more: largest ProDOS EOF
        beq ei_tag
        lda #$FF
        sta i_eof
        sta i_eof+1
        sta i_eof+2
ei_tag: ldy #16                 ; tagged by the stand-in?
        lda (T),y
        cmp #$21
        bne ei_ext
        iny
        lda (T),y
        bne ei_ext
        ldy #13
        lda (T),y
        sta i_type
        iny
        lda (T),y
        sta i_aux
        iny
        lda (T),y
        sta i_aux+1
        bra ei_stor
ei_ext: lda #$06                ; BIN, or TXT for a Merlin source (.S)
        sta i_type
        ldy #8
        lda (T),y
        cmp #'S'
        bne ei_stor
        iny
        lda (T),y
        cmp #' '
        bne ei_stor
        iny
        lda (T),y
        cmp #' '
        bne ei_stor
        lda #$04
        sta i_type
ei_stor: lda i_eof              ; blocks = (eof + 511) / 512
        cmp #1
        lda i_eof+1
        adc #1
        sta i_blk
        lda i_eof+2
        adc #0
        ror a                   ; the carry is bit 8 (EOF $FFFE01+)
        ror i_blk
        sta i_blk+1
        lda #1                  ; seedling, sapling (+ index), tree
        ldx i_eof+2
        bne ei_big
        ldx i_eof+1
        cpx #2
        bcc ei_st
        bne ei_two
        ldx i_eof
        beq ei_st
ei_two: lda #2
        bra ei_idx
ei_big: cpx #2
        bcc ei_two
        bne ei_tree
        ldx i_eof+1
        bne ei_tree
        ldx i_eof
        beq ei_two
ei_tree: lda #3
ei_idx: inc i_blk
        bne ei_st
        inc i_blk+1
ei_st:  sta i_stor
ei_date: ldy #25                ; FAT date: year-1980 << 9 | month << 5 | day
        lda (T),y
        dey
        ora (T),y
        beq ei_x
        iny
        lda (T),y
        lsr a
        php
        clc
        adc #80
        cmp #100
        bcc ei_yr
        sbc #100
ei_yr:  plp
        rol a
        sta i_date+1
        dey
        lda (T),y
        sta i_date
        ldy #23                 ; time: hour << 11 | minute << 5
        lda (T),y
        lsr a
        lsr a
        lsr a
        sta i_time+1
        lda (T),y
        and #$07
        sta W
        dey
        lda (T),y
        ldx #5
ei_min: lsr W
        ror a
        dex
        bne ei_min
        sta i_time
ei_x:   rts

; ---------------------------------------------------------------------------
; Open files.

; X = fx = the FCB of the ref num at (P),1, or fail with E_BADREF.
ref_fcb: ldy #1
        lda (P),y
        beq rf_bad
        cmp #NFCB+1
        bcs rf_bad
        tay
        ldx fcboff-1,y
        lda fcbs+F_REF,x
        beq rf_bad
        stx fx
        rts
rf_bad: lda #E_BADREF
        jmp fail

; Point LBA at the sector holding the mark of FCB fx. With grow set the
; clusters it needs are allocated (carry set, A = E_FULL, if the card is
; full; the chain then still ends at the last cluster that was linked),
; otherwise a short chain is E_EOF.
seek:   ldx fx
        lda fcbs+F_MARK+2,x     ; sector number = mark >> 9
        lsr a
        sta cidx+1
        lda fcbs+F_MARK+1,x
        ror a
        sta cidx
        and spcmask
        sta secin
        ldy spcshift            ; cluster index
        beq sk_cmp
sk_sh:  lsr cidx+1
        ror cidx
        dey
        bne sk_sh
sk_cmp: lda fcbs+F_IDX+1,x      ; can we go on from the current cluster?
        cmp cidx+1
        bcc sk_walk
        bne sk_reset
        lda fcbs+F_IDX,x
        cmp cidx
        bcc sk_walk
        bne sk_reset
        jmp sk_here
sk_reset: stz fcbs+F_IDX,x
        stz fcbs+F_IDX+1,x
        lda fcbs+F_FIRST,x
        ora fcbs+F_FIRST+1,x
        ora fcbs+F_FIRST+2,x
        ora fcbs+F_FIRST+3,x
        bne sk_first
        lda grow                ; empty file: its first cluster
        beq sk_eof
        jsr alloc
        bcs sk_full
        ldx fx
        ldy #0
sk_new: lda newcl,y
        sta fcbs+F_FIRST,x
        inx
        iny
        cpy #4
        bne sk_new
        jsr setdirty
sk_first: ldx fx
        ldy #0
sk_f1:  lda fcbs+F_FIRST,x
        sta fcbs+F_CUR,x
        inx
        iny
        cpy #4
        bne sk_f1
        ldx fx
        bra sk_cmp
sk_walk: jsr curfcl             ; fcl = current cluster
        jsr fat_rd
        jsr iseoc
        bcc sk_next
        lda grow
        beq sk_eof
        jsr alloc
        bcs sk_full
        jsr curfcl
        jsr link
        ldx #3
sk_nw:  lda newcl,x
        sta fval,x
        dex
        bpl sk_nw
sk_next: ldx fx
        ldy #0
sk_n1:  lda fval,y
        sta fcbs+F_CUR,x
        inx
        iny
        cpy #4
        bne sk_n1
        ldx fx
        inc fcbs+F_IDX,x
        bne sk_again
        inc fcbs+F_IDX+1,x
sk_again: jmp sk_cmp
sk_eof: lda #E_EOF
        jmp fail
sk_full: rts                    ; C set, A = E_FULL
sk_here: ldy #0
sk_h1:  lda fcbs+F_CUR,x
        sta ccl,y
        inx
        iny
        cpy #4
        bne sk_h1
        jsr cl2lba
        lda LBA
        clc
        adc secin
        sta LBA
        bcc sk_x
        jsr incl1
sk_x:   clc
        rts

curfcl: ldx fx
        ldy #0
cf_l:   lda fcbs+F_CUR,x
        sta fcl,y
        inx
        iny
        cpy #4
        bne cf_l
        ldx fx
        rts

setdirty: ldx fx
        lda fcbs+F_FLAGS,x
        ora #$40
        sta fcbs+F_FLAGS,x
        rts

; READ/WRITE parameters: U = buffer, cnt = request, trans = 0.
xfer_init:
        ldy #2
        lda (P),y
        sta U
        iny
        lda (P),y
        sta U+1
        iny
        lda (P),y
        sta cnt
        iny
        lda (P),y
        sta cnt+1
        iny
        lda #0
        sta (P),y
        iny
        sta (P),y
        stz trans
        stz trans+1
        stz nlhit
        rts

; This sector's share of the transfer: off = mark & $1FF, ln = bytes
; (one at a time while a READ watches for a newline).
chunk:  ldx fx
        lda fcbs+F_MARK,x
        sta off
        lda fcbs+F_MARK+1,x
        and #1
        sta off+1
        sec
        lda #0
        sbc off
        sta ln
        lda #2
        sbc off+1
        sta ln+1
        lda cnt+1
        cmp ln+1
        bcc ch_cnt
        bne ch_nl
        lda cnt
        cmp ln
        bcs ch_nl
ch_cnt: lda cnt
        sta ln
        lda cnt+1
        sta ln+1
ch_nl:  lda grow
        bne ch_x
        lda fcbs+F_NLMASK,x
        beq ch_x
        lda #1
        sta ln
        stz ln+1
ch_x:   rts

; Z set if the whole sector at off 0 is ln = 512 (a direct transfer).
whole:  lda off
        ora off+1
        bne wh_x
        lda ln
        bne wh_x
        lda ln+1
        cmp #2
wh_x:   rts

; Z set if LBA is the cached sector.
iscached: lda cvalid
        beq ic_no
        ldx #3
ic_lp:  lda LBA,x
        cmp clba,x
        bne ic_x
        dex
        bpl ic_lp
        lda #0
ic_x:   rts
ic_no:  lda #1
        rts

; T = CBUF + off
cbufoff: lda off
        sta T
        lda off+1
        clc
        adc #>CBUF
        sta T+1
        rts

; Copy ln bytes from (T) to (Q).
mcopy:  ldy #0
        ldx ln+1
        beq mc_t
mc_pg:  lda (T),y
        sta (Q),y
        iny
        bne mc_pg
        inc T+1
        inc Q+1
        dex
        bne mc_pg
mc_t:   ldx ln
        beq mc_x
mc_tl:  lda (T),y
        sta (Q),y
        iny
        dex
        bne mc_tl
mc_x:   rts

; U, mark and trans move on by ln; cnt goes down by ln.
advance: clc
        lda U
        adc ln
        sta U
        lda U+1
        adc ln+1
        sta U+1
        ldx fx
        clc
        lda fcbs+F_MARK,x
        adc ln
        sta fcbs+F_MARK,x
        lda fcbs+F_MARK+1,x
        adc ln+1
        sta fcbs+F_MARK+1,x
        bcc ad_c
        inc fcbs+F_MARK+2,x
ad_c:   sec
        lda cnt
        sbc ln
        sta cnt
        lda cnt+1
        sbc ln+1
        sta cnt+1
        clc
        lda trans
        adc ln
        sta trans
        lda trans+1
        adc ln+1
        sta trans+1
        rts

c_read: jsr ref_fcb
        jsr xfer_init
        stz grow
        ldx fx
        lda fcbs+F_FLAGS,x
        bpl rd_file
        jmp rd_dir
rd_file: sec                    ; available = eof - mark
        lda fcbs+F_EOF,x
        sbc fcbs+F_MARK,x
        sta av
        lda fcbs+F_EOF+1,x
        sbc fcbs+F_MARK+1,x
        sta av+1
        lda fcbs+F_EOF+2,x
        sbc fcbs+F_MARK+2,x
        bne rd_lp               ; 64 KB or more: no clamp
        ora av
        ora av+1
        bne rd_some
        lda #E_EOF
        jmp fail
rd_some: lda cnt+1
        cmp av+1
        bcc rd_lp
        bne rd_clamp
        lda cnt
        cmp av
        bcc rd_lp
rd_clamp: lda av
        sta cnt
        lda av+1
        sta cnt+1
rd_lp:  lda cnt
        ora cnt+1
        beq xfer_done
        lda nlhit
        bne xfer_done
        jsr seek
        jsr chunk
        jsr whole
        bne rd_cache
        jsr iscached
        beq rd_cache
        lda U                   ; a whole sector straight to the caller
        sta SBUF
        lda U+1
        sta SBUF+1
        jsr SD_READ
        bra rd_adv
rd_cache: jsr getsec
        jsr cbufoff
        lda U
        sta Q
        lda U+1
        sta Q+1
        jsr mcopy
        ldx fx
        lda fcbs+F_NLMASK,x
        beq rd_adv
        lda (U)
        and fcbs+F_NLMASK,x
        cmp fcbs+F_NLCHAR,x
        bne rd_adv
        inc nlhit
rd_adv: jsr advance
        bra rd_lp

xfer_done: lda #0
xfer_end: pha                   ; trans_count = bytes moved, also on error
        ldy #6
        lda trans
        sta (P),y
        iny
        lda trans+1
        sta (P),y
        pla
        jmp fail

c_write: jsr ref_fcb
        jsr xfer_init
        lda fcbs+F_FLAGS,x      ; a directory or a locked file
        bmi wr_acc
        lsr a
        bcc wr_lp
wr_acc: lda #E_ACCESS
        jmp fail
wr_lp:  lda cnt
        ora cnt+1
        beq xfer_done
        lda #1
        sta grow
        jsr seek
        bcs xfer_end            ; card full: what was written stays
        jsr chunk
        jsr whole
        bne wr_cache
        jsr iscached            ; a whole sector straight from the caller
        bne wr_dir
        stz cvalid
        stz cdirty
wr_dir: lda U
        sta SBUF
        lda U+1
        sta SBUF+1
        jsr SD_WRITE
        bra wr_adv
wr_cache: jsr getsec
        jsr cbufoff
        lda T
        sta Q
        lda T+1
        sta Q+1
        lda U
        sta T
        lda U+1
        sta T+1
        jsr mcopy
        lda #1
        sta cdirty
wr_adv: jsr advance
        jsr setdirty
        sec                     ; past the end: eof = mark
        lda fcbs+F_EOF,x
        sbc fcbs+F_MARK,x
        lda fcbs+F_EOF+1,x
        sbc fcbs+F_MARK+1,x
        lda fcbs+F_EOF+2,x
        sbc fcbs+F_MARK+2,x
        bcs wr_lp
        lda fcbs+F_MARK,x
        sta fcbs+F_EOF,x
        lda fcbs+F_MARK+1,x
        sta fcbs+F_EOF+1,x
        lda fcbs+F_MARK+2,x
        sta fcbs+F_EOF+2,x
        bra wr_lp

c_open: ldx #0                  ; a free FCB
op_f:   lda fcbs+F_REF,x
        beq op_got
        txa
        clc
        adc #FCBSIZE
        tax
        cmp #FCBTOT
        bcc op_f
        lda #E_TOOMANY
        jmp fail
op_got: stx fx
        ldy #1
        jsr pathq
        jsr lookup
        ldx fx                  ; clear the FCB
        ldy #FCBSIZE-1
op_z:   stz fcbs,x
        inx
        dey
        bpl op_z
        ldx fx
        dec fcbs+F_IDX,x        ; $FFFF: no current cluster
        dec fcbs+F_IDX+1,x
        lda isvol
        beq op_ent
        lda #$80                ; the volume (root) directory
        sta fcbs+F_FLAGS,x
        dec fcbs+F_DIDX,x
        ldy #0
op_rt:  lda ROOTCL,y
        sta fcbs+F_FIRST,x
        inx
        iny
        cpy #4
        bne op_rt
        bra op_dir
op_ent: ldy #11                 ; bit 7 directory, bit 0 read-only (locked)
        lda (T),y
        and #$11
        cmp #$10
        bcc op_flg
        ora #$80
        and #$81
op_flg: sta fcbs+F_FLAGS,x
        cmp #$80               ; a directory?
        bcs op_file
        ldy #31                 ; ProDOS sizes stop below 16 MB
        lda (T),y
        beq op_file
        lda #E_RANGE
        jmp fail
op_file: jsr ent_cl
        ldx fx
        ldy #0
op_cl:  lda ccl,y
        sta fcbs+F_FIRST,x
        lda eloc,y
        sta fcbs+F_DLBA,x
        inx
        iny
        cpy #4
        bne op_cl
        ldx fx
        lda eidx
        sta fcbs+F_DIDX,x
        ldy #28
op_eof: lda (T),y
        sta fcbs+F_EOF,x
        inx
        iny
        cpy #31
        bne op_eof
        ldx fx
        lda fcbs+F_FLAGS,x
        bmi op_isd
        jmp op_ref
op_isd: ldy #0
op_nm:  lda fname,y
        sta fcbs+F_NAME,x
        inx
        iny
        cpy #11
        bne op_nm
op_dir: ldy #0                  ; count its entries; eof = blocks * 512
        ldx fx
op_dc:  lda fcbs+F_FIRST,x
        sta dcl,y
        inx
        iny
        cpy #4
        bne op_dc
        stz dcnt
        stz dcnt+1
        jsr dir_open
op_cnt: jsr dir_ent
        jsr ent_kind
        beq op_cdone
        cmp #3
        bne op_cnx
        inc dcnt
        bne op_cnx
        inc dcnt+1
op_cnx: jsr dir_next
        bcc op_cnt
op_cdone: ldx fx
        lda dcnt
        sta fcbs+F_DCOUNT,x
        lda dcnt+1
        sta fcbs+F_DCOUNT+1,x
        lda #2                  ; blocks: the header plus 12, then 13 a block
        sta fcbs+F_EOF+1,x
        sec
        lda dcnt
        sbc #12
        sta dcnt
        bcs op_bl
        dec dcnt+1
op_bl:  lda dcnt+1
        bmi op_ref
        ora dcnt
        beq op_ref
        lda fcbs+F_EOF+1,x
        clc
        adc #2
        sta fcbs+F_EOF+1,x
        bcc op_b13
        inc fcbs+F_EOF+2,x
op_b13: sec
        lda dcnt
        sbc #13
        sta dcnt
        bcs op_bl
        dec dcnt+1
        bra op_bl
op_ref: txa                     ; ref num = FCB number + 1
        ldy #0
op_rn:  iny
        cmp fcboff-1,y
        bne op_rn
        tya
        sta fcbs+F_REF,x
        ldy #5
        sta (P),y
        jmp ok

; CLOSE and FLUSH: ref 0 means every open file.
c_close: lda #1
        bra cl_go
c_flush: lda #0
cl_go:  sta closing
        ldy #1
        lda (P),y
        bne cl_one
        stz fx
cl_all: ldx fx
        lda fcbs+F_REF,x
        beq cl_nx
        jsr cl_fcb
cl_nx:  lda fx
        clc
        adc #FCBSIZE
        sta fx
        cmp #FCBTOT
        bcc cl_all
        jmp ok
cl_one: jsr ref_fcb
        jsr cl_fcb
        jmp ok
cl_fcb: jsr updent
        lda closing
        beq cf_kept
        ldx fx
        stz fcbs+F_REF,x
cf_kept: rts

; Write the FCB's size, first cluster and date back to its directory
; entry if the file changed.
updent: ldx fx
        lda fcbs+F_FLAGS,x
        and #$40
        beq ue_x
        eor fcbs+F_FLAGS,x
        sta fcbs+F_FLAGS,x
        ldy #0
ue_lba: lda fcbs+F_DLBA,x
        sta LBA,y
        inx
        iny
        cpy #4
        bne ue_lba
        jsr getsec
        ldx fx
        lda fcbs+F_DIDX,x
        jsr entptr
        ldy #26
        lda fcbs+F_FIRST,x
        sta (T),y
        iny
        lda fcbs+F_FIRST+1,x
        sta (T),y
        ldy #20
        lda fcbs+F_FIRST+2,x
        sta (T),y
        iny
        lda fcbs+F_FIRST+3,x
        sta (T),y
        ldy #28
        lda fcbs+F_EOF,x
        sta (T),y
        iny
        lda fcbs+F_EOF+1,x
        sta (T),y
        iny
        lda fcbs+F_EOF+2,x
        sta (T),y
        iny
        lda #0
        sta (T),y
        jsr stamp
        lda #1
        sta cdirty
ue_x:   rts

; FAT write date/time at T from the ProDOS clock bytes, if they are set.
stamp:  lda $BF90
        ora $BF91
        beq st_x
        lda $BF91               ; ProDOS year 0-99 (0-39 = 2000-2039)
        lsr a
        php
        sec
        sbc #80
        bcs st_yr
        adc #100
st_yr:  plp
        rol a
        ldy #25
        sta (T),y
        dey
        lda $BF90
        sta (T),y
        lda $BF92               ; minute
        lsr a
        lsr a
        lsr a
        sta W
        lda $BF93               ; hour
        asl a
        asl a
        asl a
        ora W
        dey
        sta (T),y
        lda $BF92
        asl a
        asl a
        asl a
        asl a
        asl a
        dey
        sta (T),y
st_x:   rts

c_newline: jsr ref_fcb
        ldy #2
        lda (P),y
        sta fcbs+F_NLMASK,x
        iny
        lda (P),y
        sta fcbs+F_NLCHAR,x
        jmp ok

c_geteof: lda #F_EOF
        bra get3
c_getmark: lda #F_MARK
get3:   sta W
        jsr ref_fcb
        txa
        clc
        adc W
        tax
        ldy #2
g3_lp:  lda fcbs,x
        sta (P),y
        inx
        iny
        cpy #5
        bne g3_lp
        jmp ok

; new3 = the 3-byte value at (P),2; C clear if it is above the EOF.
new3:   jsr ref_fcb
        ldy #2
        lda (P),y
        sta newv
        iny
        lda (P),y
        sta newv+1
        iny
        lda (P),y
        sta newv+2
        lda fcbs+F_EOF,x
        cmp newv
        lda fcbs+F_EOF+1,x
        sbc newv+1
        lda fcbs+F_EOF+2,x
        sbc newv+2
        rts

c_setmark: jsr new3
        bcs sm_ok
        lda #E_RANGE
        jmp fail
sm_ok:  jsr setmark
        jmp ok
setmark: ldx fx
        lda newv
        sta fcbs+F_MARK,x
        lda newv+1
        sta fcbs+F_MARK+1,x
        lda newv+2
        sta fcbs+F_MARK+2,x
        rts

; SET_EOF: a longer file gets its clusters, a shorter one frees them. A
; shorter EOF reaches the directory entry before any cluster is freed, so an
; interrupted call leaks clusters rather than leaving the entry past the end
; of its chain. If the card fills up while growing, the file is put back to
; its old EOF and the call fails with E_FULL.
c_seteof: jsr ref_fcb
        lda fcbs+F_FLAGS,x      ; a directory or a locked file
        bmi se_acc
        lsr a
        bcc se_ok
se_acc: jmp wr_acc
se_ok:  stz seerr
        lda fcbs+F_MARK,x       ; keep the mark
        sta msave
        lda fcbs+F_MARK+1,x
        sta msave+1
        lda fcbs+F_MARK+2,x
        sta msave+2
        jsr new3
        bcs se_short
        jsr lastmark            ; longer: reach its last byte
        lda #1
        sta grow
        jsr seek
        bcc se_set
        sta seerr               ; full: back to the old EOF
        ldx fx
        lda fcbs+F_EOF,x
        sta newv
        lda fcbs+F_EOF+1,x
        sta newv+1
        lda fcbs+F_EOF+2,x
        sta newv+2
se_short: jsr se_eof            ; shorter (or equal): the entry first
        lda newv
        ora newv+1
        ora newv+2
        bne se_part
        ldy #0                  ; to zero: drop the whole chain
        ldx fx
se_f0:  lda fcbs+F_FIRST,x
        sta tcl,y
        stz fcbs+F_FIRST,x
        inx
        iny
        cpy #4
        bne se_f0
        jsr se_entry
        ldx #3
se_fc:  lda tcl,x
        sta fcl,x
        dex
        bpl se_fc
        jsr freechain
        bra se_set
se_part: jsr se_entry
        jsr lastmark            ; keep the cluster of the last byte
        stz grow
        jsr seek
        jsr curfcl
        jsr fat_rd
        ldx #3
se_nx:  lda fval,x
        pha
        lda c_eoc,x
        sta fval,x
        dex
        bpl se_nx
        jsr fat_wr
        ldx #0
se_pl:  pla
        sta fcl,x
        inx
        cpx #4
        bne se_pl
        jsr freechain
se_set: jsr se_eof
        ldx fx
        lda #$FF
        sta fcbs+F_IDX,x
        sta fcbs+F_IDX+1,x
        lda msave               ; mark = min(mark, eof)
        cmp newv
        lda msave+1
        sbc newv+1
        lda msave+2
        sbc newv+2
        bcs se_mk
        lda msave
        sta newv
        lda msave+1
        sta newv+1
        lda msave+2
        sta newv+2
se_mk:  jsr setmark
        jsr setdirty
        lda seerr
        jmp fail

; EOF of FCB fx = newv
se_eof: ldx fx
        lda newv
        sta fcbs+F_EOF,x
        lda newv+1
        sta fcbs+F_EOF+1,x
        lda newv+2
        sta fcbs+F_EOF+2,x
        rts

; Write FCB fx's EOF and first cluster to its entry, on the card now.
se_entry: jsr setdirty
        jsr updent
        jmp cflush

; mark = newv - 1 (newv is not zero)
lastmark: ldx fx
        sec
        lda newv
        sbc #1
        sta fcbs+F_MARK,x
        lda newv+1
        sbc #0
        sta fcbs+F_MARK+1,x
        lda newv+2
        sbc #0
        sta fcbs+F_MARK+2,x
        rts

; ---------------------------------------------------------------------------
; Reading a directory gives ProDOS directory blocks made from its FAT
; entries (one 512-byte block per READ, at a block boundary).

rd_dir: lda fcbs+F_MARK,x
        bne rdd_rng
        lda fcbs+F_MARK+1,x
        lsr a
        bcs rdd_rng
        lda fcbs+F_MARK+2,x
        lsr a
        sta blk+1
        lda fcbs+F_MARK+1,x
        ror a
        sta blk
        lda cnt+1               ; a whole block
        cmp #2
        bcc rdd_rng
        lda fcbs+F_MARK,x       ; at the end?
        cmp fcbs+F_EOF,x
        lda fcbs+F_MARK+1,x
        sbc fcbs+F_EOF+1,x
        lda fcbs+F_MARK+2,x
        sbc fcbs+F_EOF+2,x
        bcc rdd_go
        lda #E_EOF
        jmp fail
rdd_rng: lda #E_RANGE
        jmp fail
rdd_go: ldy #0                  ; clear it
        tya
rdd_z1: sta (U),y
        iny
        bne rdd_z1
        inc U+1
rdd_z2: sta (U),y
        iny
        bne rdd_z2
        dec U+1
        lda blk                 ; previous / next block links
        sta (U),y
        iny
        lda blk+1
        sta (U),y
        lda #0                  ; next: there when mark + 512 < eof
        clc
        lda fcbs+F_MARK+1,x
        adc #2
        sta W
        lda fcbs+F_MARK+2,x
        adc #0
        sta W+1
        lda W
        cmp fcbs+F_EOF+1,x
        lda W+1
        sbc fcbs+F_EOF+2,x
        bcs rdd_last
        ldy #2
        lda blk
        adc #2
        sta (U),y
rdd_last: lda U                 ; Q = first entry
        clc
        adc #4
        sta Q
        lda U+1
        adc #0
        sta Q+1
        lda #13
        sta slots
        lda blk                 ; entries before this block: blk * 13 - 1
        sta skip
        lda blk+1
        sta skip+1
        asl skip
        rol skip+1
        asl skip
        rol skip+1
        clc
        lda skip
        adc blk
        sta W
        lda skip+1
        adc blk+1
        sta W+1
        asl skip
        rol skip+1
        clc
        lda skip
        adc W
        sta skip
        lda skip+1
        adc W+1
        sta skip+1
        lda blk
        ora blk+1
        beq rdd_hdr
        lda skip
        bne rdd_dk
        dec skip+1
rdd_dk: dec skip
        bra rdd_scan
rdd_hdr: jsr whead
        dec slots
rdd_scan: ldx fx
        ldy #0
rdd_dc: lda fcbs+F_FIRST,x
        sta dcl,y
        inx
        iny
        cpy #4
        bne rdd_dc
        jsr dir_open
rdd_lp: lda slots
        beq rdd_done
        jsr dir_ent
        jsr ent_kind
        beq rdd_done
        cmp #3
        bne rdd_nx
        lda skip
        ora skip+1
        beq rdd_put
        lda skip
        bne rdd_sk
        dec skip+1
rdd_sk: dec skip
        bra rdd_nx
rdd_put: jsr wentry
        dec slots
rdd_nx: jsr dir_next
        bcc rdd_lp
rdd_done: lda #0                ; 512 bytes moved; mark on a block
        sta ln
        lda #2
        sta ln+1
        jsr advance
        jmp xfer_done

; Q += 39: the next entry slot.
nextq:  clc
        lda Q
        adc #39
        sta Q
        bcc nq_x
        inc Q+1
nq_x:   rts

; ProDOS entry at Q for the FAT entry at T; Q moves on.
wentry: jsr einfo
        jsr from83
        lda i_stor
        asl a
        asl a
        asl a
        asl a
        ora nlen
        sta (Q)
        ldx #0
        ldy #1
we_nm:  cpx nlen
        beq we_nd
        lda nbuf,x
        sta (Q),y
        inx
        iny
        bra we_nm
we_nd:  ldy #26                 ; key block: the cluster's low 16 bits
        lda (T),y
        ldy #$11
        sta (Q),y
        ldy #27
        lda (T),y
        ldy #$12
        sta (Q),y
        ldx #dtab-itab
        jsr infocopy
        jmp nextq

; Header entry (volume or subdirectory) at Q.
whead:  lda #$C3
        ldy #$1E
        sta (Q),y
        iny
        lda #39
        sta (Q),y
        iny
        lda #13
        sta (Q),y
        ldx fx
        iny
        lda fcbs+F_DCOUNT,x
        sta (Q),y
        iny
        lda fcbs+F_DCOUNT+1,x
        sta (Q),y
        lda fcbs+F_DIDX,x
        cmp #$FF
        bne wh_sub
        lda #$F2                ; volume /SD
        sta (Q)
        ldy #1
        lda #'S'
        sta (Q),y
        iny
        lda #'D'
        sta (Q),y
        ldy #$23
        lda #6                  ; bitmap block
        sta (Q),y
        ldy #$25
        lda #$FF                ; total blocks (not counted)
        sta (Q),y
        iny
        sta (Q),y
        jmp nextq
wh_sub: txa                     ; T = the directory's 8.3 name
        clc
        adc #<(fcbs+F_NAME)
        sta T
        lda #>(fcbs+F_NAME)
        adc #0
        sta T+1
        jsr from83
        lda nlen
        ora #$E0
        sta (Q)
        ldx #0
        ldy #1
wh_nm:  cpx nlen
        beq wh_nd
        lda nbuf,x
        sta (Q),y
        inx
        iny
        bra wh_nm
wh_nd:  ldy #$10
        lda #$75
        sta (Q),y
        ldy #$26
        lda #39
        sta (Q),y
        jmp nextq

; Copy info fields to (Q) by the table at X: pairs of (offset in the
; ProDOS record, offset in i_acc...), ended by 0.
infocopy: ldy itab,x
        beq ic_done
        lda itab+1,x
        sta W
        phx
        ldx W
        lda i_acc,x
        plx
        sta (Q),y
        inx
        inx
        bra infocopy
ic_done: rts

itab:
gtab:   .byte 3,0, 4,1, 5,2, 6,3, 7,4, 8,5, 9,6, $A,10, $B,11, $C,12, $D,13, 0
dtab:   .byte $10,1, $13,5, $14,6, $15,7, $16,8, $17,9, $1E,0, $1F,2, $20,3
        .byte $21,10, $22,11, $23,12, $24,13, 0

; ---------------------------------------------------------------------------
; Path calls.

c_getinfo: ldy #1
        jsr pathq
        jsr lookup
        lda P
        sta Q
        lda P+1
        sta Q+1
        lda isvol
        beq gi_ent
        ldx #i_end-i_acc-1      ; the volume
gi_z:   stz i_acc,x
        dex
        bpl gi_z
        lda #$C3
        sta i_acc
        lda #$0F
        sta i_type
        sta i_stor
        lda #$FF
        sta i_aux
        sta i_aux+1
        bra gi_copy
gi_ent: jsr einfo
gi_copy: ldx #gtab-itab
        jsr infocopy
        ldy #$11                ; no creation date
        lda #0
gi_cz:  sta (Q),y
        dey
        cpy #$0D
        bne gi_cz
        jmp ok

c_setinfo: ldy #1
        jsr pathq
        jsr lookup
        lda isvol
        bne si_x
        ldy #11
        lda (T),y
        and #$10
        bne si_acc
        ldy #4                  ; type and aux type, tagged
        lda (P),y
        ldy #13
        sta (T),y
        ldy #5
        lda (P),y
        ldy #14
        sta (T),y
        ldy #6
        lda (P),y
        ldy #15
        sta (T),y
        jsr tag
si_acc: ldy #3                  ; no write access -> read-only
        lda (P),y
        and #$02
        cmp #$02
        ldy #11
        lda (T),y
        and #$FE
        bcs si_rw
        ora #$01
si_rw:  sta (T),y
        lda #1
        sta cdirty
si_x:   jmp ok

; Mark the entry at T as typed by the stand-in (creation date 1980-01-01).
tag:    ldy #16
        lda #$21
        sta (T),y
        iny
        lda #0
        sta (T),y
        rts

c_create: ldy #1
        jsr pathq
        jsr resolve
        lda isvol
        bne cr_dupj
        jsr dir_find
        bcs cr_new
cr_dupj: jmp cr_dup
cr_new:
        jsr need_slot
        ldx #3
cr_e0:  stz ecl,x
        dex
        bpl cr_e0
        lda #$20
        sta attr
        ldy #7
        lda (P),y
        cmp #$0D
        beq cr_mkd
        jmp cr_ent
cr_mkd: jsr allocf              ; a directory: one zeroed cluster
        jsr zero_new            ; with "." and ".."
        ldx #3
cr_cl:  lda LBA,x
        sta clba,x
        lda newcl,x
        sta ecl,x
        dex
        bpl cr_cl
        lda newcl               ; "." -> itself
        sta CBUF+26
        lda newcl+1
        sta CBUF+27
        lda newcl+2
        sta CBUF+20
        lda newcl+3
        sta CBUF+21
        ldx #3                  ; ".." -> the parent (0 for the root)
cr_rt:  lda dcl,x
        cmp ROOTCL,x
        bne cr_par
        dex
        bpl cr_rt
        bra cr_dots
cr_par: lda dcl
        sta CBUF+32+26
        lda dcl+1
        sta CBUF+32+27
        lda dcl+2
        sta CBUF+32+20
        lda dcl+3
        sta CBUF+32+21
cr_dots: ldx #10
        lda #' '
cr_dn:  sta CBUF,x
        sta CBUF+32,x
        dex
        bne cr_dn
        lda #'.'
        sta CBUF
        sta CBUF+32
        sta CBUF+33
        lda #$10
        sta CBUF+11
        sta CBUF+32+11
        sta attr
        lda #1
        sta cvalid
        sta cdirty
cr_ent: ldx #3                  ; the new entry in its slot
cr_sl:  lda slot,x
        sta LBA,x
        dex
        bpl cr_sl
        jsr getsec
        lda sidx
        jsr entptr
        ldy #31
        lda #0
cr_zz:  sta (T),y
        dey
        bpl cr_zz
        ldy #10
cr_nm:  lda fname,y
        sta (T),y
        dey
        bpl cr_nm
        ldy #3                  ; no write access: read-only (locked)
        lda (P),y
        and #$02
        bne cr_rw
        inc attr
cr_rw:  ldy #11
        lda attr
        sta (T),y
        ldy #4                  ; type, aux
        lda (P),y
        ldy #13
        sta (T),y
        ldy #5
        lda (P),y
        ldy #14
        sta (T),y
        ldy #6
        lda (P),y
        ldy #15
        sta (T),y
        jsr tag
        ldy #26
        lda ecl
        sta (T),y
        iny
        lda ecl+1
        sta (T),y
        ldy #20
        lda ecl+2
        sta (T),y
        iny
        lda ecl+3
        sta (T),y
        jsr stamp
        lda #1
        sta cdirty
        jmp ok
cr_dup: lda #E_DUP
        jmp fail

; Fail with E_BUSY if the entry eloc/eidx belongs to an open file.
notopen: ldx #0
no_lp:  lda fcbs+F_REF,x
        beq no_nx
        lda fcbs+F_DIDX,x
        cmp eidx
        bne no_nx
        ldy #0
        phx
no_cmp: lda fcbs+F_DLBA,x
        cmp eloc,y
        bne no_ne
        inx
        iny
        cpy #4
        bne no_cmp
        plx
        lda #E_BUSY
        jmp fail
no_ne:  plx
no_nx:  txa
        clc
        adc #FCBSIZE
        tax
        cmp #FCBTOT
        bcc no_lp
        rts

; DESTROY: the entry is marked deleted on the card before its clusters are
; freed (an interruption leaks them instead of leaving a live entry on free
; clusters). Locked files, open files, non-empty directories and the prefix
; directory are refused.
c_destroy: ldy #1
        jsr pathq
        jsr lookup
        lda isvol
        bne de_acc
        jsr locked
        jsr notopen
        jsr ent_cl
        ldx #3
de_cl:  lda ccl,x
        sta tcl,x
        sta dcl,x
        dex
        bpl de_cl
        ldy #11
        lda (T),y
        and #$10
        beq de_free
        ldx #3                  ; not the prefix directory
de_pf:  lda tcl,x
        cmp prefcl,x
        bne de_np
        dex
        bpl de_pf
        bra de_acc
de_np:  jsr dir_open            ; a directory must be empty
de_chk: jsr dir_ent
        jsr ent_kind
        beq de_free
        cmp #3
        beq de_acc
        jsr dir_next
        bcc de_chk
de_free: jsr locent
        lda #$E5
        sta (T)
        lda #1
        sta cdirty
        jsr cflush
        ldx #3
de_fc:  lda tcl,x
        sta fcl,x
        dex
        bpl de_fc
        jsr freechain
        jmp ok
de_acc: lda #E_ACCESS
        jmp fail

; Fail with E_ACCESS if the entry at T is read-only (locked).
locked: ldy #11
        lda (T),y
        lsr a
        bcs de_acc
        rts

; T -> the entry at eloc/eidx.
locent: ldx #3
le_cp:  lda eloc,x
        sta LBA,x
        dex
        bpl le_cp
        jsr getsec
        lda eidx
        jmp entptr

c_rename: ldy #1
        jsr pathq
        jsr lookup
        lda isvol
        bne rn_bad
        jsr locked
        jsr notopen
        ldx #3                  ; keep the old entry's directory and place
rn_sv:  lda dcl,x               ; (resolving the new path moves eloc/eidx)
        sta tcl,x
        lda eloc,x
        sta tloc,x
        dex
        bpl rn_sv
        lda eidx
        sta tidx
        ldy #3
        jsr pathq
        jsr resolve
        lda isvol
        bne rn_bad
        jsr dir_find
        bcs rn_new
        jmp cr_dup
rn_new: ldx #3                  ; same directory only
rn_dc:  lda dcl,x
        cmp tcl,x
        bne rn_bad
        lda tloc,x
        sta eloc,x
        dex
        bpl rn_dc
        lda tidx
        sta eidx
        jsr locent
        ldy #10
rn_nm:  lda fname,y
        sta (T),y
        dey
        bpl rn_nm
        lda #1
        sta cdirty
        jmp ok
rn_bad: lda #E_BADPATH
        jmp fail

c_online: ldy #2
        jsr pathq
        ldy #1
        lda (P),y
        beq ol_all
        and #$F0
        cmp #$60
        beq ol_one
        lda #E_NODEV
        jmp fail
ol_all: ldy #16
        lda #0
        sta (Q),y
ol_one: lda #$62                ; slot 6 drive 1, "SD"
        sta (Q)
        ldy #1
        lda #'S'
        sta (Q),y
        iny
        lda #'D'
        sta (Q),y
        jmp ok

c_getprefix: ldy #1
        jsr pathq
        ldy prefix
gp_lp:  lda prefix,y
        sta (Q),y
        dey
        bpl gp_lp
        jmp ok

c_setprefix: ldy #1
        jsr pathq
        lda (Q)
        bne sp_set
        sta prefix              ; empty: no prefix
        jmp ok
sp_set: jsr resolve
        ldx #3
sp_z:   stz tcl,x
        dex
        bpl sp_z
        lda isvol
        bne sp_str
        jsr dir_find
        bcs sp_nf
        ldy #11
        lda (T),y
        and #$10
        beq sp_nf
        jsr ent_cl
        ldx #3
sp_cl:  lda ccl,x
        sta tcl,x
        dex
        bpl sp_cl
sp_str: ldx #0                  ; absolute, or appended to the prefix
        ldy #1
        lda (Q),y
        and #$7F
        cmp #'/'
        beq sp_abs
        ldx prefix
sp_abs: txa
        clc
        adc (Q)
        bcs sp_long
        cmp #63
        bcs sp_long
        ldy #0
sp_c:   iny
        lda (Q),y
        and #$7F
        cmp #'a'
        bcc sp_up
        cmp #'z'+1
        bcs sp_up
        and #$DF
sp_up:  inx
        sta prefix,x
        tya
        cmp (Q)
        bne sp_c
        lda prefix,x
        cmp #'/'
        beq sp_end
        inx
        lda #'/'
        sta prefix,x
sp_end: stx prefix
        ldx #3
sp_pc:  lda tcl,x
        sta prefcl,x
        dex
        bpl sp_pc
        jmp ok
sp_nf:  lda #E_NOPATH
        jmp fail
sp_long: lda #E_BADPATH
        jmp fail

; QUIT: close everything and go back to the 3RIC DOS prompt (same folder).
c_quit: lda #1
        sta closing
        stz fx
cq_lp:  ldx fx
        lda fcbs+F_REF,x
        beq cq_nx
        jsr cl_fcb
cq_nx:  lda fx
        clc
        adc #FCBSIZE
        sta fx
        cmp #FCBTOT
        bcc cq_lp
        jsr flush
        ldx #3                  ; the ROM re-reads its FAT sector
cq_rom: stz ROMFATSEC,x
        dex
        bpl cq_rom
        ldx #$FF
        txs
        jsr SETVID
        jsr SETKBD
        jsr COUT_HOOK
        jmp DOS_PROMPT

c_alloc: lda #E_INTFULL
        jmp fail
c_nodev: lda #E_NODEV
        jmp fail

; ---------------------------------------------------------------------------
; Merlin glue (main RAM, so it runs whatever the language card shows).

; MERLIN.SYSTEM's monitor copy into the language card (JSR $FE2C at $2248)
; also points the card's NMI vector at the resident.
fixup:  jsr $FE2C
        lda #<NMI_ENTRY
        sta $FFFA
        lda #>NMI_ENTRY
        sta $FFFB
        rts

; Workspace bounds at assembler start: object buffer and the top of the
; "auxiliary" workspace, which on 3RIC is main RAM (port-merlin8.mjs).
bounds: lda #WS_TOP
        sta $C8
        sta $83
        stx $E2
        lda #OBJ_PAGE
        sta $E3
        rts

; AUXMOVE ($C311) on a machine whose "auxiliary" memory is main memory.
amove:  ldy #0
        jmp $FE2C

; Merlin's BLOAD range check (CPY $0C / SBC $0D at $BA14: the end of the
; load against the source limit). ED, the editor module Merlin loads at
; startup, sits above that limit at $9DB6-$A9FF by design: allow it there.
edchk:  pha
        lda $BE09               ; load address
        cmp #>ED_ORG
        bne ec_lim
        lda $BE08
        cmp #<ED_ORG
        bne ec_lim
        pla
        cpy #0                  ; ED must end below $AA00
        sbc #$AA
        rts
ec_lim: pla
        cpy $0C
        sbc $0D
        rts

; ED's key routine (its vector at $9E03). Ctrl-A makes the next key an
; Open-Apple key: ED's Open-Apple tests read oaflag (not $C061, the 3RIC
; pad-button byte), which stays set until ED reads its next key.
oakey:  stz oaflag
ok_w1:  lda $C000
        bpl ok_w1
        bit $C010
        cmp #$81
        bne ok_x
        lda #$80
        sta oaflag
ok_w2:  lda $C000
        bpl ok_w2
        bit $C010
ok_x:   rts
oaflag: .byte 0

cmdtab: .byte $C0,$C1,$C2,$C3,$C4,$C5,$C6,$C7,$C8,$C9,$CA,$CB,$CC,$CD
        .byte $CE,$CF,$D0,$D1,$82,$65,$40,$41,$80,$81,0
jmptab: .word c_create,c_destroy,c_rename,c_setinfo,c_getinfo,c_online
        .word c_setprefix,c_getprefix,c_open,c_newline,c_read,c_write
        .word c_close,c_flush,c_setmark,c_getmark,c_seteof,c_geteof
        .word ok,c_quit,c_alloc,ok,c_nodev,c_nodev

c2:     .byte 2,0,0,0
c_eoc:  .byte $FF,$FF,$FF,$0F
vname:  .text "SD         "
fcboff: .byte 0,FCBSIZE,FCBSIZE+FCBSIZE

; Set by the loader.
spcshift: .byte 0               ; log2(sectors per cluster)
spcmask: .byte 0                ; sectors per cluster - 1
maxcl:  .res 4                  ; last cluster number
hint:   .res 4                  ; where to look for a free cluster
prefcl: .res 4                  ; prefix directory (0 = root)
prefix: .res 64                 ; length, then "/SD/..../"

code_end:

; Variables (not part of the image the loader copies).
savx:   .res 1
savy:   .res 1
lcmode: .res 1
result: .res 1
cmd:    .res 1
spsave: .res 1
zsave:  .res 16
clba:   .res 4
cvalid: .res 1
cdirty: .res 1
lsave:  .res 4
fcl:    .res 4
fval:   .res 4
fsec:   .res 3
fcur:   .res 4
fvalid: .res 1
fdirty: .res 1
ccl:    .res 4
wrapped: .res 1
newcl:  .res 4
dcl:    .res 4
itcl:   .res 4
itsec:  .res 1
itidx:  .res 1
itlba:  .res 4
slotf:  .res 1
slot:   .res 4
sidx:   .res 1
eloc:   .res 4
eidx:   .res 1
isvol:  .res 1
plen:   .res 1
pos:    .res 1
cname:  .res 15
clen:   .res 1
dotp:   .res 1
fname:  .res 11
nbuf:   .res 15
nlen:   .res 1
i_acc:  .res 1
i_type: .res 1
i_aux:  .res 2
i_stor: .res 1
i_blk:  .res 2
i_eof:  .res 3
i_date: .res 2
i_time: .res 2
i_end:
fx:     .res 1
grow:   .res 1
cidx:   .res 2
secin:  .res 1
cnt:    .res 2
trans:  .res 2
nlhit:  .res 1
off:    .res 2
ln:     .res 2
av:     .res 2
closing: .res 1
newv:   .res 3
msave:  .res 3
seerr:  .res 1
dcnt:   .res 2
skip:   .res 2
slots:  .res 1
blk:    .res 2
tcl:    .res 4
tloc:   .res 4
tidx:   .res 1
attr:   .res 1
ecl:    .res 4
fcbs:   .res FCBTOT
vars_end:

; ---------------------------------------------------------------------------
; ProDOS global page.

        .org $BF00
        jmp mli                 ; $BF00 MLI entry
        jmp mli                 ; $BF03 JSPARE
        rts                     ; $BF06 DATETIME: no clock
        .byte 0,0
        jmp nodev               ; $BF09 SYSERR
        jmp nodev               ; $BF0C SYSDEATH
        .byte 0                 ; $BF0F SERR
        .word nodev,nodev,nodev,nodev,nodev,nodev,nodev,nodev ; $BF10 DEVADR
        .word nodev,nodev,nodev,nodev,nodev,nodev,nodev,nodev
        .byte $60               ; $BF30 DEVNUM: slot 6, drive 1
        .byte 0                 ; $BF31 DEVCNT: one device
        .byte $60               ; $BF32 DEVLST
        .res 13
        .res 10                 ; $BF40
nodev:  lda #E_NODEV            ; $BF4A
        sec
        rts
        .res 10                 ; $BF4E
        .byte $CF               ; $BF58 BITMAP: pages 0, 1, 4-7 in use
        .res 22
        .byte $01               ; $BF6F: $BF in use
        .res 32                 ; $BF70 buffers, $BF80 interrupt vectors
        .res 8                  ; $BF90 DATE, TIME, LEVEL, BUBIT, ...
        .byte $60               ; $BF98 MACHID: II+-class, 64 KB
        .res 99                 ; $BF99-$BFFB
        .byte 0,0               ; $BFFC IBAKVER, IVERSION (Merlin sets)
        .byte 0,0               ; $BFFE KBAKVER, KVERSION
gp_end:
