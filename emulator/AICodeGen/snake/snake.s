; ============================================================================
; SNAKE for the 3ric  (65C02, Apple-II compatible)  -- text mode, 40x24.
;
;   * Steer a growing snake around a bordered arena; eat the food ('*') to
;     grow and score; running into a wall or yourself ends the game.
;   * Controls: arrow keys or W/A/S/D to steer, Q to quit.
;   * On game over: SPACE plays again, Q returns to the monitor.
;
; Runs entirely on the 40x24 text page ($0400-$07FF).  A 24-entry row-base
; table maps (row,col) to the interleaved screen layout; the screen itself
; doubles as the collision map (a non-blank, non-food cell is a crash).
;
; Build / run:
;   node codegen/tools/asm6502.mjs emulator/AICodeGen/snake/snake.s \
;        emulator/AICodeGen/snake/snake.prg --org 0x0800
;   BRUN SNAKE.PRG 0800
; ============================================================================

; ---- soft switches / hardware ----
KBD      = $C000        ; keyboard data (bit7 = key ready)
KBDSTRB  = $C010        ; clear keyboard strobe (any access)
TXTSET   = $C051        ; text mode on
LOWSCR   = $C054        ; display page 1

; ---- glyphs (normal video = ascii | $80) ----
BLANK    = $A0          ; ' '
WALL     = $A3          ; '#'
BODY     = $CF          ; 'O'  snake segment
FOOD     = $AA          ; '*'

; ---- geometry ----
TOPROW   = 1            ; top border row
BOTROW   = 23           ; bottom border row
LCOL     = 0            ; left border col
RCOL     = 39           ; right border col

; ---- score digit positions on row 0 ($0400 + col) ----
SCOREH   = $040D
SCORET   = $040E
SCOREO   = $040F

; ---- pacing (tuned for ~1 MHz; use the page Speed selector to taste) ----
PACE     = 180          ; input polls per snake step
DLY      = 110          ; inner delay iterations per poll

SEED0    = $A5A5        ; initial LFSR state (non-zero)

; ---- snake body ring buffers (256 entries; free RAM) ----
SNK_R    = $1800        ; row of body cell i
SNK_C    = $1900        ; col of body cell i

; ---- zero page ----
seedL    = $06
seedH    = $07
sptr     = $08          ; (2) screen pointer
strp     = $0A          ; (2) string pointer
ddR      = $0C          ; current direction: row delta (-1/0/1 as $FF/$00/$01)
ddC      = $0D          ; current direction: col delta
penR     = $0E          ; pending direction row delta
penC     = $0F          ; pending direction col delta
headR    = $10
headC    = $11
newR     = $12
newC     = $13
foodR    = $14
foodC    = $15
hidx     = $16          ; ring head index
tidx     = $17          ; ring tail index
slen     = $18          ; live length
score    = $19
ate      = $1A          ; "ate food this step" flag
gover    = $1B          ; game-over flag

        .org $0800

; ---------------------------------------------------------------------------
; entry
; ---------------------------------------------------------------------------
start:
        sei
        cld
        ldx #$FF
        txs
        lda TXTSET              ; force text mode, page 1
        lda LOWSCR
        lda KBDSTRB             ; clear any pending key
        lda #<SEED0
        sta seedL
        lda #>SEED0
        sta seedH

play:
        jsr init_game
game_loop:
        ldx #PACE
gl_wait:
        jsr read_key            ; non-blocking; updates pending dir
        jsr tiny_delay
        dex
        bne gl_wait
        jsr apply_dir           ; commit pending dir (reject reversals)
        jsr step
        lda gover
        beq game_loop
        jmp game_over

; ---------------------------------------------------------------------------
; init_game : draw the board and reset the snake to the centre.
; ---------------------------------------------------------------------------
init_game:
        jsr draw_board
        lda #0
        sta tidx
        sta score
        sta ate
        sta gover
        sta ddR
        sta penR
        lda #1
        sta ddC                 ; start heading right
        sta penC
        lda #4
        sta slen
        ; lay 4 body cells at row 12, cols 10..13
        ldx #0
ig_l:
        lda #12
        sta SNK_R,x
        txa
        clc
        adc #10
        sta SNK_C,x             ; col = 10 + idx  (A = col)
        phx
        tay                     ; Y = col
        ldx #12                 ; X = row
        lda #BODY
        jsr plot
        plx
        inx
        cpx #4
        bne ig_l
        lda #3
        sta hidx
        lda #12
        sta headR
        lda #13
        sta headC
        jsr spawn_food
        jsr draw_score
        rts

; ---------------------------------------------------------------------------
; step : advance the snake one cell in the current direction.
; ---------------------------------------------------------------------------
step:
        clc
        lda headR
        adc ddR
        sta newR
        clc
        lda headC
        adc ddC
        sta newC
        ldx newR
        ldy newC
        jsr peekc               ; A = destination cell
        cmp #FOOD
        beq st_eat
        cmp #BLANK
        beq st_move
        lda #1                  ; wall or body -> crash
        sta gover
        rts
st_move:
        ; erase tail cell, advance tail
        ldx tidx
        lda SNK_C,x
        tay
        lda SNK_R,x
        tax
        lda #BLANK
        jsr plot
        inc tidx
        bra st_head
st_eat:
        inc score
        inc slen
        lda #1
        sta ate
        ; (tail not advanced -> snake grows)
st_head:
        inc hidx
        ldx hidx
        lda newR
        sta SNK_R,x
        lda newC
        sta SNK_C,x
        lda newR
        sta headR
        lda newC
        sta headC
        ldx newR
        ldy newC
        lda #BODY
        jsr plot
        lda ate
        beq st_done
        lda #0
        sta ate
        jsr draw_score
        jsr spawn_food
st_done:
        rts

; ---------------------------------------------------------------------------
; read_key : poll the keyboard (non-blocking). Sets pending direction on an
; arrow / WASD; jumps to quit on Q; ignores anything else.
; ---------------------------------------------------------------------------
read_key:
        lda KBD
        bpl rk_none
        and #$7F
        sta KBDSTRB             ; clear strobe (access $C010)
        cmp #$08                ; left arrow
        beq rk_left
        cmp #$15                ; right arrow
        beq rk_right
        cmp #$0B                ; up arrow
        beq rk_up
        cmp #$0A                ; down arrow
        beq rk_down
        cmp #$41                ; 'A'
        beq rk_left
        cmp #$44                ; 'D'
        beq rk_right
        cmp #$57                ; 'W'
        beq rk_up
        cmp #$53                ; 'S'
        beq rk_down
        cmp #$51                ; 'Q'
        beq rk_quit
rk_none:
        rts
rk_quit:
        jmp quit
rk_left:
        lda #0
        sta penR
        lda #$FF
        sta penC
        rts
rk_right:
        lda #0
        sta penR
        lda #1
        sta penC
        rts
rk_up:
        lda #$FF
        sta penR
        lda #0
        sta penC
        rts
rk_down:
        lda #1
        sta penR
        lda #0
        sta penC
        rts

; ---------------------------------------------------------------------------
; apply_dir : accept the pending direction unless it reverses the current one
; (a 180-degree turn would run the head straight into the neck).
; ---------------------------------------------------------------------------
apply_dir:
        lda penR
        clc
        adc ddR
        bne ad_ok               ; row axis differs -> not a pure reversal
        lda penC
        clc
        adc ddC
        beq ad_no               ; both axes cancel -> reversal, ignore
ad_ok:
        lda penR
        sta ddR
        lda penC
        sta ddC
ad_no:
        rts

; ---------------------------------------------------------------------------
; spawn_food : drop food on a random empty interior cell.
; ---------------------------------------------------------------------------
spawn_food:
sf_row:
        jsr rng
        lda seedL
        and #$1F                ; 0..31
        cmp #21
        bcs sf_row              ; reject -> rows 0..20
        clc
        adc #2                  ; row 2..22
        sta foodR
sf_col:
        jsr rng
        lda seedL
        and #$3F                ; 0..63
        cmp #38
        bcs sf_col              ; reject -> cols 0..37
        clc
        adc #1                  ; col 1..38
        sta foodC
        ldx foodR
        ldy foodC
        jsr peekc
        cmp #BLANK
        bne sf_row              ; occupied -> pick again
        ldx foodR
        ldy foodC
        lda #FOOD
        jsr plot
        rts

; ---------------------------------------------------------------------------
; game_over : overlay the banner and wait for SPACE (restart) or Q (quit).
; ---------------------------------------------------------------------------
game_over:
        lda #<msg_over
        sta strp
        lda #>msg_over
        sta strp+1
        ldx #11
        ldy #11
        jsr puts
        lda #<msg_again
        sta strp
        lda #>msg_again
        sta strp+1
        ldx #13
        ldy #6
        jsr puts
go_wait:
        lda KBD
        bpl go_wait
        and #$7F
        sta KBDSTRB
        cmp #$20                ; SPACE -> play again
        beq go_restart
        cmp #$51                ; Q -> quit
        beq quit
        bra go_wait
go_restart:
        jmp play

quit:
        lda KBDSTRB
        brk                     ; back to the monitor

; ---------------------------------------------------------------------------
; draw_board : clear the screen, draw the status line and the border box.
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
        ldx #BOTROW
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
        cpx #BOTROW
        bne db_side
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
; draw_score : render `score` (0..255) as three decimal digits on row 0.
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
; puts : print a NUL-terminated ASCII string (strp) at row X, col Y. Each
; byte is OR'd with $80 for normal video.
; ---------------------------------------------------------------------------
puts:
        lda ROWL,x
        sta sptr
        lda ROWH,x
        sta sptr+1
        tya
        clc
        adc sptr
        sta sptr                ; sptr = rowbase + col (no page cross in a row)
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
; rng : 16-bit Galois LFSR (advances state; caller uses bit0 of seedL).
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
; tiny_delay : burn ~DLY iterations so the snake moves at a human pace.
; ---------------------------------------------------------------------------
tiny_delay:
        ldy #DLY
td_l:
        dey
        bne td_l
        rts

; ---------------------------------------------------------------------------
; data
; ---------------------------------------------------------------------------
ROWL:   .byte $00,$80,$00,$80,$00,$80,$00,$80,$28,$A8,$28,$A8
        .byte $28,$A8,$28,$A8,$50,$D0,$50,$D0,$50,$D0,$50,$D0
ROWH:   .byte $04,$04,$05,$05,$06,$06,$07,$07,$04,$04,$05,$05
        .byte $06,$06,$07,$07,$04,$04,$05,$05,$06,$06,$07,$07

msg_status:  .byte "SNAKE  SCORE:000  WASD/ARROWS Q=QUIT", 0
msg_over:    .byte "**** GAME OVER ****", 0
msg_again:   .byte "SPACE = PLAY AGAIN     Q = QUIT", 0
