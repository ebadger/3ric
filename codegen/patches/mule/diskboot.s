; M.U.L.E. for 3RIC - Disk II boot (MULE.WOZ), the floppy alternative to
; MULE.PRG + the SD folder. Boot from the monitor with C600G.
;
; The $C600 boot PROM loads track 0 sectors 0-1 here (count byte = 2) and
; enters $0801. Like codegen/tools/wozgen.mjs, the loader then re-enters the
; PROM's sector reader ($C65C) once per run of sectors, with its own resume
; address patched into $0801-$0803, stepping the head itself between tracks.
; The language-card images are read to $4000-$7FFF and copied into the card
; before the game is read over them; the game goes in place, and the RAM2,
; low-page and hand-off images to the same staging pages the SD loader uses.
; Stage 2 (one page at $2000) then copies those, maps bank 2 and enters
; rt.s boot_final.
;
; The converter prepends NPIECES and BOOT_FINAL and appends the piece table
; (p_n pages, p_hi destination page). Payload page k lives at track
; (k+2)/16, sector (k+2)%16.

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
        jsr piece

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
        bne rs1
        lda $05                 ; piece done; after the three language-card
        cmp #2                  ; images, move them into the card before the
        bne rs0                 ; game is read over their staging pages
        jsr lccopy
rs0:    inc $05
        lda $05
        cmp #NPIECES
        beq done
        jsr piece
rs1:    lda $09
        cmp #16
        bcc batch
        lda #0                  ; next track
        sta $09
        inc $08
        jsr stepin
        jmp batch

done:   ldx $2b                 ; motor off, ROM read-only, stage 2
        lda $C088,x
        lda $C082
        jmp $2000

piece:  ldx $05                 ; $06 pages, $07 destination
        lda p_n,x
        sta $06
        lda p_hi,x
        sta $07
        rts

; WIN.BIN ($4000) -> $E000, RTB2.BIN ($6000) -> bank 2, RTB1.BIN ($7000) ->
; bank 1. Copied here, between sector reads: the card's write enable does
; not survive the Disk II accesses of a read.
lccopy: lda $C081               ; read ROM, write bank 2 and $E000-$FFFF
        lda $C081
        lda #$40
        ldx #$E0
        ldy #32
        jsr bcopy
        lda #$60
        ldx #$D0
        ldy #16
        jsr bcopy
        lda $C089               ; read ROM, write bank 1
        lda $C089
        lda #$70
        ldx #$D0
        ldy #16
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
