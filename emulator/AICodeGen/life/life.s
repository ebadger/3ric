; ============================================================================
; Conway's Game of Life for the 3ric  (65C02, Apple-II compatible)
;
;   * Hi-res graphics, full screen, page 1 (280x192).
;   * Toroidal world (edges wrap) on a 40 x 48 cell grid.
;     Each cell is 7 px wide (one hi-res byte) x 4 px tall -> fills the screen.
;   * Runs the B3/S23 rules continuously, as fast as the CPU allows.
;   * Press SPACE to reseed the world with a fresh pseudo-random field.
;   * Press RESET to return to the monitor / BASIC.
;
; Build / run:
;   BRUN LIFE.PRG 0800     (loads the raw image to $0800 and jumps there)
; ============================================================================

; ---- soft switches (touched by reading them) ----
TXTCLR   = $C050        ; graphics (text off)
MIXCLR   = $C052        ; full screen (no split text window)
LOWSCR   = $C054        ; display page 1
HIRES_SW = $C057        ; hi-res
KBD      = $C000        ; keyboard data (bit7 = key ready)
KBDSTRB  = $C010        ; clear keyboard strobe

; ---- grid geometry ----
W        = 40           ; inner columns  (40 * 7  = 280 px)
H        = 48           ; inner rows     (48 * 4  = 192 px)
STRIDE   = 42           ; W + 2  (one halo column on each side)
ROWS     = 50           ; H + 2  (one halo row on top and bottom)
STRIDE2  = 84           ; STRIDE * 2
ROWH     = 2016         ; H * STRIDE       (byte offset of inner row H)
ROWHB    = 2058         ; (H+1) * STRIDE   (byte offset of halo row H+1)

; ---- generation buffers (padded with a 1-cell halo used for wrapping) ----
; One byte per cell: 0 = dead, 1 = alive.  Both live in the $4000-$5FFF
; hi-res page-2 region, which is free RAM here (only page 1 at $2000 is shown).
CUR0     = $4000        ; current generation
NXT0     = $5000        ; next generation

; ---- tables / scratch in RAM ----
CBASE_L  = $1000        ; 48 bytes: low byte  of the hi-res address of a cell row
CBASE_H  = $1030        ; 48 bytes: high byte of the hi-res address of a cell row
LINEBUF  = $1060        ; 40 bytes: one rendered cell row ($7F alive / $00 dead)

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
hp       = $15          ; render: hi-res dest ptr   (+1)
rp       = $17          ; row pointer               (+1)
sp       = $19          ; second row pointer        (+1)
src      = $1B          ; general source ptr        (+1)
dst      = $1D          ; general dest ptr          (+1)
tmp2     = $20
tmp3     = $21
tmp4     = $22

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
        lda HIRES_SW            ; hi-res
        lda #<SEED0
        sta seedL
        lda #>SEED0
        sta seedH
        jsr build_lines         ; hi-res base-address table
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
; build_lines : fill CBASE_L/H with the hi-res address of the top pixel row of
; each of the 48 cell rows.  Cell row r starts at pixel y = r*4; because 4
; divides 8, a cell's four pixel rows never cross an 8-line group boundary, so
; the other three rows are just +$400 each (handled in render).
;
;   high = $20 + (r&1 ? $10 : 0) + (ym >> 1)          , ym = (r>>1) & 7
;   low  =       (ym&1 ? $80 : 0) + (r>>4) * $28
; ---------------------------------------------------------------------------
build_lines:
        ldx #0
bl_loop:
        txa
        lsr a
        and #7
        sta tmp2                ; tmp2 = ym
        lsr a                   ; ym >> 1
        clc
        adc #$20
        sta tmp3                ; tmp3 = high (base part)
        txa
        and #1
        beq bl_even
        lda tmp3
        clc
        adc #$10
        sta tmp3
bl_even:
        lda #0
        sta tmp4                ; tmp4 = low
        lda tmp2
        and #1
        beq bl_nolo
        lda #$80
        sta tmp4
bl_nolo:
        txa
        lsr a
        lsr a
        lsr a
        lsr a                   ; r >> 4  (0,1,2)
        beq bl_store
        tay
        lda tmp4
bl_add28:
        clc
        adc #$28
        dey
        bne bl_add28
        sta tmp4
bl_store:
        lda tmp4
        sta CBASE_L,x
        lda tmp3
        sta CBASE_H,x
        inx
        cpx #H
        bne bl_loop
        rts

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
; render : draw curbase to the hi-res screen.  For each cell row, build a
; 40-byte pixel line then blast it to the cell's four pixel rows.
; ---------------------------------------------------------------------------
render:
        lda curbase
        clc
        adc #STRIDE+1           ; inner cell (1,1)
        sta rp
        lda curbase+1
        adc #0
        sta rp+1
        ldx #0                  ; cell row 0..47
rn_row:
        ldy #0
rn_build:
        lda (rp),y
        beq rn_dead
        lda #$7F
        jmp rn_put
rn_dead:
        lda #0
rn_put:
        sta LINEBUF,y
        iny
        cpy #W
        bne rn_build
        lda CBASE_L,x
        sta hp
        lda CBASE_H,x
        sta hp+1
        jsr blit_line           ; pixel row 0
        lda hp+1
        clc
        adc #4                  ; +$400
        sta hp+1
        jsr blit_line           ; pixel row 1
        lda hp+1
        clc
        adc #4
        sta hp+1
        jsr blit_line           ; pixel row 2
        lda hp+1
        clc
        adc #4
        sta hp+1
        jsr blit_line           ; pixel row 3
        lda rp
        clc
        adc #STRIDE
        sta rp
        lda rp+1
        adc #0
        sta rp+1
        inx
        cpx #H
        bne rn_row
        rts

blit_line:
        ldy #0
bl2:
        lda LINEBUF,y
        sta (hp),y
        iny
        cpy #W
        bne bl2
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
