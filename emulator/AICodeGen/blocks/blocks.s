; ============================================================================
; BLOCK DROP for the 3ric  (65C02, Apple-II compatible) -- LO-RES colour graphics.
;
;   * Generic falling-block stacker in a 10 x 20 well, rendered in MIXED LO-RES:
;     each well cell is a 2x2 lo-res block, so the 10x20 well fills a 20x40 lo-res
;     area framed by grey side walls.  The seven shapes each drop in their own
;     colour and settle into the well.
;   * A four-row text HUD (screen rows 20-23) under the field carries the score,
;     the controls, and the game-over banner -- the same mixed-graphics idiom as
;     snake.s / jungle.s.
;   * Controls: Left/Right arrows or A/D move, Up/W rotates, Down/S soft-drops,
;     Q quits.  SPACE restarts after game over.
;   * The well contents live in a 10x20 byte model in RAM (0 = empty, else the
;     settled cell's lo-res colour); the lo-res field is rendered from that model.
;
; Lo-res page 1 shares the text page ($0400-$07FF): each byte holds two stacked
; pixels -- the low nibble is the upper pixel, the high nibble the lower one --
; so a lo-res row R maps to text row R/2 (`ROWL/ROWH[R>>1]`), low nibble when R
; is even, high nibble when R is odd (see lplot/lpeek).
;
; Build / run:
;   node codegen/tools/asm6502.mjs emulator/AICodeGen/blocks/blocks.s \
;        emulator/AICodeGen/blocks/blocks.prg --org 0x0800
;   BRUN BLOCKS.PRG 0800
; ============================================================================

; ---- soft switches / hardware ----
KBD      = $C000        ; keyboard data (bit7 = key ready)
KBDSTRB  = $C010        ; clear keyboard strobe (any access)
TXTCLR   = $C050        ; graphics on (text off)
MIXSET   = $C053        ; mixed: 40x40 lo-res + 4 text rows at the bottom
LOWSCR   = $C054        ; display page 1
LORES    = $C056        ; lo-res graphics

; ---- lo-res colours (index into the 16-entry palette) ----
C_EMPTY  = 0            ; black, empty cell
C_WALL   = 5            ; grey side wall

; ---- well geometry (10 wide x 20 tall cells; each cell = 2x2 lo-res pixels) ----
WELL_W   = 10
WELL_H   = 20
IX0      = 10           ; interior left lo-res col (cell col c -> cols IX0+2c, +1)
WALL_L   = 9            ; left wall lo-res column
WALL_R   = 30           ; right wall lo-res column

; ---- text HUD (mixed-mode rows 20..23 live in the text page) ----
HUDROW   = 20           ; status / score line
HELPROW  = 21           ; controls line
OVERROW  = 22           ; game-over banner
AGAINROW = 23           ; play-again prompt

; ---- score digit positions on the HUD row ("...SCORE:000" -> $0650+19..21) ----
SCOREH   = $0663
SCORET   = $0664
SCOREO   = $0665

; ---- pacing ----
; GRAV = wait-loop iterations per gravity step (16-bit).  Each iteration polls
; the keyboard and burns DLY inner counts, so GRAV*(read_key+tiny_delay) sets the
; drop interval.  Tuned for a ~0.8 s/cell fall at the native 1.57 MHz clock; the
; page Speed selector scales it.
GRAV     = 1700
DLY      = 110
SEED0    = $A5A5

; ---- game model ----
WELL     = $2000        ; 200 bytes, row-major 10 x 20 (0 = empty, else colour)

; ---- zero page ----
seedL    = $06
seedH    = $07
sptr     = $08          ; (2) screen pointer
strp     = $0A          ; (2) string pointer
srcp     = $0C          ; (2) source/well pointer
dstp     = $0E          ; (2) destination pointer
shp      = $10          ; (2) shape data pointer
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
lcolor   = $22          ; lplot/lpeek scratch: colour 0..15
ltmp     = $23          ; lplot scratch: colour << 4
pcColor  = $24          ; plot_cell: cell colour
pcRow    = $25          ; plot_cell: base lo-res row
pcCol    = $26          ; plot_cell: base lo-res col
actColor = $27          ; active-piece colour
gcntL    = $28          ; (2) 16-bit gravity countdown
gcntH    = $29

        .org $0800

; ---------------------------------------------------------------------------
; entry
; ---------------------------------------------------------------------------
start:
        sei
        cld
        ldx #$FF
        txs
        lda TXTCLR              ; graphics on (text off)
        lda MIXSET              ; mixed: lo-res field + text HUD
        lda LOWSCR              ; display page 1
        lda LORES               ; lo-res graphics
        lda KBDSTRB             ; clear any pending key
        lda #<SEED0
        sta seedL
        lda #>SEED0
        sta seedH

play:
        jsr init_game
main_loop:
        lda #<GRAV
        sta gcntL
        lda #>GRAV
        sta gcntH
ml_wait:
        jsr read_key
        lda gover
        bne ml_over            ; soft-drop topped the well out
        jsr tiny_delay
        lda gcntL
        bne ml_declo
        dec gcntH
ml_declo:
        dec gcntL
        lda gcntL
        ora gcntH
        bne ml_wait
        jsr gravity_step
        lda gover
        beq main_loop
ml_over:
        jmp game_over

; ---------------------------------------------------------------------------
; init_game : clear model/screen, draw the well, and spawn the first piece.
; ---------------------------------------------------------------------------
init_game:
        jsr draw_board
        jsr clear_well
        stz score
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
; lock_piece : copy the active piece (in its colour) into the well array.
; ---------------------------------------------------------------------------
lock_piece:
        lda curRot
        sta tryRot
        jsr set_shape_ptr
        jsr cur_color
        sta actColor
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
        lda actColor
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
        ldx #OVERROW
        ldy #10
        jsr puts
        lda #<msg_again
        sta strp
        lda #>msg_again
        sta strp+1
        ldx #AGAINROW
        ldy #10
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
        rts

; draw_board : black the field, blank the HUD, draw the status/help lines + walls.
draw_board:
        jsr clear_gfx
        jsr clear_hud
        lda #<msg_status
        sta strp
        lda #>msg_status
        sta strp+1
        ldx #HUDROW
        ldy #0
        jsr puts
        lda #<msg_help
        sta strp
        lda #>msg_help
        sta strp+1
        ldx #HELPROW
        ldy #0
        jsr puts
        jsr draw_walls
        rts

; draw_walls : paint the grey side walls (cols WALL_L/WALL_R, all 40 lo-res rows).
draw_walls:
        ldx #0
dw_l:
        ldy #WALL_L
        lda #C_WALL
        jsr lplot               ; preserves X (row) and Y (col)
        ldy #WALL_R
        lda #C_WALL
        jsr lplot
        inx
        cpx #40
        bne dw_l
        rts

; render_well : paint all 200 well cells from the model (2x2 lo-res block each).
render_well:
        stz scanR
rw_row:
        ldx scanR
        lda WELLRL,x
        sta srcp
        lda WELLRH,x
        sta srcp+1
        stz scanC
rw_col:
        ldy scanC
        lda (srcp),y            ; A = cell colour (0 = empty)
        ldx scanR
        ldy scanC
        jsr plot_cell
        inc scanC
        lda scanC
        cmp #WELL_W
        bne rw_col
        inc scanR
        lda scanR
        cmp #WELL_H
        bne rw_row
        rts

; draw_active : overlay the active piece (in its colour) as 2x2 blocks.
draw_active:
        lda curRot
        sta tryRot
        jsr set_shape_ptr
        jsr cur_color
        sta actColor
        stz cellI
da_loop:
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
        lda actColor
        ldx tempR
        ldy tempC
        jsr plot_cell
        lda cellI
        clc
        adc #2
        sta cellI
        cmp #8
        bne da_loop
        rts

; plot_cell : A=colour, X=cell row(0..19), Y=cell col(0..9) -> paint a 2x2 block.
;   lo-res base row = X*2, base col = IX0 + Y*2.  Uses lplot (which preserves X,Y).
plot_cell:
        sta pcColor
        txa
        asl a                   ; cell row * 2
        sta pcRow
        tya
        asl a                   ; cell col * 2
        clc
        adc #IX0
        sta pcCol
        ldx pcRow
        ldy pcCol
        lda pcColor
        jsr lplot               ; (r, c)
        iny
        lda pcColor
        jsr lplot               ; (r, c+1)
        inx
        lda pcColor
        jsr lplot               ; (r+1, c+1)
        dey
        lda pcColor
        jsr lplot               ; (r+1, c)
        rts

; cur_color : A = lo-res colour for the current shape.
cur_color:
        ldx curShape
        lda SHCOL,x
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

; clear_gfx : paint the whole lo-res page ($0400-$07FF) black.
clear_gfx:
        lda #C_EMPTY
        ldx #0
cg_l:
        sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne cg_l
        rts

; clear_hud : blank the four text HUD rows (20..23) to spaces.
clear_hud:
        ldx #20
ch_row:
        lda ROWL,x
        sta sptr
        lda ROWH,x
        sta sptr+1
        ldy #0
        lda #$A0
ch_col:
        sta (sptr),y
        iny
        cpy #40
        bne ch_col
        inx
        cpx #24
        bne ch_row
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
; draw_score : render score as three decimal digits on the HUD row.
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
; lplot : A=colour(0..15), X=row(0..39), Y=col(0..39) -> paint one lo-res cell.
;         Read-modify-writes the correct nibble; preserves X and Y.
; ---------------------------------------------------------------------------
lplot:
        sta lcolor
        phy                     ; save caller col
        phx                     ; save caller row
        txa
        lsr a                   ; A = row>>1 = text row ; C = parity (1 = odd)
        tax
        lda ROWL,x
        sta sptr
        lda ROWH,x
        sta sptr+1
        plx                     ; restore caller row (pulls leave C intact)
        ply                     ; restore caller col -> Y
        bcs lp_hi               ; odd row -> high (lower-pixel) nibble
        lda (sptr),y            ; even row -> low (upper-pixel) nibble
        and #$F0
        ora lcolor
        sta (sptr),y
        rts
lp_hi:
        lda lcolor
        asl a
        asl a
        asl a
        asl a
        sta ltmp                ; colour << 4
        lda (sptr),y
        and #$0F
        ora ltmp
        sta (sptr),y
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
; ROWL/ROWH : base address of each text row (indexed by row>>1 for lo-res, and
; by 20..23 for the HUD).
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

; per-shape lo-res colours: O,I,T,S,Z,L,J
SHCOL:  .byte 13,14,3,12,1,9,6

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

msg_status: .byte "BLOCK DROP   SCORE:000", 0
msg_help:   .byte "A/D-MOVE  W-ROT  S-DROP  Q-QUIT", 0
msg_over:   .byte "**** GAME OVER ****", 0
msg_again:  .byte "SPACE=AGAIN   Q=QUIT", 0
