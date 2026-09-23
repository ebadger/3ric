// Offline reproduction of the sample loop, using the tables actually
// assembled into the image, so that synthesis errors can be told apart
// from runtime timing errors.
import fs from "node:fs";
import { assemble } from "../../../../../tools/asm6502.mjs";
import { AY_LEVELS, FS } from "./generate.mjs";

const image = assemble(fs.readFileSync("tts.s", "utf8"), { org: 0x0800 });
const S = image.symbols;
const read = addr => image.bytes[addr - image.org];
const signed = v => (v > 127 ? v - 256 : v);

function irAt(loSym, hiSym, index) {
  const p = read(S[loSym] + index) | (read(S[hiSym] + index) << 8);
  return Array.from({ length: 128 }, (_, i) => signed(read(p + i)));
}

function gainTable(loSym, hiSym, step) {
  const p = read(S[loSym] + step) | (read(S[hiSym] + step) << 8);
  return Array.from({ length: 256 }, (_, i) => read(p + i));
}

const [i1, i2, i3, gain, period, N] = [
  Number(process.argv[2] ?? 13),
  Number(process.argv[3] ?? 27),
  Number(process.argv[4] ?? 7),
  Number(process.argv[5] ?? 7),
  Number(process.argv[6] ?? 54),
  8192,
];

const f1 = irAt("F1_LO", "F1_HI", i1);
const f2 = irAt("F2_LO", "F2_HI", i2);
const f3 = irAt("F3_LO", "F3_HI", i3);
const ga = gainTable("GAINA3_LO", "GAINA3_HI", gain);
const gb = gainTable("GAINB3_LO", "GAINB3_HI", gain);
const gc = gainTable("GAINC3_LO", "GAINC3_HI", gain);

const raw = new Float64Array(N);
const out = new Float64Array(N);
for (let n = 0; n < N; n++) {
  const p = n % period;
  const sum = (f1[p] + f2[p] + f3[p]) & 255;
  raw[n] = (sum > 127 ? sum - 256 : sum) / 128;
  out[n] = AY_LEVELS[ga[sum] & 15] + AY_LEVELS[gb[sum] & 15] + AY_LEVELS[gc[sum] & 15];
}

function spectrum(signal) {
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const rows = [];
  for (let hz = FS/period; hz <= 2900; hz += FS/period) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * hz) / FS;
    for (let i = 0; i < N; i++) {
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      re += (signal[i] - mean) * win * Math.cos(w * i);
      im += (signal[i] - mean) * win * Math.sin(w * i);
    }
    rows.push([hz, Math.hypot(re, im) / N]);
  }
  return rows;
}

const a = spectrum(raw);
const b = spectrum(out);
const ma = Math.max(...a.map(r => r[1]));
const mb = Math.max(...b.map(r => r[1]));
console.log(`F0 ${(FS / period).toFixed(1)} Hz   ideal | through DAC`);
for (let i = 0; i < a.length; i++) {
  
  const da = 20 * Math.log10(a[i][1] / ma);
  const db = 20 * Math.log10(b[i][1] / mb);
  console.log(String(a[i][0]).padStart(4),
    "#".repeat(Math.max(0, Math.round(40 + da / 1.5))).padEnd(41),
    "#".repeat(Math.max(0, Math.round(40 + db / 1.5))));
}

