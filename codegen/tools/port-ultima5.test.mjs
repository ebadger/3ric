// Run after web/build.ps1: node codegen/tools/port-ultima5.test.mjs
//
// Proves the Ultima V SD-card glue (loader, resident NMI/ROM trampoline and
// DINKEYDOS replacement shim) on the real ROM DOS and SPI SD emulation using
// synthetic volumes - no copyrighted game data. Set U5_DISKS to a folder with
// the eight original disk images to also boot the real game to its title.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assemble } from "./asm6502.mjs";
import harness from "./harness.cjs";
import { readProdosImage } from "./ultima5/prodos.mjs";
import { buildSparseFat32 } from "./ultima5/fat32.mjs";
import { VOLUMES, BANKSIG_VALUE, applyPatches, assembleResident, buildFromVolumes, buildTree, sdKey } from "./port-ultima5.mjs";

// ---------------------------------------------------------------------------
// ProDOS reader on a synthetic image (seedling + sapling + unowned blocks).

function prodosImage(order) {
  const blocks = Array.from({ length: 280 }, () => new Uint8Array(512));
  const dir = blocks[2];
  dir[4] = 0xf0 | 4; dir.set(Buffer.from("TEST"), 5);
  dir[0x23] = 0x27; dir[0x24] = 0x0d; dir[0x27] = 6;
  const entry = (i, name, storage, key, eof, aux) => {
    const e = dir.subarray(4 + i * 39);
    e[0] = (storage << 4) | name.length; e.set(Buffer.from(name), 1); e[0x10] = 6;
    e[0x11] = key & 255; e[0x12] = key >> 8; e[0x15] = eof & 255; e[0x16] = eof >> 8;
    e[0x1f] = aux & 255; e[0x20] = aux >> 8;
  };
  entry(1, "SMALL", 1, 7, 100, 0x1234);
  for (let i = 0; i < 100; i++) blocks[7][i] = i;
  entry(2, "BIG.ONE", 2, 8, 1300, 0x2000);
  [9, 10, 11].forEach((b, n) => { blocks[8][n] = b; blocks[b].fill(0x40 + n); });
  blocks[200].fill(0x77);
  const image = new Uint8Array(143360);
  const A = [0, 13, 11, 9, 7, 5, 3, 1], B = [14, 12, 10, 8, 6, 4, 2, 15];
  blocks.forEach((b, n) => {
    if (order === "po") { image.set(b, n * 512); return; }
    const t = (n >> 3) * 4096;
    image.set(b.subarray(0, 256), t + A[n & 7] * 256);
    image.set(b.subarray(256), t + B[n & 7] * 256);
  });
  return image;
}

for (const order of ["do", "po"]) {
  const v = readProdosImage(prodosImage(order));
  assert.equal(v.volume, "TEST");
  assert.equal(v.order, order);
  assert.deepEqual(v.files.map((f) => [f.name, f.aux, f.eof]), [["SMALL", 0x1234, 100], ["BIG.ONE", 0x2000, 1300]]);
  assert.equal(v.files[0].data[99], 99);
  assert.equal(v.files[1].data[1299], 0x42);
  assert.ok(v.unowned.includes(200) && !v.unowned.includes(9) && !v.unowned.includes(2));
  assert.equal(v.blocks[200 * 512], 0x77);
}
assert.equal(sdKey("MAIN.COMBAT"), "MAINCOMB");
assert.equal(sdKey("PRTY.DATA"), "PRTYDATA");
console.log("PASS ProDOS reader (DOS and ProDOS order) and SD key mapping");

// ---------------------------------------------------------------------------
// STARTUP patch: applied only over the exact original bytes.

{
  const LDA_C000 = [0xad, 0x00, 0xc0];
  const startup = new Uint8Array(0xc00);
  const original = [0x8d, 0x08, 0xc0, 0xa9, 0x00, 0x8d, 0x05, 0xc0, 0x8d, 0x7e, 0x03, 0x8d, 0x04, 0xc0, 0x85, 0xb1, 0x8d, 0x73, 0xc0];
  startup.set(original, 0x169);
  startup.set(LDA_C000, 0xb77);
  const subs = new Uint8Array(0x1000);
  subs.set(LDA_C000, 0xfc2);
  const view = (n) => { const d = new Uint8Array(0x100); d.set(LDA_C000, 0x5a); return { name: "VIEW", aux: 0xa700, eof: d.length, data: d, n }; };
  const views = [view(1), view(2)];
  const vols = new Map([
    ["ULTIMA5", { files: [{ name: "STARTUP", aux: 0x8000, eof: startup.length, data: startup },
      { name: "MAIN.SUBS", aux: 0xe000, eof: subs.length, data: subs }] }],
    ["BRITANNIA", { files: [views[0]] }], ["TOWNE", { files: [views[1]] }],
  ]);
  const padKey = assembleResident().symbols.PAD_KEY;
  const jsrPad = [0x20, padKey & 255, padKey >> 8];
  applyPatches(vols);
  assert.deepEqual(Array.from(startup.subarray(0x169, 0x169 + 3)), [0xea, 0xea, 0xea]);
  assert.deepEqual(Array.from(startup.subarray(0x16c, 0x16e)), [0xa9, 0x00], "LDA #0 is kept");
  assert.deepEqual(Array.from(startup.subarray(0xb77, 0xb7a)), jsrPad, "title menu reads the pads");
  assert.deepEqual(Array.from(subs.subarray(0xfc2, 0xfc5)), jsrPad, "in-game scankey reads the pads");
  for (const v of views) assert.deepEqual(Array.from(v.data.subarray(0x5a, 0x5d)), jsrPad, "VIEW on every disk");
  applyPatches(vols); // idempotent
  subs[0xfc2] = 0x2c;
  assert.throws(() => applyPatches(vols), /MAIN\.SUBS.*unexpected bytes/);
  subs.set(LDA_C000, 0xfc2);
  startup[0x169] = 0x00;
  assert.throws(() => applyPatches(vols), /unexpected bytes/);
  console.log("PASS STARTUP aux-memory and keyboard-read patches are exact and guarded");
}

// ---------------------------------------------------------------------------
// End-to-end shim test on synthetic volumes.

const RES = 0x0300;
const startupSrc = `
        .org $8000
RES = $${RES.toString(16)}
        jmp start
name1:  .asciiz "DATA.ONE"
blk:    .word 200
start:
        lda #$EE                ; 1: explicit address, exact length
        sta $312C
        jsr $D006
        .asciiz "DATA.ONE"
        .word $3000
        php
        pla
        sta RES+0
        lda $312C
        sta RES+1
        jsr $D003               ; 2: name by pointer, load at aux ($3400)
        .word name1
        php
        pla
        sta RES+2
        jsr $D024               ; 3: block read into $D600 (bank 1)
        .word blk
        lda $D600
        sta RES+3
        lda $D7FF
        sta RES+4
        jsr $D000               ; 4: missing file
        .asciiz "NOPE"
        sta RES+6
        php
        pla
        sta RES+5
        ldx #63                 ; 5: switch disk, write, read back
fill:   txa
        eor #$5A
        sta $3800,x
        dex
        bpl fill
        jsr $D01E
        .asciiz "/BRITANNIA"
        php
        pla
        sta RES+7
        jsr $D018
        .asciiz "SAVE.DAT"
        .word $3800
        .word 0
        php
        pla
        sta RES+8
        jsr $D006
        .asciiz "SAVE.DAT"
        .word $3900
        ldx #63
        ldy #0
cmp5:   lda $3800,x
        cmp $3900,x
        beq cmp5ok
        iny
cmp5ok: dex
        bpl cmp5
        sty RES+9
        jsr $D024               ; 6: same block number, other disk
        .word blk
        lda $D600
        sta RES+10
        jsr $D000               ; 7: file that is not on this disk
        .asciiz "DATA.ONE"
        php
        pla
        sta RES+11
        jsr $D01E               ; 8: unknown volume
        .asciiz "/NOWHERE"
        sta RES+12
        php
        pla
        sta RES+13
        bit $C083               ; 9: NMI while bank 2 is mapped
        bit $C083
        lda #$5C
        sta $D123
        bit $C010
        nop
        nop
        lda $D123
        sta RES+14
        lda #$A7
        sta $D124
        lda $D124
        sta RES+15
        lda #$3C
        sta $9000
        lda $9000
        sta RES+16
        bit $C08B               ; 10: NMI while bank 1 is mapped
        bit $C08B
        bit $C010
        nop
        nop
        lda $D000
        sta RES+17
        jsr $D01E
        .asciiz "/ULTIMA5"
        jsr $D00C               ; 11: load and run
        .asciiz "FINISH"
        lda #$FF
        sta RES+31
hang:   jmp hang
`;
const finishSrc = `
        .org $5000
        lda #$AA
        sta $${(RES + 30).toString(16)}
done:   jmp done
`;

function synthVolumes() {
  const startup = assemble(startupSrc).bytes;
  const finish = assemble(finishSrc).bytes;
  const data = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 255);
  const file = (name, aux, bytes) => ({ name, aux, eof: bytes.length, data: new Uint8Array(bytes) });
  const volumes = new Map();
  VOLUMES.forEach(([name], v) => {
    const blocks = new Uint8Array(143360);
    for (let b = 0; b < 280; b++) blocks.fill((b + v * 16) & 255, b * 512, b * 512 + 511), blocks[b * 512 + 511] = 0x99 - v;
    volumes.set(name, { files: [], blocks });
  });
  volumes.get("ULTIMA5").files.push(
    file("STARTUP", 0x8000, startup), file("HTXT", 0xa000, new Uint8Array(2048)),
    file("DATA.ONE", 0x3400, data), file("FINISH", 0x5000, finish));
  volumes.get("BRITANNIA").files.push(file("SAVE.DAT", 0x3800, new Uint8Array(64)));
  return { volumes, data };
}

async function bootGame(tree) {
  const s = await harness.boot({ sd: buildSparseFat32({ U5: tree }) });
  const vm = s.vm;
  for (const line of ["CD U5\r", "BRUN U5.PRG 0800\r"]) {
    for (const ch of line) {
      vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0));
      for (let i = 0; i < 8; i++) vm.run(20000);
    }
    for (let i = 0; i < 40; i++) vm.run(50000);
  }
  return vm;
}

{
  const { volumes, data } = synthVolumes();
  const info = {};
  const tree = buildFromVolumes(volumes, info);
  assert.equal(tree["U5.PRG"].length, 0x1400);
  assert.equal(tree["U5.PRG"][0x0c00 - 0x0800 + 0xfff], BANKSIG_VALUE, "bank-1 signature at $DFFF");
  assert.deepEqual(Object.keys(tree).slice(1), VOLUMES.map(([, dir]) => dir));
  assert.equal(Object.keys(tree.ULTIMA5).filter((k) => k.startsWith("RAW")).length, 35);
  assert.equal(tree.ULTIMA5.DATAONE.length, 300);

  const vm = await bootGame(tree);
  let nmis = 0;
  vm.addBreakpoint(info.nmiEntry);
  for (let i = 0; i < 4000 && vm.peek(RES + 30) !== 0xaa && vm.peek(RES + 31) !== 0xff; i++) {
    vm.run(20000);
    if (vm.breakpointHit()) { nmis++; vm.removeBreakpoint(info.nmiEntry); vm.step(); vm.addBreakpoint(info.nmiEntry); }
  }
  const r = (n) => vm.peek(RES + n);
  const serial = vm.drainOutput();
  assert.equal(r(30), 0xaa, `FINISH ran (results ${Array.from({ length: 18 }, (_, i) => r(i).toString(16))}, serial: ${JSON.stringify(serial.slice(-400))})`);
  assert.equal(r(0) & 1, 0, "explicit-address load succeeds");
  assert.equal(r(1), 0xee, "load stops exactly at EOF (no extra byte)");
  for (let i = 0; i < 300; i++) assert.equal(vm.peek(0x3000 + i), data[i]);
  assert.equal(r(2) & 1, 0, "pointer-name load succeeds");
  assert.equal(vm.peek(0x3400 + 299), data[299], "default address is the ProDOS aux type");
  assert.equal(r(3), 200 & 255, "block 200 of ULTIMA5");
  assert.equal(r(4), 0x99, "whole block");
  assert.equal(r(5) & 1, 1, "missing file sets carry");
  assert.equal(r(6), 0x46, "file-not-found error code");
  assert.equal(r(7) & 1, 0, "volume switch succeeds");
  assert.equal(r(8) & 1, 0, "write succeeds");
  assert.equal(r(9), 0, "written file reads back identically");
  assert.equal(r(10), (200 + 16) & 255, "block cache is per disk");
  assert.equal(r(11) & 1, 1, "files on other disks are not visible");
  assert.equal(r(12), 0x45, "unknown volume error code");
  assert.equal(r(13) & 1, 1, "unknown volume sets carry");
  assert.equal(r(14), 0x5c, "bank 2 still mapped after an NMI");
  assert.equal(r(15), 0xa7, "bank 2 still writable after an NMI");
  assert.equal(r(16), 0x3c, "BASIC ROM stays off ($9000 is RAM)");
  assert.equal(r(17), 0x4c, "bank 1 (shim) still mapped after an NMI");
  assert.ok(nmis >= 2, `keyboard-strobe NMIs went through the language-card forwarder (${nmis})`);
  assert.match(serial, /CD ULTIMA5\rOK\r/);
  assert.match(serial, /FLOAD DATAONE 3000 0000 012B\r/);
  assert.match(serial, /FLOAD RAW19 D600 0000 01FF\r/);
  assert.match(serial, /OWRITE SAVEDAT 3800 0040\r/);
  assert.doesNotMatch(serial, /NOPE|NOWHERE|BLOAD/, "missing files/volumes never reach the ROM");
  console.log(`PASS shim on ROM DOS: loads, block reads, writes, volumes, errors, ${nmis} forwarded NMIs`);
}

// ---------------------------------------------------------------------------
// SNES pads: pad_key types mapped keys into $C000 (tap, held repeat, release).

{
  const padKey = assembleResident().symbols.PAD_KEY;
  const padProg = assemble(`
        .org $8000
        jmp start               ; the loader expects STARTUP to begin with JMP
start:  lda $C083               ; bank 2 read/write, like the game
        lda $C083
        ldx #0
loop:   stz $B8                 ; the game's key queue stays empty
        jsr $${padKey.toString(16)}
        bpl loop
        sta $0300,x
        bit $C010
        inx
        txa
        and #1
        beq use2
        lda $C08B
        lda $C08B
        bra loop
use2:   lda $C083
        lda $C083
        bra loop
`).bytes;
  const { volumes } = synthVolumes();
  const u5 = volumes.get("ULTIMA5").files;
  u5.splice(u5.findIndex((f) => f.name === "STARTUP"), 1,
    { name: "STARTUP", aux: 0x8000, eof: padProg.length, data: padProg });
  const vm = await bootGame(buildFromVolumes(volumes));
  const second = 1573438;
  const hold = (mask, seconds) => { vm.setGamepadState(1, mask); vm.runCycles(Math.round(seconds * second)); };
  const typed = () => { const out = []; for (let i = 0; i < 64 && vm.peek(0x300 + i); i++) out.push(vm.peek(0x300 + i)); return out; };
  for (let i = 0; i < 64; i++) vm.poke(0x300 + i, 0);
  hold(0, 0.3);
  hold(256, 0.1); hold(0, 0.3);
  assert.deepEqual(typed(), [0x8d], `a tap of A types one Return (controller 2 mirrors 1); PC $${vm.pc().toString(16)} serial ${JSON.stringify(vm.drainOutput().slice(-200))}`);
  hold(128, 1.5);
  const held = typed().length - 1;
  hold(0, 0.6);
  const afterRelease = typed().length - 1;
  assert.ok(typed().slice(1).every((k) => k === 0x95), "Right types right-arrow");
  assert.ok(held >= 5 && held <= 9, `holding Right 1.5 s repeats after a delay (${held} keys)`);
  assert.equal(afterRelease, held, "releasing stops at once");
  hold(1 | 8, 0.2); hold(0, 0.3);
  assert.deepEqual(typed().slice(-2).sort(), [0xa0, 0xda], "B and Start pressed together both type");
  console.log(`PASS SNES pads: tap, ${held}-key held repeat, release, simultaneous buttons, bank swaps`);
}

// ---------------------------------------------------------------------------
// Optional: the real game boots to its title screen.

if (process.env.U5_DISKS) {
  const tree = buildTree(process.env.U5_DISKS);
  const vm = await bootGame(tree);
  for (let i = 0; i < 400; i++) vm.run(50000);
  const serial = vm.drainOutput();
  assert.match(serial, /FLOAD STARTUP 8000/);
  assert.match(serial, /FLOAD MAINSUBS E000/);
  assert.match(serial, /FLOAD VIEWTILE A800/);
  assert.ok(!vm.textMode(), "title is in graphics mode");
  console.log("PASS original Ultima V disks boot to the animated title");
} else {
  console.log("SKIP real-disk boot (set U5_DISKS to the folder with the eight images)");
}
