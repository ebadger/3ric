import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildPayload, INPUT_SHA256, patchUltima, readBlock, readCatalog } from "./patch-ultima.mjs";
import { readWozSectors, sha256 } from "./wozedit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const payload = buildPayload(rom), symbols = payload.resident.symbols;
const bytesAt = (vm, address, count) =>
  Buffer.from(Array.from({ length: count }, (_, i) => vm.peekMapped(address + i)));

function fixture() {
  const disk = Buffer.alloc(143360);
  const sectors = [0, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 15];
  const put = (block, bytes) => {
    for (let part = 0; part < 2; part++)
      bytes.copy(disk, (block >> 3) * 4096 + sectors[(block & 7) * 2 + part] * 256,
        part * 256, (part + 1) * 256);
  };
  const directory = Buffer.alloc(512);
  directory[4] = 0xf4;
  directory.write("TEST", 5);
  directory[0x23] = 39;
  directory[0x24] = 13;
  directory.writeUInt16LE(1, 0x25);
  directory.writeUInt16LE(6, 0x27);
  directory.writeUInt16LE(280, 0x29);
  directory[43] = 0x24;
  directory.write("FILE", 44);
  directory.writeUInt16LE(7, 43 + 17);
  directory.writeUInt16LE(2, 43 + 19);
  directory.writeUIntLE(512, 43 + 21, 3);
  put(2, directory);
  const bitmap = Buffer.alloc(512, 255);
  for (const block of [0, 1, 2, 6, 7, 8]) bitmap[block >> 3] &= ~(128 >> (block & 7));
  put(6, bitmap);
  const index = Buffer.alloc(512);
  index[0] = 8;
  put(7, index);
  const data = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 13 + (i >> 8)) & 255));
  put(8, data);
  return { disk, put, directory, bitmap, index, data };
}

function testFixtures() {
  const f = fixture();
  assert.deepEqual(readBlock(f.disk, 8), f.data);
  assert.deepEqual(readCatalog(f.disk).get("FILE").data, f.data);
  for (const bad of [-1, 280, 1.5]) assert.throws(() => readBlock(f.disk, bad), /Invalid/);
  assert.throws(() => readBlock(f.disk.subarray(1), 2), /Invalid/);
  assert.throws(() => readCatalog(Buffer.alloc(143360)), /volume header/);
  f.index[0] = 7;
  f.put(7, f.index);
  assert.throws(() => readCatalog(f.disk), /overlapping/);
  f.index[0] = 24;
  f.index[256] = 1;
  f.put(7, f.index);
  assert.throws(() => readCatalog(f.disk), /allocated block 280/);
  f.index[0] = 8;
  f.index[256] = 0;
  f.put(7, f.index);
  f.bitmap[1] |= 128;
  f.put(6, f.bitmap);
  assert.throws(() => readCatalog(f.disk), /allocated block 8/);
  f.bitmap[1] &= 127;
  f.put(6, f.bitmap);
  f.directory.writeUInt16LE(2, 2);
  f.put(2, f.directory);
  assert.throws(() => readCatalog(f.disk), /overlapping/);
  f.directory.writeUInt16LE(0, 2);
  f.directory.writeUIntLE(131073, 43 + 21, 3);
  f.put(2, f.directory);
  assert.throws(() => readCatalog(f.disk), /file size/);
  assert.throws(() => patchUltima(f.disk, rom), /Unsupported Ultima image/);
  const wrong = Buffer.from(rom);
  wrong[0xf1cf] ^= 0x40;
  assert.throws(() => buildPayload(wrong), /Unsupported 3ric ROM/);
  assert(payload.resident.org === 0xcc00 && symbols.RESIDENT_END <= 0xce00);
  assert(payload.installer.org === 0x5a00 && payload.installer.bytes.length <= 5 * 512);
  const cli = spawnSync(process.execPath, [path.join(root, "codegen", "tools", "patch-ultima.mjs")],
    { encoding: "utf8" });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /Usage:/);
  console.log("PASS synthetic DOS-order ProDOS catalog, allocation/bounds guards, fingerprints and resident bounds");
}

function type(vm, text, budget = 300000) {
  for (const ch of text) {
    for (let i = 0; i < 200 && (vm.peek(0xc000) & 128); i++) vm.runCycles(10000);
    assert.equal(vm.peek(0xc000) & 128, 0, "Previous keyboard strobe was not consumed");
    vm.keyDown(ch.charCodeAt(0));
    vm.runCycles(budget);
  }
}

function seek(vm, pc, budget = 30000000) {
  assert(vm.addBreakpoint(pc));
  vm.runCycles(budget);
  vm.removeBreakpoint(pc);
  assert(vm.breakpointHit(), `Missed $${pc.toString(16)} at $${vm.pc().toString(16)}`);
  assert.equal(vm.pc(), pc);
}

async function boot(woz, firmware = rom) {
  const create = require(path.join(root, "web", "badger6502.js"));
  const module = await create();
  const vm = new module.WebVM();
  try {
    vm.loadData(0, firmware.subarray(0, 65536));
    vm.seedBasicRom();
    vm.loadFont(fs.readFileSync(path.join(root, "emulator", "Data", "fontrom.dat")));
    vm.reset();
    vm.runCycles(5000000);
    type(vm, "MON\r");
    assert.match(vm.drainOutput(), /\*/);
    assert(vm.insertDisk(0, woz));
    type(vm, "C600G\r");
    seek(vm, 0x0a9a);
    return vm;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

function assertInteractive(vm) {
  assert.equal(vm.peek(symbols.IO_DEPTH), 0, "Disk call left input inhibited");
  assert.equal(vm.romVisible(0xffff), true, "Interactive code hid ROM input");
  assert.equal(vm.romVisible(0x9000), false, "BASIC overlay hid game code");
  assert.equal(vm.readBus(0xc203) & 0x40, 0, "PS/2 clock was not released");
  assert.equal(vm.peek(0xcafe), 0, "ROM input-bank nesting leaked");
}

function assertOverlay(vm, file) {
  assert.deepEqual(bytesAt(vm, 0x8956, 8), file.data.subarray(0, 8), `${file.name} overlay was not loaded`);
  assertInteractive(vm);
}

async function testImage(input, inputPath) {
  assert.equal(sha256(input), INPUT_SHA256);
  const original = Buffer.from(input);
  const result = patchUltima(input, rom);
  assert.deepEqual(input, original, "Input image was mutated");
  const files = readCatalog(result.disk);
  const sourceFiles = readCatalog(input);
  for (const [name, file] of sourceFiles) {
    if (!["PRODOS", "U1.SYSTEM", "GEN", "OUT", "MI.U1"].includes(name))
      assert.deepEqual(files.get(name).data, file.data, `${name} changed`);
  }
  for (let block = 264; block < 280; block++)
    assert.deepEqual(readBlock(result.disk, block), readBlock(input, block), "Raw intro was overwritten");
  const coordinates = Array.from({ length: 560 }, (_, i) => ({ track: i >> 4, sector: i & 15 }));
  const sectors = readWozSectors(result.woz, coordinates);
  for (const sector of sectors) {
    const logical = sector.sector === 15 ? 15 : sector.sector * 7 % 15;
    const offset = sector.track * 4096 + logical * 256;
    assert.deepEqual(sector.data, result.disk.subarray(offset, offset + 256));
  }
  const directory = path.join(root, "codegen", "out");
  fs.mkdirSync(directory, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(directory, "ultima-cli-"));
  try {
    const prefix = path.join(temporary, "trial");
    const args = [path.join(root, "codegen", "tools", "patch-ultima.mjs"), inputPath, prefix];
    const cli = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /RAM ONLY/);
    assert.deepEqual(fs.readFileSync(prefix + ".dsk"), result.disk);
    assert.deepEqual(fs.readFileSync(prefix + ".woz"), result.woz);
    const again = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(again.status, 1);
    assert.match(again.stderr, /refusing overwrite/);
    assert.deepEqual(fs.readFileSync(prefix + ".dsk"), result.disk);
  } finally {
    for (const name of ["trial.dsk", "trial.woz"]) {
      const file = path.join(temporary, name);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(temporary);
  }
  console.log("PASS actual disk allocation, original asset/intro preservation, 560 WOZ sector round trips and exclusive CLI outputs");

  const wrongRom = Buffer.from(rom);
  wrongRom[0xf1cf] ^= 0x40;
  const mismatch = await boot(result.woz, wrongRom);
  try {
    type(mismatch, " ");
    mismatch.runCycles(40000000);
    assert.equal(bytesAt(mismatch, 0x400, 25).map(b => b & 127).toString(), "3RIC ROM MISMATCH - RESET");
    assert.equal(mismatch.textMode(), 1);
  } finally {
    mismatch.delete();
  }
  console.log("PASS on-machine ROM ABI mismatch rejection");

  const vm = await boot(result.woz);
  try {
    type(vm, " ");
    vm.runCycles(60000000);
    type(vm, " ");
    vm.runCycles(60000000);
    assertOverlay(vm, files.get("GEN"));
    assert.equal(vm.peek(symbols.SAVE_VALID), 0);
    assert(files.get("GEN").data.includes(Buffer.from("RAM ONLY")));
    type(vm, "b");
    vm.runCycles(1000000);
    assert.equal(vm.peek(symbols.SAVE_VALID), 0, "Continue fabricated an empty save");
    assertOverlay(vm, files.get("GEN"));
    type(vm, "a");
    type(vm, "\x15".repeat(10) + "\r" + "\x15".repeat(10) + "\r" + "\x15".repeat(10));
    type(vm, " aaaERIC\r");
    vm.addBreakpoint(symbols.SAVE_CHARACTER);
    type(vm, "y");
    assert.equal(vm.pc(), symbols.SAVE_CHARACTER, "Character creation did not call its RAM save adapter");
    vm.clearBreakpoints();
    const character = bytesAt(vm, 0x7e6d, 458);
    vm.step();
    seek(vm, symbols.SAVE_RETURN);
    assert.deepEqual(bytesAt(vm, 0xc800, 458), character);
    assert.equal(vm.peek(symbols.SAVE_VALID), 1);
    vm.runCycles(5000000);
    assertOverlay(vm, files.get("GEN"));
    type(vm, "b");
    vm.runCycles(20000000);
    assertOverlay(vm, files.get("OUT"));
    assert.equal(bytesAt(vm, 0x7eb8, 4).toString(), "Eric");
    assert.equal(vm.textMode(), 0);
    assert.equal(vm.lores(), 0);
    console.log("PASS actual cold disk boot, visible RAM-only warning, empty Continue, character creation and overworld entry");

    const position = [vm.peek(0), vm.peek(1)];
    type(vm, "\x15", 1000000);
    assert.equal(vm.peek(0), position[0] + 1, "Right did not move east");
    type(vm, "\x08", 1000000);
    assert.equal(vm.peek(0), position[0]);
    vm.addBreakpoint(symbols.SAVE_CHARACTER);
    type(vm, "q");
    assert.equal(vm.pc(), symbols.SAVE_CHARACTER);
    vm.clearBreakpoints();
    const checkpoint = bytesAt(vm, 0x7e6d, 458);
    vm.step();
    seek(vm, symbols.SAVE_RETURN);
    assert.deepEqual(bytesAt(vm, 0xc800, 458), checkpoint);
    vm.runCycles(10000000);
    assertOverlay(vm, files.get("GEN"));
    type(vm, "b");
    vm.runCycles(20000000);
    assertOverlay(vm, files.get("OUT"));
    assert.deepEqual([vm.peek(0), vm.peek(1)], position);
    console.log("PASS real Q-to-menu and B-to-Continue round trip, exact 458-byte checkpoint and restored world position");

    type(vm, "\x0b\x0b" + "\x08".repeat(9), 1000000);
    assert.deepEqual([vm.peek(0), vm.peek(1)], [30, 31]);
    type(vm, "e");
    vm.runCycles(20000000);
    assertOverlay(vm, files.get("CAS"));
    type(vm, "\x08");
    vm.runCycles(20000000);
    assertOverlay(vm, files.get("OUT"));
    assert.deepEqual([vm.peek(0), vm.peek(1)], [30, 31]);
    type(vm, "\x08\x0a", 1000000);
    assert.deepEqual([vm.peek(0), vm.peek(1)], [29, 32]);
    type(vm, "e");
    vm.runCycles(20000000);
    assertOverlay(vm, files.get("TWN"));
    assert.deepEqual([vm.peek(0), vm.peek(1)], [19, 17]);
    console.log("PASS keyboard travel, Castle British entry/exit and Britain town overlay loading");
    type(vm, "\x0a");
    vm.runCycles(20000000);
    assertOverlay(vm, files.get("OUT"));
    assert.deepEqual([vm.peek(0), vm.peek(1)], [29, 32]);
    type(vm, "\x15\x0b", 1000000);
    const dungeonRoute = [
      -64, -64, -64, -64, -64, -64, -64, -64, -64, 1, 1, 1, -64, 1, -64,
      -64, -64, -64, -64, 1, 1, 1, 1, 1, 1, 1, 1, 1, -64,
    ];
    for (const direction of dungeonRoute) type(vm, direction === 1 ? "\x15" : "\x0b", 1000000);
    assert.deepEqual([vm.peek(0), vm.peek(1)], [43, 15]);
    type(vm, "e");
    vm.runCycles(20000000);
    assertOverlay(vm, files.get("DNG"));
    assert.equal(vm.peek(0xa506), 1, "Dungeon did not start on level 1");
    const facing = bytesAt(vm, 0xa4ec, 2);
    type(vm, "\x15", 1000000);
    assert.deepEqual(bytesAt(vm, 0xa4ec, 2), Buffer.from([(-facing[1]) & 255, facing[0]]),
      "Dungeon Right did not turn its direction vector");
    const dungeonPosition = bytesAt(vm, 0xa4e8, 2);
    type(vm, "\x0b", 1000000);
    assert.deepEqual(bytesAt(vm, 0xa4e8, 2), dungeonPosition, "A wall did not block forward movement");
    let moved = false;
    for (let direction = 0; direction < 4 && !moved; direction++) {
      type(vm, "\x15\x0b", 1000000);
      moved = !bytesAt(vm, 0xa4e8, 2).equals(dungeonPosition);
    }
    assert(moved, "Forward did not move through any of the generated dungeon's four directions");
    assertInteractive(vm);
    console.log("PASS Dungeon of Montor loading, turning, blocked-wall collision and forward movement");
    assert.equal(vm.peek(symbols.SAVE_VALID), 1);
    vm.reset();
    vm.runCycles(5000000);
    type(vm, "MON\rC600G\r");
    seek(vm, 0x0a9a);
    type(vm, " ");
    vm.runCycles(60000000);
    type(vm, " ");
    vm.runCycles(60000000);
    assertOverlay(vm, files.get("GEN"));
    assert.equal(vm.peek(symbols.SAVE_VALID), 0, "Reboot retained the previous RAM-only checkpoint");
    console.log("PASS reboot invalidates the existing RAM checkpoint; persistent saving is intentionally unsupported");
    vm.poke(0xce00, 1);
    vm.setPC(symbols.IO_LOCK);
    vm.runCycles(10000);
    const message = "PS/2 TIMEOUT - RESET";
    assert.equal(bytesAt(vm, 0x400, message.length).map(b => b & 127).toString(), message);
    assert.equal(vm.textMode(), 1);
    console.log("PASS a deliberately stalled receive frame stops with an explicit timeout instead of hanging banked I/O");
  } finally {
    vm.delete();
  }
}

try {
  if (process.argv.length !== 2 && (process.argv.length !== 4 || process.argv[2] !== "--dsk"))
    throw new Error("Usage: node patch-ultima.test.mjs [--dsk owner-supplied.dsk]");
  testFixtures();
  if (process.argv[2] === "--dsk") {
    const inputPath = path.resolve(process.argv[3]);
    await testImage(fs.readFileSync(inputPath), inputPath);
  } else {
    console.log("SKIP game integration: supply --dsk with the exact owner-provided image");
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
