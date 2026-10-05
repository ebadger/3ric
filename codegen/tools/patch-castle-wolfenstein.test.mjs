import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildWozFromDsk, crc32 } from "./wozgen.mjs";
import { readWozSectors, sha256 } from "./wozedit.mjs";
import { INPUT_SHA256, PATCHES, ROM_SHA256, patchCastleWolfenstein } from "./patch-castle-wolfenstein.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { boot } = require("./harness.cjs");
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const cliPath = path.join(root, "codegen", "tools", "patch-castle-wolfenstein.mjs");
const coordinates = Array.from({ length: 560 }, (_, i) => ({ track: i >> 4, sector: i & 15 }));

function seek(vm, pc, budget = 50000000) {
  assert(vm.addBreakpoint(pc));
  vm.runCycles(budget);
  vm.removeBreakpoint(pc);
  assert(vm.breakpointHit(), `Timed out waiting for $${pc.toString(16)} at $${vm.pc().toString(16)}`);
  assert.equal(vm.pc(), pc);
}

function type(vm, text) {
  for (const ch of text) {
    assert.equal(vm.peek(0xc000) & 128, 0, "Previous keyboard strobe was not consumed");
    vm.keyDown(ch.charCodeAt(0));
    vm.runCycles(300000);
  }
}

function verifySectors(woz, dsk) {
  assert.equal(woz.readUInt32LE(8), crc32(woz, 12, woz.length));
  const sectors = readWozSectors(woz, coordinates);
  assert.equal(sectors.length, 560);
  for (const { track, sector, data } of sectors) {
    const logical = sector === 15 ? 15 : sector * 7 % 15;
    const offset = track * 4096 + logical * 256;
    assert.deepEqual(data, dsk.subarray(offset, offset + 256), `Track ${track}, sector ${sector}`);
  }
}

function testGuards() {
  assert.equal(sha256(rom), ROM_SHA256);
  const fixture = Buffer.from(Uint8Array.from({ length: 143360 }, (_, i) => (i * 17 + (i >> 8)) & 255));
  verifySectors(Buffer.from(buildWozFromDsk(fixture)), fixture);
  const used = new Set();
  for (const { offset, before, after } of PATCHES) {
    assert.equal(before.length, after.length);
    assert(offset >= 0 && offset + before.length / 2 <= fixture.length);
    for (let i = 0; i < before.length / 2; i++) {
      assert(!used.has(offset + i), "Patch ranges overlap");
      used.add(offset + i);
    }
  }
  assert.throws(() => patchCastleWolfenstein(fixture, rom), /Unsupported Castle Wolfenstein/);
  assert.throws(() => patchCastleWolfenstein(fixture.subarray(1), rom), /Unsupported Castle Wolfenstein/);
  const wrongRom = Buffer.from(rom);
  wrongRom[0xff59] ^= 1;
  assert.throws(() => patchCastleWolfenstein(fixture, wrongRom), /Unsupported 3ric ROM/);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "3ric-wolf-"));
  try {
    const input = path.join(temporary, "unsupported.do");
    const output = path.join(temporary, "output.woz");
    fs.writeFileSync(input, fixture);
    const cli = args => spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
    assert.equal(cli(["--help"]).status, 0);
    assert.notEqual(cli([]).status, 0);
    const rejected = cli([input, output]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /Unsupported Castle Wolfenstein/);
    assert(!fs.existsSync(output), "A rejected image produced output");
    assert.match(cli([input, input]).stderr, /Refusing to overwrite/);
    assert.match(cli([input, path.join(temporary, "bad.do")]).stderr, /woz extension/);
    assert.deepEqual(fs.readFileSync(input), fixture);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log("PASS DOS-order conversion, all 560 sector checksums, patch bounds and rejection/no-output guards");
}

async function bootTitle(woz) {
  const session = await boot();
  const vm = session.vm;
  try {
    assert(vm.insertDisk(0, woz));
    type(vm, "MON\r");
    type(vm, "C600G\r");
    seek(vm, 0x0c44);
    assert.equal(vm.textMode(), 0);
    assert.equal(vm.lores(), 0);
    assert.equal(vm.gfxPage(), 0);
    const frame = vm.renderFrame();
    let lit = 0;
    for (let i = 0; i < frame.length; i += 4) if (frame[i] || frame[i + 1] || frame[i + 2]) lit++;
    assert(lit > 5000, "The actual title picture did not load");
    return session;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

function enterMenu(session) {
  session.vm.keyDown(13);
  seek(session.vm, 0x0a4a);
  assert.match(session.textScreen().join("\n"), /TAPER K.*CLAVIER/);
  session.vm.step();
  session.vm.runCycles(10000);
}

function startGame(vm) {
  vm.keyDown(75);
  seek(vm, 0x0810);
  seek(vm, 0x119c);
  assert.equal(vm.peek(0x1f00), 0x4c, "Original keyboard driver was not installed");
  assert.equal(vm.peek(0x4347), 10, "The supplied castle's inventory did not load");
  assert.equal(vm.textMode(), 0);
  assert(vm.romVisible(0xfffa), "Game hid the ROM input handler");
  assert(!vm.romVisible(0x9d00), "DOS RAM was replaced by BASIC");
}

function press(vm, code, target) {
  assert.equal(vm.peek(0xc000) & 128, 0);
  vm.keyDown(typeof code === "string" ? code.charCodeAt(0) : code);
  seek(vm, target);
  vm.step();
  // Finish the ROM's strobe-clear NMI before another injected key.
  vm.runCycles(10000);
}

async function testGameplay(woz) {
  const session = await bootTitle(woz);
  const vm = session.vm;
  try {
    enterMenu(session);
    startGame(vm);
    const beforeTile = vm.peek(0x4343);
    const beforeFrame = Buffer.from(vm.renderFrame());
    press(vm, "A", 0x1f50);
    assert.equal(vm.peek(0x4341), 4);
    vm.runCycles(100000);
    press(vm, "S", 0x1f50);
    assert.equal(vm.peek(0x4341), 0);
    assert.notEqual(vm.peek(0x4343), beforeTile, "Movement did not change the player's tile");
    assert.notDeepEqual(Buffer.from(vm.renderFrame()), beforeFrame);
    press(vm, ";", 0x1f56);
    assert.equal(vm.peek(0x4342), 8, "Aim-right was not retained");
    const bullets = vm.peek(0x4347);
    assert(vm.enableAudio(44100));
    press(vm, "L", 0x1f36);
    let peak = 0, spent = 0;
    while (vm.peek(0x4347) === bullets && spent < 3000000) {
      spent += vm.runCycles(10000);
      for (const sample of vm.drainAudio()) {
        assert(Number.isFinite(sample));
        peak = Math.max(peak, Math.abs(sample));
      }
    }
    assert.equal(vm.peek(0x4347), bullets - 1, "Fire did not consume a bullet");
    assert(peak > 0.01, "No system-speaker PCM was produced");
    vm.disableAudio();
    console.log("PASS actual disk boot, French title/menu, keyboard movement/stop/aim/fire and speaker PCM");

    press(vm, "O", 0x1f56);
    press(vm, "X", 0x1f50);
    seek(vm, 0x08ae);
    assert.equal(vm.peek(0x436f), 0x40, "The guard did not capture the player");
    vm.step();
    vm.runCycles(10000);
    vm.keyDown(13);
    seek(vm, 0x0a4a);
    assert.match(session.textScreen().join("\n"), /TAPER K.*CLAVIER/);
    vm.step();
    vm.runCycles(10000);
    startGame(vm);
    console.log("PASS guard capture through keyboard play, return to options and restart from the supplied castle");

    vm.keyDown(27);
    seek(vm, 0xff59);
    assert.equal(vm.peek(0xc000) & 128, 0, "Escape leaked into the monitor");
    assert.equal(vm.peek(0x1efb), 0x4c, "Extended game tail was not loaded by DOS");
    vm.step();
    vm.runCycles(1000000);
    assert.equal(vm.textMode(), 1);
    type(vm, "4343\r");
    assert.match(session.textScreen().join("\n"), /4343-/, "Monitor lost the first command character");
    type(vm, "C600G\r");
    seek(vm, 0x0c44);
    assert.equal(vm.textMode(), 0);
    console.log("PASS Escape exit, usable monitor and disk reboot; save persistence is NOT supported");
  } finally {
    vm.delete();
  }
}

async function testImage(inputPath) {
  const original = fs.readFileSync(inputPath);
  assert.equal(sha256(original), INPUT_SHA256);
  const { dsk, woz } = patchCastleWolfenstein(original, rom);
  const restored = Buffer.from(dsk);
  for (const { offset, before, after } of PATCHES) {
    assert.equal(restored.subarray(offset, offset + after.length / 2).toString("hex"), after);
    restored.set(Buffer.from(before, "hex"), offset);
  }
  assert.deepEqual(restored, original);
  assert.equal(dsk.readUInt16LE(0xc500) + dsk.readUInt16LE(0xc502), 0x1efe);
  assert.equal(sha256(original), INPUT_SHA256, "Patcher modified its input buffer");
  verifySectors(woz, dsk);
  const changed = Buffer.from(original);
  changed[0x0ce7] ^= 1;
  assert.throws(() => patchCastleWolfenstein(changed, rom), /Unsupported Castle Wolfenstein/);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "3ric-wolf-output-"));
  try {
    const output = path.join(temporary, "castle.woz");
    const cli = () => spawnSync(process.execPath, [cliPath, inputPath, output], { encoding: "utf8" });
    assert.equal(cli().status, 0);
    assert.deepEqual(fs.readFileSync(output), woz);
    assert.equal(cli().status, 1, "Patcher overwrote an existing output");
    assert.deepEqual(fs.readFileSync(output), woz);
    await testGameplay(fs.readFileSync(output));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  assert.deepEqual(fs.readFileSync(inputPath), original);
  console.log(`PASS exact image/ROM, reversible byte edits, CLI exclusive output; WOZ SHA-256 ${sha256(woz)}`);
}

testGuards();
const args = process.argv.slice(2);
if (args.length === 0) console.log("SKIP owner-disk gameplay: pass --disk <original.do> (game assets are not bundled)");
else if (args.length === 2 && args[0] === "--disk") await testImage(path.resolve(args[1]));
else throw new Error("Usage: node codegen\\tools\\patch-castle-wolfenstein.test.mjs [--disk <original.do>]");
