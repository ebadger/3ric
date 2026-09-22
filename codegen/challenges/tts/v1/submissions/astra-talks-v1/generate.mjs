// SPDX-License-Identifier: MIT
// Original text-independent voice/rule generator by GPT-6 Astra.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "../../../../../tools/asm6502.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const sampleRate = 1_573_437.5 / 200;
const fundamental = sampleRate / 64;
// Hardware amplitude calibration, not speech data. See NOTICE.txt.
const levels = [0, .00999465934234, .0144502937362, .0210574502174,
  .0307011520562, .0455481803616, .0644998855573, .107362478065,
  .126588845655, .20498970016, .292210269322, .372838941024,
  .492530708782, .635324635691, .805584802014, 1];
const pairs = [];
for (let a = 0; a < 16; a++)
  for (let b = 0; b <= a; b++) pairs.push({ a, b, level: levels[a] + levels[b] });
function quantize(value) {
  return pairs.reduce((best, pair) =>
    Math.abs(pair.level - value) < Math.abs(best.level - value) ? pair : best);
}

// [name, three resonances (Hz), kind, block repetitions, relative gain].
// These are hand-chosen articulatory approximations, not imported voice tables.
export const phones = [
  ["GAP", [], "silence", 2, 0], ["COMMA", [], "silence", 5, 0],
  ["PERIOD", [], "silence", 8, 0], ["CLOSE", [], "silence", 1, 0],
  ["AA", [760, 1180, 2500], "voice", 4, 1],
  ["AE", [710, 1780, 2550], "voice", 4, 1],
  ["EH", [540, 1900, 2650], "voice", 4, 1],
  ["IH", [390, 2020, 2750], "voice", 3, .9],
  ["IY", [290, 2340, 3000], "voice", 4, .9],
  ["AO", [560, 890, 2460], "voice", 4, 1],
  ["UH", [430, 1060, 2320], "voice", 3, .9],
  ["UW", [310, 740, 2200], "voice", 4, .9],
  ["AH", [650, 1240, 2600], "voice", 3, 1],
  ["ER", [440, 1320, 1680], "voice", 4, .9],
  ["AX", [480, 1460, 2520], "voice", 2, .7],
  ["L", [360, 1030, 2730], "voice", 2, .75],
  ["R", [380, 1120, 1550], "voice", 2, .8],
  ["W", [280, 620, 2210], "voice", 2, .7],
  ["Y", [250, 2180, 2900], "voice", 2, .65],
  ["M", [240, 980, 2100], "nasal", 3, .65],
  ["N", [280, 1420, 2480], "nasal", 3, .65],
  ["NG", [320, 1760, 2350], "nasal", 3, .65],
  ["B", [400, 900, 2200], "voiced-stop", 1, .8],
  ["D", [450, 1800, 3100], "voiced-stop", 1, .8],
  ["G", [450, 1550, 2450], "voiced-stop", 1, .8],
  ["P", [700, 1400, 2800], "stop", 1, .8],
  ["T", [1300, 2700, 3550], "stop", 1, 1],
  ["K", [800, 1700, 2750], "stop", 1, 1],
  ["F", [900, 2100, 3400], "noise", 1, .6],
  ["V", [650, 1800, 2900], "mixed", 1, .6],
  ["TH", [1000, 1900, 3150], "noise", 1, .55],
  ["DH", [550, 1500, 2750], "mixed", 1, .55],
  ["S", [1900, 3100, 3700], "noise", 2, .9],
  ["Z", [1500, 2700, 3500], "mixed", 1, .8],
  ["SH", [1000, 2100, 2900], "noise", 2, .85],
  ["ZH", [900, 1850, 2700], "mixed", 1, .7],
  ["HH", [650, 1450, 2500], "noise", 1, .5],
];
const ids = Object.fromEntries(phones.map(([name], i) => [name, i]));
const expand = text => text.trim() ? text.split(/\s+/).flatMap(name => {
  const aliases = {
    EY: ["EH:2", "IY:2"], AY: ["AA:2", "IH:2"], OW: ["AO:2", "UW:2"],
    AW: ["AE:2", "UW:2"], OY: ["AO:2", "IH:2"], CH: ["CLOSE", "T", "SH"],
    J: ["CLOSE", "D", "ZH"],
    PB: ["CLOSE", "B"], PD: ["CLOSE", "D"], PG: ["CLOSE", "G"],
    PP: ["CLOSE", "P"], PT: ["CLOSE", "T"], PK: ["CLOSE", "K"],
  };
  return (aliases[name] || [name]).map(p => {
    const [key, duration] = p.split(":");
    if (!(key in ids)) throw new Error(`Unknown phoneme ${p}`);
    return ids[key] | (duration === "2" ? 128 : 0);
  });
}) : [];

// Exceptions are common function/irregular words, never canned utterances.
export const exceptions = {
  A: "AX", I: "AY", THE: "DH AX", THIS: "DH IH S", THAT: "DH AE PT",
  THESE: "DH IY Z", THOSE: "DH OW Z", THEY: "DH EY", THEIR: "DH EH R",
  THERE: "DH EH R", OF: "AH V", TO: "PT UW", DO: "PD UW",
  YOU: "Y UW", YOUR: "Y AO R", ONE: "W AH N", TWO: "PT UW",
  WAS: "W AH Z", WERE: "W ER", ARE: "AA R", HAVE: "HH AE V",
  SAID: "S EH PD", SAYS: "S EH Z", SOME: "S AH M", COME: "PK AH M",
  DONE: "PD AH N", DOES: "PD AH Z", WHAT: "W AH PT", WHO: "HH UW",
  WOULD: "W UH PD", COULD: "PK UH PD", SHOULD: "SH UH PD",
  THROUGH: "TH R UW", THOUGH: "DH OW", ENOUGH: "IH N AH F",
  NOW: "N AW", HOW: "HH AW", COW: "PK AW",
};
// Flags: 1 word start, 2 word end, 4 following E/I/Y, 8 following vowel,
// 16 vowel-consonant-E at word end, 32 preceding vowel,
// 64 earlier vowel in word, 128 open syllable (following consonant + vowel).
const rules = [];
const rule = (pattern, output, flags = 0) => rules.push({ pattern, output, flags });
for (const [word, output] of Object.entries(exceptions)) rule(word, output, 3);
for (const [pattern, output] of [
  ["TIOUS", "SH AX S"], ["CIOUS", "SH AX S"], ["TION", "SH AX N"],
  ["SION", "ZH AX N"], ["TURE", "CH ER"], ["SURE", "ZH ER"],
  ["IGHT", "AY PT"], ["OULD", "UH L PD"], ["ING", "IH NG"],
  ["TED", "PT IH PD"], ["DED", "PD IH PD"], ["SES", "S IH Z"],
  ["ZES", "Z IH Z"], ["ED", "PD"], ["LY", "L IY"],
  ["OUS", "AX S"], ["LE", "AX L"],
]) rule(pattern, output, 2 | (["LE", "ED", "TED", "DED"].includes(pattern) ? 64 : 0));
for (const [pattern, output, flags = 0] of [
  ["TCH", "CH"], ["DGE", "J"], ["SCH", "S PK"], ["CH", "CH"],
  ["SH", "SH"], ["TH", "TH"], ["PH", "F"], ["WH", "W"], ["QU", "PK W"],
  ["CK", "PK"], ["NG", "NG"], ["NK", "NG PK"], ["WR", "R", 1],
  ["KN", "N", 1], ["GN", "N", 1], ["MB", "M", 2],
  ["EE", "IY"], ["EA", "IY"], ["OO", "UW"], ["AI", "EY"], ["AY", "EY"],
  ["OA", "OW"], ["OE", "OW"], ["OI", "OY"], ["OY", "OY"],
  ["AU", "AO"], ["AW", "AO"], ["OU", "AW"], ["OW", "OW", 2], ["OW", "AW"],
  ["EW", "Y UW"], ["UE", "UW", 2], ["IE", "AY", 2], ["IE", "IY"], ["EI", "EY"],
  ["IGH", "AY"], ["GH", "", 2 | 64], ["WOR", "W ER"],
  ["AIR", "EH R"], ["AR", "AA R"], ["OR", "AO R"],
  ["ER", "ER"], ["IR", "ER"], ["UR", "ER"],
  ["ALK", "AO PK"], ["ALL", "AO L"], ["OLD", "OW L PD"],
]) rule(pattern, output, flags);
rule("C", "S", 4); rule("G", "J", 4);
rule("A", "EY", 16); rule("E", "IY", 16); rule("I", "AY", 16);
rule("O", "OW", 16); rule("U", "Y UW", 16);
rule("A", "EY", 128); rule("E", "IY", 128); rule("I", "AY", 128);
rule("O", "OW", 128); rule("U", "Y UW", 128);
rule("E", "", 2 | 64);
rule("E", "IY", 2);
rule("O", "OW", 2);
rule("Y", "Y", 1); rule("Y", "IY", 2 | 64); rule("Y", "AY", 2); rule("Y", "IH");
rule("S", "Z", 2 | 32);
rule("'", "");
const fallback = {
  A: "AE", B: "PB", C: "PK", D: "PD", E: "EH", F: "F", G: "PG", H: "HH",
  I: "IH", J: "J", K: "PK", L: "L", M: "M", N: "N", O: "AA", P: "PP",
  Q: "PK", R: "R", S: "S", T: "PT", U: "AH", V: "V", W: "W", X: "PK S",
  Y: "IH", Z: "Z",
};
for (const [letter, output] of Object.entries(fallback)) {
  if (!"AEIOUY".includes(letter)) rule(letter + letter, output);
  rule(letter, output);
}
rules.sort((a, b) => b.pattern.length - a.pattern.length);

function voiced(formants, nasal, n) {
  let value = 0;
  for (let k = 1; k * fundamental < sampleRate * .47; k++) {
    const f = k * fundamental;
    let weight = .08 / (k * k);
    formants.forEach((center, i) => {
      const bandwidth = [100, 150, 220][i];
      const gain = nasal ? [1, .15, .07][i] : [1, .65, .3][i];
      weight += gain / (1 + ((f - center) / bandwidth) ** 2) / Math.sqrt(k);
    });
    value += weight * Math.sin(2 * Math.PI * k * n / 64);
  }
  return value;
}

function waveform(phone, index) {
  const [, formants, kind, , gain] = phone;
  const size = ["noise", "mixed"].includes(kind) ? 512 : 256;
  if (kind === "silence") return new Array(size).fill(.8);
  let seed = (0x7321abcd ^ (index * 7919)) >>> 0;
  const noise = Array.from({ length: size }, () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 0x80000000 - 1;
  });
  // Circular FIR bandpasses make noise tiles periodic without a seam impulse.
  const filtered = noise.map((_, n) => {
    let sum = 0;
    for (let tap = -12; tap <= 12; tap++) {
      const window = .5 + .5 * Math.cos(Math.PI * tap / 13);
      const kernel = formants.reduce((s, f, i) =>
        s + [0.3, .65, 1][i] * Math.cos(2 * Math.PI * f * tap / sampleRate), 0);
      sum += noise[(n + tap + size) % size] * window * kernel;
    }
    return sum;
  });
  const noisePeak = Math.max(...filtered.map(Math.abs));
  const tonal = Array.from({ length: size }, (_, n) => voiced(formants, kind === "nasal", n));
  const voicePeak = Math.max(...tonal.map(Math.abs));
  return tonal.map((v, n) => {
    const voice = v / voicePeak;
    const hiss = filtered[n] / noisePeak;
    let signal = voice;
    if (kind === "noise") signal = hiss;
    if (kind === "mixed") signal = .5 * voice + .5 * hiss;
    if (kind === "stop" || kind === "voiced-stop")
      signal = hiss * Math.exp(-n / 52) + (kind === "voiced-stop" ? .4 * voice : 0);
    return .8 + .65 * gain * signal;
  });
}

const byteLines = values => Array.from({ length: Math.ceil(values.length / 16) }, (_, row) =>
  "        .byte " + values.slice(row * 16, row * 16 + 16).join(",")).join("\n");
let tables = "\n; Generated original rule and phoneme data. Regenerate with generate.mjs.\n";
for (const [name, id] of Object.entries(ids)) tables += `PH_${name} = ${id}\n`;
tables += "rule_table:\n";
for (const { pattern, output, flags } of rules) {
  const phonemes = expand(output);
  const record = [4 + pattern.length + phonemes.length, pattern.length, flags, phonemes.length,
    ...Buffer.from(pattern), ...phonemes];
  tables += `; ${pattern} -> ${output || "(silent)"}; context ${flags}\n${byteLines(record)}\n`;
}
tables += "        .byte 0\nrule_table_end:\n";
tables += "wave_low_pages:\n" + byteLines(phones.map(([name]) => `>wave_${name}_a`)) + "\n";
tables += "wave_high_pages:\n" + byteLines(phones.map(([name]) => `>wave_${name}_b`)) + "\n";
tables += "wave_pages:\n" + byteLines(phones.map(p => waveform(p, 1).length / 256)) + "\n";
tables += "wave_repeats:\n" + byteLines(phones.map(p => p[3])) + "\n";
tables += "tables_end:\n        .org $3000\n";
tables += "wave_GAP_a:\nwave_COMMA_a:\nwave_PERIOD_a:\nwave_CLOSE_a:\n";
tables += byteLines(new Array(256).fill(quantize(.8).a)) + "\n";
tables += "wave_GAP_b:\nwave_COMMA_b:\nwave_PERIOD_b:\nwave_CLOSE_b:\n";
tables += byteLines(new Array(256).fill(quantize(.8).b)) + "\n";
for (let i = 4; i < phones.length; i++) {
  const [name] = phones[i];
  const samples = waveform(phones[i], i).map(quantize);
  tables += `wave_${name}_a:\n${byteLines(samples.map(p => p.a))}\n`;
  tables += `wave_${name}_b:\n${byteLines(samples.map(p => p.b))}\n`;
}
tables += "program_end:\n";
const source = fs.readFileSync(path.join(here, "engine.inc"), "utf8") + tables;
const result = assemble(source);
if (result.symbols.TABLES_END > 0x3000 || result.symbols.PROGRAM_END > 0x9000)
  throw new Error("Entry exceeds always-mapped image layout");
const target = path.join(here, "tts.s");
if (process.argv.includes("--check")) {
  if (fs.readFileSync(target, "utf8") !== source) throw new Error("tts.s is stale");
} else fs.writeFileSync(target, source);
console.log(`${rules.length} rules, ${phones.length} phones, ${result.bytes.length} image bytes; ` +
  `end $${result.symbols.PROGRAM_END.toString(16)}, DAC ${sampleRate} Hz`);
