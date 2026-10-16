; Ultima III for 3RIC - loader (U3.PRG). From the ROM DOS prompt, in the
; folder that holds U3.PRG and the game files:
;
;     BRUN U3.PRG 0800
;
; It stands in for the disk's boot: turns the BASIC overlay off so
; $9000-$BFFF is RAM, copies the game's resident DOS (with the SD shim in
; place of its RWTS, see shim.s) to $AF00-$BFFF, hooks COUT to it exactly as
; the booted disk left it, and runs the first program the disk ran: TEST
; (Mockingboard set-up and credits), through the DOS's own BRUN.

COUT        = $FDED
DOS_HOOK    = $03EA             ; ROM DOS: JSR hook_buffer_no_output; RTS
CSW         = $36
IMG_SRC     = $0A00             ; $AF00-$BFFF image (17 pages) in U3.PRG
IMG_DST     = $AF00
DOS_COUT    = $B44A             ; the game DOS's COUT hook
DOS_BRK     = $B72D             ; the game DOS's BRK/reset target
BRKV        = $03F0

        .org $0800

        cld
        lda COUT                ; COUT must be JMP ($0036)
        cmp #$6C
        bne bad_rom
        lda COUT+1
        cmp #$36
        bne bad_rom
        lda DOS_HOOK            ; and the ROM DOS hook installed
        cmp #$20
        beq rom_ok
bad_rom:
        ldx #0
br_loop:
        lda msg_rom,x
        beq br_done
        ora #$80
        jsr COUT
        inx
        bne br_loop
br_done:
        brk                     ; BRUN enters with JMP: no return address

rom_ok:
        stz $CAFE               ; ROM NMI nest count 0, so its exit keeps BASIC off
        bit $C007               ; BASIC ROM off: $9000-$BFFF is RAM
        ldy #17                 ; pages $AF-$BF
        ldx #0
copy:
        lda IMG_SRC,x           ; self-modified source/destination pages
        sta IMG_DST,x
        inx
        bne copy
        inc copy+2
        inc copy+5
        dey
        bne copy

        jsr DOS_HOOK            ; CSW = ROM DOS command collector, muted
        lda CSW
        sta ROMCSW
        lda CSW+1
        sta ROMCSW+1
        lda #<DOS_BRK           ; BRK vector -> the DOS's reset/wipe path,
        sta BRKV                ; as the booted disk left it (the game
        lda #>DOS_BRK           ; checks $03F1 = $B7 and jumps through it
        sta BRKV+1              ; when one of its DOS checks fails)

        bit $C051               ; text, page 1, as the disk's HELLO left it
        bit $C054
        jsr $FE93               ; SETVID (COUT1), then HOME on the screen
        jsr $FC58
        lda #<DOS_COUT          ; COUT -> the game DOS, like the booted disk
        sta CSW
        lda #>DOS_COUT
        sta CSW+1
        ldx #$FF
        txs
        ldx #0
run_test:
        lda cmd_test,x          ; Ctrl-D BRUN TEST: the DOS loads and jumps
        beq br_done             ; (only reached if the DOS returned)
        ora #$80                ; (the DOS parses high-bit ASCII)
        jsr COUT
        inx
        bne run_test

msg_rom:    .byte $8D
            .text "U3.PRG NEEDS THE 3RIC ROM DOS"
            .byte $8D,0
cmd_test:   .byte $8D,$84
            .text "BRUN TEST"
            .byte $8D,0
loader_end:
