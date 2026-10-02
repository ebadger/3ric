import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildQuarx, sha256 } from "./port-quarx.mjs";
import { BASE_3RIC_SHA256, NMOS_OPCODES, buildQuarxApple2, lowerToNmos, reachableCode } from "./port-quarx-apple2.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const createBadgerVM = require(path.join(root, "web", "badger6502.js"));
const Module = await createBadgerVM();
let passed = 0;
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`); };

check("NMOS instruction inventory contains exactly the 151 documented opcodes", () => {
  assert.equal(NMOS_OPCODES.size, 151);
  for (const opcode of [0x1a, 0x3a, 0x5a, 0x64, 0x74, 0x7a, 0x80, 0x9c, 0x9e, 0xda, 0xfa])
    assert(!NMOS_OPCODES.has(opcode));
});

function execute(vm, image, pool, status, a, x, y) {
  vm.readBus(0xc007);
  vm.loadData(0, image);
  vm.readBus(0xc083); vm.readBus(0xc083);
  for (let n = 0; n < pool.length; n++) vm.writeBus(0xd000 + n, pool[n]);
  vm.loadData(0x300, Uint8Array.from([
    0xa2, 0xff, 0x9a, 0xa9, status, 0x48, 0xa9, a, 0xa2, x, 0xa0, y, 0x28,
    0x20, 0, 8, 0xea,
  ]));
  vm.setPC(0x300); vm.clearBreakpoints(); vm.addBreakpoint(0x310);
  vm.run(1000);
  assert.equal(vm.pc(), 0x310, "Fixture did not return");
  return {
    registers: [vm.regA(), vm.regX(), vm.regY(), vm.status() & 0xcf, vm.sp()],
    zeroPage: Array.from({ length: 256 }, (_, n) => vm.peek(n)),
    data: Array.from({ length: 512 }, (_, n) => vm.peek(0x500 + n)),
  };
}

const fixtures = [
  ["zero page STZ", "stz $80\nsta $501\nphp\npla\nsta $502\nrts"],
  ["indexed zero page STZ", "stz $80,x\nsta $501\nphp\npla\nsta $502\nrts"],
  ["absolute STZ", "stz $500\nsta $501\nphp\npla\nsta $502\nrts"],
  ["indexed absolute STZ", "stz $510,x\nsta $501\nphp\npla\nsta $502\nrts"],
  ["accumulator increment", "inc a\nsta $501\nphp\npla\nsta $502\nrts"],
  ["accumulator decrement", "dec a\nsta $501\nphp\npla\nsta $502\nrts"],
  ["X stack operations", "phx\nldx #77\nplx\nstx $500\nsta $501\nphp\npla\nsta $502\nrts"],
  ["Y stack operations", "phy\nldy #77\nply\nsty $500\nsta $501\nphp\npla\nsta $502\nrts"],
  ["unconditional branch", "nop\nbra done\nlda #42\ndone:\nsta $501\nphp\npla\nsta $502\nrts"],
  ["adjacent replacements", "stz $500\nbra done\nblank:\nlda #0\ndone:\nsta $501\nphp\npla\nsta $502\nrts"],
];
for (const [name, body] of fixtures) check(`${name}: register/flag/stack/memory equivalence`, () => {
  const original = new Uint8Array(0xc000);
  original.fill(0x96, 0, 256); original.fill(0xa5, 0x500, 0x700);
  original.set(assemble(".org $0800\n" + body).bytes, 0x800);
  const converted = Uint8Array.from(original), lowered = lowerToNmos(converted, [0x800]);
  const mapped = new Uint8Array(65536);
  mapped.set(converted); mapped.set(lowered.bytes, 0xd000);
  for (const node of reachableCode(mapped, [0x800]).values()) assert(NMOS_OPCODES.has(node.op));
  const reference = new Module.WebVM(), candidate = new Module.WebVM();
  try {
    for (const status of [0, 0xff, 0x49, 0x86]) for (const a of [0, 1, 0x7f, 0x80, 0xfe, 0xff])
      for (const x of [0, 1, 0x7f, 0xff]) {
        const expected = execute(reference, original, new Uint8Array(), status, a, x, x ^ 255);
        const actual = execute(candidate, converted, lowered.bytes, status, a, x, x ^ 255);
        assert.deepEqual(actual, expected, `${name}: P=${status} A=${a} X=${x}`);
      }
  } finally { reference.delete(); candidate.delete(); }
});

check("Self-modifying operands move only when explicitly declared", () => {
  const source = assemble(`
        .org $0800
        lda #$34
        sta fetch+1
        lda #$06
        sta fetch+2
        jsr reader
        sta $500
        rts
reader:
        cpx #0
        bne blank
fetch:
        lda $FFFF,x
        bra done
blank:
        lda #0
done:
        rts
`);
  const original = new Uint8Array(0xc000);
  original.set(source.bytes, source.org); original[0x634] = 0xa7;
  assert.throws(() => lowerToNmos(Uint8Array.from(original), [0x800]), /No safe/);
  const converted = Uint8Array.from(original);
  const lowered = lowerToNmos(converted, [0x800], new Map(),
    new Set([source.symbols.FETCH + 1, source.symbols.FETCH + 2]));
  const reference = new Module.WebVM(), candidate = new Module.WebVM();
  try {
    for (const x of [0, 1]) {
      assert.deepEqual(execute(candidate, converted, lowered.bytes, 0x49, 13, x, 9),
        execute(reference, original, new Uint8Array(), 0x49, 13, x, 9));
    }
  } finally { reference.delete(); candidate.delete(); }
});

check("Unsafe entry boundaries and unsupported CMOS operations are rejected", () => {
  for (const [body, pattern] of [
    ["bra target\ntarget:\nrts", /No safe/],
    ["bit #$80\nrts", /Unsupported 65C02/],
    ["brk", /reachable BRK/],
  ]) {
    const image = new Uint8Array(0xc000);
    image.set(assemble(".org $0800\n" + body).bytes, 0x800);
    assert.throws(() => lowerToNmos(image, [0x800]), pattern);
  }
});

const diskIndex = process.argv.indexOf("--disk");
if (diskIndex >= 0) {
  const input = fs.readFileSync(process.argv[diskIndex + 1]), before = sha256(input);
  const apple = buildQuarxApple2(input), original = buildQuarx(input);
  check("Apple II companion preserves the board-confirmed 3RIC output", () => {
    assert.equal(sha256(original.woz), BASE_3RIC_SHA256);
    assert.equal(sha256(input), before);
    assert.notEqual(sha256(apple.woz), BASE_3RIC_SHA256);
    assert.equal(apple.woz.length, 234496);
    assert(apple.prg.length <= 34560);
  });
  check("All statically reachable guest code and the temporary loader are NMOS-only", () => {
    const mapped = new Uint8Array(65536);
    mapped.set(apple.image); mapped.set(apple.lowered.bytes, 0xd000); mapped.set(apple.loader.bytes, apple.loader.org);
    for (const node of reachableCode(mapped, [0x800, apple.symbols.APPLE_IRQ_ENTRY,
      apple.loader.symbols.RESET_ENTRY, apple.loader.symbols.SOFT_RESET]).values())
      assert(NMOS_OPCODES.has(node.op), `Non-NMOS opcode at ${node.pc.toString(16)}`);
    for (const row of apple.loader.listing)
      if (row.kind === "instruction") assert(NMOS_OPCODES.has(row.bytes[0]));
    assert(apple.lowered.bytes.length <= 0x2800);
    assert.equal(apple.loader.symbols.RESET_ENTRY, 0x3e0);
    assert.equal(apple.loader.symbols.SOFT_RESET, 0x3a0);
    assert.equal(apple.loader.symbols.ORIGINAL_RESET & 255, 0xe6, "Avoid the NMOS JMP-indirect page-wrap bug");
    assert(apple.loader.org + apple.loader.bytes.length <= 0x3f0, "Leave page-three vectors alone");
    assert.equal(apple.image[apple.symbols.INIT + 2], 0xea, "No 3RIC BASIC-ROM switch");
    for (const patch of original.keyboardPatches)
      assert.deepEqual(Array.from(apple.image.slice(patch.address, patch.address + 3)), patch.original);
    const irq = apple.lowered.patches.find(patch => patch.start === apple.symbols.MUSIC_PLAY);
    assert(irq, "Missing NMOS IRQ decimal-mode patch");
    assert.equal(apple.lowered.bytes[irq.target - 0xd000], 0xd8, "Clear decimal before tracker arithmetic");
    assert.deepEqual(Array.from(apple.image.slice(apple.symbols.MUSIC + 0x8ce, apple.symbols.MUSIC + 0x8d1)),
      [0x8e, 1, 0xc4], "Use original AY periods without the 3RIC scaling hook");
  });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "quarx-apple2-cli-"));
  const output = path.join(temporary, "QUARX-APPLE2.woz");
  try {
    check("Apple II CLI produces the checked image and refuses an existing destination", () => {
      const args = [path.join(root, "codegen", "tools", "port-quarx-apple2.mjs"),
        path.resolve(process.argv[diskIndex + 1]), output];
      const first = spawnSync(process.execPath, args, { encoding: "utf8" });
      if (first.error) throw first.error;
      assert.equal(first.status, 0, first.stderr);
      assert.deepEqual(fs.readFileSync(output), Buffer.from(apple.woz));
      const second = spawnSync(process.execPath, args, { encoding: "utf8" });
      assert.equal(second.status, 1);
      assert.match(second.stderr, /already exists/);
      assert.deepEqual(fs.readFileSync(output), Buffer.from(apple.woz));
      assert.equal(sha256(fs.readFileSync(process.argv[diskIndex + 1])), before);
    });
  } finally {
    if (fs.existsSync(output)) fs.unlinkSync(output);
    fs.rmdirSync(temporary);
  }
} else console.log("Supplied-disk checks NOT RUN: add --disk <a2quarx-sw.po>.");

console.log(`${passed} Apple II companion checks passed. Browser/board execution is separate.`);
