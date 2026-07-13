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
console.log("0) program layout stays below hi-res page 1");
ok(org + bytes.length <= 0x2000, `image ends at or below $2000 (got $${(org + bytes.length).toString(16)})`);

const s = await boot();
const vm = s.vm;
s.load(bytes, org);

function runHook(entry, label) {
  const r = s.run({ org: entry, maxCycles: 8_000_000, chunk: 200_000 });
  if (r.halt !== "brk-monitor") throw new Error(`${label}: expected BRK halt, got ${r.halt} after ${r.cycles} cycles`);
  return r;
}

function measureRoutine(entry, label) {
  const trampoline = 0x7000;
  const stop = trampoline + 6;
  const code = [0xa2, 0xff, 0x9a, 0x20, entry & 0xff, entry >> 8, 0xea];
  code.forEach((byte, index) => vm.poke(trampoline + index, byte));
  vm.setPC(trampoline);
  let cycles = 0;
  for (let steps = 0; vm.pc() !== stop; steps++) {
    if (steps >= 1_000_000) throw new Error(`${label}: routine did not return`);
    cycles += vm.run(1);
  }
  return cycles;
}

vm.poke(0x7100, 0x60); // RTS stub used to remove the measurement trampoline cost.
const measureOverhead = measureRoutine(0x7100, "measurement overhead");
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

console.log("A0) seedcol: bounded divide-by-7 matches every supported X");
{
  let all = true, firstBad = null;
  for (let x = -21; x <= 296; x++) {
    pokeS16(S.CX, x);
    measureRoutine(S.SEEDCOL, `seedcol(${x})`);
    const col = vm.peek(S.COL);
    const signedCol = col & 0x80 ? col - 0x100 : col;
    const expectedCol = Math.floor(x / 7);
    const expectedBit = x - expectedCol * 7;
    if (signedCol !== expectedCol || vm.peek(S.BITN) !== expectedBit) {
      all = false;
      firstBad ??= { x, signedCol, bit: vm.peek(S.BITN), expectedCol, expectedBit };
    }
  }
  ok(all, all
    ? "all X values -21..296 produce the expected column and bit"
    : `x=${firstBad.x}: got ${firstBad.signedCol}/${firstBad.bit}, expected ${firstBad.expectedCol}/${firstBad.expectedBit}`);
}

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

// ===== M2: ship physics =====================================================
const SHIP = S.SHIP;
const O = { act:0, xf:1, xl:2, xh:3, yf:4, yl:5, yh:6, vxl:7, vxh:8, vyl:9, vyh:10, ang:11, drawn:12, life:13, kind:14 };
const gb = (k) => vm.peek(SHIP + O[k]);
const sb = (k, v) => vm.poke(SHIP + O[k], v & 0xff);
const s8 = (v) => (v & 0x80 ? v - 256 : v);           // signed byte
const press = (k) => vm.poke(0xC000, k);              // key codes already carry bit7
const frame = () => runHook(S.FRAME_BRK, "frame");
const playfieldLit = () => boxLit(0, 0, 279, 159);
const ROCKS = S.ROCKS;
const clearRocks = () => { for (let i = 0; i < 28; i++) { vm.poke(ROCKS + i * 16 + O.act, 0); vm.poke(ROCKS + i * 16 + O.drawn, 0); } };

// F) init : ship centred, at rest, pointing up
console.log("F) init: ship centred, at rest, pointing up");
{
  runHook(S.INIT_BRK, "init");
  ok(gb("act") === 1, "ship active");
  ok(gb("xl") === 140 && gb("xh") === 0, `ship x = 140 (got ${gb("xl") + 256 * gb("xh")})`);
  ok(gb("yl") === 80 && gb("yh") === 0, `ship y = 80 (got ${gb("yl") + 256 * gb("yh")})`);
  ok(gb("ang") === 24, `ship heading = up/24 (got ${gb("ang")})`);
  ok(gb("vxl") === 0 && gb("vxh") === 0 && gb("vyl") === 0 && gb("vyh") === 0, "velocity zero");
  ok(gb("drawn") === 0, "not yet drawn");
}

// G) first frame renders the ship without moving it
console.log("G) first frame renders the ship without moving it");
{
  runHook(S.INIT_BRK, "init");
  frame();
  ok(gb("drawn") === 1, "ship marked drawn");
  ok(gb("xl") === 140 && gb("yl") === 80, "ship did not move (no input)");
  ok(boxLit(128, 70, 152, 90) > 12, `ship pixels present near centre (lit ${boxLit(128, 70, 152, 90)})`);
}

// H) rotation : D/right increments, A/left decrements the heading
console.log("H) rotate: D/right increments, A/left decrements the heading");
{
  runHook(S.INIT_BRK, "init");
  press(0xC4); frame();                 // 'D'
  ok(gb("ang") === 25, `D -> 25 (got ${gb("ang")})`);
  press(0xC4); frame();
  ok(gb("ang") === 26, `D -> 26 (got ${gb("ang")})`);
  runHook(S.INIT_BRK, "init");          // fresh (clears hold-timers)
  press(0xC1); frame();                 // 'A'
  ok(gb("ang") === 23, `A -> 23 (got ${gb("ang")})`);
}

// I) thrust + inertia (heading 24 = pure up: ACCX[24]=0, ACCY[24]=-40)
console.log("I) thrust builds velocity; ship coasts (inertia) after keys stop");
{
  runHook(S.INIT_BRK, "init");
  for (let i = 0; i < 8; i++) { press(0xD7); frame(); } // 'W' x8
  const vy = s8(gb("vyh"));
  ok(vy < 0, `thrust up -> vy negative (got ${vy})`);
  ok(s8(gb("vxh")) === 0 && gb("vxl") === 0, "no sideways velocity at heading up");
  ok(gb("yl") < 80, `ship moved up (y=${gb("yl")})`);
  const yA = gb("yl");
  for (let i = 0; i < 8; i++) frame();                  // coast, no keys
  ok(gb("yl") < yA, `ship keeps moving up under inertia (y ${yA} -> ${gb("yl")})`);
  ok(s8(gb("vyh")) < 0, "velocity retained (no friction)");
}

// J) screen wrap : crossing an edge reappears on the opposite side
console.log("J) wrap: crossing an edge reappears on the opposite side");
{
  runHook(S.INIT_BRK, "init");
  sb("xf", 0); sb("xl", 278 & 255); sb("xh", 278 >> 8);
  sb("vxl", 0); sb("vxh", 2); sb("vyl", 0); sb("vyh", 0);   // +2 px/frame right
  frame();
  const x = gb("xl") + 256 * gb("xh");
  ok(x < 8, `x wrapped past the right edge to the left (got ${x})`);
  runHook(S.INIT_BRK, "init");
  sb("yf", 0); sb("yl", 2); sb("yh", 0);
  sb("vyl", 0); sb("vyh", 256 - 3); sb("vxl", 0); sb("vxh", 0); // -3 px/frame up
  frame();
  const y = gb("yl") + 256 * gb("yh");
  ok(y > 150 && y < 160, `y wrapped past the top edge to the bottom (got ${y})`);
}

// K) erase-redraw : a moving ship leaves no trail
console.log("K) erase-redraw: a moving ship leaves no trail");
{
  runHook(S.INIT_BRK, "init");
clearRocks();
  for (let i = 0; i < 10; i++) { press(0xD7); frame(); } // thrust up
  for (let i = 0; i < 10; i++) frame();                  // coast
  const total = playfieldLit();
  ok(total > 12 && total < 80, `~one ship on screen, no accumulated trail (lit ${total})`);
  const yl = gb("yl"), xl = gb("xl");
  const below = boxLit(Math.max(0, xl - 16), Math.min(159, yl + 12), Math.min(279, xl + 16), Math.min(159, yl + 30));
  ok(below === 0, `clean space behind the ship (residual ${below})`);
}

// ===========================================================================
// M3) bullets
// ===========================================================================
const BULLETS = S.BULLETS;
const bull = (i, k) => vm.peek(BULLETS + i * 16 + O[k]);
const setbull = (i, k, v) => vm.poke(BULLETS + i * 16 + O[k], v & 0xff);
const bx16 = (i) => bull(i, "xl") + 256 * bull(i, "xh");
const activeBullets = () => { let n = 0; for (let i = 0; i < 5; i++) n += bull(i, "act") ? 1 : 0; return n; };
const firstBullet = () => { for (let i = 0; i < 5; i++) if (bull(i, "act")) return i; return -1; };

// L) firing SPACE spawns a bullet at the nose, moving in the facing direction
console.log("L) fire: SPACE spawns a bullet at the nose moving up");
{
  runHook(S.INIT_BRK, "init");
  clearRocks();
  press(0xA0); frame();                       // SPACE
  ok(activeBullets() >= 1, `a bullet is active after firing (got ${activeBullets()})`);
  const bi = firstBullet();
  ok(bi >= 0, "bullet slot allocated");
  ok(Math.abs(bx16(bi) - 140) <= 3, `bullet near ship x=140 (got ${bx16(bi)})`);
  ok(bull(bi, "yl") < 78, `bullet above ship centre, travelling up (y=${bull(bi, "yl")})`);
  ok(bull(bi, "life") > 0 && bull(bi, "life") <= 60, `bullet has a lifetime (got ${bull(bi, "life")})`);
}

// M) a fired bullet keeps travelling and is drawn on the playfield
console.log("M) bullet travels and is drawn");
{
  runHook(S.INIT_BRK, "init");
  clearRocks();
  press(0xA0); frame();
  const bi = firstBullet();
  const y1 = bull(bi, "yl");
  for (let i = 0; i < 5; i++) frame();        // coast
  const y2 = bull(bi, "yl");
  ok(y2 < y1, `bullet keeps travelling up (${y1} -> ${y2})`);
  ok(getpix(bx16(bi), bull(bi, "yl")) === 1, "bullet pixel present on screen");
  ok(activeBullets() === 1, `still exactly one bullet (got ${activeBullets()})`);
}

// N) a bullet expires after its lifetime and leaves no trail
console.log("N) bullet expires after its lifetime");
{
  runHook(S.INIT_BRK, "init");
  clearRocks();
  press(0xA0); frame();
  ok(activeBullets() === 1, "bullet active");
  for (let i = 0; i < 62; i++) frame();       // outlive it
  ok(activeBullets() === 0, "bullet retired after its lifetime");
  ok(playfieldLit() < 50, `no leftover bullet trail, ship only (lit ${playfieldLit()})`);
}

// O) never more than NBULLET bullets, even holding fire
console.log("O) fire cadence caps active bullets at NBULLET");
{
  runHook(S.INIT_BRK, "init");
  clearRocks();
  let peak = 0;
  for (let i = 0; i < 50; i++) { press(0xA0); frame(); peak = Math.max(peak, activeBullets()); }
  ok(activeBullets() <= 5, `never more than 5 bullets (got ${activeBullets()})`);
  ok(peak >= 4, `fire cadence produced several coexisting bullets (peak ${peak})`);
}

// P) bullets wrap at the screen edges like the ship
console.log("P) bullet wraps at the top edge");
{
  runHook(S.INIT_BRK, "init");
  clearRocks();
  press(0xA0); frame();
  const bi = firstBullet();
  setbull(bi, "yf", 0); setbull(bi, "yl", 2); setbull(bi, "yh", 0);  // just below the top
  frame();
  ok(bull(bi, "yl") > 150, `bullet wrapped top -> bottom (y=${bull(bi, "yl")})`);
}

// ===========================================================================
// M4) rocks
// ===========================================================================
const rk = (i, k) => vm.peek(ROCKS + i * 16 + O[k]);
const setrk = (i, k, v) => vm.poke(ROCKS + i * 16 + O[k], v & 0xff);
const rkx = (i) => rk(i, "xl") + 256 * rk(i, "xh");
const activeRocks = () => { let n = 0; for (let i = 0; i < 28; i++) n += rk(i, "act") ? 1 : 0; return n; };
const firstActiveRock = () => { for (let i = 0; i < 28; i++) if (rk(i, "act")) return i; return -1; };

// Q) the opening wave spawns WAVE0 large rocks, on-screen, valid silhouettes
console.log("Q) opening wave spawns large rocks");
{
  runHook(S.INIT_BRK, "init");
  ok(activeRocks() === 4, `WAVE0 large rocks active (got ${activeRocks()})`);
  let allLarge = true, onScreen = true;
  for (let i = 0; i < 28; i++) if (rk(i, "act")) {
    const k = rk(i, "kind");
    if (k !== 2 && k !== 5 && k !== 8) allLarge = false;   // size 2 => kind in {2,5,8}
    if (rkx(i) > 279 || rk(i, "yl") > 159) onScreen = false;
  }
  ok(allLarge, "every wave rock is a large silhouette");
  ok(onScreen, "every rock spawns inside the playfield");
}

// R) rocks are actually drawn (they add many lit pixels over the ship alone)
console.log("R) rocks are drawn on the playfield");
{
  runHook(S.INIT_BRK, "init"); clearRocks(); frame();
  const shipOnly = playfieldLit();
  runHook(S.INIT_BRK, "init"); frame();
  const withRocks = playfieldLit();
  ok(withRocks - shipOnly > 60, `4 large rocks add many lit pixels (${shipOnly} -> ${withRocks})`);
}

// S) rocks drift over time
console.log("S) rocks drift over time");
{
  runHook(S.INIT_BRK, "init");
  const bi = firstActiveRock();
  const x0 = rkx(bi), y0 = rk(bi, "yl");
  for (let i = 0; i < 20; i++) frame();
  const x1 = rkx(bi), y1 = rk(bi, "yl");
  ok(x0 !== x1 || y0 !== y1, `rock drifted (${x0},${y0}) -> (${x1},${y1})`);
}

// T) rocks wrap at the screen edges like every other object
console.log("T) rocks wrap at the screen edges");
{
  runHook(S.INIT_BRK, "init");
  const bi = firstActiveRock();
  setrk(bi, "xf", 0); setrk(bi, "xl", 278 & 255); setrk(bi, "xh", 278 >> 8);
  setrk(bi, "vxl", 0); setrk(bi, "vxh", 2); setrk(bi, "vyl", 0); setrk(bi, "vyh", 0);
  frame();
  ok(rkx(bi) < 20, `rock wrapped past the right edge (x=${rkx(bi)})`);
}

// U) rocks erase-redraw with no trail (lit count stays bounded over time)
console.log("U) rocks leave no trail");
{
  runHook(S.INIT_BRK, "init");
  frame();
  const lit1 = playfieldLit();
  for (let i = 0; i < 40; i++) frame();
  const lit2 = playfieldLit();
  ok(lit2 > 80, `rocks still on screen (lit ${lit2})`);
  ok(lit2 < 700, `no runaway accumulation over 40 frames (${lit1} -> ${lit2})`);
}

// ===========================================================================
// M5) collisions : bullet-rock split + score, ship-rock death
// ===========================================================================
const bcd = (b) => (b >> 4) * 10 + (b & 15);
const scoreVal = () => bcd(vm.peek(S.SCORE0)) + 100 * bcd(vm.peek(S.SCORE1)) + 10000 * bcd(vm.peek(S.SCORE2));
const setRkCnt = (n) => vm.poke(S.RKCNT, n & 0xff);
const clearBullets = () => { for (let i = 0; i < 5; i++) { setbull(i, "act", 0); setbull(i, "drawn", 0); } };
const placeRock = (i, kind, x, y) => {
  setrk(i, "act", 1); setrk(i, "kind", kind);
  setrk(i, "xf", 0); setrk(i, "xl", x & 255); setrk(i, "xh", (x >> 8) & 255);
  setrk(i, "yf", 0); setrk(i, "yl", y & 255); setrk(i, "yh", 0);
  setrk(i, "vxl", 0); setrk(i, "vxh", 0); setrk(i, "vyl", 0); setrk(i, "vyh", 0);
  setrk(i, "drawn", 0);
};
const placeBullet = (i, x, y) => {
  setbull(i, "act", 1);
  setbull(i, "xf", 0); setbull(i, "xl", x & 255); setbull(i, "xh", (x >> 8) & 255);
  setbull(i, "yf", 0); setbull(i, "yl", y & 255); setbull(i, "yh", 0);
  setbull(i, "vxl", 0); setbull(i, "vxh", 0); setbull(i, "vyl", 0); setbull(i, "vyh", 0);
  setbull(i, "life", 60); setbull(i, "drawn", 0);
};
const rockKinds = () => { const a = []; for (let i = 0; i < 28; i++) if (rk(i, "act")) a.push(rk(i, "kind")); return a; };

// V) a bullet sitting on a rock destroys it and is itself consumed
console.log("V) a bullet destroys the rock it overlaps and is consumed");
{
  runHook(S.INIT_BRK, "init"); clearRocks(); clearBullets();
  setRkCnt(1);
  placeRock(0, 0, 100, 60);              // small rock -> destroyed outright
  placeBullet(0, 100, 60);
  frame();
  ok(activeRocks() === 0, `the struck rock is gone (got ${activeRocks()})`);
  ok(activeBullets() === 0, `the bullet is consumed (got ${activeBullets()})`);
  ok(scoreVal() === 100, `a small rock scores 100 (got ${scoreVal()})`);
}

// W) rocks split one size down; the smallest simply vanish
console.log("W) rocks split (large->2 medium, medium->2 small, small->0)");
{
  runHook(S.INIT_BRK, "init"); clearRocks(); clearBullets();
  setRkCnt(1); placeRock(0, 2, 90, 50); placeBullet(0, 90, 50); frame();
  let kinds = rockKinds();
  ok(kinds.length === 2, `a large rock splits into two (got ${kinds.length})`);
  ok(kinds.length === 2 && kinds.every(k => k % 3 === 1), `both children are medium (kinds ${kinds})`);

  runHook(S.INIT_BRK, "init"); clearRocks(); clearBullets();
  setRkCnt(1); placeRock(0, 1, 90, 50); placeBullet(0, 90, 50); frame();
  kinds = rockKinds();
  ok(kinds.length === 2, `a medium rock splits into two (got ${kinds.length})`);
  ok(kinds.length === 2 && kinds.every(k => k % 3 === 0), `both children are small (kinds ${kinds})`);

  runHook(S.INIT_BRK, "init"); clearRocks(); clearBullets();
  setRkCnt(1); placeRock(0, 0, 90, 50); placeBullet(0, 90, 50); frame();
  ok(activeRocks() === 0, `a small rock leaves no children (got ${activeRocks()})`);
}

// X) splitting a large rock nets one extra rock on the field
console.log("X) splitting grows the field by one rock");
{
  runHook(S.INIT_BRK, "init"); clearRocks(); clearBullets();
  setRkCnt(1); placeRock(0, 2, 90, 50); placeBullet(0, 90, 50);
  const before = activeRocks();
  frame();
  ok(activeRocks() === before + 1, `1 large -> 2 medium is a net +1 (${before} -> ${activeRocks()})`);
}

// Y) the score awarded scales with rock size (small 100, med 50, large 20)
console.log("Y) score value depends on rock size");
{
  const hit = (kind) => {
    runHook(S.INIT_BRK, "init"); clearRocks(); clearBullets();
    setRkCnt(1); placeRock(0, kind, 90, 50); placeBullet(0, 90, 50); frame();
    return scoreVal();
  };
  let v = hit(0); ok(v === 100, `small rock scores 100 (got ${v})`);
  v = hit(1); ok(v === 50, `medium rock scores 50 (got ${v})`);
  v = hit(2); ok(v === 20, `large rock scores 20 (got ${v})`);
}

// Z) a rock on the ship costs a life; running out ends the game
console.log("Z) ship-rock collision: lose a life, then game over at zero");
{
  runHook(S.INIT_BRK, "init"); clearRocks(); clearBullets();
  setRkCnt(1); placeRock(0, 0, 140, 80);          // rock parked on the ship spawn point
  ok(vm.peek(S.LIVES) === 3, `three lives at start (got ${vm.peek(S.LIVES)})`);
  vm.poke(S.INVUL, 0); frame();                    // drop the shield, take the hit
  ok(vm.peek(S.LIVES) === 2, `a hit costs one life (got ${vm.peek(S.LIVES)})`);
  ok(vm.peek(S.INVUL) > 0, `respawn grants fresh invulnerability (got ${vm.peek(S.INVUL)})`);
  ok(vm.peek(S.GAMEOVER) === 0, "still playing after the first death");
  vm.poke(S.INVUL, 0); frame();                    // lives 2 -> 1
  ok(vm.peek(S.LIVES) === 1, `second hit (got ${vm.peek(S.LIVES)})`);
  vm.poke(S.INVUL, 0); frame();                    // lives 1 -> 0 -> game over
  ok(vm.peek(S.LIVES) === 0, `third hit empties the lives (got ${vm.peek(S.LIVES)})`);
  ok(vm.peek(S.GAMEOVER) === 1, "game over once out of ships");
  ok(gb("act") === 0, "the ship is removed on game over");
}

// ===========================================================================
// M6) game flow : waves, HUD, attract / game-over state machine
// ===========================================================================
const clearKey = () => vm.poke(0xC000, 0);
const frameHud = () => runHook(S.FRAME_HUD_BRK, "frame+hud");
const hudChar = (base, col) => vm.peek(base + col) & 0x7f;   // strip the hi (video) bit
const hudStr = (base, col, n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(hudChar(base, col + i)); return s; };

// AA) a new game starts in the playing state on wave 1
console.log("AA) game_init enters the playing state on wave 1");
{
  runHook(S.INIT_BRK, "init");
  ok(vm.peek(S.GSTATE) === S.GS_PLAY, `play state after init (got ${vm.peek(S.GSTATE)})`);
  ok(vm.peek(S.WAVE) === 1, `starts on wave 1 (got ${vm.peek(S.WAVE)})`);
}

// AB) clearing the field advances to a larger wave
console.log("AB) clearing every rock spawns the next, larger wave");
{
  runHook(S.INIT_BRK, "init"); clearRocks(); clearKey();
  setRkCnt(0);
  frame();
  ok(vm.peek(S.WAVE) === 2, `advanced to wave 2 (got ${vm.peek(S.WAVE)})`);
  ok(activeRocks() === 5, `wave 2 has WAVE0+1 = 5 rocks (got ${activeRocks()})`);
  clearRocks(); setRkCnt(0); frame();
  ok(vm.peek(S.WAVE) === 3 && activeRocks() === 6, `wave 3 has 6 rocks (got w${vm.peek(S.WAVE)} n${activeRocks()})`);
}

// AC) the HUD shows the score and remaining ships
console.log("AC) HUD renders SCORE + digits + SHIPS + lives");
{
  runHook(S.INIT_BRK, "init"); clearRocks(); clearBullets(); clearKey();
  setRkCnt(1); placeRock(0, 0, 90, 50); placeBullet(0, 90, 50);   // +100 points
  frameHud();
  ok(hudStr(S.SNAP22, 0, 5) === "SCORE", `SCORE label on the HUD (got "${hudStr(S.SNAP22, 0, 5)}")`);
  ok(hudStr(S.SNAP22, 6, 6) === "000100", `score reads 000100 (got "${hudStr(S.SNAP22, 6, 6)}")`);
  ok(hudStr(S.SNAP22, 20, 5) === "SHIPS", `SHIPS label on the HUD (got "${hudStr(S.SNAP22, 20, 5)}")`);
  ok(hudChar(S.SNAP22, 26) === "3".charCodeAt(0), `three ships shown (got ${String.fromCharCode(hudChar(S.SNAP22, 26))})`);
}

// AD) attract screen shows the title and SPACE starts a game
console.log("AD) attract screen: title shown, SPACE starts play");
{
  runHook(S.ATTRACT_BRK, "attract");
  ok(vm.peek(S.GSTATE) === S.GS_ATTRACT, `attract state after reset (got ${vm.peek(S.GSTATE)})`);
  clearKey(); frameHud();                                // one attract frame draws the title
  ok(hudStr(S.SNAP20, 15, 10) === "ROCK STORM", `title shown (got "${hudStr(S.SNAP20, 15, 10)}")`);
  press(S.K_SPACE); frame();                             // SPACE -> play
  ok(vm.peek(S.GSTATE) === S.GS_PLAY, `SPACE starts the game (got ${vm.peek(S.GSTATE)})`);
  ok(vm.peek(S.LIVES) === 3, `fresh game has 3 lives (got ${vm.peek(S.LIVES)})`);
}

// AE) losing the last ship ends the game; SPACE restarts it
console.log("AE) game over on the last life, then SPACE restarts");
{
  runHook(S.INIT_BRK, "init"); clearRocks(); clearBullets(); clearKey();
  setRkCnt(1); placeRock(0, 0, 140, 80);                 // rock parked on the ship
  vm.poke(S.INVUL, 0); frame();                          // 3 -> 2
  vm.poke(S.INVUL, 0); frame();                          // 2 -> 1
  vm.poke(S.INVUL, 0); frame();                          // 1 -> 0 -> game over
  ok(vm.peek(S.GAMEOVER) === 1, "game-over flag set");
  ok(vm.peek(S.GSTATE) === S.GS_OVER, `game-over state entered (got ${vm.peek(S.GSTATE)})`);
  clearKey(); frameHud();                                // over_frame draws the banner
  ok(hudStr(S.SNAP20, 15, 9) === "GAME OVER", `GAME OVER banner (got "${hudStr(S.SNAP20, 15, 9)}")`);
  press(S.K_SPACE); frame();                             // SPACE -> restart
  ok(vm.peek(S.GSTATE) === S.GS_PLAY, `restart returns to play (got ${vm.peek(S.GSTATE)})`);
  ok(vm.peek(S.LIVES) === 3, `restart restores 3 lives (got ${vm.peek(S.LIVES)})`);
  ok(vm.peek(S.GAMEOVER) === 0, "restart clears the game-over flag");
}

// AF) the engine flame lights under thrust and clears without a trail
console.log("AF) engine flame lights under thrust and clears when it stops");
{
  runHook(S.INIT_BRK, "init"); clearRocks(); clearBullets(); clearKey();
  frame();                                  // draw the ship once, engine idle
  const idle = playfieldLit();
  // park the up-facing ship dead-centre at rest so only the flame changes the picture
  const park = () => {
    sb("vxl", 0); sb("vxh", 0); sb("vyl", 0); sb("vyh", 0);
    sb("xf", 0); sb("xl", 140); sb("xh", 0);
    sb("yf", 0); sb("yl", 80); sb("yh", 0);
  };
  park(); press(S.K_W); frame();            // engine on
  const firing = playfieldLit();
  ok(firing > idle, `flame adds pixels behind the ship (${idle} -> ${firing})`);
  const yF = gb("yl"), xF = gb("xl");        // nose up -> exhaust points down
  ok(boxLit(xF - 5, yF + 6, xF + 5, yF + 12) > 0,
     `flame renders below the tail (lit ${boxLit(xF - 5, yF + 6, xF + 5, yF + 12)})`);
  clearKey();                               // release the throttle
  for (let i = 0; i < 12; i++) { park(); frame(); }   // hold-timer expires, flame dies
  ok(playfieldLit() <= idle, `flame fully erased once thrust stops (${playfieldLit()} vs idle ${idle})`);
  const yR = gb("yl"), xR = gb("xl");        // ship is back at rest here
  ok(boxLit(xR - 6, yR + 6, xR + 6, yR + 16) === 0,
     `clean exhaust zone after release (residual ${boxLit(xR - 6, yR + 6, xR + 6, yR + 16)})`);
}

// AG) hyperspace warps the ship elsewhere, kills momentum, and rate-limits
console.log("AG) hyperspace jumps the ship, zeros momentum, and cools down");
{
  runHook(S.INIT_BRK, "init"); clearRocks(); clearBullets(); clearKey();
  vm.poke(S.INVUL, 0); vm.poke(S.HYPCD, 0);        // normal play: no grace, jump ready
  sb("xf", 0); sb("xl", 140); sb("xh", 0);
  sb("yf", 0); sb("yl", 80);  sb("yh", 0);
  sb("vxl", 60); sb("vxh", 0); sb("vyl", 0); sb("vyh", 0);   // real momentum
  press(S.K_H); frame();                            // hyperspace!
  const x1 = gb("xl"), y1 = gb("yl");
  ok(x1 !== 140 || y1 !== 80, `ship warps to a new spot (140,80 -> ${x1},${y1})`);
  ok(gb("vxl") === 0 && gb("vxh") === 0 && gb("vyl") === 0 && gb("vyh") === 0,
     `momentum is killed on arrival (v=${gb("vxl")},${gb("vxh")},${gb("vyl")},${gb("vyh")})`);
  ok(vm.peek(S.INVUL) === S.HYP_INV - 1, `brief arrival grace (got ${vm.peek(S.INVUL)})`);
  ok(vm.peek(S.HYPCD) === S.HYP_CD - 1, `cooldown armed (got ${vm.peek(S.HYPCD)})`);
  // a second request while cooling down is ignored -> no teleport
  clearKey(); press(S.K_H); frame();
  ok(gb("xl") === x1 && gb("yl") === y1,
     `no re-jump while cooling down (${x1},${y1} -> ${gb("xl")},${gb("yl")})`);
  // once the cooldown clears, hyperspace fires again
  vm.poke(S.HYPCD, 0); clearKey(); press(S.K_H); frame();
  ok(gb("xl") !== x1 || gb("yl") !== y1,
     `jumps again after the cooldown (${x1},${y1} -> ${gb("xl")},${gb("yl")})`);
}

// AH) a live opening-wave frame stays inside the performance contract, and
// alternating clears really retarget their self-modified stores to page 2.
console.log("AH) live frame meets its cycle budget and clears both draw pages");
{
  runHook(S.INIT_BRK, "init"); clearKey();
  const cycles = measureRoutine(S.LIVE_FRAME, "live frame") - measureOverhead;
  ok(cycles <= 175_000, `opening-wave live frame <= 175,000 cycles (got ${cycles.toLocaleString("en-US")})`);

  const page2Unused = haddr(191) + 0x2000; // mixed mode never draws this row.
  vm.poke(page2Unused, 0xff);
  measureRoutine(S.LIVE_FRAME, "page-2 live frame");
  ok(vm.peek(page2Unused) === 0, "page-2 clear removes stale graphics bytes");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);