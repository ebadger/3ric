; ============================================================================
; kfest.s — 3ric says hello to KansasFest 2026.
;
; A zero-install greeting for the Apple II crowd. It selects full-screen text,
; clears the 40x24 screen, and prints a framed welcome through the ROM monitor's
; COUT ($FDED) — which also echoes to the serial port, so the headless harness
; can verify every line. It then rests in a tight loop so the message stays put
; on screen in the browser (a clean "idle" halt).
;
;   Try it in the browser (nothing to install):
;     https://ebadger.github.io/3ric/?src=programs/kfest.s
;   ...or scan the KansasFest QR code.
;
;   Verify locally with the headless emulator:
;     node codegen/tools/run6502.mjs codegen/programs/kfest.s \
;         --expect-serial "HELLO, KANSASFEST 2026" --expect-halt idle
;
;   On real hardware:  BRUN KFEST.PRG 0800
; ============================================================================

        .org $0800

; ---- ROM routines & soft switches (from the platform reference) -------------
COUT    = $FDED             ; print A (ASCII, high bit set) to screen + serial
HOME    = $FC58             ; clear the text screen, cursor home
SW_TEXT = $C051             ; select text mode
SW_FULL = $C052             ; full screen (clear mixed graphics/text)
SW_PG1  = $C054             ; display page 1

; ---- zero-page string pointer used by PUTS ----------------------------------
STRLO   = $06
STRHI   = $07

; ---- program ----------------------------------------------------------------
        bit SW_TEXT         ; make sure we are in full-screen text, page 1
        bit SW_FULL
        bit SW_PG1
        jsr HOME            ; clean screen, cursor to the top-left

        lda #<msg           ; point PUTS at the greeting
        sta STRLO
        lda #>msg
        sta STRHI
        jsr puts

rest:   bra rest            ; keep the greeting on screen (clean idle halt)

; ---- PUTS: print the NUL-terminated string at STRLO/STRHI via COUT ----------
; The text below is stored as plain ASCII; COUT wants the high bit set, so we
; OR in $80 on the way out. That also turns a stored $0D into $8D (COUT's CR).
puts:   ldy #0
putslp: lda (STRLO),y
        beq putsend         ; $00 terminates the string
        ora #$80
        jsr COUT
        iny
        bne putslp
        inc STRHI           ; carry into the high byte for strings > 255 bytes
        bra putslp
putsend:rts

; ---- the message (plain ASCII; $0D = new line, $00 = end) -------------------
msg:    .byte $0D
        .byte "  *** HELLO, KANSASFEST 2026! ***", $0D
        .byte $0D
        .byte "  THIS IS 3RIC -- A FROM-SCRATCH", $0D
        .byte "  APPLE-II-CLASS 65C02 COMPUTER.", $0D
        .byte $0D
        .byte "  BUILT FROM CHIPS, DOCUMENTED ON", $0D
        .byte "  YOUTUBE -- AND RUNNING RIGHT NOW", $0D
        .byte "  IN YOUR BROWSER. NO INSTALL.", $0D
        .byte $0D
        .byte "  TYPE YOUR OWN 6502 BELOW, THEN", $0D
        .byte "  HIT *SHARE* TO PASS IT ON.", $0D
        .byte $00
