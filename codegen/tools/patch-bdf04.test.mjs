// Test the exact-image BDF04 controller patch without bundling the game.
// Set BDF04_PRG to the user-supplied image to run the real ROM DOS BRUN test.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import harness from "./harness.cjs";
import { buildSparseFat32 } from "./ultima5/fat32.mjs";
import {
  DECODER_BEFORE,
  DECODER_OFFSET,
  DECODER_RUNTIME_ADDR,
  DECODER_SIZE,
  LOAD_ADDR,
  PRG_SIZE,
  PRG_SHA256,
  buildControllerPatch,
  patchBdf04,
  replaceDecoder,
} from "./patch-bdf04.mjs";

const hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");

function syntheticImage() {
  const image = Uint8Array.from({ length: PRG_SIZE }, (_, i) => (i * 37 + 19) & 0xff);
  image.set(DECODER_BEFORE, DECODER_OFFSET);
  return image;
}

function testPatchConstruction() {
  const patch = buildControllerPatch();
  assert.equal(patch.length, DECODER_SIZE);
  assert.deepEqual(Array.from(patch), [
    0x5a, 0xa2, 0x07, 0xa0, 0x04, 0xbd, 0xe0, 0xce, 0xd0, 0x06,
    0xca, 0x88, 0xd0, 0xf7, 0xf0, 0x0b, 0x8a, 0x29, 0x03, 0x49,
    0x02, 0x85, 0x0f, 0xe6, 0x0f, 0xa5, 0x0f, 0x7a, 0x85, 0x0f,
  ]);

  const image = syntheticImage();
  const untouched = image.slice();
  const patched = replaceDecoder(image, patch);
  assert.deepEqual(image, untouched, "patching must not mutate the caller's image");
  assert.deepEqual(patched.subarray(DECODER_OFFSET, DECODER_OFFSET + DECODER_SIZE), patch);
  const changed = [];
  for (let i = 0; i < image.length; i++)
    if (image[i] !== patched[i]) changed.push(i);
  assert.ok(changed.length > 0, "the decoder must change");
  assert.ok(changed.every((i) => i >= DECODER_OFFSET && i < DECODER_OFFSET + DECODER_SIZE),
    "no bytes outside the guarded decoder may change");

  assert.throws(() => replaceDecoder(new Uint8Array(PRG_SIZE - 1), patch), /image size/);
  assert.throws(() => replaceDecoder(image, new Uint8Array(DECODER_SIZE - 1)), /replacement/);
  const mismatch = syntheticImage();
  mismatch[DECODER_OFFSET] ^= 1;
  assert.throws(() => replaceDecoder(mismatch, patch), /unexpected bytes at \$2284/);
  assert.throws(() => patchBdf04(syntheticImage()), /SHA-256/);
  console.log("PASS BDF04 patch assembly, exact byte guard, non-mutating replacement, and fingerprint refusal");
}

function waitForPC(vm, addr, run, budget, label) {
  for (let cycles = 0; cycles < budget; cycles += 10_000) {
    if (vm.pc() === addr) return;
    run(10_000);
    if (vm.pc() === addr) return;
  }
  assert.fail(`${label}: did not reach $${hex(addr)} (pc $${hex(vm.pc())})`);
}

async function testRealBrun(original) {
  const image = patchBdf04(original);
  const session = await harness.boot({ sd: buildSparseFat32({ "BDF04.PRG": image }) });
  const vm = session.vm;
  const run = (cycles) => vm.runCycles(cycles);
  const key = (code) => {
    for (let i = 0; i < 500 && (vm.peek(0xc000) & 0x80); i++) run(10_000);
    assert.equal(vm.peek(0xc000) & 0x80, 0, "previous keyboard strobe was not consumed");
    vm.keyDown(code);
    run(300_000);
  };

  try {
    assert.ok(vm.addBreakpoint(LOAD_ADDR), "install BRUN entry breakpoint");
    for (const ch of "BRUN BDF04.PRG 0F04\r") key(ch === "\r" ? 13 : ch.charCodeAt(0));
    waitForPC(vm, LOAD_ADDR, run, 200_000_000, "ROM DOS BRUN");
    assert.deepEqual([vm.peek(LOAD_ADDR), vm.peek(LOAD_ADDR + 1), vm.peek(LOAD_ADDR + 2)],
      [0x4c, 0x00, 0x60], "BRUN must load the image at $0F04");
    vm.removeBreakpoint(LOAD_ADDR);
    vm.step();
    assert.equal(vm.pc(), 0x6000, "BRUN enters the game's $6000 body");

    run(10_000_000);
    key(0x20);                         // leave the credits screen
    run(5_000_000);
    key(0x4a);                         // choose the Joyport joystick path
    run(5_000_000);
    assert.equal(vm.setGamepadState(0, 1), true, "set controller-1 B for the game button");
    run(5_000_000);
    vm.setGamepadState(0, 0);
    run(5_000_000);

    assert.deepEqual(
      Array.from({ length: DECODER_SIZE }, (_, i) => vm.peek(DECODER_RUNTIME_ADDR + i)),
      Array.from(buildControllerPatch()),
      "the live poll must execute the patched decoder copied to $0284",
    );

    const cases = [
      ["neutral", 0, 0],
      ["up", 1 << 4, 3],
      ["down", 1 << 5, 4],
      ["left", 1 << 6, 1],
      ["right", 1 << 7, 2],
      ["horizontal priority", (1 << 4) | (1 << 7), 2],
    ];
    for (const [label, mask, expected] of cases) {
      assert.equal(vm.setGamepadState(0, mask), true, `${label}: set controller state`);
      assert.ok(vm.addBreakpoint(DECODER_RUNTIME_ADDR), `${label}: install mapper-entry breakpoint`);
      waitForPC(vm, DECODER_RUNTIME_ADDR, run, 40_000_000, `${label} mapper entry`);
      const entryY = vm.regY();
      const entrySP = vm.sp();
      const entryCarry = vm.status() & 1;
      const expectedTable = [4, 5, 6, 7].map((index) => (mask & (1 << index)) ? 1 : 0);
      assert.deepEqual(
        Array.from({ length: 4 }, (_, i) => vm.peek(0xcee4 + i)),
        expectedTable,
        `${label}: game's $C070 scan fills GAMEPAD1 before the mapper`,
      );

      vm.removeBreakpoint(DECODER_RUNTIME_ADDR);
      assert.ok(vm.addBreakpoint(DECODER_RUNTIME_ADDR + DECODER_SIZE),
        `${label}: install mapper-exit breakpoint`);
      waitForPC(vm, DECODER_RUNTIME_ADDR + DECODER_SIZE, run, 100_000, `${label} mapper exit`);
      assert.equal(vm.regA(), expected, `${label}: return code in A`);
      assert.equal(vm.peek(0x0f), expected, `${label}: return code in $0F`);
      assert.equal(vm.regY(), entryY, `${label}: preserve Y`);
      assert.equal(vm.sp(), entrySP, `${label}: preserve stack depth`);
      assert.equal(vm.status() & 1, entryCarry, `${label}: preserve carry`);

      vm.removeBreakpoint(DECODER_RUNTIME_ADDR + DECODER_SIZE);
      vm.step(); // The game's following TAX consumes the returned direction code.
      assert.equal(vm.regX(), expected, `${label}: the game's TAX receives the direction code`);
      vm.setGamepadState(0, 0);
      run(500_000);
    }

    console.log("PASS BDF04 ROM DOS BRUN, live GAMEPAD1 scan, all directions, neutral, priority, Y/SP/carry");
  } finally {
    vm.delete();
  }
}

testPatchConstruction();

if (process.env.BDF04_PRG) {
  const original = new Uint8Array(fs.readFileSync(process.env.BDF04_PRG));
  assert.equal(original.length, PRG_SIZE);
  assert.equal(
    crypto.createHash("sha256").update(original).digest("hex"),
    PRG_SHA256,
    "BDF04_PRG must be the verified user-supplied release",
  );
  await testRealBrun(original);
} else {
  console.log("SKIP real-image BRUN integration (set BDF04_PRG to the user-supplied PRG)");
}
