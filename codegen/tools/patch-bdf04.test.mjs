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
  DELAY_ROUTINE_ADDR,
  DELAY_ROUTINE_AFTER,
  DELAY_ROUTINE_BEFORE,
  DELAY_ROUTINE_RUNTIME_ADDR,
  FIXED_TONE_DELAY_ADDR,
  FIXED_TONE_DELAY_AFTER,
  FIXED_TONE_DELAY_BEFORE,
  FIXED_TONE_DELAY_RUNTIME_ADDR,
  FRAME_DELAY_ADDR,
  FRAME_DELAY_AFTER,
  FRAME_DELAY_BEFORE,
  FRAME_DELAY_RUNTIME_ADDR,
  LOAD_ADDR,
  MAPPER_RUNTIME_ADDR,
  PRG_SIZE,
  PRG_SHA256,
  SWEEP_BRANCH_OPERAND_ADDR,
  SWEEP_BRANCH_OPERAND_AFTER,
  SWEEP_BRANCH_OPERAND_BEFORE,
  SWEEP_BRANCH_RUNTIME_ADDR,
  SWEEP_DELAY_CALL_ADDR,
  SWEEP_DELAY_CALL_AFTER,
  SWEEP_DELAY_CALL_BEFORE,
  SWEEP_DELAY_CALL_RUNTIME_ADDR,
  SWEEP_HELPER_RUNTIME_ADDR,
  TITLE_MUSIC_DELAY_HELPER_BYTES,
  TITLE_MUSIC_DELAY_HELPER_RUNTIME_ADDR,
  TITLE_MUSIC_E4_BRIDGE_ADDR,
  TITLE_MUSIC_E4_BRIDGE_AFTER,
  TITLE_MUSIC_E4_BRIDGE_BEFORE,
  TITLE_MUSIC_E4_BRIDGE_RUNTIME_ADDR,
  TITLE_MUSIC_E4_LOOP_ADDR,
  TITLE_MUSIC_E4_LOOP_AFTER,
  TITLE_MUSIC_E4_LOOP_BEFORE,
  TITLE_MUSIC_E4_LOOP_RUNTIME_ADDR,
  TITLE_MUSIC_E5_BRIDGE_ADDR,
  TITLE_MUSIC_E5_BRIDGE_AFTER,
  TITLE_MUSIC_E5_BRIDGE_BEFORE,
  TITLE_MUSIC_E5_BRIDGE_RUNTIME_ADDR,
  TITLE_MUSIC_E5_LOOP_ADDR,
  TITLE_MUSIC_E5_LOOP_AFTER,
  TITLE_MUSIC_E5_LOOP_BEFORE,
  TITLE_MUSIC_E5_LOOP_RUNTIME_ADDR,
  buildControllerPatch,
  patchBdf04,
  replaceBdf04Sites,
  replaceDecoder,
} from "./patch-bdf04.mjs";

const hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");
const TARGET_CLOCK_RATIO = 1_573_437.5 / 1_000_000;
const FIXED_TONE_ENTRY_RUNTIME_ADDR = 0x0186;
const FIXED_TONE_STORE_RUNTIME_ADDR = 0x0188;
const DELAY_TEST_RUNTIME_ADDR = 0x0a00;
const SPEAKER_SWEEP_RUNTIME_ADDR = 0x0270;
const SPEAKER_STORE_RUNTIME_ADDR = 0x0277;

const TIMING_SITES = [
  { address: FRAME_DELAY_ADDR, before: [FRAME_DELAY_BEFORE], after: [FRAME_DELAY_AFTER] },
  { address: FIXED_TONE_DELAY_ADDR, before: [FIXED_TONE_DELAY_BEFORE], after: [FIXED_TONE_DELAY_AFTER] },
  { address: DELAY_ROUTINE_ADDR, before: DELAY_ROUTINE_BEFORE, after: DELAY_ROUTINE_AFTER },
  { address: SWEEP_BRANCH_OPERAND_ADDR, before: [SWEEP_BRANCH_OPERAND_BEFORE], after: [SWEEP_BRANCH_OPERAND_AFTER] },
  { address: SWEEP_DELAY_CALL_ADDR, before: SWEEP_DELAY_CALL_BEFORE, after: SWEEP_DELAY_CALL_AFTER },
  { address: TITLE_MUSIC_E5_LOOP_ADDR, before: TITLE_MUSIC_E5_LOOP_BEFORE, after: TITLE_MUSIC_E5_LOOP_AFTER },
  { address: TITLE_MUSIC_E4_LOOP_ADDR, before: TITLE_MUSIC_E4_LOOP_BEFORE, after: TITLE_MUSIC_E4_LOOP_AFTER },
  { address: TITLE_MUSIC_E5_BRIDGE_ADDR, before: TITLE_MUSIC_E5_BRIDGE_BEFORE, after: TITLE_MUSIC_E5_BRIDGE_AFTER },
  { address: TITLE_MUSIC_E4_BRIDGE_ADDR, before: TITLE_MUSIC_E4_BRIDGE_BEFORE, after: TITLE_MUSIC_E4_BRIDGE_AFTER },
];

function syntheticImage() {
  const image = Uint8Array.from({ length: PRG_SIZE }, (_, i) => (i * 37 + 19) & 0xff);
  image.set(DECODER_BEFORE, DECODER_OFFSET);
  for (const site of TIMING_SITES) image.set(site.before, site.address - LOAD_ADDR);
  return image;
}

function testPatchConstruction() {
  const patch = buildControllerPatch();
  assert.equal(patch.length, DECODER_SIZE);
  assert.deepEqual(Array.from(patch), [
    0xf0, 0x0a, 0xc9, 0x11, 0x90, 0x01, 0x1a, 0x4c, 0xbf, 0x03, 0xea, 0x60,
    0xa2, 0x83, 0xbd, 0x64, 0xce, 0xf0, 0x06, 0x8a,
    0x49, 0x82, 0x1a, 0xd0, 0x03, 0xca, 0x30, 0xf2, 0x85, 0x0f,
  ]);

  const image = syntheticImage();
  const untouched = image.slice();
  const decoderOnly = replaceDecoder(image, patch);
  for (const site of TIMING_SITES) {
    const offset = site.address - LOAD_ADDR;
    assert.deepEqual(
      Array.from(decoderOnly.subarray(offset, offset + site.before.length)),
      site.before,
      "the decoder-only fixture helper must not alter timing sites",
    );
  }

  const patched = replaceBdf04Sites(image, patch);
  assert.deepEqual(image, untouched, "patching must not mutate the caller's image");
  assert.deepEqual(patched.subarray(DECODER_OFFSET, DECODER_OFFSET + DECODER_SIZE), patch);
  for (const site of TIMING_SITES) {
    const offset = site.address - LOAD_ADDR;
    assert.deepEqual(
      Array.from(patched.subarray(offset, offset + site.after.length)),
      site.after,
      `apply timing patch at $${hex(site.address)}`,
    );
  }
  const changed = [];
  for (let i = 0; i < image.length; i++)
    if (image[i] !== patched[i]) changed.push(i);
  const allowedRanges = [
    [DECODER_OFFSET, DECODER_OFFSET + DECODER_SIZE],
    ...TIMING_SITES.map((site) => {
      const offset = site.address - LOAD_ADDR;
      return [offset, offset + site.after.length];
    }),
  ];
  assert.ok(changed.length > 0, "the BDF04 patch must change bytes");
  assert.ok(changed.every((i) => allowedRanges.some(([start, end]) => i >= start && i < end)),
    "no bytes outside the guarded controller and timing sites may change");

  assert.throws(() => replaceBdf04Sites(new Uint8Array(PRG_SIZE - 1), patch), /image size/);
  assert.throws(() => replaceBdf04Sites(image, new Uint8Array(DECODER_SIZE - 1)), /replacement/);
  const mismatch = syntheticImage();
  mismatch[DECODER_OFFSET] ^= 1;
  assert.throws(() => replaceDecoder(mismatch, patch), /unexpected bytes at \$2284/);
  for (const site of TIMING_SITES) {
    const badSite = syntheticImage();
    badSite[site.address - LOAD_ADDR] ^= 1;
    assert.throws(
      () => replaceBdf04Sites(badSite, patch),
      new RegExp(`unexpected bytes at \\$${hex(site.address)}`),
    );
  }
  assert.throws(() => patchBdf04(syntheticImage()), /SHA-256/);
  console.log("PASS BDF04 patch assembly, every-site byte guards, non-mutating replacement, and fingerprint refusal");
}

function waitForPC(vm, addr, run, budget, label) {
  for (let cycles = 0; cycles < budget; cycles += 10_000) {
    if (vm.pc() === addr) return;
    run(10_000);
    if (vm.pc() === addr) return;
  }
  assert.fail(`${label}: did not reach $${hex(addr)} (pc $${hex(vm.pc())})`);
}

const FLAG_BRANCHES = new Map([
  [0x10, (p) => !(p & 0x80)], // BPL
  [0x30, (p) => !!(p & 0x80)], // BMI
  [0x50, (p) => !(p & 0x40)], // BVC
  [0x70, (p) => !!(p & 0x40)], // BVS
  [0x90, (p) => !(p & 0x01)], // BCC
  [0xb0, (p) => !!(p & 0x01)], // BCS
  [0xd0, (p) => !(p & 0x02)], // BNE
  [0xf0, (p) => !!(p & 0x02)], // BEQ
]);

function correctedStep65C02(vm) {
  const pc = vm.pc();
  const opcode = vm.peek(pc) & 0xff;
  const condition = FLAG_BRANCHES.get(opcode);
  if (opcode === 0x44) return vm.step() + 1; // 65C02 zero-page NOP is three cycles.
  if (opcode === 0x80 || condition) {
    const status = vm.status() & 0xff;
    const rawOffset = vm.peek((pc + 1) & 0xffff) & 0xff;
    const next = (pc + 2) & 0xffff;
    const target = (next + (rawOffset < 0x80 ? rawOffset : rawOffset - 0x100)) & 0xffff;
    const taken = opcode === 0x80 || condition(status);
    const pageCross = (next & 0xff00) !== (target & 0xff00);
    vm.step();
    return opcode === 0x80
      ? 3 + Number(pageCross)
      : taken ? 3 + Number(pageCross) : 2;
  }

  if ((opcode & 0x0f) === 0x0f) return vm.step(); // BBR/BBS are five cycles in this VM.
  return vm.step();
}

function writeDelayRoutine(vm, bytes) {
  bytes.forEach((value, i) => vm.poke(DELAY_ROUTINE_RUNTIME_ADDR + i, value));
}

function stopAtPC(vm, addr, run, budget, label) {
  assert.ok(vm.addBreakpoint(addr), `${label}: install breakpoint`);
  try {
    waitForPC(vm, addr, run, budget, label);
  } finally {
    vm.removeBreakpoint(addr);
  }
}

function measureIntervals(vm, addr, count, label) {
  assert.equal(vm.pc(), addr, `${label}: start at $${hex(addr)}`);
  const intervals = [];
  let cycles = 0;
  for (let instructions = 0; instructions < 1_000_000; instructions++) {
    if (vm.pc() === addr && cycles !== 0) {
      intervals.push(cycles);
      cycles = 0;
      if (intervals.length === count) return intervals;
    }
    cycles += correctedStep65C02(vm);
  }
  assert.fail(`${label}: measured ${intervals.length}/${count} intervals (pc $${hex(vm.pc())})`);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function assertRatioNear(actual, expected, tolerance, label) {
  const relativeError = Math.abs(actual / expected - 1);
  assert.ok(
    relativeError <= tolerance,
    `${label}: got ${actual.toFixed(5)}x, expected ${expected.toFixed(5)}x ` +
      `(relative error ${(relativeError * 100).toFixed(2)}%)`,
  );
}

function testFrameCadence(vm, run) {
  stopAtPC(vm, MAPPER_RUNTIME_ADDR, run, 40_000_000, "frame timing poll");
  const baseline = [];
  const retimed = [];
  for (let i = 0; i < 4; i++) {
    writeDelayRoutine(vm, DELAY_ROUTINE_BEFORE);
    vm.poke(FRAME_DELAY_RUNTIME_ADDR, FRAME_DELAY_BEFORE);
    baseline.push(...measureIntervals(vm, MAPPER_RUNTIME_ADDR, 1, "original frame cadence"));
    writeDelayRoutine(vm, DELAY_ROUTINE_AFTER);
    vm.poke(FRAME_DELAY_RUNTIME_ADDR, FRAME_DELAY_AFTER);
    retimed.push(...measureIntervals(vm, MAPPER_RUNTIME_ADDR, 1, "retimed frame cadence"));
  }
  writeDelayRoutine(vm, DELAY_ROUTINE_AFTER);
  vm.poke(FRAME_DELAY_RUNTIME_ADDR, FRAME_DELAY_AFTER);

  const ratio = mean(retimed) / mean(baseline);
  assertRatioNear(ratio, TARGET_CLOCK_RATIO, 0.01, "BDF04 frame-poll cadence");
  console.log(
    `PASS BDF04 frame cadence: ${mean(baseline).toFixed(2)} -> ${mean(retimed).toFixed(2)} cycles, ` +
      `${ratio.toFixed(5)}x (1 MHz target ${TARGET_CLOCK_RATIO.toFixed(5)}x)`,
  );
}

function measureSpeakerSweep(vm, delayTarget, scaled, label) {
  vm.poke(SWEEP_DELAY_CALL_RUNTIME_ADDR + 1, delayTarget & 0xff);
  vm.poke(SWEEP_DELAY_CALL_RUNTIME_ADDR + 2, delayTarget >> 8);
  vm.poke(0x00d2, 1);
  vm.setPC(SPEAKER_SWEEP_RUNTIME_ADDR);

  const clicks = [];
  const delayArguments = [];
  let cycles = 0;
  for (let instructions = 0; instructions < 500_000; instructions++) {
    const pc = vm.pc();
    if (pc === SPEAKER_STORE_RUNTIME_ADDR) clicks.push(cycles);
    if (pc === DELAY_ROUTINE_RUNTIME_ADDR) {
      const step = vm.regX() & 0xff;
      const expected = scaled && step >= 0x11 ? step + 1 : step;
      assert.equal(vm.regA() & 0xff, expected, `${label}: delay argument for sweep step ${step}`);
      delayArguments.push(vm.regA() & 0xff);
    }
    if (pc === MAPPER_RUNTIME_ADDR && clicks.length > 0) {
      assert.equal(clicks.length, 26, `${label}: one speaker toggle per sweep step`);
      assert.equal(delayArguments.length, 26, `${label}: one delay call per sweep step`);
      return {
        intervals: clicks.slice(1).map((cycle, i) => cycle - clicks[i]),
        totalCycles: cycles,
        delayArguments,
      };
    }
    cycles += correctedStep65C02(vm);
  }
  assert.fail(`${label}: speaker sweep did not finish (pc $${hex(vm.pc())})`);
}

function testSpeakerTiming(vm) {
  writeDelayRoutine(vm, DELAY_ROUTINE_BEFORE);
  const baseline = measureSpeakerSweep(vm, DELAY_ROUTINE_RUNTIME_ADDR, false, "original speaker sweep");
  writeDelayRoutine(vm, DELAY_ROUTINE_AFTER);
  const retimed = measureSpeakerSweep(vm, SWEEP_HELPER_RUNTIME_ADDR, true, "retimed speaker sweep");
  vm.poke(SWEEP_DELAY_CALL_RUNTIME_ADDR + 1, SWEEP_DELAY_CALL_AFTER[1]);
  vm.poke(SWEEP_DELAY_CALL_RUNTIME_ADDR + 2, SWEEP_DELAY_CALL_AFTER[2]);

  assert.deepEqual(baseline.delayArguments, Array.from({ length: 26 }, (_, i) => i + 1));
  assert.deepEqual(
    retimed.delayArguments,
    Array.from({ length: 26 }, (_, i) => i + 1 + Number(i + 1 >= 0x11)),
  );
  const intervalRatio = retimed.intervals.reduce((sum, value) => sum + value, 0) /
    baseline.intervals.reduce((sum, value) => sum + value, 0);
  const completeSweepRatio = retimed.totalCycles / baseline.totalCycles;
  assertRatioNear(intervalRatio, TARGET_CLOCK_RATIO, 0.01, "BDF04 speaker-sweep intervals");
  assertRatioNear(completeSweepRatio, TARGET_CLOCK_RATIO, 0.01, "BDF04 complete speaker sweep");
  console.log(
    `PASS BDF04 speaker sweep: ${baseline.totalCycles} -> ${retimed.totalCycles} cycles, ` +
      `intervals ${intervalRatio.toFixed(5)}x, complete sweep ${completeSweepRatio.toFixed(5)}x ` +
      `(1 MHz target ${TARGET_CLOCK_RATIO.toFixed(5)}x)`,
  );
}

function measureFixedTone(vm, delayRoutine, operand, label) {
  writeDelayRoutine(vm, delayRoutine);
  vm.poke(FIXED_TONE_DELAY_RUNTIME_ADDR, operand);
  vm.setPC(FIXED_TONE_ENTRY_RUNTIME_ADDR);

  const toggles = [];
  let cycles = 0;
  for (let instructions = 0; instructions < 500_000; instructions++) {
    if (vm.pc() === FIXED_TONE_STORE_RUNTIME_ADDR) {
      toggles.push(cycles);
      if (toggles.length === 6) return toggles.slice(1).map((cycle, i) => cycle - toggles[i]);
    }
    cycles += correctedStep65C02(vm);
  }
  assert.fail(`${label}: fixed speaker tone did not finish (pc $${hex(vm.pc())})`);
}

function testFixedToneTiming(vm) {
  const baseline = measureFixedTone(
    vm,
    DELAY_ROUTINE_BEFORE,
    FIXED_TONE_DELAY_BEFORE,
    "original fixed speaker tone",
  );
  const retimed = measureFixedTone(
    vm,
    DELAY_ROUTINE_AFTER,
    FIXED_TONE_DELAY_AFTER,
    "retimed fixed speaker tone",
  );
  const ratio = mean(retimed) / mean(baseline);
  assertRatioNear(ratio, TARGET_CLOCK_RATIO, 0.05, "BDF04 fixed speaker-tone intervals");
  console.log(
    `PASS BDF04 fixed speaker tone: ${mean(baseline).toFixed(2)} -> ${mean(retimed).toFixed(2)} cycles, ` +
      `${ratio.toFixed(5)}x (1 MHz target ${TARGET_CLOCK_RATIO.toFixed(5)}x)`,
  );
}

function measureDelayCall(vm, delayValue, delayRoutine, label) {
  writeDelayRoutine(vm, delayRoutine);
  const code = [
    0xa2, 0xff, 0x9a, 0xd8, 0xa9, delayValue,
    0x20, DELAY_ROUTINE_RUNTIME_ADDR & 0xff, DELAY_ROUTINE_RUNTIME_ADDR >> 8,
    0xea,
  ];
  code.forEach((value, i) => vm.poke(DELAY_TEST_RUNTIME_ADDR + i, value));
  vm.setPC(DELAY_TEST_RUNTIME_ADDR);

  let cycles = 0;
  for (let instructions = 0; instructions < 300_000; instructions++) {
    if (vm.pc() === DELAY_TEST_RUNTIME_ADDR + 9) {
      return {
        cycles,
        accumulator: vm.regA() & 0xff,
        stack: vm.sp(),
        status: vm.status() & 0xff,
      };
    }
    cycles += correctedStep65C02(vm);
  }
  assert.fail(`${label}: shared delay call did not finish (pc $${hex(vm.pc())})`);
}

function testSharedDelayTiming(vm) {
  for (const delayValue of [0x00, 0xf0]) {
    const baseline = measureDelayCall(
      vm,
      delayValue,
      DELAY_ROUTINE_BEFORE,
      `original shared delay $${hex(delayValue)}`,
    );
    const retimed = measureDelayCall(
      vm,
      delayValue,
      DELAY_ROUTINE_AFTER,
      `retimed shared delay $${hex(delayValue)}`,
    );
    assert.equal(retimed.accumulator, 0, `delay $${hex(delayValue)}: preserve the zero result`);
    assert.equal(retimed.stack, 0xff, `delay $${hex(delayValue)}: balance the stack`);
    assert.equal(retimed.status & 0x01, 0x01, `delay $${hex(delayValue)}: leave carry set`);
    assert.equal(retimed.status & 0x02, 0x02, `delay $${hex(delayValue)}: leave zero set`);
    assert.equal(retimed.status & 0x80, 0, `delay $${hex(delayValue)}: leave negative clear`);
    const ratio = retimed.cycles / baseline.cycles;
    assertRatioNear(ratio, TARGET_CLOCK_RATIO, 0.02, `BDF04 shared delay $${hex(delayValue)}`);
    console.log(
      `PASS BDF04 shared delay $${hex(delayValue)}: ${baseline.cycles} -> ${retimed.cycles} cycles, ` +
        `${ratio.toFixed(5)}x`,
    );
  }
}

function measureTitleMusicIntervals(vm, count, label) {
  vm.setPC(0x9234);
  const intervals = [];
  let cycles = 0;
  let previousSpeakerCycle = null;
  for (let instructions = 0; instructions < 1_000_000; instructions++) {
    const pc = vm.pc();
    if (pc === 0x9236 || pc === 0x9250) {
      if (previousSpeakerCycle !== null) intervals.push(cycles - previousSpeakerCycle);
      previousSpeakerCycle = cycles;
      if (intervals.length === count) return intervals;
    }
    cycles += correctedStep65C02(vm);
  }
  assert.fail(`${label}: measured ${intervals.length}/${count} title-music intervals (pc $${hex(vm.pc())})`);
}

function testTitleMusicTiming(vm, run) {
  stopAtPC(vm, 0x9236, run, 20_000_000, "title-music speaker loop");
  assert.deepEqual(
    Array.from({ length: TITLE_MUSIC_E5_LOOP_AFTER.length }, (_, i) =>
      vm.peek(TITLE_MUSIC_E5_LOOP_RUNTIME_ADDR + i)),
    Array.from(TITLE_MUSIC_E5_LOOP_AFTER),
    "the relocated E5 title-music loop contains the retiming call",
  );
  assert.deepEqual(
    Array.from({ length: TITLE_MUSIC_E4_LOOP_AFTER.length }, (_, i) =>
      vm.peek(TITLE_MUSIC_E4_LOOP_RUNTIME_ADDR + i)),
    Array.from(TITLE_MUSIC_E4_LOOP_AFTER),
    "the relocated E4 title-music loop contains the retiming call",
  );
  assert.deepEqual(
    Array.from({ length: TITLE_MUSIC_E5_BRIDGE_AFTER.length }, (_, i) =>
      vm.peek(TITLE_MUSIC_E5_BRIDGE_RUNTIME_ADDR + i)),
    Array.from(TITLE_MUSIC_E5_BRIDGE_AFTER),
    "the relocated E5 title-music bridge adds the delay cycles",
  );
  assert.deepEqual(
    Array.from({ length: TITLE_MUSIC_E4_BRIDGE_AFTER.length }, (_, i) =>
      vm.peek(TITLE_MUSIC_E4_BRIDGE_RUNTIME_ADDR + i)),
    Array.from(TITLE_MUSIC_E4_BRIDGE_AFTER),
    "the relocated E4 title-music bridge adds the delay cycles",
  );
  assert.deepEqual(
    Array.from({ length: TITLE_MUSIC_DELAY_HELPER_BYTES.length }, (_, i) =>
      vm.peek(TITLE_MUSIC_DELAY_HELPER_RUNTIME_ADDR + i)),
    Array.from(TITLE_MUSIC_DELAY_HELPER_BYTES),
    "the copied title-music helper is present at $028E",
  );

  const saved = [0xe4, 0xe5, 0xe6, 0xe7].map((addr) => vm.peek(addr));
  const note = { e4: saved[0], e5: saved[1] };
  assert.ok(note.e4 > 0 && note.e5 > 0, "title music has nonzero E4/E5 periods");
  const baselineLoops = [
    { address: TITLE_MUSIC_E5_LOOP_RUNTIME_ADDR, bytes: TITLE_MUSIC_E5_LOOP_BEFORE },
    { address: TITLE_MUSIC_E4_LOOP_RUNTIME_ADDR, bytes: TITLE_MUSIC_E4_LOOP_BEFORE },
    { address: TITLE_MUSIC_E5_BRIDGE_RUNTIME_ADDR, bytes: TITLE_MUSIC_E5_BRIDGE_BEFORE },
    { address: TITLE_MUSIC_E4_BRIDGE_RUNTIME_ADDR, bytes: TITLE_MUSIC_E4_BRIDGE_BEFORE },
  ];
  const retimedLoops = [
    { address: TITLE_MUSIC_E5_LOOP_RUNTIME_ADDR, bytes: TITLE_MUSIC_E5_LOOP_AFTER },
    { address: TITLE_MUSIC_E4_LOOP_RUNTIME_ADDR, bytes: TITLE_MUSIC_E4_LOOP_AFTER },
    { address: TITLE_MUSIC_E5_BRIDGE_RUNTIME_ADDR, bytes: TITLE_MUSIC_E5_BRIDGE_AFTER },
    { address: TITLE_MUSIC_E4_BRIDGE_RUNTIME_ADDR, bytes: TITLE_MUSIC_E4_BRIDGE_AFTER },
  ];
  const writeLoops = (loops) => {
    for (const { address, bytes } of loops)
      bytes.forEach((value, i) => vm.poke(address + i, value));
  };
  const resetMusicCounters = () => {
    vm.poke(0xe4, note.e4);
    vm.poke(0xe5, note.e5);
    vm.poke(0xe6, 0);
    vm.poke(0xe7, 0);
  };

  try {
    writeLoops(baselineLoops);
    resetMusicCounters();
    const baseline = measureTitleMusicIntervals(vm, 40, "original title music");
    writeLoops(retimedLoops);
    resetMusicCounters();
    const retimed = measureTitleMusicIntervals(vm, 40, "retimed title music");
    const ratio = retimed.reduce((sum, value) => sum + value, 0) /
      baseline.reduce((sum, value) => sum + value, 0);
    assertRatioNear(ratio, TARGET_CLOCK_RATIO, 0.01, "BDF04 title-music speaker intervals");
    console.log(
      `PASS BDF04 title music ($E4=${note.e4}, $E5=${note.e5}): ` +
        `${ratio.toFixed(5)}x (1 MHz target ${TARGET_CLOCK_RATIO.toFixed(5)}x)`,
    );
  } finally {
    writeLoops(retimedLoops);
    saved.forEach((value, i) => vm.poke(0xe4 + i, value));
    vm.setPC(0x9234);
  }
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

    testTitleMusicTiming(vm, run);
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
      "the live poll must execute the patched sweep helper and mapper copied to $0284",
    );
    assert.equal(vm.peek(FRAME_DELAY_RUNTIME_ADDR), FRAME_DELAY_AFTER, "retime the frame wait");
    assert.equal(vm.peek(FIXED_TONE_DELAY_RUNTIME_ADDR), FIXED_TONE_DELAY_AFTER, "retime the fixed speaker delay");
    assert.deepEqual(
      Array.from({ length: DELAY_ROUTINE_AFTER.length }, (_, i) =>
        vm.peek(DELAY_ROUTINE_RUNTIME_ADDR + i)),
      Array.from(DELAY_ROUTINE_AFTER),
      "retime the shared delay routine copied to $03BF",
    );
    assert.equal(vm.peek(SWEEP_BRANCH_RUNTIME_ADDR), SWEEP_BRANCH_OPERAND_AFTER, "skip the helper on the pad path");
    assert.deepEqual(
      Array.from({ length: SWEEP_DELAY_CALL_AFTER.length }, (_, i) =>
        vm.peek(SWEEP_DELAY_CALL_RUNTIME_ADDR + i)),
      Array.from(SWEEP_DELAY_CALL_AFTER),
      "route the variable speaker sweep through its helper",
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
      assert.ok(vm.addBreakpoint(MAPPER_RUNTIME_ADDR), `${label}: install mapper-entry breakpoint`);
      waitForPC(vm, MAPPER_RUNTIME_ADDR, run, 40_000_000, `${label} mapper entry`);
      const entryY = vm.regY();
      const entrySP = vm.sp();
      const entryCarry = vm.status() & 1;
      const expectedTable = [4, 5, 6, 7].map((index) => (mask & (1 << index)) ? 1 : 0);
      assert.deepEqual(
        Array.from({ length: 4 }, (_, i) => vm.peek(0xcee4 + i)),
        expectedTable,
        `${label}: game's $C070 scan fills GAMEPAD1 before the mapper`,
      );

      vm.removeBreakpoint(MAPPER_RUNTIME_ADDR);
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

    testFrameCadence(vm, run);
    testSpeakerTiming(vm);
    testSharedDelayTiming(vm);
    testFixedToneTiming(vm);
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
