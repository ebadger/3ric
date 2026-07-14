; ============================================================================
; JUNGLE QUEST: THE SUNSTONE RUN
;                 an original action-platformer for the 3ric
;                 (65C02, Apple-II compatible)
;
; Six authored screens build a compact adventure out of a small verb set:
; run, jump, duck, climb, grab and release.  Recover four glyphs, open the
; temple, and claim the Sunstone before the expedition clock expires.  Fruit is
; optional but rewards risk with points and time.  Death restarts the current
; challenge instead of discarding all progress.
;
; The renderer uses:
;   * mixed hi-res mode (160px graphics + 4 text rows of HUD)
;   * 192-entry hi-res row-address table   (ROWL/ROWH at $6000/$6100)
;   * pixel-plot + sprite blit (OR draw)   with one x/7 divide per sprite
;   * clean background buffer BG at $4000   (erase = copy BG -> screen)
;   * BRK test hooks for the headless harness
;
; Build / run:
;   BRUN JUNGLE.PRG 0800      (loads the raw image to $0800 and jumps there)
; ============================================================================

; ---- soft switches (touched by reading them) ----
TXTCLR   = $C050        ; graphics (text off)
MIXSET   = $C053        ; mixed mode on  (bottom 4 rows are text = HUD)
LOWSCR   = $C054        ; display page 1
HIRES_SW = $C057        ; hi-res
KBD      = $C000        ; keyboard data (bit7 = key ready)
KBDSTRB  = $C010        ; clear keyboard strobe
PTRIG    = $C070        ; refresh ROM SNES-pad table (real hardware)
JOYMODE  = $CE15        ; 0 = SNES pads
GAMEPAD1 = $CEE0        ; one byte per button, 1 = pressed
PAD_B    = 0
PAD_START = 3
PAD_UP   = 4
PAD_DOWN = 5
PAD_LEFT = 6
PAD_RIGHT = 7
PAD_A    = 8

; ---- memory map ----
SCREEN   = $2000        ; hi-res page 1 (displayed)   $2000-$3FFF
BG       = $4000        ; clean background buffer     $4000-$5FFF
ROWL     = $6000        ; 192 bytes: low  byte of hi-res addr of pixel row y
ROWH     = $6100        ; 192 bytes: high byte of hi-res addr of pixel row y
BGDELTA  = $20          ; high-byte delta from SCREEN to BG ($40-$20)

; ---- text page 1 (HUD lines 20..23 in mixed mode) ----
TLINE20  = $0650
TLINE21  = $06D0
TLINE22  = $0750
TLINE23  = $07D0

; ---- persistent game state (absolute RAM at $6200, above the row tables) ----
STATE    = $6200
px_lo    = STATE+0      ; player x (pixels, 16-bit 0..279)
px_hi    = STATE+1
py       = STATE+2      ; player y (top of sprite)  == integer part of y
yfrac    = STATE+3      ; fractional part of y (8.8 fixed point with py)
vy_lo    = STATE+4      ; vertical velocity, signed 16-bit 8.8 px/frame
vy_hi    = STATE+5
facing   = STATE+6      ; 0 = right, 1 = left
pstate   = STATE+7      ; reserved for future animation states
onground = STATE+8      ; 1 = standing on ground
movetmr  = STATE+9      ; frames left of a horizontal move impulse
movedir  = STATE+10     ; 0 = right, 1 = left
jumpreq  = STATE+11     ; raw jump edge this frame
lives    = STATE+12
opx_lo   = STATE+13     ; previous drawn x (for erase)
opx_hi   = STATE+14
opy      = STATE+15     ; previous drawn y
ocol     = STATE+16     ; previous drawn byte column
score0   = STATE+17     ; BCD score (6 digits, little-endian pairs)
score1   = STATE+18
score2   = STATE+19
timeL    = STATE+20     ; reserved
timeH    = STATE+21
seedL    = STATE+22
seedH    = STATE+23
hz_x_lo  = STATE+24     ; moving threat x (16-bit)
hz_x_hi  = STATE+25
hz_dir   = STATE+26     ; 0 right, 1 left
ohz_lo   = STATE+27     ; previous drawn threat position
ohz_hi   = STATE+28
ohz_y    = STATE+29
ohz_col  = STATE+30
gamestate = STATE+31    ; 0 play, 1 win, 2 game over, 3 time up
tsec     = STATE+32     ; countdown units shown in the HUD
tframe   = STATE+33     ; frame subcounter for the timer
itemleft = STATE+34     ; active items (diagnostic / tests)
curscr   = STATE+35     ; current jungle screen (0..NSCR-1)
hz_type  = STATE+36     ; current threat kind
flipreq  = STATE+37     ; 0 none, 1 = go to next screen, $FF = previous
gap1_l   = STATE+38     ; ground gaps use byte-column [left,right)
gap1_r   = STATE+39
vine_on  = STATE+40     ; 1 = this screen has a swingable vine
vine_x   = STATE+41     ; vine anchor x (pixels)
onvine   = STATE+42     ; 1 = player currently riding the vine
vphase   = STATE+43     ; vine swing phase index
gap2_l   = STATE+44
gap2_r   = STATE+45
plat1_l  = STATE+46     ; raised platform descriptors (byte columns + top y)
plat1_r  = STATE+47
plat1_y  = STATE+48
plat2_l  = STATE+49
plat2_r  = STATE+50
plat2_y  = STATE+51
spawn_lo = STATE+52     ; checkpoint x for this screen
spawn_hi = STATE+53
coyote   = STATE+54     ; grace frames after leaving a ledge
jumpbuf  = STATE+55     ; buffered jump frames
ducktmr  = STATE+56     ; duck / brake latch
invuln   = STATE+57     ; post-respawn collision grace
prevpy   = STATE+58     ; y before integration (platform crossing test)
anim     = STATE+59     ; global animation phase
glyphs   = STATE+60     ; mandatory glyph count (0..4)
status_code = STATE+61  ; transient HUD message selector
status_tmr = STATE+62
pad_jump = STATE+63     ; gamepad jump edge latch
hz_min   = STATE+64
hz_max   = STATE+65
hz_spd   = STATE+66
hz_y     = STATE+67
hz_w     = STATE+68
hz_h     = STATE+69

; world-wide item table (NITEM entries, tagged by screen and kind)
item_x   = STATE+96
item_y   = STATE+107
item_on  = STATE+118
item_scr = STATE+129
item_kind = STATE+140

; ---- gameplay constants ----
RUNSPEED = 3            ; px / frame
MOVE_HOLD = 14          ; one browser key event creates a useful run impulse
PAD_HOLD = 2            ; refreshed while a real D-pad direction is held
DUCK_HOLD = 10          ; duck is also the keyboard brake
COYOTE_MAX = 4
JUMPBUF_MAX = 5
PLAYER_W = 12
PLAYER_FEET = 14        ; foot line = py + PLAYER_FEET
GROUND_TOP = 136        ; top pixel row of the ground band
STAND_Y  = 122          ; GROUND_TOP - PLAYER_FEET
DEATH_Y  = 170          ; falling past this = death
XMAX     = 267          ; 279 - PLAYER_W
NSCR     = 6            ; number of flip-screens in the expedition
ENTER_L  = 4            ; x when entering a screen from the left edge
ENTER_R  = 263          ; x when entering a screen from the right edge (XMAX-4)
TEMPLE_SCREEN = 4       ; right edge is gated until all glyphs are found
FINAL_SCREEN = 5
GLYPH_GOAL = 4
; GRAV = +$0030 (0.1875 px/frame^2), JUMP_V = -$0380, TERMV = +$0300
GRAV_LO  = $30
GRAV_HI  = $00
JUMP_LO  = $80
JUMP_HI  = $FC          ; -$0380
TERM_LO  = $00
TERM_HI  = $03
; threat and item kinds (suffixes avoid the assembler's case-insensitive names)
HZ_NONE_KIND = 0
HZ_BOULDER_KIND = 1
HZ_SNAKE_KIND = 2
HZ_BAT_KIND = 3
NITEM    = 11
ITEM_FRUIT_KIND = 0
ITEM_GLYPH_KIND = 1
ITEM_SUN_KIND = 2
ITEM_W   = 8
ITEM_H   = 10
FRUIT_SCORE_M = $05     ; +500 BCD
GLYPH_SCORE_M = $20     ; +2000 BCD
SUN_SCORE_M = $50       ; +5000 BCD
FRUIT_TIME = 5
TSEC0    = 90           ; starting countdown value
TICK     = 24           ; gameplay frames per displayed clock unit
DEATH_TIME = 5
RESPAWN_GRACE = 20
STATUS_HOLD = 28
; swingable vine
GRAB_R   = 16           ; grab if |centre_x - vine_x| <= this and airborne
SWING_VX = 4            ; px / frame the vine carries you to the right
VINE_Y0  = STAND_Y-20   ; body-top y at the top of the swing arc
SWING_HALF = 16         ; arc peaks (lowest point) at this frame...
SWING_FULL = 32         ; ...and folds back down by this frame
SWING_MAX = 40          ; hard release after this many frames (safety)
VINE_TOP = 40           ; vine is drawn from this pixel row...
VINE_BOT = 128          ; ...down to here (hangs above the swing level)

; ---- zero page (frame-transient scratch / pointers) ----
ptr      = $06          ; screen dest pointer      (+1)
bgptr    = $08          ; bg source pointer         (+1)
sprptr   = $0A          ; sprite / string pointer   (+1)
x_lo     = $0C          ; div7 input (16-bit)
x_hi     = $0D
col      = $0E          ; byte column   (x / 7)
bitn     = $0F          ; bit in byte   (x % 7)
tmp      = $10
tmp2     = $11
width    = $12          ; sprite width  (pixels)
height   = $13          ; sprite height (rows)
rbits    = $14          ; current sprite row bits   (+1, 16-bit)
startcol = $16          ; sprite left byte column
sbit     = $17          ; sprite left bit
cury     = $18          ; current pixel row being drawn
rowsleft = $19
sx_lo    = $1A          ; draw input: object x (16-bit)
sx_hi    = $1B
sy       = $1C          ; draw input: object y
er_col   = $1D          ; rect-erase: left byte column
er_y     = $1E          ; rect-erase: top row
er_wb    = $1F          ; rect-erase: width in bytes
er_h     = $20          ; rect-erase: height in rows
ti       = $21          ; loop index passed to helpers
fillv    = $22          ; background rectangle fill byte

        .org $0800

; ---------------------------------------------------------------------------
; entry
; ---------------------------------------------------------------------------
start:
        sei
        cld
        ldx #$FF
        txs
        stz JOYMODE             ; prior programs may have selected mouse mode
        lda TXTCLR              ; graphics on
        lda MIXSET              ; mixed mode (text HUD at bottom)
        lda LOWSCR              ; page 1
        lda HIRES_SW            ; hi-res
        jsr build_rows          ; hi-res row-address table
        jsr clear_screen        ; blank hi-res page 1
        jsr clear_bg            ; blank background buffer
        jsr clear_text          ; blank text page (spaces)
        jsr show_title          ; attract screen; returns when SPACE is pressed
newgame:
        jsr clear_screen        ; fresh playfield for a new game / restart
        jsr clear_bg
        jsr clear_text
        jsr init_state
        jsr draw_scene          ; static scene into BG, then copy to screen
        jsr draw_hud
        jsr init_render         ; seed prev-position + first player blit
        jsr draw_items
main:
        lda gamestate
        bne main_over
        jsr read_input
        jsr read_pad
        jsr update_player
        jsr update_hazard
        jsr collide_hazard
        jsr collect_items
        jsr tick_timer
        jsr tick_status
        inc anim
        jsr render_player
        jsr render_hazard
        jsr draw_items
        jsr update_hud
        jsr frame_delay
        jmp main
main_over:
        jsr show_end_msg
        jsr wait_start
        jmp newgame

; ---------------------------------------------------------------------------
; show_title : temple backdrop, hero + Sunstone, then keyboard/pad start.
; ---------------------------------------------------------------------------
show_title:
        lda #FINAL_SCREEN
        sta curscr
        jsr set_screen_vars
        jsr draw_scene
        lda #42
        sta sx_lo
        lda #0
        sta sx_hi
        lda #STAND_Y
        sta sy
        lda #<hero
        sta sprptr
        lda #>hero
        sta sprptr+1
        jsr draw_sprite
        lda #180
        sta sx_lo
        lda #0
        sta sx_hi
        lda #84
        sta sy
        lda #<sun_spr
        sta sprptr
        lda #>sun_spr
        sta sprptr+1
        jsr draw_sprite
        jsr draw_title_text
        jsr wait_start
        rts

; wait_start : SPACE or a valid real-hardware pad START/A/B press.
wait_start:
        lda KBD
        bpl ws_pad
        tax
        lda KBDSTRB
        txa
        cmp #$A0
        beq ws_done
ws_pad:
        lda PTRIG
        lda GAMEPAD1+PAD_LEFT
        and GAMEPAD1+PAD_RIGHT
        bne wait_start          ; impossible state: emulator placeholder
        lda GAMEPAD1+PAD_UP
        and GAMEPAD1+PAD_DOWN
        bne wait_start
        lda GAMEPAD1+PAD_START
        ora GAMEPAD1+PAD_A
        ora GAMEPAD1+PAD_B
        beq wait_start
ws_done:
        rts

; draw_title_text : title / tagline / controls / prompt across the 4 HUD lines.
draw_title_text:
        lda #<TLINE20
        sta ptr
        lda #>TLINE20
        sta ptr+1
        jsr clear_line
        lda #<str_ttl
        sta sprptr
        lda #>str_ttl
        sta sprptr+1
        jsr print
        lda #<TLINE21
        sta ptr
        lda #>TLINE21
        sta ptr+1
        jsr clear_line
        lda #<str_tag
        sta sprptr
        lda #>str_tag
        sta sprptr+1
        jsr print
        lda #<TLINE22
        sta ptr
        lda #>TLINE22
        sta ptr+1
        jsr clear_line
        lda #<str_ctl
        sta sprptr
        lda #>str_ctl
        sta sprptr+1
        jsr print
        lda #<TLINE23
        sta ptr
        lda #>TLINE23
        sta ptr+1
        jsr clear_line
        lda #<str_go
        sta sprptr
        lda #>str_go
        sta sprptr+1
        jsr print
        rts

; ---------------------------------------------------------------------------
; init_state : reset run-wide state, items, and the first screen checkpoint.
; ---------------------------------------------------------------------------
init_state:
        lda #0
        sta yfrac
        sta vy_lo
        sta vy_hi
        sta facing
        sta pstate
        sta movetmr
        sta movedir
        sta jumpreq
        sta jumpbuf
        sta coyote
        sta ducktmr
        sta invuln
        sta anim
        sta glyphs
        sta status_code
        sta status_tmr
        sta pad_jump
        sta score0
        sta score1
        sta score2
        sta tframe
        sta gamestate
        sta curscr
        sta flipreq
        sta onvine
        lda #1
        sta onground
        lda #3
        sta lives
        lda #TSEC0
        sta tsec
        jsr init_items
        jsr set_screen_vars
        lda spawn_lo
        sta px_lo
        lda spawn_hi
        sta px_hi
        lda #STAND_Y
        sta py
        rts

; init_items : copy immutable world data into the mutable item table.
init_items:
        ldx #0
ii_loop:
        lda item_x0,x
        sta item_x,x
        lda item_y0,x
        sta item_y,x
        lda item_scr0,x
        sta item_scr,x
        lda item_kind0,x
        sta item_kind,x
        lda #1
        sta item_on,x
        inx
        cpx #NITEM
        bne ii_loop
        lda #NITEM
        sta itemleft
        rts

; set_screen_vars : load terrain, checkpoint, vine, and threat descriptors.
set_screen_vars:
        ldx curscr
        lda scr_g1l,x
        sta gap1_l
        lda scr_g1r,x
        sta gap1_r
        lda scr_g2l,x
        sta gap2_l
        lda scr_g2r,x
        sta gap2_r
        lda scr_p1l,x
        sta plat1_l
        lda scr_p1r,x
        sta plat1_r
        lda scr_p1y,x
        sta plat1_y
        lda scr_p2l,x
        sta plat2_l
        lda scr_p2r,x
        sta plat2_r
        lda scr_p2y,x
        sta plat2_y
        lda scr_spawn,x
        sta spawn_lo
        lda #0
        sta spawn_hi
        lda scr_vine,x
        sta vine_on
        lda scr_vx,x
        sta vine_x
        lda scr_hztype,x
        sta hz_type
        lda scr_hzmin,x
        sta hz_min
        lda scr_hzmax,x
        sta hz_max
        sta hz_x_lo
        lda #0
        sta hz_x_hi
        lda scr_hzspd,x
        sta hz_spd
        lda scr_hzy,x
        sta hz_y
        lda scr_hzw,x
        sta hz_w
        lda scr_hzh,x
        sta hz_h
        lda #1
        sta hz_dir
        lda #0
        sta onvine
        sta invuln
        rts

; load_screen : rebuild the current screen and its HUD.
load_screen:
        jsr set_screen_vars
        jsr clear_screen
        jsr clear_bg
        jsr draw_scene
        jsr draw_hud
        jsr draw_items
        rts

; flip_screen : cross to the neighbouring screen (flipreq: 1 next, $FF prev),
; entering from the opposite edge, then rebuild + redraw everything.
flip_screen:
        lda flipreq
        bpl fs_next
        dec curscr
        lda #<ENTER_R
        sta px_lo
        lda #>ENTER_R
        sta px_hi
        jmp fs_common
fs_next:
        inc curscr
        lda #<ENTER_L
        sta px_lo
        lda #>ENTER_L
        sta px_hi
fs_common:
        lda #0
        sta flipreq
        sta yfrac
        sta vy_lo
        sta vy_hi
        sta movetmr
        sta ducktmr
        sta jumpbuf
        lda #STAND_Y
        sta py
        lda #1
        sta onground
        jsr load_screen
        jsr init_render
        rts

; init_render : prime the previous-position trackers and draw the hero once.
init_render:
        lda px_lo
        sta opx_lo
        lda px_hi
        sta opx_hi
        lda px_lo
        sta x_lo
        lda px_hi
        sta x_hi
        jsr div7
        lda col
        sta ocol
        jsr draw_player
        lda py                  ; 16-row physics box covers every player pose
        sta opy
        lda hz_type
        beq ir_done
        lda hz_x_lo
        sta ohz_lo
        lda hz_x_hi
        sta ohz_hi
        lda hz_y
        sta ohz_y
        lda hz_x_lo
        sta x_lo
        lda hz_x_hi
        sta x_hi
        jsr div7
        lda col
        sta ohz_col
        jsr draw_hazard
ir_done:
        rts

; ---------------------------------------------------------------------------
; read_input : keyboard events become short action latches.  That lets a single
; browser keydown carry motion while a later jump/duck event remains responsive.
; ---------------------------------------------------------------------------
read_input:
        lda #0
        sta jumpreq
        lda KBD
        bpl ri_done             ; bit7 clear -> no key waiting
        tax                     ; keep the key code
        lda KBDSTRB             ; clear the strobe
        txa
        cmp #$88
        beq ri_left
        cmp #$C1
        beq ri_left
        cmp #$95
        beq ri_right
        cmp #$C4
        beq ri_right
        cmp #$A0
        beq ri_jump
        cmp #$8B
        beq ri_jump
        cmp #$D7
        beq ri_jump
        cmp #$8A
        beq ri_duck
        cmp #$D3
        beq ri_duck
        bne ri_done
ri_left:
        lda #1
        sta movedir
        lda #MOVE_HOLD
        sta movetmr
        bne ri_done
ri_right:
        lda #0
        sta movedir
        lda #MOVE_HOLD
        sta movetmr
        jmp ri_done
ri_jump:
        lda #1
        sta jumpreq
        lda #JUMPBUF_MAX
        sta jumpbuf
        lda #0
        sta ducktmr
        bra ri_done
ri_duck:
        lda #DUCK_HOLD
        sta ducktmr
        lda #0                  ; duck doubles as a precise brake
        sta movetmr
ri_done:
        rts

; ---------------------------------------------------------------------------
; read_pad : continuous controls on real hardware.  Reject opposing directions;
; the emulator's unmodelled pad reports all buttons and is therefore ignored.
; ---------------------------------------------------------------------------
read_pad:
        lda PTRIG
        lda GAMEPAD1+PAD_LEFT
        and GAMEPAD1+PAD_RIGHT
        bne rpad_done
        lda GAMEPAD1+PAD_UP
        and GAMEPAD1+PAD_DOWN
        bne rpad_done
        lda GAMEPAD1+PAD_LEFT
        beq rpad_right
        lda #1
        sta movedir
        lda #PAD_HOLD
        sta movetmr
rpad_right:
        lda GAMEPAD1+PAD_RIGHT
        beq rpad_down
        lda #0
        sta movedir
        lda #PAD_HOLD
        sta movetmr
rpad_down:
        lda GAMEPAD1+PAD_DOWN
        beq rpad_jumpcheck
        lda #PAD_HOLD
        sta ducktmr
        lda #0
        sta movetmr
rpad_jumpcheck:
        lda GAMEPAD1+PAD_UP
        ora GAMEPAD1+PAD_A
        ora GAMEPAD1+PAD_B
        beq rpad_release
        lda pad_jump
        bne rpad_done
        lda #1
        sta pad_jump
        sta jumpreq
        lda #JUMPBUF_MAX
        sta jumpbuf
        lda #0
        sta ducktmr
        rts
rpad_release:
        lda #0
        sta pad_jump
rpad_done:
        rts

; ---------------------------------------------------------------------------
; update_player : buffered/coyote jump, movement, 8.8 gravity, terrain collision.
; ---------------------------------------------------------------------------
update_player:
        lda invuln
        beq up_duck
        dec invuln
up_duck:
        lda ducktmr
        beq up_grace
        dec ducktmr
up_grace:
        lda onground
        beq up_decaygrace
        lda #COYOTE_MAX
        sta coyote
        bra up_vine
up_decaygrace:
        lda coyote
        beq up_vine
        dec coyote
up_vine:
        lda onvine
        beq up_notvine
        lda jumpbuf             ; Jump actively releases the vine
        beq up_swing
        lda #0
        sta onvine
        sta jumpbuf
        sta yfrac
        sta movedir             ; release keeps rightward momentum
        lda #10
        sta movetmr
        lda #$80
        sta vy_lo
        lda #$FD                ; -$0280, enough to risk the bonus fruit
        sta vy_hi
        rts
up_swing:
        jsr vine_swing
        rts
up_notvine:
        lda jumpbuf
        beq up_nojump
        lda onground
        bne up_jump
        lda coyote
        beq up_agejump
up_jump:
        lda #JUMP_LO
        sta vy_lo
        lda #JUMP_HI
        sta vy_hi
        lda #0
        sta onground
        sta coyote
        sta jumpbuf
        sta ducktmr
        bra up_nojump
up_agejump:
        dec jumpbuf
up_nojump:
        lda movetmr             ; horizontal move impulse
        beq up_nomove
        dec movetmr
        lda movedir
        bne up_left
        jsr move_right
        jmp up_nomove
up_left:
        jsr move_left
up_nomove:
        lda flipreq             ; a horizontal move can push off-screen
        beq up_nofl
        jsr flip_screen         ; cross to the neighbour, rebuild, redraw
        rts                     ; fresh screen: resume physics next frame
up_nofl:
        lda py
        sta prevpy
        clc                     ; y (8.8) += vy
        lda yfrac
        adc vy_lo
        sta yfrac
        lda py
        adc vy_hi
        sta py
        clc                     ; vy += gravity
        lda vy_lo
        adc #GRAV_LO
        sta vy_lo
        lda vy_hi
        adc #GRAV_HI
        sta vy_hi
        lda vy_hi               ; clamp terminal fall speed
        bmi up_novc
        cmp #TERM_HI+1
        bcc up_novc
        lda #TERM_LO
        sta vy_lo
        lda #TERM_HI
        sta vy_hi
up_novc:
        jsr check_ground
        jsr try_grab_vine       ; latch onto a vine when airborne beside it
        lda onvine
        bne up_done             ; on the vine now -> safe, skip the death test
        lda py                  ; death by falling into a pit
        cmp #DEATH_Y
        bcc up_done
        jsr player_die
up_done:
        rts

; ---------------------------------------------------------------------------
; try_grab_vine : if this screen has a vine, we're airborne, and our centre is
;   within GRAB_R of the vine, latch on (onvine=1, vphase=0).
; ---------------------------------------------------------------------------
try_grab_vine:
        lda vine_on
        beq tg_no
        lda onvine
        bne tg_no               ; already swinging
        lda onground
        bne tg_no               ; must be airborne
        lda py                  ; body must overlap the visible rope
        cmp #VINE_BOT
        bcs tg_no
        clc
        adc #PLAYER_FEET
        cmp #VINE_TOP+1
        bcc tg_no
        clc                     ; centre x = px + 6
        lda px_lo
        adc #6
        sta tmp
        lda px_hi
        adc #0
        sta tmp2
        sec                     ; d = centre - vine_x
        lda tmp
        sbc vine_x
        sta tmp
        lda tmp2
        sbc #0
        sta tmp2
        lda tmp2
        bpl tg_abs              ; d >= 0 already
        sec                     ; negate 16-bit d
        lda #0
        sbc tmp
        sta tmp
        lda #0
        sbc tmp2
        sta tmp2
tg_abs:
        lda tmp2
        bne tg_no               ; |d| >= 256 -> far away
        lda tmp
        cmp #GRAB_R+1
        bcs tg_no               ; |d| > GRAB_R
        lda #1                  ; grab!
        sta onvine
        lda #0
        sta vphase
        sta vy_lo
        sta vy_hi
        sta yfrac
tg_no:
        rts

; ---------------------------------------------------------------------------
; vine_swing : carry right along a shallow pendulum arc.  Jump can release early;
; reaching the far bank releases automatically so the crossing stays forgiving.
; ---------------------------------------------------------------------------
vine_swing:
        clc                     ; carry the hero rightward across the pit
        lda px_lo
        adc #SWING_VX
        sta px_lo
        lda px_hi
        adc #0
        sta px_hi
        inc vphase              ; arc: dip = min(vphase, SWING_FULL-vphase)
        lda vphase
        cmp #SWING_HALF
        bcc vs_rise
        lda #SWING_FULL
        sec
        sbc vphase
        jmp vs_dip
vs_rise:
        lda vphase
vs_dip:
        bpl vs_pos              ; clamp dip >= 0 (past SWING_FULL)
        lda #0
vs_pos:
        clc                     ; py = VINE_Y0 + dip
        adc #VINE_Y0
        sta py
        lda #0
        sta yfrac
        sta vy_lo
        sta vy_hi
        clc                     ; centre col past the pit's right edge?
        lda px_lo
        adc #6
        sta x_lo
        lda px_hi
        adc #0
        sta x_hi
        jsr div7
        lda col
        cmp gap1_r
        bcs vs_release          ; over solid ground on the far side -> drop
        lda vphase
        cmp #SWING_MAX
        bcc vs_hold             ; keep swinging
vs_release:
        lda #0
        sta onvine
        sta vy_lo
        sta vy_hi
        sta yfrac
vs_hold:
        rts

; ---------------------------------------------------------------------------
; check_ground : land on either raised platform or solid ground.  Platforms are
; one-way: the previous and current foot positions must cross their top.
; ---------------------------------------------------------------------------
check_ground:
        clc                     ; centre x = px + 6
        lda px_lo
        adc #6
        sta x_lo
        lda px_hi
        adc #0
        sta x_hi
        jsr div7                ; col = centre / 7
        lda vy_hi
        bpl cg_falling
        jmp cg_air              ; rising: pass upward through platforms
cg_falling:

        lda plat1_l
        cmp plat1_r
        beq cg_p2
        lda col
        cmp plat1_l
        bcc cg_p2
        cmp plat1_r
        bcs cg_p2
        lda prevpy
        clc
        adc #PLAYER_FEET
        cmp plat1_y
        bcc cg_p1new
        bne cg_p2
cg_p1new:
        lda py
        clc
        adc #PLAYER_FEET
        cmp plat1_y
        bcc cg_p2
        lda plat1_y
        jmp cg_land

cg_p2:
        lda plat2_l
        cmp plat2_r
        beq cg_groundcheck
        lda col
        cmp plat2_l
        bcc cg_groundcheck
        cmp plat2_r
        bcs cg_groundcheck
        lda prevpy
        clc
        adc #PLAYER_FEET
        cmp plat2_y
        bcc cg_p2new
        bne cg_groundcheck
cg_p2new:
        lda py
        clc
        adc #PLAYER_FEET
        cmp plat2_y
        bcc cg_groundcheck
        lda plat2_y
        jmp cg_land

cg_groundcheck:
        lda col
        cmp gap1_l
        bcc cg_gap2
        cmp gap1_r
        bcc cg_air
cg_gap2:
        lda col
        cmp gap2_l
        bcc cg_ground
        cmp gap2_r
        bcc cg_air
cg_ground:
        lda py
        clc
        adc #PLAYER_FEET
        cmp #GROUND_TOP
        bcc cg_air
        lda #GROUND_TOP
cg_land:
        sec
        sbc #PLAYER_FEET
        sta py
        lda #0
        sta yfrac
        sta vy_lo
        sta vy_hi
        lda #1
        sta onground
        rts
cg_air:
        lda #0
        sta onground
        rts

; move_right / move_left : shift px by RUNSPEED, clamp to [0, XMAX], set facing.
move_right:
        lda #0
        sta facing
        clc
        lda px_lo
        adc #RUNSPEED
        sta px_lo
        lda px_hi
        adc #0
        sta px_hi
        lda px_hi
        cmp #>XMAX
        bcc mr_ok               ; px_hi < hi(XMAX) -> in range
        bne mr_over             ; px_hi > hi(XMAX) -> past edge
        lda px_lo
        cmp #<XMAX+1
        bcc mr_ok               ; px <= XMAX
mr_over:
        lda curscr
        cmp #TEMPLE_SCREEN
        bne mr_world
        lda glyphs
        cmp #GLYPH_GOAL
        bcs mr_world
        lda #3                  ; gate message; stay at the ruins edge
        sta status_code
        lda #STATUS_HOLD
        sta status_tmr
        bra mr_clamp
mr_world:
        lda curscr
        cmp #NSCR-1
        bcs mr_clamp            ; last screen -> clamp at world edge
        lda #1                  ; else cross to the next screen
        sta flipreq
        rts
mr_clamp:
        lda #<XMAX
        sta px_lo
        lda #>XMAX
        sta px_hi
mr_ok:
        rts

move_left:
        lda #1
        sta facing
        sec
        lda px_lo
        sbc #RUNSPEED
        sta px_lo
        lda px_hi
        sbc #0
        sta px_hi
        lda px_hi
        bpl ml_ok               ; still >= 0
        lda curscr
        beq ml_clamp            ; first screen -> clamp at left edge
        lda #$FF                ; else cross to the previous screen
        sta flipreq
        rts
ml_clamp:
        lda #0
        sta px_lo
        sta px_hi
ml_ok:
        rts

; player_die : keep run progress, but charge a life and five clock units before
; respawning at this screen's checkpoint with brief collision grace.
player_die:
        dec lives
        bne pd_respawn
        lda #2                  ; out of lives -> game over
        sta gamestate
        rts
pd_respawn:
        lda tsec
        cmp #DEATH_TIME+1
        bcs pd_timeok
        lda #0
        sta tsec
        lda #3
        sta gamestate
        rts
pd_timeok:
        sec
        sbc #DEATH_TIME
        sta tsec
        lda spawn_lo
        sta px_lo
        lda spawn_hi
        sta px_hi
        lda #STAND_Y
        sta py
        lda #0
        sta yfrac
        sta vy_lo
        sta vy_hi
        sta movetmr
        sta ducktmr
        sta jumpbuf
        sta onvine
        lda #1
        sta onground
        lda #COYOTE_MAX
        sta coyote
        lda #RESPAWN_GRACE
        sta invuln
        lda #4
        sta status_code
        lda #STATUS_HOLD
        sta status_tmr
        rts

; ---------------------------------------------------------------------------
; render_player : erase the hero at its previous spot (BG copy) then redraw.
; ---------------------------------------------------------------------------
render_player:
        lda ocol
        sta er_col
        lda opy
        sta er_y
        lda #40                 ; wb = min(3, 40 - ocol)
        sec
        sbc ocol
        cmp #3
        bcs rp_wb3
        sta er_wb
        jmp rp_wbset
rp_wb3:
        lda #3
        sta er_wb
rp_wbset:
        lda #16
        sta er_h
        jsr rect_erase
        jsr draw_player
        lda px_lo               ; remember this frame's position for next erase
        sta opx_lo
        lda px_hi
        sta opx_hi
        lda py                  ; never let the duck offset push erase past row 191
        sta opy
        lda px_lo
        sta x_lo
        lda px_hi
        sta x_hi
        jsr div7
        lda col
        sta ocol
        rts

; ---------------------------------------------------------------------------
; update_hazard : ping-pong the screen's threat between descriptor bounds.
; ---------------------------------------------------------------------------
update_hazard:
        lda hz_type
        bne uh_go
        rts
uh_go:
        lda hz_dir
        beq uh_right
        sec
        lda hz_x_lo
        sbc hz_spd
        sta hz_x_lo
        cmp hz_min
        bcs uh_done
        lda hz_min
        sta hz_x_lo
        lda #0
        sta hz_dir
        rts
uh_right:
        clc
        lda hz_x_lo
        adc hz_spd
        sta hz_x_lo
        cmp hz_max
        bcc uh_done
        lda hz_max
        sta hz_x_lo
        lda #1
        sta hz_dir
uh_done:
        rts

; ---------------------------------------------------------------------------
; collide_hazard : AABB with a low ducking box.  A shoulder-height bat hits a
; standing runner but passes over a duck; ground threats still require jumping.
; ---------------------------------------------------------------------------
collide_hazard:
        lda hz_type
        beq ch_no
        lda invuln
        bne ch_no
        clc                     ; threat right -> tmp/tmp2
        lda hz_x_lo
        adc hz_w
        sta tmp
        lda hz_x_hi
        adc #0
        sta tmp2
        lda px_lo
        cmp tmp
        lda px_hi
        sbc tmp2
        bcs ch_no
        clc                     ; player right -> tmp/tmp2
        lda px_lo
        adc #PLAYER_W
        sta tmp
        lda px_hi
        adc #0
        sta tmp2
        lda hz_x_lo
        cmp tmp
        lda hz_x_hi
        sbc tmp2
        bcs ch_no
        lda py                  ; player collision top/height
        sta er_y
        lda #PLAYER_FEET
        sta er_h
        lda ducktmr
        beq ch_vertical
        lda py
        clc
        adc #8
        sta er_y
        lda #6
        sta er_h
ch_vertical:
        clc
        lda hz_y
        adc hz_h
        sta tmp
        lda er_y
        cmp tmp
        bcs ch_no
        clc
        lda er_y
        adc er_h
        cmp hz_y
        bcc ch_no
        beq ch_no
        jsr player_die
ch_no:
        rts

; draw_hazard : select art by threat kind, then blit at descriptor position.
draw_hazard:
        lda hz_x_lo
        sta sx_lo
        lda hz_x_hi
        sta sx_hi
        lda hz_y
        sta sy
        lda hz_type
        cmp #HZ_BOULDER_KIND
        bne dh_snake
        lda #<boulder_spr
        sta sprptr
        lda #>boulder_spr
        sta sprptr+1
        jmp draw_sprite
dh_snake:
        cmp #HZ_SNAKE_KIND
        bne dh_bat
        lda #<snake_spr
        sta sprptr
        lda #>snake_spr
        sta sprptr+1
        jmp draw_sprite
dh_bat:
        lda anim
        and #4
        beq dh_bat1
        lda #<bat2_spr
        sta sprptr
        lda #>bat2_spr
        sta sprptr+1
        jmp draw_sprite
dh_bat1:
        lda #<bat1_spr
        sta sprptr
        lda #>bat1_spr
        sta sprptr+1
        jmp draw_sprite

; render_hazard : erase the previous maximum-size cell, redraw, save position.
render_hazard:
        lda hz_type
        bne rh_go
        rts
rh_go:
        lda ohz_col
        sta er_col
        lda ohz_y
        sta er_y
        lda #40
        sec
        sbc ohz_col
        cmp #4
        bcs rh_wb4
        sta er_wb
        jmp rh_wbset
rh_wb4:
        lda #4
        sta er_wb
rh_wbset:
        lda #12
        sta er_h
        jsr rect_erase
        jsr draw_hazard
        lda hz_x_lo
        sta ohz_lo
        lda hz_x_hi
        sta ohz_hi
        lda hz_y
        sta ohz_y
        lda hz_x_lo
        sta x_lo
        lda hz_x_hi
        sta x_hi
        jsr div7
        lda col
        sta ohz_col
        rts

; ---------------------------------------------------------------------------
; collect_items : active on-screen item AABB, then apply kind-specific reward.
; ---------------------------------------------------------------------------
collect_items:
        ldx #0
ci_loop:
        stx ti
        lda item_on,x
        beq ci_miss
        lda item_scr,x
        cmp curscr
        bne ci_miss
        lda item_x,x            ; item right -> tmp/tmp2
        clc
        adc #ITEM_W
        sta tmp
        lda #0
        adc #0
        sta tmp2
        lda px_lo
        cmp tmp
        lda px_hi
        sbc tmp2
        bcs ci_miss
        clc
        lda px_lo
        adc #PLAYER_W
        sta tmp
        lda px_hi
        adc #0
        sta tmp2
        lda item_x,x
        cmp tmp
        lda #0
        sbc tmp2
        bcs ci_miss
        lda item_y,x
        clc
        adc #ITEM_H
        sta tmp
        lda py
        cmp tmp
        bcs ci_miss
        lda py
        clc
        adc #PLAYER_FEET
        cmp item_y,x
        bcc ci_miss
        bra ci_hit
ci_miss:
        jmp ci_next
ci_hit:
        lda #0
        sta item_on,x
        dec itemleft
        jsr erase_item
        ldx ti
        lda item_kind,x
        cmp #ITEM_GLYPH_KIND
        beq ci_glyph
        cmp #ITEM_SUN_KIND
        beq ci_sun
ci_fruit:
        lda #FRUIT_SCORE_M
        jsr add_score_m
        clc
        lda tsec
        adc #FRUIT_TIME
        cmp #100
        bcc ci_fruit_time
        lda #99
ci_fruit_time:
        sta tsec
        lda #1
        sta status_code
        bra ci_status
ci_glyph:
        inc glyphs
        lda #GLYPH_SCORE_M
        jsr add_score_m
        lda #2
        sta status_code
        bra ci_status
ci_sun:
        lda #SUN_SCORE_M
        jsr add_score_m
        lda #1
        sta gamestate
        lda #5
        sta status_code
ci_status:
        lda #STATUS_HOLD
        sta status_tmr
ci_next:
        ldx ti
        inx
        cpx #NITEM
        beq ci_done
        jmp ci_loop
ci_done:
        rts

; add_score_m : A is a packed-BCD increment for score1 (hundreds/thousands).
add_score_m:
        sta tmp
        sed
        clc
        lda score0
        adc #$00
        sta score0
        lda score1
        adc tmp
        sta score1
        lda score2
        adc #$00
        sta score2
        cld
        rts

; erase_item : clear item[ti] from the screen by restoring the static BG.
erase_item:
        ldy ti
        lda item_y,y
        sta er_y
        lda item_x,y
        sta x_lo
        lda #0
        sta x_hi
        jsr div7
        lda col
        sta er_col
        lda #40
        sec
        sbc er_col
        cmp #3
        bcs et_wb3
        sta er_wb
        jmp et_wbset
et_wb3:
        lda #3
        sta er_wb
et_wbset:
        lda #ITEM_H
        sta er_h
        jsr rect_erase
        rts

; draw_items : fruit, progression glyphs, and the final Sunstone.
draw_items:
        ldx #0
dt_loop:
        stx ti
        lda item_on,x
        beq dt_next
        lda item_scr,x
        cmp curscr
        bne dt_next
        lda item_x,x
        sta sx_lo
        lda #0
        sta sx_hi
        lda item_y,x
        sta sy
        lda item_kind,x
        cmp #ITEM_GLYPH_KIND
        beq dt_glyph
        cmp #ITEM_SUN_KIND
        beq dt_sun
        lda #<fruit_spr
        sta sprptr
        lda #>fruit_spr
        sta sprptr+1
        bra dt_draw
dt_glyph:
        lda #<glyph_spr
        sta sprptr
        lda #>glyph_spr
        sta sprptr+1
        bra dt_draw
dt_sun:
        lda #<sun_spr
        sta sprptr
        lda #>sun_spr
        sta sprptr+1
dt_draw:
        jsr draw_sprite
dt_next:
        ldx ti
        inx
        cpx #NITEM
        bne dt_loop
        rts

; tick_timer : advance the countdown; time-up ends the game.
tick_timer:
        lda gamestate
        bne tt_done             ; victory/death resolved earlier in this frame
        inc tframe
        lda tframe
        cmp #TICK
        bcc tt_done
        lda #0
        sta tframe
        lda tsec
        beq tt_zero
        dec tsec
        lda tsec
        bne tt_done
tt_zero:
        lda #3
        sta gamestate
tt_done:
        rts

tick_status:
        lda status_tmr
        beq ts_done
        dec status_tmr
        bne ts_done
        lda #0
        sta status_code
ts_done:
        rts

; ---------------------------------------------------------------------------
; update_hud : refresh the score / time / lives digits on the HUD line.
; ---------------------------------------------------------------------------
update_hud:
        ldx #6                  ; score digits at columns 6..11
        lda score2
        jsr emit2
        lda score1
        jsr emit2
        lda score0
        jsr emit2
        lda tsec                ; time digits at columns 19..20
        jsr bin2bcd
        ldx #18
        jsr emit2
        lda lives
        ora #$B0
        sta TLINE22+26
        lda glyphs
        ora #$B0
        sta TLINE22+34
        jsr draw_status_line
        rts

draw_status_line:
        lda #<TLINE23
        sta ptr
        lda #>TLINE23
        sta ptr+1
        jsr clear_line
        lda status_code
        beq dsl_controls
        cmp #1
        beq dsl_fruit
        cmp #2
        beq dsl_glyph
        cmp #3
        beq dsl_gate
        cmp #4
        beq dsl_ouch
        lda #<msg_sun
        sta sprptr
        lda #>msg_sun
        bra dsl_print_hi
dsl_controls:
        lda #<str_playctl
        sta sprptr
        lda #>str_playctl
        bra dsl_print_hi
dsl_fruit:
        lda #<msg_fruit
        sta sprptr
        lda #>msg_fruit
        bra dsl_print_hi
dsl_glyph:
        lda #<msg_glyph
        sta sprptr
        lda #>msg_glyph
        bra dsl_print_hi
dsl_gate:
        lda #<msg_gate
        sta sprptr
        lda #>msg_gate
        bra dsl_print_hi
dsl_ouch:
        lda #<msg_ouch
        sta sprptr
        lda #>msg_ouch
dsl_print_hi:
        sta sprptr+1
        jmp print

; emit2 : A = BCD byte, X = column offset into TLINE22; writes 2 digits, X += 2
emit2:
        pha
        lsr a
        lsr a
        lsr a
        lsr a
        ora #$B0
        sta TLINE22,x
        inx
        pla
        and #$0F
        ora #$B0
        sta TLINE22,x
        inx
        rts

; bin2bcd : A (0..99) -> packed BCD
bin2bcd:
        ldx #0
bb_loop:
        cmp #10
        bcc bb_done
        sbc #10
        inx
        jmp bb_loop
bb_done:
        sta tmp
        txa
        asl a
        asl a
        asl a
        asl a
        ora tmp
        rts

; ---------------------------------------------------------------------------
; show_end_msg : write the win / lose banner to the top HUD line.
; ---------------------------------------------------------------------------
show_end_msg:
        lda #<TLINE20
        sta ptr
        lda #>TLINE20
        sta ptr+1
        jsr clear_line
        lda gamestate
        cmp #1
        bne sem_notwin
        lda #<msg_win
        sta sprptr
        lda #>msg_win
        sta sprptr+1
        jmp sem_print
sem_notwin:
        cmp #3
        bne sem_over
        lda #<msg_time
        sta sprptr
        lda #>msg_time
        sta sprptr+1
        jmp sem_print
sem_over:
        lda #<msg_over
        sta sprptr
        lda #>msg_over
        sta sprptr+1
sem_print:
        jsr print
        rts

; clear_line : fill the 40-char text line at (ptr) with spaces.
clear_line:
        ldy #0
        lda #$A0
cl_loop:
        sta (ptr),y
        iny
        cpy #40
        bne cl_loop
        rts

; frame_delay : burn a fixed number of cycles so the game runs at a steady pace.
frame_delay:
        ldx #30
fd_o:
        ldy #0
fd_i:
        dey
        bne fd_i
        dex
        bne fd_o
        rts

; ---------------------------------------------------------------------------
; build_rows : ROWL/ROWH[y] = hi-res address of pixel row y (y = 0..191)
;   high = $20 + (y&7)*4 + ((y>>3)&7)>>1
;   low  =       ((y>>3)&7 & 1 ? $80 : 0) + (y>>6)*$28
; ---------------------------------------------------------------------------
build_rows:
        ldx #0
br_loop:
        txa
        and #7
        asl a
        asl a                   ; (y&7)*4
        clc
        adc #$20
        sta tmp                 ; high base
        txa
        lsr a
        lsr a
        lsr a
        and #7                  ; ym = (y>>3)&7
        sta tmp2
        lsr a                   ; ym>>1
        clc
        adc tmp
        sta ROWH,x
        lda #0
        sta tmp                 ; low accumulator
        lda tmp2
        and #1
        beq br_nolo
        lda #$80
        sta tmp
br_nolo:
        txa
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a                   ; y>>6  (0..2)
        beq br_lowdone
        tay
br_add28:
        lda tmp
        clc
        adc #$28
        sta tmp
        dey
        bne br_add28
br_lowdone:
        lda tmp
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
; clear_bg : background buffer -> 0
; ---------------------------------------------------------------------------
clear_bg:
        lda #>BG
        sta ptr+1
        lda #0
        sta ptr
        ldx #$20                ; 32 pages ($4000-$5FFF)
cb_pg:
        ldy #0
        lda #0
cb_by:
        sta (ptr),y
        iny
        bne cb_by
        inc ptr+1
        dex
        bne cb_pg
        rts

; ---------------------------------------------------------------------------
; clear_text : text page 1 -> spaces ($A0)
; ---------------------------------------------------------------------------
clear_text:
        lda #$A0
        ldx #0
ct_by:
        sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne ct_by
        rts

; ---------------------------------------------------------------------------
; div7 : x_lo/x_hi (0..279) -> col = x/7, bitn = x%7   (subtract loop)
; ---------------------------------------------------------------------------
div7:
        lda #0
        sta col
d7_loop:
        lda x_hi
        bne d7_sub              ; x >= 256 -> definitely >= 7
        lda x_lo
        cmp #7
        bcc d7_done             ; x_lo < 7 -> remainder
d7_sub:
        lda x_lo
        sec
        sbc #7
        sta x_lo
        lda x_hi
        sbc #0
        sta x_hi
        inc col
        jmp d7_loop
d7_done:
        lda x_lo
        sta bitn
        rts

; ---------------------------------------------------------------------------
; plot : set one pixel at (sx_lo/sx_hi , sy)
; ---------------------------------------------------------------------------
plot:
        lda sx_lo
        sta x_lo
        lda sx_hi
        sta x_hi
        jsr div7
        ldy sy
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        ldy col
        lda (ptr),y
        ldx bitn
        ora BITMASK,x
        ldy col
        sta (ptr),y
        rts

; ---------------------------------------------------------------------------
; draw_sprite : OR a sprite onto the screen.
;   sprptr -> {width, height, then height rows of 2 bytes (hi=cols0-7,
;   lo=cols8-15), leftmost pixel = bit7 of hi byte}.
;   position from sx_lo/sx_hi (x) and sy (top y).
; ---------------------------------------------------------------------------
draw_sprite:
        ldy #0
        lda (sprptr),y
        sta width
        iny
        lda (sprptr),y
        sta height
        clc                     ; advance sprptr past the 2-byte header
        lda sprptr
        adc #2
        sta sprptr
        lda sprptr+1
        adc #0
        sta sprptr+1
        lda sx_lo               ; base column / bit from x
        sta x_lo
        lda sx_hi
        sta x_hi
        jsr div7
        lda col
        sta startcol
        lda bitn
        sta sbit
        lda sy
        sta cury
        lda height
        sta rowsleft
ds_row:
        ldy #0
        lda (sprptr),y          ; hi byte (cols 0-7)
        sta rbits+1
        iny
        lda (sprptr),y          ; lo byte (cols 8-15)
        sta rbits
        ldy cury                ; screen row pointer
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        lda startcol
        sta col
        lda sbit
        sta bitn
        ldx width
ds_col:
        asl rbits
        rol rbits+1             ; carry = next pixel (MSB first)
        bcc ds_skip
        ldy col
        lda (ptr),y
        sta tmp
        ldy bitn
        lda BITMASK,y
        ora tmp
        ldy col
        sta (ptr),y
ds_skip:
        inc bitn
        lda bitn
        cmp #7
        bcc ds_noadv
        lda #0
        sta bitn
        inc col
ds_noadv:
        dex
        bne ds_col
        clc                     ; next row of sprite data (+2)
        lda sprptr
        adc #2
        sta sprptr
        lda sprptr+1
        adc #0
        sta sprptr+1
        inc cury
        dec rowsleft
        bne ds_row
        rts

; ---------------------------------------------------------------------------
; rect_erase : copy er_wb bytes x er_h rows from BG back onto SCREEN,
;   starting at byte column er_col, pixel row er_y.
; ---------------------------------------------------------------------------
rect_erase:
        lda er_y
        sta cury
        lda er_h
        sta rowsleft
re_row:
        ldy cury
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        lda ptr
        sta bgptr
        lda ptr+1
        clc
        adc #BGDELTA
        sta bgptr+1
        ldx er_wb
        ldy er_col
re_col:
        lda (bgptr),y
        sta (ptr),y
        iny
        dex
        bne re_col
        inc cury
        dec rowsleft
        bne re_row
        rts

; ---------------------------------------------------------------------------
; copy_bg : BG ($4000-$5FFF) -> SCREEN ($2000-$3FFF)
; ---------------------------------------------------------------------------
copy_bg:
        lda #>BG
        sta bgptr+1
        lda #>SCREEN
        sta ptr+1
        lda #0
        sta bgptr
        sta ptr
        ldx #$20
cbg_pg:
        ldy #0
cbg_by:
        lda (bgptr),y
        sta (ptr),y
        iny
        bne cbg_by
        inc bgptr+1
        inc ptr+1
        dex
        bne cbg_pg
        rts

; ---------------------------------------------------------------------------
; fill_bg_rect : er_col/er_y/er_wb/er_h rectangle in BG, filled with fillv.
; ---------------------------------------------------------------------------
fill_bg_rect:
        lda er_y
        sta cury
        lda er_h
        sta rowsleft
fbr_row:
        ldy cury
        lda ROWL,y
        sta bgptr
        lda ROWH,y
        clc
        adc #BGDELTA
        sta bgptr+1
        ldy er_col
        ldx er_wb
        lda fillv
fbr_col:
        sta (bgptr),y
        iny
        dex
        bne fbr_col
        inc cury
        dec rowsleft
        bne fbr_row
        rts

; ---------------------------------------------------------------------------
; draw_scene : layered jungle, textured ground, water gaps, raised platforms,
; vines, and ruins.  Everything lands in BG before one copy to the display.
; ---------------------------------------------------------------------------
draw_scene:
        lda #0                  ; canopy shadow
        sta er_col
        lda #8
        sta er_y
        lda #40
        sta er_wb
        lda #5
        sta er_h
        lda #$15
        sta fillv
        jsr fill_bg_rect
        lda #13
        sta er_y
        lda #2
        sta er_h
        lda #$2A
        sta fillv
        jsr fill_bg_rect

        lda #2                  ; two distant trunks frame the route
        sta er_col
        lda #15
        sta er_y
        lda #2
        sta er_wb
        lda #121
        sta er_h
        lda #$49
        sta fillv
        jsr fill_bg_rect
        lda #36
        sta er_col
        jsr fill_bg_rect

        lda #0                  ; bright ground lip
        sta er_col
        lda #GROUND_TOP
        sta er_y
        lda #40
        sta er_wb
        lda #4
        sta er_h
        lda #$7F
        sta fillv
        jsr fill_bg_rect
        lda #140                ; textured soil below it
        sta er_y
        lda #20
        sta er_h
        lda #$55
        sta fillv
        jsr fill_bg_rect

        jsr draw_gaps
        jsr draw_platforms
        jsr draw_landmark
        jsr draw_vine
        jsr copy_bg
        rts

; draw_gaps : cut each descriptor gap and add a low water shimmer.
draw_gaps:
        lda gap1_l
        cmp gap1_r
        beq dg_second
        sta er_col
        lda gap1_r
        sec
        sbc gap1_l
        sta er_wb
        jsr carve_gap
dg_second:
        lda gap2_l
        cmp gap2_r
        beq dg_done
        sta er_col
        lda gap2_r
        sec
        sbc gap2_l
        sta er_wb
        jsr carve_gap
dg_done:
        rts

carve_gap:
        lda #GROUND_TOP
        sta er_y
        lda #24
        sta er_h
        lda #0
        sta fillv
        jsr fill_bg_rect
        lda #152
        sta er_y
        lda #8
        sta er_h
        lda #$11
        sta fillv
        jmp fill_bg_rect

; draw_platforms : two byte-aligned one-way platforms with end supports.
draw_platforms:
        lda plat1_l
        cmp plat1_r
        beq dp_second
        sta er_col
        lda plat1_r
        sec
        sbc plat1_l
        sta er_wb
        lda plat1_y
        jsr draw_one_platform
dp_second:
        lda plat2_l
        cmp plat2_r
        beq dp_done
        sta er_col
        lda plat2_r
        sec
        sbc plat2_l
        sta er_wb
        lda plat2_y
        jsr draw_one_platform
dp_done:
        rts

draw_one_platform:
        sta er_y
        pha
        lda #4
        sta er_h
        lda #$7F
        sta fillv
        jsr fill_bg_rect
        pla
        clc
        adc #4
        sta er_y
        lda #GROUND_TOP
        sec
        sbc er_y
        sta er_h
        lda #1
        sta er_wb
        lda #$49
        sta fillv
        jsr fill_bg_rect
        rts

; draw_landmark : the ruins announce the gate; the final screen is a temple.
draw_landmark:
        lda curscr
        cmp #TEMPLE_SCREEN
        bcc dl_done
        beq dl_gate
        lda #4                  ; temple side walls
        sta er_col
        lda #40
        sta er_y
        lda #5
        sta er_wb
        lda #96
        sta er_h
        lda #$6D
        sta fillv
        jsr fill_bg_rect
        lda #31
        sta er_col
        jsr fill_bg_rect
        lda #3                  ; lintel
        sta er_col
        lda #34
        sta er_y
        lda #34
        sta er_wb
        lda #8
        sta er_h
        lda #$7F
        sta fillv
        jsr fill_bg_rect
        rts
dl_gate:
        lda #36                 ; sealed arch at the expedition edge
        sta er_col
        lda #62
        sta er_y
        lda #4
        sta er_wb
        lda #74
        sta er_h
        lda #$6D
        sta fillv
        jsr fill_bg_rect
        lda #33
        sta er_col
        lda #56
        sta er_y
        lda #7
        sta er_wb
        lda #6
        sta er_h
        lda #$7F
        sta fillv
        jsr fill_bg_rect
dl_done:
        rts

; ---------------------------------------------------------------------------
; draw_vine : hang a 2-pixel-wide vine down from the canopy at vine_x, drawn
;   into BG so the rect-erase restores it behind the hero each frame.
; ---------------------------------------------------------------------------
draw_vine:
        lda vine_on
        beq dv_done
        lda vine_x              ; column / bit of the vine
        sta x_lo
        lda #0
        sta x_hi
        jsr div7
        ldx bitn
        lda BITMASK,x
        sta tmp                 ; first vine pixel
        cpx #6
        beq dv_bits             ; last bit in the byte -> single pixel
        inx
        lda BITMASK,x
        ora tmp
        sta tmp                 ; second pixel makes a 2px cord
dv_bits:
        lda #VINE_TOP
        sta cury
dv_row:
        ldy cury
        lda ROWL,y
        sta bgptr
        lda ROWH,y
        clc
        adc #BGDELTA
        sta bgptr+1
        ldy col
        lda (bgptr),y
        ora tmp
        sta (bgptr),y
        inc cury
        lda cury
        cmp #VINE_BOT
        bne dv_row
dv_done:
        rts

; ---------------------------------------------------------------------------
; draw_player : choose a readable pose; duck art is offset to keep its feet put.
; ---------------------------------------------------------------------------
draw_player:
        lda px_lo
        sta sx_lo
        lda px_hi
        sta sx_hi
        lda py
        sta sy
        lda ducktmr
        beq dpl_visible
        lda sy
        clc
        adc #8
        sta sy
dpl_visible:
        lda invuln
        beq dpl_pose
        lda anim
        and #2
        bne dpl_done            ; blink during respawn grace
dpl_pose:
        lda ducktmr
        beq dpl_air
        lda #<hero_duck
        sta sprptr
        lda #>hero_duck
        sta sprptr+1
        jmp draw_sprite
dpl_air:
        lda onground
        bne dpl_run
        lda #<hero_jump
        sta sprptr
        lda #>hero_jump
        sta sprptr+1
        jmp draw_sprite
dpl_run:
        lda movetmr
        beq dpl_stand
        lda anim
        and #4
        beq dpl_run1
        lda #<hero_run2
        sta sprptr
        lda #>hero_run2
        sta sprptr+1
        jmp draw_sprite
dpl_run1:
        lda #<hero_run1
        sta sprptr
        lda #>hero_run1
        sta sprptr+1
        jmp draw_sprite
dpl_stand:
        lda #<hero_stand
        sta sprptr
        lda #>hero_stand
        sta sprptr+1
        jmp draw_sprite
dpl_done:
        rts

; ---------------------------------------------------------------------------
; draw_hud : write the HUD text lines
; ---------------------------------------------------------------------------
draw_hud:
        lda #<TLINE20
        sta ptr
        lda #>TLINE20
        sta ptr+1
        jsr clear_line
        lda #<str_title
        sta sprptr
        lda #>str_title
        sta sprptr+1
        jsr print
        lda #<TLINE21
        sta ptr
        lda #>TLINE21
        sta ptr+1
        jsr clear_line
        ldx curscr
        lda screen_name_lo,x
        sta sprptr
        lda screen_name_hi,x
        sta sprptr+1
        jsr print
        lda #<TLINE22
        sta ptr
        lda #>TLINE22
        sta ptr+1
        jsr clear_line
        lda #<str_stats
        sta sprptr
        lda #>str_stats
        sta sprptr+1
        jsr print
        jsr update_hud
        rts

; print : copy the $00-terminated string at sprptr to (ptr), forcing bit7.
print:
        ldy #0
pr_loop:
        lda (sprptr),y
        beq pr_done
        ora #$80
        sta (ptr),y
        iny
        bne pr_loop
pr_done:
        rts

; ---------------------------------------------------------------------------
; data
; ---------------------------------------------------------------------------
BITMASK:
        .byte $01,$02,$04,$08,$10,$20,$40

; ---- per-screen world descriptor (NSCR entries) ----------------------------
; Gaps and platforms use 7-pixel byte columns [left,right); left==right = none.
scr_g1l: .byte 31,  8, 15, 34, 12, 11
scr_g1r: .byte 34, 14, 31, 38, 17, 19
scr_g2l: .byte  0, 25,  0,  0, 28, 22
scr_g2r: .byte  0, 31,  0,  0, 33, 31
scr_p1l: .byte  0,  9,  0, 10, 13, 12
scr_p1r: .byte  0, 13,  0, 18, 16, 18
scr_p1y: .byte 136,116,136,116,116,116
scr_p2l: .byte  0, 26,  0, 22, 29, 23
scr_p2r: .byte  0, 30,  0, 30, 32, 30
scr_p2y: .byte 136,108,136,108,116,104
scr_spawn:
        .byte 16,16,16,16,16,16
scr_vine:
        .byte 0,0,1,0,0,0
scr_vx:
        .byte 0,0,112,0,0,0
scr_hztype:
        .byte HZ_BOULDER_KIND,HZ_SNAKE_KIND,HZ_NONE_KIND
        .byte HZ_BAT_KIND,HZ_BOULDER_KIND,HZ_SNAKE_KIND
scr_hzmin:
        .byte 70,148,0,50,30,30
scr_hzmax:
        .byte 190,166,0,230,180,65
scr_hzspd:
        .byte 2,1,0,2,3,2
scr_hzy:
        .byte 124,128,0,116,124,128
scr_hzw:
        .byte 12,16,0,16,12,16
scr_hzh:
        .byte 12,8,0,8,12,8

; ---- world items: four glyphs, six optional fruit, final Sunstone -----------
item_x0:
        .byte 195,188,235,205, 125,74,180,105,212,88,235
item_y0:
        .byte 118,98,126,126, 104,106,96,106,106,126,126
item_scr0:
        .byte 0,1,2,3, 0,1,2,3,4,5,5
item_kind0:
        .byte 1,1,1,1, 0,0,0,0,0,0,2

screen_name_lo:
        .byte <name0,<name1,<name2,<name3,<name4,<name5
screen_name_hi:
        .byte >name0,>name1,>name2,>name3,>name4,>name5

; ---- player poses: 12 pixels wide, MSB-first rows ---------------------------
hero:
hero_stand:
        .byte 12, 16
        .byte %00011110, %00000000
        .byte %00111111, %00000000
        .byte %00011110, %00000000
        .byte %00010010, %00000000
        .byte %00011110, %00000000
        .byte %00111111, %00000000
        .byte %01101101, %10000000
        .byte %01101101, %10000000
        .byte %00011110, %00000000
        .byte %00011110, %00000000
        .byte %00010010, %00000000
        .byte %00010010, %00000000
        .byte %00010010, %00000000
        .byte %00110011, %00000000
        .byte %00000000, %00000000
        .byte %00000000, %00000000

hero_run1:
        .byte 12, 16
        .byte %00011110,%00000000
        .byte %00111111,%00000000
        .byte %00011110,%00000000
        .byte %00010010,%00000000
        .byte %00011110,%00000000
        .byte %00111111,%00000000
        .byte %01101101,%10000000
        .byte %01101101,%10000000
        .byte %00011110,%00000000
        .byte %00011110,%00000000
        .byte %00110010,%00000000
        .byte %00100100,%00000000
        .byte %01000100,%00000000
        .byte %10000110,%00000000
        .byte %00000000,%00000000
        .byte %00000000,%00000000

hero_run2:
        .byte 12, 16
        .byte %00011110,%00000000
        .byte %00111111,%00000000
        .byte %00011110,%00000000
        .byte %00010010,%00000000
        .byte %00011110,%00000000
        .byte %00111111,%00000000
        .byte %01101101,%10000000
        .byte %01101101,%10000000
        .byte %00011110,%00000000
        .byte %00011110,%00000000
        .byte %00001100,%00000000
        .byte %00011000,%00000000
        .byte %00011000,%00000000
        .byte %00111100,%00000000
        .byte %00000000,%00000000
        .byte %00000000,%00000000

hero_jump:
        .byte 12, 16
        .byte %00011110,%00000000
        .byte %00111111,%00000000
        .byte %00011110,%00000000
        .byte %00010010,%00000000
        .byte %01011110,%10000000
        .byte %00111111,%00000000
        .byte %00011110,%00000000
        .byte %00011110,%00000000
        .byte %00111100,%00000000
        .byte %01100110,%00000000
        .byte %01000010,%00000000
        .byte %00000000,%00000000
        .byte %00000000,%00000000
        .byte %00000000,%00000000
        .byte %00000000,%00000000
        .byte %00000000,%00000000

hero_duck:
        .byte 12, 8
        .byte %00011110,%00000000
        .byte %00111111,%00000000
        .byte %01111110,%00000000
        .byte %11111111,%00000000
        .byte %00111100,%00000000
        .byte %01100110,%00000000
        .byte %11000011,%00000000
        .byte %00000000,%00000000

; ---- moving threats ---------------------------------------------------------
boulder_spr:
        .byte 12, 12
        .byte %00011110,%00000000
        .byte %01111111,%10000000
        .byte %11100111,%11000000
        .byte %11011011,%11000000
        .byte %11110111,%11000000
        .byte %10111101,%11000000
        .byte %11101111,%11000000
        .byte %11011011,%11000000
        .byte %11111111,%11000000
        .byte %01111111,%10000000
        .byte %00111111,%00000000
        .byte %00011110,%00000000

snake_spr:
        .byte 16, 8
        .byte %00000011,%10000000
        .byte %00000111,%11000000
        .byte %00000011,%10000000
        .byte %11000001,%10000011
        .byte %11100111,%11100111
        .byte %01111110,%01111110
        .byte %00111100,%00111100
        .byte %00000000,%00000000

bat1_spr:
        .byte 16, 8
        .byte %10000001,%10000001
        .byte %11000011,%11000011
        .byte %01100111,%11100110
        .byte %00111111,%11111100
        .byte %00011111,%11111000
        .byte %00000110,%01100000
        .byte %00000000,%00000000
        .byte %00000000,%00000000

bat2_spr:
        .byte 16, 8
        .byte %00000001,%10000000
        .byte %00000111,%11100000
        .byte %00011111,%11111000
        .byte %01111111,%11111110
        .byte %11011110,%01111011
        .byte %10001100,%00110001
        .byte %00000000,%00000000
        .byte %00000000,%00000000

; ---- pickups ----------------------------------------------------------------
fruit_spr:
        .byte 8, 10
        .byte %00010000,%00000000
        .byte %00111000,%00000000
        .byte %00010000,%00000000
        .byte %01111110,%00000000
        .byte %11111111,%00000000
        .byte %11111111,%00000000
        .byte %01111110,%00000000
        .byte %00111100,%00000000
        .byte %00011000,%00000000
        .byte %00000000,%00000000

glyph_spr:
        .byte 8, 10
        .byte %00011000, %00000000
        .byte %01111110, %00000000
        .byte %11011011, %00000000
        .byte %10111101, %00000000
        .byte %11111111, %00000000
        .byte %10100101, %00000000
        .byte %11011011, %00000000
        .byte %01111110, %00000000
        .byte %00011000, %00000000
        .byte %00111100, %00000000

sun_spr:
        .byte 8, 10
        .byte %10011001,%00000000
        .byte %01011010,%00000000
        .byte %00111100,%00000000
        .byte %11111111,%00000000
        .byte %01111110,%00000000
        .byte %11111111,%00000000
        .byte %00111100,%00000000
        .byte %01011010,%00000000
        .byte %10011001,%00000000
        .byte %00011000,%00000000

str_title:
        .asciiz "JUNGLE QUEST: THE SUNSTONE RUN"
str_ttl:
        .asciiz "      JUNGLE QUEST: THE SUNSTONE RUN"
str_tag:
        .asciiz "   FOUR GLYPHS OPEN THE SUN TEMPLE"
str_ctl:
        .asciiz " A/D RUN  W/SPACE JUMP  S/DOWN DUCK"
str_go:
        .asciiz "       PRESS SPACE OR PAD START"
str_stats:
        .asciiz "SCORE 000000 TIME 90 LIFE 3 GLYPH 0/4"
str_playctl:
        .asciiz "RUN  JUMP  DUCK - FIND FOUR GLYPHS"
msg_fruit:
        .asciiz "FRUIT +500 / CLOCK +5"
msg_glyph:
        .asciiz "GLYPH FOUND - THE TEMPLE STIRS"
msg_gate:
        .asciiz "THE TEMPLE NEEDS ALL FOUR GLYPHS"
msg_ouch:
        .asciiz "CHECKPOINT -1 LIFE / CLOCK -5"
msg_sun:
        .asciiz "THE SUNSTONE IS YOURS"
msg_win:
        .asciiz "SUNSTONE FOUND! SPACE/PAD TO RUN AGAIN"
msg_over:
        .asciiz "EXPEDITION LOST - SPACE/PAD TO RETRY"
msg_time:
        .asciiz "NIGHT FELL - SPACE/PAD TO TRY AGAIN"

name0:  .asciiz "1 TRAILHEAD - LEAP THE BOULDER"
name1:  .asciiz "2 BROKEN STEPS - TRUST YOUR JUMP"
name2:  .asciiz "3 BLACKWATER - GRAB, THEN RELEASE"
name3:  .asciiz "4 BAT CANOPY - DUCK OR CLIMB"
name4:  .asciiz "5 FALLEN RUINS - THE SEALED GATE"
name5:  .asciiz "6 SUN TEMPLE - CLAIM THE STONE"

; ---------------------------------------------------------------------------
; test hooks : harness pokes state, sets PC here, runs to BRK (monitor dump).
; ---------------------------------------------------------------------------
build_brk:
        ldx #$FF
        txs
        jsr build_rows
        brk

plot_brk:
        ldx #$FF
        txs
        jsr plot
        brk

clear_brk:
        ldx #$FF
        txs
        jsr clear_screen
        brk

erase_brk:
        ldx #$FF
        txs
        jsr rect_erase
        brk

sprite_brk:
        ldx #$FF
        txs
        jsr draw_player
        brk

; one logic frame (input + physics); harness injects a key first, then reads
; the state block at $6200.  No render/delay so the step is deterministic+fast.
step_brk:
        ldx #$FF
        txs
        jsr read_input
        jsr update_player
        brk

hazard_brk:
logstep_brk:
        ldx #$FF
        txs
        jsr update_hazard
        brk

coll_brk:
        ldx #$FF
        txs
        jsr collide_hazard
        brk

collect_brk:
        ldx #$FF
        txs
        jsr collect_items
        brk

timer_brk:
        ldx #$FF
        txs
        jsr tick_timer
        brk

screenvars_brk:
        ldx #$FF
        txs
        jsr set_screen_vars
        brk

scene_brk:
        ldx #$FF
        txs
        jsr clear_screen
        jsr clear_bg
        jsr draw_scene
        brk

death_brk:
        ldx #$FF
        txs
        jsr player_die
        brk

pad_brk:
        ldx #$FF
        txs
        jsr read_pad
        brk

init_brk:
        ldx #$FF
        txs
        jsr init_state
        brk

gameframe_brk:
        ldx #$FF
        txs
        jsr read_input
        jsr update_player
        jsr update_hazard
        jsr collide_hazard
        jsr collect_items
        jsr tick_timer
        brk

render_brk:
        ldx #$FF
        txs
        jsr render_player
        brk
