; ============================================================================
; MINEFIELD for the 3ric  (65C02, Apple-II compatible)  -- text mode, 40x24.
;
;   * Turn-based Minesweeper-style game on a 16x16 field.
;   * Controls: arrows or W/A/S/D move, SPACE/RETURN reveal, F flags, Q quits.
;   * On game over or win: SPACE plays again, Q returns to the monitor.
;   * BRK hooks expose deterministic count and flood-fill logic for tests.
;
; Build / run:
;   node codegen/tools/asm6502.mjs emulator/AICodeGen/mines/mines.s \
;        emulator/AICodeGen/mines/mines.prg --org 0x0800
;   BRUN MINES.PRG 0800
; ============================================================================

; ---- soft switches / hardware ----
KBD      = $C000        ; keyboard data (bit7 = key ready)
KBDSTRB  = $C010        ; clear keyboard strobe (any access)
TXTSET   = $C051        ; text mode on
LOWSCR   = $C054        ; display page 1

; ---- glyphs (normal video = ascii | $80) ----
BLANK    = $A0          ; ' '
HIDDEN   = $AE          ; '.'
MINECH   = $AA          ; '*'
FLAGCH   = $C6          ; 'F'
CURSORCH = $A3          ; '#'

; ---- grid geometry ----
; A 16x16 field (256 cells) is the classic Minesweeper "intermediate" board and
; is the largest grid the single-byte cell index (ROWOFF[row]+col) can address.
W        = 16
H        = 16
CELLS    = 256          ; note: index range is 0..255 -- exactly one byte
MINES_N  = 40
GRIDTOP  = 4
GRIDLEFT = 12
SEED0    = $BEEF

; ---- documented RAM arrays / hook inputs ----
MINE     = $2000        ; 256 bytes: 1 = mine, 0 = safe
STATE    = $2100        ; 256 bytes: 0 = hidden, 1 = revealed, 2 = flagged
COUNT    = $2200        ; 256 bytes: computed neighboring mine count
STACK_R  = $2300        ; flood-fill worklist rows
STACK_C  = $2400        ; flood-fill worklist cols
START_R  = $2500        ; flood_hook input row
START_C  = $2501        ; flood_hook input col

; ---- zero page ----
seedL    = $06
seedH    = $07
sptr     = $08          ; (2) screen pointer
strp     = $0A          ; (2) string pointer
rr       = $0C          ; current logic row
cc       = $0D          ; current logic col
idx      = $0E          ; linear cell index
ncnt     = $0F          ; neighbor count scratch
curR     = $10
curC     = $11
status   = $12          ; 0 playing, 1 lost, 2 won
minecnt  = $13
qhead    = $14
qtail    = $15
nrow     = $16
ncol     = $17
tmp      = $18
keytmp   = $19

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
turn_loop:
        jsr wait_key
        sta keytmp
        cmp #$51                ; Q
        beq quit
        cmp #$08                ; left arrow
        beq key_left
        cmp #$41                ; A
        beq key_left
        cmp #$15                ; right arrow
        beq key_right
        cmp #$44                ; D
        beq key_right
        cmp #$0B                ; up arrow
        beq key_up
        cmp #$57                ; W
        beq key_up
        cmp #$0A                ; down arrow
        beq key_down
        cmp #$53                ; S
        beq key_down
        cmp #$46                ; F
        beq key_flag
        cmp #$20                ; SPACE
        beq key_reveal
        cmp #$0D                ; RETURN
        beq key_reveal
        bra turn_loop

key_left:
        lda curC
        beq key_draw
        dec curC
        bra key_draw
key_right:
        lda curC
        cmp #W-1
        beq key_draw
        inc curC
        bra key_draw
key_up:
        lda curR
        beq key_draw
        dec curR
        bra key_draw
key_down:
        lda curR
        cmp #H-1
        beq key_draw
        inc curR
        bra key_draw
key_flag:
        jsr toggle_flag
        bra key_draw
key_reveal:
        jsr reveal_current
key_draw:
        jsr render_all
        lda status
        beq turn_loop
        jmp game_over

quit:
        lda KBDSTRB
        brk

; ---------------------------------------------------------------------------
; init_game : clear state, place random mines, compute counts, render.
; ---------------------------------------------------------------------------
init_game:
        jsr clear_arrays
        stz curR
        stz curC
        stz status
        stz minecnt
place_loop:
        jsr random_cell
        jsr index_rrcc
        lda MINE,x
        bne place_loop
        lda #1
        sta MINE,x
        inc minecnt
        lda minecnt
        cmp #MINES_N
        bne place_loop
        jsr count_all
        jsr render_all
        rts

clear_arrays:
        ldx #0
        lda #0
ca_loop:
        sta MINE,x
        sta STATE,x
        sta COUNT,x
        inx
        bne ca_loop             ; wraps 255->0 after all 256 cells
        rts

; random_cell : draw (rr,cc) from one RNG step -- seedH's low nibble picks the
; row, seedL's low nibble the column. Both are 0..15, exactly the 16x16 range,
; so no rejection is needed. (The original drew both coordinates from seedL's
; low nibble, whose short sub-cycle only reached 32 of the 256 cells -- not
; enough to place 40 mines, so placement spun forever.)
random_cell:
        jsr rng
        lda seedH
        and #$0F
        sta rr
        lda seedL
        and #$0F
        sta cc
        rts

; ---------------------------------------------------------------------------
; input and game-over wait loops
; ---------------------------------------------------------------------------
wait_key:
        lda KBD
        bpl wait_key
        and #$7F
        sta KBDSTRB
        rts

game_over:
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

; ---------------------------------------------------------------------------
; cell actions
; ---------------------------------------------------------------------------
toggle_flag:
        lda curR
        sta rr
        lda curC
        sta cc
        jsr index_rrcc
        lda STATE,x
        cmp #1
        beq tf_done
        cmp #2
        beq tf_unflag
        lda #2
        sta STATE,x
        rts
tf_unflag:
        lda #0
        sta STATE,x
tf_done:
        rts

reveal_current:
        lda curR
        sta rr
        lda curC
        sta cc
        jsr index_rrcc
        lda STATE,x
        cmp #2
        beq rv_done
        cmp #1
        beq rv_done
        lda MINE,x
        beq rv_safe
        lda #1
        sta status
        rts
rv_safe:
        lda COUNT,x
        beq rv_flood
        lda #1
        sta STATE,x
        bra rv_check
rv_flood:
        lda curR
        sta START_R
        lda curC
        sta START_C
        jsr flood_reveal
rv_check:
        jsr check_win
rv_done:
        rts

check_win:
        ldx #0
cw_loop:
        lda MINE,x
        bne cw_next
        lda STATE,x
        cmp #1
        bne cw_notyet
cw_next:
        inx
        bne cw_loop             ; wraps 255->0 after all 256 cells
        lda #2
        sta status
cw_notyet:
        rts

; ---------------------------------------------------------------------------
; count_all / count_cell : populate COUNT[] for every cell.
; ---------------------------------------------------------------------------
count_all:
        stz rr
cnt_row:
        stz cc
cnt_col:
        jsr count_cell
        sta tmp
        jsr index_rrcc
        lda tmp
        sta COUNT,x
        inc cc
        lda cc
        cmp #W
        bne cnt_col
        inc rr
        lda rr
        cmp #H
        bne cnt_row
        rts

count_cell:
        stz ncnt
        lda rr
        beq cc_no_up
        dec a
        sta nrow
        lda cc
        beq cc_up_mid
        dec a
        sta ncol
        jsr add_neighbor
cc_up_mid:
        lda cc
        sta ncol
        jsr add_neighbor
        lda cc
        cmp #W-1
        beq cc_no_up
        inc a
        sta ncol
        jsr add_neighbor
cc_no_up:
        lda rr
        sta nrow
        lda cc
        beq cc_mid_right
        dec a
        sta ncol
        jsr add_neighbor
cc_mid_right:
        lda cc
        cmp #W-1
        beq cc_no_mid
        inc a
        sta ncol
        jsr add_neighbor
cc_no_mid:
        lda rr
        cmp #H-1
        beq cc_done
        inc a
        sta nrow
        lda cc
        beq cc_down_mid
        dec a
        sta ncol
        jsr add_neighbor
cc_down_mid:
        lda cc
        sta ncol
        jsr add_neighbor
        lda cc
        cmp #W-1
        beq cc_done
        inc a
        sta ncol
        jsr add_neighbor
cc_done:
        lda ncnt
        rts

add_neighbor:
        ldx nrow
        lda ROWOFF,x
        clc
        adc ncol
        tax
        lda MINE,x
        beq an_done
        inc ncnt
an_done:
        rts

; ---------------------------------------------------------------------------
; flood_reveal : iterative worklist flood from START_R/START_C.
; Final STATE values are only 0 hidden, 1 revealed, or 2 flagged.
; ---------------------------------------------------------------------------
flood_reveal:
        stz qhead
        stz qtail
        lda START_R
        sta nrow
        lda START_C
        sta ncol
        jsr queue_if_ok
fr_loop:
        lda qhead
        cmp qtail
        beq fr_done
        ldx qhead
        lda STACK_R,x
        sta rr
        lda STACK_C,x
        sta cc
        inc qhead
        jsr index_rrcc
        lda #1
        sta STATE,x
        lda COUNT,x
        bne fr_loop
        jsr push_neighbors
        bra fr_loop
fr_done:
        rts

push_neighbors:
        lda rr
        beq pn_no_up
        dec a
        sta nrow
        lda cc
        beq pn_up_mid
        dec a
        sta ncol
        jsr queue_neighbor
pn_up_mid:
        lda cc
        sta ncol
        jsr queue_neighbor
        lda cc
        cmp #W-1
        beq pn_no_up
        inc a
        sta ncol
        jsr queue_neighbor
pn_no_up:
        lda rr
        sta nrow
        lda cc
        beq pn_mid_right
        dec a
        sta ncol
        jsr queue_neighbor
pn_mid_right:
        lda cc
        cmp #W-1
        beq pn_no_mid
        inc a
        sta ncol
        jsr queue_neighbor
pn_no_mid:
        lda rr
        cmp #H-1
        beq pn_done
        inc a
        sta nrow
        lda cc
        beq pn_down_mid
        dec a
        sta ncol
        jsr queue_neighbor
pn_down_mid:
        lda cc
        sta ncol
        jsr queue_neighbor
        lda cc
        cmp #W-1
        beq pn_done
        inc a
        sta ncol
        jsr queue_neighbor
pn_done:
        rts

queue_neighbor:
        jsr queue_if_ok
        rts

queue_if_ok:
        ldx nrow
        lda ROWOFF,x
        clc
        adc ncol
        tax
        lda MINE,x
        bne qi_done
        lda STATE,x
        bne qi_done
        lda #3                  ; queued marker, consumed before hook returns
        sta STATE,x
        ldx qtail
        lda nrow
        sta STACK_R,x
        lda ncol
        sta STACK_C,x
        inc qtail
qi_done:
        rts

; ---------------------------------------------------------------------------
; render_all : draw title, status, and the 16x16 field.
; ---------------------------------------------------------------------------
render_all:
        jsr clear_screen
        lda #<msg_title
        sta strp
        lda #>msg_title
        sta strp+1
        ldx #0
        ldy #0
        jsr puts
        lda #<msg_help
        sta strp
        lda #>msg_help
        sta strp+1
        ldx #1
        ldy #0
        jsr puts
        lda status
        beq rd_grid
        cmp #1
        beq rd_lost
        lda #<msg_win
        sta strp
        lda #>msg_win
        sta strp+1
        bra rd_banner
rd_lost:
        lda #<msg_over
        sta strp
        lda #>msg_over
        sta strp+1
rd_banner:
        ldx #2
        ldy #7
        jsr puts
rd_grid:
        stz rr
rd_row:
        stz cc
rd_col:
        jsr cell_glyph
        pha
        lda rr
        clc
        adc #GRIDTOP
        tax
        lda cc
        clc
        adc #GRIDLEFT
        tay
        pla
        jsr plot
        inc cc
        lda cc
        cmp #W
        bne rd_col
        inc rr
        lda rr
        cmp #H
        bne rd_row
        rts

cell_glyph:
        lda status
        cmp #1
        bne cg_cursor
        jsr index_rrcc
        lda MINE,x
        beq cg_cursor
        lda #MINECH
        rts
cg_cursor:
        lda rr
        cmp curR
        bne cg_state
        lda cc
        cmp curC
        bne cg_state
        lda #CURSORCH
        rts
cg_state:
        jsr index_rrcc
        lda STATE,x
        cmp #1
        beq cg_revealed
        cmp #2
        beq cg_flag
        lda #HIDDEN
        rts
cg_flag:
        lda #FLAGCH
        rts
cg_revealed:
        lda COUNT,x
        beq cg_blank
        ora #$B0
        rts
cg_blank:
        lda #BLANK
        rts

; ---------------------------------------------------------------------------
; screen helpers (copied from the Snake text skeleton)
; ---------------------------------------------------------------------------
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
; helpers
; ---------------------------------------------------------------------------
index_rrcc:
        ldx rr
        lda ROWOFF,x
        clc
        adc cc
        tax
        stx idx
        rts

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
; BRK test hooks
; ---------------------------------------------------------------------------
count_hook:
        ldx #$FF
        txs
        jsr count_all
        brk

flood_hook:
        ldx #$FF
        txs
        jsr count_all
        jsr flood_reveal
        brk

; ---------------------------------------------------------------------------
; data
; ---------------------------------------------------------------------------
ROWOFF: .byte 0,16,32,48,64,80,96,112,128,144,160,176,192,208,224,240

ROWL:   .byte $00,$80,$00,$80,$00,$80,$00,$80,$28,$A8,$28,$A8
        .byte $28,$A8,$28,$A8,$50,$D0,$50,$D0,$50,$D0,$50,$D0
ROWH:   .byte $04,$04,$05,$05,$06,$06,$07,$07,$04,$04,$05,$05
        .byte $06,$06,$07,$07,$04,$04,$05,$05,$06,$06,$07,$07

msg_title: .byte "MINEFIELD  ARROWS MOVE  SPC REVEAL", 0
msg_help:  .byte "F FLAG  Q=QUIT", 0
msg_over:  .byte "GAME OVER  SPACE RESTART  Q QUIT", 0
msg_win:   .byte "YOU WIN!   SPACE RESTART  Q QUIT", 0
