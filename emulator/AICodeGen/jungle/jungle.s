; ============================================================================
; JUNGLE QUEST  -  an original jungle-platformer for the 3ric
;                 (65C02, Apple-II compatible)
;
; An original game inspired by the classic jungle-runner genre: dash through a
; hazard-filled jungle, leap the pits, hop the hazards, grab the treasure and
; beat the clock.  All art, levels, name and code are original.
;
; This file is built up in tested milestones.  M1 lays the hi-res engine:
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

; ---- persistent game state (absolute RAM at $6200, above the row tables;
;      pristine RAM, so it survives the monitor's BRK handler in test hooks) --
STATE    = $6200
px_lo    = STATE+0      ; player x (pixels, 16-bit 0..279)
px_hi    = STATE+1
py       = STATE+2      ; player y (top of sprite)  == integer part of y
yfrac    = STATE+3      ; fractional part of y (8.8 fixed point with py)
vy_lo    = STATE+4      ; vertical velocity, signed 16-bit 8.8 px/frame
vy_hi    = STATE+5
facing   = STATE+6      ; 0 = right, 1 = left
pstate   = STATE+7      ; 0 stand/run, 2 jump/fall, 3 dead
onground = STATE+8      ; 1 = standing on ground
movetmr  = STATE+9      ; frames left of a horizontal move impulse
movedir  = STATE+10     ; 0 = right, 1 = left
jumpreq  = STATE+11     ; jump requested this frame
lives    = STATE+12
opx_lo   = STATE+13     ; previous drawn x (for erase)
opx_hi   = STATE+14
opy      = STATE+15     ; previous drawn y
ocol     = STATE+16     ; previous drawn byte column
score0   = STATE+17     ; BCD score (6 digits, little-endian pairs)
score1   = STATE+18
score2   = STATE+19
timeL    = STATE+20     ; countdown timer
timeH    = STATE+21
seedL    = STATE+22     ; RNG state
seedH    = STATE+23
hz_x_lo  = STATE+24     ; rolling-log hazard x (16-bit)
hz_x_hi  = STATE+25
hz_dir   = STATE+26     ; reserved (roll direction)
olog_lo  = STATE+27     ; previous drawn log x (for erase)
olog_hi  = STATE+28
olog_y   = STATE+29
olog_col = STATE+30
gamestate = STATE+31    ; 0 play, 1 win, 2 game over, 3 time up
tsec     = STATE+32     ; countdown seconds shown in the HUD
tframe   = STATE+33     ; frame subcounter for the timer
trleft   = STATE+34     ; treasures still to collect
tr_x     = STATE+35     ; NT treasure x positions (<256)
tr_y     = STATE+38     ; NT treasure y positions
tr_on    = STATE+41     ; NT active flags

; ---- gameplay constants ----
RUNSPEED = 2            ; px / frame
MOVE_HOLD = 8           ; frames a key-press keeps you moving (bridges auto-repeat)
PLAYER_W = 12
PLAYER_FEET = 14        ; foot line = py + PLAYER_FEET
GROUND_TOP = 136        ; top pixel row of the ground band
STAND_Y  = 122          ; GROUND_TOP - PLAYER_FEET
DEATH_Y  = 170          ; falling past this = death
SPAWN_X  = 20
XMAX     = 267          ; 279 - PLAYER_W
PIT_L    = 168          ; pit x-range (byte cols 24..29)
PIT_R    = 209
; GRAV = +$0030 (0.1875 px/frame^2), JUMP_V = -$0300, TERMV = +$0300
GRAV_LO  = $30
GRAV_HI  = $00
JUMP_LO  = $00
JUMP_HI  = $FD          ; -$0300
TERM_LO  = $00
TERM_HI  = $03
; rolling-log hazard (rolls along the left platform, forcing timed jumps)
LOG_W    = 16
LOG_H    = 8
LOG_Y    = 128          ; sits on the ground band (bottom at row 136)
LOG_SPD  = 2
LOG_MAX  = 152          ; right end of its run; wraps back here at the left edge
; treasures, timer, scoring
NT       = 3            ; number of treasures on the screen
TR_W     = 8
TR_H     = 10
TR_VAL_M = $20          ; +2000 (BCD) per treasure, added to score byte 1
TSEC0    = 60           ; starting countdown value
TICK     = 12           ; frames per countdown tick

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

        .org $0800

; ---------------------------------------------------------------------------
; entry
; ---------------------------------------------------------------------------
start:
        sei
        cld
        ldx #$FF
        txs
        lda TXTCLR              ; graphics on
        lda MIXSET              ; mixed mode (text HUD at bottom)
        lda LOWSCR              ; page 1
        lda HIRES_SW            ; hi-res
        jsr build_rows          ; hi-res row-address table
        jsr clear_screen        ; blank hi-res page 1
        jsr clear_bg            ; blank background buffer
        jsr clear_text          ; blank text page (spaces)
        jsr init_state
        jsr draw_scene          ; static scene into BG, then copy to screen
        jsr draw_hud
        jsr init_render         ; seed prev-position + first player blit
main:
        lda gamestate
        bne main_over
        jsr read_input
        jsr update_player
        jsr update_log
        jsr collide_log
        jsr collect_treasures
        jsr tick_timer
        jsr render_player
        jsr render_log
        jsr draw_treasures
        jsr update_hud
        jsr frame_delay
        jmp main
main_over:
        jsr show_end_msg
        lda KBD
        bpl mo_wait
        tax
        lda KBDSTRB
        txa
        cmp #$A0                ; SPACE restarts
        beq mo_restart
mo_wait:
        jsr frame_delay
        jmp main
mo_restart:
        jmp start

; ---------------------------------------------------------------------------
; init_state : starting player position / lives / physics vars
; ---------------------------------------------------------------------------
init_state:
        lda #<SPAWN_X
        sta px_lo
        lda #>SPAWN_X
        sta px_hi
        lda #STAND_Y
        sta py
        lda #0
        sta yfrac
        sta vy_lo
        sta vy_hi
        sta facing
        sta pstate
        sta movetmr
        sta movedir
        sta jumpreq
        lda #1
        sta onground
        lda #3
        sta lives
        lda #<LOG_MAX           ; rolling log starts at the right of its run
        sta hz_x_lo
        lda #>LOG_MAX
        sta hz_x_hi
        lda #1
        sta hz_dir
        lda #0                  ; reset score / timer / game state
        sta score0
        sta score1
        sta score2
        sta tframe
        sta gamestate
        lda #TSEC0
        sta tsec
        jsr init_treasures
        rts

; init_treasures : place the collectibles (two on the left, one past the pit).
init_treasures:
        lda #60
        sta tr_x+0
        lda #120
        sta tr_x+1
        lda #230
        sta tr_x+2
        lda #126                ; sits on the ground (bottom row 136)
        sta tr_y+0
        sta tr_y+1
        sta tr_y+2
        lda #1
        sta tr_on+0
        sta tr_on+1
        sta tr_on+2
        lda #NT
        sta trleft
        rts

; init_render : prime the previous-position trackers and draw the hero once.
init_render:
        lda px_lo
        sta opx_lo
        lda px_hi
        sta opx_hi
        lda py
        sta opy
        lda px_lo
        sta x_lo
        lda px_hi
        sta x_hi
        jsr div7
        lda col
        sta ocol
        jsr draw_player
        lda hz_x_lo             ; prime log prev-position + draw it once
        sta olog_lo
        lda hz_x_hi
        sta olog_hi
        lda #LOG_Y
        sta olog_y
        lda hz_x_lo
        sta x_lo
        lda hz_x_hi
        sta x_hi
        jsr div7
        lda col
        sta olog_col
        jsr draw_log
        rts

; ---------------------------------------------------------------------------
; read_input : poll the keyboard, set the move/jump latches for this frame.
;   left  = left-arrow ($88) or A ($C1)
;   right = right-arrow ($95) or D ($C4)
;   jump  = space ($A0), up-arrow ($8B) or W ($D7)
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
ri_done:
        rts

; ---------------------------------------------------------------------------
; update_player : one step of physics (jump, gravity, movement, collision).
; ---------------------------------------------------------------------------
update_player:
        lda jumpreq             ; start a jump only when standing
        beq up_nojump
        lda onground
        beq up_nojump
        lda #JUMP_LO
        sta vy_lo
        lda #JUMP_HI
        sta vy_hi
        lda #0
        sta onground
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
        lda py                  ; death by falling into a pit
        cmp #DEATH_Y
        bcc up_done
        jsr player_die
up_done:
        rts

; ---------------------------------------------------------------------------
; check_ground : land the player if falling onto solid ground; else airborne.
;   Ground exists everywhere except the pit x-range [PIT_L, PIT_R], tested at
;   the player's horizontal centre (px + 6).
; ---------------------------------------------------------------------------
check_ground:
        clc                     ; centre x = px + 6
        lda px_lo
        adc #6
        sta tmp
        lda px_hi
        adc #0
        sta tmp2
        lda tmp2
        bne cg_ground           ; centre >= 256 -> past the pit -> ground
        lda tmp
        cmp #PIT_L
        bcc cg_ground           ; centre < PIT_L -> ground
        cmp #PIT_R+1
        bcs cg_ground           ; centre > PIT_R -> ground
        lda #0                  ; over the pit -> no ground
        sta onground
        rts
cg_ground:
        lda vy_hi
        bmi cg_done             ; rising -> not landing yet
        lda py
        clc
        adc #PLAYER_FEET
        cmp #GROUND_TOP
        bcc cg_air              ; feet still above the ground
        lda #STAND_Y            ; land
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
cg_done:
        rts

; move_right / move_left : shift px by RUNSPEED, clamp to [0, XMAX], set facing.
move_right:
        clc
        lda px_lo
        adc #RUNSPEED
        sta px_lo
        lda px_hi
        adc #0
        sta px_hi
        lda px_hi
        cmp #>XMAX
        bcc mr_ok
        bne mr_clamp
        lda px_lo
        cmp #<XMAX+1
        bcc mr_ok
mr_clamp:
        lda #<XMAX
        sta px_lo
        lda #>XMAX
        sta px_hi
mr_ok:
        lda #0
        sta facing
        rts

move_left:
        sec
        lda px_lo
        sbc #RUNSPEED
        sta px_lo
        lda px_hi
        sbc #0
        sta px_hi
        lda px_hi
        bpl ml_ok               ; still >= 0
        lda #0                  ; underflow -> clamp to 0
        sta px_lo
        sta px_hi
ml_ok:
        lda #1
        sta facing
        rts

; player_die : lose a life and respawn at the start (game-over screen is M8).
player_die:
        dec lives
        bne pd_respawn
        lda #2                  ; out of lives -> game over
        sta gamestate
        rts
pd_respawn:
        lda #<SPAWN_X
        sta px_lo
        lda #>SPAWN_X
        sta px_hi
        lda #STAND_Y
        sta py
        lda #0
        sta yfrac
        sta vy_lo
        sta vy_hi
        sta movetmr
        lda #1
        sta onground
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
        lda py
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
; update_log : roll the log left; wrap to LOG_MAX when it runs off the left.
; ---------------------------------------------------------------------------
update_log:
        sec
        lda hz_x_lo
        sbc #LOG_SPD
        sta hz_x_lo
        lda hz_x_hi
        sbc #0
        sta hz_x_hi
        lda hz_x_hi
        bpl ul_ok               ; still >= 0
        lda #<LOG_MAX
        sta hz_x_lo
        lda #>LOG_MAX
        sta hz_x_hi
ul_ok:
        rts

; ---------------------------------------------------------------------------
; collide_log : AABB player-vs-log; on overlap the player dies (respawns).
;   player box [px, px+PLAYER_W) x [py, py+PLAYER_FEET)
;   log box    [hz_x, hz_x+LOG_W) x [LOG_Y, LOG_Y+LOG_H)
; ---------------------------------------------------------------------------
collide_log:
        clc                     ; tmp = log right = hz_x + LOG_W
        lda hz_x_lo
        adc #LOG_W
        sta tmp
        lda hz_x_hi
        adc #0
        sta tmp2
        lda px_lo               ; px < log_right ?
        cmp tmp
        lda px_hi
        sbc tmp2
        bcs cl_no               ; px >= log_right -> no overlap
        clc                     ; tmp = player right = px + PLAYER_W
        lda px_lo
        adc #PLAYER_W
        sta tmp
        lda px_hi
        adc #0
        sta tmp2
        lda hz_x_lo             ; hz_x < player_right ?
        cmp tmp
        lda hz_x_hi
        sbc tmp2
        bcs cl_no               ; hz_x >= player_right -> no overlap
        lda py                  ; py < LOG_Y + LOG_H ?
        cmp #LOG_Y+LOG_H
        bcs cl_no               ; player below the log
        lda py                  ; py + PLAYER_FEET > LOG_Y ?
        clc
        adc #PLAYER_FEET
        cmp #LOG_Y+1
        bcc cl_no               ; player above the log
        jsr player_die
cl_no:
        rts

; draw_log : blit the log sprite at (hz_x, LOG_Y)
draw_log:
        lda hz_x_lo
        sta sx_lo
        lda hz_x_hi
        sta sx_hi
        lda #LOG_Y
        sta sy
        lda #<log_spr
        sta sprptr
        lda #>log_spr
        sta sprptr+1
        jsr draw_sprite
        rts

; render_log : erase the log's previous cell from BG, redraw, save position.
render_log:
        lda olog_col
        sta er_col
        lda olog_y
        sta er_y
        lda #40
        sec
        sbc olog_col
        cmp #4
        bcs rl_wb4
        sta er_wb
        jmp rl_wbset
rl_wb4:
        lda #4                  ; 16px + shift spans up to 4 bytes
        sta er_wb
rl_wbset:
        lda #LOG_H
        sta er_h
        jsr rect_erase
        jsr draw_log
        lda hz_x_lo
        sta olog_lo
        lda hz_x_hi
        sta olog_hi
        lda #LOG_Y
        sta olog_y
        lda hz_x_lo
        sta x_lo
        lda hz_x_hi
        sta x_hi
        jsr div7
        lda col
        sta olog_col
        rts

; ---------------------------------------------------------------------------
; collect_treasures : AABB player-vs-each active treasure; collect on overlap.
; ---------------------------------------------------------------------------
collect_treasures:
        ldx #0
ctr_loop:
        stx ti
        lda tr_on,x
        beq ctr_next
        lda tr_x,x              ; tr_right = tr_x + TR_W  -> tmp/tmp2
        clc
        adc #TR_W
        sta tmp
        lda #0
        adc #0
        sta tmp2
        lda px_lo               ; px < tr_right ?
        cmp tmp
        lda px_hi
        sbc tmp2
        bcs ctr_next            ; px >= tr_right -> miss
        clc                     ; player_right = px + PLAYER_W
        lda px_lo
        adc #PLAYER_W
        sta tmp
        lda px_hi
        adc #0
        sta tmp2
        lda tr_x,x              ; tr_x < player_right ?
        cmp tmp
        lda #0
        sbc tmp2
        bcs ctr_next            ; tr_x >= player_right -> miss
        lda tr_y,x              ; tr_bottom = tr_y + TR_H
        clc
        adc #TR_H
        sta tmp
        lda py                  ; py < tr_bottom ?
        cmp tmp
        bcs ctr_next            ; player below treasure -> miss
        lda py                  ; py + PLAYER_FEET > tr_y ?
        clc
        adc #PLAYER_FEET
        cmp tr_y,x
        bcc ctr_next            ; player above treasure -> miss
        lda #0                  ; --- collect ---
        sta tr_on,x
        jsr add_score
        jsr erase_treasure      ; uses ti
        dec trleft
        bne ctr_next
        lda #1                  ; all collected -> win
        sta gamestate
ctr_next:
        ldx ti
        inx
        cpx #NT
        beq ctr_end
        jmp ctr_loop
ctr_end:
        rts

; add_score : += 2000 (BCD) to the 6-digit score
add_score:
        sed
        clc
        lda score0
        adc #$00
        sta score0
        lda score1
        adc #TR_VAL_M
        sta score1
        lda score2
        adc #$00
        sta score2
        cld
        rts

; erase_treasure : clear treasure[ti] from the screen (copy BG back).
erase_treasure:
        ldy ti
        lda tr_y,y
        sta er_y
        lda tr_x,y
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
        lda #TR_H
        sta er_h
        jsr rect_erase
        rts

; draw_treasures : blit every active treasure (on top of the scene each frame).
draw_treasures:
        ldx #0
dt_loop:
        stx ti
        lda tr_on,x
        beq dt_next
        lda tr_x,x
        sta sx_lo
        lda #0
        sta sx_hi
        lda tr_y,x
        sta sy
        lda #<gem_spr
        sta sprptr
        lda #>gem_spr
        sta sprptr+1
        jsr draw_sprite
dt_next:
        ldx ti
        inx
        cpx #NT
        bne dt_loop
        rts

; tick_timer : advance the countdown; time-up ends the game.
tick_timer:
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
        lda tsec                ; time digits at columns 20..21
        jsr bin2bcd
        ldx #20
        jsr emit2
        lda lives               ; lives digit at column 31
        ora #$B0
        sta TLINE22+31
        rts

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
; draw_scene : paint the static level into BG, then copy BG -> SCREEN.
;   M1 scene: black sky, a solid ground band, a simple pit gap.
;   Ground band = pixel rows 136..159 filled ($7F = 7 lit pixels/byte).
; ---------------------------------------------------------------------------
draw_scene:
        lda #136
        sta cury
ds_gnd:
        ldy cury
        lda ROWL,y
        sta bgptr               ; screen addr of this row...
        lda ROWH,y
        clc
        adc #BGDELTA            ; ...moved into BG space
        sta bgptr+1
        ldy #0
        lda #$7F
ds_gfill:
        sta (bgptr),y
        iny
        cpy #40
        bne ds_gfill
        inc cury
        lda cury
        cmp #160
        bne ds_gnd
        jsr punch_pit           ; carve a pit into the ground band
        jsr copy_bg
        rts

; ---------------------------------------------------------------------------
; punch_pit : clear a rectangular pit (byte cols 24..29) out of the ground.
; ---------------------------------------------------------------------------
punch_pit:
        lda #136
        sta cury
pp_row:
        ldy cury
        lda ROWL,y
        sta bgptr
        lda ROWH,y
        clc
        adc #BGDELTA
        sta bgptr+1
        ldy #24
        lda #0
pp_col:
        sta (bgptr),y
        iny
        cpy #30
        bne pp_col
        inc cury
        lda cury
        cmp #160
        bne pp_row
        rts

; ---------------------------------------------------------------------------
; draw_player : blit the hero sprite at (px, py)
; ---------------------------------------------------------------------------
draw_player:
        lda px_lo
        sta sx_lo
        lda px_hi
        sta sx_hi
        lda py
        sta sy
        lda #<hero
        sta sprptr
        lda #>hero
        sta sprptr+1
        jsr draw_sprite
        rts

; ---------------------------------------------------------------------------
; draw_hud : write the HUD text lines
; ---------------------------------------------------------------------------
draw_hud:
        lda #<str_title
        sta sprptr
        lda #>str_title
        sta sprptr+1
        lda #<TLINE20
        sta ptr
        lda #>TLINE20
        sta ptr+1
        jsr print
        lda #<str_stats
        sta sprptr
        lda #>str_stats
        sta sprptr+1
        lda #<TLINE22
        sta ptr
        lda #>TLINE22
        sta ptr+1
        jsr print
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

; hero : 12 x 16, left-justified rows (hi byte = cols 0-7, lo byte = cols 8-15)
hero:
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

; log_spr : 16 x 8 rolling log (original art; hi byte = cols 0-7, lo = cols 8-15)
log_spr:
        .byte 16, 8
        .byte %00111111, %11111100
        .byte %01111111, %11111110
        .byte %11111111, %11111111
        .byte %11011011, %01101101
        .byte %11111111, %11111111
        .byte %11011011, %01101101
        .byte %01111111, %11111110
        .byte %00111111, %11111100

; gem_spr : 8 x 10 treasure gem (original art)
gem_spr:
        .byte 8, 10
        .byte %00011000, %00000000
        .byte %00111100, %00000000
        .byte %01111110, %00000000
        .byte %11111111, %00000000
        .byte %11111111, %00000000
        .byte %01111110, %00000000
        .byte %00111100, %00000000
        .byte %00011000, %00000000
        .byte %00011000, %00000000
        .byte %00111100, %00000000

str_title:
        .asciiz "JUNGLE QUEST"
str_stats:
        .asciiz "SCORE 000000   TIME 20   LIVES 3"
msg_win:
        .asciiz "YOU WIN!  PRESS SPACE TO PLAY AGAIN"
msg_over:
        .asciiz "GAME OVER  PRESS SPACE TO PLAY AGAIN"
msg_time:
        .asciiz "TIME UP!  PRESS SPACE TO PLAY AGAIN"

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

logstep_brk:
        ldx #$FF
        txs
        jsr update_log
        brk

coll_brk:
        ldx #$FF
        txs
        jsr collide_log
        brk

collect_brk:
        ldx #$FF
        txs
        jsr collect_treasures
        brk

timer_brk:
        ldx #$FF
        txs
        jsr tick_timer
        brk
