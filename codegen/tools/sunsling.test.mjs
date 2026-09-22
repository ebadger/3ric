// Run after web/build.ps1: node codegen/tools/sunsling.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildBootableWoz } from "./wozgen.mjs";
import harness from "./harness.cjs";
import gamepads from "../../web/gamepad.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(ROOT, "codegen", "programs", "sunsling.s"), "utf8");
const { org, bytes, symbols: S } = assemble(source);
const { SNES } = gamepads;
const haddr = y => 0x2000 + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;
const imageByte = address => bytes[address - org];
const imageText = address => {
  let text = "";
  while (imageByte(address)) text += String.fromCharCode(imageByte(address++));
  return text;
};

assert.equal(org, 0x0800);
assert.equal(S.PROGRAM_END, org + bytes.length);
assert.ok(S.PROGRAM_END < 0x2000, "the raw image must not overlap hi-res memory");
assert.equal(S.FRAME_PERIOD, 52448);
assert.equal(S.BODY_COUNT, 10, "two ships plus four shots per pilot");
for (const name of ["TITLE", "PLAY", "PAUSE", "WIN1", "WIN2", "TIE", "SCORES", "P1", "P2"]) {
  assert.ok(imageText(S[`HUD_${name}`]).length <= 40, `${name} fits one text row`);
}
assert.equal(imageText(S.HUD_SCORES).length, 40);
const gallery = JSON.parse(readFileSync(join(ROOT, "web", "gallery.json"), "utf8"));
const entries = gallery.entries.filter(entry => entry.src === "programs/sunsling.s");
assert.equal(entries.length, 1);
assert.equal(entries[0].title, "SUNSLING");
assert.equal(entries[0].mode, "Hi-res");
assert.ok(gallery.entries.some(entry => entry.src === "programs/spacewar.s"),
  "STAR DUEL remains a separate, available game");
assert.match(readFileSync(join(ROOT, "web", "index.html"), "utf8"),
  /<optgroup label="Hi-res">(?:(?!<\/optgroup>)[\s\S])*<option value="sunsling">SUNSLING<\/option>/);
assert.equal(readFileSync(join(ROOT, "web", "programs", "sunsling.s"), "utf8"), source,
  "the gallery and editor load the canonical source staged by build.ps1");
console.log(`PASS assembly, memory layout, HUD bounds, and gallery/editor staging (${bytes.length} bytes)`);

async function create({ pad1 = 0, pad2 = 0, borrowedIO = false } = {}) {
  const session = await harness.boot();
  const vm = session.vm;
  const memory = (address, count) =>
    Buffer.from(Array.from({ length: count }, (_, i) => vm.peek(address + i)));
  if (borrowedIO) {
    vm.writeBus(S.VIA_ACR, vm.readBus(S.VIA_ACR) | 0x20);
    vm.writeBus(S.VIA_IER, 0xa0);
    vm.poke(S.JOY_MODE, 1);
  }
  const original = {
    flags: vm.status(),
    acr: vm.readBus(S.VIA_ACR),
    ier: vm.readBus(S.VIA_IER),
    joy: vm.peek(S.JOY_MODE),
    window: memory(0x20, 4),
    vectors: memory(0x36, 4),
    interrupts: memory(0x3fb, 5),
  };
  const canaries = [0x4f, 0x80, 0x1fff, 0x4000, 0x5fff, 0x60a0, 0x60ff,
    0x61a0, 0x61ff, 0x6600, 0x6fff];
  for (const address of canaries) vm.poke(address, 0xa5);
  vm.setGamepadState(0, pad1);
  vm.setGamepadState(1, pad2);
  session.load(bytes, org);

  function runTo(address, budget = 1_000_000) {
    vm.clearBreakpoints();
    vm.addBreakpoint(address);
    const cycles = vm.runCycles(budget);
    assert.ok(vm.breakpointHit(),
      `reach $${address.toString(16)} within ${budget} cycles (PC=$${vm.pc().toString(16)})`);
    assert.equal(vm.pc(), address);
    vm.clearBreakpoints();
    return cycles;
  }
  vm.setPC(org);
  runTo(S.MAIN);

  function call(entry, { a = 0, x = 0, y = 0 } = {}) {
    const trampoline = 0x7000;
    const code = [0xa9, a, 0xa2, x, 0xa0, y, 0x20, entry & 255, entry >> 8, 0xea];
    code.forEach((value, index) => vm.poke(trampoline + index, value));
    const sp = vm.sp();
    vm.setPC(trampoline);
    const cycles = runTo(trampoline + 9);
    assert.equal(vm.sp(), sp, "guest routines balance the stack, preserving entry PHP");
    vm.setPC(S.MAIN);
    return cycles;
  }
  function frame() {
    assert.equal(vm.pc(), S.MAIN);
    const first = vm.step();
    const work = first + runTo(S.FRAME_WAIT);
    const total = work + runTo(S.MAIN);
    return { work, total };
  }
  function key(value) {
    assert.equal(vm.readBus(S.KEYBOARD) & 0x80, 0, "previous key was consumed");
    vm.keyDown(typeof value === "string" ? value.charCodeAt(0) : value);
    const result = frame();
    assert.equal(vm.readBus(S.KEYBOARD) & 0x80, 0, "the game acknowledges the key");
    return result;
  }
  function setFixed(lo, hi, index, value) {
    const raw = Math.round(value * 256) & 0xffff;
    vm.poke(lo + index, raw & 255);
    vm.poke(hi + index, raw >> 8);
  }
  function fixed(lo, hi, index, signed = false) {
    const raw = vm.peek(lo + index) | (vm.peek(hi + index) << 8);
    return (signed && raw >= 32768 ? raw - 65536 : raw) / 256;
  }
  function body(index, { x = 24, y = 24, vx = 0, vy = 0 } = {}) {
    setFixed(S.X_LO, S.X_HI, index, x);
    setFixed(S.Y_LO, S.Y_HI, index, y);
    setFixed(S.VX_LO, S.VX_HI, index, vx);
    setFixed(S.VY_LO, S.VY_HI, index, vy);
  }
  function velocity(index) {
    return [fixed(S.VX_LO, S.VX_HI, index, true), fixed(S.VY_LO, S.VY_HI, index, true)];
  }
  function reset() {
    vm.setGamepadState(0, 0);
    vm.setGamepadState(1, 0);
    call(S.NEW_MATCH);
    call(S.READ_CONTROLS);
    call(S.DRAW_ACTORS);
    call(S.DRAW_HUD);
  }
  function stationary() {
    reset();
    body(0);
    body(1, { x: 232, y: 136 });
    vm.poke(S.SHIELD, 0);
    vm.poke(S.SHIELD + 1, 0);
  }
  function scene() {
    call(S.DRAW_BACKGROUND);
    call(S.DRAW_ACTORS);
    call(S.DRAW_HUD);
  }
  function protectedMemory({ monitor = false } = {}) {
    for (const address of canaries) {
      // The monitor's BRK register dump uses its own zero-page scratch.
      if (monitor && address < 0x100) continue;
      assert.equal(vm.peek(address), 0xa5, `canary $${address.toString(16)}`);
    }
    assert.deepEqual(memory(0x20, 4), original.window, "ROM text-window bounds survive");
    assert.deepEqual(memory(0x36, 4), original.vectors, "ROM I/O vectors survive");
    assert.deepEqual(memory(0x3fb, 5), original.interrupts, "ROM interrupt vectors survive");
    assert.deepEqual(memory(org, bytes.length), Buffer.from(bytes), "the raw program is not overwritten");
  }
  return { vm, session, original, memory, runTo, call, frame, key, fixed, body, velocity,
    reset, stationary, scene, protectedMemory, video: () => memory(0x2000, 0x2000) };
}

const app = await create();
try {
  const { vm, session, call, frame, key, body, velocity, fixed, reset, stationary, scene,
    memory, video, protectedMemory } = app;
  assert.equal(vm.peek(S.MODE), 0);
  assert.equal(vm.textMode(), 0);
  assert.equal(vm.lores(), 0);
  assert.equal(vm.mixed(), 1);
  assert.equal(vm.gfxPage(), 0);
  assert.match(session.textScreen()[20], /SUNSLING.*ENTER\/START/);
  assert.equal(session.textScreen()[21], "P1 0/5 T:- H:READY  P2 0/5 T:- H:READY");
  for (let y = 0; y < 160; y++) {
    assert.equal(vm.peek(S.ROW_LO + y) | (vm.peek(S.ROW_HI + y) << 8), haddr(y));
  }
  for (let x = 0; x < 256; x++) {
    assert.equal(vm.peek(S.COL_BYTE + x), Math.floor((x + 12) / 7));
    assert.equal(vm.peek(S.COL_MASK + x), 1 << ((x + 12) % 7));
  }
  const titleFrame = Buffer.from(vm.renderFrame());
  assert.equal(titleFrame.length, 320 * 384 * 4);
  let lit = 0;
  for (let i = 0; i < titleFrame.length; i += 4) {
    if (titleFrame[i] || titleFrame[i + 1] || titleFrame[i + 2]) lit++;
  }
  assert.ok(lit > 2000 && lit < 20000, `actual title/HUD framebuffer is lit but mostly space (${lit})`);
  const title = video();
  for (let i = 0; i < 8; i++) frame();
  assert.deepEqual(video(), title, "title actors erase/redraw without accumulating pixels");
  key(13);
  assert.equal(vm.peek(S.MODE), 1);
  assert.notDeepEqual(video(), title, "launch removes the title from the arena");
  console.log("PASS real title framebuffer, all scanline/column lookups, and keyboard launch");

  call(S.CLEAR_HGR);
  for (const x of [0, 1, 2, 8, 64, 127, 128, 249, 255]) {
    for (const y of [0, 7, 8, 63, 64, 127, 128, 159]) {
      vm.poke(S.PX, x);
      vm.poke(S.PY, y);
      call(S.PLOT);
      const address = haddr(y) + Math.floor((x + 12) / 7);
      assert.equal(vm.peek(address), 1 << ((x + 12) % 7));
      call(S.PLOT);
      assert.equal(vm.peek(address), 0);
    }
  }
  for (const [tx, ty] of [[16, 16], [22, 20], [10, 20], [22, 12], [10, 12],
    [16, 8], [16, 24], [8, 16], [24, 16], [23, 23]]) {
    call(S.CLEAR_HGR);
    vm.poke(S.ANCHOR_X, 128);
    vm.poke(S.ANCHOR_Y, 80);
    vm.poke(S.LX, 16);
    vm.poke(S.LY, 16);
    vm.poke(S.TX, tx);
    vm.poke(S.TY, ty);
    call(S.LINE);
    assert.equal(vm.peek(S.LX), tx, "DDA reaches its exact x endpoint");
    assert.equal(vm.peek(S.LY), ty, "DDA reaches its exact y endpoint");
    const pixels = [...video()].reduce((sum, byte) => sum + byte.toString(2).replaceAll("0", "").length, 0);
    assert.equal(pixels, Math.max(Math.abs(tx - 16), Math.abs(ty - 16)), "one XOR pixel per major-axis step");
  }
  reset();
  for (let pilot = 0; pilot < 2; pilot++) {
    vm.poke(S.DEAD + (pilot ^ 1), 1);
    vm.poke(S.DEAD + pilot, 0);
    vm.poke(S.SHIELD + pilot, 0);
    vm.poke(S.ENGINE_DRAW + pilot, 1);
    for (let angle = 0; angle < 16; angle++) {
      vm.poke(S.ANGLE + pilot, angle);
      for (const [x, y] of [[128, 80], [0, 0], [255, 159], [0, 159], [255, 0]]) {
        body(pilot, { x, y });
        call(S.CLEAR_HGR);
        call(S.DRAW_ACTORS);
        assert.ok(video().some(byte => byte !== 0), "each heading/edge has a visible ship");
        call(S.DRAW_ACTORS);
        assert.ok(video().every(byte => byte === 0), "wrapping outlines/exhaust erase exactly");
      }
    }
  }
  protectedMemory();
  console.log("PASS XOR pixels, vector endpoints, both ship silhouettes, and every heading at arena seams");

  stationary();
  call(S.DRAW_BACKGROUND);
  const occupied = new Set();
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 256; x++) {
      if (x >= 112 && x <= 144 && y >= 64 && y <= 96) continue;
      if (vm.peek(haddr(y) + Math.floor((x + 12) / 7)) & (1 << ((x + 12) % 7))) {
        occupied.add(`${x >> 5},${y >> 5}`);
      }
    }
  }
  assert.ok(occupied.size >= 26, `stars spread across the arena rather than LFSR diagonals (${occupied.size} cells)`);
  for (const x of [0, 1, 56, 96, 120, 128, 136, 160, 200, 254, 255]) {
    for (const y of [0, 1, 40, 72, 80, 88, 120, 158, 159]) {
      body(0, { x, y });
      vm.poke(S.BODY, 0);
      call(S.GRAVITY);
      const dx = 128 - x, dy = 80 - y;
      const radius = Math.max(Math.abs(dx), Math.abs(dy)) + Math.floor(Math.min(Math.abs(dx), Math.abs(dy)) / 2);
      const strength = imageByte(S.GRAVITY_STRENGTH + (radius >> 3));
      const expected = value => radius ? Math.sign(value) * Math.floor(Math.abs(value) * strength / radius) / 256 : 0;
      assert.deepEqual(velocity(0), [expected(dx) || 0, expected(dy) || 0], `radial force at (${x},${y})`);
    }
  }
  body(0, { x: 160, y: 80 });
  vm.poke(S.BODY, 0);
  call(S.GRAVITY);
  const near = Math.abs(velocity(0)[0]);
  body(0, { x: 240, y: 80 });
  call(S.GRAVITY);
  assert.ok(near > 5 * Math.abs(velocity(0)[0]), "the near-sun well is substantially stronger");
  for (const [position, speed, expected] of [
    [[255.75, 159.75], [0.5, 0.5], [0.25, 0.25]],
    [[0.25, 0.25], [-0.5, -0.5], [255.75, 159.75]],
    [[253.75, 158.75], [4, 4], [1.75, 2.75]],
    [[1.25, 1.25], [-4, -4], [253.25, 157.25]],
  ]) {
    body(0, { x: position[0], y: position[1], vx: speed[0], vy: speed[1] });
    call(S.MOVE_BODY);
    assert.deepEqual([fixed(S.X_LO, S.X_HI, 0), fixed(S.Y_LO, S.Y_HI, 0)], expected);
  }
  for (const limit of [2, 4]) {
    for (const speed of [-8, -4.5, -4, -2.1, -2, -0.5, 0, 0.5, 2, 2.5, 4, 4.5, 8]) {
      body(0, { vx: speed, vy: -speed });
      call(S.CLAMP_VELOCITY, { a: limit });
      const quantized = Math.round(speed * 256) / 256;
      const bounded = value => Math.max(-limit, Math.min(limit, value)) || 0;
      assert.deepEqual(velocity(0), [bounded(quantized), bounded(-quantized)]);
    }
  }
  stationary();
  vm.poke(S.BURN_INPUT, 1);
  vm.poke(S.TURN_INPUT, 0xff);
  call(S.STEP_GAME);
  assert.equal(vm.peek(S.ANGLE), 15);
  assert.equal(vm.peek(S.ENGINE_DRAW), 1);
  assert.ok(velocity(0)[0] > 0 && velocity(0)[1] < 0, "rotated thrust accelerates along the nose");
  vm.poke(S.TURN_INPUT, 1);
  call(S.STEP_GAME);
  assert.equal(vm.peek(S.ANGLE), 0);
  vm.poke(S.TURN_INPUT, 0);
  vm.poke(S.BURN_INPUT, 0);
  call(S.STEP_GAME);
  assert.ok(velocity(0)[0] > 0, "coasting preserves inertia");
  console.log("PASS signed fixed-point gravity, near/far falloff, singularity, fractional wrap, thrust, and speed caps");

  stationary();
  body(0, { x: 30.5, y: 30.25, vx: 1.25, vy: -0.5 });
  vm.poke(S.BODY, 0);
  call(S.FIRE);
  assert.equal(vm.peek(S.LIFE + 2), S.SHOT_LIFETIME);
  assert.deepEqual(velocity(2), [4.25, -0.5], "launch velocity is inherited before the normal speed cap");
  assert.equal(fixed(S.X_LO, S.X_HI, 2), 38.5);
  assert.equal(fixed(S.Y_LO, S.Y_HI, 2), 30.25);
  for (let pilot = 0; pilot < 2; pilot++) {
    vm.poke(S.BODY, pilot);
    for (let shot = 0; shot < 6; shot++) {
      vm.poke(S.GUN_CD + pilot, 0);
      call(S.FIRE);
    }
    for (let slot = 2 + pilot * 4; slot < 6 + pilot * 4; slot++) {
      assert.equal(vm.peek(S.LIFE + slot), S.SHOT_LIFETIME);
      assert.equal(vm.peek(S.OWNER + slot), pilot);
    }
  }
  assert.equal(memory(S.LIFE + 2, 8).filter(value => value > 0).length, 8);
  stationary();
  body(2, { x: 128, y: 40, vx: 2 });
  vm.poke(S.LIFE + 2, 40);
  for (let i = 0; i < 12; i++) call(S.STEP_GAME);
  assert.ok(velocity(2)[1] > 0);
  assert.ok(fixed(S.Y_LO, S.Y_HI, 2) > 42, "a tangential torpedo curves toward the sun");
  assert.ok(fixed(S.X_LO, S.X_HI, 2) < 152, "gravity also pulls its horizontal path inward");
  stationary();
  body(2);
  vm.poke(S.LIFE + 2, 5);
  call(S.STEP_GAME);
  assert.equal(vm.peek(S.DEAD), 0, "a torpedo cannot kill its owner");
  assert.equal(vm.peek(S.LIFE + 2), 4);
  for (let i = 0; i < 4; i++) call(S.STEP_GAME);
  assert.equal(vm.peek(S.LIFE + 2), 0, "shots expire and free their slots");
  console.log("PASS inherited torpedo velocity, both four-slot pools, curved trajectories, ownership, and expiration");

  for (const shield of [0, S.SHIELD_TICKS]) {
    stationary();
    body(0, { x: 128, y: 80 });
    vm.poke(S.SHIELD, shield);
    call(S.STEP_GAME);
    assert.equal(vm.peek(S.DEAD), S.RESPAWN_TICKS, "even a shield cannot survive the sun");
    assert.equal(vm.peek(S.SCORE + 1), 1);
    for (let i = 0; i < S.RESPAWN_TICKS - 1; i++) call(S.STEP_GAME);
    assert.equal(vm.peek(S.DEAD), 1);
    assert.equal(vm.peek(S.SCORE + 1), 1, "a death scores only once");
    call(S.STEP_GAME);
    assert.equal(vm.peek(S.DEAD), 0);
    assert.equal(vm.peek(S.SHIELD), S.SHIELD_TICKS);
    assert.equal(vm.peek(S.X_HI), imageByte(S.SPAWN_X));
    assert.equal(vm.peek(S.Y_HI), imageByte(S.SPAWN_Y));
  }
  for (const [first, second] of [
    [[70, 50], [70, 50]], [[2, 50], [254, 50]], [[30, 2], [30, 158]],
  ]) {
    stationary();
    body(0, { x: first[0], y: first[1] });
    body(1, { x: second[0], y: second[1] });
    call(S.STEP_GAME);
    assert.deepEqual([...memory(S.SCORE, 2)], [1, 1], "ship contact scores both pilots, including seams");
    assert.deepEqual([...memory(S.DEAD, 2)], [S.RESPAWN_TICKS, S.RESPAWN_TICKS]);
  }
  for (const pilot of [0, 1]) {
    stationary();
    const target = pilot ^ 1, slot = 2 + pilot * 4;
    body(target, { x: 254, y: 158 });
    body(slot, { x: 2, y: 2 });
    vm.poke(S.LIFE + slot, 20);
    call(S.STEP_GAME);
    assert.equal(vm.peek(S.SCORE + pilot), 1, "torpedo hits across both seams credit their owner");
    assert.equal(vm.peek(S.DEAD + target), S.RESPAWN_TICKS);
    assert.equal(vm.peek(S.LIFE + slot), 0);
  }
  stationary();
  body(1, { x: 210, y: 30 });
  body(2, { x: 210, y: 30 });
  vm.poke(S.SHIELD + 1, 20);
  vm.poke(S.LIFE + 2, 20);
  call(S.STEP_GAME);
  assert.equal(vm.peek(S.DEAD + 1), 0, "respawn shields block enemy fire");
  stationary();
  body(2, { x: 128, y: 80 });
  vm.poke(S.LIFE + 2, 20);
  call(S.STEP_GAME);
  assert.equal(vm.peek(S.LIFE + 2), 0, "the sun consumes torpedoes");
  stationary();
  vm.poke(S.SCORE, 4);
  vm.poke(S.SCORE + 1, 4);
  vm.poke(S.HIT_MASK, 3);
  call(S.RESOLVE_HITS);
  call(S.DRAW_HUD);
  assert.equal(vm.peek(S.MODE), 3);
  assert.deepEqual([...memory(S.SCORE, 2)], [5, 5]);
  assert.match(session.textScreen()[20], /5-5 DRAW/);
  stationary();
  vm.poke(S.SCORE, 4);
  vm.poke(S.HIT_MASK, 2);
  call(S.RESOLVE_HITS);
  call(S.DRAW_HUD);
  assert.match(session.textScreen()[20], /PILOT 1 WINS/);
  assert.equal(vm.peek(S.MODE), 3);
  key(13);
  assert.equal(vm.peek(S.MODE), 1);
  assert.deepEqual([...memory(S.SCORE, 2)], [0, 0]);
  console.log("PASS sun/ship/torpedo collisions, seam hits, shields, respawning, simultaneous scoring, win/draw, and rematch");

  stationary();
  for (let pilot = 0; pilot < 2; pilot++) {
    vm.poke(S.BODY, pilot);
    for (let i = 0; i < 64; i++) {
      vm.poke(S.JUMP_CD + pilot, 0);
      call(S.HYPERSPACE);
      const x = vm.peek(S.X_HI + pilot), y = vm.peek(S.Y_HI + pilot);
      assert.ok(x === 24 || x === 232 || y === 16 || y === 144, "hyperspace stays on the safe perimeter");
      assert.ok(x >= 0 && x < 256 && y >= 0 && y < 160);
      assert.ok(Math.max(Math.abs(128 - x), Math.abs(80 - y)) >= 64);
      assert.equal(vm.peek(S.JUMP_CD + pilot), S.JUMP_TICKS);
      assert.deepEqual(velocity(pilot), [0, 0]);
      const before = [x, y, vm.peek(S.SEED_LO), vm.peek(S.SEED_HI)];
      call(S.HYPERSPACE);
      assert.deepEqual([vm.peek(S.X_HI + pilot), vm.peek(S.Y_HI + pilot),
        vm.peek(S.SEED_LO), vm.peek(S.SEED_HI)], before, "recharging cannot teleport or consume randomness");
    }
  }
  for (let tick = S.JUMP_TICKS - 1; tick >= 0; tick--) {
    body(0);
    body(1, { x: 232, y: 136 });
    call(S.STEP_GAME);
    assert.equal(vm.peek(S.JUMP_CD), tick, "recharge takes exactly 240 simulation ticks");
    assert.equal(vm.peek(S.JUMP_CD + 1), tick);
  }
  console.log("PASS safe randomized hyperspace placement, velocity reset, cooldown gating, and eight-second recharge");

  reset();
  key("W");
  key("I");
  key("D");
  key("L");
  key("F");
  key("U");
  assert.deepEqual([...memory(S.KEY_BURN, 2)], [1, 1]);
  assert.deepEqual([...memory(S.ENGINE_DRAW, 2)], [1, 1], "both keyboard engines stay on during other actions");
  assert.deepEqual([...memory(S.ANGLE, 2)], [1, 9]);
  assert.ok(memory(S.LIFE + 2, 4).some(value => value > 0));
  assert.ok(memory(S.LIFE + 6, 4).some(value => value > 0));
  key("S");
  assert.deepEqual([...memory(S.KEY_BURN, 2)], [0, 1], "coasting P1 leaves P2's throttle alone");
  key("K");
  assert.deepEqual([...memory(S.ENGINE_DRAW, 2)], [0, 0]);
  key("E");
  key("O");
  assert.ok(vm.peek(S.JUMP_CD) > 0 && vm.peek(S.JUMP_CD + 1) > 0);
  key("P");
  assert.equal(vm.peek(S.MODE), 2);
  const frozen = Buffer.concat([memory(S.X_LO, S.TURN_INPUT - S.X_LO), memory(S.TICK, 1), video()]);
  for (let i = 0; i < 40; i++) frame();
  assert.deepEqual(Buffer.concat([memory(S.X_LO, S.TURN_INPUT - S.X_LO), memory(S.TICK, 1), video()]), frozen,
    "pause freezes physics, shots, respawns, shields, keyboard bursts, cooldowns, and graphics");
  key("W");
  assert.equal(vm.peek(S.KEY_BURN), 0, "paused flight keys cannot arm a hidden throttle");
  key("P");
  assert.equal(vm.peek(S.MODE), 1);
  console.log("PASS independent split-keyboard flight, bursts, coast, hyperspace, and complete pause/resume");

  reset();
  const pad1 = SNES.UP | SNES.A | SNES.LEFT;
  const pad2 = SNES.B | SNES.Y | SNES.RIGHT;
  vm.setGamepadState(0, pad1);
  vm.setGamepadState(1, pad2);
  frame();
  for (let pilot = 0; pilot < 2; pilot++) {
    const mask = pilot ? pad2 : pad1;
    for (let bit = 0; bit < 16; bit++) {
      assert.equal(vm.peek(S.PAD1 + pilot * 16 + bit), (mask >> bit) & 1,
        "controls use the genuine VIA/NMI/ROM scan, not injected button-table bytes");
    }
  }
  assert.deepEqual([...memory(S.ENGINE_DRAW, 2)], [1, 1]);
  assert.deepEqual([...memory(S.ANGLE, 2)], [15, 9]);
  assert.ok(vm.peek(S.LIFE + 2) && vm.peek(S.LIFE + 6), "both controllers fire in the same frame");
  vm.setGamepadState(0, SNES.LEFT | SNES.RIGHT);
  vm.setGamepadState(1, SNES.LEFT | SNES.RIGHT);
  const angles = memory(S.ANGLE, 2);
  for (let i = 0; i < 8; i++) frame();
  assert.deepEqual(memory(S.ANGLE, 2), angles, "opposing pad directions cancel");
  vm.setGamepadState(0, 0);
  vm.setGamepadState(1, 0);
  frame();
  assert.deepEqual([...memory(S.ENGINE_DRAW, 2)], [0, 0], "disconnecting releases pad thrust");
  vm.setGamepadState(0, SNES.SELECT);
  vm.setGamepadState(1, SNES.SELECT);
  frame();
  assert.equal(vm.peek(S.JUMP_CD), S.JUMP_TICKS);
  assert.equal(vm.peek(S.JUMP_CD + 1), S.JUMP_TICKS);
  vm.setGamepadState(0, SNES.SELECT | SNES.START);
  vm.setGamepadState(1, SNES.SELECT | SNES.START);
  frame();
  assert.equal(vm.peek(S.MODE), 2, "simultaneous Start presses toggle only once");
  for (let i = 0; i < 8; i++) frame();
  assert.equal(vm.peek(S.MODE), 2, "held Start does not toggle repeatedly");
  vm.poke(S.JUMP_CD, 0);
  vm.poke(S.JUMP_CD + 1, 0);
  vm.setGamepadState(0, SNES.SELECT);
  vm.setGamepadState(1, SNES.SELECT);
  frame();
  vm.setGamepadState(0, SNES.SELECT | SNES.START);
  frame();
  assert.equal(vm.peek(S.MODE), 1);
  assert.equal(vm.peek(S.JUMP_CD), 0);
  assert.equal(vm.peek(S.JUMP_CD + 1), 0, "held Select does not retrigger when the cooldown is ready");
  vm.setGamepadState(0, 0);
  vm.setGamepadState(1, 0);
  frame();
  vm.setGamepadState(0, SNES.SELECT);
  vm.setGamepadState(1, SNES.SELECT);
  frame();
  assert.equal(vm.peek(S.JUMP_CD), S.JUMP_TICKS, "fresh Select works again");
  assert.equal(vm.peek(S.JUMP_CD + 1), S.JUMP_TICKS);
  console.log("PASS both real SNES serial paths, simultaneous flight/fire, release, opposing directions, and edge gating");

  reset();
  assert.ok(vm.enableAudio(48_000));
  vm.drainAudio();
  call(S.REQUEST_SOUND, { a: 1 });
  call(S.PLAY_SOUND);
  const pcm = vm.drainAudio();
  assert.ok(pcm.length > 20 && pcm.every(Number.isFinite));
  assert.ok(pcm.some(value => Math.abs(value) > 0.0001), "effects produce real system-speaker PCM");
  key("M");
  assert.equal(vm.peek(S.MUTED), 1);
  call(S.REQUEST_SOUND, { a: 3 });
  call(S.PLAY_SOUND);
  assert.equal(vm.peek(S.SOUND_EVENT), 0, "muting consumes, rather than queues, an effect");
  key("M");
  vm.disableAudio();
  console.log("PASS genuine $C030 speaker effects and mute control");

  let worstWork = 0, worstTotal = 0, peakShots = 0;
  for (let angle = 0; angle < 16; angle++) {
    stationary();
    vm.poke(S.ANGLE, angle);
    vm.poke(S.ANGLE + 1, (angle + 8) & 15);
    vm.poke(S.ENGINE_DRAW, 1);
    vm.poke(S.ENGINE_DRAW + 1, 1);
    for (let slot = 2; slot < 10; slot++) {
      body(slot, { x: 16 + (slot - 2) * 28, y: slot % 2 ? 138 : 20, vx: 0.5, vy: 0.25 });
      vm.poke(S.LIFE + slot, 60);
    }
    scene();
    vm.setGamepadState(0, SNES.UP | SNES.A);
    vm.setGamepadState(1, SNES.B | SNES.Y);
    const cost = frame();
    worstWork = Math.max(worstWork, cost.work);
    worstTotal = Math.max(worstTotal, cost.total);
    peakShots = Math.max(peakShots, memory(S.LIFE + 2, 8).filter(value => value > 0).length);
    assert.ok(cost.work < S.FRAME_PERIOD, `heading ${angle}: ${cost.work} cycles must fit the 30 Hz deadline`);
    assert.ok(Math.abs(cost.total - S.FRAME_PERIOD) < 200, `VIA pacing retains native 30 Hz (${cost.total} cycles)`);
  }
  assert.equal(peakShots, 8, "the cycle budget is measured with all eight projectiles, not an empty arena");
  for (const event of ["fire", "jump"]) {
    for (let first = 0; first < 16; first++) {
      for (let second = 0; second < 16; second++) {
        stationary();
        vm.poke(S.ANGLE, first);
        vm.poke(S.ANGLE + 1, second);
        vm.poke(S.ENGINE_DRAW, 1);
        vm.poke(S.ENGINE_DRAW + 1, 1);
        for (let slot = 2; slot < 10; slot++) {
          body(slot, { x: 16 + (slot - 2) * 28, y: slot % 2 ? 138 : 20, vx: 0.5, vy: 0.25 });
          vm.poke(S.LIFE + slot, event === "fire" && (slot === 5 || slot === 9) ? 0 : 60);
        }
        scene();
        const mask = 0x0fff & ~SNES.START & (event === "jump" ? 0x0fff : ~SNES.SELECT);
        vm.setGamepadState(0, mask);
        vm.setGamepadState(1, mask);
        const cost = frame();
        worstWork = Math.max(worstWork, cost.work);
        worstTotal = Math.max(worstTotal, cost.total);
        assert.ok(cost.work < S.FRAME_PERIOD,
          `${event} at headings ${first}/${second}: ${cost.work} cycles must fit, including sound and eight shots`);
        assert.ok(Math.abs(cost.total - S.FRAME_PERIOD) < 200, `${event} remains timer-paced (${cost.total} cycles)`);
      }
    }
  }
  reset();
  for (let i = 0; i < 900; i++) {
    vm.setGamepadState(0, SNES.B | SNES.A | (i % 48 < 24 ? SNES.LEFT : SNES.RIGHT));
    vm.setGamepadState(1, SNES.UP | SNES.Y | (i % 32 < 16 ? SNES.RIGHT : SNES.LEFT));
    if (vm.peek(S.MODE) === 3) {
      key(13);
      continue;
    }
    const cost = frame();
    worstWork = Math.max(worstWork, cost.work);
    worstTotal = Math.max(worstTotal, cost.total);
    assert.ok(cost.work < S.FRAME_PERIOD, `live combat frame ${i}: ${cost.work} cycles exceeds deadline`);
    for (let index = 0; index < 10; index++) {
      assert.ok(vm.peek(S.Y_HI + index) < 160, "all bodies stay in the arena");
      if (index < 2 && vm.peek(S.DEAD + index)) continue;
      if (index >= 2 && !vm.peek(S.LIFE + index)) continue;
      for (const component of velocity(index)) assert.ok(Math.abs(component) <= (index < 2 ? 2 : 4));
    }
  }
  protectedMemory();
  console.log(`PASS full-load native cadence and 900 combat frames (worst work ${worstWork}, period ${worstTotal} cycles)`);
} finally {
  app.vm.delete();
}

const held = await create({ pad1: SNES.START, pad2: SNES.START });
try {
  for (let i = 0; i < 8; i++) held.frame();
  assert.equal(held.vm.peek(S.MODE), 0, "Start held on entry cannot skip the title");
  held.vm.setGamepadState(0, 0);
  held.vm.setGamepadState(1, 0);
  held.frame();
  held.vm.setGamepadState(1, SNES.START);
  held.frame();
  assert.equal(held.vm.peek(S.MODE), 1, "either pilot's fresh Start can launch");
} finally {
  held.vm.delete();
}

const cadence = await create();
try {
  const pressed = 0x0fff & ~SNES.START;
  for (const [pad1, pad2] of [[0, 0], [pressed, 0], [0, pressed], [pressed, pressed], [0, 0]]) {
    cadence.vm.setGamepadState(0, pad1);
    cadence.vm.setGamepadState(1, pad2);
    for (let i = 0; i < 8; i++) {
      const cost = cadence.frame();
      assert.ok(Math.abs(cost.total - S.FRAME_PERIOD) < 200,
        `ROM scan compensation retains native 30 Hz for pads ${pad1}/${pad2} (${cost.total} cycles)`);
    }
  }
  assert.equal(cadence.vm.peek(S.MODE), 0, "cadence checks do not leave the title");
} finally {
  cadence.vm.delete();
}
console.log("PASS current-ROM frame cadence with idle, one-pad, two-pad, and released inputs");

for (const mode of [0, 1, 2, 3]) {
  for (const quit of ["Q", 27]) {
    const closing = await create({ borrowedIO: true });
    try {
      const { vm, session, original } = closing;
      vm.poke(S.MODE, mode);
      vm.keyDown(typeof quit === "string" ? quit.charCodeAt(0) : quit);
      closing.runTo(S.EXIT_GAME);
      closing.protectedMemory();
      closing.runTo(S.EXIT_MONITOR);
      assert.equal(vm.status() & 0xcf, original.flags & 0xcf, "entry processor flags are restored before BRK");
      vm.runCycles(400_000);
      assert.match(vm.drainOutput(), harness.MONITOR_DUMP, "Q/Esc reaches the real ROM monitor");
      assert.equal(vm.textMode(), 1);
      assert.equal(vm.gfxPage(), 0);
      assert.equal(vm.mixed(), 0);
      assert.equal(vm.readBus(S.VIA_ACR), original.acr);
      assert.equal(vm.readBus(S.VIA_IER), original.ier);
      assert.equal(vm.peek(S.JOY_MODE), original.joy);
      assert.ok(session.textScreen().some(row => row.includes("*")), "the monitor prompt is visible");
      closing.protectedMemory({ monitor: true });
      for (const char of "0800.0803\r") {
        vm.keyDown(char.charCodeAt(0));
        vm.runCycles(80_000);
      }
      const expected = `0800- ${Buffer.from(bytes.subarray(0, 4)).toString("hex").match(/../g).join(" ").toUpperCase()}`;
      assert.ok(session.textScreen().some(row => row.includes(expected)), "the monitor accepts a subsequent memory command");
    } finally {
      closing.vm.delete();
    }
  }
}
console.log("PASS startup Start-release gating and Q/Esc from every mode with restored I/O and a usable monitor");

const disk = await harness.boot();
try {
  const woz = buildBootableWoz(bytes, org, org);
  assert.ok(disk.vm.insertDisk(0, new Uint8Array(woz)));
  disk.vm.addBreakpoint(S.MAIN);
  disk.vm.setPC(0xc600);
  disk.vm.runCycles(30_000_000);
  assert.ok(disk.vm.breakpointHit(), "the ordinary exported WOZ boots through the real $C600 ROM");
  assert.equal(disk.vm.peek(S.MODE), 0);
  assert.equal(disk.vm.mixed(), 1);
  assert.match(disk.textScreen()[20], /SUNSLING/);
  assert.deepEqual(Buffer.from(Array.from({ length: bytes.length }, (_, i) => disk.vm.peek(org + i))), Buffer.from(bytes));
  console.log("PASS raw-image fidelity and bootable WOZ through the unmodified Disk II loader");
} finally {
  disk.vm.delete();
}
