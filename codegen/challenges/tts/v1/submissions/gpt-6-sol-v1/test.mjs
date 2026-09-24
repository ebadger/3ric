// Entry-local integration checks on the unmodified WASM VM, not host speech.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "../../../../../tools/asm6502.mjs";
import harness from "../../../../../tools/harness.cjs";

const here = dirname(fileURLToPath(import.meta.url));
const { org, bytes, symbols: S } = assemble(readFileSync(join(here, "tts.s"), "utf8"));
assert.equal(org, 0x0800);
assert.ok(org + bytes.length < 0x2000, "complete image is always-mapped");
assert.ok(S.TTS_INPUT >= org && S.TTS_INPUT + 122 <= org + bytes.length);
assert.ok(S.TTS_INPUT > S.PROMPT, "input cannot overlap executable code or messages");
const session = await harness.boot();
const vm = session.vm;
const vectors = [0x03fb, 0x03fc, 0x03fd, 0x03fe, 0x03ff, 0xfffa, 0xfffb,
  0xfffc, 0xfffd, 0xfffe, 0xffff].map((addr) => [addr, vm.peek(addr)]);
const rom = [0xd000, 0xe000, 0xf000, 0xffff].map((addr) => [addr, vm.memoryMapping(addr)]);

function noLeaks() {
  for (const [addr, value] of vectors) assert.equal(vm.peek(addr), value, `vector $${addr.toString(16)}`);
  for (const [addr, mapping] of rom) assert.equal(vm.memoryMapping(addr), mapping, "upper ROM remains mapped");
  assert.equal(vm.readBus(0xc40e) & 0x7f, 0, "left VIA has no enabled IRQ");
  assert.equal(vm.readBus(0xc48e) & 0x7f, 0, "right VIA has no enabled IRQ");
}

function silent() {
  vm.drainAudio();
  vm.runCycles(250_000);
  const pcm = vm.drainAudio();
  assert.ok(pcm.length > 1000);
  assert.ok(pcm.every((sample) => Math.abs(sample) < 0.0005), "AY remains silent after return");
}

function type(code, cycles = 30_000) {
  assert.equal(vm.readBus(0xc000) & 0x80, 0, "previous keyboard strobe consumed");
  vm.keyDown(typeof code === "string" ? code.charCodeAt(0) : code);
  vm.runCycles(cycles);
  if (vm.readBus(0xc000) & 0x80) vm.runCycles(200_000);
  assert.equal(vm.readBus(0xc000) & 0x80, 0,
    `key was consumed (PC=$${vm.pc().toString(16)}, length=${vm.peek(S.LENGTH)})`);
}

function input() {
  const length = vm.peek(S.LENGTH);
  return Array.from({ length }, (_, i) => String.fromCharCode(vm.peek(S.TTS_INPUT + i))).join("");
}

try {
  assert.ok(vm.enableAudio(48_000));
  session.load(bytes, org);
  vm.setPC(org);
  vm.runCycles(350_000);
  assert.match(vm.drainOutput(), /LARKSPUR 65.*SAY>/s);
  assert.equal(input(), "");
  noLeaks();

  type("h");
  type("e");
  type("l");
  type("x");
  assert.match(session.textScreen().join(" "), /HELX/, "editable input is visible on text page");
  type(8);
  assert.match(session.textScreen().join(" "), /HEL/, "deletion keeps the preceding text");
  assert.doesNotMatch(session.textScreen().join(" "), /HELX/, "deletion visibly erases the last glyph");
  type("l");
  type("o");
  assert.equal(input(), "HELLO");
  assert.match(session.textScreen().join(" "), /HELLO/, "replacement is visible at the old cursor");
  assert.equal(vm.peek(S.TTS_INPUT + 5), 0, "UI maintains a terminator");
  type(13, 6_000_000);
  assert.equal(input(), "", "Enter speaks and opens a fresh editor");
  assert.match(vm.drainOutput(), /SAY>/, "UI returns to next input");
  noLeaks();
  silent();
  console.log("PASS input echo, lowercase, deletion, replay and silence");

  type("C");
  type("A");
  type("T");
  type(13, 4_000_000);
  assert.equal(input(), "");
  assert.match(vm.drainOutput(), /SAY>/);
  noLeaks();
  silent();
  console.log("PASS repeated new English sentence and bank/IRQ cleanup");

  type("#");
  assert.equal(input(), "");
  assert.match(vm.drainOutput(), /USE LETTERS/);
  for (let i = 0; i < 120; i++) type("A");
  assert.equal(input().length, 120);
  type("Z");
  assert.equal(input().length, 120, "UI rejects 121st char");
  assert.match(vm.drainOutput(), /120 CHARACTER LIMIT/);
  for (let i = 0; i < 6; i++) type(8);
  type("B");
  assert.equal(input().length, 115);
  assert.match(session.textScreen().join(" "), /A+B/, "deletion crosses a text row");
  for (let i = 0; i < 4; i++) type("A");
  assert.equal(input().length, 119);
  type(13, 30_000);
  vm.drainAudio();
  vm.runCycles(120_000);
  type(27, 400_000);
  assert.equal(input(), "", "Escape cancels speech and reopens editor");
  assert.match(vm.drainOutput(), /SAY>/);
  noLeaks();
  silent();
  console.log("PASS 120-character limit, unsupported key, cancellation and silence");

  type(27, 250_000);
  let serial = vm.drainOutput();
  assert.match(serial, /\*/, "Escape at input returns to monitor via BRK");
  noLeaks();
  silent();
  vm.keyDown("D".charCodeAt(0));
  vm.runCycles(25_000);
  for (const key of "000") type(key, 25_000);
  type(13, 120_000);
  serial = vm.drainOutput();
  assert.match(serial, /D000/, "monitor still accepts an examine command");
  console.log("PASS BRK return and live monitor command");
} finally {
  vm.disableAudio();
  vm.delete();
}

// A separate guest caller proves invalid-input and unseen-text behavior through
// the public ABI, and captures unprocessed PCM from the same emulator.
const caller = await harness.boot();
const machine = caller.vm;
try {
  assert.ok(machine.enableAudio(48_000));
  caller.load(bytes, org);
  machine.loadData(0x300, Uint8Array.of(0xd8, 0x20, S.TTS_INIT & 255, S.TTS_INIT >> 8, 0xea));
  machine.clearBreakpoints();
  machine.addBreakpoint(0x304);
  machine.setPC(0x300);
  machine.runCycles(30_000);
  assert.equal(machine.pc(), 0x304);
  machine.clearBreakpoints();

  function call(text, record = false, trace = false, pointer = S.TTS_INPUT) {
    const chars = Buffer.from(`${text}\0`, "ascii");
    assert.ok(chars.length <= 122);
    machine.loadData(pointer, chars);
    const trampoline = Uint8Array.of(0xd8, 0xa9, pointer & 255,
      0xa2, pointer >> 8, 0x20, S.TTS_SPEAK & 255, S.TTS_SPEAK >> 8, 0xea);
    machine.loadData(0x300, trampoline);
    machine.clearBreakpoints();
    machine.addBreakpoint(0x308);
    if (trace) machine.addBreakpoint(S.PHONEME);
    machine.readBus(0xc010);
    machine.drainAudio();
    machine.setPC(0x300);
    const stack = machine.sp();
    const chunks = [];
    const phonemes = [];
    let cycles = 0;
    while (machine.pc() !== 0x308 && cycles < 30_000_000) {
      cycles += machine.runCycles(16_000);
      if (record) chunks.push(machine.drainAudio());
      else machine.drainAudio();
      if (trace && machine.breakpointHit() && machine.pc() === S.PHONEME) {
        phonemes.push(machine.regA());
        cycles += machine.step();
      }
    }
    assert.equal(machine.pc(), 0x308, "public ABI returned rather than hanging");
    assert.equal(machine.sp(), stack);
    assert.deepEqual(Buffer.from(Array.from({ length: chars.length }, (_, i) =>
      machine.peek(pointer + i))), chars, "input RAM remains unchanged");
    assert.equal(machine.readBus(0xc40e) & 0x7f, 0);
    assert.equal(machine.readBus(0xc48e) & 0x7f, 0);
    for (const [addr, mapping] of rom) assert.equal(machine.memoryMapping(addr), mapping);
    if (trace && phonemes.length) {
      assert.equal(machine.peek(S.PRESET_READ + 1) | (machine.peek(S.PRESET_READ + 2) << 8),
        S.PRESETS + phonemes.at(-1) * 8, "last phoneme uses its 16-bit preset address");
    }
    return { code: machine.regA(), cycles, chunks, phonemes };
  }

  assert.equal(call("A@B").code, 2, "unsupported ASCII rejected before speech");
  assert.equal(call("A".repeat(121)).code, 2, "121st byte detected without scanning farther");
  assert.equal(call("   ").code, 0);
  assert.deepEqual(call("MAKE ME BLUE TOE THE", false, true).phonemes,
    [34, 6, 18, 34, 7, 13, 36, 10, 17, 9, 32, 2],
    "runtime G2P handles long vowels, final-E, short words and voiced TH across spaces");
  assert.deepEqual(call("MAKE. TYPE?", false, true).phonemes,
    [34, 6, 18, 17, 8, 16],
    "sentence punctuation is a word boundary and TYPE has a long Y vowel");
  assert.deepEqual(call("SENTENCE", false, true).phonemes.at(-1), 27,
    "multi-consonant endings keep the final E silent");
  assert.deepEqual(call("THESE", false, true).phonemes, [32, 7, 27],
    "split E-E is long and final E is silent");
  assert.deepEqual(call("THIN THIS", false, true).phonemes.slice(0, 5),
    [31, 3, 34, 32, 3], "THIN stays unvoiced while THIS is voiced");
  assert.deepEqual(call("L", false, true).phonemes, [36],
    "high-index consonant uses preset 36, not the wrapped vowel preset");
  assert.equal(call("L", false, true, 0x0006).code, 0,
    "low zero-page input remains intact even when it occupies UI scratch");
  assert.equal(call("L", false, true, 0x0008).code, 0,
    "preset lookup cannot overwrite a zero-page input buffer");
  console.log("PASS phoneme IDs, word-boundary rules and 16-bit preset selection");
  const text = "BLUE WAVES WASH OVER SILENT STONES.";
  const spoken = call(text, true);
  assert.equal(spoken.code, 0);
  const frames = spoken.chunks.reduce((n, chunk) => n + chunk.length / 2, 0);
  assert.ok(frames > 48_000, "unseen English uses a multisecond runtime utterance");
  assert.ok(spoken.chunks.some((chunk) => chunk.some((v) => Math.abs(v) > 0.005)),
    "PCM was actually emitted from guest execution");

  const data = Buffer.alloc(frames * 4);
  let offset = 0;
  for (const chunk of spoken.chunks) {
    for (const sample of chunk) {
      data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), offset);
      offset += 2;
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48_000, 24);
  header.writeUInt32LE(192_000, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  const out = join(here, "../../../../../out/tts-v1/gpt-6-sol-v1");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "unseen-blue-waves.wav"), Buffer.concat([header, data]));
  console.log(`PASS invalid ABI, 121st byte, silent blanks; unseen PCM ${frames} frames @ 48 kHz`);
} finally {
  machine.disableAudio();
  machine.delete();
}
