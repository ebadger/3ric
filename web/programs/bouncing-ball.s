; Amiga-style Boing Ball: checkerboard sphere, gravity bounce, 3D room grid.
; Bounding-box clear for speed. Double-buffered hi-res. Press any key → BRK.
;
; Paste into https://ebadger.github.io/3ric/ and Assemble & Run.

        .org $0800

TXTCLR  = $C050
FULLSCR = $C052             ; not mixed (no text at bottom)
LOWSCR  = $C054
HISCR   = $C055
HIRESW  = $C057
KBD     = $C000
KBDSTRB = $C010

ROWL    = $6000
ROWH    = $6100

ptr     = $06
faceptr = $08
edgeptr = $0A

x0      = $6200
y0      = $6201
x1      = $6202
y1      = $6203
dx      = $6204
dy      = $6205
sxs     = $6206
sys     = $6207
err     = $6208
errh    = $6209
e2      = $620A
e2h     = $620B
cx      = $620C
cy      = $620D
col     = $620E
bitn    = $620F

angx    = $6210
angy    = $6211
ix      = $6212
tmp0    = $6213
tmp1    = $6214
tmp2    = $6215
tmp3    = $6216
tmp4    = $6217
tmp5    = $6218
sgn     = $6219
mulA    = $621A
mulB    = $621B
resL    = $621C
resH    = $621D
xp      = $621E
yp      = $621F
zp      = $6220
e1x     = $6221
e1y     = $6222
e2x     = $6223
e2y     = $6224
nz      = $6225
nzhi    = $6226
fi      = $6227
ecnt    = $6228
drawpg  = $6229
pgoff   = $622A
ymin    = $622B
ymax    = $622C
ycur    = $622D
xl      = $622E
xr      = $622F
nvrt    = $6230
edgi    = $6231
bposx   = $6232             ; ball centre X
bposy   = $6233             ; ball centre Y
bvelx   = $6234             ; signed X velocity
bvely   = $6235             ; signed Y velocity ( + = down)
oby1    = $6236             ; page1 clear ymin
oby1m   = $6237             ; page1 clear ymax
oby2    = $6238             ; page2 clear ymin
oby2m   = $6239
bbymin  = $623A             ; current frame bbox Y
bbymax  = $623B
gi      = $623C             ; grid loop index
ink     = $623D             ; 0=black (clear bits), 1=white (set bits)

fvis    = $6300             ; 128 face flags
RX      = $6380             ; 114 verts
RY      = $63F2
RZ      = $6464
PX      = $64D6
PY      = $6548
FSX     = $6600             ; fill poly screen X[4]
FSY     = $6604             ; fill poly screen Y[4]

NVERT0  = 114
NFACE0  = 128
NEDGE0  = 240
YMAX0   = 192
XMINB0  = 44
XMAXB0  = 211
YMINB0  = 44
YMAXB0  = 145               ; low bounce: sits in floor zone below wall
GRAV0   = 1
UPVEL0  = $F1               ; -15: floor relaunch → same apex every bounce
; Room grid (5% margins)
HORIZ0  = 181               ; lowest back-wall horizontal (5% above bottom)
NVERTLINE = 15
NHORZLINE = 12
NFLOORH0  = 2               ; floor horizontal lines

start:  lda TXTCLR
        lda FULLSCR
        lda LOWSCR
        lda HIRESW
        jsr build_rows
        stz drawpg
        stz pgoff
        jsr clear_hgr
        lda #1
        sta ink
        jsr drawgrid
        lda #$20
        sta pgoff
        jsr clear_hgr
        lda #1
        sta ink
        jsr drawgrid
        stz pgoff
        lda LOWSCR
        jsr flip_show
        stz angx
        lda #12
        sta angy
        lda #140
        sta bposx
        lda #YMAXB0
        sta bposy
        lda #4
        sta bvelx
        lda #UPVEL0
        sta bvely
        stz oby1
        stz oby2
        lda #YMAX0-1
        sta oby1m
        sta oby2m

mainlp: lda FULLSCR
        jsr moveball
        jsr clear_bbox
        lda #1
        sta ink
        jsr drawgrid            ; redraw room after erase band
        jsr xform
        jsr calcvis
        jsr fillsolid
        lda #1
        sta ink
        jsr drawmesh
        jsr save_bbox
        jsr flip_show
        inc angy
        lda angy
        and #63
        sta angy
        lda angx
        clc
        adc #1
        and #63
        sta angx
        lda KBD
        bpl mainlp
        sta KBDSTRB
        brk

; Gravity + wall bounce. Floor always restores UPVEL0 → same peak height.
moveball:
        lda bvely
        clc
        adc #GRAV0
        bvc mb_gok
        lda #$18                ; clamp fall speed
mb_gok: sta bvely
        lda bposx
        clc
        adc bvelx
        sta bposx
        lda bposy
        clc
        adc bvely
        sta bposy
        lda bposx
        cmp #XMINB0
        bcs mb_xr
        lda #XMINB0
        sta bposx
        jsr negvx
        bra mb_y
mb_xr:  cmp #XMAXB0
        bcc mb_y
        lda #XMAXB0
        sta bposx
        jsr negvx
mb_y:   lda bposy
        cmp #YMINB0
        bcs mb_yb
        lda #YMINB0
        sta bposy
        lda #0                  ; apex clip: start falling
        sta bvely
        rts
mb_yb:  cmp #YMAXB0
        bcc mb_dn
        lda #YMAXB0
        sta bposy
        lda #UPVEL0             ; same launch every time → same height
        sta bvely
mb_dn:  rts

negvx:  lda bvelx
        eor #$FF
        clc
        adc #1
        sta bvelx
        rts

; Amiga-style back wall + perspective floor
drawgrid:
        ; --- 15 vertical wall lines (top → horizon) ---
        ldx #0
dg_v:   stx gi
        lda VGRIDX,x
        sta x0
        sta x1
        stz y0
        lda #HORIZ0
        sta y1
        jsr line
        ldx gi
        inx
        cpx #NVERTLINE
        bne dg_v
        ; --- 12 horizontal wall lines ---
        ldx #0
dg_h:   stx gi
        lda HGRIDY,x
        sta y0
        sta y1
        lda VGRIDX             ; left
        sta x0
        lda VGRIDX+14          ; right
        sta x1
        jsr line
        ldx gi
        inx
        cpx #NHORZLINE
        bne dg_h
        ; --- floor rays: wall bottoms → screen bottom (corners) ---
        ldx #0
dg_f:   stx gi
        lda VGRIDX,x
        sta x0
        lda #HORIZ0
        sta y0
        ; bottom x = i * 255 / 14  (0 and 255 = corners of drawable width)
        lda FLOORX,x
        sta x1
        lda #191
        sta y1
        jsr line
        ldx gi
        inx
        cpx #NVERTLINE
        bne dg_f
        ; --- floor horizontals (perspective span between left/right rays) ---
        ldx #0
dg_fh:  stx gi
        lda FLOORY,x
        sta y0
        sta y1
        sta ycur
        ; xL = lerp(VGRIDX[0], 0, t); xR = lerp(VGRIDX[14], 255, t)
        ; t ≈ (y - HORIZ0) / (191 - HORIZ0)  → use table FLXL/FLXR
        lda FLXL,x
        sta x0
        lda FLXR,x
        sta x1
        jsr line
        ldx gi
        inx
        cpx #NFLOORH0
        bne dg_fh
        rts

; Clear only scanlines [oby..obym] on the hidden draw page (big speedup).
clear_bbox:
        lda drawpg
        bne cb_p2
        lda oby1
        sta ycur
        lda oby1m
        bra cb_go
cb_p2:  lda oby2
        sta ycur
        lda oby2m
cb_go:  sta tmp5                ; ymax to clear
cb_lp:  lda ycur
        cmp tmp5
        beq cb_row
        bcc cb_row
        rts
cb_row: cmp #YMAX0
        bcs cb_nx
        tay
        lda ROWL,y
        sta ptr
        lda ROWH,y
        clc
        adc pgoff
        sta ptr+1
        lda #0
        ldy #39
cb_z:   sta (ptr),y
        dey
        bpl cb_z
cb_nx:  lda ycur
        cmp tmp5
        bcs cb_dn
        inc ycur
        bra cb_lp
cb_dn:  rts

; Remember this frame's Y band for the next clear of this page.
save_bbox:
        lda bbymin
        sec
        sbc #4                  ; pad for motion blur/trails
        bcs sb_lo
        lda #0
sb_lo:  tax
        lda bbymax
        clc
        adc #4
        cmp #YMAX0
        bcc sb_h2
        lda #YMAX0-1
sb_h2:  ldy drawpg
        bne sb_p2
        stx oby1
        sta oby1m
        rts
sb_p2:  stx oby2
        sta oby2m
        rts

flip_show:
        lda drawpg
        beq fs_p1
        lda HISCR
        stz drawpg
        stz pgoff
        rts
fs_p1:  lda LOWSCR
        lda #1
        sta drawpg
        lda #$20
        sta pgoff
        rts

xform:  ldx #0
        lda #$FF
        sta bbymin
        stz bbymax
xf_lp:  stx ix
        lda VERTX,x
        sta tmp0
        lda VERTY,x
        sta tmp1
        lda VERTZ,x
        sta tmp2
        ldy angy
        lda tmp0
        ldx COSTBL,y
        jsr smul128
        sta tmp3
        ldy angy
        lda tmp2
        ldx SINTBL,y
        jsr smul128
        sta tmp4
        sec
        lda tmp3
        sbc tmp4
        sta xp
        ldy angy
        lda tmp0
        ldx SINTBL,y
        jsr smul128
        sta tmp3
        ldy angy
        lda tmp2
        ldx COSTBL,y
        jsr smul128
        clc
        adc tmp3
        sta zp
        lda tmp1
        sta yp
        ldy angx
        lda yp
        ldx COSTBL,y
        jsr smul128
        sta tmp3
        ldy angx
        lda zp
        ldx SINTBL,y
        jsr smul128
        sta tmp4
        ldx ix
        sec
        lda tmp3
        sbc tmp4
        sta RY,x
        ldy angx
        lda yp
        ldx SINTBL,y
        jsr smul128
        sta tmp3
        ldy angx
        lda zp
        ldx COSTBL,y
        jsr smul128
        clc
        adc tmp3
        ldx ix
        sta RZ,x
        lda xp
        sta RX,x
        ; PX = bposx + xp (xp signed), saturate to 0..255
        lda xp
        bmi px_neg
        clc
        adc bposx
        bcc px_st
        lda #$FF
        bra px_st
px_neg: clc
        adc bposx
        bcs px_st               ; C=1 → no underflow
        lda #0
px_st:  sta PX,x
        ; PY = bposy - RY (RY signed). Do NOT use BCC after SBC —
        ; a negative RY causes borrow even when the result is valid.
        lda RY,x
        bmi py_neg
        lda bposy
        cmp RY,x
        bcs py_sub
        lda #0
        bra py_st
py_sub: sec
        sbc RY,x
        bra py_clip
py_neg: eor #$FF                ; PY = bposy + |RY|
        clc
        adc #1
        clc
        adc bposy
        bcc py_clip
        lda #YMAX0-1
        bra py_st
py_clip:
        cmp #YMAX0
        bcc py_st
        lda #YMAX0-1
py_st:  sta PY,x
        ; track Y bbox for partial clear
        cmp bbymin
        bcs xf_yb
        sta bbymin
xf_yb:  cmp bbymax
        bcc xf_nx
        sta bbymax
xf_nx:  inx
        cpx #NVERT0
        beq xf_dn
        jmp xf_lp
xf_dn:  rts

smul128:
        stx mulB
        sta mulA
        stz sgn
        lda mulA
        bpl sm1
        eor #$FF
        clc
        adc #1
        sta mulA
        lda #1
        sta sgn
sm1:    lda mulB
        bpl sm2
        eor #$FF
        clc
        adc #1
        sta mulB
        lda sgn
        eor #1
        sta sgn
sm2:    stz resL
        stz resH
        lda mulA
        ldx #8
smlp:   asl resL
        rol resH
        asl a
        bcc smnx
        tay
        clc
        lda resL
        adc mulB
        sta resL
        lda resH
        adc #0
        sta resH
        tya
smnx:   dex
        bne smlp
        lda resH
        ldx #7
sms:    lsr a
        ror resL
        dex
        bne sms
        lda resL
        ldx sgn
        beq smdn
        eor #$FF
        clc
        adc #1
smdn:   rts

; Quads stored as 4 verts; facing from first 3 (16-bit cross Z)
calcvis:
        lda #<FACET
        sta faceptr
        lda #>FACET
        sta faceptr+1
        ldx #0
cv_lp:  stx fi
        ldy #0
        lda (faceptr),y
        sta tmp0
        iny
        lda (faceptr),y
        sta tmp1
        iny
        lda (faceptr),y
        sta tmp2
        ldy tmp0
        lda RX,y
        sta tmp3
        lda RY,y
        sta tmp4
        ldy tmp1
        lda RX,y
        sec
        sbc tmp3
        sta e1x
        lda RY,y
        sec
        sbc tmp4
        sta e1y
        ldy tmp2
        lda RX,y
        sec
        sbc tmp3
        sta e2x
        lda RY,y
        sec
        sbc tmp4
        sta e2y
        lda e1x
        ldx e2y
        jsr smul16
        lda resL
        sta nz
        lda resH
        sta nzhi
        lda e1y
        ldx e2x
        jsr smul16
        sec
        lda nz
        sbc resL
        sta nz
        lda nzhi
        sbc resH
        sta nzhi
        ldx fi
        stz fvis,x
        lda nzhi
        bmi cv_nx
        ora nz
        beq cv_nx
        lda #1
        sta fvis,x
cv_nx:  clc
        lda faceptr
        adc #4                 ; quad stride
        sta faceptr
        lda faceptr+1
        adc #0
        sta faceptr+1
        ldx fi
        inx
        cpx #NFACE0
        beq cv_dn
        jmp cv_lp
cv_dn:  rts

smul16: stx mulB
        sta mulA
        stz sgn
        lda mulA
        bpl sh1
        eor #$FF
        clc
        adc #1
        sta mulA
        lda #1
        sta sgn
sh1:    lda mulB
        bpl sh2
        eor #$FF
        clc
        adc #1
        sta mulB
        lda sgn
        eor #1
        sta sgn
sh2:    stz resL
        stz resH
        lda mulA
        ldx #8
shlp:   asl resL
        rol resH
        asl a
        bcc shnx
        tay
        clc
        lda resL
        adc mulB
        sta resL
        lda resH
        adc #0
        sta resH
        tya
shnx:   dex
        bne shlp
        ldx sgn
        beq shdn
        lda resL
        eor #$FF
        clc
        adc #1
        sta resL
        lda resH
        eor #$FF
        adc #0
        sta resH
shdn:   rts

; Opaque checkerboard: visible faces filled white or black (not see-through).
fillsolid:
        lda #<FACET
        sta faceptr
        lda #>FACET
        sta faceptr+1
        ldx #0
ff_lp:  stx fi
        lda fvis,x
        beq ff_nx
        txa
        jsr chksolid
        sta ink                 ; 1=white square, 0=black square
        jsr loadpoly
        jsr fillpoly
ff_nx:  clc
        lda faceptr
        adc #4
        sta faceptr
        lda faceptr+1
        adc #0
        sta faceptr+1
        ldx fi
        inx
        cpx #NFACE0
        beq ff_dn
        jmp ff_lp
ff_dn:  rts

; A = face index → A=1 if solid checker cell, A=0 if open
chksolid:
        cmp #16
        bcc ck_s
        cmp #112
        bcs ck_n
        sec
        sbc #16
        sta tmp0
        and #15
        sta tmp1
        lda tmp0
        lsr a
        lsr a
        lsr a
        lsr a
        clc
        adc tmp1
        and #1
        rts
ck_s:   and #1
        eor #1                 ; invert vs band 0 so checkerboard continues
        rts
ck_n:   sec
        sbc #112
        clc
        adc #5
        and #1
        eor #1                 ; invert vs last band
        rts

; Copy projected verts for face at faceptr into FSX/FSY; set nvrt = 3 or 4
loadpoly:
        ldy #0
        lda (faceptr),y
        tax
        lda PX,x
        sta FSX
        lda PY,x
        sta FSY
        iny
        lda (faceptr),y
        tax
        lda PX,x
        sta FSX+1
        lda PY,x
        sta FSY+1
        iny
        lda (faceptr),y
        sta tmp5                ; 3rd vertex index
        tax
        lda PX,x
        sta FSX+2
        lda PY,x
        sta FSY+2
        iny
        lda (faceptr),y
        cmp tmp5
        beq lp_tri
        tax
        lda PX,x
        sta FSX+3
        lda PY,x
        sta FSY+3
        lda #4
        sta nvrt
        rts
lp_tri: lda #3
        sta nvrt
        rts

; Convex scanline fill of FSX/FSY[0..nvrt)
fillpoly:
        ldx #0
        lda FSY,x
        sta ymin
        sta ymax
        inx
fp_mm:  lda FSY,x
        cmp ymin
        bcs fp_yhi
        sta ymin
fp_yhi: cmp ymax
        bcc fp_ynx
        sta ymax
fp_ynx: inx
        cpx nvrt
        bcc fp_mm
        ; clamp scan range to screen
        lda ymin
        cmp #YMAX0
        bcc fp_ycl
        rts                     ; fully offscreen
fp_ycl: lda ymax
        cmp #YMAX0
        bcc fp_yr
        lda #YMAX0-1
        sta ymax
fp_yr:  lda ymin
        sta ycur
fp_row: lda ycur
        cmp ymax
        beq fp_last
        bcc fp_ok
        rts
fp_last:
fp_ok:  lda #$FF
        sta xl
        stz xr
        ldx #0
fp_ed:  stx edgi
        txa
        clc
        adc #1
        cmp nvrt
        bcc fp_e2
        lda #0
fp_e2:  tay                     ; Y = next vert
        lda FSY,x
        sta y0
        lda FSX,x
        sta x0
        lda FSY,y
        sta y1
        lda FSX,y
        sta x1
        ; skip horizontal
        lda y0
        cmp y1
        beq fp_en
        ; order so y0 < y1
        bcc fp_ord
        ; swap endpoints
        lda y0
        ldx y1
        stx y0
        sta y1
        lda x0
        ldx x1
        stx x0
        sta x1
fp_ord: ; if ycur < y0 or ycur > y1 skip (inclusive ends)
        lda ycur
        cmp y0
        bcc fp_en
        cmp y1
        beq fp_int
        bcc fp_int
        bra fp_en
fp_int: ; x = x0 + (ycur-y0)*(x1-x0)/(y1-y0)
        sec
        lda ycur
        sbc y0
        sta tmp0                ; dy0
        sec
        lda y1
        sbc y0
        sta tmp1                ; dy
        sec
        lda x1
        sbc x0
        sta tmp2                ; dx signed
        lda tmp0
        ldx tmp2
        jsr smul16              ; dy0 * dx → res
        lda tmp1
        jsr div16u              ; res / dy → A
        clc
        adc x0
        ; update xl/xr
        cmp xl
        bcs fp_xr
        sta xl
fp_xr:  cmp xr
        bcc fp_en
        sta xr
fp_en:  ldx edgi
        inx
        cpx nvrt
        beq fp_hl
        jmp fp_ed
fp_hl:  lda xl
        cmp #$FF
        beq fp_ny               ; no hits
        cmp xr
        beq fp_one
        bcc fp_hline
        ; xl > xr shouldn't happen often
        ldx xl
        lda xr
        sta xl
        stx xr
fp_hline:
        jsr hline
        bra fp_ny
fp_one: lda xl
        sta cx
        lda ycur
        sta cy
        jsr seedcol
        jsr plotcur
fp_ny:  inc ycur
        lda ycur
        cmp ymax
        beq fp_bot
        bcc fp_more
        rts
fp_bot: jmp fp_row              ; include ymax
fp_more:jmp fp_row

; resL:resH / A(unsigned) → A quotient (signed num / unsigned den)
div16u: sta tmp3
        lda resH
        bpl d6pos
        ; negate
        lda resL
        eor #$FF
        clc
        adc #1
        sta resL
        lda resH
        eor #$FF
        adc #0
        sta resH
        lda #1
        sta sgn
        bra d6go
d6pos:  stz sgn
d6go:   stz tmp4                ; quot
        lda tmp3
        beq d6z
d6lp:   lda resH
        bne d6sub
        lda resL
        cmp tmp3
        bcc d6dn
d6sub:  sec
        lda resL
        sbc tmp3
        sta resL
        lda resH
        sbc #0
        sta resH
        inc tmp4
        bne d6lp
        ; overflow cap
d6dn:   lda tmp4
        ldx sgn
        beq d6z
        eor #$FF
        clc
        adc #1
d6z:    rts

; Horizontal span xl..xr at ycur (clipped to hi-res byte cols)
hline:  lda ycur
        cmp #YMAX0
        bcs hl_dn
        lda xl
        cmp xr
        bcc hl_go
        beq hl_go
        ldx xl
        lda xr
        sta xl
        stx xr
hl_go:  lda xl
        sta cx
        lda ycur
        sta cy
        jsr seedcol
hl_lp:  lda col
        cmp #40
        bcs hl_dn
        jsr plotcur
        lda cx
        cmp xr
        bcs hl_dn
        inc cx
        ldx bitn
        inx
        cpx #7
        bne hl_bit
        inc col
        ldx #0
hl_bit: stx bitn
        bra hl_lp
hl_dn:  rts

drawmesh:
        lda #<EDGES
        sta edgeptr
        lda #>EDGES
        sta edgeptr+1
        lda #NEDGE0
        sta ecnt
dc_lp:  ldy #0
        lda (edgeptr),y
        sta tmp0
        iny
        lda (edgeptr),y
        sta tmp1
        iny
        lda (edgeptr),y
        sta tmp3
        iny
        lda (edgeptr),y
        sta tmp2
        ldy tmp3
        lda fvis,y
        bne dc_go
        ldy tmp2
        lda fvis,y
        beq dc_nx
dc_go:  ldy tmp0
        lda PX,y
        sta x0
        lda PY,y
        sta y0
        ldy tmp1
        lda PX,y
        sta x1
        lda PY,y
        sta y1
        jsr line
dc_nx:  clc
        lda edgeptr
        adc #4
        sta edgeptr
        lda edgeptr+1
        adc #0
        sta edgeptr+1
        dec ecnt
        beq dc_dn
        jmp dc_lp
dc_dn:  rts

line:   sec
        lda x1
        sbc x0
        bcs lxpos
        eor #$FF
        clc
        adc #1
        sta dx
        lda #$FF
        sta sxs
        bra lydo
lxpos:  sta dx
        lda #1
        sta sxs
lydo:   sec
        lda y1
        sbc y0
        bcs lypos
        eor #$FF
        clc
        adc #1
        sta dy
        lda #$FF
        sta sys
        bra linit
lypos:  sta dy
        lda #1
        sta sys
linit:  sec
        lda dx
        sbc dy
        sta err
        lda #0
        sbc #0
        sta errh
        lda x0
        sta cx
        lda y0
        sta cy
        jsr seedcol
lloop:  lda cx
        cmp x1
        bne lplot
        lda cy
        cmp y1
        bne lplot
        jsr plotcur
        rts
lplot:  jsr plotcur
        lda err
        asl a
        sta e2
        lda errh
        rol a
        sta e2h
        clc
        lda e2
        adc dy
        sta tmp0
        lda e2h
        adc #0
        bmi lychk
        bne lxstep
        lda tmp0
        beq lychk
lxstep: sec
        lda err
        sbc dy
        sta err
        lda errh
        sbc #0
        sta errh
        lda sxs
        bmi lxneg
        inc cx
        ldx bitn
        inx
        cpx #7
        bne lxok
        inc col
        ldx #0
lxok:   stx bitn
        bra lychk
lxneg:  dec cx
        ldx bitn
        bne lxn2
        dec col
        ldx #7
lxn2:   dex
        stx bitn
lychk:  sec
        lda e2
        sbc dx
        lda e2h
        sbc #0
        bmi ly_do
        jmp lloop
ly_do:  clc
        lda err
        adc dx
        sta err
        lda errh
        adc #0
        sta errh
        lda sys
        bmi lyneg
        inc cy
        jmp lloop
lyneg:  dec cy
        jmp lloop

seedcol:
        lda cx
        stz col
sclp:   cmp #7
        bcc scdn
        sbc #7
        inc col
        bra sclp
scdn:   sta bitn
        rts

plotcur:
        lda cy
        cmp #YMAX0
        bcs pcsk
        lda col
        cmp #40
        bcs pcsk
        ldy cy
        lda ROWL,y
        sta ptr
        lda ROWH,y
        clc
        adc pgoff
        sta ptr+1
        ldx bitn
        cpx #7
        bcs pcsk
        lda BITMASK,x
        ldy col
        ldx ink
        beq pc_blk
        ora (ptr),y
        sta (ptr),y
        rts
pc_blk: eor #$FF
        and (ptr),y
        sta (ptr),y
pcsk:   rts

build_rows:
        ldx #0
br_lp:  txa
        and #7
        asl a
        asl a
        clc
        adc #$20
        sta tmp0
        txa
        lsr a
        lsr a
        lsr a
        and #7
        sta tmp1
        lsr a
        clc
        adc tmp0
        sta ROWH,x
        stz tmp0
        lda tmp1
        and #1
        beq brlo
        lda #$80
        sta tmp0
brlo:   txa
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        beq brdn
        tay
br28:   lda tmp0
        clc
        adc #$28
        sta tmp0
        dey
        bne br28
brdn:   lda tmp0
        sta ROWL,x
        inx
        cpx #192
        bne br_lp
        rts

clear_hgr:
        lda pgoff
        bne clear_p2
        ldx #0
        lda #0
ch1:    sta $2000,x
        sta $2100,x
        sta $2200,x
        sta $2300,x
        sta $2400,x
        sta $2500,x
        sta $2600,x
        sta $2700,x
        sta $2800,x
        sta $2900,x
        sta $2A00,x
        sta $2B00,x
        sta $2C00,x
        sta $2D00,x
        sta $2E00,x
        sta $2F00,x
        sta $3000,x
        sta $3100,x
        sta $3200,x
        sta $3300,x
        sta $3400,x
        sta $3500,x
        sta $3600,x
        sta $3700,x
        sta $3800,x
        sta $3900,x
        sta $3A00,x
        sta $3B00,x
        sta $3C00,x
        sta $3D00,x
        sta $3E00,x
        sta $3F00,x
        inx
        bne ch1
        rts
clear_p2:
        ldx #0
        lda #0
ch2:    sta $4000,x
        sta $4100,x
        sta $4200,x
        sta $4300,x
        sta $4400,x
        sta $4500,x
        sta $4600,x
        sta $4700,x
        sta $4800,x
        sta $4900,x
        sta $4A00,x
        sta $4B00,x
        sta $4C00,x
        sta $4D00,x
        sta $4E00,x
        sta $4F00,x
        sta $5000,x
        sta $5100,x
        sta $5200,x
        sta $5300,x
        sta $5400,x
        sta $5500,x
        sta $5600,x
        sta $5700,x
        sta $5800,x
        sta $5900,x
        sta $5A00,x
        sta $5B00,x
        sta $5C00,x
        sta $5D00,x
        sta $5E00,x
        sta $5F00,x
        inx
        bne ch2
        rts

; Room grid geometry (5% side margins in drawable 0..255 space)
VGRIDX: .byte $0E,$1E,$2E,$3E,$4E,$5F,$6F,$7F,$8F,$9F,$B0,$C0,$D0,$E0,$F1
HGRIDY: .byte $00,$10,$20,$31,$41,$52,$62,$73,$83,$94,$A4,$B5
FLOORX: .byte $00,$12,$24,$36,$48,$5B,$6D,$7F,$91,$A3,$B6,$C8,$DA,$EC,$FF
FLOORY: .byte $B8,$BB
FLXL:   .byte $09,$05
FLXR:   .byte $F5,$F9

BITMASK:
        .byte $01,$02,$04,$08,$10,$20,$40

VERTX:
        .byte $00,$00,$0F,$0E,$0B,$06,$00,$FA,$F5,$F2,$F1,$F2,$F5,$FA,$00,$06
        .byte $0B,$0E,$1C,$1A,$14,$0B,$00,$F5,$EC,$E6,$E4,$E6,$EC,$F5,$00,$0B
        .byte $14,$1A,$25,$22,$1A,$0E,$00,$F2,$E6,$DE,$DB,$DE,$E6,$F2,$00,$0E
        .byte $1A,$22,$28,$25,$1C,$0F,$00,$F1,$E4,$DB,$D8,$DB,$E4,$F1,$00,$0F
        .byte $1C,$25,$25,$22,$1A,$0E,$00,$F2,$E6,$DE,$DB,$DE,$E6,$F2,$00,$0E
        .byte $1A,$22,$1C,$1A,$14,$0B,$00,$F5,$EC,$E6,$E4,$E6,$EC,$F5,$00,$0B
        .byte $14,$1A,$0F,$0E,$0B,$06,$00,$FA,$F5,$F2,$F1,$F2,$F5,$FA,$00,$06
        .byte $0B,$0E
VERTY:
        .byte $D8,$28,$DB,$DB,$DB,$DB,$DB,$DB,$DB,$DB,$DB,$DB,$DB,$DB,$DB,$DB
        .byte $DB,$DB,$E4,$E4,$E4,$E4,$E4,$E4,$E4,$E4,$E4,$E4,$E4,$E4,$E4,$E4
        .byte $E4,$E4,$F1,$F1,$F1,$F1,$F1,$F1,$F1,$F1,$F1,$F1,$F1,$F1,$F1,$F1
        .byte $F1,$F1,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F,$0F
        .byte $0F,$0F,$1C,$1C,$1C,$1C,$1C,$1C,$1C,$1C,$1C,$1C,$1C,$1C,$1C,$1C
        .byte $1C,$1C,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25,$25
        .byte $25,$25
VERTZ:
        .byte $00,$00,$00,$06,$0B,$0E,$0F,$0E,$0B,$06,$00,$FA,$F5,$F2,$F1,$F2
        .byte $F5,$FA,$00,$0B,$14,$1A,$1C,$1A,$14,$0B,$00,$F5,$EC,$E6,$E4,$E6
        .byte $EC,$F5,$00,$0E,$1A,$22,$25,$22,$1A,$0E,$00,$F2,$E6,$DE,$DB,$DE
        .byte $E6,$F2,$00,$0F,$1C,$25,$28,$25,$1C,$0F,$00,$F1,$E4,$DB,$D8,$DB
        .byte $E4,$F1,$00,$0E,$1A,$22,$25,$22,$1A,$0E,$00,$F2,$E6,$DE,$DB,$DE
        .byte $E6,$F2,$00,$0B,$14,$1A,$1C,$1A,$14,$0B,$00,$F5,$EC,$E6,$E4,$E6
        .byte $EC,$F5,$00,$06,$0B,$0E,$0F,$0E,$0B,$06,$00,$FA,$F5,$F2,$F1,$F2
        .byte $F5,$FA

; 128 faces × 4 indices (triangles repeat 4th = 3rd)
FACET:
        .byte $00,$02,$03,$03,$00,$03,$04,$04,$00,$04,$05,$05,$00,$05,$06,$06
        .byte $00,$06,$07,$07,$00,$07,$08,$08,$00,$08,$09,$09,$00,$09,$0A,$0A
        .byte $00,$0A,$0B,$0B,$00,$0B,$0C,$0C,$00,$0C,$0D,$0D,$00,$0D,$0E,$0E
        .byte $00,$0E,$0F,$0F,$00,$0F,$10,$10,$00,$10,$11,$11,$00,$11,$02,$02
        .byte $02,$12,$13,$03,$03,$13,$14,$04,$04,$14,$15,$05,$05,$15,$16,$06
        .byte $06,$16,$17,$07,$07,$17,$18,$08,$08,$18,$19,$09,$09,$19,$1A,$0A
        .byte $0A,$1A,$1B,$0B,$0B,$1B,$1C,$0C,$0C,$1C,$1D,$0D,$0D,$1D,$1E,$0E
        .byte $0E,$1E,$1F,$0F,$0F,$1F,$20,$10,$10,$20,$21,$11,$11,$21,$12,$02
        .byte $12,$22,$23,$13,$13,$23,$24,$14,$14,$24,$25,$15,$15,$25,$26,$16
        .byte $16,$26,$27,$17,$17,$27,$28,$18,$18,$28,$29,$19,$19,$29,$2A,$1A
        .byte $1A,$2A,$2B,$1B,$1B,$2B,$2C,$1C,$1C,$2C,$2D,$1D,$1D,$2D,$2E,$1E
        .byte $1E,$2E,$2F,$1F,$1F,$2F,$30,$20,$20,$30,$31,$21,$21,$31,$22,$12
        .byte $22,$32,$33,$23,$23,$33,$34,$24,$24,$34,$35,$25,$25,$35,$36,$26
        .byte $26,$36,$37,$27,$27,$37,$38,$28,$28,$38,$39,$29,$29,$39,$3A,$2A
        .byte $2A,$3A,$3B,$2B,$2B,$3B,$3C,$2C,$2C,$3C,$3D,$2D,$2D,$3D,$3E,$2E
        .byte $2E,$3E,$3F,$2F,$2F,$3F,$40,$30,$30,$40,$41,$31,$31,$41,$32,$22
        .byte $32,$42,$43,$33,$33,$43,$44,$34,$34,$44,$45,$35,$35,$45,$46,$36
        .byte $36,$46,$47,$37,$37,$47,$48,$38,$38,$48,$49,$39,$39,$49,$4A,$3A
        .byte $3A,$4A,$4B,$3B,$3B,$4B,$4C,$3C,$3C,$4C,$4D,$3D,$3D,$4D,$4E,$3E
        .byte $3E,$4E,$4F,$3F,$3F,$4F,$50,$40,$40,$50,$51,$41,$41,$51,$42,$32
        .byte $42,$52,$53,$43,$43,$53,$54,$44,$44,$54,$55,$45,$45,$55,$56,$46
        .byte $46,$56,$57,$47,$47,$57,$58,$48,$48,$58,$59,$49,$49,$59,$5A,$4A
        .byte $4A,$5A,$5B,$4B,$4B,$5B,$5C,$4C,$4C,$5C,$5D,$4D,$4D,$5D,$5E,$4E
        .byte $4E,$5E,$5F,$4F,$4F,$5F,$60,$50,$50,$60,$61,$51,$51,$61,$52,$42
        .byte $52,$62,$63,$53,$53,$63,$64,$54,$54,$64,$65,$55,$55,$65,$66,$56
        .byte $56,$66,$67,$57,$57,$67,$68,$58,$58,$68,$69,$59,$59,$69,$6A,$5A
        .byte $5A,$6A,$6B,$5B,$5B,$6B,$6C,$5C,$5C,$6C,$6D,$5D,$5D,$6D,$6E,$5E
        .byte $5E,$6E,$6F,$5F,$5F,$6F,$70,$60,$60,$70,$71,$61,$61,$71,$62,$52
        .byte $01,$63,$62,$62,$01,$64,$63,$63,$01,$65,$64,$64,$01,$66,$65,$65
        .byte $01,$67,$66,$66,$01,$68,$67,$67,$01,$69,$68,$68,$01,$6A,$69,$69
        .byte $01,$6B,$6A,$6A,$01,$6C,$6B,$6B,$01,$6D,$6C,$6C,$01,$6E,$6D,$6D
        .byte $01,$6F,$6E,$6E,$01,$70,$6F,$6F,$01,$71,$70,$70,$01,$62,$71,$71

EDGES:
        .byte $00,$02,$00,$0F,$02,$03,$00,$10,$00,$03,$00,$01,$03,$04,$01,$11
        .byte $00,$04,$01,$02,$04,$05,$02,$12,$00,$05,$02,$03,$05,$06,$03,$13
        .byte $00,$06,$03,$04,$06,$07,$04,$14,$00,$07,$04,$05,$07,$08,$05,$15
        .byte $00,$08,$05,$06,$08,$09,$06,$16,$00,$09,$06,$07,$09,$0A,$07,$17
        .byte $00,$0A,$07,$08,$0A,$0B,$08,$18,$00,$0B,$08,$09,$0B,$0C,$09,$19
        .byte $00,$0C,$09,$0A,$0C,$0D,$0A,$1A,$00,$0D,$0A,$0B,$0D,$0E,$0B,$1B
        .byte $00,$0E,$0B,$0C,$0E,$0F,$0C,$1C,$00,$0F,$0C,$0D,$0F,$10,$0D,$1D
        .byte $00,$10,$0D,$0E,$10,$11,$0E,$1E,$00,$11,$0E,$0F,$02,$11,$0F,$1F
        .byte $02,$12,$10,$1F,$12,$13,$10,$20,$03,$13,$10,$11,$13,$14,$11,$21
        .byte $04,$14,$11,$12,$14,$15,$12,$22,$05,$15,$12,$13,$15,$16,$13,$23
        .byte $06,$16,$13,$14,$16,$17,$14,$24,$07,$17,$14,$15,$17,$18,$15,$25
        .byte $08,$18,$15,$16,$18,$19,$16,$26,$09,$19,$16,$17,$19,$1A,$17,$27
        .byte $0A,$1A,$17,$18,$1A,$1B,$18,$28,$0B,$1B,$18,$19,$1B,$1C,$19,$29
        .byte $0C,$1C,$19,$1A,$1C,$1D,$1A,$2A,$0D,$1D,$1A,$1B,$1D,$1E,$1B,$2B
        .byte $0E,$1E,$1B,$1C,$1E,$1F,$1C,$2C,$0F,$1F,$1C,$1D,$1F,$20,$1D,$2D
        .byte $10,$20,$1D,$1E,$20,$21,$1E,$2E,$11,$21,$1E,$1F,$12,$21,$1F,$2F
        .byte $12,$22,$20,$2F,$22,$23,$20,$30,$13,$23,$20,$21,$23,$24,$21,$31
        .byte $14,$24,$21,$22,$24,$25,$22,$32,$15,$25,$22,$23,$25,$26,$23,$33
        .byte $16,$26,$23,$24,$26,$27,$24,$34,$17,$27,$24,$25,$27,$28,$25,$35
        .byte $18,$28,$25,$26,$28,$29,$26,$36,$19,$29,$26,$27,$29,$2A,$27,$37
        .byte $1A,$2A,$27,$28,$2A,$2B,$28,$38,$1B,$2B,$28,$29,$2B,$2C,$29,$39
        .byte $1C,$2C,$29,$2A,$2C,$2D,$2A,$3A,$1D,$2D,$2A,$2B,$2D,$2E,$2B,$3B
        .byte $1E,$2E,$2B,$2C,$2E,$2F,$2C,$3C,$1F,$2F,$2C,$2D,$2F,$30,$2D,$3D
        .byte $20,$30,$2D,$2E,$30,$31,$2E,$3E,$21,$31,$2E,$2F,$22,$31,$2F,$3F
        .byte $22,$32,$30,$3F,$32,$33,$30,$40,$23,$33,$30,$31,$33,$34,$31,$41
        .byte $24,$34,$31,$32,$34,$35,$32,$42,$25,$35,$32,$33,$35,$36,$33,$43
        .byte $26,$36,$33,$34,$36,$37,$34,$44,$27,$37,$34,$35,$37,$38,$35,$45
        .byte $28,$38,$35,$36,$38,$39,$36,$46,$29,$39,$36,$37,$39,$3A,$37,$47
        .byte $2A,$3A,$37,$38,$3A,$3B,$38,$48,$2B,$3B,$38,$39,$3B,$3C,$39,$49
        .byte $2C,$3C,$39,$3A,$3C,$3D,$3A,$4A,$2D,$3D,$3A,$3B,$3D,$3E,$3B,$4B
        .byte $2E,$3E,$3B,$3C,$3E,$3F,$3C,$4C,$2F,$3F,$3C,$3D,$3F,$40,$3D,$4D
        .byte $30,$40,$3D,$3E,$40,$41,$3E,$4E,$31,$41,$3E,$3F,$32,$41,$3F,$4F
        .byte $32,$42,$40,$4F,$42,$43,$40,$50,$33,$43,$40,$41,$43,$44,$41,$51
        .byte $34,$44,$41,$42,$44,$45,$42,$52,$35,$45,$42,$43,$45,$46,$43,$53
        .byte $36,$46,$43,$44,$46,$47,$44,$54,$37,$47,$44,$45,$47,$48,$45,$55
        .byte $38,$48,$45,$46,$48,$49,$46,$56,$39,$49,$46,$47,$49,$4A,$47,$57
        .byte $3A,$4A,$47,$48,$4A,$4B,$48,$58,$3B,$4B,$48,$49,$4B,$4C,$49,$59
        .byte $3C,$4C,$49,$4A,$4C,$4D,$4A,$5A,$3D,$4D,$4A,$4B,$4D,$4E,$4B,$5B
        .byte $3E,$4E,$4B,$4C,$4E,$4F,$4C,$5C,$3F,$4F,$4C,$4D,$4F,$50,$4D,$5D
        .byte $40,$50,$4D,$4E,$50,$51,$4E,$5E,$41,$51,$4E,$4F,$42,$51,$4F,$5F
        .byte $42,$52,$50,$5F,$52,$53,$50,$60,$43,$53,$50,$51,$53,$54,$51,$61
        .byte $44,$54,$51,$52,$54,$55,$52,$62,$45,$55,$52,$53,$55,$56,$53,$63
        .byte $46,$56,$53,$54,$56,$57,$54,$64,$47,$57,$54,$55,$57,$58,$55,$65
        .byte $48,$58,$55,$56,$58,$59,$56,$66,$49,$59,$56,$57,$59,$5A,$57,$67
        .byte $4A,$5A,$57,$58,$5A,$5B,$58,$68,$4B,$5B,$58,$59,$5B,$5C,$59,$69
        .byte $4C,$5C,$59,$5A,$5C,$5D,$5A,$6A,$4D,$5D,$5A,$5B,$5D,$5E,$5B,$6B
        .byte $4E,$5E,$5B,$5C,$5E,$5F,$5C,$6C,$4F,$5F,$5C,$5D,$5F,$60,$5D,$6D
        .byte $50,$60,$5D,$5E,$60,$61,$5E,$6E,$51,$61,$5E,$5F,$52,$61,$5F,$6F
        .byte $52,$62,$60,$6F,$62,$63,$60,$70,$53,$63,$60,$61,$63,$64,$61,$71
        .byte $54,$64,$61,$62,$64,$65,$62,$72,$55,$65,$62,$63,$65,$66,$63,$73
        .byte $56,$66,$63,$64,$66,$67,$64,$74,$57,$67,$64,$65,$67,$68,$65,$75
        .byte $58,$68,$65,$66,$68,$69,$66,$76,$59,$69,$66,$67,$69,$6A,$67,$77
        .byte $5A,$6A,$67,$68,$6A,$6B,$68,$78,$5B,$6B,$68,$69,$6B,$6C,$69,$79
        .byte $5C,$6C,$69,$6A,$6C,$6D,$6A,$7A,$5D,$6D,$6A,$6B,$6D,$6E,$6B,$7B
        .byte $5E,$6E,$6B,$6C,$6E,$6F,$6C,$7C,$5F,$6F,$6C,$6D,$6F,$70,$6D,$7D
        .byte $60,$70,$6D,$6E,$70,$71,$6E,$7E,$61,$71,$6E,$6F,$62,$71,$6F,$7F
        .byte $01,$63,$70,$71,$01,$62,$70,$7F,$01,$64,$71,$72,$01,$65,$72,$73
        .byte $01,$66,$73,$74,$01,$67,$74,$75,$01,$68,$75,$76,$01,$69,$76,$77
        .byte $01,$6A,$77,$78,$01,$6B,$78,$79,$01,$6C,$79,$7A,$01,$6D,$7A,$7B
        .byte $01,$6E,$7B,$7C,$01,$6F,$7C,$7D,$01,$70,$7D,$7E,$01,$71,$7E,$7F

SINTBL:
        .byte $00,$0C,$19,$25,$31,$3C,$47,$51,$5A,$62,$6A,$70,$75,$7A,$7D,$7E
        .byte $7F,$7E,$7D,$7A,$75,$70,$6A,$62,$5A,$51,$47,$3C,$31,$25,$19,$0C
        .byte $00,$F4,$E7,$DB,$CF,$C4,$B9,$AF,$A6,$9E,$96,$90,$8B,$86,$83,$82
        .byte $81,$82,$83,$86,$8B,$90,$96,$9E,$A6,$AF,$B9,$C4,$CF,$DB,$E7,$F4
COSTBL:
        .byte $7F,$7E,$7D,$7A,$75,$70,$6A,$62,$5A,$51,$47,$3C,$31,$25,$19,$0C
        .byte $00,$F4,$E7,$DB,$CF,$C4,$B9,$AF,$A6,$9E,$96,$90,$8B,$86,$83,$82
        .byte $81,$82,$83,$86,$8B,$90,$96,$9E,$A6,$AF,$B9,$C4,$CF,$DB,$E7,$F4
        .byte $00,$0C,$19,$25,$31,$3C,$47,$51,$5A,$62,$6A,$70,$75,$7A,$7D,$7E
