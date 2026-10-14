; Original "Cliffside Resolve" score and disk-resident player for 3ric.
; No game assets or original Karateka music are included here.
; Timer 1 is polled: no IRQs may disturb the game's speaker or disk loops.
; 192 * 256 PHI2 cycles per tick, 20 ticks/eighth: approximately 48 BPM.

TICK_QUANTA = 192
        .org $C800
MUSIC_POLL:
        php
        pha
        lda music_active
        beq poll_return
        lda $86
        and $4F
        and #1
        bne poll_clock
        pla
        plp
        jmp MUSIC_STOP
poll_clock:
        cld
        lda $C405
        sta timer_now
        lda timer_last
        sec
        sbc timer_now
        clc
        adc tick_pending
        sta tick_pending
        lda #0
        adc #0
        sta tick_carry
        lda timer_now
        sta timer_last
        phx
        phy
poll_tick:
        lda tick_carry
        bne poll_due
        lda tick_pending
        cmp #TICK_QUANTA
        bcc poll_done
poll_due:
        lda tick_pending
        sec
        sbc #TICK_QUANTA
        sta tick_pending
        lda tick_carry
        sbc #0
        sta tick_carry
        jsr music_tick
        jmp poll_tick
poll_done:
        ply
        plx
poll_return:
        pla
        plp
        rts

MUSIC_ARM:
        php
        pha
        phx
        phy
        cld
        lda $86
        and $4F
        and #1
        beq arm_quiet
        lda music_active
        bne music_restore
        lda #1
        sta music_active
        jsr music_notes
        jsr music_volumes
arm_clock:
        ; Resuming must not charge time spent paused.
        lda $C405
        sta timer_last
        jmp music_restore
arm_quiet:
        jsr music_silence
        jmp music_restore

MUSIC_STOP:
        php
        pha
        phx
        phy
        jsr music_silence
music_restore:
        ply
        plx
        pla
        plp
        rts

music_silence:
        lda #0
        sta music_active
        ldy #8
silence_voice:
        lda #0
        jsr ay_left
        lda #0
        jsr ay_right
        iny
        cpy #11
        bne silence_voice
        rts

music_tick:
        inc music_phase
        lda music_phase
        cmp #20
        bcc music_volumes
        lda #0
        sta music_phase
        inc music_row
        lda music_row
        and #127
        sta music_row
        jsr music_notes
music_volumes:
        ldy music_phase
        lda lead_env,y
        ldx lead_note
        bne lead_volume
        lda #0
lead_volume:
        ldy #8
        jsr ay_left
        ldy music_phase
        lda bass_env,y
        ldy #9
        jsr ay_left
        lda #3
        ldy #10
        jsr ay_left
        ldy music_phase
        lda arp_env,y
        ldy #8
        jsr ay_right
        ldy music_phase
        lda drum_env,y
        ldy #9
        jsr ay_right
        ldy music_phase
        lda lead_env,y
        lsr
        ldx echo_note
        bne echo_volume
        lda #0
echo_volume:
        ldy #10
        jmp ay_right

music_notes:
        ldy music_row
        lda melody,y
        sta lead_note
        ldy #0
        ldx #0
        jsr ay_tone
        lda music_row
        sec
        sbc #2
        and #127
        tay
        lda melody,y
        sta echo_note
        ldy #4
        ldx #$80
        jsr ay_tone
        lda music_row
        lsr
        lsr
        lsr
        tay
        lda roots,y
        sta root_note
        ldy #2
        ldx #0
        jsr ay_tone
        lda root_note
        clc
        adc #19
        ldy #4
        ldx #0
        jsr ay_tone
        lda music_row
        and #7
        tay
        lda arpeggio,y
        clc
        adc root_note
        ldy #0
        ldx #$80
        jsr ay_tone
        lda music_row
        and #3
        cmp #2
        beq snare
        lda #3
        bne noise_period
snare:
        lda #18
noise_period:
        ldy #6
        jmp ay_right

ay_tone:
        stx tone_chip
        sty tone_reg
        asl
        tax
        lda periods,x
        pha
        lda periods+1,x
        ldx tone_chip
        iny
        jsr ay_write
        pla
        ldy tone_reg
        jmp ay_write
ay_left:
        ldx #0
        jmp ay_write
ay_right:
        ldx #$80
ay_write:
        pha
        tya
        sta $C401,x
        lda #7
        sta $C400,x
        lda #4
        sta $C400,x
        pla
        sta $C401,x
        lda #6
        sta $C400,x
        lda #4
        sta $C400,x
        rts

MUSIC_REBASE:
        php
        pha
        lda $C405
        sta timer_last
        pla
        plp
        rts

music_active:   .byte 0
music_row:      .byte 0
music_phase:    .byte 0
tick_pending:   .byte 0
tick_carry:     .byte 0
timer_last:     .byte 0
timer_now:      .byte 0
lead_note:      .byte 0
echo_note:      .byte 0
root_note:      .byte 0
tone_chip:      .byte 0
tone_reg:       .byte 0
PLAYER_END:

        .org $CC00
REST = 0
E4 = 20
F4 = 21
G4 = 23
A4 = 25
C5 = 28
D5 = 30
E5 = 32
G5 = 35
A5 = 37
melody:
        .byte A4,REST,C5,E5,D5,C5,A4,REST
        .byte D5,REST,C5,A4,G4,A4,C5,REST
        .byte C5,D5,E5,REST,D5,C5,A4,G4
        .byte E4,G4,A4,REST,E5,D5,C5,REST
        .byte A4,C5,E5,G5,E5,D5,C5,A4
        .byte D5,E5,G5,REST,E5,D5,C5,A4
        .byte F4,A4,C5,D5,E5,REST,D5,C5
        .byte E5,D5,C5,G4,A4,REST,REST,REST
        .byte E5,REST,G5,A5,G5,E5,D5,C5
        .byte D5,E5,G5,E5,D5,REST,A4,C5
        .byte C5,E5,G5,REST,A5,G5,E5,D5
        .byte E5,REST,D5,C5,G4,A4,C5,REST
        .byte A4,C5,D5,E5,G5,E5,C5,A4
        .byte D5,REST,E5,G5,E5,D5,C5,A4
        .byte F4,A4,C5,E5,D5,C5,A4,G4
        .byte E4,G4,C5,D5,A4,REST,REST,REST
roots:
        .byte 1,6,9,8,1,6,9,8,1,6,9,8,1,6,9,8
arpeggio:
        .byte 12,19,24,19,12,19,24,19
periods:
        .word 0,894,844,796,752,710,670,632,597,563
        .word 532,502,474,447,422,398,376,355,335,316
        .word 298,282,266,251,237,223,211,199,188,177
        .word 167,158,149,141,133,125,118,112,105,100,94
lead_env:
        .byte 10,10,9,9,8,8,7,7,6,6,5,5,4,4,3,3,2,1,0,0
bass_env:
        .byte 8,8,8,7,7,7,6,6,6,6,5,5,5,5,4,4,4,3,3,3
arp_env:
        .byte 7,7,6,6,5,5,4,4,3,3,2,2,1,1,0,0,0,0,0,0
drum_env:
        .byte 6,4,2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
SCORE_END:

        .org $CF00
DRAW_FORWARD:
        jsr MUSIC_POLL
        jmp $1A42
DRAW_FORWARD_FLIP:
        jsr MUSIC_POLL
        jmp $1A4B
DRAW_REVERSE:
        jsr MUSIC_POLL
        jmp $1C5B
DRAW_REVERSE_FLIP:
        jsr MUSIC_POLL
        jmp $1C64
CLEAR_PAGE:
        jsr MUSIC_POLL
        inc $01
        lda $01
        rts
FILL_ROW:
        jsr MUSIC_POLL
        dex
        cpx #$C0
        rts
COPY_COLUMN:
        jsr MUSIC_POLL
        jmp $7761
GAME_FRAME:
        jsr MUSIC_POLL
        jsr $7628
        jsr MUSIC_ARM
        rts
GAME_PAUSE:
        jsr MUSIC_STOP
        sta $C010
        jmp $7791
GAME_WAIT:
        jsr MUSIC_STOP
        sta $C010
        jmp $77E6
GAME_CUE:
        jsr MUSIC_STOP
        ldy #0
        lda ($F7),y
        jmp $0D04
LOAD_GAME:
        jsr MUSIC_STOP
        jmp $020C
WAIT_GAME:
        jsr MUSIC_STOP
        jmp $025E
RESTART_GAME:
        jsr MUSIC_STOP
        jmp $02A2
NEXT_GAME:
        jsr MUSIC_STOP
        jmp $0237
EFFECT_1:
        jsr MUSIC_POLL
        jsr $0C55
        jmp MUSIC_REBASE
EFFECT_2:
        jsr MUSIC_POLL
        jsr $0C64
        jmp MUSIC_REBASE
EFFECT_3:
        jsr MUSIC_POLL
        jsr $0C74
        jmp MUSIC_REBASE
EFFECT_4:
        jsr MUSIC_POLL
        jsr $0C84
        jmp MUSIC_REBASE
EFFECT_5:
        jsr MUSIC_POLL
        jsr $0C92
        jmp MUSIC_REBASE
EFFECT_6:
        jsr MUSIC_POLL
        jsr $0CA0
        jmp MUSIC_REBASE
EFFECT_7:
        jsr MUSIC_POLL
        jsr $0CB0
        jmp MUSIC_REBASE

MUSIC_INIT:
        ldx #$80
init_chip:
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
        beq init_mixer
        ldx #0
        beq init_chip
init_mixer:
        ldy #7
        lda #$38
        jsr ay_left
        lda #$2A
        jsr ay_right
        lda #$40
        sta $C40B
        lda #$FF
        sta $C404
        sta $C405
        jmp MUSIC_STOP
KEEP_INPUT_MODE:
        ; Later loaders replace zero page; retain J/K selection in the new image.
        lda $C4
        sta $A0C4
        lda $C057
        rts
ADAPTER_END:
