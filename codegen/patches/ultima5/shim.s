; Ultima V for 3RIC - SD-card replacement for Origin's DINKEYDOS loader.
;
; Lives in language-card bank 1 at $D000, where DINKEYDOS lived, and keeps
; its 14-entry jump table and inline-parameter calling convention:
;
;   JSR $D000/$D00C  "NAME",0              load / load+run at the file's aux
;   JSR $D003/$D00F  .word nameptr         ... name by pointer
;   JSR $D006/$D012  "NAME",0 .word addr   load / load+run at addr (0 = aux)
;   JSR $D009/$D015  .word nameptr,addr
;   JSR $D018        "NAME",0 .word addr,x write an existing file (x unused)
;   JSR $D01B        .word nameptr,addr,x
;   JSR $D01E        "/VOLUME",0           select a disk
;   JSR $D021        .word nameptr
;   JSR $D024        .word blockptr        read ProDOS block into $D600
;   JSR $D027        .word blockptr        write block (never used: error)
;
; Return: carry clear and A=0 on success, carry set and A=ProDOS-style error
; otherwise. Load+run jumps to the load address. Each disk is a directory
; under the folder the loader ran from; ProDOS names become 8-character keys
; (dots removed) and are looked up only among the current disk's files, so
; a missing file fails here exactly as it did on the floppy (the ROM's
; OWRITE would otherwise fall back to BSAVE code in the BASIC ROM bank).
; Loads use FLOAD name addr 0000 eof-1: FLOAD's end operand is inclusive,
; and BLOAD stores one byte past EOF. The disk's blocks are exported as
; RAW00-RAW22 (eight blocks, 4 KB, each); a block read becomes
; FLOAD RAWnn D600 start end. FLOAD skips to its start byte by byte, so
; small chunks keep reads short, and a one-block cache absorbs the game's
; habit of reading every block twice (once per 256-byte half).
;
; Uses only DINKEYDOS's zero page ($52-$55, $60-$7F).

ZP_RET      = $52               ; scratch pointer
ZP_LOADADR  = $62               ; load address (DINKEYDOS contract)
ZP_P        = $68               ; inline parameter pointer
ZP_NAME     = $6A               ; file/volume name pointer
ZP_ADDR     = $6C               ; explicit address (0 = use aux type)
ZP_FLAGS    = $70
ZP_ENT      = $72               ; table entry pointer
ZP_EOF      = $74               ; write length
ZP_TMP      = $76
ZP_CMD      = $71               ; cmdbuf index ($7F stays DINKEYDOS's slot byte)

F_PTR       = $01
F_ADDR      = $02
F_SKIP2     = $04
F_RUN       = $08
F_WRITE     = $10

CTRL_D      = $84
CR          = $8D
MUTE_OUTPUT = $CE09             ; ROM: suppress screen echo of DOS output

        .org $D000

        jmp e_load_i            ; $D000
        jmp e_load_p            ; $D003
        jmp e_load_ia           ; $D006
        jmp e_load_pa           ; $D009
        jmp e_run_i             ; $D00C
        jmp e_run_p             ; $D00F
        jmp e_run_ia            ; $D012
        jmp e_run_pa            ; $D015
        jmp e_write_i           ; $D018
        jmp e_write_p           ; $D01B
        jmp e_vol_i             ; $D01E
        jmp e_vol_p             ; $D021
        jmp e_rdblk             ; $D024
        jmp e_wrblk             ; $D027
        jmp pad_poll            ; $D02A: SNES pads (resident pad_key)

curvol:     .byte $FF           ; current volume index, $FF = loader folder

e_load_i:   lda #0
            bra file_op
e_load_p:   lda #F_PTR
            bra file_op
e_load_ia:  lda #F_ADDR
            bra file_op
e_load_pa:  lda #F_PTR+F_ADDR
            bra file_op
e_run_i:    lda #F_RUN
            bra file_op
e_run_p:    lda #F_RUN+F_PTR
            bra file_op
e_run_ia:   lda #F_RUN+F_ADDR
            bra file_op
e_run_pa:   lda #F_RUN+F_PTR+F_ADDR
            bra file_op
e_write_i:  lda #F_WRITE+F_ADDR+F_SKIP2
            bra file_op
e_write_p:  lda #F_WRITE+F_ADDR+F_SKIP2+F_PTR
            bra file_op

; ---------------------------------------------------------------------------
; Parameter parsing. Called with the caller's return address on the stack.
; Leaves ZP_NAME, ZP_ADDR set and the corrected return address re-pushed.

file_op:
        sta ZP_FLAGS
        jsr take_params
        jsr make_key
        jsr find_file
        bcc fo_found
        jmp no_file             ; not on this disk: DINKEYDOS fails as well
fo_found:
        lda ZP_ADDR
        ora ZP_ADDR+1
        bne have_addr
        ldy #8
        lda (ZP_ENT),y
        sta ZP_ADDR
        iny
        lda (ZP_ENT),y
        sta ZP_ADDR+1
have_addr:
        lda ZP_ADDR
        sta ZP_LOADADR
        lda ZP_ADDR+1
        sta ZP_LOADADR+1
        ldy #10
        lda (ZP_ENT),y
        sta ZP_EOF
        iny
        lda (ZP_ENT),y
        sta ZP_EOF+1
        lda ZP_FLAGS
        and #F_WRITE
        bne do_write
        ; The ROM's BLOAD stores one byte past EOF, so load exactly
        ; [0, eof-1] with FLOAD (its end operand is inclusive).
        lda ZP_EOF
        bne fo_dec
        dec ZP_EOF+1
fo_dec:
        dec ZP_EOF
        jsr cmd_start
        ldx #<s_fload
        ldy #>s_fload
        jsr cmd_str
        jsr cmd_key
        jsr cmd_space
        lda ZP_ADDR+1
        jsr cmd_hex
        lda ZP_ADDR
        jsr cmd_hex
        ldx #<s_zero
        ldy #>s_zero
        jsr cmd_str
        lda ZP_EOF+1
        jsr cmd_hex
        lda ZP_EOF
        jsr cmd_hex
        jsr cmd_run
        lda ZP_FLAGS
        and #F_RUN
        beq ok
        jmp (ZP_LOADADR)

do_write:                       ; OWRITE writes whole sectors in place
        jsr cmd_start
        ldx #<s_owrite
        ldy #>s_owrite
        jsr cmd_str
        jsr cmd_key
        jsr cmd_space
        lda ZP_ADDR+1
        jsr cmd_hex
        lda ZP_ADDR
        jsr cmd_hex
        jsr cmd_space
        lda ZP_EOF+1
        jsr cmd_hex
        lda ZP_EOF
        jsr cmd_hex
        jsr cmd_run
ok:
        lda #0
        clc
        rts
no_file:
        lda #$46                ; ProDOS "file not found"
        sec
        rts

; Pull the caller's return address, read the inline parameters described by
; ZP_FLAGS, and push the address of the byte after them (minus one).
take_params:
        pla
        sta ZP_RET
        pla
        sta ZP_RET+1
        pla
        sta ZP_P
        pla
        sta ZP_P+1
        jsr p_inc
        stz ZP_ADDR
        stz ZP_ADDR+1
        lda ZP_FLAGS
        and #F_PTR
        beq tp_inline
        jsr p_word
        stx ZP_NAME
        sty ZP_NAME+1
        bra tp_addr
tp_inline:
        lda ZP_P
        sta ZP_NAME
        lda ZP_P+1
        sta ZP_NAME+1
tp_skip:
        ldy #0
        lda (ZP_P),y
        php
        jsr p_inc
        plp
        bne tp_skip
tp_addr:
        lda ZP_FLAGS
        and #F_ADDR
        beq tp_x
        jsr p_word
        stx ZP_ADDR
        sty ZP_ADDR+1
tp_x:
        lda ZP_FLAGS
        and #F_SKIP2
        beq tp_done
        jsr p_word
tp_done:
        lda ZP_P                ; return address = P - 1
        bne tp_dec
        dec ZP_P+1
tp_dec:
        dec ZP_P
        lda ZP_P+1
        pha
        lda ZP_P
        pha
        lda ZP_RET+1
        pha
        lda ZP_RET
        pha
        rts

p_word:                         ; X/Y = word at P, P += 2
        ldy #0
        lda (ZP_P),y
        tax
        iny
        lda (ZP_P),y
        tay
        jsr p_inc
p_inc:
        inc ZP_P
        bne p_inc_done
        inc ZP_P+1
p_inc_done:
        rts

; ---------------------------------------------------------------------------
; ProDOS name at ZP_NAME -> 8-byte key (dots removed, space padded).

make_key:
        ldx #0
        ldy #0
mk_loop:
        lda (ZP_NAME),y
        and #$7F
        beq mk_pad
        iny
        cmp #'.'
        beq mk_loop
        cmp #'a'
        bcc mk_store
        and #$DF
mk_store:
        sta key,x
        inx
        cpx #8
        bne mk_loop
        rts
mk_pad:
        lda #' '
        sta key,x
        inx
        cpx #8
        bne mk_pad
        rts

; Find key in filetab among files on the current disk. Carry clear and
; ZP_ENT set if found.
find_file:
        ldx curvol
        cpx #8
        bcs ff_missing          ; still in the loader folder
        lda volbit,x
        sta ZP_TMP
        lda #<filetab
        sta ZP_ENT
        lda #>filetab
        sta ZP_ENT+1
ff_next:
        ldy #0
        lda (ZP_ENT),y
        beq ff_missing
ff_cmp:
        lda (ZP_ENT),y
        cmp key,y
        bne ff_skip
        iny
        cpy #8
        bne ff_cmp
        ldy #12
        lda (ZP_ENT),y
        and ZP_TMP
        beq ff_skip
        clc
        rts
ff_skip:
        clc
        lda ZP_ENT
        adc #13
        sta ZP_ENT
        bcc ff_next
        inc ZP_ENT+1
        bra ff_next
ff_missing:
        sec
        rts

volbit:     .byte $01,$02,$04,$08,$10,$20,$40,$80

; ---------------------------------------------------------------------------
; Volume selection: "/NAME" (optionally "/NAME/") -> CD into its directory.

e_vol_i:
        lda #0
        bra vol_op
e_vol_p:
        lda #F_PTR
vol_op:
        sta ZP_FLAGS
        jsr take_params
        ldy #0
        lda (ZP_NAME),y
        and #$7F
        cmp #'/'
        beq vol_find
        lda #$10                ; DINKEYDOS: a bare name is not a volume
        sec
        rts
vol_find:
        lda #<voltab
        sta ZP_ENT
        lda #>voltab
        sta ZP_ENT+1
        ldx #0                  ; volume index
vf_next:
        ldy #0
        lda (ZP_ENT),y
        beq vf_missing
vf_cmp:
        iny                     ; name byte y (after '/') vs table byte y-1
        lda (ZP_NAME),y
        and #$7F
        cmp #'/'                ; a trailing '/' ends the name like NUL
        bne vf_chr
        lda #0
vf_chr:
        dey
        cmp (ZP_ENT),y
        bne vf_skip
        lda (ZP_ENT),y          ; both ended together: match
        beq vf_found
        iny
        cpy #11
        bne vf_cmp
vf_skip:
        clc
        lda ZP_ENT
        adc #19
        sta ZP_ENT
        bcc vf_inc
        inc ZP_ENT+1
vf_inc:
        inx
        bra vf_next
vf_missing:
        lda #$45                ; ProDOS "volume not found"
        sec
        rts
vf_found:
        cpx curvol
        beq vol_ok
        stx ZP_TMP
        lda curvol
        cmp #$FF
        beq vol_cd
        jsr cmd_start
        ldx #<s_cdup
        ldy #>s_cdup
        jsr cmd_str
        jsr cmd_run
vol_cd:
        jsr cmd_start
        ldx #<s_cd
        ldy #>s_cd
        jsr cmd_str
        ldy #11
vol_dir:
        lda (ZP_ENT),y
        cmp #' '
        beq vol_go
        jsr cmd_char
        iny
        cpy #19
        bne vol_dir
vol_go:
        jsr cmd_run
        lda ZP_TMP
        sta curvol
        lda #$FF                ; block numbers are per disk: drop the cache
        sta lastblk+1
vol_ok:
        lda #0
        clc
        rts

; ---------------------------------------------------------------------------
; Block read: block number word at pointer -> 512 bytes at $D600 (bank 1).

e_rdblk:
        lda #F_PTR
        sta ZP_FLAGS
        jsr take_params
        ldy #0
        lda (ZP_NAME),y         ; block low
        sta ZP_TMP
        iny
        lda (ZP_NAME),y         ; block high
        sta ZP_TMP+1
        ; TEMP.SUBS reads each block twice in a row (once per 256-byte half).
        ; Reuse $D600 when it still holds that block and is unmodified.
        lda ZP_TMP
        cmp lastblk
        bne rb_miss
        lda ZP_TMP+1
        cmp lastblk+1
        bne rb_miss
        jsr buf_sum
        cpx lastsum
        bne rb_miss
        cpy lastsum+1
        bne rb_miss
        lda #0
        clc
        rts
rb_miss:
        lda ZP_TMP
        sta lastblk
        lda ZP_TMP+1
        sta lastblk+1
        jsr cmd_start
        ldx #<s_fraw
        ldy #>s_fraw
        jsr cmd_str
        lda ZP_TMP+1            ; file = RAW(block / 8), two hex digits
        asl
        asl
        asl
        asl
        asl
        sta ZP_TMP+1
        lda ZP_TMP
        lsr
        lsr
        lsr
        ora ZP_TMP+1
        jsr cmd_hex
        ldx #<s_d600
        ldy #>s_d600
        jsr cmd_str
        lda ZP_TMP              ; start offset = (block & 7) * 512
        and #$07
        asl
        sta ZP_TMP
        jsr cmd_hex
        ldx #<s_00
        ldy #>s_00
        jsr cmd_str
        lda ZP_TMP              ; FLOAD's last operand is the inclusive end
        inc a
        jsr cmd_hex
        ldx #<s_ff
        ldy #>s_ff
        jsr cmd_str
        jsr cmd_run
        jsr buf_sum
        stx lastsum
        sty lastsum+1
        lda #0
        clc
        rts

; Fletcher-16 of $D600-$D7FF -> X (sum), Y (sum of sums).
buf_sum:
        lda #<$D600
        sta ZP_RET
        lda #>$D600
        sta ZP_RET+1
        ldx #0
        stx ZP_EOF
        stx ZP_EOF+1
bs_page:
        ldy #0
bs_loop:
        lda (ZP_RET),y
        clc
        adc ZP_EOF
        adc #0
        sta ZP_EOF
        clc
        adc ZP_EOF+1
        adc #0
        sta ZP_EOF+1
        iny
        bne bs_loop
        inc ZP_RET+1
        inx
        cpx #2
        bne bs_page
        ldx ZP_EOF
        ldy ZP_EOF+1
        rts

lastblk:    .word $FFFF
lastsum:    .word 0

e_wrblk:
        lda #F_PTR
        sta ZP_FLAGS
        jsr take_params
        lda #$27                ; ProDOS "I/O error": never used by the game
        sec
        rts

; ---------------------------------------------------------------------------
; Command buffer helpers (cmdbuf lives in the resident page).

cmd_start:
        lda #CTRL_D
        stz ZP_CMD
        bra cmd_char
cmd_space:
        lda #' '
cmd_char:
        phx
        ldx ZP_CMD
        sta CMDBUF,x
        inc ZP_CMD
        plx
        rts
cmd_str:                        ; NUL-terminated string at X/Y
        stx ZP_RET
        sty ZP_RET+1
        ldy #0
cs_loop:
        lda (ZP_RET),y
        beq cs_done
        jsr cmd_char
        iny
        bne cs_loop
cs_done:
        rts
cmd_key:
        ldy #0
ck_loop:
        lda key,y
        cmp #' '
        beq ck_done
        jsr cmd_char
        iny
        cpy #8
        bne ck_loop
ck_done:
        rts
cmd_hex:
        pha
        lsr
        lsr
        lsr
        lsr
        jsr cmd_nyb
        pla
        and #$0F
cmd_nyb:
        ora #'0'
        cmp #'9'+1
        bcc cn_store
        adc #6
cn_store:
        jmp cmd_char
cmd_run:
        lda #CR
        jsr cmd_char
        ldx #$0F
cr_save:
        lda $B0,x               ; ROM DOS / FAT32 zero page
        sta zsave,x
        dex
        bpl cr_save
        lda $36
        sta zsave+16
        lda $37
        sta zsave+17
        lda romcsw              ; COUT -> ROM DOS command collector
        sta $36
        lda romcsw+1
        sta $37
        lda #$80
        sta MUTE_OUTPUT
        jsr ROM_SEND
        lda zsave+16
        sta $36
        lda zsave+17
        sta $37
        ldx #$0F
cr_restore:
        lda zsave,x
        sta $B0,x
        dex
        bpl cr_restore
        rts

romcsw:     .word 0             ; captured by the loader from the $03EA hook
zsave:      .res 18

; ---------------------------------------------------------------------------
; SNES controllers. The resident's pad_key calls this (bank 1 mapped) in
; place of the game's keyboard reads. Both pads are read straight from VIA1
; port B, as the ROM's own scan does but without $C070 and its timer NMIs:
; PB6 latch, PB7 clock, PB5/PB4 pad 1/2 data (active low), SNES bit order
; B Y Select Start Up Down Left Right A X L R. The pads are merged.
; A new press types its mapped key into $C000 (as the ROM does for a PS/2
; key), only when no key is pending. A held direction repeats after
; PAD_DELAY, then every PAD_REPEAT, and only while the game's key queue
; ($B8, MAIN.SUBS and STARTUP) is empty, so releasing the pad stops at once.
; Time comes from VIA1 Timer 2 (one-shot mode keeps counting down; read-only
; use of T2H, 256 cycles per unit). Preserves X and Y.

PORTB       = $C200
VIA_T2H     = $C209
KEYQ_LEN    = $B8
PAD_MIN     = 8                 ; ~1.3 ms between pad reads
PAD_DELAY   = 2400              ; ~0.39 s before a held direction repeats
PAD_REPEAT  = 1100              ; ~0.18 s between repeats

pad_poll:
        phx
        phy
        cld
        ldy VIA_T2H             ; elapsed = last - now (T2 counts down)
        tya
        eor #$FF
        sec
        adc pad_t2
        sty pad_t2
        clc
        adc pad_since
        bcc pp_sum
        lda #$FF
pp_sum:
        sta pad_since
        cmp #PAD_MIN
        bcs pp_time
pp_out:
        ply
        plx
        rts
pp_time:
        sec                     ; repeat countdown -= time since last read
        lda pad_rpt
        sbc pad_since
        sta pad_rpt
        lda pad_rpt+1
        sbc #0
        sta pad_rpt+1
        stz pad_since
        bit $C000               ; a key is still pending: try again later
        bmi pp_out
        jsr pad_read
        lda pad_prev            ; released buttons may fire again
        and pad_cur
        sta pad_prev
        lda pad_prev+1
        and pad_cur+1
        sta pad_prev+1
        lda pad_prev            ; first new press
        eor #$FF
        and pad_cur
        sta pad_new
        lda pad_prev+1
        eor #$FF
        and pad_cur+1
        sta pad_new+1
        ldx #0
pp_find:
        lsr pad_new+1
        ror pad_new
        bcs pp_new
        inx
        cpx #12
        bne pp_find
        lda pad_cur             ; no new press: repeat a held direction
        and #$F0
        beq pp_done
        lda KEYQ_LEN
        bne pp_done
        lda pad_rpt+1
        bpl pp_done
        lda pad_cur
        lsr a
        lsr a
        lsr a
        lsr a
        ldx #4
pp_dir:
        lsr a
        bcs pp_held
        inx
        bra pp_dir
pp_held:
        lda #<PAD_REPEAT
        sta pad_rpt
        lda #>PAD_REPEAT
        sta pad_rpt+1
        bra pp_type
pp_new:
        lda bitmask,x
        cpx #8
        bcs pp_hi
        ora pad_prev
        sta pad_prev
        bra pp_mark
pp_hi:
        ora pad_prev+1
        sta pad_prev+1
pp_mark:
        cpx #4
        bcc pp_type
        cpx #8
        bcs pp_type
        lda #<PAD_DELAY
        sta pad_rpt
        lda #>PAD_DELAY
        sta pad_rpt+1
pp_type:
        lda padmap,x
        sta $C000
pp_done:
        ply
        plx
        rts

; pad_cur = buttons held on either pad (bit n = SNES bit n, 1 = pressed)
pad_read:
        stz PORTB
        lda #$40
        sta PORTB               ; latch
        ldx #16
pr_bit:
        stz PORTB               ; latch low, clock low: data valid
        lda PORTB
        and #$30
        eor #$30
        cmp #1                  ; carry = either pad pulls its data low
        ror pad_cur+1
        ror pad_cur
        lda #$80
        sta PORTB               ; clock high: next bit
        dex
        bne pr_bit
        stz PORTB
        lda pad_cur+1
        and #$0F
        sta pad_cur+1
        rts

; Key typed for each SNES bit (high bit set, as in $C000).
padmap:     .byte $A0           ; B      Space (pass / continue)
            .byte $C1           ; Y      A (attack)
            .byte $D1           ; Select Q (quit & save)
            .byte $DA           ; Start  Z (Ztats)
            .byte $8B           ; Up     up arrow
            .byte $8A           ; Down   down arrow
            .byte $88           ; Left   left arrow
            .byte $95           ; Right  right arrow
            .byte $8D           ; A      Return
            .byte $D4           ; X      T (talk)
            .byte $9B           ; L      Esc
            .byte $C5           ; R      E (enter / klimb)
bitmask:    .byte $01,$02,$04,$08,$10,$20,$40,$80,$01,$02,$04,$08
pad_t2:     .byte 0
pad_since:  .byte 0
pad_rpt:    .word 0
pad_cur:    .word 0
pad_new:    .word 0
pad_prev:   .word $0FFF         ; ignore buttons already held at start

s_fload:    .asciiz "FLOAD "
s_zero:     .asciiz " 0000 "
s_owrite:   .asciiz "OWRITE "
s_fraw:     .asciiz "FLOAD RAW"
s_d600:     .asciiz " D600 "
s_00:       .asciiz "00 "
s_ff:       .asciiz "FF"
s_cd:       .asciiz "CD "
s_cdup:     .asciiz "CD .."
key:        .res 8
code_end:

; $D600-$D7FF is the block buffer (callers copy from it). The tool appends
; filetab (13-byte entries: key[8], aux, eof, volume mask) and voltab
; (19-byte entries: volume name NUL-padded to 11, directory space-padded to
; 8) at $D800, and stores BANKSIG_VALUE at $DFFF for the resident NMI test.
        .org $D800
