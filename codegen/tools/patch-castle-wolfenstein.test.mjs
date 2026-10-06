import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildWozFromDsk, crc32 } from "./wozgen.mjs";
import { decode5and3, encode5and3, patchWozSectors, readWozSectors, sha256 } from "./wozedit.mjs";
import { FRENCH_PROFILE, ENGLISH_PROFILE, ENGLISH_SPINUP_PATCH, PATCHES, ROM_SHA256, buildControllerPayload,
  decodeEnglishDisk, detectCastleProfile, englishCoordinates, patchCastleWolfenstein } from "./patch-castle-wolfenstein.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { boot } = require("./harness.cjs");
const { SNES: PAD } = require(path.join(root, "web", "gamepad.js"));
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const cliPath = path.join(root, "codegen", "tools", "patch-castle-wolfenstein.mjs");
const coordinates = Array.from({ length: 560 }, (_, i) => ({ track: i >> 4, sector: i & 15 }));
const CPU_HZ = 1573437.5;
let profile = FRENCH_PROFILE;
let payload = buildControllerPayload(profile);

function seek(vm, pc, budget = profile.id === "english" ? 1000000000 : 50000000) {
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
  for (const diskProfile of [FRENCH_PROFILE, ENGLISH_PROFILE]) {
    const built = buildControllerPayload(diskProfile);
    assert.equal(built.resident.org, 0xc800);
    assert(built.resident.symbols.RESIDENT_END <= 0xcafe);
    assert(built.end <= 0x1f00);
    assert(built.source >= 0x880 + diskProfile.initLength);
  }
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

function testFiveAndThree() {
  assert.deepEqual(encode5and3(new Uint8Array(256)), new Uint8Array(411).fill(0xab));
  for (let value = 0; value < 256; value++) {
    const data = Uint8Array.from({ length: 256 }, (_, i) => (value * 17 + i * 13) & 255);
    data[255] = value;
    assert.deepEqual(decode5and3(encode5and3(data)), data);
  }
  assert.throws(() => encode5and3(new Uint8Array(255)), /256 bytes/);
  assert.throws(() => decode5and3(new Uint8Array(410)), /411 nibbles/);
  const bad = encode5and3(new Uint8Array(256));
  bad[20] = 0;
  assert.throws(() => decode5and3(bad), /Invalid 5-and-3/);
  bad[20] = 0xab;
  bad[410] = 0xad;
  assert.throws(() => decode5and3(bad), /checksum/);

  const woz = Buffer.from(buildWozFromDsk(new Uint8Array(143360)));
  const start = 1536;
  woz.fill(0, start, start + 13 * 512);
  let pos = 32;
  const put = value => {
    for (let bit = 7; bit >= 0; bit--, pos++)
      if (value & (1 << bit)) woz[start + (pos >> 3)] |= 0x80 >> (pos & 7);
  };
  const address = value => { put((value >> 1) | 0xaa); put(value | 0xaa); };
  [0xd5, 0xaa, 0xb5].forEach(put);
  pos++;
  [1, 0, 24, 1 ^ 24].forEach(address);
  [0xde, 0xaa].forEach(put);
  for (let i = 0; i < 7; i++) { put(0xff); pos += 2; }
  [0xd5, 0xaa, 0xad].forEach(put);
  const data = Uint8Array.from({ length: 256 }, (_, i) => i);
  const dataBits = new Set();
  for (const value of encode5and3(data)) {
    pos++;
    for (let i = 0; i < 8; i++) dataBits.add(pos + i);
    put(value);
  }
  [0xde, 0xaa].forEach(put);
  woz.writeUInt32LE(pos + 20, 260);
  woz.writeUInt32LE(crc32(woz, 12, woz.length), 8);
  const coordinate = { track: 0, sector: 24, encoding: "5and3" };
  assert.deepEqual(readWozSectors(woz, [coordinate])[0].data, Buffer.from(data));
  const patch = { ...coordinate, offset: 70, before: "46474849", after: "7f00ff81" };
  const edited = patchWozSectors(woz, [patch]);
  assert.deepEqual(patchWozSectors(edited, [{ ...patch, before: patch.after, after: patch.before }]), woz);
  for (let byte = 12; byte < woz.length; byte++) {
    const changed = woz[byte] ^ edited[byte];
    for (let bit = 0; bit < 8; bit++) if (changed & (0x80 >> bit))
      assert(dataBits.has((byte - start) * 8 + bit), "Editing changed a framing/address/metadata bit");
  }
  assert.throws(() => readWozSectors(woz, [{ ...coordinate, encoding: "unknown" }]), /encoding/);
  assert.throws(() => readWozSectors(woz, [{ ...coordinate, sector: 256 }]), /sector/);
  assert.throws(() => patchWozSectors(woz, [{ ...patch, before: "00000000" }]), /Unexpected bytes/);
  console.log("PASS 5-and-3 codec, malformed fields, extended sector IDs and bit-exact editing with nibble gaps");
}

async function bootTitle(woz) {
  const session = await boot();
  const vm = session.vm;
  try {
    assert(vm.insertDisk(0, woz));
    type(vm, "MON\r");
    type(vm, "C600G\r");
    seek(vm, profile.titleKey);
    assert.equal(vm.textMode(), 0);
    assert.equal(vm.lores(), 0);
    assert.equal(vm.gfxPage(), 0);
    const shadow = Buffer.from(rom.subarray(0xd000, 0x10000));
    const symbols = payload.resident.symbols;
    shadow.set([0x4c, symbols.NMI_RESUME & 255, symbols.NMI_RESUME >> 8], 0xf1ce - 0xd000);
    shadow.writeUInt16LE(symbols.NMI_ENTRY, 0xfffa - 0xd000);
    assert(!vm.romVisible(0xfffa), "The fast NMI RAM shadow is not mapped");
    assert.deepEqual(Buffer.from(Array.from({ length: shadow.length }, (_, i) => vm.peekMapped(0xd000 + i))), shadow);
    vm.writeBus(0xd000, shadow[0] ^ 255);
    assert.equal(vm.peekMapped(0xd000), shadow[0], "The monitor shadow must be read-only");
    assert.equal(vm.peek(0xf1ce), rom[0xf1ce], "Installing the shadow changed the original ROM");
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
  assert.match(session.textScreen().join("\n"), /START\/K.*SNES\+K/);
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
  assert(!vm.romVisible(0xfffa), "Game lost the fast RAM input handler");
  assert.equal(vm.peekMapped(0xfffa) | vm.peekMapped(0xfffb) << 8, payload.resident.symbols.NMI_ENTRY);
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
    console.log(`PASS actual ${profile.id} disk boot, title/menu, keyboard movement/stop/aim/fire and speaker PCM`);

    press(vm, "O", 0x1f56);
    press(vm, "X", 0x1f50);
    seek(vm, 0x08ae);
    assert.equal(vm.peek(0x436f), 0x40, "The guard did not capture the player");
    vm.step();
    vm.runCycles(10000);
    vm.keyDown(13);
    seek(vm, 0x0a4a);
    assert.match(session.textScreen().join("\n"), /START\/K.*SNES\+K/);
    vm.step();
    vm.runCycles(10000);
    startGame(vm);
    console.log("PASS guard capture through keyboard play, return to options and restart from the supplied castle");

    vm.keyDown(27);
    seek(vm, 0xff59);
    assert(vm.romVisible(0xfffa), "Exit did not restore the original ROM");
    assert.equal(vm.peek(0xc000) & 128, 0, "Escape leaked into the monitor");
    assert.equal(vm.peek(0x1efb), 0x4c, "Extended game tail was not loaded by DOS");
    vm.step();
    vm.runCycles(1000000);
    assert.equal(vm.textMode(), 1);
    type(vm, "4343\r");
    assert.match(session.textScreen().join("\n"), /4343-/, "Monitor lost the first command character");
    type(vm, "C600G\r");
    seek(vm, profile.titleKey);
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
    assert.match(session.textScreen().join("\n"), /START\/K.*SNES\+K/);
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
    assert.equal(sample(PAD.RIGHT)[0], 0, "Physical U must reach the action dispatcher with the D-pad held");
    assert.equal(action(), 0xd5);
    acknowledge();
    assert.equal(sample(PAD.RIGHT)[0], 0, "Clearing U must not cancel a timed use operation by resuming motion");
    sample(0);
    assert.equal(sample(PAD.RIGHT)[0], 8, "D-pad release must rearm movement after an action");
    sample(0);
    vm.setGamepadState(0, PAD.RIGHT);
    vm.keyDown(85);
    assert.equal(action(), 0xd5);
    acknowledge();
    assert.equal(sample(PAD.RIGHT)[0], 0, "An action arriving after the movement scan was cancelled");
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
    if (profile.id === "french") {
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
    }
    vm.setGamepadState(0, profile.id === "english" ? PAD.LEFT | PAD.A : PAD.DOWN | PAD.X);
    vm.step();
    seek(vm, 0x08ae);
    assert.equal(vm.peek(0x436f), profile.id === "english" ? 0x50 : 0x40);
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
    console.log("PASS Start capture/restart, Select inventory and grenade dispatch (seeded grenade stock)");
  } finally {
    vm.delete();
  }
}

async function testKeyboardUse(woz) {
  const session = await bootPadGame(woz), vm = session.vm;
  const english = profile.id === "english";
  const aim = english ? PAD.A : PAD.Y;
  const itemFlag = english ? 0x436c : 0x4349;
  try {
    // Position beside the disk's real first chest; only its opening timer is shortened.
    vm.poke(0x4343, english ? 58 : 1);
    vm.setGamepadState(0, aim | PAD.R);
    seek(vm, 0x1343);
    assert.equal(vm.regA(), 0xa0);
    vm.step();
    seek(vm, 0x59d7);
    assert.equal(vm.peek(0x5879), english ? 15 : 11);
    assert(vm.peek(0x587a) > 0);
    vm.poke(0x587b, 0);
    vm.step();
    seek(vm, 0x1301);
    vm.step();
    assert.equal(vm.peek(itemFlag), 0);
    vm.setGamepadState(0, PAD.RIGHT | aim);
    vm.keyDown(85);
    seek(vm, 0x5a58, 3000000);
    assert.equal(vm.peek(0x4341), 0);
    assert.equal(vm.peek(0xc000), 0xd5);
    assert.equal(vm.peek(0x587b), 0);
    vm.step();
    until(vm, () => vm.peek(itemFlag) === 1, "Keyboard U did not finish using the open chest", 50000000);
    assert.equal(vm.peek(0x4341), 0, "Held movement cancelled the use action");
    vm.setGamepadState(0, 0);
    until(vm, () => vm.peek(payload.resident.symbols.ACTION_PAUSE) === 0, "D-pad release did not clear action pause");
    vm.setGamepadState(0, PAD.RIGHT);
    until(vm, () => vm.peek(0x4341) === 8, "Fresh D-pad press did not resume movement");
    console.log(`PASS keyboard U with held D-pad ${english ? "collects the plans" : "equips a uniform"} from an open-chest fixture`);
  } finally {
    vm.delete();
  }
}

async function testRuntimeGuard(woz) {
  const session = await boot(), vm = session.vm;
  try {
    assert(vm.insertDisk(0, woz));
    type(vm, "MON\rC600G\r");
    seek(vm, payload.installer.org);
    vm.poke(0xf1bb, vm.peek(0xf1bb) ^ 1);
    vm.step();
    seek(vm, payload.installer.symbols.HALTED, 1000000);
    assert.match(session.textScreen().join("\n"), /3RIC INPUT ROM MISMATCH - RESET/);
    assert(vm.romVisible(0xfffa), "Rejected installer left the RAM shadow active");
    console.log("PASS on-machine NMI-proxy mismatch rejection");
  } finally {
    vm.delete();
  }
}

async function measureDiskLoading(woz, skipSpinup) {
  const session = await boot(), vm = session.vm;
  const advance = (pc, budget = 1000000000) => {
    assert(vm.addBreakpoint(pc));
    const cycles = vm.runCycles(budget);
    vm.removeBreakpoint(pc);
    assert(vm.breakpointHit());
    assert.equal(vm.pc(), pc, `Loading stopped at $${vm.pc().toString(16)} instead of $${pc.toString(16)}`);
    return cycles;
  };
  try {
    assert(vm.insertDisk(0, woz));
    type(vm, "MON\rC600G");
    if (skipSpinup) assert(vm.addBreakpoint(0xbd7d));
    vm.keyDown(13);
    const title = advance(0x0c56);
    assert.equal(vm.peekMapped(0xbd7b), skipSpinup ? 0x80 : 0xd0);
    const titleFrame = sha256(Buffer.from(vm.renderFrame()));

    vm.keyDown(13);
    const menu = advance(0x0a4a);
    vm.step();
    vm.runCycles(10000);
    vm.keyDown(75);
    let game = advance(0x0810);
    const binary = sha256(Buffer.from(Array.from({ length: 0x16ee }, (_, i) => vm.peek(0x0810 + i))));
    game += advance(0x119c);
    assert.equal(vm.textMode(), 0);
    assert.equal(vm.peek(0x4347), 10);

    // Include a motor-off interval before cold-reentering the disk loader.
    vm.keyDown(27);
    const exit = advance(0xff59);
    vm.step();
    vm.runCycles(Math.ceil(2 * CPU_HZ));
    type(vm, "C600G");
    vm.keyDown(13);
    const reboot = advance(0x0c56);
    assert.equal(sha256(Buffer.from(vm.renderFrame())), titleFrame);
    return { title, menu, game, exit, reboot, titleFrame, binary };
  } finally {
    vm.delete();
  }
}

async function testSolidStateLoading(woz) {
  const slow = patchWozSectors(woz, [{
    track: 0, sector: 7, encoding: "5and3", offset: 0x7b,
    before: ENGLISH_SPINUP_PATCH.after, after: ENGLISH_SPINUP_PATCH.before,
  }]);
  assert.equal(sha256(slow), "07106c99054bf6408f6e4f74c19cbb8768541694b120ea03c530876542932722",
    "The solid-state disk changed more than the guarded DOS branch");
  const before = await measureDiskLoading(slow, false);
  const after = await measureDiskLoading(woz, true);
  assert.equal(after.titleFrame, before.titleFrame, "The title output changed");
  assert.equal(after.binary, before.binary, "The disk-loaded game binary changed");
  assert(after.title <= 35 * CPU_HZ, "Cold title exceeded the 35-second solid-state limit");
  assert(after.title * 2 <= before.title, "Cold title was not at least twice as fast");
  for (const stage of ["menu", "game", "exit", "reboot"])
    assert(after[stage] < before[stage], `${stage} loading did not improve`);
  assert(after.reboot <= 35 * CPU_HZ, "Reboot exceeded the solid-state limit");
  for (const stage of ["title", "menu", "game", "exit", "reboot"])
    console.log(`  ${stage}: ${before[stage]} -> ${after[stage]} cycles `
      + `(${(before[stage] / CPU_HZ).toFixed(2)} -> ${(after[stage] / CPU_HZ).toFixed(2)} seconds at 1x)`);
  console.log("PASS solid-state DOS: exact branch-only delta, no spin-up-loop entries, unchanged title/game and faster cold/warm loading");
}

async function testImage(inputPath) {
  const original = fs.readFileSync(inputPath);
  profile = detectCastleProfile(original);
  const result = patchCastleWolfenstein(original, rom);
  payload = result.payload;
  const { dsk, woz, patches, wozPatches, addedSectors, initLength } = result;
  const originalDisk = profile.id === "english" ? decodeEnglishDisk(original) : original;
  const restored = Buffer.from(dsk);
  for (const { offset, before, after } of patches) {
    assert.equal(restored.subarray(offset, offset + after.length / 2).toString("hex"), after);
    restored.set(Buffer.from(before, "hex"), offset);
  }
  assert.deepEqual(restored, originalDisk);
  const firstSector = list => dsk[list + 12] * 4096 + dsk[list + 13] * 256;
  assert.equal(dsk.readUInt16LE(firstSector(profile.wolfList)) + dsk.readUInt16LE(firstSector(profile.wolfList) + 2), 0x1efe);
  assert.equal(dsk.readUInt16LE(firstSector(profile.initList) + 2), initLength);
  assert.equal(dsk.readUInt16LE(0x11b74 + 33), 20 + addedSectors);
  const bitmapOffset = 0x11038 + profile.extensionTrack * 4;
  let bitmap = originalDisk.readUInt32BE(bitmapOffset);
  for (let sector = 0; sector < addedSectors; sector++) {
    assert.deepEqual(dsk.subarray(profile.initList + 12 + (19 + sector) * 2, profile.initList + 14 + (19 + sector) * 2),
      Buffer.from([profile.extensionTrack, sector]));
    bitmap = (bitmap & ~(1 << (profile.bitmapShift + sector))) >>> 0;
  }
  assert.equal(dsk.readUInt32BE(bitmapOffset), bitmap);
  assert.equal(sha256(original), profile.sha256, "Patcher modified its input buffer");
  if (profile.id === "english") {
    assert.equal(woz.length, original.length);
    assert.deepEqual(patchWozSectors(woz, wozPatches.map(p => ({ ...p, before: p.after, after: p.before }))), original);
    assert.deepEqual(woz.subarray(12, 1536), original.subarray(12, 1536), "WOZ metadata/track descriptors changed");
    assert.equal(englishCoordinates().length, 453);
    assert.deepEqual(decodeEnglishDisk(woz), dsk);
    assert.equal(originalDisk[0x077b], 0xd0);
    assert.equal(dsk[0x077b], 0x80);
    assert.deepEqual(dsk.subarray(0x077c, 0x078a), originalDisk.subarray(0x077c, 0x078a),
      "Spin-up edit changed its destination or delay-loop bytes");
  } else verifySectors(woz, dsk);
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
    if (profile.id === "english") await testSolidStateLoading(woz);
    await testGameplay(fs.readFileSync(output));
    await testPadDriver(woz);
    await testPadGameplay(woz);
    await testPadActions(woz);
    await testKeyboardUse(woz);
    if (profile.id === "french") await testRuntimeGuard(woz);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  assert.deepEqual(fs.readFileSync(inputPath), original);
  console.log(`PASS exact image/ROM, reversible byte edits, CLI exclusive output; WOZ SHA-256 ${sha256(woz)}`);
}

testGuards();
testFiveAndThree();
const args = process.argv.slice(2);
if (args.length === 0) console.log("SKIP owner-disk gameplay: pass --disk <original.do|original.woz> (game assets are not bundled)");
else if (args.length === 2 && args[0] === "--disk") await testImage(path.resolve(args[1]));
else throw new Error("Usage: node codegen\\tools\\patch-castle-wolfenstein.test.mjs [--disk <original.do|original.woz>]");
