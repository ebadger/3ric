// Run after web/build.ps1: node codegen/tools/port-altreality.test.mjs
//
// Proves the Alternate Reality SD-card port - .nib decoding, side
// identification, guarded patches, character-disk templates, and the real
// loader, resident NMI/IRQ forwarder and both RWTS replacement shims - on the
// real ROM DOS and SPI SD emulation, using synthetic disk images (no
// copyrighted game data). Set AR_DISKS to a folder holding the original City
// and Dungeon images (.nib/.dsk, optionally gzipped) to also boot both real
// games from a generated card to their title menus.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { assemble } from "./asm6502.mjs";
import { encode6and2 } from "./wozgen.mjs";
import harness from "./harness.cjs";
import { buildSparseFat32 } from "./ultima5/fat32.mjs";
import * as P from "./port-altreality.mjs";

const rom = P.readRom();
const glue = P.buildGlue(rom);
const R = glue.resident.symbols;
const sec = (t, s) => (t * 16 + s) * 256;

// ---------------------------------------------------------------------------
// .nib decoding on a synthetic, standard 16-sector nibble image.

function nibFromDsk(dsk, vol) {
  const nib = new Uint8Array(P.NIB_BYTES).fill(0xff);
  const fourFour = (v) => [(v >> 1) | 0xaa, v | 0xaa];
  for (let t = 0; t < 35; t++) {
    let pos = t * P.NIB_TRACK + 20;
    const w = (bytes) => { for (const b of bytes) nib[pos++] = b; };
    for (let p = 0; p < 16; p++) {
      w([0xd5, 0xaa, 0x96, ...fourFour(vol), ...fourFour(t), ...fourFour(p), ...fourFour(vol ^ t ^ p), 0xde, 0xaa, 0xeb]);
      pos += 6;
      const data = new Uint8Array(343);
      encode6and2(data, dsk, sec(t, P.PHYS_TO_DOS[p]));
      w([0xd5, 0xaa, 0xad, ...data, 0xde, 0xaa, 0xeb]);
      pos += 20;
    }
  }
  return nib;
}

{
  const dsk = new Uint8Array(P.DSK_BYTES);
  for (let i = 0; i < dsk.length; i++) dsk[i] = (i * 7 + (i >> 8) * 13) & 255;
  const { dsk: back, vol } = P.readImage(zlib.gzipSync(nibFromDsk(dsk, 17)));
  assert.equal(vol, 17, "volume read from the address fields");
  assert.deepEqual(back, dsk, "every sector decodes to its DOS-order place");
  const bad = nibFromDsk(dsk, 3);
  const at = bad.indexOf(0xad, 5 * P.NIB_TRACK) + 40;  // a data nibble on track 5
  bad[at] = 0xd5;                                       // not a 6-and-2 nibble
  assert.throws(() => P.nibToDsk(bad), /track 5: 15 of 16/);
  assert.throws(() => P.readImage(new Uint8Array(1000)), /140 KB/);
  assert.throws(() => P.identify({ dsk, vol: 17 }), /not a known release/, "a volume alone does not make a side");
  const dun2 = Uint8Array.from(dsk);
  dun2.set(Buffer.from("NO D.O.S. ON THIS DISK", "latin1").map((c) => c ^ 0x87), 0x40);
  assert.equal(P.identify(P.readImage(nibFromDsk(dun2, 17))), "dun2", "a .nib side whose volume and contents agree");
  assert.throws(() => P.identify({ dsk: dun2, vol: 3 }), /are the Dungeon disk 1 side 2/, "volume and contents disagree");
  assert.throws(() => P.identify({ dsk, vol: 99 }), /volume 99/);
  console.log("PASS .nib decoding (6-and-2, checksum, interleave, volume) and identification by volume and contents");
}

// ---------------------------------------------------------------------------
// Address mapping, patches and character disks on synthetic sides.

{
  assert.deepEqual(P.cityAddr(0x0d00), [0, 5, 0]);
  assert.deepEqual(P.cityAddr(0x1043), [0, 8, 0x43]);
  assert.deepEqual(P.cityAddr(0x4000), [20, 1, 0]);
  assert.deepEqual(P.cityAddr(0x4100), [20, 0, 0]);
  assert.deepEqual(P.cityAddr(0x68e3), [23, 9, 0xe3]);
  assert.deepEqual(P.cityAddr(0x7400), [24, 13, 0]);
  assert.deepEqual(P.cityAddr(0x8c70), [9, 12, 0x70]);
  assert.deepEqual(P.cityAddr(0xbf00), [12, 15, 0]);
  assert.deepEqual(P.dungeonAddr(0x4517), [0, 10, 0x17]);
  assert.deepEqual(P.dungeonAddr(0x49fd), [0, 6, 0xfd]);
  assert.throws(() => P.cityAddr(0x2000), /no City disk mapping/);
  console.log("PASS game address -> disk sector mapping");
}

/** A synthetic City side 1 carrying exactly the original bytes at every patch site. */
function synthCity1() {
  const d = new Uint8Array(P.DSK_BYTES);
  for (let i = 0; i < d.length; i++) d[i] = (i * 5 + 1) & 255;
  const put = (a, bytes) => bytes.forEach((b, i) => { const [t, s, o] = P.cityAddr(a + i); d[sec(t, s) + o] = b; });
  const tmpl = new Uint8Array(0x114);                   // $732C-$743F (the boot stub runs into the $7400 probe)
  tmpl.set(Buffer.from("AR CHAR DISK", "latin1").map((c) => c | 0x80));
  for (let i = 12; i < tmpl.length; i++) tmpl[i] = i & 255;
  put(0x732c, Array.from(tmpl));
  put(0x0d00, [0x84, 0x48, 0x85, 0x49, 0xa0, 0x02]);
  for (const p of P.cityPatches(glue)) put(p.at, p.before);
  const line = Buffer.from("\r\rHit B for backup program", "latin1");
  d.set(line, sec(23, 1) + 0xa0);
  d[sec(23, 1) + 0xa0 + line.length] = 0xae;
  d.set(Buffer.from("Hit I to initialize a character disk.", "latin1"), sec(23, 1) + 0x40);
  return d;
}

{
  const side1 = synthCity1();
  assert.equal(P.identify({ dsk: side1, vol: null }), "city1", "City side 1 by its RWTS entry and menu text");
  const out = P.patchCity1(side1, glue);
  const at = (a, n) => { const r = []; for (let i = 0; i < n; i++) { const [t, s, o] = P.cityAddr(a + i); r.push(out[sec(t, s) + o]); } return r; };
  assert.deepEqual(at(0x0d00, glue.city.shim.bytes.length), Array.from(glue.city.shim.bytes), "shim over the RWTS entry");
  assert.deepEqual(at(0x68e3, 3), [0x20, R.FIXVEC & 255, R.FIXVEC >> 8], "vectors repaired after the title's ROM copy");
  assert.deepEqual(at(0x6905, 3), [0x4c, 0x18, 0x69], "disk-timed random seed skipped");
  assert.deepEqual(at(0x6948, 1), [0x07], "Backup key dropped");
  assert.deepEqual(at(0x7400, 2), [0x18, 0x60], "initializer always warns before erasing");
  assert.deepEqual(at(0x8c70, 4), [0xad, 0x6d, 0x10, 0x60], "no other-drive probe in play");
  assert.deepEqual(at(0x103e, 3), [0xea, 0xea, 0xea], "reset vector left alone");
  assert.equal(Buffer.from(out).indexOf(Buffer.from("Hit B for backup", "latin1")), -1, "Backup menu line blanked");
  assert.equal(side1[sec(0, 5)], 0x84, "input image untouched");
  assert.throws(() => P.patchCity1(out, glue), /unexpected byte/, "a patched or different release is refused");
  const chr = P.blankCityChar(side1);
  assert.deepEqual(Array.from(chr.subarray(sec(0, 1), sec(0, 1) + 256)), Array.from(tmpl(side1, 0x732c)), "directory sector from $732C");
  assert.deepEqual(Array.from(chr.subarray(sec(0, 0), sec(0, 0) + 256)), Array.from(tmpl(side1, 0x7340)), "boot stub from $7340");
  assert.equal(P.identify({ dsk: chr, vol: null }), "citychr");

  const d1 = new Uint8Array(P.DSK_BYTES);
  const dput = (a, b) => b.forEach((x, i) => { const [t, s, o] = P.dungeonAddr(a + i); d1[sec(t, s) + o] = x; });
  dput(0x4383, [0x08, 0x78, 0x20, 0x17, 0x45, 0xb0, 0x04, 0x28]);
  dput(0x4517, [0xa9, 0x01, 0x8d, 0xdc, 0x1b]);
  dput(0x49fd, [0x20, 0x0b, 0x4a]);
  assert.equal(P.identify({ dsk: d1, vol: null }), "dun1");
  const o1 = P.patchDungeon1(d1, glue);
  const dat = (a, n) => { const r = []; for (let i = 0; i < n; i++) { const [t, s, o] = P.dungeonAddr(a + i); r.push(o1[sec(t, s) + o]); } return r; };
  assert.deepEqual(dat(0x4517, glue.dungeon.shim.bytes.length), Array.from(glue.dungeon.shim.bytes));
  assert.deepEqual(dat(0x4383, 5), [0x08, 0x78, 0x20, 0x17, 0x45], "the PHP/SEI wrapper is kept");
  assert.deepEqual(dat(0x49fd, 2), [0x18, 0x60], "copy-protection check reports a pass");
  assert.ok(0x4517 + glue.dungeon.shim.bytes.length <= 0x49fd, "Dungeon shim ends below the protection entry");
  assert.throws(() => P.patchDungeon1(o1, glue), /unexpected byte/);
  const dchr = P.blankDungeonChar();
  assert.equal(P.identify({ dsk: dchr, vol: null }), "dunchr");
  assert.equal(Buffer.from(dchr.subarray(sec(0, 15), sec(0, 15) + 8).map((b) => b ^ 0x87)).toString("latin1"), "AR CHAR!");
  assert.ok(dchr.subarray(sec(0, 15) + 8, sec(0, 15) + 256).every((b) => b === 0x87), "rest of the ID sector reads back as zeros");
  console.log("PASS guarded City and Dungeon patches, side identification, character-disk templates");
}
function tmpl(side1, a) { const r = []; for (let i = 0; i < 256; i++) { const [t, s, o] = P.cityAddr(a + i); r.push(side1[sec(t, s) + o]); } return r; }

// ---------------------------------------------------------------------------
// The real loader, resident and shims on the ROM DOS with synthetic images.

const RES = 0x0300;           // results
const byteOf = (img, t, s, i) => ((img * 71 + t * 16 + s) * 3 + i * 5 + 1) & 255;
function synthImage(img, mask = 0) {
  const d = new Uint8Array(P.DSK_BYTES);
  for (let t = 0; t < 35; t++) for (let s = 0; s < 16; s++) for (let i = 0; i < 256; i++) d[sec(t, s) + i] = byteOf(img, t, s, i) ^ mask;
  return d;
}

// City: track 0 sectors 0-13 load to $0800-$15FF; the test program sits at
// $1000 (where the crack's loader is) and the shim at $0D00.
function cityFolder() {
  const IOB = 0x1700;
  const prog = assemble(`
RES = $${RES.toString(16)}
IOB = $${IOB.toString(16)}
FIXVEC = $${R.FIXVEC.toString(16)}
        .org $1000
        ldx #9                  ; canaries in the ROM's SD zero page
zc:     txa
        eor #$C3
        sta $B0,x
        dex
        bpl zc
        lda #$60                ; IOB: slot 6, drive 1
        sta IOB+1
        lda #1
        sta IOB+2
        ; 1: vol 2 (side 1), T3 S5 -> $3000
        lda #2
        ldx #3
        ldy #5
        jsr setio
        lda #$00
        ldx #$30
        jsr rd
        sta RES+0
        lda IOB+$0E
        sta RES+1
        ; 2: vol 3 (side 2), T34 S15 -> $D180 (language-card RAM, unaligned)
        lda #3
        ldx #34
        ldy #15
        jsr setio
        lda #$80
        ldx #$D1
        jsr rd
        sta RES+2
        lda #$5C                ; bank 2 still writable
        sta $D100
        lda $D100
        sta RES+3
        ; 3: vol 0 drive 1 -> the side last used (side 2), T17 S0 -> $3200
        lda #0
        ldx #17
        ldy #0
        jsr setio
        lda #$00
        ldx #$32
        jsr rd
        sta RES+4
        lda IOB+$0E
        sta RES+5
        ; 4: write vol 253 T5 S3 from $3400, read back to $3500, T5 S2 -> $3600
        ldx #0
pat:    txa
        eor #$A6
        sta $3400,x
        inx
        bne pat
        lda #253
        ldx #5
        ldy #3
        jsr setio
        lda #2
        sta IOB+$0C
        lda #$00
        sta IOB+8
        lda #$34
        sta IOB+9
        jsr call
        sta RES+6
        lda #$00
        ldx #$35
        jsr rd
        lda #253
        ldx #5
        ldy #2
        jsr setio
        lda #$00
        ldx #$36
        jsr rd
        ; 5: unknown volume
        lda #99
        ldx #1
        ldy #1
        jsr setio
        lda #$00
        ldx #$37
        jsr rd
        sta RES+7
        lda IOB+$0D
        sta RES+8
        ; 6: track 35
        lda #2
        ldx #35
        ldy #0
        jsr setio
        lda #$00
        ldx #$37
        jsr rd
        sta RES+9
        lda IOB+$0D
        sta RES+10
        ; 7: seek and format
        lda #2
        ldx #10
        ldy #0
        jsr setio
        stz IOB+$0C
        jsr call
        sta RES+11
        lda #253
        jsr setio
        lda #4
        sta IOB+$0C
        jsr call
        sta RES+12
        ; 8: drive 2, vol 0 -> the character disk, T0 S1 -> $3800
        lda #2
        sta IOB+2
        lda #0
        ldx #0
        ldy #1
        jsr setio
        lda #$00
        ldx #$38
        jsr rd
        lda IOB+$0E
        sta RES+13
        lda #1
        sta IOB+2
        ; 9: zero page, IOB pointer, mapping
        ldx #9
        stz RES+15
zk:     lda $B0,x
        eor #$C3
        stx RES+14
        cmp RES+14
        beq zok
        inc RES+15
zok:    dex
        bpl zk
        lda $48
        sta RES+16
        lda $49
        sta RES+17
        lda $FFFB               ; RAM vectors still the resident's
        sta RES+18
        ; 10: a $C010 strobe NMI with bank 2 mapped (the test types "A")
wkey:   lda $C000
        bpl wkey
        bit $C010
        ldx #0
wdel:   dex
        bne wdel
        lda $C000
        sta RES+19
        lda #$3C
        sta $D101
        lda $D101
        sta RES+20
        ; 11: the title's ROM copy clobbers the vectors; fixvec repairs them
        lda $C081
        lda $C081
        lda #$BB
        sta $FFFA
        lda #$F1
        sta $FFFB
        jsr FIXVEC
        lda $FFFB
        sta RES+21
        lda $FFFF
        sta RES+22
        lda #$AA
        sta RES+31
done:   jmp done

setio:  sta IOB+3
        stx IOB+4
        sty IOB+5
        rts
rd:     sta IOB+8
        stx IOB+9
        lda #1
        sta IOB+$0C
call:   lda #>IOB
        ldy #<IOB
        sei
        jsr $0D00
        php
        pla
        and #1
        rts
`);
  assert.ok(prog.bytes.length <= 0x600, "test program fits $1000-$15FF");
  const side1 = synthImage(0);
  side1.set(glue.city.shim.bytes, sec(0, 5));
  side1.set(prog.bytes, sec(0, 8));
  return {
    "CITY.PRG": glue.city.loader.bytes,
    "CITY1.DSK": side1,
    "CITY2.DSK": synthImage(1),
    "CITYCHR.DSK": synthImage(2),
  };
}

// Dungeon: T0 S0 -> $0800 (a JMP to the test at $0844, where the boot
// sector continues), T0 S15..S0 -> $4000-$4FFF (wrapper at $4380, shim at $4517).
function dungeonFolder() {
  const boot = assemble(`
        .org $0800
        .res $44
        jmp $4C00
`);
  const wrapper = [0x8d, 0x7b, 0x43, 0x08, 0x78, 0x20, 0x17, 0x45, 0xb0, 0x04, 0x28, 0x18, 0x90, 0x02, 0x28, 0x38, 0x60];
  const prog = assemble(`
RES = $${RES.toString(16)}
        .org $4C00
        lda #1                  ; 1: vol 16 T3 S5 -> $3000 (XOR $87 undone)
        sta $3E
        lda #16
        ldx #3
        ldy #5
        jsr setp
        lda #$00
        ldx #$30
        lda #1
        jsr go
        sta RES+0
        lda $437D
        sta RES+1
        lda #18                 ; 2: vol 18 T20 S9 -> $D280 (language card)
        ldx #20
        ldy #9
        jsr setp
        lda #$80
        sta $45
        lda #$D2
        sta $46
        lda #1
        jsr go2
        sta RES+2
        lda #20                 ; 3: write vol 20 T7 S4 from $3400, read back
        ldx #7
        ldy #4
        jsr setp
        ldx #0
pat:    txa
        eor #$5B
        sta $3400,x
        inx
        bne pat
        stz $45
        lda #$34
        sta $46
        lda #2
        jsr go2
        sta RES+3
        stz $45
        lda #$35
        sta $46
        lda #1
        jsr go2
        lda #20                 ; sector 16+5: low four bits, $41 rewritten
        ldx #7
        ldy #21
        jsr setp
        stz $45
        lda #$36
        sta $46
        lda #1
        jsr go2
        sta RES+4
        lda $41
        sta RES+5
        lda #77                 ; 4: unknown volume
        ldx #1
        ldy #1
        jsr setp
        lda #1
        jsr go2
        sta RES+6
        lda $437C
        sta RES+7
        lda #16                 ; 5: track 40
        ldx #40
        ldy #1
        jsr setp
        lda #1
        jsr go2
        sta RES+8
        lda $437C
        sta RES+9
        lda #0                  ; 6: vol 0 drive 2 -> the character disk
        ldx #0
        ldy #15
        jsr setp
        lda #2
        sta $3E
        stz $45
        lda #$37
        sta $46
        lda #1
        jsr go2
        lda $437D
        sta RES+10
        lda #3                  ; 7: format
        jsr go2
        sta RES+11
        lda #253                ; 8: the City's character disk, by volume
        ldx #0
        ldy #1
        jsr setp
        stz $45
        lda #$38
        sta $46
        lda #1
        jsr go2
        sta RES+12
        lda $FFFB
        sta RES+13
        lda #$AA
        sta RES+31
done:   jmp done

setp:   sta $3F
        stx $40
        sty $41
        lda #$60
        sta $3D
        rts
go:     pha
        lda #$00
        sta $45
        lda #$30
        sta $46
        pla
go2:    jsr $4380
        php
        pla
        and #1
        rts
`);
  const side1 = synthImage(0, 0x87);
  const t0 = new Uint8Array(4096);
  t0.set(boot.bytes, 0);                                  // sector 0 = $0800
  const pages = new Uint8Array(4096);                     // $4000-$4FFF
  pages.set(wrapper, 0x380);
  pages.set(glue.dungeon.shim.bytes, 0x517);
  pages.set(prog.bytes, 0xc00);
  for (let p = 1; p < 15; p++) t0.set(pages.subarray(p * 256, p * 256 + 256), (15 - p) * 256);
  side1.set(t0, 0);                                       // page $4F = sector 0 = the boot page
  return {
    "DUNGEON.PRG": glue.dungeon.loader.bytes,
    "DUNGEON1.DSK": side1,
    "DUNGEON2.DSK": synthImage(1, 0x87),
    "DUNGEON3.DSK": synthImage(2, 0x87),
    "DUNCHR.DSK": synthImage(3, 0x87),
    "CITYCHR.DSK": synthImage(4, 0x87),
  };
}

async function boot(files, prg, fatOpts = {}, beforeRun) {
  const s = await harness.boot({ sd: buildSparseFat32({ [P.FOLDER]: files }, fatOpts) });
  const vm = s.vm;
  if (beforeRun) beforeRun(vm);
  for (const line of [`CD ${P.FOLDER}\r`, `BRUN ${prg} 6000\r`]) {
    for (const ch of line) {
      vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0));
      for (let i = 0; i < 8; i++) vm.run(20000);
    }
    for (let i = 0; i < 40; i++) vm.run(50000);
  }
  return { s, vm };
}

function finish(vm, label) {
  let nmis = 0;
  vm.keyDown(0x41);                                       // the City test strobes it with $C010
  vm.addBreakpoint(R.NMI_ENTRY);
  for (let i = 0; i < 20000 && vm.peek(RES + 31) !== 0xaa; i++) {
    vm.run(20000);
    if (vm.breakpointHit()) { nmis++; vm.removeBreakpoint(R.NMI_ENTRY); vm.step(); vm.addBreakpoint(R.NMI_ENTRY); }
  }
  const serial = vm.drainOutput();
  assert.equal(vm.peek(RES + 31), 0xaa, `${label}: test program finished (serial: ${JSON.stringify(serial.slice(-300))})`);
  return { serial, nmis, r: (n) => vm.peek(RES + n), page: (p, n = 256) => Array.from({ length: n }, (_, i) => vm.peek(p + i)), mapped: (a, n) => Array.from({ length: n }, (_, i) => vm.peekMapped(a + i)) };
}
const expect = (img, t, s, mask = 0) => Array.from({ length: 256 }, (_, i) => byteOf(img, t, s, i) ^ mask);

async function runCity(label, fatOpts) {
  const { vm } = await boot(cityFolder(), "CITY.PRG", fatOpts);
  const { serial, nmis, r, page, mapped } = finish(vm, label);
  assert.match(serial, /FLOAD CITY1\.DSK 7000 0000 00FF\r/);
  assert.match(serial, /FLOAD CITYCHR\.DSK 7200 0000 00FF\r/);
  assert.equal(r(0), 0, "read succeeds");
  assert.equal(r(1), 2, "volume found returned in the IOB");
  assert.deepEqual(page(0x3000), expect(0, 3, 5), "side 1 T3 S5 (second half of a card sector)");
  assert.equal(r(2), 0, "read into language-card RAM succeeds");
  assert.deepEqual(mapped(0xd180, 256), expect(1, 34, 15), "side 2 T34 S15 landed in bank 2 at an unaligned address");
  assert.equal(r(3), 0x5c, "bank 2 still mapped and writable after the shim");
  assert.equal(r(4), 0, "volume 0 read succeeds");
  assert.equal(r(5), 3, "volume 0 used the side last selected (side 2)");
  assert.deepEqual(page(0x3200), expect(1, 17, 0), "...and read it");
  assert.equal(r(6), 0, "write succeeds");
  assert.deepEqual(page(0x3500), Array.from({ length: 256 }, (_, i) => i ^ 0xa6), "written sector reads back");
  assert.deepEqual(page(0x3600), expect(2, 5, 2), "write leaves the other half of the card sector alone");
  assert.equal(r(7), 1, "unknown volume sets carry");
  assert.equal(r(8), 0x20, "...with the RWTS volume-mismatch code");
  assert.equal(r(9), 1, "track 35 sets carry");
  assert.equal(r(10), 0x40, "...with the RWTS drive-error code");
  assert.equal(r(11), 0, "seek succeeds");
  assert.equal(r(12), 0, "format succeeds (the image is always formatted)");
  assert.deepEqual(page(0x3500), Array.from({ length: 256 }, (_, i) => i ^ 0xa6), "format does not erase");
  assert.equal(r(13), 253, "drive 2 starts with the character disk");
  assert.deepEqual(page(0x3800), expect(2, 0, 1), "...and reads it");
  assert.equal(r(15), 0, "ROM zero page $B0-$B9 preserved");
  assert.deepEqual([r(16), r(17)], [0x00, 0x17], "$48/$49 hold the IOB pointer, as the original RWTS leaves them");
  assert.equal(r(18), R.NMI_ENTRY >> 8, "RAM NMI vector is the resident's");
  assert.equal(r(19), 0x41, "$C010 strobe cleared through the forwarder with bank 2 mapped");
  assert.equal(r(20), 0x3c, "bank 2 writable after the NMI");
  assert.equal(r(21), R.NMI_ENTRY >> 8, "fixvec restores the NMI vector after a ROM copy");
  assert.equal(r(22), R.IRQ_ENTRY >> 8, "...and the IRQ vector");
  assert.ok(nmis >= 1, `NMIs went through the language-card forwarder (${nmis})`);
  console.log(`PASS City ${label}: loader, shim reads/writes/errors/volumes, LC buffers and state, zero page, ${nmis} forwarded NMIs`);
}

async function runDungeon(label, fatOpts) {
  const { vm } = await boot(dungeonFolder(), "DUNGEON.PRG", fatOpts);
  const { serial, r, page, mapped } = finish(vm, label);
  assert.match(serial, /FLOAD DUNGEON1\.DSK 7000 0000 00FF\r/);
  assert.match(serial, /FLOAD CITYCHR\.DSK 7400 0000 00FF\r/);
  assert.equal(r(0), 0, "read succeeds");
  assert.equal(r(1), 16, "$437D = volume found");
  assert.deepEqual(page(0x3000), expect(0, 3, 5), "disk 1 side 1 T3 S5, XOR $87 undone");
  assert.equal(r(2), 0);
  assert.deepEqual(mapped(0xd280, 256), expect(2, 20, 9), "disk 2 side 1 into language-card RAM");
  assert.equal(r(3), 0, "write succeeds");
  assert.deepEqual(page(0x3500), Array.from({ length: 256 }, (_, i) => i ^ 0x5b), "written sector reads back");
  assert.equal(r(4), 0, "sector 16+n succeeds");
  assert.equal(r(5), 5, "...with $41 reduced to n, as the original");
  assert.deepEqual(page(0x3600), expect(3, 7, 5), "...and reads sector n");
  assert.equal(r(6), 1, "unknown volume sets carry");
  assert.equal(r(7), 3, "...with the RWTS's volume error code");
  assert.equal(r(8), 1, "track 40 sets carry");
  assert.equal(r(9), 4, "...with the RWTS's drive error code");
  assert.equal(r(10), 20, "drive 2 starts with the Dungeon character disk");
  assert.equal(r(11), 0, "format succeeds");
  assert.equal(r(12), 0, "the City character disk is reachable by volume 253");
  assert.deepEqual(page(0x3800), expect(4, 0, 1), "...and read through the Dungeon's XOR");
  assert.equal(r(13), R.NMI_ENTRY >> 8, "RAM NMI vector is the resident's");
  console.log(`PASS Dungeon ${label}: loader, XOR $87 data, volumes, errors, sector+16, LC buffers`);
}

await runCity("512-byte clusters", {});
await runCity("4 KB clusters", { sectorsPerCluster: 8, totalSectors: 600000 });
await runDungeon("512-byte clusters", {});
await runDungeon("FAT entries with reserved bits set", { reservedBits: ["DUNGEON1.DSK", "DUNCHR.DSK", "CITYCHR.DSK"] });

async function expectLoaderError(label, files, prg, fatOpts, pattern, beforeRun) {
  const { s, vm } = await boot(files, prg, fatOpts, beforeRun);
  for (let i = 0; i < 200; i++) vm.run(50000);
  const out = vm.drainOutput() + "\n" + s.textScreen().join("\n");
  assert.match(out, pattern, `${label}: ${JSON.stringify(out.slice(-200))}`);
  assert.notEqual(vm.peek(RES + 31), 0xaa, `${label}: never entered the game`);
  console.log(`PASS loader refuses: ${label}`);
}
{
  const f = cityFolder(); delete f["CITY2.DSK"];
  await expectLoaderError("missing CITY2.DSK", f, "CITY.PRG", {}, /CITY2\.DSK IS MISSING/);
}
await expectLoaderError("fragmented CITYCHR.DSK", cityFolder(), "CITY.PRG", { fragment: ["CITYCHR.DSK"] }, /CITYCHR\.DSK IS FRAGMENTED/);
await expectLoaderError("unknown ROM SD routines", dungeonFolder(), "DUNGEON.PRG", {}, /NEEDS THE 3RIC ROM/, (vm) => vm.poke(0xe20a, vm.peek(0xe20a) ^ 1));

// ---------------------------------------------------------------------------
// Optional: the real games from the owner's disks.

if (process.env.AR_DISKS) {
  const dir = process.env.AR_DISKS;
  const images = fs.readdirSync(dir).map((n) => path.join(dir, n)).filter((p) => fs.statSync(p).isFile())
    .map((p) => { try { return P.readImage(fs.readFileSync(p)); } catch { return null; } }).filter(Boolean)
    .filter((im) => { try { return P.identify(im); } catch { return false; } });
  const seen = new Set();
  const unique = images.filter((im) => { const k = P.identify(im); if (seen.has(k)) return false; seen.add(k); return true; });
  const { files, games, notes } = P.buildFolder(unique, rom);
  assert.deepEqual(notes, [], "every side is a known release");
  for (const game of games) {
    const prg = P.GAMES[game].prg;
    const { vm } = await boot(files, prg);
    const entry = game === "city" ? P.CITY_SHIM : P.DUNGEON_SHIM;
    let calls = 0, armed = false;
    // The City shows the crack's title (any key), then its menu; the Dungeon goes straight to its menu.
    for (let i = 0; i < 9000; i++) {
      vm.run(50000);
      if (!armed && vm.peek(entry) === glue[game].shim.bytes[0]) { vm.addBreakpoint(entry); armed = true; }
      if (vm.breakpointHit()) { calls++; vm.removeBreakpoint(entry); vm.step(); vm.addBreakpoint(entry); }
      if (game === "city" && i === 1500) vm.keyDown(32);
    }
    assert.ok(!vm.textMode(), `${game}: title menu in graphics mode`);
    assert.equal(vm.peekMapped(0xfffb), R.NMI_ENTRY >> 8, `${game}: NMI vector points at the resident`);
    assert.ok(calls > 100, `${game}: the game loaded through the SD shim (${calls} sector calls)`);
    console.log(`PASS ${game}: original disks load from the SD card to the title menu (${calls} sector calls)`);
  }
} else {
  console.log("SKIP real-disk boot (set AR_DISKS to a folder with the Alternate Reality images)");
}
