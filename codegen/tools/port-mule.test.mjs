// Tests for the M.U.L.E. port (port-mule.mjs and codegen/patches/mule/).
//
//   node codegen/tools/port-mule.test.mjs
//
// Without the game: the floating-point package against an independent
// decimal reference, the runtime/renderer/loader builds and their layout
// limits, the font and the 40-column pixel table.
//
// With MULE_ATR=<path to the owner's M.U.L.E. .atr> (and web/build.ps1 run):
// converts the disk (running the intro headlessly), boots the folder on the
// WASM 3RIC from a generated SD card, presses the SNES pads and checks that
// the main game reaches its status summary and the land grant, with the
// hi-res page drawn. Set MULE_SHOTS=<dir> to keep PNG screenshots.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";
import * as P from "./port-mule.mjs";
import { Cpu } from "./mule-intro.mjs";
import { buildFont } from "../patches/mule/font.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
const ok = (name) => { passed++; console.log(`ok - ${name}`); };

// ---------------------------------------------------------------- FP
// Independent reference: values as exact decimal strings via BigInt.
function toFp(digits, exp10, neg) {
  // value = 0.digits * 10^exp10 -> Atari base-100 form, 10 digits, rounded
  let d = digits.replace(/^0+/, "");
  if (!d) return [0, 0, 0, 0, 0, 0];
  exp10 -= digits.length - digits.replace(/^0+/, "").length;
  if ((exp10 & 1) !== 0) { d = "0" + d; exp10 += 1; }    // align to base 100
  let m = BigInt((d + "0".repeat(12)).slice(0, 12));
  m = (m + 50n) / 100n;                                  // round to 10 digits
  if (m >= 10n ** 10n) { m /= 100n; exp10 += 2; }
  const s = m.toString().padStart(10, "0");
  if (s.startsWith("00")) { return toFp(s.slice(2) + "00", exp10 - 2, neg); }
  const e = exp10 / 2 - 1 + 64;
  if (e <= 0 || e > 127) return null;
  const out = [(neg ? 0x80 : 0) | e];
  for (let i = 0; i < 5; i++) out.push((+s[2 * i] << 4) | +s[2 * i + 1]);
  return out;
}
const fpOf = (x) => { // x as exact BigInt ratio n/10^k
  const neg = x.n < 0n; const n = neg ? -x.n : x.n;
  const s = n.toString(); return toFp(s, s.length - x.k, neg);
};
const valOf = (b) => { // FP bytes -> {n, k}
  if (!b[1]) return { n: 0n, k: 0 };
  let m = 0n; for (let i = 1; i <= 5; i++) m = m * 100n + BigInt((b[i] >> 4) * 10 + (b[i] & 15));
  const e = (b[0] & 0x7f) - 64; // value = m * 100^(e-4)
  const k = 2 * (4 - e);
  const v = k >= 0 ? { n: m, k } : { n: m * 10n ** BigInt(-k), k: 0 };
  if (b[0] & 0x80) v.n = -v.n;
  return v;
};
const norm = (a, b) => { const k = Math.max(a.k, b.k); return [a.n * 10n ** BigInt(k - a.k), b.n * 10n ** BigInt(k - b.k), k]; };
const ops = {
  add: (a, b) => { const [x, y, k] = norm(a, b); return { n: x + y, k }; },
  sub: (a, b) => { const [x, y, k] = norm(a, b); return { n: x - y, k }; },
  mul: (a, b) => ({ n: a.n * b.n, k: a.k + b.k }),
  div: (a, b) => { const [x, y] = norm(a, b); return { n: (x * 10n ** 30n) / y, k: 30 }; },
};

function testFp() {
  const src = "FPW = $0400\n" + fs.readFileSync(path.join(here, "..", "patches", "mule", "fp.s"), "utf8");
  const r = assemble(src);
  const mem = new Uint8Array(0x10000);
  for (const L of r.listing) for (let k = 0; k < L.bytes.length; k++) mem[L.pc + k] = L.bytes[k];
  const cpu = new Cpu((a) => mem[a], (a, v) => { mem[a] = v & 0xff; });
  const call = (addr) => {
    cpu.s = 0xfd; mem[0x1ff] = 0xff; mem[0x1fe] = 0xef; cpu.pc = addr; cpu.d = 0;
    for (let n = 0; cpu.pc !== 0xfff0; n++) { if (n > 1e6) throw new Error("FP hang"); cpu.step(); }
    return cpu.c;
  };
  const put = (a, b) => b.forEach((v, i) => { mem[a + i] = v; });
  const get = (a) => [...mem.slice(a, a + 6)];
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const rv = () => {
    const kind = rnd();
    if (kind < 0.4) return { n: BigInt(Math.floor(rnd() * 20000) - 5000), k: 0 };
    if (kind < 0.7) return { n: BigInt(Math.floor(rnd() * 2e6) - 5e5), k: 2 };
    return { n: BigInt(Math.floor(rnd() * 1e9) + 1), k: Math.floor(rnd() * 14) };
  };
  const ulp = (b) => valOf([b[0], 0, 0, 0, 0, 1]);   // one unit in the last place
  let n = 0;
  for (const [name, addr] of [["add", 0xda66], ["sub", 0xda60], ["mul", 0xdadb], ["div", 0xdb28]]) {
    for (let i = 0; i < 400; i++) {
      const a = valOf(fpOf(rv())), b = valOf(fpOf(rv()));
      if (name === "div" && b.n === 0n) continue;
      put(0xd4, fpOf(a) || [0, 0, 0, 0, 0, 0]); put(0xe0, fpOf(b) || [0, 0, 0, 0, 0, 0]);
      call(addr);
      const want = fpOf(ops[name](a, b));
      if (!want) continue;
      const got = get(0xd4);
      const [g, w] = norm(valOf(got), valOf(want));
      const diff = g > w ? g - w : w - g;
      const [u] = norm(ulp(want), { n: 0n, k: valOf(got).k });
      assert.ok(diff <= u, `FP ${name}: ${JSON.stringify([a, b].map(String))} got ${got} want ${want}`);
      n++;
    }
  }
  for (let i = 0; i < 300; i++) {                     // IFP / FPI
    const v = Math.floor(rnd() * 65536);
    mem[0xd4] = v & 0xff; mem[0xd5] = v >> 8;
    call(0xd9aa);
    assert.deepEqual(get(0xd4), fpOf({ n: BigInt(v), k: 0 }) || [0, 0, 0, 0, 0, 0], `IFP ${v}`);
    assert.equal(call(0xd9d2), 0);
    assert.equal(mem[0xd4] | (mem[0xd5] << 8), v, `FPI ${v}`);
  }
  put(0xd4, fpOf({ n: 7000000n, k: 0 })); assert.equal(call(0xd9d2), 1, "FPI out of range sets carry");
  const fasc = (x) => {
    put(0xd4, fpOf(x) || [0, 0, 0, 0, 0, 0]); call(0xd8e6);
    let s = ""; const p = mem[0xf3] | (mem[0xf4] << 8);
    for (let i = 0; i < 24; i++) { s += String.fromCharCode(mem[p + i] & 0x7f); if (mem[p + i] & 0x80) break; }
    return s;
  };
  assert.equal(fasc({ n: 0n, k: 0 }), "0");
  assert.equal(fasc({ n: 1000n, k: 0 }), "1000");
  assert.equal(fasc({ n: 65535n, k: 0 }), "65535");
  assert.equal(fasc({ n: -42n, k: 0 }), "-42");
  assert.equal(fasc({ n: 125n, k: 1 }), "12.5");
  assert.equal(fasc({ n: 5n, k: 1 }), ".5");
  assert.equal(fasc({ n: 5n, k: 2 }), ".05");
  assert.equal(fasc({ n: 10000000000n, k: 0 }), "1E+10");
  assert.equal(fasc({ n: 1234n, k: 6 }), "1.234E-03");
  ok(`floating point: ${n} arithmetic results within one unit, IFP/FPI round trips, FASC formats`);
}

// ---------------------------------------------------------------- build
function testBuild() {
  const rt = P.buildRuntime();
  assert.equal(rt.b1[0xdfff], 0xa5, "bank 1 signature");
  assert.equal(rt.b2[0xdfff], 0x5a, "bank 2 signature");
  for (const [a, op] of [[0xd8e6, 0x4c], [0xd9aa, 0x4c], [0xd9d2, 0x4c], [0xda60, 0x4c], [0xda66, 0x4c], [0xdadb, 0x4c],
    [0xdb28, 0x4c], [0xdd89, 0x4c], [0xdd98, 0x4c], [0xdda7, 0x4c], [0xddb6, 0x4c]]) assert.equal(rt.b2[a], op, `FP entry ${a.toString(16)}`);
  for (let a = 0xd000; a < 0xd020; a++) assert.equal(rt.b2[a], 0, "GTIA register file starts clear");
  for (let a = 0xd400; a < 0xd410; a++) assert.equal(rt.b2[a], 0, "ANTIC register file starts clear (no display)");
  assert.ok(rt.rt.RT_RAM2_END <= 0xd000 && rt.render.RENDER_END <= 0xdfff, "runtime fits");
  assert.equal(rt.shared[P.LAYOUT.RG + 0x1f], 7, "console keys up");
  for (let i = 0; i < 8; i++) assert.equal(rt.shared[P.LAYOUT.RP + i], 228, "no paddles");
  const font = buildFont();
  assert.equal(font.length, 1024);
  for (let c = 16; c < 26; c++) assert.ok(font.subarray(c * 8, c * 8 + 8).some((v) => v), `digit glyph ${c - 16}`);
  assert.ok(font.subarray(0, 8).every((v) => v === 0), "space is blank");
  const t2 = P.t2Table();
  assert.equal(t2[0x80], 0x01, "leftmost Atari pixel = leftmost hi-res pixel");
  assert.equal(t2[0x01], 0x40, "the last two Atari pixels share the last hi-res pixel");
  assert.equal(t2[0xff], 0x7f);
  const files = ["WIN.BIN", "RTB2.BIN", "RTB1.BIN", "RAM2.BIN", "LOW.BIN", "CFG.BIN", "G1.BIN", "G2.BIN"]
    .map((name, i) => ({ name, data: new Uint8Array(100 + i).fill(i + 1), addr: 0x4000 }));
  const loader = P.buildLoader(files, rt.rt);
  assert.ok(loader.length > 300 && loader.length <= 0x400, "loader fits below its staging area");
  const text = Buffer.from(loader).toString("latin1");
  assert.ok(text.includes("FLOAD G2.BIN 4000 0000 006A"), "FLOAD commands with inclusive end offsets");
  ok("runtime, renderer, loader and font build within their layout");
}

// ---------------------------------------------------------------- real disk
async function testRealDisk(atrPath) {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const harness = require("./harness.cjs");
  const { buildSparseFat32 } = await import("./ultima5/fat32.mjs");
  const { runIntro } = await import("./mule-intro.mjs");
  const atr = fs.readFileSync(atrPath);
  const handoff = runIntro(atr, { players: 2, level: "BEGINNER" });
  const conv = P.convert(atr, handoff);
  assert.ok(conv.known, `known release (main image SHA-256 ${conv.hash})`);
  const s = await harness.boot({ sd: buildSparseFat32({ [P.FOLDER]: conv.files }) });
  const vm = s.vm;
  for (const line of [`CD ${P.FOLDER}\r`, "BRUN MULE.PRG 2000\r"]) {
    for (const ch of line) { vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0)); for (let i = 0; i < 8; i++) vm.run(20000); }
    for (let i = 0; i < 40; i++) vm.run(50000);
  }
  const atText = () => { let t = ""; for (let i = 0; i < 120; i++) { const c = vm.peek(0xb500 + i) & 0x7f; t += c < 64 ? String.fromCharCode(c + 32) : " "; } return t; };
  const shots = process.env.MULE_SHOTS;
  const shot = (name) => {
    if (!shots) return;
    const rgba = vm.renderFrame(), W = vm.frameWidth(), H = vm.frameHeight();
    const raw = Buffer.alloc((W * 3 + 1) * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) raw[y * (W * 3 + 1) + 1 + x * 3 + c] = rgba[(y * W + x) * 4 + c];
    const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
    fs.mkdirSync(shots, { recursive: true });
    fs.writeFileSync(path.join(shots, name), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  };
  const seen = new Set();
  for (let t = 0; t < 120 && !seen.has("land"); t++) {
    vm.setGamepadState(0, t % 3 === 0 ? 1 : 0);                  // B on pad 1
    vm.setGamepadState(1, t % 3 === 1 ? 1 : 0);                  // and pad 2
    for (let i = 0; i < 12; i++) vm.run(50000);
    const txt = atText();
    if (/STATUS SUMMARY/.test(txt) && !seen.has("status")) { seen.add("status"); shot("mule-status.png"); }
    if (/LAND GRANT/.test(txt)) { seen.add("land"); for (let i = 0; i < 120; i++) vm.run(50000); shot("mule-land-grant.png"); }
  }
  assert.ok(seen.has("status"), "status summary reached");
  assert.ok(seen.has("land"), "land grant reached");
  let lit = 0; for (let a = 0x2000; a < 0x4000; a++) if (vm.peek(a) & 0x7f) lit++;
  assert.ok(lit > 200, `hi-res page drawn (${lit} non-blank bytes)`);
  ok("original disk: intro hand-off, SD boot, status summary and land grant on the hi-res page");
}

testFp();
testBuild();
if (process.env.MULE_ATR) await testRealDisk(process.env.MULE_ATR);
else console.log("# MULE_ATR not set: skipping the original-disk run");
console.log(`# ${passed} passed`);
