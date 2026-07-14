// jungle.test.mjs — focused engine and gameplay checks for
// JUNGLE QUEST: THE SUNSTONE RUN.
//
// Run: node codegen/tools/jungle.test.mjs
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { boot } = harnessPkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "emulator", "AICodeGen", "jungle", "jungle.s");
const EMULATOR_PRG = join(
  HERE, "..", "..", "emulator", "AICodeGen", "jungle", "jungle.prg",
);
const WEB_PRG = join(HERE, "..", "..", "web", "programs", "jungle.prg");

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
console.log(
  `assembled jungle.s: ${bytes.length} bytes @ $${org.toString(16)} ` +
  `(ends $${(org + bytes.length).toString(16)})`,
);
ok(org + bytes.length < 0x2000, "program stays below hi-res page 1 at $2000");
const assembled = Buffer.from(bytes);
ok(assembled.equals(readFileSync(EMULATOR_PRG)), "emulator PRG exactly matches assembled source");
ok(assembled.equals(readFileSync(WEB_PRG)), "web PRG exactly matches assembled source");

const s = await boot();
const vm = s.vm;
s.load(bytes, org);

function runHook(entry, label) {
  const r = s.run({ org: entry, maxCycles: 8_000_000, chunk: 200_000 });
  if (r.halt !== "brk-monitor") {
    throw new Error(
      `${label}: expected BRK halt, got ${r.halt} after ${r.cycles} cycles`,
    );
  }
  return r;
}

const pokeWord = (a, v) => {
  vm.poke(a, v & 0xff);
  vm.poke(a + 1, (v >> 8) & 0xff);
};
const peekWord = (a) => vm.peek(a) | (vm.peek(a + 1) << 8);
const key = (v) => vm.poke(0xc000, v);
const getpix = (x, y) =>
  (vm.peek(haddr(y) + Math.floor(x / 7)) >> (x % 7)) & 1;

function flatTerrain() {
  vm.poke(S.GAP1_L, 0);
  vm.poke(S.GAP1_R, 0);
  vm.poke(S.GAP2_L, 0);
  vm.poke(S.GAP2_R, 0);
  vm.poke(S.PLAT1_L, 0);
  vm.poke(S.PLAT1_R, 0);
  vm.poke(S.PLAT1_Y, S.GROUND_TOP);
  vm.poke(S.PLAT2_L, 0);
  vm.poke(S.PLAT2_R, 0);
  vm.poke(S.PLAT2_Y, S.GROUND_TOP);
  vm.poke(S.VINE_ON, 0);
  vm.poke(S.ONVINE, 0);
  vm.poke(S.HZ_TYPE, S.HZ_NONE_KIND);
}

function resetPlayer(x, y = S.STAND_Y) {
  flatTerrain();
  pokeWord(S.PX_LO, x);
  vm.poke(S.PY, y);
  vm.poke(S.PREVPY, y);
  vm.poke(S.YFRAC, 0);
  vm.poke(S.VY_LO, 0);
  vm.poke(S.VY_HI, 0);
  vm.poke(S.FACING, 0);
  vm.poke(S.ONGROUND, 1);
  vm.poke(S.MOVETMR, 0);
  vm.poke(S.MOVEDIR, 0);
  vm.poke(S.JUMPREQ, 0);
  vm.poke(S.JUMPBUF, 0);
  vm.poke(S.COYOTE, S.COYOTE_MAX);
  vm.poke(S.DUCKTMR, 0);
  vm.poke(S.INVULN, 0);
  vm.poke(S.LIVES, 3);
  vm.poke(S.TSEC, S.TSEC0);
  vm.poke(S.GAMESTATE, 0);
  vm.poke(S.CURSCR, 0);
  vm.poke(S.FLIPREQ, 0);
  vm.poke(S.GLYPHS, 0);
  vm.poke(S.SPAWN_LO, 16);
  vm.poke(S.SPAWN_HI, 0);
  vm.poke(S.STATUS_CODE, 0);
  vm.poke(S.STATUS_TMR, 0);
  key(0);
}

function clearItems() {
  for (let i = 0; i < S.NITEM; i++) vm.poke(S.ITEM_ON + i, 0);
}

console.log("A) hi-res row table and sprite blitter");
runHook(S.BUILD_BRK, "build rows");
{
  let rowsMatch = true;
  for (let y = 0; y < 192; y++) {
    const got = vm.peek(S.ROWL + y) | (vm.peek(S.ROWH + y) << 8);
    if (got !== haddr(y)) rowsMatch = false;
  }
  ok(rowsMatch, "all 192 row pointers match Apple-II hi-res interleave");

  runHook(S.CLEAR_BRK, "clear screen");
  resetPlayer(131);
  runHook(S.SPRITE_BRK, "draw standing hero");
  const heroWords = [
    0x1e00, 0x3f00, 0x1e00, 0x1200, 0x1e00, 0x3f00, 0x6d80, 0x6d80,
    0x1e00, 0x1e00, 0x1200, 0x1200, 0x1200, 0x3300, 0x0000, 0x0000,
  ];
  let spriteOk = true;
  for (let row = 0; row < heroWords.length; row++) {
    for (let col = 0; col < 12; col++) {
      const expected = (heroWords[row] >> (15 - col)) & 1;
      if (getpix(131 + col, S.STAND_Y + row) !== expected) spriteOk = false;
    }
  }
  ok(spriteOk, "standing pose blits exactly across a 7-pixel byte boundary");
}

console.log("B) authored screen descriptors and terrain rendering");
{
  vm.poke(S.CURSCR, 1);
  runHook(S.SCREENVARS_BRK, "load broken-steps descriptor");
  ok(
    vm.peek(S.GAP1_L) === 8 && vm.peek(S.GAP1_R) === 14 &&
      vm.peek(S.GAP2_L) === 25 && vm.peek(S.GAP2_R) === 31,
    "screen 2 loads two independent ground gaps",
  );
  ok(
    vm.peek(S.PLAT1_L) === 9 && vm.peek(S.PLAT1_Y) === 116 &&
      vm.peek(S.PLAT2_L) === 26 && vm.peek(S.PLAT2_Y) === 108,
    "screen 2 loads two raised stepping platforms",
  );
  ok(vm.peek(S.HZ_TYPE) === S.HZ_SNAKE_KIND, "screen 2 selects its snake threat");
  runHook(S.SCENE_BRK, "draw broken steps");
  ok(vm.peek(haddr(8)) === 0x15, "canopy texture is visible");
  ok(vm.peek(haddr(136) + 10) === 0x00, "gap removes the ground lip");
  ok(vm.peek(haddr(152) + 10) === 0x11, "gap contains readable water shimmer");
  ok(vm.peek(haddr(116) + 9) === 0x7f, "raised platform has a solid bright top");
}

console.log("C) responsive movement, jump arc, coyote time, and buffering");
{
  resetPlayer(100);
  key(0xc4);
  runHook(S.STEP_BRK, "run right");
  const afterTap = peekWord(S.PX_LO);
  key(0);
  runHook(S.STEP_BRK, "run impulse");
  const afterCoast = peekWord(S.PX_LO);
  ok(afterTap === 103 && afterCoast === 106, "one D event starts a sustained 3px run");

  key(0xd3);
  runHook(S.STEP_BRK, "duck brake");
  ok(
    vm.peek(S.DUCKTMR) > 0 && vm.peek(S.MOVETMR) === 0 &&
      peekWord(S.PX_LO) === afterCoast,
    "S ducks and brakes without sliding another frame",
  );

  resetPlayer(100);
  key(0xa0);
  runHook(S.STEP_BRK, "jump");
  const takeoffY = vm.peek(S.PY);
  key(0);
  let apex = takeoffY;
  let landed = false;
  for (let frame = 0; frame < 80; frame++) {
    runHook(S.STEP_BRK, `jump frame ${frame}`);
    apex = Math.min(apex, vm.peek(S.PY));
    if (vm.peek(S.ONGROUND) === 1) {
      landed = true;
      break;
    }
  }
  ok(takeoffY < S.STAND_Y && apex <= 90, `jump has a useful arc (apex y=${apex})`);
  ok(landed && vm.peek(S.PY) === S.STAND_Y, "jump lands cleanly at ground height");

  resetPlayer(100);
  vm.poke(S.ONGROUND, 0);
  vm.poke(S.COYOTE, 2);
  key(0xa0);
  runHook(S.STEP_BRK, "coyote jump");
  ok(vm.peek(S.VY_HI) & 0x80, "jump still fires during the post-ledge coyote window");

  resetPlayer(100, 121);
  vm.poke(S.ONGROUND, 0);
  vm.poke(S.COYOTE, 0);
  vm.poke(S.VY_HI, 1);
  vm.poke(S.JUMPBUF, S.JUMPBUF_MAX);
  runHook(S.STEP_BRK, "buffer landing");
  const bufferedLanded = vm.peek(S.ONGROUND) === 1;
  runHook(S.STEP_BRK, "consume buffered jump");
  ok(
    bufferedLanded && vm.peek(S.ONGROUND) === 0 && vm.peek(S.PY) < S.STAND_Y,
    "a pre-landing jump request fires on the next grounded frame",
  );
}

console.log("D) one-way platforms, gaps, and checkpoint deaths");
{
  resetPlayer(70, 98);
  vm.poke(S.PLAT1_L, 10);
  vm.poke(S.PLAT1_R, 18);
  vm.poke(S.PLAT1_Y, 116);
  vm.poke(S.ONGROUND, 0);
  vm.poke(S.COYOTE, 0);
  vm.poke(S.VY_HI, 1);
  let platformLanded = false;
  for (let frame = 0; frame < 12; frame++) {
    runHook(S.STEP_BRK, `platform fall ${frame}`);
    if (vm.peek(S.ONGROUND) === 1) {
      platformLanded = true;
      break;
    }
  }
  ok(
    platformLanded && vm.peek(S.PY) === 116 - S.PLAYER_FEET,
    "descending player lands on a raised platform top",
  );
  pokeWord(S.PX_LO, 126);
  runHook(S.STEP_BRK, "walk beyond platform");
  ok(vm.peek(S.ONGROUND) === 0, "leaving a platform starts a fall instead of air-walking");

  resetPlayer(150, 160);
  vm.poke(S.GAP1_L, 20);
  vm.poke(S.GAP1_R, 30);
  vm.poke(S.ONGROUND, 0);
  vm.poke(S.COYOTE, 0);
  vm.poke(S.VY_HI, 3);
  vm.poke(S.SPAWN_LO, 42);
  vm.poke(S.TSEC, 50);
  for (let frame = 0; frame < 10 && vm.peek(S.LIVES) === 3; frame++) {
    runHook(S.STEP_BRK, `pit fall ${frame}`);
  }
  ok(
    vm.peek(S.LIVES) === 2 && peekWord(S.PX_LO) === 42,
    "pit death consumes one life and returns to this screen's checkpoint",
  );
  ok(
    vm.peek(S.TSEC) === 45 && vm.peek(S.INVULN) === S.RESPAWN_GRACE,
    "death charges five clock units and grants respawn grace",
  );

  resetPlayer(100, 169);
  vm.poke(S.DUCKTMR, 5);
  vm.poke(S.OCOL, 14);
  vm.poke(S.OPY, 169);
  runHook(S.RENDER_BRK, "render duck at pit depth");
  ok(
    vm.peek(S.OPY) === 169,
    "duck pose keeps its erase origin inside the 192-row address table",
  );
}

console.log("E) distinct moving threats and duck-vs-bat collision");
{
  vm.poke(S.HZ_TYPE, S.HZ_BOULDER_KIND);
  vm.poke(S.HZ_X_LO, 72);
  vm.poke(S.HZ_X_HI, 0);
  vm.poke(S.HZ_MIN, 70);
  vm.poke(S.HZ_MAX, 80);
  vm.poke(S.HZ_SPD, 3);
  vm.poke(S.HZ_DIR, 1);
  runHook(S.HAZARD_BRK, "boulder left bound");
  const clamped = vm.peek(S.HZ_X_LO) === 70 && vm.peek(S.HZ_DIR) === 0;
  runHook(S.HAZARD_BRK, "boulder rebound");
  ok(clamped && vm.peek(S.HZ_X_LO) === 73, "threat clamps and reverses at patrol bounds");

  resetPlayer(100);
  vm.poke(S.HZ_TYPE, S.HZ_BAT_KIND);
  pokeWord(S.HZ_X_LO, 100);
  vm.poke(S.HZ_Y, 116);
  vm.poke(S.HZ_W, 16);
  vm.poke(S.HZ_H, 8);
  runHook(S.COLL_BRK, "standing into bat");
  ok(vm.peek(S.LIVES) === 2, "shoulder-height bat hits a standing runner");

  resetPlayer(100);
  vm.poke(S.HZ_TYPE, S.HZ_BAT_KIND);
  pokeWord(S.HZ_X_LO, 100);
  vm.poke(S.HZ_Y, 116);
  vm.poke(S.HZ_W, 16);
  vm.poke(S.HZ_H, 8);
  vm.poke(S.DUCKTMR, 5);
  runHook(S.COLL_BRK, "duck under bat");
  ok(vm.peek(S.LIVES) === 3, "ducking hitbox passes safely under the bat");

  vm.poke(S.HZ_TYPE, S.HZ_SNAKE_KIND);
  vm.poke(S.HZ_Y, 128);
  vm.poke(S.HZ_H, 8);
  runHook(S.COLL_BRK, "duck into snake");
  ok(vm.peek(S.LIVES) === 2, "ducking does not bypass a ground threat");
}

console.log("F) fruit, glyph, and Sunstone rewards");
{
  resetPlayer(60);
  clearItems();
  vm.poke(S.ITEM_X, 60);
  vm.poke(S.ITEM_Y, 126);
  vm.poke(S.ITEM_ON, 1);
  vm.poke(S.ITEM_SCR, 0);
  vm.poke(S.ITEM_KIND, S.ITEM_FRUIT_KIND);
  vm.poke(S.ITEMLEFT, 1);
  vm.poke(S.SCORE0, 0);
  vm.poke(S.SCORE1, 0);
  vm.poke(S.SCORE2, 0);
  vm.poke(S.TSEC, 80);
  runHook(S.COLLECT_BRK, "collect fruit");
  ok(
    vm.peek(S.ITEM_ON) === 0 && vm.peek(S.SCORE1) === 0x05 &&
      vm.peek(S.TSEC) === 85,
    "fruit awards 500 points and restores five clock units",
  );

  resetPlayer(60);
  clearItems();
  vm.poke(S.ITEM_X, 60);
  vm.poke(S.ITEM_Y, 126);
  vm.poke(S.ITEM_ON, 1);
  vm.poke(S.ITEM_SCR, 0);
  vm.poke(S.ITEM_KIND, S.ITEM_GLYPH_KIND);
  vm.poke(S.ITEMLEFT, 1);
  vm.poke(S.SCORE1, 0);
  runHook(S.COLLECT_BRK, "collect glyph");
  ok(
    vm.peek(S.GLYPHS) === 1 && vm.peek(S.SCORE1) === 0x20,
    "glyph advances temple progress and awards 2000 points",
  );

  resetPlayer(60);
  clearItems();
  vm.poke(S.ITEM_X, 60);
  vm.poke(S.ITEM_Y, 126);
  vm.poke(S.ITEM_ON, 1);
  vm.poke(S.ITEM_SCR, 0);
  vm.poke(S.ITEM_KIND, S.ITEM_SUN_KIND);
  vm.poke(S.ITEMLEFT, 1);
  runHook(S.COLLECT_BRK, "collect Sunstone");
  ok(vm.peek(S.GAMESTATE) === 1, "the Sunstone, not generic item exhaustion, wins the run");
}

console.log("G) temple gate and screen progression");
{
  resetPlayer(266);
  vm.poke(S.CURSCR, S.TEMPLE_SCREEN);
  vm.poke(S.GLYPHS, 3);
  key(0xc4);
  runHook(S.STEP_BRK, "closed temple gate");
  ok(
    vm.peek(S.CURSCR) === S.TEMPLE_SCREEN && peekWord(S.PX_LO) === S.XMAX &&
      vm.peek(S.STATUS_CODE) === 3,
    "temple edge blocks entry and explains the missing-glyph requirement",
  );

  resetPlayer(266);
  vm.poke(S.CURSCR, S.TEMPLE_SCREEN);
  vm.poke(S.GLYPHS, S.GLYPH_GOAL);
  key(0xc4);
  runHook(S.STEP_BRK, "open temple gate");
  ok(
    vm.peek(S.CURSCR) === S.FINAL_SCREEN && peekWord(S.PX_LO) === S.ENTER_L,
    "all four glyphs unlock the final Sun Temple screen",
  );
}

console.log("H) active vine release");
{
  resetPlayer(95, 100);
  vm.poke(S.CURSCR, 2);
  runHook(S.SCREENVARS_BRK, "load Blackwater descriptor");
  vm.poke(S.ONGROUND, 0);
  vm.poke(S.COYOTE, 0);
  vm.poke(S.VY_LO, 0);
  vm.poke(S.VY_HI, 0);
  let grabbed = false;
  for (let frame = 0; frame < 12; frame++) {
    key(0);
    runHook(S.STEP_BRK, `vine approach ${frame}`);
    if (vm.peek(S.ONVINE) === 1) {
      grabbed = true;
      break;
    }
  }
  key(0xa0);
  runHook(S.STEP_BRK, "release vine");
  ok(grabbed, "airborne runner automatically catches a nearby vine");
  ok(
    vm.peek(S.ONVINE) === 0 && (vm.peek(S.VY_HI) & 0x80) &&
      vm.peek(S.MOVEDIR) === 0 && vm.peek(S.MOVETMR) === 10,
    "Jump releases the vine with an upward/rightward bonus arc",
  );

  resetPlayer(106, 169);
  vm.poke(S.CURSCR, 2);
  runHook(S.SCREENVARS_BRK, "reload Blackwater descriptor");
  vm.poke(S.ONGROUND, 0);
  vm.poke(S.COYOTE, 0);
  vm.poke(S.VY_LO, 0);
  vm.poke(S.VY_HI, 3);
  runHook(S.STEP_BRK, "fall below visible vine");
  ok(
    vm.peek(S.ONVINE) === 0 && vm.peek(S.LIVES) === 2,
    "player below the visible rope cannot teleport out of a fatal fall",
  );
}

console.log("I) timer and emulator-safe gamepad guard");
{
  vm.poke(S.TSEC, 1);
  vm.poke(S.TFRAME, S.TICK - 1);
  vm.poke(S.GAMESTATE, 0);
  runHook(S.TIMER_BRK, "last timer tick");
  ok(
    vm.peek(S.TSEC) === 0 && vm.peek(S.GAMESTATE) === 3,
    "countdown reaching zero enters the time-up state",
  );
  vm.poke(S.TSEC, 1);
  vm.poke(S.TFRAME, S.TICK - 1);
  vm.poke(S.GAMESTATE, 1);
  runHook(S.TIMER_BRK, "victory on final timer tick");
  ok(
    vm.peek(S.TSEC) === 1 && vm.peek(S.GAMESTATE) === 1,
    "timer cannot overwrite a victory resolved earlier in the frame",
  );

  vm.poke(S.MOVETMR, 0);
  vm.poke(S.JUMPBUF, 0);
  for (let i = 0; i < 16; i++) vm.poke(S.GAMEPAD1 + i, 1);
  runHook(S.PAD_BRK, "invalid emulated pad");
  ok(
    vm.peek(S.MOVETMR) === 0 && vm.peek(S.JUMPBUF) === 0,
    "impossible opposing pad inputs are ignored in the emulator",
  );
}

console.log("J) complete expedition is traversable with the documented verbs");
{
  runHook(S.INIT_BRK, "initialize expedition");
  let lastScreen = vm.peek(S.CURSCR);
  let lastLives = vm.peek(S.LIVES);
  let frames = 0;
  for (; frames < 1600 && vm.peek(S.GAMESTATE) === 0; frames++) {
    const x = peekWord(S.PX_LO);
    const y = vm.peek(S.PY);
    const center = x + 6;
    const onGround = vm.peek(S.ONGROUND) === 1;
    const onVine = vm.peek(S.ONVINE) === 1;
    const moveFrames = vm.peek(S.MOVETMR);
    const hazardType = vm.peek(S.HZ_TYPE);
    const hazardCenter = peekWord(S.HZ_X_LO) + vm.peek(S.HZ_W) / 2;
    const gap1 = [vm.peek(S.GAP1_L) * 7, vm.peek(S.GAP1_R) * 7];
    const gap2 = [vm.peek(S.GAP2_L) * 7, vm.peek(S.GAP2_R) * 7];
    const gaps = [gap1, gap2].filter(([left, right]) => left !== right);

    let action = 0;
    if (!onVine && onGround) {
      const nearGap = gaps.some(([left]) => center < left && left - center <= 42);
      const leavingStep = y < S.STAND_Y && gaps.some(
        ([left, right]) => center >= left && center < right && right - center <= 24,
      );
      const nearGroundThreat =
        hazardType !== S.HZ_NONE_KIND && hazardType !== S.HZ_BAT_KIND &&
        Math.abs(hazardCenter - center) <= 55;
      if (nearGap || leavingStep || nearGroundThreat) action = 0xa0;
    }
    if (
      !action && !onVine && onGround && hazardType === S.HZ_BAT_KIND &&
      Math.abs(hazardCenter - center) <= 34
    ) {
      action = 0xd3;
    }
    if (!action && !onVine && moveFrames <= 4) action = 0xc4;

    key(action);
    runHook(S.GAMEFRAME_BRK, `expedition frame ${frames}`);
    if (vm.peek(S.LIVES) !== lastLives) {
      console.log(
        `    life ${lastLives}->${vm.peek(S.LIVES)} on screen ${vm.peek(S.CURSCR) + 1} ` +
        `after x=${x}, y=${y}, onGround=${onGround}, hazard=${hazardCenter} ` +
        `action=$${action.toString(16)}`,
      );
      lastLives = vm.peek(S.LIVES);
    }
    const screen = vm.peek(S.CURSCR);
    if (screen !== lastScreen) {
      console.log(
        `    reached screen ${screen + 1} with ${vm.peek(S.GLYPHS)} glyphs, ` +
        `${vm.peek(S.LIVES)} lives, clock ${vm.peek(S.TSEC)}`,
      );
      lastScreen = screen;
    }
  }
  ok(
    vm.peek(S.GAMESTATE) === 1 && vm.peek(S.GLYPHS) === S.GLYPH_GOAL,
    `run reaches the Sunstone in ${frames} frames ` +
    `(state=${vm.peek(S.GAMESTATE)}, screen=${vm.peek(S.CURSCR) + 1}, ` +
    `x=${peekWord(S.PX_LO)}, y=${vm.peek(S.PY)}, glyphs=${vm.peek(S.GLYPHS)})`,
  );
  ok(
    vm.peek(S.LIVES) > 0 && vm.peek(S.TSEC) > 0,
    `authored route is survivable (lives=${vm.peek(S.LIVES)}, time=${vm.peek(S.TSEC)})`,
  );
}

process.exit(failures === 0 ? 0 : 1);
