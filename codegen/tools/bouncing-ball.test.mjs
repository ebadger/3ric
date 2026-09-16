// Run after web\build.ps1: node codegen\tools\bouncing-ball.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildBootableWoz } from "./wozgen.mjs";
import harnessPkg from "./harness.cjs";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const source = readFileSync(join(ROOT, "web", "programs", "bouncing-ball.s"), "utf8");
const { org, bytes, symbols: S } = assemble(source);
const baseline = JSON.parse(readFileSync(join(HERE, "fixtures", "bouncing-ball-baseline.json"), "utf8"));
const hash = data => createHash("sha256").update(data).digest("hex");
const signed = value => value < 128 ? value : value - 256;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const haddr = y => (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;
const imageData = (name, count) => Array.from(bytes.subarray(S[name] - org, S[name] - org + count));
const vx = imageData("VERTX", 114).map(signed);
const vy = imageData("VERTY", 114).map(signed);
const vz = imageData("VERTZ", 114).map(signed);
const sin = imageData("SINTBL", 64).map(signed);
const cos = imageData("COSTBL", 64).map(signed);
const faces = imageData("FACET", 512);
const edges = imageData("EDGES", 960);

assert.equal(org, 0x0800);
assert.ok(org + bytes.length <= 0x2000, "the entire raw image stays below hi-res page 1");
assert.equal(S.XLEFTMASK % 256, 0);
assert.equal(S.XRIGHTMASK % 256, 0);
assert.equal(S.ROOM, 0x7000);
assert.equal(S.ROOM + 0x2000, 0x9000, "the cache ends before BASIC ROM");
assert.equal(S.NVERT0, 114);
assert.equal(S.NFACE0, 128);
assert.equal(S.NEDGE0, 240);
assert.ok(S.XMINB0 >= 40 && S.XMAXB0 + 40 <= 255);
assert.ok(S.YMINB0 >= 40 && S.YMAXB0 + 40 < 192);
assert.equal(baseline.frames.length, 128);
assert.equal(baseline.sourceCommit, "fc4d46e6b8ba9d83ab09cc7d2e1c175772594ea1");
const gallery = JSON.parse(readFileSync(join(ROOT, "web", "gallery.json"), "utf8"));
const entries = gallery.entries.filter(entry => entry.src === "programs/bouncing-ball.s");
assert.equal(entries.length, 1);
assert.equal(entries[0].author, "scottybe");
assert.equal(entries[0].authorUrl, "https://github.com/scottybe");
assert.equal(entries[0].mode, "Hi-res");
assert.doesNotMatch(entries[0].description, /max speed/i);
const workflow = readFileSync(join(ROOT, ".github", "workflows", "deploy-pages.yml"), "utf8");
assert.match(workflow, /^\s+node codegen\/tools\/bouncing-ball\.test\.mjs\s*$/m);
assert.ok(workflow.includes("'codegen/tools/bouncing-ball.test.mjs'"));
assert.ok(workflow.includes("'codegen/tools/fixtures/bouncing-ball-baseline.json'"));
console.log(`PASS standalone image and community attribution (${bytes.length} bytes at $0800)`);

const s = await boot();
const vm = s.vm;
s.load(bytes, org);
const readBytes = (address, length, machine = vm) =>
  Buffer.from(Array.from({ length }, (_, i) => machine.peek(address + i)));
const video = (page, machine = vm) => readBytes(0x2000 + page * 0x2000, 0x2000, machine);

function runTo(stop, budget = 1_000_000, machine = vm) {
  machine.addBreakpoint(stop);
  const cycles = machine.runCycles(budget);
  assert.ok(machine.breakpointHit(), `must reach $${stop.toString(16)} within ${budget} cycles`);
  assert.equal(machine.pc(), stop);
  machine.clearBreakpoints();
  return cycles;
}

function start() {
  vm.clearBreakpoints();
  vm.setPC(S.START);
  return runTo(S.MAINLP);
}

function frame(machine = vm) {
  assert.equal(machine.pc(), S.MAINLP);
  const first = machine.run(1);
  return first + runTo(S.MAINLP, 520_000, machine);
}

// The monitor input buffer is outside the app, its tables, and both video pages.
function call(entry, a = 0, x = 0) {
  const trampoline = 0x0200;
  vm.loadData(trampoline, Uint8Array.from([
    0xa2, 0xff, 0x9a, 0xa9, a & 255, 0xa2, x & 255,
    0x20, entry & 255, entry >> 8, 0xea,
  ]));
  vm.setPC(trampoline);
  const cycles = runTo(trampoline + 10);
  assert.equal(vm.sp(), 0xff, "routine balances the stack");
  return cycles;
}

const protectedRanges = [
  [0x0000, 6], [0x0010, 0x40], [0x00b0, 0x50], [0x0400, 0x400],
  [org + bytes.length, 0x2000 - org - bytes.length], [0x9000, 0x3000],
];
const protectedBytes = protectedRanges.map(([address, length]) => readBytes(address, length));
const startupCycles = start();
assert.ok(startupCycles < 600_000);
assert.equal(vm.textMode(), 0);
assert.equal(vm.lores(), 0);
assert.equal(vm.mixed(), 0);
assert.equal(vm.gfxPage(), 0);
assert.equal(hash(video(0)), baseline.backgroundSha256);
assert.deepEqual(video(1), video(0), "both initial pages contain the same room");
const room = readBytes(S.ROOM, 0x2000);
assert.deepEqual(room, video(0));
for (let y = 0; y < 192; y++) {
  assert.equal(vm.peek(S.ROWL + y) | (vm.peek(S.ROWH + y) << 8), 0x2000 + haddr(y));
}
for (let x = 0; x < 256; x++) {
  assert.equal(vm.peek(S.XCOL + x), Math.floor(x / 7));
  assert.equal(vm.peek(S.XBIT + x), x % 7);
  assert.equal(vm.peek(S.XLEFTMASK + x), (0x7f << (x % 7)) & 0x7f);
  assert.equal(vm.peek(S.XRIGHTMASK + x), (1 << (x % 7 + 1)) - 1);
  assert.equal(vm.peek(S.QSLO + x) | (vm.peek(S.QSHI + x) << 8), Math.floor(x * x / 4));
}
console.log(`PASS exact room, initialized lookup tables, and startup (${startupCycles} cycles)`);

function move(state) {
  state.vy++;
  state.x += state.vx;
  state.y += state.vy;
  if (state.x < 44) { state.x = 44; state.vx = -state.vx; }
  else if (state.x >= 211) { state.x = 211; state.vx = -state.vx; }
  if (state.y < 44) { state.y = 44; state.vy = 0; }
  else if (state.y >= 145) { state.y = 145; state.vy = -15; }
  state.ax = (state.ax + 1) % 64;
  state.ay = (state.ay + 1) % 64;
}

function assertMotion(state) {
  for (const [label, value] of Object.entries({
    BPOSX: state.x, BPOSY: state.y, BVELX: state.vx, BVELY: state.vy,
    ANGX: state.ax, ANGY: state.ay,
  })) assert.equal(vm.peek(S[label]), value & 255, label);
}

const state = { x: 140, y: 145, vx: 4, vy: -15, ax: 0, ay: 12 };
let originalTotal = 0, optimizedTotal = 0, worstFrame = 0, worstRatio = Infinity;
const reached = new Set();
for (const [i, original] of baseline.frames.entries()) {
  const cycles = frame();
  move(state);
  assertMotion(state);
  assert.equal(vm.gfxPage(), (i + 1) % 2);
  assert.equal(vm.peek(S.DRAWPG), 1 - vm.gfxPage());
  assert.equal(hash(video(vm.gfxPage())), original.sha256, `original pixels at frame ${i + 1}`);
  assert.ok(cycles * 9 <= original.cycles, `frame ${i + 1} is at least nine times faster`);
  originalTotal += original.cycles;
  optimizedTotal += cycles;
  worstFrame = Math.max(worstFrame, cycles);
  worstRatio = Math.min(worstRatio, original.cycles / cycles);
  if ([44, 211].includes(state.x)) reached.add(`x${state.x}`);
  if ([44, 145].includes(state.y)) reached.add(`y${state.y}`);
}
assert.ok(optimizedTotal * 10 <= originalTotal, "mean frame cost is at least ten times lower");
assert.ok(worstFrame <= 520_000);
assert.equal(reached.size, 4, "both walls, apex, and floor were exercised");
assert.deepEqual(readBytes(S.ROOM, 0x2000), room, "room cache is immutable");
assert.deepEqual(readBytes(org, S.XLEFTMASK - org), Buffer.from(bytes.subarray(0, S.XLEFTMASK - org)),
  "execution does not change code, geometry, or trigonometry data");
protectedRanges.forEach(([address, length], i) =>
  assert.deepEqual(readBytes(address, length), protectedBytes[i], `protected memory at $${address.toString(16)}`));
console.log(`PASS 128 pixel-identical frames, bounces, page flips, and memory boundaries: ` +
  `${(originalTotal / optimizedTotal).toFixed(2)}x mean / ${worstRatio.toFixed(2)}x minimum, ` +
  `${Math.round(optimizedTotal / 128)} mean / ${worstFrame} worst cycles`);

// All legal centers include both 12- and 13-byte rectangles, including column 0.
const restoreRows = [0, 7, 63, 64, 127, 191];
for (const page of [0, 1]) {
  for (let x = S.XMINB0; x <= S.XMAXB0; x++) {
    const lo = Math.floor((x - 40) / 7), hi = Math.floor((x + 40) / 7);
    const min = restoreRows[(x - S.XMINB0) % restoreRows.length], max = Math.min(min + 2, 191);
    assert.ok([12, 13].includes(hi - lo + 1));
    const expected = Buffer.alloc(0x2000, 0xaa), other = Buffer.alloc(0x2000, 0x55);
    vm.loadData(0x2000 + page * 0x2000, expected);
    vm.loadData(0x2000 + (1 - page) * 0x2000, other);
    vm.poke(S.BPOSX, x);
    vm.poke(S.BBYMIN, min);
    vm.poke(S.BBYMAX, max);
    vm.poke(S.DRAWPG, page);
    vm.poke(S.PGOFF, page * 0x20);
    call(S.SAVE_BBOX);
    call(S.CLEAR_BBOX);
    for (let row = min; row <= max; row++) {
      for (let col = lo; col <= hi; col++) expected[haddr(row) + col] = room[haddr(row) + col];
    }
    assert.deepEqual(video(page), expected, `exact restore at center ${x}, page ${page}`);
    assert.deepEqual(video(1 - page), other, "restore never changes the other page");
  }
}
console.log("PASS every restore width/alignment, row-bank transitions, and both page boundaries");

// Exhaust all signed-byte products, including -128 * -128 (quarter-square index 256).
for (let a = -128; a <= 127; a++) {
  for (let b = -128; b <= 127; b++) {
    call(S.SMUL16, a, b);
    assert.equal(vm.peek(S.RESL) | (vm.peek(S.RESH) << 8), (a * b) & 0xffff, `${a} * ${b}`);
  }
}
console.log("PASS all 65,536 signed multiply inputs");

function geometry(ax, ay, centerX = 140, centerY = 96) {
  const mul = (a, b) => Math.trunc(a * b / 128);
  const rx = vx.map((v, i) => mul(v, cos[ay]) - mul(vz[i], sin[ay]));
  const z = vx.map((v, i) => mul(v, sin[ay]) + mul(vz[i], cos[ay]));
  const ry = vy.map((v, i) => mul(v, cos[ax]) - mul(z[i], sin[ax]));
  const px = rx.map(v => clamp(centerX + v, 0, 255));
  const py = ry.map(v => clamp(centerY - v, 0, 191));
  const visible = Array.from({ length: 128 }, (_, f) => {
    const [a, b, c] = faces.slice(f * 4, f * 4 + 3);
    return Number((rx[b] - rx[a]) * (ry[c] - ry[a]) - (ry[b] - ry[a]) * (rx[c] - rx[a]) > 0);
  });
  return { rx, ry, z, px, py, visible };
}

// Vary the axes independently: a replay of the demo's 64 poses cannot pass.
vm.poke(S.BPOSX, 140);
vm.poke(S.BPOSY, 96);
for (let ax = 0; ax < 64; ax++) {
  for (let ay = 0; ay < 64; ay++) {
    const expected = geometry(ax, ay);
    assert.ok([...expected.rx, ...expected.ry, ...expected.z].every(v => Math.abs(v) <= 40),
      "all lookup coordinates and restore bounds fit the sphere's radius");
    vm.poke(S.ANGX, ax);
    vm.poke(S.ANGY, ay);
    call(S.XFORM);
    call(S.CALCVIS);
    for (const [name, values] of [
      ["RX", expected.rx], ["RY", expected.ry], ["PX", expected.px],
      ["PY", expected.py], ["FVIS", expected.visible],
    ]) assert.deepEqual(readBytes(S[name], values.length), Buffer.from(values.map(v => v & 255)),
      `${name} at independent angles ${ax}, ${ay}`);
  }
}
console.log("PASS all 4,096 independent angle pairs and exact face-visibility signs");

for (const centerX of [S.XMINB0, S.XMAXB0]) {
  for (const centerY of [S.YMINB0, S.YMAXB0]) {
    vm.poke(S.BPOSX, centerX);
    vm.poke(S.BPOSY, centerY);
    for (let angle = 0; angle < 64; angle++) {
      const ax = angle, ay = (angle + 12) % 64;
      const expected = geometry(ax, ay, centerX, centerY);
      vm.poke(S.ANGX, ax);
      vm.poke(S.ANGY, ay);
      call(S.XFORM);
      assert.deepEqual(readBytes(S.PX, 114), Buffer.from(expected.px));
      assert.deepEqual(readBytes(S.PY, 114), Buffer.from(expected.py));
      assert.ok(expected.rx.every(v => centerX + v >= 0 && centerX + v <= 255));
      assert.ok(expected.ry.every(v => centerY - v >= 0 && centerY - v < 192));
    }
  }
}
console.log("PASS unclipped projection at all four extreme ball positions");

function setPixel(page, x, y, ink = 1) {
  const offset = haddr(y) + Math.floor(x / 7), mask = 1 << (x % 7);
  page[offset] = ink ? page[offset] | mask : page[offset] & ~mask;
}

function referenceLine(page, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x1 >= x0 ? 1 : -1, sy = y1 >= y0 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    setPixel(page, x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

let random = 0x12345678;
function rng() {
  random ^= random << 13;
  random ^= random >>> 17;
  random ^= random << 5;
  return random >>> 0;
}
const lines = [
  [0, 0, 255, 191], [255, 0, 0, 191], [0, 191, 255, 0], [255, 191, 0, 0],
  [0, 0, 255, 0], [255, 191, 0, 191], [0, 0, 0, 191], [255, 191, 255, 0],
  [0, 0, 0, 0], [255, 191, 255, 191],
];
for (let i = 0; i < 512; i++) lines.push([rng() % 256, rng() % 192, rng() % 256, rng() % 192]);
for (const [i, line] of lines.entries()) {
  const page = i % 2, expected = Buffer.alloc(0x2000, 0x80);
  vm.loadData(0x2000 + page * 0x2000, expected);
  vm.poke(S.PGOFF, page * 0x20);
  vm.poke(S.INK, 1);
  ["X0", "Y0", "X1", "Y1"].forEach((name, j) => vm.poke(S[name], line[j]));
  call(S.LINE);
  referenceLine(expected, ...line);
  assert.deepEqual(video(page), expected, `Bresenham endpoints/ties ${line}`);
}
console.log("PASS line octants, ties, byte edges, both pages, and artifact-phase preservation");

function referenceFill(page, polygon, ink) {
  const min = Math.min(...polygon.map(p => p[1])), max = Math.max(...polygon.map(p => p[1]));
  for (let row = min; row <= max; row++) {
    let left = 255, right = 0;
    for (let edge = 0; edge < polygon.length; edge++) {
      let [x0, y0] = polygon[edge], [x1, y1] = polygon[(edge + 1) % polygon.length];
      if (y0 === y1) continue;
      if (y0 > y1) [x0, y0, x1, y1] = [x1, y1, x0, y0];
      if (row < y0 || row > y1) continue;
      const x = x0 + Math.trunc((row - y0) * (x1 - x0) / (y1 - y0));
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
    if (left === 255) continue;
    for (let x = left; x <= right; x++) setPixel(page, x, row, ink);
  }
}

const polygons = [
  [[0, 0], [0, 20], [20, 20], [20, 0]],
  [[235, 171], [255, 171], [255, 191], [235, 191]],
  [[0, 0], [14, 30], [30, 0]],
  [[1, 0], [0, 0], [0, 1]],
  [[40, 40], [60, 40], [50, 40]],
  [[140, 58], [140, 59], [145, 59], [151, 60]],
  [[100, 80], [108, 86], [105, 83], [110, 80]],
];
for (const [ax, ay] of [[0, 12], [6, 8], [2, 1], [17, 29], [31, 43], [48, 9]]) {
  const pose = geometry(ax, ay);
  for (let f = 0; f < 128; f++) {
    if (!pose.visible[f]) continue;
    const ids = faces.slice(f * 4, f * 4 + 4);
    if (ids[2] === ids[3]) ids.pop();
    polygons.push(ids.map(i => [pose.px[i], pose.py[i]]));
  }
}
for (const [i, polygon] of polygons.entries()) {
  for (const ink of [0, 1]) {
    const page = (i + ink) % 2;
    const expected = Buffer.from(Array.from({ length: 0x2000 }, (_, n) => (n * 37 + i * 19) & 255));
    vm.loadData(0x2000 + page * 0x2000, expected);
    vm.poke(S.PGOFF, page * 0x20);
    vm.poke(S.INK, ink);
    vm.poke(S.NVRT, polygon.length);
    for (const [j, [x, y]] of polygon.entries()) {
      vm.poke(S.FSX + j, x);
      vm.poke(S.FSY + j, y);
    }
    call(S.FILLPOLY);
    referenceFill(expected, polygon, ink);
    assert.deepEqual(video(page), expected, `opaque polygon ${i}, ink ${ink}`);
  }
}
assert.deepEqual(readBytes(S.ROOM, 0x2000), room);
console.log("PASS opaque polygons, inclusive edges, thin-quad fallback, clipping bounds, and both inks");

function checkerInk(face) {
  if (face < 16) return (face & 1) ^ 1;
  if (face >= 112) return (face - 112) & 1;
  const cell = face - 16;
  return ((cell >> 4) + (cell & 15)) & 1;
}

for (let i = 0; i < 512; i++) {
  const ax = i % 64, ay = (Math.floor(i / 64) * 7 + ax * 11) % 64;
  const centerX = i % 4 < 2 ? S.XMINB0 : S.XMAXB0;
  const centerY = i % 4 & 1 ? S.YMINB0 : S.YMAXB0;
  const page = (i >> 2) & 1, pose = geometry(ax, ay, centerX, centerY);
  const expected = Buffer.from(Array.from({ length: 0x2000 }, (_, n) => (n * 37 + i * 19) & 255));
  vm.loadData(0x2000 + page * 0x2000, expected);
  for (const [name, value] of Object.entries({
    ANGX: ax, ANGY: ay, BPOSX: centerX, BPOSY: centerY, PGOFF: page * 0x20,
  })) vm.poke(S[name], value);
  call(S.XFORM);
  call(S.CALCVIS);
  call(S.FILLSOLID);
  vm.poke(S.INK, 1);
  call(S.DRAWMESH);
  for (let face = 0; face < 128; face++) {
    if (!pose.visible[face]) continue;
    const ids = faces.slice(face * 4, face * 4 + 4);
    if (ids[2] === ids[3]) ids.pop();
    referenceFill(expected, ids.map(v => [pose.px[v], pose.py[v]]), checkerInk(face));
  }
  for (let edge = 0; edge < edges.length; edge += 4) {
    const [a, b, fa, fb] = edges.slice(edge, edge + 4);
    if (pose.visible[fa] || pose.visible[fb]) {
      referenceLine(expected, pose.px[a], pose.py[a], pose.px[b], pose.py[b]);
    }
  }
  assert.deepEqual(video(page), expected, `complete independent raster at angles ${ax},${ay}, case ${i}`);
}
console.log("PASS 512 independent complete rasters, extreme centers, and arbitrary background/phase bits");

start();
const restarted = frame();
assert.equal(hash(video(vm.gfxPage())), baseline.frames[0].sha256, "restart discards all previous page history");
assert.ok(restarted * 9 <= baseline.frames[0].cycles);
for (const key of [0x41, 0x20, 0x1b]) {
  start();
  vm.keyDown(key);
  const result = s.run({ org: S.MAINLP, maxCycles: 1_000_000, chunk: 50_000 });
  assert.equal(result.halt, "brk-monitor");
  assert.equal(vm.peek(0xc000) & 0x80, 0, "exit acknowledges the keyboard strobe");
}
console.log("PASS restart and the original any-key BRK exit");

const disk = await boot();
const diskVM = disk.vm;
const woz = buildBootableWoz(bytes, org, org);
assert.ok(diskVM.insertDisk(0, woz));
assert.ok(diskVM.diskPresent(0));
diskVM.setPC(0xc600);
const diskCycles = runTo(S.START, 20_000_000, diskVM);
assert.deepEqual(readBytes(org, bytes.length, diskVM), Buffer.from(bytes), "ROM disk boot loads the entire raw image");
runTo(S.MAINLP, 600_000, diskVM);
frame(diskVM);
assert.equal(hash(video(diskVM.gfxPage(), diskVM)), baseline.frames[0].sha256);
console.log(`PASS standalone bootable WOZ via the real $C600 ROM (${diskCycles} boot cycles)`);
