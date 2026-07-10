// swarm.test.mjs — validates the STAR SWARM sprite engine (milestone M1).
//   A) build_rows : ROWL/ROWH[y] vs the hi-res address formula (all 192 rows)
//   B) draw_sprite: a sprite renders exactly per its bitmap, with the right
//                   pixel count and nothing bleeding outside its box
//   C) xor-erase  : drawing a sprite twice leaves the screen black
//   D) clip       : sprites straddling the left / right / bottom edges are
//                   clipped (on-screen part exact, nothing wraps around)
//
// Run:  node codegen/tools/swarm.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "swarm", "swarm.s");

let failures = 0;
const ok = (cond, msg) => { if (cond) { console.log("  PASS " + msg); } else { console.log("  FAIL " + msg); failures++; } };

const haddr = (y) => 0x2000 + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;

const src = readFileSync(SRC, "utf8");
const { org, bytes, symbols: S } = assemble(src);
console.log(`assembled swarm.s: ${bytes.length} bytes @ $${org.toString(16)} (ends $${(org + bytes.length).toString(16)})`);

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
const boxLit = (x0, y0, x1, y1) => { let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) n += getpix(x, y); return n; };

// decode a sprite straight out of loaded RAM: H, W, then H rows of a 16-bit
// mask (hi byte first), leftmost pixel = bit15.
function decodeSprite(addr) {
  const H = vm.peek(addr), W = vm.peek(addr + 1);
  const rows = [];
  let pop = 0;
  for (let r = 0; r < H; r++) {
    const hi = vm.peek(addr + 2 + r * 2), lo = vm.peek(addr + 3 + r * 2);
    const mask = (hi << 8) | lo;
    const row = [];
    for (let x = 0; x < W; x++) { const b = (mask & (0x8000 >> x)) ? 1 : 0; row.push(b); pop += b; }
    rows.push(row);
  }
  return { H, W, rows, pop };
}

function drawSprite(sprAddr, x, y) {
  pokeS16(S.SPRPTR, sprAddr);   // zero-page (sprptr),y source
  pokeS16(S.SX, x);             // SX + SXH (16-bit signed)
  vm.poke(S.SY, y & 0xff);
  runHook(S.SPRITE_BRK, `sprite@(${x},${y})`);
}

// ---- M2 input / frame helpers ----
const press = (k) => vm.poke(0xC000, k);      // key codes already carry bit7
const clearKey = () => vm.poke(0xC000, 0);
const frame = () => runHook(S.FRAME_BRK, "frame");
const initCannon = () => runHook(S.INIT_BRK, "init cannon");
const canx = () => vm.peek(S.CANXL) | (vm.peek(S.CANXH) << 8);
const shtact = () => vm.peek(S.SHTACT);
const shotx = () => vm.peek(S.SHTXL) | (vm.peek(S.SHTXH) << 8);
const shty = () => vm.peek(S.SHTY);
// ---- M4 formation helpers ----
const bx = () => vm.peek(S.BXL) | (vm.peek(S.BXH) << 8);
const by = () => vm.peek(S.BY);
const mdir = () => vm.peek(S.MDIR);
const mcur = () => vm.peek(S.MCUR);
const livecnt = () => vm.peek(S.LIVECNT);
const playfieldLit = () => boxLit(0, 0, 279, 159);
const RANK = [0, 1, 1, 2, 2];
const ROWY = [0, 12, 24, 36, 48];
const SPRADDR = [S.SPR_A0, S.SPR_A1, S.SPR_B0, S.SPR_B1, S.SPR_C0, S.SPR_C1];
// does alien `i` render exactly at origin (ox,oy) with the given frame?
function alienExact(i, ox, oy, frame) {
  const row = i >> 3, col = i & 7;
  const spr = decodeSprite(SPRADDR[RANK[row] * 2 + frame]);
  const x = ox + col * 16, y = oy + ROWY[row];
  for (let r = 0; r < spr.H; r++)
    for (let c = 0; c < spr.W; c++)
      if (getpix(x + c, y + r) !== spr.rows[r][c]) return false;
  return true;
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

// ===== B) draw_sprite: exact bitmap render ==================================
console.log("B) draw_sprite: renders exactly per bitmap, right count, clean box");
{
  runHook(S.CLEAR_BRK, "clear");
  const spr = decodeSprite(S.SPR_CANNON);
  const px = 100, py = 120;
  drawSprite(S.SPR_CANNON, px, py);
  let exact = true;
  for (let r = 0; r < spr.H; r++)
    for (let x = 0; x < spr.W; x++)
      if (getpix(px + x, py + r) !== spr.rows[r][x]) exact = false;
  ok(exact, "cannon: every pixel matches its bitmap");
  ok(boxLit(px, py, px + spr.W - 1, py + spr.H - 1) === spr.pop,
     `cannon: exactly ${spr.pop} pixels lit, none extra`);
  ok(getpix(px + 7, py), "cannon: barrel-tip pixel (col7,row0) lit");
  // a one-pixel border around the box must stay black
  const ring = boxLit(px - 1, py - 1, px + spr.W, py + spr.H) - boxLit(px, py, px + spr.W - 1, py + spr.H - 1);
  ok(ring === 0, "cannon: nothing bleeds outside the sprite box");

  // a second, different sprite renders exactly too (crab-rank alien)
  runHook(S.CLEAR_BRK, "clear");
  const a = decodeSprite(S.SPR_B0);
  drawSprite(S.SPR_B0, 60, 40);
  let exact2 = true;
  for (let r = 0; r < a.H; r++)
    for (let x = 0; x < a.W; x++)
      if (getpix(60 + x, 40 + r) !== a.rows[r][x]) exact2 = false;
  ok(exact2, "alien B0: every pixel matches its bitmap");
  ok(boxLit(60, 40, 60 + a.W - 1, 40 + a.H - 1) === a.pop, `alien B0: exactly ${a.pop} pixels lit`);
}

// ===== C) xor-erase =========================================================
console.log("C) xor: drawing a sprite twice erases it");
{
  runHook(S.CLEAR_BRK, "clear");
  drawSprite(S.SPR_A0, 50, 40);
  const before = boxLit(40, 30, 80, 60);
  drawSprite(S.SPR_A0, 50, 40);
  const after = boxLit(40, 30, 80, 60);
  ok(before > 10, `sprite drew pixels (got ${before})`);
  ok(after === 0, `second pass cleared them all (residual ${after})`);
}

// ===== D) clip: off-screen parts dropped, not wrapped =======================
console.log("D) clip: left / right / bottom edges");
{
  // helper: draw sprite at (x,y); every on-screen pixel must match the bitmap
  function checkClip(sprAddr, x, y) {
    const spr = decodeSprite(sprAddr);
    runHook(S.CLEAR_BRK, "clear");
    drawSprite(sprAddr, x, y);
    let exact = true;
    for (let r = 0; r < spr.H; r++) {
      for (let c = 0; c < spr.W; c++) {
        const sxp = x + c, syp = y + r;
        if (sxp >= 0 && sxp < 280 && syp >= 0 && syp < 160) {
          if (getpix(sxp, syp) !== spr.rows[r][c]) exact = false;
        }
      }
    }
    return { spr, exact };
  }

  // left edge: sprite pushed 4px off the left
  {
    const { exact } = checkClip(S.SPR_B0, -4, 40);
    ok(exact, "left-clip: on-screen columns match the bitmap");
    let wrap = 0; for (let yy = 40; yy < 48; yy++) for (let xx = 272; xx < 280; xx++) wrap += getpix(xx, yy);
    ok(wrap === 0, "left-clip: nothing wrapped to the right edge");
  }
  // right edge: sprite (W=12) pushed past x=279
  {
    const { exact } = checkClip(S.SPR_B0, 274, 40);
    ok(exact, "right-clip: on-screen columns match the bitmap");
    let wrap = 0; for (let yy = 40; yy < 48; yy++) for (let xx = 0; xx < 8; xx++) wrap += getpix(xx, yy);
    ok(wrap === 0, "right-clip: nothing wrapped to the left edge");
  }
  // bottom edge: sprite (H=8) crossing the y=160 playfield floor
  {
    const { exact } = checkClip(S.SPR_A0, 100, 156);
    ok(exact, "bottom-clip: on-screen rows match the bitmap");
    // rows 160..163 belong to the HUD text band — must stay untouched
    let below = boxLit(100, 160, 111, 163);
    ok(below === 0, "bottom-clip: nothing drawn below the playfield floor");
  }
}

// ===== E) cannon: init + first draw =========================================
console.log("E) cannon: spawns centred and renders");
{
  runHook(S.CLEAR_BRK, "clear");
  initCannon();
  clearKey();
  frame();                                // first frame draws the cannon
  ok(canx() === 132, `cannon starts at x=132 (got ${canx()})`);
  const spr = decodeSprite(S.SPR_CANNON);
  let exact = true;
  for (let r = 0; r < spr.H; r++)
    for (let x = 0; x < spr.W; x++)
      if (getpix(132 + x, 148 + r) !== spr.rows[r][x]) exact = false;
  ok(exact, "cannon renders exactly at (132,148)");
  ok(vm.peek(S.CANDRAWN) === 1, "cannon marked drawn");
}

// ===== F) cannon: movement + edge clamps ====================================
console.log("F) cannon: moves under held keys and clamps at both edges");
{
  // a real Apple II clears the key strobe on read, so a held key re-latches
  // via auto-repeat — simulate that by re-pressing each frame.
  const hold = (k, n) => { for (let i = 0; i < n; i++) { press(k); frame(); } };

  runHook(S.CLEAR_BRK, "clear");
  initCannon();
  clearKey(); frame();                     // draw at 132
  hold(S.K_D, 5);                          // 5 * 3 px right
  ok(canx() === 132 + 15, `held D moves right to 147 (got ${canx()})`);

  hold(S.K_D, 80);                         // keep holding into the wall
  ok(canx() === 265, `clamps at right edge 265 (got ${canx()})`);

  hold(S.K_LARR, 120);                     // hold left past the wall
  ok(canx() === 0, `clamps at left edge 0 (got ${canx()})`);

  // release: cannon coasts out its hold-timer then stops for good
  clearKey(); press(S.K_D); frame(); clearKey();
  for (let i = 0; i < 12; i++) frame();
  const a = canx();
  for (let i = 0; i < 12; i++) frame();
  ok(canx() === a, `cannon halts after key release (${a} == ${canx()})`);
}

// ===== G) cannon: erase-redraw leaves no trail ==============================
console.log("G) cannon: XOR erase-redraw leaves exactly one cannon");
{
  const pop = decodeSprite(S.SPR_CANNON).pop;
  runHook(S.CLEAR_BRK, "clear");
  initCannon();
  clearKey(); frame();                      // draw at 132
  press(S.K_D);
  for (let i = 0; i < 4; i++) frame();       // slide right a few steps
  clearKey();
  let band = 0;
  for (let y = 148; y <= 155; y++) for (let x = 0; x < 280; x++) band += getpix(x, y);
  ok(band === pop, `one cannon on screen, no trail (got ${band}, want ${pop})`);
}

// ===== H) shot: fire spawns one bolt from the muzzle ========================
console.log("H) shot: SPACE fires a bolt from the muzzle");
{
  runHook(S.CLEAR_BRK, "clear");
  initCannon();
  clearKey(); frame();                      // cannon centred, no shot
  ok(shtact() === 0, "no bolt before firing");
  press(S.K_SPACE); frame();                // fire
  ok(shtact() === 1, "SPACE spawns a bolt");
  ok(shotx() === 132 + 7, `bolt at muzzle x = canx+7 (got ${shotx()})`);
  ok(shty() === 144 - 6, `bolt rose one step to y=138 (got ${shty()})`);
  // the 4-tall, 1-wide bolt is lit at its column, dark either side
  const bx = shotx(), by = shty();
  let col = 0; for (let r = 0; r < 4; r++) col += getpix(bx, by + r);
  ok(col === 4, "bolt is a 4px vertical bar");
  ok(!getpix(bx - 1, by) && !getpix(bx + 1, by), "bolt is one pixel wide");
}

// ===== I) shot: rises autonomously, leaves no trail =========================
console.log("I) shot: climbs on its own, XOR erase leaves no trail");
{
  runHook(S.CLEAR_BRK, "clear");
  initCannon();
  clearKey(); frame();
  press(S.K_SPACE); frame();                // fire -> y=138
  clearKey();
  const y0 = shty();
  frame();                                  // no keys: bolt still climbs
  ok(shty() === y0 - 6, `bolt climbs unattended (${y0} -> ${shty()})`);
  // exactly one 4px bolt anywhere on the playfield (no smear)
  let lit = 0;
  for (let y = 0; y < 160; y++) for (let x = 0; x < 280; x++) lit += getpix(x, y);
  // cannon (74) + one bolt (4) = 78
  ok(lit === 74 + 4, `one cannon + one bolt on screen, no trail (got ${lit})`);
}

// ===== J) shot: only one bolt in flight at a time ===========================
console.log("J) shot: cannot fire a second bolt while one is flying");
{
  runHook(S.CLEAR_BRK, "clear");
  initCannon();
  clearKey(); frame();
  press(S.K_SPACE); frame();                // fire -> y=138
  clearKey();
  frame(); frame();                         // climb to y=126
  const yMid = shty();
  press(S.K_SPACE); frame();                // try to fire again mid-flight
  ok(shty() === yMid - 6, `in-flight bolt keeps climbing, not restarted (${yMid} -> ${shty()})`);
  ok(shty() !== 138, "no fresh bolt spawned at the muzzle");
}

// ===== K) shot: retires off the top, freeing the next shot ==================
console.log("K) shot: expires at the top and re-arms");
{
  runHook(S.CLEAR_BRK, "clear");
  initCannon();
  clearKey(); frame();
  press(S.K_SPACE); frame();                // fire
  clearKey();
  for (let i = 0; i < 30; i++) frame();     // let it fly off the top
  ok(shtact() === 0, "bolt retired after leaving the top");
  // no bolt residue in the upper playfield (only the cannon remains)
  let lit = 0;
  for (let y = 0; y < 140; y++) for (let x = 0; x < 280; x++) lit += getpix(x, y);
  ok(lit === 0, `no bolt pixels left above the cannon (got ${lit})`);
  press(S.K_SPACE); frame();                // fire again
  ok(shtact() === 1, "can fire again once the bolt is gone");
}

// ===== L) formation: initial render =========================================
console.log("L) formation: 40 aliens paint at their cells, ready to march");
{
  runHook(S.CLEAR_BRK, "clear");
  runHook(S.INITFORM_BRK, "init formation");
  ok(livecnt() === 40, `40 aliens alive (got ${livecnt()})`);
  ok(bx() === 20 && by() === 12, `block origin at (20,12) (got ${bx()},${by()})`);
  ok(mdir() === 1, "heading right");
  ok(mcur() === 40, "cursor primed past the end");
  ok(alienExact(0, 20, 12, 0), "rank-A alien 0 at (20,12)");
  ok(alienExact(7, 20, 12, 0), "rank-A alien 7 at right of top row");
  ok(alienExact(8, 20, 12, 0), "rank-B alien 8 on row 1");
  ok(alienExact(24, 20, 12, 0), "rank-C alien 24 on row 3");
  const a0 = decodeSprite(S.SPR_A0).pop, b0 = decodeSprite(S.SPR_B0).pop, c0 = decodeSprite(S.SPR_C0).pop;
  ok(playfieldLit() === 8 * a0 + 16 * b0 + 16 * c0, "exact whole-swarm pixel budget (frame 0)");
}

// ===== M) formation: ripple march ===========================================
console.log("M) formation: one alien ripples per step; a full sweep = one move");
{
  runHook(S.CLEAR_BRK, "clear");
  runHook(S.INITFORM_BRK, "init formation");
  runHook(S.MARCH_BRK, "step 1");           // commit pass -> block to 22, move alien 0
  ok(bx() === 22, `first sweep-commit advances block to 22 (got ${bx()})`);
  ok(mcur() === 1, "cursor at 1");
  ok(alienExact(0, 22, 12, 1), "swept alien 0 at new origin, frame toggled");
  ok(alienExact(1, 20, 12, 0), "un-swept alien 1 still at old origin, frame 0");
  for (let i = 0; i < 39; i++) runHook(S.MARCH_BRK, "sweep");  // finish the pass
  ok(mcur() === 40, "cursor completed the sweep");
  ok(bx() === 22, "block still at 22 until next commit");
  ok(alienExact(39, 22, 12, 1), "last alien swept to new origin");
  const a1 = decodeSprite(S.SPR_A1).pop, b1 = decodeSprite(S.SPR_B1).pop, c1 = decodeSprite(S.SPR_C1).pop;
  ok(playfieldLit() === 8 * a1 + 16 * b1 + 16 * c1, "one frame-1 copy of each alien, no trails");
}

// ===== N) formation: edge bounce + drop =====================================
console.log("N) formation: steps, then drops and reverses at each wall");
{
  const setBlock = (x, yy, dir) => { pokeS16(S.BXL, x); vm.poke(S.BY, yy); vm.poke(S.MDIR, dir); };
  // all 40 still alive from L/M -> live columns span 0..7
  setBlock(50, 30, 1);
  runHook(S.ADVANCE_BRK, "step right");
  ok(bx() === 52 && by() === 30 && mdir() === 1, `steps right mid-field (${bx()},${by()},${mdir()})`);

  setBlock(154, 30, 1);
  runHook(S.ADVANCE_BRK, "right wall");
  ok(bx() === 154 && by() === 38 && mdir() === 0xFF, `drops+reverses at right wall (${bx()},${by()},${mdir()})`);

  setBlock(50, 30, 0xFF);
  runHook(S.ADVANCE_BRK, "step left");
  ok(bx() === 48 && mdir() === 0xFF, `steps left mid-field (got ${bx()})`);

  setBlock(1, 30, 0xFF);
  runHook(S.ADVANCE_BRK, "left wall");
  ok(bx() === 1 && by() === 38 && mdir() === 1, `drops+reverses at left wall (${bx()},${by()},${mdir()})`);
}

// ---- M5 combat helpers ----
const initAll = () => runHook(S.INITALL_BRK, "init all");
const score0 = () => vm.peek(S.SCORE0);
const lives = () => vm.peek(S.LIVES);
const aliveAt = (i) => vm.peek(S.ALIVE + i);
const setAlive = (i, v) => vm.poke(S.ALIVE + i, v);
const setBolt = (x, y) => { pokeS16(S.SHTXL, x); vm.poke(S.SHTY, y & 0xff); vm.poke(S.SHTACT, 1); };
const bombCount = () => { let n = 0; for (let i = 0; i < 4; i++) n += vm.peek(S.BACT + i) ? 1 : 0; return n; };
const bombSlot = () => { for (let i = 0; i < 4; i++) if (vm.peek(S.BACT + i)) return i; return -1; };
const bombX = (i) => vm.peek(S.BXLO + i) | (vm.peek(S.BXHI + i) << 8);
const bombY = (i) => vm.peek(S.BYY + i);
const bombOn = (i) => vm.peek(S.BACT + i);
const clearBombs = () => { for (let i = 0; i < 4; i++) { vm.poke(S.BACT + i, 0); vm.poke(S.BDRAWN + i, 0); } };
const setBomb = (i, x, y) => {
  vm.poke(S.BACT + i, 1);
  vm.poke(S.BXLO + i, x & 0xff); vm.poke(S.BXHI + i, (x >> 8) & 0xff);
  vm.poke(S.BYY + i, y & 0xff); vm.poke(S.BDRAWN + i, 0);
};
const A0POP = () => decodeSprite(S.SPR_A0).pop;

// ===== O) bolt kills the alien it overlaps ==================================
console.log("O) bolt: overlapping a live alien kills it, scores, and is consumed");
{
  runHook(S.CLEAR_BRK, "clear");
  initAll();
  ok(livecnt() === 40 && lives() === 3 && score0() === 0, "clean start: 40 aliens, 3 lives, score 0");
  const litBefore = playfieldLit(), a0 = A0POP();
  setBolt(25, 14);                          // inside alien 0's box (x20..31, y12..19)
  runHook(S.BOLTHIT_BRK, "bolt hit");
  ok(livecnt() === 39, `swarm down one (got ${livecnt()})`);
  ok(aliveAt(0) === 0, "alien 0 marked dead");
  ok(shtact() === 0, "bolt consumed by the hit");
  ok(score0() === 0x30, `rank-A kill scores 30 BCD (got ${score0().toString(16)})`);
  ok(boxLit(20, 12, 31, 19) === 0, "alien 0 fully erased from the screen");
  ok(alienExact(1, 20, 12, 0), "neighbour alien 1 untouched");
  ok(playfieldLit() === litBefore - a0, "exactly one alien's worth of pixels removed");
  runHook(S.BOLTHIT_BRK, "no bolt");        // shtact=0 -> nothing happens
  ok(livecnt() === 39 && score0() === 0x30, "no bolt in flight -> no further kills");
}

// ===== P) bolt misses when it overlaps nothing ==============================
console.log("P) bolt: a bolt clear of the swarm kills nothing");
{
  runHook(S.CLEAR_BRK, "clear");
  initAll();
  setBolt(200, 100);                        // right of and below the whole swarm
  runHook(S.BOLTHIT_BRK, "bolt miss");
  ok(livecnt() === 40, "no alien removed");
  ok(shtact() === 1, "bolt keeps flying");
  ok(score0() === 0, "no score");
}

// ===== Q) scoring by rank, accumulated in BCD ===============================
console.log("Q) bolt: rank A/B/C award 30/20/10, summed in BCD");
{
  runHook(S.CLEAR_BRK, "clear");
  initAll();
  setBolt(25, 14);  runHook(S.BOLTHIT_BRK, "kill A");   // alien 0  row0 rank A
  ok(score0() === 0x30 && livecnt() === 39, `A -> 30 (got ${score0().toString(16)})`);
  setBolt(25, 26);  runHook(S.BOLTHIT_BRK, "kill B");   // alien 8  row1 rank B (y=24)
  ok(score0() === 0x50 && livecnt() === 38, `+B -> 50 (got ${score0().toString(16)})`);
  setBolt(25, 62);  runHook(S.BOLTHIT_BRK, "kill C");   // alien 32 row4 rank C (y=60)
  ok(score0() === 0x60 && livecnt() === 37, `+C -> 60 (got ${score0().toString(16)})`);
}

// ===== R) score carries out of the low byte in BCD ==========================
console.log("R) score: BCD carry propagates past 99");
{
  runHook(S.CLEAR_BRK, "clear");
  initAll();
  vm.poke(S.SCORE0, 0x80); vm.poke(S.SCORE1, 0x00);
  setBolt(25, 14);  runHook(S.BOLTHIT_BRK, "kill A");   // +30 -> 0x80+0x30 = 110
  ok(vm.peek(S.SCORE0) === 0x10 && vm.peek(S.SCORE1) === 0x01,
     `80 + 30 = 0110 BCD (got ${vm.peek(S.SCORE1).toString(16)}${vm.peek(S.SCORE0).toString(16).padStart(2,"0")})`);
}

// ===== S) alien bomb spawns from a column's lowest alien ====================
console.log("S) bomb: a drop launches from the bottom rank of a live column");
{
  runHook(S.CLEAR_BRK, "clear");
  initAll();
  clearBombs();
  runHook(S.SPAWN_BRK, "spawn");
  ok(bombCount() === 1, `exactly one bomb launched (got ${bombCount()})`);
  const b = bombSlot();
  ok(bombY(b) === 68, `bomb starts below the row-4 alien (12+48+8=68, got ${bombY(b)})`);
  const col = (bombX(b) - 25) / 16;
  ok(Number.isInteger(col) && col >= 0 && col <= 7, `bomb x aligns to a column (got x=${bombX(b)}, col=${col})`);
}

// ===== T) bomb comes from the lowest LIVE alien =============================
console.log("T) bomb: with row 4 cleared, drops originate from row 3");
{
  runHook(S.CLEAR_BRK, "clear");
  initAll();
  for (let i = 32; i < 40; i++) setAlive(i, 0);   // wipe the bottom rank
  clearBombs();
  runHook(S.SPAWN_BRK, "spawn");
  ok(bombCount() === 1, "a bomb still launches");
  ok(bombY(bombSlot()) === 56, `now from row 3 (12+36+8=56, got ${bombY(bombSlot())})`);
}

// ===== U) bomb falls and retires at the ground ==============================
console.log("U) bomb: falls at a steady rate and dies at the ground line");
{
  runHook(S.CLEAR_BRK, "clear");
  initAll();
  clearBombs();
  vm.poke(S.BOMBCD, 250);                  // keep the spawner quiet during the fall
  setBomb(0, 100, 100);
  runHook(S.UPDBOMB_BRK, "fall 1");
  ok(bombY(0) === 103 && bombOn(0) === 1, `descends BOMB_STEP per frame (100 -> ${bombY(0)})`);
  for (let i = 0; i < 25; i++) runHook(S.UPDBOMB_BRK, "fall");
  ok(bombOn(0) === 0, "bomb retired once it reaches the ground");
}

// ===== V) bomb striking the cannon costs a life ============================
console.log("V) bomb: a hit on the cannon docks a life; a near miss does not");
{
  runHook(S.CLEAR_BRK, "clear");
  initAll();                                // cannon at x=132, lives=3
  clearBombs();
  setBomb(0, 138, 150);                     // inside the cannon box (132..146, 148..155)
  runHook(S.BOMBHIT_BRK, "cannon hit");
  ok(lives() === 2, `life lost (got ${lives()})`);
  ok(bombOn(0) === 0, "the bomb is spent");

  initAll();                                // fresh cannon + lives
  clearBombs();
  setBomb(0, 10, 150);                      // far to the left of the cannon
  runHook(S.BOMBHIT_BRK, "near miss");
  ok(lives() === 3, "clear of the cannon -> no life lost");
  ok(bombOn(0) === 1, "the bomb keeps falling");
}

// ---- M6 bunker/saucer helpers ----
const initBunkers = () => runHook(S.INITBUNK_BRK, "init bunkers");
const ufoOn = () => vm.peek(S.UFOACT);
const ufoX = () => vm.peek(S.UFOXL) | (vm.peek(S.UFOXH) << 8);
const score1 = () => vm.peek(S.SCORE1);
const BUNKERS = [30, 100, 170, 240];
function bunkerExact(x0) {
  const spr = decodeSprite(S.SPR_BUNKER);
  for (let r = 0; r < spr.H; r++)
    for (let c = 0; c < spr.W; c++)
      if (getpix(x0 + c, S.BUNK_Y + r) !== spr.rows[r][c]) return false;
  return true;
}
const bunkerLit = (x0) => boxLit(x0, S.BUNK_Y, x0 + S.BUNK_W - 1, S.BUNK_Y + S.BUNK_H - 1);

// ===== W) bunkers: four shields paint on the defensive line =================
console.log("W) bunkers: NBUNK shields render exactly above the cannon");
{
  runHook(S.CLEAR_BRK, "clear");
  initBunkers();
  const pop = decodeSprite(S.SPR_BUNKER).pop;
  let allExact = true;
  for (const x0 of BUNKERS) if (!bunkerExact(x0)) allExact = false;
  ok(allExact, "all four shields match the bunker bitmap");
  ok(playfieldLit() === 4 * pop, `exactly 4 shields' worth of pixels (${4 * pop})`);
  ok(S.BUNK_Y === 128, "shields sit in the band above the cannon");
}

// ===== X) bolt bites a shield and is spent ==================================
console.log("X) bunker: a bolt hitting a shield erodes it and is consumed");
{
  runHook(S.CLEAR_BRK, "clear");
  initBunkers();
  const before = bunkerLit(30);
  setBolt(35, 131);                          // solid part of shield 0
  runHook(S.SHOTBUNK_BRK, "bolt vs bunker");
  ok(shtact() === 0, "bolt consumed by the shield");
  ok(getpix(35, 131) === 0, "impact point cleared");
  ok(before - bunkerLit(30) === 16, "a 4x4 bite was taken out of the shield");
  ok(getpix(40, 131) === 1, "shield material away from the bite is intact");
}

// ===== Y) a bolt in the arch slips past the shield ==========================
console.log("Y) bunker: a bolt lined up with the arch gap is not stopped");
{
  runHook(S.CLEAR_BRK, "clear");
  initBunkers();
  const before = bunkerLit(30);
  setBolt(36, 137);                          // under the arch notch (empty)
  runHook(S.SHOTBUNK_BRK, "bolt in the gap");
  ok(shtact() === 1, "bolt keeps climbing through the gap");
  ok(bunkerLit(30) === before, "shield untouched");
}

// ===== Z) an alien bomb bites a shield too ==================================
console.log("Z) bunker: an alien bomb erodes a shield and is spent");
{
  runHook(S.CLEAR_BRK, "clear");
  initBunkers();
  clearBombs();
  const before = bunkerLit(100);
  setBomb(0, 104, 128);                       // bottom edge (132) lands on shield 1
  runHook(S.BOMBBUNK_BRK, "bomb vs bunker");
  ok(bombOn(0) === 0, "bomb consumed by the shield");
  ok(getpix(105, 132) === 0, "impact point cleared");
  ok(bunkerLit(100) < before, "shield lost material to the bomb");
}

// ===== AA) mystery saucer: spawns at an edge and glides inward ==============
console.log("AA) saucer: launches from an edge and moves at a steady speed");
{
  runHook(S.CLEAR_BRK, "clear");
  initCannon();                               // ufoact=0, ufocd armed
  runHook(S.SPAWNUFO_BRK, "spawn saucer");
  ok(ufoOn() === 1, "saucer is on screen");
  const dir = vm.peek(S.UFODIR);
  ok((dir === 1 && ufoX() === 0) || (dir === 0xFF && ufoX() === 264),
     `saucer enters from an edge (dir=${dir}, x=${ufoX()})`);
  vm.poke(S.UFODIR, 1); vm.poke(S.UFOXL, 0); vm.poke(S.UFOXH, 0); vm.poke(S.UFOACT, 1);
  runHook(S.UPDUFO_BRK, "glide");
  ok(ufoX() === 2, `advances UFO_STEP per frame (got ${ufoX()})`);
  runHook(S.UPDUFO_BRK, "glide");
  ok(ufoX() === 4, `keeps gliding (got ${ufoX()})`);
}

// ===== BB) saucer: a bolt knocks it down for a 100-point bonus ==============
console.log("BB) saucer: a bolt hit banks 100 and clears the saucer; a miss does not");
{
  runHook(S.CLEAR_BRK, "clear");
  initCannon();
  vm.poke(S.UFOACT, 1); vm.poke(S.UFOXL, 100); vm.poke(S.UFOXH, 0); vm.poke(S.UFODIR, 1);
  vm.poke(S.SCORE1, 0);
  setBolt(105, 4);                            // inside the saucer box (100..115, y2..8)
  runHook(S.SHOTUFO_BRK, "bolt vs saucer");
  ok(ufoOn() === 0, "saucer knocked out");
  ok(shtact() === 0, "bolt consumed");
  ok(score1() === 0x01, `+100 banked (hundreds digit, got ${score1().toString(16)})`);

  vm.poke(S.UFOACT, 1); vm.poke(S.UFOXL, 200); vm.poke(S.UFOXH, 0);
  vm.poke(S.SCORE1, 0);
  setBolt(105, 4);                            // saucer now far to the right
  runHook(S.SHOTUFO_BRK, "bolt misses saucer");
  ok(ufoOn() === 1 && shtact() === 1 && score1() === 0, "a clean miss changes nothing");
}

// ===== CC) saucer: glides off either edge and is gone =======================
console.log("CC) saucer: retires once it leaves the screen");
{
  runHook(S.CLEAR_BRK, "clear");
  initCannon();
  vm.poke(S.UFOACT, 1); vm.poke(S.UFODIR, 1); pokeS16(S.UFOXL, 278);
  runHook(S.UPDUFO_BRK, "exit right");
  ok(ufoOn() === 0, "saucer gone off the right edge");
  vm.poke(S.UFOACT, 1); vm.poke(S.UFODIR, 0xFF); pokeS16(S.UFOXL, 0xFFF0); // x = -16
  runHook(S.UPDUFO_BRK, "exit left");
  ok(ufoOn() === 0, "saucer gone off the left edge");
}

// ---- M7 flow/HUD helpers ----
const gstate = () => vm.peek(S.GSTATE);
const gameover = () => vm.peek(S.GAMEOVER);
const wave = () => vm.peek(S.WAVE);
const respawnT = () => vm.peek(S.RESPAWN);
const newGame = () => runHook(S.NEWGAME_BRK, "new game");
const SNAP = [0x6B00, 0x6B28, 0x6B50, 0x6B78];   // hud_snapshot rows 20..23
const snapStr = (row, col, len) => {
  let str = "";
  for (let i = 0; i < len; i++) str += String.fromCharCode(vm.peek(SNAP[row] + col + i) & 0x7F);
  return str;
};

// ===== DD) attract -> SPACE launches a fresh game ===========================
console.log("DD) flow: the title screen starts a clean game when SPACE is pressed");
{
  runHook(S.ATTRACT_BRK, "enter attract");
  ok(gstate() === 0, "boots into the attract state");
  clearKey();
  runHook(S.FLOW_BRK, "attract tick, no key");
  ok(gstate() === 0, "with no key it stays on the title screen");
  press(0xA0);                                // SPACE
  runHook(S.FLOW_BRK, "attract tick, SPACE");
  ok(gstate() === 1, "SPACE switches to the play state");
  ok(livecnt() === 40, "a full swarm is deployed");
  ok(vm.peek(S.LIVES) === 3, "three cannons in reserve");
  ok(wave() === 1, "starting on wave 1");
  ok(vm.peek(S.SCORE0) === 0 && vm.peek(S.SCORE2) === 0, "score starts at zero");
}

// ===== EE) the swarm landing ends the game ==================================
console.log("EE) flow: the swarm reaching the invasion line is game over");
{
  newGame();
  vm.poke(S.BY, 80);                          // 80 + row4(48) + 8 = 136 < 140
  vm.poke(S.GAMEOVER, 0);
  runHook(S.LAND_BRK, "high but safe");
  ok(gameover() === 0, "still safe above the line");
  vm.poke(S.BY, 110);                         // 110 + 48 + 8 = 166 >= 140
  runHook(S.LAND_BRK, "past the line");
  ok(gameover() === 1, "the swarm has landed -> game over");
}

// ===== FF) losing a cannon: respawn, then the final life ====================
console.log("FF) flow: a hit costs a cannon and respawns; the last one ends it");
{
  newGame();                                  // lives=3, cannon at 132
  clearBombs();
  setBomb(0, 138, 150);                       // squarely on the cannon
  runHook(S.BOMBHIT_BRK, "cannon hit");
  ok(vm.peek(S.LIVES) === 2, "a cannon is lost");
  ok(gameover() === 0, "but the game continues");
  ok(respawnT() > 0, "a respawn grace window is armed");
  ok(canx() === 132, "the fresh cannon is re-centred");
  ok(bombOn(0) === 0, "the incoming bombs are cleared");

  vm.poke(S.LIVES, 1);
  clearBombs();
  setBomb(0, 138, 150);
  runHook(S.BOMBHIT_BRK, "final cannon hit");
  ok(vm.peek(S.LIVES) === 0, "the last cannon is gone");
  ok(gameover() === 1, "game over");
}

// ===== GG) clearing the swarm rolls into a fresh, harder wave ===============
console.log("GG) flow: clearing the swarm starts the next wave");
{
  newGame();                                  // wave=1
  vm.poke(S.LIVECNT, 0);                       // pretend the swarm was cleared
  vm.poke(S.BY, 99);                           // ... and had marched down
  runHook(S.NEXTWAVE_BRK, "next wave");
  ok(wave() === 2, "advanced to wave 2");
  ok(livecnt() === 40, "a fresh full swarm");
  ok(by() === 12, "the new swarm starts back at the top");
}

// ===== HH) the in-game HUD shows score, lives and wave ======================
console.log("HH) HUD: the play HUD prints SCORE, LIVES and WAVE");
{
  newGame();
  vm.poke(S.SCORE0, 0x50); vm.poke(S.SCORE1, 0x34); vm.poke(S.SCORE2, 0x12);
  vm.poke(S.LIVES, 2); vm.poke(S.WAVE, 3);
  runHook(S.HUD_BRK, "hud play");
  ok(snapStr(2, 0, 5) === "SCORE", "SCORE label present");
  ok(snapStr(2, 6, 6) === "123450", `score digits (got ${snapStr(2, 6, 6)})`);
  ok(snapStr(2, 18, 5) === "LIVES", "LIVES label present");
  ok(snapStr(2, 24, 1) === "2", "lives count shown");
  ok(snapStr(2, 28, 4) === "WAVE", "WAVE label present");
  ok(snapStr(2, 33, 1) === "3", "wave number shown");
}

// ===== II) the attract and game-over HUDs =================================
console.log("II) HUD: attract shows the title/prompt; game over shows GAME OVER");
{
  runHook(S.HUDATT_BRK, "hud attract");
  ok(snapStr(0, 15, 10) === "STAR SWARM", "title on the attract screen");
  ok(snapStr(2, 10, 19) === "PRESS SPACE TO PLAY", "start prompt");
  ok(snapStr(3, 13, 4) === "HIGH", "high-score label");

  runHook(S.HUDOVER_BRK, "hud over");
  ok(snapStr(0, 15, 9) === "GAME OVER", "game-over banner");
  ok(snapStr(2, 10, 5) === "SCORE", "final score label");
  ok(snapStr(3, 10, 19) === "PRESS SPACE TO PLAY", "restart prompt");
}

// ===== JJ) the high score only ratchets upward ==============================
console.log("JJ) flow: the high score keeps the best run");
{
  newGame();
  vm.poke(S.HISC0, 0); vm.poke(S.HISC1, 0); vm.poke(S.HISC2, 0);
  vm.poke(S.SCORE0, 0x00); vm.poke(S.SCORE1, 0x50); vm.poke(S.SCORE2, 0x00); // 005000
  runHook(S.HISCORE_BRK, "bank first score");
  ok(vm.peek(S.HISC1) === 0x50, "a new best is recorded");
  vm.poke(S.SCORE0, 0x00); vm.poke(S.SCORE1, 0x20); vm.poke(S.SCORE2, 0x00); // 002000
  runHook(S.HISCORE_BRK, "lower score");
  ok(vm.peek(S.HISC1) === 0x50, "a lower score does not overwrite the best");
  vm.poke(S.SCORE0, 0x00); vm.poke(S.SCORE1, 0x00); vm.poke(S.SCORE2, 0x01); // 010000
  runHook(S.HISCORE_BRK, "higher score");
  ok(vm.peek(S.HISC2) === 0x01, "a higher score takes the crown");
}

// ===== KK) game over -> SPACE restarts a clean game =========================
console.log("KK) flow: from game over, SPACE starts a brand new game");
{
  newGame();
  vm.poke(S.GSTATE, 2);                        // GS_OVER
  vm.poke(S.LIVES, 0);
  press(0xA0);                                // SPACE
  runHook(S.FLOW_BRK, "over tick, SPACE");
  ok(gstate() === 1, "back to the play state");
  ok(vm.peek(S.LIVES) === 3, "cannons restocked");
  ok(wave() === 1, "back to wave 1");
  ok(livecnt() === 40, "a fresh swarm");
}

// ===== summary ==============================================================
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);