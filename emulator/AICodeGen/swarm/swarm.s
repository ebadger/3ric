; ============================================================================
; STAR SWARM  -  an original "space-invaders-style" fixed shooter for the 3ric
;               (65C02, Apple-II compatible)
;
; Defend the ground line against a descending swarm of alien bugs: sweep a laser
; cannon left/right, fire up, and clear the formation before it lands.  The swarm
; marches side to side, drops a row and speeds up as its ranks thin, rains bombs,
; and hides behind crumbling bunkers while a mystery saucer streaks overhead.
; All sprite art, code and the name are original; only the un-copyrightable
; genre mechanics are shared with the classic.
;
; Built up in tested milestones.  M1 lays the sprite engine:
;   * mixed hi-res mode (280x160 sprite playfield + 4 text rows of HUD)
;   * 192-entry hi-res row-address table   (ROWL/ROWH at $6000/$6100)
;   * draw_sprite : XOR a bitmap sprite (H,W + rows of a 16-bit left-aligned
;     mask) onto the screen, clipped to the playfield, walking col/bit
;     incrementally so there is no per-pixel divide
;   * original sprite art (three alien ranks x2 frames, cannon, saucer, shots)
;   * BRK test hooks for the headless harness
;
; Build / run:
;   BRUN SWARM.PRG 0800      (loads the raw image to $0800 and jumps there)
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
WIDTH    = 280          ; sprite playfield width  (pixels, = 40 bytes)
HEIGHT   = 160          ; sprite playfield height (top 20 rows; rest is HUD)
NCOL     = 40           ; screen bytes per row (280/7)

; ---- player cannon geometry ----
CAN_Y    = 148          ; cannon top row (occupies rows 148..155, just above HUD)
CAN_W    = 15           ; cannon sprite width
CAN_XMAX = 265          ; right-most left-edge x = WIDTH - CAN_W
CAN_X0   = 132          ; start x (roughly centred)
CAN_STEP = 3            ; cannon travel per frame while a move key is held

; ---- keyboard (Apple II key codes carry bit7) ----
K_A      = $C1
K_LARR   = $88
K_D      = $C4
K_RARR   = $95
K_SPACE  = $A0
HOLD     = 4            ; frames an intent stays live after its key event
DELAYO   = 24           ; frame-pacing busy-wait outer count

; ---- player shot ----
SHOT_STEP = 6           ; bolt rises this many pixels per frame
SHOT_DX   = 7           ; muzzle offset from cannon left edge (centre)
SHOT_Y0   = 144         ; bolt spawn y (just above the cannon barrel)

; ---- alien formation ----
NCOLS    = 8            ; columns in the swarm
NROWS    = 5            ; ranks in the swarm
NALIEN   = 40           ; NCOLS * NROWS
CELLW    = 16           ; horizontal spacing between alien cells
CELLH    = 12           ; vertical spacing between ranks
ALIEN_W  = 12           ; alien sprite width
ALIEN_H  = 8            ; alien sprite height (collision box)
BLKX0    = 20           ; formation start x (top-left of cell 0,0)
BLKY0    = 12           ; formation start y
MDX      = 2            ; horizontal march step (per formation advance)
MDROP    = 8            ; drop distance when the swarm reverses

; ---- M5: combat (collisions, alien bombs, scoring, lives) ----
MAXBOMB  = 4            ; simultaneous alien bombs
BOMB_STEP = 3           ; bomb fall speed (pixels per frame)
BOMBGAP  = 40           ; frames between bomb drops
LIVES0   = 3            ; starting cannons

; ---- M6: bunkers (destructible shields) + mystery saucer ----
NBUNK    = 4            ; number of shields on the defensive line
BUNK_Y   = 128          ; shield top row (band sits above the cannon)
BUNK_H   = 10           ; shield height
BUNK_W   = 14           ; shield width
UFO_Y    = 2            ; saucer flies along the top edge
UFO_STEP = 2            ; saucer horizontal speed
UFO_W    = 16           ; saucer width
UFO_H    = 7            ; saucer height
UFOGAP   = 180          ; frames between saucer fly-bys

; ---- M7: game flow (states, waves, HUD, high score) ----
GS_ATTRACT = 0          ; title screen
GS_PLAY    = 1          ; playing
GS_OVER    = 2          ; game over
LANDLINE   = 140        ; swarm bottom reaching this row = invasion (game over)
RESPAWNF   = 45         ; respawn grace frames after a cannon is hit
HUD20    = $0650        ; text page 1 row 20 (first visible mixed-mode text row)
HUD22    = $0750        ; text page 1 row 22
HUD23    = $07D0        ; text page 1 row 23

; ---- zero page (only the (zp),y pointers live here) ----
ptr      = $06          ; screen dest pointer            (+1)
sprptr   = $08          ; sprite-data pointer            (+1)
objptr   = $0C          ; current object base pointer    (+1)

; ---- engine working vars (absolute RAM, clear of monitor + tables) ----
cx       = $6A00        ; plot x (16-bit signed)
cxh      = $6A01
cy       = $6A02        ; plot y
cyh      = $6A03
col      = $6A04        ; current byte column (x / 7)
bitn     = $6A05        ; current bit within the byte (x mod 7)
tt       = $6A06        ; seedcol scratch (16-bit)
tth      = $6A07
tmpa     = $6A08        ; build_rows scratch
tmpb     = $6A09
; --- draw_sprite locals ---
sx       = $6A0A        ; sprite top-left x (16-bit signed)
sxh      = $6A0B
sy       = $6A0C        ; sprite top-left y
shH      = $6A0D        ; sprite height
shW      = $6A0E        ; sprite width
col0     = $6A0F        ; byte column at x = sx (row start)
bitn0    = $6A10        ; bit at x = sx (row start)
srow     = $6A11        ; current sprite row 0..H-1
ry       = $6A12        ; screen row = sy + srow
rowvis   = $6A13        ; 1 = this row is on-screen
mrowh    = $6A14        ; current mask row (16-bit, shifted left per pixel)
mrowl    = $6A15

; ---- M2: player cannon state + input ----
canxl    = $6A20        ; cannon left-edge x (16-bit; can exceed 255)
canxh    = $6A21
candrawn = $6A22        ; 0 until first draw (suppresses first erase)
lcanxl   = $6A23        ; last-drawn x (for XOR erase)
lcanxh   = $6A24
hleft    = $6A25        ; move-left  intent hold-timer (frames)
hright   = $6A26        ; move-right intent hold-timer
hfire    = $6A27        ; fire       intent hold-timer (used from M3)
keyin    = $6A28        ; last key read this frame

; ---- M3: player shot (one bolt at a time) ----
shtact   = $6A29        ; 1 = a bolt is in flight
shtxl    = $6A2A        ; bolt x (16-bit; fixed for the bolt's lifetime)
shtxh    = $6A2B
shty     = $6A2C        ; bolt y (rises each frame)
shtdrawn = $6A2D        ; 1 = bolt currently XOR-drawn
lshtxl   = $6A2E        ; last-drawn bolt position (for XOR erase)
lshtxh   = $6A2F
lshty    = $6A30

; ---- M4: alien formation (two-origin ripple march) ----
bxl      = $6A31        ; current block origin x (16-bit) — where the swarm heads
bxh      = $6A32
by       = $6A33        ; current block origin y
obxl     = $6A34        ; old block origin x — where un-swept aliens still sit
obxh     = $6A35
oby      = $6A36        ; old block origin y
mdir     = $6A37        ; march direction: +1 (right) / $FF (left)
apar     = $6A38        ; animation-frame parity (flips each full sweep)
mcur     = $6A39        ; march cursor 0..NALIEN (sweeps the formation)
livecnt  = $6A3A        ; aliens still alive
minc     = $6A3B        ; live-column extent (for edge detection)
maxc     = $6A3C
aidx     = $6A3D        ; blit_alien: which alien ...
aframe   = $6A3E        ; ... which frame (0/1) ...
aoxl     = $6A3F        ; ... at which origin x (16-bit) ...
aoxh     = $6A40
aoy      = $6A41        ; ... and origin y
arow     = $6A42        ; blit_alien scratch: row / col / cell-x
acol     = $6A43
acellx   = $6A44
t0       = $6A45        ; advance_formation scratch (16-bit)
t1l      = $6A46
t1h      = $6A47

; ---- M5: combat state ----
score0   = $6A48        ; BCD score, little-endian, 6 digits
score1   = $6A49
score2   = $6A4A
lives    = $6A4B        ; remaining cannons
bombcd   = $6A4C        ; frames until the next bomb drop
seed     = $6A4D        ; 16-bit LFSR seed (rand)   ($6A4E = seed+1)
ccur     = $6A4F        ; check_bolt_hits loop cursor
cframe   = $6A50        ; on-screen frame of the alien under test
coxl     = $6A51        ; on-screen origin of the alien under test (16-bit x)
coxh     = $6A52
coy      = $6A53        ; ... origin y
abx0l    = $6A54        ; alien collision box: left x (16-bit)
abx0h    = $6A55
aby0     = $6A56        ; alien collision box: top y
dxl      = $6A57        ; (bolt x - alien left) 16-bit
dxh      = $6A58
bi       = $6A59        ; bomb loop cursor
bcol     = $6A5A        ; spawn: chosen column
btmp     = $6A5B        ; spawn scratch: free slot
btmp2    = $6A5C        ; spawn scratch: firing row

; ---- M6: mystery saucer + bunker/pixel scratch ----
ufoact   = $6A65        ; 1 = saucer on screen
ufoxl    = $6A66        ; saucer x (16-bit)
ufoxh    = $6A67
ufodir   = $6A68        ; +1 = rightward, $FF = leftward
ufodrawn = $6A69        ; 1 = saucer currently XOR-drawn
lufoxl   = $6A6A        ; last-drawn saucer x (for XOR erase)
lufoxh   = $6A6B
ufocd    = $6A6C        ; frames until the next fly-by
bki      = $6A6D        ; bunker/bomb pixel loop cursor
pxx      = $6A6E        ; pixel test/clear x (16-bit)
pxxh     = $6A6F
pyy      = $6A70        ; pixel test/clear y
ecxl     = $6A71        ; erosion centre x (16-bit)
ecxh     = $6A72
ecy      = $6A73        ; erosion centre y
exi      = $6A74        ; erosion inner (column) counter
eyi      = $6A75        ; erosion outer (row) counter

; ---- M7: flow state ----
gstate   = $6A76        ; 0 attract, 1 play, 2 over
wave     = $6A77        ; current wave number (1-based)
gameover = $6A78        ; nonzero once the last cannon is lost or the swarm lands
respawn  = $6A79        ; respawn grace timer (frames; halts bomb drops)
hisc0    = $6A7A        ; BCD high score, little-endian, 3 bytes
hisc1    = $6A7B
hisc2    = $6A7C

alive    = $6A80        ; NALIEN alive flags ($6A80..$6AA7)

; ---- M5: alien bombs (parallel arrays, MAXBOMB wide) ----
bact     = $6AB0        ; 1 = bomb active            ($6AB0..$6AB3)
bxlo     = $6AB4        ; bomb x low                 ($6AB4..$6AB7)
bxhi     = $6AB8        ; bomb x high                ($6AB8..$6ABB)
byy      = $6ABC        ; bomb y                     ($6ABC..$6ABF)
bdrawn   = $6AC0        ; 1 = bomb currently drawn   ($6AC0..$6AC3)
lbxlo    = $6AC4        ; last-drawn x low           ($6AC4..$6AC7)
lbxhi    = $6AC8        ; last-drawn x high          ($6AC8..$6ACB)
lbyy     = $6ACC        ; last-drawn y               ($6ACC..$6ACF)

        .org $0800

; ---------------------------------------------------------------------------
; start : bring up video; the game loop arrives in later milestones.
; ---------------------------------------------------------------------------
start:
        sei
        cld
        ldx #$FF
        txs
        jsr video_init
        lda #0                  ; zero the high score at power-on
        sta hisc0
        sta hisc1
        sta hisc2
        jsr enter_attract
sg_loop:
        jsr game_frame
        jsr frame_delay
        jmp sg_loop

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
        rts

; ---------------------------------------------------------------------------
; init_cannon : place the cannon at centre-screen, undrawn, intents clear.
; ---------------------------------------------------------------------------
init_cannon:
        lda #<CAN_X0
        sta canxl
        lda #>CAN_X0
        sta canxh
        lda #0
        sta candrawn
        sta hleft
        sta hright
        sta hfire
        sta shtact
        sta shtdrawn
        sta livecnt             ; no formation yet -> march_step no-ops
        sta score0
        sta score1
        sta score2
        lda #LIVES0
        sta lives
        lda #BOMBGAP
        sta bombcd
        lda #$5A                ; seed the LFSR (any nonzero pattern)
        sta seed
        lda #$3C
        sta seed+1
        lda #0
        sta ufoact              ; no saucer yet
        sta ufodrawn
        lda #UFOGAP
        sta ufocd
        ldx #0
        lda #0
ic_bclr:
        sta bact,x              ; no bombs in flight
        sta bdrawn,x
        inx
        cpx #MAXBOMB
        bne ic_bclr
        rts

; ---------------------------------------------------------------------------
; play_frame : one gameplay tick — erase, read input, move, redraw, march, decay.
;   The state machine's PLAY branch (play_state) wraps this with wave/landing/
;   life-loss handling; frame_brk exercises this raw tick directly.
; ---------------------------------------------------------------------------
play_frame:
        jsr erase_cannon
        jsr erase_shot
        jsr erase_bombs
        jsr erase_ufo
        jsr read_input
        jsr move_cannon
        jsr do_fire
        jsr update_shot
        jsr march_step
        jsr check_bolt_hits
        jsr check_shot_bunker
        jsr update_ufo
        jsr check_shot_ufo
        jsr update_bombs
        jsr check_bomb_bunker
        jsr check_bomb_hits
        jsr draw_cannon
        jsr draw_shot
        jsr draw_bombs
        jsr draw_ufo
        jsr decay_timers
        rts

; ---------------------------------------------------------------------------
; read_input : poll the keyboard; refresh the matching intent hold-timer.
;   (Apple II reports one key at a time; held keys + OS auto-repeat keep the
;    intent alive via the hold-timers.)
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
ri_fire:
        lda #HOLD
        sta hfire
ri_ret:
        rts

; ---------------------------------------------------------------------------
; move_cannon : slide the cannon by CAN_STEP for each live move intent,
;   clamped to [0, CAN_XMAX].
; ---------------------------------------------------------------------------
move_cannon:
        lda hleft
        beq mc_right
        sec                     ; canx -= CAN_STEP  (16-bit)
        lda canxl
        sbc #CAN_STEP
        sta canxl
        lda canxh
        sbc #0
        sta canxh
        lda canxh               ; underflow past 0 -> clamp to 0
        bpl mc_right
        lda #0
        sta canxl
        sta canxh
mc_right:
        lda hright
        beq mc_ret
        clc                     ; canx += CAN_STEP
        lda canxl
        adc #CAN_STEP
        sta canxl
        lda canxh
        adc #0
        sta canxh
        lda canxh               ; clamp to CAN_XMAX (265 = $0109)
        cmp #>CAN_XMAX
        bcc mc_ret
        bne mc_clamp
        lda canxl
        cmp #<CAN_XMAX
        bcc mc_ret
        beq mc_ret
mc_clamp:
        lda #<CAN_XMAX
        sta canxl
        lda #>CAN_XMAX
        sta canxh
mc_ret:
        rts

; ---------------------------------------------------------------------------
; erase_cannon : XOR the cannon off at its last-drawn x (only if drawn).
; ---------------------------------------------------------------------------
erase_cannon:
        lda candrawn
        beq ec_ret
        lda #<SPR_CANNON
        sta sprptr
        lda #>SPR_CANNON
        sta sprptr+1
        lda lcanxl
        sta sx
        lda lcanxh
        sta sxh
        lda #CAN_Y
        sta sy
        jsr draw_sprite
ec_ret:
        rts

; ---------------------------------------------------------------------------
; draw_cannon : XOR the cannon on at canx, and remember where.
; ---------------------------------------------------------------------------
draw_cannon:
        lda #<SPR_CANNON
        sta sprptr
        lda #>SPR_CANNON
        sta sprptr+1
        lda canxl
        sta sx
        lda canxh
        sta sxh
        lda #CAN_Y
        sta sy
        jsr draw_sprite
        lda canxl
        sta lcanxl
        lda canxh
        sta lcanxh
        lda #1
        sta candrawn
        rts

; ---------------------------------------------------------------------------
; do_fire : if fire is held and no bolt is in flight, launch one from the
;   muzzle (one shot on screen at a time — the classic rule).
; ---------------------------------------------------------------------------
do_fire:
        lda hfire
        beq df_ret
        lda shtact
        bne df_ret              ; a bolt is already flying
        clc                     ; bolt x = cannon left edge + SHOT_DX
        lda canxl
        adc #SHOT_DX
        sta shtxl
        lda canxh
        adc #0
        sta shtxh
        lda #SHOT_Y0
        sta shty
        lda #1
        sta shtact
        lda #0
        sta shtdrawn
df_ret:
        rts

; ---------------------------------------------------------------------------
; update_shot : raise the bolt; retire it when it leaves the top edge.
; ---------------------------------------------------------------------------
update_shot:
        lda shtact
        beq us_ret
        lda shty
        sec
        sbc #SHOT_STEP
        bcc us_off              ; ran off the top of the playfield
        sta shty
        rts
us_off:
        lda #0
        sta shtact
us_ret:
        rts

; ---------------------------------------------------------------------------
; erase_shot : XOR the bolt off at its last-drawn position (if drawn).
; ---------------------------------------------------------------------------
erase_shot:
        lda shtdrawn
        beq es_ret
        lda #<SPR_SHOT
        sta sprptr
        lda #>SPR_SHOT
        sta sprptr+1
        lda lshtxl
        sta sx
        lda lshtxh
        sta sxh
        lda lshty
        sta sy
        jsr draw_sprite
es_ret:
        rts

; ---------------------------------------------------------------------------
; draw_shot : XOR the active bolt on and remember where; clear the flag when
;   no bolt is in flight.
; ---------------------------------------------------------------------------
draw_shot:
        lda shtact
        beq dsh_off
        lda #<SPR_SHOT
        sta sprptr
        lda #>SPR_SHOT
        sta sprptr+1
        lda shtxl
        sta sx
        lda shtxh
        sta sxh
        lda shty
        sta sy
        jsr draw_sprite
        lda shtxl
        sta lshtxl
        lda shtxh
        sta lshtxh
        lda shty
        sta lshty
        lda #1
        sta shtdrawn
        rts
dsh_off:
        lda #0
        sta shtdrawn
        rts

; ---------------------------------------------------------------------------
; init_formation : fill the swarm, draw it once (frame 0), arm the ripple.
; ---------------------------------------------------------------------------
init_formation:
        lda #<BLKX0
        sta bxl
        sta obxl
        lda #>BLKX0
        sta bxh
        sta obxh
        lda #BLKY0
        sta by
        sta oby
        lda #1
        sta mdir                ; heading right
        lda #0
        sta apar
        ldx #0
if_fill:
        lda #1
        sta alive,x
        inx
        cpx #NALIEN
        bne if_fill
        lda #NALIEN
        sta livecnt
        jsr draw_all_aliens     ; initial full paint (frame 0, old origin)
        lda #NALIEN             ; cursor past the end -> first step commits a pass
        sta mcur
        rts

; ---------------------------------------------------------------------------
; draw_all_aliens : XOR every live alien on at frame 0, current origin.
; ---------------------------------------------------------------------------
draw_all_aliens:
        ldx #0
daa_l:
        lda alive,x
        beq daa_n
        stx aidx
        lda #0
        sta aframe
        lda bxl
        sta aoxl
        lda bxh
        sta aoxh
        lda by
        sta aoy
        jsr blit_alien
        ldx aidx
daa_n:
        inx
        cpx #NALIEN
        bne daa_l
        rts

; ---------------------------------------------------------------------------
; blit_alien : XOR alien `aidx` (frame `aframe`) at origin (aoxl/aoxh, aoy).
;   Position = origin + (col*CELLW, ROWYOFF[row]); rank chooses the sprite.
; ---------------------------------------------------------------------------
blit_alien:
        lda aidx
        and #(NCOLS-1)          ; col = aidx mod 8
        sta acol
        lda aidx
        lsr a
        lsr a
        lsr a                   ; row = aidx / 8
        sta arow
        lda acol                ; cellx = col * 16
        asl a
        asl a
        asl a
        asl a
        sta acellx
        clc                     ; sx = originx + cellx (16-bit)
        lda aoxl
        adc acellx
        sta sx
        lda aoxh
        adc #0
        sta sxh
        ldx arow                ; sy = originy + ROWYOFF[row]
        clc
        lda aoy
        adc ROWYOFF,x
        sta sy
        ldx arow                ; sprite = SPRxx[ ROWRANK[row]*2 + frame ]
        lda ROWRANK,x
        asl a
        clc
        adc aframe
        tax
        lda SPRLO,x
        sta sprptr
        lda SPRHI,x
        sta sprptr+1
        jsr draw_sprite
        rts

; ---------------------------------------------------------------------------
; march_step : advance the ripple by one alien. When the cursor completes a
;   sweep, commit the pass (advance the whole block) and flip the anim frame.
;   Only live aliens cost a draw, so the swarm speeds up as ranks thin.
; ---------------------------------------------------------------------------
march_step:
        lda livecnt
        bne ms_go
        rts
ms_go:
        lda mcur
        cmp #NALIEN
        bcc ms_have             ; cursor still inside the formation
        lda #0                  ; wrapped: a full sweep = one formation step
        sta mcur
        lda bxl                 ; old origin catches up to current
        sta obxl
        lda bxh
        sta obxh
        lda by
        sta oby
        jsr advance_formation   ; step / drop+reverse -> new current origin
        lda apar
        eor #1
        sta apar
ms_have:
        ldx mcur
        lda alive,x
        bne ms_do
        inc mcur                ; skip dead slots (this is the speed-up)
        jmp ms_go
ms_do:
        lda mcur                ; erase at OLD origin with the previous frame
        sta aidx
        lda apar
        eor #1
        sta aframe
        lda obxl
        sta aoxl
        lda obxh
        sta aoxh
        lda oby
        sta aoy
        jsr blit_alien
        lda mcur                ; redraw at NEW origin with the new frame
        sta aidx
        lda apar
        sta aframe
        lda bxl
        sta aoxl
        lda bxh
        sta aoxh
        lda by
        sta aoy
        jsr blit_alien
        inc mcur
        rts

; ---------------------------------------------------------------------------
; advance_formation : shift the block one MDX in the current direction, or —
;   if the live edge would leave the playfield — drop MDROP and reverse.
; ---------------------------------------------------------------------------
advance_formation:
        jsr live_extent
        lda mdir
        bmi af_left
        lda maxc                ; right edge after step = bx + maxc*16 + ALIEN_W + MDX
        asl a
        asl a
        asl a
        asl a
        sta t0
        clc
        lda bxl
        adc t0
        sta t1l
        lda bxh
        adc #0
        sta t1h
        clc
        lda t1l
        adc #(ALIEN_W+MDX)
        sta t1l
        lda t1h
        adc #0
        sta t1h
        lda t1h                 ; compare against WIDTH (280 = $0118)
        cmp #>WIDTH
        bcc af_stepr
        bne af_drop
        lda t1l
        cmp #<WIDTH
        bcc af_stepr
af_drop:
        clc
        lda by
        adc #MDROP
        sta by
        lda mdir                ; reverse: dir = -dir
        eor #$FF
        clc
        adc #1
        sta mdir
        rts
af_stepr:
        clc
        lda bxl
        adc #MDX
        sta bxl
        lda bxh
        adc #0
        sta bxh
        rts
af_left:
        lda minc                ; left edge after step = bx + minc*16 - MDX
        asl a
        asl a
        asl a
        asl a
        sta t0
        clc
        lda bxl
        adc t0
        sta t1l
        lda bxh
        adc #0
        sta t1h
        sec
        lda t1l
        sbc #MDX
        sta t1l
        lda t1h
        sbc #0
        sta t1h
        lda t1h
        bmi af_drop             ; went negative -> hit the left wall
        sec                     ; step left: bx -= MDX
        lda bxl
        sbc #MDX
        sta bxl
        lda bxh
        sbc #0
        sta bxh
        rts

; ---------------------------------------------------------------------------
; live_extent : scan the swarm for the leftmost/rightmost live column.
; ---------------------------------------------------------------------------
live_extent:
        lda #99
        sta minc
        lda #0
        sta maxc
        ldx #0
le_l:
        lda alive,x
        beq le_n
        txa
        and #(NCOLS-1)
        sta t0                  ; col
        cmp minc
        bcs le_nomin
        sta minc
le_nomin:
        lda t0
        cmp maxc
        bcc le_nomax
        sta maxc
le_nomax:
le_n:
        inx
        cpx #NALIEN
        bne le_l
        rts

; ---------------------------------------------------------------------------
; decay_timers : count each intent hold-timer down toward 0.
; ---------------------------------------------------------------------------
decay_timers:
        lda hleft
        beq dk1
        dec hleft
dk1:
        lda hright
        beq dk2
        dec hright
dk2:
        lda hfire
        beq dk_ret
        dec hfire
dk_ret:
        rts

; ---------------------------------------------------------------------------
; frame_delay : crude busy-wait to pace the game (main loop only).
; ---------------------------------------------------------------------------
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

; ===========================================================================
; M5 : combat — bolt/alien collisions, alien bombs, scoring, lives
; ===========================================================================

; ---------------------------------------------------------------------------
; check_bolt_hits : if the player's bolt overlaps a live alien, kill that alien
;   (erase it, mark it dead, score) and consume the bolt.  One alien per call.
;   The alien's on-screen box uses the NEW origin+frame if the ripple has already
;   swept it this pass (index < mcur), else the OLD origin + previous frame — so
;   the erase matches exactly what is on the screen.
; ---------------------------------------------------------------------------
check_bolt_hits:
        lda shtact
        bne cbh_go
        rts
cbh_go:
        lda #0
        sta ccur
cbh_l:
        ldx ccur
        lda alive,x
        bne cbh_live
        jmp cbh_n
cbh_live:
        lda ccur                ; col = ccur mod 8
        and #(NCOLS-1)
        sta acol
        lda ccur                ; row = ccur / 8
        lsr a
        lsr a
        lsr a
        sta arow
        lda ccur                ; pick origin + frame by ripple sweep state
        cmp mcur
        bcc cbh_new
        lda obxl                ; not yet swept -> old origin, previous frame
        sta coxl
        lda obxh
        sta coxh
        lda oby
        sta coy
        lda apar
        eor #1
        sta cframe
        jmp cbh_pos
cbh_new:
        lda bxl                 ; already swept -> new origin, new frame
        sta coxl
        lda bxh
        sta coxh
        lda by
        sta coy
        lda apar
        sta cframe
cbh_pos:
        lda acol                ; abx0 = coxl + col*16 (16-bit)
        asl a
        asl a
        asl a
        asl a
        sta acellx
        clc
        lda coxl
        adc acellx
        sta abx0l
        lda coxh
        adc #0
        sta abx0h
        ldx arow                ; aby0 = coy + ROWYOFF[row]
        clc
        lda coy
        adc ROWYOFF,x
        sta aby0
        sec                     ; x overlap: 0 <= (shtx - abx0) < ALIEN_W
        lda shtxl
        sbc abx0l
        sta dxl
        lda shtxh
        sbc abx0h
        sta dxh
        bmi cbh_n               ; bolt is left of the alien
        lda dxh
        bne cbh_n               ; bolt is >=256 to the right
        lda dxl
        cmp #ALIEN_W
        bcs cbh_n               ; bolt is past the alien's right edge
        clc                     ; y overlap: not fully above, not fully below
        lda shty
        adc #3                  ; the bolt is 4 pixels tall
        cmp aby0
        bcc cbh_n               ; bolt entirely above the alien
        clc
        lda aby0
        adc #(ALIEN_H-1)
        cmp shty
        bcc cbh_n               ; bolt entirely below the alien
        jmp cbh_hit
cbh_n:
        inc ccur
        lda ccur
        cmp #NALIEN
        beq cbh_done
        jmp cbh_l
cbh_done:
        rts
cbh_hit:
        lda ccur                ; erase the alien where it is drawn
        sta aidx
        lda cframe
        sta aframe
        lda coxl
        sta aoxl
        lda coxh
        sta aoxh
        lda coy
        sta aoy
        jsr blit_alien
        ldx ccur                ; mark it dead
        lda #0
        sta alive,x
        dec livecnt
        lda #0                  ; consume the bolt
        sta shtact
        jsr score_alien
        rts

; ---------------------------------------------------------------------------
; score_alien : add the killed alien's rank value (BCD) to the score.
;   arow still holds its row (blit_alien recomputed the same value).
; ---------------------------------------------------------------------------
score_alien:
        ldx arow
        lda ROWRANK,x
        tax
        lda RANKSCORE,x
        sed
        clc
        adc score0
        sta score0
        lda score1
        adc #0
        sta score1
        lda score2
        adc #0
        sta score2
        cld
        rts

; ---------------------------------------------------------------------------
; erase_bombs : XOR every drawn bomb off at its last position.
; ---------------------------------------------------------------------------
erase_bombs:
        lda #0
        sta bi
eb_l:
        ldx bi
        lda bdrawn,x
        beq eb_n
        lda #<SPR_BOMB
        sta sprptr
        lda #>SPR_BOMB
        sta sprptr+1
        ldx bi
        lda lbxlo,x
        sta sx
        lda lbxhi,x
        sta sxh
        lda lbyy,x
        sta sy
        jsr draw_sprite
eb_n:
        inc bi
        lda bi
        cmp #MAXBOMB
        bne eb_l
        rts

; ---------------------------------------------------------------------------
; update_bombs : fall every active bomb; retire ones that reach the ground; on
;   the spawn cadence, drop a fresh bomb from a random column's lowest alien.
; ---------------------------------------------------------------------------
update_bombs:
        ldx #0
ub_l:
        lda bact,x
        beq ub_n
        clc
        lda byy,x
        adc #BOMB_STEP
        sta byy,x
        cmp #HEIGHT
        bcc ub_n
        lda #0
        sta bact,x              ; reached the ground line
ub_n:
        inx
        cpx #MAXBOMB
        bne ub_l
        lda bombcd
        beq ub_spawn
        dec bombcd
        rts
ub_spawn:
        lda respawn             ; hold fire while a fresh cannon is respawning
        bne ub_nofire
        jsr spawn_bomb
ub_nofire:
        lda #BOMBGAP
        sta bombcd
        rts

; ---------------------------------------------------------------------------
; spawn_bomb : find a free slot and a random column that holds a live alien,
;   then launch a bomb from that column's lowest alien.  No-op if unavailable.
; ---------------------------------------------------------------------------
spawn_bomb:
        ldx #0
sb_slot:
        lda bact,x
        beq sb_free
        inx
        cpx #MAXBOMB
        bne sb_slot
        rts                     ; every bomb slot is busy
sb_free:
        stx btmp                ; remember the free slot
        jsr rand
        and #(NCOLS-1)
        sta bcol
        ldy #(NROWS-1)          ; scan the column bottom-up for a live alien
sb_rowl:
        tya
        asl a
        asl a
        asl a                   ; row * 8
        clc
        adc bcol
        tax
        lda alive,x
        bne sb_found
        dey
        bpl sb_rowl
        rts                     ; column is empty -> skip this drop
sb_found:
        sty btmp2               ; firing alien's row
        lda bcol                ; cellx = col * 16
        asl a
        asl a
        asl a
        asl a
        sta acellx
        clc                     ; bomb x = bx + cellx + 5 (roughly centred)
        lda bxl
        adc acellx
        sta t1l
        lda bxh
        adc #0
        sta t1h
        clc
        lda t1l
        adc #5
        sta t1l
        lda t1h
        adc #0
        sta t1h
        ldx btmp
        lda t1l
        sta bxlo,x
        lda t1h
        sta bxhi,x
        ldy btmp2               ; bomb y = by + ROWYOFF[row] + ALIEN_H
        clc
        lda by
        adc ROWYOFF,y
        clc
        adc #ALIEN_H
        sta byy,x
        lda #1
        sta bact,x
        lda #0
        sta bdrawn,x
        rts

; ---------------------------------------------------------------------------
; check_bomb_hits : any active bomb overlapping the cannon costs a life and is
;   removed.  (Cannon respawn / game-over arrive in later milestones.)
; ---------------------------------------------------------------------------
check_bomb_hits:
        lda #0
        sta bi
kbh_l:
        ldx bi
        lda bact,x
        beq kbh_n
        clc                     ; brl = bomb right edge = bxlo + 2
        lda bxlo,x
        adc #2
        sta t0
        lda bxhi,x
        adc #0
        sta t1l
        sec                     ; bomb right edge < cannon left edge ?
        lda t0
        sbc canxl
        lda t1l
        sbc canxh
        bmi kbh_n               ; bomb is left of the cannon
        clc                     ; crl = cannon right edge = canx + CAN_W-1
        lda canxl
        adc #(CAN_W-1)
        sta t0
        lda canxh
        adc #0
        sta t1l
        sec                     ; cannon right edge < bomb left edge ?
        lda t0
        sbc bxlo,x
        lda t1l
        sbc bxhi,x
        bmi kbh_n               ; bomb is right of the cannon
        clc                     ; bomb bottom = byy + 4 vs cannon top
        lda byy,x
        adc #4
        cmp #CAN_Y
        bcc kbh_n               ; bomb entirely above the cannon
        lda #(CAN_Y+7)          ; cannon bottom vs bomb top
        cmp byy,x
        bcc kbh_n               ; bomb entirely below the cannon
        jsr bomb_hit
kbh_n:
        inc bi
        lda bi
        cmp #MAXBOMB
        bne kbh_l
        rts

; ---------------------------------------------------------------------------
; bomb_hit : remove bomb `bi`, dock a life.  If cannons remain, respawn (recentre
;   + clear the incoming bombs + brief grace); otherwise flag game over.
; ---------------------------------------------------------------------------
bomb_hit:
        ldx bi
        lda #0
        sta bact,x
        lda lives
        beq bh_ret              ; already out of cannons
        dec lives
        beq bh_dead
        jsr respawn_cannon
        rts
bh_dead:
        lda #1
        sta gameover
bh_ret:
        rts

; respawn_cannon : recentre the cannon, clear every incoming bomb, arm a short
;   grace window so the fresh cannon is not immediately shelled again.
respawn_cannon:
        lda #<CAN_X0
        sta canxl
        lda #>CAN_X0
        sta canxh
        lda #RESPAWNF
        sta respawn
        ldx #0
        lda #0
rc_l:
        sta bact,x
        inx
        cpx #MAXBOMB
        bne rc_l
        rts

; ---------------------------------------------------------------------------
; draw_bombs : XOR every active bomb on, remembering where; clear drawn flags
;   for retired bombs so erase_bombs leaves them alone.
; ---------------------------------------------------------------------------
draw_bombs:
        lda #0
        sta bi
db_l:
        ldx bi
        lda bact,x
        beq db_off
        lda #<SPR_BOMB
        sta sprptr
        lda #>SPR_BOMB
        sta sprptr+1
        ldx bi
        lda bxlo,x
        sta sx
        lda bxhi,x
        sta sxh
        lda byy,x
        sta sy
        jsr draw_sprite
        ldx bi
        lda bxlo,x
        sta lbxlo,x
        lda bxhi,x
        sta lbxhi,x
        lda byy,x
        sta lbyy,x
        lda #1
        sta bdrawn,x
        jmp db_n
db_off:
        ldx bi
        lda #0
        sta bdrawn,x
db_n:
        inc bi
        lda bi
        cmp #MAXBOMB
        bne db_l
        rts

; ---------------------------------------------------------------------------
; rand : 16-bit Galois LFSR (poly $B400, period 65535).  Returns A = low byte.
; ---------------------------------------------------------------------------
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

; ===========================================================================
; M6 : destructible bunkers + mystery saucer
; ===========================================================================

; ---------------------------------------------------------------------------
; pixlit : A = 1 if the screen pixel at (pxx/pxxh, pyy) is lit, else 0.
;   Off-screen columns read as 0.  Uses seedcol (cx/cxh -> col/bitn).
; ---------------------------------------------------------------------------
pixlit:
        lda pxx
        sta cx
        lda pxxh
        sta cxh
        jsr seedcol
        lda col
        bmi pl_zero             ; col < 0
        cmp #NCOL
        bcs pl_zero             ; col >= 40
        ldy pyy
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        ldx bitn
        ldy col
        lda (ptr),y
        and BITMASK,x
        beq pl_zero
        lda #1
        rts
pl_zero:
        lda #0
        rts

; ---------------------------------------------------------------------------
; clrpix : clear the screen pixel at (pxx/pxxh, pyy).  Off-screen -> no-op.
; ---------------------------------------------------------------------------
clrpix:
        lda pyy
        cmp #HEIGHT
        bcs cp_ret              ; keep erosion inside the playfield
        lda pxx
        sta cx
        lda pxxh
        sta cxh
        jsr seedcol
        lda col
        bmi cp_ret
        cmp #NCOL
        bcs cp_ret
        ldy pyy
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        ldx bitn
        lda BITMASK,x
        eor #$FF                ; ~bit
        ldy col
        and (ptr),y
        sta (ptr),y
cp_ret:
        rts

; ---------------------------------------------------------------------------
; erode : clear a 4x4 pixel bite centred on (ecxl/ecxh, ecy).
; ---------------------------------------------------------------------------
erode:
        lda #0
        sta eyi
er_row:
        lda #0
        sta exi
er_col:
        clc                     ; pyy = ecy - 1 + eyi
        lda ecy
        adc eyi
        sec
        sbc #1
        sta pyy
        clc                     ; pxx = ecx - 1 + exi  (16-bit)
        lda ecxl
        adc exi
        sta pxx
        lda ecxh
        adc #0
        sta pxxh
        sec
        lda pxx
        sbc #1
        sta pxx
        lda pxxh
        sbc #0
        sta pxxh
        jsr clrpix
        inc exi
        lda exi
        cmp #4
        bne er_col
        inc eyi
        lda eyi
        cmp #4
        bne er_row
        rts

; ---------------------------------------------------------------------------
; init_bunkers : paint the NBUNK shields across the defensive line (once, onto
;   a cleared screen — erosion later clears pixels directly, never XOR).
; ---------------------------------------------------------------------------
init_bunkers:
        lda #0
        sta bki
ibk_l:
        lda #<SPR_BUNKER
        sta sprptr
        lda #>SPR_BUNKER
        sta sprptr+1
        ldx bki
        lda BUNKX,x
        sta sx
        lda #0
        sta sxh
        lda #BUNK_Y
        sta sy
        jsr draw_sprite
        inc bki
        lda bki
        cmp #NBUNK
        bne ibk_l
        rts

; ---------------------------------------------------------------------------
; check_shot_bunker : if the climbing bolt tip meets a shield pixel, take a
;   bite out of the shield and spend the bolt.  (Runs after the alien check so
;   aliens take priority.)
; ---------------------------------------------------------------------------
check_shot_bunker:
        lda shtact
        beq csb_ret
        lda shty
        cmp #BUNK_Y
        bcc csb_ret             ; tip above the shield band
        cmp #(BUNK_Y+BUNK_H)
        bcs csb_ret             ; tip below the shield band
        lda shtxl
        sta pxx
        lda shtxh
        sta pxxh
        lda shty
        sta pyy
        jsr pixlit
        beq csb_ret
        lda shtxl               ; erode around the impact
        sta ecxl
        lda shtxh
        sta ecxh
        lda shty
        sta ecy
        jsr erode
        lda #0
        sta shtact
csb_ret:
        rts

; ---------------------------------------------------------------------------
; check_bomb_bunker : any bomb whose leading edge meets a shield chews a bite
;   and is spent.
; ---------------------------------------------------------------------------
check_bomb_bunker:
        lda #0
        sta bki
cbb_l:
        ldx bki
        lda bact,x
        bne cbb_live
        jmp cbb_n
cbb_live:
        clc                     ; leading (bottom) edge = byy + 4
        lda byy,x
        adc #4
        sta pyy
        cmp #BUNK_Y
        bcc cbb_n               ; still above the band
        lda pyy
        cmp #(BUNK_Y+BUNK_H)
        bcs cbb_n               ; already past the band
        ldx bki                 ; test pixel at (bxlo+1, pyy)
        clc
        lda bxlo,x
        adc #1
        sta pxx
        lda bxhi,x
        adc #0
        sta pxxh
        jsr pixlit
        beq cbb_n
        lda pxx                 ; erode around the impact
        sta ecxl
        lda pxxh
        sta ecxh
        lda pyy
        sta ecy
        jsr erode
        ldx bki
        lda #0
        sta bact,x
cbb_n:
        inc bki
        lda bki
        cmp #MAXBOMB
        bne cbb_l
        rts

; ---------------------------------------------------------------------------
; spawn_ufo : launch the saucer from a random edge, heading inward.
; ---------------------------------------------------------------------------
spawn_ufo:
        lda #1
        sta ufoact
        lda #0
        sta ufodrawn
        jsr rand
        and #1
        beq su_right
        lda #<(WIDTH-UFO_W)     ; enter from the right, heading left
        sta ufoxl
        lda #>(WIDTH-UFO_W)
        sta ufoxh
        lda #$FF
        sta ufodir
        rts
su_right:
        lda #0                  ; enter from the left, heading right
        sta ufoxl
        sta ufoxh
        lda #1
        sta ufodir
        rts

; ---------------------------------------------------------------------------
; update_ufo : glide the saucer across the top; retire it off either edge; when
;   idle, count down to the next fly-by.
; ---------------------------------------------------------------------------
update_ufo:
        lda ufoact
        bne uu_move
        lda ufocd
        beq uu_spawn
        dec ufocd
        rts
uu_spawn:
        jsr spawn_ufo
        rts
uu_move:
        lda ufodir
        bmi uu_left
        clc                     ; rightward
        lda ufoxl
        adc #UFO_STEP
        sta ufoxl
        lda ufoxh
        adc #0
        sta ufoxh
        lda ufoxh               ; gone once the left edge passes the screen
        cmp #>WIDTH
        bcc uu_ret
        bne uu_gone
        lda ufoxl
        cmp #<WIDTH
        bcc uu_ret
uu_gone:
        lda #0
        sta ufoact
        lda #UFOGAP
        sta ufocd
        rts
uu_left:
        sec                     ; leftward
        lda ufoxl
        sbc #UFO_STEP
        sta ufoxl
        lda ufoxh
        sbc #0
        sta ufoxh
        clc                     ; gone once the right edge passes 0
        lda ufoxl
        adc #UFO_W
        lda ufoxh
        adc #0
        bmi uu_gone
uu_ret:
        rts

; ---------------------------------------------------------------------------
; check_shot_ufo : bolt vs saucer box.  A hit erases nothing (the saucer isn't
;   on screen mid-frame), just retires the saucer, banks the bonus, spends the
;   bolt.
; ---------------------------------------------------------------------------
check_shot_ufo:
        lda ufoact
        beq csu_ret
        lda shtact
        beq csu_ret
        lda shty                ; y overlap with [UFO_Y .. UFO_Y+UFO_H-1]
        cmp #(UFO_Y+UFO_H)
        bcs csu_ret             ; bolt tip below the saucer
        clc
        lda shty
        adc #3
        cmp #UFO_Y
        bcc csu_ret             ; bolt entirely above the saucer
        sec                     ; x overlap: 0 <= (shtx - ufox) < UFO_W
        lda shtxl
        sbc ufoxl
        sta dxl
        lda shtxh
        sbc ufoxh
        sta dxh
        bmi csu_ret
        lda dxh
        bne csu_ret
        lda dxl
        cmp #UFO_W
        bcs csu_ret
        lda #0                  ; hit!
        sta ufoact
        sta shtact
        lda #UFOGAP
        sta ufocd
        jsr score_ufo
csu_ret:
        rts

; ---------------------------------------------------------------------------
; score_ufo : +100 (one hundreds digit, BCD).
; ---------------------------------------------------------------------------
score_ufo:
        sed
        clc
        lda score1
        adc #1
        sta score1
        lda score2
        adc #0
        sta score2
        cld
        rts

; ---------------------------------------------------------------------------
; erase_ufo / draw_ufo : XOR the saucer off / on, tracking its last position.
; ---------------------------------------------------------------------------
erase_ufo:
        lda ufodrawn
        beq eu_ret
        lda #<SPR_UFO
        sta sprptr
        lda #>SPR_UFO
        sta sprptr+1
        lda lufoxl
        sta sx
        lda lufoxh
        sta sxh
        lda #UFO_Y
        sta sy
        jsr draw_sprite
eu_ret:
        rts
draw_ufo:
        lda ufoact
        beq du_off
        lda #<SPR_UFO
        sta sprptr
        lda #>SPR_UFO
        sta sprptr+1
        lda ufoxl
        sta sx
        lda ufoxh
        sta sxh
        lda #UFO_Y
        sta sy
        jsr draw_sprite
        lda ufoxl
        sta lufoxl
        lda ufoxh
        sta lufoxh
        lda #1
        sta ufodrawn
        rts
du_off:
        lda #0
        sta ufodrawn
        rts

; ---------------------------------------------------------------------------
; draw_sprite : XOR the bitmap at (sprptr) onto the screen at (sx,sy).
;   sprptr -> H, W, then H rows of 2 bytes (16-bit mask, leftmost pixel=bit15).
;   Clips to the 280x160 playfield.  Advances sprptr past the sprite.
; ---------------------------------------------------------------------------
draw_sprite:
        ldy #0
        lda (sprptr),y
        sta shH
        iny
        lda (sprptr),y
        sta shW
        clc                     ; sprptr += 2  -> row 0 mask
        lda sprptr
        adc #2
        sta sprptr
        lda sprptr+1
        adc #0
        sta sprptr+1
        lda sx                  ; col0/bitn0 at x=sx (same for every row)
        sta cx
        lda sxh
        sta cxh
        jsr seedcol
        lda col
        sta col0
        lda bitn
        sta bitn0
        lda #0
        sta srow
ds_row:
        clc                     ; ry = sy + srow
        lda sy
        adc srow
        sta ry
        cmp #HEIGHT
        bcc ds_visible
        lda #0                  ; row is off the bottom: skip plotting it
        sta rowvis
        jmp ds_mask
ds_visible:
        ldy ry
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        lda #1
        sta rowvis
ds_mask:
        ldy #0
        lda (sprptr),y
        sta mrowh
        iny
        lda (sprptr),y
        sta mrowl
        lda col0                ; reset running col/bit to the row start
        sta col
        lda bitn0
        sta bitn
        ldx #0                  ; x = sprite column 0..W-1
ds_col:
        asl mrowl               ; 16-bit left shift: carry = next leftmost pixel
        rol mrowh
        bcc ds_next             ; pixel clear
        lda rowvis
        beq ds_next             ; row off-screen -> don't touch memory
        lda col
        bmi ds_next             ; col < 0  (off the left edge)
        cmp #NCOL
        bcs ds_next             ; col >= 40 (off the right edge)
        ldy bitn
        lda BITMASK,y
        ldy col
        eor (ptr),y
        sta (ptr),y
ds_next:
        inc bitn                ; step one pixel right
        lda bitn
        cmp #7
        bne ds_c2
        lda #0
        sta bitn
        inc col
ds_c2:
        inx
        cpx shW
        bne ds_col
        clc                     ; sprptr += 2 -> next row
        lda sprptr
        adc #2
        sta sprptr
        lda sprptr+1
        adc #0
        sta sprptr+1
        inc srow
        lda srow
        cmp shH
        beq ds_done
        jmp ds_row
ds_done:
        rts

; ---------------------------------------------------------------------------
; seedcol : from cx/cxh compute col = cx/7 and bitn = cx mod 7.
;   A +21 (=3 columns) bias lets small negative x (down to -21) divide cleanly;
;   the bias is removed from the quotient at the end.
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

; ==== generated sprites (spritegen.mjs) — original art ====
SPR_CANNON:
        .byte 8,15,1,0,3,128,3,128,31,240,127,252,255,254,255,254,255,254
SPR_A0:
        .byte 8,12,6,0,15,0,63,192,111,96,255,240,47,64,73,32,32,64
SPR_A1:
        .byte 8,12,6,0,15,0,63,192,111,96,255,240,47,64,64,32,144,144
SPR_B0:
        .byte 8,12,32,64,16,128,63,192,109,160,255,240,191,208,160,80,25,128
SPR_B1:
        .byte 8,12,32,64,144,144,191,208,222,208,255,240,127,224,32,64,64,32
SPR_C0:
        .byte 8,12,15,0,127,224,255,240,237,224,255,240,31,128,54,192,96,96
SPR_C1:
        .byte 8,12,15,0,127,224,255,240,237,224,255,240,47,64,95,160,160,80
SPR_UFO:
        .byte 7,16,7,224,31,248,63,252,127,254,255,255,109,182,24,24
SPR_SHOT:
        .byte 4,1,128,0,128,0,128,0,128,0
SPR_BOMB:
        .byte 5,3,64,0,192,0,64,0,96,0,64,0
SPR_BUNKER:
        .byte 10,14,63,240,127,248,255,252,255,252,255,252,255,252,248,124,240,60,240,60,224,28

; ---- formation lookup tables ----
ROWYOFF:                        ; pixel y offset of each rank = row * CELLH
        .byte 0,12,24,36,48
ROWRANK:                        ; which alien rank draws on each row
        .byte 0,1,1,2,2
SPRLO:                          ; sprite address low bytes: rank*2 + frame
        .byte <SPR_A0,<SPR_A1,<SPR_B0,<SPR_B1,<SPR_C0,<SPR_C1
SPRHI:
        .byte >SPR_A0,>SPR_A1,>SPR_B0,>SPR_B1,>SPR_C0,>SPR_C1
RANKSCORE:                      ; BCD points awarded per rank (A/B/C)
        .byte $30,$20,$10
BUNKX:                          ; left-edge x of each shield
        .byte 30,100,170,240

; ===========================================================================
; M7 : game flow — attract / play / over state machine, waves, lives, HUD
; ===========================================================================

; ---------------------------------------------------------------------------
; game_frame : dispatch one tick on the current game state.
; ---------------------------------------------------------------------------
game_frame:
        lda gstate
        cmp #GS_PLAY
        beq gf_play
        cmp #GS_OVER
        beq gf_over
        jmp attract_frame
gf_play:
        jmp play_state
gf_over:
        jmp over_frame

; ---------------------------------------------------------------------------
; play_state : the PLAY branch — run a gameplay tick, then handle respawn
;   grace, the swarm landing, wave refills, the HUD and the game-over hand-off.
; ---------------------------------------------------------------------------
play_state:
        jsr play_frame
        lda respawn
        beq ps_nore
        dec respawn
ps_nore:
        jsr check_landing
        lda livecnt
        bne ps_alv
        jsr next_wave
ps_alv:
        jsr hud_play
        lda gameover
        beq ps_ret
        jsr enter_over
ps_ret:
        rts

; ---------------------------------------------------------------------------
; attract_frame : title screen — draw the HUD, wait for SPACE to launch a game.
; ---------------------------------------------------------------------------
attract_frame:
        jsr hud_attract
        jsr poll_space
        bcc af_ret
        jsr enter_play
af_ret:
        rts

; ---------------------------------------------------------------------------
; over_frame : game-over screen — show the result, wait for SPACE to restart.
; ---------------------------------------------------------------------------
over_frame:
        jsr hud_over
        jsr poll_space
        bcc of_ret
        jsr enter_play
of_ret:
        rts

; ---------------------------------------------------------------------------
; enter_attract : reset to the title screen.
; ---------------------------------------------------------------------------
enter_attract:
        lda #GS_ATTRACT
        sta gstate
        lda #0
        sta gameover
        sta respawn
        jsr clear_screen
        rts

; ---------------------------------------------------------------------------
; enter_play : start a fresh game — clear the field, reset score/lives, build
;   the swarm and the shields.
; ---------------------------------------------------------------------------
enter_play:
        lda #GS_PLAY
        sta gstate
        lda #0
        sta gameover
        sta respawn
        lda #1
        sta wave
        jsr clear_screen
        jsr init_cannon
        jsr init_formation
        jsr init_bunkers
        rts

; ---------------------------------------------------------------------------
; enter_over : switch to the game-over state, banking a new high score.
; ---------------------------------------------------------------------------
enter_over:
        lda #GS_OVER
        sta gstate
        jsr update_hiscore
        rts

; ---------------------------------------------------------------------------
; next_wave : the swarm was cleared — bump the wave count and rebuild the field.
;   (Score and lives carry over; a fresh swarm at full strength speeds up again
;   as its ranks thin.)
; ---------------------------------------------------------------------------
next_wave:
        inc wave
        jsr init_formation
        jsr init_bunkers
        rts

; ---------------------------------------------------------------------------
; check_landing : if the lowest live alien has descended to the invasion line,
;   the swarm has landed — game over.
; ---------------------------------------------------------------------------
check_landing:
        lda livecnt
        bne cld_go
        rts
cld_go:
        ldx #0
        stx btmp                ; lowest live rank seen so far
cld_l:
        lda alive,x
        beq cld_nx
        txa
        lsr a
        lsr a
        lsr a                   ; rank = index / NCOLS (NCOLS=8)
        cmp btmp
        bcc cld_nx
        sta btmp
cld_nx:
        inx
        cpx #NALIEN
        bne cld_l
        ldx btmp                ; bottom = by + ROWYOFF[rank] + ALIEN_H
        lda by
        clc
        adc ROWYOFF,x
        clc
        adc #ALIEN_H
        cmp #LANDLINE
        bcc cld_safe
        lda #1
        sta gameover
cld_safe:
        rts

; ---------------------------------------------------------------------------
; update_hiscore : copy the score into the high score if it is now higher
;   (6-digit BCD, little-endian: score2 is most significant).
; ---------------------------------------------------------------------------
update_hiscore:
        lda score2
        cmp hisc2
        bcc uh_no
        bne uh_yes
        lda score1
        cmp hisc1
        bcc uh_no
        bne uh_yes
        lda score0
        cmp hisc0
        bcc uh_no
        beq uh_no
uh_yes:
        lda score0
        sta hisc0
        lda score1
        sta hisc1
        lda score2
        sta hisc2
uh_no:
        rts

; ---------------------------------------------------------------------------
; poll_space : carry set if SPACE is down this frame (clears the strobe).
; ---------------------------------------------------------------------------
poll_space:
        lda KBD
        bpl ps_no
        sta keyin
        lda KBDSTRB
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
; M7 HUD : text page 1 rows 20-23, visible under the mixed hi-res field.
;   Source strings are plain ASCII; ORA #$80 gives normal-video characters.
;   ptr ($06) = destination cell, sprptr ($08) = source string (both free here).
; ---------------------------------------------------------------------------

; hud_clear : blank the four text HUD rows with spaces.
hud_clear:
        ldx #0
hc_row:
        lda HUDBL,x
        sta ptr
        lda HUDBH,x
        sta ptr+1
        lda #$A0
        ldy #39
hc_col:
        sta (ptr),y
        dey
        bpl hc_col
        inx
        cpx #4
        bne hc_row
        rts

; puts : copy the $00-terminated ASCII string at (sprptr) to (ptr), hi-bit set.
puts:
        ldy #0
puts_l:
        lda (sprptr),y
        beq puts_d
        ora #$80
        sta (ptr),y
        iny
        bne puts_l
puts_d:
        rts

; sc_byte : A = BCD byte, Y = cell; writes two digits at (ptr),Y and Y += 2.
sc_byte:
        pha
        lsr a
        lsr a
        lsr a
        lsr a
        ora #$B0
        sta (ptr),y
        iny
        pla
        and #$0F
        ora #$B0
        sta (ptr),y
        iny
        rts

; put_score : write the 6-digit BCD score at (ptr) (cells 0..5).
put_score:
        ldy #0
        lda score2
        jsr sc_byte
        lda score1
        jsr sc_byte
        lda score0
        jsr sc_byte
        rts

; put_high : write the 6-digit BCD high score at (ptr).
put_high:
        ldy #0
        lda hisc2
        jsr sc_byte
        lda hisc1
        jsr sc_byte
        lda hisc0
        jsr sc_byte
        rts

; hud_play : SCORE nnnnnn ... LIVES n ... WAVE n   (row 22)
hud_play:
        jsr hud_clear
        lda #<HUD22
        sta ptr
        lda #>HUD22
        sta ptr+1
        lda #<MSG_SCORE
        sta sprptr
        lda #>MSG_SCORE
        sta sprptr+1
        jsr puts
        lda #<(HUD22+6)
        sta ptr
        lda #>(HUD22+6)
        sta ptr+1
        jsr put_score
        lda #<(HUD22+18)
        sta ptr
        lda #>(HUD22+18)
        sta ptr+1
        lda #<MSG_LIVES
        sta sprptr
        lda #>MSG_LIVES
        sta sprptr+1
        jsr puts
        lda lives
        ora #$B0
        ldy #6                  ; ptr = HUD22+18 -> col 24
        sta (ptr),y
        lda #<(HUD22+28)
        sta ptr
        lda #>(HUD22+28)
        sta ptr+1
        lda #<MSG_WAVE
        sta sprptr
        lda #>MSG_WAVE
        sta sprptr+1
        jsr puts
        lda wave
        cmp #10
        bcc hp_w
        lda #9
hp_w:
        ora #$B0
        ldy #5                  ; ptr = HUD22+28 -> col 33
        sta (ptr),y
        rts

; hud_attract : the title, the start prompt, and the high score.
hud_attract:
        jsr hud_clear
        lda #<(HUD20+15)
        sta ptr
        lda #>(HUD20+15)
        sta ptr+1
        lda #<MSG_TITLE
        sta sprptr
        lda #>MSG_TITLE
        sta sprptr+1
        jsr puts
        lda #<(HUD22+10)
        sta ptr
        lda #>(HUD22+10)
        sta ptr+1
        lda #<MSG_START
        sta sprptr
        lda #>MSG_START
        sta sprptr+1
        jsr puts
        lda #<(HUD23+13)
        sta ptr
        lda #>(HUD23+13)
        sta ptr+1
        lda #<MSG_HIGH
        sta sprptr
        lda #>MSG_HIGH
        sta sprptr+1
        jsr puts
        lda #<(HUD23+18)
        sta ptr
        lda #>(HUD23+18)
        sta ptr+1
        jsr put_high
        rts

; hud_over : GAME OVER, the final score, and the restart prompt.
hud_over:
        jsr hud_clear
        lda #<(HUD20+15)
        sta ptr
        lda #>(HUD20+15)
        sta ptr+1
        lda #<MSG_OVER
        sta sprptr
        lda #>MSG_OVER
        sta sprptr+1
        jsr puts
        lda #<(HUD22+10)
        sta ptr
        lda #>(HUD22+10)
        sta ptr+1
        lda #<MSG_SCORE
        sta sprptr
        lda #>MSG_SCORE
        sta sprptr+1
        jsr puts
        lda #<(HUD22+16)
        sta ptr
        lda #>(HUD22+16)
        sta ptr+1
        jsr put_score
        lda #<(HUD23+10)
        sta ptr
        lda #>(HUD23+10)
        sta ptr+1
        lda #<MSG_START
        sta sprptr
        lda #>MSG_START
        sta sprptr+1
        jsr puts
        rts

; hud_snapshot : copy the four live HUD rows into safe RAM ($6B00..) so tests
;   can read them after the BRK monitor scribbles over the text page.
hud_snapshot:
        ldx #0
hsn_row:
        lda HUDBL,x
        sta ptr
        lda HUDBH,x
        sta ptr+1
        lda SNAPL,x
        sta sprptr
        lda SNAPH,x
        sta sprptr+1
        ldy #39
hsn_col:
        lda (ptr),y
        sta (sprptr),y
        dey
        bpl hsn_col
        inx
        cpx #4
        bne hsn_row
        rts

HUDBL:  .byte $50,$D0,$50,$D0    ; text rows 20,21,22,23 low bytes
HUDBH:  .byte $06,$06,$07,$07    ; ... high bytes
SNAPL:  .byte $00,$28,$50,$78    ; snapshot rows at $6B00/$6B28/$6B50/$6B78
SNAPH:  .byte $6B,$6B,$6B,$6B
MSG_TITLE: .asciiz "STAR SWARM"
MSG_START: .asciiz "PRESS SPACE TO PLAY"
MSG_OVER:  .asciiz "GAME OVER"
MSG_SCORE: .asciiz "SCORE"
MSG_LIVES: .asciiz "LIVES"
MSG_WAVE:  .asciiz "WAVE"
MSG_HIGH:  .asciiz "HIGH"

; ---------------------------------------------------------------------------
; BRK test hooks (headless harness entry points)
; ---------------------------------------------------------------------------
build_brk:
        jsr build_rows
        brk
clear_brk:
        jsr clear_screen
        brk
sprite_brk:
        jsr draw_sprite
        brk
init_brk:
        jsr init_cannon
        brk
frame_brk:
        jsr play_frame
        brk
initform_brk:
        jsr init_formation
        brk
march_brk:
        jsr march_step
        brk
advance_brk:
        jsr advance_formation
        brk
initall_brk:
        jsr init_cannon
        jsr init_formation
        brk
bolthit_brk:
        jsr check_bolt_hits
        brk
spawn_brk:
        jsr spawn_bomb
        brk
updbomb_brk:
        jsr update_bombs
        brk
bombhit_brk:
        jsr check_bomb_hits
        brk
initbunk_brk:
        jsr init_bunkers
        brk
shotbunk_brk:
        jsr check_shot_bunker
        brk
bombbunk_brk:
        jsr check_bomb_bunker
        brk
spawnufo_brk:
        jsr spawn_ufo
        brk
updufo_brk:
        jsr update_ufo
        brk
shotufo_brk:
        jsr check_shot_ufo
        brk
flow_brk:
        jsr game_frame
        brk
attract_brk:
        jsr enter_attract
        brk
newgame_brk:
        jsr enter_play
        brk
land_brk:
        jsr check_landing
        brk
nextwave_brk:
        jsr next_wave
        brk
hiscore_brk:
        jsr update_hiscore
        brk
hud_brk:
        jsr hud_play
        jsr hud_snapshot
        brk
hudatt_brk:
        jsr hud_attract
        jsr hud_snapshot
        brk
hudover_brk:
        jsr hud_over
        jsr hud_snapshot
        brk
