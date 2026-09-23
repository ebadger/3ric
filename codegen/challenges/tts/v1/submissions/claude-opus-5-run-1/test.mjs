// =====================================================================
// test.mjs -- my own tests for this entry, beyond the shared checker.
//
//   node test.mjs            run everything
//   node test.mjs rules      letter-to-sound rules only
//   node test.mjs audio      spectral measurement of the demo sentences
//
// The rule tests call TTS_TRANSLATE and read the phoneme buffer straight
// out of VM memory.  The audio tests speak a sentence, capture the PCM
// the emulator produces from the AY chips and measure where the energy
// actually sits, because I have no way to listen to it myself.
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import harness from "../../../../../tools/harness.cjs";
import { assemble } from "../../../../../tools/asm6502.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLOCK_HZ = 1_573_437.5;
const SAMPLE_RATE = 48_000;
const CALLER = 0x0300;
const RETURN = 0x0308;

const source = fs.readFileSync(path.join(HERE, "tts.s"), "utf8");
const image = assemble(source, { org: 0x0800 });
const sym = image.symbols;

let failures = 0;
let checks = 0;
function ok(condition, label, detail = "") {
  checks++;
  if (!condition) failures++;
  const mark = condition ? "ok  " : "FAIL";
  console.log(`  ${mark} ${label}${detail ? `  (${detail})` : ""}`);
}

async function boot() {
  const session = await harness.boot();
  const vm = session.vm;
  if (!vm.enableAudio(SAMPLE_RATE)) throw new Error("VM rejected 48 kHz audio");
  vm.drainAudio();
  session.load(image.bytes, image.org);
  call(vm, "TTS_INIT", null, { cycles: 2_000_000 });
  return vm;
}

// Call a routine through the same trampoline shape the shared checker
// uses, so the tests exercise the documented ABI.
function call(vm, routine, text, { cycles = 40_000_000, captureAudio = false, escapeAfter = null } = {}) {
  if (text != null) vm.loadData(sym.TTS_INPUT, Buffer.from(`${text}\0`, "ascii"));
  const address = sym[routine];
  const trampoline = new Uint8Array(32).fill(0xea);
  trampoline.set([0xd8, 0xa9, sym.TTS_INPUT & 255, 0xa2, sym.TTS_INPUT >> 8,
    0x20, address & 255, address >> 8]);
  trampoline.set([0x4c, 0x10, 0x03], 0x10);
  vm.loadData(CALLER, trampoline);
  vm.readBus(0xc010);
  vm.clearBreakpoints();
  vm.addBreakpoint(RETURN);
  vm.setPC(CALLER);
  vm.drainAudio();
  const pcm = [];
  let used = 0;
  let injected = false;
  let returned = false;
  while (used < cycles) {
    if (escapeAfter != null && !injected && used >= escapeAfter) {
      vm.keyDown(27);
      injected = true;
    }
    let batch = Math.min(200_000, cycles - used);
    if (escapeAfter != null && !injected) batch = Math.min(batch, escapeAfter - used);
    const advanced = vm.runCycles(batch);
    used += advanced;
    const block = vm.drainAudio();
    if (captureAudio && block && block.length) pcm.push(Float32Array.from(block));
    if (vm.breakpointHit() && vm.pc() === RETURN) { returned = true; break; }
    if (advanced <= 0) break;
  }
  let audio = null;
  if (captureAudio) {
    const total = pcm.reduce((sum, block) => sum + block.length, 0);
    audio = new Float32Array(total / 2);
    let at = 0;
    for (const block of pcm)
      for (let i = 0; i + 1 < block.length; i += 2) audio[at++] = block[i];
  }
  return { returned, a: vm.regA(), sp: vm.sp(), cycles: used, audio };
}

function phonemes(vm) {
  const length = vm.peek(sym.PHONLEN);
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(vm.peek(sym.PHONBUF + i));
  return out;
}

// --- rules -----------------------------------------------------------
const RULE_CASES = [
  ["HELLO.", "helO."],
  ["THIS COMPUTER CAN TALK.", "Dis kxmpyUtR k@n tck."],
  ["WE MAKE NEW SOFTWARE FOR OLD COMPUTERS.", "wE mAk nU saftwer fOr Old kxmpyUtRz."],
  ["THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.",
    "Dx kwik brWn faks J^mps OvR Dx lAzE dag."],
  ["PLEASE TYPE A SENTENCE AND PRESS ENTER.", "plEz tIp x sentens @nd pres entR."],
  ["hello.", "helO."],
  ["CAT SITS", "k@t sits."],
  ["SHE SHOULD SING", "SE Sud siG."],
  ["MY NAME IS ERIC", "mI nAm iz erik."],
  ["ONE TWO THREE", "w^n tU TrE."],
  ["A, B.", "x,b."],
];

async function testRules() {
  console.log("letter-to-sound rules");
  const vm = await boot();
  for (const [text, expected] of RULE_CASES) {
    const result = call(vm, "TTS_TRANSLATE", text, { cycles: 4_000_000 });
    const got = phonemes(vm);
    ok(result.returned && got === expected, JSON.stringify(text), `got ${JSON.stringify(got)}`);
  }
  // Invalid and empty input must translate to nothing at all.
  for (const text of ["", "   ", "12345", "HELLO@WORLD", "A".repeat(121)]) {
    const result = call(vm, "TTS_TRANSLATE", text, { cycles: 4_000_000 });
    ok(result.returned && result.a === 0, `no phonemes for ${JSON.stringify(text)}`, `A=${result.a}`);
  }
  // The caller's string must survive a full speak.
  const text = "PLEASE TYPE A SENTENCE AND PRESS ENTER.";
  call(vm, "TTS_SPEAK", text, { cycles: 40_000_000 });
  let intact = true;
  for (let i = 0; i < text.length; i++)
    if (vm.peek(sym.TTS_INPUT + i) !== text.charCodeAt(i)) intact = false;
  ok(intact, "input string preserved across TTS_SPEAK");
}

// --- audio -----------------------------------------------------------
// A plain Goertzel bank: for each 20 ms window, the energy in every
// analysis band. Cheap, dependency free, and enough to see formants.
function spectrum(frame, rate, frequencies) {
  return frequencies.map(hz => {
    const w = (2 * Math.PI * hz) / rate;
    const coeff = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < frame.length; i++) {
      const s0 = frame[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / frame.length;
  });
}

const BANDS = [];
for (let hz = 150; hz <= 2900; hz += 25) BANDS.push(hz);

function analyse(audio, rate = SAMPLE_RATE) {
  const size = Math.round(rate * 0.02);
  const frames = [];
  for (let start = 0; start + size <= audio.length; start += size) {
    const frame = audio.subarray(start, start + size);
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
    frames.push({ rms: Math.sqrt(energy / frame.length), bands: spectrum(frame, rate, BANDS) });
  }
  return frames;
}

// Crude formant reading. The synthesised spectrum has real resonances
// plus DAC quantisation sidelobes, so a plain "loudest bin" reading is
// Crude formant reading.
//
// The naive approach -- "the loudest bin on a fixed frequency grid" --
// does not work here.  The voice is strictly periodic, so its spectrum
// is a comb of harmonics of F0 (~107 Hz); a fixed 25 or 50 Hz analysis
// grid beats against that comb and produces peaks that have nothing to
// do with the vocal tract.  So: find F0 by autocorrelation, measure the
// magnitude at each harmonic, and read the formants off the *envelope*
// of those harmonics.
function pitchPeriod(audio, start, size, rate) {
  let bestLag = 0;
  let best = -1;
  const top = Math.min(Math.floor(rate / 60), Math.floor((audio.length - start) / 2));
  for (let lag = Math.floor(rate / 400); lag < top; lag++) {
    let dot = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i < size; i++) {
      const x = audio[start + i];
      const y = audio[start + i + lag];
      dot += x * y;
      a += x * x;
      b += y * y;
    }
    const c = dot / Math.sqrt(a * b + 1e-12);
    if (c > best) { best = c; bestLag = lag; }
  }
  return { lag: bestLag, f0: rate / bestLag, correlation: best };
}

function harmonicEnvelope(audio, start, size, rate) {
  const { f0, correlation } = pitchPeriod(audio, start, Math.floor(size / 2), rate);
  const window = Float32Array.from(audio.subarray(start, start + size),
    (v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)));
  const points = [];
  for (let k = 1; k * f0 <= 2900; k++) {
    const hz = k * f0;
    const w = (2 * Math.PI * hz) / rate;
    let re = 0;
    let im = 0;
    for (let i = 0; i < size; i++) { re += window[i] * Math.cos(w * i); im += window[i] * Math.sin(w * i); }
    points.push({ hz, value: Math.hypot(re, im) / size });
  }
  // three-point smoothing, so a single weak harmonic between two strong
  // ones cannot masquerade as a formant boundary
  const smooth = points.map((p, i) => ({
    hz: p.hz,
    value: (points[Math.max(0, i - 1)].value + p.value + points[Math.min(points.length - 1, i + 1)].value) / 3,
  }));
  return { f0, correlation, points: smooth };
}

function envelopePeak(envelope, lowHz, highHz) {
  let hz = 0;
  let value = -1;
  for (const point of envelope.points) {
    if (point.hz < lowHz || point.hz > highHz) continue;
    if (point.value > value) { value = point.value; hz = point.hz; }
  }
  return { hz: Math.round(hz), value };
}

// A vocal tract has several resonances, and above F1 the higher ones are often
// within a decibel of each other.  Taking the strongest harmonic in the band
// would then report F3 as if it were F2, so prefer the *lowest* local maximum
// that comes within `tolDb` of the strongest one.
function envelopeFormant(envelope, lowHz, highHz, tolDb = 1) {
  const best = envelopePeak(envelope, lowHz, highHz);
  if (best.value <= 0) return best;
  const floor = best.value * Math.pow(10, -tolDb / 20);
  const pts = envelope.points;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const p = pts[i];
    if (p.hz < lowHz || p.hz > highHz) continue;
    if (p.value < floor) continue;
    if (p.value < pts[i - 1].value || p.value < pts[i + 1].value) continue;
    return { hz: Math.round(p.hz), value: p.value };
  }
  return best;
}

// formants of one 20 ms analysis frame, used only for the coarse
// "does F1/F2 move across the sentence" test
function formants(frame) {
  const first = peakIn(frame, 200, 1000);
  const second = peakIn(frame, Math.max(700, first.hz + 250), 2600);
  return { f1: first.hz, f2: second.hz, f1v: first.value, f2v: second.value };
}

function peakIn(frame, lowHz, highHz) {
  let hz = 0;
  let value = -1;
  for (let i = 0; i < BANDS.length; i++) {
    if (BANDS[i] < lowHz || BANDS[i] > highHz) continue;
    if (frame.bands[i] > value) { value = frame.bands[i]; hz = BANDS[i]; }
  }
  return { hz, value };
}

async function testAudio() {
  console.log("acoustic measurement");
  const vm = await boot();
  const sentences = [
    "HELLO. THIS COMPUTER CAN TALK.",
    "WE MAKE NEW SOFTWARE FOR OLD COMPUTERS.",
    "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.",
    "PLEASE TYPE A SENTENCE AND PRESS ENTER.",
  ];
  for (const text of sentences) {
    const result = call(vm, "TTS_SPEAK", text, { cycles: 60_000_000, captureAudio: true });
    const frames = analyse(result.audio);
    const loud = frames.filter(frame => frame.rms > 0.01);
    const peak = result.audio.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const seconds = result.audio.length / SAMPLE_RATE;
    ok(result.returned && result.a === 0, `speaks ${JSON.stringify(text.slice(0, 22))}...`,
      `A=${result.a}`);
    ok(seconds > 0.8 && seconds < 8, "plausible duration", `${seconds.toFixed(2)} s`);
    ok(peak > 0.05, "usable level", `peak ${peak.toFixed(3)}`);
    ok(loud.length > frames.length * 0.25, "mostly voiced, not a burst", `${loud.length}/${frames.length} frames`);
    // Formant movement is what makes this speech and not a tone: count
    // how many distinct F2 positions the sentence visits.
    const f2s = new Set(loud.map(frame => Math.round(formants(frame).f2 / 200) * 200));
    ok(f2s.size >= 4, "F2 moves across the sentence", `${f2s.size} distinct F2 regions`);
    const f1s = new Set(loud.map(frame => Math.round(formants(frame).f1 / 100) * 100));
    ok(f1s.size >= 3, "F1 moves across the sentence", `${f1s.size} distinct F1 regions`);
  }
}

// Isolated vowels: the measured formants must land near the targets the
// record table asks for. This is the closest thing I have to listening.
// The carrier words start with a sonorant so no fricative noise can
// dominate the measurement.
const VOWELS = [
  ["ME", 290, 2270],
  ["MOO", 310, 900],
  ["LAW", 590, 900],
  ["MAN", 690, 1690],
  ["MAY", 340, 2160],
];

// The vowel nucleus, six tenths of the way through the audible span:
// every carrier word here is <sonorant><vowel>, so that always lands
// inside the vowel.
function nucleusOffset(audio, rate = SAMPLE_RATE) {
  const size = Math.round(rate * 0.02);
  let first = -1;
  let last = -1;
  for (let start = 0; start + size <= audio.length; start += size) {
    let energy = 0;
    for (let i = 0; i < size; i++) energy += audio[start + i] * audio[start + i];
    if (Math.sqrt(energy / size) > 0.02) { if (first < 0) first = start; last = start; }
  }
  if (first < 0) return -1;
  return first + Math.floor((last - first) * 0.6);
}

async function testVowels() {
  console.log("vowel targets");
  const vm = await boot();
  const size = 2048;
  for (const [word, wantF1, wantF2] of VOWELS) {
    const result = call(vm, "TTS_SPEAK", word, { cycles: 30_000_000, captureAudio: true });
    let at = nucleusOffset(result.audio);
    if (at < 0) { ok(false, `${word}: no voiced frames`); continue; }
    at = Math.min(at, result.audio.length - 2 * size);
    const envelope = harmonicEnvelope(result.audio, at, size, SAMPLE_RATE);
    const first = envelopePeak(envelope, 200, 1000);
    const second = envelopeFormant(envelope, Math.max(700, first.hz + 250), 2600);
    const near = (got, want, tol) => Math.abs(got - want) <= tol;
    ok(near(first.hz, wantF1, 250) && near(second.hz, wantF2, 400), `${word} formants`,
      `F0 ${envelope.f0.toFixed(0)}, F1 ${first.hz} (want ${wantF1}), F2 ${second.hz} (want ${wantF2})`);
    if (process.env.TTS_SHOW_ENVELOPE) {
      const max = Math.max(...envelope.points.map(p => p.value));
      for (const point of envelope.points)
        console.log("      ", String(Math.round(point.hz)).padStart(5),
          "#".repeat(Math.max(0, Math.round(40 + 20 * Math.log10(point.value / max) / 1.5))));
    }
  }
}

async function testBehaviour() {
  console.log("behaviour");
  const vm = await boot();
  const init = call(vm, "TTS_INIT", null, { cycles: 2_000_000 });
  ok(init.returned && init.a === 0, "TTS_INIT returns 0");

  const long = `${"HELLO. THIS COMPUTER CAN TALK. "}`.repeat(4).slice(0, 120);
  const max = call(vm, "TTS_SPEAK", long, { cycles: 120_000_000 });
  ok(max.returned && max.a === 0, "120 characters speak to completion", `A=${max.a}`);

  const over = call(vm, "TTS_SPEAK", "A".repeat(121), { cycles: 4_000_000 });
  ok(over.returned && over.a === 2, "121 characters rejected", `A=${over.a}`);

  const bad = call(vm, "TTS_SPEAK", "HELLO 1234", { cycles: 4_000_000 });
  ok(bad.returned && bad.a === 2, "digits rejected", `A=${bad.a}`);

  // Cancellation, then a normal utterance afterwards.
  const cancel = call(vm, "TTS_SPEAK", "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.",
    { cycles: 60_000_000, escapeAfter: 2_000_000, captureAudio: true });
  ok(cancel.returned && cancel.a === 1, "escape cancels", `A=${cancel.a}`);
  ok(cancel.cycles < 20_000_000, "cancellation is prompt", `${cancel.cycles} cycles`);

  // After the return the chips must be quiet.
  vm.clearBreakpoints();
  vm.loadData(0x0310, Uint8Array.of(0x4c, 0x10, 0x03));
  vm.setPC(0x0310);
  vm.runCycles(400_000);
  vm.drainAudio();
  let quietPeak = 0;
  for (let i = 0; i < 8; i++) {
    vm.runCycles(50_000);
    const block = vm.drainAudio();
    for (let j = 0; j < block.length; j++) quietPeak = Math.max(quietPeak, Math.abs(block[j]));
  }
  ok(quietPeak < 5e-4, "silent after cancellation", `peak ${quietPeak.toExponential(2)}`);

  const again = call(vm, "TTS_SPEAK", "HELLO.", { cycles: 40_000_000, captureAudio: true });
  const peak = again.audio.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  ok(again.returned && again.a === 0 && peak > 0.05, "speaks again after cancellation",
    `A=${again.a} peak ${peak.toFixed(3)}`);

  // Repeated identical utterances must behave identically.
  const first = call(vm, "TTS_SPEAK", "HELLO.", { cycles: 40_000_000, captureAudio: true });
  const second = call(vm, "TTS_SPEAK", "HELLO.", { cycles: 40_000_000, captureAudio: true });
  ok(Math.abs(first.cycles - second.cycles) < first.cycles * 0.02, "repeatable timing",
    `${first.cycles} vs ${second.cycles}`);
}

const which = process.argv[2] || "all";
if (which === "all" || which === "rules") await testRules();
if (which === "all" || which === "behaviour") await testBehaviour();
if (which === "all" || which === "audio") await testAudio();
if (which === "all" || which === "vowels") await testVowels();
console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
