; Dirt Bike for 3RIC - resident: SD-card files, SNES pads and quit.
;
; DIRTBIKE (Verhille Arnaud's Apple II port) never used the DOS 3.3 file
; manager. It reads its files through RWTS ($03D9), one sector at a time,
; from track/sector tables built into the game, and loads each file's raw
; sectors - DOS header included - at a page boundary: TITLE and the 30
; tracks at $9600 (their data from $9604), the hall of fame's two sectors at
; $B500. The converter stores each of those files on the card as the same
; raw sectors, so memory ends up byte for byte as the game's own loader left
; it, and three game routines become ROM DOS commands here:
;
;   $84D1 load the file whose T/S list is at TRK/SECT -> FLOAD NAME pp00 0000 llll
;   $76BC read the hall of fame (two sectors, $B500)  -> FLOAD DIRTHOF B500 0000 01FF
;   $76A9 write it back                              -> OWRITE DIRTHOF B500 01FF
;
; (llll = file size - 1: FLOAD's end offset is inclusive. OWRITE writes
; whole 512-byte card sectors, floor(len/512)+1 of them, so 01FF is exactly
; the one sector the two DOS sectors fill.) The game's two RWTS sector
; entries ($8516 write, $8519 read) are patched to fail: nothing calls them
; any more.
;
; The ROM DOS reports a missing file only as text, and its failed FLOAD
; still copies (from stale directory state) through ($BC), which it sets
; only once the file is found. So $BC/$BD are pointed at the destination
; first, the destination's first four bytes are cleared, and a load counts
; only if it starts with the file's own DOS header; otherwise carry is set
; and the game shows DISK ERROR, as it did for a bad sector. The hall of
; fame is written only by the game's save routine, which reads it first and
; stops if that fails, so OWRITE never meets a missing file (it would fall
; back to BSAVE code in the BASIC bank, which is RAM while the game runs).
;
; Each command goes through the ROM's own Ctrl-D collector (captured by the
; loader from the $03EA hook) with screen output muted: the game keeps
; routines and variables in the text page. $B0-$BF (the ROM's FAT32 zero
; page, game data here), CSW and MUTE_OUTPUT are restored after, and IRQs
; are masked (the game never uses them; NMIs still serve the keyboard).
;
; SNES pads: in its joystick mode the game reads paddle 0 for lean, paddle 1
; for menu up/down and buttons 0/1 for gas/brake. $815C (its paddle read)
; and every $C061/$C062 read are redirected here, and the pads are clocked
; directly on VIA1 port B with the ROM scan's own pin sequence, so no PTRIG
; ($C070) scan NMIs or paddle-timer NMIs (whose ROM exit clears every VIA1
; flag and can drop a PS/2 edge) happen during play. Either pad works:
;   D-pad left/right  paddle 0 low/high (lean back / lean forward)
;   D-pad up/down     paddle 1 low/high (menus)
;   B or X            button 0 (gas)    - as the ROM maps them to $C061
;   A or Y            button 1 (brake)  - as the ROM maps them to $C062
;   Start / Select    Esc (menu) / R (restart), typed into $C000 when free
;
; It lives in DOS 3.3's old RWTS space ($B704-$BFFF: its IOB page and RWTS):
; the game called RWTS there, so it never kept anything in that space, apart
; from the four bytes ($B700-$B703) its hall-of-fame copy spills past $B6FF.
;
; Apple II speed. 3RIC's 65C02 runs at 1.5734375 MHz, 1.538 times the Apple
; II's 1.0227 MHz, and the game has no timer of its own: a race frame is
; whatever the code takes (its clock adds 1/30 s a frame, ~30 fps on the
; Apple), its sound effects and music are speaker delay loops ($6003) and
; its pauses are the monitor's WAIT. So:
;   - every sound goes through tone, a copy of $6003 whose delay loops are
;     1.538 times longer: the Apple's pitch and length;
;   - every WAIT goes through wait_apple: WAIT(a) and then WAIT(wtab[a]),
;     the converter's table making the two together last as long as WAIT(a)
;     did on the Apple;
;   - each race frame is paced before its page flip (pace, at $7D95): the
;     cycles the frame's code took ("work") are measured on the slot-4
;     Mockingboard's first VIA (Timer 1 free-running, polled, interrupts
;     off) and 0.538 times as many are waited, so the frame lasts as long as
;     on the Apple. Tone, WAIT and disk time are not work: they already run
;     at the Apple's length (disk time is the card's own).
; Without a Mockingboard (no counting Timer 1 found by timer_init) frames
; are not paced; sound and WAIT stay retimed, as they need no timer.

COUT        = $FDED
CSW         = $36
MUTE_OUTPUT = $CE09             ; ROM: no screen echo of DOS output
NMI_NEST    = $CAFE             ; ROM NMI proxy nest count
KBD         = $C000
VIA1_ORB    = $C200             ; PB6 latch, PB7 clock, PB5/PB4 pad 1/2 data
SETNORM     = $FE84
INIT        = $FB2F
SETVID      = $FE93
SETKBD      = $FE89
HOOK_BUFFER = $ED27             ; ROM: CSW = the DOS command collector
DOS_ENTRY   = $EDBC             ; ROM: mount the card, DOS prompt
CTRL_D      = $84
CR          = $8D
WAIT        = $FCA8             ; monitor WAIT (the same code as the Apple's)
SPEAKER     = $C030
MB_T1CL     = $C404             ; slot-4 Mockingboard, first VIA
MB_T1CH     = $C405
MB_T1LL     = $C406
MB_ACR      = $C40B
MB_IFR      = $C40D
MB_IER      = $C40E
FRAME_ROUTINE = $803A           ; the game's last call before its page flip
PACE_DEBT   = 357               ; 1.538 x ~232: the cycles of pace's own code
                                ; (last tick's tail, pad's exit, epilogue,
                                ; prologue, first tick's head) that are
                                ; counted inside a frame's work

TRK         = $075D             ; game: T/S list track
SECT        = $075E             ; game: T/S list sector
PAGE        = $075F             ; game: destination page
PDL0        = $71               ; game: paddle 0 count
PDL1        = $72               ; game: paddle 1 count
HOF_PAGE    = $B5

PAD_LOW     = $00               ; paddle counts the game sees; it is
PAD_CENTER  = $40               ; calibrated to PAD_CENTER (converter patch)
PAD_HIGH    = $80
KEY_ESC     = $9B
KEY_R       = $D2
BT_B        = 0                 ; SNES shift order
BT_Y        = 1
BT_SELECT   = 2
BT_START    = 3
BT_UP       = 4
BT_DOWN     = 5
BT_LEFT     = 6
BT_RIGHT    = 7
BT_A        = 8
BT_X        = 9
NBUTTONS    = 12

        .org $B704

; $6003 (A = half periods, X = delay): the game's speaker routine at the
; Apple's pitch and length. Its half period was 5X+12 cycles at 1.0227 MHz;
; here it is 15+5n cycles with n = X + X/2 + X/32 + X/64 + 1 (1.538X + 0.7),
; split over two delay loops. It comes first so that no counted branch
; crosses a page (the tool checks).
tone:
        php
        cld
        sta tn_count
        stx tn_t
        jsr exempt_begin
        stz tn_t+1
        lda tn_t
        bne tn_x
        inc tn_t+1              ; X = 0 meant 256
tn_x:
        clc                     ; n = X + 1
        lda tn_t
        adc #1
        sta tn_n
        lda tn_t+1
        adc #0
        sta tn_n+1
        ldx #0
tn_terms:
        ldy tn_shifts,x         ; + X >> 1, >> 5, >> 6 (cumulative shifts)
        beq tn_split
tn_sh:  lsr tn_t+1
        ror tn_t
        dey
        bne tn_sh
        clc
        lda tn_n
        adc tn_t
        sta tn_n
        lda tn_n+1
        adc tn_t+1
        sta tn_n+1
        inx
        bra tn_terms
tn_split:
        lda tn_n+1              ; n2 = n / 2, n1 = n - n2
        lsr
        lda tn_n
        ror
        sta tn_n2
        adc #0
        sta tn_n1
        ldy tn_count
tn_click:
        lda SPEAKER             ; 4
        ldx tn_n1               ; 4
tn_d1:  dex                     ; 5 n1 - 1
        bne tn_d1
        ldx tn_n2               ; 4
tn_d2:  dex                     ; 5 n2 - 1
        bne tn_d2
        dey                     ; 2
        bne tn_click            ; 3
tone_end:
        jsr exempt_end
        plp
        ldx #0                  ; as $6003 leaves them
        ldy #0
        rts
tn_shifts:  .byte 1,4,1,0

; --- $84D1: load a file by its T/S list location ----------------------------
load_file:
        php
        sei
        cld
        ldx #NLOAD-1
lf_find:
        lda ftab_t,x
        cmp TRK
        bne lf_next
        lda ftab_s,x
        cmp SECT
        beq lf_found
lf_next:
        dex
        bpl lf_find
        bra io_fail             ; not a file the game knows
lf_found:
        lda PAGE
        jsr fload
        bcs io_fail
io_ok:
        jsr timing_reset        ; disk time is not frame work
        plp
        clc
        rts
io_fail:
        jsr timing_reset
        plp
        sec
        rts

; --- $76BC: read the hall of fame's two sectors at $B500 --------------------
hof_read:
        php
        sei
        cld
        ldx #HOF
        lda #HOF_PAGE
        jsr fload
        bcs io_fail
        bra io_ok

; --- $76A9: write them back (only reached after hof_read succeeded) ----------
hof_write:
        php
        sei
        cld
        ldx #HOF
        lda #HOF_PAGE
        jsr owrite
        bra io_ok

; FLOAD entry X at page A; carry set unless the file's DOS header arrived.
fload:
        stx cur
        sta dpage
        sta fl_clr+2            ; destination for the clear and the check
        sta fl_h0+2
        sta fl_h1+2
        sta fl_h2+2
        sta fl_h3+2
        lda #0
        ldx #3
fl_clr: sta $FF00,x             ; a failed load cannot leave a stale header
        dex
        bpl fl_clr
        jsr cmd_begin
        ldx #s_fload-strs
        jsr puts
        jsr put_name
        jsr put_page
        ldx #s_zero-strs
        jsr puts
        jsr put_last
        jsr run_cmd
        ldx cur
fl_h0:  lda $FF00
        cmp ftab_h0,x
        bne fl_bad
fl_h1:  lda $FF01
        cmp ftab_h1,x
        bne fl_bad
fl_h2:  lda $FF02
        cmp ftab_h2,x
        bne fl_bad
fl_h3:  lda $FF03
        cmp ftab_h3,x
        bne fl_bad
        clc
        rts
fl_bad:
        sec
        rts

; OWRITE entry X from page A.
owrite:
        stx cur
        sta dpage
        jsr cmd_begin
        ldx #s_owrite-strs
        jsr puts
        jsr put_name
        jsr put_page
        lda #' '
        jsr put
        jsr put_last
        jmp run_cmd

cmd_begin:
        stz cmdlen
        lda #CTRL_D
        jmp put

put_name:                       ; entry cur's card name
        ldx cur
        ldy ftab_name,x
pn_loop:
        lda names,y
        beq pn_done
        jsr put
        iny
        bne pn_loop
pn_done:
        rts

put_page:                       ; " pp00"
        lda #' '
        jsr put
        lda dpage
        jsr put_hex
        lda #0
        jmp put_hex

put_last:                       ; entry cur's last byte offset (size - 1)
        ldx cur
        lda ftab_hi,x
        jsr put_hex
        lda ftab_lo,x
        jmp put_hex

put_hex:
        pha
        lsr
        lsr
        lsr
        lsr
        jsr put_nyb
        pla
        and #$0F
put_nyb:
        ora #'0'
        cmp #'9'+1
        bcc put
        adc #6
put:
        phx
        ldx cmdlen
        sta cmdbuf,x
        inc cmdlen
        plx
        rts

puts:                           ; NUL-terminated string at strs+X
        lda strs,x
        beq ps_done
        jsr put
        inx
        bne puts
ps_done:
        rts

; Send cmdbuf + CR to the ROM DOS command collector through COUT.
run_cmd:
        lda #CR
        jsr put
        ldx #$0F
rc_save:
        lda $B0,x
        sta zsave,x
        dex
        bpl rc_save
        stz $BC                 ; a failed FLOAD still copies through ($BC):
        lda dpage               ; keep that on the destination
        sta $BD
        lda CSW
        sta save_csw
        lda CSW+1
        sta save_csw+1
        lda MUTE_OUTPUT
        sta save_mute
        lda romcsw
        sta CSW
        lda romcsw+1
        sta CSW+1
        lda #$80
        sta MUTE_OUTPUT
        ldx #0
rc_send:
        lda cmdbuf,x
        jsr COUT
        inx
        cmp #CR
        bne rc_send
        lda save_mute
        sta MUTE_OUTPUT
        lda save_csw
        sta CSW
        lda save_csw+1
        sta CSW+1
        ldx #$0F
rc_rest:
        lda zsave,x
        sta $B0,x
        dex
        bpl rc_rest
        rts

; --- SNES pads -----------------------------------------------------------------
; $815C: read the "paddles". Carry clear: a joystick is present.
paddles:
        jsr pad_read
        lda #1
        sta fresh               ; button1 may reuse this read (same frame)
        lda padx
        sta PDL0
        lda pady
        sta PDL1
        clc
        rts

; $610C / $6119: A = button 0 | button 1, N set when either is down.
buttons:
        stz fresh
        jsr pad_read
        lda btn0
        ora btn1
        rts

; $60CE: A = button 1, N set when down. ($60D6 then reads btn0.) Every other
; frame the game read the paddles a few instructions earlier: reuse that, so
; a frame's pad reads cost about what the Apple's paddle loop did.
button1:
        lda fresh
        stz fresh
        bne b1_value
        jsr pad_read
b1_value:
        lda btn1
        rts

pad_read:
        phx
        phy
        stz VIA1_ORB            ; latch the pads (the ROM scan's sequence)
        lda #$40
        sta VIA1_ORB
        ldx #0
pr_bit:
        stz VIA1_ORB            ; clock low: this button on PB5/PB4
        nop                     ; same settle time as the ROM scan's
        nop                     ; two table stores before its read
        nop
        nop
        nop
        lda VIA1_ORB
        eor #$FF                ; active low
        and #$30                ; either pad
        sta now,x
        lda #$80
        sta VIA1_ORB            ; clock high: shift the next button
        inx
        cpx #NBUTTONS           ; the 4 unused bits are not clocked
        bne pr_bit
        stz VIA1_ORB
        ldy #0                  ; button 0: B or X
        lda now+BT_B
        ora now+BT_X
        beq pr_b0
        ldy #$80
pr_b0:
        sty btn0
        ldy #0                  ; button 1: A or Y
        lda now+BT_A
        ora now+BT_Y
        beq pr_b1
        ldy #$80
pr_b1:
        sty btn1
        ldx #BT_LEFT
        jsr axis
        sta padx
        ldx #BT_UP
        jsr axis
        sta pady
        ldx #BT_START
        lda #KEY_ESC
        jsr edge
        ldx #BT_SELECT
        lda #KEY_R
        jsr edge
        lda pending             ; deliver once the game took the last key
        beq pr_done
        bit KBD
        bmi pr_done
        sta KBD
        stz pending
pr_done:
        ply
        plx
        rts

; X = the low button of an axis (X+1 the high one): A = paddle count.
axis:
        lda now,x
        beq ax_notlow
        lda now+1,x
        bne ax_center           ; both: centred
        lda #PAD_LOW
        rts
ax_notlow:
        lda now+1,x
        beq ax_center
        lda #PAD_HIGH
        rts
ax_center:
        lda #PAD_CENTER
        rts

; X = button, A = key: queue the key on a new press of the button.
edge:
        pha
        lda now,x
        beq ed_up
        lda held,x
        bne ed_skip
        inc held,x
        pla
        sta pending
        rts
ed_up:
        stz held,x
ed_skip:
        pla
        rts

; --- Apple II speed --------------------------------------------------------------
; Called once by the loader: quiet the Mockingboard (both VIAs: interrupts
; off and cleared, AYs reset), run its first VIA's Timer 1 free from $FFFF,
; and keep it only if it really counts (two timed probes).
timer_init:
        ldx #$00
        jsr mb_quiet
        ldx #$80
        jsr mb_quiet
        lda #$40
        sta MB_ACR              ; Timer 1 free-running, no PB7 output
        lda #$FF
        sta MB_T1LL
        sta MB_T1CH             ; loads $FFFF and starts counting
        stz have_timer
        jsr probe
        bcs ti_done
        jsr probe
        bcs ti_done
        lda #$80
        sta have_timer
        jsr timing_reset
ti_done:
        rts

; Carry clear if ~100 cycles read as 100-255 cycles on Timer 1.
probe:
        lda #$80
        sta have_timer
        jsr tick
        ldx #20
pb_dly: dex
        bne pb_dly
        jsr tick
        stz have_timer
        lda el+2
        ora el+1
        bne pb_bad
        lda el
        cmp #100
        bcc pb_bad
        clc
        rts
pb_bad:
        sec
        rts

; X = $00 or $80: one Mockingboard VIA/AY pair silent, no interrupts.
mb_quiet:
        lda #$7F
        sta $C40E,x             ; IER: all sources off
        sta $C40D,x             ; IFR: clear
        lda #$FF
        sta $C403,x             ; DDRA: AY data bus out
        lda #$07
        sta $C402,x             ; DDRB: BC1, BDIR, /RESET out
        stz $C400,x             ; /RESET low
        lda #$04
        sta $C400,x             ; /RESET high, bus inactive
        rts

; el = cycles since the last tick (24 bits). Exact up to one Timer 1 period
; (65,537 cycles, 42 ms) - a race frame is ~38,000 - and beyond that only
; while the counter has not yet passed its value at the last tick: the
; flag cannot tell one underflow from two.
tick:
        bit have_timer
        bpl tk_none
        lda MB_IFR              ; Timer 1 ran out since the last read?
        and #$40                ; (read before T1C-L clears it)
        sta tk_wrap
        lda #8
        sta tk_try
tk_read:
        lda MB_T1CH             ; high, low, high again: a stable count
        sta tk_h
        lda MB_T1CL
        sta tk_l
        lda MB_T1CH
        cmp tk_h
        beq tk_stable
        dec tk_try              ; (bounded: no card must not hang here)
        bne tk_read
tk_stable:
        sec
        lda mark
        sbc tk_l
        sta el
        lda mark+1
        sbc tk_h
        sta el+1
        stz el+2
        bcc tk_mark             ; it counted past $0000 once: el is right
        lda tk_wrap
        beq tk_mark
        inc el+2                ; ran out and counted on past the mark
tk_mark:
        lda tk_l
        sta mark
        lda tk_h
        sta mark+1
        rts
tk_none:
        stz el
        stz el+1
        stz el+2
        rts

add_work:
        clc
        lda work
        adc el
        sta work
        lda work+1
        adc el+1
        sta work+1
        lda work+2
        adc el+2
        sta work+2
        rts

; Work so far belongs to the frame; what follows (tone, WAIT) does not.
exempt_begin:
        php
        cld
        jsr tick
        jsr add_work
        plp
        rts

; The frame's work starts (again) now.
exempt_end      = tick
timing_reset:
        stz work
        stz work+1
        stz work+2
        stz amt                 ; nothing owed either way
        stz amt+1
        stz amt+2
        jmp tick

; $7D95 (JSR $803A, the frame's last routine before its page flip).
pace:
        jsr FRAME_ROUTINE
        bit have_timer
        bpl pc_rts
        php
        cld
        phx
        phy
        jsr tick
        jsr add_work
pc_check:
        lda work+2
        bne pc_skip             ; 64K+: a menu or a pause, not a race frame
        jsr scale               ; amt += work * 0.538
        sec                     ; less 1.538 x pace's own cycles that fell
        lda amt                 ; inside the work (the Apple had none)
        sbc #<PACE_DEBT
        sta amt
        lda amt+1
        sbc #>PACE_DEBT
        sta amt+1
        lda amt+2
        sbc #0
        sta amt+2
        jsr pad
        stz work                ; the next frame's work starts at pad's
        stz work+1              ; last tick; what it overshot stays in amt
        stz work+2
        bra pc_done
pc_skip:
        jsr timing_reset
pc_done:
        ply
        plx
        plp
pc_rts:
        rts

; amt += work * 0.538 (= 1/2 + 1/32 + 1/256 + 1/512 + 1/1024; 1.5385 - 1)
scale:
        lda work
        sta tt
        lda work+1
        sta tt+1
        lda work+2
        sta tt+2
        ldy #0
sc_next:
        ldx sc_shifts,y
        beq sc_done
sc_shift:
        lsr tt+2
        ror tt+1
        ror tt
        dex
        bne sc_shift
        clc
        lda amt
        adc tt
        sta amt
        lda amt+1
        adc tt+1
        sta amt+1
        lda amt+2
        adc tt+2
        sta amt+2
        iny
        bra sc_next
sc_done:
        rts
sc_shifts:  .byte 1,4,3,1,1,0

; Wait while the balance amt (24-bit signed) is above zero, counting from
; the last tick (pace's own work after that tick counts towards it). The
; last tick's overshoot is left in amt, a negative balance for next frame.
pad:
        lda amt+2
        bmi pd_done             ; already owed: no wait this frame
        ora amt+1
        ora amt
        beq pd_done
pd_loop:
        jsr tick
        lda el                  ; a timer that stopped counting must not
        ora el+1                ; hang the game: stop pacing instead
        ora el+2
        beq pd_stuck
        sec
        lda amt
        sbc el
        sta amt
        lda amt+1
        sbc el+1
        sta amt+1
        lda amt+2
        sbc el+2
        sta amt+2
        bmi pd_done             ; past zero: long enough
        ora amt
        ora amt+1
        bne pd_loop
pd_done:
        rts
pd_stuck:
        stz have_timer
        rts

; JSR $FCA8 (A = delay): WAIT for as long as it took on the Apple.
wait_apple:
        php
        phx
        sta wa_a
        jsr exempt_begin
        lda wa_a
        jsr WAIT
        ldx wa_a
        lda wtab,x
        beq wa_end
        jsr WAIT
wa_end:
        jsr exempt_end
        plx
        plp
        sec                     ; as WAIT leaves them
        lda #0
        rts

; --- quit (the game's menu, item 5) ---------------------------------------------
; The Apple II version rebooted the disk so its HELLO said goodbye. Here the
; machine goes back to the ROM DOS prompt the way a reset does.
quit:
        sei
        cld
        ldx #$FF
        txs
        ldx #$00                ; Mockingboard quiet, as it was found
        jsr mb_quiet
        ldx #$80
        jsr mb_quiet
        stz MB_ACR
        stz have_timer
        stz NMI_NEST
        stz MUTE_OUTPUT
        stz pending
        stz KBD                 ; no key left over (the reset clears it too)
        cli
        jsr SETNORM
        jsr INIT                ; text, page 1, full window
        jsr SETVID
        jsr SETKBD
        jsr HOOK_BUFFER
        jmp DOS_ENTRY

romcsw:     .word 0             ; set by the loader from the $03EA hook
btn0:       .byte 0             ; $80 = down (read by the game at $60D6)
btn1:       .byte 0
padx:       .byte PAD_CENTER
pady:       .byte PAD_CENTER
pending:    .byte 0
fresh:      .byte 0             ; paddles read the pads; button1 may reuse it
cur:        .byte 0
dpage:      .byte 0             ; (not "page": symbols ignore case, PAGE is the game's)
cmdlen:     .byte 0
save_csw:   .word 0
save_mute:  .byte 0
zsave:      .res 16
now:        .res NBUTTONS
held:       .res NBUTTONS
have_timer: .byte 0             ; $80: Mockingboard Timer 1 counts
mark:       .word 0             ; Timer 1 at the last tick
el:         .res 3              ; tick: cycles since the previous tick
work:       .res 3              ; this frame's work so far
amt:        .res 3              ; pad: cycles still to wait
tt:         .res 3
tk_wrap:    .byte 0
tk_h:       .byte 0
tk_l:       .byte 0
tk_try:     .byte 0
tn_count:   .byte 0
tn_t:       .word 0
tn_n:       .word 0
tn_n1:      .byte 0
tn_n2:      .byte 0
wa_a:       .byte 0
strs:
s_fload:    .asciiz "FLOAD "
s_zero:     .asciiz " 0000 "
s_owrite:   .asciiz "OWRITE "
cmdbuf:     .res 32
; The converter appends the file table here: NLOAD (searched by T/S list),
; HOF (the hall of fame's entry), and per entry ftab_t/ftab_s (T/S list),
; ftab_lo/ftab_hi (size - 1), ftab_h0..ftab_h3 (DOS header) and ftab_name
; (offset into names).
