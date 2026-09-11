// Run after web/build.ps1: node codegen/tools/matrix.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";

const { boot } = harnessPkg;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(ROOT, "codegen", "programs", "matrix.s"), "utf8");
const { org, bytes, symbols: S } = assemble(source);
const W = 40, H = 32;
const haddr = y =>
  0x2000 + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;

assert.equal(org, 0x0800);
assert.ok(org + bytes.length <= 0x2000, "image cannot overlap hi-res memory");
assert.equal(S.COLUMN_COUNT, W);
assert.equal(S.ROW_COUNT, H);
const gallery = JSON.parse(readFileSync(join(ROOT, "web", "gallery.json"), "utf8"));
const entries = gallery.entries.filter(entry => entry.src === "programs/matrix.s");
assert.equal(entries.length, 1, "exactly one gallery entry targets the source");
assert.equal(entries[0].title, "Matrix Rain");
assert.equal(entries[0].mode, "Hi-res");
const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");
assert.match(html, /<optgroup label="Hi-res">(?:(?!<\/optgroup>)[\s\S])*<option value="matrix">Matrix Rain<\/option>/);
assert.equal(
  readFileSync(join(ROOT, "web", "programs", "matrix.s"), "utf8"),
  source,
  "the build stages the exact source used by gallery deep links and the editor",
);
console.log(`PASS source, portal entries, and staging (${bytes.length} bytes at $0800)`);

const s = await boot();
const vm = s.vm;
s.load(bytes, org);
const readBytes = (addr, length) =>
  Buffer.from(Array.from({ length }, (_, i) => vm.peek(addr + i)));
const video = () => readBytes(0x2000, 0x2000);
const state = () => Buffer.concat([
  readBytes(S.HEADS, W * 4),
  readBytes(S.GLYPHS, W * H),
  readBytes(S.SEEDLO, 2),
]);
const canaries = [0x1fff, 0x4000, 0x5fff, 0x65c0, 0x66c0, 0x6fff];
for (const addr of canaries) vm.poke(addr, 0xa5);

function runTo(stop, budget = 1_000_000) {
  vm.addBreakpoint(stop);
  const cycles = vm.runCycles(budget);
  assert.ok(vm.breakpointHit(), `execution must reach $${stop.toString(16)} within ${budget} cycles`);
  assert.equal(vm.pc(), stop);
  vm.clearBreakpoints();
  return cycles;
}

// Like rocks.test.mjs, call the real routine through a RAM trampoline, but
// stop at its return address instead of letting BRK change the display.
function call(entry, a = 0) {
  const trampoline = 0x7000;
  const code = [0xa2, 0xff, 0x9a, 0xa9, a, 0x20, entry & 0xff, entry >> 8, 0xea];
  code.forEach((byte, i) => vm.poke(trampoline + i, byte));
  vm.clearBreakpoints();
  vm.setPC(trampoline);
  return runTo(trampoline + 8);
}

function start() {
  vm.clearBreakpoints();
  vm.setPC(S.START);
  return runTo(S.MAIN);
}

function frame() {
  vm.setPC(S.MAIN);
  vm.step();
  return runTo(S.MAIN, 150_000);
}

function draw(col, row, glyph, shade) {
  vm.poke(S.COLUMN, col);
  call(S.SET_COLUMN);
  if (row < H) vm.poke(S.GLYPHS + col * H + row, glyph);
  vm.poke(S.SHADE, shade);
  call(S.DRAW_CELL, row);
}

function expectedCell(col, glyph, shade) {
  return Array.from({ length: 6 }, (_, line) => {
    if (shade === S.ERASE_SHADE) return 0;
    let bits = bytes[S.FONT - org + glyph * 8 + line];
    if (shade === S.DIM_SHADE) bits &= line % 2 ? 2 : 5;
    let pixels = 0;
    for (let dot = 0; dot < 3; dot++) {
      if (!(bits & (1 << (2 - dot)))) continue;
      pixels |= shade === S.HEAD_SHADE
        ? 3 << (dot * 2)
        : 1 << (dot * 2 + (col % 2 ? 0 : 1));
    }
    return pixels;
  });
}

function assertCell(col, row, glyph, shade) {
  const actual = Array.from({ length: 6 }, (_, line) => vm.peek(haddr(row * 6 + line) + col));
  assert.deepEqual(actual, expectedCell(col, glyph, shade), `column ${col}, row ${row}, shade ${shade}`);
}

const startupCycles = start();
assert.equal(vm.textMode(), 0);
assert.equal(vm.lores(), 0);
assert.equal(vm.mixed(), 0);
assert.equal(vm.gfxPage(), 0);
assert.equal(vm.peek(S.PAUSED), 0);
for (let y = 0; y < 192; y++) {
  assert.equal(vm.peek(S.ROWL + y) | (vm.peek(S.ROWH + y) << 8), haddr(y));
}
for (let col = 0; col < W; col++) {
  const head = vm.peek(S.HEADS + col), length = vm.peek(S.LENGTHS + col);
  const period = vm.peek(S.PERIODS + col);
  assert.ok(head >= 1 && head <= H);
  assert.ok(length >= 8 && length <= 23);
  assert.ok(period >= 2 && period <= 5);
  assert.equal(vm.peek(S.TICKS + col), period);
  for (let row = 0; row < H; row++) {
    const distance = head - row;
    const shade = distance < 1 || distance > length ? S.ERASE_SHADE
      : distance === 1 ? S.HEAD_SHADE
      : distance >= length - 1 ? S.DIM_SHADE : S.GREEN_SHADE;
    const glyph = vm.peek(S.GLYPHS + col * H + row);
    if (shade !== S.ERASE_SHADE) assert.ok(glyph < 32);
    assertCell(col, row, glyph, shade);
  }
}
assert.ok(new Set(readBytes(S.HEADS, W)).size >= 16, "starting heads are staggered");
assert.equal(new Set(readBytes(S.PERIODS, W)).size, 4, "all four falling speeds occur");
console.log(`PASS initialized trails, color phases, scanline addresses, and startup (${startupCycles} cycles)`);

{
  const fb = vm.renderFrame();
  let green = 0, white = 0, black = 0;
  for (let i = 0; i < fb.length; i += 4) {
    const [r, g, b] = fb.subarray(i, i + 3);
    if (g > r && g > b) green++;
    if (r === 255 && g === 255 && b === 255) white++;
    if (r === 0 && g === 0 && b === 0) black++;
  }
  assert.ok(green > 3000 && green > white, "the actual framebuffer has predominantly green trails");
  assert.ok(white > 100, "the actual framebuffer has white heads");
  assert.ok(black > fb.length / 8, "more than half the screen remains black");
  console.log(`PASS rendered green rain and white heads (${green} green / ${white} white pixels)`);
}

// Exercise the full font and all 32 rows, including both edges and byte parities.
call(S.CLEAR_HGR);
for (const col of [0, 1, 38, 39]) {
  for (let row = 0; row < H; row++) {
    for (const shade of [S.HEAD_SHADE, S.GREEN_SHADE, S.DIM_SHADE, S.ERASE_SHADE]) {
      draw(col, row, row, shade);
      assertCell(col, row, row, shade);
    }
  }
}
assert.ok(video().every(byte => byte === 0), "glyph updates leave no pixels in neighboring cells");
for (const row of [32, 33, 54, 127, 254, 255]) {
  for (const col of [0, 39]) {
    draw(col, row, 8, S.HEAD_SHADE);
    call(S.NEW_GLYPH, row);
  }
}
assert.ok(video().every(byte => byte === 0), "off-screen heads and tails never wrap");
console.log("PASS glyph rendering, fading, erasure, and top/bottom/left/right boundaries");

{
  let seed = 0xace1;
  vm.poke(S.SEEDLO, seed & 0xff);
  vm.poke(S.SEEDHI, seed >> 8);
  const glyphs = new Set();
  for (let i = 0; i < 256; i++) {
    seed = (seed >>> 1) ^ (seed & 1 ? 0xb400 : 0);
    call(S.RNG);
    assert.equal(vm.peek(S.SEEDLO) | (vm.peek(S.SEEDHI) << 8), seed);
    assert.equal(vm.regA(), (seed & 0xff) ^ (seed >> 8));
    glyphs.add(vm.regA() & 31);
  }
  assert.equal(glyphs.size, 32);
  console.log("PASS 16-bit randomness and the full glyph repertoire");
}

{
  const col = 7, glyph = 8;
  for (let c = 0; c < W; c++) vm.poke(S.TICKS + c, 250);
  vm.poke(S.HEADS + col, 10);
  vm.poke(S.LENGTHS + col, 8);
  vm.poke(S.PERIODS + col, 2);
  vm.poke(S.TICKS + col, 1);
  for (let row = 2; row < 10; row++) {
    draw(col, row, glyph, row === 9 ? S.HEAD_SHADE : row < 4 ? S.DIM_SHADE : S.GREEN_SHADE);
  }
  call(S.STEP_RAIN);
  assert.equal(vm.peek(S.HEADS + col), 11, "a due column moves exactly one row downward");
  assert.equal(vm.peek(S.TICKS + col), 2);
  assertCell(col, 2, glyph, S.ERASE_SHADE);
  assertCell(col, 4, glyph, S.DIM_SHADE);
  assertCell(col, 9, glyph, S.GREEN_SHADE);
  assertCell(col, 10, vm.peek(S.GLYPHS + col * H + 10), S.HEAD_SHADE);
  const before = video();
  call(S.STEP_RAIN);
  assert.equal(vm.peek(S.HEADS + col), 11, "a column waits for its own timer");
  assert.deepEqual(video(), before);
  call(S.STEP_RAIN);
  assert.equal(vm.peek(S.HEADS + col), 12);

  call(S.CLEAR_HGR);
  vm.poke(S.HEADS + col, H + 8 - 1);
  vm.poke(S.TICKS + col, 1);
  draw(col, H - 1, glyph, S.DIM_SHADE);
  call(S.STEP_RAIN);
  assert.ok(video().every(byte => byte === 0), "the last tail cell is erased before restarting");
  assert.equal(vm.peek(S.HEADS + col), 0);
  const gap = vm.peek(S.TICKS + col);
  assert.ok(gap >= 4 && gap <= 19);
  for (let i = 1; i < gap; i++) {
    call(S.STEP_RAIN);
    assert.equal(vm.peek(S.HEADS + col), 0);
    assert.ok(video().every(byte => byte === 0), "the inter-stream gap stays empty");
  }
  call(S.STEP_RAIN);
  assert.equal(vm.peek(S.HEADS + col), 1);
  assertCell(col, 0, vm.peek(S.GLYPHS + col * H), S.HEAD_SHADE);
  console.log("PASS independent timers, falling direction, full-tail drain, and restart gaps");
}

start();
{
  const initial = video();
  const restarts = new Set();
  let worstFrame = 0;
  for (let i = 0; i < 500; i++) {
    const heads = readBytes(S.HEADS, W);
    worstFrame = Math.max(worstFrame, frame());
    for (let col = 0; col < W; col++) {
      const head = vm.peek(S.HEADS + col), length = vm.peek(S.LENGTHS + col);
      const period = vm.peek(S.PERIODS + col), ticks = vm.peek(S.TICKS + col);
      assert.ok(head < H + length && length >= 8 && length <= 23);
      assert.ok(period >= 2 && period <= 5 && ticks >= 1 && ticks <= 19);
      if (head < heads[col]) restarts.add(col);
    }
  }
  assert.equal(restarts.size, W, "every column survives repeated complete falls");
  assert.notDeepEqual(video(), initial, "the live program continues animating");
  assert.ok(worstFrame < 150_000, "incremental animation stays bounded at native speed");
  assert.equal(vm.peek(S.KBD) & 0x80, 0);
  console.log(`PASS sustained animation and all column restarts (worst frame ${worstFrame} cycles)`);
}

{
  vm.keyDown(0x20);
  frame();
  assert.equal(vm.peek(S.PAUSED), 1);
  const frozenVideo = video(), frozenState = state();
  for (let i = 0; i < 20; i++) frame();
  vm.keyDown(0x41);
  frame();
  assert.equal(vm.peek(S.KBD) & 0x80, 0, "unhandled keys are consumed");
  assert.deepEqual(video(), frozenVideo, "pause freezes the pixels");
  assert.deepEqual(state(), frozenState, "pause freezes glyphs, timers, and RNG");
  vm.keyDown(0x20);
  frame();
  assert.equal(vm.peek(S.PAUSED), 0);
  assert.notDeepEqual(state(), frozenState, "resume advances the existing streams");

  assert.deepEqual(readBytes(org, S.HEADS - org), Buffer.from(bytes.subarray(0, S.HEADS - org)));
  for (const addr of canaries) assert.equal(vm.peek(addr), 0xa5, `memory guard $${addr.toString(16)} intact`);
  console.log("PASS pause/resume, keyboard strobe handling, and code/memory guards");
}

for (const key of [0x51, 0x1b]) {
  start();
  vm.keyDown(0x20);
  frame();
  vm.keyDown(key);
  const result = s.run({ org: S.MAIN, maxCycles: 500_000, chunk: 25_000 });
  assert.equal(result.halt, "brk-monitor", `key $${key.toString(16)} quits even while paused`);
  assert.equal(vm.textMode(), 1);
  assert.equal(vm.gfxPage(), 0);
  assert.equal(vm.mixed(), 0);
  assert.equal(vm.lores(), 1);
  // The harness stops at the register dump, before the ROM's bell finishes.
  vm.runCycles(1_000_000);
  assert.ok(s.textScreen().some(row => row.includes("*")), "the monitor prompt is visible");
}
vm.delete();
console.log("PASS Q/Esc restore the text monitor\n\nALL MATRIX RAIN TESTS PASSED");
