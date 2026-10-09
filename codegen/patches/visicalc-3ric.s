; Replaces the two LDA $C083,X instructions inside VisiCalc's bank selector.
; Its caller already saves A; X is 0 (bank 2) or 8 (bank 1).
        .org $C800
select_ram:
        phx
        inx
        inx
        inx
        lda $C080,x
state_pending:
        stx ram_mode
        lda $C080,x
        plx
        rts

; The guarded ROM's shifted $55 table entry is '=' rather than '+'.
; Normalize before returning from the completed-key NMI, not while polling.
normalize_key:
        lda $CE01
        cmp #$55
        bne key_done
        lda $CB55
        beq key_done
        lda $C000
        cmp #$BD
        bne key_done
        lda $CB12
        ora $CB59
        beq key_done
        lda #$AB
        sta $C000
key_done:
        rts
adapter_end:
