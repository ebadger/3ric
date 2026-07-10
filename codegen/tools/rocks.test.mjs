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

// ===== M2: ship physics =====================================================
const SHIP = S.SHIP;
const O = { act:0, xf:1, xl:2, xh:3, yf:4, yl:5, yh:6, vxl:7, vxh:8, vyl:9, vyh:10, ang:11, drawn:12, life:13 };
const gb = (k) => vm.peek(SHIP + O[k]);
const sb = (k, v) => vm.poke(SHIP + O[k], v & 0xff);
const s8 = (v) => (v & 0x80 ? v - 256 : v);           // signed byte
const press = (k) => vm.poke(0xC000, k);              // key codes already carry bit7
const frame = () => runHook(S.FRAME_BRK, "frame");
const playfieldLit = () => boxLit(0, 0, 279, 159);

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
  let peak = 0;
  for (let i = 0; i < 50; i++) { press(0xA0); frame(); peak = Math.max(peak, activeBullets()); }
  ok(activeBullets() <= 5, `never more than 5 bullets (got ${activeBullets()})`);
  ok(peak >= 4, `fire cadence produced several coexisting bullets (peak ${peak})`);
}

// P) bullets wrap at the screen edges like the ship
console.log("P) bullet wraps at the top edge");
{
  runHook(S.INIT_BRK, "init");
  press(0xA0); frame();
  const bi = firstBullet();
  setbull(bi, "yf", 0); setbull(bi, "yl", 2); setbull(bi, "yh", 0);  // just below the top
  frame();
  ok(bull(bi, "yl") > 150, `bullet wrapped top -> bottom (y=${bull(bi, "yl")})`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);