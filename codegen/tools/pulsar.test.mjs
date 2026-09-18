// pulsar.test.mjs — PULSAR DUEL engine and gameplay checks.
// Run: node codegen/tools/pulsar.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "pulsar", "pulsar.s");
const EMULATOR_PRG = join(HERE, "..", "..", "emulator", "AICodeGen", "pulsar", "pulsar.prg");
const WEB_SRC = join(HERE, "..", "..", "web", "programs", "pulsar.s");
const WEB_PRG = join(HERE, "..", "..", "web", "programs", "pulsar.prg");

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log("  PASS " + msg);
  else {
    console.log("  FAIL " + msg);
    failures++;
  }
};
const section = (name) => console.log("\n" + name);

const haddr = (y) =>
  0x2000 + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;

const src = readFileSync(SRC, "utf8");
const { org, bytes, symbols: rawSymbols } = assemble(src);
// The assembler folds symbol names to upper case; look them up either way.
const S = new Proxy({}, {
  get(_, name) {
    if (typeof name !== "string") return undefined;
    const v = rawSymbols[name] ?? rawSymbols[name.toUpperCase()] ?? rawSymbols[name.toLowerCase()];
    if (v === undefined) throw new Error(`unknown symbol: ${name}`);
    return v;
  },
});
const end = org + bytes.length;

section(`assembled pulsar.s: ${bytes.length} bytes @ $${org.toString(16)} (ends $${end.toString(16)})`);
ok(org === 0x0800, "loads at $0800");
ok(end <= 0x2000, "image stays below hi-res page 1 at $2000");

const image = Buffer.from(bytes);
writeFileSync(EMULATOR_PRG, image);
mkdirSync(dirname(WEB_PRG), { recursive: true });
writeFileSync(WEB_PRG, image);
writeFileSync(WEB_SRC, src);
ok(image.equals(readFileSync(EMULATOR_PRG)), "emulator PRG matches assembled source");
ok(image.equals(readFileSync(WEB_PRG)), "web PRG matches assembled source");

const s = await boot();
const vm = s.vm;
s.load(bytes, org);

const pk = (a) => vm.peek(a);
const po = (a, v) => vm.poke(a, v & 0xff);
const s8 = (v) => (v & 0x80 ? v - 256 : v);
const s16 = (lo, hi) => {
  const v = (hi << 8) | lo;
  return v & 0x8000 ? v - 0x10000 : v;
};
const getpix = (x, y) => (pk(haddr(y) + Math.floor(x / 7)) >> (x % 7)) & 1;

function hook(entry, label) {
  const r = s.run({ org: entry, maxCycles: 12_000_000, chunk: 250_000 });
  if (r.halt !== "brk-monitor") {
    throw new Error(`${label}: expected BRK halt, got ${r.halt} after ${r.cycles} cycles`);
  }
  return r;
}

// Per-player and per-torpedo state helpers.
const shipGet = (sym, i) => pk(S[sym] + i);
const shipSet = (sym, i, v) => po(S[sym] + i, v);
const setVel = (sym, i, v) => {
  const u = v & 0xffff;
  po(S[sym + "l"] + i, u & 0xff);
  po(S[sym + "h"] + i, (u >> 8) & 0xff);
};
const getVel = (sym, i) => s16(pk(S[sym + "l"] + i), pk(S[sym + "h"] + i));

const STARX = 128;
const STARY = 80;
const PFHIGH = 160;

function placeShip(i, { x, y, vx = 0, vy = 0, ang = 0, alive = 1, inv = 0 }) {
  shipSet("sxi", i, x);
  shipSet("sxf", i, 0);
  shipSet("syi", i, y);
  shipSet("syf", i, 0);
  setVel("svx", i, vx);
  setVel("svy", i, vy);
  shipSet("sang", i, ang);
  shipSet("salive", i, alive);
  shipSet("sinvt", i, inv);
  shipSet("srsp", i, 0);
  shipSet("scool", i, 0);
  shipSet("swcool", i, 0);
  shipSet("sdrwn", i, 0);
  shipSet("sexlf", i, 0);
  shipSet("sexdr", i, 0);
}

// step_ships is driven by do_frame, which bumps the frame counter; the hook
// calls it directly, so advance the counter here to match a real frame.
function stepShips() {
  po(S.frcnt, pk(S.frcnt) + 1);
  hook(S.hk_ships, "hk_ships");
}

const GSPLAY = 1;

function clearIntents() {
  for (const n of ["ipl", "ipr", "ipt", "ipf", "iph", "hpl", "hpr", "hpt", "hpf", "hph"]) {
    po(S[n], 0);
    po(S[n] + 1, 0);
  }
}

function clearShots() {
  for (let i = 0; i < 6; i++) {
    po(S.tlife + i, 0);
    po(S.tdrwn + i, 0);
  }
}

// Wrapped shortest distance along x, exactly like the 6502 code sees it.
const wrapdx = (a, b) => s8((b - a) & 0xff);

function radius(i) {
  const dx = wrapdx(shipGet("sxi", i), STARX);
  const dy = STARY - shipGet("syi", i);
  return Math.hypot(dx, dy);
}

// --------------------------------------------------------------- init ------
section("initialisation");
hook(S.hk_init, "hk_init");
ok(pk(S.fastmd) === 1, "fast mode armed for the remaining tests");

let rowsOk = true;
for (let y = 0; y < PFHIGH; y++) {
  const want = haddr(y);
  const got = pk(S.ROWL + y) | (pk(S.ROWH + y) << 8);
  if (got !== want) { rowsOk = false; break; }
}
ok(rowsOk, "ROWL/ROWH hold all 160 hi-res scanline bases");

let colsOk = true;
for (let x = 0; x < 256; x++) {
  const px = x + 12;
  if (pk(S.XBYTE + x) !== Math.floor(px / 7)) { colsOk = false; break; }
  if (pk(S.XMASK + x) !== (1 << (px % 7))) { colsOk = false; break; }
}
ok(colsOk, "XBYTE/XMASK map logical x to column x+12");

ok(pk(S.sxi) === 80 && pk(S.sxi + 1) === 176, "both pilots spawn on opposite sides");
ok(pk(S.syi) === 80 && pk(S.syi + 1) === 80, "both pilots spawn on the star's latitude");
ok(pk(S.salive) === 1 && pk(S.salive + 1) === 1, "both pilots start alive");
ok(getVel("svy", 0) > 0 && getVel("svy", 1) < 0, "spawn velocities orbit in the same sense");

// --------------------------------------------------------------- plot ------
section("XOR plotting");
po(S.rpx, 100);
po(S.rpy, 33);
hook(S.hk_plot, "hk_plot");
ok(getpix(112, 33) === 1, "plotxor lights logical x=100 at hi-res column 112");
hook(S.hk_plot, "hk_plot");
ok(getpix(112, 33) === 0, "plotting the same point again erases it");

po(S.rpx, 5);
po(S.rpy, 170); // 170 - 160 = row 10
hook(S.hk_plot, "hk_plot");
ok(getpix(17, 10) === 1, "a y past the bottom wraps back to the top");
hook(S.hk_plot, "hk_plot");

po(S.rpx, 5);
po(S.rpy, 250); // -6 -> row 154
hook(S.hk_plot, "hk_plot");
ok(getpix(17, 154) === 1, "a negative y wraps to the bottom");
hook(S.hk_plot, "hk_plot");

po(S.lx0, 20); po(S.ly0, 40); po(S.lx1, 50); po(S.ly1, 40);
hook(S.hk_line, "hk_line");
let lineOk = true;
for (let x = 20; x <= 50; x++) if (!getpix(x + 12, 40)) lineOk = false;
ok(lineOk, "drawline fills a horizontal run end to end");
po(S.lx0, 20); po(S.ly0, 40); po(S.lx1, 50); po(S.ly1, 40);
hook(S.hk_line, "hk_line");
let clearOk = true;
for (let x = 20; x <= 50; x++) if (getpix(x + 12, 40)) clearOk = false;
ok(clearOk, "redrawing the same line erases it");

po(S.lx0, 10); po(S.ly0, 10); po(S.lx1, 30); po(S.ly1, 25);
hook(S.hk_line, "hk_line");
ok(getpix(22, 10) === 1 && getpix(42, 25) === 1, "a diagonal reaches both endpoints");
po(S.lx0, 10); po(S.ly0, 10); po(S.lx1, 30); po(S.ly1, 25);
hook(S.hk_line, "hk_line");

// ----------------------------------------------------------- distance ------
section("distance and gravity");
const octo = (dx, dy) => {
  const a = Math.abs(dx), b = Math.abs(dy);
  return Math.max(a, b) + (Math.min(a, b) >> 1);
};
let distOk = true;
for (const [x, y] of [[128, 80], [128, 0], [48, 80], [200, 120], [8, 150], [250, 20]]) {
  po(S.gpx, x);
  po(S.gpy, y);
  hook(S.hk_dist, "hk_dist");
  const want = Math.min(255, octo(wrapdx(x, STARX), STARY - y));
  if (pk(S.rdist) !== want) { distOk = false; console.log(`   dist(${x},${y}) = ${pk(S.rdist)} want ${want}`); }
}
ok(distOk, "distcalc matches the octagonal norm, including across the x seam");

po(S.gpx, 48); po(S.gpy, 80);
hook(S.hk_dist, "hk_dist");
ok(s8(pk(S.gdx)) > 0 && pk(S.gdy) === 0, "a ship left of the star is pulled right");
po(S.gpx, 208); po(S.gpy, 80);
hook(S.hk_dist, "hk_dist");
ok(s8(pk(S.gdx)) < 0, "a ship right of the star is pulled left");
po(S.gpx, 128); po(S.gpy, 20);
hook(S.hk_dist, "hk_dist");
ok(s8(pk(S.gdy)) > 0, "a ship above the star is pulled down");

function accelAt(x, y) {
  po(S.gpx, x);
  po(S.gpy, y);
  hook(S.hk_grav, "hk_grav");
  return {
    ax: s16(pk(S.gaxl), pk(S.gaxh)),
    ay: s16(pk(S.gayl), pk(S.gayh)),
    r: pk(S.rdist),
  };
}
const near = accelAt(48, 80);
const far = accelAt(8, 80);
ok(near.ax > 0 && near.ay === 0, "gravity accelerates a ship straight at the star");
ok(Math.abs(far.ax) < Math.abs(near.ax), "gravity weakens with distance");
// a = G / r^2, G = 160, in 8.8 units.
const wantA = Math.round((160 / (80 * 80)) * 256);
ok(Math.abs(near.ax - wantA) <= 2, `field strength at r=80 is ~${wantA} in 8.8 (got ${near.ax})`);

const diag = accelAt(128 - 56, 80 - 56);
ok(diag.ax > 0 && diag.ay > 0, "a diagonal approach is pulled on both axes");

// ------------------------------------------------------------- orbit -------
section("orbital mechanics");
hook(S.hk_init, "hk_init");
clearShots();
clearIntents();
shipSet("salive", 1, 0);
let rmin = 999, rmax = 0;
for (let f = 0; f < 240; f++) {
  clearIntents();
  stepShips();
  const r = radius(0);
  rmin = Math.min(rmin, r);
  rmax = Math.max(rmax, r);
}
ok(pk(S.salive) === 1, "the spawn orbit does not fall into the star");
ok(rmin > 30 && rmax < 75, `orbit radius stays bounded over 240 frames (${rmin.toFixed(1)}..${rmax.toFixed(1)})`);

let sweptLeft = false, sweptRight = false, sweptUp = false, sweptDown = false;
for (let f = 0; f < 400; f++) {
  clearIntents();
  stepShips();
  const dx = wrapdx(STARX, shipGet("sxi", 0));
  const dy = shipGet("syi", 0) - STARY;
  if (dx < -20) sweptLeft = true;
  if (dx > 20) sweptRight = true;
  if (dy < -20) sweptUp = true;
  if (dy > 20) sweptDown = true;
}
ok(sweptLeft && sweptRight && sweptUp && sweptDown, "the ship completes a circuit around the star");

// ------------------------------------------------------- flight controls ---
section("flight controls");
hook(S.hk_init, "hk_init");
clearShots();
shipSet("salive", 1, 0);
placeShip(0, { x: 20, y: 20, ang: 0, inv: 0 });

clearIntents();
po(S.ipl, 1);
const a0 = shipGet("sang", 0);
stepShips();
stepShips();
const aLeft = shipGet("sang", 0);
placeShip(0, { x: 20, y: 20, ang: a0 });
clearIntents();
po(S.ipr, 1);
stepShips();
stepShips();
const aRight = shipGet("sang", 0);
ok(aLeft !== a0 && aRight !== a0 && aLeft !== aRight, "left and right turn the ship opposite ways");
ok(((aLeft + 1) & 31) === a0 || ((aRight + 1) & 31) === a0, "turning steps exactly one of 32 headings");

// Thrust along +x (heading 0) far from the star so gravity barely matters.
placeShip(0, { x: 20, y: 20, ang: 0 });
clearIntents();
po(S.ipt, 1);
for (let f = 0; f < 8; f++) stepShips();
ok(getVel("svx", 0) > 60, "thrust on heading 0 builds +x speed");
ok(Math.abs(getVel("svy", 0)) < 40, "thrust on heading 0 leaks little +y speed");

placeShip(0, { x: 20, y: 20, ang: 8 });
clearIntents();
po(S.ipt, 1);
for (let f = 0; f < 8; f++) stepShips();
ok(getVel("svy", 0) > 60, "thrust on heading 8 builds +y speed");

placeShip(0, { x: 20, y: 60, vx: 0x0a00, ang: 0 });
clearIntents();
for (let f = 0; f < 60; f++) stepShips();
ok(Math.abs(getVel("svx", 0)) <= 4 * 256, "ship speed is capped");

// Wrap: run a ship off the right edge and off the top.
placeShip(0, { x: 250, y: 20, vx: 3 * 256, ang: 0 });
clearIntents();
for (let f = 0; f < 4; f++) stepShips();
ok(shipGet("sxi", 0) < 60, "a ship leaving the right edge reappears on the left");

placeShip(0, { x: 20, y: 4, vy: -3 * 256, ang: 0 });
clearIntents();
for (let f = 0; f < 4; f++) stepShips();
const wy = shipGet("syi", 0);
ok(wy >= 140 && wy < PFHIGH, `a ship leaving the top reappears at the bottom (row ${wy})`);

// --------------------------------------------------------- torpedoes -------
section("torpedoes");
hook(S.hk_init, "hk_init");
clearShots();
shipSet("salive", 1, 0);
placeShip(0, { x: 20, y: 20, ang: 0 });
clearIntents();
po(S.ipf, 1);
stepShips();
let live = 0;
for (let i = 0; i < 3; i++) if (pk(S.tlife + i) > 0) live++;
ok(live === 1, "fire launches exactly one torpedo from P1's magazine");
ok(pk(S.tlife + 3) === 0 && pk(S.tlife + 4) === 0 && pk(S.tlife + 5) === 0,
   "P1 cannot consume P2's magazine");
ok(getVel("tvx", 0) > 256, "the torpedo leaves faster than the ship");
ok(pk(S.scool) > 0, "firing starts the reload cooldown");

clearIntents();
po(S.ipf, 1);
stepShips();
live = 0;
for (let i = 0; i < 3; i++) if (pk(S.tlife + i) > 0) live++;
ok(live === 1, "the cooldown blocks an immediate second shot");

// A torpedo flying past the star should be bent toward it.
clearShots();
clearIntents();
shipSet("salive", 0, 0);
po(S.txi, 40); po(S.txf, 0);
po(S.tyi, 20); po(S.tyf, 0);
po(S.tvxl, 0x00); po(S.tvxh, 0x03);
po(S.tvyl, 0x00); po(S.tvyh, 0x00);
po(S.tlife, 90);
for (let f = 0; f < 30; f++) hook(S.hk_shots, "hk_shots");
ok(pk(S.tyi) > 20, "a torpedo passing the star curves toward it");
ok(s16(pk(S.tvyl), pk(S.tvyh)) > 0, "gravity gives the torpedo downward speed");

clearShots();
po(S.txi, 40); po(S.tyi, 20);
po(S.tvxl, 0); po(S.tvxh, 1);
po(S.tvyl, 0); po(S.tvyh, 0);
po(S.tlife, 3);
for (let f = 0; f < 4; f++) hook(S.hk_shots, "hk_shots");
ok(pk(S.tlife) === 0, "torpedoes expire when their fuel runs out");

// ------------------------------------------------------- collisions --------
section("collisions and scoring");
hook(S.hk_init, "hk_init");
clearShots();
clearIntents();
po(S.gstate, GSPLAY);
po(S.sscor, 0);
po(S.sscor + 1, 0);
placeShip(0, { x: STARX + 2, y: STARY + 1, ang: 0 });
shipSet("salive", 1, 0);
stepShips();
ok(pk(S.salive) === 0, "flying into the pulsar destroys the ship");
ok(pk(S.sscor + 1) === 1, "the surviving pilot is credited with the kill");
ok(pk(S.sexlf) > 0, "the wreck leaves an expanding ring");

hook(S.hk_init, "hk_init");
clearShots();
clearIntents();
po(S.gstate, GSPLAY);
po(S.sscor, 0);
po(S.sscor + 1, 0);
placeShip(0, { x: 30, y: 30, ang: 0, inv: 0 });
placeShip(1, { x: 200, y: 30, ang: 0, inv: 0 });
// A P2 torpedo (slot 3) parked on top of P1.
po(S.txi + 3, 31); po(S.txf + 3, 0);
po(S.tyi + 3, 31); po(S.tyf + 3, 0);
po(S.tvxl + 3, 0); po(S.tvxh + 3, 0);
po(S.tvyl + 3, 0); po(S.tvyh + 3, 0);
po(S.tlife + 3, 40);
hook(S.hk_shots, "hk_shots");
ok(pk(S.salive) === 0, "a torpedo hit destroys the ship it lands on");
ok(pk(S.sscor + 1) === 1, "the shooter is credited");
ok(pk(S.tlife + 3) === 0, "the torpedo is consumed by the hit");

// Spawn protection makes a fresh ship immune.
hook(S.hk_init, "hk_init");
clearShots();
clearIntents();
placeShip(0, { x: 30, y: 30, ang: 0, inv: 30 });
placeShip(1, { x: 200, y: 30, ang: 0 });
po(S.txi + 3, 31); po(S.tyi + 3, 31);
po(S.txf + 3, 0); po(S.tyf + 3, 0);
po(S.tvxl + 3, 0); po(S.tvxh + 3, 0);
po(S.tvyl + 3, 0); po(S.tvyh + 3, 0);
po(S.tlife + 3, 40);
hook(S.hk_shots, "hk_shots");
ok(pk(S.salive) === 1, "a freshly spawned ship shrugs off a hit");

// A ship must respawn after its wreck clears.
hook(S.hk_init, "hk_init");
clearShots();
clearIntents();
po(S.gstate, GSPLAY);
placeShip(0, { x: 30, y: 30, ang: 0 });
shipSet("salive", 1, 0);
po(S.curobj, 0);
hook(S.hk_kill, "hk_kill");
ok(pk(S.salive) === 0 && pk(S.srsp) > 0, "a kill starts the respawn clock");
for (let f = 0; f < 80; f++) {
  clearIntents();
  stepShips();
  if (pk(S.salive) === 1) break;
}
ok(pk(S.salive) === 1, "the pilot respawns");
ok(pk(S.sinvt) > 0, "the new ship spawns with protection");

// Match end.
hook(S.hk_init, "hk_init");
clearShots();
clearIntents();
po(S.gstate, GSPLAY);
po(S.sscor, 4);
po(S.sscor + 1, 0);
placeShip(0, { x: 30, y: 30, ang: 0 });
placeShip(1, { x: STARX + 2, y: STARY + 1, ang: 0 });
stepShips();
ok(pk(S.sscor) === 5, "the fifth kill lands");
ok(pk(S.winner) === 0, "player one is recorded as the winner");
ok(pk(S.gstate) !== GSPLAY, "reaching five ends the match");

// --------------------------------------------------------------- input -----
section("input");
hook(S.hk_init, "hk_init");
clearIntents();
po(0xc000, 0xc1); // 'A'
hook(S.hk_keys, "hk_keys");
ok(pk(S.hpl) > 0, "keyboard A arms P1's left hold timer");
clearIntents();
po(0xc000, 0xcc); // 'L'
hook(S.hk_keys, "hk_keys");
ok(pk(S.hpr + 1) > 0, "keyboard L arms P2's right hold timer");
clearIntents();
po(0xc000, 0xd7); // 'W'
hook(S.hk_keys, "hk_keys");
ok(pk(S.hpt) > 0, "keyboard W arms P1's thrust hold timer");
clearIntents();
po(0xc000, 0xc9); // 'I'
hook(S.hk_keys, "hk_keys");
ok(pk(S.hpt + 1) > 0, "keyboard I arms P2's thrust hold timer");
clearIntents();
po(0xc000, 0xd8); // 'X'
hook(S.hk_keys, "hk_keys");
ok(pk(S.hph) > 0, "keyboard X arms P1's hyperspace hold timer");

// A single keypress should survive several frames of held intent.
clearIntents();
po(0xc000, 0xd3); // 'S'
hook(S.hk_keys, "hk_keys");
let heldFrames = 0;
for (let f = 0; f < 10; f++) {
  hook(S.hk_merge, "hk_merge");
  if (pk(S.ipf) === 1) heldFrames++;
}
ok(heldFrames >= 2, `one keypress holds fire for ${heldFrames} frames`);
ok(pk(S.ipf) === 0 || heldFrames < 10, "the hold eventually lapses");

clearIntents();
po(0xc000, 0xd1); // 'Q'
hook(S.hk_keys, "hk_keys");
ok(pk(S.quitf) === 1, "Q asks to quit");
po(S.quitf, 0);

// SNES pads.
const PAD1 = 0xcee0, PAD2 = 0xcef0;
const clearPads = () => { for (let i = 0; i < 16; i++) { po(PAD1 + i, 0); po(PAD2 + i, 0); } };
clearPads();
po(PAD1 + 6, 1);              // P1 LEFT
po(PAD2 + 7, 1);              // P2 RIGHT
po(PAD1 + 0, 1);              // P1 B -> thrust
po(PAD2 + 4, 1);              // P2 UP -> thrust
po(PAD1 + 8, 1);              // P1 A -> fire
po(PAD2 + 1, 1);              // P2 Y -> fire
po(PAD1 + 2, 1);              // P1 SELECT -> hyperspace
hook(S.hk_pads, "hk_pads");
ok(pk(S.ipl) === 1 && pk(S.ipr + 1) === 1, "both pads steer their own ship");
ok(pk(S.ipt) === 1 && pk(S.ipt + 1) === 1, "B and UP both thrust");
ok(pk(S.ipf) === 1 && pk(S.ipf + 1) === 1, "A and Y both fire");
ok(pk(S.iph) === 1, "SELECT triggers hyperspace");
ok(pk(S.ipr) === 0 && pk(S.ipl + 1) === 0, "pad input does not bleed between players");

clearPads();
po(PAD1 + 6, 1);
po(PAD1 + 7, 1);
hook(S.hk_pads, "hk_pads");
ok(pk(S.ipl) === 0 && pk(S.ipr) === 0, "an impossible left+right is ignored");

clearPads();
po(S.wantst, 0);
po(PAD2 + 3, 1);              // P2 START
hook(S.hk_pads, "hk_pads");
ok(pk(S.wantst) === 1, "START requests a match");
clearPads();

// --------------------------------------------------------------- render ----
section("rendering");
hook(S.hk_init, "hk_init");
clearShots();
clearIntents();
placeShip(0, { x: 60, y: 40, ang: 0 });
placeShip(1, { x: 200, y: 120, ang: 8 });
po(S.txi, 90); po(S.tyi, 70); po(S.tlife, 20); po(S.tdrwn, 0);

const before = [];
for (let y = 0; y < PFHIGH; y++) before.push(Buffer.from(
  Array.from({ length: 40 }, (_, c) => pk(haddr(y) + c))));

hook(S.hk_draw, "hk_draw");
let lit = 0;
for (let y = 0; y < PFHIGH; y++)
  for (let c = 0; c < 40; c++)
    if (pk(haddr(y) + c) !== before[y][c]) lit++;
ok(lit > 0, "draw_all puts geometry on the page");
ok(pk(S.sdrwn) === 1 && pk(S.sdrwn + 1) === 1, "both hulls are marked drawn");
ok(pk(S.tdrwn) === 1, "the torpedo is marked drawn");
ok(getpix(90 + 12, 70) === 1, "the torpedo is a single lit pixel");

hook(S.hk_erase, "hk_erase");
let restored = true;
for (let y = 0; y < PFHIGH; y++)
  for (let c = 0; c < 40; c++)
    if (pk(haddr(y) + c) !== before[y][c]) restored = false;
ok(restored, "erase_all restores the starfield underneath exactly");
ok(pk(S.sdrwn) === 0 && pk(S.tdrwn) === 0, "drawn flags clear after erasing");

// The pulsar itself must be on the page and never rubbed out.
let core = 0;
for (let dy = -4; dy <= 4; dy++)
  for (let dx = -4; dx <= 4; dx++)
    if (getpix(STARX + dx + 12, STARY + dy)) core++;
ok(core > 25, "the pulsar core is painted at the centre of the field");

// High bit must be set on every HUD cell, or the text renders inverse.
section("HUD");
po(S.hudirty, 1);
po(S.sscor, 3);
po(S.sscor + 1, 2);
hook(S.hk_hud, "hk_hud");
ok(pk(S.hudcpy + 11) === 0xb3, "P1's score digit is drawn");
ok(pk(S.hudcpy + 33) === 0xb2, "P2's score digit is drawn");
let hiOk = true;
for (let c = 0; c < 40; c++) if ((pk(S.hudcpy + c) & 0x80) === 0) hiOk = false;
ok(hiOk, "HUD text is normal video, not inverse");

const rows = s.textScreen();
ok(rows.some((r) => r.includes("PULSAR DUEL")), "the title banner is on screen");
ok(rows.some((r) => r.includes("P1 A D W S X")), "the keyboard legend is on screen");
ok(rows.some((r) => r.includes("PAD DPAD TURN")), "the gamepad legend is on screen");

// ------------------------------------------------------- full frame --------
section("full frame");
hook(S.hk_init, "hk_init");
po(S.wantst, 1);
hook(S.hk_frame, "hk_frame");
ok(pk(S.gstate) === GSPLAY, "START drops the machine into play");
// Returning to the monitor dominates any cycle count, so instead free-run the
// frame loop for a fixed budget and see how many frames it served.
po(S.frcnt, 0);
const BUDGET = 1_000_000;
s.run({ org: S.hk_floop, maxCycles: BUDGET, chunk: BUDGET, idleChunks: 99 });
const served = pk(S.frcnt);
const perFrame = Math.round(BUDGET / Math.max(1, served));
ok(served > 0, `the free-running loop served ${served} frames`);
ok(perFrame < 26_224,
   `a live frame costs ~${perFrame} cycles, inside the 26224-cycle budget`);
po(S.fastmd, 1);
for (let f = 0; f < 60; f++) hook(S.hk_frame, "hk_frame");
ok(pk(S.quitf) === 0, "sixty live frames run without asking to quit");
ok(pk(S.frcnt) !== 0, "the frame counter advances");

console.log(failures === 0 ? "\nVERDICT: PASS" : `\nVERDICT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
