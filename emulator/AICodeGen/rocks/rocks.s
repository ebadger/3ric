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
;   BRUN ROCKS.PRG 0C00      (loads the raw image to $0C00 and jumps there)
; ============================================================================

; ---- soft switches (touched by reading them) ----
TXTCLR   = $C050        ; graphics (text off)
MIXSET   = $C053        ; mixed mode on  (bottom 4 rows are text = HUD)
LOWSCR   = $C054        ; display page 1
HISCR    = $C055        ; display page 2  (double-buffer flip)
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
lerr     = $6A0C          ; Bresenham error term, 8-bit signed (|dx|,|dy| <= 36
e2       = $6A0E          ;   for every rock/ship edge, so lerr and e2 = 2*lerr
                          ;   both fit in a byte; s1/s2 are transient in A now,
                          ;   so $6A0D/$6A0F/$6A10..$6A13 are free scratch).
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

; ---- M5: score / lives / collision scratch ----
score0   = $6A60          ; 6-digit BCD score (score0 low .. score2 high)
score1   = $6A61
score2   = $6A62
lives    = $6A63          ; ships remaining
invul   = $6A64          ; frames of spawn invulnerability left
gameover = $6A65          ; nonzero once the last ship is lost
hcx      = $6A66          ; hit_test: centre x (16-bit) ...
hcxh     = $6A67
hcy      = $6A68          ; ... centre y (0..159) ...
hrad     = $6A69          ; ... collision radius
hpx      = $6A6A          ; hit_test: test point x (16-bit) ...
hpxh     = $6A6B
hpy      = $6A6C          ; ... test point y
cdxl     = $6A6D          ; hit_test scratch (|dx| 16-bit)
cdxh     = $6A6E
ccnt     = $6A6F          ; collision outer (rock) loop counter
pxl      = $6A70          ; split_rock: cached parent position ...
pxh      = $6A71
pyl      = $6A72
psize    = $6A73          ; ... and parent size
save0    = $6A74          ; objptr save across spawn_child scans
save1    = $6A75
chsize   = $6A76          ; spawn_child: child size
ctmp     = $6A77          ; spawn_child: velocity-doubling temp
gstate   = $6A78          ; game state: 0 attract, 1 playing, 2 game over
wave     = $6A79          ; current wave number (1-based)
fldrawn  = $6A7A          ; 1 = thrust flame currently XOR-drawn on screen
hhyp     = $6A7B          ; momentary hyperspace request (set by input)
hypcd    = $6A7C          ; frames until hyperspace is allowed again
drawpg   = $6A7D          ; double buffer: hi-res page being DRAWN (0=$2000, 1=$4000)
pgoff    = $6A7E          ; hi-res high-byte offset for the draw page ($00 or $20)
txtoff   = $6A7F          ; text-HUD high-byte offset for the draw page ($00 or $04)

; ---- tunables ----
HOLD     = 4              ; frames an action stays live after its key event
MAXVI    = 4              ; max |velocity| integer part (px/frame)
ANGUP    = 24             ; heading that points up (-y)
BULLET_LIFE = 60          ; frames a shot lives (~1 screen width @ 4.2 px/frame)
FIRE_CD  = 8              ; frames between shots (auto-fire cadence while held)
NDRIFT   = 16             ; rock drift-direction table size
SZLARGE  = 2              ; rock size index: 0 small, 1 med, 2 large
NSHAPE   = 3              ; rock silhouette variants
WAVE0    = 4              ; large rocks in the opening wave
LIVES0   = 3              ; starting ships
INVULN   = 90             ; invulnerable frames after (re)spawn
HYP_CD   = 30             ; frames between hyperspace jumps (rate limit)
HYP_INV  = 30             ; brief grace period after a hyperspace arrival
SHIPR    = 4              ; ship half-size added to a rock's collision radius
WAVEMAX  = 8              ; cap on large rocks spawned per wave
GS_ATTRACT = 0            ; game-state values
GS_PLAY  = 1
GS_OVER  = 2
HUD20    = $0650          ; text page 1 row 20 (first visible mixed-mode text row)
HUD22    = $0750          ; text page 1 row 22
HUD23    = $07D0          ; text page 1 row 23
SNAP20   = $6B00          ; safe copies of the HUD rows (the BRK monitor dump
SNAP21   = $6B28          ;   overwrites the live text page, so tests read these)
SNAP22   = $6B50
SNAP23   = $6B78

; ---- key codes (Apple II: bit7 set = key ready) ----
K_A      = $C1
K_LARR   = $88
K_D      = $C4
K_RARR   = $95
K_W      = $D7
K_UARR   = $8B
K_SPACE  = $A0
K_H      = $C8            ; hyperspace

        .org $0C00              ; above text page 2 ($800-$BFF): the page-flip HUD
                                ; uses text page 2, so the program must not live there

; ---------------------------------------------------------------------------
; entry (M1: draw a fan of ships at increasing angle to eyeball the engine)
; ---------------------------------------------------------------------------
; ---------------------------------------------------------------------------
; entry : the game.  BRUN ROCKS.PRG 0C00.
; ---------------------------------------------------------------------------
start:
        sei
        cld
        ldx #$FF
        txs
        jsr video_init
        jsr enter_attract
        jsr flip_show           ; hide page 1, draw the first frame on page 2 (no
                                ; first-frame teardown flicker on the visible page)
sg_loop:
        jsr live_frame
        jmp sg_loop

; live_frame : compose and reveal one frame.  Rendering itself sets the pace;
;   adding a fixed delay here only lowers the frame rate on a 1 MHz machine.
live_frame:
        jsr game_frame
        jmp flip_show           ; reveal the finished page, hide the other one

; ---------------------------------------------------------------------------
; video_init : select hi-res mixed mode, build the row table, clear the screen.
; ---------------------------------------------------------------------------
video_init:
        lda TXTCLR              ; graphics on
        lda MIXSET              ; mixed mode (text HUD at bottom)
        lda LOWSCR              ; page 1
        lda HIRES_SW            ; hi-res
        jsr build_rows
        jsr clear_screen
        jsr hud_clear           ; blank the page-1 text HUD too (build_rows left
                                ; txtoff=0), so the first hidden-draw frame shows a
                                ; clean screen instead of stale text-row garbage
        rts

; ---------------------------------------------------------------------------
; game_init : start a fresh game — video, ship, fresh field, score/lives.
; ---------------------------------------------------------------------------
game_init:
        jsr video_init
        jsr init_ship
        jsr clear_bullets
        jsr clear_rocks
        lda #$A5                ; nonzero LFSR seed (0 would lock the RNG)
        sta seed
        lda #$3C
        sta seed+1
        lda #0
        sta firecd
        sta score0
        sta score1
        sta score2
        sta gameover
        lda #LIVES0
        sta lives
        lda #INVULN
        sta invul              ; a moment of grace at the start
        lda #GS_PLAY
        sta gstate
        lda #1
        sta wave
        jsr start_wave
        jsr hud_play
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
        sta fldrawn
        sta hhyp
        sta hypcd
        rts

; ---------------------------------------------------------------------------
; game_frame : one tick — dispatch on the current game state.
; ---------------------------------------------------------------------------
game_frame:
        jsr clear_screen        ; wipe the hidden page, then compose the whole frame
        lda gstate
        cmp #GS_PLAY
        beq gf_play
        cmp #GS_OVER
        beq gf_over
        jmp attract_frame       ; GS_ATTRACT
gf_play:
        jmp play_frame
gf_over:
        jmp over_frame

; ---------------------------------------------------------------------------
; flip_show : reveal the page we just finished drawing, then make the OTHER
;   page the hidden draw target for the next frame.  PAGE2 ($C054/$C055) flips
;   the hi-res playfield AND the mixed-mode text HUD together, so pgoff/txtoff
;   move in lock-step.  Called only from the live loop; the test hooks never
;   flip, so every harness frame composes on page 1 where the tests read.
; ---------------------------------------------------------------------------
flip_show:
        lda drawpg
        bne fs_show2
        lda LOWSCR              ; just drew page 1 -> display it
        jmp fs_adv
fs_show2:
        lda HISCR              ; just drew page 2 -> display it
fs_adv:
        lda drawpg
        eor #1
        sta drawpg             ; the other page is now the hidden draw target
        beq fs_p1
        lda #$20               ; new draw page is page 2
        sta pgoff
        lda #$04
        sta txtoff
        jmp toggle_clear_page
fs_p1:
        lda #0                 ; new draw page is page 1
        sta pgoff
        sta txtoff
        jmp toggle_clear_page

; play_frame : advance one frame of actual gameplay.
play_frame:
        lda rkcnt
        bne pf_go
        inc wave                ; field cleared -> next, larger wave
        jsr start_wave
pf_go:
        jsr read_input
        jsr do_rotate
        jsr do_thrust
        jsr do_fire
        jsr do_hyperspace
        jsr integrate_ship
        jsr wrap_ship
        jsr update_bullets
        jsr update_rocks
        jsr collisions
        jsr draw_ship
        jsr draw_flame
        jsr draw_bullets
        jsr draw_rocks
        jsr decay_timers
        jsr dec_firecd
        jsr dec_invuln
        jsr hud_play
        lda gameover
        beq pf_ret
        jsr enter_over
pf_ret:
        rts

; attract_frame : title screen — rocks drift behind it; SPACE starts a game.
attract_frame:
        jsr update_rocks
        jsr draw_rocks
        jsr hud_attract
        jsr poll_space
        bcc af_ret
        jsr game_init           ; SPACE -> play
af_ret:
        rts

; over_frame : game-over screen — rocks keep drifting; SPACE restarts.
over_frame:
        jsr update_rocks
        jsr draw_rocks
        jsr hud_over
        jsr poll_space
        bcc of_ret
        jsr game_init           ; SPACE -> restart
of_ret:
        rts

; enter_attract : reset to the title screen with a drifting rock backdrop.
enter_attract:
        lda #GS_ATTRACT
        sta gstate
        jsr clear_screen
        lda seed
        ora seed+1
        bne ea_seeded
        lda #$A5
        sta seed
        lda #$3C
        sta seed+1
ea_seeded:
        lda #1
        sta wave
        jsr clear_rocks
        jsr start_wave
        rts

; enter_over : switch to the game-over state.
enter_over:
        lda #GS_OVER
        sta gstate
        rts

; poll_space : carry set if SPACE is pressed this frame (clears the strobe).
poll_space:
        lda KBD
        bpl ps_no               ; bit7 clear -> no key waiting
        sta keyin               ; save the key before clearing the strobe
        lda KBDSTRB             ; read of $C010 clears the strobe
        lda keyin
        cmp #K_SPACE
        beq ps_yes
ps_no:
        clc
        rts
ps_yes:
        sec
        rts

; ---------------------------------------------------------------------------
; M6 HUD : score + ships (playing), title (attract), game over (over).
;   Writes to text page 1 rows 20-23, visible under the mixed hi-res field.
;   Source strings are plain ASCII; ORA #$80 gives Apple II normal-video chars.
;   ptr ($06) = dest cell, vpx ($08) = source string (both free outside line draw)
; ---------------------------------------------------------------------------

; hud_clear : blank the four text HUD rows (20-23) with spaces.
hud_clear:
        ldx #0
hc_row:
        lda HUDBL,x
        sta ptr
        lda HUDBH,x
        clc
        adc txtoff              ; author the HUD on the hidden text page
        sta ptr+1
        lda #$A0                ; normal-video space
        ldy #39
hc_col:
        sta (ptr),y
        dey
        bpl hc_col
        inx
        cpx #4
        bne hc_row
        rts

; puts : copy the $00-terminated ASCII string at (vpx) to (ptr), hi-bit set.
puts:
        lda ptr+1
        clc
        adc txtoff              ; retarget to the hidden text page
        sta ptr+1
        ldy #0
puts_l:
        lda (vpx),y
        beq puts_d
        ora #$80
        sta (ptr),y
        iny
        bne puts_l
puts_d:
        rts

; put_score : write the 6-digit BCD score at (ptr) (cells Y=0..5).
put_score:
        lda ptr+1
        clc
        adc txtoff              ; retarget to the hidden text page
        sta ptr+1
        ldy #0
        lda score2
        jsr sc_byte
        lda score1
        jsr sc_byte
        lda score0
        jsr sc_byte
        rts
sc_byte:                        ; A = BCD byte, Y = cell; writes 2 digits, Y+=2
        pha
        lsr a
        lsr a
        lsr a
        lsr a
        ora #$B0                ; '0' in normal video
        sta (ptr),y
        iny
        pla
        and #$0F
        ora #$B0
        sta (ptr),y
        iny
        rts

; hud_play : SCORE nnnnnn ................ SHIPS n   (row 22)
hud_play:
        jsr hud_clear
        lda #<HUD22
        sta ptr
        lda #>HUD22
        sta ptr+1
        lda #<MSG_SCORE
        sta vpx
        lda #>MSG_SCORE
        sta vpx+1
        jsr puts                ; "SCORE" at cols 0-4
        lda #<(HUD22+6)
        sta ptr
        lda #>(HUD22+6)
        sta ptr+1
        jsr put_score           ; digits at cols 6-11
        lda #<(HUD22+20)
        sta ptr
        lda #>(HUD22+20)
        sta ptr+1
        lda #<MSG_SHIPS
        sta vpx
        lda #>MSG_SHIPS
        sta vpx+1
        jsr puts                ; "SHIPS" at cols 20-24
        lda lives
        ora #$B0
        ldy #6                  ; ptr = HUD22+20, so cell 26
        sta (ptr),y
        rts

; hud_attract : the title and the start prompt.
hud_attract:
        jsr hud_clear
        lda #<(HUD20+15)
        sta ptr
        lda #>(HUD20+15)
        sta ptr+1
        lda #<MSG_TITLE
        sta vpx
        lda #>MSG_TITLE
        sta vpx+1
        jsr puts                ; "ROCK STORM"
        lda #<(HUD22+10)
        sta ptr
        lda #>(HUD22+10)
        sta ptr+1
        lda #<MSG_START
        sta vpx
        lda #>MSG_START
        sta vpx+1
        jsr puts                ; "PRESS SPACE TO PLAY"
        rts

; hud_over : GAME OVER, the final score, and the restart prompt.
hud_over:
        jsr hud_clear
        lda #<(HUD20+15)
        sta ptr
        lda #>(HUD20+15)
        sta ptr+1
        lda #<MSG_OVER
        sta vpx
        lda #>MSG_OVER
        sta vpx+1
        jsr puts                ; "GAME OVER"
        lda #<(HUD22+10)
        sta ptr
        lda #>(HUD22+10)
        sta ptr+1
        lda #<MSG_SCORE
        sta vpx
        lda #>MSG_SCORE
        sta vpx+1
        jsr puts                ; "SCORE"
        lda #<(HUD22+16)
        sta ptr
        lda #>(HUD22+16)
        sta ptr+1
        jsr put_score           ; final score digits
        lda #<(HUD23+10)
        sta ptr
        lda #>(HUD23+10)
        sta ptr+1
        lda #<MSG_START
        sta vpx
        lda #>MSG_START
        sta vpx+1
        jsr puts                ; "PRESS SPACE TO PLAY"
        rts

HUDBL:  .byte $50,$D0,$50,$D0    ; text rows 20,21,22,23 low bytes
HUDBH:  .byte $06,$06,$07,$07    ; ... high bytes
MSG_TITLE:  .asciiz "ROCK STORM"
MSG_START:  .asciiz "PRESS SPACE TO PLAY"
MSG_OVER:   .asciiz "GAME OVER"
MSG_SCORE:  .asciiz "SCORE"
MSG_SHIPS:  .asciiz "SHIPS"

; hud_snapshot : copy the four live HUD rows into safe RAM so tests can read
;   them after the BRK monitor scribbles its register dump over the text page.
hud_snapshot:
        ldx #0
hsn_row:
        lda HUDBL,x
        sta ptr
        lda HUDBH,x
        sta ptr+1
        lda SNAPL,x
        sta vpx
        lda SNAPH,x
        sta vpx+1
        ldy #39
hsn_col:
        lda (ptr),y
        sta (vpx),y
        dey
        bpl hsn_col
        inx
        cpx #4
        bne hsn_row
        rts
SNAPL:  .byte $00,$28,$50,$78
SNAPH:  .byte $6B,$6B,$6B,$6B

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

; draw_ship : draw the ship and mark it drawn (skip when destroyed).
draw_ship:
        lda SHIP+o_act
        beq ds_ret
        jsr render_ship
        lda #1
        sta SHIP+o_drawn
ds_ret:
        rts

; render_flame / draw_flame : the thrust flame, drawn as its own XOR polygon
;   behind the ship so it blinks on and off with the engine.  With the frame
;   cleared each tick it simply isn't redrawn when the engine is idle.
render_flame:
        lda SHIP+o_xl
        sta cenx
        lda SHIP+o_xh
        sta cenh
        lda SHIP+o_yl
        sta ceny
        lda SHIP+o_ang
        jsr set_flame_vp
        jsr draw_poly
        rts

draw_flame:
        lda #0
        sta fldrawn             ; default: no flame this frame
        lda SHIP+o_act
        beq dfl_ret             ; ship gone -> no flame
        lda hthr
        beq dfl_ret             ; engine idle -> no flame
        jsr render_flame
        lda #1
        sta fldrawn
dfl_ret:
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
        cmp #K_H
        beq ri_hyp
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
        rts
ri_hyp:
        lda #1
        sta hhyp
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

; do_hyperspace : on a request (rate-limited) warp the ship to a random spot,
;   kill its momentum, and grant a brief grace period on arrival.  A jump can
;   still drop you onto a rock -- that's the classic risk -- but the short
;   invuln keeps arrival survivable while it clears.
do_hyperspace:
        lda hhyp
        beq dh_ret
        lda #0
        sta hhyp                ; consume the request whether or not it fires
        lda hypcd
        bne dh_ret              ; still cooling down -> ignore
        jsr rand
        sta SHIP+o_xl           ; new x in 0..255 (inside the 280-wide field)
        jsr rand
        cmp #HEIGHT
        bcc dh_yok
        sbc #HEIGHT             ; fold 160..255 down into 0..95
dh_yok:
        sta SHIP+o_yl           ; new y in 0..159
        lda #0
        sta SHIP+o_xf
        sta SHIP+o_xh
        sta SHIP+o_yf
        sta SHIP+o_yh
        sta SHIP+o_vxl          ; drop all momentum
        sta SHIP+o_vxh
        sta SHIP+o_vyl
        sta SHIP+o_vyh
        lda #HYP_CD
        sta hypcd
        lda #HYP_INV
        sta invul
dh_ret:
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

; start_wave : lay out a fresh field of large rocks; more each wave (capped).
start_wave:
        lda #0
        sta rkcnt
        lda wave
        clc
        adc #(WAVE0-1)          ; wave 1 -> WAVE0 rocks, +1 per wave
        bcs sw_capf
        cmp #(WAVEMAX+1)
        bcc sw_set
sw_capf:
        lda #WAVEMAX
sw_set:
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
        ; y in the top/bottom bands (0..49 or 110..159), clear of the ship row
        lda #0
        ldy #o_yf
        sta (objptr),y
        ldy #o_yh
        sta (objptr),y
        jsr rand
spr_yfold:
        cmp #100
        bcc spr_yband
        sbc #100                ; fold 0..255 down into 0..99
        jmp spr_yfold
spr_yband:
        cmp #50
        bcc spr_yset
        clc
        adc #60                 ; 50..99 -> 110..159 (bottom band)
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

; ===========================================================================
; M5 : collisions  (bullet->rock split+score, ship->rock death/lives)
; ===========================================================================

; collisions : resolve this frame's hits (objects already moved, not yet drawn).
collisions:
        jsr bullet_rock_hits
        jsr ship_rock_hits
        rts

; hit_test : is point (hpx/hpxh, hpy) within hrad of centre (hcx/hcxh, hcy)?
;   box test on |dx|,|dy|.  Returns carry set on a hit, clear on a miss.
hit_test:
        ; |dx| (16-bit)
        lda hpxh
        cmp hcxh
        bcc ht_pxlt
        bne ht_pxge
        lda hpx
        cmp hcx
        bcc ht_pxlt
ht_pxge:
        sec
        lda hpx
        sbc hcx
        sta cdxl
        lda hpxh
        sbc hcxh
        sta cdxh
        jmp ht_dxok
ht_pxlt:
        sec
        lda hcx
        sbc hpx
        sta cdxl
        lda hcxh
        sbc hpxh
        sta cdxh
ht_dxok:
        lda cdxh
        bne ht_miss             ; |dx| >= 256
        lda cdxl
        cmp hrad
        beq ht_dxin
        bcs ht_miss             ; |dx| > rad
ht_dxin:
        ; |dy| (8-bit, positions are 0..159)
        lda hpy
        cmp hcy
        bcs ht_pyge
        lda hcy
        sec
        sbc hpy
        jmp ht_dyok
ht_pyge:
        sec
        sbc hcy
ht_dyok:
        cmp hrad
        beq ht_hit
        bcs ht_miss             ; |dy| > rad
ht_hit:
        sec
        rts
ht_miss:
        clc
        rts

; bullet_rock_hits : rocks outer (objptr), bullets inner (absolute,X).  A hit
; kills the shot, scores, and splits the rock.
bullet_rock_hits:
        lda #<ROCKS
        sta objptr
        lda #>ROCKS
        sta objptr+1
        lda #NROCK
        sta ccnt
brh_rloop:
        ldy #o_act
        lda (objptr),y
        beq brh_rnext
        ; cache this rock as the collision centre
        ldy #o_xl
        lda (objptr),y
        sta hcx
        ldy #o_xh
        lda (objptr),y
        sta hcxh
        ldy #o_yl
        lda (objptr),y
        sta hcy
        ldy #o_kind
        lda (objptr),y
        tax
        lda RADT,x
        sta hrad
        ldx #0
brh_bloop:
        lda BULLETS+o_act,x
        beq brh_bnext
        lda BULLETS+o_xl,x
        sta hpx
        lda BULLETS+o_xh,x
        sta hpxh
        lda BULLETS+o_yl,x
        sta hpy
        jsr hit_test
        bcc brh_bnext
        ; hit: retire the shot, split the rock, and score it
        lda #0
        sta BULLETS+o_act,x
        sta BULLETS+o_drawn,x
        jsr split_rock
        jsr add_score
        jmp brh_rnext
brh_bnext:
        txa
        clc
        adc #OBJ_SIZE
        tax
        cpx #80                 ; NBULLET(5) * OBJ_SIZE(16) = end of the bullet array
        bcc brh_bloop
brh_rnext:
        jsr obj_next
        dec ccnt
        bne brh_rloop
        rts

; ship_rock_hits : ship (absolute) vs each rock (objptr).  A hit destroys the
; ship unless it is currently invulnerable or the game is already over.
ship_rock_hits:
        lda gameover
        bne srh_ret
        lda invul
        bne srh_ret
        lda SHIP+o_act
        beq srh_ret
        lda SHIP+o_xl
        sta hpx
        lda SHIP+o_xh
        sta hpxh
        lda SHIP+o_yl
        sta hpy
        lda #<ROCKS
        sta objptr
        lda #>ROCKS
        sta objptr+1
        lda #NROCK
        sta ccnt
srh_loop:
        ldy #o_act
        lda (objptr),y
        beq srh_next
        ldy #o_xl
        lda (objptr),y
        sta hcx
        ldy #o_xh
        lda (objptr),y
        sta hcxh
        ldy #o_yl
        lda (objptr),y
        sta hcy
        ldy #o_kind
        lda (objptr),y
        tax
        lda RADT,x
        clc
        adc #SHIPR
        sta hrad
        jsr hit_test
        bcc srh_next
        jsr ship_hit
        rts
srh_next:
        jsr obj_next
        dec ccnt
        bne srh_loop
srh_ret:
        rts

; ship_hit : lose a ship; respawn with invulnerability, or end the game.
ship_hit:
        lda #0
        sta SHIP+o_drawn        ; clear the drawn flag on the lost ship
        dec lives
        bne sh_respawn
        lda #1
        sta gameover
        lda #0
        sta SHIP+o_act
        rts
sh_respawn:
        jsr init_ship
        lda #INVULN
        sta invul
        rts

; split_rock : destroy the rock at objptr; spawn two of the next size down at
; its position (nothing when a small rock is destroyed).  Preserves objptr.
split_rock:
        ldy #o_xl
        lda (objptr),y
        sta pxl
        ldy #o_xh
        lda (objptr),y
        sta pxh
        ldy #o_yl
        lda (objptr),y
        sta pyl
        ldy #o_kind
        lda (objptr),y
        tax
        lda SIZEOF,x
        sta psize
        lda #0
        ldy #o_act
        sta (objptr),y
        ldy #o_drawn
        sta (objptr),y
        dec rkcnt
        lda objptr
        sta save0
        lda objptr+1
        sta save1
        lda psize
        beq sr_done             ; small -> no children
        sec
        sbc #1
        sta chsize
        jsr spawn_child
        jsr spawn_child
sr_done:
        lda save0
        sta objptr
        lda save1
        sta objptr+1
        rts

; spawn_child : add a rock of size chsize at (pxl/pxh, pyl) with a brisk drift.
spawn_child:
        lda #<ROCKS
        sta objptr
        lda #>ROCKS
        sta objptr+1
        lda #NROCK
        sta blcnt
scd_find:
        ldy #o_act
        lda (objptr),y
        beq scd_free
        jsr obj_next
        dec blcnt
        bne scd_find
        rts                     ; no room
scd_free:
        jsr rand
        and #3
        tax
        lda SHP3,x
        clc
        adc chsize
        ldy #o_kind
        sta (objptr),y
        lda #0
        ldy #o_xf
        sta (objptr),y
        lda pxl
        ldy #o_xl
        sta (objptr),y
        lda pxh
        ldy #o_xh
        sta (objptr),y
        lda #0
        ldy #o_yf
        sta (objptr),y
        lda pyl
        ldy #o_yl
        sta (objptr),y
        lda #0
        ldy #o_yh
        sta (objptr),y
        ; velocity = 2x drift[rand & 15]  (smaller rocks move livelier)
        jsr rand
        and #(NDRIFT-1)
        tax
        lda DVXL,x
        asl a
        sta ctmp
        lda DVXH,x
        rol a
        ldy #o_vxh
        sta (objptr),y
        lda ctmp
        ldy #o_vxl
        sta (objptr),y
        lda DVYL,x
        asl a
        sta ctmp
        lda DVYH,x
        rol a
        ldy #o_vyh
        sta (objptr),y
        lda ctmp
        ldy #o_vyl
        sta (objptr),y
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

; add_score : add the destroyed rock's value (by psize) to the BCD score.
add_score:
        ldx psize
        sed
        clc
        lda score0
        adc PTSL,x
        sta score0
        lda score1
        adc PTSH,x
        sta score1
        lda score2
        adc #0
        sta score2
        cld
        rts

; dec_invuln : count the spawn-invulnerability timer down toward 0.
dec_invuln:
        lda invul
        beq div_ret
        dec invul
div_ret:
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
        beq dc4
        dec hfire
dc4:
        lda hypcd
        beq dc_ret
        dec hypcd
dc_ret:
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

; set_flame_vp : point vpx/vpy at the flame triangle for angle A (0..31),
;                vcount = 3.
set_flame_vp:
        and #(NANG-1)
        sta tmpb                ; angle
        asl a                   ; angle*2
        clc
        adc tmpb                ; angle*3 (3 verts per angle)
        sta tmpa
        clc
        lda #<FLAMEX
        adc tmpa
        sta vpx
        lda #>FLAMEX
        adc #0
        sta vpx+1
        clc
        lda #<FLAMEY
        adc tmpa
        sta vpy
        lda #>FLAMEY
        adc #0
        sta vpy+1
        lda #3
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
        ; lerr = dx - dy  (8-bit signed; |dx|,|dy| <= 36 for all rock/ship
        ;   edges and every test line, so the whole error term stays in a byte)
        sec
        lda dx
        sbc dy
        sta lerr
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
        ; --- inlined plotcur (per-pixel hot path; saves jsr/rts ~12 cyc/px) ---
        lda cxh
        bmi lp_skip             ; cx < 0
        beq lp_xlo              ; cxh == 0 -> cx in 0..255 (< 280) ok
        cmp #1
        bne lp_skip             ; cxh >= 2 -> cx >= 512
        lda cx
        cmp #24
        bcs lp_skip             ; cxh==1 & cxlo>=24 -> cx >= 280
lp_xlo:
        lda cyh
        bne lp_skip             ; cy >= 256 or cy < 0
        lda cy
        cmp #HEIGHT
        bcs lp_skip             ; cy >= 160
        ldy cy
        lda ROWL,y
        sta ptr
        lda ROWH,y
        clc
        adc pgoff               ; +$00 page 1 / +$20 page 2 (double buffer)
        sta ptr+1
        ldx bitn
        lda BITMASK,x
        ldy col
        eor (ptr),y
        sta (ptr),y
lp_skip:
l_step:
        ; e2 = lerr * 2   (8-bit signed; proven |e2| <= 116 for |dx|,|dy| <= 40)
        lda lerr
        asl a
        sta e2
        ; d1: s1 = e2 + dy ; if s1 > 0 -> lerr -= dy ; step x   (8-bit signed)
        clc
        lda e2
        adc dy                  ; A = s1; N/Z flags drive the decision (s1 not stored)
        bmi l_d2                ; s1 < 0 -> skip
        beq l_d2                ; s1 == 0 -> skip (need strictly > 0)
        sec
        lda lerr
        sbc dy
        sta lerr
        ; --- inlined stepx (saves jsr/rts) ---
        lda sxs
        bmi lsx_neg
        inc cx
        bne lsx_p1
        inc cxh
lsx_p1:
        ldx bitn
        inx
        cpx #7
        bne lsx_p2
        inc col
        ldx #0
lsx_p2:
        stx bitn
        jmp l_d2
lsx_neg:
        lda cx
        bne lsx_n1
        dec cxh
lsx_n1:
        dec cx
        ldx bitn
        bne lsx_n2
        dec col
        ldx #7
lsx_n2:
        dex
        stx bitn
l_d2:
        ; d2: s2 = e2 - dx ; if s2 < 0 -> lerr += dx ; step y   (8-bit signed)
        sec
        lda e2
        sbc dx                  ; A = s2; N flag drives the decision (s2 not stored)
        bmi l_stepy             ; s2 < 0 -> do the y step
        jmp l_loop              ; s2 >= 0 -> skip (abs jmp, always in range)
l_stepy:
        clc
        lda lerr
        adc dx
        sta lerr
        ; --- inlined stepy (saves jsr/rts) ---
        lda sys
        bmi lsy_neg
        inc cy
        bne lsy_j
        inc cyh
lsy_j:
        jmp l_loop
lsy_neg:
        lda cy
        bne lsy_n1
        dec cyh
lsy_n1:
        dec cy
        jmp l_loop

; stepx/stepy were inlined into the l_step hot loop above (per-pixel path).

; ---------------------------------------------------------------------------
; seedcol : from cx (16-bit signed, >= -21) compute col = cx/7, bitn = cx%7.
;   Uses a +21 bias so the divide runs on a non-negative value.  The quotient
;   is assembled from powers of two instead of subtracting 7 up to 45 times.
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
        ; 224 = 32*7 (the only threshold that can have a high byte)
        lda tth
        bne sc_224
        lda tt
        cmp #224
        bcc sc_112
sc_224:
        sec
        lda tt
        sbc #224
        sta tt
        lda tth
        sbc #0
        sta tth
        ldx #32
sc_112:
        lda tt
        cmp #112                ; 16*7
        bcc sc_56
        sbc #112
        sta tt
        txa
        ora #16
        tax
sc_56:
        lda tt
        cmp #56                 ; 8*7
        bcc sc_28
        sbc #56
        sta tt
        txa
        ora #8
        tax
sc_28:
        lda tt
        cmp #28                 ; 4*7
        bcc sc_14
        sbc #28
        sta tt
        txa
        ora #4
        tax
sc_14:
        lda tt
        cmp #14                 ; 2*7
        bcc sc_7
        sbc #14
        sta tt
        txa
        ora #2
        tax
sc_7:
        lda tt
        cmp #7                  ; 1*7
        bcc sc_done
        sbc #7
        sta tt
        inx
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
        clc
        adc pgoff              ; +$00 page 1 / +$20 page 2 (double buffer)
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
        ; The clear loop patches its absolute operands as pages flip.  A game
        ; restart resets drawing to page 1, so put those operands back too.
        lda clear_stores+2
        cmp #$20
        beq br_clear_p1
        jsr toggle_clear_page
br_clear_p1:
        lda #0
        sta drawpg             ; default to page 1 so test hooks draw where they read
        sta pgoff
        sta txtoff
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
; clear_screen : clear the hidden 8 KB hi-res page.  Thirty-two absolute,X
;   stores per iteration are substantially cheaper than an indirect store plus
;   index update for every byte.  flip_show patches each high-byte operand
;   between $20-$3F (page 1) and $40-$5F (page 2).
; ---------------------------------------------------------------------------
clear_screen:
        ldx #0
        lda #0                  ; fill byte; A stays 0 for the whole loop
cs_by:
clear_stores:
        sta $2000,x
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
        bne cs_by
        rts

toggle_clear_page:
        ldy #2                  ; high operand of the first absolute,X store
tcp_loop:
        lda clear_stores,y
        eor #$60                ; $20-$3F <-> $40-$5F
        sta clear_stores,y
        iny
        iny
        iny
        cpy #98                 ; 32 stores * 3 bytes + initial offset 2
        bne tcp_loop
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
FLAMEX:
        .byte 252,247,252,252,247,252,253,248,252,254,249,252,255,250,252,255,251,252,0,253,253,1,254,253,2,0,254,3,2,255,3,3,0,4,5,1,4,6,1,4,7,2,4,8,3,4,9,4,4,9,4,4,9,4,3,8,4,2,7,4,1,6,4,1,5,4,0,3,3,255,2,3,254,0,2,253,254,1,253,253,0,252,251,255,252,250,255,252,249,254,252,248,253,252,247,252
FLAMEY:
        .byte 254,0,2,253,254,1,253,253,0,252,251,255,252,250,255,252,249,254,252,248,253,252,247,252,252,247,252,252,247,252,253,248,252,254,249,252,255,250,252,255,251,252,0,253,253,1,254,253,2,0,254,3,2,255,3,3,0,4,5,1,4,6,1,4,7,2,4,8,3,4,9,4,4,9,4,4,9,4,3,8,4,2,7,4,1,6,4,1,5,4,0,3,3,255,2,3
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

; --- M5 collision / scoring lookups (indexed by kind = shape*3 + size) -------
SIZEOF: .byte 0,1,2,0,1,2,0,1,2 ; kind -> size (0 small, 1 med, 2 large)
RADT:   .byte 6,11,18,6,11,18,6,11,18   ; kind -> collision radius (px)
; points by size (psize): small=100, med=50, large=20, stored BCD little-endian
PTSL:   .byte $00,$50,$20
PTSH:   .byte $01,$00,$00

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

; reset to the attract/title state, then BRK (tests drive state transitions).
attract_brk:
        ldx #$FF
        txs
        jsr video_init
        jsr enter_attract
        brk

; run one frame, then snapshot the HUD into safe RAM before BRK clobbers the
; text page — lets tests validate the SCORE/SHIPS/title/game-over text.
frame_hud_brk:
        ldx #$FF
        txs
        jsr game_frame
        jsr hud_snapshot
        brk
