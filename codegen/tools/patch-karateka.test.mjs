// node codegen\tools\patch-karateka.test.mjs [--disk <owner.dsk>] [--capture-dir <directory>]
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildPayload, INPUT_SHA256, patchKarateka } from "./patch-karateka.mjs";
import { buildWozFromDsk } from "./wozgen.mjs";
import { readWozSectors, sha256 } from "./wozedit.mjs";
import { assemble } from "./asm6502.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const payload = buildPayload();
const s = payload.player.symbols;
const TICK_CYCLES = 24576;
const SAMPLE_RATE = 48000;
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const font = fs.readFileSync(path.join(root, "emulator", "Data", "fontrom.dat"));
const module = await require(path.join(root, "web", "badger6502.js"))();
const memory = (vm, address, length) =>
  Buffer.from(Array.from({ length }, (_, i) => vm.peekMapped(address + i)));
const registers = vm => [vm.regA(), vm.regX(), vm.regY(), vm.status() & 0xcf, vm.sp()];
const hex = value => `$${value.toString(16)}`;

class Audio {
  constructor() {
    this.frames = 0;
    this.left = 0;
    this.right = 0;
    this.difference = 0;
    this.peak = 0;
    this.chunks = [];
  }
  add(pcm, capture = false) {
    assert.equal(pcm.length % 2, 0);
    for (let i = 0; i < pcm.length; i += 2) {
      const left = pcm[i], right = pcm[i + 1];
      assert(Number.isFinite(left) && Number.isFinite(right));
      this.left += left * left;
      this.right += right * right;
      this.difference += (left - right) ** 2;
      this.peak = Math.max(this.peak, Math.abs(left), Math.abs(right));
    }
    if (capture && this.frames < SAMPLE_RATE * 24) this.chunks.push(Float32Array.from(pcm));
    this.frames += pcm.length / 2;
  }
  assertStereo() {
    assert(this.frames > SAMPLE_RATE);
    assert(this.left / this.frames > 0.00001, "Left AY must produce audible PCM");
    assert(this.right / this.frames > 0.00001, "Right AY must produce audible PCM");
    assert(this.difference / this.frames > 0.00001, "Score must be genuinely stereo");
    assert(this.peak < 1, "Mixed PCM must not clip");
  }
  writeWav(filename) {
    const samples = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(SAMPLE_RATE, 24); wav.writeUInt32LE(SAMPLE_RATE * 4, 28);
    wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
    wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
    let offset = 44;
    for (const chunk of this.chunks) for (const sample of chunk) {
      wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), offset);
      offset += 2;
    }
    fs.writeFileSync(filename, wav);
  }
}

function seek(vm, address, budget = 50_000_000, audio = null) {
  assert(vm.addBreakpoint(address));
  let cycles = 0;
  do {
    cycles += vm.runCycles(audio ? Math.min(16000, budget - cycles) : budget - cycles);
    if (audio) audio.add(vm.drainAudio(), true);
  } while (!vm.breakpointHit() && cycles < budget);
  vm.removeBreakpoint(address);
  assert(vm.breakpointHit(), `Timed out seeking ${hex(address)} at ${hex(vm.pc())}`);
  assert.equal(vm.pc(), address);
  return cycles;
}

function call(vm, entry) {
  const trampoline = assemble(`
        .org $0800
        ldx #$FF
        txs
        ldx #$56
        ldy #$A9
        lda #$D3
        sed
        sec
        cli
        clv
        jsr ${hex(entry)}
returned:
        nop
`);
  vm.loadData(trampoline.org, trampoline.bytes);
  vm.setPC(trampoline.org);
  return seek(vm, trampoline.symbols.RETURNED, 100000);
}

function readAY(vm, base, reg) {
  const direction = vm.readBus(base + 3);
  vm.writeBus(base + 3, 255);
  vm.writeBus(base + 1, reg);
  vm.writeBus(base, 7);
  vm.writeBus(base, 4);
  vm.writeBus(base + 3, 0);
  vm.writeBus(base, 5);
  const value = vm.readBus(base + 1);
  vm.writeBus(base, 4);
  vm.writeBus(base + 3, direction);
  return value;
}

function assertSilentAY(vm) {
  for (const base of [0xc400, 0xc480])
    for (const reg of [8, 9, 10]) assert.equal(readAY(vm, base, reg), 0);
}

function testPlayer() {
  assert(payload.player.org === 0xc800 && s.PLAYER_END <= 0xca00);
  assert(s.SCORE_END <= 0xce00 && s.ADAPTER_END <= 0xd000);
  assert.equal(payload.pages.length, 1536);
  assert.throws(() => patchKarateka(Buffer.alloc(143360)), /Unsupported Karateka/);
  assert.throws(() => patchKarateka(Buffer.alloc(143359)), /Unsupported Karateka/);
  for (let note = 1; note <= 40; note++) {
    const offset = s.PERIODS - payload.player.org + note * 2;
    const period = payload.player.bytes[offset] | payload.player.bytes[offset + 1] << 8;
    const hz = 440 * 2 ** ((note + 44 - 69) / 12);
    assert.equal(period, Math.round(1573437.5 / (16 * hz)), `Native-clock period ${note}`);
  }
  const vm = new module.WebVM();
  try {
    vm.loadData(payload.player.org, payload.player.bytes);
    call(vm, s.MUSIC_INIT);
    assert.equal(vm.readBus(0xc40e), 0x80);
    assert.equal(vm.readBus(0xc48e), 0x80);
    assert.equal(readAY(vm, 0xc400, 7), 0x38);
    assert.equal(readAY(vm, 0xc480, 7), 0x2a);
    assertSilentAY(vm);
    vm.poke(0x86, 1);
    vm.poke(0x4f, 1);
    const zp = memory(vm, 0, 256);
    for (const entry of [s.MUSIC_ARM, s.MUSIC_POLL, s.MUSIC_STOP, s.MUSIC_REBASE]) {
      call(vm, entry);
      assert.deepEqual(registers(vm), [0xd3, 0x56, 0xa9, 0x89, 0xff], `${hex(entry)} preserves its ABI`);
      assert.deepEqual(memory(vm, 0, 256), zp, "Music must not borrow game zero page");
    }
    call(vm, s.MUSIC_ARM);
    vm.poke(s.MUSIC_ROW, 0);
    vm.poke(s.MUSIC_PHASE, 0);
    vm.poke(s.TICK_PENDING, 0);
    const loop = assemble(`.org $0800\nloop: jsr ${hex(s.MUSIC_POLL)}\njmp loop`);
    vm.loadData(loop.org, loop.bytes);
    vm.setPC(loop.org);
    assert(vm.enableAudio(SAMPLE_RATE));
    const audio = new Audio();
    let cycles = 0;
    const budget = (128 * 20 + 5) * TICK_CYCLES;
    while (cycles < budget) {
      cycles += vm.runCycles(Math.min(16000, budget - cycles));
      audio.add(vm.drainAudio());
      assert.equal(vm.irqAsserted(), false);
    }
    const ticks = vm.peek(s.MUSIC_ROW) * 20 + vm.peek(s.MUSIC_PHASE);
    assert(Math.abs(ticks - 5) <= 1, `Full 128-row loop kept timer cadence: ${ticks}`);
    audio.assertStereo();
    vm.poke(s.MUSIC_ACTIVE, 1);
    vm.poke(s.TICK_PENDING, 95);
    vm.poke(s.TIMER_LAST, (vm.readBus(0xc405) + 250) & 255);
    call(vm, s.MUSIC_POLL);
    assert.deepEqual(registers(vm), [0xd3, 0x56, 0xa9, 0x89, 0xff], "Due ticks preserve decimal/carry/registers");
    assert(vm.peek(s.TICK_PENDING) < 96, "Timer-byte carry is fully drained");
    assert.deepEqual(memory(vm, 0, 256), zp);
    vm.poke(0x4f, 0);
    call(vm, s.MUSIC_POLL);
    assert.equal(vm.peek(s.MUSIC_ACTIVE), 0, "Effects-only mode immediately silences the score");
    assertSilentAY(vm);
    console.log("PASS isolated player: full looping stereo score, native pitch/timing, no IRQ, preserved ABI/zero page");
  } finally {
    vm.delete();
  }
}

function testTransportCadence() {
  for (const withEffects of [false, true]) {
    const vm = new module.WebVM();
    try {
      vm.loadData(payload.player.org, payload.player.bytes);
      vm.poke(0x86, 1);
      vm.poke(0x4f, 1);
      const caller = assemble(`
        .org $0800
        ldx #$FF
        txs
        cld
        jsr ${hex(s.MUSIC_INIT)}
        jsr ${hex(s.MUSIC_ARM)}
ready:
        nop
next_frame:
        jsr rendering_work
        jsr ${hex(s.MUSIC_POLL)}
        jsr rendering_work
        jsr ${hex(s.MUSIC_ARM)}
        ${withEffects ? `jsr ${hex(s.EFFECT_1)}` : ""}
        inc frame_count
        lda frame_count
        cmp #64
        bne next_frame
        jsr ${hex(s.MUSIC_POLL)}
finished:
        nop
rendering_work:
        ldx #200
render_outer:
        ldy #4
render_inner:
        dey
        bne render_inner
        dex
        bne render_outer
        rts
frame_count:
        .byte 0
        .org $0C55
effect_begin:
        ldx #180
effect_outer:
        ldy #255
effect_inner:
        dey
        bne effect_inner
        dex
        bne effect_outer
effect_end:
        rts
`);
      const c = caller.symbols;
      vm.loadData(caller.org, caller.bytes);
      vm.setPC(caller.org);
      seek(vm, c.READY, 100000);
      for (const address of [c.EFFECT_BEGIN, c.EFFECT_END, c.FINISHED]) vm.addBreakpoint(address);
      let cycles = 0, blocked = 0, effectStart = null, effects = 0;
      while (vm.pc() !== c.FINISHED && cycles < 50000000) {
        cycles += vm.runCycles(50000000 - cycles);
        assert(vm.breakpointHit(), "Synthetic cadence run must complete within its budget");
        if (vm.pc() === c.EFFECT_BEGIN) {
          effectStart = cycles;
        } else if (vm.pc() === c.EFFECT_END) {
          assert.notEqual(effectStart, null);
          const rtsCycles = vm.step();
          blocked += cycles - effectStart + rtsCycles;
          cycles += rtsCycles;
          effectStart = null;
          effects++;
          continue;
        } else {
          break;
        }
        cycles += vm.step();
      }
      assert.equal(vm.pc(), c.FINISHED);
      assert.equal(effects, withEffects ? 64 : 0);
      const expected = Math.floor((cycles - blocked) / TICK_CYCLES);
      const actual = vm.peek(s.MUSIC_ROW) * 20 + vm.peek(s.MUSIC_PHASE);
      assert(Math.abs(actual - expected) <= 1,
        `Frame/effect cadence: expected ${expected} ticks, got ${actual} (effects=${withEffects})`);
    } finally {
      vm.delete();
    }
  }
  console.log("PASS active-frame cadence and pre-effect time accounting across multi-wrap blocking effects");
}

async function bootDisk(woz) {
  // Each module owns its MEMFS: two VMs in one module both read /disk0.woz.
  const isolated = await require(path.join(root, "web", "badger6502.js"))();
  const vm = new isolated.WebVM();
  vm.loadData(0, rom.subarray(0, 65536));
  vm.seedBasicRom();
  vm.loadFont(font);
  vm.reset();
  vm.runCycles(5000000);
  assert(vm.insertDisk(0, woz));
  for (const ch of "MON\rC600G\r") {
    assert.equal(vm.peek(0xc000) & 128, 0);
    vm.keyDown(ch.charCodeAt(0));
    vm.runCycles(300000);
  }
  return vm;
}

function startGame(vm) {
  seek(vm, 0xb4de, 350000000);
  vm.keyDown(32);
  vm.step();
  seek(vm, 0xbffa, 100000000);
  assert.equal(vm.peek(0xd0), 1, "Space leaves attract mode and starts the actual game");
  assert.equal(vm.peek(0xd2), 1);
  vm.step();
  seek(vm, 0x7600);
}

function frame(vm, key, audio = null) {
  assert.equal(vm.pc(), 0x7600);
  if (key !== undefined) vm.keyDown(key);
  const first = vm.step();
  return first + seek(vm, 0x7600, 50000000, audio);
}

function testPolling(vm) {
  const points = [s.MUSIC_POLL, s.MUSIC_ARM, s.MUSIC_STOP, s.MUSIC_REBASE];
  for (const address of points) vm.addBreakpoint(address);
  let cycles = 0, last = null, worst = 0, polls = 0;
  while (cycles < 6000000) {
    cycles += vm.runCycles(6000000 - cycles);
    if (!vm.breakpointHit()) break;
    if (vm.pc() === s.MUSIC_POLL && vm.peek(s.MUSIC_ACTIVE)) {
      if (last !== null) {
        worst = Math.max(worst, cycles - last);
        assert(cycles - last < 65536, "Active render callbacks must not miss a timer-byte wrap");
      }
      last = cycles;
      polls++;
    } else if (vm.pc() !== s.MUSIC_ARM || !vm.peek(s.MUSIC_ACTIVE)) {
      last = null;
    }
    cycles += vm.step();
  }
  for (const address of points) vm.removeBreakpoint(address);
  assert(polls > 100 && worst > 0);
  seek(vm, 0x7600);
  console.log(`PASS rendering-time clock: ${polls} active polls; worst observed gap ${worst} < 65536 cycles`);
}

function speakerEdges(vm, entry) {
  const caller = assemble(`.org $0800
        ldx #$FF
        txs
        lda #5
        cld
        jsr ${hex(entry)}
returned:
        nop`);
  vm.loadData(caller.org, caller.bytes);
  vm.setPC(caller.org);
  let cycles = 0;
  const edges = [];
  while (vm.pc() !== caller.symbols.RETURNED && cycles < 1000000) {
    const pc = vm.pc();
    if ([0xad, 0xae, 0x8d, 0x2c].includes(vm.peekMapped(pc))
        && vm.peekMapped(pc + 1) === 0x30 && vm.peekMapped(pc + 2) === 0xc0) edges.push(cycles);
    cycles += vm.step();
  }
  assert.equal(vm.pc(), caller.symbols.RETURNED, `Speaker effect ${hex(entry)} returns`);
  assert(edges.length > 1, `Original effect ${hex(entry)} really toggles $C030`);
  return edges.map(cycle => cycle - edges[0]);
}

function testSpeaker(original, patched) {
  const zp = memory(original, 0, 256);
  for (let entry = 0x0c40; entry <= 0x0c52; entry += 3) {
    original.loadData(0, zp);
    patched.loadData(0, zp);
    assert.deepEqual(speakerEdges(patched, entry), speakerEdges(original, entry),
      `Every original speaker edge retains its exact relative cycle at ${hex(entry)}`);
  }
  console.log("PASS all seven original speaker effects: identical $C030 edge timing");
}

async function testImage(input, captureDir) {
  assert.equal(sha256(input), INPUT_SHA256);
  const result = patchKarateka(input);
  assert.equal(result.dsk.length, input.length);
  const restored = Buffer.from(result.dsk);
  const touched = new Set();
  for (const patch of result.patches) {
    const before = Buffer.from(patch.before, "hex");
    const after = Buffer.from(patch.after, "hex");
    assert.deepEqual(input.subarray(patch.offset, patch.offset + before.length), before);
    assert.deepEqual(result.dsk.subarray(patch.offset, patch.offset + after.length), after);
    restored.set(before, patch.offset);
    for (let i = 0; i < before.length; i++) touched.add(patch.offset + i);
  }
  assert.deepEqual(restored, input);
  for (let i = 0; i < input.length; i++)
    if (!touched.has(i)) assert.equal(result.dsk[i], input[i], `Unpatched byte ${hex(i)}`);
  assert.throws(() => patchKarateka(result.dsk), /Unsupported Karateka/);
  const wrong = Buffer.from(input);
  wrong[0x4e00] ^= 1;
  assert.throws(() => patchKarateka(wrong), /Unsupported Karateka/);
  const woz = Buffer.from(buildWozFromDsk(result.dsk));
  const coordinates = Array.from({ length: 560 }, (_, i) => ({ track: i >> 4, sector: i & 15 }));
  for (const { track, sector, data } of readWozSectors(woz, coordinates)) {
    const logical = sector === 15 ? 15 : sector * 7 % 15;
    const offset = (track * 16 + logical) * 256;
    assert.deepEqual(data, result.dsk.subarray(offset, offset + 256));
  }
  testCli(input, result.dsk, woz);
  console.log("PASS exact-image guards, reversible patches, all 560 WOZ sectors, and exclusive CLI outputs");

  const original = await bootDisk(buildWozFromDsk(input));
  const patched = await bootDisk(woz);
  try {
    startGame(original);
    startGame(patched);
    assert.deepEqual(memory(original, 0x7600, 3), Buffer.from([0x4c, 0x28, 0x76]), "Baseline disk is unpatched");
    assert.deepEqual(memory(patched, 0x7600, 3), Buffer.from([0x4c, s.GAME_FRAME & 255, s.GAME_FRAME >> 8]));
    for (const [address, count] of [[0xc800, 512], [0xcc00, 512], [0xcf00, 256]]) {
      const actual = memory(patched, address, count);
      for (let i = 0; i < count; i++) {
        if (address + i >= s.MUSIC_ACTIVE && address + i < s.PLAYER_END) continue;
        assert.equal(actual[i], payload.pages[(address === 0xc800 ? 1 : address === 0xcc00 ? 3 : 5) * 256 + i],
          `Disk installed resident byte ${hex(address + i)}`);
      }
    }
    const audio = new Audio();
    assert(patched.enableAudio(SAMPLE_RATE));
    let originalCycles = 0, patchedCycles = 0;
    const positions = new Set(), rows = new Set();
    for (let index = 0; index < 46; index++) {
      assert.deepEqual(memory(patched, 0, 256), memory(original, 0, 256), `Game zero page, frame ${index}`);
      assert.deepEqual(registers(patched), registers(original), `Game CPU state, frame ${index}`);
      assert.deepEqual(Uint8Array.from(patched.renderFrame()), Uint8Array.from(original.renderFrame()),
        `Original pixels, frame ${index}`);
      for (const [address, count] of [[0xca00, 512], [0xce00, 256]])
        assert.deepEqual(memory(patched, address, count), memory(original, address, count), "Firmware RAM is untouched");
      assert.equal(patched.peek(0xd0), 1, "Still in actual gameplay");
      positions.add(patched.peek(0x62));
      rows.add(patched.peek(s.MUSIC_ROW));
      const key = index === 0 ? 75 : index === 10 ? 21 : index === 26 ? 32
        : index >= 30 && index % 6 === 0 ? 87 : undefined;
      originalCycles += frame(original, key);
      patchedCycles += frame(patched, key, audio);
    }
    assert.equal(patched.peek(0xc4), 1, "K selected keyboard controls");
    assert(positions.size >= 4, "Right arrow moved the actual player");
    assert(patched.peek(0xb7) < 14, "A natural attack hit the guard and reduced his health");
    assert(rows.size >= 8, "Score progresses during movement and attacks");
    assert(patchedCycles < originalCycles * 1.2, "Music overhead must stay below 20% on the covered gameplay sequence");
    audio.assertStereo();
    console.log(`PASS actual game: 46 pixel/state-identical movement/combat frames including a hit, stereo PCM, `
      + `${((patchedCycles / originalCycles - 1) * 100).toFixed(1)}% overhead`);
    testPolling(patched);

    patched.keyDown(27);
    patched.step();
    seek(patched, 0x7791);
    assert.equal(patched.peek(s.MUSIC_ACTIVE), 0);
    assertSilentAY(patched);
    const paused = [patched.peek(s.MUSIC_ROW), patched.peek(s.MUSIC_PHASE), patched.peek(0x62), patched.peek(0xb6)];
    patched.runCycles(1000000);
    patched.drainAudio();
    assert.deepEqual([patched.peek(s.MUSIC_ROW), patched.peek(s.MUSIC_PHASE), patched.peek(0x62), patched.peek(0xb6)], paused);
    patched.keyDown(32);
    seek(patched, 0x7600);
    frame(patched);
    assert.equal(patched.peek(s.MUSIC_ACTIVE), 1);
    for (const [effects, music] of [[1, 0], [0, 0], [1, 1]]) {
      frame(patched, 19);
      frame(patched);
      assert.equal(patched.peek(0x86), effects);
      assert.equal(patched.peek(0x4f), music);
      assert.equal(patched.peek(s.MUSIC_ACTIVE), music);
      if (!music) assertSilentAY(patched);
    }
    patched.keyDown(18);
    patched.step();
    seek(patched, s.RESTART_GAME);
    patched.step();
    seek(patched, 0x02a2);
    assert.equal(patched.peek(s.MUSIC_ACTIVE), 0);
    assertSilentAY(patched);
    seek(patched, 0x7600, 150000000);
    for (let i = 0; i < 12; i++) frame(patched);
    assert.equal(patched.peek(s.MUSIC_ACTIVE), 1, "Original restart path remains usable");
    assert(patched.peek(s.MUSIC_ROW) > 0, "Restarted score advances after the original cue");
    console.log("PASS Escape pause/resume, all three Control-S modes, and Control-R restart");
    testSpeaker(original, patched);
    if (captureDir) {
      fs.mkdirSync(captureDir, { recursive: true });
      audio.writeWav(path.join(captureDir, "karateka-gameplay.wav"));
    }
  } finally {
    original.delete();
    patched.delete();
  }
}

function testCli(input, dsk, woz) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "3ric-karateka-"));
  try {
    const source = path.join(directory, "original.dsk");
    fs.writeFileSync(source, input);
    const cli = (...args) => spawnSync(process.execPath, [path.join(root, "codegen", "tools", "patch-karateka.mjs"), ...args],
      { encoding: "utf8" });
    assert.notEqual(cli(source, source).status, 0);
    assert.deepEqual(fs.readFileSync(source), input);
    for (const [extension, expected] of [["dsk", dsk], ["woz", woz]]) {
      const output = path.join(directory, `music.${extension}`);
      const first = cli(source, output);
      assert.equal(first.status, 0, first.stderr);
      assert.deepEqual(fs.readFileSync(output), expected);
      assert.notEqual(cli(source, output).status, 0, "Existing output must not be overwritten");
      assert.deepEqual(fs.readFileSync(output), expected);
    }
    const invalid = path.join(directory, "invalid.bin");
    assert.notEqual(cli(source, invalid).status, 0);
    assert.equal(fs.existsSync(invalid), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

let disk, captureDir;
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i], value = process.argv[i + 1];
  if (!value || (flag !== "--disk" && flag !== "--capture-dir"))
    throw new Error("Usage: node codegen\\tools\\patch-karateka.test.mjs [--disk <owner.dsk>] [--capture-dir <directory>]");
  if (flag === "--disk") disk = value;
  else captureDir = value;
}
testPlayer();
testTransportCadence();
if (disk) await testImage(fs.readFileSync(disk), captureDir);
else console.log("SKIP owner-supplied disk boot/gameplay checks (pass --disk); no game assets are bundled.");
