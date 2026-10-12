// msbasic-woz.test.mjs — the MS-BASIC boot disk (specs/ROM-SOFTWARE.md): image and
// hook placement, WOZ round trip, refusals, then WASM boots through the real Disk II
// PROM with the overlay RAM scrubbed, as at a physical power-on.
// Build the emulator first: pwsh web/build.ps1
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import harness from "./harness.cjs";
import { readWozSectors } from "./wozedit.mjs";
import {
  BASIC_END, BASIC_PAGES, BASIC_START, GUARD_START, MISMATCH_TEXT, PS2_DECODER,
  buildMsBasicWoz, fletcher16, sectorForPage,
} from "./msbasic-woz.mjs";

const PRIMARY = 0, BASIC_ROM = 1; // MemoryReadMapping
const PICODISK_SPINDOWN = 1_023_000; // cycles the picodisk keeps stalling after motor-off
const rom = readFileSync(join(harness.DATA_DIR, "badger6502.bin"));
const dbg = readFileSync(join(harness.DATA_DIR, "badger6502.dbg"), "utf8");
const disk = buildMsBasicWoz(rom);
const original = rom.subarray(BASIC_START, BASIC_END);
const symbol = name => {
  const match = new RegExp(`^sym\\s.*name="${name}",.*val=0x([0-9A-F]+)`, "m").exec(dbg);
  assert.ok(match, `${name} is in badger6502.dbg`);
  return parseInt(match[1], 16);
};
const segmentStart = name => {
  const match = new RegExp(`^seg\\s.*name="${name}",start=0x([0-9A-F]+)`, "m").exec(dbg);
  assert.ok(match, `segment ${name} is in badger6502.dbg`);
  return parseInt(match[1], 16);
};

// --- the disk image -----------------------------------------------------------------
assert.equal(disk.coldStart, symbol("COLD_START"));
assert.equal(disk.patches[0].site, symbol("L40D7") + 2, "probe hook replaces BNE/INC after INC LINNUM");
assert.equal(disk.patches[1].site, symbol("L40FA"), "top-of-memory hook is the probe's exit");
assert.deepEqual(
  Object.fromEntries(disk.patches.slice(2).map(({ name, site }) => [name, site])),
  { QT_OK: symbol("QT_OK"), QT_BREAK: symbol("QT_BREAK"), QT_WRITTEN_BY: symbol("QT_WRITTEN_BY") + 30 },
  "line breaks are restored in the three messages BASIC prints");
const changed = new Set();
for (const { site, before, after } of disk.patches) {
  const at = site - BASIC_START;
  assert.equal(before.length, after.length);
  assert.deepEqual([...original.subarray(at, at + before.length)], before);
  assert.deepEqual([...disk.image.subarray(at, at + after.length)], after);
  for (let i = 0; i < after.length; i++) changed.add(site + i);
}
for (let address = disk.hooks.start; address < BASIC_END; address++) {
  assert.equal(original[address - BASIC_START], 0, "hooks use zero-filled ROM bytes");
  changed.add(address);
}
for (let address = BASIC_START; address < BASIC_END; address++) {
  if (!changed.has(address))
    assert.equal(disk.image[address - BASIC_START], original[address - BASIC_START], `byte $${address.toString(16)} is the ROM's`);
}
const segments = [...dbg.matchAll(/^seg\s.*name="([^"]+)",start=0x([0-9A-F]+),size=0x([0-9A-F]+)/gm)]
  .map(([, name, start, size]) => ({ name, start: parseInt(start, 16), end: parseInt(start, 16) + parseInt(size, 16) }))
  .filter(seg => seg.start >= BASIC_START && seg.start < BASIC_END);
assert.ok(segments.length > 0);
for (const seg of segments)
  assert.ok(seg.end <= disk.hooks.start, `${seg.name} ends before the hooks at $${disk.hooks.start.toString(16)}`);
assert.deepEqual(disk.guard, fletcher16(rom.subarray(GUARD_START, 0x10000)));
assert.ok(disk.hooks.postload >= disk.hooks.start && disk.hooks.postload < disk.hooks.probePage);
console.log("PASS image is the ROM's $9000-$BFFF plus two JSR hooks, three message line breaks and start-up code in unused bytes");

const coordinates = [{ track: 0, sector: 0 }, ...Array.from({ length: BASIC_PAGES }, (_, page) => sectorForPage(page))];
const sectors = readWozSectors(Buffer.from(disk.woz), coordinates);
assert.deepEqual(sectors[0].data, Buffer.from(disk.loader));
for (let page = 0; page < BASIC_PAGES; page++)
  assert.deepEqual(sectors[page + 1].data, Buffer.from(disk.image.subarray(page * 256, page * 256 + 256)), `page ${page}`);
console.log("PASS WOZ bitstream holds the loader at T0 S0 and all 48 BASIC pages");

const variant = edit => { const copy = Buffer.from(rom); edit(copy); return copy; };
assert.throws(() => buildMsBasicWoz(variant(r => { r[disk.patches[0].site] ^= 0xff; })), /MEMORY SIZE probe/);
assert.throws(() => buildMsBasicWoz(variant(r => { r[BASIC_END - 1] = 0xea; })), /not unused/);
assert.throws(() => buildMsBasicWoz(variant(r => { r[0xe002] = 0xd0; })), /outside BASIC/);
assert.throws(() => buildMsBasicWoz(variant(r => { r[symbol("QT_BREAK") + 1] = 0x0a; })), /QT_BREAK/);
const reset = rom[0xfffc] | (rom[0xfffd] << 8);
const clearsKeyUp = rom.subarray(reset, reset + 0x100).findIndex((_, i, a) => a[i] === 0x8d && a[i + 1] === 0x04 && a[i + 2] === 0xce);
assert.ok(clearsKeyUp >= 0, "the ROM reset handler clears KBKEYUP");
assert.throws(() => buildMsBasicWoz(variant(r => { r[reset + clearsKeyUp + 1] = 0x05; })), /reset handler/);
console.log("PASS unrecognized ROM layouts are refused");

// --- booting it ---------------------------------------------------------------------
let clock = 0; // emulated cycles, for timing assertions
const screen = session => session.textScreen().join("\n");
function type(vm, text) {
  for (const char of text) {
    for (let t = 0; t < 200 && (vm.peek(0xc000) & 0x80); t++) clock += vm.runCycles(2000);
    vm.keyDown(char === "\r" ? 13 : char.charCodeAt(0));
    clock += vm.runCycles(25_000);
  }
}
// Stops early, returning false, if an unexpected breakpoint halts the CPU.
function runUntil(vm, done, budget = 60_000_000) {
  for (let used = 0; used < budget;) {
    const ran = vm.runCycles(100_000);
    clock += ran;
    used += ran || 100_000;
    if (done()) return true;
    if (vm.breakpointHit()) return false;
  }
  return false;
}
const scrub = address => (address * 151 + 77) & 0xff;
const imageInRam = vm => disk.image.every((byte, i) => vm.peek(BASIC_START + i) === byte);

async function bootDisk(woz, { basicRomSelected = false } = {}) {
  const session = await harness.boot();
  const vm = session.vm;
  for (let address = 0x0800; address < BASIC_END; address++) vm.poke(address, scrub(address));
  assert.ok(!imageInRam(vm), "no BASIC is left in overlay RAM");
  type(vm, "MON\r");
  if (basicRomSelected) {
    vm.readBus(0xc006); // as if a program left BASIC ROM selected; the loader must expose RAM
    assert.equal(vm.memoryMapping(BASIC_START), BASIC_ROM);
  }
  assert.ok(vm.insertDisk(0, new Uint8Array(woz)));
  return session;
}

async function answerMemorySize(answer, expectedFree, expectedTop) {
  const session = await bootDisk(disk.woz);
  const { vm } = session;
  try {
    type(vm, "C600G\r");
    assert.ok(runUntil(vm, () => /MEMORY SIZE\?/.test(screen(session))), "disk BASIC prompts MEMORY SIZE?");
    type(vm, `${answer}\r`);
    assert.ok(runUntil(vm, () => /BYTES FREE/.test(screen(session))), "cold start completes");
    assert.match(screen(session), new RegExp(` ${expectedFree} BYTES FREE`));
    assert.equal(vm.peek(0x76) | (vm.peek(0x77) << 8), expectedTop, "MEMSIZ");
    assert.ok(imageInRam(vm), "the interpreter survives MEMORY SIZE");
  } finally {
    vm.delete();
  }
}

const main = await bootDisk(disk.woz, { basicRomSelected: true });
try {
  const { vm } = main;
  const d = PS2_DECODER;
  vm.addMappedBreakpoint(disk.loaderSymbols.LOADED, PRIMARY);
  type(vm, "C600G\r");
  assert.ok(runUntil(vm, () => vm.breakpointHit()), "the loader reads every page");
  const motorOff = clock;
  // Leave the ROM PS/2 decoder the way READY stalls during a physical boot can: mid-frame,
  // with stale prefixes, Shift/Ctrl/Scroll Lock held and a misdecoded key pending.
  for (const [address, value] of [
    [d.KBSTATE, 3], [d.KBEXTEND, 0xe0], [d.KBKEYUP, 0xf0], [d.KBTOGGLE, 0x58], [d.KBMODIFIER, 0x12],
    [d.KEYSTATE + 0x12, 1], [d.KEYSTATE + 0x14, 1], [d.KEYSTATE + 0x7e, 0x81], [0xc000, 0xc7],
  ]) vm.poke(address, value);
  vm.clearBreakpoints();
  vm.addMappedBreakpoint(disk.coldStart, PRIMARY);
  vm.addMappedBreakpoint(disk.coldStart, BASIC_ROM);
  assert.ok(runUntil(vm, () => vm.breakpointHit()), "the loader reaches COLD_START");
  assert.equal(vm.pc(), disk.coldStart);
  assert.equal(vm.memoryMapping(disk.coldStart), PRIMARY, "BASIC cold-starts from overlay RAM, not ROM");
  assert.ok(imageInRam(vm), "all 48 pages were loaded from the disk");
  assert.ok(clock - motorOff >= PICODISK_SPINDOWN, `BASIC starts ${clock - motorOff} cycles after motor-off`);
  for (const address of [d.KBSTATE, d.KBEXTEND, d.KBKEYUP, d.KBTOGGLE, d.KBMODIFIER])
    assert.equal(vm.peek(address), 0, `decoder variable $${address.toString(16)} is reset`);
  for (let code = 0; code < 256; code++) assert.equal(vm.peek(d.KEYSTATE + code), 0, "no key is left held");
  assert.equal(vm.peek(0xc000) & 0x80, 0, "the misdecoded key was dropped");
  console.log(`PASS start-up waits ${clock - motorOff} cycles after motor-off and resets the PS/2 decoder`);
  vm.clearBreakpoints();
  // Any BASIC statement or prompt executed with the ROM overlay selected would stop here.
  for (const name of ["RESTART", "NEWSTT"]) vm.addMappedBreakpoint(symbol(name), BASIC_ROM);

  assert.ok(runUntil(vm, () => /MEMORY SIZE\?/.test(screen(main))), "disk BASIC prompts MEMORY SIZE?");
  vm.runCycles(500_000);
  assert.ok(!/MEMORY SIZE\?[^\n]*G/.test(screen(main)), "the misdecoded G never reaches the prompt");
  type(vm, "\r");
  assert.ok(runUntil(vm, () => /BYTES FREE/.test(screen(main))), "Return at MEMORY SIZE? completes the cold start");
  assert.match(screen(main), / 34815 BYTES FREE/);
  assert.ok(runUntil(vm, () => /^ 34815 BYTES FREE *\n\]/m.test(screen(main)), 5_000_000), "the prompt is a bare ] on the next line");
  assert.equal(vm.peek(0x76) | (vm.peek(0x77) << 8), 0x9000, "MEMSIZ stops at the interpreter");
  assert.equal(vm.peek(0x72) | (vm.peek(0x73) << 8), 0x9000, "FRETOP stops at the interpreter");
  assert.ok(imageInRam(vm), "Return at MEMORY SIZE? leaves the interpreter intact");
  console.log("PASS boots from scrubbed RAM; COLD_START runs from the loaded copy; Return gives 34815 BYTES FREE");

  for (const line of [
    "10 DIM A(20)",
    "20 FOR I=1 TO 20:A(I)=I*I:NEXT",
    "30 S=0:FOR I=1 TO 20:S=S+A(I):NEXT",
    "40 B$=\"3RIC\"+\" DISK BASIC\"",
    "50 PRINT S;LEN(B$);B$",
    "60 PRINT INT(SQR(2)*1000)",
    "RUN",
  ]) type(vm, `${line}\r`);
  assert.ok(runUntil(vm, () => /\b1414\b/.test(screen(main)), 20_000_000), "the program runs");
  assert.match(screen(main), /2870\s+15\s+3RIC DISK BASIC/);
  assert.ok(runUntil(vm, () => /^ 1414 *\n *\n\]/m.test(screen(main)), 5_000_000), "one line break, as in Applesoft II, then a bare ]");
  console.log("PASS arrays, loops, strings and floating point run in disk BASIC; prompts are a bare ]");

  const nmiHandler = segmentStart("NMI");
  vm.addMappedBreakpoint(nmiHandler, BASIC_ROM);
  vm.setGamepadState(0, 1 << 8); // controller 1: A
  type(vm, "X=PEEK(49264):PRINT PEEK(52968)\r"); // $C070 raises the ROM pad-scan NMI
  assert.ok(runUntil(vm, () => vm.breakpointHit(), 5_000_000), "the pad scan reaches the ROM NMI handler");
  assert.equal(vm.pc(), nmiHandler);
  assert.equal(vm.memoryMapping(nmiHandler), BASIC_ROM, "the NMI proxy banks BASIC ROM in for its handler");
  vm.clearBreakpoints();
  for (const name of ["RESTART", "NEWSTT"]) vm.addMappedBreakpoint(symbol(name), BASIC_ROM);
  assert.ok(runUntil(vm, () => /^ 1$/m.test(screen(main)), 5_000_000), "BASIC reads A pressed from GAMEPAD1");
  assert.equal(vm.memoryMapping(BASIC_START), PRIMARY, "the NMI returns with RAM exposed");
  type(vm, "PRINT \"AFTER NMI\"\r");
  assert.ok(runUntil(vm, () => /^AFTER NMI$/m.test(screen(main)), 5_000_000), "BASIC keeps running after the NMI");
  assert.ok(!vm.breakpointHit(), "no BASIC statement ran from the ROM overlay");
  assert.ok(imageInRam(vm), "the RAM interpreter is unchanged");
  console.log("PASS ROM NMI services bank in and return to the RAM interpreter");

  // The ROM's own bytes print "b]p / IN 10" here: its CR scrolls the screen and clobbers Y.
  for (const line of ["NEW", "10 PRINT \"HI\":GOTO 10", "RUN"]) type(vm, `${line}\r`);
  vm.runCycles(3_000_000);
  type(vm, "\x03"); // Ctrl-C
  assert.ok(runUntil(vm, () => /^HI *\n *\nBREAK IN +10 *\n\]/m.test(screen(main)), 5_000_000), "BREAK survives a scroll");
  assert.ok(!/[^\n]\]/.test(screen(main)), "no prompt shows a stray character");
  console.log("PASS Ctrl-C prints BREAK IN 10 intact after scrolling output");

  vm.clearBreakpoints();
  vm.reset();
  vm.runCycles(3_000_000);
  assert.ok(!/BYTES FREE/.test(screen(main)), "reset cleared the screen");
  type(vm, "MON\r");
  vm.addMappedBreakpoint(disk.coldStart, BASIC_ROM);
  type(vm, "E000G\r");
  assert.ok(runUntil(vm, () => /MEMORY SIZE\?/.test(screen(main))), "E000G re-enters the RAM interpreter after reset");
  type(vm, "A\r");
  assert.ok(runUntil(vm, () => /^COPYRIGHT 1977 BY MICROSOFT CO *\n *\nMEMORY SIZE\?/m.test(screen(main)), 5_000_000),
    "A at MEMORY SIZE? prints the credit and a line break, then asks again");
  type(vm, "\r");
  assert.ok(runUntil(vm, () => /BYTES FREE/.test(screen(main))), "the restarted cold start completes");
  assert.match(screen(main), / 34815 BYTES FREE/);
  assert.ok(imageInRam(vm), "the interpreter survives reset and a second cold start");
  console.log("PASS the loaded interpreter survives reset; MON then E000G restarts it, and its credit line breaks cleanly");
} finally {
  main.vm.delete();
}

await answerMemorySize("40000", 34815, 0x9000);
await answerMemorySize("16384", 14335, 0x4000);
console.log("PASS typed sizes clamp to $9000 and smaller sizes are unchanged");

const foreign = buildMsBasicWoz(variant(r => { r[GUARD_START + 0x123] ^= 0x5a; }));
assert.notDeepEqual(foreign.guard, disk.guard);
const refused = await bootDisk(foreign.woz);
try {
  const { vm } = refused;
  vm.drainOutput();
  type(vm, "C600G\r");
  let serial = "";
  assert.ok(runUntil(vm, () => harness.MONITOR_DUMP.test(serial += vm.drainOutput()), 30_000_000), "the loader BRKs");
  assert.ok(screen(refused).includes(MISMATCH_TEXT), "the mismatch is reported on screen");
  for (let address = BASIC_START; address < BASIC_END; address++)
    assert.equal(vm.peek(address), scrub(address), "overlay RAM is untouched after a mismatch");
  console.log("PASS a disk built from a different ROM stops before loading");
} finally {
  refused.vm.delete();
}
