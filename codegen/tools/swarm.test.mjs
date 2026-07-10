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

// ===== summary ==============================================================
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
