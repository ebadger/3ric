import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildWozFromDsk, crc32 } from "./wozgen.mjs";
import { readWozSectors, sha256 } from "./wozedit.mjs";
import { INPUT_SHA256, PATCHES, ROM_SHA256, buildControllerPayload, patchCastleWolfenstein } from "./patch-castle-wolfenstein.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { boot } = require("./harness.cjs");
const { SNES: PAD } = require(path.join(root, "web", "gamepad.js"));
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const cliPath = path.join(root, "codegen", "tools", "patch-castle-wolfenstein.mjs");
const coordinates = Array.from({ length: 560 }, (_, i) => ({ track: i >> 4, sector: i & 15 }));
const payload = buildControllerPayload();

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
  assert.equal(payload.resident.org, 0xc800);
  assert(payload.resident.symbols.RESIDENT_END <= 0xcafe);
  assert(payload.end <= 0x1f00);
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
  assert.match(session.textScreen().join("\n"), /START\/K.*SNES\+KB/);
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
    assert.match(session.textScreen().join("\n"), /START\/K.*SNES\+KB/);
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

function guestCall(vm, address, decimal = false) {
  const call = assemble(`.org $0300
    php
    pha
    phx
    phy
    ${decimal ? "sed" : ""}
    jsr $${address.toString(16)}
    sta result
    php
    pla
    sta flags
    ply
    plx
    pla
    plp
done: jmp done
result: .byte 0
flags: .byte 0`);
  const savedPC = vm.pc();
  const saved = Buffer.from(Array.from({ length: call.bytes.length }, (_, i) => vm.peek(call.org + i)));
  const registers = [vm.regA(), vm.regX(), vm.regY(), vm.sp(), vm.status() & 0xcf];
  try {
    vm.loadData(call.org, call.bytes);
    vm.setPC(call.org);
    seek(vm, call.symbols.DONE, 20000);
    assert.deepEqual([vm.regA(), vm.regX(), vm.regY(), vm.sp(), vm.status() & 0xcf], registers);
    return { a: vm.peek(call.symbols.RESULT), flags: vm.peek(call.symbols.FLAGS) };
  } finally {
    vm.loadData(call.org, saved);
    vm.setPC(savedPC);
  }
}

function until(vm, predicate, message, budget = 10000000) {
  let cycles = 0;
  while (!predicate() && cycles < budget) cycles += vm.runCycles(1000);
  assert(predicate(), `${message}; stopped at $${vm.pc().toString(16)}`);
}

function startFromPadMenu(vm) {
  vm.step();
  vm.addBreakpoint(0x0a4d);
  vm.runCycles(100000);
  assert(!vm.breakpointHit(), "Held Start skipped the options screen");
  vm.removeBreakpoint(0x0a4d);
  vm.setGamepadState(0, 0);
  vm.runCycles(20000);
  vm.setGamepadState(0, PAD.START);
  seek(vm, 0x0810);
  vm.setGamepadState(0, 0);
  seek(vm, 0x119c);
}

async function bootPadGame(woz) {
  const session = await bootTitle(woz);
  const vm = session.vm;
  try {
    vm.setGamepadState(1, PAD.START);
    vm.addBreakpoint(0x0a4a);
    vm.runCycles(100000);
    assert(!vm.breakpointHit(), "Controller 2 advanced the title");
    vm.removeBreakpoint(0x0a4a);
    vm.setGamepadState(1, 0);
    vm.setGamepadState(0, PAD.START);
    seek(vm, 0x0a4a);
    assert.match(session.textScreen().join("\n"), /START\/K.*SNES\+KB/);
    startFromPadMenu(vm);
    return session;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

async function testPadDriver(woz) {
  const session = await bootPadGame(woz), vm = session.vm;
  const symbols = payload.resident.symbols;
  const code = () => Buffer.from(Array.from({ length: symbols.PORT_LOW - 0xc800 }, (_, i) => vm.peek(0xc800 + i)));
  const bankMode = vm.peek(0xcafe);
  const keys = Buffer.from(Array.from({ length: 256 }, (_, i) => vm.peek(0xcb00 + i)));
  const sample = (mask, decimal = false) => {
    vm.setGamepadState(0, mask);
    guestCall(vm, 0x1f00, decimal);
    return [vm.peek(0x4341), vm.peek(0x4342)];
  };
  const pending = () => vm.peek(symbols.PENDING_KEY);
  const action = () => {
    const result = guestCall(vm, symbols.READ_ACTION);
    assert.equal(result.flags & 0x82, result.a & 128 ? 0x80 : result.a === 0 ? 2 : 0);
    return result.a;
  };
  const acknowledge = () => vm.writeBus(0xc000, 0);
  try {
    assert.deepEqual(code(), Buffer.from(payload.resident.bytes.subarray(0, symbols.PORT_LOW - 0xc800)));
    for (const [mask, direction] of [
      [PAD.UP, 2], [PAD.RIGHT, 8], [PAD.DOWN, 1], [PAD.LEFT, 4],
      [PAD.UP | PAD.RIGHT, 10], [PAD.DOWN | PAD.RIGHT, 9],
      [PAD.DOWN | PAD.LEFT, 5], [PAD.UP | PAD.LEFT, 6],
      [PAD.UP | PAD.DOWN, 0], [PAD.LEFT | PAD.RIGHT, 0],
      [PAD.UP | PAD.DOWN | PAD.RIGHT, 8], [PAD.LEFT | PAD.RIGHT | PAD.UP, 2],
      [PAD.UP | PAD.DOWN | PAD.LEFT | PAD.RIGHT, 0],
    ]) {
      assert.equal(sample(mask)[0], direction);
      assert.equal(sample(0)[0], 0, "Releasing/disconnecting the pad left movement latched");
    }
    sample(PAD.RIGHT);
    vm.keyDown(87);
    assert.equal(sample(0)[0], 2, "D-pad release discarded a fresh keyboard movement");
    assert.equal(sample(0)[0], 2, "Keyboard movement stopped latching");
    vm.keyDown(83);
    assert.equal(sample(0)[0], 0);
    for (const [mask, direction] of [
      [PAD.X, 2], [PAD.A, 8], [PAD.B, 1], [PAD.Y, 4],
      [PAD.X | PAD.A, 10], [PAD.A | PAD.B, 9], [PAD.B | PAD.Y, 5], [PAD.Y | PAD.X, 6],
      [PAD.X | PAD.B | PAD.A, 8], [PAD.A | PAD.Y | PAD.X, 2],
    ]) {
      assert.equal(sample(mask)[1], direction);
      assert.equal(sample(0)[1], direction, "Releasing aim did not retain the last direction");
    }
    assert.equal(sample(PAD.X | PAD.B | PAD.A | PAD.Y)[1], 2, "Opposite aim axes did not cancel");
    assert.deepEqual(sample(PAD.DOWN | PAD.LEFT | PAD.X | PAD.A | PAD.L), [5, 10]);
    for (let i = 0; i < 3; i++) {
      const fire = guestCall(vm, 0x1f06);
      assert.equal(fire.a, 0x80);
      assert.equal(fire.flags & 0x82, 0x80);
    }
    assert.deepEqual(sample(PAD.DOWN | PAD.LEFT | PAD.X | PAD.A, true), [5, 10]);
    sample(0);
    assert.equal(guestCall(vm, 0x1f06).a, 0);
    vm.setGamepadState(1, 0xffff);
    assert.deepEqual(sample(0), [0, 10]);
    assert.equal(pending(), 0);
    assert.equal(guestCall(vm, 0x1f06).a, 0);
    vm.setGamepadState(1, 0);

    // The original options screen uses this byte to swap its keyboard grids.
    vm.poke(0x1f09, 0x80);
    for (const [key, address, expected] of [[79, 0x4341, 2], [76, 0x4341, 0], [87, 0x4342, 2]]) {
      vm.keyDown(key);
      sample(0);
      assert.equal(vm.peek(address), expected);
    }
    vm.keyDown(83);
    sample(0);
    assert.equal(guestCall(vm, 0x1f06).a, 0x80, "Swapped-keyboard fire stopped working");
    vm.poke(0x1f09, 0);

    assert.equal(sample(PAD.RIGHT | PAD.R)[0], 0, "Search must stop movement");
    assert.equal(action(), 0xa0);
    acknowledge();
    sample(PAD.R);
    assert.equal(pending(), 0, "Held search repeated its action");
    sample(0);
    vm.keyDown(85);
    sample(PAD.R);
    assert.equal(action(), 0xd5, "Pad action overwrote a ready physical key");
    assert.equal(pending(), 0xa0);
    acknowledge();
    assert.equal(action(), 0xa0);
    acknowledge();
    sample(0);

    sample(PAD.SELECT);
    assert.equal(pending(), 0, "Select fired before the tap/chord was known");
    sample(0);
    assert.equal(action(), 0x8d);
    acknowledge();
    for (const [mask, expected] of [
      [PAD.SELECT | PAD.L, 0xd4], [PAD.SELECT | PAD.R, 0xd5],
      [PAD.SELECT | PAD.L | PAD.R, 0xd5],
      [PAD.SELECT | PAD.START | PAD.L | PAD.R, 0x9b],
    ]) {
      sample(mask);
      assert.equal(guestCall(vm, 0x1f06).a, 0, "A modifier chord also fired the gun");
      assert.equal(action(), expected);
      if (expected === 0xd4) assert.equal(vm.peek(0xc000) & 128, 0, "Synthetic no-ammo T remained latched");
      acknowledge();
      sample(mask);
      assert.equal(pending(), 0, "Held chord repeated");
      sample(0);
      assert.equal(pending(), 0, "Chord release also displayed inventory/searched");
    }
    sample(PAD.SELECT | PAD.L);
    assert.equal(action(), 0xd4);
    sample(PAD.L);
    assert.equal(guestCall(vm, 0x1f06).a, 0, "Releasing Select first accidentally fired the gun");
    sample(0);
    sample(PAD.L);
    assert.equal(guestCall(vm, 0x1f06).a, 0x80, "A fresh L press remained suppressed");
    sample(0);
    vm.keyDown(85);
    sample(PAD.R);
    assert.equal(pending(), 0xa0);
    sample(PAD.SELECT | PAD.START);
    assert.equal(pending(), 0x9b, "Quit did not take priority over a queued action");
    assert.equal(action(), 0xd5);
    acknowledge();
    assert.equal(action(), 0x9b);
    acknowledge();
    sample(0);
    assert.equal(vm.peek(0xcafe), bankMode);
    assert.deepEqual(Buffer.from(Array.from({ length: 256 }, (_, i) => vm.peek(0xcb00 + i))), keys);
    assert.deepEqual(code(), Buffer.from(payload.resident.bytes.subarray(0, symbols.PORT_LOW - 0xc800)));
    console.log("PASS disk-installed SNES driver: independent axes, diagonals/opposites, releases, held fire, chords, keyboard arbitration and controller-2 isolation");
  } finally {
    vm.delete();
  }
}

async function testPadGameplay(woz) {
  const session = await bootPadGame(woz), vm = session.vm;
  try {
    const originalTile = vm.peek(0x4343);
    vm.setGamepadState(0, PAD.LEFT | PAD.A | PAD.L);
    assert(vm.enableAudio(44100));
    seek(vm, 0x1489);
    assert.equal(vm.peek(0x4341), 4);
    assert.equal(vm.peek(0x4342), 8);
    vm.step();
    until(vm, () => vm.peek(0x4347) < 10, "Held L did not fire");
    vm.setGamepadState(0, PAD.LEFT | PAD.A);
    until(vm, () => vm.peek(0x4343) !== originalTile, "D-pad did not move the player");
    vm.setGamepadState(0, 0);
    until(vm, () => vm.peek(0x4341) === 0, "Releasing the D-pad did not stop the player");
    assert.equal(vm.peek(0x4342), 8);
    assert(vm.drainAudio().some(value => Math.abs(value) > 0.01));
    vm.disableAudio();
    vm.setGamepadState(0, PAD.START | PAD.SELECT);
    seek(vm, 0xff59);
    assert.equal(vm.peek(0xc000) & 128, 0);
    vm.setGamepadState(0, 0);
    vm.step();
    vm.runCycles(1000000);
    type(vm, "4343\r");
    assert.match(session.textScreen().join("\n"), /4343-/);
    console.log("PASS controller-only start, live simultaneous movement/aim/fire, release-to-stop and Start+Select monitor exit");
  } finally {
    vm.delete();
  }
}

async function testPadActions(woz) {
  const session = await bootPadGame(woz), vm = session.vm;
  const symbols = payload.resident.symbols;
  try {
    for (const [mask, tile] of [[PAD.UP, 6], [PAD.LEFT, 1]]) {
      vm.setGamepadState(0, mask);
      until(vm, () => vm.peek(0x4343) === tile, `D-pad did not reach tile ${tile}`);
    }
    vm.setGamepadState(0, PAD.Y);
    until(vm, () => vm.peek(0x4341) === 0 && vm.peek(0x4342) === 4, "Did not aim at the chest");
    vm.setGamepadState(0, PAD.Y | PAD.R);
    seek(vm, 0x1343);
    assert.equal(vm.peek(0xc000), 0xa0);
    assert.equal(vm.regA(), 0xa0, "Search did not target the first chest");
    vm.step();
    seek(vm, 0x59d7);
    assert(vm.peek(0x587b) > 0, "Chest opening did not begin");
    vm.setGamepadState(0, PAD.SELECT | PAD.R);
    vm.step();
    seek(vm, 0x5a58);
    assert(vm.peek(0x587b) > 0, "Use fixture must still have a closed chest");
    vm.setGamepadState(0, PAD.DOWN | PAD.X);
    vm.step();
    seek(vm, 0x08ae);
    assert.equal(vm.peek(0x436f), 0x40);
    vm.setGamepadState(0, PAD.START);
    vm.step();
    seek(vm, 0x0a4a);
    startFromPadMenu(vm);
    assert.equal(vm.peek(0x4347), 10);

    vm.setGamepadState(0, PAD.SELECT);
    until(vm, () => vm.peek(symbols.PREVIOUS_SELECT) === 1, "Select was not sampled");
    vm.setGamepadState(0, 0);
    seek(vm, 0x1e49);
    vm.step();
    seek(vm, 0x1301);
    // Only the inventory stock is seeded; the actual game dispatches the chord.
    vm.poke(0x4348, 1);
    vm.setGamepadState(0, PAD.SELECT | PAD.L | PAD.X);
    vm.step();
    seek(vm, 0x1981);
    assert.equal(vm.peek(0x4348), 1);
    assert.equal(vm.peek(0x4342), 2, "Grenade fixture must have a valid aim");
    vm.step();
    until(vm, () => vm.peek(0x4348) === 0, "Grenade chord did not consume grenade stock");
    assert.equal(vm.peek(0x4347), 10, "Grenade chord also fired an ordinary bullet");
    console.log("PASS real chest search/use dispatch, Start capture/restart, Select inventory and grenade dispatch (seeded grenade stock)");
  } finally {
    vm.delete();
  }
}

async function testImage(inputPath) {
  const original = fs.readFileSync(inputPath);
  assert.equal(sha256(original), INPUT_SHA256);
  const { dsk, woz, patches, addedSectors, initLength } = patchCastleWolfenstein(original, rom);
  const restored = Buffer.from(dsk);
  for (const { offset, before, after } of patches) {
    assert.equal(restored.subarray(offset, offset + after.length / 2).toString("hex"), after);
    restored.set(Buffer.from(before, "hex"), offset);
  }
  assert.deepEqual(restored, original);
  assert.equal(dsk.readUInt16LE(0xc500) + dsk.readUInt16LE(0xc502), 0x1efe);
  assert.equal(dsk.readUInt16LE(0xd902), initLength);
  assert.equal(dsk.readUInt16LE(0x11b74 + 33), 20 + addedSectors);
  let bitmap = original.readUInt32BE(0x11048);
  for (let sector = 0; sector < addedSectors; sector++) {
    assert.deepEqual(dsk.subarray(0xda00 + 12 + (19 + sector) * 2, 0xda00 + 14 + (19 + sector) * 2),
      Buffer.from([4, sector]));
    bitmap = (bitmap & ~(1 << (16 + sector))) >>> 0;
  }
  assert.equal(dsk.readUInt32BE(0x11048), bitmap);
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
    await testPadDriver(woz);
    await testPadGameplay(woz);
    await testPadActions(woz);
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
