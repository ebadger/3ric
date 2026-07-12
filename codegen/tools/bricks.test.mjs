// bricks.test.mjs ? headless smoke/behaviour test for emulator/AICodeGen/bricks/bricks.s
//
//   A) Boot: text mode, status, walls, bricks, paddle, and ball render.
//   B) Motion: the ball changes position over time.
//   C) Destruction: unattended upward serve removes at least one brick and scores.
//   D) Hook: one deterministic physics step clears a prepared brick and scores.
//
// Run:  node codegen/tools/bricks.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "bricks", "bricks.s");

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  PASS " + msg); else { console.log("  FAIL " + msg); failures++; } };

const src = readFileSync(SRC, "utf8");
const { org, bytes, symbols: S } = assemble(src);
console.log(`assembled bricks.s: ${bytes.length} bytes @ $${org.toString(16)} (ends $${(org + bytes.length).toString(16)})`);

function dump(rows) { console.log("    +" + "-".repeat(40)); for (const r of rows) console.log("    |" + r); }
function joined(rows) { return rows.join("\n"); }
function has(rows, sub) { return rows.some((r) => r.includes(sub)); }
function countInRows(rows, ch, a, b) { return rows.slice(a, b + 1).join("").split("").filter((c) => c === ch).length; }
function scoreFrom(rows) { const m = joined(rows).match(/SCORE:(\d{3})/); return m ? Number(m[1]) : 0; }
function ballPos(rows) { for (let r = 2; r < rows.length; r++) { const c = rows[r].indexOf("O"); if (c >= 0) return `${r},${c}`; } return "none"; }

async function fresh() {
  const s = await boot();
  s.load(bytes, org);
  return s;
}

function runCycles(vm, n) { let c = 0; while (c < n) { c += vm.run(Math.min(200_000, n - c)); vm.drainOutput(); } }

// ===== A) boot / initial render ============================================
console.log("A) boot: text mode, status, walls, bricks, paddle, ball");
let s = await fresh();
let vm = s.vm;
vm.setPC(S.START);
runCycles(vm, 40_000);
let sc = s.textScreen();
ok(vm.textMode() !== 0, "text mode is on (textMode!=0)");
ok(has(sc, "BRICK BUSTER") && has(sc, "SCORE") && has(sc, "LIVES"), "status line shows BRICK BUSTER, SCORE, LIVES");
ok(sc[1]?.includes("####"), "top wall drawn with #");
ok(sc.slice(2).some((r) => r.startsWith("#") && r.endsWith("#")), "side walls drawn with #");
ok(countInRows(sc, "#", 3, 7) > 30, `large brick block present (#=${countInRows(sc, "#", 3, 7)})`);
ok(sc[22]?.includes("======"), "paddle run present on row 22");
ok(countInRows(sc, "O", 2, 23) === 1, "one ball is present");
if (failures) dump(sc);

// ===== B) motion ===========================================================
console.log("B) motion: ball moves over time");
let beforePos = ballPos(sc);
runCycles(vm, 120_000);
sc = s.textScreen();
let afterPos = ballPos(sc);
ok(beforePos !== afterPos, `ball moved (${beforePos} -> ${afterPos})`);

// ===== C) deterministic brick destruction =================================
console.log("C) unattended serve destroys a brick and raises score");
s = await fresh();
vm = s.vm;
vm.setPC(S.START);
runCycles(vm, 40_000);
const initial = countInRows(s.textScreen(), "#", 3, 7);
let destroyed = false;
for (let i = 0; i < 20 && !destroyed; i++) {
  runCycles(vm, 250_000);
  sc = s.textScreen();
  destroyed = countInRows(sc, "#", 3, 7) < initial && scoreFrom(sc) > 0;
}
ok(destroyed, `brick count decreased and score rose (initial=${initial}, now=${countInRows(sc, "#", 3, 7)}, score=${scoreFrom(sc)})`);
if (!destroyed) dump(sc);

// ===== D) BRK hook =========================================================
console.log("D) hook: prepared brick hit clears cell and scores");
s = await fresh();
vm = s.vm;
vm.setPC(S.START);
runCycles(vm, 40_000);
// Put the ball directly below a known brick at row 7, col 20, moving upward.
const addr = (row, col) => vm.peek(S.ROWL + row) + 256 * vm.peek(S.ROWH + row) + col;
vm.poke(addr(7, 20), 0xA3);
vm.poke(addr(8, 20), 0xCF);
vm.poke(S.BALLR, 8);
vm.poke(S.BALLC, 20);
vm.poke(S.BALLDR, 0xFF);
vm.poke(S.BALLDC, 0);
vm.poke(S.SCORE, 0);
vm.poke(S.SCOREH, 0xB0);
vm.poke(S.SCORET, 0xB0);
vm.poke(S.SCOREO, 0xB0);
vm.poke(S.BRICKSLEFT, 180);
vm.poke(S.BRICKS + 4 * 36 + 18, 1);
vm.poke(S.GOVER, 0);
const r = s.run({ org: S.HOOK, maxCycles: 500_000, chunk: 100_000 });
ok(r.halt === "brk-monitor", `hook returns via BRK (${r.halt})`);
ok(vm.peek(S.BRICKS + 4 * 36 + 18) === 0, "prepared brick map entry cleared");
ok(vm.peek(S.SCORE) === 1, "score bumped to 001");
ok(vm.peek(S.BRICKSLEFT) === 179, "brick counter decremented");
if (failures) dump(s.textScreen());

// ===== E) diagonal physics: serve angle, paddle english, side bounces ======
console.log("E) diagonal physics: serve angle, paddle english, wall & brick side hits");
const s8 = (v) => (v > 127 ? v - 256 : v);
const cell = (row, col) => vm.peek(S.ROWL + row) + 256 * vm.peek(S.ROWH + row) + col;
async function bootFresh() { const st = await fresh(); st.vm.setPC(S.START); runCycles(st.vm, 40_000); return st; }

// E1: the serve is diagonal — horizontal velocity is never zero.
s = await bootFresh(); vm = s.vm;
ok(s8(vm.peek(S.BALLDC)) !== 0, `serve is diagonal (BALLDC=${s8(vm.peek(S.BALLDC))} != 0)`);

// E2: paddle english — the paddle (cols 17..22, paddleC=17) steers the ball:
// striking its left half sends the ball left, its right half sends it right.
for (const [col, wantDC, side] of [[18, 0xFF, "left"], [21, 0x01, "right"]]) {
  s = await bootFresh(); vm = s.vm;
  vm.poke(S.BALLR, 21); vm.poke(S.BALLC, col);
  vm.poke(S.BALLDR, 0x01); vm.poke(S.BALLDC, 0x00);   // dropping onto the paddle
  s.run({ org: S.HOOK, maxCycles: 200_000, chunk: 50_000 });
  ok(vm.peek(S.BALLDR) === 0xFF && vm.peek(S.BALLDC) === wantDC,
    `paddle ${side} half (col ${col}) -> up & ${side} (DR=${s8(vm.peek(S.BALLDR))}, DC=${s8(vm.peek(S.BALLDC))})`);
}

// E3: a side wall reverses horizontal travel and keeps vertical (this bounce
// was a no-op back when the ball could only ever move straight up/down).
s = await bootFresh(); vm = s.vm;
vm.poke(S.BALLR, 10); vm.poke(S.BALLC, 1);
vm.poke(S.BALLDR, 0xFF); vm.poke(S.BALLDC, 0xFF);      // up-left into the col-0 wall
s.run({ org: S.HOOK, maxCycles: 200_000, chunk: 50_000 });
ok(vm.peek(S.BALLDC) === 0x01 && vm.peek(S.BALLDR) === 0xFF,
  `left wall flips DC, keeps DR (DC=${s8(vm.peek(S.BALLDC))}, DR=${s8(vm.peek(S.BALLDR))})`);

// E4: a brick struck on its SIDE face reverses horizontal travel (regression
// guard for sideways tunnelling): horizontal neighbour solid, vertical clear.
// We assert on the brick *map* (like test D) rather than the screen cell: the
// BRK hook returns through the monitor, whose register dump scrolls the text
// screen and drags the poked neighbour glyph over the target -- the map entry
// is the reliable "brick consumed" signal.
s = await bootFresh(); vm = s.vm;
vm.poke(cell(7, 21), 0xA3);   // target brick at (newR,newC)
vm.poke(cell(8, 21), 0xA3);   // horizontal neighbour solid -> side hit
vm.poke(cell(7, 20), 0xA0);   // vertical neighbour clear
vm.poke(S.BALLR, 8); vm.poke(S.BALLC, 20);
vm.poke(S.BALLDR, 0xFF); vm.poke(S.BALLDC, 0x01);      // up-right into the brick's left face
vm.poke(S.BRICKS + 4 * 36 + 19, 1);                    // map: brick present at (7,21)
vm.poke(S.BRICKSLEFT, 180); vm.poke(S.GOVER, 0); vm.poke(S.SCORE, 0);
s.run({ org: S.HOOK, maxCycles: 200_000, chunk: 50_000 });
ok(vm.peek(S.BALLDC) === 0xFF && vm.peek(S.BALLDR) === 0xFF,
  `brick side hit flips DC, keeps DR (DC=${s8(vm.peek(S.BALLDC))}, DR=${s8(vm.peek(S.BALLDR))})`);
ok(vm.peek(S.BRICKS + 4 * 36 + 19) === 0, "struck brick consumed on side hit (map cleared)");

// E5: a brick struck on its BOTTOM face reverses vertical travel and keeps
// horizontal: vertical neighbour solid, horizontal neighbour clear.
s = await bootFresh(); vm = s.vm;
vm.poke(cell(7, 21), 0xA3);   // target brick
vm.poke(cell(7, 20), 0xA3);   // vertical neighbour solid -> bottom hit
vm.poke(cell(8, 21), 0xA0);   // horizontal neighbour clear
vm.poke(S.BALLR, 8); vm.poke(S.BALLC, 20);
vm.poke(S.BALLDR, 0xFF); vm.poke(S.BALLDC, 0x01);      // up-right into the brick's underside
vm.poke(S.BRICKS + 4 * 36 + 19, 1);                    // map: brick present at (7,21)
vm.poke(S.BRICKSLEFT, 180); vm.poke(S.GOVER, 0); vm.poke(S.SCORE, 0);
s.run({ org: S.HOOK, maxCycles: 200_000, chunk: 50_000 });
ok(vm.peek(S.BALLDR) === 0x01 && vm.peek(S.BALLDC) === 0x01,
  `brick bottom hit flips DR, keeps DC (DR=${s8(vm.peek(S.BALLDR))}, DC=${s8(vm.peek(S.BALLDC))})`);
ok(vm.peek(S.BRICKS + 4 * 36 + 19) === 0, "struck brick consumed on bottom hit (map cleared)");

console.log(failures === 0 ? "\nALL BRICK BUSTER TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
