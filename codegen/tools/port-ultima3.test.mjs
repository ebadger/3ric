// Run after web/build.ps1: node codegen/tools/port-ultima3.test.mjs
//
// Proves the Ultima III SD-card glue (loader + RWTS replacement shim) on the
// real ROM DOS and SPI SD emulation with synthetic data - no copyrighted
// game bytes. Set U3_DISKS to a folder holding the two original disk images
// to also play the real game: Mockingboard set-up, title, character creation,
// party, the world, a castle, a dungeon, Quit & Save, and a resume after reset.
import assert from "node:assert/strict";
import { assemble } from "./asm6502.mjs";
import harness from "./harness.cjs";
import { buildSparseFat32 } from "./ultima5/fat32.mjs";
import { bootDos, fileTable, readFile, buildLoader, patchMbs, buildTree, CLOCK_RATIO } from "./port-ultima3.mjs";

const hex = (n, w = 4) => n.toString(16).toUpperCase().padStart(w, "0");

// ---------------------------------------------------------------------------
// Boot-image reconstruction, file table and top-down file reads.

function synthSide1() {
  const img = new Uint8Array(143360);
  const sec = (t, s) => img.subarray((t * 16 + s) * 256, (t * 16 + s) * 256 + 256);
  const b1 = sec(0, 1);
  b1.set([0xa9, 28, 0x8d, 0xec, 0xb7, 0xa9, 13, 0x8d], 0x14);
  b1.set([0x4c, 0x00, 0x8f], 0x47);
  b1[0xe0] = 0xb6 - 0x29 + 1; b1[0xe7] = 0xb7;   // pages $B6 down to $29 from T28 S13 down
  const page = (p) => { const n = 28 * 16 + 13 - (0xb6 - p); return sec(n >> 4, n & 15); };
  page(0xb4)[0x13] = 2; page(0xb4)[0x14] = 0x80; page(0xb4)[0x15] = 0xaf;
  const entry = (i, name, side, t, s, lo, top, part, pages) => {
    const e = page(0xaf).subarray(0x80 + i * 12);
    const n = name.padStart(4, " ");
    for (let k = 0; k < 4; k++) e[k] = n.charCodeAt(3 - k) | 0x80;
    e.set([0xb0 | side, t, s, lo, top, part, pages], 4);
  };
  entry(0, "ABC", 2, 5, 1, 0x00, 0x42, 0x30, 2);  // $4000-$422F: partial at T5 S1, pages T5 S0, T4 S15
  entry(1, "PRT", 2, 3, 5, 0xe0, 0x00, 0x10, 0);  // $00E0-$00EF
  sec(0, 2)[0] = 0x5a;                              // $B800
  page(0x29)[7] = 0x77;                             // moved to $B707 by the $8F00 entry
  return img;
}
{
  const mem = bootDos(synthSide1());
  assert.ok(mem, "synthetic side 1 is recognised");
  assert.equal(mem[0xb800], 0x5a, "track 0 sectors 2-9 sit at $B800");
  assert.equal(mem[0xb707], 0x77, "page $29 of the image is moved to $B700");
  assert.equal(bootDos(new Uint8Array(143360)), null, "a blank image is not side 1");
  const t = fileTable(mem);
  assert.deepEqual(t.map((e) => [e.name, e.side, e.start, e.length]), [["ABC", 2, 0x4000, 0x230], ["PRT", 2, 0xe0, 16]]);
  const side2 = new Uint8Array(143360);
  side2.fill(1, (5 * 16 + 1) * 256, (5 * 16 + 2) * 256);   // T5 S1 -> partial top page
  side2.fill(2, (5 * 16 + 0) * 256, (5 * 16 + 1) * 256);   // T5 S0 -> $4100
  side2.fill(3, (4 * 16 + 15) * 256, (4 * 16 + 16) * 256); // T4 S15 -> $4000
  const abc = readFile(side2, t[0]);
  assert.deepEqual([abc[0], abc[0xff], abc[0x100], abc[0x200], abc[0x22f]], [3, 3, 2, 1, 1]);
  assert.throws(() => patchMbs(new Uint8Array(0x1550)), /unexpected music timer/);
  console.log("PASS boot image, file table, top-down reads, guarded MBS patch");
}

// ---------------------------------------------------------------------------
// RWTS shim on the ROM DOS, driven the way the game's DOS drives it.

const RES = 0x0300;
const driverSrc = `
        .org $B44A
RES = $${hex(RES)}
IOB = $B750
        ; the loader's first COUT lands here: run the checks instead
        ldx #$FF
        txs
        cli
        ldx #$0F                ; ROM FAT32 zero page holds game data
zfill:  txa
        eor #$A5
        sta $B0,x
        dex
        bpl zfill
        lda #$EE                ; byte just past DATA
        sta $322C
        lda #<$AF80             ; 1: load DATA ($3000, partial top page)
        sta $48
        lda #>$AF80
        sta $49
        lda #1
        sta $B75C
        jsr rw
        php
        pla
        sta RES+0
        lda $48
        sta RES+1
        lda $49
        sta RES+2
        lda $322C
        sta RES+3
        ldx #$0F
        ldy #0
zchk:   txa
        eor #$A5
        cmp $B0,x
        beq zok
        iny
zok:    dex
        bpl zchk
        sty RES+4
        jsr rw                  ; 2: a later sector of the same command
        php
        pla
        sta RES+5
        lda #<$AF8C             ; 3: load ZP into $E0-$EF
        sta $48
        lda #>$AF8C
        sta $49
        lda #$11
        sta $DF
        sta $F0
        jsr rw
        lda $DF
        sta RES+6
        lda $F0
        sta RES+7
        ldx #$0F
ccopy:  lda $E0,x
        sta RES+$10,x
        dex
        bpl ccopy
        ldx #$7F                ; 4: write SAVE, wipe, read it back
wfill:  txa
        eor #$3C
        sta $3800,x
        dex
        bpl wfill
        lda #<$AF98
        sta $48
        lda #>$AF98
        sta $49
        lda #2
        sta $B75C
        jsr rw
        ldx #$7F
        lda #0
wclr:   sta $3800,x
        dex
        bpl wclr
        lda #<$AF98
        sta $48
        lda #>$AF98
        sta $49
        lda #1
        sta $B75C
        jsr rw
        ldx #$7F
        ldy #0
wchk:   txa
        eor #$3C
        cmp $3800,x
        beq wok
        iny
wok:    dex
        bpl wchk
        sty RES+8
        lda #$AA
        sta RES+$20
done:   jmp done

rw:     sec                     ; the DOS calls RWTS with the IOB in A/Y
        lda #>IOB
        ldy #<IOB
        jmp $BD00
`;

function synthDosMem() {
  const mem = new Uint8Array(0x10000);
  mem.set([0x84, 0x48, 0x85, 0x49], 0xbd00);     // DOS 3.3 RWTS entry
  const entry = (at, name, lo, top, part, pages) => {
    const n = name.padStart(4, " ");
    for (let k = 0; k < 4; k++) mem[at + k] = n.charCodeAt(3 - k) | 0x80;
    mem.set([0xb1, 0, 0, lo, top, part, pages], at + 4);
  };
  entry(0xaf80, "DATA", 0x00, 0x32, 0x2c, 2);    // $3000-$322B
  entry(0xaf8c, "ZP", 0xe0, 0x00, 0x10, 0);      // $00E0-$00EF
  entry(0xaf98, "SAVE", 0x00, 0x38, 0x80, 0);    // $3800-$387F
  mem.set(assemble(driverSrc).bytes, 0xb44a);
  return mem;
}

async function bootU3(tree) {
  const s = await harness.boot({ sd: buildSparseFat32({ U3: tree }) });
  const vm = s.vm;
  for (const line of ["CD U3\r", "BRUN U3.PRG 0800\r"]) {
    for (const ch of line) {
      vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0));
      for (let i = 0; i < 8; i++) vm.run(20000);
    }
    for (let i = 0; i < 40; i++) vm.run(50000);
  }
  return vm;
}

{
  const { prg } = buildLoader(synthDosMem());
  assert.equal(prg.length, 0x0200 + 0x1100, "loader + $AF00-$BFFF image");
  assert.deepEqual(Array.from(prg.subarray(0x200 + 0xbd00 - 0xaf00, 0x200 + 0xbd00 - 0xaf00 + 1)), [0x4c], "RWTS entry is a JMP");
  const data = Uint8Array.from({ length: 0x22c }, (_, i) => (i * 7 + 3) & 255);
  const zp = Uint8Array.from({ length: 16 }, (_, i) => 0x40 + i);
  const vm = await bootU3({ "U3.PRG": prg, DATA: data, ZP: zp, SAVE: new Uint8Array(0x80) });
  for (let i = 0; i < 600 && vm.peek(RES + 0x20) !== 0xaa; i++) vm.run(50000);
  const r = (n) => vm.peek(RES + n);
  const serial = vm.drainOutput();
  assert.equal(r(0x20), 0xaa, `driver finished (serial: ${JSON.stringify(serial.slice(-300))})`);
  assert.equal(r(0) & 1, 0, "RWTS returns carry clear");
  assert.equal(r(0) & 4, 0, "interrupt flag restored");
  assert.deepEqual([r(1), r(2)], [0x50, 0xb7], "$48/$49 point at the IOB afterwards, as RWTS leaves them");
  for (let i = 0; i < data.length; i++) assert.equal(vm.peek(0x3000 + i), data[i]);
  assert.equal(r(3), 0xee, "load stops exactly at the file's end");
  assert.equal(r(4), 0, "$B0-$BF survive the ROM command");
  assert.equal(r(5) & 1, 0, "later sector calls succeed");
  assert.deepEqual([r(6), r(7)], [0x11, 0x11], "zero-page load touches only its range");
  for (let i = 0; i < 16; i++) assert.equal(r(0x10 + i), zp[i], "zero-page file loaded");
  assert.equal(r(8), 0, "written file reads back identically");
  assert.equal(vm.peek(0x03f1), 0xb7, "BRK vector points into the DOS");
  assert.equal(serial.match(/FLOAD DATA/g).length, 1, "one ROM command per file, not per sector");
  assert.match(serial, /FLOAD DATA 3000 0000 022B\r/);
  assert.match(serial, /FLOAD ZP 00E0 0000 000F\r/);
  assert.match(serial, /OWRITE SAVE 3800 0080\r/);
  assert.match(serial, /FLOAD SAVE 3800 0000 007F\r/);
  console.log("PASS RWTS shim on ROM DOS: whole-file loads, zero page, write/read-back, IOB and flags");
}

// ---------------------------------------------------------------------------
// Optional: the real game.

if (process.env.U3_DISKS) {
  const tree = buildTree(process.env.U3_DISKS);
  assert.equal(Object.keys(tree).length, 97);
  const mbs = tree.MBS;
  assert.equal(mbs[0x5a] | (mbs[0x60] << 8), Math.round(0x411c * CLOCK_RATIO) - 2, "music timer rescaled");
  const vm = await bootU3(tree);
  const run = (n) => { for (let i = 0; i < n; i++) vm.run(50000); };
  const key = (c, n = 30) => { vm.keyDown(typeof c === "number" ? c : c.charCodeAt(0)); run(n); };
  const keys = (s, n = 30) => { for (const c of s) key(c === "\r" ? 13 : c, n); };
  run(40);
  key("2"); key("4");                       // Mockingboard: Sound II in slot 4
  // Music IRQ cadence on 3RIC time: the Apple's ~61.4 Hz.
  vm.addBreakpoint(0x9abc);
  let irqs = 0, cyc = 0;
  while (cyc < 1573437) {
    cyc += vm.runCycles(2000);
    if (vm.breakpointHit()) { irqs++; vm.removeBreakpoint(0x9abc); cyc += vm.step(); vm.addBreakpoint(0x9abc); }
  }
  vm.removeBreakpoint(0x9abc);
  assert.ok(irqs >= 59 && irqs <= 63, `music IRQs per second: ${irqs}`);
  run(200);
  for (let i = 0; i < 2000 && !(vm.pc() >= 0x10f6 && vm.pc() <= 0x10fb); i++) vm.run(20000);
  assert.ok(vm.pc() >= 0x10f6 && vm.pc() <= 0x10fb, "title waits at INSERT GAME DISK");
  key("1"); run(200);                       // which drive: 1
  key(" ", 60); keys("OC", 60);             // menu: Organize, Create
  keys("01\r", 30); keys("IOLO", 20); key(13, 40); keys("MHF");
  keys("25\r15\r05\r05\r", 20); key("Y", 80);
  keys("F", 60); keys("01\r0\r", 40); keys("MJ", 60); run(240);
  let serial = vm.drainOutput();
  assert.match(serial, /OWRITE ROST 9500 0500\r/, "character saved to the roster");
  assert.match(serial, /FLOAD ULT3 5000 0000 43FF\r[^]*FLOAD SOSA 1000 0000 0FFF\r/);
  assert.ok(!vm.textMode(), "in the world");
  const start = [vm.peek(0), vm.peek(1)];
  key(13); key(0x15); key(13); key("E", 300); // into Lord British's castle
  serial = vm.drainOutput();
  assert.match(serial, /FLOAD MAPA 1000 0000 0FFF\r/, "castle map loaded");
  for (let i = 0; i < 14; i++) key("/", 25);   // walk out
  run(100);
  serial = vm.drainOutput();
  assert.match(serial, /FLOAD SOSA 1000 0000 0FFF\r/, "back to the world");
  vm.poke(0, 46); vm.poke(1, 8); key(13, 40);  // step onto a dungeon
  key("E", 300);
  serial = vm.drainOutput();
  assert.match(serial, /FLOAD DDRW 1800 0000 06FF\r/, "dungeon drawing data loaded");
  key("/", 40);
  const pos = [vm.peek(0), vm.peek(1)];
  vm.reset(); run(25); vm.drainOutput();       // reset without quitting: nothing new saved
  for (const line of ["CD U3\r", "BRUN U3.PRG 0800\r"]) {
    for (const ch of line) { vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0)); for (let i = 0; i < 8; i++) vm.run(20000); }
    run(40);
  }
  run(40); key("2"); key("4");
  for (let i = 0; i < 4000 && !(vm.pc() >= 0x10f6 && vm.pc() <= 0x10fb); i++) vm.run(20000);
  key("1"); run(200);
  key(" ", 60); key("J", 60); run(240);
  assert.ok(!vm.textMode(), "resumed into the game");
  assert.ok(vm.peek(0xe1) === 1, "saved party of one restored");
  console.log(`PASS original disks: set-up, creation, world ${start}, castle, dungeon, autosave resume (left at ${pos})`);
} else {
  console.log("SKIP real-disk play (set U3_DISKS to the folder with the two images)");
}
