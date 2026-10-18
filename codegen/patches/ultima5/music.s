; Ultima V for 3RIC - compact Mockingboard music player (bank 1, after the
; shim). Plays Origin's songs from SONGnn files that port-ultima5.mjs
; repacks from the 128K edition's driver data (MUFF/MUIN/MUDR) and follows
; that driver's per-tick algorithm (sequencer, two envelopes, register
; shadow + flush, request interface $80-$83); see docs/porting-logs/
; ultima-v.md. Differences, all forced by the 64K machine: one song is held
; at a time (SONGBUF), loaded by the foreground (mus_fg, from pad_poll) when
; the tick asks for it - the tick stays silent until then and a song that
; does not fit the buffer is simply not played; pause silences at once
; instead of fading; note periods, the noise period and the timer latch are
; pre-scaled for 3RIC's 1.5734 MHz Mockingboard clock by the tool.
;
; SONGBUF: +0 voices played (1-6), +1 tracks, +2 six voice start pointers,
; +14 track pointers, then the event streams (pointers absolute). Events are
; the original's except: $32 (tempo) carries the scaled T1 latch (2 bytes),
; $34 (instrument) carries the record offset in INSTAB, $38/$3F are dropped.
;
; State lives in RAM2 (ram2.inc). The tick runs from the resident IRQ with
; bank 1 mapped and uses $F8/$F9 (saved) as the event pointer.

P           = $F8

; ---- low code region (after the shim, below the $D600 block buffer) ----

; A = a * 16 + b -> round(a * b / 15) (Origin's volume table at MUDR $7D00;
; the tool checks the identity against it). Keeps X and Y.
vt:
        phy
        sta VT_T
        and #$0F
        sta VT_B
        lda VT_T
        lsr
        lsr
        lsr
        lsr
        tay
        lda #7
vt_mul:
        dey
        bmi vt_div
        clc
        adc VT_B
        bra vt_mul
vt_div:
        ldy #$FF
        sec
vt_q:
        iny
        sbc #15
        bcs vt_q
        tya
        ply
        rts

; Write every shadow register that changed: AY1 R10..R0, then AY0 R10..R0.
flush:
        ldx #21
fl_loop:
        lda SHADOW,x
        cmp WRITTEN,x
        beq fl_next
        sta WRITTEN,x
        txa
        ldy #0
        cpx #11
        bcc fl_write
        sbc #11
        ldy #$80
fl_write:
        sta MB_ORA,y            ; latch the register number
        lda #$FF
        sta MB_ORB,y
        lda #$FC
        sta MB_ORB,y
        lda SHADOW,x            ; write its value
        sta MB_ORA,y
        lda #$FE
        sta MB_ORB,y
        lda #$FC
        sta MB_ORB,y
fl_next:
        dex
        bpl fl_loop
        rts

; ---------------------------------------------------------------------------
; Foreground side.

; MAIN.SUBS dispatcher via glue.s: X = $06 pause, $09 resume, $0C stop.
; Pause silences at once and stops the timer; resume restarts it and lets
; the volume ramp back. Preserves Y.
mus_ctl_b1:
        lda MUS_IER
        beq mc_out              ; no Mockingboard
        cpx #$0C
        bne mc_pr
        stz IF80                ; stop: the next tick silences
mc_out:
        rts
mc_pr:
        php
        sei
        cpx #$09
        beq mc_resume
        cmp #$C0                ; pause, unless already paused
        bne mc_done
        lda IF80+2
        beq mc_off
        lda IF80+3
        sta SAVE83
        stz IF80+3
        stz CURVOL
        ldx #2
mc_mute:
        stz SHADOW+8,x
        stz SHADOW+11+8,x
        dex
        bpl mc_mute
        phy
        jsr flush
        ply
mc_off:
        lda #$40
        bra mc_ier
mc_resume:
        cmp #$40
        bne mc_done
        lda SAVE83
        sta IF80+3
        lda #$C0
mc_ier:
        sta MUS_IER
        sta MB_IER
mc_done:
        plp
        rts

; Load the song the tick is waiting for (from pad_poll: X and Y are saved
; there; only the ROM's zero page is used, and rom_begin/rom_end keep it).
mus_fg:
        lda WANT
        beq mf_out
        php
        sei
        lda WANT
        stz WANT
        stz LOADED              ; the buffer is ours until LOADED is set
        stz CUR
        plp
        sta mf_song
        ldx #3
mf_name:
        lda s_song,x
        sta key,x
        dex
        bpl mf_name
        lda mf_song             ; "SONGnn", nn decimal
        ldx #'0'-1
        sec
mf_tens:
        inx
        sbc #10
        bcs mf_tens
        adc #'0'+10
        sta key+5
        stx key+4
        lda #' '
        sta key+6
        sta key+7
        jsr rom_begin
        jsr open_key
        bcs mf_end
        lda FAT_SIZE+1          ; a stale SD card's song must still fit
        cmp #>SONGMAX
        bcc mf_read
        bne mf_end
        lda FAT_SIZE
        cmp #<SONGMAX
        bcs mf_end
mf_read:
        ldx #<SONGBUF
        ldy #>SONGBUF
        jsr read_file
        lda mf_song
        sta LOADED
mf_end:
        jsr rom_end
mf_out:
        rts

mf_song:    .byte 0
s_song:     .text "SONG"

rd:
        lda (P)
        inc P
        bne rd_done
        inc P+1
rd_done:
        rts

reset_pd:                       ; pitch $3C, duration indices 3 / 4
        lda #$3C
        sta V_PITCH,x
        lda #3
        sta V_DURA,x
        lda #4
        sta V_DURB,x
        rts

music_lo_end:
        .org MUSIC_HI

; ---- high code region ($D800-) ----

; Resident timer IRQ: one tick of the driver.
mus_tick:
        lda MB_T1CL             ; acknowledge T1
        ldx #3
mt_zsave:
        lda P,x
        sta ZPSAVE,x
        lda SWAPPED             ; the game has the interface mapped at $80
        beq mt_zs1
        lda $80,x
        sta IF80,x
mt_zs1:
        dex
        bpl mt_zsave
        jsr sequencer
        jsr flush
        lda LATCHL
        sta MB_T1LL
        lda LATCHH
        sta MB_T1LH
        ldx #3
mt_zrest:
        lda ZPSAVE,x
        sta P,x
        lda SWAPPED
        beq mt_zr1
        lda IF80,x
        sta $80,x
mt_zr1:
        dex
        bpl mt_zrest
        rts

sequencer:
        lda CURVOL              ; ramp the volume toward $83: +3 / -5
        cmp IF80+3
        beq sq_req
        bcs sq_down
        adc #3
        bcs sq_cap
        cmp IF80+3
        bcc sq_vol
sq_cap:
        lda IF80+3
        bra sq_vol
sq_down:
        sbc #5
        bcc sq_cap
        cmp IF80+3
        bcc sq_cap
sq_vol:
        sta CURVOL
sq_req:
        lda IF80                ; $80: song to play now
        and #$7F
        sta IF80
        beq sq_stop
        cmp #16
        bcc sq_new
        lda IF80+2              ; > 15: keep the current one
        sta IF80
        beq sq_rts
sq_new:
        cmp IF80+2
        beq sq_cur
        jsr start_song
sq_cur:
        lda CUR
        cmp IF80+2
        beq sq_run
        lda LOADED              ; waiting for the foreground's load
        cmp IF80+2
        bne sq_rts
        jsr start_song
sq_run:
        lda #$FF
        sta ALLDONE
        ldx NPLAY
        dex
sq_voice:
        lda V_DONE,x
        bne sq_env
        stz ALLDONE
        dec V_DUR,x
        bne sq_env
        jsr parse
        bcs sq_next             ; voice ended: no envelope this tick
sq_env:
        jsr envelope
sq_next:
        dex
        bpl sq_voice
        lda ALLDONE
        beq sq_rts
        lda IF80+1              ; every voice ended: chain ($81)
        beq sq_stop
        cmp #16
        bcc sq_chain
        lda IF80+2
        sta IF80+1
sq_chain:
        sta IF80
        jsr start_song
        lda CUR
        bne sq_run
sq_rts:
        rts
sq_stop:
        stz IF80
        lda IF80+2
        beq sq_rts
        stz IF80+2
        stz CUR
        jmp silence

; A = song: make it current; play it from SONGBUF if loaded, else ask the
; foreground for it and stay silent.
start_song:
        sta IF80+2
        jsr silence
        lda #<DEFLATCH
        sta LATCHL
        lda #>DEFLATCH
        sta LATCHH
        lda IF80+3
        sta CURVOL
        lda IF80+2
        cmp LOADED
        beq ss_go
        sta WANT
        stz CUR
        rts
ss_go:
        sta CUR
        lda SONGBUF
        sta NPLAY
        tax
        dex
ss_voice:
        txa
        asl
        tay
        lda SONGBUF+2,y
        sta V_PTRL,x
        lda SONGBUF+3,y
        sta V_PTRH,x
        stz V_TRANS,x
        stz V_DONE,x
        stz V_LAST,x
        stz V_DEPTH,x
        stz V_VST,x
        stz V_PST,x
        stz V_VENL,x
        stz V_VENH,x
        stz V_PENL,x
        stz V_PENH,x
        lda #$FF
        sta V_LEVEL,x
        lda #1
        sta V_DUR,x
        jsr reset_pd
        dex
        bpl ss_voice
        rts

silence:                        ; all registers 0, mixer all off
        ldx #21
sl_loop:
        stz SHADOW,x
        dex
        bpl sl_loop
        lda #$3F
        sta SHADOW+7
        sta SHADOW+11+7
        rts

; ---------------------------------------------------------------------------
; Voice X: read events up to the next note or rest. Carry set if it ended.

parse:
        lda V_PTRL,x
        sta P
        lda V_PTRH,x
        sta P+1
ps_next:
        jsr rd
        sta EVB
        and #3
        beq ps_dura
        cmp #2
        beq ps_durb
        cmp #1
        bne ps_cmd
        jsr rd                  ; duration index in the next byte
        bra ps_note
ps_dura:
        lda V_DURA,x
        bra ps_note
ps_durb:
        lda V_DURB,x
ps_note:
        tay
        lda DURTAB,y
        sta V_DUR,x
        lda EVB
        lsr
        lsr
        and #$1F
        bne ps_tone
        lda #4                  ; rest: release both envelopes
        sta V_VST,x
        sta V_PST,x
        stz V_LAST,x
        bra ps_save
ps_tone:
        clc                     ; pitch += step - 16
        adc V_PITCH,x
        sec
        sbc #16
        sta V_PITCH,x
        clc
        adc V_TRANS,x
        sec
        sbc #NOTE_LO
        cmp #NOTES
        bcc ps_per
        lda #NOTES-1            ; outside the period table (never in the data)
ps_per:
        tay
        lda PERH,y
        pha
        lda PERL,y
        ldy VPER,x
        sta SHADOW,y
        pla
        sta SHADOW+1,y
        lda V_LAST,x            ; tied from the previous note: no retrigger
        bmi ps_tied
        lda #1
        sta V_VST,x
        sta V_PST,x
ps_tied:
        lda EVB
        sta V_LAST,x
ps_save:
        lda P
        sta V_PTRL,x
        lda P+1
        sta V_PTRH,x
        clc
        rts

ps_cmd:
        lda EVB
        lsr
        lsr
        cmp #$18
        bcs ps_c1
        sta V_DURA,x
        jmp ps_next
ps_c1:
        cmp #$30
        bcs ps_c2
        sbc #$17                ; carry clear: - $18
        sta V_DURB,x
        jmp ps_next
ps_c2:
        sbc #$30
        beq ps_pitch
        dec a
        beq ps_trans
        dec a
        beq ps_tempo
        dec a
        beq ps_level
        dec a
        beq ps_inst
        cmp #$3C-$34
        beq ps_call
        cmp #$3D-$34
        beq ps_ret
        cmp #$3E-$34
        beq ps_end
        jmp ps_next             ; the tool rejects other commands
ps_pitch:
        jsr rd
        sta V_PITCH,x
        jmp ps_next
ps_trans:
        jsr rd
        sta V_TRANS,x
        jmp ps_next
ps_tempo:
        jsr rd
        sta LATCHL
        jsr rd
        sta LATCHH
        jmp ps_next
ps_level:
        jsr rd
        sta V_LEVEL,x
        jmp ps_next
ps_inst:
        jsr rd
        sta V_INST,x
        tay                     ; R7 = R7 with this channel's bits from flags
        lda INSTAB+22,y
        ldy VR6,x
        eor SHADOW+1,y
        and VMIX,x
        eor SHADOW+1,y
        sta SHADOW+1,y
        jmp ps_next
ps_call:
        jsr rd
        asl
        tay
        lda P
        sta V_SPL,x
        lda P+1
        sta V_SPH,x
        inc V_DEPTH,x
        lda SONGBUF+14,y
        sta P
        lda SONGBUF+15,y
        bra ps_jump
ps_ret:
        lda V_DEPTH,x
        beq ps_end
        dec V_DEPTH,x
        lda V_SPL,x
        sta P
        lda V_SPH,x
ps_jump:
        sta P+1
        jsr reset_pd
        jmp ps_next
ps_end:
        lda #$FF
        sta V_DONE,x
        lda #4
        sta V_VST,x
        sta V_PST,x
        sec
        rts

; ---------------------------------------------------------------------------
; Voice X: envelope step and its register writes.

envelope:
        ldy V_INST,x
        jsr env_step            ; volume envelope
        beq ev_pitch            ; idle: no volume write
        cmp #4
        beq ev_vol
        lda V_LAST,x            ; stages 1-3: release when dur <= R_time
        bmi ev_vol
        lda INSTAB+10,y
        cmp V_DUR,x
        bcc ev_vol
        lda #4
        sta V_VST,x
ev_vol:
        lda V_LEVEL,x           ; T[(vol & $F0) | T[(level & $F0) | env_hi]]
        and #$F0
        ora V_VENH,x
        jsr vt
        sta VT_B
        lda CURVOL
        and #$F0
        ora VT_B
        jsr vt
        phy
        ldy VVOL,x
        sta SHADOW,y
        ply
ev_pitch:
        lda INSTAB+22,y         ; flags & $38: no noise, nothing more
        sta EVB
        and #$38
        bne ev_done
        bit EVB
        bpl ev_noise
        phx                     ; bit 7: pitch envelope
        phy
        txa
        clc
        adc #18             ; 3*NV
        tax
        tya
        adc #11
        tay
        jsr env_step
        ply
        plx
        cmp #0
        beq ev_noise
        cmp #4
        beq ev_noise
        lda V_LAST,x            ; stages 1-3: release when dur < PR_time
        bmi ev_noise
        lda V_DUR,x
        cmp INSTAB+21,y
        bcs ev_noise
        lda #4
        sta V_PST,x
ev_noise:
        lda #0                  ; R6 = -((pitch >> 2 if bit 6) + env2_hi if bit 7)
        bit EVB
        bvc en_env
        lda V_PITCH,x
        lsr
        lsr
en_env:
        bit EVB
        bpl en_neg
        clc
        adc V_PENH,x
en_neg:
        eor #$FF
        inc a
        and #$1F
        tay
        lda NOISE,y
        ldy VR6,x
        sta SHADOW,y
ev_done:
        rts

; One envelope: X = voice (+18 = 3*NV for the pitch envelope), Y = instrument
; record (+11). Returns A = stage before the step, Z set if idle.
env_step:
        lda V_VST,x
        bne es_go
        rts
es_go:
        pha
        cmp #2
        beq es_decay
        bcs es_34
        clc                     ; 1 attack: + rate; carry or >= peak -> peak
        lda V_VENL,x
        adc INSTAB+0,y
        sta V_VENL,x
        lda V_VENH,x
        adc INSTAB+1,y
        sta V_VENH,x
        bcs es_peak
        lda V_VENL,x
        cmp INSTAB+2,y
        lda V_VENH,x
        sbc INSTAB+3,y
        bcc es_done
es_peak:
        lda INSTAB+2,y
        sta V_VENL,x
        lda INSTAB+3,y
        sta V_VENH,x
        lda #2
        bra es_stage
es_decay:                       ; 2 decay: - rate; borrow or < sustain -> sustain
        sec
        lda V_VENL,x
        sbc INSTAB+4,y
        sta V_VENL,x
        lda V_VENH,x
        sbc INSTAB+5,y
        sta V_VENH,x
        bcc es_sus
        lda V_VENL,x
        cmp INSTAB+6,y
        lda V_VENH,x
        sbc INSTAB+7,y
        bcs es_done
es_sus:
        lda INSTAB+6,y
        sta V_VENL,x
        lda INSTAB+7,y
        sta V_VENH,x
        lda #3
        bra es_stage
es_34:
        cmp #4
        bne es_done             ; 3 sustain
        sec                     ; 4 release: - rate; borrow -> 0, idle
        lda V_VENL,x
        sbc INSTAB+8,y
        sta V_VENL,x
        lda V_VENH,x
        sbc INSTAB+9,y
        sta V_VENH,x
        bcs es_done
        stz V_VENL,x
        stz V_VENH,x
        lda #0
es_stage:
        sta V_VST,x
es_done:
        pla
        rts

