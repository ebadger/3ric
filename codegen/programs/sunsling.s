; SUNSLING -- an original two-pilot gravity duel for the 3RIC 65C02.
; Load/entry $0800. Native 1x. ENTER or a fresh pad START launches.
; P1: A/D turn, W/S burn/coast, F or SPACE burst, E hyperspace.
; P2: J/L turn, I/K burn/coast, U burst, O hyperspace.
; Keyboard burn stays ON until coast: both pilots can fly at once.
; Pads: LEFT/RIGHT turn, UP/B burn, A/Y fire, SELECT hyperspace.
; P or START pauses; M mutes; Q/ESC returns to the monitor.

        .org $0800

KEYBOARD = $C000
KEY_ACK = $C010
SPEAKER = $C030
PTRIG = $C070
T2_LOW = $C208
T2_HIGH = $C209
VIA_ACR = $C20B
VIA_IFR = $C20D
VIA_IER = $C20E
JOY_MODE = $CE15
PAD1 = $CEE0
PAD2 = $CEF0
HOME = $FC58
FRAME_PERIOD = 52448
; Current ROM pad scan plus frame-loop overhead, guarded by the cadence tests.
FRAME_OVERHEAD = 1600
FRAME_LATCH = FRAME_PERIOD-FRAME_OVERHEAD
BODY_COUNT = 10
SHOT_LIFETIME = 60
FIRE_GAP = 6
BURST_TICKS = 13
RESPAWN_TICKS = 45
SHIELD_TICKS = 45
JUMP_TICKS = 240

PTR = $50
PX = $52
PY = $53
LX = $54
LY = $55
TX = $56
TY = $57
DX = $58
DY = $59
SX = $5A
SY = $5B
ERROR = $5C
LINE_COUNT = $5D
ANCHOR_X = $5E
ANCHOR_Y = $5F
BODY = $60
TEMP = $61
TEMP2 = $62
GRAV_DX = $63
GRAV_DY = $64
SIGN_X = $65
SIGN_Y = $66
RADIUS = $67
STRENGTH = $68
PRODUCT_LO = $69
PRODUCT_HI = $6A
MULT_LO = $6B
MULT_HI = $6C
FACTOR = $6D
VECTOR = $6E
REMAIN = $6F
COUNTER = $70
DRAW_ANGLE = $71
POINT = $72
LIMIT_HI = $73
LIMIT_NEG = $74
TARGET = $75
HIT_RADIUS = $76
PAD_OFFSET = $77
STR_PTR = $78
TEXT_PTR = $7A

ROW_LO = $6000
ROW_HI = $6100
COL_BYTE = $6200
COL_MASK = $6300
STATE = $6400
MODE = STATE
TICK = STATE+1
REQUEST = STATE+2
QUIT_REQUEST = STATE+3
LAST_MODE = STATE+4
MUTED = STATE+5
SOUND_EVENT = STATE+6
HIT_MASK = STATE+7
SAVED_ACR = STATE+8
SAVED_IER = STATE+9
SAVED_JOY = STATE+10
SEED_LO = STATE+11
SEED_HI = STATE+12
PREV_START = STATE+16
PREV_SELECT = STATE+18
TITLE_CHAR = STATE+32
TITLE_ROW = STATE+33
TITLE_COL = STATE+34
TITLE_BITS = STATE+35
TITLE_X = STATE+36
TITLE_Y = STATE+37
TILE_X = STATE+38
TILE_Y = STATE+39
FONT_INDEX = STATE+40

X_LO = $6500
X_HI = $6510
Y_LO = $6520
Y_HI = $6530
VX_LO = $6540
VX_HI = $6550
VY_LO = $6560
VY_HI = $6570
LIFE = $6580
ANGLE = $6590
SCORE = $65A0
DEAD = $65A2
SHIELD = $65A4
GUN_CD = $65A6
JUMP_CD = $65A8
KEY_BURN = $65AA
KEY_FIRE = $65AC
TURN_INPUT = $65AE
BURN_INPUT = $65B0
FIRE_INPUT = $65B2
JUMP_INPUT = $65B4
ENGINE_DRAW = $65B6
OWNER = $65C0

start:
        php
        sei
        cld
        ldx #0
        lda #0
clear_state:
        sta STATE,x
        inx
        bne clear_state
        lda VIA_ACR
        sta SAVED_ACR
        and #$DF
        sta VIA_ACR
        lda VIA_IER
        and #$20
        sta SAVED_IER
        lda #$20
        sta VIA_IER
        lda JOY_MODE
        sta SAVED_JOY
        stz JOY_MODE
        lda #$D3
        sta SEED_LO
        lda #$A7
        sta SEED_HI
        jsr HOME
        bit $C054
        bit $C057
        bit $C053
        bit $C050
        bit KEY_ACK
        jsr make_tables
        jsr new_match
        stz MODE
        jsr draw_title
        bit PTRIG
        lda PAD1+3
        sta PREV_START
        lda PAD2+3
        sta PREV_START+1
        lda PAD1+2
        sta PREV_SELECT
        lda PAD2+2
        sta PREV_SELECT+1
        jsr draw_actors
        jsr draw_hud

main:
        jsr read_controls
        jsr frame
        lda QUIT_REQUEST
        bne exit_game
frame_wait:
        lda T2_HIGH
        cmp #>FRAME_LATCH
        bcc frame_wait
        jmp main

exit_game:
        lda T2_LOW
        lda SAVED_ACR
        sta VIA_ACR
        lda #$20
        sta VIA_IER
        lda SAVED_IER
        beq exit_no_timer_irq
        ora #$80
        sta VIA_IER
exit_no_timer_irq:
        lda SAVED_JOY
        sta JOY_MODE
        bit KEY_ACK
        bit $C054
        bit $C051
        bit $C052
        jsr HOME
        plp
exit_monitor:
        brk

frame:
        jsr draw_actors
        lda QUIT_REQUEST
        beq frame_request
        rts
frame_request:
        lda REQUEST
        beq frame_simulate
        lda MODE
        beq frame_launch
        cmp #3
        beq frame_launch
        eor #3
        sta MODE
        bra frame_simulate
frame_launch:
        lda REQUEST
        cmp #2
        beq frame_simulate
        jsr new_match
frame_simulate:
        lda MODE
        cmp #1
        bne frame_render
        jsr step_game
frame_render:
        jsr draw_actors
        jsr draw_hud
        jsr play_sound
        rts

new_match:
        lda #0
        ldx #0
match_clear:
        sta X_LO,x
        inx
        bne match_clear
        stz TICK
        stz HIT_MASK
        stz SOUND_EVENT
        lda #1
        sta MODE
        lda #$FF
        sta LAST_MODE
        ldx #6
match_owners:
        lda #1
        sta OWNER,x
        inx
        cpx #BODY_COUNT
        bne match_owners
        ldx #0
        jsr spawn_ship
        ldx #1
        jsr spawn_ship
        jsr draw_background
        jmp hud_base

spawn_ship:
        lda spawn_x,x
        sta X_HI,x
        lda spawn_y,x
        sta Y_HI,x
        stz X_LO,x
        stz Y_LO,x
        lda spawn_vx_lo,x
        sta VX_LO,x
        lda spawn_vx_hi,x
        sta VX_HI,x
        lda spawn_vy_lo,x
        sta VY_LO,x
        lda spawn_vy_hi,x
        sta VY_HI,x
        lda spawn_angle,x
        sta ANGLE,x
        lda #SHIELD_TICKS
        sta SHIELD,x
        stz DEAD,x
        stz KEY_BURN,x
        stz KEY_FIRE,x
        stz ENGINE_DRAW,x
        stz GUN_CD,x
        stz JUMP_CD,x
        rts

read_controls:
        stz REQUEST
        stz QUIT_REQUEST
        ldx #1
controls_clear:
        stz TURN_INPUT,x
        stz JUMP_INPUT,x
        lda KEY_BURN,x
        sta BURN_INPUT,x
        lda KEY_FIRE,x
        sta FIRE_INPUT,x
        dex
        bpl controls_clear
        bit PTRIG
        ; The ROM scan reloads T1/T2. Re-arm after it, then observe counter
        ; wrap: a later keyboard/T1 NMI can clear IFR even with T2 IRQ masked.
        lda #<FRAME_LATCH
        sta T2_LOW
        lda #>FRAME_LATCH
        sta T2_HIGH
        stz BODY
pad_loop:
        lda BODY
        asl
        asl
        asl
        asl
        sta PAD_OFFSET
        tay
        ldx BODY
        lda PAD1+3,y
        beq pad_save_start
        cmp PREV_START,x
        beq pad_save_start
        lda #1
        sta REQUEST
pad_save_start:
        lda PAD1+3,y
        sta PREV_START,x
        lda PAD1+2,y
        beq pad_save_select
        cmp PREV_SELECT,x
        beq pad_save_select
        lda #1
        sta JUMP_INPUT,x
pad_save_select:
        lda PAD1+2,y
        sta PREV_SELECT,x
        lda PAD1+4,y
        ora PAD1,y
        ora BURN_INPUT,x
        sta BURN_INPUT,x
        lda PAD1+8,y
        ora PAD1+1,y
        ora FIRE_INPUT,x
        sta FIRE_INPUT,x
        lda TICK
        and #3
        bne pad_next
        lda PAD1+6,y
        cmp PAD1+7,y
        beq pad_next
        lda PAD1+7,y
        bne pad_right
        lda #$FF
        bra pad_turn
pad_right:
        lda #1
pad_turn:
        sta TURN_INPUT,x
pad_next:
        inc BODY
        lda BODY
        cmp #2
        bne pad_loop
        lda KEYBOARD
        bmi key_ready
        rts
key_ready:
        and #$7F
        sta TEMP
        bit KEY_ACK
        cmp #27
        beq key_quit
        cmp #'Q'
        beq key_quit
        cmp #'M'
        beq key_mute
        cmp #'P'
        beq key_pause
        cmp #13
        beq key_enter
        lda MODE
        cmp #1
        beq key_flight
        rts
key_quit:
        lda #1
        sta QUIT_REQUEST
        rts
key_mute:
        lda MUTED
        eor #1
        sta MUTED
        rts
key_pause:
        lda #2
        sta REQUEST
        rts
key_enter:
        lda MODE
        beq key_launch
        cmp #3
        bne key_enter_done
key_launch:
        lda #1
        sta REQUEST
key_enter_done:
        rts
key_flight:
        ldx #0
        lda TEMP
        cmp #'A'
        beq key_left
        cmp #8
        beq key_left
        cmp #'D'
        beq key_right
        cmp #21
        beq key_right
        cmp #'W'
        beq key_burn_on
        cmp #11
        beq key_burn_on
        cmp #'S'
        beq key_coast
        cmp #10
        beq key_coast
        cmp #'F'
        beq key_shoot
        cmp #32
        beq key_shoot
        cmp #'E'
        beq key_jump
        inx
        cmp #'J'
        beq key_left
        cmp #'L'
        beq key_right
        cmp #'I'
        beq key_burn_on
        cmp #'K'
        beq key_coast
        cmp #'U'
        beq key_shoot
        cmp #'O'
        beq key_jump
        rts
key_left:
        lda #$FF
        bra key_store_turn
key_right:
        lda #1
key_store_turn:
        sta TURN_INPUT,x
        rts
key_burn_on:
        lda #1
        sta KEY_BURN,x
        sta BURN_INPUT,x
        rts
key_coast:
        stz KEY_BURN,x
        stz BURN_INPUT,x
        rts
key_shoot:
        lda #BURST_TICKS
        sta KEY_FIRE,x
        sta FIRE_INPUT,x
        rts
key_jump:
        lda #1
        sta JUMP_INPUT,x
        rts

step_game:
        stz HIT_MASK
        stz BODY
step_ship:
        ldx BODY
        lda DEAD,x
        beq ship_live
        dec DEAD,x
        beq ship_respawn
        jmp ship_next
ship_respawn:
        jsr spawn_ship
        jmp ship_next
ship_live:
        lda SHIELD,x
        beq ship_gun_timer
        dec SHIELD,x
ship_gun_timer:
        lda GUN_CD,x
        beq ship_jump_timer
        dec GUN_CD,x
ship_jump_timer:
        lda JUMP_CD,x
        beq ship_burst_timer
        dec JUMP_CD,x
ship_burst_timer:
        lda KEY_FIRE,x
        beq ship_turn
        dec KEY_FIRE,x
ship_turn:
        lda ANGLE,x
        clc
        adc TURN_INPUT,x
        and #15
        sta ANGLE,x
        lda JUMP_INPUT,x
        beq ship_burn
        jsr hyperspace
ship_burn:
        ldx BODY
        lda BURN_INPUT,x
        sta ENGINE_DRAW,x
        beq ship_gravity
        ldy ANGLE,x
        lda thrust_x,y
        jsr add_signed
        ldx BODY
        ldy ANGLE,x
        txa
        clc
        adc #32
        tax
        lda thrust_y,y
        jsr add_signed
ship_gravity:
        jsr gravity
        lda #2
        jsr clamp_velocity
        jsr move_body
        lda #10
        sta HIT_RADIUS
        jsr sun_contact
        bcc ship_fire
        ldx BODY
        lda player_bit,x
        ora HIT_MASK
        sta HIT_MASK
ship_fire:
        ldx BODY
        lda FIRE_INPUT,x
        beq ship_next
        jsr fire
ship_next:
        inc BODY
        lda BODY
        cmp #2
        beq step_ship_contact
        jmp step_ship
step_ship_contact:
        lda DEAD
        ora DEAD+1
        ora SHIELD
        ora SHIELD+1
        bne step_shots
        stz BODY
        lda #1
        sta TARGET
        lda #9
        sta HIT_RADIUS
        jsr body_contact
        bcc step_shots
        lda #3
        sta HIT_MASK
step_shots:
        lda #2
        sta BODY
step_shot:
        ldx BODY
        lda LIFE,x
        beq shot_next
        dec LIFE,x
        beq shot_next
        jsr gravity
        lda #4
        jsr clamp_velocity
        jsr move_body
        lda #7
        sta HIT_RADIUS
        jsr sun_contact
        bcs shot_remove
        ldx BODY
        lda OWNER,x
        eor #1
        sta TARGET
        tay
        lda DEAD,y
        ora SHIELD,y
        bne shot_next
        lda #7
        sta HIT_RADIUS
        jsr body_contact
        bcc shot_next
        ldx TARGET
        lda player_bit,x
        ora HIT_MASK
        sta HIT_MASK
shot_remove:
        ldx BODY
        stz LIFE,x
shot_next:
        inc BODY
        lda BODY
        cmp #BODY_COUNT
        bne step_shot
        jsr resolve_hits
        inc TICK
        rts

; Acceleration magnitude is a softened inverse-square lookup. Scaling each
; component by distance preserves a radial pull, rather than diagonal snapping.
gravity:
        ldx BODY
        stz SIGN_X
        stz SIGN_Y
        lda #128
        sec
        sbc X_HI,x
        bcs gravity_x_positive
        inc SIGN_X
        eor #$FF
        clc
        adc #1
gravity_x_positive:
        sta GRAV_DX
        lda #80
        sec
        sbc Y_HI,x
        bcs gravity_y_positive
        inc SIGN_Y
        eor #$FF
        clc
        adc #1
gravity_y_positive:
        sta GRAV_DY
        cmp GRAV_DX
        bcc gravity_x_major
        sta RADIUS
        lda GRAV_DX
        bra gravity_radius
gravity_x_major:
        lda GRAV_DX
        sta RADIUS
        lda GRAV_DY
gravity_radius:
        lsr
        clc
        adc RADIUS
        sta RADIUS
        bne gravity_nonzero
        rts
gravity_nonzero:
        lsr
        lsr
        lsr
        tay
        lda gravity_strength,y
        sta STRENGTH
        lda GRAV_DX
        jsr scale_force
        ldx SIGN_X
        beq gravity_add_x
        eor #$FF
        clc
        adc #1
gravity_add_x:
        ldx BODY
        jsr add_signed
        lda GRAV_DY
        jsr scale_force
        ldx SIGN_Y
        beq gravity_add_y
        eor #$FF
        clc
        adc #1
gravity_add_y:
        pha
        lda BODY
        clc
        adc #32
        tax
        pla
        jmp add_signed

; A * STRENGTH / RADIUS. Quotient <= 64, so eight division rounds suffice.
scale_force:
        cmp #0
        beq force_done
        sta MULT_LO
        stz MULT_HI
        stz PRODUCT_LO
        stz PRODUCT_HI
        lda STRENGTH
        sta FACTOR
force_multiply:
        lsr FACTOR
        bcc force_shift
        lda PRODUCT_LO
        clc
        adc MULT_LO
        sta PRODUCT_LO
        lda PRODUCT_HI
        adc MULT_HI
        sta PRODUCT_HI
force_shift:
        asl MULT_LO
        rol MULT_HI
        lda FACTOR
        bne force_multiply
        ldx #8
force_divide:
        asl PRODUCT_LO
        rol PRODUCT_HI
        lda PRODUCT_HI
        bcs force_subtract
        cmp RADIUS
        bcc force_divide_next
force_subtract:
        sec
        sbc RADIUS
        sta PRODUCT_HI
        inc PRODUCT_LO
force_divide_next:
        dex
        bne force_divide
        lda PRODUCT_LO
force_done:
        rts

; Component X=body for vx, X=body+32 for vy; A is signed 0.8 acceleration.
add_signed:
        sta TEMP
        lda #0
        bit TEMP
        bpl acceleration_sign
        lda #$FF
acceleration_sign:
        sta TEMP2
        lda VX_LO,x
        clc
        adc TEMP
        sta VX_LO,x
        lda VX_HI,x
        adc TEMP2
        sta VX_HI,x
        rts

clamp_velocity:
        sta LIMIT_HI
        eor #$FF
        clc
        adc #1
        sta LIMIT_NEG
        ldx BODY
        jsr clamp_component
        lda BODY
        clc
        adc #32
        tax
clamp_component:
        lda VX_HI,x
        bmi clamp_negative
        cmp LIMIT_HI
        bcc clamp_done
        lda LIMIT_HI
        bra clamp_store
clamp_negative:
        cmp LIMIT_NEG
        bcs clamp_done
        lda LIMIT_NEG
clamp_store:
        sta VX_HI,x
        stz VX_LO,x
clamp_done:
        rts

move_body:
        ldx BODY
        lda X_LO,x
        clc
        adc VX_LO,x
        sta X_LO,x
        lda X_HI,x
        adc VX_HI,x
        sta X_HI,x
        lda Y_LO,x
        clc
        adc VY_LO,x
        sta Y_LO,x
        lda Y_HI,x
        adc VY_HI,x
        jsr wrap_y
        sta Y_HI,x
        rts

; Bounded motion/local drawing can produce -16..175, represented modulo 256.
wrap_y:
        cmp #224
        bcc wrap_y_bottom
        clc
        adc #160
        rts
wrap_y_bottom:
        cmp #160
        bcc wrap_y_done
        sbc #160
wrap_y_done:
        rts

sun_contact:
        ldx BODY
        lda X_HI,x
        sec
        sbc #128
        bcs sun_x_abs
        eor #$FF
        clc
        adc #1
sun_x_abs:
        cmp HIT_RADIUS
        bcs contact_miss
        lda Y_HI,x
        sec
        sbc #80
        bcs sun_y_abs
        eor #$FF
        clc
        adc #1
sun_y_abs:
        cmp HIT_RADIUS
        bcs contact_miss
        sec
        rts
contact_miss:
        clc
        rts

; Shortest separations on the 256x160 torus, including collisions at seams.
body_contact:
        ldx BODY
        ldy TARGET
        lda X_HI,x
        sec
        sbc X_HI,y
        cmp #128
        bcc contact_x_abs
        eor #$FF
        clc
        adc #1
contact_x_abs:
        cmp HIT_RADIUS
        bcs contact_miss
        lda Y_HI,x
        sec
        sbc Y_HI,y
        bcs contact_y_abs
        eor #$FF
        clc
        adc #1
contact_y_abs:
        cmp #80
        bcc contact_y_short
        sta TEMP
        lda #160
        sec
        sbc TEMP
contact_y_short:
        cmp HIT_RADIUS
        bcs contact_miss
        sec
        rts

fire:
        ldx BODY
        lda GUN_CD,x
        beq fire_find
        rts
fire_find:
        ldy first_slot,x
        lda last_slot,x
        sta REMAIN
fire_search:
        lda LIFE,y
        beq fire_found
        iny
        cpy REMAIN
        bne fire_search
        rts
fire_found:
        sty TARGET
        lda #SHOT_LIFETIME
        sta LIFE,y
        lda ANGLE,x
        sta ANGLE,y
        tay
        lda nose_x,y
        clc
        adc X_HI,x
        ldy TARGET
        sta X_HI,y
        lda X_LO,x
        sta X_LO,y
        ldy ANGLE,x
        lda nose_y,y
        clc
        adc Y_HI,x
        jsr wrap_y
        ldy TARGET
        sta Y_HI,y
        lda Y_LO,x
        sta Y_LO,y
        ldy ANGLE,x
        lda shot_vx_lo,y
        clc
        adc VX_LO,x
        sta TEMP
        lda shot_vx_hi,y
        adc VX_HI,x
        ldy TARGET
        sta VX_HI,y
        lda TEMP
        sta VX_LO,y
        ldy ANGLE,x
        lda shot_vy_lo,y
        clc
        adc VY_LO,x
        sta TEMP
        lda shot_vy_hi,y
        adc VY_HI,x
        ldy TARGET
        sta VY_HI,y
        lda TEMP
        sta VY_LO,y
        lda #FIRE_GAP
        sta GUN_CD,x
        lda #1
        jmp request_sound

hyperspace:
        ldx BODY
        lda JUMP_CD,x
        beq jump_ready
        rts
jump_ready:
        jsr random
        and #3
        sta VECTOR
        jsr random
        and #127
        clc
        adc #64
        ldx BODY
        sta X_HI,x
        lda #16
        sta Y_HI,x
        lda VECTOR
        beq jump_place
        cmp #2
        beq jump_bottom
        jsr random
        and #127
        clc
        adc #16
        sta Y_HI,x
        lda #24
        sta X_HI,x
        lda VECTOR
        cmp #1
        beq jump_place
        lda #232
        sta X_HI,x
        bra jump_place
jump_bottom:
        lda #144
        sta Y_HI,x
jump_place:
        stz X_LO,x
        stz Y_LO,x
        stz VX_LO,x
        stz VX_HI,x
        stz VY_LO,x
        stz VY_HI,x
        lda #20
        sta SHIELD,x
        lda #JUMP_TICKS
        sta JUMP_CD,x
        lda #2
        jmp request_sound

resolve_hits:
        ldx #0
resolve_player:
        lda player_bit,x
        and HIT_MASK
        beq resolve_next
        lda DEAD,x
        bne resolve_next
        lda #RESPAWN_TICKS
        sta DEAD,x
        stz KEY_BURN,x
        stz KEY_FIRE,x
        stz ENGINE_DRAW,x
        txa
        eor #1
        tay
        lda SCORE,y
        clc
        adc #1
        sta SCORE,y
        lda #3
        jsr request_sound
resolve_next:
        inx
        cpx #2
        bne resolve_player
        lda SCORE
        cmp #5
        bcs match_over
        lda SCORE+1
        cmp #5
        bcc resolve_done
match_over:
        lda #3
        sta MODE
resolve_done:
        rts

request_sound:
        cmp SOUND_EVENT
        bcc sound_requested
        sta SOUND_EVENT
sound_requested:
        rts

play_sound:
        lda SOUND_EVENT
        beq sound_done
        lda MUTED
        bne sound_clear
        ldx #12
sound_edge:
        lda SOUND_EVENT
        cmp #3
        beq sound_noise
        asl
        asl
        asl
        asl
        clc
        adc #32
        bra sound_delay
sound_noise:
        jsr random
        and #63
        clc
        adc #24
sound_delay:
        tay
sound_wait:
        dey
        bne sound_wait
        bit SPEAKER
        dex
        bne sound_edge
sound_clear:
        stz SOUND_EVENT
sound_done:
        rts

random:
        lsr SEED_HI
        ror SEED_LO
        bcc random_done
        lda SEED_HI
        eor #$B4
        sta SEED_HI
random_done:
        lda SEED_LO
        eor SEED_HI
        rts

make_tables:
        ldy #0
table_row:
        tya
        and #8
        asl
        asl
        asl
        asl
        sta TEMP
        tya
        lsr
        lsr
        lsr
        lsr
        lsr
        lsr
        tax
        lda row_band,x
        ora TEMP
        sta ROW_LO,y
        tya
        and #7
        asl
        asl
        ora #$20
        sta TEMP
        tya
        lsr
        lsr
        lsr
        lsr
        and #3
        ora TEMP
        sta ROW_HI,y
        iny
        cpy #160
        bne table_row
        lda #1
        sta TEMP
        ldx #5
        ldy #0
table_col:
        lda TEMP
        sta COL_BYTE,y
        lda pixel_bits,x
        sta COL_MASK,y
        inx
        cpx #7
        bne table_col_next
        ldx #0
        inc TEMP
table_col_next:
        iny
        bne table_col
        rts

clear_hgr:
        stz PTR
        lda #$20
        sta PTR+1
        lda #0
        ldy #0
clear_hgr_byte:
        sta (PTR),y
        iny
        bne clear_hgr_byte
        inc PTR+1
        ldx PTR+1
        cpx #$40
        bne clear_hgr_byte
        rts

; XOR is its own erase. Local coordinates wrap before address lookup, so
; a ship crossing a seam cannot draw a line across the middle of the screen.
plot_local:
        lda LX
        clc
        adc ANCHOR_X
        sec
        sbc #16
        sta PX
        lda LY
        clc
        adc ANCHOR_Y
        sec
        sbc #16
        jsr wrap_y
        sta PY
plot:
        ldy PY
        cpy #160
        bcs plot_done
        lda ROW_LO,y
        sta PTR
        lda ROW_HI,y
        sta PTR+1
        ldx PX
        ldy COL_BYTE,x
        lda COL_MASK,x
        eor (PTR),y
        sta (PTR),y
plot_done:
        rts

; Integer DDA, excluding the final endpoint so polygon corners XOR once.
line:
        lda #1
        sta SX
        sta SY
        lda TX
        sec
        sbc LX
        bcs line_dx
        dec SX
        dec SX
        eor #$FF
        clc
        adc #1
line_dx:
        sta DX
        lda TY
        sec
        sbc LY
        bcs line_dy
        dec SY
        dec SY
        eor #$FF
        clc
        adc #1
line_dy:
        sta DY
        cmp DX
        bcs line_y_major
        lda DX
        sta LINE_COUNT
        lsr
        sta ERROR
line_x_loop:
        jsr plot_local
        lda LX
        clc
        adc SX
        sta LX
        lda ERROR
        sec
        sbc DY
        bcs line_x_error
        adc DX
        sta ERROR
        lda LY
        clc
        adc SY
        sta LY
        bra line_x_next
line_x_error:
        sta ERROR
line_x_next:
        dec LINE_COUNT
        bne line_x_loop
        rts
line_y_major:
        lda DY
        beq line_done
        sta LINE_COUNT
        lsr
        sta ERROR
line_y_loop:
        jsr plot_local
        lda LY
        clc
        adc SY
        sta LY
        lda ERROR
        sec
        sbc DX
        bcs line_y_error
        adc DY
        sta ERROR
        lda LX
        clc
        adc SX
        sta LX
        bra line_y_next
line_y_error:
        sta ERROR
line_y_next:
        dec LINE_COUNT
        bne line_y_loop
line_done:
        rts

draw_background:
        jsr clear_hgr
        lda #72
        sta COUNTER
background_star:
        jsr random
        sta PX
        ; Separate the two coordinates by a byte of LFSR evolution.
        ldx #8
background_mix:
        jsr random
        dex
        bne background_mix
        and #127
        clc
        adc #16
        sta PY
        jsr plot
        dec COUNTER
        bne background_star
        stz COUNTER
sun_row:
        ldx COUNTER
        lda sun_width,x
        sta REMAIN
        lsr
        sta TEMP
        lda #128
        sec
        sbc TEMP
        sta PX
        txa
        clc
        adc #75
        sta PY
sun_pixel:
        jsr plot
        inc PX
        dec REMAIN
        bne sun_pixel
        inc COUNTER
        lda COUNTER
        cmp #11
        bne sun_row
        lda #15
        sta COUNTER
sun_corona:
        ldx COUNTER
        lda corona_x,x
        clc
        adc #128
        sta PX
        lda corona_y,x
        clc
        adc #80
        sta PY
        jsr plot
        dec COUNTER
        bpl sun_corona
        rts

draw_actors:
        stz BODY
draw_actor:
        ldx BODY
        lda X_HI,x
        sta ANCHOR_X
        lda Y_HI,x
        sta ANCHOR_Y
        cpx #2
        bcc draw_pilot
        jmp draw_shot
draw_pilot:
        lda DEAD,x
        beq draw_live_ship
        jsr draw_explosion
        jmp draw_next
draw_live_ship:
        lda SHIELD,x
        beq draw_ship
        lda TICK
        and #2
        beq draw_ship
        jmp draw_next
draw_ship:
        lda ANGLE,x
        sta DRAW_ANGLE
        tay
        jsr nose_point
        lda TX
        sta LX
        lda TY
        sta LY
        lda DRAW_ANGLE
        clc
        adc #6
        and #15
        tay
        jsr wing_point
        jsr line
        lda BODY
        beq draw_second_wing
        lda DRAW_ANGLE
        clc
        adc #8
        and #15
        tay
        jsr tail_point
        jsr line
draw_second_wing:
        lda DRAW_ANGLE
        clc
        adc #10
        and #15
        tay
        jsr wing_point
        jsr line
        ldy DRAW_ANGLE
        jsr nose_point
        jsr line
        ldx BODY
        lda ENGINE_DRAW,x
        beq draw_next
        lda DRAW_ANGLE
        clc
        adc #8
        and #15
        tay
        jsr nose_point
        lda TX
        sta LX
        lda TY
        sta LY
        jsr plot_local
        bra draw_next
draw_shot:
        lda LIFE,x
        beq draw_next
        lda #16
        sta LX
        sta LY
        jsr plot_local
        inc LX
        jsr plot_local
draw_next:
        inc BODY
        lda BODY
        cmp #BODY_COUNT
        beq draw_done
        jmp draw_actor
draw_done:
        rts

nose_point:
        lda nose_x,y
        clc
        adc #16
        sta TX
        lda nose_y,y
        clc
        adc #16
        sta TY
        rts
wing_point:
        ldx BODY
        bne nose_point
        lda wing_x,y
        clc
        adc #16
        sta TX
        lda wing_y,y
        clc
        adc #16
        sta TY
        rts
tail_point:
        lda tail_x,y
        clc
        adc #16
        sta TX
        lda tail_y,y
        clc
        adc #16
        sta TY
        rts

draw_explosion:
        cmp #25
        bcc explosion_done
        sta TEMP
        lda #RESPAWN_TICKS
        sec
        sbc TEMP
        lsr
        clc
        adc #2
        sta VECTOR
        lda #7
        sta POINT
explosion_point:
        ldx POINT
        lda spark_x,x
        jsr spark_offset
        sta LX
        ldx POINT
        lda spark_y,x
        jsr spark_offset
        sta LY
        jsr plot_local
        dec POINT
        bpl explosion_point
explosion_done:
        rts
spark_offset:
        beq spark_center
        bmi spark_negative
        lda #16
        clc
        adc VECTOR
        rts
spark_negative:
        lda #16
        sec
        sbc VECTOR
        rts
spark_center:
        lda #16
        rts

draw_title:
        stz TITLE_CHAR
        lda #56
        sta TITLE_X
title_character:
        ldx TITLE_CHAR
        lda title_offsets,x
        sta FONT_INDEX
        stz TITLE_ROW
        lda #18
        sta TITLE_Y
title_scanline:
        ldx FONT_INDEX
        lda title_font,x
        sta TITLE_BITS
        stz TITLE_COL
title_column:
        lda TITLE_BITS
        and #16
        beq title_next_column
        lda #0
        sta TILE_Y
title_tile_row:
        stz TILE_X
title_tile_pixel:
        lda TITLE_COL
        asl
        clc
        adc TITLE_COL
        adc TITLE_X
        adc TILE_X
        sta PX
        lda TITLE_Y
        clc
        adc TILE_Y
        sta PY
        jsr plot
        inc TILE_X
        lda TILE_X
        cmp #3
        bne title_tile_pixel
        inc TILE_Y
        lda TILE_Y
        cmp #3
        bne title_tile_row
title_next_column:
        asl TITLE_BITS
        inc TITLE_COL
        lda TITLE_COL
        cmp #5
        bne title_column
        inc FONT_INDEX
        lda TITLE_Y
        clc
        adc #3
        sta TITLE_Y
        inc TITLE_ROW
        lda TITLE_ROW
        cmp #7
        bne title_scanline
        lda TITLE_X
        clc
        adc #18
        sta TITLE_X
        inc TITLE_CHAR
        lda TITLE_CHAR
        cmp #8
        beq title_done
        jmp title_character
title_done:
        rts

hud_base:
        lda #<hud_scores
        sta STR_PTR
        lda #>hud_scores
        sta STR_PTR+1
        lda #$D0
        sta TEXT_PTR
        lda #$06
        sta TEXT_PTR+1
        jsr write_text
        lda #<hud_p1
        sta STR_PTR
        lda #>hud_p1
        sta STR_PTR+1
        lda #$50
        sta TEXT_PTR
        lda #$07
        sta TEXT_PTR+1
        jsr write_text
        lda #<hud_p2
        sta STR_PTR
        lda #>hud_p2
        sta STR_PTR+1
        lda #$D0
        sta TEXT_PTR
        jmp write_text

draw_hud:
        lda MODE
        cmp LAST_MODE
        beq hud_numbers
        sta LAST_MODE
        tax
        cmp #3
        bne hud_status
        lda SCORE
        cmp SCORE+1
        beq hud_draw
        bcs hud_first_wins
        ldx #4
        bra hud_status
hud_first_wins:
        ldx #3
        bra hud_status
hud_draw:
        ldx #5
hud_status:
        lda hud_lo,x
        sta STR_PTR
        lda hud_hi,x
        sta STR_PTR+1
        lda #$50
        sta TEXT_PTR
        lda #$06
        sta TEXT_PTR+1
        jsr write_text
hud_numbers:
        stz BODY
hud_pilot:
        ldx BODY
        ldy score_column,x
        lda SCORE,x
        clc
        adc #$B0
        sta $06D0,y
        ldy burn_column,x
        lda #$AD
        pha
        lda ENGINE_DRAW,x
        beq hud_engine_off
        pla
        lda #$AB
        pha
hud_engine_off:
        pla
        sta $06D0,y
        ldy jump_column,x
        lda JUMP_CD,x
        beq hud_jump_ready
        lda #<hud_wait
        sta STR_PTR
        lda #>hud_wait
        bra hud_jump_ptr
hud_jump_ready:
        lda #<hud_ready
        sta STR_PTR
        lda #>hud_ready
hud_jump_ptr:
        sta STR_PTR+1
        sty TEMP
        ldy #0
hud_jump_char:
        lda (STR_PTR),y
        ora #$80
        ldx TEMP
        sta $06D0,x
        inc TEMP
        iny
        cpy #5
        bne hud_jump_char
        inc BODY
        lda BODY
        cmp #2
        bne hud_pilot
        rts

write_text:
        ldy #0
text_character:
        lda (STR_PTR)
        beq text_pad
        inc STR_PTR
        bne text_pointer
        inc STR_PTR+1
text_pointer:
        ora #$80
        sta (TEXT_PTR),y
        iny
        cpy #40
        bne text_character
        rts
text_pad:
        lda #$A0
text_padding:
        sta (TEXT_PTR),y
        iny
        cpy #40
        bne text_padding
        rts

spawn_x:        .byte 56,200
spawn_y:        .byte 48,112
spawn_vx_lo:    .byte 96,160
spawn_vx_hi:    .byte 0,255
spawn_vy_lo:    .byte 40,216
spawn_vy_hi:    .byte 255,0
spawn_angle:    .byte 0,8
first_slot:     .byte 2,6
last_slot:      .byte 6,10
player_bit:     .byte 1,2
gravity_strength:
        .byte 64,64,48,32,24,17,12,9,7,6,5,4,3,3,2,2,2,2,2,2,2,2
thrust_x:
        .byte 32,30,23,12,0,-12,-23,-30,-32,-30,-23,-12,0,12,23,30
thrust_y:
        .byte 0,12,23,30,32,30,23,12,0,-12,-23,-30,-32,-30,-23,-12
nose_x:
        .byte 8,7,6,3,0,-3,-6,-7,-8,-7,-6,-3,0,3,6,7
nose_y:
        .byte 0,3,6,7,8,7,6,3,0,-3,-6,-7,-8,-7,-6,-3
wing_x:
        .byte 6,6,4,2,0,-2,-4,-6,-6,-6,-4,-2,0,2,4,6
wing_y:
        .byte 0,2,4,6,6,6,4,2,0,-2,-4,-6,-6,-6,-4,-2
tail_x:
        .byte 2,2,1,1,0,-1,-1,-2,-2,-2,-1,-1,0,1,1,2
tail_y:
        .byte 0,1,1,2,2,2,1,1,0,-1,-1,-2,-2,-2,-1,-1
shot_vx_lo:
        .byte 0,197,31,38,0,218,225,59,0,59,225,218,0,38,31,197
shot_vx_hi:
        .byte 3,2,2,1,0,254,253,253,253,253,253,254,0,1,2,2
shot_vy_lo:
        .byte 0,38,31,197,0,197,31,38,0,218,225,59,0,59,225,218
shot_vy_hi:
        .byte 0,1,2,2,3,2,2,1,0,254,253,253,253,253,253,254
row_band:       .byte 0,40,80
pixel_bits:     .byte 1,2,4,8,16,32,64
sun_width:      .byte 1,7,9,11,11,11,11,11,9,7,1
corona_x:
        .byte 12,11,8,5,0,-5,-8,-11,-12,-11,-8,-5,0,5,8,11
corona_y:
        .byte 0,5,8,11,12,11,8,5,0,-5,-8,-11,-12,-11,-8,-5
spark_x:        .byte 1,1,0,-1,-1,-1,0,1
spark_y:        .byte 0,1,1,1,0,-1,-1,-1
title_offsets:  .byte 0,7,14,0,21,28,14,35
title_font:
        .byte 15,16,16,14,1,1,30
        .byte 17,17,17,17,17,17,14
        .byte 17,25,25,21,19,19,17
        .byte 16,16,16,16,16,16,31
        .byte 31,4,4,4,4,4,31
        .byte 14,17,16,23,17,17,14
score_column:   .byte 3,23
burn_column:    .byte 9,29
jump_column:    .byte 13,33
hud_lo:
        .byte <hud_title,<hud_play,<hud_pause,<hud_win1,<hud_win2,<hud_tie
hud_hi:
        .byte >hud_title,>hud_play,>hud_pause,>hud_win1,>hud_win2,>hud_tie
hud_title: .asciiz "SUNSLING  ENTER/START:PLAY  Q:QUIT"
hud_play:  .asciiz "SUNSLING TO 5  P:PAUSE M:MUTE Q:QUIT"
hud_pause: .asciiz "SUNSLING PAUSED  P/START:RESUME Q:QUIT"
hud_win1:  .asciiz "PILOT 1 WINS!  ENTER/START:REMATCH"
hud_win2:  .asciiz "PILOT 2 WINS!  ENTER/START:REMATCH"
hud_tie:   .asciiz "5-5 DRAW!  ENTER/START:REMATCH"
hud_scores:.asciiz "P1 0/5 T:- H:READY  P2 0/5 T:- H:READY  "
hud_p1:    .asciiz "1 A/D TURN W/S BURN/COAST F FIRE E JUMP"
hud_p2:    .asciiz "2 J/L TURN I/K BURN/COAST U FIRE O JUMP"
hud_ready: .byte "READY"
hud_wait:  .byte "WAIT "
program_end:
