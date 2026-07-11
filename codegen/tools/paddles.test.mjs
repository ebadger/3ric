// paddles.test.mjs ? headless smoke/behaviour test for emulator/AICodeGen/paddles/paddles.s
//
//   A) Boot: text mode, status, top/bottom walls, paddles and ball rendered.
//   B) Motion: the screen changes over time as the ball advances.
//   C) Scoring: with no human input, leftward serves let the CPU score.
//   D) Restart: after the win banner, SPACE resets both scores to zero.
//
// Run:  node codegen/tools/paddles.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "paddles", "paddles.s");

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  PASS " + msg); else { console.log("  FAIL " + msg); failures++; } };

const src = readFileSync(SRC, "utf8");
const { org, bytes, symbols: S } = assemble(src);
console.log(`assembled paddles.s: ${bytes.length} bytes @ $${org.toString(16)} (ends $${(org + bytes.length).toString(16)})`);

const s = await boot();
const vm = s.vm;
s.load(bytes, org);

function runCycles(n) { let c = 0; while (c < n) { c += vm.run(Math.min(200_000, n - c)); vm.drainOutput(); } }
const screen = () => s.textScreen();
const joined = (rows) => rows.join("\n");
const has = (rows, sub) => rows.some((r) => r.includes(sub));
const count = (rows, ch) => joined(rows).split("").filter((c) => c === ch).length;
function dump(rows) { console.log("    +" + "-".repeat(40)); for (const r of rows) console.log("    |" + r); }
function cpuScore(rows) { const m = rows[0].match(/CPU:(\d)/); return m ? Number(m[1]) : -1; }
function youScore(rows) { const m = rows[0].match(/YOU:(\d)/); return m ? Number(m[1]) : -1; }
const interior = (rows) => rows.slice(2, 23).join("\n");
const interiorCount = (rows, ch) => interior(rows).split("").filter((c) => c === ch).length;

// ===== A) boot / initial render ============================================
console.log("A) boot: text mode, status, court, paddles, ball");
vm.setPC(S.START);
runCycles(250_000);
let sc = screen();
ok(vm.textMode() !== 0, "text mode is on (textMode!=0)");
ok(has(sc, "PADDLES") && has(sc, "YOU") && has(sc, "CPU"), "status line shows PADDLES + YOU + CPU");
ok(sc[1].includes("####") && sc[23].includes("####"), "top and bottom walls drawn");
ok(sc.some((r) => r[2] === "|") && sc.some((r) => r[37] === "|"), "both paddles present near columns 2 and 37");
ok(interiorCount(sc, "O") === 1, `one ball present (O count=${interiorCount(sc, "O")})`);
if (failures) dump(sc);

// ===== B) motion ===========================================================
console.log("B) motion: the ball advances over time");
const before = interior(screen());
runCycles(300_000);
const after = interior(screen());
ok(before !== after, "interior changes as the ball moves");

// ===== C) deterministic CPU scoring ========================================
console.log("C) no human input: leftward serves let CPU score");
let scored = cpuScore(screen()) > 0;
for (let i = 0; i < 20 && !scored; i++) { runCycles(500_000); scored = cpuScore(screen()) > 0; }
sc = screen();
ok(scored, `CPU score rose above zero (CPU:${cpuScore(sc)})`);
if (!scored) dump(sc);

// ===== D) restart after win =================================================
console.log("D) SPACE restarts after the win banner");
let won = has(screen(), "CPU WINS") || has(screen(), "YOU WIN");
for (let i = 0; i < 30 && !won; i++) { runCycles(500_000); won = has(screen(), "CPU WINS") || has(screen(), "YOU WIN"); }
ok(won, "win banner appears at seven points");
if (won) {
  vm.keyDown(0x20);
  runCycles(300_000);
  sc = screen();
  ok(!has(sc, "CPU WINS") && !has(sc, "YOU WIN"), "banner cleared after restart");
  ok(youScore(sc) === 0 && cpuScore(sc) === 0, `scores reset (YOU:${youScore(sc)} CPU:${cpuScore(sc)})`);
  ok(interiorCount(sc, "O") === 1, "fresh ball drawn after restart");
}
if (failures) dump(screen());

console.log(failures === 0 ? "\nALL PADDLES TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);



