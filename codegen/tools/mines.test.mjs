// mines.test.mjs — headless tests for emulator/AICodeGen/mines/mines.s
//
//   A) Boot: text mode on, "MINEFIELD" title and a hidden 16x16 grid render.
//   B) count_hook: deterministic neighbor counts for known mine layouts.
//   C) flood_hook: deterministic zero-region flood reveal without recursion.
//
// Run:  node codegen/tools/mines.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "mines", "mines.s");

const W = 16, H = 16, CELLS = W * H;
const GRIDTOP = 4, GRIDLEFT = 12;   // must match mines.s
const idx = (r, c) => r * W + c;

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  PASS " + msg); else { console.log("  FAIL " + msg); failures++; } };

const src = readFileSync(SRC, "utf8");
const { org, bytes, symbols: S } = assemble(src);
console.log(`assembled mines.s: ${bytes.length} bytes @ $${org.toString(16)} (ends $${(org + bytes.length).toString(16)})`);

const s = await boot();
const vm = s.vm;
s.load(bytes, org);

function runCycles(n) {
  let c = 0;
  while (c < n) { c += vm.run(Math.min(200_000, n - c)); vm.drainOutput(); }
}
function runHook(entry, label) {
  const r = s.run({ org: entry, maxCycles: 2_000_000, chunk: 100_000 });
  if (r.halt !== "brk-monitor") throw new Error(`${label}: expected BRK halt, got ${r.halt} after ${r.cycles} cycles`);
  return r;
}
function zeroBoard() {
  for (let i = 0; i < CELLS; i++) {
    vm.poke(S.MINE + i, 0);
    vm.poke(S.STATE + i, 0);
    vm.poke(S.COUNT + i, 0);
  }
}
const screen = () => s.textScreen();
const has = (rows, sub) => rows.some((r) => r.includes(sub));
function dump(rows) {
  console.log("    +" + "-".repeat(40));
  for (const r of rows) console.log("    |" + r);
}

// ===== A) boot / initial render ============================================
console.log("A) boot: text mode, title, hidden grid");
vm.setPC(S.START);
runCycles(500_000);
let sc = screen();
ok(vm.textMode() !== 0, "text mode is on (textMode!=0)");
ok(has(sc, "MINEFIELD"), "title shows MINEFIELD");
// Exact render check: the WxH grid at rows GRIDTOP..+H-1, cols GRIDLEFT..+W-1
// must be entirely hidden cells ('.') except the single cursor ('#'). A missing
// row/column or short-drawn grid would leave blanks (gridOther>0) or drop dots.
{
  let gridDots = 0, gridCursor = 0, gridOther = 0;
  for (let r = 0; r < H; r++) {
    const row = sc[GRIDTOP + r] || "";
    for (let c = 0; c < W; c++) {
      const ch = row[GRIDLEFT + c];
      if (ch === ".") gridDots++;
      else if (ch === "#") gridCursor++;
      else gridOther++;
    }
  }
  ok(gridDots === CELLS - 1 && gridCursor === 1 && gridOther === 0,
    `full ${W}x${H} grid rendered (dots=${gridDots}, cursor=${gridCursor}, other=${gridOther})`);
}
if (failures) dump(sc);

// ===== B) deterministic neighbor-count hook ================================
console.log("B) count_hook: neighbor counts match known layouts");
zeroBoard();
vm.poke(S.MINE + idx(5, 5), 1);
runHook(S.COUNT_HOOK, "single-mine count_hook");
{
  let allEight = true;
  for (let r = 4; r <= 6; r++) for (let c = 4; c <= 6; c++) {
    if (r === 5 && c === 5) continue;
    if (vm.peek(S.COUNT + idx(r, c)) !== 1) allEight = false;
  }
  ok(allEight, "single mine gives count 1 to all eight neighbors");
  ok(vm.peek(S.COUNT + idx(0, 0)) === 0, "far-away cell has count 0");
}

zeroBoard();
vm.poke(S.MINE + idx(5, 5), 1);
vm.poke(S.MINE + idx(5, 6), 1);
runHook(S.COUNT_HOOK, "two-mine count_hook");
ok(vm.peek(S.COUNT + idx(4, 5)) === 2, "cell touching two adjacent mines has count 2");
ok(vm.peek(S.COUNT + idx(6, 6)) === 2, "second cell touching both mines has count 2");

// ===== C) deterministic flood-reveal hook ==================================
console.log("C) flood_hook: empty region reveals broadly, mine remains hidden");
zeroBoard();
vm.poke(S.MINE + idx(0, 0), 1);
vm.poke(S.START_R, 15);
vm.poke(S.START_C, 15);
runHook(S.FLOOD_HOOK, "flood_hook");
{
  let revealed = 0;
  for (let i = 0; i < CELLS; i++) if (vm.peek(S.STATE + i) === 1) revealed++;
  ok(revealed === CELLS - 1, `entire safe region revealed (${revealed}/${CELLS})`);
  ok(vm.peek(S.STATE + idx(0, 0)) !== 1, "mine cell stayed hidden");
  ok(vm.peek(S.STATE + idx(0, 1)) === 1 && vm.peek(S.STATE + idx(15, 15)) === 1, "numeric border and start region revealed");
}

console.log(failures === 0 ? "\nALL MINEFIELD TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
