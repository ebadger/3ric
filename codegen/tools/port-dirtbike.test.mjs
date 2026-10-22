// Run after web/build.ps1: node codegen/tools/port-dirtbike.test.mjs
//
// Proves the Dirt Bike SD-card glue (loader + resident) on the real ROM DOS
// and SPI SD emulation with synthetic files - no game bytes: loads by T/S
// list, a missing file, the hall of fame write and read-back, SNES pads,
// Apple II timing (tone pitch, WAIT, frame pacing) and the quit to the DOS.
// Set DIRTBIKE_DSK to the original disk image to also play the real game:
// title, a race, Apple II speed against an unpaced build, the menu's saved
// input setting across a re-run, a record with initials, and the quit.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import harness from "./harness.cjs";
import { buildSparseFat32 } from "./ultima5/fat32.mjs";
import {
  readCatalog, binary, applyPatches, checkSymbols, buildResident, buildPrg, waitTable, waitCycles,
  CLOCK_RATIO, convert, writeTree, gamePatches, titlePatches, RES_ORG,
} from "./port-dirtbike.mjs";

const hex = (n, w = 4) => n.toString(16).toUpperCase().padStart(w, "0");
const near = (got, want, tol, what) =>
  assert.ok(Math.abs(got / want - 1) <= tol, `${what}: ${got} vs ${want.toFixed(1)} (${((got / want - 1) * 100).toFixed(2)}%)`);

// ---------------------------------------------------------------------------
// Converter pieces.

{
  const img = new Uint8Array(143360);
  const sec = (t, s) => img.subarray((t * 16 + s) * 256, (t * 16 + s) * 256 + 256);
  sec(17, 0).set([4, 17, 15, 3]);
  const cat = sec(17, 15);
  const entry = (i, name, t, s, type) => {
    const e = cat.subarray(0x0b + i * 35);
    e.set([t, s, type]);
    for (let k = 0; k < 30; k++) e[3 + k] = (name.padEnd(30, " ").charCodeAt(k)) | 0x80;
  };
  entry(0, "FILEA", 18, 14, 0x84);          // locked B file: T/S list 18/14
  entry(1, "GONE", 0xff, 3, 0x04);          // deleted
  sec(18, 14).set([18, 13, 18, 12], 0x0c);  // data 18/13 then 18/12
  sec(18, 13).set([0x00, 0x96, 0x05, 0x01, 0xaa]);
  sec(18, 12)[0] = 0xbb;
  const files = readCatalog(img);
  assert.deepEqual(files.map((f) => [f.name, f.type, f.tsl.join("/"), f.sectors.join(" ")]), [["FILEA", 4, "18/14", "18,13 18,12"]]);
  assert.equal(files[0].raw.length, 512, "raw = the data sectors, as the game's loader reads them");
  assert.deepEqual([files[0].raw[4], files[0].raw[256]], [0xaa, 0xbb]);
  const b = binary(files[0]);
  assert.deepEqual([b.addr, b.len, b.body[0]], [0x9600, 0x105, 0xaa]);
  assert.throws(() => readCatalog(new Uint8Array(1000)), /140 KB/);

  const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(applyPatches(bytes, 0x1000, [{ at: 0x1001, before: [2, 3], after: [9] }])), [1, 9, 3, 4, 5]);
  assert.throws(() => applyPatches(bytes, 0x1000, [{ at: 0x1001, before: [3], after: [9], why: "x" }]), /unexpected bytes at \$1001/);
  assert.throws(() => checkSymbols("PAGE = $075F\n        lda PAGE\npage:   .byte 0\n"), /collides/);
  checkSymbols("PAGE = $075F\ndpage:  .byte 0\n");

  const tab = waitTable();
  for (const a of [0x28, 0x4f, 0x80, 0xff, 0]) {
    const total = waitCycles(a) + (tab[a] ? waitCycles(tab[a]) : 0) + 300;
    near(total, CLOCK_RATIO * waitCycles(a), 0.01, `WAIT(${hex(a, 2)}) + WAIT(${hex(tab[a], 2)})`);
  }

  // Patch sites never overlap, never grow, and the speed set is separable.
  const fake = new Proxy({}, { get: () => 0xb900 });
  for (const list of [gamePatches(fake), titlePatches(fake)]) {
    const spans = list.map((p) => [p.at, p.at + p.before.length]).sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1], "patch sites overlap");
    for (const p of list) assert.ok(p.after.length <= p.before.length);
  }
  assert.equal(gamePatches(fake).length - gamePatches(fake, { timing: false }).length, 8);
  assert.equal(titlePatches(fake).length - titlePatches(fake, { timing: false }).length, 1);
  console.log("PASS catalog reader, byte-verified patches, symbol-case guard, WAIT table, patch sets");
}

// ---------------------------------------------------------------------------
// Resident + loader on the ROM DOS with synthetic files.

const raw = (sectors, addr, len, seed) => {
  const r = Uint8Array.from({ length: sectors * 256 }, (_, i) => (i * 7 + seed * 31 + 3) & 255);
  r.set([addr & 255, addr >> 8, len & 255, len >> 8]);
  return r;
};
const ENTRIES = [
  { name: "TITLE", t: 22, s: 5, raw: raw(3, 0x9600, 0x2f0, 1) },
  { name: "T01", t: 23, s: 13, raw: raw(2, 0x9600, 0x1fc, 2) },
  { name: "T02", t: 24, s: 12, raw: raw(2, 0x9600, 0x1fc, 3) },      // not on the card
  { name: "DIRTHOF", t: 0xff, s: 0xff, raw: raw(2, 0xb500, 0x170, 4) },
];

async function bootCard(card) {
  const s = await harness.boot({ sd: buildSparseFat32(card) });
  const vm = s.vm;
  for (const line of ["CD DIRTBIKE\r", "BRUN DIRTBIKE.PRG 0800\r"]) {
    for (const ch of line) {
      vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0));
      for (let i = 0; i < 8; i++) vm.run(20000);
    }
    for (let i = 0; i < 40; i++) vm.run(50000);
  }
  return vm;
}

// JSR addr from a trampoline at $0300 with A/X/Y; returns registers, flags
// and the cycles from the trampoline's first instruction to its loop.
const TRAMP = 0x0300;
function call(vm, addr, { a = 0, x = 0, y = 0, budget = 60e6, pre = [] } = {}) {
  const code = [...pre, 0xa9, a, 0xa2, x, 0xa0, y, 0x20, addr & 255, addr >> 8,
    0x08, 0x8d, 0xc3, 0x03, 0x68, 0x8d, 0xc0, 0x03, 0x8e, 0xc1, 0x03, 0x8c, 0xc2, 0x03];
  const loop = TRAMP + code.length;
  code.push(0x4c, loop & 255, loop >> 8);
  vm.loadData(TRAMP, Uint8Array.from(code));
  vm.setPC(TRAMP);
  vm.addBreakpoint(loop);
  let cycles = 0;
  do cycles += vm.runCycles(budget - cycles);
  while (!vm.breakpointHit() && cycles < budget);
  vm.removeBreakpoint(loop);
  assert.ok(vm.pc() === loop, `call $${hex(addr)} returned (pc $${hex(vm.pc())})`);
  return { a: vm.peek(0x3c3), x: vm.peek(0x3c1), y: vm.peek(0x3c2), p: vm.peek(0x3c0), cycles };
}
const C = 1, N = 0x80;

{
  const resident = buildResident(ENTRIES);
  const R = resident.symbols;
  const game = new Uint8Array(0x203b);          // a stand-in "game": JMP $6000,
  game.set([0x4c, 0x00, 0x60]);                 // and RTS at $803A (pace's call)
  game[0x803a - 0x6000] = 0x60;
  const { prg } = buildPrg(game, resident);
  const card = { DIRTBIKE: { "DIRTBIKE.PRG": prg, TITLE: ENTRIES[0].raw, T01: ENTRIES[1].raw, DIRTHOF: ENTRIES[3].raw } };
  const vm = await bootCard(card);
  const peeks = (a, n) => Array.from({ length: n }, (_, i) => vm.peek(a + i));
  for (let i = 0; i < 400 && !(vm.pc() >= 0x6000 && vm.pc() <= 0x6002); i++) vm.run(50000);
  vm.drainOutput();

  assert.ok(vm.pc() >= 0x6000 && vm.pc() <= 0x6002, `the loader started the game at $6000 (pc $${hex(vm.pc())})`);
  assert.equal(vm.peek(0xcafe), 0, "ROM NMI nest count zeroed");
  assert.deepEqual(peeks(RES_ORG, R.ROMCSW - RES_ORG), Array.from(resident.bytes.subarray(0, R.ROMCSW - RES_ORG)), "resident at $B704");
  assert.equal(vm.peek(R.ROMCSW) | (vm.peek(R.ROMCSW + 1) << 8), 0xf0e9, "ROM DOS collector captured");
  assert.equal(vm.peek(R.HAVE_TIMER), 0x80, "Mockingboard Timer 1 found and counting");
  vm.poke(0xa123, 0x5a);
  assert.equal(vm.peek(0xa123), 0x5a, "BASIC overlay off: $9000-$BFFF is RAM");

  // Loads by T/S list, header first, at the game's page.
  const setIo = (t, s, page) => { vm.poke(0x75d, t); vm.poke(0x75e, s); vm.poke(0x75f, page); };
  for (let i = 0; i < 16; i++) vm.poke(0xb0 + i, i ^ 0xa5);
  vm.poke(0x9800, 0xee);
  setIo(23, 13, 0x96);
  let r = call(vm, R.LOAD_FILE);
  assert.equal(r.p & C, 0, "T01 loads");
  assert.deepEqual(peeks(0x9600, 512), Array.from(ENTRIES[1].raw), "T01's raw sectors at $9600");
  assert.equal(vm.peek(0x9800), 0xee, "the load stops at the file's end");
  assert.deepEqual(peeks(0xb0, 16), Array.from({ length: 16 }, (_, i) => i ^ 0xa5), "$B0-$BF survive the ROM command");
  setIo(22, 5, 0x96);
  r = call(vm, R.LOAD_FILE);
  assert.equal(r.p & C, 0, "TITLE loads");
  assert.deepEqual(peeks(0x9600, 768), Array.from(ENTRIES[0].raw));
  let serial = vm.drainOutput();
  assert.match(serial, /FLOAD T01 9600 0000 01FF\r/);
  assert.match(serial, /FLOAD TITLE 9600 0000 02FF\r/);

  // A file missing from the card: carry set, and only the destination changed.
  setIo(24, 12, 0x96);
  const before = peeks(0, 0xc000);
  r = call(vm, R.LOAD_FILE);
  assert.equal(r.p & C, C, "missing T02: carry set (the game shows DISK ERROR)");
  const after = peeks(0, 0xc000);
  const allowed = (a) => (a >= 0x9600 && a < 0x9800) || (a >= R.ROMCSW && a < R.RESIDENT_END)
    || (a >= 0x100 && a < 0x200) || (a >= TRAMP && a < 0x400);
  const stray = [];
  for (let a = 0; a < 0xc000; a++) if (before[a] !== after[a] && !allowed(a)) stray.push(hex(a));
  assert.deepEqual(stray, [], "a failed FLOAD writes nowhere but the destination");
  assert.notDeepEqual(peeks(0x9600, 4), Array.from(ENTRIES[2].raw.subarray(0, 4)), "no stale header");
  assert.match(vm.drainOutput(), /FLOAD T02 9600 0000 01FF\r/);
  setIo(3, 0, 0x96);
  r = call(vm, R.LOAD_FILE);
  assert.equal(r.p & C, C, "a T/S list the game does not use: carry set");
  assert.equal(vm.drainOutput(), "", "...without a ROM command");

  // The hall of fame: read, change, write, wipe, read back all 512 bytes.
  r = call(vm, R.HOF_READ);
  assert.equal(r.p & C, 0, "DIRTHOF reads");
  assert.deepEqual(peeks(0xb500, 512), Array.from(ENTRIES[3].raw));
  const record = Uint8Array.from({ length: 508 }, (_, i) => (i * 13 + 5) & 255);
  vm.loadData(0xb504, record);
  r = call(vm, R.HOF_WRITE);
  assert.equal(r.p & C, 0);
  vm.loadData(0xb500, new Uint8Array(512));
  r = call(vm, R.HOF_READ);
  assert.equal(r.p & C, 0);
  assert.deepEqual(peeks(0xb504, 508), Array.from(record), "the written hall of fame reads back, to its last byte");
  serial = vm.drainOutput();
  assert.match(serial, /OWRITE DIRTHOF B500 01FF\r/);
  assert.equal(serial.match(/OWRITE/g).length, 1);
  console.log("PASS file I/O on ROM DOS: T/S lookup, exact loads, $B0-$BF, missing file, hall of fame round trip");

  // SNES pads as the game's joystick (either pad), no PTRIG.
  const pad = (mask, which = 0) => { vm.setGamepadState(which, mask); vm.setGamepadState(1 - which, 0); };
  pad(0);
  r = call(vm, R.PADDLES);
  assert.equal(r.p & C, 0, "a joystick is present");
  assert.deepEqual([vm.peek(0x71), vm.peek(0x72)], [0x40, 0x40], "centred");
  for (const [mask, x, y] of [[1 << 6, 0x00, 0x40], [1 << 7, 0x80, 0x40], [1 << 4, 0x40, 0x00], [1 << 5, 0x40, 0x80], [(1 << 6) | (1 << 7), 0x40, 0x40]]) {
    pad(mask, 1);
    call(vm, R.PADDLES);
    assert.deepEqual([vm.peek(0x71), vm.peek(0x72)], [x, y], `pad 2 D-pad mask ${hex(mask)}`);
  }
  for (const [mask, b0, b1] of [[1 << 0, 0x80, 0], [1 << 9, 0x80, 0], [1 << 8, 0, 0x80], [1 << 1, 0, 0x80], [0, 0, 0]]) {
    pad(mask);
    r = call(vm, R.BUTTONS);
    assert.equal(r.a & N, (b0 | b1) & N, `buttons for mask ${hex(mask)}`);
    r = call(vm, R.BUTTON1);
    assert.equal(r.a, b1, `button 1 for mask ${hex(mask)}`);
    assert.equal(vm.peek(R.BTN0), b0, `button 0 for mask ${hex(mask)}`);
  }
  pad(1 << 8);                                  // the frame's paddle read...
  call(vm, R.PADDLES);
  pad(0);
  assert.equal(call(vm, R.BUTTON1).a, 0x80, "...is reused by the next button 1 read");
  assert.equal(call(vm, R.BUTTON1).a, 0, "...once: then the pads are read again");
  vm.poke(0xc000, 0x41);                        // no key waiting
  pad(1 << 3);                                  // Start
  call(vm, R.BUTTONS);
  assert.equal(vm.peek(0xc000), 0x9b, "Start types Esc");
  vm.poke(0xc000, 0x1b);
  call(vm, R.BUTTONS);
  assert.equal(vm.peek(0xc000), 0x1b, "a held Start types it once");
  pad(1 << 2);                                  // Select, while a typed key waits
  vm.poke(0xc000, 0xc1);
  call(vm, R.BUTTONS);
  assert.equal(vm.peek(0xc000), 0xc1, "a waiting key is not overwritten");
  vm.poke(0xc000, 0x41);
  pad(0);
  call(vm, R.BUTTONS);
  assert.equal(vm.peek(0xc000), 0xd2, "...and Select's R follows once it is taken");
  console.log("PASS SNES pads: paddles from either D-pad, B/X and A/Y buttons, Start/Select keys");

  // Apple II timing, measured against the Apple's own routines run in the
  // same emulator (so both share its CPU timing): the tone's half period,
  // click to click, against the classic speaker loop the game had at $6003
  // (TAY / STX t / LDA $C030 / LDX t / DEX / BNE / DEY / BNE), and WAIT.
  const halfPeriods = (entry, a, x) => {
    const code = [0xa9, a, 0xa2, x, 0x20, entry & 255, entry >> 8];
    const loop = TRAMP + code.length;
    vm.loadData(TRAMP, Uint8Array.from([...code, 0x4c, loop & 255, loop >> 8]));
    vm.setPC(TRAMP);
    vm.addBreakpoint(loop);
    const clicks = [];
    let cyc = 0;
    for (;;) {
      cyc += vm.step();                         // one instruction at a time:
      if (vm.pc() === loop) break;              // note each speaker access
      if (vm.peek(vm.pc()) === 0xad && vm.peek(vm.pc() + 1) === 0x30 && vm.peek(vm.pc() + 2) === 0xc0) clicks.push(cyc);
    }
    vm.removeBreakpoint(loop);
    return clicks.slice(1).map((c, i) => c - clicks[i]);
  };
  const REF = 0x0390, REF_T = 0x03b0;
  vm.loadData(REF, Uint8Array.from([0xa8, 0x8e, REF_T & 255, REF_T >> 8, 0xad, 0x30, 0xc0, 0xae, REF_T & 255, REF_T >> 8,
    0xca, 0xd0, 0xfd, 0x88, 0xd0, 0xf4, 0x60]));
  for (const [a, x] of [[8, 0xff], [8, 0xa0], [8, 0x30], [4, 0]]) {
    const mine = halfPeriods(R.TONE, a, x), apple = halfPeriods(REF, a, x);
    assert.equal(mine.length, a - 1, "one click per half period");
    near(mine[0], CLOCK_RATIO * apple[0], 0.01, `tone X=${hex(x, 2)} half period`);
    const n = (x || 256) + ((x || 256) >> 1) + ((x || 256) >> 5) + ((x || 256) >> 6) + 1;
    near(15 + 5 * n, CLOCK_RATIO * (5 * (x || 256) + 12), 0.01, `tone X=${hex(x, 2)} on 65C02 datasheet timing`);
  }
  for (const a of [0x28, 0x4f]) {
    const apple = call(vm, 0xfca8, { a }).cycles;
    r = call(vm, R.WAIT_APPLE, { a, x: 0x77 });
    near(r.cycles, CLOCK_RATIO * apple, 0.03, `WAIT(${hex(a, 2)})`);
    assert.equal(r.x, 0x77, "WAIT keeps X");
  }
  // Frame pacing: work, then pace; a tone in the frame is not padded again.
  const WORK = 0x0380;                          // ~25,000 cycles of "frame code"
  vm.loadData(WORK, Uint8Array.from([0xa0, 0x10, 0xa2, 0x00, 0xca, 0xd0, 0xfd, 0x88, 0xd0, 0xf8, 0x60]));
  const frame = (pre) => call(vm, R.PACE, { pre: [0x20, R.TIMING_RESET & 255, R.TIMING_RESET >> 8, ...pre] }).cycles;
  const jsrWork = [0x20, WORK & 255, WORK >> 8];
  const plain = call(vm, WORK, { pre: [] }).cycles;
  near(frame(jsrWork), CLOCK_RATIO * plain, 0.02, "a paced frame lasts as long as on the Apple");
  const jsrPace = [0x20, R.PACE & 255, R.PACE >> 8];
  const ten = frame([...Array(9).fill([...jsrWork, ...jsrPace]).flat(), ...jsrWork]);
  near(ten, CLOCK_RATIO * 10 * plain, 0.005, "ten paced frames (each wait's overshoot repaid by the next)");
  const toneCycles = call(vm, R.TONE, { a: 6, x: 0x80 }).cycles;
  const withTone = frame([...jsrWork, 0xa9, 6, 0xa2, 0x80, 0x20, R.TONE & 255, R.TONE >> 8, ...jsrWork]);
  near(withTone, CLOCK_RATIO * 2 * plain + toneCycles, 0.02, "tone time is not padded twice");
  const wait1 = call(vm, R.WAIT_APPLE, { a: 1 }).cycles;
  const jsrWait1 = [0xa9, 1, 0x20, R.WAIT_APPLE & 255, R.WAIT_APPLE >> 8];
  near(frame(Array(3).fill([...jsrWork, ...jsrWait1]).flat()), 3 * (plain + wait1), 0.02,
    "64K+ cycles of work between WAITs (a menu, a pause) is not padded");
  vm.poke(R.HAVE_TIMER, 0);
  near(frame(jsrWork), plain, 0.02, "without the Mockingboard timer: no pacing");
  vm.poke(R.HAVE_TIMER, 0x80);
  console.log("PASS Apple II timing: tone pitch, WAIT length, frame pacing, no double padding, no-timer fallback");

  // Quit: back at the ROM DOS prompt, which still works.
  vm.setPC(R.QUIT);
  for (let i = 0; i < 60; i++) vm.run(50000);
  const screen = harness.Session.prototype.textScreen.call({ vm }).join("\n");
  assert.ok(vm.textMode(), "text mode");
  assert.match(screen, /3RIC 6502 OS\/3/);
  assert.equal(vm.peek(0xcafe), 0);
  assert.equal(vm.peek(0xce09), 0, "DOS output unmuted");
  vm.drainOutput();
  for (const ch of "CD DIRTBIKE\r") { vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0)); for (let i = 0; i < 8; i++) vm.run(20000); }
  for (let i = 0; i < 40; i++) vm.run(50000);
  assert.match(vm.drainOutput(), /CD DIRTBIKE\rOK\r/, "the DOS works and the card is mounted");
  console.log("PASS quit: ROM DOS prompt, unmuted, NMI nest count 0, CD works");
}

// ---------------------------------------------------------------------------
// Optional: the real game.

if (process.env.DIRTBIKE_DSK) {
  const dsk = new Uint8Array(fs.readFileSync(process.env.DIRTBIKE_DSK));
  const { tree, notes, resident } = convert(dsk);
  const R = resident.symbols;
  assert.deepEqual(notes, []);
  assert.equal(Object.keys(tree).length, 33, "PRG + TITLE + 30 tracks + DIRTHOF");
  const hof = readCatalog(dsk).find((f) => f.name === "DIRTHOF");
  assert.deepEqual(Array.from(tree.DIRTHOF), Array.from(hof.raw), "the disk's hall of fame");
  assert.equal(String.fromCharCode(...tree.TITLE.subarray(0x7b1, 0x7be)), "QUIT TO DOS  ");
  const bad = dsk.slice();
  const prgFile = readCatalog(bad).find((f) => f.name === "DIRTBIKE");
  const [t, s] = prgFile.sectors[1];
  bad[(t * 16 + s) * 256 + 9] ^= 1;
  assert.throws(() => convert(bad), /not the release/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dirtbike-"));
  writeTree(tree, tmp);
  fs.writeFileSync(path.join(tmp, "DIRTHOF"), Uint8Array.of(1, 2, 3));
  assert.deepEqual(writeTree(tree, tmp), ["DIRTHOF"], "an existing DIRTHOF (records) is kept");
  assert.equal(fs.readFileSync(path.join(tmp, "DIRTHOF")).length, 3);
  fs.rmSync(tmp, { recursive: true });

  const FLIP = 0x7da8;                          // STA $A8: the page just flipped
  const boot = async (t) => {
    const vm = await bootCard({ DIRTBIKE: t });
    for (let i = 0; i < 80; i++) vm.run(50000);
    return vm;
  };
  const run = (vm, n) => { for (let i = 0; i < n; i++) vm.run(50000); };
  const key = (vm, c, n = 30) => { vm.keyDown(typeof c === "number" ? c : c.charCodeAt(0)); run(vm, n); };
  // Run frames (page flips), calling each(frame) after every flip.
  const frames = (vm, count, each = () => {}) => {
    let n = 0, cyc = 0;
    vm.addBreakpoint(FLIP);
    while (n < count) {
      cyc += vm.runCycles(5000);
      if (vm.breakpointHit()) { n++; each(n, cyc); vm.removeBreakpoint(FLIP); cyc += vm.step(); vm.addBreakpoint(FLIP); }
      assert.ok(cyc < 500e6, "the race keeps flipping pages");
    }
    vm.removeBreakpoint(FLIP);
    return cyc;
  };

  // Title, menu, a race on the pad - and Apple II speed against an unpaced build.
  const race = async (t) => {
    const vm = await boot(t);
    const serial = vm.drainOutput();
    key(vm, " ", 40);
    key(vm, 13, 0);
    let c0 = 0, c1 = 0;
    frames(vm, 320, (n, cyc) => {
      if (n === 5) vm.setGamepadState(0, 1 << 0);                 // B: gas
      if (n === 60) vm.setGamepadState(0, (1 << 0) | (1 << 7));  // + lean forward
      if (n === 90) vm.setGamepadState(0, 1 << 0);
      if (n === 20) c0 = cyc;
      if (n === 320) c1 = cyc;
    });
    vm.setGamepadState(0, 0);
    const state = [vm.peek(0x706), vm.peek(0x709), vm.peek(0x6b), vm.peek(0x6c), vm.peek(0x6d), vm.peek(0x68)];
    return { vm, serial: serial + vm.drainOutput(), cycles: c1 - c0, state };
  };
  const plain = await race(convert(dsk, { timing: false }).tree);
  const paced = await race(tree);
  assert.match(paced.serial, /FLOAD DIRTHOF B500 0000 01FF\rFLOAD TITLE 9600 0000 10FF\r[^]*FLOAD T01 9600 0000 03FF\r/);
  assert.equal(paced.vm.peek(0x70), 1, "joystick (SNES pad) mode by default");
  assert.ok((paced.state[1] << 8 | paced.state[0]) > 300, "the pad's gas moved the bike");
  assert.deepEqual(paced.state, plain.state, "both builds ride the same 300 frames");
  near(paced.cycles / plain.cycles, CLOCK_RATIO, 0.01, "300 race frames last as long as on a 1.023 MHz Apple II");
  console.log(`PASS real disk: title, menu, T01 race on the pad; 300 frames in ${(paced.cycles / 1573437.5).toFixed(2)} s (Apple II: ${(plain.cycles / (14318180 / 14)).toFixed(2)} s)`);

  // The menu's input setting is saved in DIRTHOF and survives a re-run.
  let vm = paced.vm;
  vm.drainOutput();
  key(vm, 27, 200);                             // Esc: main menu (TITLE)
  key(vm, "3", 60);                             // input: keyboard
  key(vm, "0", 200);                            // back to the race: saved
  assert.match(vm.drainOutput(), /FLOAD DIRTHOF B500 0000 01FF\rOWRITE DIRTHOF B500 01FF\r/);
  key(vm, 27, 200);
  key(vm, "5", 200);                            // QUIT TO DOS
  assert.ok(vm.textMode(), "quit: text mode");
  assert.match(vm.drainOutput(), /3RIC 6502 OS\/3[^]*>$/);
  for (const line of ["CD DIRTBIKE\r", "BRUN DIRTBIKE.PRG 0800\r"]) {
    for (const ch of line) { vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0)); for (let i = 0; i < 8; i++) vm.run(20000); }
    run(vm, 40);
  }
  run(vm, 80);
  assert.equal(vm.peek(0x70), 0, "keyboard mode read back from the card");
  console.log("PASS real disk: menu setting written to DIRTHOF, quit to DOS, re-run reads it back");

  // A record (staged: third lap, just short of the line) and its initials.
  vm = await boot(tree);
  key(vm, " ", 40);
  key(vm, 13, 0);
  let states = [];
  frames(vm, 80, (n) => {
    if (n === 3) vm.setGamepadState(0, 1 << 0);
    if (n === 60) {
      const len = vm.peek(0x74f) | vm.peek(0x750) << 8;
      vm.poke(0x726, 2);
      vm.poke(0x706, (len - 3) & 255);
      vm.poke(0x709, (len - 3) >> 8);
    }
    if (states.at(-1) !== vm.peek(0x68)) states.push(vm.peek(0x68));
  });
  vm.setGamepadState(0, 0);
  assert.deepEqual(states, [0, 3], "finish line crossed: a new record");
  run(vm, 100);
  vm.drainOutput();
  for (const c of "XEBG") key(vm, c, 40);       // X leaves the RECORD screen
  key(vm, 13, 300);
  assert.match(vm.drainOutput(), /FLOAD DIRTHOF B500 0000 01FF\rOWRITE DIRTHOF B500 01FF\rFLOAD T02 9600 0000 03FF\r/, "record saved, next track loaded");
  assert.equal(String.fromCharCode(vm.peek(0x1ecc), vm.peek(0x1ecd), vm.peek(0x1ece)), "EBG", "initials");
  console.log("PASS real disk: staged finish, new record, initials saved to DIRTHOF, next track");
} else {
  console.log("SKIP real-disk play (set DIRTBIKE_DSK to the original DIRTBIKE.dsk)");
}
