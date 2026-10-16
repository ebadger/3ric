// Run after web/build.ps1: node codegen/tools/port-ultima1.test.mjs
//
// Proves the Ultima I SD-card glue (loader + ProDOS stand-in) on the real
// ROM DOS and SPI SD emulation using synthetic files - no copyrighted game
// data. Set U1_DISK to the owner's Ultima I .dsk to also play the real game:
// intro, character creation and save, continue, castle, town and quick-save.
import assert from "node:assert/strict";
import { assemble } from "./asm6502.mjs";
import harness from "./harness.cjs";
import { buildSparseFat32 } from "./ultima5/fat32.mjs";
import { PATCHES, SAVE_FILE, applyPatches, buildFromFiles, buildLoader, buildTree, sdKey } from "./port-ultima1.mjs";

const HZ = 1573437;

// ---------------------------------------------------------------------------
// Converter: keys, the guarded STUPH patch, the generated save file.

assert.equal(sdKey("MAKE.INDATA"), "MAKEINDA");
assert.equal(sdKey("U1.SYSTEM"), "U1SYSTEM");
assert.equal(sdKey("MI.U1"), "MIU1");
{
  const stuph = new Uint8Array(0x1800);
  const p = PATCHES[0];
  stuph.set(p.before, p.address - 0x800);
  const files = [{ name: "STUPH", type: 6, aux: 0x800, eof: stuph.length, data: stuph }];
  applyPatches(files);
  assert.deepEqual(Array.from(stuph.subarray(p.address - 0x800, p.address - 0x800 + 2)), [0x80, 0x2d], "LDX #$C7 -> BRA $17BB");
  applyPatches(files); // idempotent
  stuph[p.address - 0x800] = 0;
  assert.throws(() => applyPatches(files), /unexpected bytes/);
  console.log("PASS STUPH mouse-probe patch is exact and guarded");
}

// ---------------------------------------------------------------------------
// End-to-end: a synthetic U1.SYSTEM drives the stand-in through every call.

const RES = 0x8000;
const sysSrc = `
        .org $2000
RES = $${RES.toString(16)}
MLI = $BF00
        jmp start
idx:    .byte 0
tmpa:   .byte 0
rec:    php                     ; RES+2n = A, RES+2n+1 = P after call n
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
p_one:  .byte 12
        .text "/U1/DATA.ONE"
p_low:  .byte 8
        .text "data.one"
p_miss: .byte 4
        .text "NOPE"
p_vars: .byte 18
        .text "/U1.PLAYER/U1.VARS"
p_big:  .byte 7
        .text "BIG.ONE"
p_dir:  .byte 4
        .text "/U1/"
info:   .byte $0A
        .word p_one
        .res 16
info2:  .byte $0A
        .word p_miss
        .res 16
info3:  .byte $0A
        .word p_dir
        .res 16
open1:  .byte 3
        .word p_low
        .word $BB00
        .byte 0
open2:  .byte 3
        .word p_one
        .word $BB00
        .byte 0
open3:  .byte 3
        .word p_vars
        .word $BB00
        .byte 0
open4:  .byte 3
        .word p_big
        .word $BB00
        .byte 0
eof:    .byte 2,1,0,0,0
rd1:    .byte 4,1
        .word $3000,$FFFF,0
rd2:    .byte 4,1
        .word $4000,100,0
rd3:    .byte 4,1
        .word $4100,$FFFF,0
rd4:    .byte 4,1
        .word $5100,64,0
rd5:    .byte 4,1
        .word $6000,$FFFF,0
wr1:    .byte 4,1
        .word $5000,64,0
wr2:    .byte 4,1
        .word $5000,$1CB,0
close1: .byte 1,1
close0: .byte 1,0
create: .byte 7
        .word p_miss
        .byte $C3,6,0,0,1,0,0,0,0
destroy: .byte 1
        .word p_one
blk:    .byte 3,$60
        .word $3800,7
alloc:  .byte 2,0
        .word $3900
prefix: .byte 1
        .word $8100
start:
        ldx #15                 ; zero page the ROM DOS shares, marked
zmark:  txa
        ora #$C0
        sta $B0,x
        dex
        bpl zmark
        lda #$EE
        sta $3000+300           ; byte after DATA.ONE
        sta $4000+100           ; byte after the first partial read
        sta $6000+5000          ; byte after BIG.ONE
        ldx #63
wfill:  txa
        eor #$5A
        sta $5000,x
        dex
        bpl wfill

        jsr MLI                 ; 0 GET_FILE_INFO /U1/DATA.ONE
        .byte $C4
        .word info
        jsr rec
        jsr MLI                 ; 1 GET_FILE_INFO NOPE
        .byte $C4
        .word info2
        jsr rec
        jsr MLI                 ; 2 OPEN data.one
        .byte $C8
        .word open1
        jsr rec
        jsr MLI                 ; 3 GET_EOF
        .byte $D1
        .word eof
        jsr rec
        jsr MLI                 ; 4 READ all
        .byte $CA
        .word rd1
        jsr rec
        jsr MLI                 ; 5 READ at EOF
        .byte $CA
        .word rd1
        jsr rec
        jsr MLI                 ; 6 CLOSE
        .byte $CC
        .word close1
        jsr rec
        jsr MLI                 ; 7 READ after CLOSE
        .byte $CA
        .word rd1
        jsr rec
        jsr MLI                 ; 8 OPEN /U1/DATA.ONE
        .byte $C8
        .word open2
        jsr rec
        jsr MLI                 ; 9 READ 100
        .byte $CA
        .word rd2
        jsr rec
        jsr MLI                 ; 10 READ the rest (mark 100)
        .byte $CA
        .word rd3
        jsr rec
        jsr MLI                 ; 11 CLOSE
        .byte $CC
        .word close1
        jsr rec
        jsr MLI                 ; 12 OPEN /U1.PLAYER/U1.VARS
        .byte $C8
        .word open3
        jsr rec
        jsr MLI                 ; 13 WRITE 64
        .byte $CB
        .word wr1
        jsr rec
        jsr MLI                 ; 14 WRITE at mark 64
        .byte $CB
        .word wr1
        jsr rec
        jsr MLI                 ; 15 CLOSE
        .byte $CC
        .word close1
        jsr rec
        jsr MLI                 ; 16 OPEN U1.VARS
        .byte $C8
        .word open3
        jsr rec
        jsr MLI                 ; 17 WRITE past EOF
        .byte $CB
        .word wr2
        jsr rec
        jsr MLI                 ; 18 READ back 64
        .byte $CA
        .word rd4
        jsr rec
        jsr MLI                 ; 19 CLOSE 0 (all)
        .byte $CC
        .word close0
        jsr rec
        jsr MLI                 ; 20 OPEN
        .byte $C8
        .word open2
        jsr rec
        jsr MLI                 ; 21 second OPEN
        .byte $C8
        .word open3
        jsr rec
        jsr MLI                 ; 22 CLOSE
        .byte $CC
        .word close1
        jsr rec
        jsr MLI                 ; 23 CREATE
        .byte $C0
        .word create
        jsr rec
        jsr MLI                 ; 24 DESTROY
        .byte $C1
        .word destroy
        jsr rec
        jsr MLI                 ; 25 READ_BLOCK
        .byte $80
        .word blk
        jsr rec
        jsr MLI                 ; 26 GET_TIME
        .byte $82
        .word 0
        jsr rec
        jsr MLI                 ; 27 ALLOC_INTERRUPT
        .byte $40
        .word alloc
        jsr rec
        jsr MLI                 ; 28 QUIT: not provided
        .byte $65
        .word 0
        jsr rec
        jsr MLI                 ; 29 GET_PREFIX
        .byte $C7
        .word prefix
        jsr rec
        jsr MLI                 ; 30 GET_FILE_INFO of a directory path
        .byte $C4
        .word info3
        jsr rec
        jsr MLI                 ; 31 OPEN BIG.ONE
        .byte $C8
        .word open4
        jsr rec
        jsr MLI                 ; 32 READ 5000 bytes
        .byte $CA
        .word rd5
        jsr rec
        ldx #$5A                ; 33 X/Y preserved across a call
        ldy #$A5
        jsr MLI
        .byte $CC
        .word close1
        stx RES+$70
        sty RES+$71
        jsr rec
        ldx #15                 ; zero page restored
        ldy #0
zchk:   txa
        ora #$C0
        cmp $B0,x
        beq zok
        iny
zok:    dex
        bpl zchk
        sty RES+$72
        bit $C010               ; keyboard-strobe NMI through the ROM
        nop
        nop
        lda #$3C                ; BASIC overlay still off: $9000 is RAM
        sta $9000
        lda $9000
        sta RES+$73
        lda #$AA
        sta RES+$7F
done:   jmp done
`;

const sys = assemble(sysSrc).bytes;
const data = Uint8Array.from({ length: 300 }, (_, i) => (i * 7 + 3) & 255);
const big = Uint8Array.from({ length: 5000 }, (_, i) => (i * 13) & 255);
const files = [
  { name: "U1.SYSTEM", type: 0xff, aux: 0x2000, eof: sys.length, data: sys },
  { name: "DATA.ONE", type: 6, aux: 0x1234, eof: data.length, data },
  { name: "BIG.ONE", type: 6, aux: 0x6000, eof: big.length, data: big },
  { name: "PRODOS", type: 0xff, aux: 0x2000, eof: 4, data: new Uint8Array(4) },
];
const tree = buildFromFiles(files);
assert.equal(tree["U1.PRG"].length, 0x0700, "loader + $BB00-$BFFF image");
assert.ok(!("PRODOS" in tree), "the ProDOS kernel is not copied");
assert.equal(tree.U1VARS.length, SAVE_FILE.eof, "zero-filled save file is created");
assert.ok(tree.U1VARS.every((b) => b === 0));
assert.throws(() => buildFromFiles([...files, { name: "DATAONE", type: 6, aux: 0, eof: 1, data: new Uint8Array(1) }]), /shared by/);
{
  // The real disk serves 15 files plus the save file.
  const sixteen = Array.from({ length: 16 }, (_, i) => ({ name: `FILE${i}`, type: 6, aux: 0, eof: 1 }));
  assert.ok(buildLoader(sixteen).mli.symbols.FILETAB_END <= 0xbf00, "16 files fit below the global page");
}
console.log("PASS converter: loader image, file table, save file, key collisions");

async function bootU1(tree) {
  const s = await harness.boot({ sd: buildSparseFat32({ U1: tree }) });
  const vm = s.vm;
  const key = (ch) => { vm.keyDown(ch === "\r" ? 13 : typeof ch === "number" ? ch : ch.charCodeAt(0)); for (let i = 0; i < 8; i++) vm.run(20000); };
  for (const line of ["CD U1\r", "BRUN U1.PRG 0800\r"]) { for (const ch of line) key(ch); for (let i = 0; i < 20; i++) vm.run(50000); }
  return { vm, key };
}

{
  const { vm } = await bootU1(tree);
  for (let i = 0; i < 4000 && vm.peek(RES + 0x7f) !== 0xaa; i++) vm.run(20000);
  const serial = vm.drainOutput();
  assert.equal(vm.peek(RES + 0x7f), 0xaa, `test program finished (serial: ${JSON.stringify(serial.slice(-300))})`);
  const a = (n) => vm.peek(RES + 2 * n);
  const c = (n) => vm.peek(RES + 2 * n + 1) & 1;
  const okCall = (n, what) => { assert.equal(a(n), 0, `${what}: A=0`); assert.equal(c(n), 0, `${what}: carry clear`); };
  const err = (n, code, what) => { assert.equal(a(n), code, `${what}: error $${code.toString(16)}`); assert.equal(c(n), 1, `${what}: carry set`); };
  const word = (addr) => vm.peek(addr) | (vm.peek(addr + 1) << 8);
  const sym = assemble(sysSrc).symbols;

  okCall(0, "GET_FILE_INFO");
  assert.equal(vm.peek(sym.INFO + 3), 0xc3, "access");
  assert.equal(vm.peek(sym.INFO + 4), 6, "file type");
  assert.equal(word(sym.INFO + 5), 0x1234, "aux type");
  assert.equal(vm.peek(sym.INFO + 7), 1, "seedling");
  assert.equal(word(sym.INFO + 8), 1, "one block");
  err(1, 0x46, "missing file");
  okCall(2, "OPEN (lower-case name)");
  assert.equal(vm.peek(sym.OPEN1 + 5), 1, "ref_num");
  okCall(3, "GET_EOF");
  assert.equal(word(sym.EOF + 2), 300);
  okCall(4, "READ");
  assert.equal(word(sym.RD1 + 6), 300, "transfer count clamps to EOF");
  for (let i = 0; i < 300; i++) assert.equal(vm.peek(0x3000 + i), data[i]);
  assert.equal(vm.peek(0x3000 + 300), 0xee, "load stops exactly at EOF");
  err(5, 0x4c, "READ at EOF");
  okCall(6, "CLOSE");
  err(7, 0x43, "READ on a closed ref");
  okCall(9, "partial READ");
  assert.equal(word(sym.RD2 + 6), 100);
  assert.equal(vm.peek(0x4000 + 99), data[99]);
  assert.equal(vm.peek(0x4000 + 100), 0xee, "partial read stops at its count");
  okCall(10, "READ from mark 100");
  assert.equal(word(sym.RD3 + 6), 200);
  for (let i = 0; i < 200; i++) assert.equal(vm.peek(0x4100 + i), data[100 + i]);
  okCall(13, "WRITE");
  err(14, 0x4d, "WRITE past mark 0");
  okCall(16, "re-OPEN save");
  err(17, 0x48, "WRITE larger than the file");
  okCall(18, "READ back");
  for (let i = 0; i < 64; i++) assert.equal(vm.peek(0x5100 + i), i ^ 0x5a, "save reads back");
  okCall(19, "CLOSE 0");
  okCall(20, "OPEN");
  err(21, 0x42, "second OPEN");
  err(23, 0x2b, "CREATE");
  err(24, 0x2b, "DESTROY");
  err(25, 0x28, "READ_BLOCK");
  okCall(26, "GET_TIME");
  err(27, 0x25, "ALLOC_INTERRUPT");
  err(28, 0x01, "unsupported call");
  okCall(29, "GET_PREFIX");
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => vm.peek(0x8100 + i)), [4, 0x2f, 0x55, 0x31, 0x2f], "/U1/");
  err(30, 0x46, "directory path");
  okCall(32, "READ 5000 bytes");
  for (const i of [0, 511, 512, 4095, 4096, 4999]) assert.equal(vm.peek(0x6000 + i), big[i], `BIG.ONE byte ${i}`);
  assert.equal(vm.peek(0x6000 + 5000), 0xee);
  assert.deepEqual([vm.peek(RES + 0x70), vm.peek(RES + 0x71)], [0x5a, 0xa5], "X/Y preserved");
  assert.equal(vm.peek(RES + 0x72), 0, "$B0-$BF restored");
  assert.equal(vm.peek(RES + 0x73), 0x3c, "BASIC ROM stays off after an NMI");

  assert.equal(vm.peek(0xbf98), 0x60, "MACHID: II+-class, 64 KB");
  assert.equal(vm.peek(0xbf30), 0x60, "DEVNUM");
  for (let x = 0x10; x < 0x30; x += 2) assert.equal(word(0xbf00 + x), 0xbf4a, "every DEVADR is 'no device'");
  assert.equal(vm.peek(word(0x3fe)), 0xa5, "IRQ vector -> LDA $45 / RTI");
  assert.match(serial, /FLOAD U1SYSTEM 2000 0000 [0-9A-F]{4}\r/);
  assert.match(serial, /FLOAD DATAONE 3000 0000 012B\r/);
  assert.match(serial, /FLOAD DATAONE 4100 0064 012B\r/);
  assert.match(serial, /OWRITE U1VARS 5000 0040\r/);
  assert.match(serial, /FLOAD U1VARS 5100 0000 003F\r/);
  assert.match(serial, /FLOAD BIGONE 6000 0000 1387\r/);
  assert.doesNotMatch(serial, /NOPE|BLOAD|EH\?|NOFIND/, "only well-formed commands for known files reach the ROM");
  console.log("PASS ProDOS stand-in on the ROM DOS: info, open/read/mark/EOF, write/read-back, errors, registers, zero page, NMI");
}

{
  const bad = buildFromFiles([{ name: "OTHER", type: 6, aux: 0, eof: 1, data: new Uint8Array(1) }]);
  const { vm } = await bootU1(bad);
  for (let i = 0; i < 100; i++) vm.run(20000);
  const rows = []; for (let r = 0; r < 24; r++) { const base = 0x400 + harness.TEXT_SCANLINES[r]; rows.push(Array.from({ length: 40 }, (_, i) => String.fromCharCode(vm.peek(base + i) & 0x7f)).join("")); }
  assert.ok(rows.some((r) => r.startsWith("U1: U1SYSTEM NOT FOUND")), rows.join("\n"));
  assert.ok(rows.some((r) => /^[0-9A-F]{4}-\s+A=/.test(r)), "stopped in the monitor");
  console.log("PASS loader reports a missing U1.SYSTEM and stops");
}

// ---------------------------------------------------------------------------
// Optional: the real game.

if (process.env.U1_DISK) {
  const realTree = buildTree(process.env.U1_DISK);
  const { vm, key } = await bootU1(realTree);
  const run = (sec) => { for (let c = 0; c < sec * HZ; c += 20000) vm.run(20000); };
  const keys = (list, gap = 0.15) => { for (const k of list) { key(k); run(gap); } };
  let serial = "";
  const drain = () => (serial += vm.drainOutput());
  run(20); drain();
  assert.match(serial, /FLOAD U1SYSTEM 2000 0000 0691\r[\s\S]*FLOAD U1INTRO 0800 0000 09A4\r[\s\S]*FLOAD MAKEINDA 1E00/);
  assert.ok(!vm.textMode(), "intro is in hi-res");
  keys([" "]); run(8);
  keys(["A"]); run(4);                                   // generate a character
  keys([...Array(10).fill(21), 13, ...Array(5).fill(21), 13, ...Array(10).fill(21), 13, 13, 13, ...Array(5).fill(21)]);
  keys([" "]); run(3); keys(["A"]); run(3); keys(["A"]); run(3); keys(["A"]); run(3);
  keys([..."CASCADIA", 13]); run(3);
  keys(["Y"]); run(15); drain();
  assert.match(serial, /OWRITE U1VARS 7E6D 01CA\r/, "character saved");
  keys(["B"]); run(15); drain();                         // continue
  assert.match(serial, /FLOAD U1VARS 6000 0000 01C9\r[\s\S]*FLOAD OUT 8956/, "save loaded, overworld");
  keys(["Q"]); run(8); drain();                          // quit = save in place
  assert.equal(serial.match(/OWRITE U1VARS 7E6D 01CA\r/g).length, 2, "overworld quick-save");
  keys([13, 13, 13, 13, 8, 8, 8, 8, 8, 8, 8, 8, 8, "/", "/"], 0.5);
  keys(["E"]); run(15); drain();
  assert.match(serial, /FLOAD CAS 8956 0000 1593\r[\s\S]*FLOAD TCMAPS 4000[\s\S]*FLOAD MAPCHARS B000/, "Lord British's castle");
  const prg = realTree["U1.PRG"];
  for (let a = 0xbb00; a < 0xc000; a++) {
    if ((a >= 0xbfa0 && a < 0xbfd0) || [0xbf6e, 0xbf6f, 0xbffc, 0xbffd].includes(a)) continue; // state, U1.SYSTEM's bytes
    assert.equal(vm.peek(a), prg[0x0200 + a - 0xbb00], `stand-in byte $${a.toString(16)} intact`);
  }
  assert.doesNotMatch(serial, /EH\?|NOFIND|BLOAD/);
  console.log("PASS original Ultima I: intro, character creation + save, continue, quick-save, castle; stand-in intact");
} else {
  console.log("SKIP real-disk play (set U1_DISK to the Ultima I .dsk)");
}
