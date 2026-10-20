; M.U.L.E. for 3RIC - display: the Atari screen redrawn on the hi-res page.
;
; Runs in language-card bank 1 from the 60 Hz tick (rt.s vbi_after), after
; the game's own VBI. Phase 1, interrupts off: walk the ANTIC display list
; the game left in the register file, record every mode line in a line
; table, and call the game's display-list-interrupt handlers where ANTIC
; would, so the colours, character sets and player and missile positions
; and widths they change per band are captured (the handlers' register
; stores land in this bank's copy of the register file at $D000/$D400).
; Phase 2, interrupts on: redraw the bands whose contents or sprites
; changed into the hi-res page at HIRES*256 ($2000 for the game; $4000 for
; the intro, which runs while the loader and the hand-off stash hold
; $2000-$3FFF), each row with its sprites (see draw_lines).
;
; Mapping: one Atari character column = one hi-res byte (7 pixels for 8,
; or 14 for 16 in the 20-column modes; four 2-bit pixels per byte in modes
; 4/5 and D/E); Atari colours become the nearest
; hi-res colour. Lines keep their height; if a display list is taller than
; 192 lines its blank lines are halved. Addresses in $2000-$3FFF (moved to
; $E000) are translated. Sprites: see "players".
;
; Prepended by the converter: RENDER, FONT, T2TAB, HIRES, RROWS, VC_FAKE,
; RAM2_R, rt.s's snap_g/snap_a as SNAP_G/SNAP_A and its COL_CLASS,
; COL_EVEN, COL_ODD, R_FLAGS, RENDERING; per build R_FLAG, R_OVF, R_DAT,
; R_OVD and MD_MODE (see the per-build segment at the end).

zdl     = $30                   ; display list pointer
zsrc    = $32                   ; screen memory
zhr     = $34                   ; hi-res row
zg      = $36                   ; glyph pointer
zrow    = $38                   ; glyph row (0-7)
zcb     = $39                   ; character set page
zt0     = $3A
zt1     = $3B
zt2     = $3C
zt3     = $3D
zt4     = $3E
zt5     = $3F

NL      = 48                    ; line table entries
lt_mode = $D020                 ; line table (bank 1, between the register
lt_mslo = $D050                 ; copies the game's handlers write)
lt_mshi = $D080
lt_hrow = $D0B0
lt_rows = $D0E0
lt_line = $D110
lt_h    = $D140
lt_chb  = $D170
                                ; ($D1A0-$D1CF: pc_par and the player
                                ; tables, after render_end)
lt_c0   = $D1D0
lt_c1   = $D210
lt_c2   = $D240
lt_c3   = $D270
lt_cbk  = $D2A0
lt_hp0  = $D2D0
lt_hp1  = $D304
lt_hp2  = $D334
lt_hp3  = $D364
lt_pc0  = $D394
lt_pc1  = $D3C4
lt_pc2  = $D410
lt_pc3  = $D440
pv_lo   = $D470
pv_hi   = $D4A0

r_n     = $D4D0                 ; entries this frame
r_line  = $D4D1
r_hrow  = $D4D2
r_comp  = $D4D3
r_ofs   = $D4D4
r_seen  = $D4D5
r_mslo  = $D4D6
r_mshi  = $D4D7
r_i     = $D4D8
r_rr    = $D4D9                 ; round-robin forced redraw
r_hlo   = $D4DA
r_hhi   = $D4DB
r_end   = $D4DC                 ; first row below the drawn lines
r_pend  = $D4DD                 ; previous frame's r_end
r_cnt   = $D4DE
r_lead  = $D4DF
r_tot   = $D4E0
r_blk   = $D4E1
r_cm    = $D4E2                 ; 10 bytes: colour masks even/odd x 5
r_pal   = $D4EC
r_x     = $D4ED
r_nb    = $D4EE
r_k     = $D4EF
r_gl    = $D4F0
r_cls   = $D4F1
r_dc    = $D4FD                 ; changes this frame
r_rrc   = $D4FE                 ; renders until the next forced redraw
r_rrn   = $D4FF                 ; next entry to force
RR_EVERY = 16

B1DATA   = $D3F4                ; 12 bytes between lt_pc1 and the ANTIC copy
rd_bits  = B1DATA               ; 6: entries to redraw this frame
r_pmf    = B1DATA+6             ; bit 1 players on, bit 0 missiles (pm_init)
r_o      = B1DATA+7             ; sprite (0-3 players, 4 the missiles)
r_ob     = B1DATA+8             ; sprite object being worked out (ob_get)
r_pcv    = B1DATA+9             ; COLPM of the sprite being drawn
r_rvf    = B1DATA+10            ; ob_get's c_ok: 2 for the river
r_sz     = B1DATA+11            ; SIZEP/SIZEM of the sprite being drawn
; in page 3, after the runtime's variables
r_par    = RROWS                ; the lit dot of a colour cell (pc_par)
r_src    = RROWS+1              ; the player or missile byte being drawn
r_hpg    = RROWS+2              ; HIRES, for the RAM2 code (the same in
                                ; both builds); then the c_* sprite cache
r_ebk    = RROWS+51             ; set_colors: the background's hi-res colour
r_ctr    = RROWS+52             ;   and the masks for a clash with it
RROWS_END = RROWS+53

        .org RENDER

render: php
        sei
        lda #HIRES
        sta r_hpg
        lda #DBL                ; the intro: draw on the page not shown
        beq rd0                 ; (R_OVD's db_page)
        jsr db_page
rd0:    ldx #$1F                ; this bank's register file = the game's
rd1:    lda SNAP_G,x
        sta $D000,x
        dex
        bpl rd1
        ldx #$0F
rd2:    lda SNAP_A,x
        sta $D400,x
        dex
        bpl rd2
        jsr walk
        lda #$FF
        sta VC_FAKE
        lda #R_FLAG             ; rt.s: bit 7 for the intro (no player
        sta R_FLAGS             ; collisions, console keys held over
                                ; redraws)
        plp
        jsr draw_lines
        lda #DBL                ; the intro: show the page just drawn
        beq rn_x
        jmp db_flip
rn_x:   rts

; ---------------------------------------------------------------- phase 1
xlat_hi:                        ; $20-$3F -> $E0-$FF (the moved window)
        cmp #$20
        bcc xh1
        cmp #$40
        bcs xh1
        adc #$C0
xh1:    rts

dl_byte:                        ; A = next display list byte
        lda (zdl)
        inc zdl
        bne db1
        inc zdl+1
db1:    rts

dl_start:
        lda $D402
        sta zdl
        lda $D403
        jsr xlat_hi
        sta zdl+1
        rts

walk:   stz r_n
        lda $D400               ; display list DMA off: nothing to show
        and #$20
        bne wk0
        rts
wk0:    jsr measure
        jsr dl_start
        lda #8
        sta r_line
        lda r_ofs
        sta r_hrow
        stz r_seen
wk_loop:
        lda r_n
        cmp #NL
        bcs wk_out
        lda r_line
        cmp #248
        bcc wk_go
wk_out: jmp wk_end
wk_go:
        jsr dl_byte
        sta zt0                 ; instruction
        and #$0F
        sta zt1                 ; mode
        beq wk_blank
        cmp #1
        beq wk_jump
        lda zt0                 ; mode line, maybe with a new address
        and #$40
        beq wk_nolms
        jsr dl_byte
        sta r_mslo
        jsr dl_byte
        jsr xlat_hi
        sta r_mshi
wk_nolms:
        lda r_seen              ; the first mode line: the leading blank
        bne wk_m1               ; lines on the screen above it become one
        lda r_ofs               ; entry, so they are cleared and players
        beq wk_m1               ; over them are drawn
        sta zt2
        sta zt3
        jsr record              ; (X = the new entry)
        stz lt_mode,x
        stz lt_hrow,x
        lda r_line
        sec
        sbc r_ofs
        sta lt_line,x
wk_m1:  ldx zt1
        lda mode_h,x
        sta zt2
        sta zt3
        lda #1
        sta r_seen
        jsr record
        ldx zt1
        lda mode_nb,x
        clc
        adc r_mslo
        sta r_mslo
        bcc wk_adv
        inc r_mshi
        lda r_mshi
        jsr xlat_hi
        sta r_mshi
        bra wk_adv
wk_blank:
        lda zt0
        lsr a
        lsr a
        lsr a
        lsr a
        and #$07
        clc
        adc #1
        sta zt2
wk_br:  jsr blank_rows
        lda zt3                 ; a leading blank line: no entry (wk_nolms
        beq wk_adv              ; covers those on the screen)
        jsr record
        bra wk_adv
wk_jump:
        jsr dl_byte
        pha
        jsr dl_byte
        jsr xlat_hi
        sta zdl+1
        pla
        sta zdl
        lda zt0
        and #$40
        beq wk_j1
        jmp wk_end              ; JVB: end of frame
wk_j1:  stz zt1                 ; a jump: one blank line (as wk_blank)
        lda #1
        sta zt2
        bra wk_br
wk_adv: lda zt0                 ; display list interrupt at the line's end
        bpl wk_nodli
        lda $D40E
        bpl wk_nodli
        lda r_line
        clc
        adc zt2
        lsr a
        sta VC_FAKE
        jsr call_dli
wk_nodli:
        lda r_line
        clc
        adc zt2
        bcc wk_ok
        jmp wk_end
wk_ok:  sta r_line
        lda r_hrow
        clc
        adc zt3
        bcc wk_h
        lda #$FF
wk_h:   sta r_hrow
        jmp wk_loop
wk_end: rts

blank_rows:                     ; zt3 = rows for zt2 blank lines
        lda r_seen              ; (0 for leading ones)
        bne br1
        stz zt3
        rts
br1:    lda zt2
        ldx r_comp
        beq br2
        inc a
        lsr a
br2:    sta zt3
        rts

call_dli:
        lda #>dli_ret
        pha
        lda #<dli_ret
        pha
        php
        jmp ($0200)
dli_ret:
        rts

record: ldx r_n
        lda zt1
        sta lt_mode,x
        lda r_mslo
        sta lt_mslo,x
        lda r_mshi
        sta lt_mshi,x
        lda r_hrow
        sta lt_hrow,x
        lda zt3
        sta lt_rows,x
        lda r_line
        sta lt_line,x
        lda zt2
        sta lt_h,x
        lda $D409
        sta lt_chb,x
        lda $D016
        sta lt_c0,x
        lda $D017
        sta lt_c1,x
        lda $D018
        sta lt_c2,x
        lda $D019
        sta lt_c3,x
        lda $D01A
        sta lt_cbk,x
        lda $D000
        sta lt_hp0,x
        lda $D001
        sta lt_hp1,x
        lda $D002
        sta lt_hp2,x
        lda $D003
        sta lt_hp3,x
        lda $D012
        sta lt_pc0,x
        lda $D013
        sta lt_pc1,x
        lda $D014
        sta lt_pc2,x
        lda $D015
        sta lt_pc3,x
        jsr rec_hole            ; (RAM2) HPOSM0-3, SIZEP0-3
        inc r_n
        rts

; Height of the display list: leading blank lines, total below them, and
; whether blank lines must be halved to fit 192 rows.
measure:
        jsr dl_start
        stz r_lead
        stz r_tot
        stz r_blk
        stz r_seen
        lda #8
        sta r_line
        lda #64
        sta r_cnt
ms_loop:
        dec r_cnt
        beq ms_x
        lda r_line
        cmp #248
        bcc ms_go
ms_x:   jmp ms_end
ms_go:
        jsr dl_byte
        sta zt0
        and #$0F
        tax
        beq ms_blank
        cpx #1
        beq ms_jump
        lda zt0
        and #$40
        beq ms_m
        jsr dl_byte
        jsr dl_byte
ms_m:   lda mode_h,x
        ldx #1
        stx r_seen
        bra ms_add
ms_jump:
        jsr dl_byte
        pha
        jsr dl_byte
        jsr xlat_hi
        sta zdl+1
        pla
        sta zdl
        lda zt0
        and #$40
        bne ms_x
        lda #1
        bra ms_b
ms_blank:
        lda zt0
        lsr a
        lsr a
        lsr a
        lsr a
        and #$07
        clc
        adc #1
ms_b:   ldx r_seen
        bne ms_b2
        pha
        clc
        adc r_lead
        sta r_lead
        pla
        clc
        adc r_line
        bcs ms_x
        sta r_line
        bra ms_loop
ms_b2:  pha
        clc
        adc r_blk
        sta r_blk
        pla
ms_add: pha
        clc
        adc r_tot
        sta r_tot
        pla
        clc
        adc r_line
        bcs ms_x2
        sta r_line
        jmp ms_loop
ms_x2:
ms_end: stz r_comp
        stz r_ofs
        lda r_line              ; content height = end line - 8 - lead
        sec
        sbc #8
        sec
        sbc r_lead
        cmp #193
        bcc ms_fit
        lda #1
        sta r_comp
        rts
ms_fit: sta zt0                 ; keep the usual 24-line top margin
        lda #192
        sec
        sbc zt0
        sta zt1                 ; room
        lda r_lead
        sec
        sbc #24
        bcs ms_o1
        lda #0
ms_o1:  cmp zt1
        bcc ms_o2
        lda zt1
ms_o2:  sta r_ofs
        rts

;                 0  1  2  3  4  5  6  7  8  9  A  B  C  D  E  F
mode_h:  .byte    1, 1, 8,10, 8,16, 8,16, 8, 4, 4, 2, 1, 2, 1, 1
mode_nb: .byte    0, 0,40,40,40,40,20,20,10,10,20,20,20,40,40,40

; ---------------------------------------------------------------- phase 2
; Nothing is written while the picture is unchanged: every band's hash
; (its layout, colours, screen bytes and the sprite bytes over it) is
; compared with the last frame's, and only the bands that changed are
; redrawn, each row with its players and missiles ORed in as soon as it is
; drawn, so the rest of the picture never blinks (there is no second page
; to flip to) and a moving sprite redraws only the bands it is on.
draw_lines:
        jsr ov_init
        jsr pm_init
        lda #$FF                ; every RR_EVERY renders, one line is redrawn
        sta r_rr                ; regardless (a missed change heals)
        dec r_rrc
        bne dl_r1
        lda #RR_EVERY
        sta r_rrc
        lda r_rrn
        sta r_rr
        inc a
        cmp r_n
        bcc dl_r0
        lda #0
dl_r0:  sta r_rrn
dl_r1:  ldx #5
dl_r2:  stz rd_bits,x
        dex
        bpl dl_r2
        stz r_dc
        stz r_i
        stz r_end
dl_loop:
        lda r_i
        cmp r_n
        bcs dl_done
        jsr entry_hash
        jsr ov_cmp              ; carry set: draw it (dm_*: which columns)
        bcc dl_skip
        ldx r_i
        jsr dirty_bit
        ora rd_bits,y
        sta rd_bits,y
        inc r_dc
dl_skip:
        ldx r_i                 ; r_end = max(hrow + rows)
        lda lt_hrow,x
        clc
        adc lt_rows,x
        bcs dl_e1
        cmp #193
        bcc dl_e2
dl_e1:  lda #192
dl_e2:  cmp r_end
        bcc dl_e3
        sta r_end
dl_e3:  inc r_i
        bra dl_loop
dl_done:
        ldx r_n                 ; entries gone from this frame: redraw them
dl_iv:  cpx #NL                 ; when they come back
        bcs dl_iv2
        lda #$FF                ; (and its sprite columns all: whatever
        sta pv_lo,x             ; its playfield hash, it is drawn whole)
        sta pv_hi,x
        sta om_lo,x
        sta om_hi,x
        inx
        bra dl_iv
dl_iv2: lda r_end
        cmp r_pend
        beq dl_s0
        inc r_dc
dl_s0:  lda r_dc
        bne dl_s5
        rts
dl_s5:
        stz r_i
dl_a1:  lda r_i
        cmp r_n
        bcs dl_d1
        tax
        jsr dirty_bit
        and rd_bits,y
        beq dl_a2
        jsr draw_entry
dl_a2:  inc r_i
        bra dl_a1
dl_d1:  lda r_end               ; clear what an earlier, taller screen left
        cmp r_pend
        bcs dl_d2
        sta zt4
dl_clr: lda zt4
        cmp r_pend
        bcs dl_d2
        jsr row_addr
        jsr clear_row
        inc zt4
        bra dl_clr
dl_d2:  lda r_end
        sta r_pend
        rts

; entry X -> Y = its byte in rd_bits, A = its bit; X = r_i after
dirty_bit:
        txa
        jsr row_bit
        ldx r_i
        rts
; A -> Y = A / 8, A = bit A & 7 (X lost)
row_bit:
        pha
        lsr a
        lsr a
        lsr a
        tay
        pla
        and #$07
        tax
        lda bitv,x
        rts
bitv:   .byte $01,$02,$04,$08,$10,$20,$40,$80

; 16-bit hash of an entry's layout, registers, screen bytes and sprites
entry_hash:
        stz r_hlo
        stz r_hhi
        ldx r_i
        lda lt_mode,x
        jsr hb
        lda lt_hrow,x
        jsr hb
        lda lt_rows,x
        jsr hb
        lda lt_chb,x
        jsr hb
        ldy #8                  ; the colours as the hi-res colours they
eh_c:   lda eh_lo,y             ; become (an Atari colour cycle the 3RIC
        sta eh_ld+1             ; cannot show redraws nothing), players'
        lda eh_hi,y             ; too
        sta eh_ld+2
eh_ld:  lda $FFFF,x
        cmp ec_v,y              ; as the last band's colour in this slot:
        beq eh_c1               ; its hi-res class again
        sta ec_v,y
        jsr COL_CLASS
        sta ec_r,y
eh_c1:  lda ec_v,y              ; bit 7: COLBK itself (cmask_pf draws it
        eor lt_cbk,x            ; differently from another colour of the
        cmp #1                  ; same class)
        lda ec_r,y
        bcs eh_h
        ora #$80
eh_h:   jsr hb
        dey
        bpl eh_c
        lda lt_mode,x
        cmp #2
        bcc eh_done
        tay
        lda mode_nb,y
        sta r_nb
        lda lt_mslo,x
        sta zsrc
        lda lt_mshi,x
        sta zsrc+1
        ldy #0
        lda r_hlo
eh1:    eor (zsrc),y            ; (hb, inline, the hash kept in A)
        asl a
        rol r_hhi
        adc #0
        iny
        cpy r_nb
        bne eh1
        sta r_hlo
eh_done:
        jmp ov_spr
eh_lo:  .byte <lt_c0,<lt_c1,<lt_c2,<lt_c3,<lt_cbk,<lt_pc0,<lt_pc1,<lt_pc2,<lt_pc3
eh_hi:  .byte >lt_c0,>lt_c1,>lt_c2,>lt_c3,>lt_cbk,>lt_pc0,>lt_pc1,>lt_pc2,>lt_pc3
hb:     eor r_hlo
        asl a
        rol r_hhi
        adc #0
        sta r_hlo
        rts

; Hi-res address of row A (0-191) in zhr; A preserved.
; $2000 + (y & 7) * $400 + ((y >> 3) & 7) * $80 + (y >> 6) * 40
row_addr:
        pha
        and #$07
        asl a
        asl a
        ora r_hpg               ; (the page being drawn)
        sta zhr+1
        pla
        pha
        and #$30
        lsr a
        lsr a
        lsr a
        lsr a
        ora zhr+1
        sta zhr+1
        pla
        pha
        and #$08
        asl a
        asl a
        asl a
        asl a
        sta zhr
        pla
        pha
        and #$C0
        beq ra3
        cmp #$40
        beq ra2
        lda #80
        bra ra4
ra2:    lda #40
ra4:    ora zhr
        sta zhr
ra3:    pla
        rts
clear_row:
        lda #0
        ldy #39
cr1:    sta (zhr),y
        dey
        bpl cr1
        rts

; Colour masks for the five playfield colours of entry X:
; r_cm + 2k = even-byte mask, r_cm + 2k + 1 = odd-byte mask (k: BK, PF0-3).
; Modes 4, 5, 8, D and E fill the background with COLBK; the others leave
; it the black hi-res screen. A playfield colour that would come out as that
; background colour is drawn white (black on a white background), unless it
; is COLBK's own Atari colour: dark-on-light text stays readable, and the
; title's gold logo keeps its red letters (white here) and black outlines.
set_colors:
        lda lt_cbk,x
        ldy #0
        jsr cmask
        jsr bk_set              ; (RAM2) r_ebk, r_ctr
        lda lt_c0,x
        ldy #2
        jsr cmask_pf
        lda lt_c1,x
        ldy #4
        jsr cmask_pf
        lda lt_c2,x
        ldy #6
        jsr cmask_pf
        lda lt_c3,x
        ldy #8
        jmp cmask_pf
; a sprite's colour (pc_set): black is drawn white
cmask_fg:
        jsr cmask
        lda r_cm,y
        ora r_cm+1,y
        bne cmf1
        lda #$7F
        sta r_cm,y
        sta r_cm+1,y
cmf1:   rts
cmask:  phx
        jsr col_class
        tax
        lda col_even,x
        sta r_cm,y
        lda col_odd,x
        sta r_cm+1,y
        plx
        rts
; col_class (Atari colour A -> the hi-res colour it becomes, 0-5: black,
; violet, green, white, blue, orange; X, Y kept) and its col_even/col_odd
; masks are in rt.s's RAM2 part (bank 1 is full).

; ---- draw entry r_i
draw_entry:
        jsr spr_new
        ldx r_i
        jsr set_colors
        jsr ov_ent              ; its column runs and pixel tables
        lda lt_mslo,x
        sta zsrc
        lda lt_mshi,x
        sta zsrc+1
        lda lt_chb,x            ; character set page (the ROM font -> FONT)
        and #$FC
        cmp #$E0
        bne de1
        lda #>FONT
de1:    sta zcb
        stz zt5                 ; row within the entry
        bra de_row
de_x:   rts
de_row: lda zt5
        cmp lt_rows,x
        bcs de_x
        clc
        adc lt_hrow,x
        bcs de_x
        cmp #192
        bcs de_x
        jsr row_addr
        lda zt5                 ; the second scan line of a mode 5, 7 or D
        lsr a                   ; line: a copy of the first (unless sprites
        bcc de_go               ; were ORed into the first)
        lda lt_mode,x
        cmp #5
        beq de_cp
        cmp #7
        beq de_cp
        cmp #$0D
        bne de_go
de_cp:  lda zt5
        dec a
        clc
        adc lt_line,x
        jsr ln_spr
        ldx r_i
        bcs de_go
        ldy #39
de_cp1: lda (zdl),y
        sta (zhr),y
        dey
        bpl de_cp1
        jmp de_next
de_go:  jmp ov_go               ; the row by its mode, then de_next
de_next:
        jsr de_spr              ; the row's players and missiles
        lda zhr                 ; the row just drawn (zdl is free in phase 2)
        sta zdl
        lda zhr+1
        sta zdl+1
        ldx r_i
        inc zt5
        jmp de_row

; glyph byte for character A (code & mask already applied) at row zrow
glyph:  pha
        asl a
        asl a
        asl a
        ora zrow
        sta zg
        pla
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        ora zcb
        sta zg+1
        lda (zg)
        rts

; ANTIC 2: 40 columns, one colour on the background, bit 7 = inverse
; (columns r_c0 to r_c1)
row_t40:
        ldy r_c0
rt40:   sty r_x
        lda (zsrc),y
        sta r_cls
        and #$7F
        jsr glyph
        tay
        lda T2TAB,y
        bit r_cls
        bpl rt40a
        ldy r_x
        eor #$7F
        bra rt40b
rt40a:  ldy r_x
rt40b:  sta (zhr),y
        iny
        cpy r_c1
        bne rt40
        rts

; ANTIC 6/7: 20 columns of two bytes, bits 6-7 pick PF0-PF3. Code 0 (the
; Atari space) uses glyph 0's row, looked up once; a row of nothing else,
; with that row blank, is filled black at once (the title's text bands are
; mostly that, under the walking characters)
row_t20:
        jsr t20_pre             ; (RAM2)
        bcc rt20s
        rts
rt20s:  ldy r_t0                ; characters r_t0 to r_t1
rt20:   sty r_x
        lda (zsrc),y
        sta r_cls
        and #$3F
        beq rt20o
        jsr glyph
        bne rt20g
        bra rt20k               ; a blank glyph row
rt20o:  lda zt2
        bne rt20g
rt20k:  jsr t20_bk              ; (RAM2) two black bytes
        bra rt20z
rt20g:  sta r_gl
        lda r_cls               ; colour masks for PF(code >> 6)
        rol a
        rol a
        rol a
        and #$03
        asl a
        clc
        adc #2
        tax
        lda r_gl
        lsr a
        lsr a
        lsr a
        lsr a
        tay
        lda t6_l,y
        and r_cm,x
        sta zt0
        lda r_gl
        and #$0F
        tay
        lda t6_l,y
        and r_cm+1,x
        sta zt1
        jsr t20_fat             ; (RAM2) pixels 3 and 7 in one-dot colours
        lda r_cm,x              ; palette bit
        and #$80
        ora zt0
        sta zt0
        lda r_cm,x
        and #$80
        ora zt1
rt20z:  pha
        lda r_x
        asl a
        tay
        lda zt0
        sta (zhr),y
        iny
        pla
        sta (zhr),y
        ldy r_x
        iny
        cpy r_t1
        bne rt20
        rts

; ANTIC 4/5 and D/E: ov_mc (R_OVM)

; ANTIC 8: 40 four-colour pixels, one hi-res byte each
row_bm8:
        ldy #0
        stz r_x
rb1:    lda (zsrc),y
        sta r_gl
        lda #4
        sta r_k
rb2:    lda r_gl
        asl a
        rol zt1
        asl a
        rol zt1
        sta r_gl
        lda zt1
        and #$03
        asl a
        sta zt2
        lda r_x
        and #$01
        ora zt2
        tax
        lda r_cm,x
        phy
        ldy r_x
        sta (zhr),y
        ply
        inc r_x
        dec r_k
        bne rb2
        iny
        cpy #10
        bne rb1
        rts

; ---------------------------------------------------------------- players
; Players 0-3 (single-line P/M at PMBASE+$400) and the missiles
; (PMBASE+$300) are ORed into each row as it is drawn, in the band's place,
; width and colour (the game moves players and missiles in its display list
; interrupts: lt_hp*, lt_pc* and the band's screen hole). A band's hash
; covers the sprite bytes over it, so a moving sprite redraws the bands it
; is on; nothing is kept between frames and nothing has to be lifted.
; Within a band each sprite's colour masks, place and width are worked out
; once, when a row first has its pixels (ob_get, the c_* cache).
r_p     = $D4F3                 ; player or missile number (0-3)
r_pg    = $D4F4                 ; the players' page (PMBASE + 4)
r_cb    = $D4F5                 ; byte column of a run's first lit dot
r_sh    = $D4F6                 ; dot offset there (0-6)
r_L     = $D4F7                 ; Atari line
r_le    = $D4F8
r_d     = $D4F9                 ; 8 cells to draw
r_b0    = $D4FA
r_b1    = $D4FB
r_b2    = $D4FC
c_ok    = RROWS+3               ; per sprite object (0-3 players, 4-7
c_cb    = RROWS+11              ; missiles): 0 not worked out yet, 1 on the
c_sh    = RROWS+19              ; playfield, $80 off; where, its colour
c_me    = RROWS+27              ; masks (even, odd bytes) and its width
c_mo    = RROWS+35              ; (SIZEP/SIZEM bits)
c_sz    = RROWS+43
RIVER_GOLD = $16                ; PCOLR3 on the map ($4BB7)
RIVER_BLUE = $86                ; an Atari blue (the 3RIC's blue)

; this frame's P/M state: the players' page; players and missiles on
; (DMACTL and GRACTL)
pm_init:
        lda $D407
        and #$F8
        clc
        adc #4
        sta r_pg
        lda $D400               ; DMACTL bit 3 players, bit 2 missiles
        lsr a
        lsr a
        and $D01D               ; GRACTL bit 1 players, bit 0 missiles
        and #$03
        sta r_pmf
        rts

; graphics of sprite Y (0-3 a player, 4 the missiles) -> zg; carry set
; when it is off (DMA or GRACTL). Y kept.
sp_page:
        stz zg
        tya
        clc
        adc r_pg
        cpy #4
        bcs spg_m
        sta zg+1
        lda r_pmf
        and #$02
        bra spg_x
spg_m:  sbc #5                  ; (carry set) the missiles: PMBASE + 3
        sta zg+1
        lda r_pmf
        and #$01
spg_x:  cmp #1                  ; carry clear when off
        bcc spg_off
        clc
        rts
spg_off:
        sec
        rts

; carry set when any sprite has pixels on Atari line A
ln_spr: sta r_L
        stz r_o
lsp1:   ldy r_o
        jsr sp_page
        bcs lsp2
        ldy r_L
        lda (zg),y
        bne lsp_y
lsp2:   inc r_o
        lda r_o
        cmp #5
        bne lsp1
        clc
        rts
lsp_y:  sec
        rts

; draw_entry: a new band, nothing worked out about its sprites yet
spr_new:
        ldx #7
sn1:    stz c_ok,x
        dex
        bpl sn1
        rts

; The sprites on row zt5 of entry r_i (at zhr): Atari line lt_line + zt5,
; or both of lt_line + 2 * zt5 and the next where blank lines were halved.
de_spr: ldx r_i
        lda lt_rows,x
        cmp lt_h,x
        lda zt5
        bcs ds1
        asl a
        clc
        adc lt_line,x
        sta r_L
        jsr row_spr
        ldx r_i                 ; and the next, if it is still this band's
        inc r_L
        lda lt_line,x
        clc
        adc lt_h,x
        cmp r_L
        bne row_spr
        rts
ds1:    clc
        adc lt_line,x
        sta r_L
; every sprite's pixels on line r_L, ORed into row zhr: the missiles first,
; then players 0 to 3 (the river, player 3, then sees everything else on
; the row - plot frames' missiles, the players - and keeps off it)
row_spr:
        lda #4
        sta r_o
rs_o:   ldy r_o
        jsr sp_page
        bcs rs_n
        ldy r_L
        lda (zg),y
        beq rs_n
        sta r_src
        lda r_o
        cmp #4
        bcs rs_m
        tax
        jsr ob_get
        bcs rs_n
        jsr sp_wide             ; (RAM2) by SIZEP: 1, 2 or 4 runs
rs_n:   lda r_o                 ; 4, 0, 1, 2, 3
        inc a
        cmp #5
        bcc rs_1
        lda #0
rs_1:   sta r_o
        cmp #4
        bne rs_o
        rts
rs_m:   ldx #4                  ; the missiles, 2 bits each, missile 0 lowest
rm1:    lda r_src
        and #$03
        beq rm_n
        sta r_d
        jsr ob_get
        bcs rm_n
        lda r_sz                ; 2, 4 or 8 cells by SIZEM
        asl a
        asl a
        ora r_d
        tay
        lda m_tab,y
        sta r_d
        jsr ch_draw
rm_n:   inx
        lsr r_src
        lsr r_src
        bne rm1
        bra rs_n

; Sprite object X (0-3 players, 4-7 missiles 0-3) of entry r_i -> r_cb,
; r_sh, its masks in r_pal/r_x and its width r_sz; carry set when off the
; playfield. X kept. Worked out on first use in a band (c_*).
ob_get: lda c_ok,x
        beq og_new
        bmi og_off
        sta r_rvf               ; 2 for the river
        lda c_cb,x
        sta r_cb
        lda c_sh,x
        sta r_sh
        lda c_me,x
        sta r_pal
        lda c_mo,x
        sta r_x
        lda c_sz,x
        sta r_sz
        clc
        rts
og_off: sec
        rts
og_new: stx r_ob
        lda #1
        sta r_rvf
        txa
        and #$03
        sta r_p
        ldx r_i
        lda r_ob
        cmp #4
        bcs og_m
        jsr sp_pcol             ; a player: COLPMn, HPOSn, SIZEPn
        cmp #RIVER_GOLD         ; the river (player 3 in gold on the map)
        bne og_p1               ; is water: blue
        ldy r_p
        cpy #3
        bne og_p1
        inc r_rvf
        lda #RIVER_BLUE
og_p1:  jsr pc_set
        lda r_p
        jsr lt_get
        pha
        jsr hole
        lda r_p
        ora #4
        tay
        jsr hole_ld
        bra og_c
og_m:   lda SNAP_G+$1B          ; a missile: COLPF3 for the fifth player,
        and #$10                ; else its player's colour; HPOSMn (the
        beq og_mp               ; band's); SIZEM's bits for it
        lda lt_c3,x
        bra og_mc
og_mp:  jsr sp_pcol
og_mc:  jsr pc_set
        jsr hole
        ldy r_p
        jsr hole_ld
        pha
        lda SNAP_G+12
        ldy r_p
og_s:   dey
        bmi og_c
        lsr a
        lsr a
        bra og_s
og_c:   and #$03
        ldx r_ob
        sta c_sz,x
        lda r_pal
        sta c_me,x
        lda r_x
        sta c_mo,x
        pla
        jsr shc
        ldx r_ob
        lda #$80
        bcs og_st
        lda r_cb
        sta c_cb,x
        lda r_sh
        sta c_sh,x
        lda r_rvf               ; on the playfield: 1, the river 2
og_st:  sta c_ok,x
        jmp ob_get

; r_L/r_le = the entry's first and end Atari line (X = entry)
sd_lines:
        lda lt_line,x
        sta r_L
        clc
        adc lt_h,x
        sta r_le
        rts

; HPOS A -> byte column r_cb and dot offset r_sh (0-6) of the first lit
; dot; carry set when off the playfield; X kept. Sprites are drawn in
; colour cells: colour clock x = HPOS - 48 is cell c = x * 7/8 (the
; playfield's 160 clocks are 140 cells, so a sprite keeps its place on the
; map), and each sprite pixel is one cell, dots 2c and 2c+1, lit on the
; colour's own dot (r_par: 0 for violet, blue and white, 1 for green and
; orange; white lights both). The first lit dot is s = 2c + r_par =
; 7 * r_cb + r_sh.
shc:    sec                     ; x = HPOS - 48 = 8q + r: c = 7q + r',
        sbc #48                 ; r' = r - 1 (0 for r = 0); s = 14q + t,
        bcc sh_off              ; t = 2r' + r_par (0-13)
        tay
        lsr a
        lsr a
        and #$FE
        sta r_cb                ; 2q
        tya
        and #$07
        beq sh_r0
        dec a
sh_r0:  asl a
        ora r_par
        cmp #7
        bcc sh_t
        sbc #7                  ; t >= 7: the next column
        inc r_cb
sh_t:   sta r_sh
        lda r_cb
        cmp #40
        rts                     ; carry set when off the right edge
sh_off: sec
        rts

sp_pcol:                        ; COLPMn (n = r_p) of entry X -> A
        lda r_p
        ora #4
        jsr lt_get
        sta r_pcv
        rts
; line table A (0-3: lt_hp0-3, 4-7: lt_pc0-3), entry X -> A; X kept, Y lost
lt_get: tay
        lda lg_lo,y
        sta lg+1
        lda lg_hi,y
        sta lg+2
lg:     lda $FFFF,x
        rts
lg_lo:  .byte <lt_hp0,<lt_hp1,<lt_hp2,<lt_hp3,<lt_pc0,<lt_pc1,<lt_pc2,<lt_pc3
lg_hi:  .byte >lt_hp0,>lt_hp1,>lt_hp2,>lt_hp3,>lt_pc0,>lt_pc1,>lt_pc2,>lt_pc3
; a missile's 2 pixels (bit 1 left) by SIZEM: 2, 4 or 8 cells
m_tab:  .byte $00,$40,$80,$C0, $00,$30,$C0,$F0, $00,$40,$80,$C0, $00,$0F,$F0,$FF

; Colour A for the sprite being worked out: r_par, and its masks in
; r_cm+10/+11 (r_pal and r_x, free between rows; the band's own masks
; stay for its next rows). X kept.
pc_set: pha
        jsr pc_par
        pla
        ldy #10
        jmp cmask_fg

; 8 cells r_d at column r_cb, dot offset r_sh, in the masks in r_pal/r_x,
; ORed into row zhr. X kept.
ch_draw:
        jsr sp_bits
        ldy r_cb
        lda r_b0
        jsr sr_or
        iny
        cpy #40
        bcs cd_x
        lda r_b1
        jsr sr_or
        iny
        cpy #40
        bcs cd_x
        lda r_b2
        jsr sr_or
cd_x:   rts

; ---- entry_hash's end: keep the playfield hash (r_pfl/r_pfh); add every
; sprite's bytes over the band's lines with their line and, for one with
; any, its place and width; and note the column groups it covers
; (r_nml/r_nmh, for ov_cmp)
ov_spr: lda r_hlo
        sta r_pfl
        lda r_hhi
        sta r_pfh
        stz r_nml
        stz r_nmh
        lda lt_rows,x
        bne os_s
        rts
os_s:   stz r_o
os_o:   ldy r_o
        jsr sp_page
        bcc os_g
        jmp os_n
os_g:   jsr sd_lines
        stz zt1
        stz r_mor
os_l:   ldy r_L
        lda (zg),y
        beq os_z
        tsb r_mor
        jsr hb
        tya
        jsr hb
        inc zt1
os_z:   inc r_L
        lda r_L
        cmp r_le
        bne os_l
        lda zt1
        bne os_p
        jmp os_n
os_p:   lda r_o
        cmp #4
        beq os_mi
        jsr lt_get              ; HPOSn
        sta r_hpos
        jsr hb
        jsr hole
        lda r_o
        ora #4
        tay
        jsr hole_ld             ; SIZEPn
        pha
        jsr hb
        pla
        and #$03
        tay
        lda pw_tab,y
        jsr os_mask
        bra os_n
os_mi:  jsr hole                ; HPOSM0-3, SIZEM, the fifth player
        ldy #3
os_m1:  jsr hole_ld
        sta r_hpos
        jsr hb
        lda r_mor               ; a missile with pixels: its columns
        and m_bit,y
        beq os_m2
        lda #4
        phy
        jsr os_mask
        ply
os_m2:  dey
        bpl os_m1
        lda SNAP_G+12
        jsr hb
        lda SNAP_G+$1B
        and #$10
        jsr hb
os_n:   inc r_o
        lda r_o
        cmp #5
        beq os_x
        jmp os_o
os_x:   rts


; r_d at dot offset r_sh -> hi-res bytes r_b0-r_b2: pixel k lights dot 2k
; (and 2k+1 in white, mask $7F), so a shape keeps every pixel and its colour
; wherever it stands (one more dot of width per 7 than the playfield's
; scale; at offset 6 a white pixel's last dot is cut)
sp_bits:
        lda r_d
        lsr a
        lsr a
        lsr a
        lsr a
        tay
        lda sp_tab,y
        sta r_b0
        lda r_d
        and #$0F
        tay
        lda sp_tab,y
        sta r_b1
        stz r_b2
        lda r_pal
        cmp #$7F
        bne sb1
        lda r_b0                ; white: both dots of each cell
        asl a
        ora r_b0
        sta r_b0
        lda r_b1
        asl a
        ora r_b1
        sta r_b1
sb1:    ldy r_sh
        beq sb3
sb2:    asl r_b0
        rol r_b1
        rol r_b2
        dey
        bne sb2
sb3:    lda r_b0                ; 24 dots -> three bytes of 7
        asl a
        rol r_b1
        rol r_b2
        lsr a
        sta r_b0
        lda r_b1
        asl a
        rol r_b2
        lsr a
        sta r_b1
        lda r_b2
        and #$7F
        sta r_b2
        rts

sr_or:  beq sro1                ; OR pixels A at column Y in r_pal/r_x
        sta zt0
        lda r_rvf               ; the river only where nothing is drawn:
        lsr a                   ; a plot's frame, icon and production
        lsr a                   ; dots stay readable over it
        bcc sro0
        lda (zhr),y
        asl a                   ; (lit dots, not the palette bit)
        bne sro1
sro0:
        tya
        and #$01
        phx
        tax
        lda r_pal,x
        plx
        and zt0
        sta zt0
        lda r_pal
        and #$80
        ora zt0
        ora (zhr),y
        sta (zhr),y
sro1:   rts

; ---- double buffering (the intro, DBL = 1: hi-res pages 1 and 2; the
; game has no second page, its $4000-$5FFF is code). Each render draws on
; the page not shown, against that page's own hashes, sprite columns and
; height (swapped in and out of R_SWP), then shows it: the screen only
; ever shows a whole picture.
sw_pf   = R_SWP                 ; 192: pf_lo..om_hi of the other page
sw_pv   = R_SWP+192             ; 96: its pv_lo, pv_hi
sw_pe   = R_SWP+288             ; its r_pend
sw_rr   = R_SWP+290             ; 2: its r_rrc, r_rrn (the forced redraws
                                ; take turns on each page)
r_shw   = R_SWP+289             ; the page shown ($20 or $40; intro.s)
db_page:
        lda r_shw
        eor #$60                ; $20 <-> $40
        sta r_hpg
        rts
db_flip:
        ldx #192
dbf1:   lda pf_lo-1,x
        ldy sw_pf-1,x
        sta sw_pf-1,x
        tya
        sta pf_lo-1,x
        dex
        bne dbf1
        ldx #96
dbf2:   lda pv_lo-1,x
        ldy sw_pv-1,x
        sta sw_pv-1,x
        tya
        sta pv_lo-1,x
        dex
        bne dbf2
        lda r_pend
        ldy sw_pe
        sta sw_pe
        sty r_pend
        ldx #1
dbf4:   lda r_rrc,x
        ldy sw_rr,x
        sta sw_rr,x
        tya
        sta r_rrc,x
        dex
        bpl dbf4
        lda r_hpg
        sta r_shw
        cmp #$40
        beq dbf3
        bit $C054
        rts
dbf3:   bit $C055
        rts
render_end:

        .org $D1A0              ; the line table's unused gap
; Atari colour A -> r_par, the dot of a colour cell it lights: 0 for
; violet, blue and white (and black, drawn white), 1 for green and orange.
; X, Y kept.
pc_par: jsr col_class
        phx
        tax
        lda par_tab,x
        sta r_par
        plx
        rts
par_tab: .byte 0,0,1,0,0,1
; 4 player pixels (bit 3 leftmost) -> dots 0, 2, 4, 6 (bit 0 leftmost)
sp_tab:  .byte $00,$40,$10,$50,$04,$44,$14,$54,$01,$41,$11,$51,$05,$45,$15,$55
b1gap_end:

        .org RAM2_R             ; RAM2, after the runtime: the same bytes in
                                ; both renderer builds (the converter checks)
; Entry X's screen hole: the 8 bytes after the 120 shown in hi-res block X
; (blocks are 128 bytes, 3 rows), never on the screen; hole_ld/hole_st read
; and write its byte Y. X kept. Phase 1 keeps the band's HPOSM0-3 and
; SIZEP0-3 there (the game's display list interrupts move the missiles per
; band: the plot frames' sides).
hole:   txa
        lsr a
        ora r_hpg
        sta hole_ld+2
        sta hole_st+2
        lda #$78
        bcc ho1
        lda #$F8
ho1:    sta hole_ld+1
        sta hole_st+1
        rts
hole_ld: lda $FFFF,y
        rts
hole_st: sta $FFFF,y
        rts
rec_hole:
        jsr hole
        ldy #7
rh1:    lda $D004,y
        jsr hole_st
        dey
        bpl rh1
        rts

; Player byte r_src at the place ob_get found, in its colour and width
; r_sz (SIZEP: 1 double, 3 quad, else normal): each pixel 1, 2 or 4 cells,
; drawn as 1, 2 or 4 runs of 8 cells.
sp_wide:
        lda r_sz
        lsr a
        bcs sw_w
        lda r_src
        sta r_d
        jmp ch_draw
sw_w:   sta r_sz                ; 0 double, 1 quad
        ldy #8                  ; source bits left
sw_1:   ldx #4                  ; 4 of them a run (double), 2 (quad)
        lda r_sz
        beq sw_2
        ldx #2
sw_2:   lda #0
sw_3:   asl r_src
        rol a
        dey
        dex
        bne sw_3
        tax
        lda dbl_t,x             ; each pixel doubled
        ldx r_sz
        beq sw_4
        tax
        lda dbl_t,x             ; and again (quad)
sw_4:   phy
        jsr sw_ch
        ply
        tya
        bne sw_1
        rts
; 8 cells A at the current cell (unless empty or past the right edge), then
; move 8 cells (16 dots) on
sw_ch:  cmp #0                  ; (the caller's LDX r_sz set the flags)
        beq sw_n
        sta r_d
        lda r_cb
        cmp #40
        bcs sw_n
        jsr ch_draw
sw_n:   lda r_sh
        clc
        adc #2
        cmp #7
        bcc sw_n1
        sbc #7
        inc r_cb
sw_n1:  sta r_sh
        inc r_cb
        inc r_cb
        rts
; 4 pixels, each doubled
dbl_t:  .byte $00,$03,$0C,$0F,$30,$33,$3C,$3F,$C0,$C3,$CC,$CF,$F0,$F3,$FC,$FF

; set_colors' background (entry X): r_ebk = COLBK's hi-res colour in the
; modes that fill the background (4, 5, 8, D, E), else 0 (the black
; screen); r_ctr = the masks for a playfield colour that would vanish into
; it: white, or black on white. X kept.
bk_set: stz r_ebk
        ldy lt_mode,x
        lda bk_fill,y
        beq bs1
        lda lt_cbk,x
        jsr col_class
        sta r_ebk
bs1:    lda #$7F
        ldy r_ebk
        cpy #3
        bne bs2
        lda #0
bs2:    sta r_ctr
        rts
; playfield colour A into masks slot Y (entry X): as it is, unless it comes
; out as the background's hi-res colour without being COLBK itself (on a
; black background, always): then r_ctr. X, Y kept.
cmask_pf:
        pha
        jsr cmask
        pla
        pha
        jsr col_class
        cmp r_ebk
        bne cp_x                ; another hi-res colour: as it is
        lda r_ebk
        beq cp_c                ; no background drawn: always visible
        pla
        pha
        cmp lt_cbk,x
        beq cp_x                ; COLBK itself, as on the Atari
cp_c:   lda r_ctr
        sta r_cm,y
        sta r_cm+1,y
cp_x:   pla
        rts
;                 0  1  2  3  4  5  6  7  8  9  A  B  C  D  E  F
bk_fill: .byte    0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0

; row_t20's start: zt2 = glyph 0's row; C set (the row filled black) when
; that is blank and all 20 characters are code 0
t20_pre:
        lda #0
        jsr glyph
        sta zt2
        bne tp_n
        ldy #19
tp1:    lda (zsrc),y
        and #$3F
        bne tp_n
        dey
        bpl tp1
        ldy #39                 ; A = 0
tp2:    sta (zhr),y
        dey
        bpl tp2
        sec
        rts
tp_n:   clc
        rts
; rt20g, the glyph's second byte in zt1 (X its colour's r_cm index):
; pixels 3 and 7 of t6_l's 8 -> 14 dots are a single dot each, of
; opposite parity, so they vanished in the one-dot colours (the plot
; frame's right side and a column of its production dots) and showed as
; colour in white. Pixel 3 also lights dot 7, pixel 7 dot 12 (sharing
; them with pixels 4 and 6), so every pixel shows in every colour.
t20_fat:
        lda r_gl
        and #$11
        beq tf_x
        lsr a                   ; pixel 7 -> C
        and #$08
        beq tf1
        lda #$01                ; pixel 3: dot 7
tf1:    bcc tf2
        ora #$20                ; pixel 7: dot 12
tf2:    and r_cm+1,x
        ora zt1
        sta zt1
tf_x:   rts
; rt20k: a blank character's two black bytes (A and zt0), with the palette
; bit of the byte before: a dot at the end of an orange or blue byte is
; shifted half a dot right, and a black palette-0 byte after it cut that
; short (an orange plot's right side showed green)
t20_bk: lda r_x
        beq tb0
        asl a
        tay
        dey
        lda (zhr),y
        and #$80
tb0:    sta zt0
        rts
; 8 pixels -> 14: widths 2,2,2,1 per half (bit 0 = leftmost on the hi-res)
t6_l:   .byte $00,$40,$30,$70,$0C,$4C,$3C,$7C,$03,$43,$33,$73,$0F,$4F,$3F,$7F
ram2_r_end:

        .org r_rrc              ; the first forced redraw after RR_EVERY
        .byte RR_EVERY,0        ; renders (r_rrc, r_rrn), not 256

; =====================================================================
; The per-build segment: main RAM the game and the intro leave free
; (R_OVF: $0600 in the game, loaded with page 3; $1800 in the intro, part
; of IRT.BIN), its data at R_DAT ($0406 / $1D00, not loaded: ov_cmp sets
; it up on the first redraw); and the intro's logo (R_OVD, after its
; segment; MD_MODE is $0D there and none in the game, whose R_OVD is not
; loaded). Called with bank 1 mapped.
;
; Sprite-only redraws: a band whose playfield (layout, colours, screen
; bytes) is unchanged but whose sprites changed is redrawn only in the
; columns its sprites covered last time or cover now, in groups of four
; columns (bits 0-9 of om/dm); the rest of each row stays as it is (its
; sprites are ORed again, which changes nothing).
; =====================================================================
pf_lo   = R_DAT                 ; 48: the playfield part of each hash
pf_hi   = R_DAT+48
om_lo   = R_DAT+96              ; 48 x 2: the columns its sprites cover
om_hi   = R_DAT+144
dm_lo   = R_DAT+192             ; 48 x 2: the columns to redraw
dm_hi   = R_DAT+240
r_pfl   = R_DAT+288             ; this entry's playfield hash
r_pfh   = R_DAT+289
r_nml   = R_DAT+290             ; and its sprites' column groups
r_nmh   = R_DAT+291
r_c0    = R_DAT+292             ; the run being drawn: columns
r_c1    = R_DAT+293
r_t0    = R_DAT+294             ; and characters (20-column modes)
r_t1    = R_DAT+295
r_nr    = R_DAT+296             ; runs in r_ru
r_rk    = R_DAT+297
r_rs    = R_DAT+298
r_hpos  = R_DAT+299
r_mor   = R_DAT+300             ; the missiles' bytes ORed
r_dv    = R_DAT+301             ; 2: the row drawer
r_ru    = R_DAT+303             ; 10: up to 5 runs (first, end column)
md_cp   = R_DAT+313             ; 16: mode D cell for a pixel pair
md_pat  = R_DAT+329             ; 4: mode D cell for a pixel value
md_pal  = R_DAT+333
ec_v    = R_DAT+334             ; 9 x 2: entry_hash's colour-class cache
ec_r    = R_DAT+343
R_DAT_END = R_DAT+352

        .org R_OVF

ov_ini: .byte 0                 ; set up (pf_* invalid)

; the column groups of a sprite at r_hpos, A columns wide, into r_nm*: a
; colour clock x = HPOS - 48 is column x / 4 (cell x * 7/8, 2 dots a cell)
os_mask:
        sta zt3
        lda r_hpos
        sec
        sbc #48
        bcc om_x                ; left of the playfield: not drawn (shc)
        lsr a
        lsr a
        cmp #40
        bcs om_x
        sta zt4
        clc
        adc zt3
        cmp #41
        bcc om1
        lda #40
om1:    dec a                   ; the last column's group
        lsr a
        lsr a
        sta zt3
        lda zt4
        lsr a
        lsr a
        tay
om2:    cpy #8
        bcs om3
        lda bitv,y
        tsb r_nml
        bra om4
om3:    lda bitv-8,y
        tsb r_nmh
om4:    iny
        cpy zt3
        bcc om2
        beq om2
om_x:   rts

; ---- draw_lines: entry r_i's hash against the last frame's. Carry set
; when it is to be drawn, dm_* then its columns: all of them, or (only
; its sprites changed) the groups its sprites cover now or did before.
; ---- draw_lines' start: on the first redraw, set up the data (R_DAT is
; not loaded)
ov_init:
        ldx ov_ini
        bne oc_r
        inc ov_ini
oci:    lda #$FF                ; every band's sprite columns all: on its
        sta om_lo,x             ; first change it is drawn whole
        sta om_hi,x
        cpx #9                  ; and entry_hash's colour cache holds
        bcs oci2                ; colour 0, class 0
        stz ec_v,x
        stz ec_r,x
oci2:   inx
        cpx #NL
        bne oci
oc_r:   rts
ov_cmp: ldx r_i
        lda r_hlo
        cmp pv_lo,x
        bne oc_ch
        lda r_hhi
        cmp pv_hi,x
        bne oc_ch
        cpx r_rr
        beq oc_pf
        clc
        rts
oc_ch:  lda r_hlo
        sta pv_lo,x
        lda r_hhi
        sta pv_hi,x
        cpx r_rr
        beq oc_pf
        lda r_pfl
        cmp pf_lo,x
        bne oc_pf
        lda r_pfh
        cmp pf_hi,x
        bne oc_pf
        lda om_lo,x             ; only the sprites changed
        ora r_nml
        sta dm_lo,x
        lda om_hi,x
        ora r_nmh
        sta dm_hi,x
        bra oc_out
oc_pf:  lda r_pfl
        sta pf_lo,x
        lda r_pfh
        sta pf_hi,x
oc_full:
        lda #$FF
        sta dm_lo,x
        sta dm_hi,x
oc_out: lda r_nml
        sta om_lo,x
        lda r_nmh
        sta om_hi,x
        sec
        rts

; ---- draw_entry, after set_colors (X = r_i): its runs of columns (and
; the logo's cells). X kept.
ov_ent: lda dm_lo,x
        sta zt3
        lda dm_hi,x
        sta zt4
        stz r_nr
        lda #$FF
        sta r_rs
        ldy #0
oe1:    lsr zt4
        ror zt3
        bcc oe2
        lda r_rs
        bpl oe3
        tya
        asl a
        asl a
        sta r_rs
        bra oe3
oe2:    lda r_rs
        bmi oe3
        jsr oe_end
oe3:    iny
        cpy #10
        bne oe1
        lda r_rs
        bmi oe4
        jsr oe_end
oe4:    lda lt_mode,x
        cmp #MD_MODE
        bne oe6
        jmp md_tab
oe6:    jmp mc_chk           ; (R_OVM) a mode-4 band's tables
oe_end: phx                     ; a run from r_rs to column 4 * Y
        lda r_nr
        asl a
        tax
        lda r_rs
        sta r_ru,x
        tya
        asl a
        asl a
        sta r_ru+1,x            ; (Y <= 10: at most column 40)
        inc r_nr
        lda #$FF
        sta r_rs
        plx
        rts

; ---- draw_entry's row zt5 of entry X at zhr, by its mode, each run of
; columns in turn; then de_next
ov_go:  lda lt_mode,x
        cmp #MD_MODE
        bne vg1
        ldy #<ov_md
        ldx #>ov_md
        bra vg_r
vg1:    cmp #8
        bne vg2
        jsr row_bm8
        bra vg_x
vg2:    cmp #$0D
        bcc vg3
        cmp #$0F
        bcs vg_c
        lda #$80                ; D/E: the mode-4 pixels, no glyphs
        ldy #<ov_mc
        ldx #>ov_mc
        bra vg_r
vg3:    cmp #2
        bcc vg_c
        cmp #8
        bcs vg_c
        tay
        lda zt5
        cpy #2
        beq vg_40
        cpy #3
        beq vg_40
        cpy #5
        beq vg_h
        cpy #7
        bne vg_f
vg_h:   lsr a                   ; 5, 7: two scan lines a row
vg_f:   cpy #6
        bcs vg_20
        ldy #<ov_mc            ; 4, 5
        ldx #>ov_mc
        bra vg_r
vg_20:  ldy #<t20_go            ; 6, 7
        ldx #>t20_go
        bra vg_r
vg_40:  and #$07                ; 2, 3
        ldy #<row_t40
        ldx #>row_t40
        bra vg_r
vg_c:   ldy #<clr_rng           ; blank lines and modes not drawn: black
        ldx #>clr_rng
        bra vg_r
vg_x:   ldx r_i
        jmp de_next
vg_r:   sta zrow                ; (A: the glyph row; X, Y: the drawer)
        sty r_dv
        stx r_dv+1
        stz r_rk
vg_r4:  lda r_rk
        cmp r_nr
        bcs vg_x
        asl a
        tay
        lda r_ru,y
        sta r_c0
        lsr a
        sta r_t0
        lda r_ru+1,y
        sta r_c1
        lsr a
        sta r_t1
        jsr vg_cl
        ldx r_i
        inc r_rk
        bra vg_r4
pw_tab: .byte 4,6,4,11          ; columns a player covers, by SIZEP
m_bit:  .byte $03,$0C,$30,$C0
vg_cl:  jmp (r_dv)
r_ovf_end:

; ---- the intro's logo (ANTIC D): every 8 pixels (two bytes) are 7 colour
; cells of two dots, cell k from pixels k and k + 1, so the letters' fill
; and outline keep their edges on whole cells: no colour fringes
        .org R_OVD

; md_pat = the cell of each pixel value (its colour's dots in an even
; byte's first cell), md_cp = the cell for two neighbouring pixels (an
; outline (the lower value) wins over a fill, both over the background),
; md_pal = the palette bit of every colour in the band. X kept.
md_tab: stz md_pal
        ldy #3
mdt1:   tya
        asl a
        tax
        lda r_cm,x
        and #$80
        tsb md_pal
        lda r_cm,x
        and #$03
        sta md_pat,y
        dey
        bpl mdt1
        lda #3                  ; the letters white whichever fill the
        sta md_pat+2            ; intro uses (its sweeps turn PF2's
        sta md_pat+3            ; shades into PF1, the background's gold)
        ldy #15
mdt2:   tya
        lsr a
        lsr a
        sta zt0                 ; v (left)
        tya
        and #$03                ; w (right)
        beq mdt3                ; w the background: v
        ldx zt0
        beq mdt4                ; v the background: w
        cmp zt0
        bcc mdt4                ; w < v: w
mdt3:   lda zt0
mdt4:   tax
        lda md_pat,x
        lsr a                   ; the cell's two dots in bits 6-7
        ror a
        ror a
        sta md_cp,y
        dey
        bpl mdt2
        ldx r_i
        rts

; the row's columns r_c0 to r_c1 (even): pairs of bytes -> pairs
ov_md:  ldy r_c0
omd1:   lda (zsrc),y
        sta zt0
        iny
        lda (zsrc),y
        sta zt1
        sty r_x
        lda #7
        sta r_k
omd2:   lda zt0                 ; pixels k, k + 1 -> the cell; the cells
        lsr a                   ; collect from the top of zt2/zt3 down
        lsr a
        lsr a
        lsr a
        tax
        lsr zt3
        ror zt2
        lsr zt3
        ror zt2
        lda md_cp,x
        ora zt3
        sta zt3
        asl zt1
        rol zt0
        asl zt1
        rol zt0
        dec r_k
        bne omd2
        lsr zt3                 ; dots 0-13 in zt2/zt3
        ror zt2
        lsr zt3
        ror zt2
        ldy r_x
        lda zt2
        asl a
        lda zt3
        rol a
        and #$7F
        ora md_pal
        sta (zhr),y
        dey
        lda zt2
        and #$7F
        ora md_pal
        sta (zhr),y
        iny
        iny
        cpy r_c1
        bne omd1
        rts
r_ovd_end:

; ---- mode 4/5/D/E rows (R_OVM: game $1A00, the town zoom's bitmap, free
; since the zoom is skipped; intro $1A00). Each band's colours make four
; tables: a byte's two high pixels (left) and two low pixels (right) as
; their dots in an even or an odd column, with the palette bit of any of
; them; +16 for an inverse character (pixel value 3 is PF3). A row is then
; a glyph lookup and two table reads a byte, and a byte the same as the
; last one of its column parity is not worked out again.
        .org R_OVM

mc_chk: lda lt_mode,x           ; X = r_i
        cmp #4
        beq mc_t0
        cmp #5
        beq mc_t0
        cmp #$0D
        beq mc_t0
        cmp #$0E
        beq mc_t0
        rts
mc_t0:  ldy #9                  ; the tables of the last such band are
mct1:   lda r_cm,y              ; still right when its colours were the
        cmp mc_cm,y             ; same (most of a screen's bands)
        bne mct2
        dey
        bpl mct1
        rts
mct2:   ldy #9
mct3:   lda r_cm,y
        sta mc_cm,y
        dey
        bpl mct3
mc_tab: ldy #31
mt1:    tya
        lsr a
        lsr a
        and #$03
        jsr mt_ci
        sta zt0                 ; the left pixel's masks in r_cm
        tya
        and #$03
        jsr mt_ci
        sta zt1                 ; the right pixel's
        ldx zt0
        lda r_cm,x
        and #$83
        sta zt2
        lda r_cm+1,x
        and #$83
        sta zt3
        ldx zt1
        lda r_cm,x
        and #$8C
        ora zt2
        sta mt_he,y             ; pixels 0, 1: dots 0-1, 2-3
        lda r_cm+1,x
        and #$8C
        ora zt3
        sta mt_ho,y
        ldx zt0
        lda r_cm,x
        and #$B0
        sta zt2
        lda r_cm+1,x
        and #$B0
        sta zt3
        ldx zt1
        lda r_cm,x
        and #$C0
        ora zt2
        sta mt_le,y             ; pixels 2, 3: dots 4-5, 6
        lda r_cm+1,x
        and #$C0
        ora zt3
        sta mt_lo,y
        dey
        bpl mt1
        ldx r_i
        rts
; pixel value A (0-3; Y >= 16 an inverse character) -> its masks' index
; in r_cm (class * 2: BK, PF0, PF1, PF2, or PF3 for an inverse 3)
mt_ci:  cmp #3
        bne mci1
        cpy #16
        bcc mci1
        lda #4
mci1:   asl a
        rts

; the row's columns r_c0 to r_c1 (zrow: glyph row; bit 7 D/E, the bytes
; are the pixels)
ov_mc:  stz mc_ok
        stz mc_ok+1
        ldy r_c0
omc1:   tya
        and #$01
        tax
        lda (zsrc),y
        cmp mc_k,x              ; as the last byte of this parity: its
        bne omc_n               ; hi-res byte again
        lda mc_ok,x
        beq omc_n1
        lda mc_v,x
        bra omc_w
omc_n1: lda mc_k,x
omc_n:  sta mc_k,x
        sty r_x
        bit zrow
        bmi omc_b
        tax                     ; a character: its glyph row (glyph,
        and #$80                ; inline)
        lsr a
        lsr a
        lsr a
        sta zt3                 ; $10: inverse
        txa
        asl a
        asl a
        asl a
        ora zrow
        sta zg
        txa
        and #$7F
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        ora zcb
        sta zg+1
        lda (zg)
        bra omc_g
omc_b:  stz zt3
omc_g:  tax
        and #$0F
        ora zt3
        sta zt4
        txa
        lsr a
        lsr a
        lsr a
        lsr a
        ora zt3
        tay
        ldx zt4
        lda r_x
        lsr a
        bcs omc_o
        lda mt_he,y
        ora mt_le,x
        ldx #0
        bra omc_s
omc_o:  lda mt_ho,y
        ora mt_lo,x
        ldx #1
omc_s:  sta mc_v,x
        inc mc_ok,x
        ldy r_x
omc_w:  sta (zhr),y
        iny
        cpy r_c1
        bne omc1
        rts
; the run's columns black
clr_rng:
        ldy r_c0
        lda #0
cg1:    sta (zhr),y
        iny
        cpy r_c1
        bne cg1
        rts
; ANTIC 6/7: a whole row through row_t20 (all-blank rows filled at once);
; a run of it straight to its characters
t20_go: lda r_t0
        bne tg1
        lda r_t1
        cmp #20
        bne tg1
        jmp row_t20
tg1:    lda #0                  ; zt2 = the space's glyph row (t20_pre)
        jsr glyph
        sta zt2
        jmp rt20s
mc_k:   .byte 0,0               ; ov_mc's last byte per column parity,
mc_v:   .byte 0,0               ; its hi-res byte, and whether it is set
mc_ok:  .byte 0,0
mc_cm:  .byte $A5,$A5,$A5,$A5,$A5,$A5,$A5,$A5,$A5,$A5   ; the tables' r_cm
mt_he:  .res 32                 ; mc_tab's tables
mt_ho:  .res 32
mt_le:  .res 32
mt_lo:  .res 32
r_ovm_end: