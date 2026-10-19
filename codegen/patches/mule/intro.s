; M.U.L.E. for 3RIC - the intro's Atari (phase 1 of the boot, main RAM).
;
; The intro (boot sectors 1-129, $7BEF-$BC6F: title, options, controllers,
; colour and species) runs live on the 3RIC with the game's runtime (rt.s)
; and a renderer built for hi-res page 2 (the loader and the hand-off stash
; stay in page 1). This file is the little of the Atari OS it uses: the
; Atari boot (JSR load+6, JSR (DOSINI), JMP (DOSVEC)), the VBI's stage 1
; and 2 (RTCLOK, ATRACT, shadow registers to the register file, sticks and
; triggers), the OS jump table at $E450 in language-card RAM (SETVBV,
; SYSVBV, XITVBV; disk calls answer success; WARMSV ends the intro), and
; elapsed-time versions of the intro's RTCLOK-equality waits.
;
; snap_take/intro_done let a loader run the intro in the middle of its work:
; the loader calls snap_take (carry clear) and jumps to intro_launch; at the
; intro's warm start, intro_done stashes $0000-$0FFF (the configuration the
; intro wrote) at CFG_STASH, puts back the zero page, stack, pages 2-3 and
; 8-9 and RAM2 as snap_take saw them, and returns from snap_take again with
; carry set. The loader then loads the main game as before.
;
; Prepended by the converter: IRT_CODE, SNAP, CFG_STASH, STAGE_R2,
; STAGE_LOW, BOOT_INIT, DOSINI_INIT, RG, RA, KB_KEY and the rt.s entry points
; XITVBV, SETVBV, NMI_ENTRY, IRQ_ENTRY, RESET_ENTRY, JWAIT, HW_INIT.

LCB2        = $C083
PADIER      = $C20E
MB1         = $C400
MB2         = $C480
V_ORB       = 0
V_IER       = 14

        .org IRT_CODE

; ---- the loader's side
; snap_take: returns with carry clear; returns again, after the intro,
; with carry set (intro_done). Called with the ROM mapped.
snap_take:
        php
        pla
        sta sv_p
        tsx
        stx sv_sp
        lda PADIER
        sta sv_ier
        ldx #0
st1:    lda $00,x
        sta SNAP,x
        lda $0100,x
        sta SNAP+$100,x
        lda $0200,x
        sta SNAP+$200,x
        lda $0300,x
        sta SNAP+$300,x
        lda $0800,x
        sta SNAP+$400,x
        lda $0900,x
        sta SNAP+$500,x
        inx
        bne st1
        lda #$C8                ; RAM2: the ROM's state (FAT32, receiver)
        ldx #>(SNAP+$600)
        ldy #8
        jsr pcopy
        clc
        rts

; intro_launch: entered by the loader after snap_take, the RAM2 image at
; STAGE_R2 and the runtime's page 3 at STAGE_LOW, both language-card banks
; loaded (rt.s bank 2, the intro renderer in bank 1).
intro_launch:
        sei
        cld
        lda #>STAGE_R2
        ldx #$C8
        ldy #8
        jsr pcopy
        lda #>STAGE_LOW
        ldx #$03
        ldy #1
        jsr pcopy
        lda LCB2                ; bank 2 read/write ($E000-$FFFF too)
        lda LCB2
        ldx #os_tab_end-os_tab-1
il1:    lda os_tab,x
        sta $E450,x
        dex
        bpl il1
        ldx #5
il2:    lda vectors,x
        sta $FFFA,x
        dex
        bpl il2
        lda #$00                ; an Atari after a cold start: zeroed RAM
        ldy #1                  ; (not page 1, page 3 (ours) or this code)
        jsr pclear
        lda #$02
        ldy #1
        jsr pclear
        lda #$04
        ldy #12
        jsr pclear
        lda #$40                ; hi-res page 2 and up to the intro, but
        ldy #32                 ; not the snapshot at SNAP
        jsr pclear
        lda #>(SNAP+$E00)
        ldy #$7B-(>(SNAP+$E00))
        jsr pclear
        lda #$BD
        ldy #3
        jsr pclear
        lda #<sysvbv            ; the OS's defaults the intro relies on
        sta $0222
        lda #>sysvbv
        sta $0223
        lda #<XITVBV
        sta $0224
        lda #>XITVBV
        sta $0225
        lda #<NMI_ENTRY         ; VDSLST: no handler yet (an RTI)
        sta $0200
        lda #>NMI_ENTRY
        sta $0201
        lda #<blank_dl
        sta $0230
        sta $D402
        lda #>blank_dl
        sta $0231
        sta $D403
        lda #$22
        sta $022F               ; SDMCTL
        lda #$E0
        sta $02F4               ; CHBAS: the ROM font
        lda #$02
        sta $02F3               ; CHACT
        lda #$FF
        sta $02FC               ; CH: no key
        lda #$C0
        sta $6A                 ; RAMTOP
        lda #$01
        sta $09                 ; BOOT?: disk booted
        lda #<DOSINI_INIT
        sta $0C
        lda #>DOSINI_INIT
        sta $0D
        lda #$40                ; NMIEN: VBI only
        sta $D40E
        jsr HW_INIT             ; rt.s: pads, AYs, timers; the tick armed
        bit $C050               ; hi-res page 2, full screen
        bit $C052
        bit $C055
        bit $C057
        ldx #$FF
        txs
        jsr BOOT_INIT           ; the boot sectors' own init (load + 6)
        jsr il_ini              ; JSR (DOSINI)
        cli
        jmp ($000A)             ; DOSVEC: the intro
il_ini: jmp ($000C)

; ---- the intro's warm start ($E474): hand back to the loader
intro_done:
        sei
        cld
        lda #$7F
        sta MB2+V_IER           ; no more ticks
        lda #0                  ; both AYs reset: silence
        sta MB1+V_ORB
        sta MB2+V_ORB
        lda #4
        sta MB1+V_ORB
        sta MB2+V_ORB
        lda #$00                ; the configuration: $0000-$0FFF
        ldx #>CFG_STASH
        ldy #16
        jsr pcopy
        ldx #0                  ; a text page saying what is happening
        lda #$A0
id1:    sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne id1
        ldx #msg_end-msg-1
id2:    lda msg,x
        ora #$80
        sta $05B4,x             ; row 11, centred
        dex
        bpl id2
        bit $C051
        bit $C054
        ldx #0                  ; the loader's state back
id3:    lda SNAP,x
        sta $00,x
        lda SNAP+$100,x
        sta $0100,x
        lda SNAP+$200,x
        sta $0200,x
        lda SNAP+$300,x
        sta $0300,x
        lda SNAP+$400,x
        sta $0800,x
        lda SNAP+$500,x
        sta $0900,x
        inx
        bne id3
        lda #>(SNAP+$600)
        ldx #$C8
        ldy #8
        jsr pcopy
        lda #$7F
        sta PADIER
        lda sv_ier
        ora #$80
        sta PADIER
        lda $C082               ; the ROM, card write-protected
        ldx sv_sp
        txs
        lda sv_p
        ora #$01                ; carry set: back from the intro
        pha
        plp
        rts
msg:    .byte "LOADING M.U.L.E."
msg_end:

; ---- the OS VBI: stage 1 (RTCLOK, ATRACT), then, unless CRITIC, stage 2
; (shadow registers to the register file, sticks, triggers) and VVBLKD.
; Entered from the runtime's tick (bank 2 mapped) with the Atari NMI frame.
sysvbv: inc $14
        bne sy1
        inc $4D                 ; ATRACT, every 256 ticks as the OS
        inc $13
        bne sy1
        inc $12
sy1:    lda KB_KEY              ; a key typed: CH as the OS keyboard handler
        beq sy1k                ; leaves it (the title takes any key)
        stz KB_KEY
        lda #$21                ; (the Atari code for Space; the intro only
        sta $02FC               ; tests CH for "no key", $FF)
        bra sy_in
sy1k:   lda RG+$10              ; any trigger, stick or console key holds
        and RG+$11              ; off the intro's attract restart (the
        beq sy_in               ; OS's keyboard handler does this)
        lda RA
        cmp #$FF
        bne sy_in
        lda RG+$1F
        cmp #$07
        beq sy2
sy_in:  stz $4D
sy2:    lda $42                 ; CRITIC
        bne sy_x
        ldx #8                  ; PCOLR0-3, COLOR0-4 -> COLPM0-COLBK
sy3:    lda $02C0,x
        sta $D012,x
        dex
        bpl sy3
        lda $026F
        sta $D01B               ; PRIOR
        lda $022F
        sta $D400               ; DMACTL
        lda $02F3
        sta $D401               ; CHACTL
        lda $0230
        sta $D402
        lda $0231
        sta $D403               ; DLIST
        lda $02F4
        sta $D409               ; CHBASE
        lda RA                  ; STICK0-1 from PORTA, 2-3 from PORTB
        tax
        and #$0F
        sta $0278
        txa
        lsr a
        lsr a
        lsr a
        lsr a
        sta $0279
        lda RA+1
        tax
        and #$0F
        sta $027A
        txa
        lsr a
        lsr a
        lsr a
        lsr a
        sta $027B
        ldx #3                  ; STRIG0-3
sy4:    lda RG+$10,x
        sta $0284,x
        dex
        bpl sy4
        ldx #7                  ; no paddles: PADDL0-7 228, PTRIG0-7 up
sy5:    lda #228
        sta $0270,x
        lda #1
        sta $027C,x
        dex
        bpl sy5
        jmp ($0224)             ; VVBLKD
sy_x:   jmp XITVBV

; ---- the intro's RTCLOK-equality waits, as elapsed-time waits that
; catch up. The redraw runs inside the tick and takes many ticks; the
; Atari's waits each start from "now", so the steps the main code missed
; while it ran were lost and the characters walked a fraction of their
; speed. iw_d keeps how late the last wait ended (at most IW_CAP ticks);
; the next waits end that much early, so the walk keeps the Atari's pace
; and the redraws show it at a lower frame rate. Only A (and Y in
; wait_e5, as before) is changed.
IW_CAP  = 32
; $90CF: wait A ticks; returns A = start + n with Z and C set, N clear
; (as its CMP RTCLOK left them; for n = 0, A = RTCLOK at once)
iwait:  cmp #0
        bne iw0
        lda $14
        bra iwz
iw0:    sta iw_n
        lda $14
        sta iw_s
iw1:    jsr iw_due
        bcc iw1
iw2:    lda iw_s
        clc
        adc iw_n
iwz:    sta iw_t
        cmp iw_t
        rts
; $9092: A ticks, or until $E5 is zero
wait_e5:
        sta iw_n
        lda $14
        sta iw_s
we1:    ldy $E5
        beq iw2
        jsr iw_due
        bcc we1
        bra iw2
; C set once the ticks since iw_s plus the debt reach iw_n, the debt
; then left with the rest
iw_due: lda $14
        sec
        sbc iw_s
        clc
        adc iw_d
        bcs idu1
        cmp iw_n
        bcc idu_x
idu1:   sbc iw_n                ; C set
iw_set: cmp #IW_CAP+1
        bcc idu2
        lda #IW_CAP
idu2:   sta iw_d
        sec
idu_x:  rts
; $8EDF/$9069: LDA dl / CMP RTCLOK / BNE loop, the deadline dl set to
; RTCLOK + n just before: Z set (A = dl) once n ticks, less the debt,
; have passed (dl at most 180 / 100 ticks ahead)
ddl_84: lda #256-180
        sta iw_w
        lda $84
        bra ddl
ddl_97: lda #256-100
        sta iw_w
        lda $97
ddl:    sta iw_t
        lda $14
        sec
        sbc iw_t                ; ticks past the deadline (or, from iw_w,
        cmp iw_w                ; before it)
        bcc dl_late
        clc
        adc iw_d
        bcc dd_no               ; still ahead with the debt paid
        bra dl_set
dl_late:
        clc
        adc iw_d
dl_set: jsr iw_set
        lda iw_t
        cmp iw_t
        rts
dd_no:  lda #1
        rts

; ---- the title with its logo drawn at once (INTRO_PATCHES skip the two
; pixel-by-pixel reveals, which kept the renderer redrawing the banner for
; 47 seconds and left the walking characters a frame now and then): hold
; it until the Atari's title would end ($83E0/1, the title's tick count,
; reaching $1000) or a trigger or key ($91FD clears $83EC).
title_hold:
th1:    lda $83EC
        beq th_x
        lda $83E1
        cmp #$10
        bcc th1
th_x:   rts

; ---- the OS jump table at $E450 (language-card RAM)
os_tab: .byte $4C,<os_rts,>os_rts           ; DISKIV
        .byte $4C,<os_disk,>os_disk         ; DSKINV
        .byte $4C,<os_disk,>os_disk         ; CIOV
        .byte $4C,<os_disk,>os_disk         ; SIOV
        .byte $4C,<SETVBV,>SETVBV           ; SETVBV
        .byte $4C,<sysvbv,>sysvbv           ; SYSVBV
        .byte $4C,<XITVBV,>XITVBV           ; XITVBV
        .byte $4C,<os_rts,>os_rts           ; SIOINV
        .byte $4C,<os_rts,>os_rts           ; SENDEV
        .byte $4C,<os_rts,>os_rts           ; INTINV
        .byte $4C,<os_rts,>os_rts           ; CIOINV
        .byte $4C,<os_rts,>os_rts           ; BLKBDV
        .byte $4C,<intro_done,>intro_done   ; WARMSV
        .byte $4C,<intro_done,>intro_done   ; COLDSV
os_tab_end:
os_disk: ldy #1                 ; success
os_rts: rts
vectors: .word NMI_ENTRY, RESET_ENTRY, IRQ_ENTRY
blank_dl: .byte $70,$70,$70,$41,<blank_dl,>blank_dl

; ---- Y pages from page A to page X; Y pages of zeros from page A
pcopy:  sta pc1+2
        stx pc2+2
pc0:    ldx #0
pc1:    lda $FF00,x
pc2:    sta $FF00,x
        inx
        bne pc1
        inc pc1+2
        inc pc2+2
        dey
        bne pc0
        rts
pclear: sta pz1+2
        lda #0
pz0:    ldx #0
pz1:    sta $FF00,x
        inx
        bne pz1
        inc pz1+2
        dey
        bne pz0
        rts

sv_p:   .byte 0
sv_sp:  .byte 0
sv_ier: .byte 0
iw_n:   .byte 0
iw_s:   .byte 0
iw_d:   .byte 0
iw_t:   .byte 0
iw_w:   .byte 0
irt_end:
