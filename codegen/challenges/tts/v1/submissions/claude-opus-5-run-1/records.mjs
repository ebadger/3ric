// =====================================================================
// records.mjs -- the phoneme inventory of this entry.
//
// Every record is one synthesis segment: three formant-bank positions,
// a voiced-source gain, the AY noise-generator period and amplitude, a
// duration in control frames, flags and an optional link to the segment
// that must follow it (used for diphthong glides, stop bursts and
// affricates).
//
// The formant positions are given here in Hz and converted to bank
// positions by generate.mjs, so the tables stay correct if the banks
// are ever retuned.  Nothing here is copied from any existing speech
// system: the values were chosen from the general acoustic description
// of English vowels and consonants and then adjusted by ear-free
// spectral measurement of this engine's own output.
// =====================================================================

// flags
export const F_JUMP = 1;      // move to the targets instantly, no glide
export const F_PAUSE = 2;     // reset the pitch contour

// [name, f1Hz, f2Hz, f3Hz, gain(0-7), noisePeriod, noiseAmp, frames, flags, link]
export const RECORDS = [
  ["nul",   500, 1400, 2500, 0,  0,  0,  2, 0, null],
  ["E",     290, 2270, 2700, 7,  0,  0, 17, 0, null],
  ["i",     395, 1865, 2500, 7,  0,  0,  11, 0, null],
  ["A",     463, 1865, 2500, 7,  0,  0,  10, 0, "A2"],
  ["A2",    338, 2160, 2500, 6,  0,  0,  8, 0, null],
  ["e",     542, 1776, 2500, 7,  0,  0,  14, 0, null],
  ["@",     686, 1691, 2500, 7,  0,  0, 16, 0, null],
  ["a",     742, 1144, 2500, 7,  0,  0, 16, 0, null],
  ["c",     586,  896, 2500, 7,  0,  0, 16, 0, null],
  ["O",     501,  896, 2500, 7,  0,  0,  10, 0, "O2"],
  ["O2",    365,  813, 2325, 6,  0,  0,  8, 0, null],
  ["U",     312,  896, 2325, 7,  0,  0, 16, 0, null],
  ["u",     463, 1038, 2325, 7,  0,  0,  11, 0, null],
  ["^",     634, 1202, 2500, 7,  0,  0,  13, 0, null],
  ["x",     501, 1391, 2500, 5,  0,  0,  6, 0, null],
  ["R",     463, 1325, 1724, 7,  0,  0, 16, 0, null],
  ["I",     686, 1202, 2500, 7,  0,  0,  11, 0, "I2"],
  ["I2",    395, 1958, 2500, 6,  0,  0,  9, 0, null],
  ["W",     686, 1202, 2500, 7,  0,  0,  11, 0, "W2"],
  ["W2",    338,  896, 2325, 6,  0,  0,  9, 0, null],
  ["Y",     586,  896, 2500, 7,  0,  0,  11, 0, "I2"],
  ["w",     312,  702, 2158, 5,  0,  0,  4, 0, null],
  ["y",     290, 2160, 2700, 5,  0,  0,  3, 0, null],
  ["l",     395,  988, 2700, 6,  0,  0,  5, 0, null],
  ["r",     428, 1090, 1600, 6,  0,  0,  5, 0, null],
  ["m",     290,  988, 2158, 4,  0,  0,  5, 0, null],
  ["n",     290, 1611, 2500, 4,  0,  0,  5, 0, null],
  ["G",     290, 1958, 2700, 4,  0,  0,  6, 0, null],
  ["h",     501, 1391, 2500, 0, 12,  7,  4, 0, null],
  ["f",     247,  813, 2325, 0,  4,  9,  6, 0, null],
  ["v",     290,  988, 2325, 3,  4,  5,  5, 0, null],
  ["T",     247, 1691, 2500, 0,  3,  8,  6, 0, null],
  ["D",     290, 1391, 2500, 3,  3,  4,  4, 0, null],
  ["s",     247, 1691, 2500, 0,  1, 12,  7, 0, null],
  ["z",     290, 1534, 2500, 3,  1,  8,  6, 0, null],
  ["S",     247, 1691, 2325, 0,  6, 13,  7, 0, null],
  ["Z",     290, 1691, 2325, 3,  6,  9,  6, 0, null],
  ["pC",    247,  813, 2325, 0,  0,  0,  4, 0, "pB"],
  ["pB",    247,  813, 2325, 0,  8, 11,  1, 0, null],
  ["bC",    247,  813, 2325, 2,  0,  0,  3, 0, "bB"],
  ["bB",    247,  813, 2325, 0,  8,  7,  1, 0, null],
  ["tC",    247, 1691, 2500, 0,  0,  0,  4, 0, "tB"],
  ["tB",    247, 1691, 2500, 0,  3, 12,  1, 0, null],
  ["dC",    247, 1691, 2500, 2,  0,  0,  3, 0, "dB"],
  ["dB",    247, 1691, 2500, 0,  3,  8,  1, 0, null],
  ["kC",    247, 1865, 2500, 0,  0,  0,  4, 0, "kB"],
  ["kB",    247, 1865, 2500, 0,  5, 12,  2, 0, null],
  ["gC",    247, 1865, 2500, 2,  0,  0,  3, 0, "gB"],
  ["gB",    247, 1865, 2500, 0,  5,  8,  2, 0, null],
  ["CC",    247, 1691, 2500, 0,  0,  0,  4, 0, "CB"],
  ["CB",    247, 1691, 2500, 0,  3, 11,  1, 0, "CF"],
  ["CF",    247, 1691, 2325, 0,  6, 13,  5, 0, null],
  ["JC",    247, 1691, 2500, 2,  0,  0,  3, 0, "JB"],
  ["JB",    247, 1691, 2500, 0,  3,  8,  1, 0, "JF"],
  ["JF",    290, 1691, 2325, 3,  6,  9,  5, 0, null],
  ["sp",    500, 1400, 2500, 0,  0,  0,  2, 0, null],
  ["cm",    500, 1400, 2500, 0,  0,  0,  7, F_PAUSE, null],
  ["pd",    500, 1400, 2500, 0,  0,  0, 12, F_PAUSE, null],
];

// phoneme code (ASCII) -> record name
export const PHONEMES = {
  E: "E", i: "i", A: "A", e: "e", "@": "@", a: "a", c: "c", O: "O",
  U: "U", u: "u", "^": "^", x: "x", R: "R", I: "I", W: "W", Y: "Y",
  w: "w", y: "y", l: "l", r: "r", m: "m", n: "n", G: "G", h: "h",
  f: "f", v: "v", T: "T", D: "D", s: "s", z: "z", S: "S", Z: "Z",
  p: "pC", b: "bC", t: "tC", d: "dC", k: "kC", g: "gC",
  C: "CC", J: "JC",
  " ": "sp", ",": "cm", ".": "pd",
};

function indexOfName(name) {
  const index = RECORDS.findIndex(record => record[0] === name);
  if (index < 0) throw new Error(`unknown record ${name}`);
  return index;
}

function bytes(values) {
  const lines = [];
  for (let i = 0; i < values.length; i += 16) {
    lines.push("        .byte " + values.slice(i, i + 16).join(","));
  }
  return lines.join("\n");
}

// nearest bank position for a frequency, returned on the smoothed
// 0..255 scale the engine interpolates on (bank index * 8).
function position(frequencies, hz) {
  let best = 0;
  let bestError = Infinity;
  frequencies.forEach((frequency, index) => {
    const error = Math.abs(Math.log(frequency / hz));
    if (error < bestError) {
      bestError = error;
      best = index;
    }
  });
  return best * 8;
}

export function emitRecords(origin, bankFrequencies) {
  const out = [];
  out.push("; Phoneme records -- generated from records.mjs.");
  out.push(`        .org $${origin.toString(16).toUpperCase().padStart(4, "0")}`);
  out.push("; " + RECORDS.map((record, index) => `${index}:${record[0]}`).join(" "));
  const column = index => RECORDS.map(record => record[index]);
  out.push("rec_f1:");
  out.push(bytes(RECORDS.map(record => position(bankFrequencies.f1, record[1]))));
  out.push("rec_f2:");
  out.push(bytes(RECORDS.map(record => position(bankFrequencies.f2, record[2]))));
  out.push("rec_f3:");
  out.push(bytes(RECORDS.map(record => position(bankFrequencies.f3, record[3]))));
  out.push("rec_av:");
  out.push(bytes(RECORDS.map(record => record[4] * 8)));
  out.push("rec_np:");
  out.push(bytes(column(5)));
  out.push("rec_an:");
  out.push(bytes(column(6)));
  out.push("rec_dur:");
  out.push(bytes(column(7)));
  out.push("rec_flag:");
  out.push(bytes(column(8)));
  out.push("rec_link:");
  out.push(bytes(RECORDS.map(record => (record[9] ? indexOfName(record[9]) : 0))));

  const map = [];
  for (const [code, name] of Object.entries(PHONEMES)) {
    map.push(code.charCodeAt(0), indexOfName(name));
  }
  map.push(0, 0);
  out.push("; phoneme code -> record index, terminated by a zero code.");
  out.push("pho_map:");
  out.push(bytes(map));
  return out.join("\n");
}
