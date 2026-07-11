// blocks.test.mjs — headless smoke/behaviour test for emulator/AICodeGen/blocks/blocks.s
//
//   A) Boot: mixed LO-RES mode, HUD status line, grey side walls, active piece.
//   B) Gravity: the lo-res field changes as the active piece descends.
//   C) Locking: with no key input, a piece settles into the lower well model.
//   D) Line clear hook: a full bottom row is removed, shifted, and scored.
//
// The playfield renders in mixed lo-res (a 10x20 well drawn as 2x2 colour blocks
// with a four-row text HUD at the bottom), so A/B read the lo-res video RAM and C
// reads the WELL byte model directly; D exercises the model-level clear hook.
//
// Run:  node codegen/tools/blocks.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot, TEXT_SCANLINES } = harnessPkg;
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
const has = (rows, sub) => rows.some((r) => r.includes(sub));

// Lo-res colour (0..15) of the cell at lo-res (row 0..39, col 0..39). Two stacked
// pixels share a text byte: low nibble = even row, high nibble = odd row.
function lores(row, col) {
  const b = vm.peek(0x400 + TEXT_SCANLINES[row >> 1] + col) & 0xff;
  return (row & 1) ? (b >> 4) & 0x0f : b & 0x0f;
}
// Non-black interior cells (well columns map to lo-res cols 10..29) in a row band.
function countField(r0, r1) {
  let n = 0;
  for (let r = r0; r <= r1; r++) for (let c = 10; c <= 29; c++) if (lores(r, c) !== 0) n++;
  return n;
}
function fieldSig(r0, r1) {
  let sig = "";
  for (let r = r0; r <= r1; r++) for (let c = 10; c <= 29; c++) sig += lores(r, c).toString(16);
  return sig;
}
function wellCell(row, col) { return vm.peek(S.WELL + row * 10 + col) & 0xff; }

// ===== A) boot / initial render ============================================
console.log("A) boot: mixed lo-res, HUD status, side walls, active piece");
vm.setPC(S.START);
let sc = screen();
for (let i = 0; i < 40; i++) {
  runCycles(20_000);
  sc = screen();
  if (vm.lores() && countField(0, 9) > 0) break;
}
ok(vm.textMode() === 0, "graphics on (textMode==0)");
ok(vm.lores() !== 0, "lo-res mode on");
ok(vm.mixed() !== 0, "mixed mode on (four text HUD rows at the bottom)");
ok(has(sc, "BLOCK DROP") && has(sc, "SCORE"), "HUD status line shows BLOCK DROP + SCORE");
ok(lores(0, 9) === 5 && lores(0, 30) === 5, "grey side walls drawn (cols 9 & 30)");
ok(countField(0, 9) > 0, "active piece visible in the upper lo-res field");

// ===== B) gravity / motion ==================================================
console.log("B) gravity: the lo-res field changes as the piece descends");
const before = fieldSig(0, 39);
runCycles(1_600_000);        // one ~0.83 s gravity step at the native clock
const after = fieldSig(0, 39);
ok(before !== after, "field changes after gravity ticks");

// ===== C) accumulation / locking ===========================================
console.log("C) accumulation: a piece locks into the lower well model");
runCycles(40_000_000);       // let at least one piece fall to the floor and lock
let settled = 0;
for (let r = 12; r < 20; r++) for (let c = 0; c < 10; c++) if (wellCell(r, c) !== 0) settled++;
ok(settled > 0, `settled cells appear in the lower well (count=${settled})`);

// ===== D) deterministic line clear hook =====================================
console.log("D) clear hook: full row shifts down and increments score");
function clearWell() { for (let i = 0; i < 200; i++) vm.poke(S.WELL + i, 0); }
function rowValues(row) { const a = []; for (let c = 0; c < 10; c++) a.push(wellCell(row, c)); return a; }
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
