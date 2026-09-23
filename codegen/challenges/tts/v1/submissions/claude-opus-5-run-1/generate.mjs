// generate.mjs -- builds the generated data block inside tts.s.
//
//   node codegen/challenges/tts/v1/submissions/claude-opus-5-run-1/generate.mjs
//
// Everything this script emits is synthesised from the closed-form parameters
// below; no recorded audio, no third-party table and no pretrained model is
// involved. Two kinds of table are produced:
//
//   1. Formant impulse-response banks. Each entry is one damped sinusoid
//      h[n] = A * exp(-pi*B*n/FS) * sin(2*pi*F*n/FS), which is the impulse
//      response of a single two-pole resonator. The 65C02 plays these tables
//      back from the last glottal pulse, so a parallel three-formant
//      synthesiser costs three indexed loads per sample instead of six
//      multiplies.
//
//   2. Amplitude ("gain") tables that map the summed formant sample to a PAIR
//      of AY-3-8910 4-bit volume codes. One logarithmic 16-step channel used as
//      a linear DAC only reaches about 12 dB of signal-to-quantisation-noise
//      ratio; summing two channels of the same chip reaches about 29 dB, which
//      is the difference between a buzz and a voice. The bias/scale of the DAC
//      window is chosen by a numeric search that minimises quantisation noise
//      for a Laplacian speech-amplitude distribution.
//
// The AY level table is the one in the 3RIC emulator's AY-3-8910 model
// (emulator/Badger6502VMLib/ay38910.cpp, adapted there from floooh/chips);
// it describes the hardware, and is used here only to invert it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Platform constants
// ---------------------------------------------------------------------------

import { emitRecords } from "./records.mjs";

export const PHI2 = 1_573_437.5;          // 3RIC CPU / AY clock
export const SAMPLE_PERIOD = 320;         // VIA T1 free-run period, in PHI2 cycles
export const FS = PHI2 / SAMPLE_PERIOD;   // 4917 Hz synthesis rate
export const IRLEN = 128;                 // samples per impulse-response entry

// AY-3-8910 amplitude for each 4-bit volume code (linear, 0..1).
export const AY_LEVELS = [
  0.0, 0.00999465934234, 0.0144502937362, 0.0210574502174,
  0.0307011520562, 0.0455481803616, 0.0644998855573, 0.107362478065,
  0.126588845655, 0.20498970016, 0.292210269322, 0.372838941024,
  0.492530708782, 0.635324635691, 0.805584802014, 1.0,
];

// ---------------------------------------------------------------------------
// Voice design parameters
// ---------------------------------------------------------------------------

// Resonator bandwidths. Real speech uses 60-90 Hz for F1; these are wider so
// that each impulse response has essentially decayed within one pitch period
// (the 65C02 restarts the table at every glottal pulse instead of running a
// real recursive filter, so an undecayed tail would be truncated into a click).
export const BANKS = {
  f1: { count: 24, low: 180, high: 1100, bandwidth: 110, peak: 64 },
  f2: { count: 32, low: 550, high: 2340, bandwidth: 150, peak: 36 },
  f3: { count: 8, low: 1600, high: 2380, bandwidth: 220, peak: 17 },
};

// Per-frame amplitude steps used by the engine (index 0..7 -> relative level).
// Roughly 4 dB apart, with 0 reserved for "no voicing".
export const GAIN_STEPS = [0, 0.14, 0.22, 0.33, 0.46, 0.62, 0.80, 1.0];

export function bankFrequencies({ count, low, high }) {
  if (count === 1) return [low];
  const ratio = (high / low) ** (1 / (count - 1));
  return Array.from({ length: count }, (_, i) => low * ratio ** i);
}

// Impulse response of one two-pole resonator, scaled so that its peak is
// exactly `peak` counts.
export function impulseResponse(frequency, bandwidth, peak) {
  const raw = [];
  for (let n = 0; n < IRLEN; n++) {
    raw.push(Math.exp((-Math.PI * bandwidth * n) / FS) *
      Math.sin((2 * Math.PI * frequency * n) / FS));
  }
  const scale = peak / Math.max(...raw.map(Math.abs));
  return raw.map(v => Math.max(-127, Math.min(127, Math.round(v * scale))));
}

// ---------------------------------------------------------------------------
// DAC window search
// ---------------------------------------------------------------------------

// Every level reachable by summing two AY volume codes on one chip, with the
// cheapest code pair that reaches it.
export function pairedLevels() {
  const best = new Map();
  for (let a = 0; a < AY_LEVELS.length; a++) {
    for (let c = 0; c < AY_LEVELS.length; c++) {
      const level = AY_LEVELS[a] + AY_LEVELS[c];
      const key = level.toFixed(9);
      if (!best.has(key)) best.set(key, { level, a, c });
    }
  }
  return [...best.values()].sort((x, y) => x.level - y.level);
}

const LEVELS = pairedLevels();

// Nearest reachable level for a linear target, returned as a code pair.
export function nearestPair(level) {
  let best = LEVELS[0];
  let bestError = Infinity;
  for (const candidate of LEVELS) {
    const error = Math.abs(candidate.level - level);
    if (error < bestError) { bestError = error; best = candidate; }
  }
  return best;
}

// Signal-to-quantisation-noise ratio of a bias/scale window, measured against a
// Laplacian amplitude distribution (a standard model for speech samples).
function windowSnr(bias, scale) {
  let signal = 0;
  let noise = 0;
  const b = 1 / 4; // Laplacian scale: most energy well inside full scale
  for (let i = -256; i <= 256; i++) {
    const x = i / 256;                       // normalised sample, -1..1
    const weight = Math.exp(-Math.abs(x) / b);
    const target = bias + scale * x;
    if (target < 0 || target > 2) return -Infinity;
    const error = nearestPair(target).level - target;
    signal += weight * (scale * x) ** 2;
    noise += weight * error ** 2;
  }
  return 10 * Math.log10(signal / Math.max(noise, 1e-18));
}

export function chooseWindow() {
  let best = { bias: 0.65, scale: 0.65, snr: -Infinity };
  for (let bi = 1; bi <= 80; bi++) {
    const bias = (bi / 80) * 2;
    for (let si = 1; si <= 80; si++) {
      const scale = (si / 80) * 2;
      if (bias - scale < 0 || bias + scale > 2) continue;
      const snr = windowSnr(bias, scale);
      if (snr > best.snr) best = { bias, scale, snr };
    }
  }
  return best;
}

// Amplitude table g: index = (formant sum + 128) & 255; the tables hold the
// volume code for each AY channel taking part in the DAC.
//
// Picking the nearest reachable level independently for each table entry is
// not good enough. The channels are written one after another, about 38 us
// apart, so for part of every sample period the chip is holding a mixture of
// the old and new codes. If neighbouring entries use wildly different code
// combinations for nearly the same level, those intermediate states are far
// from either endpoint and the DAC glitches -- which measures as a flat,
// noise-like spectrum with no formants left in it. So the table is built as a
// walk over increasing level, preferring combinations close to the previous
// entry's; accuracy still dominates, code movement only breaks ties.
const MOVE_WEIGHT = 0.0006;

function buildTable(levels, window, relative, channels) {
  const out = Object.fromEntries(channels.map(c => [c, new Array(256).fill(0)]));
  let previous = null;
  for (let sample = -128; sample <= 127; sample++) {
    const x = Math.max(-1, Math.min(1, (sample / 127) * relative));
    const target = window.bias + window.scale * x;
    let best = null;
    let bestCost = Infinity;
    for (const candidate of levels) {
      const error = Math.abs(candidate.level - target);
      if (error > 0.05 && best) continue;
      let move = 0;
      if (previous) for (const c of channels) move += Math.abs(candidate[c] - previous[c]);
      const cost = error + MOVE_WEIGHT * move;
      if (cost < bestCost) { bestCost = cost; best = candidate; }
    }
    previous = best;
    const index = sample & 255;
    for (const c of channels) out[c][index] = best[c];
  }
  return out;
}

export function gainTables(window, relative) {
  return buildTable(LEVELS, window, relative, ["a", "c"]);
}

export function gainTables3(window, relative) {
  return buildTable(TRIPLES, window, relative, ["a", "b", "c"]);
}

// Three-channel DAC. Channels A, B and C of one AY summed together reach far
// more distinct levels than a pair does (816 against 136), which is worth about
// 15 dB of quantisation noise -- the difference between a second formant that
// survives the DAC and one that is buried by it. Channel B is only free for
// this when the record does not need the hardware noise generator, so both
// tables sets are generated and the engine switches per record.
export function tripleLevels() {
  const best = new Map();
  for (let a = 0; a < AY_LEVELS.length; a++)
    for (let b = 0; b < AY_LEVELS.length; b++)
      for (let c = 0; c < AY_LEVELS.length; c++) {
        const level = AY_LEVELS[a] + AY_LEVELS[b] + AY_LEVELS[c];
        const key = level.toFixed(9);
        if (!best.has(key)) best.set(key, { level, a, b, c });
      }
  return [...best.values()].sort((x, y) => x.level - y.level);
}

const TRIPLES = tripleLevels();
const TRIPLE_LEVELS = TRIPLES.map(t => t.level);

function nearestSorted(values, level) {
  let lo = 0;
  let hi = values.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < level) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(values[lo - 1] - level) <= Math.abs(values[lo] - level)) return lo - 1;
  return lo;
}

export function nearestTriple(level) {
  return TRIPLES[nearestSorted(TRIPLE_LEVELS, level)];
}

function windowSnr3(bias, scale) {
  let signal = 0;
  let noise = 0;
  const b = 1 / 4;
  for (let i = -256; i <= 256; i++) {
    const x = i / 256;
    const weight = Math.exp(-Math.abs(x) / b);
    const target = bias + scale * x;
    if (target < 0 || target > 3) return -Infinity;
    const error = nearestTriple(target).level - target;
    signal += weight * (scale * x) ** 2;
    noise += weight * error ** 2;
  }
  return 10 * Math.log10(signal / Math.max(noise, 1e-18));
}

export function chooseWindow3() {
  let best = { bias: 0.9, scale: 0.9, snr: -Infinity };
  for (let bi = 1; bi <= 120; bi++) {
    const bias = (bi / 120) * 3;
    for (let si = 1; si <= 120; si++) {
      const scale = (si / 120) * 3;
      if (bias - scale < 0 || bias + scale > 3) continue;
      const snr = windowSnr3(bias, scale);
      if (snr > best.snr) best = { bias, scale, snr };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Assembly emission
// ---------------------------------------------------------------------------

function bytesBlock(values, indent = "        ") {
  const lines = [];
  for (let i = 0; i < values.length; i += 16) {
    const row = values.slice(i, i + 16)
      .map(v => (v < 0 ? v + 256 : v).toString(16).toUpperCase().padStart(2, "0"))
      .map(v => `$${v}`)
      .join(",");
    lines.push(`${indent}.byte ${row}`);
  }
  return lines.join("\n");
}

function emitBank(name, spec, origin) {
  const frequencies = bankFrequencies(spec);
  const out = [];
  out.push(`; ${name.toUpperCase()} resonator bank: ${spec.count} entries of ${IRLEN} bytes,`);
  out.push(`; ${spec.low} Hz .. ${spec.high} Hz (logarithmic), bandwidth ${spec.bandwidth} Hz, peak +-${spec.peak}.`);
  out.push(`        .org $${origin.toString(16).toUpperCase().padStart(4, "0")}`);
  out.push(`${name}_bank:`);
  frequencies.forEach((frequency, index) => {
    out.push(`; [${index}] ${frequency.toFixed(0)} Hz`);
    out.push(bytesBlock(impulseResponse(frequency, spec.bandwidth, spec.peak)));
  });
  return { text: out.join("\n"), frequencies, end: origin + spec.count * IRLEN };
}

function emitPointerTable(name, origin, count) {
  const lo = [];
  const hi = [];
  for (let i = 0; i < count; i++) {
    const address = origin + i * IRLEN;
    lo.push(address & 0xff);
    hi.push(address >> 8);
  }
  return [`${name}_lo:`, bytesBlock(lo), `${name}_hi:`, bytesBlock(hi)].join("\n");
}

// Pointer tables for the amplitude banks use a 256-byte stride.
function emitGainPointers(name, origin, count) {
  const lo = [];
  const hi = [];
  for (let i = 0; i < count; i++) {
    const address = origin + i * 256;
    lo.push(address & 0xff);
    hi.push(address >> 8);
  }
  return [`${name}_lo:`, bytesBlock(lo), `${name}_hi:`, bytesBlock(hi)].join("\n");
}

export function generate() {
  const window = chooseWindow();
  const out = [];
  const banks = {};
  let origin = 0x0c00;

  out.push("; ===========================================================================");
  out.push("; GENERATED DATA -- produced by generate.mjs. Do not edit by hand.");
  out.push(";");
  out.push(`; Synthesis rate: ${FS.toFixed(2)} Hz (VIA T1 free-run period ${SAMPLE_PERIOD} PHI2 cycles).`);
  out.push(`; DAC window: bias ${window.bias.toFixed(3)} of full scale, +-${window.scale.toFixed(3)} swing;`);
  out.push(`; modelled signal-to-quantisation-noise ratio ${window.snr.toFixed(1)} dB against a`);
  out.push("; Laplacian speech-amplitude distribution.");
  out.push("; ===========================================================================");
  out.push("");

  for (const [name, spec] of Object.entries(BANKS)) {
    const bank = emitBank(name, spec, origin);
    banks[name] = { origin, frequencies: bank.frequencies };
    out.push(bank.text, "");
    origin = bank.end;
  }

  const gainAOrigin = origin;
  const tables = GAIN_STEPS.map(relative => gainTables(window, relative));
  out.push("; Amplitude tables: index = (formant sum + 128) & $FF, value = the AY");
  out.push("; volume code for channel A (register 8).");
  out.push(`        .org $${gainAOrigin.toString(16).toUpperCase().padStart(4, "0")}`);
  out.push("gaina_bank:");
  tables.forEach((table, index) => {
    out.push(`; gain ${index}: relative amplitude ${GAIN_STEPS[index].toFixed(2)}`);
    out.push(bytesBlock(table.a));
  });
  origin += GAIN_STEPS.length * 256;

  const gainCOrigin = origin;
  out.push("");
  out.push("; The matching channel C (register 10) code. Channel A + channel C is the");
  out.push("; two-channel DAC level; neither table is usable on its own.");
  out.push(`        .org $${gainCOrigin.toString(16).toUpperCase().padStart(4, "0")}`);
  out.push("gainc_bank:");
  tables.forEach((table, index) => {
    out.push(`; gain ${index}: relative amplitude ${GAIN_STEPS[index].toFixed(2)}`);
    out.push(bytesBlock(table.c));
  });
  origin += GAIN_STEPS.length * 256;

  out.push("");
  out.push("; Address tables for every bank entry.");
  out.push(`        .org $${origin.toString(16).toUpperCase().padStart(4, "0")}`);
  for (const [name, spec] of Object.entries(BANKS)) {
    out.push(`; ${name}: ${banks[name].frequencies.map(f => f.toFixed(0)).join(" ")} Hz`);
    out.push(emitPointerTable(name, banks[name].origin, spec.count));
  }
  out.push(emitGainPointers("gaina", gainAOrigin, GAIN_STEPS.length));
  out.push(emitGainPointers("gainc", gainCOrigin, GAIN_STEPS.length));

  out.push("");
  out.push(emitRecords(0x3d00, {
    f1: banks.f1.frequencies,
    f2: banks.f2.frequencies,
    f3: banks.f3.frequencies,
  }));

  // Three-channel tables, used whenever the record does not need the AY noise
  // generator. Placed above the code, which ends well below $6000.
  const window3 = chooseWindow3();
  const tables3 = GAIN_STEPS.map(relative => gainTables3(window3, relative));
  let triple = 0x6000;
  const tripleOrigins = {};
  out.push("");
  out.push("; ---------------------------------------------------------------------");
  out.push("; Three-channel DAC tables: channel A + channel B + channel C of one AY.");
  out.push(`; DAC window: bias ${window3.bias.toFixed(3)}, +-${window3.scale.toFixed(3)} of one channel's full scale;`);
  out.push(`; modelled signal-to-quantisation-noise ratio ${window3.snr.toFixed(1)} dB`);
  out.push(`; (the two-channel window manages ${window.snr.toFixed(1)} dB).`);
  out.push("; ---------------------------------------------------------------------");
  for (const channel of ["a", "b", "c"]) {
    tripleOrigins[channel] = triple;
    out.push(`        .org $${triple.toString(16).toUpperCase().padStart(4, "0")}`);
    out.push(`gain${channel}3_bank:`);
    tables3.forEach((table, index) => {
      out.push(`; gain ${index}: relative amplitude ${GAIN_STEPS[index].toFixed(2)}`);
      out.push(bytesBlock(table[channel]));
    });
    triple += GAIN_STEPS.length * 256;
  }

  // In noise mode channel B carries the hardware noise, so its "table" is a
  // page of the constant amplitude the record asked for.
  const noiseOrigin = triple;
  out.push("");
  out.push("; Constant pages, one per AY noise amplitude, so that the sample loop can");
  out.push("; write register 9 from a table in both modes without branching.");
  out.push(`        .org $${noiseOrigin.toString(16).toUpperCase().padStart(4, "0")}`);
  out.push("nconst_bank:");
  for (let level = 0; level < 16; level++) {
    out.push(`; noise amplitude ${level}`);
    out.push(bytesBlock(new Array(256).fill(level)));
  }
  triple += 16 * 256;

  out.push("");
  out.push(`        .org $${triple.toString(16).toUpperCase().padStart(4, "0")}`);
  for (const channel of ["a", "b", "c"])
    out.push(emitGainPointers(`gain${channel}3`, tripleOrigins[channel], GAIN_STEPS.length));
  out.push(emitGainPointers("nconst", noiseOrigin, 16));

  // The quiet ("bias") pair is what the DAC holds when nothing is voiced.
  const quiet = nearestPair(window.bias);
  const quiet3 = nearestTriple(window3.bias);
  out.push("");
  out.push(`AY_BIAS_A = ${quiet.a}`);
  out.push(`AY_BIAS_C = ${quiet.c}`);
  out.push(`AY_BIAS_A3 = ${quiet3.a}`);
  out.push(`AY_BIAS_B3 = ${quiet3.b}`);
  out.push(`AY_BIAS_C3 = ${quiet3.c}`);

  return { text: out.join("\n"), window, window3, banks, gainAOrigin, gainCOrigin, quiet };
}

const BEGIN = "; ---8<--- GENERATED TABLES BEGIN";
const END = "; ---8<--- GENERATED TABLES END";

function main() {
  const target = path.join(HERE, "tts.s");
  const source = fs.readFileSync(target, "utf8");
  const begin = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (begin < 0 || end < 0 || end < begin)
    throw new Error(`tts.s is missing the ${BEGIN} / ${END} markers`);
  const { text, window, quiet } = generate();
  const updated = `${source.slice(0, begin + BEGIN.length)}\n${text}\n${source.slice(end)}`;
  fs.writeFileSync(target, updated);
  console.log(`tts.s generated block updated: ${text.split("\n").length} lines`);
  console.log(`DAC window bias=${window.bias.toFixed(3)} scale=${window.scale.toFixed(3)} ` +
    `snr=${window.snr.toFixed(1)} dB, quiet pair A=${quiet.a} C=${quiet.c}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
