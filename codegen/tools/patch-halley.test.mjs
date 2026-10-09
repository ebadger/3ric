import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { INPUT_SHA256, patchHalley } from "./patch-halley.mjs";
import { buildWozFromDsk } from "./wozgen.mjs";
import { readWozSectors, sha256 } from "./wozedit.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tool = path.join(root, "codegen", "tools", "patch-halley.mjs");
const memory = (vm, address, length) =>
  Buffer.from(Array.from({ length }, (_, i) => vm.peekMapped(address + i)));

function seek(vm, address, budget = 5000000) {
  assert(vm.addBreakpoint(address));
  vm.runCycles(budget);
  vm.removeBreakpoint(address);
  assert(vm.breakpointHit(), `Timed out waiting for $${address.toString(16)} at $${vm.pc().toString(16)}`);
  assert.equal(vm.pc(), address);
}

function type(vm, text) {
  for (const ch of text) {
    for (let i = 0; i < 200 && (vm.peek(0xc000) & 0x80); i++) vm.runCycles(10000);
    assert.equal(vm.peek(0xc000) & 0x80, 0, "Previous key was not consumed");
    vm.keyDown(ch.charCodeAt(0));
    vm.runCycles(300000);
  }
}

async function bootFlight(woz, status) {
  const { boot } = require("./harness.cjs");
  const { vm } = await boot();
  try {
    vm.poke(0xc019, status);
    assert(vm.insertDisk(0, woz));
    type(vm, "MON\rC600G\r");
    vm.runCycles(30000000);
    type(vm, " ");
    vm.runCycles(100000000);
    for (let i = 0; i < 4; i++) {
      type(vm, " ");
      vm.runCycles(20000000);
    }
    seek(vm, 0x0858);
    assert.equal(vm.textMode(), 0);
    assert.equal(vm.lores(), 0);
    assert(vm.romVisible(0xfffa));
    return vm;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

function frame(vm, mask) {
  assert.equal(vm.pc(), 0x0858);
  vm.setGamepadState(0, mask);
  vm.step();
  seek(vm, 0x0858);
}

function enterHyperspace(vm) {
  vm.setGamepadState(0, 16);
  seek(vm, 0x13bb, 150000000);
  vm.step();
}

function leaveHyperspace(vm, mask) {
  vm.setGamepadState(0, mask);
  if (!mask) vm.keyDown(32);
  vm.step();
  seek(vm, 0x157c);
  vm.setGamepadState(0, 0);
  vm.step();
  seek(vm, 0x0858);
  assert(memory(vm, 0x39, 8).every(byte => byte === 0), "Hyperspace exit did not stop the ship");
  assert(vm.romVisible(0xfffa));
  assert(!vm.romVisible(0x9000));
  assert.equal(vm.peek(0xcafe), 0, "Input interrupt remained active");
}

function testImage(input) {
  assert.equal(sha256(input), INPUT_SHA256);
  const original = Buffer.from(input);
  const result = patchHalley(input);
  assert.deepEqual(input, original, "Patcher modified the input");
  const expected = Buffer.from(input);
  for (const offset of [0x1a19, 0x3543, 0xbf31]) {
    assert.equal(expected.subarray(offset, offset + 5).toString("hex"), "ad19c030fb");
    expected.fill(0xea, offset, offset + 5);
  }
  for (const offset of [0x356c, 0xbf5a]) {
    assert.equal(expected.subarray(offset, offset + 3).toString("hex"), "201a0e");
    expected.set([0x20, 0xb9, 0x0d], offset);
  }
  assert.equal(result.patches.length, 5);
  assert.equal(expected.reduce((n, byte, i) => n + (byte !== input[i]), 0), 19);
  assert.equal(result.woz.length, 234496);
  const sectors = readWozSectors(result.woz,
    Array.from({ length: 560 }, (_, i) => ({ track: i >> 4, sector: i & 15 })));
  for (const { track, sector, data } of sectors) {
    const logical = sector === 15 ? 15 : sector * 7 % 15;
    const offset = (track * 16 + logical) * 256;
    assert.deepEqual(data, expected.subarray(offset, offset + 256), `Sector ${track}/${sector}`);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "halley-3ric-"));
  const source = path.join(directory, "original.dsk");
  const output = path.join(directory, "new.woz");
  try {
    fs.writeFileSync(source, input, { flag: "wx" });
    let cli = spawnSync(process.execPath, [tool, source, output], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.deepEqual(fs.readFileSync(output), result.woz);
    for (const destination of [source, output]) {
      cli = spawnSync(process.execPath, [tool, source, destination], { encoding: "utf8" });
      assert.equal(cli.status, 1);
      assert.match(cli.stderr, /EEXIST/);
    }
    assert.deepEqual(fs.readFileSync(source), input);
    assert.deepEqual(fs.readFileSync(output), result.woz);
  } finally {
    for (const file of [source, output]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
  console.log("PASS five guarded edits, exactly 19 changed bytes, all 560 sectors, CRC and exclusive CLI output");
  return result.woz;
}

async function testGame(input, patchedWoz) {
  const original = await bootFlight(buildWozFromDsk(input), 0);
  let patched;
  try {
    // Poison an unsupported status read; this is not a fabricated VBL device.
    patched = await bootFlight(patchedWoz, 0xff);
    const heading = vm => vm.peek(0x1e) | vm.peek(0x1f) << 8;
    const start = heading(original);
    let frames = 0;
    while (((heading(original) - start) & 2047) < 1024) {
      assert(++frames < 500, "Could not point away from the comet");
      frame(original, 129);
      frame(patched, 129);
      assert.equal(heading(patched), heading(original));
      if (frames % 8 === 0)
        assert.deepEqual(Buffer.from(patched.renderFrame()), Buffer.from(original.renderFrame()),
          "Ordinary-flight graphics changed");
    }
    console.log("PASS unchanged ordinary-flight frames while turning away using the controller");

    enterHyperspace(original);
    seek(original, 0x1543, 10000000);
    original.poke(0xc019, 0x80);
    original.keyDown(32);
    original.runCycles(3000000);
    assert([0x1543, 0x1546].includes(original.pc()), "Original VBL hang was not reproduced");
    assert.equal(original.peek(0xc000), 0xa0, "Hung game unexpectedly consumed the exit key");
    original.poke(0xc019, 0);
    seek(original, 0x0858, 10000000);
    enterHyperspace(original);
    seek(original, 0x156c, 10000000);
    original.setGamepadState(0, 1);
    original.addBreakpoint(0x157c);
    original.runCycles(5000000);
    assert(!original.breakpointHit(), "Original unexpectedly refreshed the hyperspace controller");
    original.removeBreakpoint(0x157c);
    assert.equal(original.peek(0xcee0), 0);
    original.setGamepadState(0, 0);
    console.log("PASS original-image reproductions: high-C019 hard hang and stale hyperspace button");

    for (const [mask, label] of [[1, "B"], [512, "X"], [0, "Space"]]) {
      enterHyperspace(patched);
      seek(patched, 0x156c, 10000000);
      assert.equal(patched.peek(0xc019), 0xff);
      const distance = memory(patched, 0x9c, 4);
      for (let i = 0; i < 120; i++) {
        patched.step();
        seek(patched, 0x156c);
      }
      assert.notDeepEqual(memory(patched, 0x9c, 4), distance, "Hyperspace distance did not advance");
      leaveHyperspace(patched, mask);
      console.log(`PASS high-C019 hyperspace, 120 distance updates, ${label} exit and stopped flight`);
    }
    type(patched, "L");
    seek(patched, 0x0858);
    assert.equal(patched.peek(0x122d), 0);
    type(patched, "H");
    seek(patched, 0x0858);
    assert.equal(patched.peek(0x122d), 1);
    patched.keyDown(82);
    seek(patched, 0x1800);
    patched.step();
    seek(patched, 0x181b);
    patched.keyDown(82);
    patched.step();
    seek(patched, 0x0858);
    const before = memory(patched, 0x39, 8);
    for (let i = 0; i < 8; i++) frame(patched, 16);
    assert.notDeepEqual(memory(patched, 0x39, 8), before);
    console.log("PASS post-hyperspace power, radar return and renewed thrust");
  } finally {
    original.delete();
    patched?.delete();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--dsk"))
    throw new Error("Usage: node codegen\\tools\\patch-halley.test.mjs [--dsk <original.dsk>]");
  assert.throws(() => patchHalley(Buffer.alloc(143359)), /Unsupported Halley/);
  assert.throws(() => patchHalley(Buffer.alloc(143360)), /Unsupported Halley/);
  assert.throws(() => patchHalley(Buffer.alloc(143361)), /Unsupported Halley/);
  const cli = spawnSync(process.execPath, [tool], { encoding: "utf8" });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /Usage:/);
  console.log("PASS image fingerprint/length guards and CLI usage errors");
  if (!args.length) {
    console.log("SKIP private-image sector, CLI and gameplay integration; supply --dsk <original.dsk>");
    return;
  }
  const input = fs.readFileSync(args[1]);
  await testGame(input, testImage(input));
  assert.equal(sha256(fs.readFileSync(args[1])), INPUT_SHA256);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
