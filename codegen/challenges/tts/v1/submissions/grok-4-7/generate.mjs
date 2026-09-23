// Original Wirethroat phoneme parameters. Not a port of another voice table.
// AY tone period = round(1_573_437.5 / (16 * Hz)).
// Envelope period for pitch is computed in tts.s (statement 50, question 40).
// Run: node codegen/challenges/tts/v1/submissions/grok-4-7/generate.mjs

const CLOCK = 1_573_437.5;

export function tonePeriod(hz) {
  return Math.round(CLOCK / (16 * hz));
}

function rec(frames, aHz, bHz, volA, volB, mode, noise) {
  const a = aHz ? tonePeriod(aHz) : 0;
  const b = bHz ? tonePeriod(bHz) : 0;
  return {
    frames, a, b, volA, volB, packed: (mode << 5) | (noise & 31),
    bytes: [frames, a & 255, a >> 8, b & 255, b >> 8, volA, volB, (mode << 5) | (noise & 31)],
  };
}

const V = 1, F = 2, B = 3, N = 4, VF = 5;
const ENV = 16;

// Order matches phoneme codes 5..43 in tts.s.
export function phonemeRecords() {
  return [
    rec(11, 1650, 700, ENV, ENV, V, 0),   // AE
    rec(11, 1700, 530, ENV, ENV, V, 0),   // EH
    rec(11, 1900, 400, ENV, ENV, V, 0),   // IH
    rec(11, 1100, 720, ENV, ENV, V, 0),   // AA
    rec(11, 1200, 620, ENV, ENV, V, 0),   // AH
    rec(11, 850, 500, ENV, ENV, V, 0),    // AO
    rec(11, 1100, 450, ENV, ENV, V, 0),   // UH
    rec(11, 1350, 480, ENV, ENV, V, 0),   // ER
    rec(12, 2000, 450, ENV, ENV, V, 0),   // EY
    rec(12, 2300, 280, ENV, ENV, V, 0),   // IY
    rec(12, 1500, 650, ENV, ENV, V, 0),   // AY
    rec(12, 850, 450, ENV, ENV, V, 0),    // OW
    rec(12, 850, 320, ENV, ENV, V, 0),    // UW
    rec(12, 1000, 650, ENV, ENV, V, 0),   // AW
    rec(12, 1400, 500, ENV, ENV, V, 0),   // OY
    rec(3, 0, 0, 12, 0, B, 18),           // P
    rec(3, 0, 0, 12, 0, B, 16),           // B
    rec(3, 0, 0, 12, 0, B, 2),            // T
    rec(3, 0, 0, 12, 0, B, 3),            // D
    rec(3, 0, 0, 12, 0, B, 8),            // K
    rec(3, 0, 0, 12, 0, B, 7),            // G
    rec(7, 1400, 0, 13, 0, F, 14),        // F
    rec(6, 1200, 200, 9, ENV, VF, 12),    // V
    rec(7, 1800, 0, 12, 0, F, 10),        // TH
    rec(8, 1300, 200, 11, ENV, VF, 12),   // DH
    rec(7, 6500, 0, 13, 0, F, 2),         // S
    rec(7, 5000, 200, 11, ENV, VF, 3),    // Z
    rec(7, 2500, 0, 13, 0, F, 8),         // SH
    rec(7, 2200, 200, 11, ENV, VF, 10),   // ZH
    rec(5, 0, 0, 11, 0, F, 5),            // HH
    rec(8, 0, 280, 0, ENV, N, 0),         // M
    rec(8, 0, 300, 0, ENV, N, 0),         // N
    rec(8, 0, 320, 0, ENV, N, 0),         // NG
    rec(7, 1200, 350, ENV, ENV, V, 0),    // L
    rec(7, 1100, 420, ENV, ENV, V, 0),    // R
    rec(5, 700, 350, ENV, ENV, V, 0),     // W
    rec(5, 2100, 300, ENV, ENV, V, 0),    // Y
    rec(6, 2500, 0, 13, 0, F, 6),         // CH
    rec(7, 2200, 200, 12, ENV, VF, 7),    // JH
  ];
}

if (process.argv[1] && process.argv[1].endsWith("generate.mjs")) {
  const names = ["AE","EH","IH","AA","AH","AO","UH","ER","EY","IY","AY","OW","UW","AW","OY","P","B","T","D","K","G","F","V","TH","DH","S","Z","SH","ZH","HH","M","N","NG","L","R","W","Y","CH","JH"];
  phonemeRecords().forEach((r, i) => {
    console.log(`; ${names[i]} ${r.bytes.join(",")}`);
  });
}
