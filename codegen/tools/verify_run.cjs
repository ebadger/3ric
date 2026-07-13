// verify_run.cjs — headless verifier for the *autonomous* tutorial demos (e.g.
// the bouncing ball) that never halt on their own. Boots the 3ric WASM emulator
// through the shared harness, assembles a .s, runs a FIXED cycle budget, then
// prints a little state and checks byte-level memory assertions. The core is
// cycle-honest, so a fixed budget is deterministic: "observe once, then lock the
// values" gives a stable regression test.
//
// Companion to run6502.mjs: use run6502 when the program halts (brk / idle) and
// this when it runs forever. Both need a WASM build first (web/badger6502.js,
// produced by web/build.ps1).
//
// Usage:
//   node codegen/tools/verify_run.cjs <src.s> <orgHex> <cycles> [addr=val ...]
// Example:
//   node codegen/tools/verify_run.cjs codegen/programs/tut5_bounce.s 0x0800 2000000 0x08=0xFF
//
// Addresses and values accept 0x.. hex; each assertion compares a single byte.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { boot } = require("./harness.cjs");

(async () => {
  const [, , srcArg, orgArg, cyclesArg, ...asserts] = process.argv;
  if (!srcArg) {
    console.error("usage: node codegen/tools/verify_run.cjs <src.s> <orgHex> <cycles> [addr=val ...]");
    process.exit(2);
  }

  const src = fs.readFileSync(srcArg, "utf8");
  const asm = await import(pathToFileURL(path.join(__dirname, "asm6502.mjs")).href);
  const org = orgArg ? parseInt(orgArg) : undefined;
  const out = asm.assemble(src, org != null ? { org } : {});
  const entry = out.org, bytes = out.bytes;

  const session = await boot();
  session.load(bytes, entry);
  const vm = session.vm;
  vm.drainOutput();
  vm.setPC(entry);

  const total = cyclesArg ? parseInt(cyclesArg) : 2000000;
  const chunk = 20000;
  for (let done = 0; done < total; done += chunk) vm.run(chunk);

  const peek = (a) => vm.peek(a);
  console.log(`state: $06=${peek(0x06)} $07=${peek(0x07)} $08=0x${peek(0x08).toString(16)} $09=0x${peek(0x09).toString(16)}`);
  console.log("screen:");
  for (const line of session.textScreen()) console.log("  | " + line);

  let ok = true;
  for (const a of asserts) {
    const m = a.match(/^(.+)=(.+)$/);
    const addr = parseInt(m[1]), val = parseInt(m[2]) & 0xff, got = vm.peek(addr);
    const pass = got === val;
    ok = ok && pass;
    console.log(`  ${pass ? "PASS" : "FAIL"}  mem[0x${addr.toString(16)}]==0x${val.toString(16)} (got 0x${got.toString(16)})`);
  }
  console.log(ok ? "VERDICT: PASS" : "VERDICT: FAIL");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
