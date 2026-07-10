; ============================================================================
; ROCK STORM  -  an original vector "asteroids-style" shooter for the 3ric
;               (65C02, Apple-II compatible)
;
; An original take on the classic rock-blasting genre: rotate a vector ship,
; thrust with inertia, fire shots, and blast drifting rocks that split into
; smaller rocks.  Everything wraps at the screen edges.  All polygon art, code
; and the name are original.
;
; Built up in tested milestones.  M1 lays the vector engine:
;   * mixed hi-res mode (280x160 vector playfield + 4 text rows of HUD)
;   * 192-entry hi-res row-address table   (ROWL/ROWH at $6000/$6100)
;   * XOR line draw (Bresenham) that tracks byte-col/bit incrementally (so
;     there is no per-pixel divide) and clips to the playfield
;   * draw_poly : XOR a closed ring of vertices  (ship + rocks share it)
;   * precomputed geometry (ship silhouette at 32 angles, headings, rocks)
;   * BRK test hooks for the headless harness
;
; Build / run:
;   BRUN ROCKS.PRG 0800      (loads the raw image to $0800 and jumps there)
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
WIDTH    = 280          ; vector playfield width  (pixels)
HEIGHT   = 160          ; vector playfield height (top 20 rows; rest is HUD)
NANG     = 32           ; ship rotation steps (11.25 deg each)

; ---- zero page ----
; ONLY the indirect pointers live in zero page (required for (zp),y).  Every
; other working var is ABSOLUTE RAM (VARS block below).  This is deliberate:
; the Apple II monitor owns zero page $20-$4F (text window/cursor $20-$25,
; BASL/BASH $28/$29, INVFLG $32, the COUT vector CSW $36/$37, the RDKEY vector
; KSW $38/$39, the BRK register-save $45-$49, ...).  If our scratch trampled
; those, returning to the monitor (our BRK test hooks, or a reset on real
; hardware) would jump COUT/RDKEY through a corrupted vector and hang.  The
; pointer pairs $06-$0D are in the classic free-scratch zone the monitor leaves
; alone.
ptr      = $06          ; screen dest pointer            (+1)
vpx      = $08          ; vertex X-offset table pointer  (+1)
vpy      = $0A          ; vertex Y-offset table pointer  (+1)
objptr   = $0C          ; current object base pointer    (+1)

; ---- engine working vars (absolute RAM, clear of monitor + tables) ----
; --- line() endpoints (16-bit signed) ---
x0       = $6A00
x0h      = $6A01
y0       = $6A02
y0h      = $6A03
x1       = $6A04
x1h      = $6A05
y1       = $6A06
y1h      = $6A07
; --- line() working state ---
dx       = $6A08
dxh      = $6A09
dy       = $6A0A
dyh      = $6A0B
lerr     = $6A0C
lerrh    = $6A0D
e2       = $6A0E
e2h      = $6A0F
s1       = $6A10
s1h      = $6A11
s2       = $6A12
s2h      = $6A13
sxs      = $6A14          ; x step sign (+1 / -1)
sys      = $6A15          ; y step sign
cx       = $6A16          ; current x (16-bit signed)
cxh      = $6A17
cy       = $6A18          ; current y (16-bit signed)
cyh      = $6A19
col      = $6A1A          ; current byte column (signed)
bitn     = $6A1B          ; current bit in byte (0..6)
tt       = $6A1C          ; div7 scratch (16-bit)
tth      = $6A1D
; --- draw_poly scratch ---
cenx     = $6A1E          ; polygon centre x (16-bit signed)
cenh     = $6A1F
ceny     = $6A20          ; polygon centre y (0..159)
fx       = $6A21          ; first vertex (to close the ring)
fxh      = $6A22
fy       = $6A23
fyh      = $6A24
pxv      = $6A25          ; previous vertex
pxvh     = $6A26
pyv      = $6A27
pyvh     = $6A28
vcount   = $6A29          ; vertices in this polygon
vi       = $6A2A          ; vertex loop index
tvx      = $6A2B          ; calc_vert output vertex (16-bit signed)
tvxh     = $6A2C
tvy      = $6A2D
tvyh     = $6A2E
tmpa     = $6A2F
tmpb     = $6A30
noend    = $6A31          ; 1 = half-open line (skip final endpoint pixel)
m1idx    = $6A40          ; M1 demo fan loop counter (engine never touches it)

        .org $0800

; ---------------------------------------------------------------------------
; entry (M1: draw a fan of ships at increasing angle to eyeball the engine)
; ---------------------------------------------------------------------------
start:
        sei
        cld
        ldx #$FF
        txs
        lda TXTCLR              ; graphics on
        lda MIXSET              ; mixed mode (text HUD at bottom)
        lda LOWSCR              ; page 1
        lda HIRES_SW            ; hi-res
        jsr build_rows
        jsr clear_screen
        ldx #0
m1_loop:
        stx m1idx               ; i
        txa
        asl a
        asl a
        asl a
        asl a
        asl a                   ; i*32
        clc
        adc #24
        sta cenx
        lda #0
        sta cenh
        lda #40
        sta ceny
        lda m1idx
        asl a
        asl a                   ; angle = i*4
        jsr set_ship_vp
        jsr draw_poly
        ldx m1idx
        inx
        cpx #8
        bne m1_loop
m1_halt:
        jmp m1_halt

; ---------------------------------------------------------------------------
; set_ship_vp : point vpx/vpy at the ship silhouette for angle A (0..31),
;               vcount = 4.
; ---------------------------------------------------------------------------
set_ship_vp:
        and #(NANG-1)
        asl a
        asl a                   ; angle*4 (4 verts per angle)
        sta tmpa
        clc
        lda #<SHPX
        adc tmpa
        sta vpx
        lda #>SHPX
        adc #0
        sta vpx+1
        clc
        lda #<SHPY
        adc tmpa
        sta vpy
        lda #>SHPY
        adc #0
        sta vpy+1
        lda #4
        sta vcount
        rts

; ---------------------------------------------------------------------------
; draw_poly : XOR a closed ring of vcount vertices.
;   inputs: cenx/cenh (centre x, 16-bit signed), ceny (centre y 0..159),
;           vpx/vpy -> signed byte offset tables, vcount = vertex count.
; ---------------------------------------------------------------------------
draw_poly:
        ldy #0
        jsr calc_vert           ; vertex 0
        lda tvx
        sta fx
        sta pxv
        lda tvxh
        sta fxh
        sta pxvh
        lda tvy
        sta fy
        sta pyv
        lda tvyh
        sta fyh
        sta pyvh
        lda #1
        sta vi
dp_loop:
        lda vi
        cmp vcount
        bcs dp_close
        ldy vi
        jsr calc_vert           ; next vertex -> tvx/tvy
        ; line pxv/pyv -> tvx/tvy
        lda pxv
        sta x0
        lda pxvh
        sta x0h
        lda pyv
        sta y0
        lda pyvh
        sta y0h
        lda tvx
        sta x1
        lda tvxh
        sta x1h
        lda tvy
        sta y1
        lda tvyh
        sta y1h
        jsr line_open
        lda tvx
        sta pxv
        lda tvxh
        sta pxvh
        lda tvy
        sta pyv
        lda tvyh
        sta pyvh
        inc vi
        bne dp_loop
dp_close:
        ; final edge: pxv/pyv -> fx/fy
        lda pxv
        sta x0
        lda pxvh
        sta x0h
        lda pyv
        sta y0
        lda pyvh
        sta y0h
        lda fx
        sta x1
        lda fxh
        sta x1h
        lda fy
        sta y1
        lda fyh
        sta y1h
        jsr line_open
        rts

; ---------------------------------------------------------------------------
; calc_vert : screen vertex Y (index) -> tvx/tvy (16-bit signed).
;   tvx = cenx + sext(vpx[Y]) ,  tvy = ceny + sext(vpy[Y])
; ---------------------------------------------------------------------------
calc_vert:
        lda (vpx),y
        sta tmpa                ; offx
        lda (vpy),y
        sta tmpb                ; offy
        ; tvx = cenx + sext(offx)
        clc
        lda tmpa
        adc cenx
        sta tvx
        lda tmpa
        and #$80
        beq cv_xp
        lda #$FF
        bne cv_xhi
cv_xp:
        lda #0
cv_xhi:
        adc cenh
        sta tvxh
        ; tvy = ceny + sext(offy)   (ceny hi = 0)
        clc
        lda tmpb
        adc ceny
        sta tvy
        lda tmpb
        and #$80
        beq cv_yp
        lda #$FF
        bne cv_yhi
cv_yp:
        lda #0
cv_yhi:
        adc #0
        sta tvyh
        rts

; ---------------------------------------------------------------------------
; line : XOR a line from (x0,y0) to (x1,y1) (16-bit signed), clipped to the
;        280x160 playfield.  Tracks byte-col/bit incrementally (one div7 at
;        the start vertex only).
;   line       plots both endpoints (a normal segment).
;   line_open  plots [start,end) : the final endpoint pixel is skipped, so a
;              closed polygon drawn edge-by-edge plots every shared vertex
;              exactly once (XOR-safe: no vertex cancels itself out).
; ---------------------------------------------------------------------------
line_open:
        lda #1
        sta noend
        bne line_body           ; always taken
line:
        lda #0
        sta noend
line_body:
        ; dx = x1-x0 ; sx = +1 (or negate & -1)
        sec
        lda x1
        sbc x0
        sta dx
        lda x1h
        sbc x0h
        sta dxh
        lda #1
        sta sxs
        lda dxh
        bpl l_dxpos
        sec
        lda #0
        sbc dx
        sta dx
        lda #0
        sbc dxh
        sta dxh
        lda #$FF
        sta sxs
l_dxpos:
        ; dy = y1-y0 ; sy = +1 (or negate & -1)
        sec
        lda y1
        sbc y0
        sta dy
        lda y1h
        sbc y0h
        sta dyh
        lda #1
        sta sys
        lda dyh
        bpl l_dypos
        sec
        lda #0
        sbc dy
        sta dy
        lda #0
        sbc dyh
        sta dyh
        lda #$FF
        sta sys
l_dypos:
        ; lerr = dx - dy  (16-bit signed)
        sec
        lda dx
        sbc dy
        sta lerr
        lda dxh
        sbc dyh
        sta lerrh
        ; cx = x0, cy = y0
        lda x0
        sta cx
        lda x0h
        sta cxh
        lda y0
        sta cy
        lda y0h
        sta cyh
        jsr seedcol
l_loop:
        ; at the endpoint?
        lda cx
        cmp x1
        bne l_plot
        lda cxh
        cmp x1h
        bne l_plot
        lda cy
        cmp y1
        bne l_plot
        lda cyh
        cmp y1h
        bne l_plot
        ; reached endpoint: plot it only for a normal (closed) segment
        lda noend
        bne l_ret
        jsr plotcur
l_ret:
        rts
l_plot:
        jsr plotcur
l_step:
        ; e2 = lerr * 2
        lda lerr
        sta e2
        lda lerrh
        sta e2h
        asl e2
        rol e2h
        ; d1: s1 = e2 + dy ; if s1 > 0 -> lerr -= dy ; step x
        clc
        lda e2
        adc dy
        sta s1
        lda e2h
        adc dyh
        sta s1h
        lda s1h
        bmi l_d2                ; s1 < 0 -> skip
        ora s1
        beq l_d2                ; s1 == 0 -> skip (need strictly > 0)
        sec
        lda lerr
        sbc dy
        sta lerr
        lda lerrh
        sbc dyh
        sta lerrh
        jsr stepx
l_d2:
        ; d2: s2 = e2 - dx ; if s2 < 0 -> lerr += dx ; step y
        sec
        lda e2
        sbc dx
        sta s2
        lda e2h
        sbc dxh
        sta s2h
        lda s2h
        bmi l_stepy             ; s2 < 0 -> do the y step
        jmp l_loop              ; s2 >= 0 -> skip (abs jmp, always in range)
l_stepy:
        clc
        lda lerr
        adc dx
        sta lerr
        lda lerrh
        adc dxh
        sta lerrh
        jsr stepy
        jmp l_loop

; step current x by sxs (+/-1), maintaining col/bitn
stepx:
        lda sxs
        bmi sx_neg
        inc cx
        bne sx_p1
        inc cxh
sx_p1:
        ldx bitn
        inx
        cpx #7
        bne sx_p2
        inc col
        ldx #0
sx_p2:
        stx bitn
        rts
sx_neg:
        lda cx
        bne sx_n1
        dec cxh
sx_n1:
        dec cx
        ldx bitn
        bne sx_n2
        dec col
        ldx #7
sx_n2:
        dex
        stx bitn
        rts

; step current y by sys (+/-1)
stepy:
        lda sys
        bmi sy_neg
        inc cy
        bne sy_p1
        inc cyh
sy_p1:
        rts
sy_neg:
        lda cy
        bne sy_n1
        dec cyh
sy_n1:
        dec cy
        rts

; ---------------------------------------------------------------------------
; seedcol : from cx (16-bit signed, >= -21) compute col = cx/7, bitn = cx%7.
;   Uses a +21 bias so the divide runs on a non-negative value.
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
; plotcur : XOR the pixel at (cx,cy) if inside the 280x160 playfield.
; ---------------------------------------------------------------------------
plotcur:
        lda cxh
        bmi pc_skip             ; cx < 0
        beq pc_xlo              ; cxh == 0 -> cx in 0..255 (< 280) ok
        cmp #1
        bne pc_skip             ; cxh >= 2 -> cx >= 512
        lda cx
        cmp #24
        bcs pc_skip             ; cxh==1 & cxlo>=24 -> cx>=280
pc_xlo:
        lda cyh
        bmi pc_skip             ; cy < 0
        bne pc_skip             ; cy >= 256
        lda cy
        cmp #HEIGHT
        bcs pc_skip             ; cy >= 160
        ; plot at (col,bitn,cy)
        ldy cy
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        ldx bitn
        lda BITMASK,x
        ldy col
        eor (ptr),y
        sta (ptr),y
pc_skip:
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

; ==== generated geometry (files/rockgen.mjs) — original shapes ====
; NANG=32, ship verts=4, rock shapes=3, sizes=5/10/17
SHPX:
        .byte 7,251,254,251,7,252,254,250,6,253,254,250,6,254,254,250,5,255,255,250,4,1,255,250,3,2,255,250,1,3,0,251,0,4,0,252,255,5,0,253,253,6,1,254,252,6,1,255,251,6,1,1,250,6,2,2,250,6,2,3,249,6,2,4,249,5,2,5,249,4,2,6,250,3,2,6,250,2,2,6,251,1,1,6,252,255,1,6,253,254,1,6,255,253,0,5,0,252,0,4,1,251,0,3,3,250,255,2,4,250,255,1,5,250,255,255,6,250,254,254,6,250,254,253,7,250,254,252
SHPY:
        .byte 0,252,0,4,1,251,0,3,3,250,255,2,4,250,255,1,5,250,255,255,6,250,254,254,6,250,254,253,7,250,254,252,7,251,254,251,7,252,254,250,6,253,254,250,6,254,254,250,5,255,255,250,4,1,255,250,3,2,255,250,1,3,0,251,0,4,0,252,255,5,0,253,253,6,1,254,252,6,1,255,251,6,1,1,250,6,2,2,250,6,2,3,249,6,2,4,249,5,2,5,249,4,2,6,250,3,2,6,250,2,2,6,251,1,1,6,252,255,1,6,253,254,1,6,255,253,0,5
NOSEX:
        .byte 7,7,6,6,5,4,3,1,0,255,253,252,251,250,250,249,249,249,250,250,251,252,253,255,0,1,3,4,5,6,6,7
NOSEY:
        .byte 0,1,3,4,5,6,6,7,7,7,6,6,5,4,3,1,0,255,253,252,251,250,250,249,249,249,250,250,251,252,253,255
ACCX:
        .byte 14,14,13,12,10,8,5,3,0,253,251,248,246,244,243,242,242,242,243,244,246,248,251,253,0,3,5,8,10,12,13,14
ACCY:
        .byte 0,3,5,8,10,12,13,14,14,14,13,12,10,8,5,3,0,253,251,248,246,244,243,242,242,242,243,244,246,248,251,253
BVXL:
        .byte 51,31,225,126,248,85,155,210,0,46,101,171,8,130,31,225,205,225,31,130,8,171,101,46,0,210,155,85,248,126,225,31
BVXH:
        .byte 4,4,3,3,2,2,1,0,0,255,254,253,253,252,252,251,251,251,252,252,253,253,254,255,0,0,1,2,2,3,3,4
BVYL:
        .byte 0,210,155,85,248,126,225,31,51,31,225,126,248,85,155,210,0,46,101,171,8,130,31,225,205,225,31,130,8,171,101,46
BVYH:
        .byte 0,0,1,2,2,3,3,4,4,4,3,3,2,2,1,0,0,255,254,253,253,252,252,251,251,251,252,252,253,253,254,255
ROCKX:
        .byte 5,2,0,253,251,254,0,3,10,5,0,251,246,251,0,6,17,8,0,247,239,248,0,10,4,3,255,252,252,253,1,4,8,6,255,248,248,250,1,8,13,10,254,242,242,246,2,14,5,2,255,252,251,254,1,3,10,4,254,248,246,253,3,6,16,7,253,242,240,250,5,11
ROCKY:
        .byte 0,2,5,3,0,254,251,253,0,5,10,5,0,251,247,250,0,8,17,9,0,248,240,246,1,4,4,3,255,252,253,253,1,8,7,6,255,248,249,250,2,14,12,10,254,242,244,246,1,4,3,2,255,253,252,254,3,8,6,4,253,249,247,253,5,13,11,7,251,245,241,250

; ---------------------------------------------------------------------------
; test hooks : harness pokes state, sets PC here, runs to BRK (monitor dump).
; ---------------------------------------------------------------------------
build_brk:
        ldx #$FF
        txs
        jsr build_rows
        brk

clear_brk:
        ldx #$FF
        txs
        jsr clear_screen
        brk

line_brk:
        ldx #$FF
        txs
        jsr line
        brk

; test pokes cenx/cenh/ceny and STATE(angle), runs; draws one ship
polyship_brk:
        ldx #$FF
        txs
        lda STATE
        jsr set_ship_vp
        jsr draw_poly
        brk
