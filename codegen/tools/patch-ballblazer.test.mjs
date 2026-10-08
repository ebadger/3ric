import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildPayload as archonPayload } from "./patch-archon.mjs";
import { buildPayload, createBootImage, extractProgram, patchBallblazer, readDisk } from "./patch-ballblazer.mjs";
import { crc32 } from "./wozgen.mjs";
import { readWozSectors, sha256 } from "./wozedit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { Session } = require("./harness.cjs");
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const font = fs.readFileSync(path.join(root, "emulator", "Data", "fontrom.dat"));
const payload = buildPayload(rom);
const s = payload.resident.symbols;
const hex = value => "$" + value.toString(16);
const PAD = { B: 1, X: 1 << 9, START: 8, SELECT: 4, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 };
let Module;
let checks = 0;
function checked(name) { checks++; console.log(`PASS ${name}`); }

function syntheticDisk() {
  const disk = Buffer.alloc(143360);
  const sector = (track, number) => disk.subarray(track * 4096 + number * 256, track * 4096 + number * 256 + 256);
  const vtoc = sector(17, 0);
  vtoc[1] = 17; vtoc[2] = 15; vtoc[3] = 3; vtoc[0x34] = 35; vtoc[0x35] = 16;
  vtoc.writeUInt16LE(256, 0x36);
  const entry = sector(17, 15).subarray(11, 46);
  entry[0] = 18; entry[1] = 13; entry[2] = 0x84;
  entry.set(Buffer.from("BALLBLAZER".padEnd(30, " ")).map(value => value | 128), 3);
  const binary = Buffer.alloc(4 + 27043);
  binary.writeUInt16LE(0x07fd, 0);
  binary.writeUInt16LE(27043, 2);
  binary.set([0x4c, 0x66, 0x24], 4);
  for (const patch of payload.patches) binary.set(patch.before, 4 + patch.source - 0x07fd);
  const list = sector(18, 13);
  const pages = Math.ceil(binary.length / 256);
  entry.writeUInt16LE(pages + 1, 33);
  for (let page = 0; page < pages; page++) {
    const track = 19 + (page >> 4), number = page & 15;
    list[12 + page * 2] = track;
    list[13 + page * 2] = number;
    sector(track, number).set(binary.subarray(page * 256, (page + 1) * 256));
  }
  return disk;
}

function testImport() {
  const fixture = syntheticDisk();
  assert.equal(extractProgram(fixture).length, 27043);
  for (const [offset, value, error] of [
    [17 * 4096 + 0x35, 15, /geometry/],
    [17 * 4096 + 15 * 256 + 1, 17, /sector|catalog/],
    [17 * 4096 + 15 * 256 + 13, 2, /binary/],
    [18 * 4096 + 13 * 256 + 12, 35, /sector/],
    [18 * 4096 + 13 * 256 + 1, 18, /contiguous/],
    [18 * 4096 + 13 * 256 + 5, 1, /contiguous/],
  ]) {
    const bad = Buffer.from(fixture);
    bad[offset] = value;
    assert.throws(() => extractProgram(bad), error);
  }
  const cyclic = Buffer.from(fixture);
  cyclic[18 * 4096 + 13 * 256 + 1] = 18;
  cyclic[18 * 4096 + 13 * 256 + 2] = 13;
  assert.throws(() => extractProgram(cyclic), /chain/);
  const duplicate = Buffer.from(fixture);
  duplicate[18 * 4096 + 13 * 256 + 15] = 0;
  assert.throws(() => extractProgram(duplicate), /Overlapping/);
  assert.throws(() => readDisk(fixture), /Unsupported/);
  assert.throws(() => readDisk(Buffer.alloc(1)), /Unsupported/);
  assert.throws(() => readDisk(gzipSync(Buffer.alloc(143361))), /larger|size|length/i);
  assert.throws(() => readDisk(Buffer.from([0x1f, 0x8b, 0, 0])), /header|compression|unexpected/i);
  assert.throws(() => buildPayload(Buffer.alloc(rom.length)), /Unsupported 3ric ROM/);
  assert(s.POLL_END <= 0xca00 && s.ADAPTER_END <= 0xce00 && s.NMI_END <= 0xcff0);
  const changed = new Set();
  for (const patch of payload.patches) {
    for (let i = 0; i < patch.before.length; i++) {
      const address = patch.source + i;
      assert(address >= 0x800 && address < 0x71a0);
      assert(!changed.has(address), "Overlapping patch sites");
      changed.add(address);
    }
  }
  checked("bounded gzip, exact-image/ROM guards, DOS chains and adapter extents");

  const prior = archonPayload(rom);
  for (const [key, expected] of Object.entries({
    resident: "8470be87ea3244c02f20990a2320dda9d0aac4fff0ff4fa395fcfe5d7498af16",
    game: "6aab710491e98ed5cf04461adcf4995384577dbb75359d12943fcdf84e2df88d",
    installer: "0fa820088b4500ef021093d622c5799c9b8c1901b3307c8426ec3d44ab66cc2b",
    stub: "edcf2614df6e70c3a69ddab5f05e9d5527bb736abaf180726cd1bbfd2a93f7aa",
  })) assert.equal(sha256(prior[key].bytes), expected, `Archon ${key} changed`);
  checked("Archon payloads remain byte-identical after sharing the PS/2 receiver");
}

function run(vm, cycles) {
  const elapsed = vm.runCycles(cycles);
  assert.notEqual(vm.pc(), 0, "Execution trapped to zero");
  assert.equal(vm.waiting(), false, "CPU stopped");
  return elapsed;
}

function seek(vm, address, budget = 20000000) {
  assert(vm.addBreakpoint(address));
  run(vm, budget);
  vm.removeBreakpoint(address);
  assert(vm.breakpointHit(), `Did not reach ${hex(address)}; PC=${hex(vm.pc())}`);
  assert.equal(vm.pc(), address);
}

function until(vm, predicate, budget, message) {
  let cycles = 0;
  while (!predicate()) {
    assert(cycles < budget, `${message}; PC=${hex(vm.pc())}, flags=${hex(vm.peek(0x23))}`);
    cycles += run(vm, 100000);
  }
  return cycles;
}

function type(vm, text) {
  for (const ch of text) {
    until(vm, () => !(vm.peek(0xc000) & 128), 20000000, "Previous keyboard character was not consumed");
    vm.keyDown(ch.charCodeAt(0));
    run(vm, 300000);
  }
}

async function bootDisk(woz, { firmware = rom, target = s.READ_KEY, beforeInstall } = {}) {
  Module ||= await require(path.join(root, "web", "badger6502.js"))();
  const vm = new Module.WebVM();
  try {
    vm.loadData(0, firmware.subarray(0, 65536));
    vm.seedBasicRom();
    vm.loadFont(font);
    vm.reset();
    run(vm, 5000000);
    assert(vm.insertDisk(0, woz));
    type(vm, "MON\rC600G\r");
    vm.addBreakpoint(0);
    seek(vm, payload.installer.org, 120000000);
    if (beforeInstall) beforeInstall(vm);
    vm.step();
    seek(vm, target, 20000000);
    return vm;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

function call(vm, address, setup = "") {
  const code = assemble(`.org $0300\n${setup}\njsr ${hex(address)}\ndone: jmp done`);
  vm.loadData(code.org, code.bytes);
  vm.setPC(code.org);
  seek(vm, code.symbols.DONE, 2000000);
}

async function testInstallerAndAdapter() {
  const program = extractProgram(syntheticDisk());
  const { woz } = createBootImage(program, payload);
  const bytes = Buffer.from(woz);
  assert.equal(bytes.readUInt32LE(8), crc32(bytes, 12, bytes.length));
  assert.equal(readWozSectors(bytes, Array.from({ length: 560 }, (_, i) =>
    ({ track: i >> 4, sector: i & 15 }))).length, 560);
  const vm = await bootDisk(woz, { target: 0x2466 });
  try {
    assert.equal(vm.peekMapped(0xfffa) | vm.peekMapped(0xfffb) << 8, s.NMI_ENTRY);
    for (let address = 0xe000; address < 65536; address++) {
      if (address !== 0xfffa && address !== 0xfffb) assert.equal(vm.peekMapped(address), rom[address]);
    }
    for (const patch of payload.patches)
      assert.deepEqual(Array.from({ length: patch.after.length }, (_, i) => vm.peek(patch.source + i)), patch.after);
    vm.poke(0x9953, 0x60); // synthetic fixture's continuation, not a substituted game
    vm.poke(s.INTRO_MODE, 0);
    vm.poke(0x23, 0x80);
    checked("real Disk II loader installs every guarded patch and the ROM-derived noise pool");

    const directions = [
      [0, 255], [PAD.UP, 0], [PAD.UP | PAD.LEFT, 1], [PAD.LEFT, 2],
      [PAD.DOWN | PAD.LEFT, 3], [PAD.DOWN, 4], [PAD.DOWN | PAD.RIGHT, 5],
      [PAD.RIGHT, 6], [PAD.UP | PAD.RIGHT, 7],
      [PAD.LEFT | PAD.RIGHT, 255], [PAD.UP | PAD.DOWN, 255],
      [PAD.UP | PAD.LEFT | PAD.RIGHT, 0], [240, 255],
    ];
    for (let player = 0; player < 2; player++) {
      for (const [mask, expected] of directions) {
        vm.setGamepadState(player, mask);
        call(vm, s.READ_KEY, "ldx #$35\nldy #$61\nsec\nsed");
        assert.equal(vm.regX(), 0x35);
        assert.equal(vm.regY(), 0x61);
        assert.equal(vm.status() & 9, 9, "Polling changed carry/decimal flags");
        call(vm, s.PREPARE_FIRE, "cld");
        call(vm, s.PREPARE_DIRECTION);
        call(vm, s.APPLY_PADS);
        assert.equal(vm.peek(0x14 + player), expected);
        assert.equal(vm.peek(0x15 - player), 255);
      }
      vm.setGamepadState(player, 0);
      call(vm, s.READ_KEY);
      for (const button of [PAD.B, PAD.X]) {
        vm.setGamepadState(player, button);
        call(vm, s.READ_KEY);
        call(vm, s.PREPARE_FIRE);
        call(vm, s.PREPARE_DIRECTION);
        call(vm, s.APPLY_PADS);
        assert.equal(vm.peek(0x16 + player), 255);
        vm.setGamepadState(player, 0);
        call(vm, s.READ_KEY);
        call(vm, s.PREPARE_FIRE);
        call(vm, s.PREPARE_DIRECTION);
        call(vm, s.APPLY_PADS);
        assert.equal(vm.peek(0x16 + player), 0);
      }
    }
    checked("both physical SNES shift registers: all directions, opposing axes, B/X, release and register preservation");

    vm.poke(0x23, 1);
    vm.keyDown(69);
    vm.setGamepadState(1, PAD.START);
    call(vm, s.READ_KEY);
    assert.equal(vm.regA(), 0xc5, "Pad command overwrote a physical keyboard character");
    assert.equal(vm.peek(s.PENDING_KEY), 0x8d);
    call(vm, s.ACK_KEY);
    call(vm, s.READ_KEY);
    assert.equal(vm.regA(), 0x8d, "Deferred Start did not survive the title's non-acknowledging read");
    call(vm, s.READ_KEY);
    assert.equal(vm.regA(), 0x8d);
    vm.keyDown(73);
    call(vm, s.ACK_KEY);
    assert.equal(vm.peek(0xc000), 0xc9, "Synthetic acknowledgement erased a new physical key");
    call(vm, s.READ_KEY);
    assert.equal(vm.regA(), 0xc9);
    call(vm, s.ACK_KEY);
    call(vm, s.READ_KEY);
    assert.equal(vm.regA() & 128, 0, "Held Start retriggered");
    vm.setGamepadState(1, 0);
    call(vm, s.READ_KEY);
    vm.poke(0x23, 0x80);
    vm.setGamepadState(1, PAD.START);
    call(vm, s.READ_KEY);
    assert.equal(vm.regA(), 0xa0, "Start in play did not map to Space");
    call(vm, s.ACK_KEY);
    checked("keyboard priority, deferred virtual keys, safe acknowledgement and edge-triggered Start");
  } finally { vm.delete(); }

  for (const [label, options, message] of [
    ["ROM proxy", { beforeInstall: v => v.poke(0xf1bb, v.peek(0xf1bb) ^ 1) }, "3RIC ROM MISMATCH"],
    ["banked input ABI", { firmware: (() => { const copy = Buffer.from(rom); copy[0xb500] ^= 1; return copy; })() }, "3RIC ROM MISMATCH"],
    ["game preimage", { beforeInstall: v => v.poke(payload.patches[0].source, 0) }, "BALLBLAZER PATCH MISMATCH"],
  ]) {
    const rejected = await bootDisk(woz, { ...options, target: payload.installer.symbols.HALTED });
    try {
      assert(new Session(rejected, Module).textScreen().join("\n").includes(message));
      assert.equal(rejected.textMode(), 1);
      assert(rejected.romVisible(0xfffa));
    } finally { rejected.delete(); }
    checked(`on-machine ${label} rejection screen`);
  }
}

function pulse(vm, controller, mask) {
  vm.setGamepadState(controller, mask);
  if (vm.pc() === s.READ_KEY) vm.step();
  seek(vm, s.READ_KEY, 50000000);
  vm.step();
  seek(vm, s.READ_KEY, 50000000);
  vm.setGamepadState(controller, 0);
  vm.step();
  seek(vm, s.READ_KEY, 50000000);
}

function inputBoundary(vm) {
  // Drawing swaps the player structures; sample after either keyboard or AI returns.
  if (vm.pc() === 0x04bf) vm.step();
  seek(vm, 0x04bf);
  assert.equal(vm.romVisible(0xfffa), false);
  assert.equal(vm.peekMapped(0xfffa) | vm.peekMapped(0xfffb) << 8, s.NMI_ENTRY);
}

function controlState(vm) {
  inputBoundary(vm);
  return [vm.peek(0x9e), vm.peek(0xaf), vm.peek(0x286), vm.peek(0x298)];
}

async function testGame(inputPath) {
  const input = fs.readFileSync(inputPath);
  const disk = readDisk(input);
  const result = patchBallblazer(input, rom);
  assert.deepEqual(result.woz, patchBallblazer(disk, rom).woz);
  assert.deepEqual(result.woz, patchBallblazer(gzipSync(disk), rom).woz);
  const vm = await bootDisk(result.woz);
  try {
    const screen = () => Buffer.from(vm.renderFrame());
    assert.match(new Session(vm, Module).textScreen().join("\n"), /A L L.*L A Z E R/);
    vm.setGamepadState(0, PAD.START);
    run(vm, 20000000);
    assert.equal(vm.peek(0x23), 1, "Held intro Start also started a match");
    vm.setGamepadState(0, 0);
    run(vm, 2000000);
    assert(vm.enableAudio(48000));
    let peak = 0, samples = 0;
    for (let chunk = 0; chunk < 16; chunk++) {
      run(vm, 100000);
      const audio = vm.drainAudio();
      samples += audio.length;
      for (const sample of audio) peak = Math.max(peak, Math.abs(sample));
    }
    vm.disableAudio();
    assert(samples > 90000 && peak > 0.01, "Original title music was silent");
    pulse(vm, 0, PAD.START);
    until(vm, () => vm.peek(0x23) === 0x80, 50000000, "Match did not start");
    assert.deepEqual(controlState(vm), [255, 255, 0, 0]);
    const idle = screen();
    vm.setGamepadState(0, PAD.UP | PAD.B);
    vm.setGamepadState(1, PAD.RIGHT | PAD.X);
    run(vm, 2500000);
    assert.deepEqual(controlState(vm), [0, 6, 255, 255]);
    assert.notDeepEqual(screen(), idle, "Live playfield did not change");
    vm.setGamepadState(0, PAD.LEFT | PAD.RIGHT);
    vm.setGamepadState(1, PAD.UP | PAD.DOWN);
    run(vm, 1000000);
    assert.deepEqual(controlState(vm), [255, 255, 0, 0]);
    vm.setGamepadState(0, 0);
    vm.setGamepadState(1, 0);
    type(vm, "EI");
    assert.deepEqual(controlState(vm).slice(0, 2), [0, 0]);
    vm.setGamepadState(0, PAD.RIGHT);
    vm.setGamepadState(1, PAD.LEFT);
    run(vm, 1000000);
    assert.deepEqual(controlState(vm).slice(0, 2), [6, 2]);
    vm.setGamepadState(0, 0);
    vm.setGamepadState(1, 0);
    run(vm, 1000000);
    assert.deepEqual(controlState(vm).slice(0, 2), [0, 0], "Pad release lost keyboard direction latches");
    type(vm, "DK");
    assert.deepEqual(controlState(vm), [255, 255, 0, 0]);
    vm.keyDown(66);
    assert.deepEqual(controlState(vm).slice(2), [255, 0]);
    assert.deepEqual(controlState(vm).slice(2), [0, 0]);
    vm.keyDown(78);
    assert.deepEqual(controlState(vm).slice(2), [0, 255]);
    assert.deepEqual(controlState(vm).slice(2), [0, 0]);
    vm.keyDown(51);
    assert.equal(controlState(vm)[2], 255);
    for (let frame = 0; frame < 5; frame++) assert.equal(controlState(vm)[2], 255);
    vm.setGamepadState(0, PAD.X);
    for (let frame = 0; frame < 7; frame++) assert.equal(controlState(vm)[2], 255);
    assert.equal(vm.peek(0x297), 0, "Original keyboard fire timer did not expire");
    vm.setGamepadState(0, 0);
    assert.deepEqual(controlState(vm).slice(2), [0, 0], "Pad fire leaked into the keyboard fire latch");
    pulse(vm, 1, PAD.START);
    assert.equal(vm.peek(0x19), 255);
    run(vm, 6000000);
    assert.equal(vm.peek(0x19), 255, "Pause expired without a new button edge");
    pulse(vm, 1, PAD.START);
    assert.equal(vm.peek(0x19), 0);
    checked("actual game: intro/music, two-player move/fire/release, keyboard fire timers, mixed input, pause/resume");

    pulse(vm, 0, PAD.START);
    pulse(vm, 0, PAD.SELECT);
    until(vm, () => vm.peek(0x23) === 1, 20000000, "Paused Escape did not leave the match");
    pulse(vm, 0, PAD.SELECT);
    assert.equal(vm.peek(0x23), 2);
    assert.equal(vm.peek(0x13), 2);
    pulse(vm, 0, PAD.UP);
    assert.equal(vm.peek(0x13), 1);
    type(vm, "\x0b");
    inputBoundary(vm);
    assert.equal(vm.peek(0x2a8), 1, "Player-two alternate keyboard layout was not selected");
    pulse(vm, 0, PAD.UP);
    assert.equal(vm.peek(0x13), 0);
    type(vm, "\x0b");
    inputBoundary(vm);
    assert.equal(vm.peek(0x296), 1, "Player-one alternate keyboard layout was not selected");
    pulse(vm, 0, PAD.START);
    until(vm, () => vm.peek(0x23) === 0x80, 50000000, "Restart did not start");
    type(vm, "EI");
    assert.deepEqual(controlState(vm).slice(0, 2), [0, 0]);
    type(vm, "DK");
    assert.deepEqual(controlState(vm), [255, 255, 0, 0]);
    checked("options/restart and both original alternate keyboard layouts");

    pulse(vm, 0, PAD.START);
    pulse(vm, 0, PAD.SELECT);
    pulse(vm, 0, PAD.SELECT);
    assert.equal(vm.peek(0x23), 2);
    for (let i = 0; i < 7; i++) pulse(vm, 0, PAD.RIGHT);
    assert.equal(vm.peek(0x11), 1, "One-minute match was not selected through the menu");
    pulse(vm, 0, PAD.UP);
    pulse(vm, 0, PAD.RIGHT);
    pulse(vm, 0, PAD.RIGHT);
    inputBoundary(vm);
    assert.equal(vm.peek(0x2a7), 1);
    pulse(vm, 0, PAD.UP);
    pulse(vm, 0, PAD.RIGHT);
    pulse(vm, 0, PAD.RIGHT);
    inputBoundary(vm);
    assert.equal(vm.peek(0x295), 1);
    pulse(vm, 0, PAD.START);
    until(vm, () => vm.peek(0x23) === 0x80, 50000000, "AI match did not start");
    vm.setGamepadState(0, PAD.UP | PAD.B);
    vm.setGamepadState(1, PAD.DOWN | PAD.X);
    assert.equal(vm.peek(0x295), 1);
    assert.equal(vm.peek(0x2a7), 1);
    const elapsed = until(vm, () => (vm.peek(0x23) & 8) !== 0, 500000000, "Complete timed match did not finish");
    vm.setGamepadState(0, 0);
    vm.setGamepadState(1, 0);
    run(vm, 2000000);
    pulse(vm, 0, PAD.START);
    until(vm, () => vm.peek(0x23) === 0x80, 50000000, "Post-match restart failed");
    checked(`AI choices, an unshortened one-minute match (${elapsed} cycles) and post-match restart`);
  } finally { vm.delete(); }

  const parent = path.join(root, "codegen", "out");
  fs.mkdirSync(parent, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(parent, "ballblazer-cli-"));
  try {
    const original = path.join(scratch, "original.dsk.gz"), output = path.join(scratch, "ported.woz");
    fs.writeFileSync(original, gzipSync(disk));
    const cli = (...args) => spawnSync(process.execPath, [path.join(root, "codegen", "tools", "patch-ballblazer.mjs"), ...args],
      { encoding: "utf8" });
    const created = cli(original, output);
    assert.equal(created.status, 0, created.stderr);
    assert.deepEqual(fs.readFileSync(output), Buffer.from(result.woz));
    const existing = cli(original, output);
    assert.notEqual(existing.status, 0);
    assert.match(existing.stderr, /EEXIST/);
    assert.deepEqual(fs.readFileSync(output), Buffer.from(result.woz));
    const sourceHash = sha256(fs.readFileSync(original));
    const same = cli(original, original);
    assert.notEqual(same.status, 0);
    assert.match(same.stderr, /different files/);
    assert.equal(sha256(fs.readFileSync(original)), sourceHash);
    checked("CLI creates the exact output and refuses input/output overwrite");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  console.log(`Output SHA-256: ${sha256(result.woz)}`);
}

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--disk"))
  throw new Error("Usage: node codegen\\tools\\patch-ballblazer.test.mjs [--disk <input.dsk[.gz]>]");
testImport();
await testInstallerAndAdapter();
if (args.length) await testGame(path.resolve(args[1]));
else console.log("SKIP owner-supplied game integration (pass --disk); synthetic checks do not certify game compatibility");
console.log(`PASS ${checks} Ballblazer check groups`);
