import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import harness from "./harness.cjs";
import { readEntries, validateEntry, validateId } from "./tts-entry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUBMISSIONS = path.join(ROOT, "codegen", "challenges", "tts", "v1", "submissions");
const DEFAULT_OUT = path.join(ROOT, "codegen", "out", "tts-v1");
export const CLOCK_HZ = 1_573_437.5;
export const SAMPLE_RATE = 48_000;
export const PUBLIC_SENTENCES = [
  "HELLO. THIS COMPUTER CAN TALK.",
  "WE MAKE NEW SOFTWARE FOR OLD COMPUTERS.",
  "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.",
  "PLEASE TYPE A SENTENCE AND PRESS ENTER.",
];
const CALLER = 0x0300;
const RETURN = CALLER + 8;
const IDLE = 0x0310;
const THRESHOLDS = {
  speechAcRms: 0.0001, speechPeak: 0.001, minimumSpeechFrames: 48,
  silenceRms: 0.0001, silencePeak: 0.0005,
};
const BUDGETS = {
  short: Math.floor(CLOCK_HZ * 2),
  speech: Math.floor(CLOCK_HZ * 90),
  cancellation: Math.floor(CLOCK_HZ),
  injectAfter: Math.floor(CLOCK_HZ * 0.05),
  batch: 8192,
  settle: Math.floor(CLOCK_HZ * 0.25),
  silence: Math.floor(CLOCK_HZ * 0.15),
};
const MANUAL = [
  "Intelligibility and pronunciation require human listening; non-speech tones can pass PCM checks.",
  "PCM is the mixed VM output; AY-only sound-source compliance is NOT established.",
  "Interactive typing/editing, input UI, and BRK return to a usable monitor are unverified.",
  "ROM/SD physical loading, bank initialization on the physical loader, and real hardware are unverified.",
  "Entrant metadata/provenance claims are self-reported, not independently verified.",
];

function provenance(entry) {
  let gitRevision = null, worktreeDirty = null;
  try {
    gitRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    worktreeDirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
  } catch { /* Source hash remains available outside a Git checkout. */ }
  return {
    baseline: entry.metadata.baseline, gitRevision, worktreeDirty,
  };
}

function newReport(entry, validateOnly) {
  return {
    schemaVersion: 1, challenge: "tts-v1", entryId: entry.metadata.id,
    sourceSha256: createHash("sha256").update(entry.source, "utf8").digest("hex"),
    metadata: entry.metadata, provenance: provenance(entry),
    createdAt: new Date().toISOString(), ok: false,
    status: "failed", mode: validateOnly ? "validation-only" : "runtime",
    scope: {
      completeConformance: false,
      automated: validateOnly ? ["metadata and assembly layout only"] : [
        "raw image load; exact caller-return breakpoint and stack balance",
        "bounded guest-call ABI, preserved strings, upper ROM mapping",
        "mixed stereo PCM activity and settled post-return silence",
      ],
      manualUnverified: MANUAL,
      entrantScriptsExecuted: false,
    },
    program: {
      org: entry.assembly.org, bytes: entry.assembly.bytes.length,
      endExclusive: entry.assembly.org + entry.assembly.bytes.length,
      symbols: Object.fromEntries(["TTS_INIT", "TTS_SPEAK", "TTS_INPUT"].map(k => [k, entry.assembly.symbols[k]])),
    },
    runtime: { engine: "unmodified WASM via harness.boot", clockHz: CLOCK_HZ, sampleRate: SAMPLE_RATE, channels: 2, wavEncoding: "PCM16LE", thresholds: THRESHOLDS },
    calls: [], errors: [], artifacts: [],
  };
}

class AudioStats {
  constructor() {
    this.samples = 0;
    this.channels = [0, 1].map(() => ({ sum: 0, squares: 0, peak: 0 }));
  }
  add(pcm) {
    if (pcm.length % 2) throw new Error("VM returned non-stereo PCM");
    this.samples += pcm.length;
    for (let i = 0; i < pcm.length; i++) {
      const value = pcm[i];
      if (!Number.isFinite(value)) throw new Error("VM returned non-finite PCM");
      const c = this.channels[i % 2];
      c.sum += value;
      c.squares += value * value;
      c.peak = Math.max(c.peak, Math.abs(value));
    }
  }
  result() {
    const frames = this.samples / 2;
    return {
      frames, seconds: frames / SAMPLE_RATE,
      channels: this.channels.map(c => {
        const mean = frames ? c.sum / frames : 0;
        const meanSquare = frames ? c.squares / frames : 0;
        return { mean, peak: c.peak, rms: Math.sqrt(meanSquare), acRms: Math.sqrt(Math.max(0, meanSquare - mean * mean)) };
      }),
    };
  }
}

class Wav {
  constructor(filename) {
    this.fd = fs.openSync(filename, "w");
    this.bytes = 0;
    fs.writeSync(this.fd, Buffer.alloc(44));
  }
  add(pcm) {
    const bytes = Buffer.alloc(pcm.length * 2);
    for (let i = 0; i < pcm.length; i++)
      bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), i * 2);
    fs.writeSync(this.fd, bytes);
    this.bytes += bytes.length;
  }
  close() {
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + this.bytes, 4); h.write("WAVEfmt ", 8);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
    h.writeUInt32LE(SAMPLE_RATE, 24); h.writeUInt32LE(SAMPLE_RATE * 4, 28);
    h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
    h.write("data", 36); h.writeUInt32LE(this.bytes, 40);
    try { fs.writeSync(this.fd, h, 0, h.length, 0); }
    finally { fs.closeSync(this.fd); }
  }
}

function hasAudio(audio) {
  return audio.frames >= THRESHOLDS.minimumSpeechFrames &&
    audio.channels.some(c => c.acRms > THRESHOLDS.speechAcRms && c.peak > THRESHOLDS.speechPeak);
}

function isQuiet(audio) {
  return audio.frames > 0 &&
    audio.channels.every(c => c.rms <= THRESHOLDS.silenceRms && c.peak <= THRESHOLDS.silencePeak);
}

function callCases() {
  const cases = [
    { name: "init", routine: "TTS_INIT", deadline: "short" },
    { name: "empty", text: "", expected: 0, deadline: "short", quiet: true },
    { name: "spaces", text: "     ", expected: 0, deadline: "short", quiet: true },
    { name: "overlength-121", text: "A".repeat(121), expected: 2, deadline: "short", quiet: true },
  ];
  for (let repeat = 1; repeat <= 2; repeat++)
    PUBLIC_SENTENCES.forEach((text, i) => cases.push({
      name: `sentence-${i + 1}-repeat-${repeat}`, text, expected: 0, deadline: "speech", audio: true,
      artifact: repeat === 1 ? `sentence-${i + 1}.wav` : null,
    }));
  cases.push(
    { name: "lowercase", text: PUBLIC_SENTENCES[0].toLowerCase(), expected: 0, deadline: "speech", audio: true },
    { name: "maximum-120", text: `${PUBLIC_SENTENCES[0]} `.repeat(5).slice(0, 120), expected: 0, deadline: "speech", audio: true },
    { name: "escape-cancellation", text: `${PUBLIC_SENTENCES[2]} `.repeat(4).slice(0, 120), expected: 1, deadline: "speech", cancel: true },
    { name: "after-cancellation", text: PUBLIC_SENTENCES[1], expected: 0, deadline: "speech", audio: true },
  );
  return cases;
}

function collect(vm, stats, wav, diagnostic) {
  const pcm = vm.drainAudio();
  stats.add(pcm);
  wav?.add(pcm);
  const text = vm.drainOutput();
  diagnostic.serialBytes += text.length;
  if (diagnostic.serial.length < 8192) diagnostic.serial += text.slice(0, 8192 - diagnostic.serial.length);
}

function settleAndMeasure(vm, budgets) {
  vm.clearBreakpoints();
  vm.loadData(IDLE, Uint8Array.of(0x4c, IDLE & 255, IDLE >> 8));
  vm.setPC(IDLE);
  const stats = new AudioStats();
  let settleCycles = 0, measuredCycles = 0;
  while (settleCycles < budgets.settle) {
    const advanced = vm.runCycles(Math.min(budgets.batch, budgets.settle - settleCycles));
    if (advanced <= 0) throw new Error("VM made no progress during audio settling");
    settleCycles += advanced;
    vm.drainAudio(); vm.drainOutput();
  }
  while (measuredCycles < budgets.silence) {
    const advanced = vm.runCycles(Math.min(budgets.batch, budgets.silence - measuredCycles));
    if (advanced <= 0) throw new Error("VM made no progress during silence observation");
    measuredCycles += advanced;
    stats.add(vm.drainAudio()); vm.drainOutput();
  }
  return { settleCycles, measuredCycles, audio: stats.result() };
}

function executeCall(vm, entry, definition, budgets, romMapping, wav, record) {
  Object.assign(record, {
    name: definition.name, status: "failed", routine: definition.routine || "TTS_SPEAK",
    input: definition.text ?? null, expectedA: definition.expected ?? null,
    cycles: 0, deadlineCycles: budgets[definition.deadline],
    returned: false, escapeInjectedAtCycle: null, serial: "", serialBytes: 0, checks: [],
  });
  delete record.reason;
  const check = (name, ok, detail) => record.checks.push({ name, ok, detail });
  const ptr = entry.assembly.symbols.TTS_INPUT;
  const input = definition.text == null ? null : Buffer.from(`${definition.text}\0`, "ascii");
  if (input) vm.loadData(ptr, input);
  const address = entry.assembly.symbols[record.routine];
  const trampoline = new Uint8Array(32).fill(0xea);
  trampoline.set([0xd8, 0xa9, ptr & 255, 0xa2, ptr >> 8, 0x20, address & 255, address >> 8]);
  trampoline.set([0x4c, IDLE & 255, IDLE >> 8], IDLE - CALLER);
  vm.loadData(CALLER, trampoline);
  vm.readBus(0xc010);
  vm.clearBreakpoints();
  if (!vm.addBreakpoint(RETURN)) throw new Error("VM rejected return breakpoint");
  vm.setPC(CALLER);
  const initialSP = vm.sp();
  const stats = new AudioStats();
  let deadline = record.deadlineCycles;
  while (record.cycles < deadline) {
    if (definition.cancel && record.escapeInjectedAtCycle === null && record.cycles >= budgets.injectAfter) {
      vm.keyDown(27);
      record.escapeInjectedAtCycle = record.cycles;
      deadline = Math.min(deadline, record.cycles + budgets.cancellation);
    }
    let batch = Math.min(budgets.batch, deadline - record.cycles);
    if (definition.cancel && record.escapeInjectedAtCycle === null)
      batch = Math.min(batch, budgets.injectAfter - record.cycles);
    const advanced = vm.runCycles(batch);
    record.cycles += advanced;
    collect(vm, stats, wav, record);
    if (vm.breakpointHit() && vm.pc() === RETURN) { record.returned = true; break; }
    // A batch may finish on the RTS itself. Observe the return breakpoint before
    // injecting Escape, rather than mislabeling an already-completed call as cancelled.
    if (vm.pc() === RETURN && !vm.waiting()) {
      record.cycles += vm.runCycles(1);
      collect(vm, stats, wav, record);
      if (vm.breakpointHit() && vm.pc() === RETURN) { record.returned = true; break; }
    }
    if (advanced <= 0) { record.executionError = "VM made no progress without a caller-return breakpoint"; break; }
    // WAI/STP are deliberately not success: only the actual return breakpoint is.
  }
  record.seconds = record.cycles / CLOCK_HZ;
  record.audio = stats.result();
  record.registers = { pc: vm.pc(), a: vm.regA(), x: vm.regX(), y: vm.regY(), sp: vm.sp(), status: vm.status(), waiting: vm.waiting() };
  record.effectiveDeadlineCycles = deadline;
  check("returned-before-deadline", record.returned && record.cycles <= deadline,
    record.returned ? `${record.cycles} cycles` : `timeout/no return at PC=$${vm.pc().toString(16)}; WAI is not a return`);
  if (definition.cancel) {
    check("escape-injected-while-running", record.escapeInjectedAtCycle !== null,
      record.escapeInjectedAtCycle === null ? "incomplete: routine returned before injection; cancellation was not exercised" : `Escape at cycle ${record.escapeInjectedAtCycle}`);
    record.cancellationCycles = record.escapeInjectedAtCycle === null ? null : record.cycles - record.escapeInjectedAtCycle;
    check("cancellation-deadline", record.returned && record.cancellationCycles !== null && record.cancellationCycles <= budgets.cancellation,
      `${record.cancellationCycles} cycles after Escape (limit ${budgets.cancellation})`);
  }
  if (record.returned) {
    check("balanced-stack", vm.sp() === initialSP, `SP ${initialSP} -> ${vm.sp()}`);
    if (definition.expected !== undefined)
      check("return-code", vm.regA() === definition.expected, `expected A=${definition.expected}; got ${vm.regA()}`);
    check("upper-rom-visible", romMapping.every(([addr, mapping]) => vm.memoryMapping(addr) === mapping),
      "compare $D000/$E000/$F000/$FFFF read mappings with boot ROM mappings");
    check("caller-preserved", trampoline.every((byte, i) => vm.peek(CALLER + i) === byte), "$0300..$031F is reserved");
  }
  if (input) check("input-preserved", input.every((byte, i) => vm.peek(ptr + i) === byte), "all supplied bytes including NUL must remain unchanged");
  if (definition.audio) check("pcm-activity", hasAudio(record.audio), "mixed PCM activity only; not intelligibility or AY-only proof");
  if (definition.quiet) {
    // Very short empty/invalid calls may finish before the first sample. The
    // independent post-return observation still requires actual quiet PCM frames.
    const quiet = !record.audio.frames || isQuiet(record.audio);
    check("no-speech-pcm", quiet, "empty/space-only/invalid calls must not emit an audible signal");
  }
  if (record.returned) {
    record.postReturn = settleAndMeasure(vm, budgets);
    check("post-return-silence", isQuiet(record.postReturn.audio), "measured after DC settling; caller spins without muting hardware");
  }
  record.status = record.checks.every(c => c.ok) ? "passed" : "failed";
  return record;
}

// testCycleBudgets is an internal test seam, never accepted by the production CLI.
// Passing it is prominently recorded; such a report is not a production check.
export async function checkEntry(entry, { outDir, validateOnly = false, testCycleBudgets } = {}) {
  const report = newReport(entry, validateOnly);
  const budgets = { ...BUDGETS, ...testCycleBudgets };
  for (const [name, value] of Object.entries(budgets))
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid cycle budget ${name}`);
  if (budgets.batch > 8192) throw new Error("audio-drain batch must not exceed 8192 cycles");
  report.runtime.budgets = budgets;
  report.runtime.testOverrides = testCycleBudgets !== undefined;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "tts.prg"), entry.assembly.bytes);
    report.artifacts.push({ file: "tts.prg", kind: "program" });
  }
  let vm;
  try {
    if (validateOnly) {
      report.ok = true;
      report.status = "passed";
    } else {
      const cases = callCases();
      report.calls = cases.map(c => ({ name: c.name, status: "not-run", reason: "not reached" }));
      const session = await harness.boot();
      vm = session.vm;
      for (const method of ["runCycles", "drainAudio", "memoryMapping", "addBreakpoint", "breakpointHit"])
        if (typeof vm[method] !== "function") throw new Error(`WASM lacks ${method}; rebuild web/build.ps1`);
      if (!vm.enableAudio(SAMPLE_RATE)) throw new Error("VM rejected 48 kHz audio");
      vm.drainAudio();
      const romMapping = [0xd000, 0xe000, 0xf000, 0xffff].map(addr => [addr, vm.memoryMapping(addr)]);
      session.load(entry.assembly.bytes, entry.assembly.org);
      for (let i = 0; i < cases.length; i++) {
        const definition = cases[i];
        const filename = definition.artifact;
        let wav;
        try {
          if (outDir && filename) {
            wav = new Wav(path.join(outDir, filename));
            report.artifacts.push({ file: filename, kind: "audio", text: definition.text });
          }
          executeCall(vm, entry, definition, budgets, romMapping, wav, report.calls[i]);
        } finally { wav?.close(); }
        if (!report.calls[i].returned ||
            report.calls[i].checks.some(c => !c.ok && ["balanced-stack", "upper-rom-visible", "caller-preserved"].includes(c.name))) {
          for (let j = i + 1; j < cases.length; j++)
            report.calls[j].reason = `not run after unsafe/unfinished ${definition.name}`;
          break;
        }
      }
      report.ok = report.calls.every(c => c.status === "passed");
      report.status = report.ok ? "passed" : "failed";
    }
  } catch (error) {
    report.errors.push(error.message);
    report.status = "failed";
    for (const call of report.calls)
      if (call.status === "not-run") call.reason = `aborted: ${error.message}`;
  } finally {
    if (vm) {
      try { vm.delete(); }
      catch (error) { report.errors.push(`VM cleanup: ${error.message}`); report.ok = false; report.status = "failed"; }
    }
    if (outDir) fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

export function parseOptions(argv) {
  const options = { all: false, validateOnly: false, preview: false, out: DEFAULT_OUT };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error(`duplicate option ${flag}`);
    seen.add(flag);
    if (flag === "--all") options.all = true;
    else if (flag === "--validate-only") options.validateOnly = true;
    else if (flag === "--preview") options.preview = true;
    else if (flag === "--entry" || flag === "--out") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
      if (flag === "--entry") options.entry = validateId(value);
      else options.out = path.resolve(value);
    } else throw new Error(`unknown option ${flag}`);
  }
  if (options.all === Boolean(options.entry))
    throw new Error("usage: node codegen/tools/check-tts.mjs (--entry <id> | --all) [--validate-only] [--out <root-directory>] [--preview]");
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  let baseline, entries;
  try {
    const { getChallengeBaseline } = await import("./challenge-baseline.mjs");
    baseline = getChallengeBaseline({ preview: options.preview });
    entries = options.entry
      ? [validateEntry(path.join(SUBMISSIONS, options.entry), { baseline })]
      : readEntries({ submissionsDir: SUBMISSIONS, baseline });
    if (options.preview && entries.length)
      throw new Error("--preview is only for initial no-entry foundation validation");
  } catch (error) {
    let entryId = options.entry || error.entryId || null;
    try { if (entryId) validateId(entryId); } catch { entryId = null; }
    const outDir = entryId ? path.join(options.out, entryId) : options.out;
    const report = {
      schemaVersion: 1, challenge: "tts-v1", entryId, sourceSha256: null,
      status: "failed", ok: false, mode: "validation",
      createdAt: new Date().toISOString(), provenance: { baseline: baseline || null },
      errors: [error.message], calls: [], artifacts: [],
      scope: { completeConformance: false, automated: [], manualUnverified: MANUAL, entrantScriptsExecuted: false },
    };
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.error(`TTS validation failed: ${error.message}; report: ${path.join(outDir, "report.json")}`);
    return 1;
  }
  if (!entries.length) {
    console.log(`TTS v1: no entries; ${baseline ? `baseline ${baseline}` : "uncommitted foundation preview"}. No WASM loaded; no TTS implementation verified.`);
    return 0;
  }
  if (!baseline) throw new Error("preview cannot run or validate entries without a committed challenge baseline");
  let failed = false;
  for (const entry of entries) {
    const outDir = path.join(options.out, entry.metadata.id);
    const report = await checkEntry(entry, { outDir, validateOnly: options.validateOnly });
    console.log(`${entry.metadata.id}: ${report.status} (${report.mode}); report: ${path.join(outDir, "report.json")}`);
    for (const error of report.errors) console.error(`  ${error}`);
    for (const call of report.calls) {
      if (call.status === "not-run") console.error(`  ${call.name}: NOT RUN — ${call.reason}`);
      for (const check of call.checks || [])
        if (!check.ok) console.error(`  ${call.name}/${check.name}: ${check.detail}`);
    }
    failed ||= !report.ok;
  }
  console.log("Automated checks do not establish intelligibility, AY-only compliance, UI behavior, physical loading, or hardware conformance.");
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(`TTS check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
