// rocks.test.mjs — validates the ROCK STORM vector engine against JS models.
//   A) build_rows : ROWL/ROWH[y] vs the hi-res address formula (all 192 rows)
//   B) line       : horizontal / vertical / diagonal XOR lines land exactly,
//                   with correct endpoints and no stray/wrapped pixels
//   C) clip       : a line running off the left edge is clipped (no wrap)
//   D) xor-erase  : drawing the same line twice leaves the screen black
//   E) draw_poly  : the ship silhouette renders (nose pixel present) and XORs
//                   back to black when drawn twice
//
// Run:  node codegen/tools/rocks.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "rocks", "rocks.s");

let failures = 0;
const ok = (cond, msg) => { if (cond) { console.log("  PASS " + msg); } else { console.log("  FAIL " + msg); failures++; } };

const haddr = (y) => 0x2000 + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;

const src = readFileSync(SRC, "utf8");
const { org, bytes, symbols: S } = assemble(src);
console.log(`assembled rocks.s: ${bytes.length} bytes @ $${org.toString(16)} (ends $${(org + bytes.length).toString(16)})`);

const s = await boot();
const vm = s.vm;
s.load(bytes, org);

function runHook(entry, label) {
  const r = s.run({ org: entry, maxCycles: 8_000_000, chunk: 200_000 });
  if (r.halt !== "brk-monitor") throw new Error(`${label}: expected BRK halt, got ${r.halt} after ${r.cycles} cycles`);
  return r;
}
const getpix = (x, y) => (vm.peek(haddr(y) + Math.floor(x / 7)) >> (x % 7)) & 1;
const pokeS16 = (a, v) => { const u = v & 0xffff; vm.poke(a, u & 0xff); vm.poke(a + 1, (u >> 8) & 0xff); };
// count lit pixels in a row across the whole 280-wide playfield
const rowLit = (y) => { let n = 0; for (let x = 0; x < 280; x++) n += getpix(x, y); return n; };
// count lit pixels in a bounding box
const boxLit = (x0, y0, x1, y1) => { let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) n += getpix(x, y); return n; };

function drawLine(a, b, c, d) {
  pokeS16(S.X0, a); pokeS16(S.Y0, b); pokeS16(S.X1, c); pokeS16(S.Y1, d);
  runHook(S.LINE_BRK, `line(${a},${b},${c},${d})`);
}

// build the row table once, then reuse
runHook(S.BUILD_BRK, "build_rows");

// ===== A) row-address table =================================================
console.log("A) build_rows: ROWL/ROWH == hi-res address formula");
{
  let all = true, firstBad = null;
  for (let y = 0; y < 192; y++) {
    const got = vm.peek(S.ROWL + y) | (vm.peek(S.ROWH + y) << 8), exp = haddr(y);
    if (got !== exp) { all = false; if (firstBad === null) firstBad = y; }
  }
  ok(all, all ? "all 192 rows match" : `row ${firstBad} wrong`);
}

// ===== B) line: horizontal / vertical / diagonal ============================
console.log("B) line: exact endpoints, span, and no stray pixels");
{
  runHook(S.CLEAR_BRK, "clear");
  drawLine(10, 20, 30, 20);            // horizontal
  let span = true;
  for (let x = 10; x <= 30; x++) if (!getpix(x, 20)) span = false;
  ok(span, "horizontal line: all pixels 10..30 @ y=20 set");
  ok(getpix(10, 20) && getpix(30, 20), "horizontal endpoints set");
  ok(!getpix(9, 20) && !getpix(31, 20), "no overshoot beyond endpoints");
  ok(rowLit(20) === 21, `exactly 21 pixels on the row (got ${rowLit(20)})`);

  runHook(S.CLEAR_BRK, "clear");
  drawLine(50, 10, 50, 40);            // vertical
  let vspan = true;
  for (let y = 10; y <= 40; y++) if (!getpix(50, y)) vspan = false;
  ok(vspan, "vertical line: all pixels y=10..40 @ x=50 set");
  ok(!getpix(50, 9) && !getpix(50, 41), "vertical: no overshoot");

  runHook(S.CLEAR_BRK, "clear");
  drawLine(10, 10, 30, 30);            // 45-degree diagonal
  let diag = true;
  for (let i = 0; i <= 20; i++) if (!getpix(10 + i, 10 + i)) diag = false;
  ok(diag, "diagonal line: (10,10)..(30,30) fully connected");
  ok(getpix(10, 10) && getpix(30, 30), "diagonal endpoints set");
}

// ===== C) clip: off-screen portions are dropped, not wrapped ================
console.log("C) line clip: left-edge overrun is clipped (no wrap)");
{
  runHook(S.CLEAR_BRK, "clear");
  drawLine(-8, 60, 8, 60);             // starts off the left edge
  let onscreen = true;
  for (let x = 0; x <= 8; x++) if (!getpix(x, 60)) onscreen = false;
  ok(onscreen, "clipped line: on-screen pixels 0..8 set");
  // nothing should have wrapped to the right edge
  let wrapped = 0;
  for (let x = 270; x < 280; x++) wrapped += getpix(x, 60);
  ok(wrapped === 0, "no pixels wrapped to the right edge");
  ok(rowLit(60) === 9, `exactly 9 on-screen pixels (got ${rowLit(60)})`);
}

// ===== D) xor-erase =========================================================
console.log("D) xor: drawing a line twice erases it");
{
  runHook(S.CLEAR_BRK, "clear");
  drawLine(15, 70, 45, 78);
  const before = boxLit(0, 60, 279, 90);
  drawLine(15, 70, 45, 78);            // same line again
  const after = boxLit(0, 60, 279, 90);
  ok(before > 20, `line drew pixels (got ${before})`);
  ok(after === 0, `second pass cleared them all (residual ${after})`);
}

// ===== E) draw_poly: ship silhouette ========================================
console.log("E) draw_poly: ship renders and XOR-erases");
{
  runHook(S.CLEAR_BRK, "clear");
  // ship at angle 0, centre (100,80): nose vertex at (107,80)
  vm.poke(S.STATE, 0);                 // angle
  pokeS16(S.CENX, 100); vm.poke(S.CENY, 80);
  runHook(S.POLYSHIP_BRK, "ship@0");
  const lit = boxLit(90, 72, 112, 88);
  ok(lit > 15, `ship silhouette present (lit ${lit})`);
  ok(getpix(107, 80), "nose pixel at (107,80) lit");
  runHook(S.POLYSHIP_BRK, "ship@0 again");
  const after = boxLit(90, 72, 112, 88);
  ok(after === 0, `ship XOR-erased on redraw (residual ${after})`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
