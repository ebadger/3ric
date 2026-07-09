// run6502.mjs — CLI to assemble/load a 3ric program, run it headlessly on the
// emulator, apply pass/fail checks, and (optionally) emit the card-ready .PRG.
//
// This is the primary tool the codegen loop drives: give it a .s source (or a
// raw .prg/.bin + --org), declare what success looks like, and it returns a
// verdict you can iterate against.
//
// Usage:
//   node run6502.mjs <input.s|input.prg> [options]
//
// Options:
//   --org 0xADDR            Load/entry address. For .s, overrides/supplies .org.
//                           Required for raw .prg/.bin images.
//   --out FILE.prg          Write the raw image (card-ready .PRG) to FILE.
//   --sd FILE.sparse        Mount a FAT32 SD image while running.
//   --max-cycles N          Cycle budget before "timeout" (default 20000000).
//   --expect-halt REASON    Assert halt reason: brk-monitor|wai|idle|timeout.
//   --expect-serial STR     Assert serial output contains STR. Repeatable.
//   --expect-serial-re RE   Assert serial matches JS regex RE. Repeatable.
//   --expect-mem A=V        Assert byte at address A equals V (hex ok). Repeatable.
//   --expect-a V / --expect-x V / --expect-y V   Assert final register value.
//   --json                  Emit only the JSON verdict.
//   --quiet                 Suppress the serial/text dump in the human summary.
//
// Exit code is 0 only when the program halted cleanly AND every declared check
// passed; otherwise 1.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";
import harnessPkg from "./harness.cjs";
const { boot } = harnessPkg;

function parseArgs(argv) {
  const o = { expectSerial: [], expectSerialRe: [], expectMem: [], _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--org": o.org = toNum(next()); break;
      case "--out": o.out = next(); break;
      case "--sd": o.sd = next(); break;
      case "--max-cycles": o.maxCycles = toNum(next()); break;
      case "--expect-halt": o.expectHalt = next(); break;
      case "--expect-serial": o.expectSerial.push(next()); break;
      case "--expect-serial-re": o.expectSerialRe.push(next()); break;
      case "--expect-mem": o.expectMem.push(next()); break;
      case "--expect-a": o.expectA = toNum(next()); break;
      case "--expect-x": o.expectX = toNum(next()); break;
      case "--expect-y": o.expectY = toNum(next()); break;
      case "--json": o.json = true; break;
      case "--quiet": o.quiet = true; break;
      default:
        if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
        o._.push(a);
    }
  }
  return o;
}

function toNum(s) {
  if (s == null) throw new Error("missing numeric argument");
  const v = /^0x/i.test(s) ? parseInt(s, 16) : /^\$/.test(s) ? parseInt(s.slice(1), 16) : Number(s);
  if (Number.isNaN(v)) throw new Error(`bad number: ${s}`);
  return v;
}

function hex(n, w = 2) { return "$" + (n & (w === 2 ? 0xff : 0xffff)).toString(16).toUpperCase().padStart(w, "0"); }

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const input = opt._[0];
  if (!input) { console.error("usage: node run6502.mjs <input.s|input.prg> [options]"); process.exit(2); }

  // --- obtain raw image bytes + org ---
  const ext = path.extname(input).toLowerCase();
  let org, bytes, symbols = {};
  if (ext === ".prg" || ext === ".bin") {
    if (opt.org == null) throw new Error("raw images require --org");
    org = opt.org & 0xffff;
    bytes = new Uint8Array(fs.readFileSync(input));
  } else {
    const src = fs.readFileSync(input, "utf8");
    ({ org, bytes, symbols } = assemble(src, opt.org != null ? { org: opt.org } : {}));
  }

  if (opt.out) { fs.writeFileSync(opt.out, Buffer.from(bytes)); }

  // --- run ---
  const sd = opt.sd ? fs.readFileSync(opt.sd) : undefined;
  const session = await boot({ sd });
  session.load(bytes, org);
  const result = session.run({ org, maxCycles: opt.maxCycles });

  // --- checks ---
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  if (opt.expectHalt) add(`halt==${opt.expectHalt}`, result.halt === opt.expectHalt, `got ${result.halt}`);
  for (const s of opt.expectSerial) add(`serial contains ${JSON.stringify(s)}`, result.serial.includes(s));
  for (const re of opt.expectSerialRe) add(`serial matches /${re}/`, new RegExp(re).test(result.serial));
  for (const pair of opt.expectMem) {
    const m = pair.match(/^([^=]+)=(.+)$/);
    if (!m) throw new Error(`bad --expect-mem ${pair} (want A=V)`);
    const a = toNum(m[1]) & 0xffff, v = toNum(m[2]) & 0xff, got = session.peek(a);
    add(`mem[${hex(a, 4)}]==${hex(v)}`, got === v, `got ${hex(got)}`);
  }
  if (opt.expectA != null) add(`A==${hex(opt.expectA)}`, result.registers.a === (opt.expectA & 0xff), `got ${hex(result.registers.a)}`);
  if (opt.expectX != null) add(`X==${hex(opt.expectX)}`, result.registers.x === (opt.expectX & 0xff), `got ${hex(result.registers.x)}`);
  if (opt.expectY != null) add(`Y==${hex(opt.expectY)}`, result.registers.y === (opt.expectY & 0xff), `got ${hex(result.registers.y)}`);

  const cleanHalt = result.halt === "brk-monitor" || result.halt === "wai" || result.halt === "idle";
  const checksPass = checks.every((c) => c.ok);
  const ok = checksPass && (opt.expectHalt ? true : cleanHalt);

  const verdict = {
    ok, halt: result.halt, cycles: result.cycles,
    org: hex(org, 4), size: bytes.length,
    registers: result.registers, dump: result.dump,
    serial: result.serial, checks,
    symbols: Object.fromEntries(Object.entries(symbols).map(([k, v]) => [k, hex(v, 4)])),
    out: opt.out || null,
  };

  if (opt.json) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    console.log(`input : ${input}`);
    console.log(`org   : ${hex(org, 4)}  size: ${bytes.length} bytes${opt.out ? `  -> ${opt.out}` : ""}`);
    console.log(`halt  : ${result.halt}   cycles: ${result.cycles}`);
    const R = result.registers;
    console.log(`regs  : A=${hex(R.a)} X=${hex(R.x)} Y=${hex(R.y)} SP=${hex(R.sp)} P=${hex(R.status)} PC=${hex(R.pc, 4)}`);
    if (!opt.quiet) {
      console.log(`serial: ${JSON.stringify(result.serial)}`);
      const nonEmpty = result.text.filter((l) => l.trim() !== "");
      if (nonEmpty.length) { console.log("text  :"); for (const l of nonEmpty) console.log("  | " + l); }
    }
    if (checks.length) {
      console.log("checks:");
      for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail && !c.ok ? "  (" + c.detail + ")" : ""}`);
    }
    console.log(ok ? "\nVERDICT: PASS" : "\nVERDICT: FAIL");
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(2); });
