// Entry-local tests for claude-opus-5-5-run-1 (does not replace check-tts).
//   node codegen/challenges/tts/v1/submissions/claude-opus-5-5-run-1/test.mjs [--wav]
// Checks: generated data is in sync, on-6502 letter-to-sound matches the
// reference model in generate.mjs, the interactive UI (typing, delete, limit,
// unsupported keys, Enter speaks and returns, Escape cancels, Escape-at-input
// BRKs to the monitor), repeated utterances, ROM mapping, VIA state, silence.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildGenerated, textToCodes, codesToText } from './generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..', '..', '..');
const require = createRequire(import.meta.url);
const harness = require(path.join(ROOT, 'codegen', 'tools', 'harness.cjs'));
const { assemble } = await import(pathToUrl(path.join(ROOT, 'codegen', 'tools', 'asm6502.mjs')));
function pathToUrl(p) { return new URL('file:///' + p.replace(/\\/g, '/')).href; }

const CLOCK = 1_573_437.5;
const WANT_WAV = process.argv.includes('--wav');
const OUT = path.join(ROOT, 'codegen', 'out', 'tts-v1', 'claude-opus-5-5-run-1', 'entry-tests');
let failures = 0, passes = 0;
const ok = (cond, name, detail = '') => {
  if (cond) passes++; else failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' -- ' + detail : ''}`);
};

// ---------------------------------------------------------------- generated block in sync
const src = fs.readFileSync(path.join(HERE, 'tts.s'), 'utf8');
{
  const m = src.match(/; >>> GENERATED DATA \(generate\.mjs\)\r?\n([\s\S]*?); <<< GENERATED DATA/);
  const norm = (s) => s.replace(/\r\n/g, '\n').trim();
  ok(m && norm(m[1]) === norm(buildGenerated()), 'generated-data-in-sync', 'run node generate.mjs if this fails');
}

const asm = assemble(src);
const sym = Object.fromEntries(Object.entries(asm.symbols).map(([k, v]) => [k.toUpperCase(), v]));
ok(asm.org === 0x0800 && asm.org + asm.bytes.length <= 0x4000, 'image-below-work-buffers',
  `$${asm.org.toString(16)}..$${(asm.org + asm.bytes.length - 1).toString(16)}`);

const session = await harness.boot();
const vm = session.vm;
vm.enableAudio(48000);
const romMap = [0xd000, 0xe000, 0xf000, 0xffff].map((a) => vm.memoryMapping(a));
session.load(asm.bytes, asm.org);

const CALLER = 0x0300, RET = 0x0308, IDLE = 0x0310;
function call(routine, text, { escAt = null, maxSec = 90, wav = null } = {}) {
  const ptr = sym.TTS_INPUT;
  if (text != null) vm.loadData(ptr, Buffer.from(text + '\0', 'ascii'));
  const t = new Uint8Array(32).fill(0xea);
  t.set([0xd8, 0xa9, ptr & 255, 0xa2, ptr >> 8, 0x20, sym[routine] & 255, sym[routine] >> 8]);
  t.set([0x4c, IDLE & 255, IDLE >> 8], IDLE - CALLER);
  vm.loadData(CALLER, t);
  vm.readBus(0xc010);
  vm.clearBreakpoints();
  vm.addBreakpoint(RET);
  vm.setPC(CALLER);
  const sp = vm.sp();
  let cycles = 0, escCycle = null, returned = false, first = null;
  const pcm = [];
  vm.drainAudio();
  while (cycles < maxSec * CLOCK) {
    if (escAt != null && escCycle == null && cycles >= escAt * CLOCK) { vm.keyDown(27); escCycle = cycles; }
    cycles += vm.runCycles(8192);
    const a = vm.drainAudio(); if (wav) pcm.push(Float32Array.from(a));
    if (first == null && a.some((v) => Math.abs(v) > 1e-3)) first = cycles;
    vm.drainOutput();
    if (vm.breakpointHit() && vm.pc() === RET) { returned = true; break; }
  }
  vm.clearBreakpoints();
  return { a: vm.regA(), returned, cycles, escCycle, spOk: vm.sp() === sp, pcm, first };
}
function quietAfter(sec = 0.4) {
  vm.loadData(IDLE, Uint8Array.of(0x4c, IDLE & 255, IDLE >> 8));
  vm.setPC(IDLE);
  let c = 0; vm.drainAudio();
  while (c < 0.25 * CLOCK) c += vm.runCycles(8192);
  vm.drainAudio(); c = 0;
  let peak = 0, ss = 0, n = 0, mean = 0;
  const all = [];
  while (c < (sec - 0.25) * CLOCK) { c += vm.runCycles(8192); for (const v of vm.drainAudio()) all.push(v); }
  for (const v of all) mean += v; mean /= all.length || 1;
  for (const v of all) { peak = Math.max(peak, Math.abs(v - mean)); ss += (v - mean) ** 2; n++; }
  return { rms: Math.sqrt(ss / (n || 1)), peak };
}
function writeWav(file, chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const buf = Buffer.alloc(44 + total * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + total * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(48000, 24); buf.writeUInt32LE(48000 * 4, 28); buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(total * 2, 40);
  let o = 44;
  for (const c of chunks) for (const v of c) { buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), o); o += 2; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}
function readPHB() {
  const out = [];
  for (let a = sym.PHB; a < sym.PHB + 0x800; a++) { const b = session.peek(a); if (!b) break; out.push(b); }
  return out;
}

// ---------------------------------------------------------------- letter-to-sound parity
const PARITY = [
  'HELLO. THIS COMPUTER CAN TALK.', 'WE MAKE NEW SOFTWARE FOR OLD COMPUTERS.',
  'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.', 'PLEASE TYPE A SENTENCE AND PRESS ENTER.',
  'the weather is nice today, is it not?', 'I have 3 cats and 12 dogs!',
  'Knowledge; science: philosophy. Thought through enough rough dough.',
  "Don't stop believing, it's a machine reading station nation",
  'Phone photograph physics chemistry character school church',
  'A very long wordwithnospacesthatgoesonandonforeverandevermorebeyondsixtyletterstotal ok',
  'Each yellow bird flew quickly over houses where people sleep.',
  'measure treasure vision usual sure sugar ocean special',
];
for (const s of PARITY) {
  const r = call('TTS_G2P', s, { maxSec: 5 });
  const got = readPHB(), want = textToCodes(s);
  const same = r.returned && r.a === 0 && got.length === want.length && got.every((b, i) => b === want[i]);
  ok(same, `g2p-parity "${s.slice(0, 40)}"`, same ? '' : `\n  6502: ${codesToText(got)}\n  ref : ${codesToText(want)}`);
}

// ---------------------------------------------------------------- speech calls
const SPEAK = [
  ['public-1', 'HELLO. THIS COMPUTER CAN TALK.'],
  ['new-1', 'Good morning. My name is three rick, and I can read aloud.'],
  ['new-2', 'Is this the right way to the station?'],
  ['new-3', 'Seven green frogs sang loudly under a bright yellow moon.'],
  ['repeat-1', 'HELLO. THIS COMPUTER CAN TALK.'],
];
for (const [name, text] of SPEAK) {
  const r = call('TTS_SPEAK', text, { wav: WANT_WAV });
  const secs = r.cycles / CLOCK;
  ok(r.returned && r.a === 0 && r.spOk, `speak-${name}`, `A=${r.a} ${secs.toFixed(2)} s, first sound ${(r.first / CLOCK).toFixed(3)} s`);
  ok(romMap.every((m, i) => vm.memoryMapping([0xd000, 0xe000, 0xf000, 0xffff][i]) === m), `rom-mapping-after-${name}`);
  ok([0xc40e, 0xc48e].every((a) => (vm.readBus(a) & 0x7f) === 0), `via-ier-clear-after-${name}`);
  const q = quietAfter();
  ok(q.rms <= 1e-4 && q.peak <= 5e-4, `silent-after-${name}`, `rms=${q.rms.toExponential(2)}`);
  if (WANT_WAV) writeWav(path.join(OUT, `${name}.wav`), r.pcm);
}
{
  const long = 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG. '.repeat(3).slice(0, 120);
  const full = call('TTS_SPEAK', long);
  ok(full.returned && full.a === 0, 'speak-120-chars', `A=${full.a} ${(full.cycles / CLOCK).toFixed(2)} s, first sound after ${(full.first / CLOCK).toFixed(3)} s`);
  const r = call('TTS_SPEAK', long, { escAt: 0.05 });
  const lat = r.escCycle == null ? null : (r.cycles - r.escCycle) / CLOCK;
  ok(r.returned && r.a === 1 && lat != null && lat < 0.1, 'escape-cancel-during-analysis-120', `A=${r.a} latency=${lat?.toFixed(3)} s`);
  ok(quietAfter().rms <= 1e-4, 'silent-after-analysis-cancel');
}
{
  const r = call('TTS_SPEAK', 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.', { escAt: 0.3 });
  const lat = r.escCycle == null ? null : (r.cycles - r.escCycle) / CLOCK;
  ok(r.returned && r.a === 1 && lat != null && lat < 1, 'escape-cancel-mid-sentence', `A=${r.a} latency=${lat?.toFixed(3)} s`);
  const q = quietAfter();
  ok(q.rms <= 1e-4, 'silent-after-cancel', `rms=${q.rms.toExponential(2)}`);
  const r2 = call('TTS_SPEAK', 'Still here.');
  ok(r2.returned && r2.a === 0, 'speak-after-cancel');
}
for (const [text, want] of [['', 0], ['   ', 0], ['. , ?', 0], ['A'.repeat(121), 2], ['tab\there', 2], ['50%', 2]]) {
  const r = call('TTS_SPEAK', text, { maxSec: 2 });
  ok(r.returned && r.a === want, `abi-${JSON.stringify(text.slice(0, 12))}`, `A=${r.a} want ${want}`);
}

// ---------------------------------------------------------------- interactive UI
function dump(s) { return s.split('\n').filter((l) => l.trim()).join(' | '); }
function screen() { return session.textScreen().join('\n'); }
function runFor(sec) { let c = 0; while (c < sec * CLOCK) { c += vm.runCycles(8192); vm.drainAudio(); vm.drainOutput(); } }
function key(code, sec = 0.02) { vm.keyDown(code); runFor(sec); }
function typeText(s) { for (const ch of s) key(ch.charCodeAt(0)); }
vm.clearBreakpoints();
vm.setPC(asm.org);
runFor(0.3);
let scr = screen();
ok(/3RIC TALKS/.test(scr) && /TYPE/.test(scr), 'ui-title-and-prompt', '');
typeText('HELLO WORLDX');
key(8);
scr = screen();
ok(scr.includes('HELLO WORLD') && !scr.includes('HELLO WORLDX'), 'ui-type-and-delete');
key(0x18);
ok(!screen().includes('HELLO WORLD'), 'ui-ctrl-x-clears');
typeText('B'.repeat(125));
scr = screen();
ok(/120\/120/.test(scr) && /LIMIT/.test(scr), 'ui-120-limit', '');
key(0x18);
key('~'.charCodeAt(0));
ok(/UNSUPPORTED/.test(screen()), 'ui-unsupported-key-message');
typeText('HI THERE');
key(13, 0.2);
ok(/SPEAKING/.test(screen()), 'ui-enter-speaks');
runFor(3);
scr = screen();
ok(/DONE\. TYPE ANOTHER/.test(scr) && !scr.includes('HI THERE'), 'ui-returns-to-input-after-speech', dump(scr));
typeText('THIS SENTENCE WILL BE CANCELLED BY ESCAPE RIGHT AWAY');
key(13, 0.3);
key(27, 0.5);
ok(/STOPPED\./.test(screen()), 'ui-escape-cancels-speech', dump(screen()));
typeText('AGAIN');
key(13, 3);
ok(/DONE\./.test(screen()), 'ui-speaks-again-after-cancel', dump(screen()));
vm.drainOutput();
vm.keyDown(27);
let serial = '';
for (let c = 0; c < 0.5 * CLOCK;) { c += vm.runCycles(8192); vm.drainAudio(); serial += vm.drainOutput(); }
const md = serial.match(harness.MONITOR_DUMP);
ok(!!md, 'ui-escape-at-input-brk-monitor-dump', md ? md[0] : JSON.stringify(serial.slice(-120)));
ok(/EXIT TO MONITOR/.test(screen()), 'ui-exit-message');
{
  const rows = session.textScreen();
  const idx = rows.findIndex((l) => harness.MONITOR_DUMP.test(l));
  ok(idx >= 13, 'monitor-dump-below-ui', `row ${idx}: ${rows[idx] ?? ''}`);
  vm.drainOutput();
  typeText('0300.0307');
  key(13, 0.3);
  const after = vm.drainOutput() + '\n' + screen();
  ok(/0300-\s*D8 A9/i.test(after), 'monitor-accepts-command-after-brk', after.split('\n').filter((l) => /0300/.test(l)).slice(-1)[0] ?? '');
}
{
  const q = quietAfter(0.5);
  ok(q.rms <= 1e-4, 'silent-in-monitor', `rms=${q.rms.toExponential(2)}`);
}

console.log(`\n${passes} passed, ${failures} failed`);
if (WANT_WAV) console.log(`WAVs in ${OUT}`);
process.exit(failures ? 1 : 0);
