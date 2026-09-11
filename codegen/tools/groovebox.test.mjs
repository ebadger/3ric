// Real 65C02 sequencer, SNES/ROM input, VIA timing, and stereo AY output.
// Run: node codegen/tools/groovebox.test.mjs (after web/build.ps1).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";
import harness from "./harness.cjs";
import gamepads from "../../web/gamepad.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(ROOT, "codegen", "programs", "groovebox.s"), "utf8");
const { org, bytes, symbols: S } = assemble(source);
const { SNES } = gamepads;
const PHI2 = 25_175_000 / 16;
const SAMPLE_RATE = 48_000;
const TIMER_PERIOD = S.TIMER_LATCH + 1;
const word = (vm, addr) => vm.peek(addr) | (vm.peek(addr + 1) << 8);
const pokeWord = (vm, addr, value) => {
  vm.poke(addr, value & 255);
  vm.poke(addr + 1, value >> 8);
};
const imageByte = (addr) => bytes[addr - org];

assert.equal(org, 0x0800);
assert.equal(S.PROGRAM_END, org + bytes.length);
assert.ok(S.PROGRAM_END < S.STATE, "program does not overlap its $6000 workspace");
assert.ok(S.STATE + 512 <= 0x9000, "workspace stays in physical RAM");
for (let note = 0; note < 48; note++) {
  const expected = Math.round(PHI2 / (16 * 440 * 2 ** ((36 + note - 69) / 12)));
  const actual = imageByte(S.PERIOD_LOW + note) | (imageByte(S.PERIOD_HIGH + note) << 8);
  assert.equal(actual, expected, `C2..B5 period ${note} matches 3RIC PHI2`);
}
let textAddress = S.SCREEN_TEXT;
for (let row = 0; row < 24; row++) {
  let length = 0;
  while (imageByte(textAddress++) !== 0) {
    assert.ok(++length <= 40, `text template row ${row} fits 40 columns`);
  }
}
assert.equal(textAddress, S.PROGRAM_END, "exactly 24 terminated template rows");
const gallery = JSON.parse(readFileSync(join(ROOT, "web", "gallery.json"), "utf8"));
const entry = gallery.entries.find((item) => item.src === "programs/groovebox.s");
assert.equal(entry?.title, "3RIC Groovebox");
assert.match(readFileSync(join(ROOT, "web", "index.html"), "utf8"),
  /<option value="groovebox">3RIC GROOVEBOX<\/option>/);
console.log(`PASS assembly, clock tables, screen bounds, and portal entry (${bytes.length} bytes)`);

function screen(vm) {
  return harness.TEXT_SCANLINES.map((offset) => {
    let row = "";
    for (let col = 0; col < 40; col++) {
      let value = vm.peek(0x400 + offset + col) & 0x7f;
      if (value < 0x20) value += 0x40; // inverse Apple II letters
      row += String.fromCharCode(value);
    }
    return row;
  });
}

async function start(pad = 0) {
  const session = await harness.boot();
  const vm = session.vm;
  const vectors = [0x03fb, 0x03fc, 0x03fd, 0x03fe, 0x03ff,
    0xfffa, 0xfffb, 0xfffc, 0xfffd, 0xfffe, 0xffff].map((addr) => [addr, vm.peek(addr)]);
  const joymode = vm.peek(0xce15);
  vm.setGamepadState(0, pad);
  assert.ok(vm.enableAudio(SAMPLE_RATE));
  session.load(bytes, org);
  vm.addBreakpoint(S.MAIN_WAIT);
  vm.setPC(org);
  vm.runCycles(2_000_000);
  assert.ok(vm.breakpointHit(), "startup reaches the timer wait");
  assert.equal(vm.pc(), S.MAIN_WAIT);
  assert.equal(vm.peek(S.BPM), 120);
  assert.equal(vm.peek(S.PLAYING), 1);
  assert.equal(vm.peek(S.TICK_COUNTER), 0);

  // Always finish an entire guest tick, including input and rendering.
  function ticks(count) {
    let cycles = 0;
    for (let tick = 0; tick < count; tick++) {
      const before = vm.peek(S.TICK_COUNTER);
      let wakeups = 0;
      do {
        assert.ok(++wakeups < 32, "timer continues to wake WAI");
        assert.equal(vm.pc(), S.MAIN_WAIT);
        cycles += vm.step();
        cycles += vm.runCycles(TIMER_PERIOD * 4);
        assert.ok(vm.breakpointHit(), "guest returns to wait within four timer periods");
      } while (vm.peek(S.TICK_COUNTER) === before);
      assert.equal(vm.peek(S.TICK_COUNTER), (before + 1) & 255, "one tick per timer wake");
    }
    return cycles;
  }

  function key(value) {
    assert.equal(vm.readBus(0xc000) & 0x80, 0, "previous key consumed");
    vm.keyDown(typeof value === "string" ? value.charCodeAt(0) : value);
    ticks(8);
    assert.equal(vm.readBus(0xc000) & 0x80, 0, "guest consumes keyboard input");
  }

  function padPress(mask) {
    vm.setGamepadState(0, 0);
    ticks(4);
    vm.setGamepadState(0, mask);
    ticks(4);
  }

  function close() {
    vm.disableAudio();
    vm.delete();
  }
  return { vm, session, ticks, key, padPress, vectors, joymode, close };
}

function energy(samples, channel) {
  let sum = 0;
  for (let i = channel; i < samples.length; i += 2) sum += Math.abs(samples[i]);
  return sum;
}

function peak(samples, channel) {
  let maximum = 0;
  for (let i = channel; i < samples.length; i += 2) {
    maximum = Math.max(maximum, Math.abs(samples[i]));
  }
  return maximum;
}

// The AY DC-blocker's floating-point accumulator leaves a tiny residual.
const silent = (samples, channel) => peak(samples, channel) < 0.0001;

function risingFrequency(samples, channel) {
  let edges = 0;
  for (let i = channel + 2; i < samples.length; i += 2) {
    if (samples[i - 2] <= 0 && samples[i] > 0) edges++;
  }
  return edges * SAMPLE_RATE / (samples.length / 2);
}

{
  const app = await start();
  try {
    const { vm, ticks } = app;
    const rows = screen(vm);
    assert.match(rows[0], /3RIC GROOVEBOX/);
    assert.match(rows[2], /PLAYING\s+BPM 120/);
    assert.match(rows[13], /VOICE: BASS\s+STEP: 01\s+NOTE: C-2/);
    assert.match(rows[14], /SOUND: PLUCK\s+STEP: ON\s+TRACK: LIVE/);
    assert.equal(vm.peek(0x700 + 7), "X".charCodeAt(0) & 0x3f, "selected cell is inverse");
    assert.equal(vm.peek(S.PLAYHEAD_LINE + 7), 0xbe, "first step playhead is visible");
    for (let index = 0; index < 96; index++) {
      const initial = imageByte(S.DEMO_STEPS + index);
      assert.equal(vm.peek(S.STEP_ON + index), initial ? 1 : 0);
      assert.ok(vm.peek(S.STEP_NOTES + index) >= 1 && vm.peek(S.STEP_NOTES + index) <= 24);
    }
    assert.equal(vm.readBus(0xc40b), 0x40, "left VIA Timer 1 free-runs");
    assert.equal(vm.readBus(0xc40e) & 0x7f, 0x40, "only Timer 1 IRQ is enabled");
    assert.equal(vm.readBus(0xc48e) & 0x7f, 0, "right VIA cannot cause a stray IRQ");
    assert.ok(vm.status() & 4, "WAI uses masked IRQ, not a replacement ROM vector");

    vm.drainAudio();
    const cycles = ticks(960);
    assert.ok(Math.abs(cycles - 960 * TIMER_PERIOD) < TIMER_PERIOD,
      "four seconds of real synthesis/rendering lose no timer ticks");
    assert.equal(vm.peek(S.PLAY_STEP), 0, "two complete bars wrap to step 1");
    assert.equal(word(vm, S.PHASE_LOW), 0);
    const audio = vm.drainAudio();
    assert.ok(audio.every(Number.isFinite), "all PCM samples are finite");
    assert.ok(energy(audio, 0) > 100 && energy(audio, 1) > 100,
      "original demo produces genuine AY audio in both channels");
    assert.ok(audio.some((sample, index) => index % 2 === 0 &&
      Math.abs(sample - audio[index + 1]) > 0.01), "stereo is not duplicated mono");
    for (const [addr, value] of app.vectors) assert.equal(vm.peek(addr), value);
    console.log("PASS demo UI, real stereo sound, timer cadence, looping, and untouched ROM vectors");
  } finally {
    app.close();
  }
}

{
  const app = await start();
  try {
    const { vm, key, ticks } = app;
    key(13);
    assert.equal(vm.peek(S.PLAYING), 0);
    assert.equal(vm.peek(S.PLAY_STEP), 0);
    assert.ok(Array.from({ length: 6 }, (_, i) => vm.peek(S.VOLUMES + i)).every((v) => v === 0));
    assert.match(screen(vm)[2], /STOPPED/);
    vm.drainAudio();
    ticks(60);
    const audio = vm.drainAudio();
    assert.ok(silent(audio, 0) && silent(audio, 1), "stop is silent");

    const note = vm.peek(S.STEP_NOTES);
    key(" ");
    assert.equal(vm.peek(S.STEP_ON), 0);
    assert.equal(vm.peek(S.STEP_NOTES), note, "disabling preserves pitch");
    key(" ");
    assert.equal(vm.peek(S.STEP_ON), 1);
    assert.equal(vm.peek(S.STEP_NOTES), note);
    assert.ok(energy(vm.drainAudio(), 0) > 0, "stopped step edit auditions a real tone");

    vm.poke(S.STEP_NOTES, 24);
    key("+");
    assert.equal(vm.peek(S.STEP_NOTES), 24, "upper pitch limit");
    key("-");
    assert.equal(vm.peek(S.STEP_NOTES), 23);
    vm.poke(S.STEP_NOTES, 1);
    key("-");
    assert.equal(vm.peek(S.STEP_NOTES), 1, "lower pitch limit");
    key(" ");
    key("=");
    assert.equal(vm.peek(S.STEP_ON), 1, "editing a rest enables it");
    assert.equal(vm.peek(S.STEP_NOTES), 2);
    assert.match(screen(vm)[13], /NOTE: C#2/);

    key("I");
    assert.equal(vm.peek(S.PRESETS), 1);
    assert.match(screen(vm)[14], /SOUND: SOFT/);
    key("I");
    assert.equal(vm.peek(S.PRESETS), 2);
    key("I");
    assert.equal(vm.peek(S.PRESETS), 0);
    key("M");
    assert.equal(vm.peek(S.MUTED), 1);
    assert.equal(vm.peek(S.VOLUMES), 0);
    assert.equal(vm.peek(0x700 + 5), 0xcd, "mute marker shown");
    assert.match(screen(vm)[14], /TRACK: MUTE/);
    vm.drainAudio();
    key("+");
    assert.ok(silent(vm.drainAudio(), 0), "muted edits do not audition");
    key("M");
    assert.equal(vm.peek(S.MUTED), 0);

    key("A");
    assert.equal(vm.peek(S.CURSOR_STEP), 15);
    key("D");
    assert.equal(vm.peek(S.CURSOR_STEP), 0);
    key("W");
    assert.equal(vm.peek(S.CURSOR_TRACK), 5);
    assert.match(screen(vm)[13], /VOICE: HATS\s+STEP: 01\s+NOTE: N04/);
    key(0x0a);
    assert.equal(vm.peek(S.CURSOR_TRACK), 0);
    key(0x15);
    assert.equal(vm.peek(S.CURSOR_STEP), 1);
    key(0x08);
    assert.equal(vm.peek(S.CURSOR_STEP), 0);
    key(0x0b);
    assert.equal(vm.peek(S.CURSOR_TRACK), 5);
    key("S");
    assert.equal(vm.peek(S.CURSOR_TRACK), 0);
    console.log("PASS keyboard editing, note limits, audition, envelopes, mute, and cursor wrapping");
  } finally {
    app.close();
  }
}

{
  const app = await start(SNES.A | SNES.START);
  try {
    const { vm, ticks, padPress } = app;
    ticks(120);
    assert.equal(vm.peek(S.PLAYING), 1, "startup-held Start is ignored");
    assert.equal(vm.peek(S.STEP_ON), 1, "startup-held A is ignored");
    padPress(SNES.START);
    assert.equal(vm.peek(S.PLAYING), 0);
    ticks(120);
    assert.equal(vm.peek(S.PLAYING), 0, "held Start does not retrigger");
    padPress(SNES.A);
    assert.equal(vm.peek(S.STEP_ON), 0);
    ticks(120);
    assert.equal(vm.peek(S.STEP_ON), 0, "held A does not retrigger");
    padPress(SNES.B);
    assert.equal(vm.peek(S.STEP_NOTES), 2);
    assert.equal(vm.peek(S.STEP_ON), 1);
    padPress(SNES.Y);
    assert.equal(vm.peek(S.STEP_NOTES), 1);
    padPress(SNES.X);
    assert.equal(vm.peek(S.MUTED), 1);
    padPress(SNES.SELECT);
    assert.equal(vm.peek(S.PRESETS), 1);
    padPress(SNES.L);
    assert.equal(vm.peek(S.BPM), 115);
    ticks(120);
    assert.equal(vm.peek(S.BPM), 115, "held shoulder has no unwanted repeats");
    padPress(SNES.R);
    assert.equal(vm.peek(S.BPM), 120);

    padPress(SNES.RIGHT);
    assert.equal(vm.peek(S.CURSOR_STEP), 1);
    ticks(68);
    assert.equal(vm.peek(S.CURSOR_STEP), 1, "navigation waits before repeating");
    ticks(4);
    assert.equal(vm.peek(S.CURSOR_STEP), 2);
    ticks(20);
    assert.equal(vm.peek(S.CURSOR_STEP), 3, "held navigation repeats on hardware time");
    padPress(SNES.LEFT | SNES.RIGHT | SNES.UP | SNES.DOWN);
    ticks(100);
    assert.equal(vm.peek(S.CURSOR_STEP), 3);
    assert.equal(vm.peek(S.CURSOR_TRACK), 0, "opposing directions cancel");
    padPress(SNES.UP);
    assert.equal(vm.peek(S.CURSOR_TRACK), 5);
    padPress(SNES.DOWN);
    assert.equal(vm.peek(S.CURSOR_TRACK), 0);
    padPress(SNES.LEFT);
    assert.equal(vm.peek(S.CURSOR_STEP), 2);
    vm.setGamepadState(0, 0);
    ticks(120);
    assert.equal(vm.peek(S.CURSOR_STEP), 2, "disconnect/release stops navigation");
    padPress(SNES.START);
    assert.equal(vm.peek(S.PLAYING), 1);
    assert.equal(vm.peek(S.PLAY_STEP), 0, "pad restart begins at step 1");
    assert.equal(vm.peek(0xcee0 + 3), 1, "input came through the ROM GAMEPAD1 table");
    console.log("PASS all SNES controls through the serial VIA/ROM path, debounce, repeat, and release");
  } finally {
    app.close();
  }
}

{
  const app = await start();
  try {
    const { vm, key, ticks } = app;
    for (let i = 0; i < 20; i++) key("[");
    assert.equal(vm.peek(S.BPM), 60);
    assert.match(screen(vm)[2], /BPM 060/);
    for (let i = 0; i < 30; i++) key("]");
    assert.equal(vm.peek(S.BPM), 180);
    assert.match(screen(vm)[2], /BPM 180/);
    for (const tempo of [60, 95, 120, 175, 180]) {
      vm.poke(S.BPM, tempo);
      vm.poke(S.PLAY_STEP, 0);
      pokeWord(vm, S.PHASE_LOW, 0);
      ticks(720);
      const advances = Math.floor(720 * tempo / S.STEP_PHASE);
      assert.equal(vm.peek(S.PLAY_STEP), advances % 16, `${tempo} BPM sixteenth notes`);
      assert.equal(word(vm, S.PHASE_LOW), (720 * tempo) % S.STEP_PHASE,
        `${tempo} BPM retains fractional phase`);
    }
    console.log("PASS tempo bounds and exact fractional scheduling across the BPM range");
  } finally {
    app.close();
  }
}

{
  const app = await start();
  try {
    const { vm, key, ticks } = app;
    key(13);
    // Isolate each voice, but trigger it through real guest keyboard editing.
    for (let voice = 0; voice < 6; voice++) {
      ticks(150);
      vm.poke(S.CURSOR_TRACK, voice);
      vm.poke(S.CURSOR_STEP, 0);
      vm.poke(S.PRESETS + voice, 2);
      vm.poke(S.STEP_ON + voice * 16, 1);
      vm.poke(S.STEP_NOTES + voice * 16, voice === 5 ? 4 : 13);
      vm.drainAudio();
      key("+");
      vm.drainAudio();
      ticks(20);
      const audio = vm.drainAudio();
      const channel = voice < 3 ? 0 : 1;
      assert.ok(energy(audio, channel) > 1, `voice ${voice + 1} produces audio`);
      assert.ok(silent(audio, 1 - channel), `voice ${voice + 1} respects hard pan`);
      if (voice < 3) {
        const tableIndex = imageByte(S.NOTE_OFFSETS + voice) + 13;
        const period = imageByte(S.PERIOD_LOW + tableIndex) |
          (imageByte(S.PERIOD_HIGH + tableIndex) << 8);
        const frequency = risingFrequency(audio, channel);
        const expected = PHI2 / (16 * period);
        assert.ok(Math.abs(frequency - expected) / expected < 0.12,
          `voice ${voice + 1} has hardware-clock pitch (${frequency.toFixed(1)} Hz)`);
      }
      if (voice === 3) {
        const initial = imageByte(S.PERIOD_LOW + 13) | (imageByte(S.PERIOD_HIGH + 13) << 8);
        const swept = vm.peek(S.TONE_LOW + voice) | (vm.peek(S.TONE_HIGH + voice) << 8);
        assert.ok(swept > initial, "kick pitch falls as its period increases");
      }
    }
    ticks(240);
    vm.drainAudio();
    ticks(60);
    const tail = vm.drainAudio();
    assert.ok(silent(tail, 0) && silent(tail, 1),
      "all six envelope tails eventually become silent");
    console.log("PASS six isolated hardware voices, stereo separation, tuning, kick sweep, and release");
  } finally {
    app.close();
  }
}

{
  const app = await start();
  try {
    const { vm, ticks } = app;
    // Force a dense six-voice step, live editor action, and ROM pad scan together.
    for (let i = 0; i < 96; i++) vm.poke(S.STEP_ON + i, 1);
    vm.poke(S.TICK_COUNTER, 3);
    pokeWord(vm, S.PHASE_LOW, S.STEP_PHASE - 120);
    vm.setGamepadState(0, SNES.DOWN | SNES.A);
    vm.keyDown("I".charCodeAt(0));
    vm.addBreakpoint(S.TICK_ENVELOPES);
    for (let wakeups = 0; vm.pc() === S.MAIN_WAIT && wakeups < 32; wakeups++) {
      vm.step();
      vm.runCycles(TIMER_PERIOD * 4);
    }
    assert.equal(vm.pc(), S.TICK_ENVELOPES);
    vm.removeBreakpoint(S.TICK_ENVELOPES);
    const workCycles = vm.step() + vm.runCycles(TIMER_PERIOD * 4);
    assert.equal(vm.pc(), S.MAIN_WAIT);
    assert.ok(workCycles + 32 < TIMER_PERIOD,
      `worst live tick fits the hardware deadline: ${workCycles + 32} < ${TIMER_PERIOD}`);
    ticks(240);
    console.log(`PASS dense-step/input/render deadline (${workCycles + 32}/${TIMER_PERIOD} cycles)`);
  } finally {
    app.close();
  }
}

{
  const app = await start();
  try {
    const { vm } = app;
    vm.clearBreakpoints();
    vm.keyDown("Q".charCodeAt(0));
    vm.runCycles(PHI2 / 2);
    assert.match(vm.drainOutput(), harness.MONITOR_DUMP, "Q returns to the ROM monitor");
    assert.equal(vm.readBus(0xc40e) & 0x7f, 0);
    assert.equal(vm.readBus(0xc48e) & 0x7f, 0);
    assert.equal(vm.peek(0xce15), app.joymode, "joystick mode is restored");
    for (const [addr, value] of app.vectors) assert.equal(vm.peek(addr), value);
    assert.ok(Array.from({ length: 6 }, (_, i) => vm.peek(S.VOLUMES + i)).every((v) => v === 0));
    assert.ok(!vm.irqAsserted(), "no Mockingboard IRQ is left asserted on exit");
    console.log("PASS clean monitor exit, silent voices, restored input mode, and disabled timer IRQ");
  } finally {
    app.close();
  }
}

assert.equal(readFileSync(join(ROOT, "web", "programs", "groovebox.s"), "utf8"), source,
  "published sample is the canonical source");
console.log("PASS staged browser source matches the downloadable guest program");
