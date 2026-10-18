// Run after web/build.ps1: node codegen/tools/port-loderunner.test.mjs
//
// Proves the Lode Runner SD-card glue - converter, loader and the resident
// (SD shim over the ROM DOS, Apple II pacing and speaker timing, SNES pads,
// Mockingboard level-clear tally) - on the real ROM DOS and SPI SD emulation,
// using synthetic level files and a synthetic game image (no copyrighted game
// data). Set LR_DISK to the original Apple II disk image (.dsk or .dsk.gz) to
// also play the real game: high scores, disk swap, the board editor (edit,
// save, play, move from the master, initialize), a level clear and the pads.
// Add LR_TIMING=1 to compare the attract-mode demo's length with the
// unpatched game (takes several minutes).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { assemble } from "./asm6502.mjs";
import harness from "./harness.cjs";
import { buildSparseFat32 } from "./ultima5/fat32.mjs";
import * as P from "./port-loderunner.mjs";

const HZ = 1573437.5;
const glue = P.buildGlue();
const S = glue.resident.symbols;

// ---------------------------------------------------------------------------
// Converter pieces on synthetic bytes.

/** A synthetic DOS 3.3 disk with a LODE RUNNER binary file. */
function synthDisk(file, levels = null) {
  const dsk = new Uint8Array(P.DSK_BYTES);
  const sec = (t, s) => dsk.subarray((t * 16 + s) * 256, (t * 16 + s + 1) * 256);
  sec(17, 0).set([0, 17, 15]);
  const cat = sec(17, 15);
  const e = 11;
  cat[e] = 18; cat[e + 1] = 15; cat[e + 2] = 0x84;
  cat.set(Buffer.from(P.FILE_NAME.padEnd(30, " "), "latin1").map((c) => c | 0x80), e + 3);
  const body = new Uint8Array(4 + file.length);
  body.set([0x00, 0x08, 0x00, 0x81]); body.set(file, 4);
  const sectors = Math.ceil(body.length / 256);
  for (let i = 0, t = 19, s = 0; i < sectors; i++) {
    const ts = sec(18, 15 - Math.floor(i / 122));       // 122 entries per T/S list
    if (i % 122 === 0 && i) { const prev = sec(18, 16 - Math.floor(i / 122)); prev[1] = 18; prev[2] = 15 - Math.floor(i / 122); }
    ts[12 + 2 * (i % 122)] = t; ts[13 + 2 * (i % 122)] = s;
    sec(t, s).set(body.subarray(i * 256, i * 256 + 256));
    if (++s === 16) { s = 0; t++; }
  }
  if (levels) for (let loc = 0; loc < 160; loc++) sec(3 + (loc >> 4), loc & 15).set(levels[loc]);
  return dsk;
}

{
  const file = Uint8Array.from({ length: P.FILE_LEN }, (_, i) => (i * 31 + 7) & 255);
  const dsk = synthDisk(file);
  assert.deepEqual(P.readGameFile(dsk), file, "the catalog's LODE RUNNER file, header removed");
  assert.deepEqual(P.readDisk(zlib.gzipSync(dsk)), dsk, "gzipped images are accepted");
  assert.throws(() => P.readDisk(new Uint8Array(1000)), /140 KB/);
  assert.throws(() => P.readGameFile(new Uint8Array(P.DSK_BYTES)), /no "LODE RUNNER"/);
  assert.throws(() => P.buildTree(dsk), /not the release/);
  const mem = P.toRuntime(file);
  assert.equal(mem[0x1fff], file[0x1fff]);
  assert.equal(mem[0x5f00], file[0x2000], "file $2000 is runtime $5F00");
  assert.equal(mem[0xbfff], file[0x80ff]);
  assert.deepEqual(P.toFile(mem), file, "runtime <-> file round trip");
  assert.equal(P.loadAddress(0x9000), 0x5900, "runtime $9000 is at $5900 once the file is loaded at $0800");
  assert.equal(P.loadAddress(0x0100), 0x0900);
  console.log("PASS DOS 3.3 file extraction and the relocation map");
}

{
  // Level files: Lnn holds sectors 2nn and 2nn+1; the high-score sector is apart.
  const area = Array.from({ length: 160 }, (_, loc) => new Uint8Array(256).fill(loc));
  const files = P.levelFiles(area);
  assert.equal(Object.keys(files).length, 80);
  assert.equal(files.L00[0], 0); assert.equal(files.L00[256], 1);
  assert.equal(files.L4A[0], 148); assert.equal(files.L4A[511], 149);
  assert.equal(files.L4F[0], 158); assert.equal(files.L4F[256], 0, "T12 S15 is HISCORE, not a level");
  const h = P.dataHiscore();
  assert.deepEqual(Array.from(h.subarray(244, 255)), Array.from(P.MARKER));
  assert.equal(h[255], 0, "a data disk");
  assert.throws(() => P.checkMasterHiscore(h), /master high-score/);
  const m = Uint8Array.from(h); m[255] = 0xff;
  P.checkMasterHiscore(m);
  m[90] = 1;
  assert.throws(() => P.checkMasterHiscore(m), /80-99/);
  console.log("PASS level files, data-disk and master high-score sectors");
}

{
  // Guarded patches land on the exact original bytes, the resident is placed.
  const mem = new Uint8Array(0x10000);
  for (const [at, orig] of P.PATCHES) mem.set(orig, at);
  mem.set([0xa5, 0x95, 0xc9, 0xcb, 0xf0, 0x0a], 0x6199);
  const out = P.patchRuntime(mem, glue);
  const jsr = (a) => [0x20, a & 255, a >> 8], jmp = (a) => [0x4c, a & 255, a >> 8];
  const at = (a, n) => Array.from(out.subarray(a, a + n));
  assert.deepEqual(at(0xb7b5, 3), jmp(S.SHIM), "RWTS entry -> shim");
  assert.deepEqual(at(0x87ba, 3), jmp(S.PLAY_NOTE));
  assert.deepEqual(at(0x612f, 9), [...jsr(S.MB_TALLY), 0xea, 0xea, 0xea, 0xea, 0xea, 0xea], "tally replaces 3 notes");
  assert.deepEqual(at(0x619f, 8), [...jsr(S.PAD_BTN), 0x30, 0x5d, ...jmp(0x61a9)], "title: $619B (CHECK_FOR_BUTTON_DOWN) untouched");
  assert.deepEqual(at(0x6199, 6), [0xa5, 0x95, 0xc9, 0xcb, 0xf0, 0x0a]);
  assert.deepEqual(at(0x8811, 4), [...jmp(S.PS_HOOK), 0xea]);
  for (const [a, b] of glue.resident.parts) assert.deepEqual(Array.from(out.subarray(a, a + b.length)), Array.from(b));
  assert.ok(S.RESIDENT_END <= 0x9b00, "resident leaves the attract-mode moves at $9B00 alone");
  assert.ok(S.VARS >= 0xbd00 && S.VARS + 101 <= P.RESIDENT2, "variables between the buffers and part 2");
  assert.ok(S.ZSAVE >= 0xb800 && S.HSBUF + 0x200 <= S.VARS, "buffers clear of the IOB at $B7E8");
  const bad = Uint8Array.from(mem); bad[0x876d] = 0;
  assert.throws(() => P.patchRuntime(bad, glue), /CHECK_JOYSTICK.*different release/);
  assert.ok(glue.stage2.bytes.length <= 0x200 && glue.loader.bytes.length < 0x800);
  console.log("PASS guarded patches and the resident layout");
}

{
  // The output folder: never overwritten; --update replaces only the program files.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lr-"));
  try {
    const tree = { "LR.PRG": Uint8Array.of(1), "GAME.BIN": Uint8Array.of(2), MASTER: { HISCORE: Uint8Array.of(3) }, DATA: { HISCORE: Uint8Array.of(4), L00: Uint8Array.of(5) } };
    const out = P.writeOutput(root, tree);
    assert.equal(fs.readFileSync(path.join(out, "DATA", "L00"))[0], 5);
    fs.writeFileSync(path.join(out, "DATA", "HISCORE"), Uint8Array.of(44));       // the player's
    fs.writeFileSync(path.join(out, "DATA", "L00"), Uint8Array.of(55));
    const newer = { ...tree, "LR.PRG": Uint8Array.of(11), "GAME.BIN": Uint8Array.of(22) };
    assert.throws(() => P.writeOutput(root, newer), /exists/);
    assert.equal(fs.readFileSync(path.join(out, "LR.PRG"))[0], 1, "refused: nothing written");
    P.writeOutput(root, newer, true);
    assert.deepEqual([fs.readFileSync(path.join(out, "LR.PRG"))[0], fs.readFileSync(path.join(out, "GAME.BIN"))[0]], [11, 22]);
    assert.deepEqual([fs.readFileSync(path.join(out, "DATA", "HISCORE"))[0], fs.readFileSync(path.join(out, "DATA", "L00"))[0],
      fs.readFileSync(path.join(out, "MASTER", "HISCORE"))[0]], [44, 55, 3], "--update keeps scores and levels");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("PASS output folder: refused when present, --update keeps scores and levels");
}

// ---------------------------------------------------------------------------
// The real resident on the ROM DOS, with synthetic level files.

const masterByte = (loc, i) => (loc * 7 + i * 3 + 1) & 255;
const dataByte = (loc, i) => ((loc * 11 + i) ^ 0x5a) & 255;
function synthFolder(fn, hiscore, drop = []) {
  const area = Array.from({ length: 160 }, (_, loc) => Uint8Array.from({ length: 256 }, (_, i) => fn(loc, i)));
  const tree = { HISCORE: hiscore, ...P.levelFiles(area) };
  for (const d of drop) delete tree[d];
  return tree;
}
const masterHs = Uint8Array.from({ length: 256 }, (_, i) => (i < 80 ? (i * 5) & 255 : 0));
masterHs.set(P.MARKER, 244); masterHs[255] = 0xff;

const s = await harness.boot({ sd: buildSparseFat32({ LODERUN: {
  MASTER: synthFolder(masterByte, masterHs),
  DATA: synthFolder(dataByte, P.dataHiscore(), ["L4F"]),
} }) });
const vm = s.vm;
let serial = "";
const runC = (n) => { let c = 0; while (c < n) { const r = vm.runCycles(Math.min(20000, n - c)); if (!r) break; c += r; } serial += vm.drainOutput(); return c; };
for (const line of ["CD LODERUN\r", "CD MASTER\r"]) {
  for (const ch of line) { vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0)); runC(40000); }
  for (let i = 0; i < 100 && !serial.endsWith(">"); i++) runC(50000);
}
assert.equal((serial.match(/OK\r/g) || []).length, 2, `both folders entered (${JSON.stringify(serial)})`);
for (const [a, b] of glue.resident.parts) vm.loadData(a, b);
// Stubs for the game routines the resident reaches in these tests.
vm.loadData(0x8098, [0x60]);                         // DONT_MANIPULATE_MASTER_DISK
vm.loadData(0x7bb2, [0x4c, 0xb2, 0x7b]);             // START_LEVEL_EDITOR: stop here
vm.loadData(0x6a76, [0x4c, 0x76, 0x6a]);             // ESC_HANDLER: stop here
vm.loadData(0x6a0b, [0xc9, 0xca, 0xcb, 0xcc, 0xcf, 0xd5, 0xa0]);
vm.loadData(0x63a8, P.MARKER);                       // HI_SCORE_DATA_MARKER
const DONE = 0x0340;
function call(addr, { a = 0, x = 0, y = 0, max = 30 * HZ } = {}) {
  const prog = assemble(`.org $0300\n lda #${a}\n ldx #${x}\n ldy #${y}\n jsr $${addr.toString(16)}\n php\n sta $02F0\n stx $02F1\n sty $02F2\n pla\n sta $02F3\n jmp $${DONE.toString(16)}\n .org $${DONE.toString(16)}\nhere: jmp here\n`);
  vm.loadData(0x0300, prog.bytes);
  vm.setPC(0x0300);
  let c = 0;
  while (vm.pc() !== DONE && vm.pc() !== 0x7bb2 && vm.pc() !== 0x6a76 && c < max) c += vm.step();
  serial += vm.drainOutput();
  return { a: vm.peek(0x2f0), x: vm.peek(0x2f1), y: vm.peek(0x2f2), p: vm.peek(0x2f3), pc: vm.pc(), cycles: c };
}
const runFast = (addr, opts = {}) => {             // the same, with runCycles (no per-step cost)
  const prog = assemble(`.org $0300\n jsr $${addr.toString(16)}\n php\n pla\n sta $02F3\n jmp $${DONE.toString(16)}\n .org $${DONE.toString(16)}\nhere: jmp here\n`);
  vm.loadData(0x0300, prog.bytes); vm.setPC(0x0300);
  let c = 0; while (vm.pc() !== DONE && c < (opts.max || 60 * HZ)) c += vm.runCycles(2000);
  serial += vm.drainOutput();
  return { p: vm.peek(0x2f3), cycles: c };
};
{
  const init = assemble(`.org $0200\n sei\n bit $C007\n stz $CAFE\n lda $CE09\n pha\n jsr $03EA\n lda $36\n sta $${S.ROMCSW.toString(16)}\n lda $37\n sta $${(S.ROMCSW + 1).toString(16)}\n pla\n sta $CE09\n jsr $FE93\n jsr $FE89\n jsr $${S.LR_INIT.toString(16)}\n jmp $${DONE.toString(16)}\n .org $${DONE.toString(16)}\nhere: jmp here\n`);
  vm.loadData(0x0200, init.bytes); vm.setPC(0x0200);
  let c = 0; while (vm.pc() !== DONE && c < HZ) c += vm.runCycles(1000);
  assert.equal(vm.pc(), DONE, "lr_init returns");
  assert.equal(vm.peek(0x03fe) | (vm.peek(0x03ff) << 8), S.IRQ_RET, "IRQ vector made harmless");
  assert.equal(vm.readBus(0xc40e) & 0x7f, 0, "no Mockingboard interrupts enabled");
}

const iob = (track, sector, buf, cmd) => {
  vm.poke(0xb7ec, track); vm.poke(0xb7ed, sector); vm.poke(0xb7f0, buf & 255); vm.poke(0xb7f1, buf >> 8); vm.poke(0xb7f4, cmd);
};
const peekN = (a, n) => Array.from({ length: n }, (_, i) => vm.peek(a + i));
const carry = (r) => r.p & 1;
function shim(track, sector, buf, cmd) {
  iob(track, sector, buf, cmd);
  serial = "";
  return call(S.SHIM);
}
const loc = (t, s_) => (t - 3) * 16 + s_;

{
  for (let i = 0; i < 256; i++) vm.poke(i, (i * 13 + 5) & 255);
  const zp = peekN(0, 256);
  let r = shim(3, 5, 0x0d00, 1);
  assert.equal(carry(r), 0, "read succeeds");
  assert.match(serial, /FLOAD L02 0D00 0100 01FF\r/, "sector 5 is the second half of L02");
  assert.deepEqual(peekN(0x0d00, 256), Array.from({ length: 256 }, (_, i) => masterByte(5, i)));
  assert.deepEqual(peekN(0, 256), zp, "zero page is preserved across the ROM DOS command");
  r = shim(12, 14, 0x0d00, 1);
  assert.match(serial, /FLOAD L4F 0D00 0000 00FF\r/);
  assert.deepEqual(peekN(0x0d00, 4), [0, 1, 2, 3].map((i) => masterByte(158, i)));
  r = shim(12, 15, 0x1f00, 1);
  assert.match(serial, /FLOAD HISCORE 1F00 0000 00FF\r/);
  assert.deepEqual(peekN(0x1f00, 256), Array.from(masterHs));
  vm.loadData(0x0d00, new Uint8Array(256).fill(0xee));
  r = shim(3, 0, 0x0d00, 2);
  assert.equal(carry(r), 0);
  assert.doesNotMatch(serial, /OWRITE/, "the master's levels are never written");
  for (const [t, sc] of [[0, 0], [17, 0], [17, 15]]) {
    vm.loadData(0x0d00, new Uint8Array(256).fill(0x77));
    r = shim(t, sc, 0x0d00, 1);
    assert.equal(carry(r), 0); assert.equal(serial, "", `T${t} S${sc} is not on the card`);
    assert.deepEqual(peekN(0x0d00, 256), new Array(256).fill(0), "and reads as zeros");
    r = shim(t, sc, 0x0d00, 2);
    assert.equal(carry(r), 0); assert.equal(serial, "");
  }
  r = shim(3, 0, 0x0d00, 4);
  assert.equal(r.pc, 0x7bb2, "formatting the master: refused, back to the editor");
  console.log("PASS master disk: level and high-score reads, zero page kept, writes and format refused");
}

{
  serial = "";
  call(S.DISK_SWAP);
  assert.match(serial, /CD \.\.\rOK\rCD DATA\r/);
  assert.equal(vm.peek(S.DISK), 1);
  let r = shim(12, 15, 0x1f00, 1);
  assert.deepEqual(peekN(0x1f00 + 244, 12), [...P.MARKER, 0], "the data disk's high-score sector");
  vm.loadData(0x0d00, Uint8Array.from({ length: 256 }, (_, i) => i ^ 0xa5));
  r = shim(3, 7, 0x0d00, 2);
  assert.equal(carry(r), 0);
  assert.match(serial, /FLOAD L03 B900 0000 01FF\rOWRITE L03 B900 01FF\r/, "read-modify-write of one 512-byte file");
  assert.doesNotMatch(serial, /HISCORE/, "no erased level: the map is not rewritten");
  r = shim(3, 7, 0x0e00, 1);
  assert.deepEqual(peekN(0x0e00, 256), Array.from({ length: 256 }, (_, i) => i ^ 0xa5), "level 7 reads back");
  r = shim(3, 6, 0x0e00, 1);
  assert.deepEqual(peekN(0x0e00, 256), Array.from({ length: 256 }, (_, i) => dataByte(6, i)), "its partner is untouched");

  // the folder lacks L4F: reads and writes fail cleanly
  r = shim(12, 14, 0x0e00, 1);
  assert.equal(carry(r), 1, "a missing file is an error");
  r = shim(12, 14, 0x0d00, 2);
  assert.equal(carry(r), 1);
  assert.doesNotMatch(serial, /OWRITE/, "and OWRITE never sees a missing file");
  r = shim(3, 0, 0x0d00, 4);
  assert.equal(carry(r), 0);
  assert.match(serial, /OWRITE HISCORE BB00 00FF\r/, "format: one high-score write");
  r = shim(12, 15, 0x1f00, 1);
  assert.deepEqual(peekN(0x1f00 + 80, 20), new Array(20).fill(0xff), "every level marked erased");
  assert.deepEqual(peekN(0x1f00, 80), new Array(80).fill(0), "no scores");
  assert.deepEqual(peekN(0x1f00 + 244, 12), [...P.MARKER, 0], "still a data disk");
  vm.loadData(0x0e00, new Uint8Array(256).fill(0x33));
  r = shim(3, 7, 0x0e00, 1);
  assert.equal(serial, "", "an erased level costs no card access");
  assert.deepEqual(peekN(0x0e00, 256), new Array(256).fill(0));
  vm.loadData(0x0d00, Uint8Array.from({ length: 256 }, (_, i) => (i * 3) & 255));
  r = shim(3, 6, 0x0d00, 2);
  assert.match(serial, /OWRITE L03 B900 01FF\r.*OWRITE HISCORE BB00 00FF\r/s, "a write clears its bit in the map");
  r = shim(3, 6, 0x0e00, 1);
  assert.deepEqual(peekN(0x0e00, 256), Array.from({ length: 256 }, (_, i) => (i * 3) & 255));
  r = shim(3, 7, 0x0e00, 1);
  assert.deepEqual(peekN(0x0e00, 256), new Array(256).fill(0), "the erased partner was written as zeros");
  r = shim(12, 15, 0x1f00, 1);
  assert.equal(vm.peek(0x1f00 + 80), 0xfd, "only level 6's bit cleared");
  vm.loadData(0x1f00, Uint8Array.from({ length: 256 }, (_, i) => (i < 80 ? 0x11 : 0)));
  vm.loadData(0x1f00 + 244, P.MARKER);
  r = shim(12, 15, 0x1f00, 2);
  assert.match(serial, /FLOAD HISCORE BB00 0000 0000\rOWRITE HISCORE BB00 00FF\r/, "a score write checks the file first");
  r = shim(12, 15, 0x1f00, 1);
  assert.equal(vm.peek(0x1f00), 0x11, "scores saved");
  assert.equal(vm.peek(0x1f00 + 80), 0xfd, "the erased map survives a score write");
  serial = "";
  call(S.DISK_SWAP);
  assert.match(serial, /CD \.\.\rOK\rCD MASTER\r/);
  console.log("PASS data disk: read-modify-write, lazy format map, score writes, missing files");
}

// ---------------------------------------------------------------------------
// Apple II pacing and speaker timing (VIA 2 T2 of the Mockingboard).

/** True 6502 cycles of the original PLAY_NOTE (sound on), JSR and RTS included. */
function playNoteCycles(a, x, y) {
  let c = 6 + 6, X = x, Y = y, T = x;
  for (;;) {
    c += 9;
    for (;;) {
      Y = (Y - 1) & 255; c += 2;
      if (Y) c += 3; else { c += 2 + 5; T = (T - 1) & 255; if (!T) return c + 2 + 6; c += 2; }
      X = (X - 1) & 255; c += 2;
      if (X) { c += 3; continue; }
      c += 2; break;
    }
    X = a; c += 6;
  }
}
{
  for (const loops of [10, 40]) {
    const prog = assemble(`.org $0400\n jsr $${S.PACE_MARK.toString(16)}\nstart: ldx #${loops}\nol: ldy #0\nil: dey\n bne il\n dex\n bne ol\n jsr $${S.PACE_SYNC.toString(16)}\nhere: jmp here\n`);
    vm.loadData(0x0400, prog.bytes); vm.setPC(0x0400);
    while (vm.pc() !== prog.symbols.START) vm.step();
    let total = 0, work = 0;
    while (vm.pc() !== prog.symbols.HERE) { const pc = vm.pc(); const c = vm.step(); total += c; if (pc < 0x9000) work += c; }
    const ratio = total / work;
    assert.ok(ratio > 1.53 && ratio < 1.55, `pace_sync: ${work} cycles of work take ${ratio.toFixed(4)}x (Apple II: 1.5385x)`);
  }
  vm.poke(0x99, 0xff);
  for (const [a, x, y] of [[0x64, 8, 0], [0x45, 7, 3], [0x80, 6, 1], [0x20, 8, 0x10]]) {
    call(S.PACE_MARK);
    const r = call(S.PLAY_NOTE, { a, x, y });
    const ratio = r.cycles / playNoteCycles(a, x, y);
    assert.ok(ratio > 1.52 && ratio < 1.6, `PLAY_NOTE ${a}/${x}/${y}: ${ratio.toFixed(4)}x the Apple II time`);
    assert.equal(r.y, 0, "PLAY_NOTE returns Y = 0");
    assert.equal(vm.peek(0x0b), 0, "and TMP_PTR+1 = 0, as the original");
  }
  call(S.PACE_MARK);
  const b = call(S.BEEP);
  const ideal = 192 * 656 * (HZ / (14318180 / 14));
  assert.ok(Math.abs(b.cycles / ideal - 1) < 0.02, `BEEP lasts ${(b.cycles / ideal).toFixed(4)}x the Apple II beep`);
  console.log("PASS pacing: work x1.539, PLAY_NOTE and BEEP at Apple II pitch and length");
}

// ---------------------------------------------------------------------------
// SNES pads.

const BTN = { B: 1, Y: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128, A: 256, X: 512, L: 1024, R: 2048 };
function padCommand(mask) {
  vm.setGamepadState(0, mask);
  runC(8000);                                          // past the 4 ms scan limiter
  return call(S.PAD_COMMAND);
}
{
  vm.poke(0xa7, 2); vm.poke(0x95, 0xca); vm.poke(0x9a, 1);
  const cmd = () => [vm.peek(0x9e), vm.peek(0x9f)];
  padCommand(0);
  assert.deepEqual(cmd(), [0xc0, 0xc0], "nothing held: '@' both ways");
  padCommand(BTN.LEFT); assert.deepEqual(cmd(), [0xc0, 0xca], "Left: J");
  padCommand(BTN.RIGHT); assert.deepEqual(cmd(), [0xc0, 0xcc], "Right: L");
  padCommand(BTN.UP); assert.deepEqual(cmd(), [0xc9, 0xc0], "Up: I");
  padCommand(BTN.DOWN | BTN.RIGHT); assert.deepEqual(cmd(), [0xcb, 0xcc], "Down+Right: K and L");
  for (const b of ["Y", "X", "L"]) { padCommand(BTN[b]); assert.deepEqual(cmd(), [0xd5, 0xd5], `${b}: dig left (U)`); }
  for (const b of ["B", "A", "R"]) { padCommand(BTN[b]); assert.deepEqual(cmd(), [0xcf, 0xcf], `${b}: dig right (O)`); }
  padCommand(0);
  vm.setGamepadState(1, BTN.LEFT); padCommand(0); assert.deepEqual(cmd(), [0xc0, 0xca], "controller 2 works too");
  vm.setGamepadState(1, 0); padCommand(0);
  padCommand(BTN.SELECT); assert.equal(vm.peek(0x9a), 0, "Select gives up the life");
  vm.poke(0x9a, 1);
  padCommand(BTN.SELECT); assert.equal(vm.peek(0x9a), 1, "only on a new press");
  padCommand(0);
  let r = padCommand(BTN.START); assert.equal(r.pc, 0x6a76, "Start pauses (ESC_HANDLER)");
  vm.setGamepadState(0, 0); runC(8000); call(S.PAD_COMMAND);   // released
  vm.setGamepadState(0, BTN.START); runC(8000);
  r = call(S.PAUSE_WAIT); assert.equal(r.a, 0x9b, "a new Start press resumes, as Esc");
  vm.setGamepadState(0, 0);
  vm.keyDown("Q".charCodeAt(0)); runC(20000);
  r = call(S.PAUSE_WAIT); assert.equal(r.a, 0xd1, "a key ends the wait too");
  assert.equal(vm.peek(0xc000) & 0x80, 0, "and is taken");

  vm.poke(0x95, 0xcb);
  vm.setGamepadState(0, BTN.A); runC(8000);
  r = call(S.PAD_BTN);
  assert.ok(r.p & 0x80, "pad_btn: N = 1 for a button"); assert.equal(vm.peek(0x95), 0xca, "pad input selects joystick mode");
  vm.setGamepadState(0, BTN.UP); runC(8000);
  r = call(S.PAD_BTN); assert.equal(r.p & 0x80, 0, "the D-pad is not a button");
  vm.poke(0x95, 0xcb); vm.poke(0xa7, 5);
  vm.setGamepadState(0, BTN.B); runC(8000); call(S.PAD_POLL);
  assert.equal(vm.peek(0x95), 0xcb, "but not in the board editor");
  vm.poke(0xa7, 2); vm.setGamepadState(0, 0); runC(8000); call(S.PAD_POLL);
  vm.poke(0x95, 0xca); vm.poke(0x1e, "j".charCodeAt(0) | 0x80);
  call(S.KEY_HOOK);
  assert.deepEqual([vm.peek(0x95), vm.peek(0x9e), vm.peek(0x9f)], [0xcb, 0xca, 0xca], "a game key (lower case folded) selects keyboard mode");
  vm.poke(0x95, 0xca); vm.poke(0x1e, 0xc1);
  vm.setGamepadState(0, BTN.LEFT); runC(8000);
  call(S.KEY_HOOK);
  assert.deepEqual([vm.peek(0x95), vm.peek(0x9f)], [0xca, 0xca], "another key in joystick mode reads the pads");
  vm.setGamepadState(0, 0); runC(8000);
  vm.poke(0x95, 0xcb);
  const d1 = call(S.PAD_CHECK_DELAY);
  assert.equal(d1.p & 1, 0, "keyboard mode: CHECK_JOYSTICK_OR_DELAY delays, C = 0");
  vm.poke(0x95, 0xca); vm.setGamepadState(0, BTN.RIGHT); runC(8000);
  const d2 = call(S.PAD_CHECK_DELAY);
  assert.equal(d2.p & 1, 1, "joystick mode: pad input, C = 1");
  vm.setGamepadState(0, 0); runC(8000);
  console.log("PASS SNES pads: moves, digs, Start/Select, both controllers, mode selection");
}

// ---------------------------------------------------------------------------
// Level-clear tally on the Mockingboard.

{
  vm.poke(0x99, 0xff);
  vm.enableAudio(48000); vm.drainAudio();
  const onSamples = [], gaps = [];
  let total = 0;
  for (let n = 15; n >= 1; n--) {
    vm.poke(0x5c, n);
    const r = runFast(S.MB_TALLY);
    total += r.cycles;
    const pcm = vm.drainAudio();
    onSamples.push(pcm);
  }
  const frames = total / (HZ / 59.9227);
  assert.ok(Math.abs(frames / 60 - 1) < 0.01, `15 tones over ${frames.toFixed(1)} Atari frames (60)`);
  const freq = (pcm, ch) => {                          // over the tone wherever it lies
    const frames = pcm.length / 2;
    let peak = 0;
    for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(pcm[2 * i + ch]));
    let low = false;
    const at = [];
    for (let i = 0; i < frames; i++) {
      const v = pcm[2 * i + ch];
      if (v < -0.4 * peak) low = true;
      else if (low && v > 0.4 * peak) { low = false; at.push(i); }
    }
    const gaps = at.slice(1).map((x, i) => x - at[i]).sort((a, b) => a - b);
    return gaps.length ? 48000 / gaps[gaps.length >> 1] : 0;   // median period
  };
  const expect = (N) => 1573437.5 / (16 * Math.round(3.0769231 * (N + 1)));
  for (const [i, N] of [[0, 150], [7, 115], [14, 80]]) {
    for (const ch of [0, 1]) {
      const f = freq(onSamples[i], ch);
      assert.ok(Math.abs(f / expect(N) - 1) < 0.06, `tone ${i + 1} on AY ${ch + 1}: ${f.toFixed(1)} Hz, POKEY AUDF ${N} is ${expect(N).toFixed(1)} Hz`);
    }
  }
  const quiet = vm.drainAudio(); runC(20000);
  assert.ok(vm.drainAudio().every((v) => Math.abs(v) < 0.02), "silent afterwards");
  vm.poke(0x99, 0);
  vm.poke(0x5c, 15); runFast(S.MB_TALLY); vm.drainAudio();
  vm.poke(0x5c, 14); runFast(S.MB_TALLY);
  assert.ok(vm.drainAudio().every((v) => Math.abs(v) < 0.02), "sound off (Ctrl-S): no tones, same timing");
  vm.disableAudio();
  console.log(`PASS Mockingboard tally: 15 tones, ${(total / HZ).toFixed(3)} s, Atari pitches on both AYs`);
}

// ---------------------------------------------------------------------------
// The real loader (LR.PRG + stage 2) on the ROM DOS with a synthetic GAME.BIN.

{
  const sum16 = (b) => b.reduce((a, x) => (a + x) & 0xffff, 0);
  const game = Uint8Array.from({ length: P.FILE_LEN }, (_, i) => (i * 7 + 3) & 255);
  game[0] = 0x4c;
  game.set([0x4c, 0x00, 0x28], 0x2000);              // loaded at $2800: JMP $2800 (stands in for RELOCATE0)
  const hs = P.dataHiscore();
  async function brun(tree) {
    const sl = await harness.boot({ sd: buildSparseFat32({ LODERUN: tree }) });
    const v = sl.vm;
    let out = "";
    for (const line of ["CD LODERUN\r", "BRUN LR.PRG 0800\r"]) {
      for (const ch of line) { v.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0)); v.runCycles(40000); }
      for (let i = 0; i < 40; i++) v.runCycles(50000);
    }
    for (let c = 0; c < 40 * HZ && v.pc() !== 0x2800 && !/\x07\r\*/.test(out); c += 100000) { v.runCycles(100000); out += v.drainOutput(); }
    for (let i = 0; i < 10; i++) v.runCycles(50000);
    out += v.drainOutput();
    for (let r = 0; r < 24; r++)                       // and the text screen: failures print with COUT1
      out += "\n" + Array.from({ length: 40 }, (_, c) => String.fromCharCode(v.peek(0x400 + harness.TEXT_SCANLINES[r] + c) & 0x7f)).join("");
    return { v, out };
  }
  const g = P.buildGlue(sum16(game));
  const tree = { "LR.PRG": g.loader.bytes, "GAME.BIN": game, MASTER: { HISCORE: hs }, DATA: { HISCORE: hs } };
  let { v, out } = await brun(tree);
  assert.equal(v.pc(), 0x2800, `the loader enters the game's relocator (${JSON.stringify(out.slice(-200))})`);
  assert.match(out, /FLOAD GAME\.BIN 0800 0000 80FF\r.*CD DATA\r.*FLOAD HISCORE 8E00 0000 00FF\r.*CD MASTER\r.*FLOAD HISCORE/s);
  assert.equal(v.peek(0xcafe), 0, "ROM NMI nest count zeroed");
  assert.equal(v.memoryMapping(0x9000) === v.memoryMapping(0x0800), true, "BASIC overlay off: $9000 is RAM");
  const csw = P.loadAddress(g.resident.symbols.ROMCSW);
  assert.ok((v.peek(csw) | (v.peek(csw + 1) << 8)) >= 0xc000, "the resident got the ROM DOS collector");
  const bad = Uint8Array.from(game); bad[0x1234] ^= 1;
  ({ v, out } = await brun({ ...tree, "GAME.BIN": bad }));
  assert.match(out, /LR: GAME\.BIN DOES NOT MATCH LR\.PRG/, "a changed GAME.BIN is refused");
  ({ v, out } = await brun({ ...tree, DATA: { L00: new Uint8Array(512) } }));
  assert.match(out, /LR: DATA\/HISCORE NOT FOUND/);
  ({ v, out } = await brun({ ...tree, MASTER: { HISCORE: new Uint8Array(256) } }));
  assert.match(out, /LR: MASTER\/HISCORE NOT FOUND/, "a HISCORE without the marker is refused");
  const { "GAME.BIN": _, ...noGame } = tree;
  ({ v, out } = await brun(noGame));
  assert.match(out, /LR: GAME\.BIN NOT FOUND/);
  console.log("PASS loader: GAME.BIN sum, both HISCORE files, collector, overlay off, entry at $2800");
}

// ---------------------------------------------------------------------------
// The original disk (LR_DISK).

const diskPath = process.env.LR_DISK;
if (!diskPath) {
  console.log("SKIP real-disk play (set LR_DISK to the Lode Runner disk image)");
} else {
  const { tree } = P.buildTree(fs.readFileSync(diskPath));
  assert.equal(tree["GAME.BIN"].length, P.FILE_LEN);
  const g2 = harness.boot({ sd: buildSparseFat32({ LODERUN: tree }) });
  const s2 = await g2, v = s2.vm;
  let out = "";
  const pump = (sec) => { let c = 0; const n = Math.ceil(sec * HZ); while (c < n) { const r = v.runCycles(Math.min(20000, n - c)); if (!r) break; c += r; } out += v.drainOutput(); };
  const waitFor = (pred, max, what) => { for (let t = 0; t < max; t += 0.1) { pump(0.1); if (pred()) return; } assert.fail(`timed out: ${what} (serial ${JSON.stringify(out.slice(-300))})`); };
  const key = (ch, after = 0.6) => { v.keyDown(typeof ch === "number" ? ch : ch === "\r" ? 13 : ch.charCodeAt(0)); pump(after); };
  const until = (addr, max, what) => { v.addBreakpoint(addr); let c = 0; while (!v.breakpointHit() && c < max * HZ) c += v.runCycles(20000); v.removeBreakpoint(addr); out += v.drainOutput(); assert.ok(v.breakpointHit() || v.pc() === addr, `reached ${what}`); };
  for (const line of ["CD LODERUN\r", "BRUN LR.PRG 0800\r"]) { for (const ch of line) key(ch, 0.03); pump(0.3); }
  waitFor(() => v.peek(0xa7) === 1, 60, "the attract-mode demo");
  assert.match(out, /FLOAD GAME\.BIN 0800 0000 80FF\r.*CD MASTER\r/s);
  assert.equal(v.peek(S.DISK), 0);
  console.log("PASS real disk: the loader starts the game; the attract demo plays");

  out = ""; key("\r", 0); until(S.HS_LABEL, 20, "the high-score screen"); pump(0.5);
  assert.match(out, /FLOAD HISCORE 1F00 0000 00FF\r/);
  assert.equal(v.gfxPage(), 1, "high scores on page 2");
  out = ""; key(4, 0); until(S.HS_LABEL, 20, "the data disk's scores"); pump(0.5);
  assert.match(out, /CD \.\.\rOK\rCD DATA\rOK\rFLOAD HISCORE/);
  assert.equal(v.peek(0x1f00 + 3), 0, "an empty table");
  out = ""; key(4, 0); until(S.HS_LABEL, 20, "the master's scores"); pump(0.5);
  console.log("PASS real disk: Ctrl-D swaps the disk in the drive, high scores per disk");

  // Board editor on the data disk: draw a level, save, play it to a level clear.
  key(5, 0); waitFor(() => v.peek(0xa7) === 5 && out.includes("CD DATA"), 20, "the editor"); pump(1.5);
  out = ""; key("E"); key("\r", 0); waitFor(() => out.includes("FLOAD L00"), 20, "edit level 1"); pump(1.5);
  for (const ch of ["9", "K", "7", "M", "1", "J", "1"]) key(ch, 0.4);
  out = ""; key(0x13, 0); waitFor(() => out.includes("OWRITE L00"), 20, "save");
  assert.match(out, /FLOAD L00 B900 0000 01FF\rOWRITE L00 B900 01FF\r/);
  pump(1); key(0x11, 2);
  out = ""; key("P"); key("\r", 0); waitFor(() => out.includes("FLOAD L00 0D00 0000 00FF"), 20, "play level 1");
  until(S.PAD_CHECK_DELAY, 30, "the start-of-level wait"); pump(0.5);
  v.enableAudio(48000); v.drainAudio();
  key("L", 0);
  until(S.MB_TALLY, 15, "the level-clear tally");
  pump(1.2);
  const pcm = v.drainAudio(); v.disableAudio();
  let energy = 0; for (let i = 0; i < pcm.length; i += 2) energy += pcm[i] * pcm[i];
  assert.ok(energy / (pcm.length / 2) > 0.002, "the tally is heard on the Mockingboard");
  assert.equal([0x91, 0x90, 0x8f, 0x8e].map((a) => v.peek(a).toString(16).padStart(2, "0")).join(""), "00001750", "gold 250 + 1500");
  waitFor(() => out.includes("FLOAD L00 0D00 0100 01FF"), 10, "level 2 (empty on the data disk)");
  console.log("PASS real disk: editor draw/save/play on the data disk, Mockingboard level clear");

  // Game over in editor play records a high score on the data disk, then the
  // game returns to the title, as on the Apple.
  until(S.PAD_CHECK_DELAY, 30, "the start-of-level wait"); pump(0.5);
  out = ""; key(0x12, 0);                               // Ctrl-R: last life
  waitFor(() => out.includes("FLOAD HISCORE"), 20, "the high-score check"); pump(3);
  for (const ch of ["A", "B", "C"]) key(ch, 0.4);
  out = ""; key("\r", 0); waitFor(() => out.includes("OWRITE HISCORE"), 20, "the high score written");
  assert.match(out, /FLOAD HISCORE BB00 0000 0000\rOWRITE HISCORE BB00 00FF\r/);
  pump(1);
  assert.deepEqual([0, 1, 2, 3].map((i) => v.peek(0x1f00 + i)), [0xc1, 0xc2, 0xc3, 2], "ABC, level 2");
  console.log("PASS real disk: a game over records the score on the disk in the drive");

  // Back in the editor: copy master level 1 to data level 2.
  waitFor(() => v.peek(0xa7) <= 1, 60, "the title"); pump(1);
  out = ""; key(5, 0); waitFor(() => v.peek(0xa7) === 5, 20, "the editor again"); pump(1.5);
  assert.equal(v.peek(S.DISK), 1, "still the data disk");
  key(4, 0); waitFor(() => out.includes("CD MASTER"), 20, "Ctrl-D to the master"); pump(1.5);
  out = ""; key("M"); key("\r"); key("0"); key("0"); key("2"); key("\r");
  key("\r", 0); waitFor(() => out.includes("FLOAD L00 0D00 0000 00FF"), 20, "the master level read");
  pump(1); key(4, 0); waitFor(() => out.includes("CD DATA"), 20, "Ctrl-D at DESTINATION DISKETTE"); pump(1.5);
  out = ""; key("\r", 0); waitFor(() => out.includes("OWRITE L00"), 20, "the copy written");
  pump(1);
  assert.match(out, /FLOAD L00 B900 0000 01FF\rOWRITE L00 B900 01FF\r/);
  console.log("PASS real disk: Move copies a master level into the data disk");

  // Initialize the data disk: lazy erase.
  out = ""; key("I"); key("Y", 0); waitFor(() => (out.match(/OWRITE HISCORE/g) || []).length >= 2, 20, "initialize");
  pump(2);
  out = ""; key("E"); key("0"); key("0"); key("2"); key("\r", 0); waitFor(() => out.includes("FLOAD HISCORE"), 20, "edit level 2"); pump(2);
  assert.doesNotMatch(out, /FLOAD L00/, "an erased level is not read from the card");
  key(0x11, 2);
  key(0x1b, 0); waitFor(() => v.peek(0xa7) !== 5, 20, "Esc leaves the editor");
  console.log("PASS real disk: Initialize erases the data disk; Esc leaves the editor");

  // A master game started and played with the pad.
  pump(2);
  if (v.peek(S.DISK) !== 0) { out = ""; key(4, 0); waitFor(() => out.includes("CD MASTER"), 30, "back to the master"); }
  pump(3);
  v.poke(0x95, 0xcb);
  out = ""; v.setGamepadState(0, BTN.A); pump(0.3); v.setGamepadState(0, 0);
  waitFor(() => out.includes("FLOAD L00 0D00 0000 00FF"), 30, "a pad press starts a game");
  assert.equal(v.peek(0x95), 0xca, "joystick mode");
  until(S.PAD_CHECK_DELAY, 30, "the start-of-level wait"); pump(0.5);
  v.setGamepadState(0, BTN.LEFT); pump(0.3); v.setGamepadState(0, 0); pump(0.5);
  const col0 = v.peek(0x00);
  v.setGamepadState(0, BTN.LEFT); pump(1); v.setGamepadState(0, 0); pump(0.3);
  assert.ok(v.peek(0x00) < col0, `the D-pad moves the runner (column ${col0} -> ${v.peek(0x00)})`);
  console.log("PASS real disk: a pad starts a master game and moves the runner");

  if (process.env.LR_TIMING) {
    // The attract demo's first level against the unpatched game in memory.
    const file = P.readGameFile(P.readDisk(fs.readFileSync(diskPath)));
    const level1 = async (boot) => {
      const vm2 = await boot();
      let c = 0;
      vm2.addBreakpoint(0x6238); while (!vm2.breakpointHit() && c < 120 * HZ) c += vm2.runCycles(50000);
      assert.ok(vm2.breakpointHit(), "the demo's first level loads");
      vm2.step(); vm2.addBreakpoint(0x611a); c = 0;
      while (!vm2.breakpointHit() && c < 400 * HZ) c += vm2.runCycles(50000);
      assert.ok(vm2.breakpointHit(), "the demo clears its first level");
      return c;
    };
    const orig = await level1(async () => {
      const so = await harness.boot({}); so.vm.loadData(0x0800, file);
      so.vm.loadData(0x8c00, assemble(".org $8C00\n stz $CAFE\n bit $C007\n sei\n ldx #$FF\n txs\n jmp $2800\n").bytes);
      so.vm.setPC(0x8c00); return so.vm;
    });
    const port = await level1(async () => {
      const sp = await harness.boot({ sd: buildSparseFat32({ LODERUN: tree }) });
      for (const line of ["CD LODERUN\r", "BRUN LR.PRG 0800\r"]) {
        for (const ch of line) { sp.vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0)); sp.vm.runCycles(60000); }
        for (let i = 0; i < 40; i++) sp.vm.runCycles(50000);
      }
      return sp.vm;
    });
    const apple = orig / (14318180 / 14), here = port / HZ;
    assert.ok(Math.abs(here / apple - 1) < 0.01, `demo level 1: ${here.toFixed(2)} s here, ${apple.toFixed(2)} s on an Apple II`);
    console.log(`PASS timing: demo level 1 lasts ${here.toFixed(2)} s (Apple II ${apple.toFixed(2)} s)`);
  }
}
