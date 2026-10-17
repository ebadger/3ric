// Run after web/build.ps1: node codegen/tools/port-sevencities.test.mjs
//
// Proves the Seven Cities of Gold SD-card glue - converter, loader, resident
// NMI/IRQ forwarder and the RWTS replacement shim - on the real ROM DOS and
// SPI SD emulation, using synthetic disk images and a synthetic GAME.BIN (no
// copyrighted game data). Set SEVENCITIES_DISKS to a folder holding the
// original program and map disk images to also boot the real game to its
// title screen and joystick menu.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { assemble } from "./asm6502.mjs";
import harness from "./harness.cjs";
import { buildSparseFat32 } from "./ultima5/fat32.mjs";
import * as P from "./port-sevencities.mjs";

const rom = P.readRom();

// ---------------------------------------------------------------------------
// Converter pieces on synthetic bytes.

{
  const dsk = new Uint8Array(P.DSK_BYTES);
  for (let t = 0; t < 35; t++) for (let s = 0; s < 16; s++) dsk.fill(t * 16 + s, (t * 16 + s) * 256, (t * 16 + s + 1) * 256);
  const tr = P.trackAsLoaded(dsk, 9);
  for (let page = 0; page < 16; page++) assert.equal(tr[page * 256], 9 * 16 + 15 - page, "page n holds DOS sector 15-n");
  assert.deepEqual(P.readDisk(zlib.gzipSync(dsk)), dsk, "gzipped images are accepted");
  assert.throws(() => P.readDisk(new Uint8Array(1000)), /140 KB/);
  assert.equal(P.identifyDisk(dsk), null);
  const prog = Uint8Array.from(dsk); prog[0] = 0x0b; prog.set(Buffer.from("NO LANGUAGE CARD INSTALLED", "latin1").map((c) => c | 0x80), 0x81);
  assert.equal(P.identifyDisk(prog), "program");
  const map = Uint8Array.from(dsk); map.set(Buffer.from("MAP DISK COPY PROGRAM", "latin1"), 0x900);
  assert.equal(P.identifyDisk(map), "map");
  console.log("PASS disk reading, identification and the boot loader's track layout");
}

{
  // Decryption: every other byte of $4000-$67FF XORed with runs 1..5, 1..6, ...
  const dsk = new Uint8Array(P.DSK_BYTES);
  const entry = [0xad, 0x50, 0xc0, 0xad, 0x52, 0xc0, 0xad, 0x57, 0xc0];
  const keys = []; for (let run = 5; keys.length < 0x1400; run++) for (let k = 1; k <= run && keys.length < 0x1400; k++) keys.push(k);
  const plain = new Uint8Array(0x2800); plain.set(entry);
  for (let i = entry.length; i < plain.length; i++) plain[i] = (i * 13) & 255;
  const cipher = Uint8Array.from(plain, (b, i) => (i & 1 ? b : b ^ keys[i >> 1]));
  for (const [track, page] of [[7, 0x40], [8, 0x50], [9, 0x60]]) {
    const chunk = cipher.subarray((page - 0x40) * 256, (page - 0x40) * 256 + 4096);
    for (let p = 0; p < 16 && p * 256 < chunk.length; p++) dsk.set(chunk.subarray(p * 256, p * 256 + 256), track * 4096 + (15 - p) * 256);
  }
  const mem = P.buildBootImage(dsk);
  assert.deepEqual(Array.from(mem.subarray(0x4000, 0x6800)), Array.from(plain));
  dsk[7 * 4096 + 15 * 256] ^= 1;
  assert.throws(() => P.buildBootImage(dsk), /different release/);

  const [, origin] = P.relocate(new Uint8Array(0x10000));
  for (const [rt, img] of [[0x7000, 0x4e00], [0xb7ff, 0x95ff], [0x8eef, 0x6cef], [0x6000, 0x1000], [0x60ff, 0x10ff],
    [0x6100, 0x4900], [0x651f, 0x4d1f], [0x6520, 0x1520], [0x6a0c, 0x1a0c], [0x4071, 0x4071], [0x5fff, 0x5fff]])
    assert.equal(origin[rt], img, `runtime $${rt.toString(16)} comes from image $${img.toString(16)}`);
  console.log("PASS decryption key stream and the start-up relocation map");
}

{
  // Patches land only on the expected bytes and survive relocation.
  const glue = P.buildGlue(rom);
  const image = new Uint8Array(0x10000);
  const [, origin] = P.relocate(image);
  const pre = { [P.RWTS_ENTRY]: [0x08, 0x78, 0x20, 0xfc, 0x8e], 0x6862: [0xa9, 0x05, 0x8d, 0xe8, 0x8c, 0xa9, 0x00, 0x8d, 0xe9, 0x8c, 0x8d, 0xf0, 0x8c, 0x20, 0x3e, 0x91, 0x20, 0xf3, 0x76, 0x20, 0x00, 0x61],
    0x4071: [0x20, 0xbd, 0x76], 0x408a: [0x20, 0xbd, 0x76], 0x6a0c: [0x20, 0xbd, 0x76], 0x40af: [0x8d, 0xfc, 0xff],
    0x40b2: [0xa9, 0x00, 0x8d, 0xfe, 0xff], 0x40bc: [0x8d, 0xfd, 0xff], 0x40c4: [0xa9, 0x03, 0x8d, 0xff, 0xff],
    [P.BTN_LDA]: [0x38, 0x86, 0xa3, 0xbd, 0x8d, 0xc0, 0xbd, 0x8e, 0xc0, 0x10, 0x03, 0x4c, 0x8f, 0x8a, 0xad, 0x00, 0x8e, 0x85, 0xaf, 0xa9],
    0x774d: [0xad, 0x61, 0xc0], 0x84f3: [0xad, 0x61, 0xc0], 0x88e8: [0x2c, 0x61, 0xc0] };
  for (const [at, bytes] of Object.entries(pre)) bytes.forEach((b, i) => { image[origin[+at + i]] = b; });
  const patched = P.patchImage(image, glue);
  const [rt] = P.relocate(patched);
  assert.deepEqual(Array.from(rt.subarray(P.RWTS_ENTRY, P.RWTS_ENTRY + 3)), [0x4c, P.GAME_SHIM & 255, P.GAME_SHIM >> 8]);
  assert.deepEqual(Array.from(rt.subarray(0x4071, 0x4074)), [0x20, glue.shim.symbols.PROG_LOAD & 255, glue.shim.symbols.PROG_LOAD >> 8]);
  assert.deepEqual(Array.from(rt.subarray(0x6862, 0x686c)), [0xa9, 0x00, 0x85, 0x03, 0x8d, 0x0a, 0x65, 0x4c, 0x94, 0x69], "protection call replaced by its passed result");
  assert.equal(rt[0x40b3], glue.resident.symbols.IRQ_ENTRY & 255);
  assert.equal(rt[0x40c5], glue.resident.symbols.IRQ_ENTRY >> 8);
  assert.deepEqual(Array.from(rt.subarray(0x774d, 0x7750)), [0x20, P.BTN_LDA & 255, P.BTN_LDA >> 8], "button wait scans first");
  assert.deepEqual(Array.from(rt.subarray(P.BTN_LDA, P.BTN_LDA + 10)), [0x2c, 0x70, 0xc0, 0xea, 0xea, 0xea, 0xad, 0x61, 0xc0, 0x60]);
  assert.deepEqual(Array.from(rt.subarray(P.GAME_SHIM, P.GAME_SHIM + glue.shim.bytes.length)), Array.from(glue.shim.bytes));
  assert.ok(P.GAME_SHIM + glue.shim.bytes.length <= P.GAME_IOB, "shim ends below the IOB");
  image[origin[0x6862]] = 0x60;
  assert.throws(() => P.patchImage(image, glue), /different release/);

  const disk = new Uint8Array(P.DSK_BYTES);
  const out = P.patchProgramDisk(disk);
  assert.equal(out[30 * 4096 + 0xff], P.SIG_BANK1);
  assert.equal(out[27 * 4096 + 256 + 0xff], P.SIG_BANK2);
  assert.equal(disk[30 * 4096 + 0xff], 0, "input image untouched");
  assert.throws(() => P.patchProgramDisk(out), /different release/);

  assert.equal(P.wmOffset(0x0850), (21 * 16 + 9) * 256, "World Maker $0850 is T21 S9");
  assert.equal(P.wmOffset(0x15ef), (22 * 16 + 6) * 256 + 0x9f, "World Maker $15EF is T22 S6 +$9F");
  const wm = new Uint8Array(P.DSK_BYTES);
  const wmPut = (a, bytes) => bytes.forEach((b, i) => { wm[P.wmOffset(a + i)] = b; });
  wmPut(P.WM_ENTRY, [0x08, 0x78, 0x20, 0xfc, 0x15]); wmPut(P.WM_IOB, [0x01, 0x60, 0x01]);
  wmPut(P.WM_RD_PAGE - 2, [0x99, 0x00]); wmPut(P.WM_WR_PAGE - 2, [0x59, 0x00]);
  P.patchWorldMaker(wm, glue);
  assert.deepEqual([0, 1, 2].map((i) => wm[P.wmOffset(P.WM_ENTRY + i)]), [0x4c, P.WM_SHIM & 255, P.WM_SHIM >> 8]);
  assert.equal(wm[P.wmOffset(P.WM_SHIM)], glue.wmShim.bytes[0]);
  assert.ok(P.WM_SHIM + glue.wmShim.bytes.length <= P.WM_IOB, "World Maker shim ends below its IOB");
  assert.throws(() => P.patchWorldMaker(wm, glue), /different release/);
  console.log("PASS guarded game and program-disk patches");
}

// ---------------------------------------------------------------------------
// The real loader, resident and shim on the ROM DOS with synthetic files.

const RES = 0x0300;
const progByte = (t, s, i) => (t * 16 + s + i * 7 + 0x11) & 255;
const mapByte = (t, s, i) => ((t * 16 + s) * 3 + i) ^ 0x5c;
function synthDisk(fn) {
  const d = new Uint8Array(P.DSK_BYTES);
  for (let t = 0; t < 35; t++) for (let s = 0; s < 16; s++) for (let i = 0; i < 256; i++) d[(t * 16 + s) * 256 + i] = fn(t, s, i) & 255;
  return d;
}

function testProgram(glue) {
  return assemble(`
RES = $${RES.toString(16)}
IOB = $${P.GAME_IOB.toString(16)}
SHIM = $${P.GAME_SHIM.toString(16)}
PROG_LOAD = $${glue.shim.symbols.PROG_LOAD.toString(16)}
DISK = $CFF8
RD = $${P.GAME_RD_PAGE.toString(16)}
WR = $${P.GAME_WR_PAGE.toString(16)}
WSHIM = $${P.WM_SHIM.toString(16)}
WIOB = $${P.WM_IOB.toString(16)}
WRD = $${P.WM_RD_PAGE.toString(16)}
BTN = $${P.BTN_LDA.toString(16)}
        .org $4000
        stz IOB+8               ; the IOB buffer is stale in this RWTS
        lda #$77
        sta IOB+9
        ldx #9                  ; zero-page canaries in the ROM's SD bytes
zc:     txa
        eor #$C3
        sta $B0,x
        dex
        bpl zc
        lda #1
        sta IOB+$0C
        lda $C083               ; 1: bank 2, program disk T3 S5 -> $3000
        lda $C083
        stz DISK
        lda #3
        sta IOB+4
        lda #5
        sta IOB+5
        lda #$30
        sta RD
        jsr SHIM
        php
        pla
        sta RES+0
        lda $DFFF
        sta RES+1
        lda #$77
        sta $D123
        lda $D123
        sta RES+2
        lda $C08B               ; 2: bank 1, map disk T34 S15 -> $3100
        lda $C08B
        lda #1
        sta DISK
        lda #34
        sta IOB+4
        lda #15
        sta IOB+5
        lda #$31
        sta RD
        jsr SHIM
        php
        pla
        sta RES+3
        lda $DFFF
        sta RES+4
        lda $C082               ; 3: ROM selected, map T17 S0 -> $3200
        lda #17
        sta IOB+4
        stz IOB+5
        lda #$32
        sta RD
        jsr SHIM
        lda $DFFF
        sta RES+5
        lda $E1B9
        sta RES+6
        lda $C083               ; 4: write map T17 S1 from $3400, read back
        lda $C083
        ldx #0
pat:    txa
        eor #$A6
        sta $3400,x
        inx
        bne pat
        lda #2
        sta IOB+$0C
        lda #1
        sta IOB+5
        lda #$34
        sta WR
        jsr SHIM
        php
        pla
        sta RES+7
        lda #1
        sta IOB+$0C
        lda #$35
        sta RD
        jsr SHIM                ; T17 S1 -> $3500
        stz IOB+5
        lda #$36
        sta RD
        jsr SHIM                ; T17 S0 -> $3600 (other half of the card sector)
        lda #35                 ; 5: track out of range
        sta IOB+4
        jsr SHIM
        php
        pla
        sta RES+8
        lda IOB+$0D
        sta RES+9
        stz IOB+$0C             ; 6: seek
        lda #5
        sta IOB+4
        jsr SHIM
        php
        pla
        sta RES+10
        lda #1                  ; 7: program-disk wrapper (stub at $76BD)
        sta DISK
        jsr PROG_LOAD
        lda DISK
        sta RES+12
        ldx #9                  ; 8: canaries
        ldy #0
zc2:    txa
        eor #$C3
        cmp $B0,x
        beq zc3
        iny
zc3:    dex
        bpl zc2
        sty RES+13
        lda $C08B               ; 9: NMIs with each bank mapped
        lda $C08B
        lda #$C1
        sta $C000
        bit $C010
        nop
        nop
        nop
        lda $C000
        sta RES+14
        lda $DFFF
        sta RES+15
        jsr BTN                 ; the game's patched button read
        sta RES+16
        lda $DFFF
        sta RES+17
        lda $C083
        lda $C083
        lda #$C2
        sta $C000
        bit $C010
        nop
        nop
        nop
        lda $C000
        sta RES+18
        lda $DFFF
        sta RES+19
        lda #$3C
        sta $D124
        lda $D124
        sta RES+20
        stz DISK                ; 10: World Maker copy: program-disk read,
        lda #1                  ; then format (selects and zeroes the map disk)
        sta WIOB+$0C
        lda #4
        sta WIOB+4
        lda #6
        sta WIOB+5
        lda #$39
        sta WRD
        jsr WSHIM               ; program T4 S6 -> $3900
        lda #4
        sta WIOB+$0C
        jsr WSHIM
        php
        pla
        sta RES+21
        lda DISK
        sta RES+22
        lda #1
        sta IOB+$0C
        lda #34
        sta IOB+4
        lda #15
        sta IOB+5
        lda #$37
        sta RD
        jsr SHIM                ; map T34 S15 -> $3700 (zeros)
        stz DISK
        lda #3
        sta IOB+4
        lda #5
        sta IOB+5
        lda #$38
        sta RD
        jsr SHIM                ; program T3 S5 -> $3800 (untouched)
        lda #$AA
        sta RES+31
hang:   bra hang
`);
}

function synthProgramDisk() {
  const d = synthDisk(progByte);
  for (const p of P.DISK_PATCHES) d[p.track * 4096 + p.sector * 256 + p.offset] = p.before;
  return P.patchProgramDisk(d);
}

function synthFolder() {
  const glue = P.buildGlue(rom);
  const image = new Uint8Array(0x10000);
  const prog = testProgram(glue);
  image.set(prog.bytes, 0x4000);
  image.set(assemble(`.org $76BD\n lda $CFF8\n sta $${(RES + 11).toString(16)}\n rts\n`).bytes, 0x76bd);
  image.set(glue.shim.bytes, P.GAME_SHIM);
  image.set(glue.wmShim.bytes, P.WM_SHIM);
  image.set(P.BTN_HELPERS, P.BTN_LDA);
  // the IOBs as the images hold them: slot 6, drive 1
  image.set([0x01, 0x60, 0x01, 0x00, 0x00, 0x00, 0x6f, 0x90, 0x00, 0x1f], P.GAME_IOB);
  image.set([0x01, 0x60, 0x01, 0x00, 0x00, 0x00, 0x6e, 0x18, 0x00, 0x02], P.WM_IOB);
  return {
    glue,
    files: {
      "7CITIES.PRG": glue.prg,
      "GAME.BIN": image.slice(P.GAME_START, P.GAME_END),
      "PROGRAM.DSK": synthProgramDisk(),
      "MAP.DSK": synthDisk(mapByte),
    },
  };
}

async function boot(files, fatOpts = {}, beforeRun) {
  const s = await harness.boot({ sd: buildSparseFat32({ [P.FOLDER]: files }, fatOpts) });
  const vm = s.vm;
  if (beforeRun) beforeRun(vm);
  for (const line of [`CD ${P.FOLDER}\r`, "BRUN 7CITIES.PRG 0800\r"]) {
    for (const ch of line) {
      vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0));
      for (let i = 0; i < 8; i++) vm.run(20000);
    }
    for (let i = 0; i < 40; i++) vm.run(50000);
  }
  return { s, vm };
}

async function runSynthetic(label, fatOpts) {
  const { glue, files } = synthFolder();
  const { vm } = await boot(files, fatOpts, (v) => v.setGamepadState(0, 1));
  let nmis = 0;
  const nmiEntry = glue.resident.symbols.NMI_ENTRY;
  vm.addBreakpoint(nmiEntry);
  for (let i = 0; i < 20000 && vm.peek(RES + 31) !== 0xaa; i++) {
    vm.run(20000);
    if (vm.breakpointHit()) { nmis++; vm.removeBreakpoint(nmiEntry); vm.step(); vm.addBreakpoint(nmiEntry); }
  }
  const serial = vm.drainOutput();
  const r = (n) => vm.peek(RES + n);
  const page = (p) => Array.from({ length: 256 }, (_, i) => vm.peek(p * 256 + i));
  assert.equal(r(31), 0xaa, `${label}: test program finished (serial: ${JSON.stringify(serial.slice(-300))})`);
  assert.match(serial, /FLOAD PROGRAM\.DSK 2000 0000 00FF\r/);
  assert.match(serial, /FLOAD MAP\.DSK 2100 0000 00FF\r/);
  assert.match(serial, /FLOAD GAME\.BIN 2200 0000 00FF\r/);
  assert.equal(r(0) & 1, 0, "read succeeds");
  assert.deepEqual(page(0x30), Array.from({ length: 256 }, (_, i) => progByte(3, 5, i)), "program disk T3 S5 (second half of a card sector)");
  assert.equal(r(1), P.SIG_BANK2, "bank 2 still mapped after a read");
  assert.equal(r(2), 0x77, "bank 2 still writable");
  assert.deepEqual(page(0x31), Array.from({ length: 256 }, (_, i) => mapByte(34, 15, i) & 255), "map disk T34 S15");
  assert.equal(r(4), P.SIG_BANK1, "bank 1 still mapped after a read");
  assert.deepEqual(page(0x32), Array.from({ length: 256 }, (_, i) => mapByte(17, 0, i) & 255), "read with ROM selected");
  assert.equal(r(5), 0x00, "ROM still selected ($DFFF)");
  assert.equal(r(6), 0xa9, "ROM still selected ($E1B9)");
  assert.equal(r(7) & 1, 0, "write succeeds");
  assert.deepEqual(page(0x35), Array.from({ length: 256 }, (_, i) => i ^ 0xa6), "written sector reads back");
  assert.deepEqual(page(0x36), Array.from({ length: 256 }, (_, i) => mapByte(17, 0, i) & 255), "write leaves the other half of the card sector alone");
  assert.equal(r(8) & 1, 1, "track 35 sets carry");
  assert.equal(r(9), 0x40, "...with the RWTS drive-error code");
  assert.equal(r(10) & 1, 0, "seek succeeds");
  assert.equal(r(11), 0, "the program disk is selected inside the wrapper");
  assert.equal(r(12), 1, "the map disk is selected after it");
  assert.equal(r(13), 0, "ROM zero page $B0-$B9 preserved");
  assert.equal(r(14), 0x41, "$C010 strobe cleared through the forwarder (bank 1)");
  assert.equal(r(15), P.SIG_BANK1, "bank 1 mapped after the strobe NMI");
  assert.ok(r(16) & 0x80, "button helper (BIT $C070, NOPs, LDA $C061) sees the pad's button with bank 1 mapped");
  assert.equal(r(17), P.SIG_BANK1, "bank 1 mapped after the joystick NMI");
  assert.equal(r(18), 0x42, "$C010 strobe cleared through the forwarder (bank 2)");
  assert.equal(r(19), P.SIG_BANK2, "bank 2 mapped after the strobe NMI");
  assert.equal(r(20), 0x3c, "bank 2 writable after the NMI");
  assert.equal(r(21) & 1, 0, "format succeeds");
  assert.equal(r(22), 1, "format selects the map disk");
  assert.deepEqual(page(0x39), Array.from({ length: 256 }, (_, i) => progByte(4, 6, i)), "World Maker copy reads the program disk into its own page");
  assert.deepEqual(page(0x77), new Array(256).fill(0), "the stale IOB buffer page is never written");
  assert.deepEqual(page(0x37), new Array(256).fill(0), "format zeroes the map disk");
  assert.deepEqual(page(0x38), Array.from({ length: 256 }, (_, i) => progByte(3, 5, i)), "format leaves the program disk alone");
  assert.ok(nmis >= 3, `NMIs went through the language-card forwarder (${nmis})`);
  console.log(`PASS ${label}: loader, shim reads/writes/format on both disks, LC state, zero page, ${nmis} forwarded NMIs`);
}

await runSynthetic("512-byte clusters", {});
await runSynthetic("4 KB clusters", { sectorsPerCluster: 8, totalSectors: 600000 });

async function expectLoaderError(label, mutate, fatOpts, pattern, beforeRun) {
  const { files } = synthFolder();
  mutate(files);
  const { s, vm } = await boot(files, fatOpts, beforeRun);
  for (let i = 0; i < 200; i++) vm.run(50000);
  const serial = vm.drainOutput() + "\n" + s.textScreen().join("\n");
  assert.match(serial, pattern, `${label}: ${JSON.stringify(serial.slice(-200))}`);
  assert.doesNotMatch(serial, /4002-/, `${label}: never entered GAME.BIN`);
  console.log(`PASS loader refuses: ${label}`);
}

await expectLoaderError("missing MAP.DSK", (f) => delete f["MAP.DSK"], {}, /MAP\.DSK IS MISSING/);
await expectLoaderError("fragmented MAP.DSK", () => {}, { fragment: ["MAP.DSK"] }, /MAP\.DSK IS FRAGMENTED/);
await expectLoaderError("fragmented GAME.BIN", () => {}, { fragment: ["GAME.BIN"] }, /GAME\.BIN IS FRAGMENTED/);
await expectLoaderError("unknown ROM SD routines", () => {}, {}, /NEEDS THE 3RIC ROM/, (vm) => vm.poke(0xe20a, vm.peek(0xe20a) ^ 1));

// ---------------------------------------------------------------------------
// Optional: the real game from the owner's disks.

if (process.env.SEVENCITIES_DISKS) {
  const dir = process.env.SEVENCITIES_DISKS;
  const images = fs.readdirSync(dir).map((n) => path.join(dir, n)).filter((p) => fs.statSync(p).isFile())
    .map((p) => { try { return P.readDisk(fs.readFileSync(p)); } catch { return null; } }).filter(Boolean);
  const program = images.find((d) => P.identifyDisk(d) === "program");
  const map = images.find((d) => P.identifyDisk(d) === "map");
  assert.ok(program && map, "SEVENCITIES_DISKS holds a program disk and a map disk");
  const { files, knownRelease } = P.buildFolder(program, map, rom);
  assert.ok(knownRelease, "the program disk is the release the port was built on");
  const { vm } = await boot(files);
  const IOB = P.GAME_IOB;
  const reads = [];
  let armed = false;
  for (let i = 0; i < 3200; i++) {
    vm.run(20000);
    if (!armed && vm.peek(P.GAME_SHIM) === 0x08) { vm.addBreakpoint(P.GAME_SHIM); vm.addBreakpoint(0x6294); armed = true; }
    if (vm.breakpointHit()) {
      const pc = vm.pc();
      assert.notEqual(pc, 0x6294, "the copy-protection nibble reader never runs");
      reads.push(`${vm.peek(0xcff8)}:${vm.peek(IOB + 4)}:${vm.peek(IOB + 5)}`);
      vm.removeBreakpoint(pc); vm.step(); vm.addBreakpoint(pc);
    }
  }
  assert.equal(reads.length, 63, "the language card loads 63 sectors");
  assert.ok(reads.every((r) => r.startsWith("0:")), "...all from the program disk");
  assert.equal(vm.peek(0xcff8), 1, "the map disk is in the drive afterwards");
  assert.ok(!vm.textMode(), "title in graphics mode");
  assert.equal(vm.peekMapped(0xfffb), 0xcf, "NMI vector points at the resident");
  console.log("PASS original disks load from the SD card to the title screen");
} else {
  console.log("SKIP real-disk boot (set SEVENCITIES_DISKS to the folder with the two images)");
}
