; Ultima I for 3RIC - a ProDOS stand-in on the ROM DOS.
;
; The 1986 Apple II Ultima I is a ProDOS program: U1.SYSTEM relocates
; Origin's small file layer to $B700-$BAFF (inline-parameter load, save,
; run, delete) and every game file goes through it to the ProDOS MLI. This
; replaces ProDOS only - U1.SYSTEM, the layer and the game run unmodified.
;
;   $BB00-$BEFF  MLI code and file table. ProDOS gave this to the layer as
;                its 1 KB OPEN buffer; nothing here uses one.
;   $BF00-$BFFF  ProDOS global page: MLI entry, device table, bitmap,
;                MACHID, version bytes. The stand-in's tables and variables
;                use bytes that are ProDOS-internal ($BF70-$BF8F, $BFA0-$BFFB).
;
; Calls follow ProDOS: JSR $BF00 / .byte cmd / .word params. On return A is
; the error code (0 = none), carry is set on error, Z/N follow A, and X/Y
; are preserved. Files live flat in the folder U1.PRG ran from; a path is
; resolved by its last component (so /U1/OUT and /U1.PLAYER/U1.VARS both
; work), mapped to a dot-less 8-character key and looked up in filetab,
; which port-ultima1.mjs appends: key[8], type, aux(2), eof(2).
;
; Only READ and WRITE reach the card: READ is FLOAD key buf mark end (the
; end operand is an inclusive offset), WRITE is OWRITE key buf n at mark 0
; of an existing file no smaller than n. The ROM DOS changes only $B0-$BF
; of the game's RAM (measured); they are saved and restored around every
; call, and used as scratch here - so the scratch itself is kept across each
; ROM DOS command.

COUT        = $FDED
MUTE_OUTPUT = $CE09             ; ROM: suppress screen echo of DOS output

P           = $B0               ; parameter block
T           = $B2               ; scratch pointer
ENT         = $B4               ; file table entry
N           = $B6               ; byte count
TMP         = $B8

E_BADCALL   = $01
E_INTFULL   = $25
E_NODEV     = $28
E_WPROT     = $2B
E_TOOMANY   = $42
E_BADREF    = $43
E_NOFILE    = $46
E_FULL      = $48
E_EOF       = $4C
E_RANGE     = $4D

V_FLOAD     = 0                 ; offsets into verbs
V_OWRITE    = 7

        .org $BB00

mli:
        cld
        stx savx
        sty savy
        ldx #15
m_save:
        lda $B0,x
        sta zsave,x
        dex
        bpl m_save
        pla                     ; caller's JSR address + 2
        sta T
        pla
        sta T+1
        ldy #1
        lda (T),y
        tax                     ; command
        iny
        lda (T),y
        sta P
        iny
        lda (T),y
        sta P+1
        tya                     ; return past the 3 inline bytes
        clc
        adc T
        tay
        lda T+1
        adc #0
        pha
        phy
        txa
        ldx #0
m_find:
        ldy cmdtab,x
        beq m_bad
        cmp cmdtab,x
        beq m_go
        inx
        bra m_find
m_go:
        txa
        asl a
        tax
        jmp (jmptab,x)
m_bad:
        lda #E_BADCALL
        bra fail

ok:
        lda #0
fail:
        sta result
        ldx #15
m_rest:
        lda zsave,x
        sta $B0,x
        dex
        bpl m_rest
        ldx savx
        ldy savy
        lda result
        beq m_clc
        sec
        rts
m_clc:
        clc
        rts


c_wprot:                        ; no new or deleted files on the card
        lda #E_WPROT
        bra fail
c_nodev:
        lda #E_NODEV
        bra fail
c_alloc:
        lda #E_INTFULL
        bra fail
c_setinfo:
        jsr need_file
c_ok:
        bra ok

; GET_FILE_INFO: access, type, aux, storage type, blocks used; dates zero.
c_getinfo:
        jsr need_file
        ldy #3
        lda #$C3                ; destroy, rename, write, read
        sta (P),y
        ldy #8
gi_copy:                        ; type, aux lo, aux hi -> +4, +5, +6
        lda (ENT),y
        dey
        dey
        dey
        dey
        sta (P),y
        tya
        clc
        adc #5
        tay
        cpy #11
        bne gi_copy
        lda N                   ; blocks = (eof + 511) / 512
        cmp #1
        lda N+1
        adc #1
        ror a
        ldx #1                  ; seedling up to one block, else sapling
        cmp #2                  ; plus its index block
        bcc gi_store
        inx
        inc a
gi_store:
        ldy #8
        sta (P),y
        dey
        txa
        sta (P),y
        ldy #9
        lda #0
gi_zero:
        sta (P),y               ; +9 .. +$11
        iny
        cpy #$12
        bne gi_zero
        jmp ok

; GET_PREFIX: "/U1/". (With an empty prefix U1.SYSTEM would derive one
; from the startup pathname at $0280 instead.)
c_getprefix:
        ldy #1
        lda (P),y
        sta T
        iny
        lda (P),y
        sta T+1
        ldy #4
gp_copy:
        lda prefix,y
        sta (T),y
        dey
        bpl gp_copy
        jmp ok

c_open:
        lda isopen
        beq op_free
        lda #E_TOOMANY
        jmp fail
op_free:
        jsr need_file
        lda ENT
        sta openent
        lda ENT+1
        sta openent+1
        stz mark
        stz mark+1
        lda #1
        sta isopen
        ldy #5
        sta (P),y               ; ref_num 1
        jmp ok

c_close:
        ldy #1
        lda (P),y
        beq cl_all              ; ref 0: close everything
        jsr check_ref
cl_all:
        stz isopen
        jmp ok

c_geteof:
        jsr check_ref
        ldy #2
        lda N
        sta (P),y
        iny
        lda N+1
        sta (P),y
        iny
        lda #0
        sta (P),y
        jmp ok

; READ: n = min(request, eof - mark); FLOAD key buf mark mark+n-1.
c_read:
        jsr check_ref
        sec                     ; N = eof - mark
        lda N
        sbc mark
        sta N
        lda N+1
        sbc mark+1
        sta N+1
        ora N
        bne rd_some
        lda #E_EOF
        jmp fail
rd_some:
        ldy #5                  ; request count
        lda (P),y
        cmp N+1
        bcc rd_req
        bne rd_n
        dey
        lda (P),y
        cmp N
        bcs rd_n
        iny
rd_req:
        lda (P),y               ; request < available: N = request
        sta N+1
        dey
        lda (P),y
        sta N
rd_n:
        lda N
        ora N+1
        beq xfer_done
        ldx #V_FLOAD
        jsr cmd_begin
        lda mark+1
        ldx mark
        jsr cmd_word
        clc                     ; end = mark + n - 1 (inclusive)
        lda mark
        adc N
        tax
        lda mark+1
        adc N+1
        cpx #0
        bne rd_end
        dec a
rd_end:
        dex
        jsr cmd_word
        jsr cmd_end
xfer_done:                      ; mark += N, trans_count = N
        clc
        lda mark
        adc N
        sta mark
        lda mark+1
        adc N+1
        sta mark+1
        ldy #6
        lda N
        sta (P),y
        iny
        lda N+1
        sta (P),y
        jmp ok

; WRITE: only whole-file rewrites (mark 0, n <= eof) - OWRITE key buf n.
c_write:
        jsr check_ref
        lda mark
        ora mark+1
        beq wr_mark0
        lda #E_RANGE
        jmp fail
wr_mark0:
        ldy #4                  ; T = n
        lda (P),y
        sta T
        iny
        lda (P),y
        sta T+1
        lda N                   ; n <= eof?
        cmp T
        lda N+1
        sbc T+1
        bcs wr_fits
        lda #E_FULL             ; a file on the card cannot grow
        jmp fail
wr_fits:
        lda T
        sta N
        lda T+1
        sta N+1
        ora N
        beq xfer_done
        ldx #V_OWRITE
        jsr cmd_begin
        lda N+1
        ldx N
        jsr cmd_word
        jsr cmd_end
        bra xfer_done

; ---------------------------------------------------------------------------
; The ref num at (P),1 must name the open file: sets ENT and N = eof.
; Otherwise the call fails with E_BADREF (the caller's frame is dropped).
check_ref:
        ldy #1
        lda (P),y
        dec a
        bne cr_bad
        lda isopen
        beq cr_bad
        lda openent
        sta ENT
        lda openent+1
        sta ENT+1
        bra ent_eof
cr_bad:
        pla
        pla
        lda #E_BADREF
        jmp fail

; The path at (P),1 must name a file: sets ENT and N = eof. Otherwise the
; call fails with E_NOFILE (the caller's frame is dropped). The key is the
; last path component with dots removed, upper case, space padded to 8.
need_file:
        ldy #1
        lda (P),y
        sta T
        iny
        lda (P),y
        sta T+1
        lda (T)
        and #$7F                ; pathname length
        sta TMP
        ldy #0
rs_new:
        ldx #0
rs_next:
        cpy TMP
        bcs rs_done
        iny
        lda (T),y
        and #$7F
        cmp #'/'
        beq rs_new
        cmp #'.'
        beq rs_next
        cpx #8
        bcs rs_next
        cmp #'a'
        bcc rs_store
        and #$DF
rs_store:
        sta key,x
        inx
        bra rs_next
rs_done:
        txa
        beq rs_none             ; empty last component
        lda #' '
rs_pad:
        cpx #8
        bcs rs_find
        sta key,x
        inx
        bra rs_pad
rs_find:
        lda #<filetab
        sta ENT
        lda #>filetab
        sta ENT+1
rs_entry:
        lda (ENT)
        beq rs_none
        ldy #0
rs_cmp:
        lda (ENT),y
        cmp key,y
        bne rs_skip
        iny
        cpy #8
        bne rs_cmp
ent_eof:                        ; N = eof of entry ENT
        ldy #11
        lda (ENT),y
        sta N
        iny
        lda (ENT),y
        sta N+1
        rts
rs_skip:
        clc
        lda ENT
        adc #13
        sta ENT
        bcc rs_entry
        inc ENT+1
        bra rs_entry
rs_none:
        pla
        pla
        lda #E_NOFILE
        jmp fail

; ---------------------------------------------------------------------------
; ROM DOS commands are streamed through COUT to the command collector the
; loader captured from the $03EA hook, with the screen echo muted; the
; game's CSW and mute flag are restored by cmd_end.

; Ctrl-D, the verb at verbs+X, "KEY BBBB" with
; the open file's key and the buffer at (P),2.
cmd_begin:
        ldy #7                  ; the ROM DOS reuses $B0-$BF: keep P, T, ENT, N
cb_keep:
        lda P,y
        sta zwork,y
        dey
        bpl cb_keep
        lda $36
        sta sav36
        lda $37
        sta sav37
        lda MUTE_OUTPUT
        sta savmute
        lda romcsw
        sta $36
        lda romcsw+1
        sta $37
        lda #$80
        sta MUTE_OUTPUT
        lda #$84
        jsr COUT
cb_verb:
        lda verbs,x
        beq cb_key
        jsr COUT
        inx
        bra cb_verb
cb_key:
        ldy #0
cb_key_loop:
        lda (ENT),y
        cmp #' '
        beq cb_buf
        jsr COUT
        iny
        cpy #8
        bne cb_key_loop
cb_buf:
        ldy #2
        lda (P),y
        tax
        iny
        lda (P),y
cmd_word:                       ; " " then A (high), X (low) as 4 hex digits
        pha
        lda #' '
        jsr COUT
        pla
        jsr cmd_hex
        txa
cmd_hex:
        pha
        lsr a
        lsr a
        lsr a
        lsr a
        jsr cmd_nyb
        pla
        and #$0F
cmd_nyb:
        ora #'0'
        cmp #'9'+1
        bcc cn_out
        adc #6
cn_out:
        jmp COUT

cmd_end:                        ; CR runs the command
        lda #$8D
        jsr COUT
        lda savmute
        sta MUTE_OUTPUT
        lda sav37
        sta $37
        lda sav36
        sta $36
        ldx #7
ce_keep:
        lda zwork,x
        sta P,x
        dex
        bpl ce_keep
        rts

; IRQ vector target ($03FE is ProDOS's to own). The ROM's IRQ entry saved A
; in $45. 3RIC enables no IRQ source the game uses; return if one arrives.
irq_return:
        lda $45
        rti

verbs:      .asciiz "FLOAD "      ; V_FLOAD = 0
            .asciiz "OWRITE "     ; V_OWRITE = 7
filetab:                        ; appended by port-ultima1.mjs, 0-terminated

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
        .byte $FF               ; $BF31 DEVCNT: no devices
        .res 14                 ; $BF32 DEVLST
        .res 10                 ; $BF40
nodev:                          ; $BF4A: every slot/drive is "no device"
        lda #E_NODEV
        sec
        rts
        .res 10                 ; $BF4E
        .byte $CF               ; $BF58 BITMAP: pages 0, 1, 4-7 in use
        .res 22
        .byte $1F               ; $BF6F: $BB-$BF in use
; $BF70-$BF8F (ProDOS's file buffer and interrupt tables, unused here) and
; $BFD0-$BFFB hold the dispatch tables. Command order:
; GET_FILE_INFO OPEN GET_EOF READ CLOSE WRITE SET_EOF SET_FILE_INFO
; GET_PREFIX SET_PREFIX CREATE DESTROY READ_BLOCK WRITE_BLOCK GET_TIME
; ALLOC_INTERRUPT DEALLOC_INTERRUPT
cmdtab:     .byte $C4,$C8,$D1,$CA,$CC,$CB,$D0,$C3,$C7,$C6,$C0,$C1,$80,$81,$82,$40,$41,0
prefix:     .byte 4
            .text "/U1/"
        .res 9
        .res 8                  ; $BF90 DATE/TIME (no clock), LEVEL, BUBIT
        .byte $60               ; $BF98 MACHID: II+-class, 64 KB
        .byte 0,0,0             ; $BF99 SLTBYT, PFIXPTR, MLIACTV
        .res 4                  ; $BF9C
; $BFA0-$BFCF: ProDOS-internal bytes, used here for the stand-in's state.
romcsw:     .word 0             ; set by the loader from the $03EA hook
savx:       .byte 0
savy:       .byte 0
result:     .byte 0
isopen:     .byte 0
openent:    .word 0
mark:       .word 0
sav36:      .byte 0
sav37:      .byte 0
savmute:    .byte 0
            .res 3
key:        .res 8              ; $BFB0
zwork:      .res 8              ; $BFB8: P, T, ENT, N across a ROM DOS command
zsave:      .res 16             ; $BFC0
jmptab:     .word c_getinfo,c_open,c_geteof,c_read,c_close,c_write,c_ok,c_setinfo ; $BFD0
            .word c_getprefix,c_ok,c_wprot,c_wprot,c_nodev,c_nodev,c_ok,c_alloc,c_ok
        .res 10
        .byte 0,0               ; $BFFC IBAKVER, IVERSION (U1.SYSTEM sets)
        .byte 0,0               ; $BFFE KBAKVER, $BFFF KVERSION
gp_end:
