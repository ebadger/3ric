; Ultima III for 3RIC - SD-card file I/O under the game's own disk loader.
;
; The Ultima III disks boot a small resident DOS at $AF80-$BFFF: a COUT hook
; ($B44A) that parses "Ctrl-D BLOAD/BRUN/BSAVE NAME[,Dn][,Vn]" and a table
; of 96 files (12-byte entries at $AF80: reversed name[4], side, track,
; sector, address low, top page, bytes in the partial top page, whole pages).
; Files are stored top-down: the partial page (if any) sits at the top
; address, the whole pages below it. The game checksums that DOS's code
; ($B42D-$B4AD, $B5A8-$B628, $B610-$B690, $B731-$B74C) and reads its data,
; so the port keeps $AF80-$B7FF byte for byte and replaces only the DOS 3.3
; RWTS underneath: $BD00 becomes JMP rwts (the converter writes it). The
; DOS's own sector loop still runs and calls RWTS once per sector with the
; IOB at $B750 (track $B754, sector $B755, command $B75C).
;
; The first call of a BLOAD/BRUN/BSAVE arrives with ($48) still pointing at
; the matched table entry; like the real RWTS, every call leaves $48/$49
; pointing at the IOB, so the later sector calls of the same command are
; told apart and return at once. The first call moves the whole file with
; one ROM DOS command in the folder the loader ran from:
;
;     FLOAD NAME aaaa 0000 llll     (llll = length - 1: the end is inclusive)
;     OWRITE NAME aaaa llll          (the file exists on the card)
;
; By the time BSAVE reaches RWTS the memory it saves is final, and a load
; finishing early is invisible to the loop, which only counts sectors.
;
; Interrupts stay off while the ROM runs, as they did in the original RWTS:
; the game's Mockingboard IRQ driver keeps its pointers in $B0-$BB, the same
; zero page the ROM's FAT32 code uses. $B0-$BF and CSW are restored after.
; Nothing here touches zero page except $48/$49 (as RWTS does) and through
; run_cmd's save/restore.

ENT         = $48               ; DOS: matched table entry / RWTS: IOB pointer
IOB         = $B750             ; the DOS's RWTS parameter block
IOMODE      = $B75C             ; IOB command: 1 = read, 2 = write
CSW         = $36
COUT        = $FDED
MUTE_OUTPUT = $CE09             ; ROM: suppress screen echo of DOS output
CTRL_D      = $84
CR          = $8D

; $BE3D is the original RWTS's partial-byte count, which the DOS still
; writes, and $B8E7-$BB28 hold nibble tables the DOS still patches per
; side: the code starts above both.
        .org $BE40

rwts:
        php
        sei
        lda ENT                 ; a later sector of this command?
        cmp #<IOB
        bne first
        lda ENT+1
        cmp #>IOB
        beq io_done
first:
        ldy #9
        lda (ENT),y             ; bytes in the partial top page
        sta len
        iny
        lda (ENT),y             ; whole pages
        sta len+1
        ldy #7
        lda (ENT),y
        sta addr
        iny
        lda (ENT),y             ; top page
        sec
        sbc len+1
        sta addr+1
        lda len
        ora len+1
        beq io_done             ; empty entry: nothing to move
        stz cmdlen
        lda #CTRL_D
        jsr put
        lda IOMODE
        cmp #2
        beq io_write
        ldx #s_fload-strs
        jsr puts
        jsr put_name
        jsr put_addr
        ldx #s_zero-strs
        jsr puts
        lda len                 ; inclusive end = length - 1
        bne io_dec
        dec len+1
io_dec:
        dec len
        jsr put_len
        bra io_run
io_write:
        ldx #s_owrite-strs
        jsr puts
        jsr put_name
        jsr put_addr
        lda #' '
        jsr put
        jsr put_len
io_run:
        jsr run_cmd
io_done:
        lda #<IOB               ; as RWTS: $48/$49 -> IOB, carry clear
        sta ENT
        lda #>IOB
        sta ENT+1
        plp
        clc
        rts

; File name: entry bytes 3..0 (stored reversed), spaces dropped.
put_name:
        ldy #3
pn_loop:
        lda (ENT),y
        and #$7F
        cmp #' '
        beq pn_next
        jsr put
pn_next:
        dey
        bpl pn_loop
        rts

put_addr:
        lda #' '
        jsr put
        lda addr+1
        jsr put_hex
        lda addr
        jmp put_hex

put_len:
        lda len+1
        jsr put_hex
        lda len
        jmp put_hex

put_hex:
        pha
        lsr
        lsr
        lsr
        lsr
        jsr put_nyb
        pla
        and #$0F
put_nyb:
        ora #'0'
        cmp #'9'+1
        bcc put
        adc #6
put:
        phx
        ldx cmdlen
        sta cmdbuf,x
        inc cmdlen
        plx
        rts

puts:                           ; NUL-terminated string at strs+X
        lda strs,x
        beq ps_done
        jsr put
        inx
        bne puts
ps_done:
        rts

; Send cmdbuf + CR to the ROM DOS command collector through COUT.
run_cmd:
        lda #CR
        jsr put
        ldx #$0F
rc_save:
        lda $B0,x
        sta zsave,x
        dex
        bpl rc_save
        lda CSW
        sta zsave+16
        lda CSW+1
        sta zsave+17
        lda romcsw
        sta CSW
        lda romcsw+1
        sta CSW+1
        lda #$80
        sta MUTE_OUTPUT
        ldx #0
rc_send:
        lda cmdbuf,x
        jsr COUT
        inx
        cmp #CR
        bne rc_send
        lda zsave+16
        sta CSW
        lda zsave+17
        sta CSW+1
        ldx #$0F
rc_restore:
        lda zsave,x
        sta $B0,x
        dex
        bpl rc_restore
        rts

romcsw:     .word 0             ; set by the loader from the $03EA hook
addr:       .word 0
len:        .word 0
cmdlen:     .byte 0
zsave:      .res 18
strs:
s_fload:    .asciiz "FLOAD "
s_zero:     .asciiz " 0000 "
s_owrite:   .asciiz "OWRITE "
cmdbuf:     .res 32
shim_end:
