; Alternate Reality: The Dungeon for 3RIC - SD-card replacement for the
; game's RWTS. The converter assembles this with sdcore.s appended
; (XORV = $87) and writes it over the RWTS core on track 0 of disk 1 side 1,
; which the boot sector loads to $4000-$4FFF.
;
; Every disk access goes through the jump table at $50B7 or straight to
; $4380 (STA $437B) / $4383, whose PHP/SEI/JSR $4517/PLP wrapper is kept:
; this replaces the routine at $4517 (to $49FC) and returns carry set on an
; error. Its parameters: $437B command (0 seek, 1 read, 2 write, 3+ format),
; $3D slot*16, $3E drive, $3F volume (0 = any), $40 track, $41 sector (16
; is added to ask for a different stepper sequence before the seek; the
; sector is the low four bits), $45/$46 buffer. It reports $437C error code
; (3 wrong volume, 4 drive error), $437D the volume found, $437F the drive.
; Data on the disk is stored XOR $87. Volumes: 16 disk 1 side 1, 17 side 2,
; 18 disk 2 side 1, 20 the character disk, 253 a City character disk.

        .org $4517

rwts:
        lda $437B
        sta c_cmd
        lda $3E
        sta c_drv
        sta $437F
        lda $3F
        sta c_vol
        lda $40
        sta c_trk
        lda $41
        cmp #16
        bcc dr_sec
        sbc #16
        sta $41
dr_sec:
        sta c_sec
        lda $45
        sta c_buf
        lda $46
        sta c_buf+1
        jsr core
        tax
        beq dr_ok
        lda #3                  ; wrong volume
        dex
        beq dr_err
        lda #4                  ; drive error
dr_err:
        sta $437C
        sec
        rts
dr_ok:
        lda c_found
        sta $437D
        clc
        rts

