import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildPayload as buildArchon } from "./patch-archon.mjs";
import { buildPayload, INPUT_SHA256, patchSilentService } from "./patch-silent-service.mjs";
import { readWozSectors, sha256 } from "./wozedit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const payload = buildPayload(rom);
const s = payload.resident.symbols;
const hex = value => `$${value.toString(16)}`;
const word = (vm, address) => vm.peek(address) | vm.peek(address + 1) << 8;
const putWord = (vm, address, value) => { vm.poke(address, value); vm.poke(address + 1, value >> 8); };
const bytesAt = (vm, address, length) =>
  Buffer.from(Array.from({ length }, (_, i) => vm.peekMapped(address + i)));

function text(vm) {
  return Array.from({ length: 24 }, (_, row) => {
    const address = 0x400 + (row & 7) * 128 + (row >> 3) * 40;
    return bytesAt(vm, address, 40).map(value => value & 127).toString("ascii");
  }).join("\n");
}

async function machine(firmware = rom) {
  const create = require(path.join(root, "web", "badger6502.js"));
  const module = await create();
  const vm = new module.WebVM();
  vm.loadData(0, firmware.subarray(0, 65536));
  vm.seedBasicRom();
  vm.loadFont(fs.readFileSync(path.join(root, "emulator", "Data", "fontrom.dat")));
  vm.reset();
  vm.runCycles(5000000);
  vm.drainOutput();
  return vm;
}

function run(vm, budget) {
  let cycles = 0;
  let energy = 0, samples = 0;
  while (cycles < budget) {
    cycles += vm.runCycles(Math.min(100000, budget - cycles));
    const pcm = vm.drainAudio();
    for (const value of pcm) energy += value * value;
    samples += pcm.length;
    if (vm.breakpointHit()) break;
  }
  assert(!vm.waiting(), `CPU stopped at ${hex(vm.pc())}`);
  return samples ? Math.sqrt(energy / samples) : 0;
}

function key(vm, value, budget = 300000) {
  for (let i = 0; i < 200 && (vm.peek(0xc000) & 128); i++) run(vm, 10000);
  assert.equal(vm.peek(0xc000) & 128, 0, "Previous key was not consumed");
  vm.keyDown(typeof value === "string" ? value.charCodeAt(0) : value);
  run(vm, budget);
}

function seek(vm, address, budget = 5000000) {
  vm.addBreakpoint(address);
  run(vm, budget);
  vm.removeBreakpoint(address);
  assert(vm.breakpointHit(), `Timed out at ${hex(vm.pc())}, waiting for ${hex(address)}`);
  assert.equal(vm.pc(), address);
}

async function bootDisk(woz, firmware = rom) {
  const vm = await machine(firmware);
  try {
    assert(vm.insertDisk(0, woz), "Disk insertion failed");
    for (const ch of "MON\rC600G\r") key(vm, ch);
    run(vm, 50000000);
    return vm;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

function installResident(vm) {
  for (const address of [0xc800, 0xc900, 0xcc00, 0xcd00, 0xcf00])
    vm.loadData(address, payload.resident.bytes.subarray(address - 0xc800, address - 0xc800 + 256));
}

async function testInterpreter() {
  const vm = await machine();
  try {
    installResident(vm);
    vm.writeBus(0xc20e, 0x90);
    const cases = [
      [0, 1, 3, true], [2, 1, 3, true], [3, 1, 3, false],
      [3, -1, 0, true], [1, -1, 0, true], [0, -1, 0, false],
      [0xffff, 1, 3, true], [0, -1, 0xfffd, true], [8, 2, 9, false],
    ];
    let injected = 0;
    for (const nested of [false, true]) {
      for (const [initial, step, limit, continues] of cases) {
        const sp = nested ? 0xeb : 0xf5;
        const frame = [0x00, 0x60, 0x50, 0x10, step & 255, step >> 8 & 255,
          limit & 255, limit >> 8 & 255, 0xaa, 0xbb];
        vm.loadData(0x1f6, Uint8Array.from(frame));
        if (nested) vm.loadData(0x1ec, Uint8Array.from([0x02, 0x60, ...frame.slice(2)]));
        vm.poke(0x5001, 0);
        vm.poke(0x5002, 0x60);
        putWord(vm, 0xb0, 0x5000);
        putWord(vm, 0x6000, initial);
        const setup = assemble(`
          .org $0200
          ldx #$DF
          txs
          jsr ${hex(s.RAM2_WRITE_LDA)}
          ldx #${sp}
          txs
          jmp ${hex(s.NEXT_LOOP)}
        `);
        vm.loadData(setup.org, setup.bytes);
        vm.setPC(setup.org);
        let instructions = 0;
        const interrupted = new Set();
        while (![0xa8, 0xaf, 0x1224].includes(vm.pc()) && instructions++ < 5000) {
          if (vm.pc() >= s.NEXT_LOOP && vm.pc() < s.NEXT_END && !interrupted.has(vm.pc())) {
            interrupted.add(vm.pc());
            vm.readBus(0xc010);
            injected++;
          }
          vm.step();
        }
        assert(instructions < 5000, "NEXT did not terminate");
        assert.equal(vm.pc(), continues ? 0xaf : 0xa8);
        assert.equal(word(vm, 0x6000), (initial + step) & 65535);
        assert.equal(vm.sp(), continues ? 0xf5 : 0xff);
        assert.equal(word(vm, 0xb0), continues ? 0x5010 : 0x5000);
        if (continues) assert.deepEqual(bytesAt(vm, 0x1f6, 10), Buffer.from(frame),
          "NEXT or an NMI destroyed a live FOR frame");
      }
    }
    const capture = assemble(`
      .org $0200
      ldx #$F0
      txs
      lda #$57
      ldy #$A6
      jsr ${hex(s.RETURN_ADDRESS)}
captured:
      jmp captured
    `);
    vm.loadData(capture.org, capture.bytes);
    vm.setPC(capture.org);
    seek(vm, capture.symbols.CAPTURED, 5000);
    vm.readBus(0xc010);
    run(vm, 1000);
    assert.equal(word(vm, s.CAPTURED_LOW), capture.symbols.CAPTURED - 1);
    assert.deepEqual([vm.regA(), vm.regX(), vm.regY(), vm.sp()], [0x57, 0xf0, 0xa6, 0xf0]);
    console.log(`PASS synthetic NEXT: signed bounds, nested frames, ${injected} NMIs; safe return-address capture`);
  } finally {
    vm.delete();
  }
}

async function testDiskError() {
  const vm = await machine();
  try {
    vm.loadData(payload.stub.org, payload.stub.bytes);
    vm.loadData(0xb7b5, Uint8Array.from([0x38, 0x60])); // failing RWTS, carry set
    vm.setPC(payload.stub.org);
    run(vm, 100000);
    assert(text(vm).includes("SILENT SERVICE DISK ERROR - RESET"));
    assert.equal(vm.pc(), payload.stub.symbols.HALTED);
    console.log("PASS boot read error is visible and halts before installation");
  } finally {
    vm.delete();
  }
}

function testPayload() {
  assert(s.STARTUP_END <= 0xc880 && s.GAME_PADDLE_END <= 0xc900);
  assert(s.POLL_END <= 0xca00 && s.BANKING_END <= 0xcc70);
  assert(s.FIRMWARE_END <= 0xce00 && s.NMI_END <= 0xd000);
  assert(payload.sectorCount <= 12 && payload.stub.bytes.length <= 0xf0);
  assert.deepEqual([s.DOS_ROM, s.DOS_BANK2, s.DOS_BANK1], [0xcc81, 0xcc83, 0xcc8b]);
  const wrongRom = Buffer.from(rom);
  wrongRom[0xb500] ^= 1;
  assert.throws(() => buildPayload(wrongRom), /Unsupported 3ric ROM/);
  assert.throws(() => patchSilentService(Buffer.alloc(143360), rom), /Unsupported Silent Service image/);
  assert.throws(() => patchSilentService(Buffer.alloc(1), rom), /Unsupported Silent Service image/);
  const archon = buildArchon(rom);
  assert.equal(sha256(archon.resident.bytes), "8470be87ea3244c02f20990a2320dda9d0aac4fff0ff4fa395fcfe5d7498af16");
  assert.equal(sha256(archon.installer.bytes), "0fa820088b4500ef021093d622c5799c9b8c1901b3307c8426ec3d44ab66cc2b");
  assert.equal(sha256(archon.stub.bytes), "edcf2614df6e70c3a69ddab5f05e9d5527bb736abaf180726cd1bbfd2a93f7aa");
  console.log("PASS payload boundaries, exact ROM/input guards and byte-identical Archon extraction");
}

function testImage(input, result) {
  assert.equal(sha256(input), INPUT_SHA256);
  const restored = Buffer.from(result.dsk);
  for (const patch of result.patches)
    restored.set(Buffer.from(patch.before, "hex"), patch.offset);
  assert.deepEqual(restored, input, "Unrelated disk bytes changed");
  const coordinates = Array.from({ length: 560 }, (_, i) => ({ track: i >> 4, sector: i & 15 }));
  for (const sector of readWozSectors(result.woz, coordinates)) {
    const logical = sector.sector === 15 ? 15 : sector.sector * 7 % 15;
    const offset = (sector.track * 16 + logical) * 256;
    assert.deepEqual(Buffer.from(sector.data), result.dsk.subarray(offset, offset + 256));
  }
  assert.equal(result.dsk.readUInt32BE(0x11048),
    (input.readUInt32BE(0x11048) & ~(((1 << payload.sectorCount) - 1) << 16)) >>> 0);
  const changed = Buffer.from(input);
  changed[42] ^= 1;
  assert.throws(() => patchSilentService(changed, rom), /Unsupported Silent Service image/);
  console.log("PASS exact inverse, reserved free-sector bitmap and all 560 WOZ sector checksums/order");
}

function testCLI(inputPath, result) {
  const out = path.join(root, "codegen", "out");
  fs.mkdirSync(out, { recursive: true });
  const dir = fs.mkdtempSync(path.join(out, "silent-service-cli-"));
  try {
    const tool = path.join(root, "codegen", "tools", "patch-silent-service.mjs");
    const invoke = args => spawnSync(process.execPath, [tool, ...args], { encoding: "utf8" });
    const existing = path.join(dir, "existing.woz");
    fs.writeFileSync(existing, "do not overwrite");
    assert.notEqual(invoke([inputPath, existing]).status, 0);
    assert.equal(fs.readFileSync(existing, "utf8"), "do not overwrite");
    const same = invoke([inputPath, inputPath]);
    assert.notEqual(same.status, 0);
    assert.match(same.stderr, /different files/);
    assert.notEqual(invoke([inputPath, path.join(dir, "wrong.ext")]).status, 0);
    for (const extension of ["woz", "dsk"]) {
      const output = path.join(dir, `output.${extension}`);
      const command = invoke([inputPath, output]);
      assert.equal(command.status, 0, command.stderr);
      assert.deepEqual(fs.readFileSync(output), result[extension]);
    }
    console.log("PASS exclusive CLI output, original preservation, DSK and WOZ exports");
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}

const ceiling = vm => sha256(Buffer.from(vm.renderFrame()).subarray(0, vm.frameWidth() * 100 * 4));

async function testScenario(woz, scenario, sound) {
  const vm = await bootDisk(woz);
  try {
    assert(text(vm).includes("USE MOCKINGBOARD"));
    assert.equal(vm.peek(s.NMI_ENTRY), 0x48, "The disk did not install its own adapter");
    key(vm, sound);
    run(vm, 60000000);
    assert.equal(vm.textMode(), 0);
    assert.equal(vm.lores(), 0);
    const menu = ceiling(vm);
    key(vm, scenario);
    run(vm, 30000000);
    if (scenario !== "1") { key(vm, "1"); run(vm, 30000000); }
    if (scenario === "3") { key(vm, "1"); run(vm, 30000000); }
    assert.notEqual(ceiling(vm), menu, "Scenario selection did not change the menu");
    key(vm, "\r");
    run(vm, 120000000);
    seek(vm, s.GAME_PADDLE);
    assert.equal(vm.romVisible(0xfffa), false);
    assert.equal(vm.peekMapped(0xfffa) | vm.peekMapped(0xfffb) << 8, s.NMI_ENTRY);
    assert.deepEqual(bytesAt(vm, 0xaea2, 3), Buffer.from([0x4c, s.GAME_PADDLE & 255, s.GAME_PADDLE >> 8]));
    assert.equal(vm.peek(0xbf4b), 0xcc, "Later disk loads lost the self-modifying bank trampoline");
    const room = ceiling(vm);
    if (scenario === "1") {
      for (const [mask, x, y] of [[0, 0, 0], [16, 0, 0xffff], [32, 0, 1],
        [64, 0xffff, 0], [128, 1, 0], [48, 0, 0], [192, 0, 0]]) {
        vm.setGamepadState(0, mask);
        vm.step();
        seek(vm, 0xad4e);
        vm.step();
        seek(vm, 0xad4e);
        assert.equal(word(vm, 0x4042), x);
        assert.equal(word(vm, 0x4044), y);
        vm.step();
        seek(vm, s.GAME_PADDLE);
      }
      vm.setGamepadState(0, 0);
      run(vm, 1000000);
      vm.enableAudio(44100);
      key(vm, "T");
      const rms = run(vm, 60000000);
      assert.notEqual(ceiling(vm), room, "Keyboard did not select the periscope/TDC view");
      assert(rms > 0.001, "Mockingboard/speaker produced no real PCM");
      key(vm, " ");
      run(vm, 60000000);
      seek(vm, s.GAME_PADDLE);
      assert.equal(ceiling(vm), room, "Space did not restore the station-selection view");
      vm.setGamepadState(0, 1);
      run(vm, 1000000);
      vm.setGamepadState(0, 0);
      run(vm, 20000000);
      assert.notEqual(ceiling(vm), room, "SNES B did not select a station");
      assert.equal(vm.peek(0xc000) & 128, 0, "Game stopped consuming keyboard input");
    }
    assert(!/ERR @|A=[0-9A-F]{2} X=/.test(vm.drainOutput().split("C600G").at(-1)),
      "Game trapped back into the monitor");
    console.log(`PASS scenario ${scenario}, sound ${sound}: real disk loader, interactive game and banked overlays`);
  } finally {
    vm.delete();
  }
}

async function main(args) {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--dsk"))
    throw new Error("Usage: node codegen\\tools\\patch-silent-service.test.mjs [--dsk <original.dsk>]");
  testPayload();
  await testInterpreter();
  await testDiskError();
  if (!args.length) {
    console.log("SKIP owner-supplied game integration (pass --dsk <original.dsk>)");
    return;
  }
  const inputPath = path.resolve(args[1]);
  const input = fs.readFileSync(inputPath);
  const result = patchSilentService(input, rom);
  testImage(input, result);
  testCLI(inputPath, result);
  const wrongRom = Buffer.from(rom);
  wrongRom[0xb500] ^= 1;
  const rejected = await bootDisk(result.woz, wrongRom);
  try {
    assert(text(rejected).includes("3RIC ROM MISMATCH - RESET"));
    assert.equal(rejected.pc(), payload.installer.symbols.HALTED);
    console.log("PASS on-machine ROM ABI mismatch rejection");
  } finally {
    rejected.delete();
  }
  await testScenario(result.woz, "1", "Y");
  await testScenario(result.woz, "2", "N");
  await testScenario(result.woz, "3", "Y");
}

try { await main(process.argv.slice(2)); }
catch (error) { console.error(error); process.exitCode = 1; }
