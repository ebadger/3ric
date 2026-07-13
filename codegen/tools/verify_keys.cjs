// verify_keys.cjs — headless *interactive* verifier for the tutorial programs.
// Boots the 3ric WASM emulator through the shared harness, assembles a .s, runs
// it, injects a scripted string of keypresses (one per frame, honoring the
// keyboard strobe), then prints the hero position + text screen and checks
// byte-level memory assertions.
//
// Companion to run6502.mjs for programs that need input. The web keyboard bridge
// uppercases letters (web_bridge.cpp keyDown -> toupper), so pass keys in
// uppercase (e.g. WASD). Needs a WASM build first (web/badger6502.js, produced by
// web/build.ps1).
//
// Usage:
//   node codegen/tools/verify_keys.cjs <src.s> <orgHex> <keys> [addr=val ...]
// Example:
//   node codegen/tools/verify_keys.cjs codegen/programs/tut3_move.s 0x0800 "DDSSWW" 0x06=0x18
//
// keys is a plain string; each character is typed in order. Addresses and values
// accept 0x.. hex; each assertion compares a single byte.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { boot } = require("./harness.cjs");

(async () => {
  const [, , srcArg, orgArg, keys, ...asserts] = process.argv;
  if (!srcArg) {
    console.error("usage: node codegen/tools/verify_keys.cjs <src.s> <orgHex> <keys> [addr=val ...]");
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

  const step = (n = 8, c = 20000) => { for (let i = 0; i < n; i++) vm.run(c); };
  step(12); // let the first frame draw

  for (const ch of keys || "") {
    for (let t = 0; t < 200 && (vm.peek(0xc000) & 0x80) !== 0; t++) vm.run(2000); // wait for the strobe to clear
    vm.keyDown(ch.charCodeAt(0));
    step(8, 20000); // let the loop consume the key + redraw
  }
  step(6);

  const hx = vm.peek(0x06), hy = vm.peek(0x07);
  console.log(`hero: hx=${hx} (0x${hx.toString(16)})  hy=${hy} (0x${hy.toString(16)})`);
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
