; Ultima II for 3RIC - resident DOS 3.3 command translator ($9600).
;
; Ultima II drives Apple DOS 3.3 only through text commands: it prints
; Ctrl-D, "BLOAD MAP 21" (or BRUN/BSAVE), CR through COUT. The loader points
; CSW here, so this page stands where DOS 3.3's output hook stood:
;
;   - ordinary characters go straight to the screen through COUT1;
;   - a Ctrl-D ($84) starts collecting a command line, which runs at CR.
;
; Commands are translated for the 3RIC ROM DOS on the micro-SD card:
;
;   BLOAD name[,A$addr]        -> FLOAD key addr 0000 len-1
;   BRUN  name[,A$addr]        -> the same, then JMP addr
;   BSAVE name,A$addr,L$len    -> OWRITE key addr len  (file must exist)
;   NOMON/MON/MAXFILES ...     -> ignored (DOS 3.3 housekeeping)
;   DISK n                     -> port-only: select disk n's folder
;
; Each original disk is a folder (PROGRAM, PLAYER, GALACTIC). A DOS 3.3 name
; becomes a key of its first eight letters and digits ("MAP 21" -> MAP21,
; "ULTIMA II.OBJ" -> ULTIMAII), looked up only among the current disk's
; files in a table the tool appends (key, disk mask, address, length). The
; table gives BLOAD its default address and FLOAD its exact length: the
; ROM's BLOAD stores one byte past EOF, and its OWRITE of a missing file
; falls back to BSAVE code in the BASIC ROM bank, so neither is used.
; Ultima II's "insert disk" prompts are patched into DISK commands.
;
; A command naming a file that is not on the current disk, or one the
; translator does not understand, stops in the monitor with a message:
; DOS 3.3 would also have stopped the game there.
;
; ROM DOS commands go through the ROM's own Ctrl-D collector (captured by
; the loader from the $03EA hook) with screen echo muted; the ROM's FAT32
; zero page $B0-$BF and CSW are saved and restored around each one. Uses
; no zero page of its own. A, X and Y are preserved, as COUT requires.

COUT        = $FDED
COUT1       = $FDF0
MUTE_OUTPUT = $CE09             ; ROM: nonzero suppresses DOS screen echo
TXTSET      = $C051
TXTPAGE1    = $C054
CTRLD_HI    = $84
LINEMAX     = 96
ENTRYLEN    = 13                ; filetab entry: key[8], mask, addr, len

        .org $9600

        jmp out_hook            ; $9600: CSW
        jmp disk_select         ; $9603: A = disk 1-3 (loader)
romcsw:     .word 0             ; $9606: ROM DOS collector
origcsw:    .word 0             ; $9608: CSW before the port (for errors)
curdisk:    .byte $FF           ; $960A: $FF = still in the U2 folder

; ---------------------------------------------------------------------------
; SNES gamepads -> keystrokes. The loader points the ROM's IRQ vector ($03FE)
; here and runs the Mockingboard's first VIA Timer 1 at ~30 Hz. The ROM's IRQ
; entry has saved A in $45. Each tick clocks both pads on VIA1 port B with
; the ROM scan's own pin sequence ($B99B) but without touching PTRIG $C070:
; the ROM's $C070 path also arms VIA1's paddle timers, whose NMIs dropped
; PS/2 keys on the board (A2Robots). No NMI is raised here. A new press (both
; pads ORed) becomes a key in the $C000 latch, exactly where a typed key
; lands, so every input path in the game sees it. The latch is checked just
; before the store and a press counts as sent only once stored, so a busy
; latch retries on the next tick; D-pad keys repeat while held. A tick costs
; about 1,000 cycles.

MB_T1CL     = $C404             ; Mockingboard VIA 1 (slot 4)
MB_IFR      = $C40D
MB_IER      = $C40E
VIA1_ORB    = $C200             ; latch $40, clock $80; data pad 1 $20, pad 2 $10
ACIA_DATA   = $C100
ACIA_STATUS = $C101
KBD         = $C000
IRQ_SAVEA   = $45               ; where the ROM's IRQ entry saved A
REPEAT_FIRST = 10               ; ticks (~0.33 s) before a held D-pad key repeats
REPEAT_GAP  = 4                 ; ticks (~0.13 s) between repeats

pad_irq:
        bit MB_IFR              ; V = Timer 1
        bvs pi_tick
        lda ACIA_STATUS         ; the emulator routes ACIA receive to IRQ
        and #$08                ; (the board: NMI, where the ROM does this)
        beq pi_done
        lda ACIA_DATA
        ora #$80
        sta KBD
pi_done:
        lda IRQ_SAVEA
        rti
pi_tick:
        lda MB_T1CL             ; acknowledge Timer 1
        phx
        stz VIA1_ORB            ; latch the pads (ROM scan sequence)
        lda #$40
        sta VIA1_ORB
        ldx #0
pi_bit:
        stz VIA1_ORB
        nop                     ; same settle time as the ROM scan's
        nop                     ; two table stores before its read
        nop
        nop
        nop
        lda VIA1_ORB
        eor #$FF                ; active low
        and #$30                ; either pad's data bit
        beq pi_clear
        lda #1
pi_clear:
        cpx #12
        bcs pi_clock            ; bits 12-15 are unused
        sta padnow,x
pi_clock:
        lda #$80
        sta VIA1_ORB
        inx
        cpx #16
        bne pi_bit
        stz VIA1_ORB
        ldx #11
pi_button:
        lda padnow,x
        beq pi_up
        lda padheld,x
        beq pi_new
        cpx #4                  ; D-pad (4-7) repeats while held
        bcc pi_next
        cpx #8
        bcs pi_next
        lda padheld,x
        cmp #REPEAT_FIRST
        bcs pi_repeat
        inc padheld,x
        bra pi_next
pi_repeat:
        jsr pad_inject
        bcs pi_next             ; latch busy: try again next tick
        lda #REPEAT_FIRST-REPEAT_GAP
        sta padheld,x
        bra pi_next
pi_new:
        jsr pad_inject
        bcs pi_next             ; latch busy: still a new press next tick
        lda #1
        sta padheld,x
        bra pi_next
pi_up:
        stz padheld,x
pi_next:
        dex
        bpl pi_button
        plx
        lda IRQ_SAVEA
        rti

; Key for button X into the $C000 latch if no key is pending: carry clear.
pad_inject:
        lda padkeys,x
        bit KBD
        bmi pinj_busy
        sta KBD
        clc
        rts
pinj_busy:
        sec
        rts

;                 B    Y    SEL  START UP   DOWN LEFT RIGHT A    X    L    R
padkeys:    .byte $C5, $C7, $9B, $A0, $8D, $AF, $88, $95, $C1, $D4, $DA, $C9
padheld:    .res 12
padnow:     .res 12

; HELLO did not load: the loader leaves JMP no_hello at $6000.
no_hello:
        ldx #<msg_hello
        ldy #>msg_hello
        jmp fail

; ---------------------------------------------------------------------------
; Output hook.

out_hook:
        sta sva
        stx svx
        sty svy
        bit collecting
        bmi oh_collect
        cmp #CTRLD_HI
        beq oh_start
        jsr COUT1
oh_ret:
        lda sva
        ldx svx
        ldy svy
        rts
oh_start:
        lda #$80
        sta collecting
        stz linelen
        bra oh_ret
oh_collect:
        and #$7F
        cmp #$0D
        beq oh_exec
        cmp #'a'
        bcc oh_store
        cmp #'z'+1
        bcs oh_store
        and #$DF
oh_store:
        ldx linelen
        cpx #LINEMAX
        bcs oh_ret              ; an over-long line fails its lookup
        sta linebuf,x
        inc linelen
        bra oh_ret
oh_exec:
        stz collecting
        ldx linelen
        stz linebuf,x
        jsr run_line
        bra oh_ret

; ---------------------------------------------------------------------------
; Command line: verb (first four characters), name, ",A$xxxx" options.

run_line:
        stz lp
        jsr skip_spaces
        ldx lp
        ldy #0
rl_fetch:
        lda linebuf,x
        bne rl_keep
        lda #' '                ; short verb: pad, stay on the NUL
        dex
rl_keep:
        sta verb4,y
        inx
        iny
        cpy #4
        bne rl_fetch
        ldx #0                  ; verbtab offset
rl_match:
        lda verbtab,x
        beq rl_bad
        ldy #0
rl_cmp:
        lda verbtab,x
        cmp verb4,y
        bne rl_next
        inx
        iny
        cpy #4
        bne rl_cmp
        lda verbtab,x
        sta vector
        lda verbtab+1,x
        sta vector+1
rl_skipverb:                    ; past the verb word, then spaces
        ldx lp
        lda linebuf,x
        beq rl_go
        cmp #' '
        beq rl_go
        cmp #','
        beq rl_go
        inc lp
        bra rl_skipverb
rl_go:
        jsr skip_spaces
        jmp (vector)
rl_next:
        txa                     ; x = entry + y: step to the next entry
        sty tmp
        sec
        sbc tmp
        clc
        adc #6
        tax
        bra rl_match
rl_bad:
        ldx #<msg_cmd
        ldy #>msg_cmd
        jmp fail

verbtab:
        .byte "BLOA"
        .word h_bload
        .byte "BRUN"
        .word h_brun
        .byte "BSAV"
        .word h_bsave
        .byte "DISK"
        .word h_disk
        .byte "NOMO"
        .word h_ignore
        .byte "MON "
        .word h_ignore
        .byte "MAXF"
        .word h_ignore
        .byte 0

skip_spaces:
        ldx lp
        lda linebuf,x
        cmp #' '
        bne ss_done
        inc lp
        bra skip_spaces
ss_done:
        rts

; ---------------------------------------------------------------------------
; Verbs.

h_ignore:
        rts

h_bload:
        jsr name_and_file
        jmp load_file

h_brun:
        jsr name_and_file
        jsr load_file
        lda ladr
        sta brun_jmp+1
        lda ladr+1
        sta brun_jmp+2
        lda sva
        ldx svx
        ldy svy
brun_jmp:
        jmp $FFFF               ; like DOS 3.3: no return to the caller

h_bsave:
        jsr name_and_file
        bit have_a
        bpl bs_bad
        bit have_l
        bpl bs_bad
        lda opt_l               ; whole file, in place
        cmp flen
        bne bs_bad
        lda opt_l+1
        cmp flen+1
        bne bs_bad
        jsr cmd_start
        ldx #<s_owrite
        ldy #>s_owrite
        jsr cmd_str
        jsr cmd_key
        jsr cmd_space
        lda opt_a+1
        jsr cmd_hex
        lda opt_a
        jsr cmd_hex
        jsr cmd_space
        lda opt_l+1
        jsr cmd_hex
        lda opt_l
        jsr cmd_hex
        jmp send
bs_bad:
        ldx #<msg_bsave
        ldy #>msg_bsave
        jmp fail

h_disk:
        ldx lp
        lda linebuf,x
        sec
        sbc #'0'
        beq hd_bad
        cmp #4
        bcs hd_bad
        jmp disk_select
hd_bad:
        ldx #<msg_cmd
        ldy #>msg_cmd
        jmp fail

; Parse the name and options, find the file on the current disk.
name_and_file:
        jsr parse_name
        lda keylen
        beq nf_bad
        jsr parse_opts
        jsr find_file
        bcs nf_bad
        rts
nf_bad:
        ldx #<msg_file
        ldy #>msg_file
        jmp fail

; FLOAD key addr 0000 len-1 (FLOAD's end operand is inclusive).
load_file:
        lda faddr
        sta ladr
        lda faddr+1
        sta ladr+1
        bit have_a
        bpl lf_addr
        lda opt_a
        sta ladr
        lda opt_a+1
        sta ladr+1
lf_addr:
        lda flen
        ora flen+1
        beq lf_done             ; nothing to load
        lda flen
        sec
        sbc #1
        sta tmp
        lda flen+1
        sbc #0
        sta tmp+1
        jsr cmd_start
        ldx #<s_fload
        ldy #>s_fload
        jsr cmd_str
        jsr cmd_key
        jsr cmd_space
        lda ladr+1
        jsr cmd_hex
        lda ladr
        jsr cmd_hex
        ldx #<s_zero
        ldy #>s_zero
        jsr cmd_str
        lda tmp+1
        jsr cmd_hex
        lda tmp
        jsr cmd_hex
        jmp send
lf_done:
        rts

; ---------------------------------------------------------------------------
; Name -> key: letters and digits up to the first comma, eight at most.

parse_name:
        ldy #7
        lda #' '
pn_clear:
        sta key,y
        dey
        bpl pn_clear
        iny
pn_loop:
        ldx lp
        lda linebuf,x
        beq pn_done
        cmp #','
        beq pn_done
        inc lp
        cmp #'0'
        bcc pn_loop
        cmp #'9'+1
        bcc pn_take
        cmp #'A'
        bcc pn_loop
        cmp #'Z'+1
        bcs pn_loop
pn_take:
        cpy #8
        bcs pn_loop
        sta key,y
        iny
        bra pn_loop
pn_done:
        sty keylen
        rts

; Options after the name: ,A<num> ,L<num>, others (D/S/V) parsed and dropped.
parse_opts:
        stz have_a
        stz have_l
po_loop:
        ldx lp
        lda linebuf,x
        beq po_done
        inc lp
        cmp #','
        bne po_loop
        jsr skip_spaces
        ldx lp
        lda linebuf,x
        beq po_done
        sta optch
        inc lp
        jsr parse_num
        lda optch
        cmp #'A'
        bne po_len
        lda numlo
        sta opt_a
        lda numhi
        sta opt_a+1
        lda #$80
        sta have_a
        bra po_loop
po_len:
        cmp #'L'
        bne po_loop
        lda numlo
        sta opt_l
        lda numhi
        sta opt_l+1
        lda #$80
        sta have_l
        bra po_loop
po_done:
        rts

; "$hex" or decimal at lp -> numlo/numhi.
parse_num:
        stz numlo
        stz numhi
        ldx lp
        lda linebuf,x
        cmp #'$'
        bne pnum_dec
        inc lp
pnum_hex:
        ldx lp
        lda linebuf,x
        jsr hexval
        bcs pnum_end
        inc lp
        ldx #4
pnum_shift:
        asl numlo
        rol numhi
        dex
        bne pnum_shift
        ora numlo
        sta numlo
        bra pnum_hex
pnum_dec:
        ldx lp
        lda linebuf,x
        cmp #'0'
        bcc pnum_end
        cmp #'9'+1
        bcs pnum_end
        inc lp
        sec
        sbc #'0'
        pha
        asl numlo               ; num = num*2*4 + num*2
        rol numhi
        lda numlo
        sta tmp
        lda numhi
        sta tmp+1
        asl numlo
        rol numhi
        asl numlo
        rol numhi
        clc
        lda numlo
        adc tmp
        sta numlo
        lda numhi
        adc tmp+1
        sta numhi
        pla
        clc
        adc numlo
        sta numlo
        bcc pnum_dec
        inc numhi
        bra pnum_dec
pnum_end:
        rts

hexval:                         ; A = '0'-'9'/'A'-'F' -> 0-15, carry clear
        cmp #'0'
        bcc hv_bad
        cmp #'9'+1
        bcc hv_digit
        cmp #'A'
        bcc hv_bad
        cmp #'F'+1
        bcs hv_bad
        sbc #'A'-11             ; carry clear here: subtracts 'A'-10
        clc
        rts
hv_digit:
        sbc #'0'-1              ; carry clear here: subtracts '0'
        clc
        rts
hv_bad:
        sec
        rts

; ---------------------------------------------------------------------------
; Look the key up among the current disk's files. Carry clear if found,
; with faddr/flen set.

find_file:
        ldx curdisk
        cpx #4
        bcs ff_none
        lda diskbits,x
        sta curmask
        lda #<filetab
        sta fb_op+1
        lda #>filetab
        sta fb_op+2
ff_next:
        ldy #0
        jsr fbyte
        beq ff_none
ff_cmp:
        jsr fbyte
        cmp key,y
        bne ff_skip
        iny
        cpy #8
        bne ff_cmp
        jsr fbyte               ; y = 8: disk mask
        and curmask
        beq ff_skip
        iny
        jsr fbyte
        sta faddr
        iny
        jsr fbyte
        sta faddr+1
        iny
        jsr fbyte
        sta flen
        iny
        jsr fbyte
        sta flen+1
        clc
        rts
ff_skip:
        clc
        lda fb_op+1
        adc #ENTRYLEN
        sta fb_op+1
        bcc ff_next
        inc fb_op+2
        bra ff_next
ff_none:
        sec
        rts
fbyte:
fb_op:  lda $FFFF,y
        rts

diskbits:   .byte $00,$01,$02,$04

; ---------------------------------------------------------------------------
; Disk selection: CD .. (unless still in the U2 folder), CD <folder>.

disk_select:
        cmp curdisk
        beq ds_done
        sta newdisk
        lda curdisk
        cmp #$FF
        beq ds_cd
        jsr cmd_start
        ldx #<s_cdup
        ldy #>s_cdup
        jsr cmd_str
        jsr send
ds_cd:
        jsr cmd_start
        ldx #<s_cd
        ldy #>s_cd
        jsr cmd_str
        lda newdisk             ; folder name = dirnames + (disk-1)*8
        dec a
        asl a
        asl a
        asl a
        tax
        ldy #8
ds_name:
        lda dirnames,x
        cmp #' '
        beq ds_go
        jsr cmd_char
        inx
        dey
        bne ds_name
ds_go:
        jsr send
        lda newdisk
        sta curdisk
ds_done:
        rts

dirnames:   .byte "PROGRAM PLAYER  GALACTIC"

; ---------------------------------------------------------------------------
; Command buffer and the ROM DOS call.

cmd_start:
        stz cmdlen
        lda #CTRLD_HI
        bra cmd_char
cmd_space:
        lda #' '
cmd_char:
        phx
        ldx cmdlen
        sta cmdbuf,x
        inc cmdlen
        plx
        rts
cmd_str:                        ; NUL-terminated string at X (lo) / Y (hi)
        stx cs_op+1
        sty cs_op+2
        ldy #0
cs_loop:
cs_op:  lda $FFFF,y
        beq cs_done
        jsr cmd_char
        iny
        bne cs_loop
cs_done:
        rts
cmd_key:
        ldy #0
ck_loop:
        lda key,y
        cmp #' '
        beq ck_done
        jsr cmd_char
        iny
        cpy #8
        bne ck_loop
ck_done:
        rts
cmd_hex:
        pha
        lsr a
        lsr a
        lsr a
        lsr a
        jsr cmd_nyb
        pla
        and #$0F
cmd_nyb:
        ora #'0'
        cmp #'9'+1
        bcc cn_store
        adc #6
cn_store:
        jmp cmd_char

send:
        lda #$8D
        jsr cmd_char
        php                     ; no pad scan (VIA1) during SD bit-banging
        sei
        ldx #$0F
sd_save:
        lda $B0,x
        sta zsave,x
        dex
        bpl sd_save
        lda $36
        sta csave
        lda $37
        sta csave+1
        lda MUTE_OUTPUT
        sta msave
        lda romcsw
        sta $36
        lda romcsw+1
        sta $37
        lda #$80
        sta MUTE_OUTPUT
        stz sidx
sd_loop:
        ldx sidx
        lda cmdbuf,x
        sta tmp
        jsr COUT
        inc sidx
        lda tmp
        cmp #$8D
        bne sd_loop
        lda msave
        sta MUTE_OUTPUT
        lda csave
        sta $36
        lda csave+1
        sta $37
        ldx #$0F
sd_restore:
        lda zsave,x
        sta $B0,x
        dex
        bpl sd_restore
        plp
        rts

; ---------------------------------------------------------------------------
; Stop in the monitor with a message and the offending command.

fail:
        stx fl_op+1
        sty fl_op+2
        lda #$7F                ; gamepad timer off: the monitor owns input
        sta MB_IER
        lda origcsw
        sta $36
        lda origcsw+1
        sta $37
        stz MUTE_OUTPUT
        bit TXTSET
        bit TXTPAGE1
        lda #$8D
        jsr COUT
        ldx #<msg_head
        ldy #>msg_head
        jsr print
        ldy #0
fl_loop:
fl_op:  lda $FFFF,y
        beq fl_line
        ora #$80
        jsr COUT
        iny
        bne fl_loop
fl_line:
        lda #$8D
        jsr COUT
        ldx #0
fl_cmd:
        lda linebuf,x
        beq fl_end
        ora #$80
        jsr COUT
        inx
        cpx #LINEMAX
        bne fl_cmd
fl_end:
        lda #$8D
        jsr COUT
        brk

print:
        stx pr_op+1
        sty pr_op+2
        ldy #0
pr_loop:
pr_op:  lda $FFFF,y
        beq pr_done
        ora #$80
        jsr COUT
        iny
        bne pr_loop
pr_done:
        rts

s_fload:    .asciiz "FLOAD "
s_zero:     .asciiz " 0000 "
s_owrite:   .asciiz "OWRITE "
s_cd:       .asciiz "CD "
s_cdup:     .asciiz "CD .."
msg_head:   .asciiz "ULTIMA II PORT: "
msg_cmd:    .asciiz "UNKNOWN DOS COMMAND"
msg_file:   .asciiz "FILE NOT ON THIS DISK"
msg_bsave:  .asciiz "BSAVE NOT A WHOLE FILE"
msg_hello:  .asciiz "HELLO DID NOT LOAD"

sva:        .byte 0
svx:        .byte 0
svy:        .byte 0
collecting: .byte 0
linelen:    .byte 0
lp:         .byte 0
cmdlen:     .byte 0
sidx:       .byte 0
newdisk:    .byte 0
curmask:    .byte 0
keylen:     .byte 0
optch:      .byte 0
have_a:     .byte 0
have_l:     .byte 0
msave:      .byte 0
vector:     .word 0
numlo:      .byte 0
numhi:      .byte 0
tmp:        .word 0
opt_a:      .word 0
opt_l:      .word 0
faddr:      .word 0
flen:       .word 0
ladr:       .word 0
csave:      .word 0
verb4:      .res 4
key:        .res 8
zsave:      .res 16
cmdbuf:     .res 48
linebuf:    .res LINEMAX+1
; The tool appends filetab here: 13-byte entries (key space-padded to 8,
; disk mask bit 0 PROGRAM / 1 PLAYER / 2 GALACTIC, address, length), then 0.
filetab:
