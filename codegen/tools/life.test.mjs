// life.test.mjs — cross-checks emulator/AICodeGen/life/life.s against a JS reference.
//
//   A) RNG / seed field : the 6502 seed_brk hook vs an identical JS LFSR.
//   B) Rules + wrap      : onestep_brk vs a JS reference Life on a random torus.
//   C) Glider wrap       : a lone glider must stay intact and translate
//                          uniformly, including across the torus edges
//                          (reference-free ground truth for rules + wrapping).
//   D) Full run smoke    : start -> full-screen lo-res on, populated field,
//                          evolution, and a SPACE press reseeds the field.
//   E) Lo-res render     : render_wai draws a known buffer to the $0400-$07FF
//                          lo-res page; assert the exact two-cells-per-byte
//                          nibble packing, the seeded field round-trips, and a
//                          blinker oscillates horizontal <-> vertical.
//
// Run:  node codegen/tools/life.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot, TEXT_SCANLINES } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "life", "life.s");

const W = 40, H = 48, STRIDE = 42;
const GREEN = 12;                                 // lo-res palette index for a live cell
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

// Decode the on-screen 40x48 field from the lo-res/text page the way the VM's
// renderer does: each byte packs two stacked cells (low nibble = upper/even row,
// high nibble = lower/odd row); a live cell is palette GREEN.
function decodeField(vm) {
  const g = new Uint8Array(H * W);
  for (let r = 0; r < H; r++) {
    const base = 0x400 + TEXT_SCANLINES[r >> 1];
    for (let c = 0; c < W; c++) {
      const byte = vm.peek(base + c) & 0xFF;
      const nib = (r & 1) ? (byte >> 4) : (byte & 0x0F);
      g[r * W + c] = nib === GREEN ? 1 : 0;
    }
  }
  return g;
}
function countAlive(g) { let n = 0; for (const b of g) n += b; return n; }
function asciiField(g) { let out = ""; for (let r = 0; r < H; r++) { let line = ""; for (let c = 0; c < W; c++) line += g[r * W + c] ? "#" : "."; out += "    " + line + "\n"; } return out; }

// --- main -------------------------------------------------------------------
const src = readFileSync(SRC, "utf8");
const { org, bytes, symbols: S } = assemble(src);
console.log(`assembled life.s: ${bytes.length} bytes @ $${org.toString(16)}  (ends $${(org + bytes.length).toString(16)})`);

const s = await boot();
const vm = s.vm;
s.load(bytes, org);

function runHook(entry, label, expect = "brk-monitor") {
  const r = s.run({ org: entry, maxCycles: 6_000_000, chunk: 200_000 });
  if (r.halt !== expect) throw new Error(`${label}: expected ${expect} halt, got ${r.halt} after ${r.cycles} cycles`);
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
console.log("D) full run: full-screen lo-res mode, populated field, evolution, spacebar reseed");
function runCycles(n) { let c = 0; while (c < n) { c += vm.run(Math.min(200_000, n - c)); vm.drainOutput(); } }
{
  const CELLS = H * W;                        // 1920
  vm.setPC(S.START);
  runCycles(400_000);                        // past clear/seed + first render(s)
  ok(vm.textMode() === 0, "graphics mode on (textMode==0)");
  ok(vm.lores() !== 0, "lo-res mode on (lores!=0)");
  ok(vm.mixed() === 0, "full screen, not mixed (mixed==0)");

  const seed = decodeField(vm);
  const seedCells = countAlive(seed);
  ok(seedCells > CELLS * 0.2 && seedCells < CELLS * 0.7, `field populated (alive=${seedCells}/${CELLS})`);

  let snapA = decodeField(vm), evolved = false;
  for (let t = 0; t < 4 && !evolved; t++) { runCycles(300_000); const snapB = decodeField(vm); if (!gridsEqual(snapA, snapB)) evolved = true; snapA = snapB; }
  ok(evolved, "field evolves over time");

  const before = decodeField(vm);
  vm.keyDown(0x20);                          // press SPACE
  runCycles(700_000);
  const after = decodeField(vm);
  ok(!gridsEqual(before, after), "SPACE reseeds (field changes)");
  const dens = countAlive(after);
  ok(dens > CELLS * 0.2 && dens < CELLS * 0.7, `reseeded field populated (alive=${dens}/${CELLS})`);
}

// ===== E) lo-res render: exact nibble packing + seed round-trip + blinker ====
// render_wai draws curbase to the lo-res page then WAIs (no monitor, so the
// register dump can't scribble on $0400-$07FF), letting us decode exactly what
// the renderer produced.  A full render overwrites every visible byte, so any
// earlier monitor output from a BRK hook is wiped before we read it back.
console.log("E) lo-res render ground truth (render_wai)");
function renderCur(base) { pokeWord(vm, S.CURBASE, base); runHook(S.RENDER_WAI, "render_wai", "wai"); }
{
  // E1) a seeded buffer round-trips through the renderer exactly.
  pokeWord(vm, S.SEEDL, S.SEED0);
  pokeWord(vm, S.CURBASE, S.CUR0);
  runHook(S.SEED_BRK, "seed_brk");           // fill CUR0 with the LFSR field
  renderCur(S.CUR0);
  const shown = decodeField(vm);
  ok(gridsEqual(shown, refSeed(S.SEED0)), "rendered lo-res field matches the seeded buffer");
  const alive = countAlive(shown);
  ok(alive > H * W * 0.4 && alive < H * W * 0.6, `rendered seed density ~50% (alive=${alive}/${H * W})`);

  // E2) exact two-cells-per-byte nibble packing: low nibble = upper (even) cell,
  //     high nibble = lower (odd) cell.  A top/bottom swap would only show here.
  zeroBuf(vm, S.CUR0);
  const set = (r, c) => vm.poke(S.CUR0 + bufIndex(r + 1, c + 1), 1);
  set(0, 0); set(1, 0);                       // text row 0, col 0: both cells -> $CC
  set(0, 5);                                  // upper only            -> $0C
  set(3, 7);                                  // odd row (text row 1)  -> $C0
  renderCur(S.CUR0);
  ok(vm.peek(0x400) === 0xCC, "byte packs upper|lower cell into low|high nibble ($0400==$CC)");
  ok(vm.peek(0x405) === 0x0C, "upper-only cell sets only the low nibble ($0405==$0C)");
  ok(vm.peek(0x400 + TEXT_SCANLINES[1] + 7) === 0xC0, "odd-row cell sets only the high nibble ($C0)");
  const expSparse = new Uint8Array(H * W);
  expSparse[0 * W + 0] = 1; expSparse[1 * W + 0] = 1; expSparse[0 * W + 5] = 1; expSparse[3 * W + 7] = 1;
  ok(gridsEqual(decodeField(vm), expSparse), "sparse pattern decodes back to exactly the poked cells");

  // E3) a blinker oscillates horizontal <-> vertical (period-2 oscillator).
  const horiz = new Uint8Array(H * W); horiz[10 * W + 10] = 1; horiz[10 * W + 11] = 1; horiz[10 * W + 12] = 1;
  const vert = new Uint8Array(H * W); vert[9 * W + 11] = 1; vert[10 * W + 11] = 1; vert[11 * W + 11] = 1;
  zeroBuf(vm, S.CUR0); zeroBuf(vm, S.NXT0);
  pokeGrid(vm, S.CUR0, horiz);
  renderCur(S.CUR0);
  const shownH = decodeField(vm);
  const okH = gridsEqual(shownH, horiz);
  ok(okH, "horizontal blinker renders as three cells in a row");
  if (!okH) console.log(asciiField(shownH));

  pokeWord(vm, S.CURBASE, S.CUR0); pokeWord(vm, S.NXTBASE, S.NXT0);
  runHook(S.ONESTEP_BRK, "onestep blinker");  // CUR0 -> NXT0 (one generation)
  renderCur(S.NXT0);
  const shownV = decodeField(vm);
  const okV = gridsEqual(shownV, vert);
  ok(okV, "after one step the blinker is vertical (period-2 oscillator)");
  if (!okV) console.log(asciiField(shownV));
}

console.log(failures === 0 ? "\nALL LIFE TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
