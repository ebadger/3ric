// Run after web/build.ps1: node codegen/tools/port-merlin8.test.mjs
//
// Proves the Merlin-8 SD-card glue (loader, ProDOS stand-in over FAT32,
// NMI resident) on the real ROM DOS and SPI SD emulation with a synthetic
// "MERLIN.SYSTEM" that drives every MLI call Merlin makes - no copyrighted
// data. The card's FAT, directories and files are then checked sector by
// sector through the ROM's own sd_readsector. Set MERLIN_DISKS to the
// owner's two disk images (separated by ';' or ',') to also run the real
// Merlin: catalog, load, assemble, compare the objects with the disk's own
// utilities, save, ED's full-screen editor (Ctrl-A for Open-Apple) and quit.
import assert from "node:assert/strict";
import fs from "node:fs";
import { assemble } from "./asm6502.mjs";
import harness from "./harness.cjs";
import { buildSparseFat32 } from "./ultima5/fat32.mjs";
import { ED_ORG, LAYOUT, ROM_RANGES, applyPatches, buildLoader, buildTree, edPatches, parmsPatches, readProdosVolume, romSums, systemPatches, to83 } from "./port-merlin8.mjs";

const HZ = 1573437;

// ---------------------------------------------------------------------------
// Converter: names, patches, ROM sums, image layout.

assert.equal(to83("PI.START.S"), "PISTART.S");
assert.equal(to83("MERLIN.SYSTEM"), "MERLIN.SYS");
assert.equal(to83("printfiler.s"), "PRINTFIL.S");
assert.equal(to83("ED"), "ED");
assert.equal(to83("ED.16"), "ED.16");
assert.equal(to83("WHATSIT.A.Q"), "WHATSITA.Q");
{
  const { prg, standin, loader, resident } = buildLoader();
  const s = standin.symbols;
  assert.ok(s.VARS_END <= ED_ORG, "stand-in and variables end below ED");
  assert.equal(s.STANDIN, LAYOUT.STANDIN);
  assert.ok(LAYOUT.SRC_LIMIT <= LAYOUT.SYM && LAYOUT.SYM < LAYOUT.OBJ && LAYOUT.OBJ < LAYOUT.TOP && LAYOUT.TOP * 256 <= LAYOUT.STANDIN, "source < symbols < object < stand-in");
  assert.equal(s.NODEV, 0xbf4a);
  assert.ok(resident.bytes.length <= 0x100);
  assert.ok(loader.org + loader.bytes.length <= 0x0c00);
  assert.ok(0x0800 + prg.length <= 0x2000 + 0x1000, "MERLIN.PRG is short");
  // Every patch is exact, guarded and idempotent (synthetic images).
  for (const [what, base, size, list] of [["MERLIN.SYSTEM", 0x2000, 0x48f6, systemPatches(s)], ["ED", ED_ORG, 0xc4a, edPatches(s)], ["PARMS", 0, 44, parmsPatches()]]) {
    const img = new Uint8Array(size);
    for (const p of list) img.set(p.before, p.at - base);
    const out = applyPatches(img, base, list, what);
    for (const p of list) assert.deepEqual(Array.from(out.subarray(p.at - base, p.at - base + p.after.length)), p.after, `${what} $${p.at.toString(16)}`);
    assert.deepEqual(applyPatches(out, base, list, what), out, `${what} patches are idempotent`);
    const bad = Uint8Array.from(img); bad[list[0].at - base] ^= 0xff;
    assert.throws(() => applyPatches(bad, base, list, what), /unexpected bytes/);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
      assert.ok(list[i].at + list[i].before.length <= list[j].at || list[j].at + list[j].before.length <= list[i].at, `${what} patches overlap`);
  }
  const rom = fs.readFileSync(new URL("../../emulator/Data/badger6502.bin", import.meta.url));
  assert.equal(romSums(rom).length, ROM_RANGES.length);
  console.log("PASS converter: 8.3 names, guarded patches, layout, ROM sums");
}

// ---------------------------------------------------------------------------
// The stand-in, driven by a synthetic MERLIN.SYSTEM.

const RES = 0x1c00;                     // A, P after call n at RES + 2n
const pattern = (n, k) => Uint8Array.from({ length: n }, (_, i) => (i * k + (i >> 8) + 7) & 255);
const BIG = pattern(5000, 13);
const SRC = new TextEncoder().encode("* first line\r LDA #1\r RTS\r");
const SA = buildLoader().standin.symbols;
const sysSrc = `
        .org $2000
RES = $${RES.toString(16)}
MLI = $BF00
HINT = $${SA.HINT.toString(16)}
MAXCL = $${SA.MAXCL.toString(16)}
CDIRTY = $${SA.CDIRTY.toString(16)}
        jmp start
idx:    .byte 0
tmpa:   .byte 0
rec:    php
        sta tmpa
        pla
        ldx idx
        sta RES+1,x
        lda tmpa
        sta RES,x
        inx
        inx
        stx idx
        rts
p_ed:   .byte 2
        .text "ED"
p_src:  .byte 5
        .text "src.s"
p_big:  .byte 7
        .text "BIG.BIN"
p_nope: .byte 4
        .text "NOPE"
p_vol:  .byte 4
        .text "/SD/"
p_xvol: .byte 5
        .text "/XX/A"
p_nod:  .byte 7
        .text "NODIR/X"
p_new:  .byte 5
        .text "NEW.S"
p_sub:  .byte 6
        .text "SUBDIR"
p_inn:  .byte 16
        .text "SUBDIR/INNER.BIN"
p_inn2: .byte 9
        .text "INNER.BIN"
p_home: .byte 12
        .text "/SD/MERLIN8/"
p_ren:  .byte 9
        .text "RENAMED.S"
p_bad:  .byte 6
        .text "A,B\$C!"
p_many: .byte 4
        .text "MANY"
p_mf:   .byte 11
        .text "MANY/FILE00"
p_here: .byte 11
        .text "/SD/MERLIN8"
info:   .byte $0A
        .word 0
        .res 16
open:   .byte 3
        .word 0
        .word $AE00
oref:   .byte 0
rd:     .byte 4
rref:   .byte 0
rbuf:   .word 0
rreq:   .word 0
rgot:   .word 0
cl:     .byte 1
cref:   .byte 0
mark:   .byte 2
mref:   .byte 0
mval:   .byte 0,0,0
nl:     .byte 3
nref:   .byte 0
        .byte $7F,$0D
create: .byte 7
        .word 0
cacc:   .byte $C3
ctype:  .byte $04
caux:   .word 0
cstor:  .byte 1
        .word 0,0
path1:  .byte 1
        .word 0
ren:    .byte 2
        .word p_new
        .word p_ren
ren2:   .byte 2
        .word p_ren
        .word p_big
sinfo:  .byte 7
        .word p_ren
        .byte $01
        .byte $04
        .word 0
        .res 7
online: .byte 2,0
        .word $6800
prefix: .byte 1
        .word $6900
blk:    .byte 3,$60
        .word $6A00,0
alloc:  .byte 2,0
        .word 0

; set the path at A/Y into info, open, create or path1 (all at +1)
setinfo: sta info+1
        sty info+2
        rts
setopen: sta open+1
        sty open+2
        rts
setcr:  sta create+1
        sty create+2
        rts
setp1:  sta path1+1
        sty path1+2
        rts
; read: ref from oref, buffer A/Y, count in X pages ($FF: $FFFF)
setrd:  sta rbuf
        sty rbuf+1
        lda oref
        sta rref
        sta cref
        sta mref
        sta nref
        rts

start:
        ldx #0                  ; clear the result log
rz:     stz RES,x
        stz RES+$100,x
        inx
        bne rz
        ldx #15                 ; the zero page the stand-in borrows, marked
zm:     txa
        ora #$C0
        sta $B0,x
        dex
        bpl zm
        jsr MLI                 ; 0 GET_PREFIX
        .byte $C7
        .word prefix
        jsr rec
        lda #<p_ed              ; 1 ED, typed by the loader
        ldy #>p_ed
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda info+4
        sta RES+$100
        lda info+5
        sta RES+$101
        lda info+6
        sta RES+$102
        lda #<p_src             ; 2 src.s: TXT by its extension
        ldy #>p_src
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda info+4
        sta RES+$103
        lda info+7
        sta RES+$104
        lda #<p_big             ; 3 BIG.BIN: BIN, sapling, 11 blocks
        ldy #>p_big
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        ldx #15
bi:     lda info+3,x
        sta RES+$110,x
        dex
        bpl bi
        lda #<p_nope            ; 4 missing
        ldy #>p_nope
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda #<p_vol             ; 5 the volume
        ldy #>p_vol
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda info+7
        sta RES+$105
        lda #<p_xvol            ; 6 another volume
        ldy #>p_xvol
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda #<p_nod             ; 7 a missing directory
        ldy #>p_nod
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda #<p_big             ; 8 OPEN BIG.BIN
        ldy #>p_big
        jsr setopen
        jsr MLI
        .byte $C8
        .word open
        jsr rec
        lda #<$4000             ; 9 READ it all ($FFFF requested)
        ldy #>$4000
        jsr setrd
        lda #$FF
        sta rreq
        sta rreq+1
        jsr MLI
        .byte $CA
        .word rd
        jsr rec
        lda rgot
        sta RES+$106
        lda rgot+1
        sta RES+$107
        jsr MLI                 ; 10 READ at EOF
        .byte $CA
        .word rd
        jsr rec
        lda #<1000              ; 11 SET_MARK 1000
        sta mval
        lda #>1000
        sta mval+1
        jsr MLI
        .byte $CE
        .word mark
        jsr rec
        lda #<$5800             ; 12 READ 100
        ldy #>$5800
        jsr setrd
        lda #100
        sta rreq
        stz rreq+1
        jsr MLI
        .byte $CA
        .word rd
        jsr rec
        jsr MLI                 ; 13 GET_MARK
        .byte $CF
        .word mark
        jsr rec
        lda mval
        sta RES+$108
        lda mval+1
        sta RES+$109
        lda #<6000              ; 14 SET_MARK past the end
        sta mval
        lda #>6000
        sta mval+1
        jsr MLI
        .byte $CE
        .word mark
        jsr rec
        jsr MLI                 ; 15 CLOSE
        .byte $CC
        .word cl
        jsr rec
        jsr MLI                 ; 16 READ on a closed ref
        .byte $CA
        .word rd
        jsr rec
        lda #<p_src             ; 17 OPEN src.s
        ldy #>p_src
        jsr setopen
        jsr MLI
        .byte $C8
        .word open
        jsr rec
        lda #<$5900             ; 18 NEWLINE CR
        ldy #>$5900
        jsr setrd
        jsr MLI
        .byte $C9
        .word nl
        jsr rec
        lda #64                 ; 19 READ: the first line
        sta rreq
        stz rreq+1
        jsr MLI
        .byte $CA
        .word rd
        jsr rec
        lda rgot
        sta RES+$10A
        lda #<$5940             ; 20 READ: the second line
        sta rbuf
        jsr MLI
        .byte $CA
        .word rd
        jsr rec
        lda rgot
        sta RES+$10B
        jsr MLI                 ; 21 CLOSE
        .byte $CC
        .word cl
        jsr rec
        lda #<p_new             ; 22 CREATE NEW.S
        ldy #>p_new
        jsr setcr
        jsr MLI
        .byte $C0
        .word create
        jsr rec
        jsr MLI                 ; 23 CREATE it again
        .byte $C0
        .word create
        jsr rec
        lda #<p_new             ; 24 OPEN NEW.S
        ldy #>p_new
        jsr setopen
        jsr MLI
        .byte $C8
        .word open
        jsr rec
        lda #<$3000             ; 25 WRITE 3000 bytes
        ldy #>$3000
        jsr setrd
        lda #<3000
        sta rreq
        lda #>3000
        sta rreq+1
        jsr MLI
        .byte $CB
        .word rd
        jsr rec
        lda #<($3000+3000)      ; 26 WRITE 100 more
        sta rbuf
        lda #>($3000+3000)
        sta rbuf+1
        lda #100
        sta rreq
        stz rreq+1
        jsr MLI
        .byte $CB
        .word rd
        jsr rec
        jsr MLI                 ; 27 GET_EOF
        .byte $D1
        .word mark
        jsr rec
        lda mval
        sta RES+$10C
        lda mval+1
        sta RES+$10D
        lda #<2000              ; 28 SET_EOF 2000
        sta mval
        lda #>2000
        sta mval+1
        stz mval+2
        jsr MLI
        .byte $D0
        .word mark
        jsr rec
        jsr MLI                 ; 29 GET_MARK (was 3100)
        .byte $CF
        .word mark
        jsr rec
        lda mval
        sta RES+$10E
        lda mval+1
        sta RES+$10F
        jsr MLI                 ; 30 CLOSE
        .byte $CC
        .word cl
        jsr rec
        jsr MLI                 ; 31 OPEN NEW.S
        .byte $C8
        .word open
        jsr rec
        lda #<$7000             ; 32 READ it back
        ldy #>$7000
        jsr setrd
        lda #$FF
        sta rreq
        sta rreq+1
        jsr MLI
        .byte $CA
        .word rd
        jsr rec
        lda rgot
        sta RES+$120
        lda rgot+1
        sta RES+$121
        jsr MLI                 ; 33 CLOSE
        .byte $CC
        .word cl
        jsr rec
        lda #<p_sub             ; 34 CREATE SUBDIR (a directory)
        ldy #>p_sub
        jsr setcr
        lda #$0F
        sta ctype
        lda #$0D
        sta cstor
        jsr MLI
        .byte $C0
        .word create
        jsr rec
        lda #<p_inn             ; 35 CREATE SUBDIR/INNER.BIN, aux $1234
        ldy #>p_inn
        jsr setcr
        lda #$06
        sta ctype
        lda #1
        sta cstor
        lda #$34
        sta caux
        lda #$12
        sta caux+1
        jsr MLI
        .byte $C0
        .word create
        jsr rec
        lda #<p_inn             ; 36 its type and aux type
        ldy #>p_inn
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda info+4
        sta RES+$122
        lda info+5
        sta RES+$123
        lda info+6
        sta RES+$124
        lda #<p_sub             ; 37 SET_PREFIX SUBDIR
        ldy #>p_sub
        jsr setp1
        jsr MLI
        .byte $C6
        .word path1
        jsr rec
        jsr MLI                 ; 38 GET_PREFIX
        .byte $C7
        .word prefix
        jsr rec
        ldx #20
gp:     lda $6900,x
        sta RES+$130,x
        dex
        bpl gp
        lda #<p_inn2            ; 39 INNER.BIN relative to the new prefix
        ldy #>p_inn2
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda #<p_here            ; 40 SET_PREFIX back (absolute)
        ldy #>p_here
        jsr setp1
        jsr MLI
        .byte $C6
        .word path1
        jsr rec
        jsr MLI                 ; 41 RENAME NEW.S -> RENAMED.S
        .byte $C2
        .word ren
        jsr rec
        lda #<p_new             ; 42 NEW.S is gone
        ldy #>p_new
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        jsr MLI                 ; 43 RENAME onto an existing name
        .byte $C2
        .word ren2
        jsr rec
        lda #<p_sub             ; 44 DESTROY a directory that is not empty
        ldy #>p_sub
        jsr setp1
        jsr MLI
        .byte $C1
        .word path1
        jsr rec
        lda #<p_inn             ; 45 DESTROY SUBDIR/INNER.BIN
        ldy #>p_inn
        jsr setp1
        jsr MLI
        .byte $C1
        .word path1
        jsr rec
        lda #<p_sub             ; 46 DESTROY SUBDIR
        ldy #>p_sub
        jsr setp1
        jsr MLI
        .byte $C1
        .word path1
        jsr rec
        lda #<p_bad             ; 47 a name ProDOS would not accept
        ldy #>p_bad
        jsr setcr
        jsr MLI
        .byte $C0
        .word create
        jsr rec
        jsr MLI                 ; 48 SET_FILE_INFO: lock RENAMED.S
        .byte $C3
        .word sinfo
        jsr rec
        lda #<p_ren             ; 49 GET_FILE_INFO: locked
        ldy #>p_ren
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda info+3
        sta RES+$125
        jsr MLI                 ; 50 ON_LINE
        .byte $C5
        .word online
        jsr rec
        lda #<p_many            ; 51 CREATE MANY (a directory)
        ldy #>p_many
        jsr setcr
        lda #$0D
        sta cstor
        jsr MLI
        .byte $C0
        .word create
        jsr rec
        lda #<p_mf              ; 52.. CREATE MANY/FILE00-FILE19
        ldy #>p_mf
        jsr setcr
        lda #1
        sta cstor
        stz manyn
many:   jsr MLI
        .byte $C0
        .word create
        jsr rec
        inc p_mf+11
        lda p_mf+11
        cmp #'9'+1
        bne many_n
        lda #'0'
        sta p_mf+11
        inc p_mf+10
many_n: inc manyn
        lda manyn
        cmp #20
        bne many
        lda #<p_many            ; 72 OPEN MANY
        ldy #>p_many
        jsr setopen
        jsr MLI
        .byte $C8
        .word open
        jsr rec
        lda #<$6000             ; 73, 74 READ two directory blocks
        ldy #>$6000
        jsr setrd
        lda #0
        sta rreq
        lda #2
        sta rreq+1
        jsr MLI
        .byte $CA
        .word rd
        jsr rec
        lda #>$6200
        sta rbuf+1
        jsr MLI
        .byte $CA
        .word rd
        jsr rec
        jsr MLI                 ; 75 a third: EOF
        .byte $CA
        .word rd
        jsr rec
        jsr MLI                 ; 76 CLOSE
        .byte $CC
        .word cl
        jsr rec
        lda #<p_vol             ; 77 OPEN the volume directory
        ldy #>p_vol
        jsr setopen
        jsr MLI
        .byte $C8
        .word open
        jsr rec
        lda #<$6400             ; 78 READ its first block
        ldy #>$6400
        jsr setrd
        jsr MLI
        .byte $CA
        .word rd
        jsr rec
        lda #<p_big             ; 79, 80, 81 three files open, then a fourth
        ldy #>p_big
        jsr setopen
        jsr MLI
        .byte $C8
        .word open
        jsr rec
        jsr MLI
        .byte $C8
        .word open
        jsr rec
        jsr MLI
        .byte $C8
        .word open
        jsr rec
        jsr MLI                 ; 82 CLOSE 0: all
        .byte $CC
        .word cl0
        jsr rec
        jsr MLI                 ; 83 GET_TIME
        .byte $82
        .word 0
        jsr rec
        jsr MLI                 ; 84 ALLOC_INTERRUPT
        .byte $40
        .word alloc
        jsr rec
        jsr MLI                 ; 85 READ_BLOCK
        .byte $80
        .word blk
        jsr rec
        jsr MLI                 ; 86 an unknown call
        .byte $FF
        .word 0
        jsr rec
        ldx #$5A                ; 87 X/Y preserved
        ldy #$A5
        jsr MLI
        .byte $82
        .word 0
        stx RES+$126
        sty RES+$127
        jsr rec
        ldx #15                 ; zero page restored
        ldy #0
zc:     txa
        ora #$C0
        cmp $B0,x
        beq zok
        iny
zok:    dex
        bpl zc
        sty RES+$128

; Locked files, paths with directories, names ProDOS refuses, the prefix
; directory, a full card and a file too large for ProDOS (calls 88-).
        lda #$C3
        sta cacc
        lda #$06
        sta ctype
        lda #1
        sta cstor
        lda #$21                ; 88 CREATE LOCKD.S locked
        sta cacc
        lda #<p_lk
        ldy #>p_lk
        jsr setcr
        jsr MLI
        .byte $C0
        .word create
        jsr rec
        lda #$C3
        sta cacc
        lda #<p_lk              ; 89 OPEN it
        ldy #>p_lk
        jsr setopen
        jsr MLI
        .byte $C8
        .word open
        jsr rec
        lda #<$3000             ; 90 WRITE: refused
        ldy #>$3000
        jsr setrd
        lda #10
        sta rreq
        stz rreq+1
        jsr MLI
        .byte $CB
        .word rd
        jsr rec
        lda #5                  ; 91 SET_EOF: refused
        sta mval
        stz mval+1
        stz mval+2
        jsr MLI
        .byte $D0
        .word mark
        jsr rec
        jsr MLI                 ; 92 CLOSE
        .byte $CC
        .word cl
        jsr rec
        lda #<p_lk              ; 93 DESTROY: refused
        ldy #>p_lk
        jsr setp1
        jsr MLI
        .byte $C1
        .word path1
        jsr rec
        jsr MLI                 ; 94 RENAME: refused
        .byte $C2
        .word ren3
        jsr rec
        lda #<p_dbl             ; 95 CREATE /SD//X
        ldy #>p_dbl
        jsr setcr
        jsr MLI
        .byte $C0
        .word create
        jsr rec
        lda #<p_dot             ; 96 CREATE .S
        ldy #>p_dot
        jsr setcr
        jsr MLI
        .byte $C0
        .word create
        jsr rec
        lda #$0D                ; 97 CREATE MANY/SUB (a directory)
        sta cstor
        lda #<p_msub
        ldy #>p_msub
        jsr setcr
        jsr MLI
        .byte $C0
        .word create
        jsr rec
        lda #1
        sta cstor
        jsr MLI                 ; 98 RENAME MANY/FILE00 MANY/RENAMED
        .byte $C2
        .word ren4
        jsr rec
        lda #<p_mren            ; 99 the new name
        ldy #>p_mren
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda #<p_mf0             ; 100 the old name is gone
        ldy #>p_mf0
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda #<p_here            ; 101 MERLIN8 kept its name
        ldy #>p_here
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda #<p_msub            ; 102 SET_PREFIX MANY/SUB
        ldy #>p_msub
        jsr setp1
        jsr MLI
        .byte $C6
        .word path1
        jsr rec
        lda #<p_absb            ; 103 DESTROY the prefix directory: refused
        ldy #>p_absb
        jsr setp1
        jsr MLI
        .byte $C1
        .word path1
        jsr rec
        lda #<p_here            ; 104 SET_PREFIX back
        ldy #>p_here
        jsr setp1
        jsr MLI
        .byte $C6
        .word path1
        jsr rec
        lda #<p_msub            ; 105 DESTROY MANY/SUB
        ldy #>p_msub
        jsr setp1
        jsr MLI
        .byte $C1
        .word path1
        jsr rec
        lda #<p_full            ; 106 CREATE FULL.BIN
        ldy #>p_full
        jsr setcr
        jsr MLI
        .byte $C0
        .word create
        jsr rec
        lda #<p_full            ; 107 OPEN it
        ldy #>p_full
        jsr setopen
        jsr MLI
        .byte $C8
        .word open
        jsr rec
        ldx #3                  ; the card ends at the hint (plus freed clusters)
fc_sv:  lda MAXCL,x
        sta maxsv,x
        dex
        bpl fc_sv
        clc
        ldx #0
        lda #0
fc_add: adc HINT,x
        sta MAXCL,x
        lda #0
        inx
        cpx #4
        bne fc_add
        lda #<$3000             ; 108 WRITE 20000: the card fills up
        ldy #>$3000
        jsr setrd
        lda #<20000
        sta rreq
        lda #>20000
        sta rreq+1
        jsr MLI
        .byte $CB
        .word rd
        jsr rec
        lda rgot
        sta RES+$160
        lda rgot+1
        sta RES+$161
        jsr MLI                 ; 109 GET_EOF
        .byte $D1
        .word mark
        jsr rec
        lda mval
        sta RES+$162
        lda mval+1
        sta RES+$163
        lda #100                ; 110 SET_MARK 100
        sta mval
        stz mval+1
        stz mval+2
        jsr MLI
        .byte $CE
        .word mark
        jsr rec
        lda #<30000             ; 111 SET_EOF 30000: full
        sta mval
        lda #>30000
        sta mval+1
        jsr MLI
        .byte $D0
        .word mark
        jsr rec
        jsr MLI                 ; 112 GET_EOF: unchanged
        .byte $D1
        .word mark
        jsr rec
        lda mval
        sta RES+$164
        lda mval+1
        sta RES+$165
        lda mval+2
        sta RES+$166
        jsr MLI                 ; 113 GET_MARK: kept
        .byte $CF
        .word mark
        jsr rec
        lda mval
        sta RES+$167
        lda mval+1
        sta RES+$168
        lda #<p_empty           ; 114 CREATE EMPTY.BIN on the full card
        ldy #>p_empty
        jsr setcr
        jsr MLI
        .byte $C0
        .word create
        jsr rec
        lda #<p_empty           ; 115 OPEN it
        ldy #>p_empty
        jsr setopen
        jsr MLI
        .byte $C8
        .word open
        jsr rec
        lda #<$3000             ; 116, 117 WRITE twice: full both times
        ldy #>$3000
        jsr setrd
        lda #10
        sta rreq
        stz rreq+1
        jsr MLI
        .byte $CB
        .word rd
        jsr rec
        jsr MLI
        .byte $CB
        .word rd
        jsr rec
        lda rgot
        sta RES+$16B
        lda rgot+1
        sta RES+$16C
        ldx #3
fc_rs:  lda maxsv,x
        sta MAXCL,x
        dex
        bpl fc_rs
        jsr MLI                 ; 118 CLOSE 0 (both files)
        .byte $CC
        .word cl0
        jsr rec
        lda #<p_huge            ; 119 CREATE HUGE.BIN
        ldy #>p_huge
        jsr setcr
        jsr MLI
        .byte $C0
        .word create
        jsr rec
        lda #<p_huge            ; 120 its entry is now in the cache
        ldy #>p_huge
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda #$01                ; size 16 MB (entry byte 31)
        jsr hugeset
        jsr MLI                 ; 121 GET_FILE_INFO: largest ProDOS EOF
        .byte $C4
        .word info
        jsr rec
        lda info+8
        sta RES+$169
        lda info+9
        sta RES+$16A
        lda #<p_huge            ; 122 OPEN: refused
        ldy #>p_huge
        jsr setopen
        jsr MLI
        .byte $C8
        .word open
        jsr rec
        lda #<p_huge            ; 123 GET_FILE_INFO again (cache)
        ldy #>p_huge
        jsr setinfo
        jsr MLI
        .byte $C4
        .word info
        jsr rec
        lda #0
        jsr hugeset
        lda #<p_huge            ; 124 DESTROY HUGE.BIN
        ldy #>p_huge
        jsr setp1
        jsr MLI
        .byte $C1
        .word path1
        jsr rec
        bra lcsect

; Byte 31 of HUGE.BIN's entry in the stand-in's sector cache = A.
hugeset: sta tmpa
        lda #$00
        sta $FE
        lda #$AE
        sta $FF
hs_lp:  ldy #0
        lda ($FE),y
        cmp #'H'
        bne hs_nx
        iny
        lda ($FE),y
        cmp #'U'
        bne hs_nx
        iny
        lda ($FE),y
        cmp #'G'
        bne hs_nx
        ldy #31
        lda tmpa
        sta ($FE),y
        lda #1
        sta CDIRTY
        rts
hs_nx:  clc
        lda $FE
        adc #32
        sta $FE
        bcc hs_lp
        inc $FF
        lda $FF
        cmp #$B0
        bne hs_lp
        brk

lcsect:
; Language card: MLI calls and NMIs keep the mode Merlin had selected.
        lda $C081               ; read ROM, write bank 2
        lda $C081
        lda #$60
        sta $DFFF               ; bank 2 signature (Merlin's RTS there)
        lda #$B2
        sta $D000
        lda #$00                ; the resident as the card's NMI vector
        sta $FFFA
        lda #$CF
        sta $FFFB
        lda $FFFE               ; IRQ like the ROM
        sta $FFFE
        lda $C089               ; write bank 1
        lda $C089
        lda #$05
        sta $DFFF
        lda #$B1
        sta $D000
        lda $C080               ; bank 2, read-only
        jsr MLI                 ; 88 GET_PREFIX from bank 2 read-only
        .byte $C7
        .word prefix
        jsr rec
        lda $DFFF
        sta RES+$15A            ; bank 2 signature intact
        lda $D000
        sta RES+$129            ; $B2: bank 2 still read
        inc $D000
        lda $D000
        sta RES+$12A            ; still $B2: writes still off
        lda $C08B               ; bank 1 read/write
        lda $C08B
        jsr MLI                 ; 89 GET_PREFIX from bank 1 read/write
        .byte $C7
        .word prefix
        jsr rec
        lda $DFFF
        sta RES+$15B            ; bank 1 signature intact
        lda $D000
        sta RES+$12B            ; $B1
        inc $D000
        lda $D000
        sta RES+$12C            ; $B2: writes on
        lda $C080               ; bank 2's signature after the bank-1 call
        lda $DFFF
        sta RES+$15C
        lda $C08B
        lda $C08B
        lda #$AA
        sta RES+$12F
padwait: bit $C070              ; pad scans through the resident (ROM NMI)
        lda $CEE8               ; SNES A of controller 1 (set by the test)
        beq padwait
        lda $D000
        sta RES+$12D            ; bank 1 still mapped after the NMIs
        inc $D000
        lda $D000
        sta RES+$12E
        lda $C082               ; ROM
        lda #$BB
        sta RES+$12F
        jsr MLI                 ; QUIT to the 3RIC DOS prompt
        .byte $65
        .word quit
quit:   .byte 4,0,0,0,0,0,0
cl0:    .byte 1,0
p_lk:   .byte 7
        .text "LOCKD.S"
p_lk2:  .byte 3
        .text "X.S"
p_dbl:  .byte 6
        .text "/SD//X"
p_dot:  .byte 2
        .text ".S"
p_msub: .byte 8
        .text "MANY/SUB"
p_mf0:  .byte 11
        .text "MANY/FILE00"
p_mren: .byte 12
        .text "MANY/RENAMED"
p_absb: .byte 20
        .text "/SD/MERLIN8/MANY/SUB"
p_full: .byte 8
        .text "FULL.BIN"
p_empty: .byte 9
        .text "EMPTY.BIN"
p_huge: .byte 8
        .text "HUGE.BIN"
ren3:   .byte 2
        .word p_lk
        .word p_lk2
ren4:   .byte 2
        .word p_mf0
        .word p_mren
maxsv:  .res 4
manyn:  .byte 0`;

const sys = assemble(sysSrc);
const sym = sys.symbols;

function stub(vm) {
  // Read sector `lba` with the ROM's sd_readsector into $4000 (after QUIT).
  const code = assemble(`
        .org $0300
        jsr $E1B9
done:   jmp done`);
  vm.loadData(0x300, new Uint8Array(code.bytes));
  return (lba) => {
    for (let i = 0; i < 4; i++) vm.poke(0xb0 + i, (lba >>> (8 * i)) & 255);
    vm.poke(0xb8, 0x00); vm.poke(0xb9, 0x40);
    vm.setPC(0x300);
    for (let n = 0; n < 200 && vm.pc() !== code.symbols.DONE; n++) vm.run(5000);
    assert.equal(vm.pc(), code.symbols.DONE, "sector read");
    return Uint8Array.from({ length: 512 }, (_, i) => vm.peek(0x4000 + i));
  };
}

// Walk the card from the boot sector: every file's chain matches its size,
// both FATs agree, no cluster is used twice, no cluster is lost.
function checkFat(read) {
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const mbr = read(0), part = u32(mbr, 0x1c6);
  const bs = read(part);
  const spc = bs[13], rsvd = bs[14] | (bs[15] << 8), nfats = bs[16], fsz = u32(bs, 36), rootCl = u32(bs, 44);
  const fat0 = part + rsvd, data = fat0 + nfats * fsz;
  const fatCache = new Map();
  const fatSec = (n) => {
    if (!fatCache.has(n)) {
      const a = read(fat0 + n), b = read(fat0 + fsz + n);
      assert.deepEqual(Array.from(a), Array.from(b), `FAT copies agree in sector ${n}`);
      fatCache.set(n, a);
    }
    return fatCache.get(n);
  };
  const fat = (c) => u32(fatSec(c >> 7), (c & 127) * 4) & 0x0fffffff;
  const used = new Set();
  const chain = (c, what) => {
    const out = [];
    while (c >= 2 && c < 0x0ffffff7) {
      assert.ok(!used.has(c), `${what}: cluster ${c} used twice`);
      used.add(c); out.push(c); c = fat(c);
      assert.ok(out.length < 100000, `${what}: endless chain`);
    }
    assert.ok(c >= 0x0ffffff8, `${what}: chain ends in ${c.toString(16)}`);
    return out;
  };
  const files = new Map();
  const walk = (cl, prefix) => {
    const clusters = chain(cl, prefix || "/");
    for (const c of clusters) for (let k = 0; k < spc; k++) {
      const sec = read(data + (c - 2) * spc + k);
      for (let e = 0; e < 16; e++) {
        const ent = sec.subarray(e * 32, e * 32 + 32);
        if (ent[0] === 0) return;
        if (ent[0] === 0xe5 || ent[11] === 0x0f || (ent[11] & 8) || ent[0] === 0x2e) continue;
        const base = String.fromCharCode(...ent.subarray(0, 8)).trimEnd(), ext = String.fromCharCode(...ent.subarray(8, 11)).trimEnd();
        const name = prefix + (ext ? `${base}.${ext}` : base);
        const first = (ent[26] | (ent[27] << 8) | (ent[20] << 16) | (ent[21] << 24)) >>> 0;
        if (ent[11] & 0x10) { files.set(name + "/", { dir: true, entry: Uint8Array.from(ent) }); walk(first, name + "/"); continue; }
        const size = u32(ent, 28);
        const cl2 = first ? chain(first, name) : [];
        assert.equal(cl2.length, Math.ceil(size / (512 * spc)), `${name}: ${cl2.length} clusters for ${size} bytes`);
        files.set(name, { size, clusters: cl2, entry: Uint8Array.from(ent), first });
      }
    }
  };
  walk(rootCl, "");
  const maxUsed = Math.max(...used);
  for (let c = 2; c <= maxUsed + 64; c++) if (fat(c) !== 0) assert.ok(used.has(c), `cluster ${c} is lost (FAT ${fat(c).toString(16)})`);
  const content = (name) => {
    const f = files.get(name), out = new Uint8Array(f.size);
    let o = 0;
    for (const c of f.clusters) for (let k = 0; k < spc && o < f.size; k++, o += 512) out.set(read(data + (c - 2) * spc + k).subarray(0, Math.min(512, f.size - o)), o);
    return out;
  };
  return { files, content, spc };
}

async function bootMerlin(tree, opts = {}, before = () => {}) {
  const s = await harness.boot({ sd: buildSparseFat32({ MERLIN8: tree }, opts) });
  const vm = s.vm;
  before(vm);
  const key = (ch) => { vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0)); for (let i = 0; i < 4; i++) vm.run(20000); };
  for (const line of ["CD MERLIN8\r", "BRUN MERLIN.PRG 0800\r"]) { for (const ch of line) key(ch); for (let i = 0; i < 20; i++) vm.run(50000); }
  return { s, vm, key };
}

const screenText = (s) => s.textScreen().join("\n");

async function standinRun(cardOpts, label) {
  const { prg } = buildLoader();
  const tree = {
    "MERLIN.PRG": prg,
    "MERLIN.SYS": sys.bytes,
    ED: new Uint8Array(16),
    "SRC.S": SRC,
    "BIG.BIN": BIG,
  };
  const { s, vm } = await bootMerlin(tree, cardOpts, (v) => v.loadData(0x3000, pattern(3100, 7)));
  // NMIs right inside lc_mode's write probe (BANKSIG briefly changed): a
  // $C070 pad trigger there is forwarded to the ROM and nests another probe.
  const R = buildLoader().resident.symbols;
  vm.addBreakpoint(R.LM_PUT);
  if (process.env.M8_DEBUG) vm.addBreakpoint(SA.OP_FLG);
  let injected = 0, taken = 0, injectedAt = -1;
  let lastIdx = -1;
  for (let i = 0; i < 6000 && vm.peek(RES + 0x12f) !== 0xaa; i++) {
    if (process.env.M8_DEBUG && vm.peek(sym.IDX) !== lastIdx) { lastIdx = vm.peek(sym.IDX); console.log("call", lastIdx / 2, "pc", vm.pc().toString(16)); }
    vm.run(20000);
    if (process.env.M8_DEBUG && vm.breakpointHit() && vm.pc() === SA.OP_FLG) { const T = vm.peek(0xba) | (vm.peek(0xbb) << 8); console.log("OPEN at call", vm.peek(sym.IDX) / 2, "T", T.toString(16), Array.from({ length: 32 }, (_, i) => vm.peek(T + i).toString(16)).join(" ")); vm.step(); continue; }
    while (vm.breakpointHit() && vm.peek(RES + 0x12f) !== 0xaa) {
      if (vm.peek(sym.IDX) !== injectedAt) { vm.readBus(0xc070); injected++; injectedAt = vm.peek(sym.IDX); } // once per MLI call
      vm.step();
      if (vm.pc() === R.NMI_ENTRY) taken++;
      vm.run(2000);
    }
  }
  vm.removeBreakpoint(R.LM_PUT);
  assert.ok(injected >= 2 && taken >= 2, `${label}: NMIs taken inside the bank probe (${injected}/${taken})`);
  assert.equal(vm.peek(RES + 0x12f), 0xaa, `${label}: test program reached the pad loop\n${screenText(s)}`);
  vm.setGamepadState(0, 1 << 8);         // SNES A: the ROM scan sets $CEE8
  for (let i = 0; i < 3000 && vm.peek(RES + 0x12f) !== 0xbb; i++) vm.run(20000);
  vm.setGamepadState(0, 0);
  assert.equal(vm.peek(RES + 0x12f), 0xbb, `${label}: pad NMIs came back`);
  for (let i = 0; i < 400; i++) vm.run(20000);
  const a = (n) => vm.peek(RES + 2 * n), c = (n) => vm.peek(RES + 2 * n + 1) & 1;
  const word = (x) => vm.peek(x) | (vm.peek(x + 1) << 8);
  const okCall = (n, what) => { assert.equal(a(n), 0, `${label} ${what}: A=0`); assert.equal(c(n), 0, `${label} ${what}: carry clear`); };
  const err = (n, code, what) => { assert.equal(a(n), code, `${label} ${what}: error $${code.toString(16)} (got $${a(n).toString(16)})`); assert.equal(c(n), 1, `${label} ${what}: carry set`); };
  const str = (at) => String.fromCharCode(...Array.from({ length: vm.peek(at) }, (_, i) => vm.peek(at + 1 + i)));

  okCall(0, "GET_PREFIX");
  okCall(1, "GET_FILE_INFO ED");
  assert.deepEqual([vm.peek(RES + 0x100), word(RES + 0x101)], [0x06, ED_ORG], "the loader typed ED as BIN at $9DB6");
  okCall(2, "GET_FILE_INFO src.s (lower case)");
  assert.deepEqual([vm.peek(RES + 0x103), vm.peek(RES + 0x104)], [0x04, 1], ".S is TXT, a seedling");
  okCall(3, "GET_FILE_INFO BIG.BIN");
  const bi = (o) => vm.peek(RES + 0x110 + o - 3);
  assert.equal(bi(4), 0x06, "BIN"); assert.equal(bi(5) | (bi(6) << 8), 0, "aux 0");
  assert.equal(bi(7), 2, "sapling"); assert.equal(bi(8) | (bi(9) << 8), 11, "10 data blocks + index");
  assert.equal(bi(3), 0xe3, "unlocked");
  err(4, 0x46, "missing file");
  okCall(5, "GET_FILE_INFO /SD/");
  assert.equal(vm.peek(RES + 0x105), 0x0f, "volume storage type");
  err(6, 0x45, "another volume");
  err(7, 0x44, "missing directory");
  okCall(8, "OPEN");
  okCall(9, "READ all");
  assert.equal(word(RES + 0x106), 5000, "transfer count clamps to EOF");
  for (let i = 0; i < 5000; i++) assert.equal(vm.peek(0x4000 + i), BIG[i], `BIG byte ${i}`);
  err(10, 0x4c, "READ at EOF");
  okCall(11, "SET_MARK");
  okCall(12, "READ 100 at 1000");
  for (let i = 0; i < 100; i++) assert.equal(vm.peek(0x5800 + i), BIG[1000 + i]);
  okCall(13, "GET_MARK");
  assert.equal(word(RES + 0x108), 1100);
  err(14, 0x4d, "SET_MARK past EOF");
  okCall(15, "CLOSE");
  err(16, 0x43, "READ on a closed ref");
  okCall(17, "OPEN src.s"); okCall(18, "NEWLINE");
  okCall(19, "READ line 1"); assert.equal(vm.peek(RES + 0x10a), 13, "first line with its CR");
  okCall(20, "READ line 2"); assert.equal(vm.peek(RES + 0x10b), 8, "second line");
  assert.equal(String.fromCharCode(...Array.from({ length: 8 }, (_, i) => vm.peek(0x5940 + i))), " LDA #1\r");
  okCall(21, "CLOSE");
  okCall(22, "CREATE NEW.S"); err(23, 0x47, "CREATE duplicate");
  okCall(24, "OPEN NEW.S"); okCall(25, "WRITE 3000"); okCall(26, "WRITE 100");
  okCall(27, "GET_EOF"); assert.equal(word(RES + 0x10c), 3100);
  okCall(28, "SET_EOF 2000"); okCall(29, "GET_MARK after SET_EOF");
  assert.equal(word(RES + 0x10e), 2000, "mark pulled back to the new EOF");
  okCall(30, "CLOSE"); okCall(31, "OPEN"); okCall(32, "READ back");
  assert.equal(word(RES + 0x120), 2000);
  const w = pattern(3100, 7);
  for (let i = 0; i < 2000; i++) assert.equal(vm.peek(0x7000 + i), w[i], `NEW.S byte ${i}`);
  okCall(33, "CLOSE");
  okCall(34, "CREATE SUBDIR"); okCall(35, "CREATE SUBDIR/INNER.BIN"); okCall(36, "GET_FILE_INFO INNER.BIN");
  assert.deepEqual([vm.peek(RES + 0x122), word(RES + 0x123)], [0x06, 0x1234], "type and aux type kept in the FAT entry");
  okCall(37, "SET_PREFIX SUBDIR"); okCall(38, "GET_PREFIX");
  assert.equal(String.fromCharCode(...Array.from({ length: vm.peek(RES + 0x130) }, (_, i) => vm.peek(RES + 0x131 + i))), "/SD/MERLIN8/SUBDIR/");
  okCall(39, "relative to the new prefix");
  okCall(40, "SET_PREFIX absolute");
  assert.equal(str(0x6900), "/SD/MERLIN8/", "GET_PREFIX after the absolute SET_PREFIX (call 89)");
  okCall(41, "RENAME"); err(42, 0x46, "old name gone"); err(43, 0x47, "RENAME onto an existing name");
  err(44, 0x4e, "DESTROY a non-empty directory"); okCall(45, "DESTROY INNER.BIN"); okCall(46, "DESTROY SUBDIR");
  err(47, 0x40, "invalid name");
  okCall(48, "SET_FILE_INFO lock"); okCall(49, "GET_FILE_INFO locked");
  assert.equal(vm.peek(RES + 0x125), 0x21, "locked access");
  okCall(50, "ON_LINE");
  assert.deepEqual([vm.peek(0x6800), vm.peek(0x6801), vm.peek(0x6802), vm.peek(0x6810)], [0x62, 0x53, 0x44, 0], "one volume, /SD, in slot 6");
  okCall(51, "CREATE MANY");
  for (let n = 52; n < 72; n++) okCall(n, `CREATE MANY/FILE${n - 52}`);
  okCall(72, "OPEN MANY"); okCall(73, "READ block 0"); okCall(74, "READ block 1"); err(75, 0x4c, "READ past the last block"); okCall(76, "CLOSE");
  // ProDOS directory blocks synthesized from the FAT directory.
  const ent = (blk, k) => 0x6000 + blk * 0x200 + 4 + k * 39;
  assert.equal(vm.peek(0x6004) >> 4, 0x0e, "subdirectory header");
  assert.equal(String.fromCharCode(...Array.from({ length: vm.peek(0x6004) & 15 }, (_, i) => vm.peek(0x6005 + i))), "MANY");
  assert.deepEqual([vm.peek(0x6004 + 0x1f), vm.peek(0x6004 + 0x20), word(0x6004 + 0x21)], [39, 13, 20], "entry length, entries per block, file count");
  const names = [];
  for (let k = 1; k < 13; k++) names.push(String.fromCharCode(...Array.from({ length: vm.peek(ent(0, k)) & 15 }, (_, i) => vm.peek(ent(0, k) + 1 + i))));
  for (let k = 0; k < 8; k++) names.push(String.fromCharCode(...Array.from({ length: vm.peek(ent(1, k)) & 15 }, (_, i) => vm.peek(ent(1, k) + 1 + i))));
  assert.deepEqual(names, Array.from({ length: 20 }, (_, i) => `FILE${String(i).padStart(2, "0")}`), "all 20 entries across two blocks");
  assert.equal(vm.peek(ent(1, 8)), 0, "the rest of the block is empty");
  assert.equal(vm.peek(ent(0, 1) + 0x10), 0x06, "FILE00 typed BIN as created");
  assert.ok(word(0x6002) !== 0 && word(0x6202) === 0, "next-block links");
  okCall(77, "OPEN /SD/"); okCall(78, "READ the volume directory");
  assert.equal(vm.peek(0x6404) >> 4, 0x0f, "volume header");
  const vnames = [];
  for (let k = 1; k < 13; k++) { const e = 0x6404 + k * 39; if (vm.peek(e)) vnames.push(String.fromCharCode(...Array.from({ length: vm.peek(e) & 15 }, (_, i) => vm.peek(e + 1 + i)))); }
  assert.deepEqual(vnames, ["MERLIN8"], "the card root holds the folder");
  okCall(79, "OPEN 2"); okCall(80, "OPEN 3"); err(81, 0x42, "too many files open"); okCall(82, "CLOSE 0");
  okCall(83, "GET_TIME"); err(84, 0x25, "ALLOC_INTERRUPT"); err(85, 0x28, "READ_BLOCK"); err(86, 0x01, "unknown call");
  assert.deepEqual([vm.peek(RES + 0x126), vm.peek(RES + 0x127)], [0x5a, 0xa5], "X/Y preserved");
  assert.equal(vm.peek(RES + 0x128), 0, "$B0-$BF restored");
  okCall(88, "CREATE locked"); okCall(89, "OPEN locked");
  err(90, 0x4e, "WRITE a locked file"); err(91, 0x4e, "SET_EOF a locked file"); okCall(92, "CLOSE");
  err(93, 0x4e, "DESTROY a locked file"); err(94, 0x4e, "RENAME a locked file");
  err(95, 0x40, "/SD//X"); err(96, 0x40, "a name with nothing before its dot");
  okCall(97, "CREATE MANY/SUB"); okCall(98, "RENAME MANY/FILE00 MANY/RENAMED"); okCall(99, "the new name");
  err(100, 0x46, "the old name is gone"); okCall(101, "the parent directory kept its name");
  okCall(102, "SET_PREFIX MANY/SUB"); err(103, 0x4e, "DESTROY the prefix directory");
  okCall(104, "SET_PREFIX back"); okCall(105, "DESTROY MANY/SUB");
  okCall(106, "CREATE FULL.BIN"); okCall(107, "OPEN FULL.BIN");
  err(108, 0x48, "WRITE on a full card");
  const cs = 512 * (cardOpts.sectorsPerCluster || 1), wrote = word(RES + 0x160);
  assert.ok(wrote > 0 && wrote < 20000 && wrote % cs === 0, `${label}: a full card reports the bytes written (${wrote})`);
  okCall(109, "GET_EOF"); assert.equal(word(RES + 0x162), wrote, "EOF is what was written");
  okCall(110, "SET_MARK"); err(111, 0x48, "SET_EOF past a full card");
  okCall(112, "GET_EOF"); assert.deepEqual([word(RES + 0x164), vm.peek(RES + 0x166)], [wrote, 0], "a failed SET_EOF keeps the EOF");
  okCall(113, "GET_MARK"); assert.equal(word(RES + 0x167), 100, "and the mark");
  okCall(114, "CREATE EMPTY.BIN on a full card"); okCall(115, "OPEN EMPTY.BIN");
  err(116, 0x48, "WRITE to an empty file on a full card"); err(117, 0x48, "and again");
  assert.equal(word(RES + 0x16b), 0, "nothing was written");
  okCall(118, "CLOSE 0");
  okCall(119, "CREATE HUGE.BIN"); okCall(120, "GET_FILE_INFO"); okCall(121, "GET_FILE_INFO 16 MB");
  assert.equal(word(RES + 0x169), 0x8001, "a 16 MB file shows the largest ProDOS size: 32768 blocks + index");
  err(122, 0x4d, "OPEN a 16 MB file"); okCall(123, "GET_FILE_INFO"); okCall(124, "DESTROY HUGE.BIN");
  okCall(125, "MLI from bank 2 read-only"); okCall(126, "MLI from bank 1 read/write");
  assert.deepEqual([vm.peek(RES + 0x15a), vm.peek(RES + 0x15b), vm.peek(RES + 0x15c)], [0x60, 0x05, 0x60], "bank signatures at $DFFF intact");
  assert.deepEqual([0x129, 0x12a, 0x12b, 0x12c, 0x12d, 0x12e].map((o) => vm.peek(RES + o)), [0xb2, 0xb2, 0xb1, 0xb2, 0xb2, 0xb3],
    "language-card bank and write state survive MLI calls and forwarded NMIs");

  // Back at the ROM DOS prompt, in the same folder: the ROM sees the files.
  const rows = s.textScreen();
  assert.ok(rows.some((r) => r.startsWith(">")), `QUIT returned to the DOS prompt\n${rows.join("\n")}`);
  const typeLine = (line) => { for (const ch of line) { vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0)); for (let i = 0; i < 4; i++) vm.run(20000); } for (let i = 0; i < 40; i++) vm.run(50000); };
  typeLine("FLOAD RENAMED.S 3000 0000 07CF\r");
  for (let i = 0; i < 2000; i++) assert.equal(vm.peek(0x3000 + i), w[i], `ROM FLOAD of RENAMED.S byte ${i}`);
  typeLine("DIR\r");
  assert.match(screenText(s), /RENAMED\s+S\s+\$000007D0/, "ROM DIR shows the file and its size");

  // The card itself.
  const read = stub(vm);
  const fat = checkFat(read);
  for (const name of ["MERLIN8/RENAMED.S", "MERLIN8/BIG.BIN", "MERLIN8/SRC.S", "MERLIN8/MANY/", "MERLIN8/LOCKD.S", "MERLIN8/FULL.BIN", "MERLIN8/MANY/RENAMED"]) assert.ok(fat.files.has(name), `${name} on the card`);
  assert.ok(!fat.files.has("MERLIN8/HUGE.BIN") && !fat.files.has("MERLIN8/MANY/SUB/") && !fat.files.has("MERLIN8/MANY/FILE00"), "destroyed and renamed entries are gone");
  assert.equal(fat.files.get("MERLIN8/LOCKD.S").entry[11] & 1, 1, "CREATE with no write access is read-only");
  assert.equal(fat.files.get("MERLIN8/FULL.BIN").size, wrote, "FULL.BIN on the card holds what was written");
  assert.deepEqual([fat.files.get("MERLIN8/EMPTY.BIN").size, fat.files.get("MERLIN8/EMPTY.BIN").first], [0, 0], "EMPTY.BIN stayed empty");
  assert.ok(!fat.files.has("MERLIN8/NEW.S") && !fat.files.has("MERLIN8/SUBDIR/"), "renamed and destroyed entries are gone");
  assert.deepEqual(Array.from(fat.content("MERLIN8/RENAMED.S")), Array.from(w.subarray(0, 2000)), "RENAMED.S content on the card");
  assert.deepEqual(Array.from(fat.content("MERLIN8/BIG.BIN")), Array.from(BIG));
  const ren = fat.files.get("MERLIN8/RENAMED.S").entry;
  assert.deepEqual([ren[11] & 1, ren[13], ren[16], ren[17]], [1, 0x04, 0x21, 0], "read-only, TXT tag");
  for (let i = 1; i < 20; i++) assert.ok(fat.files.has(`MERLIN8/MANY/FILE${String(i).padStart(2, "0")}`));
  console.log(`PASS ${label}: every MLI call Merlin makes (incl. errors), locked files, nested-path rename, full card, 16 MB files, directory blocks, 20-file directory growth, LC modes + NMIs inside the bank probe, QUIT, ROM DOS cross-check, FAT integrity`);
}

await standinRun({}, "stand-in on 512-byte clusters");
await standinRun({ sectorsPerCluster: 8, totalSectors: 1 << 20, fragment: ["BIG.BIN"] }, "stand-in on 4 KB clusters, fragmented file");

{
  const { prg } = buildLoader();
  const { s, vm } = await bootMerlin({ "MERLIN.PRG": prg, ED: new Uint8Array(4) });
  for (let i = 0; i < 200; i++) vm.run(20000);
  assert.match(screenText(s), /MERLIN: MERLIN\.SYS NOT FOUND/);
  assert.ok(s.textScreen().some((r) => r.startsWith(">")), "back at the DOS prompt");
  const rom = Uint8Array.from(fs.readFileSync(new URL("../../emulator/Data/badger6502.bin", import.meta.url)));
  rom[ROM_RANGES[0][0] + 3] ^= 1;
  const other = buildLoader(rom).prg;
  const b = await bootMerlin({ "MERLIN.PRG": other, "MERLIN.SYS": sys.bytes });
  for (let i = 0; i < 200; i++) b.vm.run(20000);
  assert.match(screenText(b.s), /NEEDS THE 3RIC ROM DOS/);
  console.log("PASS loader: missing MERLIN.SYS and a different ROM are reported at the DOS prompt");
}

// ---------------------------------------------------------------------------
// Optional: the real Merlin-8.

if (process.env.MERLIN_DISKS) {
  const [d1, d2] = process.env.MERLIN_DISKS.split(/[;,]/).map((p) => new Uint8Array(fs.readFileSync(p.trim())));
  const tree = buildTree(d1, d2 || null);
  const ref = readProdosVolume(d1).files;
  const { s, vm } = await bootMerlin(tree);
  const run = (sec) => { for (let c = 0; c < sec * HZ; c += 50000) vm.run(50000); };
  const type = (str, gap = 0.08) => { for (const ch of str) { vm.keyDown(ch === "~" ? 13 : ch.charCodeAt(0)); run(gap); } };
  const screen = () => screenText(s);
  run(12);
  assert.match(screen(), /Prefix: \/SD\/MERLIN8\//, `main menu\n${screen()}`);
  type("C"); type("~"); run(6);
  assert.match(screen(), /MERLIN\.SYS\s+BIN/); assert.match(screen(), /SOURCE\s+DIR/);
  type("~"); run(1);
  // Assemble two of the disk's own sources; their SAVE writes the objects.
  for (const [src, answer, out, refPath] of [["SOURCE/EDMAC", "1", "EDMAC", "UTILITIES/EDMAC"]]) {
    type("L"); type(src + "~"); run(8);
    type("ASM~"); run(2); type(answer + "~"); run(40);
    assert.match(screen(), /:$/m, `${src} assembled\n${screen()}`);
    type("Q~"); run(2);
    // Read the object back through the stand-in: Merlin's BLOAD.
    const want = ref.find((f) => f.path === refPath);
    type("D"); type(`BLOAD ${out},A$3000~`); run(6); type("~"); run(1);
    for (let i = 0; i < want.data.length; i++) assert.equal(vm.peek(0x3000 + i), want.data[i], `${out} byte ${i} matches ${refPath}`);
  }
  console.log("PASS real Merlin: catalog, load + assemble EDMAC.S into a byte-identical object, BLOAD");
  // Write a program in ED (Ctrl-A Q leaves it), assemble, save source and object, run it.
  type("E"); run(2); type("NEW~"); run(1); type("A~"); run(2);
  type(" ORG $0900~ LDA #$C8~ JSR $FDED~ LDA #$C9~ JMP $FDED~");
  type("\x01Q"); run(2);
  type("ASM~"); run(20); type("Q~"); run(2);
  type("S"); type("HI~"); run(8);
  type("O"); type("HI~"); run(8);
  type("D"); type("BRUN HI~"); run(3);
  assert.ok(s.textScreen().some((r) => r.startsWith("HIDisk command:")), `the program ran\n${screen()}`);
  type("~"); run(1);
  type("L"); type("HI~"); run(8); type("L~"); run(3);
  assert.match(screen(), /LDA\s+#\$C8/, "the saved source loads back");
  type("Q~"); run(2); type("Q"); type("Y"); run(4);
  type("DIR~"); run(5);
  assert.match(screen(), /HI\s+S\s+\$/); assert.match(screen(), /HI\s+\$0000000A/);
  const fat = checkFat(stub(vm));
  assert.ok(fat.files.has("MERLIN8/HI.S") && fat.files.has("MERLIN8/HI"));
  console.log("PASS real Merlin: ED full-screen editor with Ctrl-A, assemble, save source/object, BRUN, reload, quit to DOS, FAT intact");
} else {
  console.log("SKIP real Merlin-8 (set MERLIN_DISKS=<disk1.dsk>;<disk2.dsk>)");
}
