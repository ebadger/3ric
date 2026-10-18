; Lode Runner for 3RIC - resident glue.
;
; Lives at $9000-$9AFF, a region of the game image that holds only unused
; data (left over from the original build; the attract-mode demo moves start
; at $9B00), and in the copy of DOS 3.3's RWTS this port replaces: buffers
; $B800-$BCFF, variables $BD00, a second code part at $BE00. The IOB at
; $B7E8-$B7FF is kept. port-loderunner.mjs writes both parts into the game
; file and redirects the game to them with guarded patches. It keeps no state
; in zero page; during a ROM DOS command all of zero page is saved and restored.
;
;  1. Disk. Every disk access of the game ends in its RWTS entry $B7B5 with
;     the IOB at $B7E8 (track, sector, buffer, command 1 read / 2 write /
;     4 format). The shim maps the level area of the floppy (tracks 3-12,
;     160 sectors; T12 S15 is the high-score sector) onto files in the
;     current disk folder and moves them with ROM DOS commands (FLOAD and
;     OWRITE through the command collector, as the Ultima ports do):
;         HISCORE   T12 S15 (256 bytes)
;         Lnn       sectors 2nn and 2nn+1 (512 bytes, nn hex 00-4F)
;     Every write is one 512-byte SD sector, which OWRITE writes correctly on
;     any cluster size. Two folders are two floppies: MASTER (the 150
;     original levels; the game itself refuses to edit it) and DATA (a Lode
;     Runner data disk for the board editor). Ctrl-D at the title or in the
;     editor swaps the folder - "the disk in the drive". Formatting the data
;     disk would take ~80 OWRITEs, so it is lazy: bytes 80-99 of the DATA
;     high-score sector (unused by the game) hold one bit per level,
;     "erased"; an erased level reads as zeros and its bit is cleared when
;     the level is next written.
;  2. Speed. The 3RIC CPU runs 1.538x an Apple II. Every frame point
;     (PLAY_SOUND, input waits, iris steps, the game-over spin) calls
;     pace_sync, which reads the CPU time since the previous point from a
;     free-running Mockingboard timer (VIA 2 T2) and waits 0.539x as long
;     again, so play runs at Apple II speed. The speaker routines
;     (PLAY_NOTE, BEEP) are re-timed on the same timer: same pitch and length.
;  3. SNES pads, read directly on VIA1 port B (as the Ultima ports do: no
;     PTRIG, no ROM scan NMI). D-pad moves, Y/X/L dig left, B/A/R dig right,
;     Start pauses (as Esc), Select gives up the life (as Ctrl-A). Pad input
;     selects joystick mode; I J K L U O or space select keyboard mode.
;  4. Level clear: the Atari version's tally sound on the Mockingboard (15
;     square-wave tones, 2 frames on and 2 off, POKEY AUDF 150 down to 80)
;     replaces the three speaker notes per 100 points.

; ---- game (runtime addresses) ----------------------------------------------
GAME_MODE   = $A7
INPUT_MODE  = $95
JOYMODE     = $CA
KEYMODE     = $CB
ENABLE_SOUND = $99
ALIVE       = $9A
KEY_CMD     = $9E
KEY_CMD_LR  = $9F
SPRITE_NUM  = $1E
GAME_COLNUM = $85
GAME_ROWNUM = $86
SCRATCH_5C  = $5C
NOTE_INDEX  = $54
TMP_PTR     = $0A
PUT_STRING  = $86E0
DRAW_SPRITE_PAGE1 = $82AA
DRAW_SPRITE_PAGE2 = $82B0
WAIT_KEY_CURSOR1 = $8700
ESC_HANDLER = $6A76
IRIS_WIPE_STEP = $88D7
ANIM_COUNT  = $8D4B
EDITOR_COMMAND_LOOP = $7C16
START_LEVEL_EDITOR = $7BB2
LEVEL_EDITOR = $7B84
SAVED_INPUT_MODE = $7C77
RESET_GAME  = $6008
READ_SHOW_SCORES = $61E4
DONT_MANIPULATE = $8098
CHECK_VALID_DATA_DISK = $807F
PS_NOTES    = $8815
PS_NONOTES  = $8832
VALID_KEYS  = $6A0B             ; I J K L O U space
IOB_TRACK   = $B7EC
IOB_SECTOR  = $B7ED
IOB_BUF     = $B7F0
IOB_CMD     = $B7F4

; ---- machine --------------------------------------------------------------
KBD         = $C000
KBDSTRB     = $C010
SPKR        = $C030
TXTPAGE2    = $C055
COUT        = $FDED
MUTE_OUTPUT = $CE09
PADPORT     = $C200             ; VIA1 ORB: PB6 latch, PB7 clock, PB5/PB4 data
MB1         = $C400             ; Mockingboard VIA 1 / AY 1
MB2         = $C480             ; Mockingboard VIA 2 / AY 2
MB_ORB      = 0
MB_ORA      = 1
MB_DDRB     = 2
MB_DDRA     = 3
MB_T1CL     = 4
MB_T1CH     = 5
MB_T2CL     = 8
MB_T2CH     = 9
MB_ACR      = 11
MB_IFR      = 13
MB_IER      = 14

; ---- buffers --------------------------------------------------------------
ZSAVE       = $B800             ; zero page during a ROM DOS command
RMW         = $B900             ; one 512-byte level file
HSBUF       = $BB00             ; HISCORE (OWRITE sends 512 bytes from here)

; ---- variables (in the replaced RWTS's space; lr_init sets those it needs) ---
VARS        = $BD00
cache_ok    = VARS
erased      = VARS+1            ; 20 bytes: one bit per level, DATA disk
cur_lo      = VARS+21
cur_hi      = VARS+22
last_lo     = VARS+23
last_hi     = VARS+24
new_lo      = VARS+25
sc_lo       = VARS+26
sc_hi       = VARS+27
ed_top      = VARS+28
ed_col      = VARS+29
tt_i        = VARS+30
pe_lo       = VARS+31
pe_hi       = VARS+32
pd_lo       = VARS+33
pd_hi       = VARS+34
credit      = VARS+35           ; 2 bytes
dl_lo       = VARS+37
dl_hi       = VARS+38
dl_c        = VARS+39           ; 2 bytes
dw_t        = VARS+41           ; 2 bytes
it_lo       = VARS+43
it_hi       = VARS+44
r_lo        = VARS+45
r_hi        = VARS+46
seg_lo      = VARS+47
seg_hi      = VARS+48
pn_y        = VARS+49
s_buf       = VARS+50           ; 2 bytes
s_cmd       = VARS+52
s_loc       = VARS+53
dx_chk      = VARS+54
dx_mute     = VARS+55
cmdlen      = VARS+56
cmdbuf      = VARS+57           ; 40 bytes
tm_lo       = VARS+97
tm_hi       = VARS+98
pc_c        = VARS+99           ; 2 bytes
chk         = VARS+101          ; 2 bytes
chk_len     = VARS+103
PAD_PERIOD  = 6293              ; pads scanned at most every 4 ms
SYNC_COST   = 140               ; pace_sync's own time, measured
SCAN_CYCLES = 760               ; a scanning pad_poll, measured: not Apple II work
FRAME2      = 52514             ; two Atari NTSC frames at 1.5734375 MHz
FRAME2_OFF  = FRAME2-400
BEEP_PERIOD = 1009              ; BEEP's 656-cycle period x 1.538
TALLY_VOL   = 14

        .org $9000

; ===========================================================================
; Start-up (MAIN, after the game relocated itself): replaces the two reads of
; $C081 (ROM read / RAM write) that began MAIN.
lr_init:
        lda #<irq_ret           ; the game's image overwrote the ROM's IRQ
        sta $03FE               ; vector; nothing should interrupt, but make
        lda #>irq_ret           ; a stray IRQ harmless
        sta $03FF
        ldx #0
        jsr mb_init
        ldx #$80
        jsr mb_init
        lda #$3E                ; mixer: tone A only
        ldx #7
        jsr ay_set
        lda #0
        ldx #8
        jsr ay_set
        lda #0
        ldx #9
        jsr ay_set
        lda #0
        ldx #10
        jsr ay_set
        stz cur_lo
        stz cur_hi
        stz last_lo
        stz last_hi
        stz cache_ok
        stz ed_top
        stz credit
        stz credit+1
        lda #2                  ; the first pad poll scans at once
        sta MB1+MB_T1CL
        stz MB1+MB_T1CH
        jmp pace_mark

irq_ret:
        lda $45                 ; the ROM's IRQ entry saved A here
        rti

mb_init:                        ; X = 0 (VIA 1) or $80 (VIA 2)
        lda #$7F
        sta MB1+MB_IER,x        ; no interrupts
        sta MB1+MB_IFR,x
        stz MB1+MB_ACR,x        ; T1 one-shot, T2 counts PHI2
        lda #$FF
        sta MB1+MB_DDRA,x
        lda #$07
        sta MB1+MB_DDRB,x
        stz MB1+MB_ORB,x        ; AY reset
        lda #$04
        sta MB1+MB_ORB,x
        rts

; Write A to AY register X on both chips. Preserves A and X.
ay_set:
        stx MB1+MB_ORA
        ldy #$07
        sty MB1+MB_ORB
        ldy #$04
        sty MB1+MB_ORB
        sta MB1+MB_ORA
        ldy #$06
        sty MB1+MB_ORB
        ldy #$04
        sty MB1+MB_ORB
        stx MB2+MB_ORA
        ldy #$07
        sty MB2+MB_ORB
        ldy #$04
        sty MB2+MB_ORB
        sta MB2+MB_ORA
        ldy #$06
        sty MB2+MB_ORB
        ldy #$04
        sty MB2+MB_ORB
        rts

; ===========================================================================
; Pacing on Mockingboard VIA 2 Timer 2: restarted at $FFFF at every sync
; point, so its count is the CPU time since; its IFR bit means >= 65536.

pace_mark:
        lda #$FF
        sta MB2+MB_T2CL
        sta MB2+MB_T2CH
        rts

rt2:                            ; A = T2 high, X = T2 low (consistent)
        lda MB2+MB_T2CH
        ldx MB2+MB_T2CL
        cmp MB2+MB_T2CH
        bne rt2
        rts

; Wait 0.539x the CPU time since the last sync point, then start a new one.
; Preserves X and Y.
pace_sync:
        phx
        phy
        lda MB2+MB_IFR          ; before rt2: reading T2CL clears the flag
        and #$20
        beq ps_meas
        jmp ps_long
ps_meas:
        jsr rt2
        sta tm_hi
        stx tm_lo
        eor #$FF
        sta pe_hi               ; E = $FFFF - T2
        txa
        eor #$FF
        sta pe_lo
        sec                     ; less the credited pad scans
        lda pe_lo
        sbc credit
        sta pe_lo
        lda pe_hi
        sbc credit+1
        sta pe_hi
        bcs ps_pos
        stz pe_lo
        stz pe_hi
ps_pos: stz credit
        stz credit+1
        lsr pe_hi               ; pad = E/2 + E/32 + E/128
        ror pe_lo
        lda pe_lo
        sta pd_lo
        lda pe_hi
        sta pd_hi
        ldx #4
ps_sh:  lsr pe_hi
        ror pe_lo
        dex
        bne ps_sh
        jsr ps_add
        lsr pe_hi
        ror pe_lo
        lsr pe_hi
        ror pe_lo
        jsr ps_add
        sec                     ; less this routine's own time
        lda pd_lo
        sbc #<SYNC_COST
        sta pd_lo
        lda pd_hi
        sbc #>SYNC_COST
        sta pd_hi
        bcs ps_room
        stz pd_lo
        stz pd_hi
ps_room:
        sec                     ; target = T2 when measured - pad, if that
        lda tm_lo               ; leaves room (no restart, so the time spent
        sbc pd_lo               ; here is part of the wait)
        tax
        lda tm_hi
        sbc pd_hi
        bcc ps_wait
        cmp #$04
        bcc ps_wait
        sta pd_hi
        stx pd_lo
        bra ps_spin
ps_long:
        stz credit
        stz credit+1
        stz pd_lo               ; 65536 or more: the most it can tell
        lda #$8A
        sta pd_hi
ps_wait:
        jsr pace_mark
        sec                     ; target = $FFFF - pad
        lda #$FF
        sbc pd_lo
        sta pd_lo
        lda #$FF
        sbc pd_hi
        sta pd_hi
ps_spin:
        jsr rt2
        cmp pd_hi
        bcc ps_done
        bne ps_spin
        cpx pd_lo
        beq ps_done
        bcs ps_spin
ps_done:
        jsr pace_mark
        ply
        plx
        rts
ps_add:
        clc
        lda pd_lo
        adc pe_lo
        sta pd_lo
        lda pd_hi
        adc pe_hi
        sta pd_hi
        rts

; Deadline waits for the re-timed speaker routines: dl counts down with T2.
; dl_wait moves the deadline dl_c cycles on and waits for it, rebasing T2
; when it gets low. Preserves Y.
dl_start:
        jsr pace_sync
        lda #$FF
        sta dl_lo
        sta dl_hi
        rts
dl_wait:
        sec
        lda dl_lo
        sbc dl_c
        sta dl_lo
        lda dl_hi
        sbc dl_c+1
        sta dl_hi
dw_spin:
        jsr rt2
        cmp dl_hi
        bcc dw_done
        bne dw_spin
        cpx dl_lo
        beq dw_done
        bcs dw_spin
dw_done:
        lda dl_hi
        cmp #$20
        bcs dw_ret
        jsr rt2                 ; overshoot = dl - T2; T2 = $FFFF again
        stx dw_t
        sta dw_t+1
        jsr pace_mark
        sec
        lda dl_lo
        sbc dw_t
        sta dw_t
        lda dl_hi
        sbc dw_t+1
        sta dw_t+1
        sec
        lda #$FF
        sbc dw_t
        sta dl_lo
        lda #$FF
        sbc dw_t+1
        sta dl_hi
dw_ret:
        rts

; dl_c = k * 15.375 (+22 if Y != 0): k inner iterations of PLAY_NOTE (10
; Apple cycles each) in 3RIC cycles, plus the 14 between click segments.
; k (1..256) in it_lo/it_hi.
iter_cycles:
        lda it_lo
        sta dl_c
        lda it_hi
        sta dl_c+1
        ldx #4
ic_x16: asl dl_c
        rol dl_c+1
        dex
        bne ic_x16
        lda it_lo               ; t = (k*4 + k) / 8
        sta dw_t
        lda it_hi
        sta dw_t+1
        asl dw_t
        rol dw_t+1
        asl dw_t
        rol dw_t+1
        clc
        lda dw_t
        adc it_lo
        sta dw_t
        lda dw_t+1
        adc it_hi
        sta dw_t+1
        ldx #3
ic_d8:  lsr dw_t+1
        ror dw_t
        dex
        bne ic_d8
        sec
        lda dl_c
        sbc dw_t
        sta dl_c
        lda dl_c+1
        sbc dw_t+1
        sta dl_c+1
        cpy #0
        beq ic_ret
        clc
        lda dl_c
        adc #22
        sta dl_c
        bcc ic_ret
        inc dl_c+1
ic_ret: rts

; PLAY_NOTE ($87BA): A = pitch (inner iterations between clicks), X =
; duration (pages of iterations), Y = length of the first page. The same
; clicks as the original loop, at Apple II times. The cost of a pitch
; stretch is worked out once, so the loop keeps up down to pitch ~8.
play_note:
        sta TMP_PTR
        stx TMP_PTR+1
        sty pn_y
        jsr dl_start
        lda TMP_PTR             ; the cost of one pitch stretch
        jsr seg_from_a
        jsr seg_cost
        lda dl_c
        sta pc_c
        lda dl_c+1
        sta pc_c+1
        lda pn_y                ; R = y0 + (dur-1)*256, y0 = 0 means 256
        sta r_lo
        lda TMP_PTR+1
        sec
        sbc #1
        sta r_hi
        lda pn_y
        bne pn_first
        inc r_hi
pn_first:
        lda TMP_PTR+1           ; the first stretch counts the duration
        jsr seg_from_a
        jsr seg_cost
pn_loop:
        lda ENABLE_SOUND
        beq pn_quiet
        lda SPKR
pn_quiet:
        lda r_hi                ; R <= seg: the last stretch, no more clicks
        cmp seg_hi
        bcc pn_last
        bne pn_more
        lda r_lo
        cmp seg_lo
        beq pn_last
        bcc pn_last
pn_more:
        sec
        lda r_lo
        sbc seg_lo
        sta r_lo
        lda r_hi
        sbc seg_hi
        sta r_hi
        jsr dl_wait
        lda TMP_PTR             ; from now on, pitch stretches
        jsr seg_from_a
        lda pc_c
        sta dl_c
        lda pc_c+1
        sta dl_c+1
        bra pn_loop
pn_last:
        lda r_lo
        sta it_lo
        lda r_hi
        sta it_hi
        ora r_lo
        beq pn_end
        ldy #0
        jsr iter_cycles
        jsr dl_wait
pn_end:
        jsr pace_mark
        stz TMP_PTR+1
        ldy #0
        rts
seg_cost:                       ; dl_c = cost of a stretch of seg iterations
        lda seg_lo
        sta it_lo
        lda seg_hi
        sta it_hi
        ldy #1
        jmp iter_cycles
seg_from_a:                     ; seg = A, 0 means 256
        sta seg_lo
        stz seg_hi
        cmp #0
        bne sfa_ret
        inc seg_hi
sfa_ret:
        rts

; BEEP ($86CE): 192 clicks 656 Apple cycles apart.
beep:
        jsr dl_start
        ldy #$C0
bp_loop:
        lda #<BEEP_PERIOD
        sta dl_c
        lda #>BEEP_PERIOD
        sta dl_c+1
        jsr dl_wait
        lda ENABLE_SOUND
        beq bp_quiet
        lda SPKR
bp_quiet:
        dey
        bne bp_loop
        jsr pace_mark
        ldx #0
        rts

; PLAY_SOUND ($8811) entry: a frame point.
ps_hook:
        jsr pace_sync
        ldy NOTE_INDEX
        beq ph_none
        jmp PS_NOTES
ph_none:
        jmp PS_NONOTES

iris_step:                      ; both JSR IRIS_WIPE_STEP
        jsr pace_sync
        jmp IRIS_WIPE_STEP

anim_pace:                      ; INC ANIM_COUNT in the game-over spin
        jsr pace_sync
        inc ANIM_COUNT
        rts

; ===========================================================================
; SNES pads.

; Clock both pads (VIA1 port B, the ROM scan's pin sequence). cur = held on
; either pad: cur_lo = B Y Select Start Up Down Left Right, cur_hi = A X L R.
pad_scan:
        stz PADPORT
        lda #$40                ; latch
        sta PADPORT
        nop
        ldx #16
psc_bit:
        stz PADPORT
        lda PADPORT
        and #$30
        cmp #$30                ; C = 1: up on both pads
        ror sc_hi
        ror sc_lo
        lda #$80                ; clock: the next bit
        sta PADPORT
        dex
        bne psc_bit
        stz PADPORT
        lda sc_lo
        eor #$FF
        sta cur_lo
        lda sc_hi
        eor #$FF
        and #$0F
        sta cur_hi
        rts

; Scan if 4 ms have passed (Mockingboard VIA 1 T1). Pad input selects
; joystick mode, except in the board editor. Preserves X and Y.
pad_poll:
        lda MB1+MB_IFR
        and #$40
        beq pp_ret
        phx
        jsr pad_scan
        plx
        lda credit+1            ; (no frame point for a while: stop counting)
        bmi pp_rearm
        clc                     ; the scan is not Apple II work: credit its
        lda credit              ; time against the next pace_sync
        adc #<SCAN_CYCLES
        sta credit
        lda credit+1
        adc #>SCAN_CYCLES
        sta credit+1
pp_rearm:
        lda #<PAD_PERIOD
        sta MB1+MB_T1CL
        lda #>PAD_PERIOD
        sta MB1+MB_T1CH
        lda cur_lo
        ora cur_hi
        beq pp_ret
        lda GAME_MODE
        cmp #5
        beq pp_ret
        lda #JOYMODE
        sta INPUT_MODE
pp_ret: rts

held_as_last:
        lda cur_lo
        sta last_lo
        lda cur_hi
        sta last_hi
        rts

; In place of "LDA BUTN1 / BMI": N = 1 if a button (not the D-pad) is held.
; Preserves X and Y.
pad_btn:
        jsr pad_poll
        lda cur_lo
        and #$0F
        ora cur_hi
        beq pb_none
        jsr held_as_last
        lda #$80
        rts
pb_none:
        lda #0
        rts

; READ_JOYSTICK_FOR_COMMAND ($6AD0), joystick mode.
pad_command:
        jsr pad_poll
        lda last_lo             ; presses since the last command read
        eor #$FF
        and cur_lo
        sta new_lo
        jsr held_as_last
        lda new_lo
        and #$08                ; Start: pause, as Esc
        beq pc_select
        jmp ESC_HANDLER
pc_select:
        lda new_lo
        and #$04                ; Select: give up this life, as Ctrl-A
        beq pc_dig
        lsr ALIVE
        rts
pc_dig:
        lda cur_lo
        and #$02                ; Y
        bne pc_left
        lda cur_hi
        and #$06                ; X L
        beq pc_right_q
pc_left:
        lda #$D5                ; 'U' dig left
        bra pc_both
pc_right_q:
        lda cur_lo
        and #$01                ; B
        bne pc_right
        lda cur_hi
        and #$09                ; A R
        beq pc_dirs
pc_right:
        lda #$CF                ; 'O' dig right
pc_both:
        sta KEY_CMD
        sta KEY_CMD_LR
        rts
pc_dirs:
        lda #$C0                ; '@' no move
        bit cur_lo
        bvc pc_r
        lda #$CA                ; Left: 'J'
        bra pc_lr
pc_r:   bpl pc_lr
        lda #$CC                ; Right: 'L'
pc_lr:  sta KEY_CMD_LR
        ldx #$C9                ; Up: 'I'
        lda cur_lo
        and #$10
        bne pc_ud
        ldx #$CB                ; Down: 'K'
        lda cur_lo
        and #$20
        bne pc_ud
        ldx #$C0
pc_ud:  stx KEY_CMD
        rts

; CHECK_JOYSTICK_OR_DELAY ($876D): a frame point in every input wait.
; C = 1: pad input in joystick mode; otherwise a short delay and C = 0.
pad_check_delay:
        jsr pace_sync
        jsr pad_poll
        lda INPUT_MODE
        cmp #KEYMODE
        beq pcd_delay
        lda cur_lo
        ora cur_hi
        beq pcd_delay
        jsr held_as_last
        sec
        rts
pcd_delay:
        ldx #$02
pcd_loop:
        dey
        bne pcd_loop
        dex
        bne pcd_loop
        clc
        rts

; CHECK_FOR_INPUT with no key waiting ($6A22).
nokey_hook:
        jsr pad_poll
        lda INPUT_MODE
        cmp #KEYMODE
        beq nk_ret
        jmp pad_command
nk_ret: rts

; CHECK_FOR_INPUT, a non-control key ($6A49): game keys select keyboard mode.
key_hook:
        lda SPRITE_NUM
        jsr upcase
        sta SPRITE_NUM
        ldx #6
kh_find:
        cmp VALID_KEYS,x
        beq kh_game
        dex
        bpl kh_find
        lda INPUT_MODE
        cmp #JOYMODE
        bne kh_store
        jmp pad_command
kh_game:
        lda #KEYMODE
        sta INPUT_MODE
kh_store:
        ldx SPRITE_NUM
        stx KEY_CMD
        stx KEY_CMD_LR
        rts

upcase:
        cmp #$E1
        bcc uc_ret
        cmp #$FB
        bcs uc_ret
        and #$DF
uc_ret: rts

; ESC_HANDLER's wait ($6A76, was WAIT_KEY_QUEUED): a key, or Start (as Esc).
pause_wait:
        lda KBD
        bmi pw_key
        jsr pad_poll
        lda last_lo
        eor #$FF
        and cur_lo
        and #$08
        sta new_lo
        jsr held_as_last
        lda new_lo
        beq pause_wait
        jsr pace_mark
        lda #$9B
        rts
pw_key:
        sta KBDSTRB
        pha
        jsr pace_mark
        pla
        rts

; End of WAIT_FOR_KEY / WAIT_FOR_KEY_WITH_CURSOR_PAGE_1: fold the key the
; caller is about to PLA to upper case.
fold2:
        jsr DRAW_SPRITE_PAGE2
        bra fold
fold1:
        jsr DRAW_SPRITE_PAGE1
fold:
        tsx                     ; the stack may wrap: index page 1 by hand
        txa
        clc
        adc #3
        tax
        lda $0100,x
        jsr upcase
        sta $0100,x
        rts

; ===========================================================================
; Level-clear tally on the Mockingboard (was 3 x APPEND_LEVEL_CLEARED_NOTE).
; Called 15 times with SCRATCH_5C = 15..1; the score is added in between.
mb_tally:
        lda SCRATCH_5C
        cmp #15
        beq mt_first
        jsr mt_wait             ; the rest of the previous tone's gap
mt_first:
        lda ENABLE_SOUND
        beq mt_timed
        lda #15
        sec
        sbc SCRATCH_5C
        asl a
        sta tt_i
        tay
        lda tally_tp,y
        ldx #0
        jsr ay_set
        ldy tt_i
        lda tally_tp+1,y
        ldx #1
        jsr ay_set
        lda #TALLY_VOL
        ldx #8
        jsr ay_set
mt_timed:
        jsr mt_start
        jsr mt_wait
        lda #0
        ldx #8
        jsr ay_set
        lda #<FRAME2_OFF        ; the gap; less the tone set-up (~400 cycles)
        sta MB2+MB_T1CL
        lda #>FRAME2_OFF
        sta MB2+MB_T1CH
        lda SCRATCH_5C
        cmp #1
        bne mt_ret
        jsr mt_wait
mt_ret: jmp pace_mark
mt_start:
        lda #<FRAME2
        sta MB2+MB_T1CL
        lda #>FRAME2
        sta MB2+MB_T1CH
        rts
mt_wait:
        lda MB2+MB_IFR
        and #$40
        beq mt_wait
        rts

; AY tone periods for POKEY AUDF N = 150, 145 ... 80 on its 64 kHz base:
; 1573437.5 / (16 * 63920.45 / (2 * (N + 1))) = 3.0769 * (N + 1).
tally_tp:
        .word 465,449,434,418,403,388,372,357,342,326,311,295,280,265,249

; ===========================================================================
; RWTS replacement ($B7B5 jumps here). C = 0 on success; the game resets on
; C = 1, as it does for a disk error.
shim:
        lda IOB_BUF
        sta s_buf
        lda IOB_BUF+1
        sta s_buf+1
        lda IOB_CMD
        sta s_cmd
        cmp #4
        bne sh_rw
        jmp format
sh_rw:
        lda IOB_TRACK
        sec
        sbc #3
        bcc sh_other
        cmp #10
        bcs sh_other
        asl a
        asl a
        asl a
        asl a
        ora IOB_SECTOR
        sta s_loc
        cmp #159
        bne sh_level
        lda s_cmd
        cmp #2
        bne hs_read
        jmp hs_write
sh_level:
        lda s_cmd
        cmp #2
        bne lv_read
        jmp lv_write
sh_other:                       ; boot sector, VTOC, catalog: not on the card
        lda s_cmd
        cmp #1
        bne sh_ok
        jsr zero_buf
sh_ok:  clc
        rts

hs_read:
        jsr cb_reset
        jsr cb_hs_load
        jsr chk_sbuf
        jsr dos_check
        bcs hr_ret
        clc                     ; remember the erased-level map
        lda s_buf
        adc #80
        sta sm_hsr+1
        lda s_buf+1
        adc #0
        sta sm_hsr+2
        ldx #19
sm_hsr: lda $FFFF,x
        sta erased,x
        dex
        bpl sm_hsr
        jsr fix_master_map
        lda #1
        sta cache_ok
        clc
hr_ret: jmp pace_mark_c

lv_read:
        jsr ensure_cache
        bcs lr_ret
        jsr is_erased
        beq lr_file
        jsr zero_buf
        clc
        rts
lr_file:
        jsr cb_reset
        jsr cb_str
        .byte "FLOAD ",0
        jsr cb_lname
        lda s_buf+1
        ldx s_buf
        jsr cb_hex4
        lda s_loc               ; offset 0 or 256 in the file
        and #1
        ldx #0
        jsr cb_hex4
        lda s_loc
        and #1
        ldx #$FF
        jsr cb_hex4
        jsr chk_sbuf
        jsr dos_check
lr_ret: jmp pace_mark_c

lv_write:
        lda disk
        bne lw_data
        clc                     ; the master's levels are never written
        rts
lw_err: jmp pace_mark_c
lw_data:
        jsr ensure_cache
        bcs lw_err
        jsr cb_reset            ; read the 512-byte file holding this level
        jsr cb_str
        .byte "FLOAD ",0
        jsr cb_lname
        lda #>RMW
        ldx #<RMW
        jsr cb_hex4
        lda #0
        tax
        jsr cb_hex4
        lda #$01
        ldx #$FF
        jsr cb_hex4
        jsr chk_rmw
        jsr dos_check
        bcs lw_err
        lda s_loc               ; the other level still erased: zeros
        eor #1
        jsr is_erased_a
        beq lw_copy
        lda s_loc
        eor #1
        jsr rmw_page
        sta sm_lz+2
        ldy #0
        lda #0
sm_lz:  sta RMW,y
        iny
        bne sm_lz
lw_copy:
        lda s_loc
        jsr rmw_page
        sta sm_lwd+2
        lda s_buf
        sta sm_lwc+1
        lda s_buf+1
        sta sm_lwc+2
        ldy #0
sm_lwc: lda $FFFF,y
sm_lwd: sta RMW,y
        iny
        bne sm_lwc
        jsr cb_reset
        jsr cb_str
        .byte "OWRITE ",0
        jsr cb_lname
        lda #>RMW
        ldx #<RMW
        jsr cb_hex4
        lda #$01
        ldx #$FF
        jsr cb_hex4
        jsr dos_exec
        jsr is_erased
        beq lw_done
        lda s_loc               ; no longer erased: record it
        jsr bit_of
        eor #$FF
        and erased,x
        sta erased,x
        jsr write_map
        bcs lw_ret
lw_done:
        clc
lw_ret: jmp pace_mark_c

rmw_page:                       ; A = page of level A's half of RMW
        and #1
        clc
        adc #>RMW
        rts

hs_write:
        jsr cb_reset            ; HISCORE must exist before an OWRITE
        jsr cb_hs_probe
        jsr chk_hs1
        jsr dos_check
        bcs hw_ret
        lda s_buf
        sta sm_hw+1
        lda s_buf+1
        sta sm_hw+2
        ldx #0
sm_hw:  lda $FFFF,x
        sta HSBUF,x
        inx
        bne sm_hw
        jsr put_map
        jsr cb_hs_write
        jsr dos_exec
        clc
hw_ret: jmp pace_mark_c

format:
        lda disk
        bne fm_data
        jsr DONT_MANIPULATE     ; as the original master-disk check did
        jmp START_LEVEL_EDITOR
fm_data:
        ldx #19
        lda #$FF
fm_map: sta erased,x
        dex
        bpl fm_map
        lda #1
        sta cache_ok
        jsr cb_reset
        jsr cb_hs_probe
        jsr chk_hs1
        jsr dos_check
        bcs fm_ret
        ldx #0
fm_clr: stz HSBUF,x
        inx
        bne fm_clr
        jsr put_map
        jsr cb_hs_write
        jsr dos_exec
        clc
fm_ret: jmp pace_mark_c

; Read HISCORE into HSBUF, put the map in, write it back.
write_map:
        jsr cb_reset
        jsr cb_str
        .byte "FLOAD HISCORE",0
        lda #>HSBUF
        ldx #<HSBUF
        jsr cb_hex4
        lda #0
        tax
        jsr cb_hex4
        lda #0
        ldx #$FF
        jsr cb_hex4
        jsr chk_hs
        jsr dos_check
        bcs wm_ret
        jsr put_map
        jsr cb_hs_write
        jsr dos_exec
        clc
wm_ret: rts

put_map:                        ; DATA: the map into HSBUF+80..99
        lda disk
        beq pm_ret
        lda cache_ok
        beq pm_ret
        ldx #19
pm_loop:
        lda erased,x
        sta HSBUF+80,x
        dex
        bpl pm_loop
pm_ret: rts

fix_master_map:                 ; the master has no erased levels
        lda disk
        bne fmm_ret
        ldx #19
fmm_loop:
        stz erased,x
        dex
        bpl fmm_loop
fmm_ret:
        rts

ensure_cache:
        lda cache_ok
        bne ec_ok
        lda s_buf               ; read HISCORE into HSBUF
        pha
        lda s_buf+1
        pha
        lda #<HSBUF
        sta s_buf
        lda #>HSBUF
        sta s_buf+1
        jsr cb_reset
        jsr cb_hs_load
        jsr chk_sbuf
        jsr dos_check
        pla
        sta s_buf+1
        pla
        sta s_buf
        bcs ec_ret
        ldx #19
ec_copy:
        lda HSBUF+80,x
        sta erased,x
        dex
        bpl ec_copy
        jsr fix_master_map
        lda #1
        sta cache_ok
ec_ok:  clc
ec_ret: rts

is_erased:
        lda s_loc
is_erased_a:                    ; Z = 0: level A is erased
        jsr bit_of
        and erased,x
        rts
bit_of:                         ; X = A/8, A = $80 >> (A&7)
        pha
        lsr a
        lsr a
        lsr a
        tax
        pla
        and #7
        tay
        lda #$80
bo_sh:  cpy #0
        beq bo_ret
        lsr a
        dey
        bra bo_sh
bo_ret: rts

zero_buf:
        lda s_buf
        sta sm_zb+1
        lda s_buf+1
        sta sm_zb+2
        ldx #0
sm_zb:  stz $FFFF,x
        inx
        bne sm_zb
        rts

pace_mark_c:                    ; pace_mark, keeping C
        php
        jsr pace_mark
        plp
        rts

; ---- ROM DOS command text --------------------------------------------------
cb_reset:
        stz cmdlen
        rts
cb_char:                        ; preserves X and Y
        phx
        ldx cmdlen
        sta cmdbuf,x
        inc cmdlen
        plx
        rts
cb_str:                         ; inline text after the JSR, 0-terminated
        pla
        sta sm_cbs+1
        pla
        sta sm_cbs+2
cbs_next:
        inc sm_cbs+1
        bne sm_cbs
        inc sm_cbs+2
sm_cbs: lda $FFFF
        beq cbs_end
        jsr cb_char
        bra cbs_next
cbs_end:
        lda sm_cbs+2
        pha
        lda sm_cbs+1
        pha
        rts
cb_hex4:                        ; " HHLL" from A (high) and X (low)
        pha
        lda #' '
        jsr cb_char
        pla
        jsr cb_hex2
        txa
cb_hex2:
        pha
        lsr a
        lsr a
        lsr a
        lsr a
        jsr cb_nyb
        pla
        and #$0F
cb_nyb: cmp #10
        bcc cbn_dig
        adc #6
cbn_dig:
        adc #'0'
        jmp cb_char
cb_lname:                       ; "Lnn" for s_loc
        lda #'L'
        jsr cb_char
        lda s_loc
        lsr a
        jmp cb_hex2
cb_hs_load:                     ; FLOAD HISCORE <s_buf> 0000 00FF
        jsr cb_str
        .byte "FLOAD HISCORE",0
        lda s_buf+1
        ldx s_buf
        jsr cb_hex4
        lda #0
        tax
        jsr cb_hex4
        lda #0
        ldx #$FF
        jmp cb_hex4
cb_hs_probe:                    ; FLOAD HISCORE HSBUF 0000 0000
        jsr cb_str
        .byte "FLOAD HISCORE",0
        lda #>HSBUF
        ldx #<HSBUF
        jsr cb_hex4
        lda #0
        tax
        jsr cb_hex4
        lda #0
        tax
        jmp cb_hex4
cb_hs_write:
        jsr cb_reset
        jsr cb_str
        .byte "OWRITE HISCORE",0
        lda #>HSBUF
        ldx #<HSBUF
        jsr cb_hex4
        lda #0
        ldx #$FF
        jmp cb_hex4

; Run the command in cmdbuf through the ROM DOS collector, echo muted, with
; all of zero page saved.
dos_exec:
        ldx #0
dx_save:
        lda $00,x
        sta ZSAVE,x
        inx
        bne dx_save
        lda romcsw
        sta $36
        lda romcsw+1
        sta $37
        lda MUTE_OUTPUT
        sta dx_mute
        lda #$80
        sta MUTE_OUTPUT
        lda #$84
        jsr COUT
        ldx #0
dx_out: cpx cmdlen
        beq dx_cr
        lda cmdbuf,x
        jsr COUT
        inx
        bra dx_out
dx_cr:  lda #$8D
        jsr COUT
        lda dx_mute
        sta MUTE_OUTPUT
        ldx #0
dx_rest:
        lda ZSAVE,x
        sta $00,x
        inx
        bne dx_rest
        rts

; ---- state kept in the game file (the loader sets romcsw) -------------------
romcsw:     .word 0             ; ROM DOS command collector
disk:       .byte 0             ; 0 = MASTER, 1 = DATA
resident_end:

; ===========================================================================
; Second part, in the replaced RWTS's space after the variables.

        .org $BE00

; ===========================================================================
; Disk folders: Ctrl-D.

; The title's keyboard poll ($61A9, was LDA KBD): pads are polled in keyboard
; mode too, so a button press selects joystick mode and starts a game.
title_kbd:
        jsr pad_poll
        lda KBD
        rts

; .key_pressed at the title ($61F6, was STA KBDSTRB).
title_key:
        sta KBDSTRB
        cmp #$84
        beq tk_swap
        rts
tk_swap:
        pla
        pla
        jsr disk_swap
        jmp READ_SHOW_SCORES    ; read and show the new disk's scores

disk_swap:
        lda disk
        eor #1
        sta disk
        stz cache_ok
        jsr cb_reset
        jsr cb_str
        .byte "CD ..",0
        jsr dos_exec
        jsr cb_reset
        jsr cb_str
        .byte "CD ",0
        lda disk
        bne ds_data
        jsr cb_str
        .byte "MASTER",0
        bra ds_go
ds_data:
        jsr cb_str
        .byte "DATA",0
ds_go:  jsr dos_exec
        jmp pace_mark

; The high-score screen ($799A, was STA TXTPAGE2): name the disk.
hs_label:
        lda GAME_ROWNUM
        pha
        lda GAME_COLNUM
        pha
        lda #15
        sta GAME_ROWNUM
        lda disk
        bne hl_data
        lda #8
        sta GAME_COLNUM
        jsr PUT_STRING
        .byte $CD,$C1,$D3,$D4,$C5,$D2,$A0,$C4,$C9,$D3,$CB,0     ; MASTER DISK
        bra hl_hint
hl_data:
        lda #9
        sta GAME_COLNUM
        jsr PUT_STRING
        .byte $C4,$C1,$D4,$C1,$A0,$C4,$C9,$D3,$CB,0             ; DATA DISK
hl_hint:
        lda #16
        sta GAME_ROWNUM
        lda #4
        sta GAME_COLNUM
        jsr PUT_STRING                                          ; (CTRL-D SWAPS DISKS)
        .byte $A8,$C3,$D4,$D2,$CC,$AD,$C4,$A0,$D3,$D7,$C1,$D0,$D3,$A0,$C4,$C9,$D3,$CB,$D3,$A9,0
        pla
        sta GAME_COLNUM
        pla
        sta GAME_ROWNUM
        sta TXTPAGE2
        rts

; Ctrl-E at the title ($6211): the editor starts on the data disk.
ed_enter:
        lda disk
        bne ee_go
        jsr disk_swap
ee_go:  jmp LEVEL_EDITOR

; The editor prompt ($7C1C, was PUT_STRING "\rCOMMAND>").
ed_prompt:
        lda #1
        sta ed_top
        jsr PUT_STRING
        .byte $8D,$A8,0                                         ; \r(
        lda disk
        bne ep_data
        jsr PUT_STRING
        .byte $CD,$C1,$D3,$D4,$C5,$D2,0                         ; MASTER
        bra ep_rest
ep_data:
        jsr PUT_STRING
        .byte $C4,$C1,$D4,$C1,0                                 ; DATA
ep_rest:
        jsr PUT_STRING
        .byte $A9,$A0,$C3,$CF,$CD,$CD,$C1,$CE,$C4,$BE,0         ; ) COMMAND>
        rts

; EDITOR_WAIT_FOR_KEY's wait ($823F). Ctrl-D swaps disks: at the command
; prompt it prompts again; inside a command (SOURCE/DESTINATION DISKETTE)
; it shows the disk at the cursor and keeps waiting. Esc at the command
; prompt leaves the editor for the title.
ed_wait:
        lda GAME_COLNUM
        sta ed_col
ew_loop:
        lda #0
        jsr WAIT_KEY_CURSOR1
        cmp #$84
        beq ew_swap
        cmp #$9B
        bne ew_ret
        ldx ed_top
        beq ew_ret
        sta KBDSTRB
        lda SAVED_INPUT_MODE
        sta INPUT_MODE
        jmp RESET_GAME
ew_ret:
        stz ed_top
        rts
ew_swap:
        sta KBDSTRB
        jsr disk_swap
        lda ed_top
        beq ew_show
        jmp EDITOR_COMMAND_LOOP
ew_show:
        lda ed_col
        sta GAME_COLNUM
        lda disk
        bne ew_data
        jsr PUT_STRING
        .byte $A0,$CD,$C1,$D3,$D4,$C5,$D2,0                     ; " MASTER"
        bra ew_loop
ew_data:
        jsr PUT_STRING
        .byte $A0,$C4,$C1,$D4,$C1,$A0,$A0,0                     ; " DATA  "
        dec GAME_COLNUM
        dec GAME_COLNUM
        bra ew_loop

; Move level, source disk check ($7D1F): the master may be the source.
move_src:
        lda disk
        bne ms_check
        rts
ms_check:
        jmp CHECK_VALID_DATA_DISK
; Run an FLOAD; C = 1 if it loaded nothing. The ROM DOS reports a missing
; file only as text, so the first chk_len bytes (0 = 256) at chk are set to
; $A5 first and must change: no level byte is $A5 (tiles are 0-9) and no
; high-score file starts with one (initials are letters, '.' or space).
dos_check:
        lda chk
        sta sm_cf+1
        sta sm_cc+1
        lda chk+1
        sta sm_cf+2
        sta sm_cc+2
        ldx chk_len
        lda #$A5
dc_fill:
        dex
sm_cf:  sta $FFFF,x
        cpx #0
        bne dc_fill
        jsr dos_exec
        ldx chk_len
dc_cmp: dex
sm_cc:  lda $FFFF,x
        cmp #$A5
        bne dc_ok
        cpx #0
        bne dc_cmp
        sec
        rts
dc_ok:  clc
        rts
chk_sbuf:                       ; check 256 bytes at s_buf
        lda s_buf
        ldx s_buf+1
        bra chk_256
chk_rmw:
        lda #<RMW
        ldx #>RMW
        bra chk_256
chk_hs:
        lda #<HSBUF
        ldx #>HSBUF
chk_256:
        stz chk_len
chk_ax: sta chk
        stx chk+1
        rts
chk_hs1:                        ; one byte at HSBUF
        lda #1
        sta chk_len
        lda #<HSBUF
        ldx #>HSBUF
        bra chk_ax
resident2_end:
