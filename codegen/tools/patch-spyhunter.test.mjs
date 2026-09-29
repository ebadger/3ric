// Run after web/build.ps1; optionally supply the original, local spyh07fd.prg.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";
import { createInputPatches, IMAGE_SIZE, LOAD_ADDRESS, ORIGINAL_SHA256, patchSpyHunter } from "./patch-spyhunter.mjs";
import harness from "./harness.cjs";
import gamepads from "../../web/gamepad.js";

const { SNES } = gamepads;
const patches = createInputPatches();
const scanButton = patches.find((patch) => patch.org === 0x0f86).symbols.SCAN_BUTTON;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(patches.length, 6);
assert.equal(patches.reduce((sum, patch) => sum + patch.bytes.length, 0), 135);
assert.throws(() => patchSpyHunter(new Uint8Array(IMAGE_SIZE - 1)), /34307-byte/);
const unknown = new Uint8Array(IMAGE_SIZE);
assert.throws(() => patchSpyHunter(unknown), /Unsupported or already modified/);
assert.ok(unknown.every((byte) => byte === 0), "rejected input is not modified");

function stopAt(vm, address, budget = 5_000_000) {
  vm.addBreakpoint(address);
  const cycles = vm.runCycles(budget);
  vm.removeBreakpoint(address);
  assert.ok(vm.breakpointHit(), `reach $${address.toString(16)}; stopped at $${vm.pc().toString(16)}`);
  assert.equal(vm.pc(), address);
  return cycles;
}

function prepareCall(vm, target, setup = "") {
  const call = assemble(`
    SEI
    LDX #$2E
    TXS
    ${setup}
    JSR $${target.toString(16)}
done:
    JMP done
  `, { org: 0x0800 });
  vm.loadData(call.org, call.bytes);
  vm.setPC(call.org);
  return call.symbols.DONE;
}

function call(vm, target, setup = "", budget = 100_000) {
  return stopAt(vm, prepareCall(vm, target, setup), budget);
}

const session = await harness.boot();
const vm = session.vm;
try {
  for (const patch of patches) vm.loadData(patch.org, patch.bytes);
  const release = assemble(`
wait:
    JSR $${scanButton.toString(16)}
    ORA $C062
    BMI wait
    RTS
  `, { org: 0x0ec1 });
  vm.loadData(0x0ec4, release.bytes.subarray(3));

  for (const mask of [SNES.B, 0, SNES.X, 0]) {
    vm.setGamepadState(0, mask);
    call(vm, scanButton, "LDX #$12\nLDY #$34");
    assert.equal(vm.regA() & 0x80, mask ? 0x80 : 0, "button changes request a fresh ROM scan");
    assert.equal(vm.regX(), 0x12);
    assert.equal(vm.regY(), 0x34);
  }

  for (const mask of [SNES.B, SNES.A]) {
    vm.setGamepadState(0, mask);
    const done = prepareCall(vm, 0x0ec1);
    vm.addBreakpoint(done);
    vm.runCycles(20_000);
    assert.equal(vm.breakpointHit(), false, "a held fire button keeps the release wait active");
    vm.setGamepadState(0, 0);
    vm.runCycles(20_000);
    vm.removeBreakpoint(done);
    assert.equal(vm.breakpointHit(), true, "release is seen without an external PTRIG");
    assert.equal(vm.pc(), done);
  }

  for (const mask of [SNES.B, SNES.A]) {
    vm.poke(0xc000, 0);
    vm.setGamepadState(0, 0);
    const done = prepareCall(vm, 0x0e9f, "LDX #15\nSTZ $6E");
    vm.addBreakpoint(done);
    vm.runCycles(20_000);
    assert.equal(vm.breakpointHit(), false, "timed input wait does not finish prematurely");
    vm.setGamepadState(0, mask);
    vm.runCycles(20_000);
    vm.removeBreakpoint(done);
    assert.ok(vm.breakpointHit(), "timed wait notices either fire button");
    assert.equal(vm.regA(), 0);
    assert.notEqual(vm.regX(), 0, "button return is distinct from timeout");
  }
  vm.setGamepadState(0, 0);
  vm.keyDown("J".charCodeAt(0));
  call(vm, 0x0e9f, "LDX #15");
  assert.equal(vm.regA(), 0xca, "keyboard return retains the original strobe-set character");
  assert.notEqual(vm.regX(), 0);
  vm.runCycles(1000);
  assert.equal(vm.peek(0xc000) & 0x80, 0, "keyboard return acknowledges the strobe");
  const timeout = call(vm, 0x0e9f, "LDX #1\nSTZ $6E", 2_000_000);
  assert.equal(vm.regA(), 0);
  assert.equal(vm.regX(), 0);
  assert.ok(timeout > 500_000 && timeout < 2_000_000, "polling preserves a usable bounded timeout");

  const samples = [];
  for (const horizontal of [SNES.LEFT, 0, SNES.RIGHT]) {
    const row = [];
    for (const vertical of [SNES.UP, 0, SNES.DOWN]) {
      vm.setGamepadState(0, horizontal | vertical);
      call(vm, 0x0ff0, "LDY #$57");
      row.push([vm.peek(0x6e), vm.peek(0x6f)]);
      assert.equal(vm.regX(), 0);
      assert.equal(vm.regY(), 0x57, "sampler preserves Y");
    }
    samples.push(row);
  }
  for (let axis = 0; axis < 3; axis++) {
    assert.equal(samples[0][axis][0], 0, "left is minimum");
    assert.equal(samples[axis][0][1], 0, "up is minimum");
    assert.ok(samples[0][axis][0] < samples[1][axis][0] &&
      samples[1][axis][0] < samples[2][axis][0], "horizontal calibration is ordered");
    assert.ok(samples[axis][0][1] < samples[axis][1][1] &&
      samples[axis][1][1] < samples[axis][2][1], "vertical calibration is ordered");
  }
  assert.ok(Math.max(...samples[1].map((row) => row[0])) -
    Math.min(...samples[1].map((row) => row[0])) <= 1, "Y does not skew centered X timing");
  assert.ok(Math.max(...samples.map((row) => row[1][1])) -
    Math.min(...samples.map((row) => row[1][1])) <= 1, "X does not skew centered Y timing");

  for (let i = 0; i < 16; i++) {
    vm.poke(0x01f1 + i, i === 15 ? 255 : (i + 1) * 8);
    vm.poke(0x0201 + i, i === 15 ? 255 : (i + 1) * 8);
    vm.poke(0x0fc0 + i, i);
    vm.poke(0x0fd0 + i, 0x40 + i);
    vm.poke(0x0fe0 + i, 0x80 + i);
  }
  for (const [mask, first, second] of [[0, 0, 0], [SNES.B, 1, 0],
    [SNES.X, 1, 0], [SNES.A, 0, 1], [SNES.Y, 0, 1], [SNES.B | SNES.A, 1, 1]]) {
    vm.setGamepadState(0, mask);
    call(vm, 0x0ff0);
    const before = [vm.peek(0xc061), vm.peek(0xc062)];
    vm.poke(0x6e, 12);
    vm.poke(0x6f, 92);
    call(vm, 0x0f86, "STZ $A7\nSTZ $A8");
    assert.deepEqual([vm.peek(0xa7), vm.peek(0xa8)], [first, second]);
    assert.deepEqual([vm.peek(0xc061), vm.peek(0xc062)], before, "button samples never write back");
    assert.deepEqual([vm.peek(0xa9), vm.peek(0xaa), vm.peek(0xab)], [1, 0x4b, 0x8b]);
  }
  console.log(`PASS ROM-backed press/release, keyboard, timeout (${timeout} cycles), fixed-time paddles and buttons`);
} finally {
  vm.delete();
}

async function startGame(bytes, joystick) {
  const { vm } = await harness.boot();
  try {
    vm.loadData(LOAD_ADDRESS, bytes);
    vm.setPC(LOAD_ADDRESS);
    stopAt(vm, 0x2db6);
    vm.keyDown(32);
    stopAt(vm, 0x07b0, 35_000_000);
    vm.keyDown(32);
    stopAt(vm, 0x07d5);
    vm.keyDown(joystick ? 74 : 32);
    stopAt(vm, joystick ? 0x071f : 0x0ed0);
    return vm;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

const originalPath = process.argv[2];
if (originalPath) {
  const original = readFileSync(originalPath);
  assert.equal(hash(original), ORIGINAL_SHA256);
  const patched = patchSpyHunter(original);
  assert.equal(hash(original), ORIGINAL_SHA256, "patching does not modify input");
  assert.equal(patched.length, original.length);
  assert.throws(() => patchSpyHunter(patched), /already modified/);
  const changed = new Set(patches.flatMap((patch) =>
    Array.from({ length: patch.bytes.length }, (_, i) => patch.org - LOAD_ADDRESS + i)));
  for (let i = 0; i < original.length; i++) {
    if (!changed.has(i)) assert.equal(patched[i], original[i], `unrelated byte ${i} stays unchanged`);
  }

  const old = await startGame(original, true);
  try {
    old.setGamepadState(0, SNES.B);
    old.addBreakpoint(0x0ec1);
    old.runCycles(100_000);
    assert.equal(old.breakpointHit(), false, "original calibration misses the face-button press");
    old.removeBreakpoint(0x0ec1);
    old.keyDown(13);
    stopAt(old, 0x0ec1);
    old.setGamepadState(0, 0);
    old.runCycles(100_000);
    assert.ok(old.pc() >= 0x0ec1 && old.pc() <= 0x0ec9, "original release loop remains stuck");
    assert.ok(old.peek(0xc061) & 0x80);
  } finally {
    old.delete();
  }

  const game = await startGame(patched, true);
  try {
    const calibration = [];
    for (const [index, direction] of [0, SNES.UP | SNES.LEFT, SNES.DOWN | SNES.RIGHT].entries()) {
      game.setGamepadState(0, direction | SNES.B);
      stopAt(game, 0x0ec1, 100_000);
      calibration.push([game.peek(0x6e), game.peek(0x6f)]);
      game.setGamepadState(0, 0);
      stopAt(game, index < 2 ? 0x071f : 0x0ed0);
    }
    for (let axis = 0; axis < 2; axis++) {
      assert.ok(calibration[1][axis] < calibration[0][axis] &&
        calibration[0][axis] < calibration[2][axis], "real game calibration is ordered");
    }
    game.setGamepadState(0, SNES.B);
    for (let i = 0; i < 100 && game.peek(0) !== 1; i++) game.runCycles(50_000);
    assert.equal(game.peek(0), 1, "face button starts actual gameplay");

    function input(mask) {
      game.setGamepadState(0, mask);
      stopAt(game, 0x0ed0);
      game.step();
      stopAt(game, 0x0f36);
      return Array.from({ length: 5 }, (_, i) => game.peek(0xa7 + i));
    }
    const left = input(SNES.LEFT);
    const center = input(0);
    const right = input(SNES.RIGHT);
    assert.ok(left[2] >= 0x80 && right[2] > 0 && right[2] < 0x80, "game steers in both directions");
    assert.equal(center[2], 0, "released steering is centered");
    assert.deepEqual(input(SNES.B | SNES.A).slice(0, 2), [1, 1], "both fire buttons work");
    assert.deepEqual(input(0).slice(0, 2), [0, 0], "both fire buttons release");
    const up = input(SNES.UP), down = input(SNES.DOWN);
    const throttle = (state) => (state[3] << 24 >> 16) + state[4];
    assert.ok(throttle(up) > throttle(center) && throttle(down) < throttle(center),
      "game throttle responds in both directions");

    // The delivery animation runs before the player car can accelerate or steer.
    let drivable = false;
    for (let frame = 0; frame < 180; frame++) {
      input(SNES.UP);
      game.step();
      stopAt(game, 0x0ed0);
      if ((game.peek(0x05a9) & 0x80) && game.peek(0x20) >= 4) {
        drivable = true;
        break;
      }
    }
    assert.ok(drivable, "the delivered player car accelerates enough to steer");
    function drive(mask) {
      input(mask);
      stopAt(game, 0x60c5);
      const player = game.regX();
      const before = game.peek(0x06 + player);
      stopAt(game, 0x6411);
      assert.equal(game.regX(), player, "movement belongs to the player car");
      return {
        player, before, after: game.peek(0x06 + player),
        speed: game.peek(0x20 + player), delta: game.peek(0xbf9f + player),
      };
    }
    const moveLeft = drive(SNES.LEFT);
    const moveRight = drive(SNES.RIGHT);
    assert.ok(moveLeft.after < moveLeft.before && moveRight.after > moveRight.before,
      `controller moves the car: ${JSON.stringify({ moveLeft, moveRight })}`);
    console.log(`PASS original stalls; patched calibration ${JSON.stringify(calibration)}, start, steering, throttle and fire`);
    console.log(`PASS car movement: left ${moveLeft.before} -> ${moveLeft.after}, right ${moveRight.before} -> ${moveRight.after}`);
  } finally {
    game.delete();
  }

  const keyboard = await startGame(patched, false);
  try {
    keyboard.keyDown(32);
    for (let i = 0; i < 100 && keyboard.peek(0) !== 1; i++) keyboard.runCycles(50_000);
    assert.equal(keyboard.peek(0), 1, "keyboard-only mode still starts");
    for (const [key, expected] of [["L", 0xfc], [";", 4]]) {
      stopAt(keyboard, 0x0ed0);
      keyboard.keyDown(key.charCodeAt(0));
      keyboard.step();
      stopAt(keyboard, 0x0f36);
      assert.equal(keyboard.peek(0xa9), expected, "original keyboard steering is preserved");
    }
    console.log("PASS actual game's keyboard-only start and steering");
  } finally {
    keyboard.delete();
  }

  const card = await harness.boot({ sd: readFileSync(join(harness.DATA_DIR, "sd.sparse")) });
  try {
    function command(text, jump = false) {
      let output = card.vm.drainOutput();
      for (const character of text) {
        for (let i = 0; i < 100 && (card.vm.peek(0xc000) & 0x80); i++) card.vm.run(10_000);
        assert.equal(card.vm.peek(0xc000) & 0x80, 0, "DOS is ready for the next key");
        card.vm.keyDown(character.charCodeAt(0));
        card.vm.run(20_000);
        output += card.vm.drainOutput();
      }
      // Writing this file through bit-banged SPI takes about 97 million cycles.
      for (let i = 0; i < 1200; i++) {
        card.vm.runCycles(250_000);
        output += card.vm.drainOutput();
        if (jump ? card.vm.breakpointHit() : output.endsWith(">")) return output;
      }
      assert.fail(`DOS command did not finish: ${text.trim()} (PC $${card.vm.pc().toString(16)})`);
    }
    card.vm.loadData(LOAD_ADDRESS, patched);
    command("BSAVE SPY3RIC.PRG 07FD 8603\r");
    const beforeLoad = card.vm.sdReadCount();
    card.vm.loadData(LOAD_ADDRESS, new Uint8Array(patched.length));
    card.vm.addBreakpoint(LOAD_ADDRESS);
    command("BRUN SPY3RIC.PRG 07FD\r", true);
    card.vm.removeBreakpoint(LOAD_ADDRESS);
    assert.equal(card.vm.pc(), LOAD_ADDRESS);
    assert.ok(card.vm.sdReadCount() > beforeLoad, "BRUN reads the emulated card");
    assert.deepEqual(Uint8Array.from({ length: patched.length }, (_, i) => card.vm.peek(LOAD_ADDRESS + i)),
      patched, "the ROM loader restores every patched byte at the original address");
    stopAt(card.vm, 0x2db6);
    console.log("PASS ROM BSAVE/BRUN card round trip: all 34,307 bytes, entry point and relocation");
  } finally {
    card.vm.delete();
  }

  const temporary = mkdtempSync(join(tmpdir(), "3ric-spyhunter-"));
  const inputPath = join(temporary, "original.prg");
  const outputPath = join(temporary, "SPY3RIC.PRG");
  const script = join(dirname(fileURLToPath(import.meta.url)), "patch-spyhunter.mjs");
  try {
    writeFileSync(inputPath, original);
    const result = spawnSync(process.execPath, [script, inputPath, outputPath], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(outputPath), Buffer.from(patched));
    const exists = spawnSync(process.execPath, [script, inputPath, outputPath], { encoding: "utf8" });
    assert.notEqual(exists.status, 0);
    assert.match(exists.stderr, /EEXIST/);
    assert.deepEqual(readFileSync(outputPath), Buffer.from(patched));
    const same = spawnSync(process.execPath, [script, inputPath, inputPath], { encoding: "utf8" });
    assert.notEqual(same.status, 0);
    assert.equal(hash(readFileSync(inputPath)), ORIGINAL_SHA256);
    console.log("PASS CLI output matches; existing files and original input cannot be overwritten");
  } finally {
    for (const file of [inputPath, outputPath]) {
      try { unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    rmdirSync(temporary);
  }
} else {
  console.log("SKIP full-game checks: supply a local original spyh07fd.prg as the first argument");
}
