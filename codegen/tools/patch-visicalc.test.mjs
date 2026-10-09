import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildPayload, INPUT_SHA256, patchVisicalc } from "./patch-visicalc.mjs";
import { buildPayload as buildArchonPayload } from "./patch-archon.mjs";
import { crc32 } from "./wozgen.mjs";
import { readWozSectors, sha256 } from "./wozedit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const payload = buildPayload(rom);
const bytesAt = (vm, address, count) =>
  Buffer.from(Array.from({ length: count }, (_, i) => vm.peekMapped(address + i)));

function screen(vm) {
  return Array.from({ length: 24 }, (_, row) =>
    Array.from({ length: 40 }, (_, col) => {
      const b = vm.peek(0x400 + (row & 7) * 128 + (row >> 3) * 40 + col) & 127;
      return String.fromCharCode(b < 32 ? b + 64 : b);
    }).join(""));
}

function type(vm, text) {
  for (const ch of text) {
    for (let i = 0; i < 100 && (vm.peek(0xc000) & 128); ++i) vm.runCycles(10000);
    assert.equal(vm.peek(0xc000) & 128, 0, "Previous keyboard strobe was not consumed");
    vm.keyDown(ch.charCodeAt(0));
    vm.runCycles(300000);
  }
}

function waitFor(vm, predicate, message, budget = 80000000) {
  for (let cycles = 0; cycles < budget; cycles += 1000000) {
    vm.runCycles(1000000);
    if (predicate()) return;
  }
  assert.fail(`${message}; PC=$${vm.pc().toString(16)}\n${screen(vm).join("\n")}`);
}

async function boot(woz, firmware = rom, expected = /VC-208B0-AP2/) {
  const module = await require(path.join(root, "web", "badger6502.js"))();
  const vm = new module.WebVM();
  try {
    vm.loadData(0, firmware.subarray(0, 65536));
    vm.seedBasicRom();
    vm.loadFont(fs.readFileSync(path.join(root, "emulator", "Data", "fontrom.dat")));
    vm.reset();
    vm.runCycles(5000000);
    assert(vm.insertDisk(0, woz));
    type(vm, "MON\rC600G\r");
    waitFor(vm, () => expected.test(screen(vm).join("\n")), "Disk did not reach its expected screen");
    vm.runCycles(1000000);
    return vm;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

function testPayload() {
  assert(payload.resident.symbols.ADAPTER_END <= 0xc900);
  assert(payload.resident.symbols.NMI_END <= 0xd000);
  assert.equal(payload.installer.org, 0x3500);
  assert(payload.pages <= 4);
  const wrongRom = Buffer.from(rom);
  wrongRom[0xb500] ^= 1;
  assert.throws(() => buildPayload(wrongRom), /Unsupported 3ric ROM/);
  assert.throws(() => patchVisicalc(Buffer.alloc(143360), rom), /Unsupported VisiCalc image/);
  assert.throws(() => patchVisicalc(Buffer.alloc(143359), rom), /Unsupported VisiCalc image/);
  // Fingerprints from the Archon payload before the shared input extraction.
  const archon = buildArchonPayload(rom);
  assert.equal(sha256(archon.resident.bytes), "8470be87ea3244c02f20990a2320dda9d0aac4fff0ff4fa395fcfe5d7498af16");
  assert.equal(sha256(archon.installer.bytes), "0fa820088b4500ef021093d622c5799c9b8c1901b3307c8426ec3d44ab66cc2b");
  assert.equal(sha256(archon.stub.bytes), "edcf2614df6e70c3a69ddab5f05e9d5527bb736abaf180726cd1bbfd2a93f7aa");
  console.log("PASS payload bounds, disk/ROM guards and byte-identical Archon extraction");
}

function testDisk(input, result) {
  assert.equal(sha256(input), INPUT_SHA256);
  const restored = Buffer.from(result.dsk);
  for (const edit of [...result.edits].reverse()) {
    assert.deepEqual(restored.subarray(edit.offset, edit.offset + edit.after.length), edit.after);
    restored.set(edit.before, edit.offset);
  }
  assert.deepEqual(restored, input, "Reversing edits did not restore the entire supplied disk");
  let catalog = 17 * 4096 + 15 * 256, worksheets = 0;
  const visited = new Set();
  while (catalog) {
    assert(!visited.has(catalog), "Catalog loop");
    visited.add(catalog);
    for (let i = 0; i < 7; ++i) {
      const entry = input.subarray(catalog + 11 + i * 35, catalog + 46 + i * 35);
      if (!entry[0] || entry[0] === 255 || (entry[2] & 127) !== 0) continue;
      ++worksheets;
      assert.deepEqual(result.dsk.subarray(catalog + 11 + i * 35, catalog + 46 + i * 35), entry);
      let list = entry[0] * 4096 + entry[1] * 256;
      const lists = new Set();
      while (list) {
        assert(!lists.has(list), "Worksheet track/sector list loop");
        lists.add(list);
        assert.deepEqual(result.dsk.subarray(list, list + 256), input.subarray(list, list + 256));
        for (let j = 12; j < 256 && input[list + j]; j += 2) {
          const offset = input[list + j] * 4096 + input[list + j + 1] * 256;
          assert.deepEqual(result.dsk.subarray(offset, offset + 256), input.subarray(offset, offset + 256));
        }
        list = input[list + 1] ? input[list + 1] * 4096 + input[list + 2] * 256 : 0;
      }
    }
    catalog = input[catalog + 1] ? input[catalog + 1] * 4096 + input[catalog + 2] * 256 : 0;
  }
  assert.equal(worksheets, 12, "Not all supplied worksheets were checked");
  const changed = new Set(result.edits.flatMap(edit =>
    Array.from({ length: edit.after.length }, (_, i) => edit.offset + i)));
  for (let i = 0; i < input.length; ++i)
    if (!changed.has(i)) assert.equal(result.dsk[i], input[i], `Unrelated byte changed at ${i}`);
  const count = result.payload.pages;
  assert.equal(result.dsk.readUInt16LE(17 * 4096 + 15 * 256 + 44), 46 + count);
  for (let i = 0; i < count; ++i) {
    assert.deepEqual(result.dsk.subarray(18 * 4096 + 15 * 256 + 102 + i * 2,
      18 * 4096 + 15 * 256 + 104 + i * 2), Buffer.from([3, i]));
    assert.equal(result.dsk.readUInt32BE(17 * 4096 + 0x44) & (1 << (16 + i)), 0);
  }
  assert.deepEqual(result.dsk.subarray(18 * 4096 + 15 * 256 + 102 + count * 2,
    18 * 4096 + 15 * 256 + 104 + count * 2), Buffer.alloc(2), "Missing track/sector list terminator");
  const all = readWozSectors(result.woz,
    Array.from({ length: 560 }, (_, i) => ({ track: i >> 4, sector: i & 15 })));
  for (const { track, sector, data } of all) {
    const logical = sector === 15 ? 15 : sector * 7 % 15;
    const offset = track * 4096 + logical * 256;
    assert.deepEqual(data, result.dsk.subarray(offset, offset + 256));
  }
  assert.equal(result.woz[22], 1);
  assert.equal(result.woz.readUInt32LE(8), crc32(result.woz, 12, result.woz.length));
  const wrong = Buffer.from(input);
  wrong[0] ^= 1;
  assert.throws(() => patchVisicalc(wrong, rom), /Unsupported VisiCalc image/);
  console.log("PASS reversible exact-image edits, DOS allocation and all 560 WOZ sectors");
}

function testCLI(input, expectedWoz) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "3ric-visicalc-"));
  try {
    const source = path.join(temp, "VISICALC.DSK"), target = path.join(temp, "VISICALC-3RIC.woz");
    const script = path.join(root, "codegen", "tools", "patch-visicalc.mjs");
    fs.writeFileSync(source, input, { flag: "wx" });
    const run = args => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    const created = run([source, target]);
    assert.equal(created.status, 0, created.stderr);
    assert.deepEqual(fs.readFileSync(target), expectedWoz);
    assert.match(created.stdout, /40 columns, write-protected/);
    const existing = run([source, target]);
    assert.notEqual(existing.status, 0);
    assert.match(existing.stderr, /EEXIST/);
    assert.deepEqual(fs.readFileSync(target), expectedWoz);
    assert.match(run([source, source]).stderr, /different files/);
    assert.deepEqual(fs.readFileSync(source), input, "CLI changed its valid input");
    fs.writeFileSync(source, Buffer.alloc(12));
    assert.match(run([source, path.join(temp, "bad.woz")]).stderr, /Unsupported VisiCalc image/);
    assert(!fs.existsSync(path.join(temp, "bad.woz")));
    assert.deepEqual(fs.readFileSync(source), Buffer.alloc(12), "CLI changed its input");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("PASS CLI output, overwrite refusal and no output on invalid input");
}

async function testRuntime(result) {
  const vm = await boot(result.woz);
  try {
    assert.equal(vm.textMode(), 1);
    assert.equal(vm.gfxPage(), 0);
    assert(screen(vm)[0].startsWith("A1"));
    assert(!screen(vm).join("\n").includes("80 COLUMNS"));
    assert.equal(bytesAt(vm, 0xfffa, 2).readUInt16LE(), payload.resident.symbols.NMI_ENTRY);
    assert.match(screen(vm)[1], /34\s*$/, "Available worksheet memory changed");
    type(vm, "123\r>B1\r+A1*2\r");
    assert.match(screen(vm)[4], /123\s+246/);
    type(vm, ">A1\r456\r");
    assert.match(screen(vm)[4], /456\s+912/, "Dependent formula did not recalculate");
    type(vm, ">C1\r1.25\r>D1\r+C1*2\r");
    assert.match(screen(vm)[4], /1\.25\s+2\.5/, "Decimal arithmetic failed");
    type(vm, ">A2\r\"3RIC\r");
    assert.match(screen(vm)[5], /3RIC/, "Label entry failed");
    type(vm, ">B2\r@SUM(A1...B1)\r");
    assert.match(screen(vm)[5], /1368/, "Range formula failed");
    type(vm, ">B1\r");
    assert.match(screen(vm)[0], /B1\s+\(V\) \+A1\*2/, "Cell navigation lost its formula");
    const lit = vm.renderFrame().filter((v, i) => i % 4 !== 3 && v !== 0).length;
    assert(lit > 5000, "Spreadsheet text did not render");
    console.log("PASS real-disk 40-column boot, labels, decimal/range formulas and recalculation");

    type(vm, "/CY");
    vm.runCycles(3000000);
    assert(screen(vm)[0].startsWith("A1"), "Clear did not return to A1");
    assert(!screen(vm)[4].includes("456"), "Clear left the previous worksheet");
    type(vm, "/SLBUDGET.VC\r");
    waitFor(vm, () => screen(vm).join("\n").includes("HOME BUDGET MODEL")
      && !screen(vm).join("\n").includes("LOADING"), "Budget worksheet did not load");
    type(vm, ">B3\r");
    assert.match(screen(vm)[0], /B3\s+\(V\) 561/);
    type(vm, "600\r>B12\r");
    assert.match(screen(vm).join("\n"), /407/, "Loaded budget did not recalculate");
    type(vm, "/SS3RICTEST\r");
    waitFor(vm, () => screen(vm).join("\n").includes("ERROR: WRITE PROTECTED"),
      "Save did not explicitly report write protection");
    type(vm, "\x1b");
    assert.equal(bytesAt(vm, 0xfffa, 2).readUInt16LE(), payload.resident.symbols.NMI_ENTRY);
    console.log("PASS clear/reuse, original budget loading/recalculation and explicit save rejection");
    const normalize = payload.resident.symbols.NORMALIZE_KEY;
    vm.loadData(0x300, [0x20, normalize & 255, normalize >> 8, 0xea]);
    vm.addBreakpoint(0x303);
    for (const [scan, pressed, left, right, latched, expected] of [
      [0x55, 1, 1, 0, 0xbd, 0xab], [0x55, 1, 0, 1, 0xbd, 0xab],
      [0x55, 1, 0, 0, 0xbd, 0xbd], [0x55, 0, 1, 0, 0xbd, 0xbd],
      [0x12, 1, 1, 0, 0xbd, 0xbd], [0x55, 1, 1, 0, 0x3d, 0x3d],
      [0x55, 1, 1, 0, 0xb1, 0xb1], [0, 0, 0, 0, 0xab, 0xab],
    ]) {
      for (const [address, value] of [[0xce01, scan], [0xcb55, pressed], [0xcb12, left],
        [0xcb59, right], [0xc000, latched]]) vm.poke(address, value);
      vm.setPC(0x300);
      vm.runCycles(1000);
      assert(vm.breakpointHit(), "Guest key-normalization routine did not return");
      assert.equal(vm.peek(0xc000), expected);
    }
    console.log("PASS guest plus-key normalization and unshifted/released/unrelated-key guards");
  } finally {
    vm.delete();
  }
  for (const address of [0xb500, 0xf1cf]) {
    const firmware = Buffer.from(rom);
    firmware[address] ^= 1;
    const rejected = await boot(result.woz, firmware, /3RIC ROM MISMATCH - RESET/);
    try {
      assert.equal(rejected.pc(), payload.installer.symbols.HALTED);
      assert.equal(rejected.textMode(), 1);
    } finally {
      rejected.delete();
    }
  }
  console.log("PASS on-machine banked-code and NMI-proxy ABI rejection");
}

testPayload();
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log("SKIP owner-supplied disk integration (pass --dsk <VISICALC.DSK>)");
} else {
  assert(args.length === 2 && args[0] === "--dsk",
    "Usage: node codegen\\tools\\patch-visicalc.test.mjs [--dsk <VISICALC.DSK>]");
  const input = fs.readFileSync(args[1]);
  const result = patchVisicalc(input, rom);
  testDisk(input, result);
  testCLI(input, result.woz);
  await testRuntime(result);
  assert.equal(sha256(fs.readFileSync(args[1])), INPUT_SHA256, "Supplied disk changed");
}
