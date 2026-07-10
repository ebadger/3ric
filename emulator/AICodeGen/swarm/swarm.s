; ============================================================================
; STAR SWARM  -  an original "space-invaders-style" fixed shooter for the 3ric
;               (65C02, Apple-II compatible)
;
; Defend the ground line against a descending swarm of alien bugs: sweep a laser
; cannon left/right, fire up, and clear the formation before it lands.  The swarm
; marches side to side, drops a row and speeds up as its ranks thin, rains bombs,
; and hides behind crumbling bunkers while a mystery saucer streaks overhead.
; All sprite art, code and the name are original; only the un-copyrightable
; genre mechanics are shared with the classic.
;
; Built up in tested milestones.  M1 lays the sprite engine:
;   * mixed hi-res mode (280x160 sprite playfield + 4 text rows of HUD)
;   * 192-entry hi-res row-address table   (ROWL/ROWH at $6000/$6100)
;   * draw_sprite : XOR a bitmap sprite (H,W + rows of a 16-bit left-aligned
;     mask) onto the screen, clipped to the playfield, walking col/bit
;     incrementally so there is no per-pixel divide
;   * original sprite art (three alien ranks x2 frames, cannon, saucer, shots)
;   * BRK test hooks for the headless harness
;
; Build / run:
;   BRUN SWARM.PRG 0800      (loads the raw image to $0800 and jumps there)
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
WIDTH    = 280          ; sprite playfield width  (pixels, = 40 bytes)
HEIGHT   = 160          ; sprite playfield height (top 20 rows; rest is HUD)
NCOL     = 40           ; screen bytes per row (280/7)

; ---- zero page (only the (zp),y pointers live here) ----
ptr      = $06          ; screen dest pointer            (+1)
sprptr   = $08          ; sprite-data pointer            (+1)
objptr   = $0C          ; current object base pointer    (+1)

; ---- engine working vars (absolute RAM, clear of monitor + tables) ----
cx       = $6A00        ; plot x (16-bit signed)
cxh      = $6A01
cy       = $6A02        ; plot y
cyh      = $6A03
col      = $6A04        ; current byte column (x / 7)
bitn     = $6A05        ; current bit within the byte (x mod 7)
tt       = $6A06        ; seedcol scratch (16-bit)
tth      = $6A07
tmpa     = $6A08        ; build_rows scratch
tmpb     = $6A09
; --- draw_sprite locals ---
sx       = $6A0A        ; sprite top-left x (16-bit signed)
sxh      = $6A0B
sy       = $6A0C        ; sprite top-left y
shH      = $6A0D        ; sprite height
shW      = $6A0E        ; sprite width
col0     = $6A0F        ; byte column at x = sx (row start)
bitn0    = $6A10        ; bit at x = sx (row start)
srow     = $6A11        ; current sprite row 0..H-1
ry       = $6A12        ; screen row = sy + srow
rowvis   = $6A13        ; 1 = this row is on-screen
mrowh    = $6A14        ; current mask row (16-bit, shifted left per pixel)
mrowl    = $6A15

        .org $0800

; ---------------------------------------------------------------------------
; start : bring up video; the game loop arrives in later milestones.
; ---------------------------------------------------------------------------
start:
        sei
        cld
        ldx #$FF
        txs
        jsr video_init
hlt:
        jmp hlt

; ---------------------------------------------------------------------------
; video_init : select hi-res mixed mode, build the row table, clear the screen.
; ---------------------------------------------------------------------------
video_init:
        lda TXTCLR              ; graphics on
        lda MIXSET              ; mixed mode (text HUD at bottom)
        lda LOWSCR              ; page 1
        lda HIRES_SW            ; hi-res
        jsr build_rows
        jsr clear_screen
        rts

; ---------------------------------------------------------------------------
; draw_sprite : XOR the bitmap at (sprptr) onto the screen at (sx,sy).
;   sprptr -> H, W, then H rows of 2 bytes (16-bit mask, leftmost pixel=bit15).
;   Clips to the 280x160 playfield.  Advances sprptr past the sprite.
; ---------------------------------------------------------------------------
draw_sprite:
        ldy #0
        lda (sprptr),y
        sta shH
        iny
        lda (sprptr),y
        sta shW
        clc                     ; sprptr += 2  -> row 0 mask
        lda sprptr
        adc #2
        sta sprptr
        lda sprptr+1
        adc #0
        sta sprptr+1
        lda sx                  ; col0/bitn0 at x=sx (same for every row)
        sta cx
        lda sxh
        sta cxh
        jsr seedcol
        lda col
        sta col0
        lda bitn
        sta bitn0
        lda #0
        sta srow
ds_row:
        clc                     ; ry = sy + srow
        lda sy
        adc srow
        sta ry
        cmp #HEIGHT
        bcc ds_visible
        lda #0                  ; row is off the bottom: skip plotting it
        sta rowvis
        jmp ds_mask
ds_visible:
        ldy ry
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        lda #1
        sta rowvis
ds_mask:
        ldy #0
        lda (sprptr),y
        sta mrowh
        iny
        lda (sprptr),y
        sta mrowl
        lda col0                ; reset running col/bit to the row start
        sta col
        lda bitn0
        sta bitn
        ldx #0                  ; x = sprite column 0..W-1
ds_col:
        asl mrowl               ; 16-bit left shift: carry = next leftmost pixel
        rol mrowh
        bcc ds_next             ; pixel clear
        lda rowvis
        beq ds_next             ; row off-screen -> don't touch memory
        lda col
        bmi ds_next             ; col < 0  (off the left edge)
        cmp #NCOL
        bcs ds_next             ; col >= 40 (off the right edge)
        ldy bitn
        lda BITMASK,y
        ldy col
        eor (ptr),y
        sta (ptr),y
ds_next:
        inc bitn                ; step one pixel right
        lda bitn
        cmp #7
        bne ds_c2
        lda #0
        sta bitn
        inc col
ds_c2:
        inx
        cpx shW
        bne ds_col
        clc                     ; sprptr += 2 -> next row
        lda sprptr
        adc #2
        sta sprptr
        lda sprptr+1
        adc #0
        sta sprptr+1
        inc srow
        lda srow
        cmp shH
        beq ds_done
        jmp ds_row
ds_done:
        rts

; ---------------------------------------------------------------------------
; seedcol : from cx/cxh compute col = cx/7 and bitn = cx mod 7.
;   A +21 (=3 columns) bias lets small negative x (down to -21) divide cleanly;
;   the bias is removed from the quotient at the end.
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

; ==== generated sprites (spritegen.mjs) — original art ====
SPR_CANNON:
        .byte 8,15,1,0,3,128,3,128,31,240,127,252,255,254,255,254,255,254
SPR_A0:
        .byte 8,12,6,0,15,0,63,192,111,96,255,240,47,64,73,32,32,64
SPR_A1:
        .byte 8,12,6,0,15,0,63,192,111,96,255,240,47,64,64,32,144,144
SPR_B0:
        .byte 8,12,32,64,16,128,63,192,109,160,255,240,191,208,160,80,25,128
SPR_B1:
        .byte 8,12,32,64,144,144,191,208,222,208,255,240,127,224,32,64,64,32
SPR_C0:
        .byte 8,12,15,0,127,224,255,240,237,224,255,240,31,128,54,192,96,96
SPR_C1:
        .byte 8,12,15,0,127,224,255,240,237,224,255,240,47,64,95,160,160,80
SPR_UFO:
        .byte 7,16,7,224,31,248,63,252,127,254,255,255,109,182,24,24
SPR_SHOT:
        .byte 4,1,128,0,128,0,128,0,128,0
SPR_BOMB:
        .byte 5,3,64,0,192,0,64,0,96,0,64,0

; ---------------------------------------------------------------------------
; BRK test hooks (headless harness entry points)
; ---------------------------------------------------------------------------
build_brk:
        jsr build_rows
        brk
clear_brk:
        jsr clear_screen
        brk
sprite_brk:
        jsr draw_sprite
        brk
