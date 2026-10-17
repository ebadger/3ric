// Flight Simulator II / 3RIC adapter tests (WASM build: run web\build.ps1 first).
//
//   node codegen\tools\patch-fs2.test.mjs                  synthetic checks only
//   node codegen\tools\patch-fs2.test.mjs --dsk <FS2.dsk>  + owner-supplied disk
//
// The disk checks cold-boot the actual generated WOZ through the Disk II PROM.
// Real PS/2 timing is covered natively by codegen\tools\patch-fs2.native.ps1.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildWozFromDsk } from "./wozgen.mjs";
import { sha256 } from "./wozedit.mjs";
import { applyPatches, buildPatches, buildResident, DSK_SIZE, INPUT_SHA256, patchFs2 } from "./patch-fs2.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const resident = buildResident();
const s = resident.symbols;
const CPS = 1573437;                       // 3RIC CPU cycles per second
const RESTART = 0xa7e2;                    // the game's NMI/RESET/IRQ restart handler
const KEYPOLL = 0x894d;                    // the game's LDA $C000 key poll
const PAD = { B: 1, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 };
const textRows = [0x000, 0x080, 0x100, 0x180, 0x200, 0x280, 0x300, 0x380, 0x028, 0x0a8, 0x128, 0x1a8,
  0x228, 0x2a8, 0x328, 0x3a8, 0x050, 0x0d0, 0x150, 0x1d0, 0x250, 0x2d0, 0x350, 0x3d0];

function screenText(vm) {
  return textRows.map(r => Array.from({ length: 40 }, (_, c) => {
    const b = vm.peek(0x400 + r + c) & 0x7f;
    return b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : " ";
  }).join("")).join("\n");
}

/** Run, failing if the game's restart handler is ever entered. */
function run(vm, cycles) {
  cycles = Math.ceil(cycles);
  vm.addBreakpoint(RESTART);
  for (let done = 0; done < cycles; ) {
    done += vm.runCycles(Math.min(200000, cycles - done));
    assert(!vm.breakpointHit(), "Flight Simulator II entered its restart handler ($A7E2)");
  }
  vm.removeBreakpoint(RESTART);
}

function key(vm, code, settle = 0.3) {
  for (let i = 0; i < 400 && (vm.peek(0xc000) & 0x80); i++) run(vm, 5000);
  assert.equal(vm.peek(0xc000) & 0x80, 0, "Previous keyboard strobe was not consumed");
  vm.keyDown(typeof code === "string" ? code.charCodeAt(0) : code);
  run(vm, settle * CPS);
}

function seek(vm, address, budget, guard = true) {
  vm.addBreakpoint(address);
  if (guard) vm.addBreakpoint(RESTART);
  vm.runCycles(0);                         // clears a breakpoint hit left by an earlier seek
  for (let done = 0; done < budget && !vm.breakpointHit(); ) done += vm.runCycles(200000);
  vm.removeBreakpoint(address);
  if (guard) vm.removeBreakpoint(RESTART);
  assert(vm.breakpointHit() && vm.pc() === address,
    `Timed out waiting for $${address.toString(16)} (at $${vm.pc().toString(16)})`);
}

async function bootDisk(woz, firmware = rom) {
  const create = require(path.join(root, "web", "badger6502.js"));
  const vm = new (await create()).WebVM();
  vm.loadData(0, firmware.subarray(0, 65536));
  vm.seedBasicRom();
  vm.loadFont(fs.readFileSync(path.join(root, "emulator", "Data", "fontrom.dat")));
  vm.reset();
  vm.runCycles(5000000);
  assert(vm.insertDisk(0, woz), "Disk was not inserted");
  for (const ch of "MON\rC600G\r") {
    for (let i = 0; i < 200 && (vm.peek(0xc000) & 0x80); i++) vm.runCycles(10000);
    vm.keyDown(ch.charCodeAt(0));
    vm.runCycles(300000);
  }
  return vm;
}

const handler = (vm, ch) => vm.peek(0x89ce + 2 * ch.charCodeAt(0)) | vm.peek(0x89cf + 2 * ch.charCodeAt(0)) << 8;

function editorValue(vm, label) {
  const line = screenText(vm).split("\n").find(l => l.includes(label));
  assert(line, `Editor did not show ${label}`);
  return Number(line.replace("-->", "").trim().split(/\s+/).pop());
}

function testSynthetic() {
  assert.equal(resident.org, 0xcf00);
  assert(resident.bytes.length <= 0xff, "Resident must leave $CFFF untouched");
  for (const name of ["NMI_ENTRY", "LC_ON", "SET_NMI", "BOOT_INIT"]) assert(s[name] >= 0xcf00, name);
  const patches = buildPatches(resident);
  const image = Buffer.alloc(DSK_SIZE);
  for (const [track, sector, offset, before] of patches)
    Buffer.from(before).copy(image, (track * 16 + sector) * 256 + offset);
  const patched = applyPatches(image, patches);
  for (const [track, sector, offset, , after] of patches)
    assert.deepEqual(patched.subarray((track * 16 + sector) * 256 + offset).subarray(0, after.length), Buffer.from(after));
  let changed = 0;
  for (let i = 0; i < DSK_SIZE; i++) changed += image[i] !== patched[i];
  assert(changed > 0 && changed <= 280, `Unexpected change count ${changed}`);
  for (const [track, sector, offset, before, , why] of patches) {
    if (!Buffer.from(before).some(Boolean)) continue;
    const wrong = Buffer.from(image);
    wrong[(track * 16 + sector) * 256 + offset] ^= 0xff;
    assert.throws(() => applyPatches(wrong, patches), /Unexpected Flight Simulator II bytes/, why);
  }
  assert.throws(() => patchFs2(image, rom), /Unsupported Flight Simulator II image/);
  console.log(`PASS resident ($CF00-$${(0xcf00 + resident.bytes.length - 1).toString(16).toUpperCase()}), `
    + `${patches.length} byte-verified patch sites, ${changed} changed bytes, preimage guards`);
}

async function testDisk(input) {
  assert.equal(sha256(input), INPUT_SHA256);
  const wrongRom = Buffer.from(rom);
  wrongRom[0xf1bf] ^= 1;                   // inside the checked NMI proxy
  assert.throws(() => patchFs2(input, wrongRom), /Unsupported 3ric ROM/);
  const result = patchFs2(input, rom);
  const again = patchFs2(input, rom);
  assert.deepEqual(result.woz, again.woz, "Output is not deterministic");
  console.log(`PASS image guards; output WOZ SHA-256 ${sha256(result.woz)}`);

  // The unmodified game: its first acknowledged key raises a $C010 NMI that
  // the language-card vector sends to the restart handler.
  const original = await bootDisk(Buffer.from(buildWozFromDsk(new Uint8Array(input))));
  try {
    seek(original, KEYPOLL, 60 * CPS, false); // $A7E2 is also the game's cold start
    original.keyDown("A".charCodeAt(0));
    seek(original, 0x8957, 3000000, false); // just after STA $C010 acknowledged the key
    original.addBreakpoint(RESTART);
    original.runCycles(1000);
    assert(original.breakpointHit(), "Unpatched disk was expected to restart on the first key");
    console.log("PASS unpatched disk reproduces the restart loop on the first key");
  } finally { original.delete(); }

  const mismatch = await bootDisk(result.woz, wrongRom);
  try {
    mismatch.runCycles(10000000);
    assert.match(screenText(mismatch), /FS2: ROM MISMATCH/);
    assert(mismatch.textMode(), "ROM mismatch did not stop in text mode");
    console.log("PASS on-machine ROM-proxy mismatch rejection");
  } finally { mismatch.delete(); }

  const vm = await bootDisk(result.woz);
  try {
    seek(vm, KEYPOLL, 60 * CPS, false);    // title: "TYPE A OR B"
    assert.deepEqual(Buffer.from(Array.from(resident.bytes, (_, i) => vm.peek(0xcf00 + i))),
      Buffer.from(resident.bytes), "Boot hook did not install the resident");
    assert.equal(vm.peekMapped(0xfffa) | vm.peekMapped(0xfffb) << 8, s.NMI_ENTRY, "LC NMI vector");
    assert.equal(vm.peekMapped(0xfffe) | vm.peekMapped(0xffff) << 8, RESTART, "Game IRQ vector changed");
    key(vm, "A", 2);                       // colour display
    key(vm, "B", 12);                      // regular flight mode
    assert.equal(vm.memoryMapping(0xd000), 3, "Flight is not running in language-card bank 2");
    assert.equal(vm.memoryMapping(0x9000), 0, "BASIC overlay is visible during flight");
    assert(!vm.textMode(), "Flight view is not in graphics");
    for (const ch of "TBFHG") {
      vm.keyDown(ch.charCodeAt(0));
      seek(vm, handler(vm, ch), CPS);
      run(vm, 0.2 * CPS);
      assert.equal(vm.peek(0xc000) & 0x80, 0, `${ch} strobe was not cleared`);
    }
    for (let i = 0; i < 16; i++) key(vm, 0x15, 0.1);  // right arrow: throttle
    assert.equal(vm.peek(0x0aaa), 0x78, "Right arrow did not open the throttle fully");
    run(vm, 20 * CPS);                     // takeoff roll
    key(vm, "B", 0.2);                     // rotate: elevator up
    key(vm, "B", 0.2);
    run(vm, 15 * CPS);
    key(vm, 0x1b, 6);                      // editor
    const altitude = editorValue(vm, "ALTITUDE"), airspeed = editorValue(vm, "AIRSPEED");
    assert(altitude > 800 && airspeed > 40, `No takeoff: altitude ${altitude}, airspeed ${airspeed}`);
    console.log(`PASS cold boot, title, flight mode, T/B/F/H/G handlers, full throttle, takeoff `
      + `(editor: altitude ${altitude}, airspeed ${airspeed})`);

    // Joystick option -> SNES pad 1 through the ROM paddle emulation.
    const joystickLine = () => screenText(vm).split("\n").find(l => l.includes("JOYSTICK")) || "";
    for (let i = 0; i < 60 && !joystickLine().includes("-->"); i++) key(vm, 0x0d, 0.2);
    assert(joystickLine().includes("-->"), "Editor cursor did not reach JOYSTICK");
    key(vm, "1", 0.2);
    key(vm, 0x0d, 0.2);
    assert.equal(vm.peek(0x0987), 1, "Joystick option was not set");
    key(vm, 0x1b, 8);
    vm.setGamepadState(0, PAD.B);          // fire button: centre calibration
    run(vm, CPS);
    vm.setGamepadState(0, 0);
    run(vm, CPS);
    const axis = (mask, address) => {
      vm.setGamepadState(0, mask);
      run(vm, 1.5 * CPS);
      const v = vm.peek(address);
      return v >= 0x80 ? v - 256 : v;
    };
    assert(axis(PAD.LEFT, 0x0a80) < -20 && axis(PAD.RIGHT, 0x0a80) > 20, "D-pad left/right did not move the ailerons");
    assert(axis(PAD.UP, 0x0a88) < -20 && axis(PAD.DOWN, 0x0a88) > 20, "D-pad up/down did not move the elevator");
    assert.equal(axis(0, 0x0a80), 0, "Released pad did not centre the ailerons");
    console.log("PASS editor joystick option, pad-B calibration, D-pad ailerons/elevator via $C070 NMIs");

    // Course plotter: recording runs with language-card bank 1 mapped.
    vm.keyDown("Q".charCodeAt(0));         // course plotter menu (drawn in hi-res)
    seek(vm, handler(vm, "Q"), CPS);
    run(vm, 2 * CPS);
    key(vm, "A", 1);                       // begin normal course recording
    key(vm, 0x1b, 2);
    seek(vm, 0xf820, 30 * CPS);            // bank 1 just selected by $F8B0
    assert.equal(vm.memoryMapping(0xd000), 2, "Course recording is not in bank 1");
    assert.equal(vm.peek(0x0e43), 1);
    const frame = [vm.pc(), vm.sp(), vm.regA(), vm.regX(), vm.regY(), vm.status()];
    vm.setGamepadState(0, PAD.RIGHT);
    vm.readBus(0xc070);                    // pad trigger NMI -> ROM path
    vm.step();
    assert.equal(vm.pc(), s.NMI_ENTRY, "Pad trigger did not enter the resident");
    for (let i = 0; i < 20000 && !(vm.pc() === frame[0] && vm.sp() === frame[1]); i++) vm.step();
    assert.deepEqual([vm.pc(), vm.sp(), vm.regA(), vm.regX(), vm.regY(), vm.status() & 0xcf],
      [...frame.slice(0, 5), frame[5] & 0xcf], "Bank-1 NMI did not preserve registers");
    assert.equal(vm.memoryMapping(0xd000), 2, "Bank-1 NMI did not restore bank 1");
    assert.equal(vm.memoryMapping(0x9000), 0, "Bank-1 NMI left BASIC visible");
    assert.equal(vm.peek(0xcee7), 1, "ROM pad scan did not run");
    vm.setGamepadState(0, 0);
    run(vm, 10 * CPS);
    key(vm, "Q", 2);
    key(vm, "B", 1);                       // display course plot from the bank-1 buffer
    vm.keyDown(0x1b);                      // back to flight; the main loop draws the plot
    seek(vm, 0xf7fc, 10 * CPS);            // JSR $6006 right after $F8B0 selected bank 1
    assert.equal(vm.memoryMapping(0xd000), 2, "Course plot is not reading bank 1");
    run(vm, 5 * CPS);
    console.log("PASS course recording/plot in bank 1, ROM-path NMI with bank 1 restored");
  } finally { vm.delete(); }
}

async function main(args) {
  assert(args.length === 0 || (args.length === 2 && args[0] === "--dsk"),
    "Usage: node codegen\\tools\\patch-fs2.test.mjs [--dsk <FlightSimulator2.dsk>]");
  testSynthetic();
  if (args.length) await testDisk(fs.readFileSync(args[1]));
  else console.log("SKIP owner-supplied disk integration (pass --dsk <FlightSimulator2.dsk>)");
}

main(process.argv.slice(2)).catch(error => { console.error(`FAIL ${error.stack || error.message}`); process.exitCode = 1; });
