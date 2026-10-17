// Run after web/build.ps1: node codegen/tools/port-wizardry1.test.mjs
//
// Proves the Wizardry I SD-card glue (loader, resident, Pascal BIOS block
// driver) on the real ROM DOS and SPI SD emulation with synthetic volumes -
// no copyrighted game data. Set WIZ1_DISKS to a folder holding the boot and
// scenario images to also play the real game from the title to the maze.
import assert from "node:assert/strict";
import { assemble } from "./asm6502.mjs";
import harness from "./harness.cjs";
import { buildSparseFat32 } from "./ultima5/fat32.mjs";
import { codeSegments, readPascalImage } from "./wizardry1/pascal.mjs";
import {
  PATCHES, applyPatches, buildFromDisks, buildLoader, combineVolumes, fletcher, loadDisks, romFingerprints,
} from "./port-wizardry1.mjs";

const BLOCK = 512;
const DOS_SECTOR = [0, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 15];

// ---------------------------------------------------------------------------
// Synthetic Apple Pascal volumes.

function pascalVolume(name, files, { flag25 = 0 } = {}) {
  const blocks = new Uint8Array(280 * BLOCK);
  const d = blocks.subarray(2 * BLOCK);
  d[2] = 6; d[6] = name.length; d.set(Buffer.from(name), 7);
  d[14] = 280 & 255; d[15] = 280 >> 8; d[16] = files.length; d[25] = flag25;
  files.forEach((f, i) => {
    const e = d.subarray((i + 1) * 26);
    e[0] = f.first & 255; e[1] = f.first >> 8; e[2] = f.next & 255; e[3] = f.next >> 8;
    e[4] = f.kind ?? 2; e[6] = f.name.length; e.set(Buffer.from(f.name), 7); e[22] = 0; e[23] = 2;
    if (f.data) blocks.set(f.data, f.first * BLOCK);
  });
  return blocks;
}
function dosOrder(blocks) {
  const image = new Uint8Array(blocks.length);
  for (let b = 0; b < 280; b++) {
    const t = (b >> 3) * 4096, i = b & 7;
    image.set(blocks.subarray(b * BLOCK, b * BLOCK + 256), t + DOS_SECTOR[2 * i] * 256);
    image.set(blocks.subarray(b * BLOCK + 256, b * BLOCK + 512), t + DOS_SECTOR[2 * i + 1] * 256);
  }
  return image;
}
// A code file: segment dictionary block + one 16-block (8 KB) segment per name.
function codeFile(segments) {
  const data = new Uint8Array((1 + 16 * segments.length) * BLOCK);
  segments.forEach(([name, bytesAt], i) => {
    data[i * 4] = 1 + 16 * i; data[i * 4 + 2] = 0; data[i * 4 + 3] = 0x20; // 8 KB long
    data.set(Buffer.from(name.padEnd(8, " ")), 64 + i * 8);
    for (const [off, bytes] of bytesAt) data.set(bytes, (1 + 16 * i) * BLOCK + off);
  });
  return data;
}
const before = (file, seg) => PATCHES.filter((p) => p.file === file && p.segment === seg)
  .flatMap((p) => [[p.offset, p.before], ...(p.target ? [[p.target.offset, p.target.bytes]] : [])]);

function syntheticDisks() {
  const wiz = codeFile([["SPECIALS", before("WIZARDRY.CODE", "SPECIALS")], ["CASTLE", before("WIZARDRY.CODE", "CASTLE")]]);
  const startup = codeFile([["WIZBOOT", before("SYSTEM.STARTUP", "WIZBOOT")]]);
  const fill = (n, v) => new Uint8Array(n * BLOCK).fill(v);
  const scenData = fill(116, 0x5d);
  scenData.set([0, 0, 6, 0, 26, 0, 60, 0, 68, 0, 84, 0, 94, 0, 114, 0], 90);
  const boot = pascalVolume("WBV2.1", [
    { name: "WIZARDRY.CODE", first: 6, next: 6 + wiz.length / BLOCK, data: wiz },
    { name: "RTSTRP.APPLE", first: 149, next: 173, data: fill(24, 0x11) },
    { name: "SYSTEM.PASCAL", first: 173, next: 202, data: fill(29, 0x22) },
    { name: "SYSTEM.STARTUP", first: 257, next: 257 + startup.length / BLOCK, data: startup },
  ], { flag25: 0x0e });
  const scen = pascalVolume("WSV2.1", [
    { name: "WIZARDRY.CODE", first: 6, next: 6 + wiz.length / BLOCK, data: wiz },
    { name: "SCENARIO.DATA", first: 149, next: 265, data: scenData },
    { name: "SCENARIO.MESGS", first: 265, next: 280, data: fill(15, 0x33) },
  ]);
  scen.fill(0x55, 5 * BLOCK, 6 * BLOCK); // the scenario's serial block
  return { boot: readPascalImage(dosOrder(boot)), scenario: readPascalImage(scen) };
}

{
  const { boot, scenario } = syntheticDisks();
  assert.equal(boot.order, "do");
  assert.equal(scenario.order, "po");
  assert.equal(boot.volume, "WBV2.1");
  assert.deepEqual(scenario.files.map((f) => [f.name, f.first, f.next]),
    [["WIZARDRY.CODE", 6, 39], ["SCENARIO.DATA", 149, 265], ["SCENARIO.MESGS", 265, 280]]);
  assert.deepEqual(codeSegments(boot.blocks, 6).map((s) => [s.name, s.block, s.length]),
    [["SPECIALS", 7, 8192], ["CASTLE", 23, 8192]]);

  const vol = combineVolumes(boot, scenario);
  assert.equal(vol.base, 280);
  assert.equal(vol.total, 280 + (274 - 149), "boot files 149-273 move up as one run");
  const dir = vol.blocks.subarray(2 * BLOCK);
  assert.equal(String.fromCharCode(...dir.subarray(7, 13)), "WBV2.1", "system volume header");
  assert.equal(dir[25], 0x0e, "boot header flag kept (the runtime's volume search depends on it)");
  assert.equal(dir[14] | (dir[15] << 8), vol.total);
  assert.deepEqual(vol.files.map((f) => [f.name, f.first]), [
    ["WIZARDRY.CODE", 6], ["SCENARIO.DATA", 149], ["SCENARIO.MESGS", 265],
    ["RTSTRP.APPLE", 280], ["SYSTEM.PASCAL", 304], ["SYSTEM.STARTUP", 388]]);
  assert.equal(vol.blocks[5 * BLOCK], 0x55, "scenario serial block");
  assert.equal(vol.blocks[280 * BLOCK], 0x11, "RTSTRP data moved with its entry");

  const applied = applyPatches(vol);
  assert.equal(applied.length, 4);
  for (const p of PATCHES) {
    const f = vol.files.find((x) => x.name === p.file);
    const seg = codeSegments(vol.blocks, f.first).find((s) => s.name === p.segment);
    assert.deepEqual(Array.from(vol.blocks.subarray(seg.block * BLOCK + p.offset, seg.block * BLOCK + p.offset + p.after.length)), p.after);
  }
  applyPatches(vol); // idempotent
  vol.blocks[23 * BLOCK + 0x1584] = 0x0b;
  assert.throws(() => applyPatches(vol), /unexpected bytes/);

  const other = syntheticDisks();
  other.scenario.blocks[7 * BLOCK + 3] ^= 1;
  assert.throws(() => combineVolumes(other.boot, other.scenario), /WIZARDRY.CODE differ/);
  assert.equal(fletcher([1, 2, 255]).join(), "3,7"); // end-around carry, as the loader adds
  console.log("PASS Pascal reader (both orders), combined volume, guarded p-code patches");
}

// ---------------------------------------------------------------------------
// End to end: loader + resident + shim on the ROM DOS with a synthetic volume.
// The "runtime" is a test program placed where RTSTRP.APPLE's BIOS lives.

const VOL_BLOCKS = 64, RT_BLOCK = 30, WR_FIRST = 2, WR_END = 30;
const RES = 0x0300;
const pattern = (b, i) => (b * 7 + i * 3 + (i >> 8)) & 255;
const DIRSIG = Uint8Array.from({ length: 14 }, (_, i) => pattern(2, i));

const runtimeSrc = `
        .org $9300
RES = $${RES.toString(16)}
start:
        ldx #0                  ; 0: blocks 0-2 (1536 bytes) -> $4000
        jsr bios
        sta RES+0
        lda #$EE                ; 1: partial read, 700 bytes of block 3
        sta $4C00+700
        ldx #8
        jsr bios
        sta RES+1
        ldx #16                 ; 2: 4 KB across clusters from block 7
        jsr bios
        sta RES+2
        ldx #24                 ; 3: past the volume
        jsr bios
        sta RES+3
        ldx #32                 ; 4: drive 2
        jsr bios
        sta RES+4
        ldx #40                 ; 5: write block 0 (the write-protect probe)
        jsr bios
        sta RES+5
        ldx #48                 ; 6: write a boot-disk block
        jsr bios
        sta RES+6
        ldx #56                 ; 7: partial-block write
        jsr bios
        sta RES+7
        ldx #64                 ; 8: write straddling the protected end
        jsr bios
        sta RES+8
        ldx #255                ; 9: write blocks 10-11 from a pattern
fill:   txa
        eor #$A5
        sta $6000,x
        eor #$FF
        sta $6100,x
        sta $6200,x
        sta $6300,x
        dex
        cpx #255
        bne fill
        ldx #72
        jsr bios
        sta RES+9
        ldx #80                 ; 10: read them back to $6400
        jsr bios
        sta RES+10
        ldx #88                 ; 10b: negative block number (16-bit wrap)
        jsr bios
        sta RES+19
        lda $C083               ; 11: NMI with bank 2 mapped
        lda $C083
        lda #$5C
        sta $D123
        bit $C010
        nop
        nop
        lda $D123
        sta RES+11
        lda #$A7
        sta $D124
        lda $D124
        sta RES+12
        lda #$3C
        sta $9000
        lda $9000
        sta RES+13
        ldx #0                  ; 12: a BIOS call from bank 2 keeps bank 2
        jsr bios
        sta RES+14
        lda $D123
        sta RES+15
        lda $C08B               ; 13: bank 1 mapped: NMI and a BIOS call
        lda $C08B
        lda $DFFF
        sta RES+16
        bit $C010
        nop
        nop
        ldx #0
        jsr bios
        lda $DFFF
        sta RES+17
        lda $FFFA
        sta RES+18
        lda $C082               ; 14: ROM again
        lda #$FF
        sta RES+31
hang:   jmp hang

; X = offset into calls: op, block, count, buffer, drive. Returns IORESULT.
bios:
        pla
        sta ret
        pla
        sta ret+1
        lda #0
        pha
        pha
        pha
        lda calls+7,x
        pha
        lda calls+6,x
        pha
        lda calls+5,x
        pha
        lda calls+4,x
        pha
        lda calls+3,x
        pha
        lda calls+2,x
        pha
        lda calls+1,x
        pha
        lda calls,x
        cmp #2
        beq b_write
        jsr $BDC8               ; DISKREAD through the BIOS jump table
        bra b_done
b_write:
        jsr $BDC5               ; DISKWRITE
b_done:
        lda ret+1
        pha
        lda ret
        pha
        txa
        rts
ret:    .word 0
calls:
        .byte 1
        .word 0,1536,$4000
        .byte 0
        .byte 1
        .word 3,700,$4C00
        .byte 0
        .byte 1
        .word 7,4096,$5000
        .byte 0
        .byte 1
        .word ${VOL_BLOCKS},512,$4000
        .byte 0
        .byte 1
        .word 0,512,$4000
        .byte 1
        .byte 2
        .word 0,512,$4000
        .byte 0
        .byte 2
        .word ${WR_END},512,$4000
        .byte 0
        .byte 2
        .word 10,600,$6000
        .byte 0
        .byte 2
        .word ${WR_END - 1},1024,$4000
        .byte 0
        .byte 2
        .word 10,1024,$6000
        .byte 0
        .byte 1
        .word 10,1024,$6400
        .byte 0
        .byte 2
        .word $FFFF,512,$4000
        .byte 0
`;

function syntheticVolume({ badRuntime = false } = {}) {
  const vol = new Uint8Array(VOL_BLOCKS * BLOCK);
  for (let b = 0; b < VOL_BLOCKS; b++) for (let i = 0; i < BLOCK; i++) vol[b * BLOCK + i] = pattern(b, i);
  const rt = new Uint8Array(45 * 256);
  const put = (addr, bytes) => rt.set(bytes, addr - 0x9200);
  put(0x9300, assemble(runtimeSrc).bytes);
  put(0xaf28, [0xa0, 0x02, 0xd0, 0x02, 0xa0, 0x01, 0x8c, 0xac, 0x03, 0x68, 0x85, badRuntime ? 0xc1 : 0xc0]);
  put(0xbdc5, [0x4c, 0x28, 0xaf, 0x4c, 0x2c, 0xaf]);
  put(0xbefe, [0x00, 0x93]);
  vol.set(rt, RT_BLOCK * BLOCK);
  return vol;
}

const ROWS = [0, 0x80, 0x100, 0x180, 0x200, 0x280, 0x300, 0x380, 0x28, 0xa8, 0x128, 0x1a8, 0x228, 0x2a8, 0x328, 0x3a8, 0x50, 0xd0, 0x150, 0x1d0, 0x250, 0x2d0, 0x350, 0x3d0];
// Text page as ASCII; Pascal writes letters as $01-$1A.
const screenOf = (vm) => ROWS.map((o) => Array.from({ length: 40 }, (_, c) => {
  let b = vm.peek(0x400 + o + c) & 0x7f;
  if (b < 0x20) b += 0x40;
  return String.fromCharCode(b);
}).join("")).join("\n");

async function bootCard(card) {
  const s = await harness.boot({ sd: buildSparseFat32({ WIZ1: card }, card.options) });
  const vm = s.vm;
  for (const line of ["CD WIZ1\r", "BRUN WIZ1.PRG 0800\r"]) {
    for (const ch of line) { vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0)); for (let i = 0; i < 8; i++) vm.run(20000); }
    for (let i = 0; i < 40; i++) vm.run(50000);
  }
  return vm;
}

const built = buildLoader({ volBlocks: VOL_BLOCKS, rtBlock: RT_BLOCK, wrFirst: WR_FIRST, wrEnd: WR_END, dirSig: DIRSIG });
const NMI = built.resident.symbols.NMI_ENTRY;
for (const options of [{}, { sectorsPerCluster: 8, fragment: true, totalSectors: 600000 }, { sectorsPerCluster: 64, totalSectors: 4300000 }]) {
  const label = `${options.sectorsPerCluster ?? 1}-sector clusters${options.fragment ? ", fragmented" : ""}`;
  const card = { "WIZ1.PRG": built.prg, "WIZ1.VOL": syntheticVolume() };
  Object.defineProperty(card, "options", { value: options, enumerable: false });
  const vm = await bootCard(card);
  let nmis = 0;
  vm.addBreakpoint(NMI);
  for (let i = 0; i < 4000 && vm.peek(RES + 31) !== 0xff; i++) {
    vm.run(20000);
    if (vm.breakpointHit()) { nmis++; vm.removeBreakpoint(NMI); vm.step(); vm.addBreakpoint(NMI); }
  }
  const serial = vm.drainOutput();
  const r = (n) => vm.peek(RES + n);
  const results = Array.from({ length: 19 }, (_, i) => r(i).toString(16)).join(" ");
  assert.equal(r(31), 0xff, `${label}: runtime finished (results ${results}, serial ${JSON.stringify(serial.slice(-300))})`);
  const check = (addr, block, n) => { for (let i = 0; i < n; i++) assert.equal(vm.peek(addr + i), pattern(block + (i >> 9), i & 511), `${label}: block ${block}+${i}`); };
  assert.equal(r(0), 0, "whole-block read");
  check(0x4000, 0, 1536);
  assert.equal(r(1), 0, "partial read");
  check(0x4c00, 3, 700);
  assert.equal(vm.peek(0x4c00 + 700), 0xee, "partial read stops at the byte count");
  assert.equal(r(2), 0, "read across clusters");
  check(0x5000, 7, 4096);
  assert.equal(r(3), 8, "block past the volume");
  assert.equal(r(4), 9, "only unit 4 exists");
  assert.equal(r(5), 16, "block 0 is write-protected (WIZBOOT's master check)");
  assert.equal(r(6), 16, "boot-disk blocks are write-protected");
  assert.equal(r(7), 16, "partial-block writes are refused");
  assert.equal(r(8), 16, "a write may not straddle the protected end");
  assert.equal(r(9), 0, "scenario write");
  assert.equal(r(10), 0, "read back");
  assert.equal(r(19), 16, "a negative block number cannot wrap into the writable range");
  for (let i = 0; i < 1024; i++) assert.equal(vm.peek(0x6400 + i), vm.peek(0x6000 + i), `${label}: written byte ${i}`);
  assert.equal(r(11), 0x5c, "bank 2 still mapped after an NMI");
  assert.equal(r(12), 0xa7, "bank 2 still writable after an NMI");
  assert.equal(r(13), 0x3c, "BASIC ROM stays off ($9000 is RAM)");
  assert.equal(r(14), 0, "BIOS call from bank 2");
  assert.equal(r(15), 0x5c, "bank 2 restored after a BIOS call");
  assert.equal(r(16), 0xa5, "bank 1 signature");
  assert.equal(r(17), 0xa5, "bank 1 restored after an NMI and a BIOS call");
  assert.equal(r(18), NMI & 255, "language-card NMI vector points at the resident");
  assert.ok(nmis >= 2, `${label}: keyboard-strobe NMIs went through the resident (${nmis})`);
  console.log(`PASS block driver on ROM DOS (${label}): reads, partial/cross-cluster, errors, write+read-back, ${nmis} NMIs, bank restore`);
}

// Loader refusals: no volume, short volume, foreign ROM, unexpected runtime.
for (const [label, card, message] of [
  ["missing WIZ1.VOL", { "WIZ1.PRG": built.prg }, /WIZ1\.VOL MISSING OR DAMAGED/],
  ["short WIZ1.VOL", { "WIZ1.PRG": built.prg, "WIZ1.VOL": syntheticVolume().slice(0, 40 * BLOCK) }, /WIZ1\.VOL MISSING OR DAMAGED/],
  ["another volume", { "WIZ1.PRG": built.prg, "WIZ1.VOL": syntheticVolume().map((b, i) => (i >= 2 * BLOCK && i < 2 * BLOCK + 14 ? b ^ 1 : b)) }, /WIZ1\.VOL MISSING OR DAMAGED/],
  ["unexpected runtime", { "WIZ1.PRG": built.prg, "WIZ1.VOL": syntheticVolume({ badRuntime: true }) }, /RTSTRP\.APPLE UNEXPECTED/],
  ["different ROM", {
    "WIZ1.PRG": buildLoader({ volBlocks: VOL_BLOCKS, rtBlock: RT_BLOCK, wrFirst: WR_FIRST, wrEnd: WR_END, dirSig: DIRSIG,
      fingerprints: romFingerprints().map(([a, b, s1, s2], i) => [a, b, i === 1 ? s1 ^ 1 : s1, s2]) }).prg,
    "WIZ1.VOL": syntheticVolume() }, /NEEDS THE 3RIC ROM DOS/],
]) {
  const vm = await bootCard(card);
  for (let i = 0; i < 200; i++) vm.run(20000);
  const out = screenOf(vm);
  assert.match(out, message, `${label}:\n${out}`);
  assert.ok(vm.peek(RES + 31) !== 0xff, `${label}: the runtime did not start`);
}
console.log("PASS loader refuses a missing, short or foreign volume, an unexpected runtime and a different ROM");

// ---------------------------------------------------------------------------
// Optional: the real game, from BRUN through the title, menu, castle and maze.

if (process.env.WIZ1_DISKS) {
  const info = {};
  const tree = buildFromDisks(loadDisks(process.env.WIZ1_DISKS), info);
  const vm = await bootCard(tree);
  const screen = () => screenOf(vm);
  const until = (text, max = 8000) => { for (let i = 0; i < max; i++) { vm.run(20000); if (i % 25 === 0 && screen().includes(text)) return; } assert.fail(`never saw "${text}":\n${screen()}`); };
  const key = (s) => { for (const ch of s) { for (let t = 0; t < 400 && (vm.peek(0xc000) & 0x80); t++) vm.run(20000); vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0)); for (let i = 0; i < 20; i++) vm.run(20000); } };
  for (let i = 0; i < 3000; i++) vm.run(20000);
  assert.ok(!vm.textMode(), "animated title in graphics mode");
  key(" ");
  until("S)TART GAME");
  key("S");
  until("SCENARIO MASTER IN DRV 1");
  key("\r");
  until("MASTER/DUPLICATE IN DRV 1");
  key("\r");
  until("THE A)DVENTURER'S INN");
  key("E");
  until("T)RAINING GROUNDS");
  key("T");
  until("*ROSTER");
  console.log("PASS original disks: title, menu (write-protect probe), both disk prompts, castle, edge of town, training grounds");
} else {
  console.log("SKIP real-disk run (set WIZ1_DISKS to the folder with the boot and scenario images)");
}
