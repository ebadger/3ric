// SPDX-License-Identifier: MIT
// Entry-local guest tests: host code supplies text and captures PCM, never speech.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "../../../../../tools/asm6502.mjs";
import harness from "../../../../../tools/harness.cjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../../../..");
const OUT = path.join(ROOT, "codegen", "out", "tts-v1", "astra-talks-v1", "local");
fs.mkdirSync(OUT, { recursive: true });
const source = fs.readFileSync(path.join(HERE, "tts.s"), "utf8");
const { org, bytes, symbols: S, listing } = assemble(source);
const CLOCK = 1_573_437.5;
const RATE = 48_000;
const summary = { clockHz: CLOCK, pcmSampleRate: RATE, playbackSpeed: 1,
  listening: "Not performed; no auditory access", physicalHardware: "Not tested",
  checks: [], utterances: [], cadence: null };
function check(name, test) {
  test();
  summary.checks.push(name);
  console.log(`PASS ${name}`);
}
const image = address => bytes[address - org];
check("standalone always-mapped image, workspace and 40-column layout", () => {
  assert.equal(org, 0x800);
  assert.equal(org + bytes.length, S.PROGRAM_END);
  assert.ok(S.PROGRAM_END <= 0x9000);
  assert.ok(S.WORD_BUFFER + 122 <= S.PHONE_QUEUE);
  assert.equal(S.PHONE_QUEUE_END - S.PHONE_QUEUE, 512);
  assert.ok(S.TABLES_END <= 0x3000);
  assert.equal(S.HELP_TEXT - S.TITLE_TEXT, 40);
  assert.equal(S.STATUS_TEXT - S.HELP_TEXT, 40);
  assert.equal(S.INPUT_ROWS_LOW - S.STATUS_TEXT, 200);
  const occupied = new Set();
  for (const row of listing)
    for (let i = 0; i < row.bytes.length; i++) {
      assert.ok(!occupied.has(row.pc + i), "no overlapping emissions");
      occupied.add(row.pc + i);
    }
  for (let i = 0; i < 122; i++) assert.ok(occupied.has(S.TTS_INPUT + i));
  assert.doesNotMatch(source, /\$C030|\$C200|\$C480.*speech/i);
});

const session = await harness.boot();
const vm = session.vm;
// Unlike loadData's backing-store shortcut, these writes use actual bus mappings.
for (let i = 0; i < bytes.length; i++) vm.writeBus(org + i, bytes[i]);
assert.ok(vm.enableAudio(RATE));
const memory = (start, count) => Uint8Array.from({ length: count }, (_, i) => vm.peek(start + i));
const vectors = memory(0x3f0, 16);
const window = memory(0x20, 0x20);
const rom = [0xd000, 0xe000, 0xffff].map(a => vm.peekMapped(a));
const zp = memory(6, 8);
const screen = () => session.textScreen();
const phoneNames = Object.fromEntries(Object.entries(S).filter(([key]) => key.startsWith("PH_"))
  .map(([key, value]) => [value, key.slice(3)]));
function queue() {
  const result = [];
  for (let i = 0; i < 512; i++) {
    const id = vm.peek(S.PHONE_QUEUE + i);
    if (id === 255) return result;
    assert.ok(phoneNames[id & 127], `valid phoneme ${id}`);
    result.push(phoneNames[id & 127]);
  }
  throw new Error("unterminated queue");
}
function silentHardware() {
  assert.equal(vm.readBus(0xc40e) & 127, 0);
  assert.equal(vm.readBus(0xc48e) & 127, 0);
  assert.equal(vm.irqAsserted(), false);
  for (const base of [0xc400, 0xc480]) {
    for (const reg of [8, 9, 10]) {
      vm.writeBus(base + 1, reg);
      vm.writeBus(base, 7); vm.writeBus(base, 4);
      vm.writeBus(base + 3, 0); vm.writeBus(base, 5);
      assert.equal(vm.readBus(base + 1), 0, "AY amplitude register silent");
      vm.writeBus(base, 4); vm.writeBus(base + 3, 255);
    }
  }
}
function checkSharedState() {
  assert.deepEqual(memory(6, 8), zp, "borrowed zero page restored");
  assert.deepEqual(memory(0x3f0, 16), vectors, "vectors unchanged");
  assert.deepEqual(memory(0x20, 0x20), window, "ROM text state unchanged");
  assert.deepEqual([0xd000, 0xe000, 0xffff].map(a => vm.peekMapped(a)), rom);
  assert.ok(vm.romVisible(0xd000) && vm.romVisible(0xffff));
  silentHardware();
}
function wav(filename, chunks) {
  const count = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const data = Buffer.alloc(44 + count * 2);
  data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 4, 28);
  data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(count * 2, 40);
  let offset = 44;
  for (const chunk of chunks) for (const value of chunk) {
    assert.ok(Number.isFinite(value));
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), offset);
    offset += 2;
  }
  fs.writeFileSync(path.join(OUT, filename), data);
}
function call(routine, text, { pointer = S.TTS_INPUT, expected = 0, cancel = false,
  capture, flags = 0, trace = false } = {}) {
  const input = typeof text === "string" ? Buffer.from(text + "\0", "latin1") : text;
  if (input && pointer >= 0x9000 && pointer < 0xc000) vm.writeBus(0xc007, 0);
  if (input) for (let i = 0; i < input.length; i++) vm.writeBus(pointer + i, input[i]);
  vm.readBus(0xc010);
  vm.clearBreakpoints();
  // Deliberately test decimal and interrupt-state preservation too.
  vm.loadData(0x300, Uint8Array.of(flags & 8 ? 0xf8 : 0xd8, flags & 4 ? 0x78 : 0x58,
    0xa9, pointer & 255, 0xa2, pointer >> 8, 0x20, S[routine] & 255, S[routine] >> 8));
  vm.addBreakpoint(0x309);
  vm.setPC(0x300);
  const initialSP = vm.sp();
  const initialScreen = memory(0x400, 1024);
  let cycles = 0, cancelledAt = null;
  const chunks = [];
  const io = new Set();
  vm.drainAudio();
  while (cycles < CLOCK * 90 && vm.pc() !== 0x309) {
    if (cancel && cancelledAt === null && cycles >= CLOCK * .07) {
      vm.keyDown(27); cancelledAt = cycles;
    }
    if (trace) {
      const pc = vm.pc(), op = vm.peekMapped(pc);
      // All hardware accesses in this engine are direct absolute/indexed.
      if ([0xad, 0x8d, 0x2c, 0x9c, 0x9d, 0xbd, 0x9e].includes(op)) {
        let addr = vm.peekMapped(pc + 1) | vm.peekMapped(pc + 2) << 8;
        if ([0x9d, 0xbd, 0x9e].includes(op)) addr = (addr + vm.regX()) & 65535;
        assert.notEqual(addr, 0xc030, "no speaker access during traced speech");
        if (pc >= org && pc < S.TABLES_END && addr >= 0xc000 && addr < 0xd000) io.add(addr);
      }
      cycles += vm.step();
      if (cycles % 4096 < 8) chunks.push(vm.drainAudio());
    } else cycles += vm.runCycles(8192);
    if (!trace) chunks.push(vm.drainAudio());
  }
  chunks.push(vm.drainAudio());
  assert.equal(vm.pc(), 0x309, `${routine} returned before deadline`);
  assert.equal(vm.sp(), initialSP);
  assert.equal(vm.status() & 12, flags & 12, "I and D restored");
  if (routine === "TTS_SPEAK") assert.equal(vm.regA(), expected);
  if (input) assert.deepEqual(memory(pointer, input.length), new Uint8Array(input));
  assert.deepEqual(memory(0x400, 1024), initialScreen, "ABI does not draw on screen");
  if (cancel) {
    assert.notEqual(cancelledAt, null);
    assert.ok(cycles - cancelledAt < CLOCK * .02, "cancel within 20 ms");
  }
  checkSharedState();
  if (trace) {
    const permitted = new Set([0xc000, 0xc006, 0xc007, 0xc010, 0xc082]);
    for (const base of [0xc400, 0xc480])
      for (const offset of [0, 1, 2, 3, 4, 5, 11, 13, 14]) permitted.add(base + offset);
    for (const address of io) assert.ok(permitted.has(address), `unexpected I/O $${address.toString(16)}`);
    assert.ok(io.has(0xc400) && io.has(0xc480));
  }
  if (capture) wav(capture, chunks);
  const peak = chunks.reduce((p, chunk) => chunk.reduce((q, v) => Math.max(q, Math.abs(v)), p), 0);
  return { cycles, seconds: cycles / CLOCK, peak, cancellationCycles: cancelledAt === null ? null : cycles - cancelledAt,
    phonemes: routine === "TTS_SPEAK" && typeof text === "string" && /[A-Za-z]/.test(text) &&
      expected === 0 ? queue() : [], io: [...io] };
}

try {
  call("TTS_INIT");
  check("independent init keeps upper ROM visible and disables slot-4 IRQs", () => checkSharedState());
  for (const text of ["", "     ", "...?!-' ,", "@", "HI\n", "A".repeat(121), "\x80"]) {
    const expected = /[@\n\x80]/.test(text) || text.length > 120 ? 2 : 0;
    const result = call("TTS_SPEAK", text, { expected, flags: 8 });
    assert.ok(result.seconds < 2);
  }
  check("empty, space/punctuation-only, invalid/high-bit and overlength inputs", () => {});
  const nonterminated = Buffer.alloc(122, 65);
  call("TTS_SPEAK", nonterminated, { expected: 2 });
  call("TTS_SPEAK", Buffer.from([65]), { pointer: 0xbfff, expected: 2 });
  call("TTS_SPEAK", null, { pointer: 0xc030, expected: 2, trace: true });
  check("bounded rejection of a non-NUL 121-character prefix", () => {});

  const newTexts = [
    "RED BIRDS SING IN THE GREEN GARDEN.",
    "MY SMALL ROBOT WILL READ YOUR LETTER.",
    "FRESH SNOW FALLS ON A QUIET WINDOW.",
    "DON'T HIDE THE BLUE-GREEN KITE!",
  ];
  for (let i = 0; i < newTexts.length; i++) {
    const result = call("TTS_SPEAK", newTexts[i], { capture: `new-${i + 1}.wav`, trace: i === 0 });
    assert.ok(result.peak > .001);
    summary.utterances.push({ text: newTexts[i], ...result });
  }
  check("new ordinary English runtime cases, PCM capture and AY-only access trace", () => {});
  const upper = call("TTS_SPEAK", "WE MAKE A RED KITE.");
  const lower = call("TTS_SPEAK", "we make a red kite.", { flags: 12 });
  assert.deepEqual(upper.phonemes, lower.phonemes);
  assert.ok(upper.phonemes.includes("IY"), "WE keeps its vowel");
  const red = call("TTS_SPEAK", "RED");
  assert.deepEqual(red.phonemes, ["R", "EH", "CLOSE", "D"]);
  const make = call("TTS_SPEAK", "MAKE");
  assert.deepEqual(make.phonemes, ["M", "EH", "IY", "CLOSE", "K"]);
  const snow = call("TTS_SPEAK", "SNOW");
  assert.deepEqual(snow.phonemes, ["S", "N", "AO", "UW"]);
  const blue = call("TTS_SPEAK", "BLUE");
  assert.deepEqual(blue.phonemes, ["CLOSE", "B", "L", "UW"]);
  const my = call("TTS_SPEAK", "MY");
  assert.deepEqual(my.phonemes, ["M", "AA", "IH"]);
  check("repeatability, lower-case normalization and general-rule phoneme regressions", () => {});
  vm.writeBus(0xc007, 0);
  call("TTS_SPEAK", "A ROBIN SINGS.", { pointer: 0x9000 });
  assert.equal(vm.romVisible(0x9000), true, "restore BASIC after RAM input");
  vm.writeBus(0xc006, 0);
  call("TTS_SPEAK", "A ROBIN SINGS.", { flags: 4 });
  assert.equal(vm.romVisible(0x9000), true);
  check("BASIC-overlay RAM input, explicit ROM return mapping and preserved caller flags", () => {});
  summary.cancellation = call("TTS_SPEAK", "PLEASE STOP WHEN I PRESS ESCAPE.", { cancel: true, expected: 1 });
  call("TTS_SPEAK", "BACK AGAIN.");
  call("TTS_SPEAK", "JX".repeat(60));
  check("prompt cancellation, subsequent utterance, and worst-expansion 120-byte input", () => {});

  // Measure actual instruction-boundary sample spacing in the unmodified VM.
  vm.loadData(S.TTS_INPUT, Buffer.from("AAAA\0"));
  vm.loadData(0x300, Uint8Array.of(0xd8, 0xa9, S.TTS_INPUT & 255, 0xa2, S.TTS_INPUT >> 8,
    0x20, S.TTS_SPEAK & 255, S.TTS_SPEAK >> 8));
  vm.clearBreakpoints(); vm.addBreakpoint(S.SAMPLE_TICK); vm.setPC(0x300);
  vm.runCycles(CLOCK);
  assert.equal(vm.pc(), S.SAMPLE_TICK);
  const intervals = [];
  for (let i = 0; i < 2047; i++) {
    let cycles = vm.step();
    cycles += vm.runCycles(10000);
    assert.equal(vm.pc(), S.SAMPLE_TICK);
    intervals.push(cycles);
  }
  summary.cadence = { min: Math.min(...intervals), max: Math.max(...intervals),
    mean: intervals.reduce((a, b) => a + b) / intervals.length };
  assert.ok(Math.abs(summary.cadence.mean - 200) < 1, "no sustained sample deadline loss");
  assert.ok(summary.cadence.max < 260, "bounded phoneme/block transition overhead");
  vm.keyDown(27); vm.clearBreakpoints(); vm.addBreakpoint(0x308);
  vm.step(); vm.runCycles(CLOCK);
  assert.equal(vm.pc(), 0x308);
  check("real timer sample cadence, including waveform wrap", () => {});

  vm.clearBreakpoints(); vm.addBreakpoint(S.INPUT_WAIT); vm.setPC(org);
  vm.runCycles(CLOCK);
  assert.equal(vm.pc(), S.INPUT_WAIT);
  assert.match(screen()[0], /COPPER VOICE/);
  assert.match(screen()[2], /READY/);
  function key(value) {
    assert.equal(vm.pc(), S.INPUT_WAIT);
    vm.keyDown(typeof value === "string" ? value.charCodeAt(0) : value);
    vm.step();
    vm.runCycles(CLOCK * 90);
    assert.equal(vm.pc(), S.INPUT_WAIT);
    assert.equal(vm.readBus(0xc000) & 128, 0);
  }
  key("a"); key("B"); key("C"); key(8); key("d"); key(127);
  assert.equal(vm.peek(S.INPUT_LENGTH), 2);
  assert.equal(Buffer.from(memory(S.TTS_INPUT, 3)).toString("ascii"), "AB\0");
  assert.match(screen()[6], /^AB_/);
  key("@");
  assert.equal(vm.peek(S.INPUT_LENGTH), 2);
  assert.match(screen()[2], /INVALID KEY/);
  for (let i = 2; i < 120; i++) key("E");
  assert.equal(vm.peek(S.INPUT_LENGTH), 120);
  assert.equal(screen()[6].length, 40);
  assert.equal(screen()[7].length, 40);
  assert.equal(screen()[8].length, 40);
  assert.match(screen()[9], /^_/);
  const full = memory(S.TTS_INPUT, 122);
  key("F");
  assert.deepEqual(memory(S.TTS_INPUT, 122), full);
  assert.match(screen()[2], /FULL: 120/);
  key(8);
  assert.equal(vm.peek(S.INPUT_LENGTH), 119);
  check("visible editing, normalization, deletion, invalid key and 120-character UI limit", () => {});
  // Cancel a live UI call, retaining the editable text.
  vm.addBreakpoint(S.SAMPLE_TICK);
  vm.keyDown(13); vm.step(); vm.runCycles(CLOCK);
  assert.equal(vm.pc(), S.SAMPLE_TICK);
  vm.removeBreakpoint(S.SAMPLE_TICK);
  vm.keyDown(27); vm.step(); vm.runCycles(CLOCK);
  assert.equal(vm.pc(), S.INPUT_WAIT);
  assert.equal(vm.peek(S.INPUT_LENGTH), 119);
  assert.match(screen()[2], /CANCELLED/);
  silentHardware();
  for (let i = 0; i < 119; i++) key(8);
  for (const ch of "RED KITE") key(ch);
  key(13);
  assert.equal(vm.peek(S.INPUT_LENGTH), 0);
  assert.match(screen()[2], /READY/);
  for (const ch of "HELLO") key(ch);
  key(13);
  assert.equal(vm.peek(S.INPUT_LENGTH), 0);
  check("UI Escape cancellation preserves editor; repeated Enter returns to fresh input", () => {});
  vm.clearBreakpoints(); vm.drainOutput(); vm.keyDown(27);
  vm.step(); vm.runCycles(CLOCK / 2);
  assert.match(vm.drainOutput(), harness.MONITOR_DUMP);
  assert.ok(screen().join("\n").includes("*"), "visible monitor prompt");
  for (const ch of "0800\r") { vm.keyDown(ch.charCodeAt(0)); vm.runCycles(100000); }
  assert.match(vm.drainOutput(), /0800-/);
  assert.match(screen().join("\n"), /0800-/);
  silentHardware();
  assert.deepEqual(memory(0x3f0, 16), vectors);
  assert.equal(vm.peek(0x20), window[0]);
  assert.equal(vm.peek(0x21), window[1]);
  assert.equal(vm.peek(0x22), window[2]);
  assert.equal(vm.peek(0x23), window[3]);
  check("BRK exit, visible monitor command, text bounds, vectors and IRQ cleanup", () => {});
  vm.disableAudio();
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(summary, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT, "screen.txt"), screen().join("\n") + "\n");
  console.log(`Artifacts: ${OUT}`);
} finally {
  vm.delete();
}
