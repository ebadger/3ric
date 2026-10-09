import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPayload, INPUT_SHA256, patchWcKarate } from "./patch-wckarate.mjs";
import { buildPayload as buildArchon } from "./patch-archon.mjs";
import { readWozSectors, sha256 } from "./wozedit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
export const payload = buildPayload(rom);
export const symbols = payload.resident.symbols;
const bytesAt = (vm, address, length) =>
  Buffer.from(Array.from({ length }, (_, i) => vm.peekMapped(address + i)));
const blockSectors = [[0, 14], [13, 12], [11, 10], [9, 8], [7, 6], [5, 4], [3, 2], [1, 15]];
const block = (dsk, number) => Buffer.concat(blockSectors[number % 8].map(sector => {
  const offset = (Math.floor(number / 8) * 16 + sector) * 256;
  return dsk.subarray(offset, offset + 256);
}));

export function type(vm, text) {
  for (const ch of text) {
    for (let i = 0; i < 200 && (vm.peek(0xc000) & 0x80); i++) vm.runCycles(10000);
    assert.equal(vm.peek(0xc000) & 0x80, 0, "Previous keyboard character was not consumed");
    vm.keyDown(ch.charCodeAt(0));
    vm.runCycles(300000);
  }
}

export function seek(vm, address, budget = 2000000) {
  assert(vm.addBreakpoint(address));
  vm.runCycles(budget);
  vm.removeBreakpoint(address);
  assert(vm.breakpointHit(), `Timed out waiting for $${address.toString(16)} at $${vm.pc().toString(16)}`);
  assert.equal(vm.pc(), address);
}

export async function bootDisk(woz, firmware = rom) {
  const create = require(path.join(root, "web", "badger6502.js"));
  const module = await create();
  const vm = new module.WebVM();
  try {
    vm.loadData(0, firmware.subarray(0, 65536));
    vm.seedBasicRom();
    vm.loadFont(fs.readFileSync(path.join(root, "emulator", "Data", "fontrom.dat")));
    vm.reset();
    vm.runCycles(5000000);
    assert(vm.insertDisk(0, woz));
    type(vm, "MON\r");
    assert.match(vm.drainOutput(), /\*/);
    type(vm, "C600G\r");
    return vm;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

export async function bootGame(woz, location = "A", original) {
  const vm = await bootDisk(woz);
  try {
    seek(vm, 0x20a5, 50000000);
    assert.deepEqual(bytesAt(vm, 0xcc00, 512), payload.adapterPages, "Boot did not install the resident");
    assert.deepEqual(bytesAt(vm, 0xcf00, 256), payload.nmiPage);
    assert.deepEqual(bytesAt(vm, 0xc800, 256), rom.subarray(0xd000, 0xd100), "Sound waveform copy changed");
    if (original) {
      const picture = Buffer.concat(Array.from({ length: 16 }, (_, i) => block(original, 136 + i)));
      assert.deepEqual(bytesAt(vm, 0x4000, 8192), picture, "Title picture did not load from disk");
    }
    vm.step();
    vm.runCycles(100000);
    for (let i = 0; i < 3; i++) {
      type(vm, " ");
      vm.runCycles(2000000);
    }
    seek(vm, 0x2344);
    type(vm, location);
    seek(vm, symbols.FRAME_INPUT, 30000000);
    assert.equal(vm.peek(0xbdfe), location === "A" ? 0 : 8);
    assert.equal(vm.textMode(), 0);
    assert.equal(vm.romVisible(0xfffa), false);
    assert.equal(vm.peekMapped(0xfffa) | vm.peekMapped(0xfffb) << 8, symbols.NMI_ENTRY);
    assert.equal(vm.peek(0x51), 0, "Initial game should retain the original attract mode");
    vm.step();
    return vm;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

export function startGame(vm, players) {
  type(vm, String(players));
  seek(vm, symbols.FRAME_INPUT, 30000000);
  assert.equal(vm.peek(0x51), 1);
  assert.equal(vm.peek(0x52), players === 2 ? 1 : 0);
  vm.step();
}

function testHardwareIRQ(vm) {
  startGame(vm, 2);
  seek(vm, symbols.FRAME_INPUT);
  assert(vm.status() & 4, "Gameplay enabled IRQ while scenery hides the ROM IRQ handler");
  vm.step();
  for (const base of [0xc400, 0xc480]) {
    vm.writeBus(base + 0x0b, 0);
    vm.writeBus(base + 0x0e, 0xc0);
    vm.writeBus(base + 0x04, 10);
    vm.writeBus(base + 0x05, 0);
    vm.runCycles(1000);
    assert(vm.irqAsserted(), "The test did not assert a real device IRQ");
    const position = vm.peek(0x75);
    const timer = vm.peek(0x71);
    vm.setGamepadState(0, 128);
    vm.runCycles(10000000);
    assert(vm.irqAsserted(), "The pending IRQ was unexpectedly discarded");
    assert.notEqual(vm.peek(0x75), position, "Held IRQ froze controller movement");
    assert.notEqual(vm.peek(0x71), timer, "Held IRQ froze the game timer");
    assert(vm.status() & 4, "Gameplay unmasked the pending IRQ");
    vm.setGamepadState(0, 0);
    type(vm, "1");
    seek(vm, symbols.FRAME_INPUT, 30000000);
    assert.equal(vm.peek(0x51), 1, "Held IRQ blocked keyboard input");
    assert.equal(vm.peek(0x52), 0);
    assert(vm.status() & 4, "Restart/scenery copy unmasked the pending IRQ");
    assert(vm.irqAsserted());
    vm.step();
    vm.writeBus(base + 0x0e, 0x40);
    vm.writeBus(base + 0x0d, 0x40);
    assert.equal(vm.irqAsserted(), false);
  }
  console.log("PASS game timer, SNES movement and keyboard restart with both device IRQs held active");
}

export async function testRandomChoices(woz) {
  const vm = await bootGame(woz);
  try {
    vm.loadData(0xc900, Uint8Array.from([0xa2, 0x5a, 0xa0, 0xa5, 0xd8, 0x20, 0x76, 0x6d]));
    assert(vm.addBreakpoint(0xc908));
    const call = () => {
      vm.setPC(0xc900);
      vm.runCycles(500);
      assert.equal(vm.pc(), 0xc908, "Random-byte routine did not return");
      assert.equal(vm.regX(), 0x5a);
      assert.equal(vm.regY(), 0xa5);
    };
    vm.poke(symbols.RANDOM_LO, 0xe1);
    vm.poke(symbols.RANDOM_HI, 0xac);
    const seen = new Uint8Array(65536);
    const values = new Uint8Array(65535);
    let state = 0xace1;
    for (let i = 0; i < values.length; i++) {
      call();
      state = (state >>> 1) ^ (state & 1 ? 0xb400 : 0);
      assert.equal(vm.peek(symbols.RANDOM_LO) | vm.peek(symbols.RANDOM_HI) << 8, state);
      assert.notEqual(state, 0);
      assert.equal(seen[state], 0, "Random generator repeated before its full period");
      seen[state] = 1;
      values[i] = vm.regA();
      assert.equal(values[i], (state ^ (state >>> 8)) & 255);
    }
    assert.equal(state, 0xace1);
    vm.poke(symbols.RANDOM_LO, 0);
    vm.poke(symbols.RANDOM_HI, 0);
    call();
    assert.notEqual(vm.peek(symbols.RANDOM_LO) | vm.peek(symbols.RANDOM_HI) << 8, 0);
    vm.removeBreakpoint(0xc908);
    let longestRejection = 0;
    for (let limit = 1; limit <= 32; limit++) {
      let rejected = 0;
      for (let i = 0; i < values.length * 2; i++) {
        const value = values[i % values.length];
        rejected = (value & 31) < limit || (value & 15) < limit ? 0 : rejected + 1;
        longestRejection = Math.max(longestRejection, rejected);
      }
    }
    assert(longestRejection < 256, "A bounded random choice can reject for too long");

    vm.loadData(0xc900, Uint8Array.from([0xa2, 1, 0xa0, 0xa5, 0xa9, 0x42, 0x20, 0xe4, 0x86]));
    assert(vm.addBreakpoint(0xc909));
    for (let limit = 1; limit <= 32; limit++) {
      vm.poke(0xc901, limit);
      for (let bus = 0; bus < 256; bus++) {
        vm.poke(0xc057, bus);
        vm.poke(0x0359, 0);
        vm.poke(symbols.RANDOM_LO, bus);
        vm.poke(symbols.RANDOM_HI, 0xac);
        const scratch = vm.peek(0x53);
        vm.setPC(0xc900);
        vm.runCycles(50000);
        assert.equal(vm.pc(), 0xc909, `Random selector hung for limit ${limit}, static bus ${bus}`);
        assert(vm.regX() < limit);
        assert.equal(vm.regA(), 0x42);
        assert.equal(vm.regY(), 0xa5);
        assert.equal(vm.peek(0x53), scratch);
      }
    }
    vm.removeBreakpoint(0xc909);
    vm.loadData(0xc900, Uint8Array.from([0xa2, 1, 0xa0, 0xa5, 0xa9, 0x42, 0x38, 0x20, 0xe4, 0x86]));
    assert(vm.addBreakpoint(0xc90a));
    vm.poke(0xc057, 0);
    vm.poke(0x0359, 0);
    vm.poke(symbols.RANDOM_LO, 0);
    vm.poke(symbols.RANDOM_HI, 0);
    vm.setPC(0xc900);
    vm.runCycles(50000);
    assert.equal(vm.pc(), 0xc90a, "Revised sampler failed the exact static-bus/carry-set reproduction");
    assert.equal(vm.regX(), 0);
    // The original sampler cannot escape with the same initial carry, zero
    // seed and static bus. Discard this VM immediately after the reproduction.
    vm.loadData(0x6d76, Uint8Array.from([0xee, 0x59, 0x03]));
    vm.poke(0x0359, 0);
    vm.setPC(0xc900);
    vm.runCycles(50000);
    assert.equal(vm.breakpointHit(), false, "Original static-bus freeze was not reproduced");
    assert((vm.pc() >= 0x6d76 && vm.pc() <= 0x6d8e) || (vm.pc() >= 0x86ea && vm.pc() <= 0x86f7),
      "Original sampler failed outside the expected rejection loop");
    console.log(`PASS 65,535-state PRNG period, zero recovery, X/Y preservation and 8,192 bounded choices; max rejection streak ${longestRejection}`);
    console.log("PASS negative control reproduces the original sampler's static-bus freeze");
  } finally {
    vm.delete();
  }
}

async function testExtendedPlay(woz) {
  for (const players of [1, 2]) {
    const vm = await bootGame(woz);
    try {
      startGame(vm, players);
      vm.writeBus(0xc40b, 0);
      vm.writeBus(0xc40e, 0xc0);
      vm.writeBus(0xc404, 10);
      vm.writeBus(0xc405, 0);
      let seed = 121, timerChanges = 0, previousTimer = vm.peek(0x71);
      const states = new Set();
      for (let tick = 0; tick < 1800; tick++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        vm.setGamepadState(0, [0, 16, 32, 64, 128, 80, 144, 96, 160][seed % 9] | (seed & 256 ? 1 : 0));
        if (players === 2)
          vm.setGamepadState(1, [0, 16, 32, 64, 128][(seed >>> 16) % 5] | (seed & 512));
        vm.runCycles(250000);
        assert(vm.irqAsserted(), "Extended play did not retain the held device IRQ");
        assert(vm.status() & 4, "Extended play unmasked IRQ");
        assert.equal(vm.waiting(), false, "Extended play executed a stop/wait opcode");
        assert.equal(vm.romVisible(0x9000), false, "Extended play lost its BASIC RAM mapping");
        assert.equal(vm.peekMapped(0xfffa) | vm.peekMapped(0xfffb) << 8, symbols.NMI_ENTRY);
        const timer = vm.peek(0x71);
        if (timer !== previousTimer) timerChanges++;
        previousTimer = timer;
        states.add(vm.peek(0x5f));
      }
      assert(timerChanges > 100, `Extended play stopped: ${timerChanges} timer changes, states ${[...states]}, PC $${vm.pc().toString(16)}`);
      assert(states.has(1) && states.has(3), "Extended play did not cover fights and natural round ends");
      assert.equal(vm.drainOutput().includes("A="), false, "Extended play fell back into the monitor");
      console.log(`PASS ${players}P: 450 million cycles of SNES-only play under held IRQ, ${timerChanges} timer changes, states ${[...states].sort()}`);
    } finally {
      vm.delete();
    }
  }
}

function samplePad(vm, player, mask) {
  seek(vm, player === 0 ? 0x6a2b : 0x6a35, 20000000);
  vm.setGamepadState(player, mask);
  vm.step();
  seek(vm, player === 0 ? 0x6a2e : 0x6a38);
  const result = [vm.regA(), vm.regX() & 0x80];
  vm.step();
  return result;
}

function testPayload() {
  assert(payload.resident.symbols.ADAPTER_END <= 0xce00);
  assert(payload.resident.symbols.NMI_END <= 0xd000);
  assert(payload.installer.org + payload.installer.bytes.length <= 0x6000);
  assert(payload.copyBackground.org + payload.copyBackground.bytes.length <= 0x8589);
  assert.deepEqual(Buffer.from(payload.resident.bytes.subarray(symbols.WAIT - 0xcc00, symbols.ADAPTER_END - 0xcc00)),
    rom.subarray(0xfca8, 0xfcb4), "RAM WAIT must retain the ROM's instructions and timing");
  assert.equal(symbols.WAIT >> 8, (symbols.ADAPTER_END - 1) >> 8, "RAM WAIT gained a branch page-crossing penalty");
  const wrongRom = Buffer.from(rom);
  wrongRom[0xb500] ^= 1;
  assert.throws(() => buildPayload(wrongRom), /Unsupported 3ric ROM/);
  assert.throws(() => patchWcKarate(Buffer.alloc(143360), rom), /Unsupported World Karate/);
  assert.throws(() => patchWcKarate(Buffer.alloc(10), rom), /Unsupported World Karate/);
  const archon = buildArchon(rom);
  for (const [name, expected] of Object.entries({
    resident: "8470be87ea3244c02f20990a2320dda9d0aac4fff0ff4fa395fcfe5d7498af16",
    game: "6aab710491e98ed5cf04461adcf4995384577dbb75359d12943fcdf84e2df88d",
    installer: "0fa820088b4500ef021093d622c5799c9b8c1901b3307c8426ec3d44ab66cc2b",
    stub: "edcf2614df6e70c3a69ddab5f05e9d5527bb736abaf180726cd1bbfd2a93f7aa",
  })) assert.equal(sha256(archon[name].bytes), expected, `Shared input extraction changed Archon's ${name}`);
  console.log("PASS payload bounds, revision rejection and byte-identical Archon payloads");
}

function testSectors(input, result) {
  assert.equal(sha256(input), INPUT_SHA256, "Patcher mutated its input");
  assert.equal(result.dsk.length, input.length);
  const restored = Buffer.from(result.dsk);
  const index = block(input, 8);
  for (const patch of result.patches) {
    const before = Buffer.from(patch.before, "hex"), after = Buffer.from(patch.after, "hex");
    assert.equal(before.length, after.length);
    for (let i = 0; i < before.length; i++) {
      const offset = patch.address - 0x2000 + i;
      const fileBlock = offset >> 9, diskBlock = index[fileBlock] | index[256 + fileBlock] << 8;
      const sector = blockSectors[diskBlock % 8][(offset >> 8) & 1];
      const diskOffset = (Math.floor(diskBlock / 8) * 16 + sector) * 256 + (offset & 255);
      assert.equal(input[diskOffset], before[i]);
      assert.equal(restored[diskOffset], after[i]);
      restored[diskOffset] = before[i];
    }
  }
  assert.deepEqual(restored, input, "Changes escaped the declared game-file patches");
  for (const number of [0, 1, 2, 3, 4, 5, 6, 8, 88])
    assert.deepEqual(block(result.dsk, number), block(input, number), "Boot/filesystem metadata changed");
  const backgrounds = [168, 152, 184, 200, 264, 216, 232, 248];
  for (const first of [136, ...backgrounds]) {
    for (let i = 0; i < 16; i++)
      assert.deepEqual(block(result.dsk, first + i), block(input, first + i), "An original picture changed");
  }
  const coordinates = Array.from({ length: 560 }, (_, i) => ({ track: i >> 4, sector: i & 15 }));
  for (const sector of readWozSectors(result.woz, coordinates)) {
    const logical = sector.sector === 15 ? 15 : sector.sector * 7 % 15;
    const offset = (sector.track * 16 + logical) * 256;
    assert.deepEqual(sector.data, result.dsk.subarray(offset, offset + 256));
  }
  console.log("PASS reversible disk edits, unchanged allocation/pictures and all 560 WOZ sectors");
}

function testCli(inputPath, expected) {
  const out = path.join(root, "codegen", "out");
  fs.mkdirSync(out, { recursive: true });
  const temp = fs.mkdtempSync(path.join(out, "wckarate-cli-"));
  const output = path.join(temp, "candidate.woz");
  const wrong = path.join(temp, "wrong.dsk");
  const run = (...args) => spawnSync(process.execPath,
    [path.join(root, "codegen", "tools", "patch-wckarate.mjs"), ...args], { encoding: "utf8" });
  try {
    const valid = run(inputPath, output);
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(fs.readFileSync(output), expected);
    const repeat = run(inputPath, output);
    assert.notEqual(repeat.status, 0);
    assert.match(repeat.stderr, /EEXIST/);
    assert.deepEqual(fs.readFileSync(output), expected, "Existing output was overwritten");
    assert.notEqual(run(inputPath, inputPath).status, 0);
    assert.equal(sha256(fs.readFileSync(inputPath)), INPUT_SHA256);
    fs.writeFileSync(wrong, Buffer.alloc(143360));
    fs.unlinkSync(output);
    assert.notEqual(run(wrong, output).status, 0);
    assert.equal(fs.existsSync(output), false, "Rejected input created an output");
  } finally {
    for (const file of [output, wrong]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(temp);
  }
  console.log("PASS CLI creation, revision errors and refusal to overwrite input/output");
}

function testControls(vm) {
  startGame(vm, 2);
  const cases = [[0, 15], [16, 14], [32, 13], [64, 11], [128, 7],
    [16 | 64, 10], [32 | 128, 5], [16 | 32, 15], [64 | 128, 15]];
  for (const player of [0, 1]) {
    for (const [mask, expected] of cases) {
      assert.deepEqual(samplePad(vm, player, mask), [expected, 0], `Pad ${player + 1}, mask ${mask}`);
      assert.deepEqual(samplePad(vm, player, 0), [15, 0], "Release retained a direction");
    }
    for (const button of [1, 1 << 9]) {
      assert.deepEqual(samplePad(vm, player, 128 | button), [7, 128]);
      assert.deepEqual(samplePad(vm, player, 0), [15, 0]);
    }
  }
  for (const player of [0, 1]) {
    const position = vm.peek(0x75 + player);
    vm.setGamepadState(player, player === 0 ? 128 : 64);
    vm.runCycles(800000);
    vm.setGamepadState(player, 0);
    const moved = vm.peek(0x75 + player);
    assert(player === 0 ? moved > position : moved < position, `Fighter ${player + 1} did not move`);
  }
  for (const player of [0, 1]) {
    vm.setGamepadState(player, (player === 0 ? 128 : 64) | 1);
    seek(vm, player === 0 ? 0x6a2b : 0x6a35, 20000000);
    vm.step();
    seek(vm, 0x6a55);
    assert(vm.peek(0x0340) & 16, "Attack modifier did not reach game-owned move selection");
    seek(vm, 0x6a9f);
    assert(vm.regA() > 0, "Attack selected no animation");
    vm.step();
    vm.runCycles(150000);
    vm.setGamepadState(player, 0);
  }
  startGame(vm, 2);
  type(vm, "\x0b"); // original Ctrl-K selects keyboard for player one
  type(vm, "F");
  vm.runCycles(500000);
  assert.equal(vm.peek(0x0302), 0);
  assert.equal(vm.peek(0x6bb6), 8);
  type(vm, " ");
  vm.runCycles(100000);
  assert.equal(vm.peek(0x6bb7), 0x80, "Keyboard attack toggle was lost");
  type(vm, "J");
  vm.runCycles(100000);
  assert.equal(vm.peek(0x6c23), 4, "Player two's original keyboard grid was lost");
  type(vm, "\r");
  vm.runCycles(100000);
  assert.equal(vm.peek(0x6c24), 0x80);
  assert.deepEqual(samplePad(vm, 1, 128), [7, 0], "Pad two did not override its keyboard latch");
  assert.deepEqual(samplePad(vm, 1, 0), [15, 0]);
  assert.deepEqual(samplePad(vm, 1, 0), [15, 0], "Released pad resurrected stale keyboard motion");
  type(vm, "\x0a");
  vm.runCycles(100000);
  assert.equal(vm.peek(0x0302), 1, "Ctrl-J did not restore joystick mode");
  type(vm, "\x1b");
  seek(vm, 0x6dcc);
  const positions = bytesAt(vm, 0x75, 2);
  vm.runCycles(1000000);
  assert.deepEqual(bytesAt(vm, 0x75, 2), positions, "Pause did not hold the fighters");
  const sound = vm.peek(0x0300);
  type(vm, "\x13"); // a new non-Esc key resumes, as in the original
  vm.runCycles(100000);
  assert.equal(vm.peek(0x0300), sound ^ 1);
  assert.equal(vm.peek(0x0301), sound ^ 1);
  type(vm, "\x13");
  vm.runCycles(100000);
  assert.equal(vm.peek(0x0300), sound);
  console.log("PASS two real SNES pads, release/opposites, movement/attacks, both keyboard grids, pause and sound");
}

function testStart(vm) {
  for (const player of [0, 1]) {
    vm.setGamepadState(player, 8);
    seek(vm, 0x6e38, 20000000);
    assert.equal(vm.peek(0x51), 1);
    assert.equal(vm.peek(0x52), player);
    vm.step();
    seek(vm, symbols.FRAME_INPUT, 30000000);
    vm.step();
    assert(vm.addBreakpoint(0x6e38));
    vm.runCycles(1000000);
    vm.removeBreakpoint(0x6e38);
    assert.equal(vm.breakpointHit(), false, "Held Start repeatedly restarted the game");
    vm.setGamepadState(player, 0);
    vm.runCycles(100000);
  }
  seek(vm, symbols.FRAME_INPUT);
  vm.keyDown("2".charCodeAt(0));
  vm.setGamepadState(0, 8);
  vm.step();
  seek(vm, 0x6e38);
  assert.equal(vm.peek(0x52), 1, "Pad Start overwrote a pending keyboard character");
  vm.setGamepadState(0, 0);
  vm.step();
  seek(vm, symbols.FRAME_INPUT, 30000000);
  vm.step();
  console.log("PASS fresh/held pad Start and preservation of pending keyboard input");
}

function testAudio(vm) {
  startGame(vm, 1);
  assert(vm.enableAudio(48000));
  vm.setGamepadState(0, 128 | 1);
  const capture = cycles => {
    let peak = 0, samples = 0;
    for (let elapsed = 0; elapsed < cycles; elapsed += 20000) {
      vm.runCycles(20000);
      for (const value of vm.drainAudio()) {
        assert(Number.isFinite(value), "Speaker produced invalid PCM");
        peak = Math.max(peak, Math.abs(value));
        samples++;
      }
    }
    return { peak, samples };
  };
  const sound = capture(5000000);
  assert(sound.samples > 250000 && sound.peak > 0.05, "Gameplay did not produce real speaker PCM");
  type(vm, "\x13");
  assert.equal(vm.peek(0x0301), 0);
  capture(500000);
  assert(capture(1000000).peak < 0.0001, "Muted gameplay still produced speaker audio");
  vm.setGamepadState(0, 0);
  type(vm, "\x13");
  vm.disableAudio();
  console.log("PASS actual gameplay speaker PCM and silence after the original mute command");
}

function testScenery(vm, input, location) {
  const starts = location === "A" ? [168, 152, 184, 200] : [264, 216, 232, 248];
  const vectors = bytesAt(vm, 0xfff8, 8);
  // Focused guest calls exercise every original scenery read/cache path; they
  // are not a claim that the test wins every round to reach those locations.
  vm.loadData(0xc900, Uint8Array.from([0x20, 0x2e, 0x85, 0xdb]));
  for (let scene = 0; scene < starts.length; scene++) {
    vm.poke(0x0332, scene);
    vm.poke(0x85cb, 0xff);
    vm.setPC(0xc900);
    seek(vm, 0x85ba, 30000000);
    const picture = Buffer.concat(Array.from({ length: 16 }, (_, i) => block(input, starts[scene] + i)));
    assert.deepEqual(bytesAt(vm, 0x2000, 8192), picture, `Wrong scenery ${location}/${scene}`);
    vm.step();
    seek(vm, 0x8551);
    const decorated = bytesAt(vm, 0x2000, 0x1ff8);
    vm.step();
    seek(vm, 0xc903);
    assert.deepEqual(bytesAt(vm, 0xe000, 0x1ff8), decorated, "Scenery cache lost image pixels");
    assert.deepEqual(bytesAt(vm, 0xfff8, 8), vectors, "Scenery refill corrupted the interrupt vectors");
  }
  console.log(`PASS ${location}: all four real disk scenery reads and vector-safe cache refills`);
}

async function testImage(inputPath) {
  const input = fs.readFileSync(inputPath);
  const result = patchWcKarate(input, rom);
  testSectors(input, result);
  testCli(inputPath, result.woz);
  const wrongRom = Buffer.from(rom);
  wrongRom[0xb500] ^= 1;
  const rejected = await bootDisk(result.woz, wrongRom);
  try {
    rejected.runCycles(50000000);
    const message = "3RIC ROM MISMATCH - RESET";
    assert.equal(bytesAt(rejected, 0x400, message.length).map(v => v & 127).toString(), message);
    assert.equal(rejected.textMode(), 1);
  } finally {
    rejected.delete();
  }
  console.log("PASS on-machine input-ROM ABI rejection");
  for (const location of ["A", "E"]) {
    const vm = await bootGame(result.woz, location, input);
    try {
      startGame(vm, 1);
      if (location === "A") {
        testHardwareIRQ(vm);
        testControls(vm);
        testStart(vm);
        testAudio(vm);
      }
      testScenery(vm, input, location);
    } finally {
      vm.delete();
    }
  }
  await testRandomChoices(result.woz);
  await testExtendedPlay(result.woz);
  console.log("PASS actual output WOZ cold boots into both locations and single/two-player gameplay");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--dsk"))
      throw new Error("Usage: node codegen\\tools\\patch-wckarate.test.mjs [--dsk <original.dsk>]");
    testPayload();
    if (args.length) await testImage(path.resolve(args[1]));
    else console.log("SKIP owner-supplied disk integration (pass --dsk <original.dsk>)");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
