// life.test.mjs — cross-checks emulator/AICodeGen/life/life.s against a JS reference.
//
//   A) RNG / seed field : the 6502 seed_brk hook vs an identical JS LFSR.
//   B) Rules + wrap      : onestep_brk vs a JS reference Life on a random torus.
//   C) Glider wrap       : a lone glider must stay intact and translate
//                          uniformly, including across the torus edges
//                          (reference-free ground truth for rules + wrapping).
//   D) Full run smoke    : start -> hi-res on, ~50% seed density, evolution,
//                          and a SPACE press reseeds the field.
//
// Run:  node codegen/tools/life.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "life", "life.s");

const W = 40, H = 48, STRIDE = 42;
const bufIndex = (r, c) => r * STRIDE + c;        // r,c are 1-based inside the padded buffer

let failures = 0;
const ok = (cond, msg) => { if (cond) { console.log("  PASS " + msg); } else { console.log("  FAIL " + msg); failures++; } };

// --- JS reference LFSR (matches lsr seedH / ror seedL / eor #$B4) -----------
function rngStep(v) { const carry = v & 1; v = v >>> 1; if (carry) v ^= 0xB400; return v & 0xFFFF; }

function refSeed(seed) {
  const g = new Uint8Array(H * W);
  let v = seed, k = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { v = rngStep(v); g[k++] = v & 1; }
  return g;
}

// --- JS reference Life step with toroidal wrap ------------------------------
function refStep(g) {
  const n = new Uint8Array(H * W);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    let cnt = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = (r + dr + H) % H, cc = (c + dc + W) % W;
      cnt += g[rr * W + cc];
    }
    n[r * W + c] = (cnt === 3 || (cnt === 2 && g[r * W + c])) ? 1 : 0;
  }
  return n;
}

function gridsEqual(a, b) { for (let i = 0; i < a.length; i++) if ((a[i] & 1) !== (b[i] & 1)) return false; return true; }

// --- VM helpers -------------------------------------------------------------
function pokeWord(vm, zp, val) { vm.poke(zp, val & 0xFF); vm.poke(zp + 1, (val >> 8) & 0xFF); }
function pokeGrid(vm, base, g) { for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) vm.poke(base + bufIndex(r + 1, c + 1), g[r * W + c] & 1); }
function peekGrid(vm, base) { const g = new Uint8Array(H * W); for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) g[r * W + c] = vm.peek(base + bufIndex(r + 1, c + 1)) & 1; return g; }
function zeroBuf(vm, base) { for (let i = 0; i < STRIDE * (H + 2); i++) vm.poke(base + i, 0); }

// --- main -------------------------------------------------------------------
const src = readFileSync(SRC, "utf8");
const { org, bytes, symbols: S } = assemble(src);
console.log(`assembled life.s: ${bytes.length} bytes @ $${org.toString(16)}  (ends $${(org + bytes.length).toString(16)})`);

const s = await boot();
const vm = s.vm;
s.load(bytes, org);

function runHook(entry, label) {
  const r = s.run({ org: entry, maxCycles: 6_000_000, chunk: 200_000 });
  if (r.halt !== "brk-monitor") throw new Error(`${label}: expected BRK halt, got ${r.halt} after ${r.cycles} cycles`);
  return r;
}

// ===== A) RNG / seed field ==================================================
console.log("A) seed field vs JS LFSR");
pokeWord(vm, S.CURBASE, S.CUR0);
pokeWord(vm, S.SEEDL, S.SEED0);
runHook(S.SEED_BRK, "seed_brk");
{
  const got = peekGrid(vm, S.CUR0);
  const ref = refSeed(S.SEED0);
  const alive = got.reduce((a, b) => a + b, 0);
  ok(gridsEqual(got, ref), "6502 seed matches reference LFSR field");
  ok(alive > H * W * 0.4 && alive < H * W * 0.6, `seed density ~50% (alive=${alive}/${H * W})`);
}

// ===== B) rules + wrap vs reference Life ====================================
console.log("B) rules + wrap vs reference Life (8 generations on a random torus)");
{
  let g = refSeed(0xBEEF);
  let cur = S.CUR0, nxt = S.NXT0, all = true;
  zeroBuf(vm, S.CUR0); zeroBuf(vm, S.NXT0);
  pokeGrid(vm, cur, g);
  for (let gen = 1; gen <= 8; gen++) {
    pokeWord(vm, S.CURBASE, cur); pokeWord(vm, S.NXTBASE, nxt);
    runHook(S.ONESTEP_BRK, `onestep gen ${gen}`);
    const got = peekGrid(vm, nxt);
    const exp = refStep(g);
    if (!gridsEqual(got, exp)) { all = false; console.log(`    mismatch at gen ${gen}`); }
    g = exp;
    [cur, nxt] = [nxt, cur];   // freshest generation is now at `cur`
  }
  ok(all, "6502 evolution matches reference Life every generation (incl. edge wrap)");
}

// ===== C) glider on a torus: intact + uniform translation across edges ======
console.log("C) lone glider stays intact and translates uniformly across wraps");
{
  const gliderOffs = [[0, 1], [1, 2], [2, 0], [2, 1], [2, 2]];   // canonical SE glider
  const r0 = 44, c0 = 36;                                        // near bottom-right -> wraps fast
  const key = (r, c) => `${((r % H) + H) % H},${((c % W) + W) % W}`;
  const G0 = new Set(gliderOffs.map(([dr, dc]) => key(r0 + dr, c0 + dc)));
  const translate = (base, dr, dc) => new Set([...base].map(s => { const [r, c] = s.split(",").map(Number); return key(r + dr, c + dc); }));
  const setEq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  const liveSet = (g) => { const set = new Set(); for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (g[r * W + c]) set.add(`${r},${c}`); return set; };

  const g0 = new Uint8Array(H * W);
  for (const [dr, dc] of gliderOffs) g0[((r0 + dr) % H) * W + ((c0 + dc) % W)] = 1;
  zeroBuf(vm, S.CUR0); zeroBuf(vm, S.NXT0);
  pokeGrid(vm, S.CUR0, g0);

  let cur = S.CUR0, nxt = S.NXT0;
  let dr = null, dc = null, intact = true, uniform = true, wrapped = false;
  const GENS = 200;
  for (let gen = 1; gen <= GENS; gen++) {
    pokeWord(vm, S.CURBASE, cur); pokeWord(vm, S.NXTBASE, nxt);
    runHook(S.ONESTEP_BRK, `glider gen ${gen}`);
    [cur, nxt] = [nxt, cur];
    if (gen % 4 !== 0) continue;
    const k = gen / 4;
    const live = liveSet(peekGrid(vm, cur));
    if (live.size !== 5) { intact = false; continue; }
    if (dr === null) {                                   // learn the per-4-gen translation
      let found = null;
      for (let a = -2; a <= 2 && !found; a++) for (let b = -2; b <= 2; b++) if (setEq(translate(G0, a, b), live)) { found = [a, b]; break; }
      if (!found) { intact = false; continue; }
      [dr, dc] = found;
    }
    const expected = translate(G0, k * dr, k * dc);
    if (!setEq(live, expected)) uniform = false;
    if (r0 + k * dr >= H || c0 + k * dc >= W) wrapped = true;
  }
  ok(dr !== null && (Math.abs(dr) === 1 && Math.abs(dc) === 1), `glider translates by (${dr},${dc}) per 4 gens`);
  ok(intact, "glider stays exactly 5 cells for 200 generations");
  ok(uniform, "glider position matches uniform translation at every checkpoint");
  ok(wrapped, "glider crossed a torus edge during the test");
}

// ===== D) full-run smoke test ===============================================
console.log("D) full run: hi-res mode, seed density, evolution, spacebar reseed");
function runCycles(n) { let c = 0; while (c < n) { c += vm.run(Math.min(200_000, n - c)); vm.drainOutput(); } }
function readHires() { const a = new Uint8Array(0x2000); for (let i = 0; i < 0x2000; i++) a[i] = vm.peek(0x2000 + i); return a; }
function countByte(a, val) { let n = 0; for (const b of a) if (b === val) n++; return n; }
function countNonzero(a) { let n = 0; for (const b of a) if (b) n++; return n; }
{
  vm.setPC(S.START);
  runCycles(400_000);                       // past build/clear/seed + first render
  ok(vm.textMode() === 0, "graphics mode on (textMode==0)");
  ok(vm.lores() === 0, "hi-res mode on (lores==0)");
  const seedSnap = readHires();
  const seedCells = countByte(seedSnap, 0x7F);
  ok(seedCells > 1200 && seedCells < 5800, `rendered field ~half full (0x7F bytes=${seedCells})`);

  let snapA = readHires(), evolved = false;
  for (let t = 0; t < 4 && !evolved; t++) { runCycles(300_000); const snapB = readHires(); if (!gridsEqual(snapA, snapB)) evolved = true; snapA = snapB; }
  ok(evolved, "field evolves over time");

  const before = readHires();
  vm.keyDown(0x20);                         // press SPACE
  runCycles(700_000);
  const after = readHires();
  ok(!gridsEqual(before, after), "SPACE reseeds (field changes)");
  const dens = countByte(after, 0x7F);
  ok(dens > 1200 && dens < 5800, `reseeded field ~half full (0x7F bytes=${dens})`);
}

console.log(failures === 0 ? "\nALL LIFE TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
