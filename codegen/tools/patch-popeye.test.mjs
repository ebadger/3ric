import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readWozSectors, sha256 } from "./wozedit.mjs";
import { buildPayload, INPUT_SHA256, patchPopeye, readDosFiles, writePopeye } from "./patch-popeye.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const artifact = (vm, start, length) =>
  Buffer.from(Array.from({ length }, (_, offset) => vm.peekMapped(start + offset)));
const position = vm => vm.peek(0x94a0) * 7 + vm.peek(0x94a1);

function syntheticDisk(entries) {
  const disk = Buffer.alloc(143360);
  const sector = (track, number) => disk.subarray((track * 16 + number) * 256, (track * 16 + number + 1) * 256);
  const vtoc = sector(17, 0);
  vtoc[1] = 17;
  vtoc[2] = 15;
  vtoc[0x34] = 35;
  vtoc[0x35] = 16;
  vtoc.writeUInt16LE(256, 0x36);
  let next = 16;
  const allocate = () => {
    if (next === 17 * 16) next = 18 * 16;
    assert(next < 560);
    return next++;
  };
  const catalogs = [15, 14];
  for (let index = 0; index < entries.length; index++) {
    const [name, address, length] = entries[index];
    const catalog = sector(17, catalogs[Math.floor(index / 7)]);
    if (index >= 7) {
      sector(17, 15)[1] = 17;
      sector(17, 15)[2] = 14;
    }
    const offset = 11 + index % 7 * 35;
    const listIndex = allocate(), list = sector(listIndex >> 4, listIndex & 15);
    const pages = Math.ceil((length + 4) / 256);
    catalog[offset] = listIndex >> 4;
    catalog[offset + 1] = listIndex & 15;
    catalog[offset + 2] = 4;
    catalog.fill(0xa0, offset + 3, offset + 33);
    catalog.set(Buffer.from(name).map(byte => byte | 128), offset + 3);
    catalog.writeUInt16LE(pages + 1, offset + 33);
    for (let page = 0; page < pages; page++) {
      const dataIndex = allocate(), data = sector(dataIndex >> 4, dataIndex & 15);
      list[12 + page * 2] = dataIndex >> 4;
      list[13 + page * 2] = dataIndex & 15;
      data.fill((index + page) & 255);
      if (page === 0) {
        data.writeUInt16LE(address);
        data.writeUInt16LE(length, 2);
      }
    }
  }
  return disk;
}

function testTools() {
  const disk = syntheticDisk([["FIRST", 0x0800, 300], ["SECOND", 0x1234, 17]]);
  const files = readDosFiles(disk);
  assert.equal(files.size, 2);
  assert.equal(files.get("FIRST").sectors.length, 2);
  assert.equal(files.get("SECOND").bytes.readUInt16LE(0), 0x1234);
  assert.throws(() => readDosFiles(disk.subarray(1)), /143360/);
  const bad = (offset, value, expected) => {
    const malformed = Buffer.from(disk);
    malformed[offset] = value;
    assert.throws(() => readDosFiles(malformed), expected);
  };
  bad(17 * 4096 + 0x34, 40, /geometry/);
  bad(17 * 4096 + 1, 35, /Invalid DOS sector/);
  bad(17 * 4096 + 15 * 256 + 1, 17, /overlapping/);
  bad(4096 + 1, 1, /overlapping/);
  bad(4096 + 12, 35, /Invalid DOS sector/);
  bad(4096 + 5, 1, /Non-contiguous/);
  bad(17 * 4096 + 15 * 256 + 44, 9, /count mismatch/);
  const hole = Buffer.from(disk);
  hole.fill(0, 4096 + 12, 4096 + 14);
  assert.throws(() => readDosFiles(hole), /Sparse/);
  assert.throws(() => patchPopeye(disk, rom), /Unsupported Popeye disk/);
  assert.throws(() => buildPayload(files), /Unexpected DOS binary/);
  const fixture = syntheticDisk([
    ["P", 0x2000, 0x2000], ["MUSIC", 0x8500, 0x02ed], ["MINUET", 0x4000, 0x0900],
    ["RP", 0x1f70, 0x0090], ["SO", 0x0800, 0x022d], ["P.ANM", 0x6cc8, 0x2938],
    ["P1.PAK", 0x6000, 0x1079], ["P2.PAK", 0x6000, 0x0b39], ["P3.PAK", 0x6000, 0x13bf],
    ["P.OB1", 0x0800, 0x0b77], ["P.OB2", 0x0800, 0x0c14], ["P.OB3", 0x0800, 0x0bcb],
  ]);
  const payload = buildPayload(readDosFiles(fixture));
  assert.equal(payload.org, 0xa000);
  assert(payload.pages <= 15);
  assert(payload.org + payload.bytes.length < 0xb000);
  assert(payload.boot.length <= 256);
  assert.equal(payload.boot[0], 1);
  const controls = Buffer.from(payload.bytes.subarray(payload.symbols.CONTROLS - payload.org,
    payload.symbols.FILE_TABLE - payload.org));
  assert.equal(controls.length, 160, "Each on-screen control line must be exactly 40 columns");
  console.log("PASS synthetic DOS bounds, cycles/overlap, headers, image guard and assembled memory/boot/UI bounds");
}

export function run(vm, budget, collect = () => {}) {
  let cycles = 0;
  while (cycles < budget) {
    cycles += vm.runCycles(Math.min(100000, budget - cycles));
    collect(vm.drainAudio());
    if (vm.breakpointHit()) break;
  }
  return cycles;
}

export function seek(vm, address, budget = 2000000, collect) {
  assert(vm.addBreakpoint(address));
  try {
    run(vm, budget, collect);
    assert(vm.breakpointHit(), `Waiting for $${address.toString(16)}, stopped at $${vm.pc().toString(16)}`);
  } finally {
    vm.removeBreakpoint(address);
  }
}

export async function bootPopeye(result) {
  const create = require(path.join(root, "web", "badger6502.js"));
  const module = await create(), vm = new module.WebVM();
  try {
    vm.loadData(0, rom.subarray(0, 65536));
    vm.seedBasicRom();
    vm.loadFont(fs.readFileSync(path.join(root, "emulator", "Data", "fontrom.dat")));
    vm.reset();
    run(vm, 5000000);
    assert(vm.insertDisk(0, result.woz));
    for (const ch of "MON\rC600G\r") {
      assert.equal(vm.peek(0xc000) & 128, 0, "Previous boot input was not consumed");
      vm.keyDown(ch.charCodeAt(0));
      run(vm, 300000);
    }
    seek(vm, result.payload.symbols.TITLE_WAIT, 80000000);
    return vm;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

function testImage(result, input, directory) {
  assert.equal(sha256(input), INPUT_SHA256);
  const badRom = Buffer.from(rom);
  badRom[0xb500] ^= 1;
  assert.throws(() => patchPopeye(input, badRom), /Unsupported 3ric ROM/);
  const coordinates = Array.from({ length: 560 }, (_, index) => ({ track: index >> 4, sector: index & 15 }));
  const sectors = readWozSectors(result.woz, coordinates);
  for (const field of sectors) {
    const logical = field.sector === 15 ? 15 : field.sector * 7 % 15;
    const offset = (field.track * 16 + logical) * 256;
    assert.deepEqual(Buffer.from(field.data), result.disk.subarray(offset, offset + 256));
  }
  const restored = Buffer.from(result.disk), files = readDosFiles(input);
  for (const patch of result.patches) {
    const file = files.get(patch.file);
    const origin = patch.file === "MUSIC" ? 0x8500 : 0x6000;
    const offset = patch.address - origin + 4;
    const before = Buffer.from(patch.before, "hex"), after = Buffer.from(patch.after, "hex");
    for (let index = 0; index < before.length; index++) {
      const position = file.sectors[(offset + index) >> 8];
      const diskOffset = (position.track * 16 + position.sector) * 256 + ((offset + index) & 255);
      assert.equal(restored[diskOffset], after[index]);
      restored[diskOffset] = before[index];
    }
  }
  assert.deepEqual(restored.subarray(4096), input.subarray(4096),
    "Disk edits escaped the replacement boot track and declared compatibility patches");
  const output = path.join(directory, "popeye.woz");
  writePopeye(path.join(directory, "source.do"), output);
  assert.deepEqual(fs.readFileSync(output), result.woz);
  assert.throws(() => writePopeye(path.join(directory, "source.do"), output), /EEXIST/);
  assert.throws(() => writePopeye(path.join(directory, "source.do"), path.join(directory, "source.do")), /EEXIST/);
  assert.deepEqual(fs.readFileSync(path.join(directory, "source.do")), input);
  console.log("PASS exact disk/ROM guards, exclusive output, all 560 encoded sectors and bounded reversible edits");
}

async function testGame(result) {
  const s = result.payload.symbols, vm = await bootPopeye(result);
  let peak = 0, frames = 0;
  const audio = samples => {
    frames += samples.length / 2;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  };
  function frame(mask = 0, key) {
    if (vm.pc() !== s.READ_FIRE) seek(vm, s.READ_FIRE, 5000000, audio);
    assert(vm.setGamepadState(0, mask));
    if (key !== undefined) vm.keyDown(key);
    vm.step();
    seek(vm, s.INPUT_READY, 2000000, audio);
    vm.step();
    seek(vm, s.READ_FIRE, 5000000, audio);
  }
  function collision() {
    vm.setGamepadState(0, 0);
    if (vm.pc() === s.GAME_CALL) vm.step();
    seek(vm, 0x6865, 5000000, audio);
    for (let i = 0; i < 3; i++) vm.poke(0x94ac + i, vm.peek(0x94a0 + i));
    vm.step();
    seek(vm, s.GAME_EVENT, 2000000, audio);
    assert.equal(vm.peek(0xfd), 1, "The original engine did not report the injected collision");
  }
  try {
    assert.equal(vm.textMode(), 0);
    assert.equal(vm.lores(), 0);
    assert.equal(vm.mixed(), 1);
    assert.equal(vm.romVisible(0xfffa), true);
    assert.equal(vm.romVisible(0x9000), false);
    assert(vm.enableAudio(48000));
    vm.step();
    run(vm, 5000000, audio);
    assert(peak > 0.01 && frames > 10000, "Original title music did not produce PCM");
    vm.setGamepadState(0, 1 << 3);
    seek(vm, s.GAME_CALL, 80000000, audio);
    vm.setGamepadState(0, 0);
    assert.equal(vm.peek(s.LEVEL), 1);
    assert.equal(vm.peek(s.LIVES_GLYPH), 17);
    assert.equal(vm.peek(0xea), 20);
    assert.equal(vm.mixed(), 0);
    console.log("PASS actual WOZ cold boot, original title music, delayed controller Start and first-level loading");
    peak = 0;
    frames = 0;

    vm.step();
    seek(vm, s.READ_FIRE);
    const initial = position(vm);
    for (let i = 0; i < 8; i++) frame(1 << 7);
    assert(position(vm) > initial, "Right did not move Popeye right");
    const right = position(vm);
    for (let i = 0; i < 8; i++) frame(1 << 6);
    assert(position(vm) < right, "Left did not move Popeye left");
    frame();
    const stopped = position(vm);
    for (let i = 0; i < 3; i++) frame();
    assert.equal(position(vm), stopped, "Released D-pad did not stop movement");
    frame((1 << 6) | (1 << 7));
    assert.equal(position(vm), stopped, "Opposing directions did not cancel");
    frame(0, "D".charCodeAt(0));
    for (let i = 0; i < 3; i++) frame();
    assert(position(vm) > stopped, "Keyboard D did not move right");
    frame(0, "X".charCodeAt(0));
    const keyStop = position(vm);
    for (let i = 0; i < 3; i++) frame();
    assert.equal(position(vm), keyStop, "Keyboard X did not stop the latched direction");
    frame(1);
    assert([10, 11].includes(vm.peek(0x9400)), "Pad punch did not enter the original punch animation");
    for (let i = 0; i < 6; i++) frame();
    frame(0, 32);
    assert([10, 11].includes(vm.peek(0x9400)), "Space did not punch");
    for (let i = 0; i < 10; i++) frame();
    assert(peak > 0.01 && frames > 10000, "Original gameplay sound did not produce PCM");
    console.log("PASS real engine movement, keyboard direction/stop, punch, controller release and opposing directions");

    // Position at a real ladder for a controlled geometry fixture, then use
    // actual controller input and the game's unchanged climbing logic.
    vm.poke(0x94a0, 14);
    vm.poke(0x94a1, 0);
    vm.poke(0x94a2, 159);
    const beforeClimb = vm.peek(0x94a2);
    for (let i = 0; i < 10; i++) frame(1 << 4);
    assert(vm.peek(0x94a2) < beforeClimb, "Up did not climb the ladder");
    const up = vm.peek(0x94a2);
    for (let i = 0; i < 5; i++) frame(1 << 5);
    assert(vm.peek(0x94a2) > up, "Down did not descend");
    frame();
    console.log("PASS original ladder movement through real D-pad input (controlled starting position)");

    const fieldHashes = new Set();
    for (const [expectedLevel, speed] of [[2, 30], [3, 20], [1, 10], [2, 1], [3, 1], [1, 1]]) {
      vm.setGamepadState(0, 0);
      vm.poke(0xea, 0); // Controlled completion; the game itself must return event 2.
      vm.step();
      seek(vm, s.GAME_EVENT, 5000000, audio);
      assert.equal(vm.peek(0xfd), 2);
      vm.step();
      seek(vm, s.GAME_CALL, 80000000, audio);
      assert.equal(vm.peek(s.LEVEL), expectedLevel);
      assert.equal(vm.peek(s.SPEED), speed);
      assert.equal(vm.peek(0xfc), speed);
      assert.equal(vm.peek(0xea), 20);
      assert.equal(vm.romVisible(0xfffa), true);
      assert.equal(vm.romVisible(0x9000), false);
      assert.equal(vm.peek(0x6000), 0x4c);
      const currentFiles = readDosFiles(result.disk);
      const engine = currentFiles.get(`P.OB${expectedLevel}`).bytes;
      assert.deepEqual(artifact(vm, 0x6000, 3), engine.subarray(4, 7));
      fieldHashes.add(sha256(artifact(vm, 0x4000, 8192)));
      vm.step();
      seek(vm, s.READ_FIRE);
      frame(1 << 7);
      frame();
    }
    assert.equal(fieldHashes.size, 3, "Three distinct level backgrounds were not loaded from disk");
    assert.equal(vm.peek(s.DIFFICULTY), 30);
    console.log("PASS original-engine completion events, all three disk-loaded levels, wraparound and difficulty/speed floors");

    frame(0, "X".charCodeAt(0));
    const score = [6, 5, 4, 3, 2];
    for (let i = 0; i < 5; i++) vm.poke(0xe0 + i, score[i]);
    for (const glyph of [16, 15, 14]) {
      collision();
      vm.step();
      seek(vm, s.GAME_CALL, 5000000, audio);
      assert.equal(vm.peek(s.LIVES_GLYPH), glyph);
      assert.deepEqual(artifact(vm, 0xe0, 5), Buffer.from(score), "Death discarded the score");
    }
    collision();
    vm.step();
    seek(vm, s.RESTART_WAIT, 5000000, audio);
    assert.equal(vm.textMode(), 1);
    assert.equal(vm.peek(s.LIVES_GLYPH), 13);
    vm.keyDown(32);
    vm.step();
    seek(vm, s.GAME_CALL, 80000000, audio);
    assert.equal(vm.peek(s.LEVEL), 1);
    assert.equal(vm.peek(s.LIVES_GLYPH), 17);
    assert.deepEqual(artifact(vm, 0xe0, 5), Buffer.alloc(5));
    assert.deepEqual(artifact(vm, 0xe5, 5), Buffer.from(score));
    console.log("PASS original collision/death events, spare lives, game-over, keyboard restart and high-score retention");

    vm.step();
    seek(vm, s.READ_FIRE);
    vm.poke(0xed, 10);
    collision();
    vm.step();
    seek(vm, s.RESTART_WAIT, 5000000, audio);
    assert.equal(vm.peek(s.GOAL), 40, "Miss-limit game over lost the original 40-item restart rule");
    vm.setGamepadState(0, 1 << 3);
    vm.step();
    seek(vm, s.GAME_CALL, 80000000, audio);
    vm.setGamepadState(0, 0);
    assert.equal(vm.peek(0xea), 40);
    assert.equal(vm.peek(s.LIVES_GLYPH), 17);
    console.log("PASS miss-limit game over and controller restart with the original 40-item goal");

    vm.step();
    seek(vm, s.READ_FIRE);
    vm.drainOutput();
    vm.keyDown("Q".charCodeAt(0));
    vm.step();
    run(vm, 3000000, audio);
    assert.equal(vm.textMode(), 1, "Quit did not restore text mode");
    const output = vm.drainOutput();
    assert.match(output, /\*/, "Quit did not return to the monitor");
    for (const ch of "0300:5A\r") {
      assert.equal(vm.peek(0xc000) & 128, 0);
      vm.keyDown(ch.charCodeAt(0));
      run(vm, 300000, audio);
    }
    assert.equal(vm.peek(0x300), 0x5a, "Restored monitor did not execute a typed memory command");
    assert.equal(vm.readBus(0xc20e), vm.peek(s.SAVED_VIA_IER),
      "Quit did not restore the ROM's input interrupt enables");
    assert(peak > 0.01 && frames > 100000);
    console.log("PASS sound through real VM PCM and a usable monitor exit");
  } finally {
    vm.delete();
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--disk"))
    throw new Error("Usage: node patch-popeye.test.mjs [--disk <original.do>]");
  testTools();
  if (args.length === 0) {
    console.log("SKIP owner-supplied game integration; pass --disk <original.do>");
    return;
  }
  const input = fs.readFileSync(args[1]), result = patchPopeye(input, rom);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "3ric-popeye-"));
  try {
    fs.writeFileSync(path.join(directory, "source.do"), input);
    testImage(result, input, directory);
    await testGame(result);
  } finally {
    for (const name of ["source.do", "popeye.woz"]) {
      const filename = path.join(directory, name);
      if (fs.existsSync(filename)) fs.unlinkSync(filename);
    }
    fs.rmdirSync(directory);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(error); process.exitCode = 1; });
