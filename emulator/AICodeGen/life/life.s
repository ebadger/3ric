; ============================================================================
; Conway's Game of Life for the 3ric  (65C02, Apple-II compatible)
;
;   * Full-screen LO-RES colour graphics, page 1 (40 x 48 blocks).
;   * Toroidal world (edges wrap) on a 40 x 48 cell grid -- one lo-res block per
;     cell, so the world fills the screen and every edge wraps.
;   * Live cells are green, dead cells black.  Runs the B3/S23 rules
;     continuously, as fast as the CPU allows.
;   * Press SPACE to reseed the world with a fresh pseudo-random field.
;   * Press RESET to return to the monitor / BASIC.
;
; Lo-res page 1 shares the text page ($0400-$07FF): each byte holds two stacked
; cells -- the low nibble is the upper cell, the high nibble the lower one -- so
; a lo-res row R maps to text row R/2 (`TROWL/TROWH[R>>1]`), low nibble when R is
; even, high nibble when R is odd.  A full-screen (non-mixed) field is therefore
; 24 text rows x 2 = 48 cells tall.  The simulation is unchanged from the hi-res
; version; only the render stage and the mode setup differ.
;
; Build / run:
;   node codegen/tools/asm6502.mjs emulator/AICodeGen/life/life.s \
;        emulator/AICodeGen/life/life.prg --org 0x0800
;   BRUN LIFE.PRG 0800     (loads the raw image to $0800 and jumps there)
; ============================================================================

; ---- soft switches (touched by reading them) ----
TXTCLR   = $C050        ; graphics (text off)
MIXCLR   = $C052        ; full screen (no split text window)
LOWSCR   = $C054        ; display page 1
LORES    = $C056        ; lo-res graphics
KBD      = $C000        ; keyboard data (bit7 = key ready)
KBDSTRB  = $C010        ; clear keyboard strobe

; ---- lo-res colours (index into the 16-entry palette) ----
BLACK    = 0            ; dead cell
GREEN    = $0C          ; live cell (palette 12) in the low (upper-pixel) nibble
GREENHI  = $C0          ; live cell (palette 12) in the high (lower-pixel) nibble

; ---- grid geometry (lo-res field: 40 cols x 48 rows, full screen) ----
W        = 40           ; inner columns  (40 lo-res cells wide)
H        = 48           ; inner rows     (48 lo-res cells tall)
TROWS    = 24           ; text rows on screen (H / 2; two cells packed per byte)
STRIDE   = 42           ; W + 2  (one halo column on each side)
ROWS     = 50           ; H + 2  (one halo row on top and bottom)
STRIDE2  = 84           ; STRIDE * 2
ROWH     = 2016         ; H * STRIDE       (byte offset of inner row H)
ROWHB    = 2058         ; (H+1) * STRIDE   (byte offset of halo row H+1)

; ---- generation buffers (padded with a 1-cell halo used for wrapping) ----
; One byte per cell: 0 = dead, 1 = alive.  Both live in the $4000-$5FFF free RAM
; region; the lo-res display shares the text page at $0400-$07FF, so there is no
; conflict with the buffers or with the program at $0800.
CUR0     = $4000        ; current generation
NXT0     = $5000        ; next generation

; ---- zero page ----
seedL    = $06
seedH    = $07
pA       = $08          ; step: row above          (+1)
pC       = $0A          ; step: current row         (+1)
pB       = $0C          ; step: row below           (+1)
pN       = $0E          ; step: next-gen row        (+1)
cnt      = $10          ; neighbour count
curbase  = $11          ; -> current buffer         (+1)
nxtbase  = $13          ; -> next buffer            (+1)
hp       = $15          ; render: lo-res dest ptr   (+1)
rp       = $17          ; render: top cell-row ptr  (+1)
sp       = $19          ; render: bottom cell-row ptr (+1)
dst      = $1D          ; general dest ptr          (+1)
tmp2     = $20          ; render: packed low-nibble scratch

SEED0    = $ACE1        ; initial LFSR state (must be non-zero)

        .org $0800

; ---------------------------------------------------------------------------
; entry point
; ---------------------------------------------------------------------------
start:
        sei
        cld
        ldx #$FF
        txs
        lda TXTCLR              ; graphics on
        lda MIXCLR              ; full screen
        lda LOWSCR              ; page 1
        lda LORES               ; lo-res
        lda #<SEED0
        sta seedL
        lda #>SEED0
        sta seedH
        lda #<CUR0
        sta curbase
        lda #>CUR0
        sta curbase+1
        lda #<NXT0
        sta nxtbase
        lda #>NXT0
        sta nxtbase+1
        jsr clear_bufs
        jsr seed_field

main:
        jsr render
        jsr check_key
        cmp #1
        beq main                ; just reseeded -> redraw the fresh field
        jsr wrap_halo
        jsr step
        jsr swap_buf
        jmp main

; ---------------------------------------------------------------------------
; clear_bufs : zero the whole $4000-$5FFF range (both buffers + halo).
; ---------------------------------------------------------------------------
clear_bufs:
        lda #0
        ldx #$40
cb_page:
        stx dst+1
        sta dst
        ldy #0
cb_byte:
        sta (dst),y
        iny
        bne cb_byte
        inx
        cpx #$60
        bne cb_page
        rts

; ---------------------------------------------------------------------------
; seed_field : fill the inner cells of curbase with random 0/1 (~50% alive).
; ---------------------------------------------------------------------------
seed_field:
        lda curbase
        clc
        adc #STRIDE
        sta rp
        lda curbase+1
        adc #0
        sta rp+1
        ldx #H
sf_row:
        ldy #1
sf_col:
        jsr rng
        lda seedL
        and #1
        sta (rp),y
        iny
        cpy #W+1
        bne sf_col
        lda rp
        clc
        adc #STRIDE
        sta rp
        lda rp+1
        adc #0
        sta rp+1
        dex
        bne sf_row
        rts

; ---------------------------------------------------------------------------
; rng : 16-bit Galois LFSR (taps $B400, period 65535).  Advances the state;
; the caller uses bit 0 of seedL as the next random bit.
; ---------------------------------------------------------------------------
rng:
        lsr seedH
        ror seedL
        bcc rng_done
        lda seedH
        eor #$B4
        sta seedH
rng_done:
        rts

; ---------------------------------------------------------------------------
; wrap_halo : copy edge cells of curbase into the halo so the world wraps.
;   row 0  <- inner row H   ,  row H+1 <- inner row 1     (inner columns)
;   col 0  <- inner col W   ,  col W+1 <- inner col 1      (all rows)
; ---------------------------------------------------------------------------
wrap_halo:
        ; row 0 <- inner row H
        lda curbase
        clc
        adc #<ROWH             ; row H offset
        sta rp
        lda curbase+1
        adc #>ROWH
        sta rp+1
        lda curbase
        sta sp                  ; row 0
        lda curbase+1
        sta sp+1
        ldy #1
wh_top:
        lda (rp),y
        sta (sp),y
        iny
        cpy #W+1
        bne wh_top
        ; row H+1 <- inner row 1
        lda curbase
        clc
        adc #STRIDE             ; row 1
        sta rp
        lda curbase+1
        adc #0
        sta rp+1
        lda curbase
        clc
        adc #<ROWHB            ; row H+1
        sta sp
        lda curbase+1
        adc #>ROWHB
        sta sp+1
        ldy #1
wh_bot:
        lda (rp),y
        sta (sp),y
        iny
        cpy #W+1
        bne wh_bot
        ; columns for every row
        lda curbase
        sta rp
        lda curbase+1
        sta rp+1
        ldx #ROWS
wh_col:
        ldy #W
        lda (rp),y              ; inner col W
        ldy #0
        sta (rp),y              ; -> col 0
        ldy #1
        lda (rp),y              ; inner col 1
        ldy #W+1
        sta (rp),y              ; -> col W+1
        lda rp
        clc
        adc #STRIDE
        sta rp
        lda rp+1
        adc #0
        sta rp+1
        dex
        bne wh_col
        rts

; ---------------------------------------------------------------------------
; step : compute nxtbase from curbase using the B3/S23 rules.
; pA/pB/pC point at the row above/below/current; pN at the next-gen row.
; ---------------------------------------------------------------------------
step:
        lda curbase
        sta pA
        lda curbase+1
        sta pA+1
        lda curbase
        clc
        adc #STRIDE
        sta pC
        lda curbase+1
        adc #0
        sta pC+1
        lda curbase
        clc
        adc #STRIDE2
        sta pB
        lda curbase+1
        adc #0
        sta pB+1
        lda nxtbase
        clc
        adc #STRIDE
        sta pN
        lda nxtbase+1
        adc #0
        sta pN+1
        ldx #H
st_row:
        ldy #1
st_col:
        clc
        dey                     ; c-1
        lda (pA),y
        adc (pB),y
        sta cnt
        lda (pC),y
        adc cnt
        sta cnt
        iny                     ; c
        lda (pA),y
        adc cnt
        sta cnt
        lda (pB),y
        adc cnt
        sta cnt
        iny                     ; c+1
        lda (pA),y
        adc cnt
        sta cnt
        lda (pB),y
        adc cnt
        sta cnt
        lda (pC),y
        adc cnt
        sta cnt
        dey                     ; back to c
        lda cnt
        cmp #3
        beq st_alive
        cmp #2
        bne st_dead
        lda (pC),y              ; survives only if currently alive
        bne st_alive
st_dead:
        lda #0
        sta (pN),y
        jmp st_next
st_alive:
        lda #1
        sta (pN),y
st_next:
        iny
        cpy #W+1
        bne st_col
        lda pA
        clc
        adc #STRIDE
        sta pA
        lda pA+1
        adc #0
        sta pA+1
        lda pC
        clc
        adc #STRIDE
        sta pC
        lda pC+1
        adc #0
        sta pC+1
        lda pB
        clc
        adc #STRIDE
        sta pB
        lda pB+1
        adc #0
        sta pB+1
        lda pN
        clc
        adc #STRIDE
        sta pN
        lda pN+1
        adc #0
        sta pN+1
        dex
        beq st_ret
        jmp st_row
st_ret:
        rts

; ---------------------------------------------------------------------------
; render : draw curbase to the full-screen lo-res page ($0400-$07FF).  Each
; lo-res byte packs two vertically-adjacent cells: the low nibble is the upper
; cell (even grid row 2R), the high nibble the lower cell (odd grid row 2R+1).
; For each of the 24 text rows R, walk 40 columns writing one packed byte
; (green for a live cell, black for a dead one).
; ---------------------------------------------------------------------------
render:
        lda curbase
        clc
        adc #STRIDE+1           ; rp -> inner cell (1,1) = grid (0,0)
        sta rp
        lda curbase+1
        adc #0
        sta rp+1
        ldx #0                  ; X = text row R (0..23)
rn_row:
        lda rp                  ; sp -> bottom cell row (grid row 2R+1)
        clc
        adc #STRIDE
        sta sp
        lda rp+1
        adc #0
        sta sp+1
        lda TROWL,x             ; hp -> $0400 + text-row base
        sta hp
        lda TROWH,x
        sta hp+1
        ldy #0                  ; Y = column 0..39
rn_col:
        lda (rp),y              ; upper cell (0 = dead / 1 = alive)
        beq rn_top0
        lda #GREEN              ; alive -> low nibble = $0C
rn_top0:
        sta tmp2                ; dead leaves A=0 -> low nibble = 0
        lda (sp),y              ; lower cell (0 = dead / 1 = alive)
        beq rn_bot0
        lda #GREENHI            ; alive -> high nibble = $C0
rn_bot0:
        ora tmp2                ; combine high | low
        sta (hp),y
        iny
        cpy #W                  ; 40 columns
        bne rn_col
        lda rp                  ; advance to next text row's top cell (+2 grid rows)
        clc
        adc #STRIDE2
        sta rp
        lda rp+1
        adc #0
        sta rp+1
        inx
        cpx #TROWS              ; 24 text rows
        bne rn_row
        rts

; ---------------------------------------------------------------------------
; check_key : if SPACE is pressed, reseed and return A=1; otherwise A=0.
; ---------------------------------------------------------------------------
check_key:
        lda KBD
        bpl ck_none
        and #$7F
        cmp #$20
        bne ck_other
        sta KBDSTRB
        jsr seed_field
        lda #1
        rts
ck_other:
        sta KBDSTRB
ck_none:
        lda #0
        rts

; ---------------------------------------------------------------------------
; swap_buf : exchange curbase and nxtbase.
; ---------------------------------------------------------------------------
swap_buf:
        ldx curbase
        lda nxtbase
        sta curbase
        stx nxtbase
        ldx curbase+1
        lda nxtbase+1
        sta curbase+1
        stx nxtbase+1
        rts

; ---------------------------------------------------------------------------
; test hooks : the headless harness pokes buffer/ZP state, sets PC here, and
; runs to the BRK (which the monitor turns into a register dump = halt).
; ---------------------------------------------------------------------------
onestep_brk:
        ldx #$FF
        txs
        jsr wrap_halo
        jsr step
        brk

seed_brk:
        ldx #$FF
        txs
        jsr seed_field
        brk

; render_wai renders the current buffer, then WAIs.  Unlike a BRK hook this never
; drops into the monitor, so its register dump can't scribble on the text/lo-res
; page -- the harness can decode $0400-$07FF exactly as rendered.
render_wai:
        ldx #$FF
        txs
        jsr render
        wai

; ---------------------------------------------------------------------------
; data : absolute base address of each of the 24 text rows in the lo-res/text
; page ($0400 + the interleaved scanline offset).  render indexes these by text
; row R; the two lo-res cells stacked in that row are the low (upper) and high
; (lower) nibble of each byte.
; ---------------------------------------------------------------------------
TROWL:  .byte $00,$80,$00,$80,$00,$80,$00,$80,$28,$A8,$28,$A8
        .byte $28,$A8,$28,$A8,$50,$D0,$50,$D0,$50,$D0,$50,$D0
TROWH:  .byte $04,$04,$05,$05,$06,$06,$07,$07,$04,$04,$05,$05
        .byte $06,$06,$07,$07,$04,$04,$05,$05,$06,$06,$07,$07
