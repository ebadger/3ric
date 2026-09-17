; ============================================================================
; PULSAR DUEL  -  two-player gravity dogfight for the 3ric  (65C02)
;
; An original 3RIC Studio take on the Spacewar! conventions that are free for
; anyone to use: two ships, one hungry star, inverse-square gravity, a wrapping
; playfield, thrust inertia, torpedoes and a hyperspace escape.  The artwork,
; naming, tuning, tables and 65C02 code here are all original.
;
; The star sits dead centre and pulls every ship AND every torpedo toward it
; with an inverse-square field, so shots curve.  Both ships start in a stable
; circular orbit; fly well and the well does half your aiming for you.
;
;   P1 keyboard : A / D turn, W thrust, S fire, X hyperspace
;   P2 keyboard : J / L turn, I thrust, K fire, M hyperspace
;                 (P2 may also use the arrow keys: left/right turn, up thrust)
;   SNES pad 1/2: D-pad left/right turn, Up or B thrust, A or Y fire,
;                 Select hyperspace, Start begins or restarts a match
;   Q or ESC     : quit to the monitor
;
; First pilot to 5 kills wins.
;
; Build / run:
;   BRUN PULSAR.PRG 0800
; ============================================================================

        .org $0800

; ---------------------------------------------------------------- hardware --
KBD      = $C000
KBDSTRB  = $C010
SPKR     = $C030
TXTCLR   = $C050
TXTSET   = $C051
MIXSET   = $C053
LOWSCR   = $C054
HIRESON  = $C057
PTRIG    = $C070
JOYMODE  = $CE15
GAMEPAD1 = $CEE0
GAMEPAD2 = $CEF0
MONHOME  = $FC58

; SNES button offsets inside the ROM's 16-byte pad tables
PAD_B    = 0
PAD_Y    = 1
PAD_SEL  = 2
PAD_STRT = 3
PAD_UP   = 4
PAD_DN   = 5
PAD_LF   = 6
PAD_RT   = 7
PAD_A    = 8

; ------------------------------------------------------------------- keys ---
KEY_A    = $C1
KEY_D    = $C4
KEY_W    = $D7
KEY_S    = $D3
KEY_X    = $D8
KEY_J    = $CA
KEY_L    = $CC
KEY_I    = $C9
KEY_K    = $CB
KEY_M    = $CD
KEY_Q    = $D1
KEY_ESC  = $9B
KEY_SPC  = $A0
KEY_RET  = $8D
KEY_LARR = $88
KEY_RARR = $95
KEY_UARR = $8B

; --------------------------------------------------- playfield / tunables ---
; Logical playfield is 256 x 160.  Logical x maps to hi-res column x+12 so the
; 280-pixel line is centred; logical y maps straight to scanlines 0..159, the
; graphics half of mixed mode.  Both axes wrap.
PFXOFF   = 12
PFHIGH   = 160
STARX    = 128                  ; pulsar centre, logical
STARY    = 80
RSTARK   = 10                   ; ship is vaporised inside this radius
RSHOTK   = 13                   ; torpedo is swallowed inside this radius
BOXHW    = 8                    ; torpedo/ship hit box half width
BOXHH    = 6                    ; torpedo/ship hit box half height
VELCAP   = 4                    ; |ship velocity| integer cap, px per frame
VELNEG   = $FC                  ; ... the same cap as a negative high byte
SHVCAP   = 6                    ; |torpedo velocity| integer cap
SHVNEG   = $FA
EXFRAM   = 8                    ; explosion ring lasts this many frames
HOLDFR   = 5                    ; frames a keyboard press stays "held"
CDFIRE   = 12                   ; frames between torpedoes
CDWARP   = 45                   ; frames between hyperspace jumps
TLIFE0   = 84                   ; torpedo lifetime in frames
WINSCR   = 5
RESPFR   = 45                   ; frames dead before respawning
INVFR    = 48                   ; frames of spawn protection
NSHOTS   = 6                    ; total torpedoes in flight
SHOTPP   = 3                    ; ... three per pilot
EXRMAX   = 16                   ; explosion ring stops here
GRAVMAX  = 176                  ; gravity table length
GSTITLE  = 0
GSPLAY   = 1
GSOVER   = 2

; text page 1 rows 20..23 (the four text lines of mixed mode)
HUDR0    = $0650
HUDR1    = $06D0
HUDR2    = $0750
HUDR3    = $07D0
SC1COL   = 11
SC2COL   = 33

; ---------------------------------------------------- zero page (scratch) ---
ptr      = $06
ptr2     = $08
zta      = $0A
ztb      = $0B
ztc      = $0C
ztd      = $0D
zte      = $0E
ztf      = $0F

; ============================================================================
; entry
; ============================================================================
start:
        jsr init_all
mloop:
        jsr do_frame
        lda quitf
        beq mloop
        jsr leave
        brk

leave:
        lda TXTSET
        lda LOWSCR
        jsr MONHOME
        rts

; ============================================================================
; one-time setup
; ============================================================================
init_all:
        stz quitf
        stz fastmd
        stz frcnt
        stz winner
        lda #$C7                ; any non-zero LFSR seed
        sta rngv
        lda #$5B
        sta rngv+1
        stz JOYMODE             ; ROM pad tables, not the analogue mouse mode
        jsr build_rows
        jsr build_cols
        jsr new_match
        stz gstate              ; GSTITLE
        jsr gfx_on
        jsr paint_field
        jsr hud_static
        lda #1
        sta hudirty
        jsr hud_draw
        rts

gfx_on:
        lda LOWSCR              ; hi-res page 1 ...
        lda HIRESON
        lda MIXSET              ; ... with four text rows underneath
        lda TXTCLR
        rts

; Build the 160 hi-res scanline base addresses:
;   base(y) = $2000 + (y&7)*$400 + ((y>>3)&7)*$80 + (y>>6)*40
build_rows:
        ldy #0
br_l:
        stz zta                 ; low byte
        tya
        and #7
        asl a
        asl a
        clc
        adc #$20
        sta ztb                 ; high byte = $20 + (y&7)*4
        tya
        lsr a
        lsr a
        lsr a
        and #7
        sta ztc
        lsr ztc                 ; ztc = v>>1, carry = v&1
        bcc br_nolo
        lda #$80
        sta zta
br_nolo:
        lda ztb
        clc
        adc ztc
        sta ztb
        tya                     ; + (y>>6)*40 -- never carries out of the low byte
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        tax
        lda zta
br_40:
        cpx #0
        beq br_40d
        clc
        adc #40
        dex
        bra br_40
br_40d:
        sta ROWL,y
        lda ztb
        sta ROWH,y
        iny
        cpy #PFHIGH
        bne br_l
        rts

; Build logical-x -> (byte offset, pixel mask).  Screen column is x+PFXOFF,
; seven pixels per byte, bit 0 leftmost, bit 7 is the colour-shift bit.
; PFXOFF is 12, so logical x=0 lands in byte 1 at pixel 5.
build_cols:
        ldx #0
        lda #1
        sta ztc                 ; starting byte offset  (12 / 7)
        lda #$20
        sta ztd                 ; starting pixel mask   (1 << (12 mod 7))
bc_l:
        lda ztc
        sta XBYTE,x
        lda ztd
        sta XMASK,x
        asl ztd
        lda ztd
        cmp #$80
        bne bc_n
        lda #1
        sta ztd
        inc ztc
bc_n:
        inx
        bne bc_l
        rts

; ============================================================================
; match / round setup
; ============================================================================
new_match:
        stz sscor
        stz sscor+1
        stz winner
        ; fall through
reset_round:
        ldx #NSHOTS-1
rr_shot:
        stz tlife,x
        stz tdrwn,x
        dex
        bpl rr_shot
        ldx #1
rr_ship:
        stz sexlf,x
        stz sexdr,x
        stz sdrwn,x
        stz srsp,x
        jsr spawn_ship
        dex
        bpl rr_ship
        lda #1
        sta hudirty
        rts

; Put ship X back on its starting arc.  Both pilots begin in orbit on opposite
; sides of the pulsar, 48 logical pixels out, running the same way round.
spawn_ship:
        lda SPAWNX,x
        sta sxi,x
        stz sxf,x
        lda SPAWNY,x
        sta syi,x
        stz syf,x
        lda SPAWNVL,x
        sta svyl,x
        lda SPAWNVH,x
        sta svyh,x
        stz svxl,x
        stz svxh,x
        lda SPAWNA,x
        sta sang,x
        lda #1
        sta salive,x
        stz scool,x
        stz swcool,x
        lda #INVFR
        sta sinvt,x
        stz srsp,x
        rts

; ============================================================================
; the frame
; ============================================================================
do_frame:
        inc frcnt
        jsr read_input
        lda quitf
        bne df_rts
        jsr erase_all
        jsr check_start
        jsr step_ships
        jsr step_shots
        jsr step_booms
        jsr draw_all
        jsr hud_draw
        jsr pace
df_rts:
        rts

check_start:
        lda gstate
        cmp #GSPLAY
        beq cs_rts
        lda wantst
        beq cs_rts
        stz wantst
        jsr new_match
        lda #GSPLAY
        sta gstate
        lda #1
        sta hudirty
cs_rts:
        rts

; Idle burn so the action runs at a steady pace on a 1.57 MHz 3ric.  A live
; frame measures about 8,600 cycles, and the budget is 26,224, so burn the
; remainder here.  Tests set fastmd to skip it.
pace:
        lda fastmd
        bne pc_rts
        ldx #$0D
pc_o:
        ldy #0
pc_i:
        dey
        bne pc_i
        dex
        bne pc_o
pc_rts:
        rts

; ============================================================================
; input: keyboard hold-timers merged with the ROM's SNES pad tables
; ============================================================================
read_input:
        jsr decay_holds
        jsr clear_intent
        jsr scan_keys
        lda PTRIG               ; ask the ROM to re-scan both pads
        jsr scan_pads
        jsr merge_holds
        rts

decay_holds:
        ldx #9
dh_l:
        lda hpl,x
        beq dh_n
        dec hpl,x
dh_n:
        dex
        bpl dh_l
        rts

clear_intent:
        ldx #9
ci_l:
        stz ipl,x
        dex
        bpl ci_l
        rts

merge_holds:
        ldx #9
mh_l:
        lda hpl,x
        beq mh_n
        lda #1
        sta ipl,x
mh_n:
        dex
        bpl mh_l
        rts

; The machine latches one key at a time, so every recognised press arms a
; short hold timer; merge_holds turns those timers back into held intents.
scan_keys:
        lda KBD
        bpl sk_rts
        sta keych
        lda KBDSTRB
        lda keych
        cmp #KEY_Q
        beq sk_quit
        cmp #KEY_ESC
        beq sk_quit
        cmp #KEY_SPC
        beq sk_start
        cmp #KEY_RET
        beq sk_start
        ldx #0                  ; player 1 keys
        cmp #KEY_A
        beq sk_left
        cmp #KEY_D
        beq sk_right
        cmp #KEY_W
        beq sk_thr
        cmp #KEY_S
        beq sk_fire
        cmp #KEY_X
        beq sk_warp
        ldx #1                  ; player 2 keys
        cmp #KEY_J
        beq sk_left
        cmp #KEY_LARR
        beq sk_left
        cmp #KEY_L
        beq sk_right
        cmp #KEY_RARR
        beq sk_right
        cmp #KEY_I
        beq sk_thr
        cmp #KEY_UARR
        beq sk_thr
        cmp #KEY_K
        beq sk_fire
        cmp #KEY_M
        beq sk_warp
sk_rts:
        rts
sk_quit:
        lda #1
        sta quitf
        rts
sk_start:
        lda gstate
        cmp #GSPLAY
        beq sk_sp_fire
        lda #1
        sta wantst
        rts
sk_sp_fire:
        ldx #0
sk_fire:
        lda #HOLDFR
        sta hpf,x
        rts
sk_left:
        lda #HOLDFR
        sta hpl,x
        rts
sk_right:
        lda #HOLDFR
        sta hpr,x
        rts
sk_thr:
        lda #HOLDFR
        sta hpt,x
        rts
sk_warp:
        lda #HOLDFR
        sta hph,x
        rts

; Pads report a live held state, so they feed the intents directly.
scan_pads:
        ldx #0
        lda #<GAMEPAD1
        sta ptr2
        lda #>GAMEPAD1
        sta ptr2+1
        jsr scan_one_pad
        ldx #1
        lda #<GAMEPAD2
        sta ptr2
        lda #>GAMEPAD2
        sta ptr2+1
        jsr scan_one_pad
        rts

; X = player index, ptr2 -> that player's 16-byte pad table
scan_one_pad:
        ldy #PAD_LF             ; an impossible left+right is ignored outright
        lda (ptr2),y
        ldy #PAD_RT
        and (ptr2),y
        bne sop_nodir
        ldy #PAD_LF
        lda (ptr2),y
        beq sop_r
        lda #1
        sta ipl,x
sop_r:
        ldy #PAD_RT
        lda (ptr2),y
        beq sop_nodir
        lda #1
        sta ipr,x
sop_nodir:
        ldy #PAD_UP
        lda (ptr2),y
        ldy #PAD_B
        ora (ptr2),y
        beq sop_f
        lda #1
        sta ipt,x
sop_f:
        ldy #PAD_A
        lda (ptr2),y
        ldy #PAD_Y
        ora (ptr2),y
        beq sop_h
        lda #1
        sta ipf,x
sop_h:
        ldy #PAD_SEL
        lda (ptr2),y
        beq sop_s
        lda #1
        sta iph,x
sop_s:
        ldy #PAD_STRT
        lda (ptr2),y
        beq sop_rts
        lda #1
        sta wantst
sop_rts:
        rts

; ============================================================================
; ship simulation
; ============================================================================
step_ships:
        ldx #1
ss_l:
        stx curobj
        jsr ship_one
        ldx curobj
        dex
        bpl ss_l
        rts

ship_one:                       ; X = ship index
        lda salive,x
        bne so_alive
        lda srsp,x              ; dead: tick the respawn clock
        beq so_rts
        dec srsp,x
        bne so_rts
        jsr spawn_ship
so_rts:
        rts
so_alive:
        lda scool,x
        beq so_c1
        dec scool,x
so_c1:
        lda swcool,x
        beq so_c2
        dec swcool,x
so_c2:
        lda sinvt,x
        beq so_c3
        dec sinvt,x
so_c3:
        jsr ship_turn
        ldx curobj
        jsr ship_thrust
        ldx curobj
        jsr ship_grav
        ldx curobj
        jsr ship_move
        ldx curobj
        jsr ship_fire
        ldx curobj
        jsr ship_warp
        ldx curobj
        lda salive,x
        beq so_rts2
        jsr ship_star
so_rts2:
        rts

; One 1/32 turn every other frame: a full revolution in about a second.
ship_turn:
        lda frcnt
        and #1
        bne st_rts
        lda ipl,x
        beq st_r
        lda sang,x
        dec a
        and #31
        sta sang,x
        rts
st_r:
        lda ipr,x
        beq st_rts
        lda sang,x
        inc a
        and #31
        sta sang,x
st_rts:
        rts

; Thrust adds cos/sin scaled by 1/4 of the unit table: 16/256 = 0.0625 px per
; frame per frame along the current heading.
ship_thrust:
        lda ipt,x
        beq th_rts
        ldy sang,x
        lda UCOS,y
        cmp #$80                ; sign-preserving >>2
        ror a
        cmp #$80
        ror a
        jsr add_vx
        ldy sang,x
        lda USIN,y
        cmp #$80
        ror a
        cmp #$80
        ror a
        jsr add_vy
th_rts:
        rts

; A = signed 8-bit delta, X = ship index
add_vx:
        ldy #0
        cmp #0
        bpl avx_p
        ldy #$ff
avx_p:
        sty ztb
        clc
        adc svxl,x
        sta svxl,x
        lda ztb
        adc svxh,x
        sta svxh,x
        rts
add_vy:
        ldy #0
        cmp #0
        bpl avy_p
        ldy #$ff
avy_p:
        sty ztb
        clc
        adc svyl,x
        sta svyl,x
        lda ztb
        adc svyh,x
        sta svyh,x
        rts

ship_grav:
        lda sxi,x
        sta gpx
        lda syi,x
        sta gpy
        jsr gravcalc
        ldx curobj
        clc
        lda svxl,x
        adc gaxl
        sta svxl,x
        lda svxh,x
        adc gaxh
        sta svxh,x
        clc
        lda svyl,x
        adc gayl
        sta svyl,x
        lda svyh,x
        adc gayh
        sta svyh,x
        rts

ship_move:
        jsr clamp_ship_vel
        clc
        lda sxf,x
        adc svxl,x
        sta sxf,x
        lda sxi,x
        adc svxh,x
        sta sxi,x               ; x wraps mod 256 for free
        clc
        lda syf,x
        adc svyl,x
        sta syf,x
        lda syi,x
        adc svyh,x
        jsr wrapy
        sta syi,x
        rts

; A = raw y byte -> folded back into 0..159
wrapy:
        cmp #PFHIGH
        bcc wy_d
        cmp #240
        bcs wy_n
        sec
        sbc #PFHIGH
        rts
wy_n:
        clc
        adc #PFHIGH
wy_d:
        rts

clamp_ship_vel:
        lda svxh,x
        bmi cv_xn
        cmp #VELCAP
        bcc cv_y
        lda #VELCAP-1
        sta svxh,x
        lda #$ff
        sta svxl,x
        bra cv_y
cv_xn:
        cmp #VELNEG
        bcs cv_y
        lda #VELNEG
        sta svxh,x
        stz svxl,x
cv_y:
        lda svyh,x
        bmi cv_yn
        cmp #VELCAP
        bcc cv_d
        lda #VELCAP-1
        sta svyh,x
        lda #$ff
        sta svyl,x
        bra cv_d
cv_yn:
        cmp #VELNEG
        bcs cv_d
        lda #VELNEG
        sta svyh,x
        stz svyl,x
cv_d:
        rts

ship_star:
        lda sxi,x
        sta gpx
        lda syi,x
        sta gpy
        jsr distcalc
        ldx curobj
        lda rdist
        cmp #RSTARK
        bcs sst_rts
        jsr kill_ship
sst_rts:
        rts

ship_fire:
        lda ipf,x
        beq sf_rts
        lda scool,x
        bne sf_rts
        jsr spawn_shot
sf_rts:
        rts

; Hyperspace: instant relocation, dead stop, a sliver of protection -- and a
; one-in-eight chance the hull does not survive the jump.
ship_warp:
        lda iph,x
        beq sw_rts
        lda swcool,x
        bne sw_rts
        lda #CDWARP
        sta swcool,x
        jsr rngnext
        ldx curobj
        sta sxi,x
        stz sxf,x
        jsr rngnext
        and #127
        clc
        adc #16
        ldx curobj
        sta syi,x
        stz syf,x
        stz svxl,x
        stz svxh,x
        stz svyl,x
        stz svyh,x
        lda #12
        sta sinvt,x
        jsr rngnext
        and #7
        ldx curobj
        cmp #1
        beq sw_bad
        jsr warp_sound
        rts
sw_bad:
        ldx curobj
        jsr kill_ship
sw_rts:
        rts

; X = victim.  The other pilot takes the point -- including for own goals.
kill_ship:
        stz salive,x
        lda #RESPFR
        sta srsp,x
        lda sxi,x
        sta sexpx,x
        lda syi,x
        sta sexpy,x
        lda #EXFRAM
        sta sexlf,x
        lda #3
        sta sexrd,x
        jsr boom_sound
        ldx curobj
        lda gstate
        cmp #GSPLAY
        bne ks_rts
        txa
        eor #1
        tay
        lda sscor,y
        inc a
        sta sscor,y
        lda #1
        sta hudirty
        lda sscor,y
        cmp #WINSCR
        bcc ks_rts
        sty winner
        lda #GSOVER
        sta gstate
ks_rts:
        rts

; ============================================================================
; torpedoes
; ============================================================================
; X = firing player.  Each pilot may keep SHOTPP torpedoes in flight.
spawn_shot:
        lda #0
        cpx #0
        beq sp_b0
        lda #SHOTPP
sp_b0:
        sta zta
        clc
        adc #SHOTPP
        sta ztb
        ldy zta
sp_find:
        lda tlife,y
        beq sp_got
        iny
        cpy ztb
        bne sp_find
        rts
sp_got:
        sty slot
        lda #CDFIRE
        sta scool,x
        ldy sang,x              ; leaves from the nose vertex
        lda SHX0,y
        clc
        adc sxi,x
        sta shpx
        lda SHY0,y
        clc
        adc syi,x
        jsr wrapy
        sta shpy
        ldx curobj
        ldy sang,x              ; muzzle velocity = 2 px/frame, plus the ship's
        lda UCOS,y
        sta shvxl
        stz shvxh
        bpl sp_vxp
        lda #$ff
        sta shvxh
sp_vxp:
        asl shvxl
        rol shvxh
        asl shvxl
        rol shvxh
        asl shvxl
        rol shvxh
        clc
        lda shvxl
        adc svxl,x
        sta shvxl
        lda shvxh
        adc svxh,x
        sta shvxh
        ldy sang,x
        lda USIN,y
        sta shvyl
        stz shvyh
        bpl sp_vyp
        lda #$ff
        sta shvyh
sp_vyp:
        asl shvyl
        rol shvyh
        asl shvyl
        rol shvyh
        asl shvyl
        rol shvyh
        clc
        lda shvyl
        adc svyl,x
        sta shvyl
        lda shvyh
        adc svyh,x
        sta shvyh
        ldy slot
        lda #0
        sta txf,y
        sta tyf,y
        sta tdrwn,y
        lda shpx
        sta txi,y
        lda shpy
        sta tyi,y
        lda shvxl
        sta tvxl,y
        lda shvxh
        sta tvxh,y
        lda shvyl
        sta tvyl,y
        lda shvyh
        sta tvyh,y
        lda #TLIFE0
        sta tlife,y
        jsr fire_sound
        rts

step_shots:
        ldx #NSHOTS-1
sh_l:
        stx shidx
        lda tlife,x
        beq sh_n
        jsr shot_one
sh_n:
        ldx shidx
        dex
        bpl sh_l
        rts

shot_one:                       ; X = torpedo index
        dec tlife,x
        lda txi,x               ; torpedoes fall into the well too
        sta gpx
        lda tyi,x
        sta gpy
        jsr gravcalc
        ldx shidx
        clc
        lda tvxl,x
        adc gaxl
        sta tvxl,x
        lda tvxh,x
        adc gaxh
        sta tvxh,x
        clc
        lda tvyl,x
        adc gayl
        sta tvyl,x
        lda tvyh,x
        adc gayh
        sta tvyh,x
        jsr clamp_shot_vel
        clc
        lda txf,x
        adc tvxl,x
        sta txf,x
        lda txi,x
        adc tvxh,x
        sta txi,x
        clc
        lda tyf,x
        adc tvyl,x
        sta tyf,x
        lda tyi,x
        adc tvyh,x
        jsr wrapy
        sta tyi,x
        lda txi,x
        sta gpx
        lda tyi,x
        sta gpy
        jsr distcalc
        ldx shidx
        lda rdist
        cmp #RSHOTK
        bcs sho_live
        stz tlife,x             ; swallowed by the pulsar
        rts
sho_live:
        jsr shot_hits
        rts

clamp_shot_vel:                 ; X = torpedo index
        lda tvxh,x
        bmi csv_xn
        cmp #SHVCAP
        bcc csv_y
        lda #SHVCAP-1
        sta tvxh,x
        lda #$ff
        sta tvxl,x
        bra csv_y
csv_xn:
        cmp #SHVNEG
        bcs csv_y
        lda #SHVNEG
        sta tvxh,x
        stz tvxl,x
csv_y:
        lda tvyh,x
        bmi csv_yn
        cmp #SHVCAP
        bcc csv_d
        lda #SHVCAP-1
        sta tvyh,x
        lda #$ff
        sta tvyl,x
        bra csv_d
csv_yn:
        cmp #SHVNEG
        bcs csv_d
        lda #SHVNEG
        sta tvyh,x
        stz tvyl,x
csv_d:
        rts

; X = torpedo index.  A torpedo is live ordnance for both hulls, so a badly
; curved shot can come back around and claim its own pilot.
shot_hits:
        ldy #1
shh_l:
        sty ztf
        lda salive,y
        beq shh_n
        lda sinvt,y
        bne shh_n
        lda txi,x
        sec
        sbc sxi,y
        bpl shh_xp
        eor #$ff
        inc a
shh_xp:
        cmp #BOXHW+1
        bcs shh_n
        lda tyi,x
        sec
        sbc syi,y
        bpl shh_yp
        eor #$ff
        inc a
shh_yp:
        cmp #81                 ; take the short way round the wrap
        bcc shh_y2
        sta zte
        lda #PFHIGH
        sec
        sbc zte
shh_y2:
        cmp #BOXHH+1
        bcs shh_n
        stz tlife,x
        ldx ztf
        stx curobj
        jsr kill_ship
        rts
shh_n:
        ldy ztf
        dey
        bpl shh_l
        rts

step_booms:
        ldx #1
sb_l:
        lda sexlf,x
        beq sb_n
        dec sexlf,x
        lda sexrd,x
        clc
        adc #2
        sta sexrd,x
sb_n:
        dex
        bpl sb_l
        rts

; ============================================================================
; gravity: a = G/r^2 toward the pulsar, as a table of G*65536/r^3 so that
;          accel_8.8 = (|component| * F[r]) >> 8 needs no divide.
; ============================================================================
; gpx/gpy -> gdx/gdy (signed deltas toward the star), adxv/adyv, rdist
distcalc:
        lda #STARX
        sec
        sbc gpx
        sta gdx
        bpl dc_xp
        eor #$ff
        inc a
dc_xp:
        sta adxv
        lda #STARY              ; the star sits on the vertical mid-line, so
        sec                     ; the direct delta is always the short one
        sbc gpy
        sta gdy
        bpl dc_yp
        eor #$ff
        inc a
dc_yp:
        sta adyv
        lda adxv
        cmp adyv
        bcs dc_xbig
        lda adyv
        sta rdist
        lda adxv
        lsr a
        clc
        adc rdist
        sta rdist
        bra dc_clamp
dc_xbig:
        sta rdist
        lda adyv
        lsr a
        clc
        adc rdist
        sta rdist
dc_clamp:
        lda rdist               ; octagonal norm: max + min/2
        cmp #GRAVMAX
        bcc dc_rts
        lda #GRAVMAX-1
        sta rdist
dc_rts:
        rts

gravcalc:
        jsr distcalc
        ldy rdist
        lda FGRVL,y
        sta mulm0
        lda FGRVH,y
        sta mulm1
        lda adxv
        sta mulb
        jsr mul8x16
        lda mres1
        sta gaxl
        lda mres2
        sta gaxh
        lda gdx
        bpl gc_xp
        sec
        lda #0
        sbc gaxl
        sta gaxl
        lda #0
        sbc gaxh
        sta gaxh
gc_xp:
        ldy rdist
        lda FGRVL,y
        sta mulm0
        lda FGRVH,y
        sta mulm1
        lda adyv
        sta mulb
        jsr mul8x16
        lda mres1
        sta gayl
        lda mres2
        sta gayh
        lda gdy
        bpl gc_yp
        sec
        lda #0
        sbc gayl
        sta gayl
        lda #0
        sbc gayh
        sta gayh
gc_yp:
        rts

; (mulm1:mulm0) * mulb -> mres2:mres1:mres0
mul8x16:
        stz mres0
        stz mres1
        stz mres2
        stz mulm2
        ldy #8
mul_l:
        lsr mulb
        bcc mul_s
        clc
        lda mres0
        adc mulm0
        sta mres0
        lda mres1
        adc mulm1
        sta mres1
        lda mres2
        adc mulm2
        sta mres2
mul_s:
        asl mulm0
        rol mulm1
        rol mulm2
        dey
        bne mul_l
        rts

; 16-bit Galois LFSR; returns the low byte in A
rngnext:
        lsr rngv+1
        ror rngv
        bcc rn_d
        lda rngv+1
        eor #$B4
        sta rngv+1
rn_d:
        lda rngv
        rts

; ============================================================================
; speaker
; ============================================================================
fire_sound:
        phx
        phy
        ldy #16
fs_l:
        lda SPKR
        ldx #10
fs_d:
        dex
        bne fs_d
        dey
        bne fs_l
        ply
        plx
        rts

boom_sound:
        phx
        phy
        ldy #40
bs_l:
        lda SPKR
        jsr rngnext
        and #31
        clc
        adc #6
        tax
bs_d:
        dex
        bne bs_d
        dey
        bne bs_l
        ply
        plx
        rts

warp_sound:
        phx
        phy
        ldx #30
ws_l:
        lda SPKR
        txa
        tay
ws_d:
        dey
        bne ws_d
        dex
        bne ws_l
        ply
        plx
        rts

; ============================================================================
; renderer -- everything moving is XOR'd on, so erasing is simply drawing the
; previous frame's geometry a second time.  The starfield and the pulsar are
; painted once and survive underneath.
; ============================================================================
; X = logical x (0..255), A = raw logical y (may be just outside 0..159)
plotxor:
        cmp #PFHIGH
        bcc pw_ok
        cmp #240
        bcs pw_neg
        sec
        sbc #PFHIGH
        bra pw_ok
pw_neg:
        clc
        adc #PFHIGH
pw_ok:
        tay
        lda ROWL,y
        clc
        adc XBYTE,x
        sta ptr
        lda ROWH,y
        adc #0
        sta ptr+1
        lda XMASK,x
        ldy #0
        eor (ptr),y
        sta (ptr),y
        rts

; Bresenham between (lx0,ly0) and (lx1,ly1).  Both axes are byte values, so a
; segment that steps across the wrap seam is drawn correctly on both sides.
drawline:
        lda lx1
        sec
        sbc lx0
        bpl dl_xp
        eor #$ff
        inc a
        sta ldxv
        lda #$ff
        sta lsx
        bra dl_y
dl_xp:
        sta ldxv
        lda #1
        sta lsx
dl_y:
        lda ly1
        sec
        sbc ly0
        bpl dl_yp
        eor #$ff
        inc a
        sta ldyv
        lda #$ff
        sta lsy
        bra dl_go
dl_yp:
        sta ldyv
        lda #1
        sta lsy
dl_go:
        lda ldyv
        eor #$ff
        inc a
        sta ldyn                ; ldyn = -|dy|
        lda ldxv
        clc
        adc ldyn
        sta lerr
        lda #48
        sta lcnt
dl_loop:
        ldx lx0
        lda ly0
        jsr plotxor
        lda lx0
        cmp lx1
        bne dl_step
        lda ly0
        cmp ly1
        beq dl_done
dl_step:
        lda lerr
        asl a
        sta le2
        sec
        sbc ldyn
        bmi dl_ystep
        lda lerr
        clc
        adc ldyn
        sta lerr
        lda lx0
        clc
        adc lsx
        sta lx0
dl_ystep:
        lda ldxv
        sec
        sbc le2
        bmi dl_next
        lda lerr
        clc
        adc ldxv
        sta lerr
        lda ly0
        clc
        adc lsy
        sta ly0
dl_next:
        dec lcnt
        bne dl_loop
dl_done:
        rts

; Draw the dart at (dsx,dsy) heading dsa, with the exhaust plume when dsth.
drawship:
        ldy dsa
        lda dsx
        clc
        adc SHX0,y
        sta vx0
        lda dsy
        clc
        adc SHY0,y
        sta vy0
        lda dsx
        clc
        adc SHX1,y
        sta vx1
        lda dsy
        clc
        adc SHY1,y
        sta vy1
        lda dsx
        clc
        adc SHX2,y
        sta vx2
        lda dsy
        clc
        adc SHY2,y
        sta vy2
        lda vx0
        sta lx0
        lda vy0
        sta ly0
        lda vx1
        sta lx1
        lda vy1
        sta ly1
        jsr drawline
        lda vx1
        sta lx0
        lda vy1
        sta ly0
        lda vx2
        sta lx1
        lda vy2
        sta ly1
        jsr drawline
        lda vx2
        sta lx0
        lda vy2
        sta ly0
        lda vx0
        sta lx1
        lda vy0
        sta ly1
        jsr drawline
        lda dsth
        beq ds_rts
        ldy dsa
        lda dsx
        clc
        adc SHX3,y
        sta lx0
        lda dsy
        clc
        adc SHY3,y
        sta ly0
        lda dsx
        clc
        adc SHX4,y
        sta lx1
        lda dsy
        clc
        adc SHY4,y
        sta ly1
        jsr drawline
ds_rts:
        rts

; X = compass index 0..7, rrad = radius, rcx/rcy = centre -> rpx/rpy
radpt:
        lda EXDXS,x
        beq rp_x0
        bmi rp_xn
        lda rcx
        clc
        adc rrad
        bra rp_xd
rp_xn:
        lda rcx
        sec
        sbc rrad
        bra rp_xd
rp_x0:
        lda rcx
rp_xd:
        sta rpx
        lda EXDYS,x
        beq rp_y0
        bmi rp_yn
        lda rcy
        clc
        adc rrad
        bra rp_yd
rp_yn:
        lda rcy
        sec
        sbc rrad
        bra rp_yd
rp_y0:
        lda rcy
rp_yd:
        sta rpy
        rts

draw_ring:
        ldx #7
dr_l:
        phx
        jsr radpt
        lda rpx
        sta ztc
        lda rpy
        sta ztd
        ldx ztc
        lda ztd
        jsr plotxor
        plx
        dex
        bpl dr_l
        rts

; ============================================================================
; static scenery
; ============================================================================
paint_field:
        jsr clear_page
        jsr draw_stars
        jsr draw_pulsar
        rts

clear_page:
        stz ptr
        lda #$20
        sta ptr+1
        ldx #32
        ldy #0
        lda #0
cp_l:
        sta (ptr),y
        iny
        bne cp_l
        inc ptr+1
        dex
        bne cp_l
        rts

draw_stars:
        ldy #48
dst_l:
        phy
        jsr rngnext
        sta ztc
        jsr rngnext
        cmp #PFHIGH
        bcc dst_y
        sec
        sbc #PFHIGH
dst_y:
        sta ztd
        lda ztc
        sta gpx
        lda ztd
        sta gpy
        jsr distcalc
        lda rdist
        cmp #26                 ; keep the glare around the pulsar clean
        bcc dst_n
        ldx ztc
        lda ztd
        jsr plotxor
dst_n:
        ply
        dey
        bne dst_l
        rts

draw_pulsar:
        lda #STARX
        sta rcx
        lda #STARY
        sta rcy
        lda #$FC                ; core rows, dy = -4 .. +4
        sta ztf
dp_row:
        lda ztf
        bpl dp_abs
        eor #$ff
        inc a
dp_abs:
        tay
        lda SUNW,y
        sta zte
        lda #STARX
        sec
        sbc zte
        sta ztc
        lda zte
        asl a
        sta ztd
        inc ztd
dp_col:
        ldx ztc
        lda #STARY
        clc
        adc ztf
        jsr plotxor
        inc ztc
        dec ztd
        bne dp_col
        inc ztf
        lda ztf
        cmp #5
        bne dp_row
        ldx #7                  ; eight flares
dp_sp:
        phx
        lda #7
        sta rrad
        jsr radpt
        lda rpx
        sta lx0
        lda rpy
        sta ly0
        plx
        phx
        lda #13
        sta rrad
        jsr radpt
        lda rpx
        sta lx1
        lda rpy
        sta ly1
        jsr drawline
        plx
        dex
        bpl dp_sp
        rts

; ============================================================================
; erase / draw passes
; ============================================================================
erase_all:
        ldx #1
ea_sl:
        stx curobj
        lda sdrwn,x
        beq ea_sn
        lda sodx,x
        sta dsx
        lda sody,x
        sta dsy
        lda soang,x
        sta dsa
        lda sothr,x
        sta dsth
        jsr drawship
        ldx curobj
        stz sdrwn,x
ea_sn:
        ldx curobj
        lda sexdr,x
        beq ea_en
        lda sexpx,x
        sta rcx
        lda sexpy,x
        sta rcy
        lda sexor,x
        sta rrad
        jsr draw_ring
        ldx curobj
        stz sexdr,x
ea_en:
        ldx curobj
        dex
        bpl ea_sl
        ldx #NSHOTS-1
ea_tl:
        stx shidx
        lda tdrwn,x
        beq ea_tn
        lda todx,x
        sta ztc
        lda tody,x
        sta ztd
        ldx ztc
        lda ztd
        jsr plotxor
        ldx shidx
        stz tdrwn,x
ea_tn:
        ldx shidx
        dex
        bpl ea_tl
        rts

draw_all:
        ldx #1
da_sl:
        stx curobj
        lda salive,x
        beq da_sn
        jsr ship_visible
        beq da_sn
        ldx curobj
        lda sxi,x
        sta dsx
        sta sodx,x
        lda syi,x
        sta dsy
        sta sody,x
        lda sang,x
        sta dsa
        sta soang,x
        lda ipt,x
        sta dsth
        sta sothr,x
        jsr drawship
        ldx curobj
        lda #1
        sta sdrwn,x
da_sn:
        ldx curobj
        lda sexlf,x
        beq da_en
        lda sexpx,x
        sta rcx
        lda sexpy,x
        sta rcy
        lda sexrd,x
        sta rrad
        sta sexor,x
        jsr draw_ring
        ldx curobj
        lda #1
        sta sexdr,x
da_en:
        ldx curobj
        dex
        bpl da_sl
        ldx #NSHOTS-1
da_tl:
        stx shidx
        lda tlife,x
        beq da_tn
        lda txi,x
        sta ztc
        sta todx,x
        lda tyi,x
        sta ztd
        sta tody,x
        ldx ztc
        lda ztd
        jsr plotxor
        ldx shidx
        lda #1
        sta tdrwn,x
da_tn:
        ldx shidx
        dex
        bpl da_tl
        rts

; X = ship index.  A fresh hull blinks while its spawn protection lasts.
ship_visible:
        lda sinvt,x
        beq sv_yes
        lda frcnt
        and #4
        rts
sv_yes:
        lda #1
        rts

; ============================================================================
; four-row text HUD under the graphics
; ============================================================================
hud_static:
        lda #<HUDR2
        sta ptr
        lda #>HUDR2
        sta ptr+1
        lda #<MSGKB
        sta ptr2
        lda #>MSGKB
        sta ptr2+1
        jsr putrow
        lda #<HUDR3
        sta ptr
        lda #>HUDR3
        sta ptr+1
        lda #<MSGPD
        sta ptr2
        lda #>MSGPD
        sta ptr2+1
        jsr putrow
        rts

putrow:
        ldy #39
pr_l:
        lda (ptr2),y
        ora #$80
        sta (ptr),y
        dey
        bpl pr_l
        rts

hud_draw:
        lda hudirty
        beq hd_rts
        stz hudirty
        lda #<HUDR0
        sta ptr
        lda #>HUDR0
        sta ptr+1
        lda #<MSGSC
        sta ptr2
        lda #>MSGSC
        sta ptr2+1
        jsr putrow
        lda sscor
        clc
        adc #$B0
        sta HUDR0+SC1COL
        lda sscor+1
        clc
        adc #$B0
        sta HUDR0+SC2COL
        lda #<HUDR1
        sta ptr
        lda #>HUDR1
        sta ptr+1
        lda gstate
        cmp #GSPLAY
        beq hd_play
        cmp #GSOVER
        beq hd_over
        lda #<MSGTIT
        sta ptr2
        lda #>MSGTIT
        sta ptr2+1
        bra hd_put
hd_play:
        lda #<MSGPLY
        sta ptr2
        lda #>MSGPLY
        sta ptr2+1
        bra hd_put
hd_over:
        lda winner
        bne hd_ov2
        lda #<MSGW1
        sta ptr2
        lda #>MSGW1
        sta ptr2+1
        bra hd_put
hd_ov2:
        lda #<MSGW2
        sta ptr2
        lda #>MSGW2
        sta ptr2+1
hd_put:
        jsr putrow
hd_rts:
        rts

; ============================================================================
; headless test hooks -- each performs one unit of work and returns to the
; monitor, so codegen/tools/pulsar.test.mjs can drive the engine directly.
; ============================================================================
hk_init:
        jsr init_all
        lda #1
        sta fastmd
        brk
hk_frame:
        jsr do_frame
        brk
hk_ships:
        jsr step_ships
        brk
hk_shots:
        jsr step_shots
        brk
hk_grav:
        jsr gravcalc
        brk
hk_dist:
        jsr distcalc
        brk
hk_draw:
        jsr draw_all
        brk
hk_erase:
        jsr erase_all
        brk
hk_input:
        jsr read_input
        brk
hk_pads:
        jsr clear_intent
        jsr scan_pads
        brk
hk_keys:
        jsr scan_keys
        brk
hk_merge:
        jsr clear_intent
        jsr merge_holds
        jsr decay_holds
        brk
hk_plot:
        ldx rpx
        lda rpy
        jsr plotxor
        brk
hk_line:
        jsr drawline
        brk
hk_kill:
        ldx curobj
        jsr kill_ship
        brk
hk_fire:
        ldx curobj
        jsr spawn_shot
        brk
hk_hud:
        lda #1
        sta hudirty
        jsr hud_draw
        ldy #39                 ; snapshot the score row before BRK's register
hh_c:                           ; dump lands on top of it
        lda HUDR0,y
        sta hudcpy,y
        dey
        bpl hh_c
        brk
hk_floop:                       ; free-run for a fixed cycle budget so a test
        jsr do_frame            ; can divide it by the frames actually served
        bra hk_floop
hk_nop:
        brk


; ============================================================================
; generated tables
; ============================================================================
UCOS:   ; round(64*cos(a*2pi/32))
        .byte $40,$3f,$3b,$35,$2d,$24,$18,$0c
        .byte $00,$f4,$e8,$dc,$d3,$cb,$c5,$c1
        .byte $c0,$c1,$c5,$cb,$d3,$dc,$e8,$f4
        .byte $00,$0c,$18,$24,$2d,$35,$3b,$3f
USIN:   ; round(64*sin(a*2pi/32))
        .byte $00,$0c,$18,$24,$2d,$35,$3b,$3f
        .byte $40,$3f,$3b,$35,$2d,$24,$18,$0c
        .byte $00,$f4,$e8,$dc,$d3,$cb,$c5,$c1
        .byte $c0,$c1,$c5,$cb,$d3,$dc,$e8,$f4
SHX0:   ; nose dx
        .byte $0a,$0a,$09,$08,$07,$06,$04,$02
        .byte $00,$fe,$fc,$fa,$f9,$f8,$f7,$f6
        .byte $f6,$f6,$f7,$f8,$f9,$fa,$fc,$fe
        .byte $00,$02,$04,$06,$07,$08,$09,$0a
SHY0:   ; nose dy
        .byte $00,$02,$04,$06,$07,$08,$09,$0a
        .byte $0a,$0a,$09,$08,$07,$06,$04,$02
        .byte $00,$fe,$fc,$fa,$f9,$f8,$f7,$f6
        .byte $f6,$f6,$f7,$f8,$f9,$fa,$fc,$fe
SHX1:   ; port wing dx
        .byte $f9,$fa,$fc,$fe,$ff,$01,$03,$05
        .byte $06,$07,$08,$09,$09,$09,$09,$08
        .byte $07,$06,$04,$02,$01,$ff,$fd,$fb
        .byte $fa,$f9,$f8,$f7,$f7,$f7,$f7,$f8
SHY1:   ; port wing dy
        .byte $fa,$f9,$f8,$f7,$f7,$f7,$f7,$f8
        .byte $f9,$fa,$fc,$fe,$ff,$01,$03,$05
        .byte $06,$07,$08,$09,$09,$09,$09,$08
        .byte $07,$06,$04,$02,$01,$ff,$fd,$fb
SHX2:   ; starboard wing dx
        .byte $f9,$f8,$f7,$f7,$f7,$f7,$f8,$f9
        .byte $fa,$fb,$fd,$ff,$01,$02,$04,$06
        .byte $07,$08,$09,$09,$09,$09,$08,$07
        .byte $06,$05,$03,$01,$ff,$fe,$fc,$fa
SHY2:   ; starboard wing dy
        .byte $06,$05,$03,$01,$ff,$fe,$fc,$fa
        .byte $f9,$f8,$f7,$f7,$f7,$f7,$f8,$f9
        .byte $fa,$fb,$fd,$ff,$01,$02,$04,$06
        .byte $07,$08,$09,$09,$09,$09,$08,$07
SHX3:   ; tail notch dx
        .byte $fa,$fa,$fa,$fb,$fc,$fd,$fe,$ff
        .byte $00,$01,$02,$03,$04,$05,$06,$06
        .byte $06,$06,$06,$05,$04,$03,$02,$01
        .byte $00,$ff,$fe,$fd,$fc,$fb,$fa,$fa
SHY3:   ; tail notch dy
        .byte $00,$ff,$fe,$fd,$fc,$fb,$fa,$fa
        .byte $fa,$fa,$fa,$fb,$fc,$fd,$fe,$ff
        .byte $00,$01,$02,$03,$04,$05,$06,$06
        .byte $06,$06,$06,$05,$04,$03,$02,$01
SHX4:   ; exhaust tip dx
        .byte $f3,$f3,$f4,$f5,$f7,$f9,$fb,$fd
        .byte $00,$03,$05,$07,$09,$0b,$0c,$0d
        .byte $0d,$0d,$0c,$0b,$09,$07,$05,$03
        .byte $00,$fd,$fb,$f9,$f7,$f5,$f4,$f3
SHY4:   ; exhaust tip dy
        .byte $00,$fd,$fb,$f9,$f7,$f5,$f4,$f3
        .byte $f3,$f3,$f4,$f5,$f7,$f9,$fb,$fd
        .byte $00,$03,$05,$07,$09,$0b,$0c,$0d
        .byte $0d,$0d,$0c,$0b,$09,$07,$05,$03
FGRVL:   ; G*65536/r^3 low byte
        .byte $f6,$f6,$f6,$f6,$f6,$f6,$f6,$f6
        .byte $f6,$f6,$f6,$c6,$b4,$a5,$ed,$23
        .byte $00,$56,$06,$f9,$1f,$6c,$d9,$5e
        .byte $f7,$9f,$55,$15,$de,$ae,$84,$60
        .byte $40,$24,$0b,$f5,$e1,$cf,$bf,$b1
        .byte $a4,$98,$8e,$84,$7b,$73,$6c,$65
        .byte $5f,$59,$54,$4f,$4b,$46,$43,$3f
        .byte $3c,$39,$36,$33,$31,$2e,$2c,$2a
        .byte $28,$26,$24,$23,$21,$20,$1f,$1d
        .byte $1c,$1b,$1a,$19,$18,$17,$16,$15
        .byte $14,$14,$13,$12,$12,$11,$10,$10
        .byte $0f,$0f,$0e,$0e,$0d,$0d,$0d,$0c
        .byte $0c,$0b,$0b,$0b,$0a,$0a,$0a,$0a
        .byte $09,$09,$09,$09,$08,$08,$08,$08
        .byte $07,$07,$07,$07,$07,$07,$06,$06
        .byte $06,$06,$06,$06,$05,$05,$05,$05
        .byte $05,$05,$05,$05,$05,$04,$04,$04
        .byte $04,$04,$04,$04,$04,$04,$04,$04
        .byte $04,$03,$03,$03,$03,$03,$03,$03
        .byte $03,$03,$03,$03,$03,$03,$03,$03
        .byte $03,$03,$02,$02,$02,$02,$02,$02
        .byte $02,$02,$02,$02,$02,$02,$02,$02
FGRVH:   ; G*65536/r^3 high byte
        .byte $28,$28,$28,$28,$28,$28,$28,$28
        .byte $28,$28,$28,$1e,$17,$12,$0e,$0c
        .byte $0a,$08,$07,$05,$05,$04,$03,$03
        .byte $02,$02,$02,$02,$01,$01,$01,$01
        .byte $01,$01,$01,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00
        .byte $00,$00,$00,$00,$00,$00,$00,$00


; --- round start: a stable orbit, one pilot on each side of the well ---
; r = 48 keeps the whole path clear of the wrap seam at y = 0/160, and 420 in
; 8.8 (1.64 px/frame) is the tangential speed that holds it there.
SPAWNX:  .byte 80,176
SPAWNY:  .byte 80,80
SPAWNVL: .byte $a4,$5c          ; +420 and -420 in 8.8
SPAWNVH: .byte $01,$fe
SPAWNA:  .byte 8,24             ; nose along the orbit

; --- pulsar core half-width per |dy| ---
SUNW:    .byte 4,4,4,3,2

; --- eight compass directions, as signs ---
EXDXS:   .byte 1,1,0,$ff,$ff,$ff,0,1
EXDYS:   .byte 0,1,1,1,0,$ff,$ff,$ff

; --- HUD rows, exactly 40 plain-ASCII characters each ---
MSGSC:   .text "  P1 SCORE 0            P2 SCORE 0      "
MSGTIT:  .text "     PULSAR DUEL - PRESS START OR S     "
MSGPLY:  .text "      FIRST TO 5 WINS THE DUEL          "
MSGW1:   .text "    PLAYER 1 WINS - PRESS START AGAIN   "
MSGW2:   .text "    PLAYER 2 WINS - PRESS START AGAIN   "
MSGKB:   .text "KEYS P1 A D W S X    P2 J L I K M       "
MSGPD:   .text "PAD DPAD TURN B THRUST A FIRE SEL WARP  "


; ============================================================================
; working RAM (part of the image; emitted as zeroes)
; ============================================================================
; --- per-ship arrays, indexed 0 = player one, 1 = player two ---
sxf:     .res 2          ; position x, fraction
sxi:     .res 2          ; position x, integer (logical, wraps mod 256)
syf:     .res 2
syi:     .res 2          ; position y, integer (logical 0..159)
svxl:    .res 2          ; velocity x, 8.8 signed
svxh:    .res 2
svyl:    .res 2
svyh:    .res 2
sang:    .res 2          ; heading, 0..31
salive:  .res 2
sdrwn:   .res 2          ; silhouette currently XOR'd onto the page
sodx:    .res 2          ; ... at this x
sody:    .res 2          ; ... this y
soang:   .res 2          ; ... this heading
sothr:   .res 2          ; ... with the exhaust plume
scool:   .res 2          ; torpedo cooldown
swcool:  .res 2          ; hyperspace cooldown
sinvt:   .res 2          ; spawn protection frames left
srsp:    .res 2          ; respawn countdown
sscor:   .res 2
sexlf:   .res 2          ; explosion frames left
sexrd:   .res 2          ; explosion ring radius
sexdr:   .res 2          ; explosion currently drawn
sexpx:   .res 2
sexpy:   .res 2
sexor:   .res 2          ; ... drawn at this radius

; --- per-torpedo arrays, 0..2 belong to P1, 3..5 to P2 ---
txf:     .res 6
txi:     .res 6
tyf:     .res 6
tyi:     .res 6
tvxl:    .res 6
tvxh:    .res 6
tvyl:    .res 6
tvyh:    .res 6
tlife:   .res 6
tdrwn:   .res 6
todx:    .res 6
tody:    .res 6

; --- input intents / hold timers, indexed by player ---
ipl:     .res 2
ipr:     .res 2
ipt:     .res 2
ipf:     .res 2
iph:     .res 2
hpl:     .res 2
hpr:     .res 2
hpt:     .res 2
hpf:     .res 2
hph:     .res 2

; --- game state ---
gstate:  .res 1
quitf:   .res 1
wantst:  .res 1          ; start / rematch requested
hudirty: .res 1
winner:  .res 1
frcnt:   .res 1
fastmd:  .res 1          ; 1 = skip the frame pacing delay (tests)
rngv:    .res 2
curobj:  .res 1          ; ship index of the ship currently being stepped
shidx:   .res 1          ; torpedo index of the torpedo currently being stepped
keych:   .res 1

; --- torpedo launch scratch ---
slot:    .res 1
shpx:    .res 1
shpy:    .res 1
shvxl:   .res 1
shvxh:   .res 1
shvyl:   .res 1
shvyh:   .res 1

; --- gravity / multiply scratch ---
gpx:     .res 1
gpy:     .res 1
gdx:     .res 1
gdy:     .res 1
adxv:    .res 1
adyv:    .res 1
rdist:   .res 1
gaxl:    .res 1
gaxh:    .res 1
gayl:    .res 1
gayh:    .res 1
mulm0:   .res 1
mulm1:   .res 1
mulm2:   .res 1
mulb:    .res 1
mres0:   .res 1
mres1:   .res 1
mres2:   .res 1

; --- renderer scratch ---
lx0:     .res 1
ly0:     .res 1
lx1:     .res 1
ly1:     .res 1
ldxv:    .res 1
ldyv:    .res 1
ldyn:    .res 1
lsx:     .res 1
lsy:     .res 1
lerr:    .res 1
le2:     .res 1
lcnt:    .res 1
dsx:     .res 1
dsy:     .res 1
dsa:     .res 1
dsth:    .res 1
vx0:     .res 1
vy0:     .res 1
vx1:     .res 1
vy1:     .res 1
vx2:     .res 1
vy2:     .res 1
rcx:     .res 1
rcy:     .res 1
rpx:     .res 1
rpy:     .res 1
rrad:    .res 1
hudcpy:  .res 40         ; test-visible copy of the score row

; --- generated lookup tables ---
ROWL:    .res 160        ; hi-res scanline base, low byte
ROWH:    .res 160        ; ... high byte
XBYTE:   .res 256        ; logical x -> byte offset within the scanline
XMASK:   .res 256        ; logical x -> pixel bit inside that byte
