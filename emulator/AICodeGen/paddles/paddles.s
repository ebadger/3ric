; ============================================================================
; PADDLES for the 3ric  (65C02, Apple-II compatible)  -- text mode, 40x24.
;
;   * Two-paddle tennis: YOU at left, CPU at right, top/bottom walls, centre net.
;   * Controls: W/S or up/down arrows move the left paddle; Q quits.
;   * First player to 7 points wins. SPACE plays again, Q returns to monitor.
;
; Build / run:
;   node codegen/tools/asm6502.mjs emulator/AICodeGen/paddles/paddles.s \
;        emulator/AICodeGen/paddles/paddles.prg --org 0x0800
;   BRUN PADDLES.PRG 0800
; ============================================================================

; ---- soft switches / hardware ----
KBD      = $C000
KBDSTRB  = $C010
TXTSET   = $C051
LOWSCR   = $C054

; ---- glyphs (normal video = ascii | $80) ----
BLANK    = $A0          ; ' '
WALL     = $A3          ; '#'
BALL     = $CF          ; 'O'
PADDLE   = $FC          ; '|'
NET      = $BA          ; ':'

; ---- geometry ----
TOPROW   = 1
BOTROW   = 23
MINPAD   = 2
MAXPAD   = 19
HCOL     = 2
CCOL     = 37
NETCOL   = 20
RCOL     = 39

; ---- score digit positions on row 0 ----
YOUSCR   = $040C
CPUSCR   = $0412

; ---- pacing ----
PACE     = 80
DLY      = 70
SEED0    = $A5A5

; ---- zero page ----
seedL    = $06
seedH    = $07
sptr     = $08          ; (2) screen pointer
strp     = $0A          ; (2) string pointer
hpadR    = $0C
cpadR    = $0D
ballR    = $0E
ballC    = $0F
ballDR   = $10
ballDC   = $11
newR     = $12
newC     = $13
youScore = $14
cpuScore = $15
gover    = $16
winner   = $17

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
        jsr read_key
        jsr tiny_delay
        dex
        bne gl_wait
        jsr step_game
        lda gover
        beq game_loop
        jmp game_over

; ---------------------------------------------------------------------------
; init_game : draw court, reset scores and positions.
; ---------------------------------------------------------------------------
init_game:
        jsr draw_court
        stz youScore
        stz cpuScore
        stz gover
        stz winner
        lda #MINPAD
        sta hpadR
        lda #10
        sta cpadR
        jsr draw_human
        jsr draw_cpu
        jsr serve_center
        jsr draw_score
        rts

; ---------------------------------------------------------------------------
; serve_center : put the ball in the centre, always heading left to start.
; ---------------------------------------------------------------------------
serve_center:
        lda #12
        sta ballR
        lda #NETCOL
        sta ballC
        lda #1
        sta ballDR
        lda #$FF
        sta ballDC
        ldx ballR
        ldy ballC
        lda #BALL
        jsr plot
        rts

; ---------------------------------------------------------------------------
; step_game : one AI + ball tick.
; ---------------------------------------------------------------------------
step_game:
        ldx ballR
        ldy ballC
        jsr restore_cell
        jsr move_cpu
        clc
        lda ballR
        adc ballDR
        sta newR
        cmp #TOPROW
        beq sg_bounce_top
        cmp #BOTROW
        beq sg_bounce_bot
sg_row_ok:
        clc
        lda ballC
        adc ballDC
        sta newC
        lda newC
        cmp #HCOL
        beq sg_try_human
        cmp #CCOL
        beq sg_try_cpu
        cmp #0
        beq sg_cpu_point
        cmp #RCOL
        beq sg_you_point
        jmp sg_place
sg_bounce_top:
        lda #1
        sta ballDR
        lda ballR
        clc
        adc ballDR
        sta newR
        bra sg_row_ok
sg_bounce_bot:
        lda #$FF
        sta ballDR
        lda ballR
        clc
        adc ballDR
        sta newR
        bra sg_row_ok
sg_try_human:
        lda ballDC
        cmp #$FF
        bne sg_place
        jsr hit_human
        beq sg_human_miss
        lda #1
        sta ballDC
        lda #HCOL+1
        sta newC
        bra sg_place
sg_human_miss:
        bra sg_place
sg_try_cpu:
        lda ballDC
        cmp #1
        bne sg_place
        jsr hit_cpu
        beq sg_cpu_miss
        lda #$FF
        sta ballDC
        lda #CCOL-1
        sta newC
        bra sg_place
sg_cpu_miss:
        bra sg_place
sg_place:
        lda newR
        sta ballR
        lda newC
        sta ballC
        ldx ballR
        ldy ballC
        lda #BALL
        jsr plot
        rts
sg_cpu_point:
        inc cpuScore
        jsr draw_score
        lda cpuScore
        cmp #7
        bcc sg_serve
        lda #1
        sta winner
        sta gover
        rts
sg_you_point:
        inc youScore
        jsr draw_score
        lda youScore
        cmp #7
        bcc sg_serve
        lda #2
        sta winner
        lda #1
        sta gover
        rts
sg_serve:
        jsr serve_center
        rts

; ---------------------------------------------------------------------------
; hit tests return Z clear on hit, Z set on miss.
; ---------------------------------------------------------------------------
hit_human:
        lda newR
        cmp hpadR
        bcc hh_miss
        lda hpadR
        clc
        adc #4
        cmp newR
        bcc hh_miss
        bne hh_hit
        bra hh_miss
hh_hit:
        lda #1
        rts
hh_miss:
        lda #0
        rts

hit_cpu:
        lda newR
        cmp cpadR
        bcc hc_miss
        lda cpadR
        clc
        adc #4
        cmp newR
        bcc hc_miss
        bne hc_hit
        bra hc_miss
hc_hit:
        lda #1
        rts
hc_miss:
        lda #0
        rts

; ---------------------------------------------------------------------------
; read_key : W/up moves up, S/down moves down, Q quits.
; ---------------------------------------------------------------------------
read_key:
        lda KBD
        bpl rk_none
        and #$7F
        sta KBDSTRB
        cmp #$0B                ; up arrow
        beq rk_up
        cmp #$0A                ; down arrow
        beq rk_down
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
rk_up:
        lda hpadR
        cmp #MINPAD
        beq rk_none
        jsr erase_human
        dec hpadR
        jsr draw_human
        rts
rk_down:
        lda hpadR
        cmp #MAXPAD
        beq rk_none
        jsr erase_human
        inc hpadR
        jsr draw_human
        rts

; ---------------------------------------------------------------------------
; CPU AI: move one row toward containing the ball.
; ---------------------------------------------------------------------------
move_cpu:
        lda ballR
        cmp cpadR
        bcc mc_up
        lda cpadR
        clc
        adc #4
        cmp ballR
        bcc mc_down
        bne mc_done
        bra mc_down
mc_up:
        lda cpadR
        cmp #MINPAD
        beq mc_done
        jsr erase_cpu
        dec cpadR
        jsr draw_cpu
        rts
mc_down:
        lda cpadR
        cmp #MAXPAD
        beq mc_done
        jsr erase_cpu
        inc cpadR
        jsr draw_cpu
mc_done:
        rts

; ---------------------------------------------------------------------------
; paddle draw / erase helpers.
; ---------------------------------------------------------------------------
draw_human:
        ldx hpadR
        ldy #HCOL
        lda #PADDLE
        jsr plot
        inx
        lda #PADDLE
        jsr plot
        inx
        lda #PADDLE
        jsr plot
        inx
        lda #PADDLE
        jsr plot
        rts

erase_human:
        ldx hpadR
        ldy #HCOL
        jsr restore_cell
        inx
        jsr restore_cell
        inx
        jsr restore_cell
        inx
        jsr restore_cell
        rts

draw_cpu:
        ldx cpadR
        ldy #CCOL
        lda #PADDLE
        jsr plot
        inx
        lda #PADDLE
        jsr plot
        inx
        lda #PADDLE
        jsr plot
        inx
        lda #PADDLE
        jsr plot
        rts

erase_cpu:
        ldx cpadR
        ldy #CCOL
        jsr restore_cell
        inx
        jsr restore_cell
        inx
        jsr restore_cell
        inx
        jsr restore_cell
        rts

; ---------------------------------------------------------------------------
; game_over : overlay the banner and wait for SPACE (restart) or Q (quit).
; ---------------------------------------------------------------------------
game_over:
        lda winner
        cmp #2
        beq go_you
        lda #<msg_cpuwins
        sta strp
        lda #>msg_cpuwins
        sta strp+1
        bra go_show
go_you:
        lda #<msg_youwin
        sta strp
        lda #>msg_youwin
        sta strp+1
go_show:
        ldx #10
        ldy #13
        jsr puts
        lda #<msg_again
        sta strp
        lda #>msg_again
        sta strp+1
        ldx #12
        ldy #6
        jsr puts
go_wait:
        lda KBD
        bpl go_wait
        and #$7F
        sta KBDSTRB
        cmp #$20
        beq go_restart
        cmp #$51
        beq quit
        bra go_wait
go_restart:
        jmp play

quit:
        lda KBDSTRB
        brk

; ---------------------------------------------------------------------------
; draw_court : clear screen, draw status, walls and dashed centre net.
; ---------------------------------------------------------------------------
draw_court:
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
dc_net:
        txa
        and #1
        bne dc_next
        ldy #NETCOL
        lda #NET
        jsr plot
dc_next:
        inx
        cpx #BOTROW
        bne dc_net
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
; draw_score : render both scores as one decimal digit.
; ---------------------------------------------------------------------------
draw_score:
        lda youScore
        ora #$B0
        sta YOUSCR
        lda cpuScore
        ora #$B0
        sta CPUSCR
        rts

; ---------------------------------------------------------------------------
; restore_cell : X=row, Y=col -> restore wall/net/blank background.
; ---------------------------------------------------------------------------
restore_cell:
        cpx #TOPROW
        beq rc_wall
        cpx #BOTROW
        beq rc_wall
        cpy #NETCOL
        bne rc_blank
        txa
        and #1
        bne rc_blank
        lda #NET
        jsr plot
        rts
rc_wall:
        lda #WALL
        jsr plot
        rts
rc_blank:
        lda #BLANK
        jsr plot
        rts

; ---------------------------------------------------------------------------
; plot  : A=char, X=row, Y=col  -> write one cell.
; peekc : X=row, Y=col          -> A=char at that cell.
; puts  : NUL-terminated ASCII string at row X, col Y; ORs $80.
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
; rng : 16-bit Galois LFSR (available for future variation).
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
; tiny_delay : burn ~DLY iterations.
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

msg_status:  .byte "PADDLES YOU:0 CPU:0 W/S/ARROWS Q=QUIT", 0
msg_cpuwins: .byte "CPU WINS", 0
msg_youwin:  .byte "YOU WIN", 0
msg_again:   .byte "SPACE = PLAY AGAIN     Q = QUIT", 0
