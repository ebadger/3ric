; Matrix Rain - falling code for the 3ric / 6502.
; Run at native 1x speed. Space pauses/resumes; Q or Esc returns to the monitor.
; https://ebadger.github.io/3ric/?src=programs/matrix.s
;
; Each hi-res byte is one column of a 3x5 glyph in a 7x6-pixel cell.
; Alternating pixel parity keeps both even and odd columns artifact-green;
; paired pixels make white heads, and checkerboard pixels dim the tails.
; Only the head, previous head, fading cell, and departing tail are redrawn.
;
; Load / entry: $0800. Image stays below $2000; video uses $2000-$3FFF.
; Glyph history: $6000-$64FF (40 columns x 32 rows).
; Hi-res scanline tables: $6500-$65BF / $6600-$66BF.
; Assemble: node codegen/tools/asm6502.mjs codegen/programs/matrix.s matrix.prg

        .org $0800

KBD          = $C000
KBDSTRB      = $C010
GRAPHICS     = $C050
TEXT         = $C051
FULLSCREEN   = $C052
DISPLAY1     = $C054
LORES        = $C056
HIRES        = $C057
HOME         = $FC58

COLUMN_COUNT = 40
ROW_COUNT    = 32
ERASE_SHADE  = 0
DIM_SHADE    = 1
GREEN_SHADE  = 2
HEAD_SHADE   = 3
GLYPHS       = $6000
ROWL         = $6500
ROWH         = $6600

seedlo       = $06
seedhi       = $07
screenptr    = $08
charptr      = $0A
fontptr      = $0C
column       = $0E
shade        = $0F
cellrow      = $10
scanrow      = $11
glyphline    = $12
drawbits     = $13
coloroffset  = $14
rowtmpa      = $15
rowtmpb      = $16
paintrow     = $17
paused       = $18

start:
        sei
        cld
        ldx #$FF
        txs
        bit KBDSTRB
        lda #$E1
        sta seedlo
        lda #$AC
        sta seedhi
        lda #0
        sta paused
        sta column
        jsr build_rows
        jsr clear_hgr

; Seed complete, staggered trails so the first frame is already raining.
init_column:
        jsr set_column
        ldx column
        jsr new_stream
        jsr rng
        and #31
        clc
        adc #1
        sta heads,x             ; next row to receive a head, not the current head
        lda periods,x
        sta ticks,x
        lda heads,x
        sec
        sbc lengths,x
        bcs init_first_row
        lda #0
init_first_row:
        sta paintrow
init_glyph:
        lda #GREEN_SHADE
        sta shade
        lda heads,x
        sec
        sbc paintrow
        cmp #1
        beq init_head
        clc
        adc #1
        cmp lengths,x
        bcc init_draw
        lda #DIM_SHADE
        sta shade
        jmp init_draw
init_head:
        lda #HEAD_SHADE
        sta shade
init_draw:
        lda paintrow
        jsr new_glyph
        inc paintrow
        ldx column
        lda paintrow
        cmp heads,x
        bcc init_glyph
        inc column
        lda column
        cmp #COLUMN_COUNT
        bcc init_column

        bit FULLSCREEN
        bit DISPLAY1
        bit HIRES
        bit GRAPHICS
main:
        jsr check_key
        lda paused
        bne frame_wait
        jsr step_rain
frame_wait:
        jsr pace
        jmp main

check_key:
        lda KBD
        bpl key_done
        bit KBDSTRB
        and #$7F
        cmp #$20
        bne key_quit
        lda paused
        eor #1
        sta paused
key_done:
        rts
key_quit:
        cmp #'Q'
        beq quit
        cmp #$1B
        beq quit
        rts
quit:
        bit TEXT
        bit FULLSCREEN
        bit DISPLAY1
        bit LORES
        jsr HOME
        cli
        brk

step_rain:
        lda #0
        sta column
step_column:
        ldx column
        dec ticks,x
        beq step_due
        jmp step_next
step_due:
        lda periods,x
        sta ticks,x
        jsr set_column

        lda #ERASE_SHADE
        sta shade
        lda heads,x
        sec
        sbc lengths,x
        jsr draw_cell

        lda #DIM_SHADE
        sta shade
        ldx column
        lda heads,x
        sec
        sbc lengths,x
        clc
        adc #2
        jsr draw_cell

        lda #GREEN_SHADE
        sta shade
        ldx column
        lda heads,x
        sec
        sbc #1
        jsr draw_cell

        lda #HEAD_SHADE
        sta shade
        ldx column
        lda heads,x
        jsr new_glyph

        ldx column
        inc heads,x
        lda heads,x
        sec
        sbc lengths,x
        bcc step_next
        cmp #ROW_COUNT
        bcc step_next
        jsr new_stream          ; last tail cell has left; wait before restarting
step_next:
        inc column
        lda column
        cmp #COLUMN_COUNT
        bcs step_done
        jmp step_column
step_done:
        rts

new_stream:
        lda #0
        sta heads,x
        jsr rng
        and #15
        clc
        adc #8
        sta lengths,x
        jsr rng
        and #3
        clc
        adc #2
        sta periods,x
        jsr rng
        and #15
        clc
        adc #4
        sta ticks,x
        rts

; charptr = GLYPHS + column * 32. X/Y are preserved.
set_column:
        lda column
        and #7
        asl a
        asl a
        asl a
        asl a
        asl a
        sta charptr
        lda column
        lsr a
        lsr a
        lsr a
        clc
        adc #>GLYPHS
        sta charptr+1
        rts

new_glyph:
        cmp #ROW_COUNT
        bcc new_visible
        rts
new_visible:
        tay
        jsr rng
        and #31
        sta (charptr),y
        tya
        jmp draw_cell

; Draw row A in the selected column and shade. Unsigned clipping also rejects
; negative rows represented by subtraction underflow near the top of a stream.
draw_cell:
        cmp #ROW_COUNT
        bcc draw_visible
        rts
draw_visible:
        sta cellrow
        asl a
        sta scanrow
        asl a
        clc
        adc scanrow
        sta scanrow             ; first pixel row = character row * 6
        lda shade
        beq draw_setup
        ldy cellrow
        lda (charptr),y
        asl a
        asl a
        asl a
        clc
        adc #<font
        sta fontptr
        lda #>font
        adc #0
        sta fontptr+1
        lda #16
        ldx shade
        cpx #HEAD_SHADE
        beq draw_color
        lda column
        and #1
        asl a
        asl a
        asl a
draw_color:
        sta coloroffset
draw_setup:
        lda #0
        sta glyphline
draw_line:
        lda shade
        beq draw_blank
        ldy glyphline
        lda (fontptr),y
        ldx shade
        cpx #DIM_SHADE
        bne draw_full
        and dither,y
draw_full:
        ora coloroffset
        tax
        lda pixels,x
        jmp draw_plot
draw_blank:
        lda #0
draw_plot:
        sta drawbits
        ldx scanrow
        lda ROWL,x
        sta screenptr
        lda ROWH,x
        sta screenptr+1
        ldy column
        lda drawbits
        sta (screenptr),y
        inc scanrow
        inc glyphline
        lda glyphline
        cmp #6
        bne draw_line
        rts

; Same 16-bit Galois LFSR as life.s; mix its bytes for glyph/timing choices.
rng:
        lsr seedhi
        ror seedlo
        bcc rng_value
        lda seedhi
        eor #$B4
        sta seedhi
rng_value:
        lda seedlo
        eor seedhi
        rts

pace:
        ldx #8
pace_outer:
        ldy #0
pace_inner:
        dey
        bne pace_inner
        dex
        bne pace_outer
        rts

; Apple-II scanline interleave, using the same construction as tut8_hires.s.
build_rows:
        ldx #0
rows_loop:
        txa
        and #7
        asl a
        asl a
        clc
        adc #$20
        sta rowtmpa
        txa
        lsr a
        lsr a
        lsr a
        and #7
        sta rowtmpb
        lsr a
        clc
        adc rowtmpa
        sta ROWH,x
        lda #0
        sta rowtmpa
        lda rowtmpb
        and #1
        beq rows_low
        lda #$80
        sta rowtmpa
rows_low:
        txa
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        beq rows_store
        tay
rows_add:
        lda rowtmpa
        clc
        adc #$28
        sta rowtmpa
        dey
        bne rows_add
rows_store:
        lda rowtmpa
        sta ROWL,x
        inx
        cpx #192
        bne rows_loop
        rts

clear_hgr:
        lda #$20
        sta screenptr+1
        lda #0
        sta screenptr
        ldx #32
clear_page:
        ldy #0
clear_byte:
        sta (screenptr),y
        iny
        bne clear_byte
        inc screenptr+1
        dex
        bne clear_page
        rts

; Three packed glyph bits -> green (even/odd byte columns), then white.
pixels:
        .byte $00,$20,$08,$28,$02,$22,$0A,$2A
        .byte $00,$10,$04,$14,$01,$11,$05,$15
        .byte $00,$30,$0C,$3C,$03,$33,$0F,$3F
dither:
        .byte 5,2,5,2,5,0

; Original compact digits and letters; eight-byte slots simplify indexing.
font:
        .byte 7,5,5,5,7,0,0,0   ; 0
        .byte 2,6,2,2,7,0,0,0   ; 1
        .byte 7,1,7,4,7,0,0,0   ; 2
        .byte 7,1,7,1,7,0,0,0   ; 3
        .byte 5,5,7,1,1,0,0,0   ; 4
        .byte 7,4,7,1,7,0,0,0   ; 5
        .byte 7,4,7,5,7,0,0,0   ; 6
        .byte 7,1,1,2,2,0,0,0   ; 7
        .byte 7,5,7,5,7,0,0,0   ; 8
        .byte 7,5,7,1,7,0,0,0   ; 9
        .byte 2,5,7,5,5,0,0,0   ; A
        .byte 6,5,6,5,6,0,0,0   ; B
        .byte 3,4,4,4,3,0,0,0   ; C
        .byte 6,5,5,5,6,0,0,0   ; D
        .byte 7,4,6,4,7,0,0,0   ; E
        .byte 7,4,6,4,4,0,0,0   ; F
        .byte 3,4,5,5,3,0,0,0   ; G
        .byte 5,5,7,5,5,0,0,0   ; H
        .byte 1,1,1,5,2,0,0,0   ; J
        .byte 5,5,6,5,5,0,0,0   ; K
        .byte 4,4,4,4,7,0,0,0   ; L
        .byte 5,7,7,5,5,0,0,0   ; M
        .byte 5,7,7,7,5,0,0,0   ; N
        .byte 6,5,6,4,4,0,0,0   ; P
        .byte 6,5,6,5,5,0,0,0   ; R
        .byte 7,2,2,2,2,0,0,0   ; T
        .byte 5,5,5,5,7,0,0,0   ; U
        .byte 5,5,5,5,2,0,0,0   ; V
        .byte 5,5,7,7,5,0,0,0   ; W
        .byte 5,5,2,5,5,0,0,0   ; X
        .byte 5,5,2,2,2,0,0,0   ; Y
        .byte 7,1,2,4,7,0,0,0   ; Z

heads:   .res COLUMN_COUNT
lengths: .res COLUMN_COUNT
periods: .res COLUMN_COUNT
ticks:   .res COLUMN_COUNT
