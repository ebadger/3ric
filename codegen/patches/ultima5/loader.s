; Ultima V for 3RIC - loader (U5.PRG). From the ROM DOS prompt, in the folder
; that holds U5.PRG and the eight disk directories:
;
;     BRUN U5.PRG 0800
;
; It stands in for DINKEYDOS's boot code: checks the ROM routines the shim
; relies on, copies the resident page ($CF00), the music glue ($CD80) and
; the player's tables into RAM2, finds the eight disk directories in one pass
; over this folder (fat32_readdirent), copies
; the SD shim and player into language-card bank 1 at $D000, clears bank 2
; and $E000-$FFFF, points the language-card NMI/IRQ vectors at the resident
; forwarders, starts the Mockingboard timer if there is a card, and runs
; STARTUP from the ULTIMA5 directory with bank 1 read/write - the state
; DINKEYDOS leaves for the game.
;
; Every language-card write happens with the ROM still selected for reads,
; so an NMI during setup always finds the ROM's vectors.
;
; The tool appends romsig ([address, first 8 bytes] per ROM FAT32 routine,
; then 0,0), segtab ([dest, source, length (0 = 256)] per RAM2
; segment, then 0,0) and dirnames (8 x 8-character directory names).

COUT        = $FDED
FAT_OFFSET  = $CC3B             ; ROM: fat32 byte offset
DIRENT      = $B8               ; ROM: fat32_readdirent's entry pointer
PTR         = $00
DST         = $02

        .org $0800

        cld
        ldx #10                 ; ROM NMI proxy the PS/2 fast path shares
nmi_chk:                        ; state ($CE00/$CE01/$CE19) with
        lda $F1BB,x
        cmp nmi_proxy,x
        bne bad_rom
        dex
        bpl nmi_chk
        ldx #0                  ; the FAT32 routines the shim calls
rs_next:
        lda romsig+1,x
        beq rom_ok
        sta PTR+1
        lda romsig,x
        sta PTR
        ldy #0
rs_cmp:
        lda (PTR),y
        cmp romsig+2,x
        bne bad_rom
        inx
        iny
        cpy #8
        bne rs_cmp
        inx
        inx
        bra rs_next
bad_rom:
        ldx #<msg_rom
        ldy #>msg_rom
fail:
        stx PTR
        sty PTR+1
        lda $C082               ; ROM reads (no-op unless the LC was mapped)
        ldy #0
fail_loop:
        lda (PTR),y
        beq fail_done
        ora #$80
        jsr COUT
        iny
        bne fail_loop
fail_done:
        brk                     ; BRUN enters with JMP: no return address

rom_ok:
        stz $CAFE               ; ROM NMI nest count 0, so its exit keeps BASIC off
        bit $C007               ; BASIC ROM off: $9000-$BFFF is RAM
        ldx #0                  ; RAM2 segments
seg_next:
        lda segtab+1,x
        beq seg_done
        sta DST+1
        lda segtab,x
        sta DST
        lda segtab+2,x
        sta PTR
        lda segtab+3,x
        sta PTR+1
        ldy segtab+4,x
seg_copy:
        dey
        lda (PTR),y
        sta (DST),y
        cpy #0
        bne seg_copy
        txa
        clc
        adc #5
        tax
        bra seg_next
seg_done:

        ldx #MS_END-MS          ; music state: silent, nothing requested
ms_clear:
        stz MS-1,x
        dex
        bne ms_clear
        lda #$3F                ; mixer off on both chips
        sta SHADOW+7
        sta SHADOW+11+7
        ldx #21
ms_written:                     ; differs everywhere: the first tick writes all
        lda SHADOW,x
        eor #$FF
        sta WRITTEN,x
        dex
        bpl ms_written
        lda #$FF
        sta IF80+3              ; full volume, as Origin's MUSIC sets it
        sta CURVOL
        sta SAVE83
        lda #<DEFLATCH
        sta LATCHL
        lda #>DEFLATCH
        sta LATCHH
        lda #ZERO_INST
        ldx #NV-1
ms_inst:
        sta V_INST,x
        dex
        bpl ms_inst
        lda #$55                ; a Mockingboard? (T1 latch reads back)
        sta MB_T1LL
        cmp MB_T1LL
        bne no_mb
        lda #$AA
        sta MB_T1LL
        cmp MB_T1LL
        bne no_mb
        lda #$7F
        sta MB_IER
        sta MB_IER+$80
        lda #$C0
        sta MUS_IER
        lda #<MB_IFR            ; resident IRQ: test the timer flag
        sta IRQ_MB_OP
        lda #>MB_IFR
        sta IRQ_MB_OP+1
no_mb:

        stz vfound              ; directory of each disk, under this folder
        stz FAT_OFFSET          ; as fat32_finddirent does
        stz FAT_OFFSET+1
        jsr ROM_OPEN_CD         ; one pass over this folder's entries
vol_entry:
        jsr ROM_READDIRENT      ; ($B8) = next entry, carry set at the end
        bcs vol_scanned
        ldy #11                 ; directories only
        lda (DIRENT),y
        and #$10
        beq vol_entry
        stz vnum
vol_try:
        lda vnum                ; dirnames[vnum] + 3 spaces = the 8.3 name?
        asl
        asl
        asl
        tax
        ldy #0
vol_cmp:
        lda #' '
        cpy #8
        bcs vol_chr
        lda dirnames,x
        inx
vol_chr:
        cmp (DIRENT),y
        bne vol_other
        iny
        cpy #11
        bne vol_cmp
        lda vnum                ; voltab entry vnum: hash, then cluster
        asl
        adc vnum
        asl
        tax
        ldy #$1A                ; cluster bytes 0-1 at $1A, 2-3 at $14
        lda (DIRENT),y
        sta VOLTAB+2,x
        iny
        lda (DIRENT),y
        sta VOLTAB+3,x
        ldy #$14
        lda (DIRENT),y
        sta VOLTAB+4,x
        iny
        lda (DIRENT),y
        sta VOLTAB+5,x
        inc vfound
        bra vol_entry
vol_other:
        inc vnum
        lda vnum
        cmp #8
        bne vol_try
        bra vol_entry
vol_scanned:
        lda vfound
        cmp #8
        beq vol_ok
        jmp vol_missing
vol_ok:

        lda $C089               ; read ROM, write bank 1
        lda $C089
        lda #<SHIM_SRC
        sta PTR
        lda #>SHIM_SRC
        sta PTR+1
        lda #$00
        sta DST
        lda #$D0
        sta DST+1
        ldx #SHIM_PAGES         ; up to the (empty) song buffer
        ldy #0
copy_shim:
        lda (PTR),y
        sta (DST),y
        iny
        bne copy_shim
        inc PTR+1
        inc DST+1
        dex
        bne copy_shim
        lda #BANKSIG_VALUE      ; bank-1 signature for the resident
        sta $DFFF

        lda $C081               ; read ROM, write bank 2 and $E000-$FFFF
        lda $C081
        lda #$D0
        sta DST+1
        ldx #48
        lda #0
        tay
clear_lc:
        sta (DST),y
        iny
        bne clear_lc
        inc DST+1
        dex
        bne clear_lc
        lda #<NMI_ENTRY
        sta $FFFA
        lda #>NMI_ENTRY
        sta $FFFB
        lda $FFFC               ; ROM reset vector (reads still see ROM)
        sta $FFFC
        lda $FFFD
        sta $FFFD
        lda #<IRQ_ENTRY
        sta $FFFE
        lda #>IRQ_ENTRY
        sta $FFFF

        lda $C08B               ; bank 1 read/write: the shim is live
        lda $C08B
        lda MUS_IER
        beq no_timer
        ldy #0                  ; both AY chips: ports out, reset pulse
mb_init:
        lda #$FF
        sta MB_DDRA,y
        lda #$1F
        sta MB_DDRB,y
        lda #$FC
        sta MB_ORB,y
        lda #$F8
        sta MB_ORB,y
        lda #$FC
        sta MB_ORB,y
        tya
        eor #$80
        tay
        bne mb_init
        lda #$40                ; T1 free-running, IRQ on each timeout
        sta MB_ACR
        lda #<DEFLATCH
        sta MB_T1CL
        lda #>DEFLATCH
        sta MB_T1CL+1
        lda #$C0
        sta MB_IER
        cli
no_timer:
        ldx #$FF
        txs
        lda #$60                ; DINKEYDOS boot zero page (slot 6, drive 1)
        sta $50
        sta $7F
        lda #1
        sta $78
        jsr $D01E
        .asciiz "/ULTIMA5"
        jsr $D006
        .asciiz "STARTUP"
        .word $8000
        bcs boot_fail
        lda EXTC                ; named by this build (STARTUP.x), not a
        cmp #'A'                ; leftover from an older U5 folder
        bcc stale
        lda $8000               ; STARTUP begins with JMP
        cmp #$4C
        bne boot_fail
        jmp $8000
stale:
        sei
        lda $C082
        jsr $FE93
        ldx #<msg_stale
        ldy #>msg_stale
        jmp fail
boot_fail:
        sei
        lda $C082               ; ROM back, report and stop in the monitor
        jsr $FE93               ; SETVID: COUT to the screen again
        ldx #<msg_boot
        ldy #>msg_boot
        jmp fail
vol_missing:
        ldx #<msg_dir
        ldy #>msg_dir
        jmp fail

msg_rom:    .byte $8D
            .text "U5.PRG NEEDS THE 3RIC ROM DOS"
            .byte $8D,0
nmi_proxy:  .byte $EE,$FE,$CA,$2C,$06,$C0,$48,$DA,$4C,$A9,$B6
msg_boot:   .byte $8D
            .text "U5: ULTIMA5/STARTUP NOT FOUND"
            .byte $8D,0
msg_dir:    .byte $8D
            .text "U5: A DISK FOLDER IS MISSING"
            .byte $8D,0
msg_stale:  .byte $8D
            .text "U5: OLD FILES FOUND - DELETE THE U5"
            .byte $8D
            .text "FOLDER ON THE CARD, THEN COPY IT AGAIN"
            .byte $8D,0
vnum:       .byte 0
vfound:     .byte 0
