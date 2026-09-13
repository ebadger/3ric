// Run after web/build.ps1: node codegen/tools/hackaday.test.mjs
// --write-preview refreshes the landing page's real framebuffer still.
// --capture-dir <directory> additionally saves all four scenes for inspection.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";
import { runInNewContext } from "node:vm";
import { assemble } from "./asm6502.mjs";
import { buildBootableWoz } from "./wozgen.mjs";
import harnessPkg from "./harness.cjs";

const { boot } = harnessPkg;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(ROOT, "codegen", "programs", "hackaday.s"), "utf8");
const { org, bytes, symbols: S } = assemble(source);
const haddr = y =>
  0x2000 + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;
assert.equal(org, 0x0800);
assert.equal(S.IMAGE_END, org + bytes.length);
assert.ok(S.IMAGE_END < 0x2000, "the raw PRG must not overlap video RAM");
assert.equal(S.SCENE_TICKS, 384);
assert.equal(S.NOTE_TICKS, 6);
console.log(`PASS assembly: ${bytes.length} bytes at $0800`);

const s = await boot();
const vm = s.vm;
s.load(bytes, org);
const originalACR = vm.readBus(S.VIA_ACR);
const originalIER = vm.readBus(S.VIA_IER);
const memory = (addr, count) =>
  Buffer.from(Array.from({ length: count }, (_, i) => vm.peek(addr + i)));
const originalWindow = memory(0x20, 4);
const hires = () => memory(0x2000, 0x2000);
const animationState = () => [
  S.SCENE, S.PAUSED, S.MUTED, S.TICK, S.PHASE, S.AGE_LO, S.AGE_HI, S.SCOREPOS,
].map(addr => vm.peek(addr));
const canaries = [0x1fff, 0x4000, 0x5fff, 0x60c0, 0x61c0, 0x6430,
  0x6470, 0x64a8, 0x64c8, 0x64d8, 0x64e6, 0x64ee, 0x6504, 0x67ff];
for (const addr of canaries) vm.poke(addr, 0xa5);

function runTo(address, budget = 1_000_000) {
  vm.addBreakpoint(address);
  const cycles = vm.runCycles(budget);
  assert.ok(vm.breakpointHit(), `must reach $${address.toString(16)} within ${budget} cycles (PC=$${vm.pc().toString(16)})`);
  assert.equal(vm.pc(), address);
  vm.clearBreakpoints();
  return cycles;
}

function call(entry, budget = 1_000_000) {
  const trampoline = 0x7000;
  const code = [0xa2, 0xff, 0x9a, 0x20, entry & 0xff, entry >> 8, 0xea];
  code.forEach((value, i) => vm.poke(trampoline + i, value));
  vm.setPC(trampoline);
  const cycles = runTo(trampoline + 6, budget);
  vm.setPC(S.MAIN);
  return cycles;
}

let pcm = null;
function frame() {
  assert.equal(vm.pc(), S.MAIN, "a frame starts at the live loop");
  vm.step();
  const cycles = 6 + runTo(S.MAIN);
  assert.deepEqual(memory(0x20, 4), originalWindow, "drawing must preserve the ROM text window");
  const samples = vm.drainAudio();
  if (pcm) pcm.push(Float32Array.from(samples));
  return cycles;
}

function key(code) {
  assert.equal(vm.peek(S.KBD) & 0x80, 0, "previous key was consumed");
  vm.keyDown(typeof code === "string" ? code.charCodeAt(0) : code);
  const cycles = frame();
  assert.equal(vm.peek(S.KBD) & 0x80, 0, "input uses and clears the real keyboard latch");
  return cycles;
}

function readAY(base, reg) {
  vm.writeBus(base + 3, 0xff);
  vm.writeBus(base + 1, reg);
  vm.writeBus(base, 7);
  vm.writeBus(base, 4);
  vm.writeBus(base + 3, 0);
  vm.writeBus(base, 5);
  const value = vm.readBus(base + 1);
  vm.writeBus(base, 4);
  vm.writeBus(base + 3, 0xff);
  return value;
}

function assertUsableMonitor(session) {
  const target = session.vm;
  const assertPrompt = () => {
    assert.equal(target.peek(0x24), 1, "cursor is immediately after the monitor prompt");
    // The ROM's blinking cursor is $60 (backtick) in text RAM.
    assert.match(session.textScreen()[target.peek(0x25)], /^\*`?$/, "the monitor prompt is visibly usable");
  };
  target.runCycles(100_000);
  assert.deepEqual(
    Buffer.from(Array.from({ length: 4 }, (_, i) => target.peek(0x20 + i))),
    originalWindow,
    "exit preserves the ROM window bounds",
  );
  assertPrompt();
  assert.ok(!session.textScreen().join("\n").includes("SCENE"), "HOME clears the old demo HUD");
  target.drainOutput();
  for (const ch of "0800.0803\r") {
    assert.equal(target.peek(S.KBD) & 0x80, 0, "monitor consumes the previous key");
    target.keyDown(ch.charCodeAt(0));
    target.runCycles(80_000);
  }
  const expected = `0800- ${Array.from(bytes.subarray(0, 4), b => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")}`;
  assert.ok(target.drainOutput().includes(expected), "monitor executes a memory examination command");
  assert.ok(session.textScreen().some(row => row.includes(expected)), "the command result is visible on screen");
  assertPrompt();
}

// PNG is only a lossless container around renderFrame(), not a second renderer.
function png(framebuffer) {
  const width = 320, height = 384;
  assert.equal(framebuffer.length, width * height * 4);
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    Buffer.from(framebuffer.subarray(y * width * 4, (y + 1) * width * 4))
      .copy(rows, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

vm.setPC(S.START);
const startup = runTo(S.MAIN);
assert.equal(vm.textMode(), 0);
assert.equal(vm.lores(), 0);
assert.equal(vm.mixed(), 1);
assert.equal(vm.gfxPage(), 0);
assert.equal(vm.readBus(S.VIA_ACR), originalACR & ~0x20);
assert.equal(vm.readBus(S.VIA_IER), originalIER & ~0x20);
assert.deepEqual(memory(0x20, 4), originalWindow, "startup preserves the ROM text window");
assert.match(s.textScreen()[20], /01 SIGNAL/);
for (let y = 0; y < 192; y++) {
  assert.equal(vm.peek(S.ROWL + y) | (vm.peek(S.ROWH + y) << 8), haddr(y));
}
for (let x = 0; x < 256; x++) {
  assert.equal(vm.peek(S.XCOL + x), 1 + Math.floor(x / 7));
  assert.equal(vm.peek(S.XMASK + x), 1 << (x % 7));
}
assert.ok(hires().some(byte => byte !== 0), "startup actually draws into hi-res memory");
assert.equal(readAY(0xc400, 7), 0x38);
assert.equal(readAY(0xc480, 7), 0x38);
console.log(`PASS real startup, scanline tables, mixed graphics, and sound setup (${startup} cycles)`);

const previews = [];
const names = ["signal", "color", "wireframe", "stereo"];
const worstFrames = [];
for (let scene = 0; scene < 4; scene++) {
  key(String(scene + 1));
  assert.equal(vm.peek(S.SCENE), scene);
  assert.equal(vm.lores(), scene === 1 ? 1 : 0);
  assert.equal(vm.mixed(), 1);
  assert.match(s.textScreen()[20], new RegExp(`0${scene + 1} `));
  const before = Buffer.from(vm.renderFrame());
  let worst = 0;
  for (let i = 0; i < 64; i++) {
    const cycles = frame();
    worst = Math.max(worst, cycles);
    assert.equal(vm.peek(S.SCENE), scene);
    if (i === 0) {
      assert.ok(!Buffer.from(vm.renderFrame()).equals(before), `${names[scene]} animates on the CPU`);
    }
    if (i === 31) previews.push(png(vm.renderFrame()));
  }
  assert.ok(worst <= 63_000, `${names[scene]} steady-state frames fit 63,000 cycles, got ${worst}`);
  worstFrames.push(worst);
  const fb = vm.renderFrame();
  const colors = new Set();
  let lit = 0;
  for (let y = 0; y < 320; y++) {
    for (let x = 0; x < 320; x++) {
      const offset = (y * 320 + x) * 4;
      const rgb = [...fb.subarray(offset, offset + 3)].join(",");
      colors.add(rgb);
      if (rgb !== "0,0,0") lit++;
    }
  }
  assert.ok(lit > (scene === 1 ? 70_000 : 600), `${names[scene]} has visible real pixels`);
  if (scene === 1) assert.ok(colors.size >= 15, "plasma reaches the real lo-res palette");
}
console.log(`PASS four animated scenes at native cadence: ${worstFrames.join(", ")} cycles`);

// Both the underlying framebuffer and an XOR-drawn line must restore exactly.
key("3");
const cubeBefore = hires();
call(S.XOR_CUBE);
assert.notDeepEqual(hires(), cubeBefore);
call(S.XOR_CUBE);
assert.deepEqual(hires(), cubeBefore, "double XOR restores every original pixel");
for (const [x0, y0, x1, y1] of [
  [0, 0, 255, 159], [255, 159, 0, 0], [0, 159, 255, 0],
  [10, 10, 10, 10], [0, 80, 255, 80], [128, 0, 128, 159],
  [230, 120, 12, 3], [12, 3, 230, 120],
]) {
  const before = hires();
  for (let pass = 0; pass < 2; pass++) {
    vm.poke(S.PX, x0); vm.poke(S.PY, y0);
    vm.poke(S.ENDX, x1); vm.poke(S.ENDY, y1);
    call(S.LINE);
    assert.equal(vm.peek(S.PX), x1);
    assert.equal(vm.peek(S.PY), y1);
    if (pass === 0) assert.notDeepEqual(hires(), before);
  }
  assert.deepEqual(hires(), before, "line erasure restores the full image");
}
console.log("PASS XOR restoration and line endpoints in every direction");

// One entire attract loop checks scene timing, music wrap, and workspace bounds.
key("1");
vm.poke(S.AGE_LO, 0);
vm.poke(S.AGE_HI, 0);
const visits = [];
for (let i = 0; i < S.SCENE_TICKS * 4; i++) {
  const oldScene = vm.peek(S.SCENE);
  const cycles = frame();
  if (oldScene === vm.peek(S.SCENE)) {
    assert.ok(cycles <= 63_000, `scene ${oldScene + 1}, tick ${i}: ${cycles} cycles exceeds native cadence`);
  }
  assert.ok(vm.peek(S.TICK) < S.NOTE_TICKS);
  assert.ok(vm.peek(S.SCOREPOS) < 64);
  for (let voice = 0; voice < 6; voice++) {
    assert.ok(vm.peek(S.VOICE_NOTES + voice) < 32);
    assert.ok(vm.peek(S.VOICE_LEVELS + voice) <= 15);
  }
  if (oldScene !== vm.peek(S.SCENE)) {
    assert.equal((i + 1) % S.SCENE_TICKS, 0, "scene transitions use exactly 384 live ticks");
    visits.push(vm.peek(S.SCENE));
  }
}
assert.deepEqual(visits, [1, 2, 3, 0], "the complete four-scene loop repeats");
for (const addr of canaries) assert.equal(vm.peek(addr), 0xa5, `$${addr.toString(16)} remains untouched`);
assert.deepEqual(memory(org, bytes.length), Buffer.from(bytes), "the program never overwrites its image");
console.log("PASS full attract loop, note bounds, immutable image, and memory canaries");

assert.ok(vm.enableAudio(48000));
key("4");
pcm = [];
for (let i = 0; i < 32; i++) frame();
const samples = pcm.flatMap(chunk => [...chunk]);
pcm = null;
let left = 0, right = 0, separation = 0;
for (let i = 0; i < samples.length; i += 2) {
  assert.ok(Number.isFinite(samples[i]) && Number.isFinite(samples[i + 1]));
  left += Math.abs(samples[i]);
  right += Math.abs(samples[i + 1]);
  separation += Math.abs(samples[i] - samples[i + 1]);
}
assert.ok(left > 100 && right > 100 && separation > 100, "real PCM contains distinct left/right music");
for (let voice = 0; voice < 6; voice++) {
  const base = voice < 3 ? 0xc400 : 0xc480;
  const channel = voice % 3;
  const note = vm.peek(S.VOICE_NOTES + voice);
  assert.equal(readAY(base, channel * 2), bytes[S.NOTE_LO - org + note]);
  assert.equal(readAY(base, channel * 2 + 1), bytes[S.NOTE_HI - org + note]);
  assert.equal(readAY(base, channel + 8), vm.peek(S.VOICE_LEVELS + voice), "displayed level is the AY value");
}
key("M");
const mutedScore = vm.peek(S.SCOREPOS);
for (let i = 0; i < 12; i++) frame();
assert.notEqual(vm.peek(S.SCOREPOS), mutedScore, "mute does not pause the sequencer");
for (let voice = 0; voice < 6; voice++) {
  assert.equal(vm.peek(S.VOICE_LEVELS + voice), 0);
  assert.equal(readAY(voice < 3 ? 0xc400 : 0xc480, 8 + voice % 3), 0);
}
pcm = [];
for (let i = 0; i < 3; i++) frame();
assert.ok(pcm.every(chunk => chunk.every(value => Math.abs(value) < 0.0001)), "mute drains to actual silence");
pcm = null;
key("M");
assert.ok(memory(S.VOICE_LEVELS, 6).some(value => value > 0));
key(" ");
assert.equal(vm.peek(S.PAUSED), 1);
assert.match(s.textScreen()[23], /^PAUSED/);
const pausedState = animationState();
const pausedGraphics = hires();
for (let i = 0; i < 10; i++) frame();
assert.deepEqual(animationState(), pausedState);
assert.deepEqual(hires(), pausedGraphics, "pause freezes the real display");
assert.ok(memory(S.VOICE_LEVELS, 6).every(value => value === 0), "pause silences all six voices");
key("2");
assert.equal(vm.peek(S.PAUSED), 1, "manual scene changes preserve pause");
assert.equal(vm.peek(S.AGE_LO), 0);
const pausedLores = memory(0x0400, 0x400);
for (let i = 0; i < 5; i++) frame();
assert.deepEqual(memory(0x0400, 0x400), pausedLores);
key(" ");
assert.equal(vm.peek(S.PAUSED), 0);
key("N");
assert.equal(vm.peek(S.SCENE), 2);
key(0x15);
assert.equal(vm.peek(S.SCENE), 3);
key(0x15);
assert.equal(vm.peek(S.SCENE), 0, "next wraps");
key(0x08);
assert.equal(vm.peek(S.SCENE), 3, "previous wraps");
key("Z");
assert.equal(vm.peek(S.SCENE), 3, "unknown input is consumed without changing scenes");
console.log("PASS actual stereo PCM, AY readback, mute, pause, scene controls, and keyboard acknowledgement");

for (let scene = 0; scene < 4; scene++) {
  for (const exitKey of [0x1b, "Q".charCodeAt(0)]) {
    key(String(scene + 1));
    for (let i = 0; i < 3; i++) frame();
    vm.keyDown(exitKey);
    const exit = s.run({ org: S.MAIN, maxCycles: 1_000_000 });
    assert.equal(exit.halt, "brk-monitor");
    assert.equal(vm.textMode(), 1);
    assert.equal(vm.mixed(), 0);
    assert.equal(vm.gfxPage(), 0);
    assert.equal(vm.readBus(S.VIA_ACR), originalACR);
    assert.equal(vm.readBus(S.VIA_IER), originalIER);
    for (const base of [0xc400, 0xc480]) {
      for (let reg = 8; reg <= 10; reg++) assert.equal(readAY(base, reg), 0);
    }
    assertUsableMonitor(s);
    vm.setPC(S.START);
    runTo(S.MAIN);
  }
}
vm.disableAudio();
vm.delete();
console.log("PASS Q/Esc from all four scenes: visible prompt, subsequent commands, restored VIA, silent AYs");

const diskSession = await boot();
const diskVM = diskSession.vm;
const woz = buildBootableWoz(bytes, org);
assert.ok(diskVM.insertDisk(0, new Uint8Array(woz)));
diskVM.addBreakpoint(S.ENTER_SIGNAL);
diskVM.setPC(0xc600);
diskVM.runCycles(30_000_000);
assert.ok(diskVM.breakpointHit(), "the exported WOZ boots through the unmodified Disk II ROM");
diskVM.clearBreakpoints();
diskVM.addBreakpoint(S.MAIN);
diskVM.runCycles(1_000_000);
assert.ok(diskVM.breakpointHit());
assert.match(diskSession.textScreen()[20], /01 SIGNAL/);
assert.equal(diskVM.textMode(), 0);
diskVM.clearBreakpoints();
diskVM.keyDown("Q".charCodeAt(0));
const diskExit = diskSession.run({ org: S.MAIN, maxCycles: 1_000_000 });
assert.equal(diskExit.halt, "brk-monitor", "Q also exits a disk-booted demo");
assertUsableMonitor(diskSession);
diskVM.delete();
console.log("PASS hardware-path WOZ boot and Q exit");

const staged = readFileSync(join(ROOT, "web", "programs", "hackaday.s"), "utf8");
assert.equal(staged, source, "the browser runs this exact tested source");
const gallery = JSON.parse(readFileSync(join(ROOT, "web", "gallery.json"), "utf8"));
assert.equal(gallery.entries.filter(entry => entry.src === "programs/hackaday.s").length, 1);
const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");
assert.match(html, /<option value="hackaday">Built from Bits/);
const selectionStart = html.indexOf("const m = /^programs");
const selectionEnd = html.indexOf("const srcOrg =", selectionStart);
assert.ok(selectionStart !== -1 && selectionEnd > selectionStart);
const selectionCode = html.slice(selectionStart, selectionEnd);
for (const name of ["hackaday", "matrix", "unlisted"]) {
  const sampleEl = {
    value: "tut1_hello",
    options: ["tut1_hello", "hackaday", "matrix"].map(value => ({ value })),
  };
  const context = { sampleEl, srcUrl: `programs/${name}.s`, srcEl: { value: source }, loadedRef: null };
  runInNewContext(selectionCode, context);
  assert.equal(sampleEl.value, name === "unlisted" ? "tut1_hello" : name);
  assert.equal(context.loadedRef.name, name);
}
console.log("PASS gallery, staged source, and matching deep-link sample/download names");

if (process.argv.includes("--write-preview")) {
  const directory = join(ROOT, "web", "media");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "hackaday-preview.png"), previews[0]);
}
const captureArg = process.argv.indexOf("--capture-dir");
if (captureArg !== -1) {
  const directory = process.argv[captureArg + 1];
  assert.ok(directory, "--capture-dir requires a directory");
  mkdirSync(directory, { recursive: true });
  names.forEach((name, i) => writeFileSync(join(directory, `hackaday-${name}.png`), previews[i]));
}
console.log("ALL PASS");
