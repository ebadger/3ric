; ============================================================================
; 2048 for the 3ric  (65C02, Apple-II compatible) -- text mode, 40x24.
;
;   * Standard 4x4 2048 board.  Each board byte is an exponent:
;       0 = empty, 1 = 2, 2 = 4, ... 11 = 2048.
;   * Controls: arrows or W/A/S/D move, Q quits.
;   * SPACE restarts after game over; reaching 2048 allows continue/restart.
;   * Deterministic test hook `do_move` performs one slide+merge, updates score,
;     does not spawn, then BRKs.
;
; Build / run:
;   node codegen/tools/asm6502.mjs emulator/AICodeGen/2048/2048.s \
;        emulator/AICodeGen/2048/2048.prg --org 0x0800
;   BRUN 2048.PRG 0800
; ============================================================================

; ---- soft switches / hardware ----
KBD      = $C000
KBDSTRB  = $C010
TXTSET   = $C051
LOWSCR   = $C054

; ---- glyphs (normal video = ascii | $80) ----
BLANK    = $A0

; ---- fixed RAM API for tests ----
board    = $1A00        ; 16 exponents, row-major
dir      = $1A10        ; 0=left, 1=right, 2=up, 3=down
score    = $1A11        ; 16-bit little-endian score
moved    = $1A13        ; non-zero if the last move changed board
wonflag  = $1A14

; ---- screen layout ----
GRIDCOL  = 9
SCORE0   = $040C        ; first score digit in "2048  SCORE:00000..."

SEED0    = $A5A5

; ---- zero page ----
seedL    = $06
seedH    = $07
sptr     = $08          ; (2) screen pointer
strp     = $0A          ; (2) string pointer
idx      = $0C
c0       = $10
c1       = $11
c2       = $12
c3       = $13
temp0    = $14          ; temp0..temp3
out0     = $18          ; out0..out3
curv     = $1C
remL     = $1D
remH     = $1E
subL     = $1F
subH     = $20

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
        jsr wait_key
        jsr move_only
        lda moved
        beq main_loop
        jsr spawn_tile
        jsr render
        jsr check_win
        jsr check_lose
        jmp main_loop

; ---------------------------------------------------------------------------
; deterministic BRK hook: perform one move in `dir`, update score, no spawn.
; ---------------------------------------------------------------------------
do_move:
        ldx #$FF
        txs
        jsr move_only
        brk

; ---------------------------------------------------------------------------
; init_game
; ---------------------------------------------------------------------------
init_game:
        jsr clear_board
        stz score
        stz score+1
        stz wonflag
        lda #0
        sta dir
        jsr spawn_tile
        jsr spawn_tile
        jsr render
        rts

clear_board:
        lda #0
        ldx #15
cb_l:
        sta board,x
        dex
        bpl cb_l
        rts

; ---------------------------------------------------------------------------
; wait_key : block until a movement key or Q is pressed.
; ---------------------------------------------------------------------------
wait_key:
        lda KBD
        bpl wait_key
        and #$7F
        sta KBDSTRB
        cmp #$08                ; left arrow
        beq wk_left
        cmp #$41                ; A
        beq wk_left
        cmp #$15                ; right arrow
        beq wk_right
        cmp #$44                ; D
        beq wk_right
        cmp #$0B                ; up arrow
        beq wk_up
        cmp #$57                ; W
        beq wk_up
        cmp #$0A                ; down arrow
        beq wk_down
        cmp #$53                ; S
        beq wk_down
        cmp #$51                ; Q
        bne wait_key
        jmp quit
wk_left:
        lda #0
        sta dir
        rts
wk_right:
        lda #1
        sta dir
        rts
wk_up:
        lda #2
        sta dir
        rts
wk_down:
        lda #3
        sta dir
        rts

quit:
        lda KBDSTRB
        brk

; ---------------------------------------------------------------------------
; move_only : dispatch one slide+merge in `dir`.
; ---------------------------------------------------------------------------
move_only:
        stz moved
        lda dir
        beq mo_left
        cmp #1
        beq mo_right
        cmp #2
        beq mo_up
        jmp move_down
mo_left:
        jmp move_left
mo_right:
        jmp move_right
mo_up:
        jmp move_up

; c0..c3 are in wall-facing order.  Result overwrites c0..c3.
process_line:
        stz temp0
        stz temp0+1
        stz temp0+2
        stz temp0+3
        stz out0
        stz out0+1
        stz out0+2
        stz out0+3
        ldx #0
        lda c0
        beq pl_c1
        sta temp0,x
        inx
pl_c1:
        lda c1
        beq pl_c2
        sta temp0,x
        inx
pl_c2:
        lda c2
        beq pl_c3
        sta temp0,x
        inx
pl_c3:
        lda c3
        beq pl_merge
        sta temp0,x
pl_merge:
        ldx #0                  ; input index
        ldy #0                  ; output index
pl_loop:
        cpx #4
        beq pl_done
        lda temp0,x
        beq pl_done
        sta curv
        cpx #3
        beq pl_store
        lda temp0+1,x
        cmp curv
        bne pl_store
        inc curv
        lda curv
        phx
        phy
        jsr add_score_exp
        ply
        plx
        inx                     ; consume the merged neighbour too
pl_store:
        lda curv
        sta out0,y
        iny
        inx
        bra pl_loop
pl_done:
        lda out0
        sta c0
        lda out0+1
        sta c1
        lda out0+2
        sta c2
        lda out0+3
        sta c3
        rts

add_score_exp:
        tax
        lda score
        clc
        adc score_val_l,x
        sta score
        lda score+1
        adc score_val_h,x
        sta score+1
        rts

; ---------------------------------------------------------------------------
; four directions
; ---------------------------------------------------------------------------
move_left:
        ldx #0
ml_row:
        stx idx
        lda board,x
        sta c0
        lda board+1,x
        sta c1
        lda board+2,x
        sta c2
        lda board+3,x
        sta c3
        jsr process_line
        ldx idx
        lda c0
        cmp board,x
        beq ml_s1
        sta board,x
        lda #1
        sta moved
ml_s1:
        lda c1
        cmp board+1,x
        beq ml_s2
        sta board+1,x
        lda #1
        sta moved
ml_s2:
        lda c2
        cmp board+2,x
        beq ml_s3
        sta board+2,x
        lda #1
        sta moved
ml_s3:
        lda c3
        cmp board+3,x
        beq ml_next
        sta board+3,x
        lda #1
        sta moved
ml_next:
        txa
        clc
        adc #4
        tax
        cpx #16
        bne ml_row
        rts

move_right:
        ldx #0
mr_row:
        stx idx
        lda board+3,x
        sta c0
        lda board+2,x
        sta c1
        lda board+1,x
        sta c2
        lda board,x
        sta c3
        jsr process_line
        ldx idx
        lda c0
        cmp board+3,x
        beq mr_s1
        sta board+3,x
        lda #1
        sta moved
mr_s1:
        lda c1
        cmp board+2,x
        beq mr_s2
        sta board+2,x
        lda #1
        sta moved
mr_s2:
        lda c2
        cmp board+1,x
        beq mr_s3
        sta board+1,x
        lda #1
        sta moved
mr_s3:
        lda c3
        cmp board,x
        beq mr_next
        sta board,x
        lda #1
        sta moved
mr_next:
        txa
        clc
        adc #4
        tax
        cpx #16
        bne mr_row
        rts

move_up:
        ldx #0
mu_col:
        stx idx
        lda board,x
        sta c0
        lda board+4,x
        sta c1
        lda board+8,x
        sta c2
        lda board+12,x
        sta c3
        jsr process_line
        ldx idx
        lda c0
        cmp board,x
        beq mu_s1
        sta board,x
        lda #1
        sta moved
mu_s1:
        lda c1
        cmp board+4,x
        beq mu_s2
        sta board+4,x
        lda #1
        sta moved
mu_s2:
        lda c2
        cmp board+8,x
        beq mu_s3
        sta board+8,x
        lda #1
        sta moved
mu_s3:
        lda c3
        cmp board+12,x
        beq mu_next
        sta board+12,x
        lda #1
        sta moved
mu_next:
        inx
        cpx #4
        bne mu_col
        rts

move_down:
        ldx #0
md_col:
        stx idx
        lda board+12,x
        sta c0
        lda board+8,x
        sta c1
        lda board+4,x
        sta c2
        lda board,x
        sta c3
        jsr process_line
        ldx idx
        lda c0
        cmp board+12,x
        beq md_s1
        sta board+12,x
        lda #1
        sta moved
md_s1:
        lda c1
        cmp board+8,x
        beq md_s2
        sta board+8,x
        lda #1
        sta moved
md_s2:
        lda c2
        cmp board+4,x
        beq md_s3
        sta board+4,x
        lda #1
        sta moved
md_s3:
        lda c3
        cmp board,x
        beq md_next
        sta board,x
        lda #1
        sta moved
md_next:
        inx
        cpx #4
        bne md_col
        rts

; ---------------------------------------------------------------------------
; spawn_tile : choose a random empty board slot, 2 with ~90%, 4 with ~10%.
; ---------------------------------------------------------------------------
spawn_tile:
        jsr has_empty
        bne st_pick
        rts
st_pick:
        jsr rng
        lda seedL
        and #$0F
        tax
        lda board,x
        bne st_pick
        jsr rng
        lda seedL
        and #$1F
        cmp #3
        bcc st_four
        lda #1
        bra st_store
st_four:
        lda #2
st_store:
        sta board,x
        rts

has_empty:
        ldx #0
he_l:
        lda board,x
        bne he_next
        lda #1
        rts
he_next:
        inx
        cpx #16
        bne he_l
        lda #0
        rts

; ---------------------------------------------------------------------------
; win / lose
; ---------------------------------------------------------------------------
check_win:
        lda wonflag
        beq cw_scan
        rts
cw_scan:
        ldx #0
cw_l:
        lda board,x
        cmp #11
        bcc cw_next
        jmp cw_found
cw_next:
        inx
        cpx #16
        bne cw_l
        rts
cw_found:
        lda #1
        sta wonflag
        lda #<msg_win
        sta strp
        lda #>msg_win
        sta strp+1
        ldx #13
        ldy #3
        jsr puts
cw_wait:
        lda KBD
        bpl cw_wait
        and #$7F
        sta KBDSTRB
        cmp #$51
        bne cw_notq
        jmp quit
cw_notq:
        cmp #$20
        bne cw_notsp
        jmp play
cw_notsp:
        cmp #$43                ; C
        beq cw_cont
        cmp #$0D                ; RETURN
        bne cw_wait
cw_cont:
        jsr render
        rts

check_lose:
        ldx #0
cl_empty:
        lda board,x
        bne cl_e_next
        rts
cl_e_next:
        inx
        cpx #16
        bne cl_empty
        ldx #0
cl_hr:
        lda board,x
        cmp board+1,x
        bne cl_h2
        rts
cl_h2:
        lda board+1,x
        cmp board+2,x
        bne cl_h3
        rts
cl_h3:
        lda board+2,x
        cmp board+3,x
        bne cl_hn
        rts
cl_hn:
        txa
        clc
        adc #4
        tax
        cpx #16
        bne cl_hr
        ldx #0
cl_v:
        lda board,x
        cmp board+4,x
        bne cl_v2
        rts
cl_v2:
        lda board+4,x
        cmp board+8,x
        bne cl_v3
        rts
cl_v3:
        lda board+8,x
        cmp board+12,x
        bne cl_vn
        rts
cl_vn:
        inx
        cpx #4
        bne cl_v
        jmp game_over

game_over:
        lda #<msg_over
        sta strp
        lda #>msg_over
        sta strp+1
        ldx #13
        ldy #11
        jsr puts
        lda #<msg_again
        sta strp
        lda #>msg_again
        sta strp+1
        ldx #15
        ldy #6
        jsr puts
go_wait:
        lda KBD
        bpl go_wait
        and #$7F
        sta KBDSTRB
        cmp #$51
        bne go_notq
        jmp quit
go_notq:
        cmp #$20
        bne go_wait
        jmp play

; ---------------------------------------------------------------------------
; render
; ---------------------------------------------------------------------------
render:
        jsr clear_screen
        lda #<msg_status
        sta strp
        lda #>msg_status
        sta strp+1
        ldx #0
        ldy #0
        jsr puts
        jsr draw_score
        jsr draw_frame
        jsr draw_tiles
        rts

draw_frame:
        ldx #3
        jsr put_border
        ldx #4
        jsr put_emptyrow
        ldx #5
        jsr put_border
        ldx #6
        jsr put_emptyrow
        ldx #7
        jsr put_border
        ldx #8
        jsr put_emptyrow
        ldx #9
        jsr put_border
        ldx #10
        jsr put_emptyrow
        ldx #11
        jsr put_border
        rts

put_border:
        lda #<msg_border
        sta strp
        lda #>msg_border
        sta strp+1
        ldy #GRIDCOL
        jsr puts
        rts

put_emptyrow:
        lda #<msg_emptyrow
        sta strp
        lda #>msg_emptyrow
        sta strp+1
        ldy #GRIDCOL
        jsr puts
        rts

draw_tiles:
        ldx #0
dt_l:
        stx idx
        lda board,x
        cmp #12
        bcc dt_exp
        lda #11
dt_exp:
        tay
        lda tile_l,y
        sta strp
        lda tile_h,y
        sta strp+1
        ldx idx
        ldy cell_col,x
        lda cell_row,x
        tax
        jsr put4
        ldx idx
        inx
        cpx #16
        bne dt_l
        rts

draw_score:
        lda score
        sta remL
        lda score+1
        sta remH
        lda #<$2710             ; 10000
        sta subL
        lda #>$2710
        sta subH
        jsr digit_sub
        sta SCORE0
        lda #<$03E8             ; 1000
        sta subL
        lda #>$03E8
        sta subH
        jsr digit_sub
        sta SCORE0+1
        lda #<$0064             ; 100
        sta subL
        lda #>$0064
        sta subH
        jsr digit_sub
        sta SCORE0+2
        lda #<$000A             ; 10
        sta subL
        lda #>$000A
        sta subH
        jsr digit_sub
        sta SCORE0+3
        lda remL
        ora #$B0
        sta SCORE0+4
        rts

digit_sub:
        ldx #$B0
ds_l:
        lda remH
        cmp subH
        bcc ds_done
        bne ds_can
        lda remL
        cmp subL
        bcc ds_done
ds_can:
        lda remL
        sec
        sbc subL
        sta remL
        lda remH
        sbc subH
        sta remH
        inx
        bra ds_l
ds_done:
        txa
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

; ---------------------------------------------------------------------------
; text helpers
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

put4:
        lda ROWL,x
        sta sptr
        lda ROWH,x
        sta sptr+1
        tya
        clc
        adc sptr
        sta sptr
        ldy #0
p4_l:
        lda (strp),y
        ora #$80
        sta (sptr),y
        iny
        cpy #4
        bne p4_l
        rts

; ---------------------------------------------------------------------------
; rng : 16-bit Galois LFSR.
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
; data
; ---------------------------------------------------------------------------
ROWL:   .byte $00,$80,$00,$80,$00,$80,$00,$80,$28,$A8,$28,$A8
        .byte $28,$A8,$28,$A8,$50,$D0,$50,$D0,$50,$D0,$50,$D0
ROWH:   .byte $04,$04,$05,$05,$06,$06,$07,$07,$04,$04,$05,$05
        .byte $06,$06,$07,$07,$04,$04,$05,$05,$06,$06,$07,$07

cell_row:
        .byte 4,4,4,4, 6,6,6,6, 8,8,8,8, 10,10,10,10
cell_col:
        .byte 10,15,20,25, 10,15,20,25, 10,15,20,25, 10,15,20,25

score_val_l:
        .byte $00,$02,$04,$08,$10,$20,$40,$80,$00,$00,$00,$00,$00,$00,$00,$00
score_val_h:
        .byte $00,$00,$00,$00,$00,$00,$00,$00,$01,$02,$04,$08,$10,$20,$40,$80

tile_l:
        .byte <tile_0,<tile_1,<tile_2,<tile_3,<tile_4,<tile_5
        .byte <tile_6,<tile_7,<tile_8,<tile_9,<tile_10,<tile_11
tile_h:
        .byte >tile_0,>tile_1,>tile_2,>tile_3,>tile_4,>tile_5
        .byte >tile_6,>tile_7,>tile_8,>tile_9,>tile_10,>tile_11

msg_status:   .byte "2048  SCORE:00000  WASD/ARROWS Q=QUIT", 0
msg_border:   .byte "+----+----+----+----+", 0
msg_emptyrow: .byte "|    |    |    |    |", 0
msg_over:     .byte "**** GAME OVER ****", 0
msg_again:    .byte "SPACE = PLAY AGAIN     Q = QUIT", 0
msg_win:      .byte "2048!  C/RETURN CONTINUE  SPACE RESTART", 0

tile_0:       .byte "    "
tile_1:       .byte "   2"
tile_2:       .byte "   4"
tile_3:       .byte "   8"
tile_4:       .byte "  16"
tile_5:       .byte "  32"
tile_6:       .byte "  64"
tile_7:       .byte " 128"
tile_8:       .byte " 256"
tile_9:       .byte " 512"
tile_10:      .byte "1024"
tile_11:      .byte "2048"
