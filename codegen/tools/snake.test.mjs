// snake.test.mjs — headless smoke/behaviour test for emulator/AICodeGen/snake/snake.s
//
//   A) Boot: mixed LO-RES on, HUD status line, border box + snake + food rendered.
//   B) Motion: the field changes over time (the snake advances).
//   C) Crash: heading right from the centre, the snake reaches the right wall
//      and the "GAME OVER" banner appears (deterministic — it never turns).
//   D) Restart: pressing SPACE clears the banner and redraws a fresh snake.
//   E) Odd-row crash: steering DOWN into the bottom wall (row 39, an odd row)
//      exercises the high-nibble collision-read path of lpeek (lpk_hi); section
//      C only ever crashes on even row 20 (the low-nibble path).
//
// Snake now renders in mixed lo-res: a 40x40 colour playfield (page 1 shares the
// text page) above four text HUD rows (20-23). Each lo-res byte packs two rows —
// low nibble = even row (upper pixel), high nibble = odd row (lower pixel) — so
// this test decodes the field the same way the VM's lo-res renderer does.
//
// Run:  node codegen/tools/snake.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot, TEXT_SCANLINES } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "snake", "snake.s");

// lo-res palette indices used by the game.
const BLACK = 0, WALL = 5, BODY = 12, FOOD = 13;

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
const has = (rows, sub) => rows.some((r) => r.includes(sub));

// Decode the 40x40 lo-res playfield (page 1) into field[row][col] colour indices.
function loresField() {
  const f = [];
  for (let r = 0; r < 40; r++) {
    const base = 0x400 + TEXT_SCANLINES[r >> 1];
    const row = [];
    for (let c = 0; c < 40; c++) {
      const byte = vm.peek(base + c) & 0xff;
      row.push((r & 1) ? (byte >> 4) : (byte & 0x0f));
    }
    f.push(row);
  }
  return f;
}
const countColour = (f, k) => f.reduce((n, row) => n + row.filter((v) => v === k).length, 0);
function dumpField(f) {
  const g = { [BLACK]: ".", [WALL]: "#", [BODY]: "O", [FOOD]: "*" };
  console.log("    +" + "-".repeat(40));
  for (const row of f) console.log("    |" + row.map((v) => g[v] ?? v.toString(16)).join(""));
}
function dumpHud(rows) { for (let r = 20; r < 24; r++) console.log("    HUD" + r + "|" + (rows[r] || "")); }

// ===== A) boot / initial render ============================================
console.log("A) boot: mixed lo-res, HUD status, border, snake, food");
vm.setPC(S.START);
runCycles(400_000);
let sc = screen();
let f = loresField();
ok(vm.textMode() === 0, "graphics on (textMode==0)");
ok(vm.lores() !== 0, "lo-res mode selected (lores!=0)");
ok(vm.mixed() !== 0, "mixed mode selected (mixed!=0)");
ok(has(sc, "SNAKE") && has(sc, "SCORE:"), "HUD status line shows SNAKE + SCORE:");
ok(f[0].every((v) => v === WALL), "top border row is all wall colour");
ok(countColour(f, WALL) >= 156, `border box drawn (wall cells=${countColour(f, WALL)})`);
ok(countColour(f, BODY) >= 4, `snake body present (body cells=${countColour(f, BODY)})`);
ok(countColour(f, FOOD) === 1, `exactly one food on screen (food cells=${countColour(f, FOOD)})`);
if (failures) { dumpField(f); dumpHud(sc); }

// ===== B) motion ===========================================================
console.log("B) motion: the field advances over time");
const interior = (fld) => fld.slice(1, 39).map((row) => row.slice(1, 39).join(",")).join("|");
const before = interior(loresField());
runCycles(350_000);
const after = interior(loresField());
ok(before !== after, "interior changes as the snake moves");

// ===== C) crash into the right wall ========================================
console.log("C) heading right from centre eventually hits the wall -> GAME OVER");
let over = false;
for (let i = 0; i < 12 && !over; i++) { runCycles(500_000); if (has(screen(), "GAME OVER")) over = true; }
ok(over, "GAME OVER banner appears after crossing to the wall");
if (!over) { dumpField(loresField()); dumpHud(screen()); }

// ===== D) restart ==========================================================
console.log("D) SPACE restarts a fresh game");
vm.keyDown(0x20);              // SPACE
runCycles(300_000);
sc = screen();
f = loresField();
ok(!has(sc, "GAME OVER"), "banner cleared after restart");
ok(countColour(f, BODY) >= 4, `fresh snake drawn (body cells=${countColour(f, BODY)})`);
if (failures) { dumpField(f); dumpHud(sc); }

// ===== E) odd-row collision path (lpeek high-nibble / lpk_hi) ==============
// Section C only ever crashes on even row 20, so the head-collision lpeek is
// read exclusively through the low-nibble path. Steer the fresh snake straight
// DOWN so it runs into the bottom wall at row 39 (an odd row): the fatal
// destination read must go through lpeek's high-nibble branch (lpk_hi).
//
// Two guards stop this passing spuriously: (1) the snake must actually reach
// the bottom -- if DOWN were ignored it would instead crash rightward on row 20
// and never touch an odd wall; (2) the bottom wall must stay intact -- if lpk_hi
// mis-read the odd wall as empty, the head would punch a hole through row 39
// (plotting BODY over it) before dying later on HUD garbage.
console.log("E) crashing downward into the bottom (odd-row) wall -> GAME OVER");
vm.keyDown(0x0a);             // down arrow -> head turns toward row 39 (odd)
let overOdd = false;
for (let i = 0; i < 12 && !overOdd; i++) { runCycles(500_000); if (has(screen(), "GAME OVER")) overOdd = true; }
const fE = loresField();
const maxBodyRow = fE.reduce((m, row, r) => (row.includes(BODY) ? r : m), -1);
const bottomIntact = fE[39].every((v) => v === WALL);
ok(overOdd, "GAME OVER after steering into the bottom wall");
ok(maxBodyRow >= 35, `snake travelled down to the bottom rows (max body row=${maxBodyRow})`);
ok(bottomIntact, "bottom wall (row 39, odd) intact -- lpk_hi read the wall, no breach");
if (!overOdd || maxBodyRow < 35 || !bottomIntact) { dumpField(fE); dumpHud(screen()); }

console.log(failures === 0 ? "\nALL SNAKE TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
