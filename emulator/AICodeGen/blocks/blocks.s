; ============================================================================
; BLOCK DROP for the 3ric  (65C02, Apple-II compatible) -- text mode, 40x24.
;
;   * Generic falling-block stacker in a 10 x 20 well.
;   * Controls: Left/Right arrows or A/D move, Up/W rotates, Down/S drops,
;     Q quits.  SPACE restarts after game over.
;   * The well contents live in RAM; the text screen is rendered from that model.
;
; Build / run:
;   node codegen/tools/asm6502.mjs emulator/AICodeGen/blocks/blocks.s \
;        emulator/AICodeGen/blocks/blocks.prg --org 0x0800
;   BRUN BLOCKS.PRG 0800
; ============================================================================

; ---- soft switches / hardware ----
KBD      = $C000
KBDSTRB  = $C010
TXTSET   = $C051
LOWSCR   = $C054

; ---- glyphs (normal video = ascii | $80) ----
BLANK    = $A0          ; ' '
WALL     = $A3          ; '#'
ACTIVE   = $C0          ; '@'

; ---- well geometry ----
WELL_W   = 10
WELL_H   = 20
WELL_R0  = 2
WELL_C0  = 15
WALL_L   = 14
WALL_R   = 25
FLOOR_R  = 22

; ---- score digit positions on row 0 ----
SCOREH   = $0411
SCORET   = $0412
SCOREO   = $0413
LVLT     = $0419        ; level tens / ones digits
LVLO     = $041A

; ---- pacing ----
;   Gravity period (ml_wait iterations per row) comes from PACE_TBL, indexed by
;   the current level.  Level rises with lines cleared, so the fall speeds up.
DLY      = 60           ; inner busy-delay per keyboard poll
LINES_PER_LEVEL = 5     ; cleared lines needed to advance one level
MAXLVL   = 15           ; fastest level (also PACE_TBL's last index)
SEED0    = $A5A5

; ---- game model ----
WELL     = $2000        ; 200 bytes, row-major 10 x 20

; ---- zero page ----
seedL    = $06
seedH    = $07
sptr     = $08          ; screen pointer
strp     = $0A          ; string pointer
srcp     = $0C          ; source/well pointer
dstp     = $0E          ; destination pointer
shp      = $10          ; shape data pointer
pieceR   = $12
pieceC   = $13
curShape = $14
curRot   = $15
tryR     = $16
tryC     = $17
tryRot   = $18
tempR    = $19
tempC    = $1A
cellI    = $1B
coll     = $1C
scanR    = $1D
scanC    = $1E
copyR    = $1F
score    = $20
gover    = $21
level    = $22
gravL    = $23          ; 16-bit gravity countdown (iterations left this row)
gravH    = $24

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
        jsr reload_grav
ml_wait:
        jsr read_key
        jsr tiny_delay
        lda gravL
        bne ml_declo
        dec gravH
ml_declo:
        dec gravL
        lda gravL
        ora gravH
        bne ml_wait
        jsr gravity_step
        lda gover
        beq main_loop
        jmp game_over

; ---------------------------------------------------------------------------
; init_game : clear model/screen, draw the well, and spawn the first piece.
; ---------------------------------------------------------------------------
init_game:
        jsr draw_board
        jsr clear_well
        stz score
        lda #1
        sta level
        stz gover
        jsr spawn_piece
        jsr render_all
        rts

; ---------------------------------------------------------------------------
; read_key : non-blocking keyboard poll.
; ---------------------------------------------------------------------------
read_key:
        lda KBD
        bpl rk_none
        and #$7F
        sta KBDSTRB
        cmp #$08                ; left arrow
        beq rk_left
        cmp #$41                ; A
        beq rk_left
        cmp #$15                ; right arrow
        beq rk_right
        cmp #$44                ; D
        beq rk_right
        cmp #$0B                ; up arrow
        beq rk_rot
        cmp #$57                ; W
        beq rk_rot
        cmp #$0A                ; down arrow
        beq rk_down
        cmp #$53                ; S
        beq rk_down
        cmp #$51                ; Q
        beq rk_quit
rk_none:
        rts
rk_quit:
        jmp quit
rk_left:
        lda pieceR
        sta tryR
        lda pieceC
        sec
        sbc #1
        sta tryC
        lda curRot
        sta tryRot
        jsr check_collision
        lda coll
        bne rk_done
        dec pieceC
        jsr render_all
rk_done:
        rts
rk_right:
        lda pieceR
        sta tryR
        lda pieceC
        clc
        adc #1
        sta tryC
        lda curRot
        sta tryRot
        jsr check_collision
        lda coll
        bne rk_done
        inc pieceC
        jsr render_all
        rts
rk_down:
        jsr gravity_step
        rts
rk_rot:
        lda pieceR
        sta tryR
        lda pieceC
        sta tryC
        lda curRot
        inc a
        and #3
        sta tryRot
        jsr check_collision
        lda coll
        bne rk_done
        lda tryRot
        sta curRot
        jsr render_all
        rts

; ---------------------------------------------------------------------------
; gravity_step : move down if possible; otherwise lock, clear rows, respawn.
; ---------------------------------------------------------------------------
gravity_step:
        lda pieceR
        clc
        adc #1
        sta tryR
        lda pieceC
        sta tryC
        lda curRot
        sta tryRot
        jsr check_collision
        lda coll
        bne gs_lock
        inc pieceR
        jsr render_all
        rts
gs_lock:
        jsr lock_piece
        jsr clear_lines
        jsr update_level
        jsr spawn_piece
        lda gover
        bne gs_over
        jsr render_all
        rts
gs_over:
        jsr render_all
        rts

; ---------------------------------------------------------------------------
; spawn_piece : choose a random shape and place it at the top centre.
; ---------------------------------------------------------------------------
spawn_piece:
sp_pick:
        jsr rng
        lda seedL
        and #7
        cmp #7
        beq sp_pick
        sta curShape
        stz curRot
        stz pieceR
        lda #3
        sta pieceC
        stz gover
        lda pieceR
        sta tryR
        lda pieceC
        sta tryC
        lda curRot
        sta tryRot
        jsr check_collision
        lda coll
        beq sp_ok
        lda #1
        sta gover
sp_ok:
        rts

; ---------------------------------------------------------------------------
; check_collision : tryR/tryC/tryRot -> coll (0 = fits, 1 = blocked).
; ---------------------------------------------------------------------------
check_collision:
        jsr set_shape_ptr
        stz coll
        stz cellI
cc_loop:
        ldy cellI
        lda (shp),y
        clc
        adc tryR
        sta tempR
        cmp #WELL_H
        bcs cc_hit
        iny
        lda (shp),y
        clc
        adc tryC
        sta tempC
        cmp #WELL_W
        bcs cc_hit
        ldx tempR
        ldy tempC
        jsr well_peek
        beq cc_next
cc_hit:
        lda #1
        sta coll
        rts
cc_next:
        lda cellI
        clc
        adc #2
        sta cellI
        cmp #8
        bne cc_loop
        rts

; ---------------------------------------------------------------------------
; lock_piece : copy the active piece into the well array.
; ---------------------------------------------------------------------------
lock_piece:
        lda curRot
        sta tryRot
        jsr set_shape_ptr
        stz cellI
lp_loop:
        ldy cellI
        lda (shp),y
        clc
        adc pieceR
        sta tempR
        iny
        lda (shp),y
        clc
        adc pieceC
        sta tempC
        ldx tempR
        ldy tempC
        lda #1
        jsr well_store
        lda cellI
        clc
        adc #2
        sta cellI
        cmp #8
        bne lp_loop
        rts

; ---------------------------------------------------------------------------
; clear_lines : remove full rows, shift above rows down, and update score.
; ---------------------------------------------------------------------------
clear_lines:
        lda #19
        sta scanR
cl_loop:
        jsr row_full
        cmp #1
        beq cl_drop
cl_next:
        lda scanR
        beq cl_done
        dec scanR
        bra cl_loop
cl_drop:
        jsr drop_rows
        lda score
        cmp #255
        beq cl_loop
        inc score
        bra cl_loop
cl_done:
        rts

row_full:
        ldx scanR
        lda WELLRL,x
        sta srcp
        lda WELLRH,x
        sta srcp+1
        ldy #0
rf_loop:
        lda (srcp),y
        beq rf_no
        iny
        cpy #WELL_W
        bne rf_loop
        lda #1
        rts
rf_no:
        lda #0
        rts

drop_rows:
        lda scanR
        beq dr_zero_top
        sta copyR
dr_loop:
        ldx copyR
        lda WELLRL,x
        sta dstp
        lda WELLRH,x
        sta dstp+1
        dex
        lda WELLRL,x
        sta srcp
        lda WELLRH,x
        sta srcp+1
        ldy #0
dr_copy:
        lda (srcp),y
        sta (dstp),y
        iny
        cpy #WELL_W
        bne dr_copy
        dec copyR
        bne dr_loop
dr_zero_top:
        ldx #0
        lda WELLRL,x
        sta dstp
        lda WELLRH,x
        sta dstp+1
        lda #0
        ldy #0
dr_zero:
        sta (dstp),y
        iny
        cpy #WELL_W
        bne dr_zero
        rts

; ---------------------------------------------------------------------------
; game_over : overlay banner and wait for SPACE (restart) or Q (quit).
; ---------------------------------------------------------------------------
game_over:
        lda #<msg_over
        sta strp
        lda #>msg_over
        sta strp+1
        ldx #10
        ldy #11
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
; rendering and board helpers
; ---------------------------------------------------------------------------
render_all:
        jsr render_well
        jsr draw_active
        jsr draw_score
        jsr draw_level
        rts

draw_board:
        jsr clear_screen
        lda #<msg_status
        sta strp
        lda #>msg_status
        sta strp+1
        ldx #0
        ldy #0
        jsr puts
        ldx #WELL_R0
        stx scanR
db_sides:
        ldx scanR
        ldy #WALL_L
        lda #WALL
        jsr plot
        ldx scanR
        ldy #WALL_R
        lda #WALL
        jsr plot
        inc scanR
        lda scanR
        cmp #FLOOR_R
        bne db_sides
        ldx #FLOOR_R
        lda ROWL,x
        sta sptr
        lda ROWH,x
        sta sptr+1
        ldy #WALL_L
        lda #WALL
db_floor:
        sta (sptr),y
        iny
        cpy #WALL_R+1
        bne db_floor
        rts

render_well:
        stz scanR
rw_row:
        ldx scanR
        lda WELLRL,x
        sta srcp
        lda WELLRH,x
        sta srcp+1
        lda scanR
        clc
        adc #WELL_R0
        sta tempR
        stz scanC
rw_col:
        ldy scanC
        lda (srcp),y
        beq rw_blank
        lda #WALL
        bra rw_plot
rw_blank:
        lda #BLANK
rw_plot:
        pha
        lda scanC
        clc
        adc #WELL_C0
        tay
        ldx tempR
        pla
        jsr plot
        inc scanC
        lda scanC
        cmp #WELL_W
        bne rw_col
        inc scanR
        lda scanR
        cmp #WELL_H
        bne rw_row
        rts

draw_active:
        lda curRot
        sta tryRot
        jsr set_shape_ptr
        stz cellI
da_loop:
        ldy cellI
        lda (shp),y
        clc
        adc pieceR
        clc
        adc #WELL_R0
        sta tempR
        iny
        lda (shp),y
        clc
        adc pieceC
        clc
        adc #WELL_C0
        sta tempC
        ldx tempR
        ldy tempC
        lda #ACTIVE
        jsr plot
        lda cellI
        clc
        adc #2
        sta cellI
        cmp #8
        bne da_loop
        rts

clear_well:
        lda #0
        ldx #0
cw_loop:
        sta WELL,x
        inx
        cpx #200
        bne cw_loop
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
; well access: X=row, Y=col.  well_store takes A=value.
; ---------------------------------------------------------------------------
well_peek:
        lda WELLRL,x
        sta srcp
        lda WELLRH,x
        sta srcp+1
        lda (srcp),y
        rts

well_store:
        pha
        lda WELLRL,x
        sta dstp
        lda WELLRH,x
        sta dstp+1
        pla
        sta (dstp),y
        rts

; ---------------------------------------------------------------------------
; draw_score : render score as three decimal digits on row 0.
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
; draw_level : render the current level as two decimal digits on row 0.
; ---------------------------------------------------------------------------
draw_level:
        lda level
        ldx #0
dl_t:
        cmp #10
        bcc dl_td
        sbc #10
        inx
        bra dl_t
dl_td:
        pha
        txa
        ora #$B0
        sta LVLT
        pla
        ora #$B0
        sta LVLO
        rts

; ---------------------------------------------------------------------------
; update_level : level = 1 + min(score / LINES_PER_LEVEL, MAXLVL-1), capped.
; ---------------------------------------------------------------------------
update_level:
        lda score
        ldx #1
ul_loop:
        cmp #LINES_PER_LEVEL
        bcc ul_done
        sbc #LINES_PER_LEVEL
        inx
        cpx #MAXLVL
        bcc ul_loop
        ldx #MAXLVL
ul_done:
        stx level
        rts

; ---------------------------------------------------------------------------
; reload_grav : load this row's gravity countdown from PACE_TBL[level].
;   Larger counts = slower fall; the table shrinks as the level rises.
; ---------------------------------------------------------------------------
reload_grav:
        ldx level
        lda PACE_TBL_L,x
        sta gravL
        lda PACE_TBL_H,x
        sta gravH
        rts

; ---------------------------------------------------------------------------
; plot / peekc / puts copied from the text-mode game skeleton.
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
; rng / tiny_delay / shape pointer
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

tiny_delay:
        ldy #DLY
td_l:
        dey
        bne td_l
        rts

set_shape_ptr:
        lda curShape
        asl a
        asl a
        clc
        adc tryRot
        tax
        lda SHAPE_L,x
        sta shp
        lda SHAPE_H,x
        sta shp+1
        rts

; ---------------------------------------------------------------------------
; test hook: harness sets up WELL/SCORE, runs here, and stops at BRK.
; ---------------------------------------------------------------------------
clear_hook:
        ldx #$FF
        txs
        jsr clear_lines
        brk

; ---------------------------------------------------------------------------
; data
; ---------------------------------------------------------------------------
ROWL:   .byte $00,$80,$00,$80,$00,$80,$00,$80,$28,$A8,$28,$A8
        .byte $28,$A8,$28,$A8,$50,$D0,$50,$D0,$50,$D0,$50,$D0
ROWH:   .byte $04,$04,$05,$05,$06,$06,$07,$07,$04,$04,$05,$05
        .byte $06,$06,$07,$07,$04,$04,$05,$05,$06,$06,$07,$07

WELLRL: .byte <WELL,<(WELL+10),<(WELL+20),<(WELL+30),<(WELL+40)
        .byte <(WELL+50),<(WELL+60),<(WELL+70),<(WELL+80),<(WELL+90)
        .byte <(WELL+100),<(WELL+110),<(WELL+120),<(WELL+130),<(WELL+140)
        .byte <(WELL+150),<(WELL+160),<(WELL+170),<(WELL+180),<(WELL+190)
WELLRH: .byte >WELL,>(WELL+10),>(WELL+20),>(WELL+30),>(WELL+40)
        .byte >(WELL+50),>(WELL+60),>(WELL+70),>(WELL+80),>(WELL+90)
        .byte >(WELL+100),>(WELL+110),>(WELL+120),>(WELL+130),>(WELL+140)
        .byte >(WELL+150),>(WELL+160),>(WELL+170),>(WELL+180),>(WELL+190)

; gravity countdown (ml_wait iterations per row) by level 1..MAXLVL.  index 0 is
; unused (level is 1-based).  ~0.80 s/row at level 1 down to ~0.09 s/row at 15.
PACE_TBL_L: .byte <1948,<1948,<1699,<1475,<1275,<1101,<951,<802
            .byte <677,<577,<478,<403,<328,<278,<229,<179
PACE_TBL_H: .byte >1948,>1948,>1699,>1475,>1275,>1101,>951,>802
            .byte >677,>577,>478,>403,>328,>278,>229,>179

SHAPE_L: .byte <sh_o0,<sh_o1,<sh_o2,<sh_o3,<sh_i0,<sh_i1,<sh_i2,<sh_i3
         .byte <sh_t0,<sh_t1,<sh_t2,<sh_t3,<sh_s0,<sh_s1,<sh_s2,<sh_s3
         .byte <sh_z0,<sh_z1,<sh_z2,<sh_z3,<sh_l0,<sh_l1,<sh_l2,<sh_l3
         .byte <sh_j0,<sh_j1,<sh_j2,<sh_j3
SHAPE_H: .byte >sh_o0,>sh_o1,>sh_o2,>sh_o3,>sh_i0,>sh_i1,>sh_i2,>sh_i3
         .byte >sh_t0,>sh_t1,>sh_t2,>sh_t3,>sh_s0,>sh_s1,>sh_s2,>sh_s3
         .byte >sh_z0,>sh_z1,>sh_z2,>sh_z3,>sh_l0,>sh_l1,>sh_l2,>sh_l3
         .byte >sh_j0,>sh_j1,>sh_j2,>sh_j3

; each rotation is four (dRow,dCol) pairs inside a 4x4 box
sh_o0: .byte 0,1, 0,2, 1,1, 1,2
sh_o1: .byte 0,1, 0,2, 1,1, 1,2
sh_o2: .byte 0,1, 0,2, 1,1, 1,2
sh_o3: .byte 0,1, 0,2, 1,1, 1,2
sh_i0: .byte 1,0, 1,1, 1,2, 1,3
sh_i1: .byte 0,2, 1,2, 2,2, 3,2
sh_i2: .byte 2,0, 2,1, 2,2, 2,3
sh_i3: .byte 0,1, 1,1, 2,1, 3,1
sh_t0: .byte 0,1, 1,0, 1,1, 1,2
sh_t1: .byte 0,1, 1,1, 1,2, 2,1
sh_t2: .byte 1,0, 1,1, 1,2, 2,1
sh_t3: .byte 0,1, 1,0, 1,1, 2,1
sh_s0: .byte 0,1, 0,2, 1,0, 1,1
sh_s1: .byte 0,1, 1,1, 1,2, 2,2
sh_s2: .byte 1,1, 1,2, 2,0, 2,1
sh_s3: .byte 0,0, 1,0, 1,1, 2,1
sh_z0: .byte 0,0, 0,1, 1,1, 1,2
sh_z1: .byte 0,2, 1,1, 1,2, 2,1
sh_z2: .byte 1,0, 1,1, 2,1, 2,2
sh_z3: .byte 0,1, 1,0, 1,1, 2,0
sh_l0: .byte 0,0, 1,0, 1,1, 1,2
sh_l1: .byte 0,1, 0,2, 1,1, 2,1
sh_l2: .byte 1,0, 1,1, 1,2, 2,2
sh_l3: .byte 0,1, 1,1, 2,0, 2,1
sh_j0: .byte 0,2, 1,0, 1,1, 1,2
sh_j1: .byte 0,1, 1,1, 2,1, 2,2
sh_j2: .byte 1,0, 1,1, 1,2, 2,0
sh_j3: .byte 0,0, 0,1, 1,1, 2,1

msg_status: .byte "BLOCK DROP SCORE:000 LVL:01 A/D W/S Q", 0
msg_over:   .byte "**** GAME OVER ****", 0
msg_again:  .byte "SPACE = PLAY AGAIN     Q = QUIT", 0

