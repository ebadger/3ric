; ============================================================================
; BLOCK DROP for the 3ric  (65C02, Apple-II compatible) -- text mode, 40x24.
;
;   * Generic falling-block stacker in a 10 x 20 well.
;   * Controls: Left/Right arrows or A/D move, Up/W rotates, Down/S drops,
;     Q quits.  SPACE restarts after game over.
;   * SNES gamepad (real hardware): D-pad Left/Right move, Down soft-drops,
;     Up / A / B rotate, SELECT quits, START restarts after game over.  The pad
;     is read from the ROM's GAMEPAD1 ($CEE0) table, refreshed by touching PTRIG
;     ($C070) which raises the VIA CB2 edge -> NMI pad-scan.  The emulator has no
;     gamepad hardware, so the pad is a no-op there; verify on real hardware.
;   * The well contents live in RAM; the text screen is rendered from that model.
;   * Gravity is paced by a 16-bit counter (GRAV) tuned for the native ~1.57 MHz
;     clock (~0.8 s/cell) so the drop is a comfortable classic pace, not too fast.
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

; ---- SNES gamepad (serviced by the ROM's VIA CB2 -> NMI pad scan) ----
; Touch PTRIG to trigger a refresh; the ROM then fills GAMEPAD1 with one byte
; per button (1 = pressed).  Source of truth: ebadger/msbasic (branch
; newboard_a2), badger6502_extra.s.
PTRIG     = $C070       ; RW: strobe -> CB2 edge -> NMI -> ROM scans the pads
JOYMODE   = $CE15       ; ROM joystick mode (0 = SNES pads)
GAMEPAD1  = $CEE0       ; 16 bytes; GAMEPAD1+offset = 1 while that button is down
PAD_B     = 0
PAD_SEL   = 2
PAD_START = 3
PAD_UP    = 4
PAD_DOWN  = 5
PAD_LEFT  = 6
PAD_RIGHT = 7
PAD_A     = 8
GP_RATE   = 180         ; read_key calls between pad polls (repeat rate / latency)
DAS_INIT  = 4           ; pad polls a direction is held before it auto-shifts
DAS_REP   = 2           ; pad polls between auto-shifts once repeating (tunable)

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
SCOREH   = $0412
SCORET   = $0413
SCOREO   = $0414

; ---- pacing ----
; GRAV = wait-loop iterations per gravity step (16-bit).  Each iteration polls the
; keyboard and burns DLY inner counts, so GRAV*(read_key+tiny_delay) sets the drop
; interval.  Tuned for a ~0.8 s/cell fall at the native 1.57 MHz clock (the old
; PACE=45 drop was too fast); the page Speed selector scales it.
GRAV     = 1700
DLY      = 110
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
gcntL    = $28          ; (2) 16-bit gravity countdown
gcntH    = $29
gpPoll   = $2A          ; gamepad poll throttle countdown
gpRot    = $2B          ; gamepad rotate edge latch (1 = rotate held last poll)
gpHDir   = $2C          ; gamepad horizontal latch (0 none, 1 left, 2 right)
gpHDas   = $2D          ; gamepad horizontal auto-shift (DAS) countdown

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
        stz JOYMODE            ; ensure the ROM scans SNES pads (not the mouse)
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
        lda #GP_RATE
        sta gpPoll
        stz gpRot
        stz gpHDir
        jsr spawn_piece
        jsr render_all
        rts

; ---------------------------------------------------------------------------
; read_key : non-blocking keyboard poll.
; ---------------------------------------------------------------------------
read_key:
        dec gpPoll
        bne rk_kbd
        lda #GP_RATE
        sta gpPoll
        jsr read_pad
rk_kbd:
        lda gover               ; a pad soft-drop this poll may have topped out --
        bne rk_none             ; don't act on the keyboard on a dead board
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
; read_pad : poll the SNES gamepad (throttled by read_key via gpPoll).  Touch
; PTRIG so the ROM refreshes GAMEPAD1, then act on the buttons.  Left/Right use
; auto-shift (DAS): a tap moves one cell, a hold repeats after a short delay.
; Down soft-drops fast while held; rotate is edge-detected via gpRot so one
; press = one turn; SELECT quits.
;
; A real D-pad can never report LEFT+RIGHT or UP+DOWN simultaneously, so those
; impossible combinations are rejected.  That also makes the pad a no-op under
; emulation: the emulator models no pad hardware, so the ROM's bit-bang reads
; every button as pressed -- the guard catches that and leaves the game on the
; keyboard.  A disconnected pad reads all-zero (also safe).
; ---------------------------------------------------------------------------
read_pad:
        lda PTRIG               ; strobe -> CB2 -> NMI -> ROM fills GAMEPAD1
        lda GAMEPAD1 + PAD_LEFT
        and GAMEPAD1 + PAD_RIGHT
        bne rp_done             ; both L+R held -> invalid, ignore this poll
        lda GAMEPAD1 + PAD_UP
        and GAMEPAD1 + PAD_DOWN
        bne rp_done             ; both U+D held -> invalid, ignore this poll
        ; ---- horizontal move with auto-shift (DAS) ------------------------
        ; X = held direction (0 none / 1 left / 2 right; L+R already rejected).
        ; A fresh press moves one cell and arms DAS_INIT; holding waits that
        ; delay then shifts every DAS_REP polls -- so a tap = one cell.
        ldx #0
        lda GAMEPAD1 + PAD_LEFT
        beq rp_ckr
        ldx #1
rp_ckr:
        lda GAMEPAD1 + PAD_RIGHT
        beq rp_hdir
        ldx #2
rp_hdir:
        cpx gpHDir
        bne rp_hnew             ; direction changed (release, press, or L<->R)
        cpx #0
        beq rp_down             ; still nothing held -> no horizontal move
        dec gpHDas
        bne rp_down             ; holding, but not time to auto-shift yet
        lda #DAS_REP
        sta gpHDas
        bra rp_hmove
rp_hnew:
        stx gpHDir              ; latch the new direction (may be 0 = released)
        cpx #0
        beq rp_down
        lda #DAS_INIT
        sta gpHDas              ; move once now, then hold DAS_INIT before repeat
rp_hmove:
        cpx #1
        bne rp_hright
        jsr rk_left
        bra rp_down
rp_hright:
        jsr rk_right
rp_down:
        lda GAMEPAD1 + PAD_DOWN
        beq rp_nd
        jsr gravity_step        ; soft drop
        lda gover
        bne rp_done             ; topped out during the soft drop
rp_nd:
        lda GAMEPAD1 + PAD_UP
        ora GAMEPAD1 + PAD_A
        ora GAMEPAD1 + PAD_B
        beq rp_rotup            ; no rotate button held -> release the latch
        lda gpRot
        bne rp_quitchk          ; still held -> do not auto-repeat rotation
        lda #1
        sta gpRot
        jsr rk_rot
        bra rp_quitchk
rp_rotup:
        stz gpRot
rp_quitchk:
        lda GAMEPAD1 + PAD_SEL
        bne rp_quit
rp_done:
        rts
rp_quit:
        jmp quit

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
        lda #GP_RATE            ; seed the pad-poll throttle for the wait loop
        sta gpPoll
go_wait:
        lda KBD                 ; keyboard is checked every spin (no NMI cost)
        bmi go_key
        dec gpPoll              ; only strobe PTRIG every GP_RATE spins so the NMI
        bne go_wait             ;   pad scan can't pin the CPU or hammer the latch
        lda #GP_RATE
        sta gpPoll
        lda PTRIG               ; refresh the pad (-> CB2 -> NMI -> ROM scan)
        lda GAMEPAD1 + PAD_LEFT
        and GAMEPAD1 + PAD_RIGHT
        bne go_wait             ; invalid combo (also the emulator) -> ignore pad
        lda GAMEPAD1 + PAD_UP
        and GAMEPAD1 + PAD_DOWN
        bne go_wait
        lda GAMEPAD1 + PAD_START
        bne go_restart          ; START = play again
        lda GAMEPAD1 + PAD_SEL
        bne quit                ; SELECT = quit
        bra go_wait
go_key:
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

msg_status: .byte "BLOCK DROP  SCORE:000 A/D W/S ROT Q +PAD", 0
msg_over:   .byte "**** GAME OVER ****", 0
msg_again:  .byte "SPACE = PLAY AGAIN     Q = QUIT", 0

