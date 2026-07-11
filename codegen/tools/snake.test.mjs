// snake.test.mjs — headless smoke/behaviour test for emulator/AICodeGen/snake/snake.s
//
//   A) Boot: text mode on, status line + border box + snake + food rendered.
//   B) Motion: the field changes over time (the snake advances).
//   C) Crash: heading right from the centre, the snake reaches the right wall
//      and the "GAME OVER" banner appears (deterministic — it never turns).
//   D) Restart: pressing SPACE clears the banner and redraws a fresh snake.
//
// Run:  node codegen/tools/snake.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "snake", "snake.s");

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  PASS " + msg); else { console.log("  FAIL " + msg); failures++; } };

const src = readFileSync(SRC, "utf8");
const { org, bytes, symbols: S } = assemble(src);
console.log(`assembled snake.s: ${bytes.length} bytes @ $${org.toString(16)} (ends $${(org + bytes.length).toString(16)})`);

const s = await boot();
const vm = s.vm;
s.load(bytes, org);

function runCycles(n) { let c = 0; while (c < n) { c += vm.run(Math.min(200_000, n - c)); vm.drainOutput(); } }
const screen = () => s.textScreen();
const joined = (rows) => rows.join("\n");
const has = (rows, sub) => rows.some((r) => r.includes(sub));
const count = (rows, ch) => joined(rows).split("").filter((c) => c === ch).length;
function dump(rows) { console.log("    +" + "-".repeat(40)); for (const r of rows) console.log("    |" + r); }

// ===== A) boot / initial render ============================================
console.log("A) boot: text mode, status line, border, snake, food");
vm.setPC(S.START);
runCycles(400_000);
let sc = screen();
ok(vm.textMode() !== 0, "text mode is on (textMode!=0)");
ok(has(sc, "SNAKE") && has(sc, "SCORE:"), "status line shows SNAKE + SCORE:");
ok(sc.some((r) => r.includes("####")), "border box drawn");
ok(count(sc, "O") >= 3, `snake body present (O count=${count(sc, "O")})`);
ok(count(sc, "*") === 1, `exactly one food on screen (*=${count(sc, "*")})`);
if (failures) dump(sc);

// ===== B) motion ===========================================================
console.log("B) motion: the field advances over time");
const interior = (rows) => rows.slice(2, 23).join("\n");
const before = interior(screen());
runCycles(350_000);
const after = interior(screen());
ok(before !== after, "interior changes as the snake moves");

// ===== C) crash into the right wall ========================================
console.log("C) heading right from centre eventually hits the wall -> GAME OVER");
let over = false;
for (let i = 0; i < 12 && !over; i++) { runCycles(500_000); if (has(screen(), "GAME OVER")) over = true; }
ok(over, "GAME OVER banner appears after crossing to the wall");
if (!over) dump(screen());

// ===== D) restart ==========================================================
console.log("D) SPACE restarts a fresh game");
vm.keyDown(0x20);              // SPACE
runCycles(300_000);
sc = screen();
ok(!has(sc, "GAME OVER"), "banner cleared after restart");
ok(count(sc, "O") >= 3, `fresh snake drawn (O count=${count(sc, "O")})`);
if (failures) dump(sc);

console.log(failures === 0 ? "\nALL SNAKE TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
