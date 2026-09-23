// Entrant unit tests for gemini-38flash-v1
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "../../../../../tools/asm6502.mjs";
import { PHONEME_LIST, EXCEPTIONS, sentenceToPhonemes } from "./generate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

console.log("Running unit tests for gemini-38flash-v1...\n");

// 1. Verify Phoneme definitions
console.log("1. Checking phoneme definitions...");
assert(PHONEME_LIST.length === 42, `Expected 42 phonemes, got ${PHONEME_LIST.length}`);
for (const p of PHONEME_LIST) {
  assert(typeof p.name === "string" && p.name.length > 0, "Invalid phoneme name");
  assert(Number.isInteger(p.dur) && p.dur > 0, `Invalid duration for ${p.name}`);
  assert(p.f1 >= 0 && p.f1 <= 4000, `F1 out of range for ${p.name}`);
  assert(p.f2 >= 0 && p.f2 <= 4000, `F2 out of range for ${p.name}`);
  assert(p.noise >= 0 && p.noise <= 31, `Noise period out of range for ${p.name}`);
  assert(p.vol >= 0 && p.vol <= 0x1F, `Volume out of range for ${p.name}`);
}
console.log("   ✓ All 42 phoneme models valid.");

// 2. Verify Dictionary entries
console.log("2. Checking dictionary entries...");
const exceptionKeys = Object.keys(EXCEPTIONS);
assert(exceptionKeys.length >= 30, `Expected at least 30 dictionary entries, got ${exceptionKeys.length}`);
for (const word of exceptionKeys) {
  assert(/^[A-Z]+$/.test(word), `Invalid word in dictionary: ${word}`);
  const phonemes = EXCEPTIONS[word];
  assert(Array.isArray(phonemes) && phonemes.length > 0, `Empty phonemes for ${word}`);
  for (const ph of phonemes) {
    assert(PHONEME_LIST.some(p => p.name === ph), `Unknown phoneme ${ph} in dictionary entry ${word}`);
  }
}
console.log(`   ✓ ${exceptionKeys.length} dictionary entries verified.`);

// 3. Verify G2P conversion on challenge sentences
console.log("3. Checking G2P translation on benchmark sentences...");
const sentences = [
  "Hello, world! 3RIC talks.",
  "The quick brown fox jumps over the lazy dog.",
  "Computer speech on a 6502 with dual AY chips sounds like this.",
  "One, two, three: testing text to speech."
];

for (const s of sentences) {
  const phonemes = sentenceToPhonemes(s);
  assert(phonemes.length > 5, `Phoneme sequence too short for: ${s}`);
  console.log(`   ✓ "${s.slice(0, 35)}..." -> ${phonemes.length} phonemes`);
}

// 4. Verify Assembly of tts.s
console.log("4. Checking assembly of tts.s...");
const sourcePath = path.join(__dirname, "tts.s");
const source = fs.readFileSync(sourcePath, "utf8");
const result = assemble(source);

assert(result.org === 0x0800, `Expected org $0800, got $${result.org.toString(16)}`);
assert(result.symbols.TTS_INIT !== undefined, "Missing symbol TTS_INIT");
assert(result.symbols.TTS_SPEAK !== undefined, "Missing symbol TTS_SPEAK");
assert(result.symbols.TTS_INPUT !== undefined, "Missing symbol TTS_INPUT");

const initAddr = result.symbols.TTS_INIT;
const speakAddr = result.symbols.TTS_SPEAK;
const inputAddr = result.symbols.TTS_INPUT;

assert(initAddr >= 0x0800 && initAddr < 0x9000, `TTS_INIT ($${initAddr.toString(16)}) outside $0800..$8FFF`);
assert(speakAddr >= 0x0800 && speakAddr < 0x9000, `TTS_SPEAK ($${speakAddr.toString(16)}) outside $0800..$8FFF`);
assert(inputAddr >= 0x0800 && inputAddr + 122 <= 0x9000, `TTS_INPUT ($${inputAddr.toString(16)}) outside $0800..$8FFF`);

console.log(`   ✓ Assembled ${result.bytes.length} bytes at $${result.org.toString(16)}`);
console.log(`   ✓ TTS_INIT  = $${initAddr.toString(16)}`);
console.log(`   ✓ TTS_SPEAK = $${speakAddr.toString(16)}`);
console.log(`   ✓ TTS_INPUT = $${inputAddr.toString(16)} (122 bytes)`);

console.log("\nAll entrant unit tests passed successfully!");
