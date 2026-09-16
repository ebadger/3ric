// spacewar.test.mjs — STAR DUEL engine and gameplay checks.
// Run: node codegen/tools/spacewar.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "spacewar", "spacewar.s");
const EMULATOR_PRG = join(HERE, "..", "..", "emulator", "AICodeGen", "spacewar", "spacewar.prg");
const WEB_PRG = join(HERE, "..", "..", "web", "programs", "spacewar.prg");

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log("  PASS " + msg);
  else {
    console.log("  FAIL " + msg);
    failures++;
  }
};

const haddr = (y) =>
  0x2000 + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;

const src = readFileSync(SRC, "utf8");
const { org, bytes, symbols: S } = assemble(src);
const end = org + bytes.length;
console.log(
  `assembled spacewar.s: ${bytes.length} bytes @ $${org.toString(16)} ` +
  `(ends $${end.toString(16)})`,
);
ok(org === 0x0800, "loads at $0800");
ok(end <= 0x2000, "program stays at or below hi-res page 1 at $2000");

const assembled = Buffer.from(bytes);
writeFileSync(EMULATOR_PRG, assembled);
mkdirSync(dirname(WEB_PRG), { recursive: true });
writeFileSync(WEB_PRG, assembled);
ok(assembled.equals(readFileSync(EMULATOR_PRG)), "emulator PRG matches assembled source");
ok(assembled.equals(readFileSync(WEB_PRG)), "web PRG matches assembled source");

const s = await boot();
const vm = s.vm;
s.load(bytes, org);

function runHook(entry, label) {
  const r = s.run({ org: entry, maxCycles: 8_000_000, chunk: 200_000 });
  if (r.halt !== "brk-monitor") {
    throw new Error(`${label}: expected BRK halt, got ${r.halt} after ${r.cycles} cycles`);
  }
  return r;
}

const pokeWord = (a, v) => {
  vm.poke(a, v & 0xff);
  vm.poke(a + 1, (v >> 8) & 0xff);
};
const peekWord = (a) => vm.peek(a) | (vm.peek(a + 1) << 8);
const getpix = (x, y) =>
  (vm.peek(haddr(y) + Math.floor(x / 7)) >> (x % 7)) & 1;
const signed8 = (v) => (v & 0x80 ? v - 256 : v);

function pokeShip(base, { x, y, vx = 0, vy = 0, ang = 0, act = 1, inv = 0, dead = 0 } = {}) {
  vm.poke(base + S.O_ACT, act);
  vm.poke(base + S.O_XF, 0);
  vm.poke(base + S.O_XL, x & 0xff);
  vm.poke(base + S.O_XH, (x >> 8) & 0xff);
  vm.poke(base + S.O_YF, 0);
  vm.poke(base + S.O_YL, y & 0xff);
  vm.poke(base + S.O_YH, (y >> 8) & 0xff);
  const vxu = vx & 0xffff;
  vm.poke(base + S.O_VXL, vxu & 0xff);
  vm.poke(base + S.O_VXH, (vxu >> 8) & 0xff);
  const vyu = vy & 0xffff;
  vm.poke(base + S.O_VYL, vyu & 0xff);
  vm.poke(base + S.O_VYH, (vyu >> 8) & 0xff);
  vm.poke(base + S.O_ANG, ang);
  vm.poke(base + S.O_DRAWN, 0);
  vm.poke(base + S.O_COOL, 0);
  vm.poke(base + S.O_INV, inv);
  vm.poke(base + S.O_DEAD, dead);
}

function peekX(base) {
  return vm.peek(base + S.O_XL) | (vm.peek(base + S.O_XH) << 8);
}
function peekY(base) {
  return vm.peek(base + S.O_YL) | (vm.peek(base + S.O_YH) << 8);
}
function peekVX(base) {
  return (vm.peek(base + S.O_VXL) | (signed8(vm.peek(base + S.O_VXH)) << 8));
}

function clearPads() {
  for (let i = 0; i < 16; i++) {
    vm.poke(S.GAMEPAD1 + i, 0);
    vm.poke(S.GAMEPAD2 + i, 0);
  }
}

console.log("0) program layout");
ok(bytes.length > 2000, "image is a full game, not a stub");

console.log("A) hi-res row table");
runHook(S.BUILD_BRK, "build rows");
{
  let rowsMatch = true;
  let firstBad = null;
  for (let y = 0; y < 192; y++) {
    const got = vm.peek(S.ROWL + y) | (vm.peek(S.ROWH + y) << 8);
    const exp = haddr(y);
    if (got !== exp) {
      rowsMatch = false;
      firstBad ??= { y, got, exp };
    }
  }
  ok(rowsMatch, rowsMatch ? "all 192 rows match Apple II hi-res formula" : `row ${firstBad.y} got $${firstBad.got.toString(16)} expected $${firstBad.exp.toString(16)}`);
}

console.log("B) XOR plot");
runHook(S.CLEAR_BRK, "clear");
{
  pokeWord(S.BX, 14);
  vm.poke(S.BY, 20);
  vm.poke(S.PLOTOR, 0);
  runHook(S.PLOT_BRK, "plot on");
  ok(getpix(14, 20) === 1, "plot lights (14,20)");
  runHook(S.PLOT_BRK, "plot off");
  ok(getpix(14, 20) === 0, "plotting twice XOR-erases the pixel");
  ok(getpix(15, 20) === 0, "neighbor pixel stays dark");
}

console.log("C) gravity pulls toward the sun");
runHook(S.INIT_BRK, "init");
{
  pokeShip(S.SHIP0, { x: 180, y: 80, vx: 0, vy: 0, act: 1, inv: 30 });
  runHook(S.GRAV_BRK, "grav from the right");
  ok(peekVX(S.SHIP0) < 0, `ship right of the sun gets -vx (got ${peekVX(S.SHIP0)})`);
  ok(vm.peek(S.SHIP0 + S.O_ACT) === 1, "distance-40 ship is not swallowed");

  pokeShip(S.SHIP0, { x: 100, y: 80, vx: 0, vy: 0, act: 1, inv: 30 });
  runHook(S.GRAV_BRK, "grav from the left");
  ok(peekVX(S.SHIP0) > 0, `ship left of the sun gets +vx (got ${peekVX(S.SHIP0)})`);

  pokeShip(S.SHIP0, { x: 140, y: 120, vx: 0, vy: 0, act: 1, inv: 30 });
  runHook(S.GRAV_BRK, "grav from below");
  const vy = vm.peek(S.SHIP0 + S.O_VYL) | (signed8(vm.peek(S.SHIP0 + S.O_VYH)) << 8);
  ok(vy < 0, `ship below the sun gets -vy (got ${vy})`);
}

console.log("D) wrap");
{
  pokeShip(S.SHIP0, { x: 0xffff, y: 80, act: 1 }); // -1
  runHook(S.WRAP_BRK, "wrap left");
  ok(peekX(S.SHIP0) === 279, `x=-1 wraps to 279 (got ${peekX(S.SHIP0)})`);

  pokeShip(S.SHIP0, { x: 280, y: 80, act: 1 });
  runHook(S.WRAP_BRK, "wrap right");
  ok(peekX(S.SHIP0) === 0, `x=280 wraps to 0 (got ${peekX(S.SHIP0)})`);

  pokeShip(S.SHIP0, { x: 40, y: 0xffff, act: 1 }); // y=-1
  runHook(S.WRAP_BRK, "wrap top");
  ok((peekY(S.SHIP0) & 0xff) === 159, `y=-1 wraps to 159 (got ${peekY(S.SHIP0)})`);
}

console.log("E) thrust along heading 0 increases +vx");
runHook(S.INIT_BRK, "init thrust");
{
  pokeShip(S.SHIP0, { x: 40, y: 80, vx: 0, vy: 0, ang: 0, act: 1, inv: 30 });
  runHook(S.THRUST_BRK, "thrust");
  ok(peekVX(S.SHIP0) === 64, `heading-0 thrust adds COSTAB 64 (got ${peekVX(S.SHIP0)})`);
}

console.log("F) firing");
runHook(S.INIT_BRK, "init fire");
{
  vm.poke(S.SHIP0 + S.O_COOL, 0);
  vm.poke(S.SHIP0 + S.O_ANG, 0);
  runHook(S.FIRE_BRK, "fire");
  ok(vm.peek(S.SHOTS + S.B_ACT) === 1, "slot 0 becomes an active shot");
  ok(signed8(vm.peek(S.SHOTS + S.B_DX)) === 4, "heading-0 shot travels +4 x");
  ok(vm.peek(S.SHOTS + S.B_OWN) === 0, "shot belongs to player 1");
}

console.log("G) sun collision scores for the opponent");
runHook(S.INIT_BRK, "init sun");
{
  pokeShip(S.SHIP0, { x: 140, y: 80, act: 1, inv: 0 });
  vm.poke(S.P1SC, 0);
  vm.poke(S.P2SC, 0);
  vm.poke(S.GSTATE, S.GS_PLAY);
  vm.poke(S.NOSCORE, 0);
  runHook(S.GRAV_BRK, "eat by sun");
  ok(vm.peek(S.SHIP0 + S.O_ACT) === 0, "sun contact deactivates the ship");
  ok(vm.peek(S.P2SC) === 1, "player 2 scores the sun kill");
}

console.log("H) shot hits the other ship");
runHook(S.INIT_BRK, "init hit");
{
  pokeShip(S.SHIP0, { x: 40, y: 80, act: 1, inv: 30 });
  pokeShip(S.SHIP1, { x: 80, y: 80, act: 1, inv: 0 });
  vm.poke(S.P1SC, 0);
  vm.poke(S.P2SC, 0);
  vm.poke(S.GSTATE, S.GS_PLAY);
  vm.poke(S.SHOTS + S.B_ACT, 1);
  vm.poke(S.SHOTS + S.B_XL, 80);
  vm.poke(S.SHOTS + S.B_XH, 0);
  vm.poke(S.SHOTS + S.B_YL, 80);
  vm.poke(S.SHOTS + S.B_OWN, 0);
  vm.poke(S.SHOTS + S.B_LIFE, 10);
  runHook(S.HIT_BRK, "shot hit");
  ok(vm.peek(S.SHIP1 + S.O_ACT) === 0, "player 2 is destroyed");
  ok(vm.peek(S.P1SC) === 1, "player 1 scores the torpedo hit");
  ok(vm.peek(S.SHOTS + S.B_ACT) === 0, "the torpedo is consumed");
}

console.log("H2) glancing shot and live fire-and-fly");
runHook(S.INIT_BRK, "init glance");
{
  pokeShip(S.SHIP0, { x: 40, y: 80, act: 1, inv: 30 });
  pokeShip(S.SHIP1, { x: 80, y: 80, act: 1, inv: 0 });
  vm.poke(S.P1SC, 0);
  vm.poke(S.P2SC, 0);
  vm.poke(S.GSTATE, S.GS_PLAY);
  vm.poke(S.SHOTS + S.B_ACT, 1);
  vm.poke(S.SHOTS + S.B_XL, 80);
  vm.poke(S.SHOTS + S.B_XH, 0);
  vm.poke(S.SHOTS + S.B_YL, 86);
  vm.poke(S.SHOTS + S.B_OWN, 0);
  vm.poke(S.SHOTS + S.B_LIFE, 10);
  runHook(S.HIT_BRK, "glancing hit");
  ok(vm.peek(S.SHIP1 + S.O_ACT) === 0, "a shot 6px off the centre still kills");
  ok(vm.peek(S.P1SC) === 1, "glancing hit scores");
}

runHook(S.INIT_BRK, "init fly");
{
  pokeShip(S.SHIP0, { x: 40, y: 80, ang: 0, act: 1, inv: 0, dead: 0 });
  pokeShip(S.SHIP1, { x: 80, y: 80, ang: 16, act: 1, inv: 0, dead: 0 });
  vm.poke(S.SHIP0 + S.O_COOL, 0);
  vm.poke(S.P1SC, 0);
  vm.poke(S.P2SC, 0);
  vm.poke(S.GSTATE, S.GS_PLAY);
  for (let i = 0; i < 4; i++) vm.poke(S.SHOTS + i * 16 + S.B_ACT, 0);
  runHook(S.FIRE_BRK, "live fire");
  let killed = false;
  for (let i = 0; i < 20; i++) {
    runHook(S.STEP_BRK, `fly ${i}`);
    if (vm.peek(S.SHIP1 + S.O_ACT) === 0) { killed = true; break; }
  }
  ok(killed, "a heading-0 torpedo destroys a ship 40px ahead");
  ok(vm.peek(S.P1SC) === 1, "live fire-and-fly awards a point");
}

console.log("I) dual SNES pads");
runHook(S.INIT_BRK, "init pads");
{
  clearPads();
  vm.poke(0xc000, 0);
  vm.poke(S.GAMEPAD1 + S.PAD_LEFT, 1);
  vm.poke(S.GAMEPAD2 + S.PAD_RIGHT, 1);
  runHook(S.INPUT_BRK, "pads");
  ok(vm.peek(S.P1L) === 1, "pad 1 left rotate");
  ok(vm.peek(S.P2R) === 1, "pad 2 right rotate");
  ok(vm.peek(S.P1R) === 0 && vm.peek(S.P2L) === 0, "the other rotate flags stay clear");

  clearPads();
  vm.poke(S.GAMEPAD1 + S.PAD_LEFT, 1);
  vm.poke(S.GAMEPAD1 + S.PAD_RIGHT, 1);
  vm.poke(S.GAMEPAD1 + S.PAD_UP, 1);
  runHook(S.INPUT_BRK, "impossible pad");
  ok(vm.peek(S.P1L) === 0 && vm.peek(S.P1T) === 0, "LEFT+RIGHT together is ignored (phantom pad)");
}

console.log("J) mutual ship collision scores nobody");
runHook(S.INIT_BRK, "init ramming");
{
  pokeShip(S.SHIP0, { x: 100, y: 80, act: 1, inv: 0 });
  pokeShip(S.SHIP1, { x: 102, y: 80, act: 1, inv: 0 });
  vm.poke(S.P1SC, 0);
  vm.poke(S.P2SC, 0);
  vm.poke(S.GSTATE, S.GS_PLAY);
  vm.poke(S.NOSCORE, 0);
  runHook(S.HIT_BRK, "ram");
  ok(vm.peek(S.SHIP0 + S.O_ACT) === 0 && vm.peek(S.SHIP1 + S.O_ACT) === 0, "both ships die on contact");
  ok(vm.peek(S.P1SC) === 0 && vm.peek(S.P2SC) === 0, "ramming awards no points");
}

console.log("K) sun is drawn and first-to-5 ends the match");
runHook(S.INIT_BRK, "init sun pixel");
{
  ok(getpix(140, 80) === 1, "sun center pixel is lit");
  pokeShip(S.SHIP0, { x: 140, y: 80, act: 1, inv: 0 });
  vm.poke(S.P2SC, 4);
  vm.poke(S.P1SC, 0);
  vm.poke(S.GSTATE, S.GS_PLAY);
  vm.poke(S.NOSCORE, 0);
  runHook(S.GRAV_BRK, "winning sun kill");
  ok(vm.peek(S.P2SC) === 5, "fifth kill reaches WINSC");
  ok(vm.peek(S.GSTATE) === S.GS_OVER, "match switches to game-over");
  ok(vm.peek(S.WINNER) === 1, "player 2 is recorded as winner");
}

console.log("L) Q requests monitor exit");
{
  vm.poke(0xc000, S.K_Q);
  runHook(S.INPUT_BRK, "quit key");
  ok(vm.peek(S.QUITF) === 1, "Q sets the quit flag");
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll STAR DUEL checks passed.");
