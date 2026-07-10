; ============================================================================
; BRICK BUSTER for the 3ric  (65C02, Apple-II compatible) -- text mode 40x24.
;
;   * A compact brick-breaker: clear the bricks, keep the ball in play with the
;     paddle, and press SPACE after game over / win to restart.
;   * Controls: arrow left/right or A/D to move, Q to quit.
;
; Build / run:
;   node codegen/tools/asm6502.mjs emulator/AICodeGen/bricks/bricks.s \
;        emulator/AICodeGen/bricks/bricks.prg --org 0x0800
;   BRUN BRICKS.PRG 0800
; ============================================================================

; ---- soft switches / hardware ----
KBD      = $C000
KBDSTRB  = $C010
TXTSET   = $C051
LOWSCR   = $C054

; ---- glyphs (normal video = ascii | $80) ----
BLANK    = $A0          ; ' '
WALL     = $A3          ; '#'
BRICK    = $A3          ; '#'
BALL     = $CF          ; 'O'
PADDLE   = $BD          ; '='

; ---- geometry ----
TOPROW   = 1
LCOL     = 0
RCOL     = 39
BRICKTOP = 3
BRICKEND = 8            ; rows 3..7
BRICKL   = 2
BRICKR1  = 38           ; cols 2..37
PADDROW  = 22
PADW     = 6

; ---- status digit positions on row 0 ----
SCOREH   = $0413        ; BRICK BUSTER SCORE:000 ...
SCORET   = $0414
SCOREO   = $0415
LIVESPOS = $041D

; ---- pacing ----
PACE     = 20
DLY      = 60
SEED0    = $A5A5

; ---- brick presence bytes (5 rows * 36 columns = 180 bytes) ----
BRICKS   = $1800

; ---- zero page ----
seedL       = $06
seedH       = $07
sptr        = $08        ; (2) screen pointer
strp        = $0A        ; (2) string pointer
bptr        = $0C        ; (2) brick row pointer
ballR       = $0E
ballC       = $0F
ballDR      = $10
ballDC      = $11
newR        = $12
newC        = $13
paddleC     = $14
padDir      = $15
score       = $16
lives       = $17
bricksLeft  = $18
gover       = $19        ; 0=playing, 1=game over, 2=win
tmp         = $1A

        .org $0800

; ---------------------------------------------------------------------------
; entry
; ---------------------------------------------------------------------------
start:
        sei
        cld
        ldx #$FF
        txs
        lda TXTSET
        lda LOWSCR
        lda KBDSTRB
        lda #<SEED0
        sta seedL
        lda #>SEED0
        sta seedH

play:
        jsr init_game
main_loop:
        ldx #PACE
ml_wait:
        jsr read_key
        jsr tiny_delay
        dex
        bne ml_wait
        jsr move_paddle
        jsr step_ball
        lda gover
        beq main_loop
        cmp #2
        bne ml_over
        jmp win_screen
ml_over:
        jmp game_over

; ---------------------------------------------------------------------------
; init_game : reset state and draw a fresh court.
; ---------------------------------------------------------------------------
init_game:
        lda #0
        sta score
        sta gover
        sta padDir
        lda #3
        sta lives
        lda #180
        sta bricksLeft
        lda #17
        sta paddleC
        jsr draw_board
        jsr draw_bricks
        jsr draw_paddle
        jsr serve_ball
        jsr draw_score
        jsr draw_lives
        rts

; ---------------------------------------------------------------------------
; read_key : non-blocking; latches one paddle move or quits on Q.
; ---------------------------------------------------------------------------
read_key:
        lda KBD
        bpl rk_none
        and #$7F
        sta KBDSTRB
        cmp #$08                ; left arrow
        beq rk_left
        cmp #$15                ; right arrow
        beq rk_right
        cmp #$41                ; A
        beq rk_left
        cmp #$44                ; D
        beq rk_right
        cmp #$51                ; Q
        beq rk_quit
rk_none:
        rts
rk_quit:
        jmp quit
rk_left:
        lda #$FF
        sta padDir
        rts
rk_right:
        lda #1
        sta padDir
        rts

; ---------------------------------------------------------------------------
; move_paddle : move one cell if a key was latched, clamped inside the walls.
; ---------------------------------------------------------------------------
move_paddle:
        lda padDir
        beq mp_done
        bmi mp_left
mp_right:
        lda paddleC
        cmp #33
        bcs mp_clear
        ldx #PADDROW
        ldy paddleC
        lda #BLANK
        jsr plot
        inc paddleC
        lda paddleC
        clc
        adc #5
        tay
        ldx #PADDROW
        lda #PADDLE
        jsr plot
        bra mp_clear
mp_left:
        lda paddleC
        cmp #1
        beq mp_clear
        lda paddleC
        clc
        adc #5
        tay
        ldx #PADDROW
        lda #BLANK
        jsr plot
        dec paddleC
        ldy paddleC
        ldx #PADDROW
        lda #PADDLE
        jsr plot
mp_clear:
        lda #0
        sta padDir
mp_done:
        rts

; ---------------------------------------------------------------------------
; serve_ball : place the ball above the paddle, travelling straight up.
; ---------------------------------------------------------------------------
serve_ball:
        lda #21
        sta ballR
        lda paddleC
        clc
        adc #3
        sta ballC
        lda #$FF
        sta ballDR
        lda #0
        sta ballDC
        ldx ballR
        ldy ballC
        lda #BALL
        jsr plot
        rts

; ---------------------------------------------------------------------------
; step_ball : advance the ball one tick and handle collisions.
; ---------------------------------------------------------------------------
step_ball:
        clc
        lda ballR
        adc ballDR
        sta newR
        clc
        lda ballC
        adc ballDC
        sta newC
        lda newR
        cmp #23
        bcs sb_lost
        ldx newR
        ldy newC
        jsr peekc
        cmp #BLANK
        beq sb_move
        cmp #PADDLE
        beq sb_paddle
        cmp #WALL
        beq sb_hash
        rts
sb_move:
        ldx ballR
        ldy ballC
        lda #BLANK
        jsr plot
        lda newR
        sta ballR
        lda newC
        sta ballC
        ldx ballR
        ldy ballC
        lda #BALL
        jsr plot
        rts
sb_paddle:
        lda #$FF
        sta ballDR
        lda #0
        sta ballDC
        rts
sb_hash:
        lda newR
        cmp #BRICKTOP
        bcc sb_wall
        cmp #BRICKEND
        bcs sb_wall
        lda newC
        cmp #BRICKL
        bcc sb_wall
        cmp #BRICKR1
        bcs sb_wall
        jmp hit_brick
sb_wall:
        lda newR
        cmp #TOPROW
        bne sb_side
        jsr flip_dr
sb_side:
        lda newC
        cmp #LCOL
        beq sb_flipc
        cmp #RCOL
        beq sb_flipc
        rts
sb_flipc:
        jsr flip_dc
        rts
sb_lost:
        ldx ballR
        ldy ballC
        lda #BLANK
        jsr plot
        dec lives
        jsr draw_lives
        lda lives
        beq sb_over
        jsr serve_ball
        rts
sb_over:
        lda #1
        sta gover
        rts

flip_dr:
        lda ballDR
        eor #$FE
        sta ballDR
        rts

flip_dc:
        lda ballDC
        beq fd_done
        eor #$FE
        sta ballDC
fd_done:
        rts

; ---------------------------------------------------------------------------
; hit_brick : remove the brick at newR/newC, bump score, and bounce vertically.
; ---------------------------------------------------------------------------
hit_brick:
        ldx newR
        ldy newC
        lda #BLANK
        jsr plot
        lda newR
        sec
        sbc #BRICKTOP
        tax
        lda BRKL,x
        sta bptr
        lda BRKH,x
        sta bptr+1
        lda newC
        sec
        sbc #BRICKL
        tay
        lda #0
        sta (bptr),y
        inc score
        jsr draw_score
        dec bricksLeft
        bne hb_bounce
        lda #2
        sta gover
hb_bounce:
        jsr flip_dr
        rts

; ---------------------------------------------------------------------------
; draw_board : clear the screen, status, top wall, and side walls.
; ---------------------------------------------------------------------------
draw_board:
        jsr clear_screen
        lda #<msg_status
        sta strp
        lda #>msg_status
        sta strp+1
        ldx #0
        ldy #0
        jsr puts
        ldx #TOPROW
        jsr hborder
        ldx #2
db_side:
        ldy #LCOL
        lda #WALL
        jsr plot
        ldy #RCOL
        lda #WALL
        jsr plot
        inx
        cpx #24
        bne db_side
        rts

; ---------------------------------------------------------------------------
; draw_bricks : initialize RAM brick map and draw rows 3..7, cols 2..37.
; ---------------------------------------------------------------------------
draw_bricks:
        lda #1
        ldx #0
dbr_mem:
        sta BRICKS,x
        inx
        cpx #180
        bne dbr_mem
        ldx #BRICKTOP
dbr_row:
        ldy #BRICKL
dbr_col:
        lda #BRICK
        jsr plot
        iny
        cpy #BRICKR1
        bne dbr_col
        inx
        cpx #BRICKEND
        bne dbr_row
        rts

draw_paddle:
        lda paddleC
        clc
        adc #PADW
        sta tmp
        ldx #PADDROW
        ldy paddleC
        lda #PADDLE
dp_l:
        jsr plot
        iny
        cpy tmp
        bne dp_l
        rts

clear_screen:
        lda #BLANK
        ldx #0
cs_l:
        sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne cs_l
        rts

hborder:
        lda ROWL,x
        sta sptr
        lda ROWH,x
        sta sptr+1
        ldy #0
        lda #WALL
hb_l:
        sta (sptr),y
        iny
        cpy #40
        bne hb_l
        rts

; ---------------------------------------------------------------------------
; draw_score / draw_lives.
; ---------------------------------------------------------------------------
draw_score:
        lda score
        ldx #0
ds_h:
        cmp #100
        bcc ds_hd
        sbc #100
        inx
        bra ds_h
ds_hd:
        pha
        txa
        ora #$B0
        sta SCOREH
        pla
        ldx #0
ds_t:
        cmp #10
        bcc ds_td
        sbc #10
        inx
        bra ds_t
ds_td:
        pha
        txa
        ora #$B0
        sta SCORET
        pla
        ora #$B0
        sta SCOREO
        rts

draw_lives:
        lda lives
        ora #$B0
        sta LIVESPOS
        rts

; ---------------------------------------------------------------------------
; game-over / win wait screens.
; ---------------------------------------------------------------------------
game_over:
        lda #<msg_over
        sta strp
        lda #>msg_over
        sta strp+1
        ldx #11
        ldy #10
        jsr puts
        jmp wait_restart

win_screen:
        lda #<msg_win
        sta strp
        lda #>msg_win
        sta strp+1
        ldx #11
        ldy #9
        jsr puts

wait_restart:
        lda #<msg_again
        sta strp
        lda #>msg_again
        sta strp+1
        ldx #13
        ldy #6
        jsr puts
wr_wait:
        lda KBD
        bpl wr_wait
        and #$7F
        sta KBDSTRB
        cmp #$20
        beq wr_restart
        cmp #$51
        beq quit
        bra wr_wait
wr_restart:
        jmp play

quit:
        lda KBDSTRB
        brk

; ---------------------------------------------------------------------------
; plot  : A=char, X=row, Y=col  -> write one cell.
; peekc : X=row, Y=col          -> A=char at that cell.
; ---------------------------------------------------------------------------
plot:
        pha
        lda ROWL,x
        sta sptr
        lda ROWH,x
        sta sptr+1
        pla
        sta (sptr),y
        rts

peekc:
        lda ROWL,x
        sta sptr
        lda ROWH,x
        sta sptr+1
        lda (sptr),y
        rts

; ---------------------------------------------------------------------------
; puts : print NUL-terminated ASCII at row X, col Y, OR'd with $80.
; ---------------------------------------------------------------------------
puts:
        lda ROWL,x
        sta sptr
        lda ROWH,x
        sta sptr+1
        tya
        clc
        adc sptr
        sta sptr
        ldy #0
pu_l:
        lda (strp),y
        beq pu_done
        ora #$80
        sta (sptr),y
        iny
        bne pu_l
pu_done:
        rts

; ---------------------------------------------------------------------------
; rng : 16-bit Galois LFSR (kept for the standard game skeleton).
; ---------------------------------------------------------------------------
rng:
        lsr seedH
        ror seedL
        bcc rng_d
        lda seedH
        eor #$B4
        sta seedH
rng_d:
        rts

; ---------------------------------------------------------------------------
; tiny_delay : burn a small, deterministic delay.
; ---------------------------------------------------------------------------
tiny_delay:
        ldy #DLY
td_l:
        dey
        bne td_l
        rts

; ---------------------------------------------------------------------------
; BRK test hook: run one physics step and return to the harness.
; ---------------------------------------------------------------------------
hook:
        ldx #$FF
        txs
        jsr step_ball
        brk

; ---------------------------------------------------------------------------
; data
; ---------------------------------------------------------------------------
ROWL:   .byte $00,$80,$00,$80,$00,$80,$00,$80,$28,$A8,$28,$A8
        .byte $28,$A8,$28,$A8,$50,$D0,$50,$D0,$50,$D0,$50,$D0
ROWH:   .byte $04,$04,$05,$05,$06,$06,$07,$07,$04,$04,$05,$05
        .byte $06,$06,$07,$07,$04,$04,$05,$05,$06,$06,$07,$07

BRKL:   .byte <BRICKS,<(BRICKS+36),<(BRICKS+72),<(BRICKS+108),<(BRICKS+144)
BRKH:   .byte >BRICKS,>(BRICKS+36),>(BRICKS+72),>(BRICKS+108),>(BRICKS+144)

msg_status: .byte "BRICK BUSTER SCORE:000 LIVES:3 A/D Q", 0
msg_over:   .byte "**** GAME OVER ****", 0
msg_win:    .byte "*** YOU CLEARED IT ***", 0
msg_again:  .byte "SPACE = PLAY AGAIN   Q = QUIT", 0
