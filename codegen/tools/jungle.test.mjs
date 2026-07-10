// jungle.test.mjs — validates the JUNGLE QUEST hi-res engine primitives against
// independent JS models:
//   A) build_rows : ROWL/ROWH[y] vs the hi-res address formula (all 192 rows)
//   B) plot       : single pixels land at the exact hi-res byte + bit
//   C) rect_erase : BG bytes are copied back onto SCREEN for the given rect only
//   D) draw_sprite: the hero blit lights exactly the sprite's pixels, including
//                   across 7-pixel byte boundaries (the shift/carry path)
//
// Run:  node codegen/tools/jungle.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "jungle", "jungle.s");

let failures = 0;
const ok = (cond, msg) => { if (cond) { console.log("  PASS " + msg); } else { console.log("  FAIL " + msg); failures++; } };

// hi-res address of pixel row y (Apple II interleave)
const haddr = (y) => 0x2000 + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;

// --- main -------------------------------------------------------------------
const src = readFileSync(SRC, "utf8");
const { org, bytes, symbols: S } = assemble(src);
console.log(`assembled jungle.s: ${bytes.length} bytes @ $${org.toString(16)} (ends $${(org + bytes.length).toString(16)})`);

const s = await boot();
const vm = s.vm;
s.load(bytes, org);

function runHook(entry, label) {
  const r = s.run({ org: entry, maxCycles: 8_000_000, chunk: 200_000 });
  if (r.halt !== "brk-monitor") throw new Error(`${label}: expected BRK halt, got ${r.halt} after ${r.cycles} cycles`);
  return r;
}
const pokeWord = (a, v) => { vm.poke(a, v & 0xFF); vm.poke(a + 1, (v >> 8) & 0xFF); };
const getpix = (x, y) => (vm.peek(haddr(y) + Math.floor(x / 7)) >> (x % 7)) & 1;

// ===== A) row-address table =================================================
console.log("A) build_rows: ROWL/ROWH == hi-res address formula");
runHook(S.BUILD_BRK, "build_brk");
{
  let all = true, firstBad = null;
  for (let y = 0; y < 192; y++) {
    const lo = vm.peek(S.ROWL + y), hi = vm.peek(S.ROWH + y);
    const got = lo | (hi << 8), exp = haddr(y);
    if (got !== exp) { all = false; if (firstBad === null) firstBad = y; }
  }
  ok(all, all ? "all 192 rows match" : `row ${firstBad} wrong (got $${(vm.peek(S.ROWL+firstBad)|(vm.peek(S.ROWH+firstBad)<<8)).toString(16)} exp $${haddr(firstBad).toString(16)})`);
}

// ===== B) plot ==============================================================
console.log("B) plot: single pixels at exact byte + bit");
{
  runHook(S.CLEAR_BRK, "clear_screen");
  // points chosen to hit distinct bytes, various bit offsets and rows,
  // including x that spans the 7-pixel boundary (x=6 vs 7) and wide x (>255).
  const pts = [[0, 0], [6, 0], [7, 1], [13, 5], [139, 100], [279, 191], [270, 64]];
  let all = true;
  for (const [x, y] of pts) {
    pokeWord(S.SX_LO, x); vm.poke(S.SY, y);
    runHook(S.PLOT_BRK, `plot(${x},${y})`);
    const byte = vm.peek(haddr(y) + Math.floor(x / 7));
    const exp = 1 << (x % 7);
    if (byte !== exp) { all = false; console.log(`    (${x},${y}) byte=$${byte.toString(16)} exp=$${exp.toString(16)}`); }
    // clear that byte again so the next point starts from a clean slate
    vm.poke(haddr(y) + Math.floor(x / 7), 0);
  }
  ok(all, "every plotted pixel is exactly one bit in the right byte");
}

// ===== C) rect_erase ========================================================
console.log("C) rect_erase: copies BG -> SCREEN for the rect only");
{
  const col = 5, y0 = 40, wb = 3, h = 6;
  // seed SCREEN with garbage and BG with a recognisable pattern over a wider area
  for (let dy = -1; dy <= h; dy++) {
    const y = y0 + dy;
    for (let c = col - 1; c <= col + wb; c++) {
      vm.poke(haddr(y) + c, 0xFF);                 // screen garbage
      vm.poke(haddr(y) + c + 0x2000, (y ^ c) & 0x7F); // BG pattern
    }
  }
  vm.poke(S.ER_COL, col); vm.poke(S.ER_Y, y0); vm.poke(S.ER_WB, wb); vm.poke(S.ER_H, h);
  runHook(S.ERASE_BRK, "rect_erase");
  let inside = true, outside = true;
  for (let dy = 0; dy < h; dy++) {
    const y = y0 + dy;
    for (let c = col; c < col + wb; c++) if (vm.peek(haddr(y) + c) !== ((y ^ c) & 0x7F)) inside = false;
    if (vm.peek(haddr(y) + col - 1) !== 0xFF) outside = false;   // column just left
    if (vm.peek(haddr(y) + col + wb) !== 0xFF) outside = false;  // column just right
  }
  if (vm.peek(haddr(y0 - 1) + col) !== 0xFF) outside = false;    // row above
  if (vm.peek(haddr(y0 + h) + col) !== 0xFF) outside = false;    // row below
  ok(inside, "rect interior copied from BG");
  ok(outside, "pixels outside the rect untouched");
}

// ===== D) hero sprite blit ==================================================
console.log("D) draw_sprite: hero lights exactly its pixels (incl. byte-boundary shift)");
{
  // hero bitmap from jungle.s (hi<<8 | lo), col c = bit (15-c), 12 wide
  const heroWords = [
    0x1E00, 0x3F00, 0x1E00, 0x1200, 0x1E00, 0x3F00, 0x6D80, 0x6D80,
    0x1E00, 0x1E00, 0x1200, 0x1200, 0x1200, 0x3300, 0x0000, 0x0000,
  ];
  const W = 12, Hh = heroWords.length;
  // draw at an x whose bit offset (x%7) forces the sprite across byte boundaries
  const testX = [130, 131, 200];
  let all = true;
  for (const px of testX) {
    const py = 60;
    runHook(S.CLEAR_BRK, "clear_screen");
    pokeWord(S.PX_LO, px); vm.poke(S.PY, py);
    runHook(S.SPRITE_BRK, "draw_player");
    let want = 0, litOk = true;
    for (let r = 0; r < Hh; r++) {
      for (let c = 0; c < W; c++) {
        if ((heroWords[r] >> (15 - c)) & 1) {
          want++;
          if (getpix(px + c, py + r) !== 1) litOk = false;
        }
      }
    }
    // count all lit pixels in the bounding box -> must equal `want` (no extras)
    let lit = 0;
    for (let r = 0; r < Hh; r++) for (let c = 0; c < W + 7; c++) lit += getpix(px + c, py + r);
    if (!litOk || lit !== want) { all = false; console.log(`    x=${px}: want=${want} lit=${lit} litOk=${litOk}`); }
  }
  ok(all, "hero pixels blit correctly at every tested x alignment");
}

// ===== E/F/G) physics =======================================================
const key = (v) => vm.poke(0xC000, v);
function resetPlayer(px, py = 122) {
  pokeWord(S.PX_LO, px); vm.poke(S.PY, py); vm.poke(S.YFRAC, 0);
  vm.poke(S.VY_LO, 0); vm.poke(S.VY_HI, 0);
  vm.poke(S.ONGROUND, 1); vm.poke(S.MOVETMR, 0); vm.poke(S.MOVEDIR, 0);
  vm.poke(S.JUMPREQ, 0); vm.poke(S.FACING, 0); vm.poke(S.LIVES, 3);
  vm.poke(S.CURSCR, 0); vm.poke(S.FLIPREQ, 0);        // screen-0 defaults
  vm.poke(S.CUR_PLC, 24); vm.poke(S.CUR_PRC, 30);     // pit cols 24..30
  vm.poke(S.HZ_ACTIVE, 1);                            // log present
  key(0);
}
const pxOf = () => vm.peek(S.PX_LO) | (vm.peek(S.PX_HI) << 8);

console.log("E) horizontal movement + momentum");
{
  resetPlayer(100);
  key(0xC4); runHook(S.STEP_BRK, "right");         // 'D'
  const after1 = pxOf();
  runHook(S.STEP_BRK, "coast");                    // no key: momentum carries
  const after2 = pxOf();
  ok(after1 === 102 && vm.peek(S.FACING) === 0, `right: 100 -> ${after1} (facing right)`);
  ok(after2 === 104, `momentum coasts one more step -> ${after2}`);
  resetPlayer(100);
  key(0xC1); runHook(S.STEP_BRK, "left");          // 'A'
  ok(pxOf() === 98 && vm.peek(S.FACING) === 1, `left: 100 -> ${pxOf()} (facing left)`);
  resetPlayer(0);
  key(0xC1); runHook(S.STEP_BRK, "left-clamp");
  ok(pxOf() === 0, `left clamps at 0 -> ${pxOf()}`);
}

console.log("F) jump arc rises then lands back on the ground");
{
  resetPlayer(100);
  key(0xA0); runHook(S.STEP_BRK, "jump");           // space
  const rising = vm.peek(S.PY), air = vm.peek(S.ONGROUND);
  ok(rising < 122 && air === 0, `takes off: py ${rising} < 122, airborne`);
  let minY = rising, landed = false;
  for (let f = 0; f < 60; f++) {
    runHook(S.STEP_BRK, `air ${f}`);
    const y = vm.peek(S.PY);
    if (y < minY) minY = y;
    if (vm.peek(S.ONGROUND) === 1) { landed = true; break; }
  }
  ok(minY < 110, `rises a meaningful height (apex py=${minY})`);
  ok(landed && vm.peek(S.PY) === 122, `lands back at STAND_Y (py=${vm.peek(S.PY)}, onground=${vm.peek(S.ONGROUND)})`);
}

console.log("G) walking over a pit falls in -> lose a life + respawn");
{
  resetPlayer(180);                                 // centre 186 is inside the pit
  let died = false;
  for (let f = 0; f < 60; f++) {
    runHook(S.STEP_BRK, `fall ${f}`);
    if (pxOf() === 20) { died = true; break; }       // respawned at SPAWN_X
  }
  ok(died, "player fell into the pit and respawned at the start");
  ok(vm.peek(S.LIVES) === 2, `lost exactly one life (lives=${vm.peek(S.LIVES)})`);
}

console.log("H) rolling log moves left and wraps");
{
  vm.poke(S.HZ_ACTIVE, 1);
  vm.poke(S.HZ_X_LO, 6); vm.poke(S.HZ_X_HI, 0);
  const seq = [];
  for (let i = 0; i < 4; i++) { runHook(S.LOGSTEP_BRK, `log ${i}`); seq.push(vm.peek(S.HZ_X_LO) | (vm.peek(S.HZ_X_HI) << 8)); }
  ok(seq[0] === 4 && seq[1] === 2 && seq[2] === 0, `rolls left 2px/frame (${seq.slice(0,3).join(",")})`);
  ok(seq[3] === S.LOG_MAX, `wraps back to LOG_MAX (${seq[3]})`);
}

console.log("I) log collision kills; clearing it by jumping does not");
{
  resetPlayer(100);                                 // standing at ground level
  vm.poke(S.HZ_X_LO, 100); vm.poke(S.HZ_X_HI, 0);   // log right on top of player
  runHook(S.COLL_BRK, "hit");
  ok(vm.peek(S.LIVES) === 2 && pxOf() === 20, `standing into the log costs a life + respawns (lives=${vm.peek(S.LIVES)})`);
  resetPlayer(100); vm.poke(S.PY, 90);              // mid-jump, above the log
  vm.poke(S.HZ_X_LO, 100); vm.poke(S.HZ_X_HI, 0);
  runHook(S.COLL_BRK, "clear");
  ok(vm.peek(S.LIVES) === 3 && pxOf() === 100, `jumping over the log is safe (lives=${vm.peek(S.LIVES)})`);
}

console.log("J) treasure pickup adds score and clears the treasure");
{
  resetPlayer(60);                                  // stand on treasure 0 (x=60)
  for (let i = 0; i < 6; i++) { vm.poke(S.TR_ON + i, 0); vm.poke(S.TR_SCR + i, 0); }
  vm.poke(S.TR_X + 0, 60); vm.poke(S.TR_X + 1, 120); vm.poke(S.TR_X + 2, 230);
  vm.poke(S.TR_Y + 0, 126); vm.poke(S.TR_Y + 1, 126); vm.poke(S.TR_Y + 2, 126);
  vm.poke(S.TR_ON + 0, 1); vm.poke(S.TR_ON + 1, 1); vm.poke(S.TR_ON + 2, 1);
  vm.poke(S.TRLEFT, 3);
  vm.poke(S.SCORE0, 0); vm.poke(S.SCORE1, 0); vm.poke(S.SCORE2, 0);
  vm.poke(S.GAMESTATE, 0);
  runHook(S.COLLECT_BRK, "collect");
  ok(vm.peek(S.TR_ON + 0) === 0 && vm.peek(S.TRLEFT) === 2, "treasure 0 collected, count drops to 2");
  ok(vm.peek(S.SCORE1) === 0x20 && vm.peek(S.SCORE0) === 0 && vm.peek(S.SCORE2) === 0, `score +2000 BCD (score1=$${vm.peek(S.SCORE1).toString(16)})`);
}

console.log("K) collecting the last treasure wins the game");
{
  resetPlayer(60);
  for (let i = 0; i < 6; i++) { vm.poke(S.TR_ON + i, 0); vm.poke(S.TR_SCR + i, 0); }
  vm.poke(S.TR_X + 0, 60); vm.poke(S.TR_Y + 0, 126); vm.poke(S.TR_ON + 0, 1);
  vm.poke(S.TRLEFT, 1); vm.poke(S.GAMESTATE, 0);
  runHook(S.COLLECT_BRK, "win");
  ok(vm.peek(S.TRLEFT) === 0 && vm.peek(S.GAMESTATE) === 1, `all collected -> gamestate=win (${vm.peek(S.GAMESTATE)})`);
}

console.log("J2) treasures on other screens are ignored");
{
  resetPlayer(60);
  for (let i = 0; i < 6; i++) { vm.poke(S.TR_ON + i, 0); vm.poke(S.TR_SCR + i, 0); }
  vm.poke(S.TR_X + 0, 60); vm.poke(S.TR_Y + 0, 126); vm.poke(S.TR_ON + 0, 1);
  vm.poke(S.TR_SCR + 0, 1);                          // gem lives on screen 1
  vm.poke(S.TRLEFT, 1); vm.poke(S.GAMESTATE, 0);
  runHook(S.COLLECT_BRK, "offscreen");
  ok(vm.peek(S.TR_ON + 0) === 1 && vm.peek(S.TRLEFT) === 1, "gem on another screen is not collected");
}

console.log("L) countdown timer reaches zero -> time up");
{
  vm.poke(S.TSEC, 1); vm.poke(S.TFRAME, 0); vm.poke(S.GAMESTATE, 0);
  for (let i = 0; i < 2 * 12 + 2; i++) runHook(S.TIMER_BRK, `tick ${i}`);
  ok(vm.peek(S.TSEC) === 0 && vm.peek(S.GAMESTATE) === 3, `timer hit 0 -> gamestate=time-up (${vm.peek(S.GAMESTATE)})`);
}

console.log("M) walking off a screen edge flips to the neighbouring screen");
{
  // right edge -> next screen, enter from the left
  resetPlayer(266);                                  // on the right platform, screen 0
  key(0xC4); runHook(S.STEP_BRK, "walk right off-edge");   // 'D'
  ok(vm.peek(S.CURSCR) === 1 && pxOf() === S.ENTER_L, `right edge -> screen ${vm.peek(S.CURSCR)}, x=${pxOf()}`);

  // left edge on an inner screen -> previous screen, enter from the right
  resetPlayer(0); vm.poke(S.CURSCR, 1);
  key(0xC1); runHook(S.STEP_BRK, "walk left off-edge");    // 'A'
  ok(vm.peek(S.CURSCR) === 0 && pxOf() === S.ENTER_R, `left edge -> screen ${vm.peek(S.CURSCR)}, x=${pxOf()}`);

  // left edge on the first screen -> clamp, no flip
  resetPlayer(0);
  key(0xC1); runHook(S.STEP_BRK, "walk left at world edge");
  ok(vm.peek(S.CURSCR) === 0 && pxOf() === 0, `world left edge clamps (screen ${vm.peek(S.CURSCR)}, x=${pxOf()})`);
}

console.log("N) grabbing the vine swings the hero across the wide pit");
{
  // screen 1: wide pit at cols 22..30, a vine anchored at x=168, no log
  resetPlayer(150, 100);                 // airborne over the pit, beside the vine
  vm.poke(S.CURSCR, 1);
  vm.poke(S.CUR_PLC, 22); vm.poke(S.CUR_PRC, 30);
  vm.poke(S.HZ_ACTIVE, 0);
  vm.poke(S.VINE_ON, 1); vm.poke(S.VINE_X, 168);
  vm.poke(S.ONVINE, 0); vm.poke(S.VPHASE, 0);
  vm.poke(S.ONGROUND, 0); vm.poke(S.VY_LO, 0); vm.poke(S.VY_HI, 0);
  let grabbed = false;
  for (let i = 0; i < 60; i++) {
    key(0); runHook(S.STEP_BRK, "vine frame");
    if (vm.peek(S.ONVINE) === 1) grabbed = true;
  }
  const centreCol = Math.floor((pxOf() + 6) / 7);
  ok(grabbed, "hero latched onto the vine");
  ok(vm.peek(S.ONVINE) === 0 && centreCol >= 30,
     `released on the far platform (x=${pxOf()}, col=${centreCol})`);
  ok(vm.peek(S.LIVES) === 3 && vm.peek(S.ONGROUND) === 1 && vm.peek(S.PY) === S.STAND_Y,
     `crossed safely and landed (lives=${vm.peek(S.LIVES)}, py=${vm.peek(S.PY)})`);

  // without the vine that same leap drops the hero into the pit
  resetPlayer(150, 100);
  vm.poke(S.CURSCR, 1);
  vm.poke(S.CUR_PLC, 22); vm.poke(S.CUR_PRC, 30);
  vm.poke(S.HZ_ACTIVE, 0);
  vm.poke(S.VINE_ON, 0);                 // vine disabled
  vm.poke(S.ONVINE, 0);
  vm.poke(S.ONGROUND, 0); vm.poke(S.VY_LO, 0); vm.poke(S.VY_HI, 0);
  for (let i = 0; i < 60; i++) { key(0); runHook(S.STEP_BRK, "no-vine frame"); }
  ok(vm.peek(S.LIVES) === 2, `no vine -> falls in and loses a life (lives=${vm.peek(S.LIVES)})`);
}

// ---------------------------------------------------------------------------
process.exit(failures === 0 ? 0 : 1);

