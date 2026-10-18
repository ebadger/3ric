; M.U.L.E. for 3RIC - runtime core: the Atari machine the game expects.
;
; The game runs unmodified at its Atari addresses except for converter
; patches. Its hardware stores land in a register file of language-card RAM
; at the real addresses ($D000-$D4FF, bank 2); the few hardware reads are
; patched to the read mirrors and helpers below; its eleven floating-point
; calls reach fp.s at the Atari entry points.
;
; Timing: Timer 1 of the second Mockingboard VIA interrupts at ~60 Hz. Each
; tick plays the part of the Atari vertical-blank NMI: refresh pads,
; translate POKEY to the two AY chips, approximate player collisions, then
; enter the game's own VBI through VVBLKI with the Atari NMI stack frame
; (A, X, Y pushed). The game's VBI ends with PLA x3 / RTI, which lands in
; vbi_after; every RENDER_EVERY ticks that redraws the hi-res screen from
; the Atari display list with interrupts enabled (render.s, bank 1). Timer 1
; of the first VIA free-runs with the same period and serves as the beam
; position for the game's VCOUNT waits.
;
; Prepended by the converter: RT_RAM2, RT_B2 (code origins), FONT, RENDER,
; RENDER_EVERY, TIMER_LATCH, RG/RP/RA (read mirrors), RTVARS (variables).

MB1         = $C400             ; Mockingboard VIA 1 (AY 1, VCOUNT clock)
MB2         = $C480             ; Mockingboard VIA 2 (AY 2, 60 Hz tick)
V_ORB       = 0
V_ORA       = 1
V_DDRB      = 2
V_DDRA      = 3
V_T1CL      = 4
V_T1CH      = 5
V_T1LL      = 6
V_T1LH      = 7
V_ACR       = 11
V_IFR       = 13
V_IER       = 14
PADORB      = $C200             ; onboard VIA port B: PB6 latch, PB7 clock
PADIER      = $C20E
SPEAKER     = $C030
LCB1        = $C08B             ; language card: read/write bank 1
LCB2        = $C083             ; read/write bank 2
SIG         = $DFFF             ; $A5 in bank 1, $5A in bank 2
SIG_B1      = $A5
SIG_B2      = $5A

VDSLST      = $0200
VVBLKI      = $0222

; Atari register file (bank 2)
AUDF1       = $D200
AUDCTL      = $D208
HPOSP0      = $D000
SIZEP0      = $D008
DMACTL      = $D400
PMBASE      = $D407

; variables (RTVARS, bank-neutral RAM)
rendering   = RTVARS            ; non-zero while a redraw runs
render_cd   = RTVARS+1
frames      = RTVARS+2
rnd_lo      = RTVARS+3
rnd_hi      = RTVARS+4
rnd_out     = RTVARS+5
vt          = RTVARS+6
vlo_raw     = RTVARS+7
vhi_raw     = RTVARS+8
velo        = RTVARS+9
vres        = RTVARS+10
vc_fake     = RTVARS+11         ; $FF, or the renderer's VCOUNT
spk_last    = RTVARS+12
pad1        = RTVARS+13         ; SNES buttons, bit n = button n pressed
pad1h       = RTVARS+14
pad2        = RTVARS+15
pad2h       = RTVARS+16
snd_ch      = RTVARS+17
snd_c       = RTVARS+18
snd_f       = RTVARS+19
snd_n       = RTVARS+20
snd_p       = RTVARS+21         ; 2 bytes
snd_mix     = RTVARS+23         ; 2 bytes (one per AY)
col_m       = RTVARS+25
vt2         = RTVARS+26
snd_v       = RTVARS+27
ay_val      = RTVARS+28
ay_reg      = RTVARS+29
ay_chip     = RTVARS+30
snd_t      = RTVARS+31
ay_cache    = RTVARS+32         ; 32 bytes: AY 1 regs 0-15, AY 2 regs 0-15
snap_g      = RTVARS+64         ; 32: GTIA registers for the renderer
snap_a      = RTVARS+96         ; 16: ANTIC registers
snap_v      = RTVARS+112        ; 2: VDSLST
vct         = RTVARS+114        ; VCOUNT compare scratch (main code only)
RTVARS_END  = RTVARS+115

; =====================================================================
; Bank-neutral part (RAM2): entered with either language-card bank mapped
; =====================================================================
        .org RT_RAM2

irq_entry:
        pha
        lda MB2+V_IFR
        and #$40
        bne irq_tick
        pla
nmi_entry:
        rti
irq_tick:
        lda MB2+V_T1CL          ; acknowledge the tick
        lda SIG                 ; bank the interrupted code had mapped
        pha
        lda LCB2
        lda LCB2
        phx
        phy
        cld
        jsr vbi_rt
        tsx                     ; the interrupted code's P: the game's VBI
        lda $0105,x            ; skips its work when I was set there
        tay
        lda #>vbi_after         ; Atari VBI NMI frame: return, P, A, X, Y
        pha
        lda #<vbi_after
        pha
        tya
        pha
        pha
        pha
        pha
        jmp (VVBLKI)
vbi_after:
        sei
        cld                     ; the game's RTI restored the interrupted D
        lda rendering
        bne irq_out
        dec render_cd
        bne irq_out
        lda #RENDER_EVERY
        sta render_cd
        inc rendering
        cli
        jsr render_tramp
        sei
        stz rendering
irq_out:
        ply
        plx
        pla
        cmp #SIG_B1
        bne irq_b2
        lda LCB1
        lda LCB1
irq_b2: pla
        rti

; Snapshot the bank-2 registers and draw with bank 1 mapped.
render_tramp:
        ldx #$1F
rtr1:   lda $D000,x
        sta snap_g,x
        dex
        bpl rtr1
        ldx #$0F
rtr2:   lda $D400,x
        sta snap_a,x
        dex
        bpl rtr2
        lda VDSLST
        sta snap_v
        lda VDSLST+1
        sta snap_v+1
        lda LCB1
        lda LCB1
        jsr RENDER
        lda LCB2
        lda LCB2
        rts

; ---- RANDOM ($D20A) reads: a 16-bit LFSR mixed with a free-running timer
rnd_step:
        lda rnd_lo
        asl a
        rol rnd_hi
        bcc rs1
        eor #$2D
rs1:    sta rnd_lo
        eor MB1+V_T1CL
        sta rnd_out
        rts
rnd_a:  php                     ; LDA RANDOM
        jsr rnd_step
        plp
        lda rnd_out
        rts
rnd_y:  php                     ; LDY RANDOM
        pha
        jsr rnd_step
        pla
        plp
        ldy rnd_out
        rts
rnd_bit: php                    ; BIT RANDOM
        pha
        jsr rnd_step
        pla
        plp
        bit rnd_out
        rts
rnd_and: php                    ; AND RANDOM
        pha
        jsr rnd_step
        pla
        plp
        and rnd_out
        rts

; ---- VCOUNT ($D40B) reads: beam line from the first VIA's Timer 1, which
; runs in step with the 60 Hz tick (tick = Atari line 248, VCOUNT $7C).
vc_get: phx
        lda vc_fake
        cmp #$FF
        bne vg_done
vg_rd:  ldx MB1+V_T1CH
        lda MB1+V_T1CL
        cpx MB1+V_T1CH
        bne vg_rd
        stx vhi_raw
        sta vlo_raw
        sec
        lda #<TIMER_LATCH
        sbc vlo_raw
        sta velo
        lda #>TIMER_LATCH
        sbc vhi_raw
        tax                     ; elapsed / 256 (0..102)
        lda VCT,x               ; elapsed / 200 from the high byte
        sta vres
        lda VCR,x               ; remainder, plus the low byte
        clc
        adc velo
        bcs vg_c
        cmp #200
        bcc vg_add
        inc vres
        bra vg_add
vg_c:   inc vres
        cmp #144
        bcc vg_add
        inc vres
vg_add: lda vres
        clc
        adc #124
        cmp #131
        bcc vg_done
        sbc #131
vg_done: plx
        rts
vc_lda: php                     ; LDA VCOUNT
        jsr vc_get
        plp
        pha
        pla
        rts
vc_ldy: php                     ; LDY VCOUNT
        pha
        jsr vc_get
        tay
        pla
        plp
        iny
        dey
        rts
vc_cmp: php                     ; CMP VCOUNT (V kept, own scratch)
        pha
        jsr vc_get
        sta vct
        pla
        plp
        cmp vct
        rts
vc_cpy: php                     ; CPY VCOUNT
        pha
        jsr vc_get
        sta vct
        pla
        plp
        cpy vct
        rts

; ---- CONSOL ($D01F) stores: bit 3 drives the console speaker
spk_a:  php
        pha
        eor spk_last
        and #$08
        beq sp1
        bit SPEAKER
sp1:    pla
        sta spk_last
        sta $D01F
        plp
        rts

spk_x:  php                     ; STX CONSOL
        pha
        txa
        jsr spk_a
        pla
        plp
        rts

; ---- default VBI until the game installs its own (Atari XITVBV)
xitvbv: pla
        tay
        pla
        tax
        pla
        rti

; ---- RESET with the language card mapped: back to the ROM's reset
reset_entry:
        lda $C082
        jmp ($FFFC)

; ---- last loader stage, entered with interrupts off and bank 2 mapped.
; CFG_STASH holds $0000-$0FFF as the intro leaves it for the main game.
boot_final:
        ldx #0
bf1:    lda CFG_STASH,x         ; zero page, page 2, pages 4-5 and 9-15;
        sta $00,x               ; page 1 is the stack, 3 and 6-8 are ours
        lda CFG_STASH+$200,x
        sta $0200,x
        lda CFG_STASH+$400,x
        sta $0400,x
        lda CFG_STASH+$500,x
        sta $0500,x
        inx
        bne bf1
        lda #>(CFG_STASH+$900)
        sta bf3+2
        lda #$09
        sta bf4+2
bf2:    ldx #0
bf3:    lda $FF00,x
bf4:    sta $FF00,x
        inx
        bne bf3
        inc bf3+2
        inc bf4+2
        lda bf4+2
        cmp #$10
        bne bf2
        lda #<xitvbv            ; until the game's SETVBV
        sta VVBLKI
        lda #>xitvbv
        sta VVBLKI+1
        lda #<nmi_entry         ; what an Atari warm start leaves: no DLI
        sta VDSLST              ; handler, no screen, and a display list
        lda #>nmi_entry         ; without interrupts (the intro's are gone)
        sta VDSLST+1
        stz $022F
        lda #<blank_dl
        sta $0230
        lda #>blank_dl
        sta $0231
        lda #$FF
        sta vc_fake
        lda #1
        sta render_cd
        stz rendering
        lda #$20                ; clear hi-res page 1
        sta bf6+2
        lda #0
        ldx #0
bf6:    sta $2000,x
        inx
        bne bf6
        inc bf6+2
        ldy bf6+2
        cpy #$40
        bne bf6
        bit $C050               ; hi-res page 1, full screen
        bit $C052
        bit $C054
        bit $C057
        lda #$7F                ; no onboard VIA interrupts (PS/2 NMIs)
        sta PADIER
        ldx #$80                ; both Mockingboard VIAs
bf7:    lda #$FF
        sta MB1+V_DDRA,x
        lda #$07
        sta MB1+V_DDRB,x
        lda #$00                ; AY reset pulse
        sta MB1+V_ORB,x
        lda #$04
        sta MB1+V_ORB,x
        lda #$7F
        sta MB1+V_IER,x
        lda #$40                ; Timer 1 free-running
        sta MB1+V_ACR,x
        cpx #0
        beq bf8
        ldx #0
        bra bf7
bf8:    ldx #31                 ; nothing cached: first write goes out
bf9:    lda #$FF
        sta ay_cache,x
        dex
        bpl bf9
        lda #<TIMER_LATCH       ; start both timers back to back
        sta MB1+V_T1CL
        sta MB2+V_T1CL
        lda #>TIMER_LATCH
        sta MB1+V_T1CH
        sta MB2+V_T1CH
        lda #$C0                ; tick interrupt on
        sta MB2+V_IER
        ldx #$FF
        txs
        cli
        jsr bf_ini              ; Atari warm start: JSR (DOSINI), JMP (DOSVEC)
        jmp ($000A)
bf_ini: jmp ($000C)
blank_dl: .byte $70,$70,$70,$41,<blank_dl,>blank_dl
; ---- SETVBV ($E45C): A = 6 immediate / 7 deferred VBI, X = high, Y = low
setvbv: php
        sei
        cmp #7
        beq sv7
        sty VVBLKI
        stx VVBLKI+1
        plp
        rts
sv7:    sty VVBLKI+2
        stx VVBLKI+3
        plp
        rts

; elapsed/256*256/200 and its remainder, for elapsed/256 = 0..103
VCT:    .byte 0,1,2,3,5,6,7,8,10,11,12,14,15,16,17,19,20,21,23,24,25,26,28,29,30,32
        .byte 33,34,35,37,38,39,40,42,43,44,46,47,48,49,51,52,53,55,56,57,58,60,61,62
        .byte 64,65,66,67,69,70,71,72,74,75,76,78,79,80,81,83,84,85,87,88,89,90,92,93
        .byte 94,96,97,98,99,101,102,103,104,106,107,108,110,111,112,113,115,116,117,119,120,121
        .byte 122,124,125,126,128,129,130,131
VCR:    .byte 0,56,112,168,24,80,136,192,48,104,160,16,72,128,184,40,96,152,8,64,120,176,32,88,144,0
        .byte 56,112,168,24,80,136,192,48,104,160,16,72,128,184,40,96,152,8,64,120,176,32,88,144
        .byte 0,56,112,168,24,80,136,192,48,104,160,16,72,128,184,40,96,152,8,64,120,176,32,88
        .byte 144,0,56,112,168,24,80,136,192,48,104,160,16,72,128,184,40,96,152,8,64,120,176,32
        .byte 88,144,0,56,112,168,24,80
rt_ram2_end:

; =====================================================================
; Bank 2: per-tick work
; =====================================================================
        .org RT_B2

vbi_rt: jsr pad_scan
        jsr map_input
        jsr sound
        jsr collide
        inc frames
        rts

; ---- SNES pads, clocked directly (as the ROM's scan does, without NMIs)
pad_scan:
        stz pad1
        stz pad1h
        stz pad2
        stz pad2h
        stz PADORB
        lda #$40
        sta PADORB
        ldx #0
ps1:    stz PADORB
        lda PADORB
        eor #$FF
        sta vt
        lda #$80
        sta PADORB
        lda vt                  ; bit 5 pad 1, bit 4 pad 2 (1 = pressed)
        asl a
        asl a
        asl a                   ; pad 1 -> carry
        ror pad1h
        ror pad1
        asl a                   ; pad 2 -> carry
        ror pad2h
        ror pad2
        inx
        cpx #16
        bne ps1
        stz PADORB
        rts

; SNES bits: 0 B, 1 Y, 2 Select, 3 Start, 4 Up, 5 Down, 6 Left, 7 Right,
; 8 A, 9 X, 10 L, 11 R.  Pad 1 is Atari joystick 0, pad 2 joystick 1.
map_input:
        lda pad1
        jsr stick_nib
        sta vt
        lda pad2
        jsr stick_nib
        asl a
        asl a
        asl a
        asl a
        ora vt
        sta RA                  ; PORTA: sticks 0 and 1
        lda #$FF
        sta RA+1                ; PORTB: sticks 2 and 3 idle
        lda pad1
        ldx pad1h
        jsr trig_of
        sta RG+$10
        lda pad2
        ldx pad2h
        jsr trig_of
        sta RG+$11
        lda #1
        sta RG+$12
        sta RG+$13
        lda pad1                ; CONSOL: bit 0 START, 1 SELECT, 2 OPTION, 0 = down
        ora pad2
        sta vt
        lda pad1h
        ora pad2h
        sta vt2
        ldx #7
        lda vt
        and #$08                ; Start
        beq mi1
        txa
        and #$06
        tax
mi1:    lda vt
        and #$04                ; Select
        beq mi2
        txa
        and #$05
        tax
mi2:    lda vt2
        and #$0E                ; X, L or R = OPTION
        beq mi3
        txa
        and #$03
        tax
mi3:    stx RG+$1F
        rts
stick_nib:                      ; A = SNES low byte -> active-low U D L R
        lsr a
        lsr a
        lsr a
        lsr a
        eor #$0F
        rts
trig_of:                        ; B, Y or A pressed -> 0, else 1
        and #$03
        bne to0
        txa
        and #$01
        bne to0
        lda #1
        rts
to0:    lda #0
        rts

; ---- POKEY -> AY. Channels 1/3 on AY 1 tones A/B, 2/4 on AY 2 tones A/B.
sound:  stz snd_mix
        stz snd_mix+1
        stz snd_ch
snd_loop:
        lda snd_ch
        asl a
        tax
        lda AUDF1,x
        sta snd_f
        lda AUDF1+1,x
        sta snd_c
        lda snd_f               ; 64 kHz clock: period = (f+1) * 3.06
        clc
        adc #1
        sta snd_n
        lda #0
        rol a
        sta snd_p+1
        sta vt
        lda snd_n
        sta snd_p
        asl snd_p
        rol snd_p+1
        clc
        lda snd_p
        adc snd_n
        sta snd_p
        lda snd_p+1
        adc vt
        sta snd_p+1
        lda snd_n
        lsr vt
        ror a
        lsr a
        lsr a
        lsr a
        clc
        adc snd_p
        sta snd_p
        bcc sn1
        inc snd_p+1
sn1:    lda AUDCTL              ; 15 kHz clock: four times longer
        and #$01
        beq sn2
        asl snd_p
        rol snd_p+1
        asl snd_p
        rol snd_p+1
sn2:    lda snd_ch              ; 1.79 MHz on channel 1 or 3: (f+4) / 8
        and #$01
        bne sn4
        lda snd_ch
        bne sn3
        lda AUDCTL
        and #$40
        beq sn4
        bne sn3a
sn3:    lda AUDCTL
        and #$20
        beq sn4
sn3a:   lda snd_f
        clc
        adc #4
        lsr a
        lsr a
        lsr a
        sta snd_p
        stz snd_p+1
sn4:    lda snd_p+1             ; clamp to 12 bits
        cmp #$10
        bcc sn5
        lda #$FF
        sta snd_p
        lda #$0F
        sta snd_p+1
sn5:    lda snd_ch              ; chip X = ch & 1, tone T = ch >> 1
        and #$01
        tax
        lda snd_ch
        lsr a
        sta snd_t
        lda snd_c
        and #$10                ; volume-only: silent here
        bne sn_mute
        lda snd_c
        and #$0F
        beq sn_mute
        sta snd_v
        lda snd_t
        asl a
        tay
        lda snd_p
        jsr ay_set
        iny
        lda snd_p+1
        jsr ay_set
        lda snd_t
        clc
        adc #8
        tay
        lda snd_v
        jsr ay_set
        lda snd_c               ; pure tones and the buzz tones stay tones
        and #$E0
        cmp #$A0
        beq sn_tone
        cmp #$E0
        beq sn_tone
        cmp #$C0
        beq sn_tone
        cmp #$40
        beq sn_tone
        lda snd_f               ; noise, period from the divider
        lsr a
        lsr a
        lsr a
        ldy #6
        jsr ay_set
        ldy snd_t
        lda noise_bit,y
        bra sn_mixin
sn_tone:
        ldy snd_t
        lda tone_bit,y
sn_mixin:
        ora snd_mix,x
        sta snd_mix,x
        bra sn_next
sn_mute:
        lda snd_t
        clc
        adc #8
        tay
        lda #0
        jsr ay_set
sn_next:
        inc snd_ch
        lda snd_ch
        cmp #4
        beq sn_done
        jmp snd_loop
sn_done:
        ldx #0                  ; mixer: enables are active low on the AY
        lda snd_mix
        eor #$3F
        ldy #7
        jsr ay_set
        ldx #1
        lda snd_mix+1
        eor #$3F
        ldy #7
        jmp ay_set
tone_bit:   .byte $01,$02
noise_bit:  .byte $08,$10
chip_off:   .byte $00,$80

; A = value, Y = register, X = chip (0/1); X and Y preserved. Unchanged
; registers are not rewritten.
ay_set: sta ay_val
        sty ay_reg
        stx ay_chip
        txa
        asl a
        asl a
        asl a
        asl a
        ora ay_reg
        tax
        lda ay_val
        cmp ay_cache,x
        beq ays_x
        sta ay_cache,x
        ldx ay_chip
        lda chip_off,x
        tax
        lda ay_reg
        sta MB1+V_ORA,x         ; latch address
        lda #$07
        sta MB1+V_ORB,x
        lda #$04
        sta MB1+V_ORB,x
        lda ay_val              ; write data
        sta MB1+V_ORA,x
        lda #$06
        sta MB1+V_ORB,x
        lda #$04
        sta MB1+V_ORB,x
ays_x:  ldx ay_chip
        ldy ay_reg
        rts
; ---- player collisions: P0 against P1-P3 (P0PL) from the VBI positions
collide:
        stz RG+$0C
        stz RG+$04
        lda DMACTL
        and #$0C
        beq cl_done
        lda PMBASE
        and #$F8
        clc
        adc #$04
        sta cl_p0+2
        adc #$01
        sta cl_p1+2
        adc #$01
        sta cl_p2+2
        adc #$01
        sta cl_p3+2
        ldy #$20
cl_row: 
cl_p0:  lda $FF00,y
        beq cl_next
        sta col_m
        ldx #1
cl_pl:
        jsr cl_test
        inx
        cpx #4
        bne cl_pl
cl_next:
        iny
        cpy #$F8
        bne cl_row
cl_done:
        rts
cl_test:                        ; P0 row Y against player X
        txa
        cmp #1
        bne ct2
cl_p1:  lda $FF00,y
        bra ct4
ct2:    cmp #2
        bne ct3
cl_p2:  lda $FF00,y
        bra ct4
ct3:
cl_p3:  lda $FF00,y
ct4:    beq ct_no
        lda HPOSP0,x            ; |HPOSPx - HPOSP0| < 8 (normal width)
        sec
        sbc HPOSP0
        bcs ct5
        eor #$FF
        adc #1
ct5:    cmp #8
        bcs ct_no
        lda col_bits,x
        ora RG+$0C
        sta RG+$0C
ct_no:  rts
col_bits:   .byte $00,$02,$04,$08
rt_b2_end:
