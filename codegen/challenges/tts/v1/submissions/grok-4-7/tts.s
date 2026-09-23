; Wirethroat — original 3RIC Talks engine for Grok 4.7.
; Formant squares on the slot-4 Mockingboard, amplitude-pulsed by the AY envelope.
; Pronunciation rules and voice numbers are original. Not a port of another TTS.
;
; AY bus sequence and VIA reset are adapted from codegen/programs/groovebox.s
; (3RIC, Eric Badger, MIT). Port B bit0=BC1, bit1=BDIR, bit2=active-low reset.
;
; ABI (clobbers A/X/Y/flags; no zero page; no IRQ left enabled):
;   TTS_INIT  — select BASIC ROM window, reset both AYs, silence, RTS
;   TTS_SPEAK — A/X = pointer to NUL-terminated ASCII; RTS A=0 done, 1 cancel, 2 bad
;   TTS_INPUT — 122-byte caller buffer
; Upper ROM stays visible. Sound is silent on every return.
; Load: BRUN TTS.PRG 0800. All code and tables are in always-mapped RAM.
; TTS_INIT does not touch $C006/$C007. Every ABI return reads $C082 so upper
; ROM is visible and language-card writes are off, even if the caller had
; banked RAM over $D000-$FFFF.

        .org $0800

MB      = $C400
ORB     = 0
ORA     = 1
DDRB    = 2
DDRA    = 3
ACR     = 11
IFR     = 13
IER     = 14
KBD     = $C000
KSTRB   = $C010
BASIC   = $C006
TEXT    = $C051
FULL    = $C052
PAGE1   = $C054
SER     = $C100
FWAIT   = 14

PGAP = 1
PCOM = 2
PSTP = 3
PQRY = 4
VAE = 5
VEH = 6
VIH = 7
VAA = 8
VAH = 9
VAO = 10
VUH = 11
VER = 12
VEY = 13
VIY = 14
VAY = 15
VOW = 16
VUW = 17
VAW = 18
VOY = 19
CP  = 20
CB  = 21
CT  = 22
CD  = 23
CK  = 24
CG  = 25
CF  = 26
CV  = 27
CTH = 28
CDH = 29
CS  = 30
CZ  = 31
CSH = 32
CZH = 33
CHH = 34
CM  = 35
CN  = 36
CNG = 37
CL  = 38
CR  = 39
CW  = 40
CY  = 41
CCH = 42
CJH = 43

        jmp app_start

TTS_INIT:
        cld
        jsr show_rom
        jsr init_chips
        jsr show_rom
        rts

TTS_SPEAK:
        cld
        jsr show_rom
        sta srclo
        stx srchi
        lda readyf
        bne sp_bus
        jsr init_chips
sp_bus:
        jsr ensure_bus
        jsr validate
        bcs sp_bad
        lda haslet
        beq sp_empty
        jsr copy_norm
        jsr g2p
        jmp play
sp_bad:
        stz spoke
        jsr silence_vols
        jsr show_rom
        lda #2
        rts
sp_empty:
        stz spoke
        jsr silence_vols
        jsr show_rom
        lda #0
        rts

; --- validation: at most 121 characters, then stop ---------------------------
validate:
        stz haslet
        stz qflag
        ldy #0
vloop:
        jsr fetch
        beq v_end
        jsr classify
        bcs v_bad
        iny
        cpy #121
        bne vloop
        sec
        rts
v_end:
        sty inlen
        clc
        rts
v_bad:
        sec
        rts

classify:
        cmp #'A'
        bcc cl_sym
        cmp #'Z'+1
        bcc cl_let
        cmp #'a'
        bcc cl_sym
        cmp #'z'+1
        bcs cl_sym
cl_let:
        lda #1
        sta haslet
        clc
        rts
cl_sym:
        cmp #$20
        beq cl_ok
        cmp #$27
        beq cl_ok
        cmp #$2D
        beq cl_ok
        cmp #$2E
        beq cl_ok
        cmp #$2C
        beq cl_ok
        cmp #$21
        beq cl_ok
        cmp #$3F
        bne cl_no
        lda #1
        sta qflag
cl_ok:
        clc
        rts
cl_no:
        sec
        rts

fetch:
        lda srclo
        sta fetchld+1
        lda srchi
        sta fetchld+2
fetchld:
        lda $FFFF,y
        rts

copy_norm:
        ldy #0
copylp:
        cpy inlen
        bcs cn_done
        jsr fetch
        cmp #'a'
        bcc cn_st
        cmp #'z'+1
        bcs cn_st
        and #$DF
cn_st:
        sta NORM,y
        iny
        jmp copylp
cn_done:
        lda #0
        sta NORM,y
        rts

; --- grapheme walk -----------------------------------------------------------
g2p:
        stz phcount
        stz srci
gp:
        ldy srci
        lda NORM,y
        beq gp_end
        cmp #$20
        beq gp_sp
        cmp #$2D
        beq gp_sp
        cmp #$2C
        beq gp_com
        cmp #$2E
        beq gp_stp
        cmp #$21
        beq gp_stp
        cmp #$3F
        beq gp_qry
        jsr take_word
        lda wordlen
        beq gp
        jsr match_ex
        bcs gp
        jsr rules_word
        jmp gp
gp_sp:
        inc srci
        ldy srci
        lda NORM,y
        cmp #$20
        beq gp_sp
        cmp #$2D
        beq gp_sp
        lda #PGAP
        jsr emit
        jmp gp
gp_com:
        inc srci
        lda #PCOM
        jsr emit
        jsr skip_sp
        jmp gp
gp_stp:
        inc srci
        lda #PSTP
        jsr emit
        jsr skip_sp
        jmp gp
gp_qry:
        inc srci
        lda #1
        sta qflag
        lda #PQRY
        jsr emit
        jsr skip_sp
        jmp gp
gp_end:
        lda #0
        ldx phcount
        sta PHBUF,x
        rts

skip_sp:
        ldy srci
        lda NORM,y
        cmp #$20
        bne ss_done
        inc srci
        jmp skip_sp
ss_done:
        rts

take_word:
        stz wordlen
tw:
        ldy srci
        lda NORM,y
        beq tw_done
        cmp #$20
        beq tw_done
        cmp #$2D
        beq tw_done
        cmp #$2C
        beq tw_done
        cmp #$2E
        beq tw_done
        cmp #$21
        beq tw_done
        cmp #$3F
        beq tw_done
        cmp #$27
        beq tw_ap
        ldx wordlen
        cpx #120
        bcs tw_ap
        sta WORDBUF,x
        inc wordlen
tw_ap:
        inc srci
        jmp tw
tw_done:
        rts

emit:
        ldx phcount
        cpx #254
        bcs em_full
        sta PHBUF,x
        inc phcount
em_full:
        rts

adv_sec:
        jsr adv
        sec
        rts

adv:
        clc
        adc wi
        sta wi
        rts

; Exception words supplement the rules. Records: len, text, nphon, phones..., 0.
match_ex:
        lda #<EXCEPT
        sta ptrlo
        lda #>EXCEPT
        sta ptrhi
mex:
        ldy #0
        jsr mem_y
        beq mex_no
        sta exlen
        cmp wordlen
        bne mex_skip
        ldx #0
mex_c:
        cpx wordlen
        bcs mex_ph
        txa
        tay
        iny
        jsr mem_y
        cmp WORDBUF,x
        bne mex_skip
        inx
        jmp mex_c
mex_ph:
        ldy wordlen
        iny
        jsr mem_y
        sta leftn
        beq mex_yes
mex_em:
        iny
        jsr mem_y
        jsr emit
        dec leftn
        bne mex_em
mex_yes:
        sec
        rts
mex_skip:
        ldy exlen
        iny
        jsr mem_y
        clc
        adc exlen
        adc #2
        jsr add_ptr
        jmp mex
mex_no:
        clc
        rts

rules_word:
        jsr mark_long
        stz wi
rw:
        ldx wi
        cpx wordlen
        bcs rw_done
        lda WORDBUF,x
        sta c0
        jsr load_c1c2
        jsr match_pat
        bcs rw
        jsr rule_vowel
        bcs rw
        jsr rule_cons
        bcs rw
        inc wi
        jmp rw
rw_done:
        jmp voice_s

mark_long:
        lda #$FF
        sta longat
        jsr ends_are
        bcs ml_y
        lda wordlen
        cmp #3
        bcc ml_y
        ldy wordlen
        dey
        lda WORDBUF,y
        cmp #'E'
        bne ml_y
        dey
        lda WORDBUF,y
        jsr is_vowel
        bcs ml_y
        cpy #0
        beq ml_hide
        dey
        lda WORDBUF,y
        jsr is_vowel
        bcc ml_two
        sty longat
        dec wordlen
        jmp ml_y
ml_two:
        jsr has_earlier
        bcc ml_y
ml_hide:
        dec wordlen
ml_y:
        ldy wordlen
        beq ml_done
        dey
        lda WORDBUF,y
        cmp #'Y'
        bne ml_done
        cpy #2
        bcc ml_done
        dey
        lda WORDBUF,y
        jsr is_vowel
        bcs ml_done
        dey
        lda WORDBUF,y
        jsr is_vowel
        bcc ml_done
        sty longat
ml_done:
        rts

ends_are:
        lda wordlen
        cmp #3
        bcc ea_no
        ldy wordlen
        dey
        lda WORDBUF,y
        cmp #'E'
        bne ea_no
        dey
        lda WORDBUF,y
        cmp #'R'
        bne ea_no
        dey
        lda WORDBUF,y
        cmp #'A'
        bne ea_no
        sec
        rts
ea_no:
        clc
        rts

has_earlier:
        ldx wordlen
        dex
        stx hevlim
        ldx #0
hev:
        cpx hevlim
        bcs hev_no
        lda WORDBUF,x
        jsr is_vowel
        bcs hev_yes
        inx
        jmp hev
hev_yes:
        sec
        rts
hev_no:
        clc
        rts

load_c1c2:
        stz c1
        stz c2
        stz c3
        ldx wi
        inx
        cpx wordlen
        bcs lc_done
        lda WORDBUF,x
        sta c1
        inx
        cpx wordlen
        bcs lc_done
        lda WORDBUF,x
        sta c2
        inx
        cpx wordlen
        bcs lc_done
        lda WORDBUF,x
        sta c3
lc_done:
        rts

; Pattern records: flags, len, chars, nphon, phones. $FF ends.
; flags bit0 = word start, bit1 = must end at word end.
match_pat:
        lda #<PATS
        sta ptrlo
        lda #>PATS
        sta ptrhi
mp:
        ldy #0
        jsr mem_y
        cmp #$FF
        bne mp_go
        jmp mp_no
mp_go:
        sta pflags
        iny
        jsr mem_y
        sta plen
        ldx #0
mp_c:
        cpx plen
        bcs mp_ctx
        txa
        clc
        adc wi
        cmp wordlen
        bcs mp_skip
        tay
        lda WORDBUF,y
        sta ptmp
        txa
        clc
        adc #2
        tay
        jsr mem_y
        cmp ptmp
        bne mp_skip
        inx
        jmp mp_c
mp_ctx:
        lda pflags
        and #1
        beq mp_endf
        lda wi
        bne mp_skip
mp_endf:
        lda pflags
        and #2
        beq mp_em
        lda wi
        clc
        adc plen
        cmp wordlen
        bne mp_skip
mp_em:
        lda plen
        clc
        adc #2
        tay
        jsr mem_y
        sta leftn
        beq mp_adv
mp_el:
        iny
        jsr mem_y
        jsr emit
        dec leftn
        bne mp_el
mp_adv:
        lda plen
        jmp adv_sec
mp_skip:
        ldy plen
        iny
        iny
        jsr mem_y
        clc
        adc plen
        adc #3
        jsr add_ptr
        jmp mp
mp_no:
        clc
        rts

rule_vowel:
        lda c0
        jsr is_vowel
        bcs rv_yes
        clc
        rts
rv_yes:
        lda c0
        cmp #'Y'
        bne rv_e
        lda wi
        bne rv_e
        lda c1
        jsr is_vowel
        bcc rv_e
        clc
        rts
rv_e:
        lda c0
        cmp #'E'
        bne rv_o
        ldx wi
        inx
        cpx wordlen
        bne rv_o
        jsr only_one
        bcc rv_o
        lda #VIY
        jsr emit
        lda #1
        jmp adv_sec
rv_o:
        lda c0
        cmp #'O'
        bne rv_y
        ldx wi
        inx
        cpx wordlen
        bne rv_y
        jsr emit_ow
        lda #1
        jmp adv_sec
rv_y:
        lda c0
        cmp #'Y'
        bne rv_i
        ldx wi
        inx
        cpx wordlen
        bne rv_i
        jsr only_one
        bcc rv_yiy
        jsr emit_ay
        lda #1
        jmp adv_sec
rv_yiy:
        lda #VIY
        jsr emit
        lda #1
        jmp adv_sec
rv_i:
        lda c0
        cmp #'I'
        bne rv_len
        ldx wi
        inx
        cpx wordlen
        bne rv_len
        jsr emit_ay
        lda #1
        jmp adv_sec
rv_len:
        jsr want_long
        bcc rv_sh
        jsr emit_long
        lda #1
        jmp adv_sec
rv_sh:
        jsr emit_short
        lda #1
        jmp adv_sec

want_long:
        lda wi
        cmp longat
        beq wl_yes
        lda c1
        jsr is_vowel
        bcs wl_no
        lda c2
        cmp #'E'
        bne wl_no
        lda c3
        cmp #'R'
        bne wl_no
wl_yes:
        sec
        rts
wl_no:
        clc
        rts

emit_ow:
        lda #VAO
        jsr emit
        lda #VUH
        jmp emit

emit_ay:
        lda #VAA
        jsr emit
        lda #VIH
        jmp emit

emit_long:
        lda c0
        cmp #'A'
        bne el_e
        lda #VEH
        jsr emit
        lda #VIY
        jmp emit
el_e:
        cmp #'E'
        bne el_i
        lda #VIY
        jmp emit
el_i:
        cmp #'I'
        bne el_o
        jmp emit_ay
el_o:
        cmp #'O'
        bne el_u
        jmp emit_ow
el_u:
        cmp #'U'
        bne el_y
        lda #CY
        jsr emit
        lda #VUW
        jmp emit
el_y:
        jmp emit_ay

emit_short:
        lda c0
        cmp #'A'
        bne es_e
        lda #VAE
        jmp emit
es_e:
        cmp #'E'
        bne es_i
        lda #VEH
        jmp emit
es_i:
        cmp #'I'
        bne es_o
        lda #VIH
        jmp emit
es_o:
        cmp #'O'
        bne es_u
        lda #VAA
        jmp emit
es_u:
        cmp #'U'
        bne es_y
        lda #VAH
        jmp emit
es_y:
        lda #VIH
        jmp emit

rule_cons:
        lda c0
        sec
        sbc #'A'
        cmp #26
        bcs rc_no
        tax
        lda CMAP,x
        beq rc_spec
        jsr emit
        jmp rc_adv
rc_spec:
        lda c0
        cmp #'C'
        beq rc_c
        cmp #'X'
        beq rc_x
        cmp #'Q'
        beq rc_q
rc_no:
        clc
        rts
rc_c:
        lda c1
        cmp #'E'
        beq rc_s
        cmp #'I'
        beq rc_s
        cmp #'Y'
        beq rc_s
        lda longat
        cmp #$FF
        beq rc_k
        ldx wi
        inx
        cpx wordlen
        bne rc_k
rc_s:
        lda #CS
        jsr emit
        jmp rc_adv
rc_k:
        lda #CK
        jsr emit
        jmp rc_adv
rc_x:
        lda #CK
        jsr emit
        lda #CS
        jsr emit
        jmp rc_adv
rc_q:
        lda #CK
        jsr emit
        lda #CW
        jsr emit
rc_adv:
        lda c0
        cmp c1
        bne rc_one
        lda #2
        jmp adv_sec
rc_one:
        lda #1
        jmp adv_sec

voice_s:
        ldx phcount
        beq vs_done
        dex
        lda PHBUF,x
        cmp #CS
        bne vs_done
        cpx #0
        beq vs_done
        dex
        lda PHBUF,x
        cmp #VAE
        bcc vs_cons
        cmp #VUH+1
        bcc vs_done
vs_cons:
        jsr phon_voiced
        bcc vs_done
        inx
        lda #CZ
        sta PHBUF,x
vs_done:
        rts

phon_voiced:
        tay
        lda VOICED,y
        beq pv_no
        sec
        rts
pv_no:
        clc
        rts

is_vowel:
        cmp #'A'
        beq iv_y
        cmp #'E'
        beq iv_y
        cmp #'I'
        beq iv_y
        cmp #'O'
        beq iv_y
        cmp #'U'
        beq iv_y
        cmp #'Y'
        beq iv_y
        clc
        rts
iv_y:
        sec
        rts

only_one:
        stz vcnt
        ldx #0
ov:
        cpx wordlen
        bcs ov_d
        lda WORDBUF,x
        jsr is_vowel
        bcc ov_n
        inc vcnt
ov_n:
        inx
        jmp ov
ov_d:
        lda vcnt
        cmp #1
        beq ov_yes
        clc
        rts
ov_yes:
        sec
        rts

mem_y:
        lda ptrlo
        sta myld+1
        lda ptrhi
        sta myld+2
myld:
        lda $FFFF,y
        rts

add_ptr:
        clc
        adc ptrlo
        sta ptrlo
        bcc ap_ok
        inc ptrhi
ap_ok:
        rts

; --- synthesis ---------------------------------------------------------------
play:
        jsr set_pitch
        lda #1
        sta stress
        stz envon
        stz phi
        lda #1
        sta spoke
pl:
        ldx phi
        lda PHBUF,x
        beq pl_done
        inc phi
        cmp #5
        bcs pl_ph
        jsr do_pause
        bcs pl_can
        jmp pl
pl_ph:
        jsr play_one
        bcs pl_can
        jmp pl
pl_can:
        jsr silence_vols
        jsr show_rom
        lda #1
        rts
pl_done:
        jsr silence_vols
        jsr show_rom
        lda #0
        rts

do_pause:
        cmp #PCOM
        bne dp1
        lda #6
        jmp dp_go
dp1:
        cmp #PSTP
        bne dp2
        lda #12
        jmp dp_go
dp2:
        cmp #PQRY
        bne dp3
        lda #12
        jmp dp_go
dp3:
        lda #3
dp_go:
        pha
        jsr silence_vols
        lda #1
        sta stress
        pla
        jmp wait_frames

play_one:
        sta pcode
        jsr load_rec
        lda modev
        cmp #$60
        bne po_prog
        jsr silence_vols
        lda #2
        jsr wait_frames
        bcs po_esc
po_prog:
        jsr maybe_stress
        jsr program_ay
        lda frames
        jmp wait_frames
po_esc:
        sec
        rts

maybe_stress:
        lda pcode
        cmp #VAE
        bcc ms_no
        cmp #VOY+1
        bcs ms_no
        lda stress
        beq ms_no
        stz stress
        clc
        lda frames
        adc #3
        sta frames
ms_no:
        rts

load_rec:
        lda pcode
        sec
        sbc #5
        sta tmplo
        stz tmphi
        asl tmplo
        rol tmphi
        asl tmplo
        rol tmphi
        asl tmplo
        rol tmphi
        clc
        lda tmplo
        adc #<PTAB
        sta ptrlo
        lda tmphi
        adc #>PTAB
        sta ptrhi
        ldy #0
        jsr mem_y
        sta frames
        iny
        jsr mem_y
        sta palo
        iny
        jsr mem_y
        sta pahi
        iny
        jsr mem_y
        sta pblo
        iny
        jsr mem_y
        sta pbhi
        iny
        jsr mem_y
        sta vola
        iny
        jsr mem_y
        sta volb
        iny
        jsr mem_y
        sta packed
        and #$1F
        sta noisev
        lda packed
        and #$E0
        sta modev
        rts

program_ay:
        ldy #0
        lda palo
        jsr ay_both
        ldy #1
        lda pahi
        jsr ay_both
        ldy #2
        lda pblo
        jsr ay_both
        ldy #3
        lda pbhi
        jsr ay_both
        ldy #4
        lda #0
        jsr ay_both
        ldy #5
        lda #0
        jsr ay_both
        ldy #6
        lda noisev
        jsr ay_both
        jsr pick_mixer
        ldy #7
        jsr ay_both
        ldy #8
        lda vola
        jsr ay_both
        ldy #9
        lda volb
        jsr ay_both
        ldy #10
        lda #0
        jsr ay_both
        lda vola
        cmp #16
        beq pa_env
        lda volb
        cmp #16
        bne pa_done
pa_env:
        lda envon
        bne pa_done
        lda #$0E
        ldy #13
        jsr ay_both
        lda #1
        sta envon
pa_done:
        rts

pick_mixer:
        lda modev
        cmp #$20
        bne pm1
        lda #$3C
        rts
pm1:
        cmp #$80
        bne pm2
        lda #$3D
        rts
pm2:
        cmp #$A0
        bne pm3
        lda #$34
        rts
pm3:
        cmp #$40
        beq pm_f
        cmp #$60
        beq pm_f
        lda #$3F
        rts
pm_f:
        lda palo
        ora pahi
        beq pm_n
        lda #$36
        rts
pm_n:
        lda #$37
        rts

set_pitch:
        lda #50
        ldx qflag
        beq sp_w
        lda #40
sp_w:
        ldy #11
        jsr ay_both
        ldy #12
        lda #0
        jmp ay_both

wait_frames:
        sta frleft
wf:
        lda frleft
        beq wf_ok
        dec frleft
        jsr poll_esc
        bcs wf_esc
        jsr frame_delay
        jmp wf
wf_ok:
        clc
        rts
wf_esc:
        sec
        rts

poll_esc:
        lda KBD
        bpl pe_no
        and #$7F
        cmp #$1B
        bne pe_no
        bit KSTRB
        sec
        rts
pe_no:
        clc
        rts

frame_delay:
        ldy #FWAIT
fd_o:
        ldx #0
fd_i:
        dex
        bne fd_i
        dey
        bne fd_o
        rts

show_rom:
        bit $C082
        rts

silence_vols:
        ldy #8
        lda #0
        jsr ay_both
        ldy #9
        lda #0
        jsr ay_both
        ldy #10
        lda #0
        jsr ay_both
        ldy #7
        lda #$3F
        jsr ay_both
        stz envon
        rts

; Adapted from groovebox.s reset_chip / ay_write. X is the VIA offset.
init_chips:
        ldx #0
        jsr reset_chip
        ldx #$80
        jsr reset_chip
        jsr silence_vols
        lda #1
        sta readyf
        rts

ensure_bus:
        ldx #0
        jsr ddr_only
        ldx #$80
        jmp ddr_only

ddr_only:
        lda #$7F
        sta MB+IER,x
        lda #$FF
        sta MB+DDRA,x
        lda #7
        sta MB+DDRB,x
        rts

reset_chip:
        lda #$7F
        sta MB+IER,x
        sta MB+IFR,x
        stz MB+ACR,x
        stz MB+ORB,x
        lda #$FF
        sta MB+DDRA,x
        lda #7
        sta MB+DDRB,x
        stz MB+ORB,x
        lda #4
        sta MB+ORB,x
        rts

ay_both:
        sta ayhold
        ldx #0
        lda ayhold
        jsr ay_one
        ldx #$80
        lda ayhold
        jmp ay_one

ay_one:
        sta ayval
        tya
        sta MB+ORA,x
        lda #7
        sta MB+ORB,x
        lda #4
        sta MB+ORB,x
        lda ayval
        sta MB+ORA,x
        lda #6
        sta MB+ORB,x
        lda #4
        sta MB+ORB,x
        rts

; --- type-and-speak UI -------------------------------------------------------
app_start:
        jsr TTS_INIT
        bit TEXT
        bit FULL
        bit PAGE1
        bit KSTRB
        jsr ui_cls
        stz uilen
        stz TTS_INPUT
        lda #0
        ldx #<m_title
        ldy #>m_title
        jsr show_msg
        lda #1
        ldx #<m_type
        ldy #>m_type
        jsr show_msg
        lda #2
        ldx #<m_esc
        ldy #>m_esc
        jsr show_msg
        lda #10
        ldx #<m_ready
        ldy #>m_ready
        jsr show_msg
app_loop:
        jsr ui_draw
ui_wait:
        lda KBD
        bpl ui_wait
        bit KSTRB
        and #$7F
        cmp #$1B
        beq app_quit
        cmp #$0D
        beq app_say
        cmp #$08
        beq app_bs
        cmp #$7F
        beq app_bs
        jsr ui_insert
        jmp app_loop
app_bs:
        lda uilen
        beq app_loop
        dec uilen
        ldx uilen
        stz TTS_INPUT,x
        jmp app_loop
app_say:
        ldx uilen
        stz TTS_INPUT,x
        lda #10
        ldx #<m_say
        ldy #>m_say
        jsr show_msg
        lda #<TTS_INPUT
        ldx #>TTS_INPUT
        jsr TTS_SPEAK
        sta lastres
        cmp #1
        beq as_can
        lda spoke
        beq as_none
        lda #10
        ldx #<m_done
        ldy #>m_done
        jsr show_msg
        jmp as_clr
as_can:
        lda #10
        ldx #<m_can
        ldy #>m_can
        jsr show_msg
        jmp as_clr
as_none:
        lda #10
        ldx #<m_none
        ldy #>m_none
        jsr show_msg
as_clr:
        stz uilen
        stz TTS_INPUT
        jmp app_loop
app_quit:
        jsr silence_vols
        jsr show_rom
        bit KSTRB
        brk

ui_insert:
        sta keych
        cmp #'a'
        bcc ui_chk
        cmp #'z'+1
        bcs ui_chk
        and #$DF
        sta keych
ui_chk:
        lda keych
        cmp #'A'
        bcc ui_sym
        cmp #'Z'+1
        bcc ui_yes
ui_sym:
        cmp #$20
        beq ui_yes
        cmp #$27
        beq ui_yes
        cmp #$2D
        beq ui_yes
        cmp #$2E
        beq ui_yes
        cmp #$2C
        beq ui_yes
        cmp #$3F
        beq ui_yes
        cmp #$21
        beq ui_yes
        lda #10
        ldx #<m_bad
        ldy #>m_bad
        jmp show_msg
ui_yes:
        lda uilen
        cmp #120
        bcs ui_lim
        ldx uilen
        lda keych
        sta TTS_INPUT,x
        inc uilen
        ldx uilen
        stz TTS_INPUT,x
        lda #10
        ldx #<m_ready
        ldy #>m_ready
        jmp show_msg
ui_lim:
        lda #10
        ldx #<m_lim
        ldy #>m_lim
        jmp show_msg

ui_cls:
        ldx #0
        lda #$A0
ucl:
        sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne ucl
        rts

ui_draw:
        lda #4
        jsr clear_row
        lda #5
        jsr clear_row
        lda #6
        jsr clear_row
        lda #7
        jsr clear_row
        lda #4
        sta plotrow
        stz plotcol
        lda #$3E
        jsr plot_a
        lda #$20
        jsr plot_a
        ldx #0
ud:
        cpx uilen
        bcs ud_cur
        lda TTS_INPUT,x
        jsr plot_wrap
        inx
        jmp ud
ud_cur:
        lda #$5F
        jmp plot_wrap

plot_wrap:
        pha
        lda plotrow
        cmp #8
        bcs pw_skip
        lda plotcol
        cmp #39
        bcc pw_ok
        inc plotrow
        stz plotcol
pw_ok:
        pla
        jmp plot_a
pw_skip:
        pla
        rts

clear_row:
        sta plotrow
        stz plotcol
        ldx #40
crw:
        lda #$20
        jsr plot_a
        dex
        bne crw
        rts

plot_a:
        phx
        pha
        ldx plotrow
        lda ROWLO,x
        clc
        adc plotcol
        sta pst+1
        lda ROWHI,x
        adc #0
        sta pst+2
        pla
        ora #$80
pst:
        sta $0400
        inc plotcol
        plx
        rts

show_msg:
        sta plotrow
        stx msglo
        sty msghi
        lda plotrow
        jsr clear_row
        lda plotrow
        sta plotrow
        stz plotcol
        ldy #0
sm:
        lda msglo
        sta sml+1
        lda msghi
        sta sml+2
sml:
        lda $FFFF,y
        beq sm_ser
        jsr plot_a
        iny
        bne sm
sm_ser:
        ldy #0
sms:
        lda msglo
        sta smsl+1
        lda msghi
        sta smsl+2
smsl:
        lda $FFFF,y
        beq sm_cr
        sta SER
        iny
        bne sms
sm_cr:
        lda #$0D
        sta SER
        rts

; --- tables and buffers ------------------------------------------------------
CMAP:
        .byte 0, CB, 0, CD, 0, CF, CG, CHH, 0, CJH, CK, CL, CM, CN
        .byte 0, CP, 0, CR, CS, CT, 0, CV, CW, 0, CY, CZ

VOICED:
        .byte 0,0,0,0,0
        .byte 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1
        .byte 0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1,0,1

PTAB:
        .byte 11,60,0,140,0,16,16,32
        .byte 11,58,0,186,0,16,16,32
        .byte 11,52,0,246,0,16,16,32
        .byte 11,89,0,137,0,16,16,32
        .byte 11,82,0,159,0,16,16,32
        .byte 11,116,0,197,0,16,16,32
        .byte 11,89,0,219,0,16,16,32
        .byte 11,73,0,205,0,16,16,32
        .byte 12,49,0,219,0,16,16,32
        .byte 12,43,0,95,1,16,16,32
        .byte 12,66,0,151,0,16,16,32
        .byte 12,116,0,219,0,16,16,32
        .byte 12,116,0,51,1,16,16,32
        .byte 12,98,0,151,0,16,16,32
        .byte 12,70,0,197,0,16,16,32
        .byte 3,0,0,0,0,12,0,114
        .byte 3,0,0,0,0,12,0,112
        .byte 3,0,0,0,0,12,0,98
        .byte 3,0,0,0,0,12,0,99
        .byte 3,0,0,0,0,12,0,104
        .byte 3,0,0,0,0,12,0,103
        .byte 7,70,0,0,0,13,0,78
        .byte 6,82,0,236,1,9,16,172
        .byte 7,55,0,0,0,12,0,74
        .byte 8,76,0,236,1,11,16,172
        .byte 7,15,0,0,0,13,0,66
        .byte 7,20,0,236,1,11,16,163
        .byte 7,39,0,0,0,13,0,72
        .byte 7,45,0,236,1,11,16,170
        .byte 5,0,0,0,0,11,0,69
        .byte 8,0,0,95,1,0,16,128
        .byte 8,0,0,72,1,0,16,128
        .byte 8,0,0,51,1,0,16,128
        .byte 7,82,0,25,1,16,16,32
        .byte 7,89,0,234,0,16,16,32
        .byte 5,140,0,25,1,16,16,32
        .byte 5,47,0,72,1,16,16,32
        .byte 6,39,0,0,0,13,0,70
        .byte 7,45,0,236,1,12,16,167

PATS:
        .byte 0,3,"ALK",2,VAO,CK
        .byte 0,3,"ALL",2,VAO,CL
        .byte 2,3,"ARE",2,VEH,CR
        .byte 0,4,"TION",3,CSH,VAH,CN
        .byte 0,4,"SION",3,CZH,VAH,CN
        .byte 0,3,"IGH",2,VAA,VIH
        .byte 0,3,"OFT",3,VAO,CF,CT
        .byte 0,3,"OLD",4,VAO,VUH,CL,CD
        .byte 2,2,"OG",2,VAO,CG
        .byte 1,3,"COM",3,CK,VAH,CM
        .byte 1,2,"KN",1,CN
        .byte 1,2,"WR",1,CR
        .byte 0,2,"CK",1,CK
        .byte 0,2,"TH",1,CTH
        .byte 0,2,"SH",1,CSH
        .byte 0,2,"CH",1,CCH
        .byte 0,2,"PH",1,CF
        .byte 0,2,"WH",1,CW
        .byte 0,2,"NG",1,CNG
        .byte 0,2,"QU",2,CK,CW
        .byte 0,2,"GH",0
        .byte 0,2,"EE",1,VIY
        .byte 0,2,"EA",1,VIY
        .byte 0,2,"OO",1,VUW
        .byte 0,2,"OU",2,VAA,VUH
        .byte 2,2,"OW",2,VAO,VUH
        .byte 0,2,"OW",2,VAA,VUH
        .byte 0,2,"AI",2,VEH,VIY
        .byte 0,2,"AY",2,VEH,VIY
        .byte 0,2,"EY",2,VEH,VIY
        .byte 0,2,"OA",2,VAO,VUH
        .byte 0,2,"OI",2,VAO,VIH
        .byte 0,2,"OY",2,VAO,VIH
        .byte 0,2,"AU",1,VAO
        .byte 0,2,"AW",1,VAO
        .byte 0,2,"EW",2,CY,VUW
        .byte 0,2,"UE",2,CY,VUW
        .byte 0,2,"AR",2,VAA,CR
        .byte 0,2,"OR",2,VAO,CR
        .byte 0,2,"ER",1,VER
        .byte 0,2,"IR",1,VER
        .byte 0,2,"UR",1,VER
        .byte $FF

EXCEPT:
        .byte 3,"THE",2,CDH,VAH
        .byte 1,"A",1,VAH
        .byte 1,"I",2,VAA,VIH
        .byte 2,"OF",2,VAH,CV
        .byte 2,"TO",2,CT,VUW
        .byte 3,"YOU",2,CY,VUW
        .byte 3,"WAS",3,CW,VAH,CZ
        .byte 4,"WERE",2,CW,VER
        .byte 3,"ARE",2,VAA,CR
        .byte 2,"BE",2,CB,VIY
        .byte 2,"DO",2,CD,VUW
        .byte 3,"WHO",2,CHH,VUW
        .byte 4,"WHAT",3,CW,VAH,CT
        .byte 5,"WHERE",3,CW,VEH,CR
        .byte 4,"WHEN",3,CW,VEH,CN
        .byte 3,"WHY",3,CW,VAA,VIH
        .byte 3,"HOW",3,CHH,VAA,VUH
        .byte 3,"NOW",3,CN,VAA,VUH
        .byte 3,"COW",3,CK,VAA,VUH
        .byte 4,"DOWN",4,CD,VAA,VUH,CN
        .byte 4,"TOWN",4,CT,VAA,VUH,CN
        .byte 4,"THEY",3,CDH,VEH,VIY
        .byte 4,"THEM",3,CDH,VEH,CM
        .byte 5,"THEIR",3,CDH,VEH,CR
        .byte 5,"THERE",3,CDH,VEH,CR
        .byte 4,"THIS",3,CDH,VIH,CS
        .byte 4,"THAT",3,CDH,VAE,CT
        .byte 5,"THESE",3,CDH,VIY,CZ
        .byte 5,"THOSE",4,CDH,VAO,VUH,CZ
        .byte 4,"THEN",3,CDH,VEH,CN
        .byte 4,"THAN",3,CDH,VAE,CN
        .byte 3,"ONE",3,CW,VAH,CN
        .byte 4,"SAID",3,CS,VEH,CD
        .byte 4,"SAYS",3,CS,VEH,CZ
        .byte 4,"COME",3,CK,VAH,CM
        .byte 4,"SOME",3,CS,VAH,CM
        .byte 4,"LOVE",3,CL,VAH,CV
        .byte 4,"HAVE",3,CHH,VAE,CV
        .byte 4,"GIVE",3,CG,VIH,CV
        .byte 4,"GONE",3,CG,VAO,CN
        .byte 4,"DONE",3,CD,VAH,CN
        .byte 4,"KNOW",3,CN,VAO,VUH
        .byte 5,"COULD",3,CK,VUH,CD
        .byte 5,"WOULD",3,CW,VUH,CD
        .byte 6,"SHOULD",3,CSH,VUH,CD
        .byte 6,"PEOPLE",5,CP,VIY,CP,VAH,CL
        .byte 7,"THROUGH",3,CTH,CR,VUW
        .byte 6,"THOUGH",3,CDH,VAO,VUH
        .byte 6,"ENOUGH",4,VIH,CN,VAH,CF
        .byte 5,"LAUGH",3,CL,VAE,CF
        .byte 4,"HEAD",3,CHH,VEH,CD
        .byte 4,"DEAD",3,CD,VEH,CD
        .byte 4,"BOOK",3,CB,VUH,CK
        .byte 4,"LOOK",3,CL,VUH,CK
        .byte 4,"GOOD",3,CG,VUH,CD
        .byte 4,"FOOT",3,CF,VUH,CT
        .byte 3,"PUT",3,CP,VUH,CT
        .byte 4,"WORD",3,CW,VER,CD
        .byte 4,"WORK",3,CW,VER,CK
        .byte 5,"WORLD",4,CW,VER,CL,CD
        .byte 5,"RIGHT",3,CR,VAA,VIH
        .byte 5,"LIGHT",3,CL,VAA,VIH
        .byte 5,"NIGHT",3,CN,VAA,VIH
        .byte 8,"SENTENCE",7,CS,VEH,CN,CT,VAH,CN,CS
        .byte 4,"DONT",4,CD,VAO,CN,CT
        .byte 4,"CANT",4,CK,VAE,CN,CT
        .byte 4,"WONT",4,CW,VAO,CN,CT
        .byte 4,"BEEN",3,CB,VIH,CN
        .byte 4,"DOES",3,CD,VAH,CZ
        .byte 0

ROWLO:  .byte $00,$80,$00,$80,$00,$80,$00,$80
        .byte $28,$A8,$28,$A8,$28,$A8,$28,$A8
        .byte $50,$D0,$50,$D0,$50,$D0,$50,$D0
ROWHI:  .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07
        .byte $04,$04,$05,$05,$06,$06,$07,$07

m_title: .byte "WIRETHROAT FORMANT TALKER",0
m_type:  .byte "TYPE, THEN PRESS RETURN.",0
m_esc:   .byte "ESC CANCELS. ESC AGAIN QUITS.",0
m_ready: .byte "READY.",0
m_say:   .byte "SPEAKING. ESC CANCELS.",0
m_done:  .byte "DONE.",0
m_can:   .byte "CANCELLED.",0
m_none:  .byte "NOTHING TO SAY.",0
m_lim:   .byte "LIMIT IS 120 CHARACTERS.",0
m_bad:   .byte "UNSUPPORTED CHARACTER.",0

TTS_INPUT: .res 122
NORM:      .res 121
WORDBUF:   .res 121
PHBUF:     .res 256

srclo:  .res 1
srchi:  .res 1
haslet: .res 1
qflag:  .res 1
inlen:  .res 1
readyf: .res 1
spoke:  .res 1
lastres:.res 1
uilen:  .res 1
keych:  .res 1
srci:   .res 1
wordlen:.res 1
wi:     .res 1
longat: .res 1
c0:     .res 1
c1:     .res 1
c2:     .res 1
c3:     .res 1
phcount:.res 1
exlen:  .res 1
leftn:  .res 1
pflags: .res 1
plen:   .res 1
ptmp:   .res 1
vcnt:   .res 1
hevlim: .res 1
phi:    .res 1
pcode:  .res 1
frames: .res 1
stress: .res 1
envon:  .res 1
modev:  .res 1
noisev: .res 1
packed: .res 1
palo:   .res 1
pahi:   .res 1
pblo:   .res 1
pbhi:   .res 1
vola:   .res 1
volb:   .res 1
frleft: .res 1
ayhold: .res 1
ayval:  .res 1
ptrlo:  .res 1
ptrhi:  .res 1
tmplo:  .res 1
tmphi:  .res 1
msglo:  .res 1
msghi:  .res 1
plotrow:.res 1
plotcol:.res 1
