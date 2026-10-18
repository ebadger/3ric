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
; plus $D02A pad_poll (resident pad_key), $D02D mus_tick (resident IRQ) and
; $D030 mus_ctl_b1 (glue.s mus_ctl), see music.s.
;
; Return: carry clear and A=0 on success, carry set and A=ProDOS-style error
; otherwise. Load+run jumps to the load address. Each disk is a directory
; under the folder the loader ran from; ProDOS names become 8-character keys
; (dots removed). Files are found, read and written with the ROM's own FAT32
; routines - the calls its FLOAD and OWRITE commands make - through the
; resident's rom_call (ROM reads, bank-1 writes), in the current disk's
; directory only, so a missing file fails here exactly as on the floppy.
; A load reads bytes [0, size-1] (the ROM's end offset is inclusive); a
; write rewrites the file's sectors in place, as OWRITE does. The ProDOS
; load address (aux type) of each name is looked up in auxtab by a 16-bit
; hash of the key. Selecting a disk sets the ROM's current-directory cluster
; from voltab, which the loader filled in. The disk's blocks are exported as
; RAW00-RAW22 (eight blocks, 4 KB, each); a block read loads 512 bytes of
; RAWnn into $D600, and a one-block cache absorbs the game's habit of
; reading every block twice (once per 256-byte half). Each ROM session
; saves the ROM's zero page $B0-$BF and holds off the music timer.
;
; Uses only DINKEYDOS's zero page ($52-$55, $60-$7F).

ZP_RET      = $52               ; scratch pointer
ZP_LOADADR  = $62               ; load address (DINKEYDOS contract)
ZP_P        = $68               ; inline parameter pointer
ZP_NAME     = $6A               ; file/volume name pointer
ZP_ADDR     = $6C               ; explicit address (0 = use aux type)
ZP_FLAGS    = $70
ZP_CNT      = $71
ZP_TMP      = $76               ; block number / key hash
ZP_SUM      = $74               ; Fletcher sums

F_PTR       = $01
F_ADDR      = $02
F_SKIP2     = $04
F_RUN       = $08
F_WRITE     = $10

FAT_SIZE    = $CC10             ; file size (fat32_opendirent)
FAT_CD      = $CC20             ; current directory cluster
FAT_ADDR    = $CC30             ; fat32_file_write source
FAT_END     = $CC35             ; fat32_file_read_part last byte (inclusive)
FAT_OFFSET  = $CC3B             ; fat32_file_read_part first byte
FAT_NAME    = $CD70             ; 8.3 name fat32_finddirent matches
FAT_DEST    = $BC               ; fat32_file_read_part destination

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
        jmp mus_tick            ; $D02D: music timer tick (resident IRQ)
        jmp mus_ctl_b1          ; $D030: music pause / resume (glue.s)

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

; ---------------------------------------------------------------------------
; Load / load+run / write a file of the current disk.

file_op:
        sta ZP_FLAGS
        jsr take_params
        jsr make_key
        jsr rom_begin
        jsr open_key
        bcs fo_missing
        lda ZP_ADDR
        ora ZP_ADDR+1
        bne fo_addr
        jsr aux_lookup
fo_addr:
        lda ZP_ADDR
        sta ZP_LOADADR
        lda ZP_ADDR+1
        sta ZP_LOADADR+1
        lda ZP_FLAGS
        and #F_WRITE
        bne fo_write
        ldx ZP_ADDR
        ldy ZP_ADDR+1
        jsr read_file
        jsr rom_end
        lda ZP_FLAGS
        and #F_RUN
        beq ok
        jmp (ZP_LOADADR)
fo_write:
        lda ZP_ADDR
        sta FAT_ADDR
        lda ZP_ADDR+1
        sta FAT_ADDR+1
        ldx #<ROM_FILE_WRITE
        ldy #>ROM_FILE_WRITE
        jsr ROM_CALL
        bcs fo_ioerr
        ldx #<ROM_OPEN_CD       ; as OWRITE does afterwards
        ldy #>ROM_OPEN_CD
        jsr ROM_CALL
        jsr rom_end
ok:
        lda #0
        clc
        rts
fo_missing:
        jsr rom_end
        lda #$46                ; ProDOS "file not found"
        sec
        rts
fo_ioerr:
        jsr rom_end
io_error:
        lda #$27                ; ProDOS "I/O error"
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
; ProDOS name at ZP_NAME -> 8-byte key (dots removed, upper case, space
; padded; NUL or '/' ends the name).

make_key:
        ldx #0
        ldy #0
mk_loop:
        lda (ZP_NAME),y
        and #$7F
        beq mk_pad
        cmp #'/'
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

; key -> ZP_TMP: h = rotate_left(h, 3) xor c over the eight key bytes
; (port-ultima5.mjs keyHash computes the same).
key_hash:
        stz ZP_TMP
        stz ZP_TMP+1
        ldy #0
kh_loop:
        ldx #3
kh_rot:
        asl ZP_TMP
        rol ZP_TMP+1
        bcc kh_nc
        inc ZP_TMP
kh_nc:
        dex
        bne kh_rot
        lda key,y
        eor ZP_TMP
        sta ZP_TMP
        iny
        cpy #8
        bne kh_loop
        rts

; ZP_ADDR = the key's ProDOS aux type (0 if not listed). auxtab holds groups
; [count, aux low, aux high, count x (hash low, hash high)], then 0.
aux_lookup:
        jsr key_hash
        ldx #0
al_group:
        lda auxtab,x
        beq al_none
        sta ZP_CNT
        lda auxtab+1,x
        sta ZP_ADDR
        lda auxtab+2,x
        sta ZP_ADDR+1
        inx
        inx
        inx
al_ent:
        lda auxtab,x
        cmp ZP_TMP
        bne al_skip
        lda auxtab+1,x
        cmp ZP_TMP+1
        beq al_found
al_skip:
        inx
        inx
        dec ZP_CNT
        bne al_ent
        bra al_group
al_none:
        stz ZP_ADDR
        stz ZP_ADDR+1
al_found:
        rts

; ---------------------------------------------------------------------------
; ROM FAT32 sessions. Between rom_begin and rom_end the ROM owns the
; interrupt vectors, so the Mockingboard timer is held off.

rom_begin:
        ldx #$0F
rb_save:
        lda $B0,x               ; ROM DOS / FAT32 zero page
        sta zsave,x
        dex
        bpl rb_save
        lda MUS_IER
        beq rb_done             ; no Mockingboard
        lda #$40
        sta MB_IER
rb_done:
        rts

rom_end:
        ldx #$0F
re_rest:
        lda zsave,x
        sta $B0,x
        dex
        bpl re_rest
        lda MUS_IER
        beq re_done
        sta MB_IER
re_done:
        rts

; Find key in the current directory: carry clear and the file open
; (FAT_SIZE etc. set) if found.
open_key:
        ldx #<ROM_OPEN_CD
        ldy #>ROM_OPEN_CD
        jsr ROM_CALL
        ldx #10
ok_name:
        lda #' '
        cpx #8
        bcs ok_store
        lda key,x
ok_store:
        sta FAT_NAME,x
        dex
        bpl ok_name
        ldx #<ROM_FINDDIRENT
        ldy #>ROM_FINDDIRENT
        jsr ROM_CALL
        bcs ok_done
        ldx #<ROM_OPENDIRENT
        ldy #>ROM_OPENDIRENT
        jsr ROM_CALL
        clc
ok_done:
        rts

; Read the whole open file to X (low) / Y (high).
read_file:
        stx FAT_DEST
        sty FAT_DEST+1
        stz FAT_OFFSET
        stz FAT_OFFSET+1
        lda FAT_SIZE
        sec
        sbc #1
        sta FAT_END
        lda FAT_SIZE+1
        sbc #0
        sta FAT_END+1
read_part:
        ldx #<ROM_READ_PART
        ldy #>ROM_READ_PART
        jmp ROM_CALL

; ---------------------------------------------------------------------------
; Volume selection: "/NAME" (optionally "/NAME/") -> that disk's directory.
; voltab: 8 x [key hash low, high, directory cluster (4 bytes)].

e_vol_i:
        lda #0
        bra vol_op
e_vol_p:
        lda #F_PTR
vol_op:
        sta ZP_FLAGS
        jsr take_params
        lda (ZP_NAME)
        and #$7F
        cmp #'/'
        beq vol_find
        lda #$10                ; DINKEYDOS: a bare name is not a volume
        sec
        rts
vol_find:
        inc ZP_NAME
        bne vf_key
        inc ZP_NAME+1
vf_key:
        jsr make_key
        jsr key_hash
        ldx #0
vf_next:
        lda voltab,x
        cmp ZP_TMP
        bne vf_skip
        lda voltab+1,x
        cmp ZP_TMP+1
        beq vf_found
vf_skip:
        txa
        clc
        adc #6
        tax
        cpx #48
        bne vf_next
        lda #$45                ; ProDOS "volume not found"
        sec
        rts
vf_found:
        ldy #0
vf_cd:
        lda voltab+2,x
        cmp FAT_CD,y
        beq vf_same
        sta FAT_CD,y
        lda #$FF                ; block numbers are per disk: drop the cache
        sta lastblk+1
vf_same:
        inx
        iny
        cpy #4
        bne vf_cd
        jmp ok

; ---------------------------------------------------------------------------
; Block read: block number word at pointer -> 512 bytes at $D600 (bank 1).

e_rdblk:
        lda #F_PTR
        sta ZP_FLAGS
        jsr take_params
        lda (ZP_NAME)           ; block low
        sta ZP_TMP
        ldy #1
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
        jmp ok
rb_miss:
        lda #$FF
        sta lastblk+1
        ldx #2                  ; key = "RAWnn", nn = block / 8 in hex
rb_raw:
        lda s_raw,x
        sta key,x
        dex
        bpl rb_raw
        lda ZP_TMP+1
        asl
        asl
        asl
        asl
        asl
        sta ZP_CNT
        lda ZP_TMP
        lsr
        lsr
        lsr
        ora ZP_CNT
        ldx #3
        jsr key_hex
        lda #' '
        sta key+5
        sta key+6
        sta key+7
        jsr rom_begin
        jsr open_key
        bcc rb_open
        jmp fo_ioerr
rb_open:
        stz FAT_OFFSET          ; offset = (block & 7) * 512
        lda ZP_TMP
        and #$07
        asl
        sta FAT_OFFSET+1
        inc a
        sta FAT_END+1           ; last byte = offset + 511
        lda #$FF
        sta FAT_END
        lda #<$D600
        sta FAT_DEST
        lda #>$D600
        sta FAT_DEST+1
        jsr read_part
        jsr rom_end
        lda ZP_TMP
        sta lastblk
        lda ZP_TMP+1
        sta lastblk+1
        jsr buf_sum
        stx lastsum
        sty lastsum+1
        jmp ok

; A -> two hex digits at key+X, key+X+1.
key_hex:
        pha
        lsr
        lsr
        lsr
        lsr
        jsr kx_nyb
        pla
        and #$0F
kx_nyb:
        ora #'0'
        cmp #'9'+1
        bcc kx_store
        adc #6
kx_store:
        sta key,x
        inx
        rts

; Fletcher-16 of $D600-$D7FF -> X (sum), Y (sum of sums).
buf_sum:
        lda #<$D600
        sta ZP_RET
        lda #>$D600
        sta ZP_RET+1
        ldx #0
        stx ZP_SUM
        stx ZP_SUM+1
bs_page:
        ldy #0
bs_loop:
        lda (ZP_RET),y
        clc
        adc ZP_SUM
        adc #0
        sta ZP_SUM
        clc
        adc ZP_SUM+1
        adc #0
        sta ZP_SUM+1
        iny
        bne bs_loop
        inc ZP_RET+1
        inx
        cpx #2
        bne bs_page
        ldx ZP_SUM
        ldy ZP_SUM+1
        rts

lastblk:    .word $FFFF
lastsum:    .word 0
s_raw:      .text "RAW"

e_wrblk:
        lda #F_PTR
        sta ZP_FLAGS
        jsr take_params
        jmp io_error            ; never used by the game

zsave:      .res 16
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
        jsr mus_fg              ; load a song the player is waiting for
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

key:        .res 8
