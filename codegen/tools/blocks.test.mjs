// blocks.test.mjs ? headless smoke/behaviour test for emulator/AICodeGen/blocks/blocks.s
//
//   A) Boot: text mode, title/status, well border, and active piece rendered.
//   B) Gravity: the field changes as the active piece descends.
//   C) Locking: with no key input, pieces settle into the lower well.
//   D) Line clear hook: a full bottom row is removed, shifted, and scored.
//
// Run:  node codegen/tools/blocks.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "blocks", "blocks.s");

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  PASS " + msg); else { console.log("  FAIL " + msg); failures++; } };

const src = readFileSync(SRC, "utf8");
const { org, bytes, symbols: S } = assemble(src);
console.log(`assembled blocks.s: ${bytes.length} bytes @ $${org.toString(16)} (ends $${(org + bytes.length).toString(16)})`);

const s = await boot();
const vm = s.vm;
s.load(bytes, org);

function runCycles(n) { let c = 0; while (c < n) { c += vm.run(Math.min(200_000, n - c)); vm.drainOutput(); } }
const screen = () => s.textScreen();
const joined = (rows) => rows.join("\n");
const has = (rows, sub) => rows.some((r) => r.includes(sub));
function dump(rows) { console.log("    +" + "-".repeat(40)); for (const r of rows) console.log("    |" + r); }
function countRegion(rows, r0, r1, c0, c1, ch) {
  let n = 0;
  for (let r = r0; r <= r1; r++) for (const c of rows[r].slice(c0, c1 + 1)) if (c === ch) n++;
  return n;
}
function clearWell() { for (let i = 0; i < 200; i++) vm.poke(S.WELL + i, 0); }
function rowValues(row) { const a = []; for (let c = 0; c < 10; c++) a.push(vm.peek(S.WELL + row * 10 + c)); return a; }

// ===== A) boot / initial render ============================================
console.log("A) boot: text mode, title/status, border, active piece");
vm.setPC(S.START);
let sc = screen();
for (let i = 0; i < 30; i++) {
  runCycles(20_000);
  sc = screen();
  if (countRegion(sc, 2, 15, 15, 24, "@") > 0) break;
}
ok(vm.textMode() !== 0, "text mode is on (textMode!=0)");
ok(has(sc, "BLOCK DROP") && has(sc, "SCORE"), "status line shows BLOCK DROP + SCORE");
ok(sc.some((r) => r.includes("#")), "well border/floor drawn with #");
ok(countRegion(sc, 2, 15, 15, 24, "@") > 0, "active piece visible in upper well");
if (failures) dump(sc);

// ===== B) gravity / motion ==================================================
console.log("B) gravity: field changes as the piece descends");
const before = joined(screen().slice(2, 22));
runCycles(450_000);
const after = joined(screen().slice(2, 22));
ok(before !== after, "well changes after gravity ticks");

// ===== C) accumulation / locking ===========================================
console.log("C) accumulation: pieces lock into the lower well");
for (let i = 0; i < 12; i++) runCycles(500_000);
sc = screen();
const lowerSettled = countRegion(sc, 17, 21, 15, 24, "#");
ok(lowerSettled > 0, `settled # cells appear in bottom rows (count=${lowerSettled})`);
if (lowerSettled === 0) dump(sc);

// ===== D) deterministic line clear hook =====================================
console.log("D) clear hook: full row shifts down and increments score");
clearWell();
for (let c = 0; c < 10; c++) vm.poke(S.WELL + 19 * 10 + c, 1);
vm.poke(S.WELL + 18 * 10 + 4, 1);
vm.poke(S.SCORE, 0);
const h = s.run({ org: S.CLEAR_HOOK, maxCycles: 2_000_000, chunk: 100_000 });
ok(h.halt === "brk-monitor", `clear hook halts at BRK (${h.halt})`);
const bottom = rowValues(19);
const above = rowValues(18);
ok(bottom.reduce((a, b) => a + (b ? 1 : 0), 0) === 1 && bottom[4] === 1, "row above shifted into cleared bottom row");
ok(above.every((v) => v === 0), "row above is empty after shift");
ok(vm.peek(S.SCORE) === 1, `score increased by one (${vm.peek(S.SCORE)})`);

console.log(failures === 0 ? "\nALL BLOCKS TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

