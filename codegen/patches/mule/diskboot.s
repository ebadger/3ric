; M.U.L.E. for 3RIC - Disk II boot (MULE.WOZ), the floppy alternative to
; MULE.PRG + the SD folder. Boot from the monitor with C600G.
;
; The $C600 boot PROM loads track 0 sectors 0-1 here (count byte = 2) and
; enters $0801. Like codegen/tools/wozgen.mjs, the loader then re-enters the
; PROM's sector reader ($C65C) once per run of sectors, with its own resume
; address patched into $0801-$0803, stepping the head itself between tracks.
; It works through the same piece table as MULE.PRG (port-mule.mjs
; SEQUENCE); a piece's kind says where it goes:
;   0  in place
;   1  read to $4000, then into language-card bank 2 ($D000, 16 pages)
;   2  read to $4000, then into bank 1
;   3  read to $4000, then into $E000-$FFFF (32 pages)
;   4  no pages: run the intro (intro.s) with the motor off; snap_take
;      saves this loader's pages and zero page, the PROM's tables in page 3
;      and so on, and the intro's warm start puts them back and returns
;      here, the head where it was
; Language-card copies happen between reads: the card's write enable does
; not survive the Disk II accesses of a read. Stage 2 (one page at $2000)
; finally copies the staged RAM2 and low-page images, maps bank 2 and
; enters rt.s boot_final.
;
; The converter prepends NPIECES, BOOT_FINAL, SNAP_TAKE and INTRO_LAUNCH
; and appends the piece table (p_n pages, p_hi destination page, p_kind).
; Payload page k lives at track (k+2)/16, sector (k+2)%16.

READSEC = $C65C
WAIT    = $FCA8
CNT     = $0800

        .org $0800
count:  .byte 2                 ; the PROM loads sectors 0-1
        jmp init                ; $0801, patched to jmp resume

init:   lda #<resume
        sta $0802
        lda #>resume
        sta $0803
        bit $C007               ; BASIC ROM off: $9000-$BFFF is RAM
        lda #0
        sta $08                 ; current track
        sta $0b                 ; half-track counter
        sta $05                 ; piece
        lda #2
        sta $09                 ; next sector
        jmp nextp

batch:  sec                     ; read min(16 - sector, pages left in piece)
        lda #16
        sbc $09
        cmp $06
        bcc bt1
        lda $06
bt1:    sta $0a
        clc
        adc $09
        sta CNT                 ; last sector + 1
        lda $09
        sta $3d                 ; first sector
        lda #0
        sta $26
        lda $07
        sta $27                 ; destination page
        lda $08
        sta $41                 ; track
        ldx $2b
        jmp READSEC             ; reads, then JMP $0801 -> resume

resume: clc
        lda $09
        adc $0a
        sta $09
        clc
        lda $07
        adc $0a
        sta $07
        sec
        lda $06
        sbc $0a
        sta $06
        bne chk
        ldx $05                 ; piece done
        lda p_kind,x
        beq rs0
        jsr lcput
rs0:    inc $05
nextp:  ldx $05
        cpx #NPIECES
        beq done
        lda p_kind,x
        cmp #4
        bne np1
        jsr intro
        inc $05
        bra nextp
np1:    lda p_n,x               ; $06 pages, $07 destination
        sta $06
        lda p_hi,x
        sta $07
chk:    lda $09
        cmp #16
        bcc bt2
        lda #0                  ; next track
        sta $09
        inc $08
        jsr stepin
bt2:    jmp batch

done:   ldx $2b                 ; motor off, ROM read-only, stage 2
        lda $C088,x
        lda $C082
        jmp $2000

; Run the intro: motor and stepper phase off while it runs.
intro:  ldx $2b
        lda $C088,x
        lda $0b
        and #3
        asl a
        ora $2b
        tay
        lda $C080,y
        jsr SNAP_TAKE           ; carry clear now; set when the intro is done
        bcs in1
        jmp INTRO_LAUNCH
in1:    ldx $2b
        lda $C089,x             ; motor on again
        rts

; Piece of kind A (1-3) from $4000 into the language card.
lcput:  ldx #$D0
        ldy #16
        cmp #2
        beq lp2
        pha
        lda $C081               ; read ROM, write bank 2 and $E000-$FFFF
        lda $C081
        pla
        cmp #3
        bne lp3
        ldx #$E0
        ldy #32
        bra lp3
lp2:    lda $C089               ; read ROM, write bank 1
        lda $C089
lp3:    lda #$40
        jsr bcopy
        lda $C082
        rts
bcopy:  sta bc1+2               ; Y pages from page A to page X
        stx bc2+2
bc0:    ldx #0
bc1:    lda $FF00,x
bc2:    sta $FF00,x
        inx
        bne bc1
        inc bc1+2
        inc bc2+2
        dey
        bne bc0
        rts

stepin: ldx #2                  ; one track in: two half-steps
si1:    lda $0b
        and #3
        asl a
        ora $2b
        tay
        lda $C080,y             ; phase off
        inc $0b
        lda $0b
        and #3
        asl a
        ora #1
        ora $2b
        tay
        lda $C080,y             ; next phase on
        lda #$ff
        jsr WAIT
        dex
        bne si1
        rts
boot_code_end:

; ---- stage 2: the last piece read, at $2000
        .org $2000
stage2: sei
        lda #$24                ; RAM2 image -> $C800 (8 pages)
        ldx #$C8
        ldy #8
        jsr s2copy
        lda #$2C                ; low pages: $0300, then $0600-$08FF
        ldx #$03
        ldy #1
        jsr s2copy
        lda #$2D
        ldx #$06
        ldy #3
        jsr s2copy
        lda $C083               ; language card bank 2, read/write
        lda $C083
        jmp BOOT_FINAL
s2copy: sta s2a+2
        stx s2b+2
s2c:    ldx #0
s2a:    lda $FF00,x
s2b:    sta $FF00,x
        inx
        bne s2a
        inc s2a+2
        inc s2b+2
        dey
        bne s2c
        rts
stage2_end:

        .org $0800+$1C0
p_n:
