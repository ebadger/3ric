// Generator and phonetic rule test harness for 3RIC Talks v1: gemini-38flash-v1
// Computes dual-AY Mockingboard acoustic parameters and tests G2P rules.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLOCK_HZ = 1573437.5;

// Period calculation: frequency = CLOCK_HZ / (16 * period)
// period = round(CLOCK_HZ / (16 * frequency)) = round(98339.84 / frequency)
function calcPeriod(freq) {
  if (!freq || freq <= 0) return 0;
  return Math.round(98339.84 / freq);
}

// Envelope frequency: CLOCK_HZ / (256 * envPeriod) = 6146.24 / envPeriod
// For F0 = 125 Hz: envPeriod = round(6146.24 / 125) = 49 ($31)
const F0_DEFAULT = 125;
const ENV_PERIOD_DEFAULT = Math.round(6146.24 / F0_DEFAULT); // 49

// Phoneme definitions
// Mode flags:
// Bit 0: Tone A/B enabled (formants)
// Bit 1: Tone C enabled (voice bar / F0)
// Bit 2: Noise enabled
// Bit 3: Envelope on Tone A/B (glottal pulse)
// Bit 4: Diphthong glide
// Bit 5: Plosive pre-closure silence
export const PHONEMES = {
  // Pauses
  PAUSE_WORD:     { id: 0,  name: "PAUSE_WORD", dur: 5,  mode: 0, f1: 0, f2: 0, noise: 0, vol: 0 },
  PAUSE_CLAUSE:   { id: 1,  name: "PAUSE_CLAUSE", dur: 12, mode: 0, f1: 0, f2: 0, noise: 0, vol: 0 },
  PAUSE_SENTENCE: { id: 2,  name: "PAUSE_SENTENCE", dur: 22, mode: 0, f1: 0, f2: 0, noise: 0, vol: 0 },

  // Vowels (Voiced: Tone A=F1, Tone B=F2, Tone C=F0, Envelope=1)
  // Mode: 1 (Tone A/B) | 2 (Tone C) | 8 (Env) = 11 ($0B)
  IY: { id: 3,  name: "IY", dur: 9,  mode: 0x0B, f1: 270, f2: 2300, noise: 0, vol: 0x10 },
  IH: { id: 4,  name: "IH", dur: 8,  mode: 0x0B, f1: 390, f2: 1900, noise: 0, vol: 0x10 },
  EY: { id: 5,  name: "EY", dur: 12, mode: 0x1B, f1: 500, f2: 1800, f1b: 320, f2b: 2200, noise: 0, vol: 0x10 }, // glide
  EH: { id: 6,  name: "EH", dur: 8,  mode: 0x0B, f1: 530, f2: 1750, noise: 0, vol: 0x10 },
  AE: { id: 7,  name: "AE", dur: 9,  mode: 0x0B, f1: 660, f2: 1600, noise: 0, vol: 0x10 },
  AA: { id: 8,  name: "AA", dur: 10, mode: 0x0B, f1: 730, f2: 1100, noise: 0, vol: 0x10 },
  AO: { id: 9,  name: "AO", dur: 10, mode: 0x0B, f1: 570, f2: 840,  noise: 0, vol: 0x10 },
  OW: { id: 10, name: "OW", dur: 12, mode: 0x1B, f1: 500, f2: 900,  f1b: 380, f2b: 800,  noise: 0, vol: 0x10 }, // glide
  UH: { id: 11, name: "UH", dur: 8,  mode: 0x0B, f1: 440, f2: 1020, noise: 0, vol: 0x10 },
  UW: { id: 12, name: "UW", dur: 10, mode: 0x0B, f1: 300, f2: 850,  noise: 0, vol: 0x10 },
  AH: { id: 13, name: "AH", dur: 7,  mode: 0x0B, f1: 600, f2: 1200, noise: 0, vol: 0x10 },
  ER: { id: 14, name: "ER", dur: 9,  mode: 0x0B, f1: 450, f2: 1300, noise: 0, vol: 0x10 },
  AY: { id: 15, name: "AY", dur: 13, mode: 0x1B, f1: 700, f2: 1100, f1b: 320, f2b: 2100, noise: 0, vol: 0x10 }, // glide
  AW: { id: 16, name: "AW", dur: 13, mode: 0x1B, f1: 700, f2: 1100, f1b: 350, f2b: 850,  noise: 0, vol: 0x10 }, // glide
  OY: { id: 17, name: "OY", dur: 13, mode: 0x1B, f1: 550, f2: 850,  f1b: 320, f2b: 2100, noise: 0, vol: 0x10 }, // glide

  // Liquids & Glides (Voiced, steady volume $0D)
  L:  { id: 18, name: "L",  dur: 7,  mode: 0x03, f1: 380, f2: 1050, noise: 0, vol: 0x0D },
  R:  { id: 19, name: "R",  dur: 7,  mode: 0x03, f1: 350, f2: 1000, noise: 0, vol: 0x0D },
  W:  { id: 20, name: "W",  dur: 7,  mode: 0x03, f1: 300, f2: 800,  noise: 0, vol: 0x0D },
  Y:  { id: 21, name: "Y",  dur: 7,  mode: 0x03, f1: 280, f2: 2200, noise: 0, vol: 0x0D },

  // Nasals (Voiced, low F1, muted volume $0B)
  M:  { id: 22, name: "M",  dur: 7,  mode: 0x03, f1: 270, f2: 900,  noise: 0, vol: 0x0B },
  N:  { id: 23, name: "N",  dur: 7,  mode: 0x03, f1: 270, f2: 1400, noise: 0, vol: 0x0B },
  NG: { id: 24, name: "NG", dur: 8,  mode: 0x03, f1: 270, f2: 1800, noise: 0, vol: 0x0B },

  // Unvoiced Fricatives (Noise only: mode = 4)
  S:  { id: 25, name: "S",  dur: 8,  mode: 0x04, f1: 0, f2: 0, noise: 1,  vol: 0x0E },
  SH: { id: 26, name: "SH", dur: 8,  mode: 0x04, f1: 0, f2: 0, noise: 5,  vol: 0x0E },
  F:  { id: 27, name: "F",  dur: 7,  mode: 0x04, f1: 0, f2: 0, noise: 13, vol: 0x09 },
  TH: { id: 28, name: "TH", dur: 7,  mode: 0x04, f1: 0, f2: 0, noise: 11, vol: 0x08 },
  HH: { id: 29, name: "HH", dur: 6,  mode: 0x04, f1: 0, f2: 0, noise: 17, vol: 0x08 },

  // Voiced Fricatives (Tone C voice bar + Noise: mode = 2 | 4 = 6)
  Z:  { id: 30, name: "Z",  dur: 8,  mode: 0x06, f1: 0, f2: 0, noise: 1,  vol: 0x0C },
  ZH: { id: 31, name: "ZH", dur: 8,  mode: 0x06, f1: 0, f2: 0, noise: 5,  vol: 0x0C },
  V:  { id: 32, name: "V",  dur: 7,  mode: 0x06, f1: 0, f2: 0, noise: 13, vol: 0x0A },
  DH: { id: 33, name: "DH", dur: 7,  mode: 0x06, f1: 0, f2: 0, noise: 11, vol: 0x0A },

  // Stops / Plosives (Unvoiced: Bit 5 = pre-closure silence, then noise burst)
  P:  { id: 34, name: "P",  dur: 3,  mode: 0x24, f1: 0, f2: 0, noise: 15, vol: 0x0C },
  T:  { id: 35, name: "T",  dur: 3,  mode: 0x24, f1: 0, f2: 0, noise: 2,  vol: 0x0E },
  K:  { id: 36, name: "K",  dur: 3,  mode: 0x24, f1: 0, f2: 0, noise: 7,  vol: 0x0E },

  // Stops / Plosives (Voiced: Tone C voice bar + burst)
  B:  { id: 37, name: "B",  dur: 3,  mode: 0x26, f1: 0, f2: 0, noise: 15, vol: 0x0C },
  D:  { id: 38, name: "D",  dur: 3,  mode: 0x26, f1: 0, f2: 0, noise: 2,  vol: 0x0D },
  G:  { id: 39, name: "G",  dur: 3,  mode: 0x26, f1: 0, f2: 0, noise: 7,  vol: 0x0D },

  // Affricates
  CH: { id: 40, name: "CH", dur: 5,  mode: 0x24, f1: 0, f2: 0, noise: 4,  vol: 0x0E },
  JH: { id: 41, name: "JH", dur: 5,  mode: 0x26, f1: 0, f2: 0, noise: 4,  vol: 0x0E },
};

export const PHONEME_LIST = Object.values(PHONEMES);

// Exceptions dictionary for high-frequency irregular English words
export const EXCEPTIONS = {
  "THE":       ["DH", "AH"],
  "THIS":      ["DH", "IH", "S"],
  "THAT":      ["DH", "AE", "T"],
  "THESE":     ["DH", "IY", "Z"],
  "THOSE":     ["DH", "OW", "Z"],
  "THEY":      ["DH", "EY"],
  "THEIR":     ["DH", "EH", "R"],
  "THERE":     ["DH", "EH", "R"],
  "TO":        ["T", "UW"],
  "TOO":       ["T", "UW"],
  "TWO":       ["T", "UW"],
  "OF":        ["AH", "V"],
  "OFF":       ["AO", "F"],
  "FOR":       ["F", "AO", "R"],
  "ONE":       ["W", "AH", "N"],
  "ONCE":      ["W", "AH", "N", "S"],
  "ARE":       ["AA", "R"],
  "YOU":       ["Y", "UW"],
  "YOUR":      ["Y", "AO", "R"],
  "WE":        ["W", "IY"],
  "TALK":      ["T", "AO", "K"],
  "TALKS":     ["T", "AO", "K", "S"],
  "TALKED":    ["T", "AO", "K", "T"],
  "TALKING":   ["T", "AO", "K", "IH", "NG"],
  "WALK":      ["W", "AO", "K"],
  "WALKS":     ["W", "AO", "K", "S"],
  "NEW":       ["N", "UW"],
  "OLD":       ["OW", "L", "D"],
  "HAVE":      ["HH", "AE", "V"],
  "HAS":       ["HH", "AE", "Z"],
  "HAD":       ["HH", "AE", "D"],
  "DO":        ["D", "UW"],
  "DOES":      ["D", "AH", "Z"],
  "DONE":      ["D", "AH", "N"],
  "SAID":      ["S", "EH", "D"],
  "SAYS":      ["S", "EH", "Z"],
  "WAS":       ["W", "AA", "Z"],
  "WERE":      ["W", "ER"],
  "WHAT":      ["W", "AH", "T"],
  "WHO":       ["HH", "UW"],
  "WHERE":     ["W", "EH", "R"],
  "WHEN":      ["W", "EH", "N"],
  "WHY":       ["W", "AY"],
  "WHICH":     ["W", "IH", "CH"],
  "COME":      ["K", "AH", "M"],
  "SOME":      ["S", "AH", "M"],
  "GIVE":      ["G", "IH", "V"],
  "LIVE":      ["L", "IH", "V"],
  "LOVE":      ["L", "AH", "V"],
  "GONE":      ["G", "AO", "N"],
  "HELLO":     ["HH", "EH", "L", "OW"],
  "COMPUTER":  ["K", "AH", "M", "P", "Y", "UW", "T", "ER"],
  "COMPUTERS": ["K", "AH", "M", "P", "Y", "UW", "T", "ER", "Z"],
  "SOFTWARE":  ["S", "AO", "F", "T", "W", "EH", "R"],
  "PLEASE":    ["P", "L", "IY", "Z"],
  "A":         ["EY"],
  "I":         ["AY"],
  "AN":        ["AE", "N"],
  "AND":       ["AE", "N", "D"],
  "IN":        ["IH", "N"],
  "IS":        ["IH", "Z"],
  "IT":        ["IH", "T"],
  "CAN":       ["K", "AE", "N"],
  "OVER":      ["OW", "V", "ER"],
  "LAZY":      ["L", "EY", "Z", "IY"],
  "DOG":       ["D", "AO", "G"],
};

// General English Grapheme-to-Phoneme converter for any word
export function wordToPhonemes(word) {
  word = word.toUpperCase();
  if (EXCEPTIONS[word]) return [...EXCEPTIONS[word]];

  const result = [];
  let i = 0;
  const n = word.length;

  const isVowel = c => "AEIOUY".includes(c);
  const isConsonant = c => c >= "A" && c <= "Z" && !isVowel(c);

  // Check silent E rule: does the word end with Vowel + Consonant + E?
  const hasSilentE = n >= 3 &&
    word.endsWith("E") &&
    isConsonant(word[n - 2]) &&
    isVowel(word[n - 3]) &&
    (n === 3 || !isVowel(word[n - 4]));

  while (i < n) {
    const sub2 = word.slice(i, i + 2);
    const sub3 = word.slice(i, i + 3);
    const sub4 = word.slice(i, i + 4);

    // Multi-letter checks
    if (sub4 === "TION" || sub4 === "SION") {
      result.push("SH", "AH", "N");
      i += 4;
      continue;
    }

    if (sub3 === "ING" && i > 0 && i === n - 3) {
      result.push("IH", "NG");
      i += 3;
      continue;
    }

    // Digraphs
    if (sub2 === "QU") { result.push("K", "W"); i += 2; continue; }
    if (sub2 === "TH") { result.push(i === 0 ? "DH" : "TH"); i += 2; continue; }
    if (sub2 === "SH") { result.push("SH"); i += 2; continue; }
    if (sub2 === "CH") { result.push("CH"); i += 2; continue; }
    if (sub2 === "PH") { result.push("F"); i += 2; continue; }
    if (sub2 === "WH") { result.push("W"); i += 2; continue; }
    if (sub2 === "CK") { result.push("K"); i += 2; continue; }
    if (sub2 === "KN" && i === 0) { result.push("N"); i += 2; continue; }
    if (sub2 === "WR" && i === 0) { result.push("R"); i += 2; continue; }
    if (sub2 === "NG") { result.push("NG"); i += 2; continue; }

    // Vowel digraphs
    if (sub2 === "EE" || sub2 === "EA") { result.push("IY"); i += 2; continue; }
    if (sub2 === "OO") { result.push("UW"); i += 2; continue; }
    if (sub2 === "AI" || sub2 === "AY") { result.push("EY"); i += 2; continue; }
    if (sub2 === "OA") { result.push("OW"); i += 2; continue; }
    if (sub2 === "OI" || sub2 === "OY") { result.push("OY"); i += 2; continue; }
    if (sub2 === "OU" || sub2 === "OW") { result.push("AW"); i += 2; continue; }
    if (sub2 === "AU" || sub2 === "AW") { result.push("AO"); i += 2; continue; }
    if (sub2 === "EW") { result.push("UW"); i += 2; continue; }

    // R-controlled vowels
    if (sub2 === "AR") { result.push("AA", "R"); i += 2; continue; }
    if (sub2 === "OR") { result.push("AO", "R"); i += 2; continue; }
    if (sub2 === "ER" || sub2 === "IR" || sub2 === "UR") { result.push("ER"); i += 2; continue; }

    const c = word[i];
    const next = i + 1 < n ? word[i + 1] : "";

    // Silent E at end
    if (hasSilentE && i === n - 3) {
      // Long vowel!
      if (c === "A") result.push("EY");
      else if (c === "E") result.push("IY");
      else if (c === "I") result.push("AY");
      else if (c === "O") result.push("OW");
      else if (c === "U") result.push("UW");
      else if (c === "Y") result.push("AY");
      i++;
      continue;
    }
    if (hasSilentE && i === n - 1 && c === "E") {
      // Silent E: skip!
      i++;
      continue;
    }

    // Single vowels
    if (c === "A") {
      result.push("AE");
    } else if (c === "E") {
      if (i === n - 1 && n > 2) {
        // Unstressed final E: usually silent or schwa
      } else {
        result.push("EH");
      }
    } else if (c === "I") {
      result.push("IH");
    } else if (c === "O") {
      result.push("AA");
    } else if (c === "U") {
      result.push("AH");
    } else if (c === "Y") {
      if (i === 0) result.push("Y");
      else if (i === n - 1) result.push("IY");
      else result.push("IH");
    }
    // Consonants
    else if (c === "B") result.push("B");
    else if (c === "C") {
      if (next && "EIY".includes(next)) result.push("S");
      else result.push("K");
    }
    else if (c === "D") result.push("D");
    else if (c === "F") result.push("F");
    else if (c === "G") {
      if (next && "EIY".includes(next)) result.push("JH");
      else result.push("G");
    }
    else if (c === "H") result.push("HH");
    else if (c === "J") result.push("JH");
    else if (c === "K") result.push("K");
    else if (c === "L") result.push("L");
    else if (c === "M") result.push("M");
    else if (c === "N") result.push("N");
    else if (c === "P") result.push("P");
    else if (c === "R") result.push("R");
    else if (c === "S") {
      if (i === n - 1 && result.length > 0 && "BDGLMNRVW".includes(word[i - 1]))
        result.push("Z");
      else
        result.push("S");
    }
    else if (c === "T") result.push("T");
    else if (c === "V") result.push("V");
    else if (c === "W") result.push("W");
    else if (c === "X") result.push("K", "S");
    else if (c === "Z") result.push("Z");

    // Double consonant: skip duplicate
    if (isConsonant(c) && c === next) {
      i++;
    }

    i++;
  }

  return result;
}

// Convert full sentence to phoneme tokens
export function sentenceToPhonemes(sentence) {
  const tokens = [];
  let currentWord = "";

  for (let i = 0; i < sentence.length; i++) {
    const ch = sentence[i];
    if (ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z") {
      currentWord += ch;
    } else {
      if (currentWord) {
        tokens.push(...wordToPhonemes(currentWord));
        currentWord = "";
        tokens.push("PAUSE_WORD");
      }
      if (ch === "." || ch === "?" || ch === "!") {
        tokens.push("PAUSE_SENTENCE");
      } else if (ch === "," || ch === ";" || ch === ":") {
        tokens.push("PAUSE_CLAUSE");
      }
    }
  }
  if (currentWord) {
    tokens.push(...wordToPhonemes(currentWord));
    tokens.push("PAUSE_WORD");
  }

  // Deduplicate consecutive pauses to the largest pause
  const cleaned = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("PAUSE_")) {
      let maxPause = t;
      while (i + 1 < tokens.length && tokens[i + 1].startsWith("PAUSE_")) {
        i++;
        if (tokens[i] === "PAUSE_SENTENCE" || maxPause !== "PAUSE_SENTENCE" && tokens[i] === "PAUSE_CLAUSE")
          maxPause = tokens[i];
      }
      cleaned.push(maxPause);
    } else {
      cleaned.push(t);
    }
  }
  return cleaned;
}

// CLI test runner when executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sentences = [
    "HELLO. THIS COMPUTER CAN TALK.",
    "WE MAKE NEW SOFTWARE FOR OLD COMPUTERS.",
    "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.",
    "PLEASE TYPE A SENTENCE AND PRESS ENTER.",
  ];

  console.log("Testing English Text-to-Phoneme translation:\n");
  for (const s of sentences) {
    const p = sentenceToPhonemes(s);
    console.log(`Sentence: "${s}"`);
    console.log(`Phonemes: ${p.join(" ")}\n`);
  }
}
