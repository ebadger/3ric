; hello.s — 3ric serial "hello" demo.
;
; Prints a greeting through the ROM monitor's COUT ($FDED), which echoes to the
; ACIA serial port, then BRKs back to the monitor (the harness's halt sentinel).
;
; Build/run:  node ../tools/run6502.mjs hello.s --out hello.prg \
;                 --expect-serial "HELLO, 3RIC" --expect-halt brk-monitor
; On hardware: BRUN HELLO.PRG 0800

        .org $0800

COUT    = $FDED         ; monitor: print A (ASCII, high bit set) to screen+serial

        ldx #0
print:  lda msg,x
        beq done        ; 0 terminator ends the string
        jsr COUT
        inx
        bne print
done:   brk             ; return to monitor "*" prompt

; Message bytes carry the high bit set, as COUT expects for normal text.
msg:    .byte $C8,$C5,$CC,$CC,$CF,$AC,$A0   ; "HELLO, "
        .byte $B3,$D2,$C9,$C3               ; "3RIC"
        .byte $8D,$00                       ; CR, NUL
