; M.U.L.E. for 3RIC - display: the Atari screen redrawn on the hi-res page.
;
; Runs in language-card bank 1 from the 60 Hz tick (rt.s vbi_after), after
; the game's own VBI. Phase 1, interrupts off: walk the ANTIC display list
; the game left in the register file, record every mode line in a line
; table, and call the game's display-list-interrupt handlers where ANTIC
; would, so the colours, character sets and player positions they change
; per band are captured (the handlers' register stores land in this bank's
; copy of the register file at $D000/$D400). Phase 2, interrupts on: redraw
; the lines whose contents changed into hi-res page 1 at $2000, and update
; only the player rows that changed (see draw_lines).
;
; Mapping: one Atari character column = one hi-res byte (7 pixels for 8,
; or 14 for 16 in the 20-column modes); Atari colours become the nearest
; hi-res colour. Lines keep their height; if a display list is taller than
; 192 lines its blank lines are halved. Addresses in $2000-$3FFF (moved to
; $E000) are translated.
;
; Prepended by the converter: RENDER, FONT, T2TAB, RTVARS (rt.s symbols
; snap_g/snap_a are passed as SNAP_G/SNAP_A), VC_FAKE.

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
lt_cha  = $D1A0
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

B1DATA   = $DFF0                ; renderer data at the top of bank 1
rd_bits  = B1DATA               ; 6: entries to redraw this frame
rd_np    = B1DATA+6             ; player/entry pairs with pixels
rd_k     = B1DATA+7
rd_osn   = B1DATA+8             ; player records on the screen
r_pcv    = B1DATA+9             ; COLPM of the player being compared
r_shi    = B1DATA+10            ; player pixel shift index (0-3)
; in main RAM (bank 1 is full of code): RROWS in page 3 after the runtime's
; variables, RDATA in $0406-$057F (the game uses $0400-$0405; $0580 is the
; floating-point package's LBUFF)
rd_rows  = RROWS                ; 24: hi-res rows drawn afresh
rd_srow  = RROWS+24             ; 24: hi-res rows whose players changed
RROWS_END = RROWS+48
pn_row   = RDATA                ; pending player records (the compare
pn_y     = RDATA+80             ; pass's findings, drawn by spr_put),
pn_d     = RDATA+160            ; SPRMAX each
pn_c     = RDATA+240
rd_pairs = RDATA+320            ; NPAIR: player << 6 | entry
NPAIR    = 58
RDATA_END = RDATA+378

        .org RENDER

render: php
        sei
        ldx #$1F                ; this bank's register file = the game's
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
        plp
        jsr draw_lines
        rts

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
        ldx zt1
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
        jsr blank_rows
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
        bne wk_out              ; JVB: end of frame
        stz zt1
        lda #1
        sta zt2
        jsr blank_rows
        jsr record
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
        lda r_seen
        bne br1
        stz zt3                 ; leading blank lines are not drawn
        rts
br1:    lda zt2
        ldx r_comp
        beq br2
        clc
        adc #1
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
        lda $D401
        sta lt_cha,x
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
; Nothing is written while the picture is unchanged: first every line's
; hash, and every player row about to be drawn, are compared with what is
; on the screen. Then the changed lines are redrawn (wiping the players on
; them) and only the player rows that changed or were wiped are lifted and
; put back, so the rest of the picture never blinks (there is no second
; page to flip to).
draw_lines:
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
        ldx r_i
        cpx r_rr
        beq dl_mark
        lda r_hlo
        cmp pv_lo,x
        bne dl_mark
        lda r_hhi
        cmp pv_hi,x
        beq dl_skip
dl_mark:
        lda r_hlo
        sta pv_lo,x
        lda r_hhi
        sta pv_hi,x
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
        lda #$A5
        sta pv_lo,x
        sta pv_hi,x
        inx
        bra dl_iv
dl_iv2: lda r_end
        cmp r_pend
        beq dl_s0
        inc r_dc
dl_s0:  jsr spr_scan            ; the players: which rows change?
        ldx #23
dl_s1:  stz rd_srow,x
        stz rd_rows,x
        dex
        bpl dl_s1
        lda r_spn
        sta rd_osn
        stz r_spn
        jsr spr_draw
        jsr spr_gone
        lda r_dc
        ldx #23
dl_s4:  ora rd_srow,x
        dex
        bpl dl_s4
        tax
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
        jsr mark_row
        jsr clear_row
        inc zt4
        bra dl_clr
dl_d2:  lda r_end
        sta r_pend
        jsr spr_erase           ; the players: lift, then draw what the
        jmp spr_put             ; compare pass recorded (the game's VBI may
                                ; have moved them since; next frame shows it)

; records past the ones just compared are no longer drawn: lift their rows
spr_gone:
        ldx r_spn
sg1:    cpx rd_osn
        bcs sg2
        lda spr_row,x
        jsr srow_mark
        inx
        bra sg1
sg2:    rts

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
; Row A is being drawn afresh: note it, then its address (as row_addr;
; Y lost).
mark_row:
        phx
        pha
        jsr row_bit
        ora rd_rows,y
        sta rd_rows,y
        pla
        plx
        jmp row_addr
; Row A's players change: note it (A lost).
srow_mark:
        phx
        jsr row_bit
        ora rd_srow,y
        sta rd_srow,y
        plx
        rts
bitv:   .byte $01,$02,$04,$08,$10,$20,$40,$80

; 16-bit hash of an entry's layout, registers and screen bytes
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
        lda lt_cha,x
        jsr hb
        lda lt_c0,x
        jsr hb
        lda lt_c1,x
        jsr hb
        lda lt_c2,x
        jsr hb
        lda lt_c3,x
        jsr hb
        lda lt_cbk,x
        jsr hb
        lda lt_pc0,x            ; player colours: a player record holds
        jsr hb                  ; pixels and place, not colour
        lda lt_pc1,x
        jsr hb
        lda lt_pc2,x
        jsr hb
        lda lt_pc3,x
        jsr hb
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
eh1:    lda (zsrc),y
        jsr hb
        iny
        cpy r_nb
        bne eh1
eh_done:
        rts
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
        ora #$20
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
; The hi-res background is black, so a playfield colour that would come out
; black is drawn white (dark-on-light Atari text stays readable).
set_colors:
        lda lt_cbk,x
        ldy #0
        jsr cmask
        lda lt_c0,x
        ldy #2
        jsr cmask_fg
        lda lt_c1,x
        ldy #4
        jsr cmask_fg
        lda lt_c2,x
        ldy #6
        jsr cmask_fg
        lda lt_c3,x
        ldy #8
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
        pha
        and #$0E                ; luminance
        cmp #$02
        bcc cm_black
        cmp #$0E
        bcs cm_white
        pla
        pha
        lsr a
        lsr a
        lsr a
        lsr a
        tax
        lda hue_col,x
        bne cm_hue
        pla                     ; grey: light = white, dark = black
        pha
        and #$0E
        cmp #$08
        bcs cm_white
cm_black:
        lda #0
        bra cm_set
cm_white:
        lda #3
cm_hue:
cm_set: tax
        lda col_even,x
        sta r_cm,y
        lda col_odd,x
        sta r_cm+1,y
        pla
        plx
        rts
;               grey gold orng rdor pink purp ppbl blue blue ltbl turq grbl gren yegr orgr ltor
hue_col: .byte    0,   5,   5,   5,   1,   1,   1,   4,   4,   4,   4,   2,   2,   2,   5,   5
;               black violet green white blue orange
col_even: .byte $00,  $55,  $2A,  $7F, $D5, $AA
col_odd:  .byte $00,  $2A,  $55,  $7F, $AA, $D5

; ---- draw entry r_i
draw_entry:
        ldx r_i
        jsr set_colors
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
de_row: lda zt5
        cmp lt_rows,x
        bcs de_done
        clc
        adc lt_hrow,x
        bcs de_done
        cmp #192
        bcs de_done
        jsr mark_row
        lda lt_mode,x
        cmp #2
        beq de_t40
        cmp #3
        beq de_t40
        cmp #4
        beq de_mc
        cmp #5
        beq de_mc2
        cmp #6
        beq de_t20
        cmp #7
        beq de_t20b
        cmp #8
        beq de_bm8
        jsr clear_row
        bra de_next
de_t40: lda zt5
        and #$07
        sta zrow
        jsr row_t40
        bra de_next
de_mc2: lda zt5
        lsr a
        sta zrow
        jsr row_mc
        bra de_next
de_mc:  lda zt5
        sta zrow
        jsr row_mc
        bra de_next
de_t20b:
        lda zt5
        lsr a
        sta zrow
        jsr row_t20
        bra de_next
de_t20: lda zt5
        sta zrow
        jsr row_t20
        bra de_next
de_bm8: jsr row_bm8
de_next:
        ldx r_i
        inc zt5
        bra de_row
de_done:
        rts

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
row_t40:
        ldy #0
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
        cpy #40
        bne rt40
        rts

; ANTIC 6/7: 20 columns of two bytes, bits 6-7 pick PF0-PF3
row_t20:
        ldy #0
rt20:   sty r_x
        lda (zsrc),y
        sta r_cls
        and #$3F
        jsr glyph
        sta r_gl
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
        lda t6_r,y
        and r_cm+1,x
        sta zt1
        lda r_cm,x              ; palette bit
        and #$80
        ora zt0
        sta zt0
        lda r_cm,x
        and #$80
        ora zt1
        pha
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
        cpy #20
        bne rt20
        rts

; ANTIC 4/5: 40 columns of four 2-bit pixels (BK, PF0, PF1, PF2/PF3)
row_mc: ldy #0
rmc1:   sty r_x
        lda (zsrc),y
        sta r_cls
        and #$7F
        jsr glyph
        sta r_gl
        stz zt0                 ; output byte
        stz r_pal
        lda r_x                 ; parity of the byte column
        and #$01
        sta zt2
        stz r_k                 ; pixel slot 0-3
rmc2:   lda r_gl
        asl a
        rol zt1
        asl a
        rol zt1
        sta r_gl
        lda zt1
        and #$03
        cmp #$03                ; PF2, or PF3 for inverse characters
        bne rmc3
        bit r_cls
        bpl rmc3
        lda #$04
rmc3:   asl a                   ; mask index = class*2 + parity
        ora zt2
        tax
        lda r_cm,x
        tay
        and #$80
        ora r_pal
        sta r_pal
        tya
        ldx r_k
        and slot_mask,x
        ora zt0
        sta zt0
        inc r_k
        lda r_k
        cmp #4
        bne rmc2
        lda zt0
        and #$7F
        ora r_pal
        ldy r_x
        sta (zhr),y
        iny
        cpy #40
        bne rmc1
        rts
slot_mask: .byte $03,$0C,$30,$40

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

; 8 pixels -> 14: widths 2,2,2,1 per half (bit 0 = leftmost on the hi-res)
t6_l:   .byte $00,$40,$30,$70,$0C,$4C,$3C,$7C,$03,$43,$33,$73,$0F,$4F,$3F,$7F
t6_r:   .byte $00,$40,$30,$70,$0C,$4C,$3C,$7C,$03,$43,$33,$73,$0F,$4F,$3F,$7F
; ---------------------------------------------------------------- players
; Players 0-3 (single-line P/M at PMBASE+$400) are ORed onto the screen in
; their colour, each band with the position and colour the line table
; captured for it (the game repositions players in its DLIs). Each player
; row drawn is a record (row, column and pixel shift, the player byte, the
; bytes under it), so the next frame can tell exactly which rows changed; a
; player colour change redraws the entry instead (entry_hash).
SPRMAX  = 80
spr_row = SPRITES               ; hi-res row
spr_ck  = SPRITES+80            ; player byte
spr_y   = SPRITES+160           ; column | shift index << 6
spr_s0  = SPRITES+240
spr_s1  = SPRITES+320
spr_s2  = SPRITES+400
r_spn   = $D4F2
r_p     = $D4F3
r_pg    = $D4F4
r_cb    = $D4F5
r_sh    = $D4F6
r_L     = $D4F7
r_le    = $D4F8
r_d     = $D4F9
r_b0    = $D4FA
r_b1    = $D4FB
r_b2    = $D4FC

spr_erase:
        ldx rd_osn
        beq se_done
se1:    dex
        phx
        lda spr_row,x
        jsr row_bit
        sta zt1
        and rd_rows,y           ; drawn afresh: nothing to put back
        bne se2
        lda zt1
        and rd_srow,y           ; unchanged: stays
        beq se2
        plx
        phx
        lda spr_row,x
        jsr row_addr
        lda spr_y,x
        and #$3F
        tay
        lda spr_s0,x
        sta (zhr),y
        iny
        cpy #40
        bcs se2
        lda spr_s1,x
        sta (zhr),y
        iny
        cpy #40
        bcs se2
        lda spr_s2,x
        sta (zhr),y
se2:    plx
        bne se1
se_done:
        rts

; The (player, entry) pairs with pixels -> rd_pairs.
spr_scan:
        stz rd_np
        lda $D400               ; player DMA and GRACTL players
        and #$08
        beq ss_r
        lda $D01D
        and #$02
        bne ss_go
ss_r:   rts
ss_go:  lda $D407
        and #$F8
        clc
        adc #4
        sta r_pg
        stz r_p
ss_pl:  lda r_pg
        clc
        adc r_p
        sta zg+1
        stz zg
        stz r_i
ss_ent: ldx r_i
        cpx r_n
        bcs ss_np
        lda lt_rows,x
        beq ss_ne
        jsr sp_hpos
        bcs ss_ne
        jsr sd_lines
        stz zt1
ss_ln:  ldy r_L
        lda (zg),y
        beq ss_nl
        sta zt1
ss_nl:  inc r_L
        lda r_L
        cmp r_le
        bne ss_ln
        lda zt1
        beq ss_ne
        ldx rd_np
        cpx #NPAIR
        bcs ss_ne
        lda r_p
        lsr a
        ror a
        ror a
        ora r_i
        sta rd_pairs,x
        inc rd_np
ss_ne:  inc r_i
        jmp ss_ent
ss_np:  inc r_p
        lda r_p
        cmp #4
        beq ss_x
        jmp ss_pl
ss_x:   rts

; r_L/r_le = the entry's first and end Atari line (X = entry)
sd_lines:
        lda lt_line,x
        sta r_L
        clc
        adc lt_h,x
        sta r_le
        rts

spr_draw:
        stz rd_k
sd_pl:  ldx rd_k
        cpx rd_np
        bcs sd_out
        lda rd_pairs,x
        and #$3F
        sta r_i
        lda rd_pairs,x
        rol a
        rol a
        rol a
        and #$03
        sta r_p
        clc
        adc r_pg
        sta zg+1
        stz zg
        ldx r_i
        jsr sp_hpos
        bcs sd_np
        jsr sp_pcol
        ldx r_i
        jsr sd_lines
sd_ln:  ldy r_L
        lda (zg),y
        beq sd_nl
        sta r_d
        lda r_L                 ; row = hrow + (L - line), halved when the
        sec                     ; band's blank lines were compressed
        sbc lt_line,x
        sta zt0
        lda lt_rows,x
        cmp lt_h,x
        lda zt0
        bcs sd_h1
        lsr a
sd_h1:  clc
        adc lt_hrow,x
        bcs sd_nl
        cmp #192
        bcs sd_nl
        jsr sp_rec
        ldx r_i
sd_nl:  inc r_L
        lda r_L
        cmp r_le
        bne sd_ln
sd_np:  inc rd_k
        bra sd_pl
sd_out: rts

; HPOS of player r_p in entry X -> byte column r_cb, pixel shift r_sh;
; carry set when off the playfield. Hi-res x = (HPOS - 48) * 7/4.
sp_hpos:
        lda r_p
        beq sh0
        cmp #1
        beq sh1
        cmp #2
        beq sh2
        lda lt_hp3,x
        bra shc
sh0:    lda lt_hp0,x
        bra shc
sh1:    lda lt_hp1,x
        bra shc
sh2:    lda lt_hp2,x
shc:    sec
        sbc #48
        bcc sh_off
        pha
        and #$03
        sta r_shi
        tay
        lda sh_tab,y
        sta r_sh
        pla
        lsr a
        lsr a
        sta r_cb
        cmp #40
        bcs sh_off
        clc
        rts
sh_off: sec
        rts
sh_tab: .byte 0,1,3,5
shi_hi: .byte $00,$40,$80,$C0

sp_pcol:                        ; COLPMn of entry X -> r_pcv
        lda r_p
        beq sc0
        cmp #1
        beq sc1
        cmp #2
        beq sc2
        lda lt_pc3,x
        bra scc
sc0:    lda lt_pc0,x
        bra scc
sc1:    lda lt_pc1,x
        bra scc
sc2:    lda lt_pc2,x
scc:    sta r_pcv
        rts

; Player byte r_d on hi-res row A at column r_cb, shift r_shi: record it in
; the pending list and compare it with the record on the screen at the same
; index; a difference marks both rows. The record is exact (row, column |
; shift << 6, player byte; a colour change redraws the entry, entry_hash).
sp_rec: sta zt3
        ldx r_spn
        cpx #SPRMAX
        bcs sp_rx
        ldy r_shi
        lda shi_hi,y
        ora r_cb
        sta zt4
        sta pn_y,x
        lda zt3
        sta pn_row,x
        lda r_d
        sta pn_d,x
        lda r_pcv
        sta pn_c,x
        cpx rd_osn
        bcs sr_m1
        lda spr_row,x
        cmp zt3
        bne sr_m0
        lda spr_y,x
        cmp zt4
        bne sr_m0
        lda spr_ck,x
        cmp r_d
        beq sr_n
sr_m0:  lda spr_row,x
        jsr srow_mark
sr_m1:  lda zt3
        jsr srow_mark
sr_n:   inc r_spn
sp_rx:  rts

; Draw the pending records whose rows were lifted or drawn afresh (the
; others are already on the screen, unchanged) and make them the records.
spr_put:
        stz rd_k
pu_l:   ldx rd_k
        cpx r_spn
        bcc pu_c
        rts
pu_c:   lda pn_row,x
        jsr row_bit
        sta zt1
        lda rd_rows,y
        ora rd_srow,y
        and zt1
        bne pu_go
        jmp pu_n
pu_go:  ldx rd_k
        lda pn_d,x
        sta r_d
        lda pn_y,x
        sta zt4
        and #$3F
        sta r_cb
        lda zt4
        rol a
        rol a
        rol a
        and #$03
        tay
        lda sh_tab,y
        sta r_sh
        lda pn_c,x
        ldy #0
        jsr cmask_fg
        jsr sp_bits
        ldx rd_k
        lda pn_row,x
        sta spr_row,x
        jsr row_addr
        lda r_d
        sta spr_ck,x
        lda zt4
        sta spr_y,x
        ldy r_cb
        lda (zhr),y
        sta spr_s0,x
        lda r_b0
        jsr sr_or
        iny
        cpy #40
        bcs pu_n
        lda (zhr),y
        sta spr_s1,x
        lda r_b1
        jsr sr_or
        iny
        cpy #40
        bcs pu_n
        lda (zhr),y
        sta spr_s2,x
        lda r_b2
        jsr sr_or
pu_n:   inc rd_k
        jmp pu_l

; r_d, shift r_sh -> hi-res bytes r_b0-r_b2 (8 pixels -> 14, as in the
; 20-column text, then r_sh pixels right across 7-bit bytes)
sp_bits:
        lda r_d
        lsr a
        lsr a
        lsr a
        lsr a
        tay
        lda t6_l,y
        sta r_b0
        lda r_d
        and #$0F
        tay
        lda t6_r,y
        sta r_b1
        stz r_b2
        ldy r_sh
        beq sb_x
sr1:    asl r_b2
        asl r_b1
        lda r_b1
        bpl sr1a
        and #$7F
        sta r_b1
        inc r_b2
sr1a:   asl r_b0
        lda r_b0
        bpl sr1b
        and #$7F
        sta r_b0
        inc r_b1
sr1b:   dey
        bne sr1
sb_x:   rts

sr_or:  beq sro1                ; OR pixels A at column Y in its colour
        sta zt0
        tya
        and #$01
        phx
        tax
        lda r_cm,x
        plx
        and zt0
        sta zt0
        lda r_cm
        and #$80
        ora zt0
        ora (zhr),y
        sta (zhr),y
sro1:   rts

render_end:

        .org r_rrc              ; the first forced redraw after RR_EVERY
        .byte RR_EVERY,0        ; renders (r_rrc, r_rrn), not 256
