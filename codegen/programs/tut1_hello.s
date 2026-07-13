; ============================================================================
; Lesson 1 — HELLO, 3RIC        (tutorial: docs/tutorials/01-hello.md)
;
; Your very first 3ric program. It clears the screen, prints two lines, and
; stops. Every line is explained step-by-step in the lesson.
;
;   Try it in the browser (nothing to install):
;     https://ebadger.github.io/3ric/?src=programs/tut1_hello.s
;
;   Verify it locally with the headless emulator:
;     node codegen/tools/run6502.mjs codegen/programs/tut1_hello.s \
;         --expect-serial "HELLO, 3RIC" --expect-halt brk-monitor
;
;   On real hardware:  BRUN TUT1_HELLO.PRG 0800
; ============================================================================

        .org $0800          ; Load + run address. A .PRG starts executing here.

; ---- ROM routines we borrow (addresses from the platform reference) ---------
COUT    = $FDED             ; print the character in A to the screen (+ serial)
HOME    = $FC58             ; clear the text screen, cursor to the top-left

; ---- the program ------------------------------------------------------------
        jsr HOME            ; start on a clean screen

        ldx #0              ; X walks through the message, one byte at a time
print:  lda msg,x           ; A = the X-th byte of msg   (LDA addr,X = "indexed")
        beq done            ; a 0 byte marks the end of the text -> finished
        jsr COUT            ; print the character now in A
        inx                 ; advance to the next byte
        bne print           ; loop back (BNE is always taken until X would wrap)

done:   brk                 ; hand control back to the monitor: program finished

; ---- data -------------------------------------------------------------------
; COUT wants ASCII with the HIGH BIT SET, so 'H' ($48) is stored as $C8.
; $8D is a carriage return (start a new line). The final $00 stops the loop.
msg:
        .byte $C8,$C5,$CC,$CC,$CF,$AC,$A0      ; "HELLO, "
        .byte $B3,$D2,$C9,$C3                  ; "3RIC"
        .byte $8D                              ; new line
        .byte $CC,$C5,$D4,$A7,$D3,$A0          ; "LET'S "
        .byte $CD,$C1,$CB,$C5,$A0              ; "MAKE "
        .byte $C7,$C1,$CD,$C5,$D3,$AE          ; "GAMES."
        .byte $8D,$00                          ; new line, end marker
