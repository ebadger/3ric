import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { test, after } from "node:test";
import { validateEntry, readEntries, validateId } from "./tts-entry.mjs";
import { checkEntry, main, parseOptions, PUBLIC_SENTENCES, CLOCK_HZ, SAMPLE_RATE } from "./check-tts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = "0123456789abcdef0123456789abcdef01234567";
const tone = fs.readFileSync(path.join(HERE, "fixtures", "tts-check-tone.s"), "utf8").replace(/\r\n/g, "\n");
const work = fs.mkdtempSync(path.join(HERE, "fixtures", "tts-check-work-"));
let nextId = 0;
after(() => fs.rmSync(work, { recursive: true, force: true }));

function createEntry({ source = tone, metadata = {}, parent = work, id = `fixture-${++nextId}` } = {}) {
  const directory = path.join(parent, id);
  fs.mkdirSync(directory, { recursive: true });
  const meta = {
    schemaVersion: 1, challenge: "tts-v1", id, title: "NON-SPEECH tooling fixture",
    author: "Checker tests", model: "Not applicable", agent: "Node test runner",
    baseline: BASELINE, description: "A tone, never speech.", assistance: "Tooling fixture only.",
    license: "MIT", memory: "Always-mapped RAM; $E0..$E4 workspace.",
    limitations: "NOT TTS. System speaker, not AY speech. Never publish as an entry.",
    ...metadata,
  };
  fs.writeFileSync(path.join(directory, "tts.s"), source);
  fs.writeFileSync(path.join(directory, "entry.json"), JSON.stringify(meta));
  fs.writeFileSync(path.join(directory, "README.md"), "Tooling-only NON-SPEECH fixture; not a submission.\n");
  return directory;
}

function validate(directory, baseline = BASELINE) { return validateEntry(directory, { baseline }); }
function variant(flag) { return tone.replace(`${flag} = 0`, `${flag} = 1`); }
const failure = (report, name, check) => report.calls.some(c =>
  (!name || c.name === name) && c.checks?.some(item => item.name === check && !item.ok));

test("valid entry exports source, metadata and exact raw assembly; entrant scripts never run", () => {
  const directory = createEntry();
  fs.writeFileSync(path.join(directory, "test.mjs"), "throw new Error('ENTRANT SCRIPT EXECUTED');");
  fs.writeFileSync(path.join(directory, "generator.js"), "process.exit(99);");
  const entry = validate(directory);
  assert.equal(entry.source, tone);
  assert.equal(entry.metadata.id, path.basename(directory));
  assert.equal(entry.directory, directory);
  assert.equal(entry.assembly.org, 0x0800);
  assert(entry.assembly.bytes instanceof Uint8Array);
  assert.equal(entry.assembly.bytes[0], 0x4c);
  assert(entry.assembly.listing.some(r => r.kind === "instruction" && r.pc === entry.assembly.symbols.TTS_INIT));
});

test("all required metadata is typed, bounded, supported and baseline-pinned", () => {
  const required = ["id", "title", "author", "model", "agent", "baseline", "description", "assistance", "license", "memory", "limitations"];
  for (const key of required) {
    for (const value of [null, "", "  ", 23, {}])
      assert.throws(() => validate(createEntry({ metadata: { [key]: value } })), /must|baseline/);
  }
  for (const metadata of [
    { schemaVersion: "1" }, { schemaVersion: 2 }, { challenge: "tts-v2" },
    { baseline: "0".repeat(40) }, { baseline: "z".repeat(40) },
    { title: "T".repeat(161) }, { description: "D".repeat(4001) },
    { author: "A\u0000B" }, { executable: "evil.mjs" },
  ]) assert.throws(() => validate(createEntry({ metadata })));
  assert.throws(() => validate(createEntry(), null), /baseline/);
  assert.throws(() => validate(createEntry(), "bad"), /baseline/);
  validate(createEntry({ metadata: { baseline: BASELINE.toUpperCase() } }));
});

test("metadata JSON objects only; malformed, missing and empty required files rejected", () => {
  for (const text of ["[1]", "null", "true", "{", ""])
    assert.throws(() => {
      const directory = createEntry();
      fs.writeFileSync(path.join(directory, "entry.json"), text);
      validate(directory);
    });
  for (const name of ["entry.json", "tts.s", "README.md"]) {
    const missing = createEntry();
    fs.unlinkSync(path.join(missing, name));
    assert.throws(() => validate(missing));
    const empty = createEntry();
    fs.writeFileSync(path.join(empty, name), " \n");
    assert.throws(() => validate(empty), /empty|JSON/);
    const isDirectory = createEntry();
    fs.unlinkSync(path.join(isDirectory, name));
    fs.mkdirSync(path.join(isDirectory, name));
    assert.throws(() => validate(isDirectory), /regular file/);
  }
  assert.throws(() => validate(createEntry({ source: ";".repeat(1024 * 1024 + 1) })), /limit/);
  const badEncoding = createEntry();
  fs.writeFileSync(path.join(badEncoding, "tts.s"), Buffer.from([0xff, 0xfe]));
  assert.throws(() => validate(badEncoding), /encoded|encoding/);
});

test("IDs reject traversal, separators, duplicates/wrong IDs and invalid lengths", () => {
  for (const id of ["", ".", "..", "../escape", "..\\escape", "a/b", "a\\b", "A", "-a", "a-", "a--b", "a_b", "a".repeat(61)]) {
    assert.throws(() => validateId(id));
    assert.throws(() => parseOptions(["--entry", id]));
  }
  assert.equal(validateId("a".repeat(60)), "a".repeat(60));
  assert.throws(() => validate(createEntry({ metadata: { id: "somebody-else" } })), /basename/);
  const parent = path.join(work, "duplicate-ids");
  createEntry({ parent, id: "first" });
  createEntry({ parent, id: "second", metadata: { id: "first" } });
  assert.throws(() => readEntries({ submissionsDir: parent, baseline: BASELINE }), /basename/);
});

test("entry enumeration is sorted, excludes only regular README.md, and requires an existing root", () => {
  const parent = path.join(work, "enumeration");
  fs.mkdirSync(parent);
  fs.writeFileSync(path.join(parent, "README.md"), "No entries.");
  assert.deepEqual(readEntries({ submissionsDir: parent, baseline: null }), []);
  assert.throws(() => readEntries({ submissionsDir: path.join(work, "missing"), baseline: BASELINE }));
  createEntry({ parent, id: "zulu" });
  createEntry({ parent, id: "alpha" });
  assert.deepEqual(readEntries({ submissionsDir: parent, baseline: BASELINE }).map(e => e.metadata.id), ["alpha", "zulu"]);
  fs.writeFileSync(path.join(parent, "ignored.json"), "{}");
  assert.throws(() => readEntries({ submissionsDir: parent, baseline: BASELINE }), /unexpected submission child/);
  fs.unlinkSync(path.join(parent, "ignored.json"));
  fs.mkdirSync(path.join(parent, ".hidden"));
  assert.throws(() => readEntries({ submissionsDir: parent, baseline: BASELINE }), /entry id/);
});

test("symlinked required files, entries, roots and root README are rejected where supported", context => {
  const directory = createEntry();
  const target = path.join(work, "readme-target");
  fs.writeFileSync(target, "Not a regular entry file.");
  const filename = path.join(directory, "README.md");
  fs.unlinkSync(filename);
  try { fs.symlinkSync(target, filename, "file"); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return context.skip(`file symlinks unavailable: ${error.code}`);
    throw error;
  }
  assert.throws(() => validate(directory), /symlink/);
  for (const name of ["entry.json", "tts.s"]) {
    const linkedEntry = createEntry();
    fs.unlinkSync(path.join(linkedEntry, name));
    fs.symlinkSync(target, path.join(linkedEntry, name), "file");
    assert.throws(() => validate(linkedEntry), /symlink/);
  }
  const parent = path.join(work, "linked-entries");
  fs.mkdirSync(parent);
  fs.symlinkSync(createEntry(), path.join(parent, "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => readEntries({ submissionsDir: parent, baseline: BASELINE }), /symlink/);
  assert.throws(() => validate(path.join(parent, "linked")), /symlink/);
  assert.throws(() => readEntries({ submissionsDir: path.join(parent, "linked"), baseline: BASELINE }), /symlink/);
  fs.unlinkSync(path.join(parent, "linked"));
  fs.symlinkSync(target, path.join(parent, "README.md"), "file");
  assert.throws(() => readEntries({ submissionsDir: parent, baseline: BASELINE }), /unexpected/);
});

test("assembly ABI rejects wrong origins, missing/data/banked routines, and unreserved/overlapping input", () => {
  for (const source of [
    tone.replace(".org $0800", ".org $0900"),
    tone.replace("TTS_INIT:", "NOT_INIT:"),
    tone.replace("TTS_SPEAK:", "NOT_SPEAK:"),
    tone.replace("TTS_INIT:\n        lda #0", "TTS_INIT:\n        .byte 0, 0"),
    `${tone}\nTTS_INIT = $9000`,
    `${tone}\nTTS_SPEAK = $d000`,
    `${tone}\n        .org $8fff\nLAST:   lda #0\nTTS_INIT = LAST`,
    tone.replace("TTS_INPUT:", "OTHER_INPUT:"),
    tone.replace(".res 122", ".res 121"),
    `${tone}\nTTS_INPUT = $8f87`,
    `${tone}\nTTS_INPUT = TTS_INIT`,
    tone.replace("TTS_INPUT:\n        .res 122", "TTS_INPUT:\n        .org $1000\n        .byte 0"),
    `${tone}\n        .org $0300\n        nop`,
    `${tone}\n        .org $0800\n        nop`,
    `${tone}\n        .org $c000\n        .byte 0`,
    `${tone}\n        nonsense`,
  ]) assert.throws(() => validate(createEntry({ source })));
});

test("raw images beyond 36 KiB and up through $BFFF are valid; oversized allocations are bounded", () => {
  const entry = validate(createEntry({ source: `${tone}\n        .res $c000-*\n` }));
  assert.equal(entry.assembly.bytes.length, 0xb800);
  assert(entry.assembly.bytes.length > 36 * 1024);
  for (const source of [
    `${tone}\n        .res $c001-*\n`,
    `${tone}\n        .res 2000000000\n`,
    `${tone}\n        .org 2000000000\n        nop\n`,
  ]) assert.throws(() => validate(createEntry({ source })), /allocation|end at or below/);
});

test("CLI is strict; production callers cannot override cycle limits", () => {
  assert.deepEqual(parseOptions(["--all", "--preview"]).all, true);
  assert.equal(parseOptions(["--entry", "good-id", "--validate-only"]).validateOnly, true);
  for (const args of [[], ["--all", "--entry", "a"], ["--all", "--all"], ["--entry"], ["--all", "--out"], ["--all", "--max-cycles", "1"], ["--all", "--test-cycle-budgets", "1"]])
    assert.throws(() => parseOptions(args));
});

test("validation-only emits raw image/report, preserves provenance, and claims no runtime result", async () => {
  const entry = validate(createEntry({ source: `\ufeff${tone}` }));
  const outDir = path.join(work, "validation-artifacts");
  const report = await checkEntry(entry, { outDir, validateOnly: true });
  assert.equal(report.ok, true);
  assert.equal(report.status, "passed");
  assert.equal(report.mode, "validation-only");
  assert.equal(report.entryId, entry.metadata.id);
  assert.equal(report.calls.length, 0);
  assert.equal(report.scope.completeConformance, false);
  assert.equal(report.scope.entrantScriptsExecuted, false);
  assert.equal(report.sourceSha256.length, 64);
  assert.equal(report.sourceSha256, createHash("sha256").update(fs.readFileSync(path.join(entry.directory, "tts.s"))).digest("hex"));
  assert.deepEqual(report.artifacts, [{ file: "tts.prg", kind: "program" }]);
  assert.equal(report.provenance.baseline, BASELINE);
  assert.equal(report.runtime.clockHz, CLOCK_HZ);
  assert.equal(report.runtime.sampleRate, SAMPLE_RATE);
  assert.deepEqual(fs.readFileSync(path.join(outDir, "tts.prg")), Buffer.from(entry.assembly.bytes));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, "report.json"), "utf8")), report);
});

test("CLI validation failure persists a non-publishable failed report", async () => {
  const out = path.join(work, "failed-cli");
  const entryId = "missing-checker-fixture";
  assert.equal(await main(["--entry", entryId, "--out", out]), 1);
  const report = JSON.parse(fs.readFileSync(path.join(out, entryId, "report.json"), "utf8"));
  assert.equal(report.entryId, entryId);
  assert.equal(report.status, "failed");
  assert.equal(report.sourceSha256, null);
  assert.deepEqual(report.artifacts, []);
  assert(report.errors.length > 0);
});

const web = process.env.BADGER_WEB_DIR || path.resolve(HERE, "..", "..", "web");
const runtimeAvailable = ["badger6502.js", "badger6502.wasm", path.join("data", "badger6502.bin"), path.join("data", "fontrom.dat")]
  .every(name => fs.existsSync(path.join(web, name)));
const runtimeRequested = process.argv.includes("--runtime");
const skipRuntime = process.argv.includes("--static-only") || process.argv.includes("--static") ? "static-only requested" :
  !runtimeAvailable && !runtimeRequested ? "WASM/data pending: build web/build.ps1, then rerun with --runtime" : false;
const testCycleBudgets = {
  short: 100_000, speech: 400_000, cancellation: 20_000, injectAfter: 8192,
  batch: 2048,
  // Keep real DC settling; only guest-call deadlines are shortened.
};

test("missing WASM produces a persistent failed report, never a passing empty check", { skip: runtimeAvailable }, async () => {
  const outDir = path.join(work, "missing-runtime-artifacts");
  const report = await checkEntry(validate(createEntry()), { outDir });
  assert.equal(report.ok, false);
  assert.equal(report.status, "failed");
  assert(report.errors.length > 0);
  assert.equal(report.calls.length, 16);
  assert(report.calls.every(c => c.status === "not-run" && c.reason.startsWith("aborted:")));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, "report.json"), "utf8")), report);
});

test("real WASM non-speech fixture exercises all calls, artifacts and honest report scope", { skip: skipRuntime }, async () => {
  assert(runtimeAvailable, "Runtime dependency missing: build web/build.ps1 before --runtime");
  const entry = validate(createEntry());
  const outDir = path.join(work, "runtime-artifacts");
  const report = await checkEntry(entry, { outDir, testCycleBudgets });
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.status, "passed");
  assert.equal(report.mode, "runtime");
  assert.equal(report.entryId, entry.metadata.id);
  assert.equal(report.runtime.testOverrides, true);
  assert.equal(report.scope.completeConformance, false);
  assert(report.scope.manualUnverified.some(s => s.includes("non-speech tones")));
  assert.equal(report.calls.length, 16);
  for (const sentence of PUBLIC_SENTENCES)
    assert.equal(report.calls.filter(c => c.input === sentence).length >= 2, true);
  const cancel = report.calls.find(c => c.name === "escape-cancellation");
  assert(cancel.escapeInjectedAtCycle >= testCycleBudgets.injectAfter);
  assert(cancel.cancellationCycles <= testCycleBudgets.cancellation);
  for (const call of report.calls) {
    assert.equal(call.status, "passed", call.name);
    assert(call.returned);
    assert(call.cycles > 0);
    assert(call.postReturn.audio.frames > 0);
  }
  const audio = report.artifacts.filter(artifact => artifact.kind === "audio");
  assert.deepEqual(audio.map(artifact => artifact.file), ["sentence-1.wav", "sentence-2.wav", "sentence-3.wav", "sentence-4.wav"]);
  assert.deepEqual(audio.map(artifact => artifact.text), PUBLIC_SENTENCES);
  const wav = fs.readFileSync(path.join(outDir, audio[0].file));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 48_000);
  assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  assert(wav.length > 44);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, "report.json"), "utf8")), report);
});

test("real WASM fixture also passes fixed production deadlines without overrides", { skip: skipRuntime }, async () => {
  assert(runtimeAvailable, "Runtime dependency missing: build web/build.ps1 before --runtime");
  const report = await checkEntry(validate(createEntry()));
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.runtime.testOverrides, false);
  assert.equal(report.runtime.budgets.short, Math.floor(CLOCK_HZ * 2));
  assert.equal(report.runtime.budgets.speech, Math.floor(CLOCK_HZ * 90));
  assert.equal(report.runtime.budgets.cancellation, Math.floor(CLOCK_HZ));
  assert.equal(report.status, "passed");
  assert.equal(report.scope.completeConformance, false);
});

for (const [flag, name, check] of [
  ["SILENT", "sentence-1-repeat-1", "pcm-activity"],
  ["MUTATE", "empty", "input-preserved"],
  ["BAD_INVALID", "overlength-121", "return-code"],
  ["BAD_CANCEL", "escape-cancellation", "return-code"],
  ["IGNORE_ESCAPE", "escape-cancellation", "cancellation-deadline"],
  ["FAST", "escape-cancellation", "escape-injected-while-running"],
  ["LEAK", "sentence-1-repeat-1", "post-return-silence"],
  ["HIDE_ROM", "sentence-1-repeat-1", "upper-rom-visible"],
  ["CLOBBER_CALLER", "sentence-1-repeat-1", "caller-preserved"],
  ["HANG", "sentence-1-repeat-1", "returned-before-deadline"],
  ["WAIT", "sentence-1-repeat-1", "returned-before-deadline"],
]) {
  test(`real WASM detects ${flag}: ${check}`, { skip: skipRuntime }, async () => {
    assert(runtimeAvailable, "Runtime dependency missing: build web/build.ps1 before --runtime");
    const report = await checkEntry(validate(createEntry({ source: variant(flag) })), { testCycleBudgets });
    assert.equal(report.ok, false, `${flag} incorrectly passed`);
    assert(failure(report, name, check), JSON.stringify(report, null, 2));
    if (["HANG", "WAIT", "HIDE_ROM", "CLOBBER_CALLER", "IGNORE_ESCAPE"].includes(flag))
      assert(report.calls.some(c => c.status === "not-run" && c.reason.includes(name)));
    if (flag === "WAIT") {
      const call = report.calls.find(c => c.name === name);
      assert.equal(call.returned, false);
      assert(call.cycles >= testCycleBudgets.speech);
    }
    if (flag === "FAST") {
      const call = report.calls.find(c => c.name === name);
      assert.equal(call.escapeInjectedAtCycle, null);
    }
  });
}
