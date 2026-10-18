; Ultima I for 3RIC - SNES controllers as keystrokes.
;
; STUPH reads the keyboard in two places, both "LDA $C000" followed by
; storing a ready key in the game's 4-key type-ahead buffer ($74-$78):
; $1D64 (every input wait) and $1C59 (polled while the view is drawn).
; port-ultima1.mjs turns both into "JSR padpoll". padpoll returns exactly
; what LDA $C000 would - A and N/Z - except that when no key is waiting and
; a controller button is down, it returns that button's key with bit 7 set.
; The game then buffers it and touches $C010 as for a real key (the strobe
; NMI finds nothing to clear). X and Y are preserved.
;
; Either controller works. Touching PTRIG makes the ROM's NMI scan both
; pads into GAMEPAD1/GAMEPAD2 (one byte per button, 1 = down). A scan costs
; ~1,500 cycles and the game polls ~130 times a second while it waits, so
; only every SCAN_EVERY-th poll scans. A new press sends its key at once; a
; held D-pad direction repeats (counted in scans) only while the game's
; type-ahead buffer is empty, so letting go never leaves queued moves.
;
;   D-pad  arrows (move, menus, dungeon turns)
;   A Attack   B Enter    X eXit     Y Transact
;   L Klimb    R Fire     Select Ztats   Start Space (pass)
;
; Lives at $0300-$03BF: unused by the game and the ROM in play (measured;
; U1.INTRO uses $03CE).

GAMEPAD1    = $CEE0
GAMEPAD2    = $CEF0
PTRIG       = $C070
KBD         = $C000
KEYCOUNT    = $78               ; game: keys in its type-ahead buffer
SCAN_EVERY  = 4

        .org $0300

padpoll:
        lda KBD
        bmi pp_done             ; a typed key wins
        dec skip
        bpl pp_quiet
        lda #SCAN_EVERY-1
        sta skip
        phx
        bit PTRIG               ; ROM NMI: scan both pads
        ldx #11                 ; highest index first
pp_scan:
        lda GAMEPAD1,x
        ora GAMEPAD2,x
        bne pp_down
        dex
        bpl pp_scan
        stx held                ; $FF: nothing down
        bra pp_none
pp_down:
        cpx held
        beq pp_held
        stx held                ; a new press: send it now
        lda #FIRST_DELAY
        sta repeat
        bra pp_send
pp_held:
        cpx #4                  ; only the D-pad (4-7) repeats
        bcc pp_none
        cpx #8
        bcs pp_none
        lda KEYCOUNT            ; wait until the last move was taken
        bne pp_none
        dec repeat
        bne pp_none
        lda #REPEAT_DELAY
        sta repeat
pp_send:
        lda keytab,x
        plx
        ora #0                  ; N set: a key is ready
        rts
pp_none:
        plx
pp_quiet:
        lda KBD                 ; as the game would have read it
pp_done:
        rts

; Button order of the ROM's tables: B Y Select Start Up Down Left Right A X L R
keytab:     .byte $C5,$D4,$DA,$A0,$8B,$8A,$88,$95,$C1,$D8,$CB,$C6
held:       .byte $FF
repeat:     .byte 0
skip:       .byte 0
pad_end:
