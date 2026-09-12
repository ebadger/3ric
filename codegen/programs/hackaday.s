; BUILT FROM BITS - a one-minute 3RIC / Hackaday showreel.
; Every pixel, note and scene change below runs on the 65C02.
; https://ebadger.github.io/3ric/hackaday.html
;
; 1-4: scene, N/Right: next, Left: previous, Space: pause, M: music, Q/Esc: quit.
; Run at 1x (1.5734375 MHz). Browser sound needs a click inside the emulator.
; BRUN HACKADAY.PRG 0800 on 3RIC. Music needs a slot-4 dual-AY Mockingboard.
; This uses 3RIC's onboard VIA, not an unmodified Apple II's slot-2 hardware.
;
; Image: $0800-$1FFF; mixed text/lores: $0400-$07FF; hires: $2000-$3FFF.
; Tables/workspace: $6000-$6503. Rendering uses no ROM drawing or host animation.
; Timer 2 on the onboard VIA paces all scenes, even without a sound card.

        .org $0800

KBD          = $C000
KBDSTRB      = $C010
GRAPHICS     = $C050
TEXT         = $C051
FULLSCREEN   = $C052
MIXED        = $C053
DISPLAY1     = $C054
LORES        = $C056
HIRES        = $C057
T2LO         = $C208
T2HI         = $C209
VIA_ACR      = $C20B
VIA_IFR      = $C20D
VIA_IER      = $C20E
HOME         = $FC58
FRAME_LATCH  = $F5D9
SCENE_TICKS  = 384
NOTE_TICKS   = 6
STAR_COUNT   = 48
ROWL         = $6000
ROWH         = $6100
XCOL         = $6200
XMASK        = $6300
STAR_X       = $6400
STAR_Y       = $6440
COLWAVE      = $6480
CUBE_X       = $64C0
CUBE_Y       = $64D0
VOICE_NOTES  = $64E0
VOICE_LEVELS = $64E8
NOTE_LABEL   = $6500

ptr          = $06
strptr       = $08
fontptr      = $0A
seedlo       = $0C
seedhi       = $0D
tmp          = $0E
tmp2         = $0F
scene        = $10
paused       = $11
muted        = $12
tick         = $13
phase        = $14
age_lo       = $15
age_hi       = $16
scorepos     = $17
voice        = $18
cutoff       = $19
column       = $1A
row          = $1B
glyphline    = $1C
glyphbits    = $1D
paint        = $1E
repeatrow    = $1F
px           = $20
py           = $21
endx         = $22
endy         = $23
linedx       = $40
linedy       = $41
stepx        = $42
stepy        = $43
lineerr      = $44
remaining    = $45
edge         = $46
item         = $47
oldacr       = $48
oldier       = $49
ayreg        = $4A
ayvalue      = $4B
board        = $4C
topwave      = $4D
bottomwave   = $4E
rowphase     = $4F
textcolumn   = $50
textrow      = $51
logoletter   = $52
logocol      = $53
logobit      = $54
lastkey      = $55
linecol      = $56
linemask     = $57

start:
        sei
        cld
        ldx #$FF
        txs
        bit KBDSTRB
        lda VIA_ACR
        sta oldacr
        and #$DF
        sta VIA_ACR
        lda VIA_IER
        sta oldier
        lda #$20
        sta VIA_IER             ; mask only T2; keep the ROM's keyboard NMI path
        stz scene
        stz paused
        stz muted
        stz tick
        stz scorepos
        lda #$E1
        sta seedlo
        lda #$AC
        sta seedhi
        jsr build_tables
        jsr init_sound
        jsr score_notes
        jsr apply_audio
        jsr enter_scene
main:
        jsr check_key
        lda #<FRAME_LATCH
        sta T2LO
        lda #>FRAME_LATCH
        sta T2HI
        lda paused
        bne frame_wait
        jsr music_frame
        lda scene
        beq frame_signal
        cmp #1
        beq frame_color
        cmp #2
        beq frame_wire
        jsr step_stereo
        bra frame_age
frame_signal:
        jsr step_stars
        bra frame_age
frame_color:
        jsr step_plasma
        bra frame_age
frame_wire:
        jsr step_cube
frame_age:
        inc age_lo
        bne frame_check_age
        inc age_hi
frame_check_age:
        lda age_hi
        cmp #>SCENE_TICKS
        bne frame_wait
        lda age_lo
        cmp #<SCENE_TICKS
        bne frame_wait
        jsr next_scene
frame_wait:
        lda VIA_IFR
        and #$20
        beq frame_wait
        bit T2LO
        jmp main

check_key:
        lda KBD
        bpl key_done
        bit KBDSTRB
        and #$7F
        sta lastkey
        cmp #'Q'
        beq quit
        cmp #$1B
        beq quit
        cmp #$20
        beq key_pause
        cmp #'M'
        beq key_music
        cmp #'N'
        beq next_scene
        cmp #$15
        beq next_scene
        cmp #$08
        beq previous_scene
        cmp #'1'
        bcc key_done
        cmp #'5'
        bcs key_done
        sec
        sbc #'1'
        sta scene
        jmp enter_scene
key_pause:
        lda paused
        eor #1
        sta paused
        bra key_sound
key_music:
        lda muted
        eor #1
        sta muted
key_sound:
        jsr apply_audio
        jsr draw_status
        lda scene
        cmp #3
        bne key_done
        jsr step_stereo
key_done:
        rts

quit:
        jsr silence
        bit T2LO
        lda oldacr
        sta VIA_ACR
        lda oldier
        and #$20
        beq quit_video
        lda #$A0
        sta VIA_IER
quit_video:
        bit TEXT
        bit FULLSCREEN
        bit DISPLAY1
        bit LORES
        jsr HOME
        cli
        brk

previous_scene:
        lda scene
        dec a
        and #3
        sta scene
        jmp enter_scene
next_scene:
        lda scene
        inc a
        and #3
        sta scene
enter_scene:
        stz age_lo
        stz age_hi
        stz phase
        jsr clear_hgr
        jsr clear_text
        bit DISPLAY1
        bit MIXED
        jsr draw_hud
        lda scene
        cmp #1
        beq enter_color
        bit HIRES
        bit GRAPHICS
        lda scene
        beq enter_signal
        cmp #2
        beq enter_wire
        jmp enter_stereo
enter_color:
        jsr step_plasma
        bit LORES
        bit GRAPHICS
        rts
enter_signal:
        lda #<signal_top
        sta strptr
        lda #>signal_top
        sta strptr+1
        lda #7
        sta textcolumn
        lda #14
        sta textrow
        jsr draw_text
        jsr draw_logo
        lda #<signal_bottom
        sta strptr
        lda #>signal_bottom
        sta strptr+1
        lda #12
        sta textcolumn
        lda #109
        sta textrow
        jsr draw_text
        ldx #0
seed_stars:
        jsr rng
        sta STAR_X,x
        jsr rng
        and #127
        clc
        adc #16
        sta STAR_Y,x
        inx
        cpx #STAR_COUNT
        bne seed_stars
        stz item
seed_star_plot:
        jsr load_star
        jsr plot_star
        inc item
        lda item
        cmp #STAR_COUNT
        bne seed_star_plot
        rts

enter_wire:
        lda #<wire_top
        sta strptr
        lda #>wire_top
        sta strptr+1
        lda #10
        sta textcolumn
        lda #14
        sta textrow
        jsr draw_text
        lda #<wire_bottom
        sta strptr
        lda #>wire_bottom
        sta strptr+1
        lda #7
        sta textcolumn
        lda #143
        sta textrow
        jsr draw_text
        stz item
wire_floor:
        lda #128
        sta px
        lda #116
        sta py
        ldx item
        lda floor_x,x
        sta endx
        lda #134
        sta endy
        jsr line
        inc item
        lda item
        cmp #5
        bne wire_floor
        jsr cube_vertices
        jmp xor_cube

enter_stereo:
        lda #<stereo_top
        sta strptr
        lda #>stereo_top
        sta strptr+1
        lda #8
        sta textcolumn
        lda #12
        sta textrow
        jsr draw_text
        lda #<left_label
        sta strptr
        lda #>left_label
        sta strptr+1
        lda #7
        sta textcolumn
        lda #34
        sta textrow
        jsr draw_text
        lda #<right_label
        sta strptr
        lda #>right_label
        sta strptr+1
        lda #25
        sta textcolumn
        lda #34
        sta textrow
        jsr draw_text
        jmp step_stereo

; XOR restores the underlying logo and wireframe without clearing each frame.
load_star:
        ldx item
        lda STAR_X,x
        sta px
        lda STAR_Y,x
        sta py
        rts
plot_star:
        lda py
        cmp #40
        bcc plot
        cmp #120
        bcs plot
        lda px
        cmp #45
        bcc plot
        cmp #224
        bcs plot
        rts
step_stars:
        stz item
star_loop:
        jsr load_star
        jsr plot_star
        lda item
        and #3
        inc a
        sta tmp
        ldx item
        lda STAR_X,x
        sec
        sbc tmp
        sta STAR_X,x
        bcs star_moved
        jsr rng
        and #127
        clc
        adc #16
        sta STAR_Y,x
star_moved:
        jsr load_star
        jsr plot_star
        inc item
        lda item
        cmp #STAR_COUNT
        bne star_loop
        rts

plot:
        ldy py
        cpy #160
        bcs plot_done
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        ldx px
        ldy XCOL,x
        lda XMASK,x
        eor (ptr),y
        sta (ptr),y
plot_done:
        rts

; Precompute the horizontal wave once; each byte packs two independent pixels.
step_plasma:
        inc phase
        lda phase
        and #63
        sta phase
        stz column
plasma_columns:
        lda column
        asl a
        clc
        adc phase
        and #63
        tax
        lda sine32,x
        ldx column
        sta COLWAVE,x
        inc column
        lda column
        cmp #40
        bne plasma_columns
        stz row
        lda phase
        sta rowphase
plasma_row:
        ldx row
        lda text_lo,x
        sta ptr
        lda text_hi,x
        sta ptr+1
        lda rowphase
        and #63
        tax
        lda sine32,x
        sta topwave
        txa
        clc
        adc #2
        and #63
        tax
        lda sine32,x
        sta bottomwave
        stz column
plasma_cell:
        ldx column
        lda COLWAVE,x
        clc
        adc topwave
        and #15
        tay
        lda palette_lo,y
        sta paint
        lda COLWAVE,x
        clc
        adc bottomwave
        and #15
        tay
        lda palette_hi,y
        ora paint
        ldy column
        sta (ptr),y
        inc column
        lda column
        cmp #40
        bne plasma_cell
        lda rowphase
        clc
        adc #4
        sta rowphase
        inc row
        lda row
        cmp #20
        bne plasma_row
        rts

step_cube:
        jsr xor_cube
        inc phase
        lda phase
        and #63
        sta phase
        jsr cube_vertices
        jmp xor_cube
cube_vertices:
        ldx #0
cube_vertex:
        txa
        asl a
        asl a
        asl a
        asl a
        clc
        adc phase
        and #63
        tay
        lda rotate_x,y
        sta CUBE_X,x
        sta CUBE_X+4,x
        lda rotate_y,y
        sta CUBE_Y,x
        clc
        adc #40
        sta CUBE_Y+4,x
        inx
        cpx #4
        bne cube_vertex
        rts
xor_cube:
        stz edge
cube_edge:
        ldx edge
        ldy edge_a,x
        lda CUBE_X,y
        sta px
        lda CUBE_Y,y
        sta py
        ldy edge_b,x
        lda CUBE_X,y
        sta endx
        lda CUBE_Y,y
        sta endy
        jsr line
        inc edge
        lda edge
        cmp #12
        bne cube_edge
        rts

; Dominant-axis Bresenham: unsigned error avoids a signed doubled-error overflow.
; Endpoints are in the 256x160 playfield. Like ROCK STORM, inline the pixel hot
; path; the cube's vertical edges need no per-pixel error or column calculation.
line:
        lda #1
        sta stepx
        sta stepy
        lda endx
        sec
        sbc px
        bcs line_x_positive
        eor #$FF
        inc a
        dec stepx
        dec stepx
line_x_positive:
        sta linedx
        lda endy
        sec
        sbc py
        bcs line_y_positive
        eor #$FF
        inc a
        dec stepy
        dec stepy
line_y_positive:
        sta linedy
        lda linedx
        bne line_diagonal
        jmp line_vertical
line_diagonal:
        lda linedy
        cmp linedx
        bcs line_y_major
        lda linedx
        sta remaining
        lsr a
        sta lineerr
line_x_loop:
        ldy py
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        ldx px
        ldy XCOL,x
        lda XMASK,x
        eor (ptr),y
        sta (ptr),y
        lda lineerr
        sec
        sbc linedy
        bcs line_x_error
        clc
        adc linedx
        pha
        lda py
        clc
        adc stepy
        sta py
        pla
line_x_error:
        sta lineerr
        lda px
        clc
        adc stepx
        sta px
        dec remaining
        bne line_x_loop
        jmp plot
line_y_major:
        lda linedy
        sta remaining
        lsr a
        sta lineerr
line_y_loop:
        ldy py
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        ldx px
        ldy XCOL,x
        lda XMASK,x
        eor (ptr),y
        sta (ptr),y
        lda lineerr
        sec
        sbc linedx
        bcs line_y_error
        clc
        adc linedy
        pha
        lda px
        clc
        adc stepx
        sta px
        pla
line_y_error:
        sta lineerr
        lda py
        clc
        adc stepy
        sta py
        dec remaining
        bne line_y_loop
        jmp plot

line_vertical:
        ldx px
        lda XCOL,x
        sta linecol
        lda XMASK,x
        sta linemask
        ldy py
line_vertical_pixel:
        lda ROWL,y
        sta ptr
        lda ROWH,y
        sta ptr+1
        phy
        ldy linecol
        lda linemask
        eor (ptr),y
        sta (ptr),y
        ply
        cpy endy
        beq line_vertical_done
        tya
        clc
        adc stepy
        tay
        bra line_vertical_pixel
line_vertical_done:
        sty py
        rts

step_stereo:
        stz voice
stereo_voice:
        ldx voice
        lda bar_columns,x
        sta column
        lda VOICE_LEVELS,x
        sta tmp
        asl a
        asl a
        clc
        adc tmp
        sta tmp
        lda #128
        sec
        sbc tmp
        sta cutoff
        lda #56
        sta row
stereo_row:
        ldx row
        lda ROWL,x
        sta ptr
        lda ROWH,x
        sta ptr+1
        lda #0
        cpx cutoff
        bcc stereo_paint
        lda row
        and #3
        beq stereo_blank
        lda column
        and #1
        tax
        lda green_bits,x
        ldx voice
        cpx #3
        bcc stereo_paint
        ora #$80
        bra stereo_paint
stereo_blank:
        lda #0
stereo_paint:
        sta paint
        ldy column
        sta (ptr),y
        iny
        tax
        beq stereo_middle
        eor #$7F
stereo_middle:
        sta (ptr),y
        iny
        lda paint
        sta (ptr),y
        inc row
        lda row
        cmp #128
        bne stereo_row
        jsr draw_note
        inc voice
        lda voice
        cmp #6
        bne stereo_voice
        rts

draw_note:
        ldx voice
        lda VOICE_NOTES,x
        ldy #'3'
note_octave:
        cmp #12
        bcc note_name
        sec
        sbc #12
        iny
        bra note_octave
note_name:
        tax
        sty NOTE_LABEL+2
        lda note_letters,x
        sta NOTE_LABEL
        lda note_sharps,x
        sta NOTE_LABEL+1
        stz NOTE_LABEL+3
        lda #<NOTE_LABEL
        sta strptr
        lda #>NOTE_LABEL
        sta strptr+1
        lda column
        sta textcolumn
        lda #137
        sta textrow
        jmp draw_text

init_sound:
        ldx #0
sound_chip:
        lda #$7F
        sta $C40E,x
        lda #$FF
        sta $C403,x
        lda #7
        sta $C402,x
        lda #0
        sta $C400,x
        lda #4
        sta $C400,x
        txa
        beq sound_right
        stz board
        ldx #7
        lda #$38
        jsr write_ay
        lda #$80
        sta board
        ldx #7
        lda #$38
        jmp write_ay
sound_right:
        ldx #$80
        bra sound_chip

music_frame:
        inc tick
        lda tick
        cmp #NOTE_TICKS
        bcc apply_audio
        stz tick
        inc scorepos
        lda scorepos
        and #63
        sta scorepos
        jsr score_notes
apply_audio:
        stz voice
audio_voice:
        jsr select_voice
        ldx voice
        ldy VOICE_NOTES,x
        lda note_lo,y
        ldx ayreg
        jsr write_ay
        inc ayreg
        ldx voice
        ldy VOICE_NOTES,x
        lda note_hi,y
        ldx ayreg
        jsr write_ay
        ldx voice
        lda levels,x
        sec
        sbc tick
        sta tmp
        lda muted
        ora paused
        beq audio_level
        stz tmp
audio_level:
        lda tmp
        sta VOICE_LEVELS,x
        lda volume_regs,x
        tax
        lda tmp
        jsr write_ay
        inc voice
        lda voice
        cmp #6
        bne audio_voice
        rts

score_notes:
        ldx scorepos
        lda melody,x
        sta VOICE_NOTES
        txa
        clc
        adc #56
        and #63
        tax
        lda melody,x
        sta VOICE_NOTES+3
        lda scorepos
        lsr a
        lsr a
        lsr a
        tax
        lda roots,x
        sta VOICE_NOTES+2
        clc
        adc #12
        sta VOICE_NOTES+5
        lda scorepos
        and #3
        tax
        lda arp_intervals,x
        clc
        adc VOICE_NOTES+2
        sta VOICE_NOTES+1
        clc
        adc #12
        sta VOICE_NOTES+4
        rts

select_voice:
        ldx voice
        lda tone_regs,x
        sta ayreg
        lda #0
        cpx #3
        bcc voice_board
        lda #$80
voice_board:
        sta board
        rts

; AY latches on the falling control edge: address, inactive, data, inactive.
write_ay:
        sta ayvalue
        stx ayreg
        ldx board
        lda ayreg
        sta $C401,x
        lda #7
        sta $C400,x
        lda #4
        sta $C400,x
        lda ayvalue
        sta $C401,x
        lda #6
        sta $C400,x
        lda #4
        sta $C400,x
        rts

silence:
        stz voice
silence_voice:
        jsr select_voice
        ldx voice
        lda #0
        sta VOICE_LEVELS,x
        lda volume_regs,x
        tax
        lda #0
        jsr write_ay
        inc voice
        lda voice
        cmp #6
        bne silence_voice
        rts

draw_hud:
        lda scene
        asl a
        tax
        lda heading_ptrs,x
        sta strptr
        lda heading_ptrs+1,x
        sta strptr+1
        ldx #20
        jsr text_string
        lda scene
        asl a
        tax
        lda detail_ptrs,x
        sta strptr
        lda detail_ptrs+1,x
        sta strptr+1
        ldx #21
        jsr text_string
        lda #<controls
        sta strptr
        lda #>controls
        sta strptr+1
        ldx #22
        jsr text_string
        lda #<status_line
        sta strptr
        lda #>status_line
        sta strptr+1
        ldx #23
        jsr text_string
draw_status:
        lda #<playing_label
        ldx #>playing_label
        ldy paused
        beq status_run
        lda #<paused_label
        ldx #>paused_label
status_run:
        sta strptr
        stx strptr+1
        ldx #23
        jsr text_string
        ldx #0
status_music:
        lda music_on,x
        ldy muted
        beq status_music_char
        lda music_off,x
status_music_char:
        ora #$80
        sta $07D8,x
        inx
        cpx #9
        bne status_music
        rts

text_string:
        lda text_lo,x
        sta ptr
        lda text_hi,x
        sta ptr+1
        ldy #0
text_char:
        lda (strptr),y
        beq text_done
        ora #$80
        sta (ptr),y
        iny
        cpy #40
        bne text_char
text_done:
        rts

clear_text:
        lda #$04
        sta ptr+1
        stz ptr
        lda #$A0
        ldx #4
clear_text_page:
        ldy #0
clear_text_byte:
        sta (ptr),y
        iny
        bne clear_text_byte
        inc ptr+1
        dex
        bne clear_text_page
        rts

clear_hgr:
        lda #$20
        sta ptr+1
        stz ptr
        lda #0
        ldx #32
clear_hgr_page:
        ldy #0
clear_hgr_byte:
        sta (ptr),y
        iny
        bne clear_hgr_byte
        inc ptr+1
        dex
        bne clear_hgr_page
        rts

; Small 5x7 lettering and a byte-wide, six-scanline-per-dot title use one font.
font_address:
        cmp #'#'
        beq font_sharp
        cmp #'A'
        bcc font_digit
        sec
        sbc #'A'
        bra font_index
font_digit:
        sec
        sbc #'0'
        clc
        adc #26
        bra font_index
font_sharp:
        lda #36
font_index:
        stz fontptr+1
        asl a
        rol fontptr+1
        asl a
        rol fontptr+1
        asl a
        rol fontptr+1
        clc
        adc #<font
        sta fontptr
        lda fontptr+1
        adc #>font
        sta fontptr+1
        rts

draw_text:
        lda (strptr)
        beq draw_text_done
        cmp #$20
        beq draw_space
        jsr font_address
        stz glyphline
draw_letter_row:
        ldy glyphline
        lda (fontptr),y
        sta glyphbits
        ldx #5
        lda #0
reverse_glyph:
        lsr glyphbits
        rol a
        dex
        bne reverse_glyph
        asl a
        sta paint
        lda textrow
        clc
        adc glyphline
        tax
        lda ROWL,x
        sta ptr
        lda ROWH,x
        sta ptr+1
        ldy textcolumn
        lda paint
        sta (ptr),y
        inc glyphline
        lda glyphline
        cmp #7
        bne draw_letter_row
        bra draw_text_next
draw_space:
        ldx textrow
        lda #7
        sta repeatrow
draw_space_row:
        lda ROWL,x
        sta ptr
        lda ROWH,x
        sta ptr+1
        ldy textcolumn
        lda #0
        sta (ptr),y
        inx
        dec repeatrow
        bne draw_space_row
draw_text_next:
        inc strptr
        bne draw_text_pointer
        inc strptr+1
draw_text_pointer:
        inc textcolumn
        bra draw_text
draw_text_done:
        rts

draw_logo:
        stz logoletter
        lda #8
        sta logocol
logo_letter:
        ldx logoletter
        lda logo_text,x
        jsr font_address
        stz glyphline
        lda #52
        sta row
logo_font_row:
        lda #6
        sta repeatrow
logo_scanline:
        ldy glyphline
        lda (fontptr),y
        asl a
        asl a
        asl a
        sta glyphbits
        lda logocol
        sta column
        lda #5
        sta logobit
        ldx row
        lda ROWL,x
        sta ptr
        lda ROWH,x
        sta ptr+1
logo_dot:
        asl glyphbits
        bcc logo_dot_next
        lda #$7F
        ldx repeatrow
        cpx #4
        bcs logo_dot_paint
        lda column
        and #1
        tax
        lda green_bits,x
logo_dot_paint:
        ldy column
        sta (ptr),y
logo_dot_next:
        inc column
        dec logobit
        bne logo_dot
        inc row
        dec repeatrow
        bne logo_scanline
        inc glyphline
        lda glyphline
        cmp #7
        bne logo_font_row
        lda logocol
        clc
        adc #6
        sta logocol
        inc logoletter
        lda logoletter
        cmp #4
        bne logo_letter
        rts

; Same Apple-II scanline construction and Galois LFSR as the other demos.
build_tables:
        ldx #0
build_row:
        txa
        and #7
        asl a
        asl a
        clc
        adc #$20
        sta tmp
        txa
        lsr a
        lsr a
        lsr a
        and #7
        sta tmp2
        lsr a
        clc
        adc tmp
        sta ROWH,x
        stz tmp
        lda tmp2
        and #1
        beq build_low
        lda #$80
        sta tmp
build_low:
        txa
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        lsr a
        beq build_store
        tay
build_add:
        lda tmp
        clc
        adc #$28
        sta tmp
        dey
        bne build_add
build_store:
        lda tmp
        sta ROWL,x
        inx
        cpx #192
        bne build_row
        ldx #0
        lda #1
        sta tmp
        sta tmp2                ; one-byte horizontal border: x maps to x + 7
build_x:
        lda tmp
        sta XMASK,x
        lda tmp2
        sta XCOL,x
        asl tmp
        bpl build_x_next
        lda #1
        sta tmp
        inc tmp2
build_x_next:
        inx
        bne build_x
        rts
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

heading_ptrs:
        .word heading_signal,heading_color,heading_wire,heading_stereo
detail_ptrs:
        .word detail_signal,detail_color,detail_wire,detail_stereo
heading_signal: .asciiz "01 SIGNAL / BUILT FROM BITS"
detail_signal:  .asciiz "65C02 + RAM WRITES = EVERY PIXEL"
heading_color:  .asciiz "02 COLOR / COPPER WITHOUT A COPPER"
detail_color:   .asciiz "MIXED LORES: 40X40, 16 COLORS"
heading_wire:   .asciiz "03 WIREFRAME / MATH INTO LIGHT"
detail_wire:    .asciiz "12 EDGES / XOR ERASE / NO GPU"
heading_stereo: .asciiz "04 STEREO / SIX VOICES TWO CHIPS"
detail_stereo:  .asciiz "SLOT 4: $C400 LEFT / $C480 RIGHT"
controls:      .asciiz "1-4 SCENE N/NEXT SPACE/PAUSE M/MUSIC"
status_line:   .asciiz "PLAY    MUSIC ON     Q/ESC: MONITOR"
playing_label: .asciiz "PLAY  "
paused_label:  .asciiz "PAUSED"
music_on:      .byte "MUSIC ON "
music_off:     .byte "MUSIC OFF"
signal_top:    .asciiz "ONE CPU   A WHOLE COMPUTER"
signal_bottom: .asciiz "BUILT FROM BITS"
wire_top:      .asciiz "MATH BECOMES LIGHT"
wire_bottom:   .asciiz "XOR   ERASE   ROTATE   DRAW"
stereo_top:    .asciiz "SIX VOICES   TWO CHIPS"
left_label:    .asciiz "LEFT AY"
right_label:   .asciiz "RIGHT AY"
logo_text:     .byte "3RIC"
green_bits:    .byte $2A,$55
floor_x:       .byte 32,80,128,176,224
bar_columns:   .byte 5,10,15,23,28,33
edge_a:        .byte 0,1,2,3,4,5,6,7,0,1,2,3
edge_b:        .byte 1,2,3,0,5,6,7,4,4,5,6,7
tone_regs:     .byte 0,2,4,0,2,4
volume_regs:   .byte 8,9,10,8,9,10
levels:        .byte 12,8,11,10,7,9
roots:         .byte 0,0,5,5,7,7,0,0
arp_intervals: .byte 0,4,7,4
note_letters:  .byte "CCDDEFFGGAAB"
note_sharps:   .byte " # #  # # # "

; An original 64-step melody. Six 25Hz ticks per eighth note: about 125 BPM.
melody:
        .byte 12,16,19,24,23,19,16,14,12,16,19,16,14,12,11,7
        .byte 17,21,24,21,19,17,16,12,17,19,21,24,21,19,17,16
        .byte 19,23,26,23,21,19,16,14,19,21,23,26,24,23,21,19
        .byte 24,19,16,12,14,16,19,23,24,19,16,14,12,7,11,12
note_lo:
        .byte 240,198,158,120,85,51,20,246,218,191,166,142,120,99,79,60
        .byte 42,26,10,251,237,223,211,199,188,177,167,158,149,141,133,125
note_hi:
        .byte 2,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1
        .byte 1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0
sine32:
        .byte 16,17,19,20,21,23,24,25,26,27,28,29,30,30,31,31
        .byte 31,31,31,30,30,29,28,27,26,25,24,23,21,20,19,17
        .byte 16,14,12,11,10,8,7,6,5,4,3,2,1,1,0,0
        .byte 0,0,0,1,1,2,3,4,5,6,7,8,10,11,12,14
rotate_x:
        .byte 128,131,133,136,139,141,144,146,148,150,151,153,154,155,155,156
        .byte 156,156,155,155,154,153,151,150,148,146,144,141,139,136,133,131
        .byte 128,125,123,120,117,115,112,110,108,106,105,103,102,101,101,100
        .byte 100,100,101,101,102,103,105,106,108,110,112,115,117,120,123,125
rotate_y:
        .byte 74,74,74,73,73,72,72,71,70,69,68,67,65,64,63,61
        .byte 60,59,57,56,55,53,52,51,50,49,48,48,47,47,46,46
        .byte 46,46,46,47,47,48,48,49,50,51,52,53,55,56,57,59
        .byte 60,61,63,64,65,67,68,69,70,71,72,72,73,73,74,74
palette_lo:
        .byte 0,2,6,7,15,11,9,1,3,13,12,4,5,8,10,14
palette_hi:
        .byte $00,$20,$60,$70,$F0,$B0,$90,$10,$30,$D0,$C0,$40,$50,$80,$A0,$E0
text_lo:
        .byte $00,$80,$00,$80,$00,$80,$00,$80,$28,$A8,$28,$A8
        .byte $28,$A8,$28,$A8,$50,$D0,$50,$D0,$50,$D0,$50,$D0
text_hi:
        .byte $04,$04,$05,$05,$06,$06,$07,$07,$04,$04,$05,$05
        .byte $06,$06,$07,$07,$04,$04,$05,$05,$06,$06,$07,$07

; Original 5x7 uppercase alphabet, digits, and sharp sign in eight-byte slots.
font:
        .byte 14,17,17,31,17,17,17,0
        .byte 30,17,17,30,17,17,30,0
        .byte 14,17,16,16,16,17,14,0
        .byte 30,17,17,17,17,17,30,0
        .byte 31,16,16,30,16,16,31,0
        .byte 31,16,16,30,16,16,16,0
        .byte 14,17,16,23,17,17,15,0
        .byte 17,17,17,31,17,17,17,0
        .byte 31,4,4,4,4,4,31,0
        .byte 7,2,2,2,18,18,12,0
        .byte 17,18,20,24,20,18,17,0
        .byte 16,16,16,16,16,16,31,0
        .byte 17,27,21,21,17,17,17,0
        .byte 17,25,25,21,19,19,17,0
        .byte 14,17,17,17,17,17,14,0
        .byte 30,17,17,30,16,16,16,0
        .byte 14,17,17,17,21,18,13,0
        .byte 30,17,17,30,20,18,17,0
        .byte 15,16,16,14,1,1,30,0
        .byte 31,4,4,4,4,4,4,0
        .byte 17,17,17,17,17,17,14,0
        .byte 17,17,17,17,17,10,4,0
        .byte 17,17,17,21,21,27,17,0
        .byte 17,17,10,4,10,17,17,0
        .byte 17,17,10,4,4,4,4,0
        .byte 31,1,2,4,8,16,31,0
        .byte 14,17,19,21,25,17,14,0
        .byte 4,12,4,4,4,4,14,0
        .byte 14,17,1,2,4,8,31,0
        .byte 30,1,1,14,1,1,30,0
        .byte 2,6,10,18,31,2,2,0
        .byte 31,16,16,30,1,1,30,0
        .byte 14,16,16,30,17,17,14,0
        .byte 31,1,2,4,8,8,8,0
        .byte 14,17,17,14,17,17,14,0
        .byte 14,17,17,15,1,1,14,0
        .byte 10,10,31,10,31,10,10,0
image_end:
