; Ultima I for 3RIC - SNES controllers as keystrokes.
;
; STUPH reads the keyboard at $1D64 on every input wait: "LDA $C000", then
; a ready key goes into the game's 4-key type-ahead buffer ($74-$77, count
; $78). port-ultima1.mjs turns that read into "JSR $0300". padpoll returns
; exactly what LDA $C000 would - A and N/Z - except that when no key is
; waiting and a controller button has just been pressed, it returns that
; button's key with bit 7 set. The game then buffers it and touches $C010
; as for a real key (the strobe NMI finds nothing to clear). X and Y are
; preserved; a typed key always wins. (STUPH's other read, $1C59, which
; buffers typed keys while the view animates, is left alone: the game acts
; on keys only at input waits, and that read runs far more often.)
;;   D-pad  arrows (move, menus, dungeon turns)
;   A Attack   B Enter    X eXit     Y Transact
;   L Klimb    R Fire     Select Ztats   Start Space (pass)
;
; Scanning. The glue clocks both SNES pads itself on VIA1 port B, exactly as
; the ROM's @joystick_gamepads does (latch = bit 6, clock = bit 7, data =
; bit 5 pad 1 / bit 4 pad 2, active low), reading the 12 buttons. It does not use PTRIG or
; call the ROM routine: a PTRIG scan runs inside a ~1,500-cycle NMI, and the
; routine leaves through the ROM's NMI exit, whose blanket VIA1 IFR clear
; drops PS/2 and $C010 edges that arrive just before it (seen on the board in
; the A2Robots port, and reproduced by port-ultima1.native.ps1). This scan
; takes no NMI, switches no bank and touches no VIA register but ORB, so
; keyboard NMIs are served throughout. A scan takes ~400 cycles and the
; input wait polls ~30 times a second, so every poll scans (~1% of the CPU).
;
; Keys. Each button sends its key on its own press (0 -> 1), however other
; buttons overlap. The D-pad direction pressed last repeats while it is held,
; but only while the type-ahead buffer is empty, so letting go never leaves
; queued steps - first after FIRST_DELAY scans, then every REPEAT_DELAY.
;
; Lives at $0300-$03BF: unused by the game and the ROM in play (measured;
; U1.INTRO uses $03CE).

PADPORT     = $C200             ; VIA1 ORB/IRB
KBD         = $C000
KEYCOUNT    = $78               ; game: keys in its type-ahead buffer

        .org $0300

padpoll:                        ; STUPH $1D64: every input wait
        lda KBD
        bpl pp_nokey
        rts                     ; a typed key wins
pp_nokey:
        phx
scan:
        stz PADPORT
        lda #$40                ; latch both pads
        sta PADPORT
        ldx #0
scan_bit:
        stz PADPORT             ; latch and clock low: bit X on the data pins
        lda PADPORT
        and #$30                ; either pad, 0 = down
        cmp #$30
        beq sb_up
        lda prev,x
        bne sb_clock            ; still held (or a press not yet sent)
        lda #$81                ; a new press
        bra sb_store
sb_up:
        lda #0
sb_store:
        sta prev,x
sb_clock:
        lda #$80                ; clock high: the pads shift
        sta PADPORT
        inx
        cpx #12                 ; B Y Select Start Up Down Left Right A X L R
        bne scan_bit
        stz PADPORT
scan_ret:
        lda KBD                 ; a key decoded during the scan wins; any
        bmi pp_none             ; new press stays marked for the next scan
        ldx #11
pp_find:
        lda prev,x
        bmi pp_press
        dex
        bpl pp_find
        ldx lastdir             ; nothing new: repeat the held direction?
        bmi pp_none
        lda prev,x
        bne pp_held
        ldx #$FF                ; released
        stx lastdir
        bra pp_none
pp_held:
        lda KEYCOUNT            ; wait until the last step was taken
        bne pp_none
        dec repeat
        bne pp_none
        lda #REPEAT_DELAY
        sta repeat
        bra pp_send
pp_press:
        lda #1                  ; sent: now just held
        sta prev,x
        cpx #4                  ; D-pad: 4-7
        bcc pp_send
        cpx #8
        bcs pp_send
        stx lastdir
        lda #FIRST_DELAY
        sta repeat
pp_send:
        lda keytab,x
        plx
        ora #0                  ; N set: a key is ready
        rts
pp_none:
        plx
        lda KBD                 ; as the game would have read it
        rts

; Button order of the ROM's tables: B Y Select Start Up Down Left Right A X L R
keytab:     .byte $C5,$D4,$DA,$A0,$8B,$8A,$88,$95,$C1,$D8,$CB,$C6
prev:       .res 12             ; 0 up, 1 held, $81 pressed and not yet sent
lastdir:    .byte $FF           ; D-pad index that may repeat, $FF none
repeat:     .byte 0
pad_end:
