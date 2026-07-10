// 2048.test.mjs — headless smoke/behaviour test for emulator/AICodeGen/2048/2048.s
//
//   A) Boot: text mode on, title/status + grid rendered, at least one tile shown.
//   B) Hook: deterministic slide/merge logic in all four directions.
//
// Run:  node codegen/tools/2048.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "2048", "2048.s");

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  PASS " + msg); else { console.log("  FAIL " + msg); failures++; } };

const src = readFileSync(SRC, "utf8");
const { org, bytes, symbols: S } = assemble(src);
console.log(`assembled 2048.s: ${bytes.length} bytes @ $${org.toString(16)} (ends $${(org + bytes.length).toString(16)})`);

const s = await boot();
const vm = s.vm;
s.load(bytes, org);

function runCycles(n) { let c = 0; while (c < n) { c += vm.run(Math.min(200_000, n - c)); vm.drainOutput(); } }
const screen = () => s.textScreen();
const joined = rows => rows.join("\n");
const has = (rows, sub) => rows.some(r => r.includes(sub));
function dump(rows) { console.log("    +" + "-".repeat(40)); for (const r of rows) console.log("    |" + r); }

function pokeBoard(vals) {
  for (let i = 0; i < 16; i++) vm.poke(S.BOARD + i, vals[i] ?? 0);
}
function peekBoard() {
  return Array.from({ length: 16 }, (_, i) => vm.peek(S.BOARD + i));
}
function setScore(v = 0) {
  vm.poke(S.SCORE, v & 0xFF);
  vm.poke(S.SCORE + 1, (v >> 8) & 0xFF);
}
function getScore() {
  return vm.peek(S.SCORE) | (vm.peek(S.SCORE + 1) << 8);
}
function runHook(label) {
  const r = s.run({ org: S.DO_MOVE, maxCycles: 2_000_000, chunk: 100_000 });
  if (r.halt !== "brk-monitor") throw new Error(`${label}: expected BRK halt, got ${r.halt} after ${r.cycles} cycles`);
}
function sameBoard(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
function moveCase(name, direction, before, expected, expectedScore) {
  pokeBoard(before);
  setScore(0);
  vm.poke(S.DIR, direction);
  runHook(name);
  const got = peekBoard();
  const score = getScore();
  const pass = sameBoard(got, expected) && score === expectedScore;
  ok(pass, `${name}: board=${JSON.stringify(got)} score=${score}`);
  if (!pass) {
    console.log(`    expected board=${JSON.stringify(expected)} score=${expectedScore}`);
  }
}

// ===== A) boot / initial render ============================================
console.log("A) boot: text mode, status, grid, starting tile");
vm.setPC(S.START);
runCycles(500_000);
let sc = screen();
const gridRows = [sc[4] ?? "", sc[6] ?? "", sc[8] ?? "", sc[10] ?? ""];
ok(vm.textMode() !== 0, "text mode is on (textMode!=0)");
ok(has(sc, "2048") && has(sc, "SCORE"), "title and SCORE appear");
ok(has(sc, "+----+----+----+----+") && gridRows.some(r => r.includes("|")), "grid borders drawn");
ok(gridRows.some(r => r.includes("   2") || r.includes("   4")), "at least one starting tile is visible");
if (failures) dump(sc);

// ===== B) deterministic move hook ==========================================
console.log("B) deterministic do_move hook: slide/merge mechanics");
const Z = Array(16).fill(0);
const row = (r0, r1, r2, r3) => [r0, r1, r2, r3, ...Array(12).fill(0)];
moveCase("LEFT [1,1,0,0] -> [2,0,0,0]", 0, row(1, 1, 0, 0), row(2, 0, 0, 0), 4);
moveCase("LEFT [1,0,1,0] -> [2,0,0,0]", 0, row(1, 0, 1, 0), row(2, 0, 0, 0), 4);
moveCase("LEFT [1,2,0,0] unchanged", 0, row(1, 2, 0, 0), row(1, 2, 0, 0), 0);
moveCase("LEFT [1,1,1,1] -> [2,2,0,0]", 0, row(1, 1, 1, 1), row(2, 2, 0, 0), 8);
moveCase("RIGHT [1,1,0,0] -> [0,0,0,2]", 1, row(1, 1, 0, 0), row(0, 0, 0, 2), 4);

{
  const before = Z.slice();
  before[0] = 1; before[4] = 1;
  const expected = Z.slice();
  expected[0] = 2;
  moveCase("UP column [1,1,0,0] -> top merge", 2, before, expected, 4);
}
{
  const before = Z.slice();
  before[0] = 1; before[4] = 1;
  const expected = Z.slice();
  expected[12] = 2;
  moveCase("DOWN column [1,1,0,0] -> bottom merge", 3, before, expected, 4);
}

console.log(failures === 0 ? "\nALL 2048 TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
