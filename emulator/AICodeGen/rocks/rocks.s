; ============================================================================
; ROCK STORM  -  an original vector "asteroids-style" shooter for the 3ric
;               (65C02, Apple-II compatible)
;
; An original take on the classic rock-blasting genre: rotate a vector ship,
; thrust with inertia, fire shots, and blast drifting rocks that split into
; smaller rocks.  Everything wraps at the screen edges.  All polygon art, code
; and the name are original.
;
; Built up in tested milestones.  M1 lays the vector engine:
;   * mixed hi-res mode (280x160 vector playfield + 4 text rows of HUD)
;   * 192-entry hi-res row-address table   (ROWL/ROWH at $6000/$6100)
;   * XOR line draw (Bresenham) that tracks byte-col/bit incrementally (so
;     there is no per-pixel divide) and clips to the playfield
;   * draw_poly : XOR a closed ring of vertices  (ship + rocks share it)
;   * precomputed geometry (ship silhouette at 32 angles, headings, rocks)
;   * BRK test hooks for the headless harness
;
; Build / run:
;   BRUN ROCKS.PRG 0800      (loads the raw image to $0800 and jumps there)
; ============================================================================

; ---- soft switches (touched by reading them) ----
TXTCLR   = $C050        ; graphics (text off)
MIXSET   = $C053        ; mixed mode on  (bottom 4 rows are text = HUD)
LOWSCR   = $C054        ; display page 1
HIRES_SW = $C057        ; hi-res
KBD      = $C000        ; keyboard data (bit7 = key ready)
KBDSTRB  = $C010        ; clear keyboard strobe

; ---- memory map ----
SCREEN   = $2000        ; hi-res page 1 (displayed)   $2000-$3FFF
ROWL     = $6000        ; 192 bytes: low  byte of hi-res addr of pixel row y
ROWH     = $6100        ; 192 bytes: high byte of hi-res addr of pixel row y
STATE    = $6200        ; persistent game state (survives BRK monitor in tests)

; ---- playfield ----
WIDTH    = 280          ; vector playfield width  (pixels)
HEIGHT   = 160          ; vector playfield height (top 20 rows; rest is HUD)
NANG     = 32           ; ship rotation steps (11.25 deg each)

; ---- zero page ----
; ONLY the indirect pointers live in zero page (required for (zp),y).  Every
; other working var is ABSOLUTE RAM (VARS block below).  This is deliberate:
; the Apple II monitor owns zero page $20-$4F (text window/cursor $20-$25,
; BASL/BASH $28/$29, INVFLG $32, the COUT vector CSW $36/$37, the RDKEY vector
; KSW $38/$39, the BRK register-save $45-$49, ...).  If our scratch trampled
; those, returning to the monitor (our BRK test hooks, or a reset on real
; hardware) would jump COUT/RDKEY through a corrupted vector and hang.  The
; pointer pairs $06-$0D are in the classic free-scratch zone the monitor leaves
; alone.
ptr      = $06          ; screen dest pointer            (+1)
vpx      = $08          ; vertex X-offset table pointer  (+1)
vpy      = $0A          ; vertex Y-offset table pointer  (+1)
objptr   = $0C          ; current object base pointer    (+1)

; ---- engine working vars (absolute RAM, clear of monitor + tables) ----
; --- line() endpoints (16-bit signed) ---
x0       = $6A00
x0h      = $6A01
y0       = $6A02
y0h      = $6A03
x1       = $6A04
x1h      = $6A05
y1       = $6A06
y1h      = $6A07
; --- line() working state ---
dx       = $6A08
dxh      = $6A09
dy       = $6A0A
dyh      = $6A0B
lerr     = $6A0C
lerrh    = $6A0D
e2       = $6A0E
e2h      = $6A0F
s1       = $6A10
s1h      = $6A11
s2       = $6A12
s2h      = $6A13
sxs      = $6A14          ; x step sign (+1 / -1)
sys      = $6A15          ; y step sign
cx       = $6A16          ; current x (16-bit signed)
cxh      = $6A17
cy       = $6A18          ; current y (16-bit signed)
cyh      = $6A19
col      = $6A1A          ; current byte column (signed)
bitn     = $6A1B          ; current bit in byte (0..6)
tt       = $6A1C          ; div7 scratch (16-bit)
tth      = $6A1D
; --- draw_poly scratch ---
cenx     = $6A1E          ; polygon centre x (16-bit signed)
cenh     = $6A1F
ceny     = $6A20          ; polygon centre y (0..159)
fx       = $6A21          ; first vertex (to close the ring)
fxh      = $6A22
fy       = $6A23
fyh      = $6A24
pxv      = $6A25          ; previous vertex
pxvh     = $6A26
pyv      = $6A27
pyvh     = $6A28
vcount   = $6A29          ; vertices in this polygon
vi       = $6A2A          ; vertex loop index
tvx      = $6A2B          ; calc_vert output vertex (16-bit signed)
tvxh     = $6A2C
tvy      = $6A2D
tvyh     = $6A2E
tmpa     = $6A2F
tmpb     = $6A30
noend    = $6A31          ; 1 = half-open line (skip final endpoint pixel)

; ---- object structs (array-of-structs, stride OBJ_SIZE) ----
OBJ_SIZE = 16
SHIP     = $6300          ; 1 ship
BULLETS  = $6310          ; 5 bullets  ($6310..$635F)
ROCKS    = $6360          ; 28 rocks   ($6360..$651F)
NBULLET  = 5
NROCK    = 28
; struct field offsets
o_act    = 0              ; active flag
o_xf     = 1              ; x fraction (16.8 fixed)
o_xl     = 2              ; x integer low
o_xh     = 3              ; x integer high
o_yf     = 4              ; y fraction
o_yl     = 5              ; y integer low
o_yh     = 6              ; y integer high
o_vxl    = 7              ; vx 8.8 low (fraction)
o_vxh    = 8              ; vx 8.8 high (integer, signed)
o_vyl    = 9              ; vy 8.8 low
o_vyh    = 10             ; vy 8.8 high (signed)
o_ang    = 11             ; heading 0..31 (ship)
o_drawn  = 12             ; 1 = currently XOR-drawn on screen
o_life   = 13             ; bullet time-to-live / spare
o_kind   = 14             ; rock shape*3+size / spare

; ---- input intent hold-timers (frames remaining) + scratch ----
hleft    = $6A50
hright   = $6A51
hthr     = $6A52
hfire    = $6A53
keyin    = $6A54
firecd  = $6A55          ; frames until the next shot is allowed
blcnt    = $6A56          ; object-iteration loop counter
bx       = $6A57          ; plot_xy args: pixel x (16-bit) ...
bxh      = $6A58
by       = $6A59          ; ... pixel y (0..159)
seed     = $6A5A          ; 16-bit LFSR RNG state (+1)
rkcnt    = $6A5C          ; rocks alive (wave bookkeeping)
spcnt    = $6A5D          ; spawn loop counter
rksz     = $6A5E          ; spawn_rock: requested size, kept across rand calls

; ---- tunables ----
HOLD     = 4              ; frames an action stays live after its key event
MAXVI    = 4              ; max |velocity| integer part (px/frame)
ANGUP    = 24             ; heading that points up (-y)
DELAYO   = 20             ; frame-delay outer count (game pacing)
BULLET_LIFE = 60          ; frames a shot lives (~1 screen width @ 4.2 px/frame)
FIRE_CD  = 8              ; frames between shots (auto-fire cadence while held)
NDRIFT   = 16             ; rock drift-direction table size
SZLARGE  = 2              ; rock size index: 0 small, 1 med, 2 large
NSHAPE   = 3              ; rock silhouette variants
WAVE0    = 4              ; large rocks in the opening wave

; ---- key codes (Apple II: bit7 set = key ready) ----
K_A      = $C1
K_LARR   = $88
K_D      = $C4
K_RARR   = $95
K_W      = $D7
K_UARR   = $8B
K_SPACE  = $A0

        .org $0800

; ---------------------------------------------------------------------------
; entry (M1: draw a fan of ships at increasing angle to eyeball the engine)
; ---------------------------------------------------------------------------
; ---------------------------------------------------------------------------
; entry : the game.  BRUN ROCKS.PRG 0800.
; ---------------------------------------------------------------------------
start:
        sei
        cld
        ldx #$FF
        txs
        jsr game_init
sg_loop:
        jsr game_frame
        jsr frame_delay
        jmp sg_loop

; ---------------------------------------------------------------------------
; game_init : hi-res mixed mode, row table, clear, place the ship.
; ---------------------------------------------------------------------------
game_init:
        lda TXTCLR              ; graphics on
        lda MIXSET              ; mixed mode (text HUD at bottom)
        lda LOWSCR              ; page 1
        lda HIRES_SW            ; hi-res
        jsr build_rows
        jsr clear_screen
        jsr init_ship
        jsr clear_bullets
        jsr clear_rocks
        lda #$A5                ; nonzero LFSR seed (0 would lock the RNG)
        sta seed
        lda #$3C
        sta seed+1
        lda #0
        sta firecd
        jsr spawn_wave
        rts

; init_ship : place the ship at screen centre, at rest, pointing up.
init_ship:
        lda #1
        sta SHIP+o_act
        lda #0
        sta SHIP+o_xf
        sta SHIP+o_xh
        sta SHIP+o_yf
        sta SHIP+o_yh
        sta SHIP+o_vxl
        sta SHIP+o_vxh
        sta SHIP+o_vyl
        sta SHIP+o_vyh
        sta SHIP+o_drawn
        lda #140
        sta SHIP+o_xl
        lda #80
        sta SHIP+o_yl
        lda #ANGUP
        sta SHIP+o_ang
        lda #0
        sta hleft
        sta hright
        sta hthr
        sta hfire
        rts

; ---------------------------------------------------------------------------
; game_frame : advance one frame (erase, input, physics, redraw).
; ---------------------------------------------------------------------------
game_frame:
        jsr erase_ship
        jsr erase_bullets
        jsr erase_rocks
        jsr read_input
        jsr do_rotate
        jsr do_thrust
        jsr do_fire
        jsr integrate_ship
        jsr wrap_ship
        jsr update_bullets
        jsr update_rocks
        jsr draw_ship
        jsr draw_bullets
        jsr draw_rocks
        jsr decay_timers
        jsr dec_firecd
        rts

; render_ship : XOR the ship polygon at its current pos/angle.
render_ship:
        lda SHIP+o_xl
        sta cenx
        lda SHIP+o_xh
        sta cenh
        lda SHIP+o_yl
        sta ceny
        lda SHIP+o_ang
        jsr set_ship_vp
        jsr draw_poly
        rts

; erase_ship : XOR the ship off (only if it was drawn last frame).
erase_ship:
        lda SHIP+o_drawn
        beq er_ret
        jsr render_ship
er_ret:
        rts

; draw_ship : XOR the ship on and mark it drawn.
draw_ship:
        jsr render_ship
        lda #1
        sta SHIP+o_drawn
        rts

; ---------------------------------------------------------------------------
; read_input : poll the keyboard; refresh the matching intent hold-timer.
;   (Apple II reports one key at a time; the hold-timers + OS auto-repeat let
;    rapid key alternation feel like simultaneous rotate/thrust/fire.)
; ---------------------------------------------------------------------------
read_input:
        lda KBD
        bpl ri_ret              ; bit7 clear -> no key waiting
        sta keyin
        lda KBDSTRB             ; clear the strobe
        lda keyin
        cmp #K_A
        beq ri_left
        cmp #K_LARR
        beq ri_left
        cmp #K_D
        beq ri_right
        cmp #K_RARR
        beq ri_right
        cmp #K_W
        beq ri_thr
        cmp #K_UARR
        beq ri_thr
        cmp #K_SPACE
        beq ri_fire
        rts
ri_left:
        lda #HOLD
        sta hleft
        rts
ri_right:
        lda #HOLD
        sta hright
        rts
ri_thr:
        lda #HOLD
        sta hthr
        rts
ri_fire:
        lda #HOLD
        sta hfire
ri_ret:
        rts

; ---------------------------------------------------------------------------
; do_rotate : if a rotate intent is live, step the heading one notch.
; ---------------------------------------------------------------------------
do_rotate:
        lda hleft
        beq dr_r
        ldx SHIP+o_ang
        dex
        txa
        and #(NANG-1)
        sta SHIP+o_ang
dr_r:
        lda hright
        beq dr_ret
        ldx SHIP+o_ang
        inx
        txa
        and #(NANG-1)
        sta SHIP+o_ang
dr_ret:
        rts

; ---------------------------------------------------------------------------
; do_thrust : if thrust intent is live, add ACC[angle] (8.8) to velocity.
; ---------------------------------------------------------------------------
do_thrust:
        lda hthr
        beq dt_ret
        ldx SHIP+o_ang
        clc                     ; vx += sext(ACCX[ang]) as 8.8
        lda SHIP+o_vxl
        adc ACCX,x
        sta SHIP+o_vxl
        lda ACCX,x
        and #$80
        beq dt_xp
        lda #$FF
        bne dt_xa
dt_xp:
        lda #0
dt_xa:
        adc SHIP+o_vxh
        sta SHIP+o_vxh
        clc                     ; vy += sext(ACCY[ang])
        lda SHIP+o_vyl
        adc ACCY,x
        sta SHIP+o_vyl
        lda ACCY,x
        and #$80
        beq dt_yp
        lda #$FF
        bne dt_ya
dt_yp:
        lda #0
dt_ya:
        adc SHIP+o_vyh
        sta SHIP+o_vyh
        jsr cap_vel
dt_ret:
        rts

; cap_vel : clamp each velocity axis integer part to +/- MAXVI.
cap_vel:
        lda SHIP+o_vxh
        bmi cvx_neg
        cmp #(MAXVI+1)
        bcc cvx_ok
        lda #MAXVI
        sta SHIP+o_vxh
        lda #0
        sta SHIP+o_vxl
        jmp cvx_ok
cvx_neg:
        cmp #(256-MAXVI)
        bcs cvx_ok
        lda #(256-MAXVI)
        sta SHIP+o_vxh
        lda #0
        sta SHIP+o_vxl
cvx_ok:
        lda SHIP+o_vyh
        bmi cvy_neg
        cmp #(MAXVI+1)
        bcc cvy_ok
        lda #MAXVI
        sta SHIP+o_vyh
        lda #0
        sta SHIP+o_vyl
        jmp cvy_ok
cvy_neg:
        cmp #(256-MAXVI)
        bcs cvy_ok
        lda #(256-MAXVI)
        sta SHIP+o_vyh
        lda #0
        sta SHIP+o_vyl
cvy_ok:
        rts

; ---------------------------------------------------------------------------
; integrate_obj / wrap_obj : operate on the object pointed to by objptr, so the
; ship, bullets and rocks all share one copy of the physics.  integrate_ship /
; wrap_ship are thin wrappers that point objptr at the ship.
; ---------------------------------------------------------------------------
integrate_ship:
        lda #<SHIP
        sta objptr
        lda #>SHIP
        sta objptr+1
        jmp integrate_obj

wrap_ship:
        lda #<SHIP
        sta objptr
        lda #>SHIP
        sta objptr+1
        jmp wrap_obj

; integrate_obj : pos (16.8) += vel (8.8), with sign extension.  The fraction
; add's carry flows into the integer add (no CLC between), and the velocity's
; sign byte + that carry extend into the high byte.
integrate_obj:
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
        ldy #o_vxh
        lda (objptr),y
        and #$80
        beq io_xp
        lda #$FF
        bne io_xa
io_xp:
        lda #0
io_xa:
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
        ldy #o_vyh
        lda (objptr),y
        and #$80
        beq io_yp
        lda #$FF
        bne io_ya
io_yp:
        lda #0
io_ya:
        ldy #o_yh
        adc (objptr),y
        sta (objptr),y
        rts

; wrap_obj : centre-wrap x mod WIDTH (280), y mod HEIGHT (160).
wrap_obj:
        ldy #o_xh
        lda (objptr),y
        bpl wo_xpos
        clc                     ; x < 0 -> += WIDTH
        ldy #o_xl
        lda (objptr),y
        adc #<WIDTH
        sta (objptr),y
        ldy #o_xh
        lda (objptr),y
        adc #>WIDTH
        sta (objptr),y
        jmp wo_y
wo_xpos:
        cmp #>WIDTH
        bcc wo_y                ; xh < 1 -> x < 256 < WIDTH
        bne wo_xsub             ; xh > 1 -> x >= 512
        ldy #o_xl
        lda (objptr),y
        cmp #<WIDTH
        bcc wo_y                ; x < WIDTH
wo_xsub:
        sec                     ; x >= WIDTH -> -= WIDTH
        ldy #o_xl
        lda (objptr),y
        sbc #<WIDTH
        sta (objptr),y
        ldy #o_xh
        lda (objptr),y
        sbc #>WIDTH
        sta (objptr),y
wo_y:
        ldy #o_yh
        lda (objptr),y
        bpl wo_ypos
        clc                     ; y < 0 -> += HEIGHT
        ldy #o_yl
        lda (objptr),y
        adc #HEIGHT
        sta (objptr),y
        ldy #o_yh
        lda (objptr),y
        adc #0
        sta (objptr),y
        jmp wo_ret
wo_ypos:
        bne wo_ysub             ; yh > 0 -> y >= 256
        ldy #o_yl
        lda (objptr),y
        cmp #HEIGHT
        bcc wo_ret              ; y < HEIGHT
wo_ysub:
        sec                     ; y >= HEIGHT -> -= HEIGHT
        ldy #o_yl
        lda (objptr),y
        sbc #HEIGHT
        sta (objptr),y
        ldy #o_yh
        lda (objptr),y
        sbc #0
        sta (objptr),y
wo_ret:
        rts

; ===========================================================================
; M3 : bullets  (share the object struct; up to NBULLET on screen)
; ===========================================================================

; clear_bullets : deactivate every bullet slot.
clear_bullets:
        lda #<BULLETS
        sta objptr
        lda #>BULLETS
        sta objptr+1
        lda #NBULLET
        sta blcnt
clb_loop:
        lda #0
        ldy #o_act
        sta (objptr),y
        ldy #o_drawn
        sta (objptr),y
        jsr obj_next
        dec blcnt
        bne clb_loop
        rts

; obj_next : advance objptr by one struct (OBJ_SIZE).
obj_next:
        clc
        lda objptr
        adc #OBJ_SIZE
        sta objptr
        bcc on_ret
        inc objptr+1
on_ret:
        rts

; do_fire : if fire intent is live and the cooldown has expired, launch a shot.
do_fire:
        lda hfire
        beq df_ret
        lda firecd
        bne df_ret
        jsr fire_bullet
        lda #FIRE_CD
        sta firecd
df_ret:
        rts

; fire_bullet : find a free slot; spawn a shot at the nose, moving along the
; heading (fixed muzzle velocity BVX/BVY[ang]).
fire_bullet:
        lda #<BULLETS
        sta objptr
        lda #>BULLETS
        sta objptr+1
        lda #NBULLET
        sta blcnt
fb_find:
        ldy #o_act
        lda (objptr),y
        beq fb_free
        jsr obj_next
        dec blcnt
        bne fb_find
        rts                     ; no free slot -> no shot
fb_free:
        ldx SHIP+o_ang
        ; x position = ship x + sext(NOSEX[ang]) ; frac = 0
        lda #0
        ldy #o_xf
        sta (objptr),y
        clc
        lda SHIP+o_xl
        adc NOSEX,x
        ldy #o_xl
        sta (objptr),y
        lda NOSEX,x
        and #$80
        beq fb_xp
        lda #$FF
        bne fb_xa
fb_xp:
        lda #0
fb_xa:
        adc SHIP+o_xh
        ldy #o_xh
        sta (objptr),y
        ; y position = ship y + sext(NOSEY[ang]) ; frac = 0
        lda #0
        ldy #o_yf
        sta (objptr),y
        clc
        lda SHIP+o_yl
        adc NOSEY,x
        ldy #o_yl
        sta (objptr),y
        lda NOSEY,x
        and #$80
        beq fb_yp
        lda #$FF
        bne fb_ya
fb_yp:
        lda #0
fb_ya:
        adc SHIP+o_yh
        ldy #o_yh
        sta (objptr),y
        ; velocity = BVX/BVY[ang]
        lda BVXL,x
        ldy #o_vxl
        sta (objptr),y
        lda BVXH,x
        ldy #o_vxh
        sta (objptr),y
        lda BVYL,x
        ldy #o_vyl
        sta (objptr),y
        lda BVYH,x
        ldy #o_vyh
        sta (objptr),y
        ; flags
        lda #BULLET_LIFE
        ldy #o_life
        sta (objptr),y
        lda #0
        ldy #o_drawn
        sta (objptr),y
        lda #1
        ldy #o_act
        sta (objptr),y
        rts

; erase_bullets : XOR-off every bullet that is currently drawn.
erase_bullets:
        lda #<BULLETS
        sta objptr
        lda #>BULLETS
        sta objptr+1
        lda #NBULLET
        sta blcnt
eb_loop:
        ldy #o_act
        lda (objptr),y
        beq eb_next
        ldy #o_drawn
        lda (objptr),y
        beq eb_next
        jsr render_bullet
eb_next:
        jsr obj_next
        dec blcnt
        bne eb_loop
        rts

; update_bullets : integrate + wrap each active bullet, then age it; a shot
; whose life reaches 0 is deactivated (it was erased at the top of the frame).
update_bullets:
        lda #<BULLETS
        sta objptr
        lda #>BULLETS
        sta objptr+1
        lda #NBULLET
        sta blcnt
ub_loop:
        ldy #o_act
        lda (objptr),y
        beq ub_next
        jsr integrate_obj
        jsr wrap_obj
        ldy #o_life
        lda (objptr),y
        sec
        sbc #1
        sta (objptr),y
        bne ub_next
        lda #0                  ; life expired -> retire the shot
        ldy #o_act
        sta (objptr),y
        ldy #o_drawn
        sta (objptr),y
ub_next:
        jsr obj_next
        dec blcnt
        bne ub_loop
        rts

; draw_bullets : XOR-on every active bullet and mark it drawn.
draw_bullets:
        lda #<BULLETS
        sta objptr
        lda #>BULLETS
        sta objptr+1
        lda #NBULLET
        sta blcnt
db_loop:
        ldy #o_act
        lda (objptr),y
        beq db_next
        jsr render_bullet
        lda #1
        ldy #o_drawn
        sta (objptr),y
db_next:
        jsr obj_next
        dec blcnt
        bne db_loop
        rts

; render_bullet : XOR the single pixel at the bullet's integer position.
render_bullet:
        ldy #o_xl
        lda (objptr),y
        sta bx
        ldy #o_xh
        lda (objptr),y
        sta bxh
        ldy #o_yl
        lda (objptr),y
        sta by
        jsr plot_xy
        rts

; plot_xy : XOR one pixel at (bx 16-bit, by 0..159), clipped to the playfield.
plot_xy:
        lda bx
        sta cx
        lda bxh
        sta cxh
        lda by
        sta cy
        lda #0
        sta cyh
        jsr seedcol
        jsr plotcur
        rts

; dec_firecd : count the fire cooldown down toward 0.
dec_firecd:
        lda firecd
        beq dfc_ret
        dec firecd
dfc_ret:
        rts

; ===========================================================================
; M4 : rocks  (drifting lumpy polygons that wrap; split in M5)
; ===========================================================================

; rand : 16-bit Galois LFSR (poly $B400, period 65535).  Returns A = low byte.
rand:
        lsr seed+1
        ror seed
        bcc rnd_ret
        lda seed+1
        eor #$B4
        sta seed+1
rnd_ret:
        lda seed
        rts

; set_rock_vp : point the vertex tables at rock silhouette A (kind 0..8).
;   kind = shape*3 + size ; 8 verts per rock.
set_rock_vp:
        asl a
        asl a
        asl a                   ; kind*8
        sta tmpa
        clc
        lda #<ROCKX
        adc tmpa
        sta vpx
        lda #>ROCKX
        adc #0
        sta vpx+1
        clc
        lda #<ROCKY
        adc tmpa
        sta vpy
        lda #>ROCKY
        adc #0
        sta vpy+1
        lda #8
        sta vcount
        rts

; render_rock : XOR the rock pointed to by objptr at its current position.
render_rock:
        ldy #o_xl
        lda (objptr),y
        sta cenx
        ldy #o_xh
        lda (objptr),y
        sta cenh
        ldy #o_yl
        lda (objptr),y
        sta ceny
        ldy #o_kind
        lda (objptr),y
        jsr set_rock_vp
        jsr draw_poly
        rts

; clear_rocks : deactivate every rock slot.
clear_rocks:
        lda #<ROCKS
        sta objptr
        lda #>ROCKS
        sta objptr+1
        lda #NROCK
        sta blcnt
crk_loop:
        lda #0
        ldy #o_act
        sta (objptr),y
        ldy #o_drawn
        sta (objptr),y
        jsr obj_next
        dec blcnt
        bne crk_loop
        rts

; erase_rocks : XOR off every rock that is currently drawn.
erase_rocks:
        lda #<ROCKS
        sta objptr
        lda #>ROCKS
        sta objptr+1
        lda #NROCK
        sta blcnt
erk_loop:
        ldy #o_act
        lda (objptr),y
        beq erk_next
        ldy #o_drawn
        lda (objptr),y
        beq erk_next
        jsr render_rock
erk_next:
        jsr obj_next
        dec blcnt
        bne erk_loop
        rts

; update_rocks : drift + wrap each active rock (shared physics).
update_rocks:
        lda #<ROCKS
        sta objptr
        lda #>ROCKS
        sta objptr+1
        lda #NROCK
        sta blcnt
urk_loop:
        ldy #o_act
        lda (objptr),y
        beq urk_next
        jsr integrate_obj
        jsr wrap_obj
urk_next:
        jsr obj_next
        dec blcnt
        bne urk_loop
        rts

; draw_rocks : XOR on every active rock and mark it drawn.
draw_rocks:
        lda #<ROCKS
        sta objptr
        lda #>ROCKS
        sta objptr+1
        lda #NROCK
        sta blcnt
drk_loop:
        ldy #o_act
        lda (objptr),y
        beq drk_next
        jsr render_rock
        lda #1
        ldy #o_drawn
        sta (objptr),y
drk_next:
        jsr obj_next
        dec blcnt
        bne drk_loop
        rts

; spawn_wave : lay out the opening field of large rocks.
spawn_wave:
        lda #0
        sta rkcnt
        lda #WAVE0
        sta spcnt
sw_loop:
        lda #SZLARGE
        jsr spawn_rock
        dec spcnt
        bne sw_loop
        rts

; spawn_rock : add one rock of size A (0..2) in a free slot at a random edge
; position with a random slow drift.  No-op if every slot is taken.
spawn_rock:
        sta rksz
        lda #<ROCKS
        sta objptr
        lda #>ROCKS
        sta objptr+1
        lda #NROCK
        sta blcnt
spr_find:
        ldy #o_act
        lda (objptr),y
        beq spr_free
        jsr obj_next
        dec blcnt
        bne spr_find
        rts                     ; field full
spr_free:
        ; kind = SHP3[rand & 3] + size
        jsr rand
        and #3
        tax
        lda SHP3,x
        clc
        adc rksz
        ldy #o_kind
        sta (objptr),y
        ; x = rand (0..255) ; xf = xh = 0
        lda #0
        ldy #o_xf
        sta (objptr),y
        ldy #o_xh
        sta (objptr),y
        jsr rand
        ldy #o_xl
        sta (objptr),y
        ; y = rand folded into 0..159 ; yf = yh = 0
        lda #0
        ldy #o_yf
        sta (objptr),y
        ldy #o_yh
        sta (objptr),y
        jsr rand
        cmp #160
        bcc spr_yset
        sec
        sbc #160
spr_yset:
        ldy #o_yl
        sta (objptr),y
        ; velocity = drift table[rand & 15]
        jsr rand
        and #(NDRIFT-1)
        tax
        lda DVXL,x
        ldy #o_vxl
        sta (objptr),y
        lda DVXH,x
        ldy #o_vxh
        sta (objptr),y
        lda DVYL,x
        ldy #o_vyl
        sta (objptr),y
        lda DVYH,x
        ldy #o_vyh
        sta (objptr),y
        ; flags
        lda #0
        ldy #o_drawn
        sta (objptr),y
        ldy #o_life
        sta (objptr),y
        lda #1
        ldy #o_act
        sta (objptr),y
        inc rkcnt
        rts

; decay_timers : count each hold-timer down toward 0.
decay_timers:
        lda hleft
        beq dc1
        dec hleft
dc1:
        lda hright
        beq dc2
        dec hright
dc2:
        lda hthr
        beq dc3
        dec hthr
dc3:
        lda hfire
        beq dc_ret
        dec hfire
dc_ret:
        rts

; frame_delay : crude busy-wait to pace the game (game entry only).
frame_delay:
        ldy #DELAYO
fd_o:
        ldx #0
fd_i:
        dex
        bne fd_i
        dey
        bne fd_o
        rts

; ---------------------------------------------------------------------------
; set_ship_vp : point vpx/vpy at the ship silhouette for angle A (0..31),
;               vcount = 4.
; ---------------------------------------------------------------------------
set_ship_vp:
        and #(NANG-1)
        asl a
        asl a                   ; angle*4 (4 verts per angle)
        sta tmpa
        clc
        lda #<SHPX
        adc tmpa
        sta vpx
        lda #>SHPX
        adc #0
        sta vpx+1
        clc
        lda #<SHPY
        adc tmpa
        sta vpy
        lda #>SHPY
        adc #0
        sta vpy+1
        lda #4
        sta vcount
        rts

; ---------------------------------------------------------------------------
; draw_poly : XOR a closed ring of vcount vertices.
;   inputs: cenx/cenh (centre x, 16-bit signed), ceny (centre y 0..159),
;           vpx/vpy -> signed byte offset tables, vcount = vertex count.
; ---------------------------------------------------------------------------
draw_poly:
        ldy #0
        jsr calc_vert           ; vertex 0
        lda tvx
        sta fx
        sta pxv
        lda tvxh
        sta fxh
        sta pxvh
        lda tvy
        sta fy
        sta pyv
        lda tvyh
        sta fyh
        sta pyvh
        lda #1
        sta vi
dp_loop:
        lda vi
        cmp vcount
        bcs dp_close
        ldy vi
        jsr calc_vert           ; next vertex -> tvx/tvy
        ; line pxv/pyv -> tvx/tvy
        lda pxv
        sta x0
        lda pxvh
        sta x0h
        lda pyv
        sta y0
        lda pyvh
        sta y0h
        lda tvx
        sta x1
        lda tvxh
        sta x1h
        lda tvy
        sta y1
        lda tvyh
        sta y1h
        jsr line_open
        lda tvx
        sta pxv
        lda tvxh
        sta pxvh
        lda tvy
        sta pyv
        lda tvyh
        sta pyvh
        inc vi
        bne dp_loop
dp_close:
        ; final edge: pxv/pyv -> fx/fy
        lda pxv
        sta x0
        lda pxvh
        sta x0h
        lda pyv
        sta y0
        lda pyvh
        sta y0h
        lda fx
        sta x1
        lda fxh
        sta x1h
        lda fy
        sta y1
        lda fyh
        sta y1h
        jsr line_open
        rts

; ---------------------------------------------------------------------------
; calc_vert : screen vertex Y (index) -> tvx/tvy (16-bit signed).
;   tvx = cenx + sext(vpx[Y]) ,  tvy = ceny + sext(vpy[Y])
; ---------------------------------------------------------------------------
calc_vert:
        lda (vpx),y
        sta tmpa                ; offx
        lda (vpy),y
        sta tmpb                ; offy
        ; tvx = cenx + sext(offx)
        clc
        lda tmpa
        adc cenx
        sta tvx
        lda tmpa
        and #$80
        beq cv_xp
        lda #$FF
        bne cv_xhi
cv_xp:
        lda #0
cv_xhi:
        adc cenh
        sta tvxh
        ; tvy = ceny + sext(offy)   (ceny hi = 0)
        clc
        lda tmpb
        adc ceny
        sta tvy
        lda tmpb
        and #$80
        beq cv_yp
        lda #$FF
        bne cv_yhi
cv_yp:
        lda #0
cv_yhi:
        adc #0
        sta tvyh
        rts

; ---------------------------------------------------------------------------
; line : XOR a line from (x0,y0) to (x1,y1) (16-bit signed), clipped to the
;        280x160 playfield.  Tracks byte-col/bit incrementally (one div7 at
;        the start vertex only).
;   line       plots both endpoints (a normal segment).
;   line_open  plots [start,end) : the final endpoint pixel is skipped, so a
;              closed polygon drawn edge-by-edge plots every shared vertex
;              exactly once (XOR-safe: no vertex cancels itself out).
; ---------------------------------------------------------------------------
line_open:
        lda #1
        sta noend
        bne line_body           ; always taken
line:
        lda #0
        sta noend
line_body:
        ; dx = x1-x0 ; sx = +1 (or negate & -1)
        sec
        lda x1
        sbc x0
        sta dx
        lda x1h
        sbc x0h
        sta dxh
        lda #1
        sta sxs
        lda dxh
        bpl l_dxpos
        sec
        lda #0
        sbc dx
        sta dx
        lda #0
        sbc dxh
        sta dxh
        lda #$FF
        sta sxs
l_dxpos:
        ; dy = y1-y0 ; sy = +1 (or negate & -1)
        sec
        lda y1
        sbc y0
        sta dy
        lda y1h
        sbc y0h
        sta dyh
        lda #1
        sta sys
        lda dyh
        bpl l_dypos
        sec
        lda #0
        sbc dy
        sta dy
        lda #0
        sbc dyh
        sta dyh
        lda #$FF
        sta sys
l_dypos:
        ; lerr = dx - dy  (16-bit signed)
        sec
        lda dx
        sbc dy
        sta lerr
        lda dxh
        sbc dyh
        sta lerrh
        ; cx = x0, cy = y0
        lda x0
        sta cx
        lda x0h
        sta cxh
        lda y0
        sta cy
        lda y0h
        sta cyh
        jsr seedcol
l_loop:
        ; at the endpoint?
        lda cx
        cmp x1
        bne l_plot
        lda cxh
        cmp x1h
        bne l_plot
        lda cy
        cmp y1
        bne l_plot
        lda cyh
        cmp y1h
        bne l_plot
        ; reached endpoint: plot it only for a normal (closed) segment
        lda noend
        bne l_ret
        jsr plotcur
l_ret:
        rts
l_plot:
        jsr plotcur
l_step:
        ; e2 = lerr * 2
        lda lerr
        sta e2
        lda lerrh
        sta e2h
        asl e2
        rol e2h
        ; d1: s1 = e2 + dy ; if s1 > 0 -> lerr -= dy ; step x
        clc
        lda e2
        adc dy
        sta s1
        lda e2h
        adc dyh
        sta s1h
        lda s1h
        bmi l_d2                ; s1 < 0 -> skip
        ora s1
        beq l_d2                ; s1 == 0 -> skip (need strictly > 0)
        sec
        lda lerr
        sbc dy
        sta lerr
        lda lerrh
        sbc dyh
        sta lerrh
        jsr stepx
l_d2:
        ; d2: s2 = e2 - dx ; if s2 < 0 -> lerr += dx ; step y
        sec
        lda e2
        sbc dx
        sta s2
        lda e2h
        sbc dxh
        sta s2h
        lda s2h
        bmi l_stepy             ; s2 < 0 -> do the y step
        jmp l_loop              ; s2 >= 0 -> skip (abs jmp, always in range)
l_stepy:
        clc
        lda lerr
        adc dx
        sta lerr
        lda lerrh
        adc dxh
        sta lerrh
        jsr stepy
        jmp l_loop

; step current x by sxs (+/-1), maintaining col/bitn
stepx:
        lda sxs
        bmi sx_neg
        inc cx
        bne sx_p1
        inc cxh
sx_p1:
        ldx bitn
        inx
        cpx #7
        bne sx_p2
        inc col
        ldx #0
sx_p2:
        stx bitn
        rts
sx_neg:
        lda cx
        bne sx_n1
        dec cxh
sx_n1:
        dec cx
        ldx bitn
        bne sx_n2
        dec col
        ldx #7
sx_n2:
        dex
        stx bitn
        rts

; step current y by sys (+/-1)
stepy:
        lda sys
        bmi sy_neg
        inc cy
        bne sy_p1
        inc cyh
sy_p1:
        rts
sy_neg:
        lda cy
        bne sy_n1
        dec cyh
sy_n1:
        dec cy
        rts

; ---------------------------------------------------------------------------
; seedcol : from cx (16-bit signed, >= -21) compute col = cx/7, bitn = cx%7.
;   Uses a +21 bias so the divide runs on a non-negative value.
; ---------------------------------------------------------------------------
seedcol:
        clc
        lda cx
        adc #21
        sta tt
        lda cxh
        adc #0
        sta tth
        ldx #0                  ; quotient
sc_l:
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
        inx
        jmp sc_l
sc_done:
        lda tt
        sta bitn                ; remainder 0..6
        txa
        sec
        sbc #3                  ; undo the +21 = +3 columns bias
        sta col
        rts

; ---------------------------------------------------------------------------
; plotcur : XOR the pixel at (cx,cy) if inside the 280x160 playfield.
; ---------------------------------------------------------------------------
plotcur:
        lda cxh
        bmi pc_skip             ; cx < 0
        beq pc_xlo              ; cxh == 0 -> cx in 0..255 (< 280) ok
        cmp #1
        bne pc_skip             ; cxh >= 2 -> cx >= 512
        lda cx
        cmp #24
        bcs pc_skip             ; cxh==1 & cxlo>=24 -> cx>=280
pc_xlo:
        lda cyh
        bmi pc_skip             ; cy < 0
        bne pc_skip             ; cy >= 256
        lda cy
        cmp #HEIGHT
        bcs pc_skip             ; cy >= 160
        ; plot at (col,bitn,cy)
        ldy cy
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        ldx bitn
        lda BITMASK,x
        ldy col
        eor (ptr),y
        sta (ptr),y
pc_skip:
        rts

; ---------------------------------------------------------------------------
; build_rows : ROWL/ROWH[y] = hi-res address of pixel row y (y = 0..191)
; ---------------------------------------------------------------------------
build_rows:
        ldx #0
br_loop:
        txa
        and #7
        asl a
        asl a
        clc
        adc #$20
        sta tmpa                ; high base
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

; ---------------------------------------------------------------------------
; clear_screen : hi-res page 1 -> 0
; ---------------------------------------------------------------------------
clear_screen:
        lda #>SCREEN
        sta ptr+1
        lda #0
        sta ptr
        ldx #$20                ; 32 pages ($2000-$3FFF)
cs_pg:
        ldy #0
        lda #0
cs_by:
        sta (ptr),y
        iny
        bne cs_by
        inc ptr+1
        dex
        bne cs_pg
        rts

; ---------------------------------------------------------------------------
; data
; ---------------------------------------------------------------------------
BITMASK:
        .byte $01,$02,$04,$08,$10,$20,$40

; ==== generated geometry (files/rockgen.mjs) — original shapes ====
; NANG=32, ship verts=4, rock shapes=3, sizes=5/10/17
SHPX:
        .byte 7,251,254,251,7,252,254,250,6,253,254,250,6,254,254,250,5,255,255,250,4,1,255,250,3,2,255,250,1,3,0,251,0,4,0,252,255,5,0,253,253,6,1,254,252,6,1,255,251,6,1,1,250,6,2,2,250,6,2,3,249,6,2,4,249,5,2,5,249,4,2,6,250,3,2,6,250,2,2,6,251,1,1,6,252,255,1,6,253,254,1,6,255,253,0,5,0,252,0,4,1,251,0,3,3,250,255,2,4,250,255,1,5,250,255,255,6,250,254,254,6,250,254,253,7,250,254,252
SHPY:
        .byte 0,252,0,4,1,251,0,3,3,250,255,2,4,250,255,1,5,250,255,255,6,250,254,254,6,250,254,253,7,250,254,252,7,251,254,251,7,252,254,250,6,253,254,250,6,254,254,250,5,255,255,250,4,1,255,250,3,2,255,250,1,3,0,251,0,4,0,252,255,5,0,253,253,6,1,254,252,6,1,255,251,6,1,1,250,6,2,2,250,6,2,3,249,6,2,4,249,5,2,5,249,4,2,6,250,3,2,6,250,2,2,6,251,1,1,6,252,255,1,6,253,254,1,6,255,253,0,5
NOSEX:
        .byte 7,7,6,6,5,4,3,1,0,255,253,252,251,250,250,249,249,249,250,250,251,252,253,255,0,1,3,4,5,6,6,7
NOSEY:
        .byte 0,1,3,4,5,6,6,7,7,7,6,6,5,4,3,1,0,255,253,252,251,250,250,249,249,249,250,250,251,252,253,255
ACCX:
        .byte 40,39,37,33,28,22,15,8,0,248,241,234,228,223,219,217,216,217,219,223,228,234,241,248,0,8,15,22,28,33,37,39
ACCY:
        .byte 0,8,15,22,28,33,37,39,40,39,37,33,28,22,15,8,0,248,241,234,228,223,219,217,216,217,219,223,228,234,241,248
BVXL:
        .byte 51,31,225,126,248,85,155,210,0,46,101,171,8,130,31,225,205,225,31,130,8,171,101,46,0,210,155,85,248,126,225,31
BVXH:
        .byte 4,4,3,3,2,2,1,0,0,255,254,253,253,252,252,251,251,251,252,252,253,253,254,255,0,0,1,2,2,3,3,4
BVYL:
        .byte 0,210,155,85,248,126,225,31,51,31,225,126,248,85,155,210,0,46,101,171,8,130,31,225,205,225,31,130,8,171,101,46
BVYH:
        .byte 0,0,1,2,2,3,3,4,4,4,3,3,2,2,1,0,0,255,254,253,253,252,252,251,251,251,252,252,253,253,254,255
ROCKX:
        .byte 5,2,0,253,251,254,0,3,10,5,0,251,246,251,0,6,17,8,0,247,239,248,0,10,4,3,255,252,252,253,1,4,8,6,255,248,248,250,1,8,13,10,254,242,242,246,2,14,5,2,255,252,251,254,1,3,10,4,254,248,246,253,3,6,16,7,253,242,240,250,5,11
ROCKY:
        .byte 0,2,5,3,0,254,251,253,0,5,10,5,0,251,247,250,0,8,17,9,0,248,240,246,1,4,4,3,255,252,253,253,1,8,7,6,255,248,249,250,2,14,12,10,254,242,244,246,1,4,3,2,255,253,252,254,3,8,6,4,253,249,247,253,5,13,11,7,251,245,241,250
DVXL:
        .byte 151,128,86,31,227,171,129,106,105,128,170,225,29,85,127,150
DVXH:
        .byte 0,0,0,0,255,255,255,255,255,255,255,255,0,0,0,0
DVYL:
        .byte 29,85,127,150,151,128,86,31,227,171,129,106,105,128,170,225
DVYH:
        .byte 0,0,0,0,0,0,0,0,255,255,255,255,255,255,255,255
SHP3:
        .byte 0,3,6,0            ; shape*3 for a random rock silhouette (rand&3)

; ---------------------------------------------------------------------------
; test hooks : harness pokes state, sets PC here, runs to BRK (monitor dump).
; ---------------------------------------------------------------------------
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

line_brk:
        ldx #$FF
        txs
        jsr line
        brk

; test pokes cenx/cenh/ceny and STATE(angle), runs; draws one ship
polyship_brk:
        ldx #$FF
        txs
        lda STATE
        jsr set_ship_vp
        jsr draw_poly
        brk

; --- M2 test hooks ---
; init the game (ship at centre, pointing up), then BRK.
init_brk:
        ldx #$FF
        txs
        jsr game_init
        brk

; run exactly one game frame (erase/input/physics/redraw), then BRK.  Tests
; poke KBD ($C000) and/or the ship struct ($6300) before each call.
frame_brk:
        ldx #$FF
        txs
        jsr game_frame
        brk
