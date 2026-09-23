// Wirethroat tests. Not run by check-tts.mjs.
//   node codegen/challenges/tts/v1/submissions/grok-4-7/test.mjs
import fs from "node:fs";
import { assemble } from "../../../../../tools/asm6502.mjs";
import harness from "../../../../../tools/harness.cjs";
import { phonemeRecords } from "./generate.mjs";

const CLOCK = 1_573_437.5;
const SRC = new URL("./tts.s", import.meta.url);
const source = fs.readFileSync(SRC, "utf8");
const asm = assemble(source);
const NAMES = [null,"GAP","COM","STP","QRY","AE","EH","IH","AA","AH","AO","UH","ER","EY","IY","AY","OW","UW","AW","OY","P","B","T","D","K","G","F","V","TH","DH","S","Z","SH","ZH","HH","M","N","NG","L","R","W","Y","CH","JH"];
let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
}

const records = phonemeRecords();
const ptab = asm.symbols.PTAB - asm.org;
const table = asm.bytes.subarray(ptab, ptab + records.length * 8);
const expected = records.flatMap(r => r.bytes);
check("phoneme table matches generate.mjs", table.length === expected.length && expected.every((b, i) => table[i] === b),
  `${table.length} bytes`);

const session = await harness.boot();
const vm = session.vm;
if (!vm.enableAudio(48000)) throw new Error("audio enable failed");
session.load(asm.bytes, asm.org);
const ptr = asm.symbols.TTS_INPUT;
const speak = asm.symbols.TTS_SPEAK;
const init = asm.symbols.TTS_INIT;
const ph = asm.symbols.PHBUF;
const romBefore = [0xd000, 0xe000, 0xf000, 0xffff, 0x9000].map(a => [a, vm.memoryMapping(a)]);

function install(addr) {
  const tramp = new Uint8Array(16).fill(0xea);
  tramp.set([0xd8, 0xa9, ptr & 255, 0xa2, ptr >> 8, 0x20, addr & 255, addr >> 8, 0x4c, 0x10, 0x03]);
  vm.loadData(0x300, tramp);
  vm.loadData(0x310, Uint8Array.of(0x4c, 0x10, 0x03));
  vm.readBus(0xc010);
  vm.clearBreakpoints();
  vm.addBreakpoint(0x308);
  vm.setPC(0x300);
}

function runUntil(seconds) {
  const limit = Math.floor(CLOCK * seconds);
  let cycles = 0;
  const pcm = [];
  while (cycles < limit) {
    const n = vm.runCycles(Math.min(8192, limit - cycles));
    cycles += n;
    pcm.push(...vm.drainAudio());
    vm.drainOutput();
    if (vm.breakpointHit() && vm.pc() === 0x308) return { returned: true, cycles, pcm };
    if (n <= 0) break;
  }
  return { returned: false, cycles, pcm, pc: vm.pc() };
}

function audioPeak(pcm) {
  let peak = 0;
  for (const s of pcm) peak = Math.max(peak, Math.abs(s));
  return peak;
}

function phones() {
  const out = [];
  for (let i = 0; i < 96; i++) {
    const v = vm.peek(ph + i);
    if (v === 0) break;
    out.push(NAMES[v] || `#${v}`);
  }
  return out.join(" ");
}

function callSpeak(text, seconds = 20) {
  const raw = Buffer.from(`${text}\0`, "ascii");
  vm.loadData(ptr, raw);
  const sp = vm.sp();
  install(speak);
  const result = runUntil(seconds);
  const preserved = raw.every((b, i) => vm.peek(ptr + i) === b);
  return { ...result, a: vm.regA(), sp, spAfter: vm.sp(), preserved, phones: phones(), peak: audioPeak(result.pcm) };
}

function settleQuiet() {
  vm.clearBreakpoints();
  vm.loadData(0x310, Uint8Array.of(0x4c, 0x10, 0x03));
  vm.setPC(0x310);
  let cycles = 0;
  const settle = Math.floor(CLOCK * 0.25);
  const measure = Math.floor(CLOCK * 0.15);
  while (cycles < settle) {
    cycles += vm.runCycles(Math.min(8192, settle - cycles));
    vm.drainAudio();
  }
  cycles = 0;
  const pcm = [];
  while (cycles < measure) {
    cycles += vm.runCycles(Math.min(8192, measure - cycles));
    pcm.push(...vm.drainAudio());
  }
  return audioPeak(pcm);
}

install(init);
const initRun = runUntil(2);
check("TTS_INIT returns", initRun.returned, `${initRun.cycles} cycles`);
const romAfter = romBefore.map(([a]) => [a, vm.memoryMapping(a)]);
check("upper ROM mapping unchanged", romBefore.filter(([a]) => a >= 0xd000).every(([a, m]) => vm.memoryMapping(a) === m),
  romAfter.map(([a, m]) => `${a.toString(16)}=${m}`).join(" "));
check("BASIC window still selected", vm.memoryMapping(0x9000) === romBefore.find(([a]) => a === 0x9000)[1],
  `9000=${vm.memoryMapping(0x9000)}`);
const ier = vm.readBus(0xc40e);
check("Mockingboard IRQ enables cleared", (ier & 0x7f) === 0, `IER=$${ier.toString(16)}`);
check("init settles silent", settleQuiet() < 0.0005, "");

const empty = callSpeak("");
check("empty A=0", empty.returned && empty.a === 0 && empty.peak < 0.0005, `A=${empty.a} peak=${empty.peak}`);
check("empty silent after return", settleQuiet() < 0.0005);
const spaces = callSpeak("   ");
check("spaces A=0 quiet", spaces.returned && spaces.a === 0 && spaces.peak < 0.0005, `peak=${spaces.peak}`);
const bad = callSpeak("HELLO 3");
check("invalid A=2 quiet", bad.returned && bad.a === 2 && bad.peak < 0.0005, `A=${bad.a} peak=${bad.peak}`);
const over = callSpeak("A".repeat(121), 2);
check("121st char A=2", over.returned && over.a === 2 && over.preserved, `A=${over.a}`);
check("overlength silent", settleQuiet() < 0.0005);

const hello = callSpeak("HELLO");
check("HELLO phonemes", hello.phones === "HH EH L AO UH", hello.phones);
check("HELLO audible and preserved", hello.a === 0 && hello.preserved && hello.peak > 0.01, `peak=${hello.peak}`);
check("HELLO stack balanced", hello.sp === hello.spAfter, `${hello.sp} -> ${hello.spAfter}`);
check("HELLO silent after return", settleQuiet() < 0.0005);
const hello2 = callSpeak("HELLO");
check("repeated HELLO audible", hello2.a === 0 && hello2.peak > 0.01 && hello2.phones === hello.phones, `peak=${hello2.peak}`);
const lower = callSpeak("hello. this computer can talk.");
check("lowercase normalized", lower.a === 0 && lower.phones.startsWith("HH EH L AO UH"), lower.phones);

check("SOFTWARE", callSpeak("SOFTWARE").phones === "S AO F T W EH R");
check("COMPUTER", callSpeak("COMPUTER").phones === "K AH M P Y UW T ER");
check("PRESS stays unvoiced", callSpeak("PRESS").phones === "P R EH S");

const long = `${"THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG. ".repeat(3)}`.slice(0, 120);
const cancel = callSpeak(long, 0.04);
check("does not finish before escape window", !cancel.returned, `returned=${cancel.returned}`);
vm.keyDown(27);
const rest = runUntil(1.2);
check("escape cancels with A=1", rest.returned && vm.regA() === 1, `A=${vm.regA()} pc=${vm.pc().toString(16)}`);
check("cancel settles silent", settleQuiet() < 0.0005);
const after = callSpeak("WE MAKE NEW SOFTWARE");
check("speaks after cancel", after.a === 0 && after.peak > 0.01, after.phones);

// Interactive UI
vm.readBus(0xc010);
vm.clearBreakpoints();
vm.setPC(asm.org);
let screen = [];
let cycles = 0;
while (cycles < Math.floor(CLOCK * 2)) {
  cycles += vm.runCycles(20000);
  vm.drainOutput();
  screen = session.textScreen();
  if (screen.some(row => row.includes("WIRETHROAT"))) break;
}
check("UI banner", screen.some(row => row.includes("WIRETHROAT")), screen.slice(0, 3).join(" | "));
function tap(code, budget = 80000) {
  vm.keyDown(code);
  let n = 0;
  while (n < budget) n += vm.runCycles(5000);
  vm.drainOutput();
  return session.textScreen();
}
screen = tap(72); // H
screen = tap(73); // I
check("UI shows typed text", screen.some(row => row.includes("HI")), screen.slice(4, 8).join(" | "));
screen = tap(8); // backspace
check("UI deletes", screen.some(row => row.includes("> H")) && !screen.some(row => row.includes("HI")), screen.slice(4, 6).join(" | "));
screen = tap(49); // '1'
check("UI rejects unsupported", screen.some(row => row.includes("UNSUPPORTED")), screen[10] || "");
const input = asm.symbols.TTS_INPUT;
const uilen = asm.symbols.UILEN;
for (let i = 0; i < 119; i++) vm.poke(input + i, 0x41);
vm.poke(input + 119, 0);
vm.poke(uilen, 119);
screen = tap(66, 80000); // 120th char, B
check("UI accepts the 120th character", screen.some(row => row.includes("BB") || row.includes("B")), screen.slice(4, 8).join(" | "));
screen = tap(67, 80000); // 121st rejected
check("UI reports 120 limit", screen.some(row => row.includes("LIMIT IS 120")), screen[10] || "");
vm.keyDown(27);
let serial = "";
cycles = 0;
while (cycles < Math.floor(CLOCK * 2)) {
  cycles += vm.runCycles(20000);
  serial += vm.drainOutput();
  if (serial.includes("*")) break;
}
check("ESC at input returns to monitor", serial.includes("*"), serial.slice(-80));

vm.delete();
if (failed) {
  console.error(`${failed} failed`);
  process.exitCode = 1;
} else {
  console.log("all wirethroat tests passed");
}
