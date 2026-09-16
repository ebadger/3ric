; ============================================================================
; STAR DUEL  -  two-player gravity war for the 3ric  (65C02)
;
; Original take on the Spacewar conventions: two ships, a central sun,
; inverse-distance gravity, wrap, thrust inertia, and torpedoes.  Names,
; silhouettes, HUD, and code are original to 3RIC Studio.
;
; P1: A/D or arrows rotate, W/Up thrust, S/Space fire, H hyperspace
; P2: J/L rotate, I thrust, K/U fire, N hyperspace
; SNES 1/2: L/R rotate, Up/B thrust, A/Y fire, Select hyperspace, Start play
; Q/Esc returns to the monitor.  First to 5 kills wins.
;
; Build / run:
;   BRUN SPACEWAR.PRG 0800
; ============================================================================

        .org $0800

; ---- soft switches / hardware ----
KBD      = $C000
KBDSTRB  = $C010
SPEAKER  = $C030
TXTCLR   = $C050
TXTSET   = $C051
MIXSET   = $C053
LOWSCR   = $C054
HIRES_SW = $C057
PTRIG    = $C070
HOME     = $FC58
JOYMODE  = $CE15
GAMEPAD1 = $CEE0
GAMEPAD2 = $CEF0

PAD_B    = 0
PAD_Y    = 1
PAD_SEL  = 2
PAD_START = 3
PAD_UP   = 4
PAD_DOWN = 5
PAD_LEFT = 6
PAD_RIGHT = 7
PAD_A    = 8

; ---- keys (high bit set) ----
K_A      = $C1
K_D      = $C4
K_W      = $D7
K_S      = $D3
K_H      = $C8
K_J      = $CA
K_L      = $CC
K_I      = $C9
K_K      = $CB
K_U      = $D5
K_N      = $CE
K_Q      = $D1
K_ESC    = $9B
K_SPACE  = $A0
K_LARR   = $88
K_RARR   = $95
K_UARR   = $8B

; ---- playfield / tunables ----
PFW      = 280
PFH      = 160
NANG0    = 32
SUNX     = 140
SUNY     = 80
SUNHIT   = 6
SHIPHIT  = 10
SHOTHIT  = 10
MAXV0    = 4
HOLD0    = 4
FIRECD0  = 10
SHOTLIFE = 72
WINSC    = 5
DEADWAIT = 40
INV0     = 24
NSHOT    = 4
BSIZE    = 16

GS_ATTRACT = 0
GS_PLAY  = 1
GS_OVER  = 2

; ---- memory ----
SCREEN   = $2000
ROWL     = $6000
ROWH     = $6100
SHIP0    = $6300
SHIP1    = $6310
SHOTS    = $6320

; ship / shot field offsets
o_act    = 0
o_xf     = 1
o_xl     = 2
o_xh     = 3
o_yf     = 4
o_yl     = 5
o_yh     = 6
o_vxl    = 7
o_vxh    = 8
o_vyl    = 9
o_vyh    = 10
o_ang    = 11
o_drawn  = 12
o_cool   = 13
o_inv    = 14
o_dead   = 15

b_act    = 0
b_xl     = 1
b_xh     = 2
b_yl     = 3
b_dx     = 4
b_dy     = 5
b_life   = 6
b_own    = 7
b_drawn  = 8

; ---- zero page (monitor-safe scratch) ----
ptr      = $06
objptr   = $08
tmpa     = $0A
tmpb     = $0B
tmpc     = $0C
tmpd     = $0D
save0    = $0E
save1    = $0F

; ---- absolute working RAM ----
lx0      = $6200
ly0      = $6201
lx1      = $6202
ly1      = $6203
lx       = $6204
ly       = $6205
dx8      = $6206
dy8      = $6207
sx8      = $6208
sy8      = $6209
lerr     = $620A
e2       = $620B
lcnt     = $620C
plotor   = $620D
cenx     = $620E
cenh     = $620F
ceny     = $6210
bx       = $6211
bxh      = $6212
by       = $6213
col      = $6214
bitn     = $6215
tt       = $6216
tth      = $6217
shipi    = $6218
gval     = $6219
sgx      = $621A
sgy      = $621B
adx      = $621C
ady      = $621D
dxlo     = $621E
dxhi     = $621F
p1l      = $6220
p1r      = $6221
p1t      = $6222
p1f      = $6223
p1h      = $6224
p2l      = $6225
p2r      = $6226
p2t      = $6227
p2f      = $6228
p2h      = $6229
p1st     = $622A
p2st     = $622B
wantst   = $622C
tleft    = $622D
tright   = $622E
tthr     = $622F
tfire    = $6230
thyp     = $6231
h1l      = $6232
h1r      = $6233
h1t      = $6234
h1f      = $6235
h1h      = $6236
h2l      = $6237
h2r      = $6238
h2t      = $6239
h2f      = $623A
h2h      = $623B
keyin    = $623C
gstate   = $623D
p1sc     = $623E
p2sc     = $623F
fastmd   = $6240
seed     = $6241
seedh    = $6242
quitf    = $6243
shoti    = $6244
hcx      = $6245
hcxh     = $6246
hcy      = $6247
hpx      = $6248
hpxh     = $6249
hpy      = $624A
hrad     = $624B
cdx      = $624C
winner   = $624D
noscore  = $624E
keyq     = $624F

TLINE20  = $0650
TLINE21  = $06D0
TLINE22  = $0750
TLINE23  = $07D0

; ============================================================================
start:
        sei
        cld
        ldx #$FF
        txs
        stz fastmd
        stz quitf
        stz noscore
        lda #$A5
        sta seed
        lda #$5A
        sta seedh
        jsr video_init
        jsr enter_attract
main_loop:
        lda quitf
        bne exit_game
        jsr game_frame
        bra main_loop

exit_game:
        lda TXTSET
        lda LOWSCR
        jsr HOME
        brk

; ---------------------------------------------------------------------------
video_init:
        lda TXTCLR
        lda MIXSET
        lda LOWSCR
        lda HIRES_SW
        lda KBDSTRB
        stz JOYMODE
        jsr build_rows
        jsr clear_screen
        stz plotor
        inc plotor
        jsr draw_sun
        jsr draw_field
        stz plotor
        rts

enter_attract:
        lda #GS_ATTRACT
        sta gstate
        stz p1sc
        stz p2sc
        stz winner
        jsr clear_shots
        stz shipi
        jsr set_ship
        jsr spawn_one
        lda #1
        sta shipi
        jsr set_ship
        jsr spawn_one
        rts

game_init:
        lda #GS_PLAY
        sta gstate
        stz p1sc
        stz p2sc
        stz winner
        jsr clear_shots
        stz shipi
        jsr set_ship
        jsr spawn_one
        lda #1
        sta shipi
        jsr set_ship
        jsr spawn_one
        rts

; ---------------------------------------------------------------------------
game_frame:
        jsr erase_objs
        jsr read_input
        lda quitf
        bne gf_rts
        jsr apply_input
        lda gstate
        cmp #GS_OVER
        beq gf_draw
        jsr phys_all
gf_draw:
        jsr draw_objs
        jsr hud_draw
        jsr pace_frame
gf_rts:
        rts

pace_frame:
        lda fastmd
        bne pf_rts
        ldx #$18
        ldy #0
pf_l:
        dey
        bne pf_l
        dex
        bne pf_l
pf_rts:
        rts

; ============================================================================
; input
; ============================================================================
read_input:
        jsr decay_holds
        jsr clear_intent
        jsr scan_keys
        lda PTRIG
        jsr scan_pads
        jsr merge_holds
        rts

decay_holds:
        ldx #9
dh_l:
        lda h1l,x
        beq dh_n
        dec h1l,x
dh_n:
        dex
        bpl dh_l
        rts

clear_intent:
        ldx #12
ci_l:
        stz p1l,x
        dex
        bpl ci_l
        stz wantst
        stz keyq
        rts

merge_holds:
        ldx #9
mh_l:
        lda h1l,x
        beq mh_n
        lda #1
        sta p1l,x
mh_n:
        dex
        bpl mh_l
        rts

scan_keys:
        lda KBD
        bpl sk_rts
        sta keyin
        lda KBDSTRB
        lda keyin
        cmp #K_Q
        beq sk_q
        cmp #K_ESC
        beq sk_q
        cmp #K_A
        beq sk_p1l
        cmp #K_LARR
        beq sk_p1l
        cmp #K_D
        beq sk_p1r
        cmp #K_RARR
        beq sk_p1r
        cmp #K_W
        beq sk_p1t
        cmp #K_UARR
        beq sk_p1t
        cmp #K_S
        beq sk_p1f
        cmp #K_SPACE
        beq sk_space
        cmp #K_H
        beq sk_p1h
        cmp #K_J
        beq sk_p2l
        cmp #K_L
        beq sk_p2r
        cmp #K_I
        beq sk_p2t
        cmp #K_K
        beq sk_p2f
        cmp #K_U
        beq sk_p2f
        cmp #K_N
        beq sk_p2h
sk_rts:
        rts
sk_q:
        lda #1
        sta quitf
        rts
sk_space:
        lda gstate
        cmp #GS_PLAY
        beq sk_p1f
        lda #1
        sta wantst
        rts
sk_p1l:
        lda #HOLD0
        sta h1l
        rts
sk_p1r:
        lda #HOLD0
        sta h1r
        rts
sk_p1t:
        lda #HOLD0
        sta h1t
        rts
sk_p1f:
        lda #HOLD0
        sta h1f
        rts
sk_p1h:
        lda #HOLD0
        sta h1h
        rts
sk_p2l:
        lda #HOLD0
        sta h2l
        rts
sk_p2r:
        lda #HOLD0
        sta h2r
        rts
sk_p2t:
        lda #HOLD0
        sta h2t
        rts
sk_p2f:
        lda #HOLD0
        sta h2f
        rts
sk_p2h:
        lda #HOLD0
        sta h2h
        rts

scan_pads:
        lda GAMEPAD1+PAD_LEFT
        and GAMEPAD1+PAD_RIGHT
        bne sp1_skip
        lda GAMEPAD1+PAD_LEFT
        beq sp1_r
        lda #1
        sta p1l
sp1_r:
        lda GAMEPAD1+PAD_RIGHT
        beq sp1_rot_done
        lda #1
        sta p1r
sp1_rot_done:
        lda GAMEPAD1+PAD_UP
        ora GAMEPAD1+PAD_B
        beq sp1_t
        lda #1
        sta p1t
sp1_t:
        lda GAMEPAD1+PAD_A
        ora GAMEPAD1+PAD_Y
        beq sp1_f
        lda #1
        sta p1f
sp1_f:
        lda GAMEPAD1+PAD_SEL
        beq sp1_s
        lda #1
        sta p1h
sp1_s:
        lda GAMEPAD1+PAD_START
        sta p1st
sp1_skip:
        lda GAMEPAD2+PAD_LEFT
        and GAMEPAD2+PAD_RIGHT
        bne sp2_skip
        lda GAMEPAD2+PAD_LEFT
        beq sp2_r
        lda #1
        sta p2l
sp2_r:
        lda GAMEPAD2+PAD_RIGHT
        beq sp2_rot_done
        lda #1
        sta p2r
sp2_rot_done:
        lda GAMEPAD2+PAD_UP
        ora GAMEPAD2+PAD_B
        beq sp2_t
        lda #1
        sta p2t
sp2_t:
        lda GAMEPAD2+PAD_A
        ora GAMEPAD2+PAD_Y
        beq sp2_f
        lda #1
        sta p2f
sp2_f:
        lda GAMEPAD2+PAD_SEL
        beq sp2_s
        lda #1
        sta p2h
sp2_s:
        lda GAMEPAD2+PAD_START
        sta p2st
sp2_skip:
        rts

apply_input:
        lda gstate
        cmp #GS_PLAY
        beq ai_play
        lda wantst
        ora p1st
        ora p2st
        beq ai_rts
        jsr game_init
ai_rts:
        rts
ai_play:
        stz shipi
        jsr set_ship
        jsr apply_one
        lda #1
        sta shipi
        jsr set_ship
        jsr apply_one
        rts

apply_one:
        lda shipi
        bne ao_p2
        lda p1l
        sta tleft
        lda p1r
        sta tright
        lda p1t
        sta tthr
        lda p1f
        sta tfire
        lda p1h
        sta thyp
        bra ao_go
ao_p2:
        lda p2l
        sta tleft
        lda p2r
        sta tright
        lda p2t
        sta tthr
        lda p2f
        sta tfire
        lda p2h
        sta thyp
ao_go:
        ldy #o_act
        lda (objptr),y
        bne ao_live
        rts
ao_live:
        lda tleft
        beq ao_right
        lda tright
        bne ao_right
        ldy #o_ang
        lda (objptr),y
        dec a
        and #31
        sta (objptr),y
ao_right:
        lda tright
        beq ao_thr
        lda tleft
        bne ao_thr
        ldy #o_ang
        lda (objptr),y
        inc a
        and #31
        sta (objptr),y
ao_thr:
        lda tthr
        beq ao_fire
        ldy #o_ang
        lda (objptr),y
        tax
        lda COSTAB,x
        jsr addvx
        lda SINTAB,x
        jsr addvy
ao_fire:
        lda tfire
        beq ao_hyp
        jsr tryfire
ao_hyp:
        lda thyp
        beq ao_rts
        jsr do_hyper
ao_rts:
        rts

; ============================================================================
; physics
; ============================================================================
phys_all:
        stz shipi
        jsr set_ship
        jsr phys_one
        lda #1
        sta shipi
        jsr set_ship
        jsr phys_one
        jsr move_all_shots
        jsr collide_all
        jsr respawn_dead
        rts

phys_one:
        jsr tick_ship
        ldy #o_act
        lda (objptr),y
        beq po_rts
        jsr grav_one
        ldy #o_act
        lda (objptr),y
        beq po_rts
        jsr integ_one
        jsr wrap_one
        jsr clamp_one
po_rts:
        rts

tick_ship:
        ldy #o_cool
        lda (objptr),y
        beq ts_inv
        dec a
        sta (objptr),y
ts_inv:
        ldy #o_inv
        lda (objptr),y
        beq ts_rts
        dec a
        sta (objptr),y
ts_rts:
        rts

grav_one:
        stz adx
        stz ady
        stz sgx
        stz sgy
        sec
        lda #<SUNX
        ldy #o_xl
        sbc (objptr),y
        sta dxlo
        lda #>SUNX
        ldy #o_xh
        sbc (objptr),y
        sta dxhi
        lda dxhi
        bmi g_negx
        ora dxlo
        beq g_xdone
        lda #1
        sta sgx
        lda dxhi
        beq g_xlo
        lda #127
        sta adx
        bra g_xdone
g_xlo:
        lda dxlo
        sta adx
        bra g_xdone
g_negx:
        lda #$FF
        sta sgx
        sec
        lda #0
        sbc dxlo
        sta adx
        lda #0
        sbc dxhi
        beq g_xdone
        lda #127
        sta adx
g_xdone:
        sec
        lda #SUNY
        ldy #o_yl
        sbc (objptr),y
        sta tmpa
        beq g_ydone
        bpl g_posy
        lda #$FF
        sta sgy
        lda tmpa
        eor #$FF
        inc a
        sta ady
        bra g_ydone
g_posy:
        sta ady
        lda #1
        sta sgy
g_ydone:
        lda adx
        cmp #SUNHIT
        bcs g_far
        lda ady
        cmp #SUNHIT
        bcs g_far
        jmp kill_ship
g_far:
        clc
        lda adx
        adc ady
        bcc g_man
        lda #255
g_man:
        lsr a
        lsr a
        lsr a
        cmp #32
        bcc g_idx
        lda #31
g_idx:
        tax
        lda GRAVTAB,x
        sta gval
        beq g_rts
        lda sgx
        beq g_yapp
        bmi g_subx
        clc
        ldy #o_vxl
        lda (objptr),y
        adc gval
        sta (objptr),y
        ldy #o_vxh
        lda (objptr),y
        adc #0
        sta (objptr),y
        bra g_yapp
g_subx:
        sec
        ldy #o_vxl
        lda (objptr),y
        sbc gval
        sta (objptr),y
        ldy #o_vxh
        lda (objptr),y
        sbc #0
        sta (objptr),y
g_yapp:
        lda sgy
        beq g_rts
        bmi g_suby
        clc
        ldy #o_vyl
        lda (objptr),y
        adc gval
        sta (objptr),y
        ldy #o_vyh
        lda (objptr),y
        adc #0
        sta (objptr),y
        rts
g_suby:
        sec
        ldy #o_vyl
        lda (objptr),y
        sbc gval
        sta (objptr),y
        ldy #o_vyh
        lda (objptr),y
        sbc #0
        sta (objptr),y
g_rts:
        rts

integ_one:
        clc
        ldy #o_xf
        lda (objptr),y
        ldy #o_vxl
        adc (objptr),y
        ldy #o_xf
        sta (objptr),y
        ldy #o_xl
        lda (objptr),y
        ldy #o_vxh
        adc (objptr),y
        ldy #o_xl
        sta (objptr),y
        php
        ldy #o_vxh
        lda (objptr),y
        bmi in_xneg
        lda #0
        bra in_xhi
in_xneg:
        lda #$FF
in_xhi:
        plp
        ldy #o_xh
        adc (objptr),y
        sta (objptr),y
        clc
        ldy #o_yf
        lda (objptr),y
        ldy #o_vyl
        adc (objptr),y
        ldy #o_yf
        sta (objptr),y
        ldy #o_yl
        lda (objptr),y
        ldy #o_vyh
        adc (objptr),y
        ldy #o_yl
        sta (objptr),y
        php
        ldy #o_vyh
        lda (objptr),y
        bmi in_yneg
        lda #0
        bra in_yhi
in_yneg:
        lda #$FF
in_yhi:
        plp
        ldy #o_yh
        adc (objptr),y
        sta (objptr),y
        rts

wrap_one:
        ldy #o_xh
        lda (objptr),y
        bmi wr_xneg
        bne wr_xhi
        bra wr_y
wr_xhi:
        ldy #o_xl
        lda (objptr),y
        cmp #24
        bcc wr_y
        sec
        sbc #24
        sta (objptr),y
        ldy #o_xh
        lda (objptr),y
        dec a
        sta (objptr),y
        bra wr_y
wr_xneg:
        clc
        ldy #o_xl
        lda (objptr),y
        adc #24
        sta (objptr),y
        ldy #o_xh
        lda (objptr),y
        adc #1
        sta (objptr),y
wr_y:
        ldy #o_yh
        lda (objptr),y
        bmi wr_yneg
        bne wr_yhi
        ldy #o_yl
        lda (objptr),y
        cmp #PFH
        bcc wr_rts
wr_yhi:
        sec
        ldy #o_yl
        lda (objptr),y
        sbc #PFH
        sta (objptr),y
        ldy #o_yh
        lda (objptr),y
        sbc #0
        sta (objptr),y
        rts
wr_yneg:
        clc
        ldy #o_yl
        lda (objptr),y
        adc #PFH
        sta (objptr),y
        ldy #o_yh
        lda (objptr),y
        adc #0
        sta (objptr),y
wr_rts:
        rts

clamp_one:
        ldy #o_vxh
        lda (objptr),y
        bmi cl_xn
        cmp #MAXV0
        bcc cl_y
        beq cl_y
        lda #MAXV0
        sta (objptr),y
        lda #0
        ldy #o_vxl
        sta (objptr),y
        bra cl_y
cl_xn:
        cmp #$FC
        bcs cl_y
        lda #$FC
        ldy #o_vxh
        sta (objptr),y
        lda #0
        ldy #o_vxl
        sta (objptr),y
cl_y:
        ldy #o_vyh
        lda (objptr),y
        bmi cl_yn
        cmp #MAXV0
        bcc cl_rts
        beq cl_rts
        lda #MAXV0
        sta (objptr),y
        lda #0
        ldy #o_vyl
        sta (objptr),y
        rts
cl_yn:
        cmp #$FC
        bcs cl_rts
        lda #$FC
        ldy #o_vyh
        sta (objptr),y
        lda #0
        ldy #o_vyl
        sta (objptr),y
cl_rts:
        rts

addvx:
        sta tmpa
        bpl ax_p
        clc
        ldy #o_vxl
        adc (objptr),y
        sta (objptr),y
        ldy #o_vxh
        lda (objptr),y
        adc #$FF
        sta (objptr),y
        rts
ax_p:
        clc
        ldy #o_vxl
        adc (objptr),y
        sta (objptr),y
        ldy #o_vxh
        lda (objptr),y
        adc #0
        sta (objptr),y
        rts

addvy:
        sta tmpa
        bpl ay_p
        clc
        ldy #o_vyl
        adc (objptr),y
        sta (objptr),y
        ldy #o_vyh
        lda (objptr),y
        adc #$FF
        sta (objptr),y
        rts
ay_p:
        clc
        ldy #o_vyl
        adc (objptr),y
        sta (objptr),y
        ldy #o_vyh
        lda (objptr),y
        adc #0
        sta (objptr),y
        rts

; ============================================================================
; shots / hyperspace / spawn / kill
; ============================================================================
tryfire:
        ldy #o_cool
        lda (objptr),y
        beq tf_ok
        rts
tf_ok:
        lda objptr
        sta save0
        lda objptr+1
        sta save1
        lda shipi
        asl a
        sta shoti
        jsr shot_free
        beq tf_use
        inc shoti
        jsr shot_free
        bne tf_restore
tf_use:
        lda #1
        ldy #b_act
        sta (objptr),y
        lda #0
        ldy #b_drawn
        sta (objptr),y
        lda #SHOTLIFE
        ldy #b_life
        sta (objptr),y
        lda shipi
        ldy #b_own
        sta (objptr),y
        ldy #o_ang
        lda (save0),y
        tax
        lda SHOTDX,x
        ldy #b_dx
        sta (objptr),y
        lda SHOTDY,x
        ldy #b_dy
        sta (objptr),y
        lda SHNX,x
        sta tmpa
        lda SHNY,x
        sta tmpb
        lda #0
        sta tmpc
        lda tmpa
        bpl tf_xp
        lda #$FF
        sta tmpc
tf_xp:
        clc
        ldy #o_xl
        lda (save0),y
        adc tmpa
        ldy #b_xl
        sta (objptr),y
        ldy #o_xh
        lda (save0),y
        adc tmpc
        ldy #b_xh
        sta (objptr),y
        clc
        ldy #o_yl
        lda (save0),y
        adc tmpb
        ldy #b_yl
        sta (objptr),y
        lda save0
        sta objptr
        lda save1
        sta objptr+1
        lda #FIRECD0
        ldy #o_cool
        sta (objptr),y
        lda SPEAKER
        rts
tf_restore:
        lda save0
        sta objptr
        lda save1
        sta objptr+1
        rts

shot_free:
        jsr set_shot
        ldy #b_act
        lda (objptr),y
        rts

do_hyper:
        jsr rand
        ldy #o_xl
        sta (objptr),y
        jsr rand
        and #1
        ldy #o_xh
        sta (objptr),y
        jsr rand
        and #127
        clc
        adc #16
        ldy #o_yl
        sta (objptr),y
        lda #0
        ldy #o_yh
        sta (objptr),y
        ldy #o_xf
        sta (objptr),y
        ldy #o_yf
        sta (objptr),y
        ldy #o_vxl
        sta (objptr),y
        ldy #o_vxh
        sta (objptr),y
        ldy #o_vyl
        sta (objptr),y
        ldy #o_vyh
        sta (objptr),y
        lda #INV0
        ldy #o_inv
        sta (objptr),y
        jsr wrap_one
        jsr sun_dist
        bcc hy_live
        jmp kill_ship
hy_live:
        lda SPEAKER
        rts

sun_dist:
        jsr grav_prep
        lda adx
        cmp #SUNHIT
        bcs sd_ok
        lda ady
        cmp #SUNHIT
        bcs sd_ok
        sec
        rts
sd_ok:
        clc
        rts

grav_prep:
        sec
        lda #<SUNX
        ldy #o_xl
        sbc (objptr),y
        sta dxlo
        lda #>SUNX
        ldy #o_xh
        sbc (objptr),y
        sta dxhi
        lda dxhi
        bmi gp_nx
        lda dxhi
        beq gp_xl
        lda #127
        sta adx
        bra gp_y
gp_xl:
        lda dxlo
        sta adx
        bra gp_y
gp_nx:
        sec
        lda #0
        sbc dxlo
        sta adx
        lda #0
        sbc dxhi
        beq gp_y
        lda #127
        sta adx
gp_y:
        sec
        lda #SUNY
        ldy #o_yl
        sbc (objptr),y
        sta tmpa
        bpl gp_py
        eor #$FF
        inc a
gp_py:
        sta ady
        rts

clear_shots:
        stz shoti
cs_l:
        jsr set_shot
        lda #0
        ldy #b_act
        sta (objptr),y
        ldy #b_drawn
        sta (objptr),y
        inc shoti
        lda shoti
        cmp #NSHOT
        bne cs_l
        rts

spawn_one:
        lda #1
        ldy #o_act
        sta (objptr),y
        lda #0
        ldy #o_xf
        sta (objptr),y
        ldy #o_yf
        sta (objptr),y
        ldy #o_vxl
        sta (objptr),y
        ldy #o_vxh
        sta (objptr),y
        ldy #o_vyl
        sta (objptr),y
        ldy #o_vyh
        sta (objptr),y
        ldy #o_xh
        sta (objptr),y
        ldy #o_yh
        sta (objptr),y
        ldy #o_drawn
        sta (objptr),y
        ldy #o_cool
        sta (objptr),y
        ldy #o_dead
        sta (objptr),y
        lda #INV0
        ldy #o_inv
        sta (objptr),y
        lda shipi
        bne so_p2
        lda #52
        ldy #o_xl
        sta (objptr),y
        lda #44
        ldy #o_yl
        sta (objptr),y
        lda #0
        ldy #o_ang
        sta (objptr),y
        rts
so_p2:
        lda #228
        ldy #o_xl
        sta (objptr),y
        lda #116
        ldy #o_yl
        sta (objptr),y
        lda #16
        ldy #o_ang
        sta (objptr),y
        rts

kill_ship:
        lda #0
        ldy #o_act
        sta (objptr),y
        lda #DEADWAIT
        ldy #o_dead
        sta (objptr),y
        lda SPEAKER
        lda noscore
        bne ks_rts
        lda gstate
        cmp #GS_PLAY
        bne ks_rts
        lda shipi
        bne ks_p1
        inc p2sc
        lda p2sc
        cmp #WINSC
        bcc ks_rts
        lda #1
        sta winner
        lda #GS_OVER
        sta gstate
        rts
ks_p1:
        inc p1sc
        lda p1sc
        cmp #WINSC
        bcc ks_rts
        stz winner
        lda #GS_OVER
        sta gstate
ks_rts:
        rts

respawn_dead:
        stz shipi
        jsr set_ship
        jsr rs_one
        lda #1
        sta shipi
        jsr set_ship
        jsr rs_one
        rts
rs_one:
        ldy #o_act
        lda (objptr),y
        bne rs_rts
        ldy #o_dead
        lda (objptr),y
        beq rs_rts
        dec a
        sta (objptr),y
        bne rs_rts
        jsr spawn_one
rs_rts:
        rts

move_all_shots:
        stz shoti
ms_l:
        jsr set_shot
        ldy #b_act
        lda (objptr),y
        beq ms_n
        jsr move_shot
ms_n:
        inc shoti
        lda shoti
        cmp #NSHOT
        bne ms_l
        rts

move_shot:
        ldy #b_dx
        lda (objptr),y
        sta tmpa
        bpl msx_p
        clc
        ldy #b_xl
        adc (objptr),y
        sta (objptr),y
        ldy #b_xh
        lda (objptr),y
        adc #$FF
        sta (objptr),y
        bra msy
msx_p:
        clc
        ldy #b_xl
        adc (objptr),y
        sta (objptr),y
        ldy #b_xh
        lda (objptr),y
        adc #0
        sta (objptr),y
msy:
        clc
        ldy #b_yl
        lda (objptr),y
        ldy #b_dy
        adc (objptr),y
        cmp #PFH
        bcc msy_ok
        cmp #208
        bcc msy_hi
        clc
        adc #PFH
        bra msy_ok
msy_hi:
        sec
        sbc #PFH
msy_ok:
        ldy #b_yl
        sta (objptr),y
        jsr wrap_shot_x
        ldy #b_life
        lda (objptr),y
        dec a
        sta (objptr),y
        bne ms_live
        lda #0
        ldy #b_act
        sta (objptr),y
ms_live:
        rts

wrap_shot_x:
        ldy #b_xh
        lda (objptr),y
        bmi ws_neg
        bne ws_hi
        rts
ws_hi:
        ldy #b_xl
        lda (objptr),y
        cmp #24
        bcc ws_rts
        sec
        sbc #24
        sta (objptr),y
        ldy #b_xh
        lda #0
        sta (objptr),y
        rts
ws_neg:
        clc
        ldy #b_xl
        lda (objptr),y
        adc #24
        sta (objptr),y
        ldy #b_xh
        lda #1
        sta (objptr),y
ws_rts:
        rts

; ============================================================================
; collisions
; ============================================================================
collide_all:
        jsr shots_vs_world
        jsr ships_vs_ships
        rts

shots_vs_world:
        stz shoti
sv_l:
        jsr set_shot
        ldy #b_act
        lda (objptr),y
        beq sv_n
        jsr shot_hits
sv_n:
        inc shoti
        lda shoti
        cmp #NSHOT
        bne sv_l
        rts

shot_hits:
        ldy #b_xl
        lda (objptr),y
        sta hpx
        ldy #b_xh
        lda (objptr),y
        sta hpxh
        ldy #b_yl
        lda (objptr),y
        sta hpy
        lda #<SUNX
        sta hcx
        lda #>SUNX
        sta hcxh
        lda #SUNY
        sta hcy
        lda #SUNHIT
        sta hrad
        jsr chtest
        bcc sh_ships
        lda #0
        ldy #b_act
        sta (objptr),y
        rts
sh_ships:
        lda objptr
        sta save0
        lda objptr+1
        sta save1
        ldy #b_own
        lda (objptr),y
        sta tmpb
        stz shipi
        jsr sh_vs_ship
        lda #1
        sta shipi
        jsr sh_vs_ship
        lda save0
        sta objptr
        lda save1
        sta objptr+1
        rts

sh_vs_ship:
        lda shipi
        cmp tmpb
        beq svs_rts
        jsr set_ship
        ldy #o_act
        lda (objptr),y
        beq svs_rts
        ldy #o_inv
        lda (objptr),y
        bne svs_rts
        ldy #o_xl
        lda (objptr),y
        sta hcx
        ldy #o_xh
        lda (objptr),y
        sta hcxh
        ldy #o_yl
        lda (objptr),y
        sta hcy
        lda #SHOTHIT
        sta hrad
        jsr chtest
        bcc svs_rts
        jsr kill_ship
        lda save0
        sta objptr
        lda save1
        sta objptr+1
        lda #0
        ldy #b_act
        sta (objptr),y
svs_rts:
        rts

ships_vs_ships:
        lda SHIP0+o_act
        beq svv_rts
        lda SHIP1+o_act
        beq svv_rts
        lda SHIP0+o_inv
        bne svv_rts
        lda SHIP1+o_inv
        bne svv_rts
        lda SHIP0+o_xl
        sta hcx
        lda SHIP0+o_xh
        sta hcxh
        lda SHIP0+o_yl
        sta hcy
        lda SHIP1+o_xl
        sta hpx
        lda SHIP1+o_xh
        sta hpxh
        lda SHIP1+o_yl
        sta hpy
        lda #SHIPHIT
        sta hrad
        jsr chtest
        bcc svv_rts
        lda #1
        sta noscore
        stz shipi
        jsr set_ship
        jsr kill_ship
        lda #1
        sta shipi
        jsr set_ship
        jsr kill_ship
        stz noscore
svv_rts:
        rts

chtest:
        sec
        lda hcx
        sbc hpx
        sta cdx
        lda hcxh
        sbc hpxh
        beq ch_x8
        cmp #$FF
        bne ch_miss
        lda #0
        sec
        sbc cdx
        sta cdx
        bra ch_xcmp
ch_x8:
        lda cdx
        bpl ch_xcmp
        eor #$FF
        inc a
        sta cdx
ch_xcmp:
        lda cdx
        cmp hrad
        bcs ch_miss
        sec
        lda hcy
        sbc hpy
        bcs ch_ypos
        eor #$FF
        inc a
ch_ypos:
        cmp hrad
        bcs ch_miss
        sec
        rts
ch_miss:
        clc
        rts

; ============================================================================
; draw
; ============================================================================
erase_objs:
        stz plotor
        stz shipi
        jsr set_ship
        jsr erase_ship
        lda #1
        sta shipi
        jsr set_ship
        jsr erase_ship
        stz shoti
er_s:
        jsr set_shot
        jsr erase_shot
        inc shoti
        lda shoti
        cmp #NSHOT
        bne er_s
        rts

draw_objs:
        stz plotor
        stz shipi
        jsr set_ship
        jsr paint_ship
        lda #1
        sta shipi
        jsr set_ship
        jsr paint_ship
        stz shoti
dr_s:
        jsr set_shot
        jsr paint_shot
        inc shoti
        lda shoti
        cmp #NSHOT
        bne dr_s
        rts

erase_ship:
        ldy #o_drawn
        lda (objptr),y
        beq es_rts
        jsr render_ship
        lda #0
        ldy #o_drawn
        sta (objptr),y
es_rts:
        rts

paint_ship:
        ldy #o_act
        lda (objptr),y
        beq ps_rts
        jsr render_ship
        lda #1
        ldy #o_drawn
        sta (objptr),y
ps_rts:
        rts

erase_shot:
        ldy #b_drawn
        lda (objptr),y
        beq eq_rts
        jsr render_shot
        lda #0
        ldy #b_drawn
        sta (objptr),y
eq_rts:
        rts

paint_shot:
        ldy #b_act
        lda (objptr),y
        beq pq_rts
        jsr render_shot
        lda #1
        ldy #b_drawn
        sta (objptr),y
pq_rts:
        rts

render_shot:
        ldy #b_xl
        lda (objptr),y
        sta bx
        ldy #b_xh
        lda (objptr),y
        sta bxh
        ldy #b_yl
        lda (objptr),y
        sta by
        jmp plot_xy

render_ship:
        ldy #o_xl
        lda (objptr),y
        sta cenx
        ldy #o_xh
        lda (objptr),y
        sta cenh
        ldy #o_yl
        lda (objptr),y
        sta ceny
        ldy #o_ang
        lda (objptr),y
        sta tmpb
        tax
        lda SHNX,x
        sta lx0
        lda SHNY,x
        sta ly0
        lda SHLX,x
        sta lx1
        lda SHLY,x
        sta ly1
        jsr line8
        ldx tmpb
        lda SHNX,x
        sta lx0
        lda SHNY,x
        sta ly0
        lda SHRX,x
        sta lx1
        lda SHRY,x
        sta ly1
        jsr line8
        ldx tmpb
        lda SHLX,x
        sta lx0
        lda SHLY,x
        sta ly0
        lda SHRX,x
        sta lx1
        lda SHRY,x
        sta ly1
        jsr line8
        lda shipi
        bne rs_p2t
        lda p1t
        bne rs_ex
        rts
rs_p2t:
        lda p2t
        beq rsh_done
rs_ex:
        ldx tmpb
        lda SHNX,x
        eor #$FF
        inc a
        sta lx
        lda SHNY,x
        eor #$FF
        inc a
        sta ly
        jsr plot_off
rsh_done:
        rts

draw_sun:
        lda #<SUNX
        sta cenx
        lda #>SUNX
        sta cenh
        lda #SUNY
        sta ceny
        ldx #0
dsn_l:
        lda SUNOFF,x
        cmp #$80
        beq dsn_rts
        sta lx
        inx
        lda SUNOFF,x
        sta ly
        inx
        phx
        jsr plot_off
        plx
        bra dsn_l
dsn_rts:
        rts

draw_field:
        ldx #0
df_l:
        lda STARX,x
        sta bx
        lda STARXH,x
        sta bxh
        lda STARY,x
        sta by
        phx
        jsr plot_xy
        plx
        inx
        cpx #20
        bne df_l
        rts

; half-open 8-bit offset Bresenham (plots start, not end)
line8:
        lda lx0
        sta lx
        lda ly0
        sta ly
        sec
        lda lx1
        sbc lx0
        sta dx8
        lda #1
        sta sx8
        lda dx8
        bpl l8_dx
        lda #$FF
        sta sx8
        lda dx8
        eor #$FF
        inc a
        sta dx8
l8_dx:
        sec
        lda ly1
        sbc ly0
        sta dy8
        lda #1
        sta sy8
        lda dy8
        bpl l8_dy
        lda #$FF
        sta sy8
        lda dy8
        eor #$FF
        inc a
        sta dy8
l8_dy:
        sec
        lda dx8
        sbc dy8
        sta lerr
        lda #16
        sta lcnt
l8_loop:
        lda lx
        cmp lx1
        bne l8_go
        lda ly
        cmp ly1
        beq l8_done
l8_go:
        jsr plot_off
        jsr l8_step
        dec lcnt
        bne l8_loop
l8_done:
        rts

l8_step:
        lda lerr
        asl a
        sta e2
        clc
        adc dy8
        bmi l8_nox
        sec
        lda lerr
        sbc dy8
        sta lerr
        clc
        lda lx
        adc sx8
        sta lx
l8_nox:
        sec
        lda e2
        sbc dx8
        bpl l8_noy
        clc
        lda lerr
        adc dx8
        sta lerr
        clc
        lda ly
        adc sy8
        sta ly
l8_noy:
        rts

plot_off:
        lda lx
        bpl po_xp
        clc
        adc cenx
        sta bx
        lda cenh
        adc #$FF
        sta bxh
        bra po_y
po_xp:
        clc
        adc cenx
        sta bx
        lda cenh
        adc #0
        sta bxh
po_y:
        clc
        lda ceny
        adc ly
        sta by
        jmp plot_xy

plot_xy:
        lda bxh
        bmi px_skip
        cmp #2
        bcs px_skip
        cmp #1
        bne px_xok
        lda bx
        cmp #24
        bcs px_skip
px_xok:
        lda by
        cmp #PFH
        bcs px_skip
        jsr seedcol
        ldy by
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        ldx bitn
        lda BITMASK,x
        ldy col
        lda plotor
        bne px_or
        lda BITMASK,x
        eor (ptr),y
        sta (ptr),y
        rts
px_or:
        lda BITMASK,x
        ora (ptr),y
        sta (ptr),y
px_skip:
        rts

seedcol:
        stz col
        lda bx
        sta tt
        lda bxh
        sta tth
sc_loop:
        lda tth
        bne sc_sub
        lda tt
        cmp #7
        bcc sc_done
sc_sub:
        sec
        lda tt
        sbc #7
        sta tt
        lda tth
        sbc #0
        sta tth
        inc col
        bne sc_loop
sc_done:
        lda tt
        sta bitn
        rts

; ============================================================================
; objects helpers
; ============================================================================
set_ship:
        lda shipi
        asl a
        asl a
        asl a
        asl a
        clc
        adc #<SHIP0
        sta objptr
        lda #>SHIP0
        adc #0
        sta objptr+1
        rts

set_shot:
        lda shoti
        asl a
        asl a
        asl a
        asl a
        clc
        adc #<SHOTS
        sta objptr
        lda #>SHOTS
        adc #0
        sta objptr+1
        rts

rand:
        lsr seedh
        ror seed
        bcc rd_r
        lda seedh
        eor #$B4
        sta seedh
rd_r:
        lda seed
        rts

; ============================================================================
; HUD
; ============================================================================
hud_draw:
        jsr hud_clear
        lda #<TLINE20
        sta ptr
        lda #>TLINE20
        sta ptr+1
        lda #<HUD1
        sta objptr
        lda #>HUD1
        sta objptr+1
        jsr puts
        lda p1sc
        clc
        adc #$B0
        sta TLINE20+3
        lda p2sc
        clc
        adc #$B0
        sta TLINE20+38
        lda #<TLINE21
        sta ptr
        lda #>TLINE21
        sta ptr+1
        lda #<HUD2
        sta objptr
        lda #>HUD2
        sta objptr+1
        jsr puts
        lda #<TLINE22
        sta ptr
        lda #>TLINE22
        sta ptr+1
        lda gstate
        cmp #GS_OVER
        beq hd_over
        cmp #GS_PLAY
        beq hd_play
        lda #<HUDATT
        sta objptr
        lda #>HUDATT
        sta objptr+1
        jmp puts
hd_play:
        lda #<HUDPLAY
        sta objptr
        lda #>HUDPLAY
        sta objptr+1
        jmp puts
hd_over:
        lda winner
        bne hd_p2
        lda #<HUDO1
        sta objptr
        lda #>HUDO1
        sta objptr+1
        jmp puts
hd_p2:
        lda #<HUDO2
        sta objptr
        lda #>HUDO2
        sta objptr+1
        jmp puts

hud_clear:
        ldx #0
hc_r:
        lda HUDBL,x
        sta ptr
        lda HUDBH,x
        sta ptr+1
        lda #$A0
        ldy #39
hc_c:
        sta (ptr),y
        dey
        bpl hc_c
        inx
        cpx #4
        bne hc_r
        rts

puts:
        ldy #0
pt_l:
        lda (objptr),y
        beq pt_d
        ora #$80
        sta (ptr),y
        iny
        bne pt_l
pt_d:
        rts

; ============================================================================
; hi-res row table / clear
; ============================================================================
build_rows:
        ldx #0
br_loop:
        txa
        and #7
        asl a
        asl a
        clc
        adc #$20
        sta tmpa
        txa
        lsr a
        lsr a
        lsr a
        and #7
        sta tmpb
        lsr a
        clc
        adc tmpa
        sta ROWH,x
        lda #0
        sta tmpa
        lda tmpb
        and #1
        beq br_nolo
        lda #$80
        sta tmpa
br_nolo:
        txa
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        beq br_lowdone
        tay
br_add28:
        lda tmpa
        clc
        adc #$28
        sta tmpa
        dey
        bne br_add28
br_lowdone:
        lda tmpa
        sta ROWL,x
        inx
        cpx #192
        bne br_loop
        rts

clear_screen:
        lda #$20
        sta ptr+1
        stz ptr
        lda #0
        tay
cl_page:
        sta (ptr),y
        iny
        bne cl_page
        inc ptr+1
        ldx ptr+1
        cpx #$40
        bne cl_page
        rts

; ============================================================================
; test hooks
; ============================================================================
build_brk:
        ldx #$FF
        txs
        jsr build_rows
        brk

clear_brk:
        ldx #$FF
        txs
        jsr clear_screen
        brk

plot_brk:
        ldx #$FF
        txs
        jsr plot_xy
        brk

init_brk:
        ldx #$FF
        txs
        jsr video_init
        jsr game_init
        lda #1
        sta fastmd
        brk

grav_brk:
        ldx #$FF
        txs
        stz shipi
        jsr set_ship
        jsr grav_one
        brk

step_brk:
        ldx #$FF
        txs
        jsr phys_all
        brk

frame_brk:
        ldx #$FF
        txs
        lda #1
        sta fastmd
        jsr game_frame
        brk

fire_brk:
        ldx #$FF
        txs
        stz shipi
        jsr set_ship
        jsr tryfire
        brk

wrap_brk:
        ldx #$FF
        txs
        stz shipi
        jsr set_ship
        jsr wrap_one
        brk

hit_brk:
        ldx #$FF
        txs
        jsr collide_all
        brk

input_brk:
        ldx #$FF
        txs
        jsr decay_holds
        jsr clear_intent
        jsr scan_keys
        jsr scan_pads
        jsr merge_holds
        brk

thrust_brk:
        ldx #$FF
        txs
        stz shipi
        jsr set_ship
        stz p1l
        stz p1r
        lda #1
        sta p1t
        stz p1f
        stz p1h
        jsr apply_one
        brk

; ============================================================================
; tables
; ============================================================================
BITMASK:
        .byte $01,$02,$04,$08,$10,$20,$40

GRAVTAB:
        .byte 48,32,24,16,12,10,8,6,5,4,3,3,2,2,1,1
        .byte 1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0

COSTAB:
        .byte $40,$3F,$3B,$35,$2D,$24,$18,$0C,$00,$F4,$E8,$DC,$D3,$CB,$C5,$C1
        .byte $C0,$C1,$C5,$CB,$D3,$DC,$E8,$F4,$00,$0C,$18,$24,$2D,$35,$3B,$3F
SINTAB:
        .byte $00,$0C,$18,$24,$2D,$35,$3B,$3F,$40,$3F,$3B,$35,$2D,$24,$18,$0C
        .byte $00,$F4,$E8,$DC,$D3,$CB,$C5,$C1,$C0,$C1,$C5,$CB,$D3,$DC,$E8,$F4
SHNX:
        .byte $05,$05,$05,$04,$04,$03,$02,$01,$00,$FF,$FE,$FD,$FC,$FC,$FB,$FB
        .byte $FB,$FB,$FB,$FC,$FC,$FD,$FE,$FF,$00,$01,$02,$03,$04,$04,$05,$05
SHNY:
        .byte $00,$01,$02,$03,$04,$04,$05,$05,$05,$05,$05,$04,$04,$03,$02,$01
        .byte $00,$FF,$FE,$FD,$FC,$FC,$FB,$FB,$FB,$FB,$FB,$FC,$FC,$FD,$FE,$FF
SHLX:
        .byte $FD,$FC,$FC,$FC,$FC,$FC,$FC,$FD,$FD,$FE,$FF,$00,$00,$01,$02,$03
        .byte $03,$04,$04,$04,$04,$04,$04,$03,$03,$02,$01,$00,$00,$FF,$FE,$FD
SHLY:
        .byte $03,$02,$01,$00,$00,$FF,$FE,$FD,$FD,$FC,$FC,$FC,$FC,$FC,$FC,$FD
        .byte $FD,$FE,$FF,$00,$00,$01,$02,$03,$03,$04,$04,$04,$04,$04,$04,$03
SHRX:
        .byte $FD,$FD,$FE,$FF,$00,$00,$01,$02,$03,$03,$04,$04,$04,$04,$04,$04
        .byte $03,$03,$02,$01,$00,$00,$FF,$FE,$FD,$FD,$FC,$FC,$FC,$FC,$FC,$FC
SHRY:
        .byte $FD,$FD,$FC,$FC,$FC,$FC,$FC,$FC,$FD,$FD,$FE,$FF,$00,$00,$01,$02
        .byte $03,$03,$04,$04,$04,$04,$04,$04,$03,$03,$02,$01,$00,$00,$FF,$FE
SHOTDX:
        .byte $04,$04,$04,$03,$03,$02,$02,$01,$00,$FF,$FE,$FE,$FD,$FD,$FC,$FC
        .byte $FC,$FC,$FC,$FD,$FD,$FE,$FE,$FF,$00,$01,$02,$02,$03,$03,$04,$04
SHOTDY:
        .byte $00,$01,$02,$02,$03,$03,$04,$04,$04,$04,$04,$03,$03,$02,$02,$01
        .byte $00,$FF,$FE,$FE,$FD,$FD,$FC,$FC,$FC,$FC,$FC,$FD,$FD,$FE,$FE,$FF

SUNOFF:
        .byte $00,$00,$01,$00,$FF,$00,$00,$01,$00,$FF
        .byte $02,$00,$FE,$00,$00,$02,$00,$FE
        .byte $01,$01,$FF,$01,$01,$FF,$FF,$FF
        .byte $03,$00,$FD,$00,$00,$03,$00,$FD
        .byte $02,$01,$FE,$01,$02,$FF,$FE,$FF
        .byte $80

STARX:
        .byte 20,60,100,180,220,4,30,90,200,250
        .byte 15,70,120,160,210,40,85,195,230,12
STARXH:
        .byte 0,0,0,0,0,1,0,0,0,0
        .byte 0,0,0,0,0,0,0,0,0,0
STARY:
        .byte 12,28,18,22,40,15,140,150,130,145
        .byte 50,60,10,148,70,100,120,35,55,80

HUDBL:  .byte $50,$D0,$50,$D0
HUDBH:  .byte $06,$06,$07,$07

HUD1:   .byte "P1:0           STAR DUEL           P2:0",0
HUD2:   .byte "P1 WASD/PAD1    GRAVITY    P2 IJKL/PAD2",0
HUDATT: .byte "SPACE/START TO PLAY          Q QUITS",0
HUDPLAY:.byte "FIRST TO 5 WINS               Q QUITS",0
HUDO1:  .byte "P1 WINS - SPACE/START AGAIN   Q QUITS",0
HUDO2:  .byte "P2 WINS - SPACE/START AGAIN   Q QUITS",0
