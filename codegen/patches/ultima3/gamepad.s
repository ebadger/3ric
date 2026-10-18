; Ultima III for 3RIC - SNES gamepads as keyboard input.
;
; Ultima III reads only the keyboard ($C000/$C010). A 61 Hz tick turns the
; two 3RIC SNES pads into the game's own keystrokes: each new press of a
; mapped button puts that key in $C000 (strobe set) once the game has taken
; the previous one, and a held D-pad direction repeats like a held key.
; Either pad works; the keyboard keeps working alongside.
;
; The tick is Timer 1 of the second Mockingboard VIA ($C480), which the game
; does not use for timing (Sound I/II drive only the first AY; SND/SPCH
; drives the second AY's ports, never its timer). The loader starts it and
; points the Apple IRQ vector $03FE here; the game's Mockingboard driver
; (MBS) installs its own handler into next_irq instead of $03FE (a guarded
; converter patch), so both interrupts share the line: ours is serviced
; when its T1 flag is set, anything else is passed on.
;
; Each tick reads both pads itself through VIA1 port B, the way the ROM's
; scan does (PB6 latch, PB7 clock, active-low data on PB5/PB4). It does NOT
; touch PTRIG ($C070): that runs the scan inside the ROM's NMI, whose exit
; writes $7F to VIA1's IFR and would discard a PS/2 clock edge arriving
; during the scan. Here only IRQs are masked, so keyboard NMIs interrupt the
; scan normally (the ROM's keyboard path does not touch port B). Nothing
; here touches zero page except $45, which the ROM's IRQ entry already uses
; to hold A.
;
; Lives in the dead part of the original DOS 3.3 RWTS, right after the
; JMP that replaces its entry ($BD00), and must end before $BE3D.

ACC         = $45               ; ROM IRQ entry: A saved here
KBD         = $C000
VIA1_ORB    = $C200             ; PB6 latch, PB7 clock, PB5/PB4 pad 1/2 data
PAD_LATCH_B = $40
PAD_CLOCK_B = $80
PAD_DATA_B  = $30               ; either pad, active low
VIA2_T1CL   = $C484
VIA2_IFR    = $C48D
NBUTTONS    = 12
FIRST_REPEAT = 18               ; ticks before a held direction repeats
NEXT_REPEAT = 9                 ; ticks between repeats

        .org $BD03

pad_irq:
        lda VIA2_IFR
        and #$40                ; our Timer 1?
        beq pass_on
        lda VIA2_T1CL           ; acknowledge it
        phx
        phy
        jsr pad_tick
        ply
        plx
        lda ACC
        rti
pass_on:
        jmp (next_irq)
no_irq:
        lda ACC                 ; no other handler installed
        rti
next_irq:   .word no_irq        ; MBS stores its handler here

pad_tick:
        stz VIA1_ORB            ; as the ROM scan: latch, then one clock
        lda #PAD_LATCH_B        ; per button, in SNES order B Y Select
        sta VIA1_ORB            ; Start Up Down Left Right A X L R
        ldx #0
ps_bit:
        stz VIA1_ORB            ; latch low, clock low: bit on PB5/PB4
        lda VIA1_ORB
        eor #$FF
        and #PAD_DATA_B
        sta now,x
        lda #PAD_CLOCK_B
        sta VIA1_ORB            ; clock high: shift the next bit
        inx
        cpx #NBUTTONS
        bne ps_bit
        stz VIA1_ORB
        ldx #NBUTTONS-1
pt_loop:
        lda keymap,x
        beq pt_next             ; unmapped button
        lda now,x
        bne pt_down
        stz held,x              ; released
        bra pt_next
pt_down:
        lda held,x
        bne pt_held
        inc held,x              ; new press: queue its key
        lda #FIRST_REPEAT
        sta timer,x
        lda keymap,x
        sta pending
        bra pt_next
pt_held:
        cpx #4                  ; only the D-pad (4-7) repeats
        bcc pt_next
        cpx #8
        bcs pt_next
        dec timer,x
        bne pt_next
        lda #NEXT_REPEAT
        sta timer,x
        lda pending             ; never pile up repeats: wait until the
        bne pt_next             ; game has taken the last key
        bit KBD
        bmi pt_next
        lda keymap,x
        sta pending
pt_next:
        dex
        bpl pt_loop
        lda pending             ; deliver once the game took the last key
        beq pt_done
        bit KBD
        bmi pt_done
        sta KBD
        stz pending
pt_done:
        rts

; Button -> Apple II key (high bit set), 0 = unmapped, in SNES bit order.
keymap:
        .byte $A0               ; B      Space: pass / continue
        .byte $D4               ; Y      T: transact (talk, shop)
        .byte $C9               ; Select I: ignite a torch
        .byte $C7               ; Start  G: get chest
        .byte $8D               ; Up     Return: north
        .byte $AF               ; Down   /: south
        .byte $88               ; Left   <-: west
        .byte $95               ; Right  ->: east
        .byte $C1               ; A      A: attack
        .byte $C5               ; X      E: enter
        .byte $CB               ; L      K: klimb
        .byte $C4               ; R      D: descend
now:        .res NBUTTONS
held:       .res NBUTTONS
timer:      .res NBUTTONS
pending:    .byte 0
gamepad_end:
