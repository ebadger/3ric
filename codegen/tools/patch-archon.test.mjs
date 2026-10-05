import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildWozFromDsk, crc32, decode6and2, encode6and2 } from "./wozgen.mjs";
import { patchWozSectors, readWozSectors, sha256 } from "./wozedit.mjs";
import { buildPayload, INPUT_SHA256, patchArchon } from "./patch-archon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const coordinates = Array.from({ length: 560 }, (_, i) => ({ track: i >> 4, sector: i & 15 }));
export const payload = buildPayload(rom);
export const symbols = payload.resident.symbols;
const bytesAt = (vm, address, count) =>
  Buffer.from(Array.from({ length: count }, (_, i) => vm.peekMapped(address + i)));

export function type(vm, text) {
  for (const ch of text) {
    for (let i = 0; i < 200 && (vm.peek(0xc000) & 0x80); i++) vm.runCycles(10000);
    assert.equal(vm.peek(0xc000) & 0x80, 0, "Previous keyboard strobe was not consumed");
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
    assert(vm.insertDisk(0, woz), "Disk was not inserted");
    type(vm, "MON\r");
    assert.match(vm.drainOutput(), /\*/, "MON did not enter the monitor");
    type(vm, "C600G\r");
    vm.runCycles(50000000);
    return vm;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

export async function bootMenu(woz) {
  const vm = await bootDisk(woz);
  try {
    assert.equal(vm.peek(0xcf00), payload.resident.bytes[0x300], "Disk did not install its adapter");
    for (let i = 0; i < 5; i++) {
      type(vm, " ");
      vm.runCycles(10000000);
    }
    seek(vm, symbols.MENU_PAD);
    vm.step();
    assert.equal(vm.romVisible(0xfffa), false, "Interactive menu exposed the ROM NMI handler");
    assert.equal(vm.peekMapped(0xfffa) | vm.peekMapped(0xfffb) << 8, symbols.NMI_ENTRY);
    return vm;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

export function moveMenu(vm, x, y) {
  let cycles = 0;
  while (Math.abs(vm.peek(0xa8) - x) > 2 || Math.abs(vm.peek(0xa9) - y) > 2) {
    let mask = 0;
    if (vm.peek(0xa8) < x - 2) mask |= 1 << 7;
    if (vm.peek(0xa8) > x + 2) mask |= 1 << 6;
    if (vm.peek(0xa9) < y - 2) mask |= 1 << 5;
    if (vm.peek(0xa9) > y + 2) mask |= 1 << 4;
    assert(vm.setGamepadState(0, mask));
    cycles += vm.runCycles(5000);
    assert(cycles < 30000000, `Menu cursor did not reach ${x},${y}; at ${vm.peek(0xa8)},${vm.peek(0xa9)}`);
  }
  vm.setGamepadState(0, 0);
  vm.runCycles(100000);
}

export function click(vm) {
  vm.setGamepadState(0, 1);
  vm.runCycles(200000);
  vm.setGamepadState(0, 0);
  vm.runCycles(200000);
}

export function startGame(vm) {
  moveMenu(vm, 120, 185);
  vm.setGamepadState(0, 1);
  seek(vm, payload.game.symbols.GAME_INIT, 80000000);
  vm.setGamepadState(0, 0);
  vm.step();
  vm.runCycles(20000000);
  assert.deepEqual(bytesAt(vm, 0x1ea4, 3),
    Buffer.from([0x4c, symbols.GAME_PAD & 255, symbols.GAME_PAD >> 8]));
  assert.equal(vm.peekMapped(0xfffa) | vm.peekMapped(0xfffb) << 8, symbols.NMI_ENTRY);
  assert.equal(vm.textMode(), 0);
  assert.equal(vm.gfxPage(), 0);
  assert.notEqual(vm.pc(), 0x0508, "Board fell back into the disk-reading loop");
}

export function samplePad(vm, controller, mask) {
  seek(vm, symbols.GAME_PAD, 20000000);
  vm.setGamepadState(controller, mask);
  vm.step();
  seek(vm, symbols.GAME_PAD_DONE);
  return [vm.peek(0x278), vm.peek(0x279)];
}

export function boardCursor(vm, x, y, controller) {
  const position = () => [vm.peek(0xd1) >= 128 ? vm.peek(0xd1) - 256 : vm.peek(0xd1), vm.peek(0xcf)];
  let cycles = 0;
  while (position()[0] !== x || position()[1] !== y) {
    const [cx, cy] = position();
    let mask = 0;
    if (cx < x) mask |= 1 << 7;
    if (cx > x) mask |= 1 << 6;
    if (cy < y) mask |= 1 << 5;
    if (cy > y) mask |= 1 << 4;
    vm.setGamepadState(controller, mask);
    cycles += vm.runCycles(5000);
    assert(cycles < 20000000, `Board cursor ${position()} did not reach ${x},${y}`);
  }
  vm.setGamepadState(controller, 0);
  vm.runCycles(300000);
  assert.deepEqual(position(), [x, y]);
}

export function boardFire(vm, controller) {
  vm.setGamepadState(controller, 1);
  vm.runCycles(200000);
  vm.setGamepadState(controller, 0);
  vm.runCycles(3000000);
}

function testSectorEditing() {
  const source = Uint8Array.from({ length: 256 }, (_, i) => i);
  const encoded = new Uint8Array(343);
  encode6and2(encoded, source, 0);
  assert.deepEqual(decode6and2(encoded), source);
  assert.throws(() => decode6and2(encoded.subarray(1)), /343 bytes/);
  const invalid = encoded.slice();
  invalid[8] = 0;
  assert.throws(() => decode6and2(invalid), /invalid 6-and-2/);
  invalid.set(encoded);
  invalid[342] = invalid[342] === 0x96 ? 0x97 : 0x96;
  assert.throws(() => decode6and2(invalid), /checksum/);

  const disk = Uint8Array.from({ length: 143360 }, (_, i) => (i * 13 + (i >> 8)) & 255);
  const woz = Buffer.from(buildWozFromDsk(disk));
  assert.deepEqual(patchWozSectors(woz, []), woz);
  const original = readWozSectors(woz, [{ track: 2, sector: 7 }])[0].data;
  const patch = { track: 2, sector: 7, offset: 10, before: original.subarray(10, 14).toString("hex"), after: "01234567" };
  const edited = patchWozSectors(woz, [patch]);
  const restored = patchWozSectors(edited, [{ ...patch, before: patch.after, after: patch.before }]);
  assert.deepEqual(restored, woz);
  assert.equal(edited.readUInt32LE(8), crc32(edited, 12, edited.length));
  const differences = [];
  for (let i = 12; i < woz.length; i++) if (woz[i] !== edited[i]) differences.push(i);
  assert(differences.length > 0);
  assert(differences.at(-1) - differences[0] < 345, "Changes escaped a single sector data field");
  assert.deepEqual(edited.subarray(12, 1536), woz.subarray(12, 1536), "Track metadata changed");
  assert.throws(() => patchWozSectors(woz, [{ ...patch, before: "ffffffff" }]), /Unexpected bytes/);
  assert.throws(() => patchWozSectors(woz, [patch, patch]), /Unexpected bytes|Overlapping/);
  assert.throws(() => readWozSectors(woz, [{ track: 40, sector: 0 }]), /Invalid sector/);
  assert.throws(() => readWozSectors(woz, [{ track: 35, sector: 0 }]), /Unmapped track/);
  assert.throws(() => patchWozSectors(woz.subarray(0, 100), []), /CRC/);
  const malformed = Buffer.from(woz);
  malformed.writeUInt32LE(0xffffffff, 16);
  malformed.writeUInt32LE(crc32(malformed, 12, malformed.length), 8);
  assert.throws(() => patchWozSectors(malformed, []), /Truncated INFO/);
  malformed.set(woz);
  malformed.writeUInt32LE(0xffffffff, 260);
  malformed.writeUInt32LE(crc32(malformed, 12, malformed.length), 8);
  assert.throws(() => readWozSectors(malformed, [{ track: 0, sector: 0 }]), /Invalid track/);
  console.log("PASS sector checksums, bounds, preimages, exact inverse and unchanged surrounding bits");
}

async function testImage(input) {
  assert.equal(sha256(input), INPUT_SHA256);
  const result = patchArchon(input, rom);
  assert.deepEqual(input, patchWozSectors(result.woz,
    result.patches.map(patch => ({ ...patch, before: patch.after, after: patch.before }))));
  assert.equal(readWozSectors(result.woz, coordinates).length, 560);
  assert.equal(result.woz.length, input.length);
  const wrong = Buffer.from(input);
  wrong[22] ^= 1;
  assert.throws(() => patchArchon(wrong, rom), /Unsupported Archon image/);
  const wrongRom = Buffer.from(rom);
  wrongRom[0xb500] ^= 1;
  assert.throws(() => buildPayload(wrongRom), /Unsupported 3ric ROM/);
  console.log("PASS exact-image guards, all 560 sectors and reversible full-image patch");
  const romMismatch = await bootDisk(result.woz, wrongRom);
  try {
    const message = "3RIC ROM MISMATCH - RESET";
    assert.equal(bytesAt(romMismatch, 0x400, message.length).map(v => v & 127).toString(), message);
    assert.equal(romMismatch.textMode(), 1);
    console.log("PASS on-machine ROM mismatch rejection");
  } finally {
    romMismatch.delete();
  }
  const vm = await bootMenu(result.woz);
  try {
    const before = [vm.peek(0xa8), vm.peek(0xa9)];
    moveMenu(vm, 100, 55);
    assert.notDeepEqual([vm.peek(0xa8), vm.peek(0xa9)], before);
    click(vm); // TWO PLAYERS, TWO JOYSTICKS
    startGame(vm);
    assert.equal(vm.peek(0x9f0b), 2, "Two-player option was not retained");
    for (const controller of [0, 1]) {
      for (const [mask, direction] of [[1 << 4, 14], [1 << 5, 13], [1 << 6, 11], [1 << 7, 7]]) {
        assert.equal(samplePad(vm, controller, mask)[controller], direction,
          `Controller ${controller + 1} direction ${mask}`);
        assert.equal(samplePad(vm, controller, 0)[controller], 15, "Release did not neutralize the pad");
      }
      assert.equal(samplePad(vm, controller, (1 << 4) | (1 << 5))[controller], 15,
        "Opposing directions did not cancel");
      samplePad(vm, controller, 0);
    }
    console.log("PASS actual patched WOZ cold boot, menu navigation, board entry and both real SNES scans");
    boardCursor(vm, 1, 0, 0);
    boardFire(vm, 0);
    assert(vm.peek(0x9f6f) > 0, "Light piece was not selected");
    boardCursor(vm, 4, 0, 0);
    boardFire(vm, 0);
    assert.equal(vm.peek(0x9f6f), 0, "Light move did not complete");
    seek(vm, 0x7734, 20000000);
    assert.equal(vm.regX(), 1, "Turn did not pass to the second controller");
    vm.step();
    boardCursor(vm, 7, 0, 1);
    boardFire(vm, 1);
    assert(vm.peek(0x9f6f) > 0, "Dark piece was not selected");
    boardCursor(vm, 4, 0, 1);
    boardFire(vm, 1);
    seek(vm, 0x837a, 40000000);
    vm.step();
    for (const [controller, mask] of [[0, 1 << 7], [1, 1 << 6]]) {
      const x = vm.peek(0x9fc0 + controller);
      vm.setGamepadState(controller, mask);
      vm.runCycles(500000);
      vm.setGamepadState(controller, 0);
      vm.runCycles(100000);
      assert.notEqual(vm.peek(0x9fc0 + controller), x, `Combat fighter ${controller + 1} did not move`);
    }
    vm.setGamepadState(0, (1 << 7) | 1);
    seek(vm, 0x845e, 5000000);
    assert.equal(vm.regX(), 0, "Wrong fighter fired");
    vm.step();
    vm.runCycles(100);
    assert.equal(vm.peek(0x9f3f), 14, "Combat projectile was not launched");
    vm.setGamepadState(0, 0);
    console.log("PASS legal moves, turn change, combat entry, both fighters moving and projectile launch");
  } finally {
    vm.delete();
  }
  const solo = await bootMenu(result.woz);
  try {
    startGame(solo);
    assert.equal(solo.peek(0x9f0b), 1, "Default single-player option changed");
    boardCursor(solo, 0, 4, 0);
    type(solo, "I");
    solo.runCycles(1000000);
    assert.equal(solo.peek(0xcf), 3, "Original keyboard I did not move the board cursor");
    assert.equal(solo.peek(0xd1), 0);
    assert.equal(solo.peekMapped(0xfffa) | solo.peekMapped(0xfffb) << 8, symbols.NMI_ENTRY);
    console.log("PASS default single-player setup and original keyboard board movement");
  } finally {
    solo.delete();
  }
  for (const [y, expectedSwap] of [[67, 0], [79, 254]]) {
    const keyboardGame = await bootMenu(result.woz);
    try {
      moveMenu(keyboardGame, 100, y);
      click(keyboardGame);
      startGame(keyboardGame);
      assert.equal(keyboardGame.peek(0x9f0b), 2);
      assert.equal(keyboardGame.peek(0x9f0f), expectedSwap);
      keyboardGame.addBreakpoint(0x1fc7);
      type(keyboardGame, "L");
      seek(keyboardGame, 0x1fc7);
      assert.equal(keyboardGame.regY(), 1, "Keyboard-side option was not retained");
      keyboardGame.step();
      seek(keyboardGame, symbols.GAME_PAD_DONE);
      assert.equal(keyboardGame.peek(0x279), 7, "Keyboard L did not reach the selected player's direction");
    } finally {
      keyboardGame.delete();
    }
  }
  console.log("PASS both two-player keyboard-side options");
  const gameMismatch = await bootMenu(result.woz);
  try {
    moveMenu(gameMismatch, 120, 185);
    gameMismatch.setGamepadState(0, 1);
    seek(gameMismatch, payload.game.symbols.GAME_INIT, 80000000);
    gameMismatch.poke(0x800, 0xea); // Negative fixture: corrupt a checked preimage.
    gameMismatch.step();
    gameMismatch.runCycles(100000);
    const message = "ARCHON PATCH MISMATCH - RESET";
    assert.equal(bytesAt(gameMismatch, 0x400, message.length).map(v => v & 127).toString(), message);
    assert.equal(gameMismatch.textMode(), 1);
    console.log("PASS on-machine game-preimage mismatch rejection");
  } finally {
    gameMismatch.delete();
  }
}

async function main(args) {
  assert(args.length === 0 || (args.length === 2 && args[0] === "--woz"),
    "Usage: node codegen\\tools\\patch-archon.test.mjs [--woz <original.woz>]");
  testSectorEditing();
  assert(symbols.ADAPTER_END <= 0xce00 && symbols.NMI_END <= 0xd000);
  assert(payload.game.bytes.length <= 512 && payload.pages <= 8);
  console.log("PASS adapter and installer memory bounds");
  if (args.length) await testImage(fs.readFileSync(args[1]));
  else console.log("SKIP owner-supplied disk integration (pass --woz <original.woz>)");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
