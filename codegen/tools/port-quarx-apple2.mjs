import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildBootableWoz } from "./wozgen.mjs";
import { buildQuarx, instructionSizes, packQuarxImage, sha256, INPUT_SHA256 } from "./port-quarx.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hex = value => "$" + value.toString(16);
const putWord = (bytes, address, value) => { bytes[address] = value; bytes[address + 1] = value >> 8; };
const branches = new Set([0x10, 0x30, 0x50, 0x70, 0x90, 0xb0, 0xd0, 0xf0]);
export const BASE_3RIC_SHA256 = "aa55941794ee1cf61b19e7b7aacfd5e7ef39d4a7bc97e5c8942fddd65d30fd11";
export const NMOS_OPCODES = new Set(`
00 01 05 06 08 09 0a 0d 0e 10 11 15 16 18 19 1d 1e
20 21 24 25 26 28 29 2a 2c 2d 2e 30 31 35 36 38 39 3d 3e
40 41 45 46 48 49 4a 4c 4d 4e 50 51 55 56 58 59 5d 5e
60 61 65 66 68 69 6a 6c 6d 6e 70 71 75 76 78 79 7d 7e
81 84 85 86 88 8a 8c 8d 8e 90 91 94 95 96 98 99 9a 9d
a0 a1 a2 a4 a5 a6 a8 a9 aa ac ad ae b0 b1 b4 b5 b6 b8 b9 ba bc bd be
c0 c1 c4 c5 c6 c8 c9 ca cc cd ce d0 d1 d5 d6 d8 d9 dd de
e0 e1 e4 e5 e6 e8 e9 ea ec ed ee f0 f1 f5 f6 f8 f9 fd fe
`.trim().split(/\s+/).map(value => parseInt(value, 16)));

function decode(bytes, pc) {
  const op = bytes[pc], size = instructionSizes.get(op);
  if (!size || pc + size > bytes.length) throw new Error(`Unknown instruction at ${hex(pc)}`);
  const data = bytes.slice(pc, pc + size);
  const target = branches.has(op) || op === 0x80
    ? (pc + 2 + (data[1] < 128 ? data[1] : data[1] - 256)) & 65535
    : size === 3 ? data[1] | data[2] << 8 : null;
  return { pc, op, size, data, target };
}

export function reachableCode(image, roots) {
  const nodes = new Map(), pending = [...roots];
  while (pending.length) {
    const pc = pending.pop();
    if (pc >= 0xf800) continue;
    if (pc < (image.length === 65536 ? 0x200 : 0x800)
        || (pc >= 0xc000 && pc < 0xd000) || pc >= image.length)
      throw new Error(`Unexpected code target ${hex(pc)}`);
    if (nodes.has(pc)) continue;
    const node = decode(image, pc);
    if (node.op === 0) throw new Error(`Unexpected reachable BRK at ${hex(pc)}`);
    nodes.set(pc, node);
    if (node.op === 0x4c || node.op === 0x80) pending.push(node.target);
    else if (node.op === 0x20 || branches.has(node.op)) pending.push(node.target, pc + node.size);
    else if (![0x60, 0x40, 0x6c].includes(node.op)) pending.push(pc + node.size);
  }
  return nodes;
}

function expect(image, address, pattern) {
  if (!pattern.every((byte, index) => image[address + index] === byte))
    throw new Error(`The 3RIC port changed at ${hex(address)}; inspect the Apple II adaptation`);
}

function patchPlatform(image, symbols) {
  expect(image, symbols.INIT + 2, [0x2c, 7, 0xc0, 0x2c, 0x82, 0xc0, 0x20,
    symbols.CHECK_ROM & 255, symbols.CHECK_ROM >> 8]);
  image.fill(0xea, symbols.INIT + 2, symbols.INIT + 11);
  const timer = symbols.MUSIC_START + 5;
  expect(image, timer, [0xa9, 0x29, 0x8d, 4, 0xc4, 0xa9, 0x64, 0x8d, 5, 0xc4]);
  image[timer + 1] = 0x1a;
  image[timer + 6] = 0x41;
  const output = symbols.MUSIC + 0x8ce;
  expect(image, output, [0x20, symbols.MUSIC_WRITE & 255, symbols.MUSIC_WRITE >> 8]);
  image.set([0x8e, 1, 0xc4], output);
  const delay = symbols.NOTICE_DELAY - 4;
  expect(image, delay, [0xa0, 8, 0xa2, 0]);
  image[delay + 1] = 5;
}

function branchName(op) {
  return new Map([[0x10, "bpl"], [0x30, "bmi"], [0x50, "bvc"], [0x70, "bvs"],
    [0x90, "bcc"], [0xb0, "bcs"], [0xd0, "bne"], [0xf0, "beq"]]).get(op);
}

function emitInstruction(node, sequence) {
  const { op, data, target } = node;
  if (branches.has(op))
    return `${branchName(op ^ 0x20)} skip_${sequence}\njmp ${hex(target)}\nskip_${sequence}:`;
  if (op === 0x80) return `jmp ${hex(target)}`;
  if (NMOS_OPCODES.has(op)) return `operand_${node.pc}:\n.byte ${Array.from(data, hex).join(",")}`;
  if ([0x64, 0x74, 0x9c, 0x9e].includes(op)) {
    const store = new Map([[0x64, 0x85], [0x74, 0x95], [0x9c, 0x8d], [0x9e, 0x9d]]).get(op);
    return `php\npha\nlda #0\noperand_${node.pc}:\n.byte ${[store, ...data.slice(1)].map(hex).join(",")}\npla\nplp`;
  }
  if (op === 0x1a || op === 0x3a)
    return `sta saved_a\n${op === 0x1a ? "inc" : "dec"} saved_a\nlda saved_a`;
  if (op === 0xda || op === 0x5a)
    return `sta saved_a\nphp\npla\nsta saved_p\n${op === 0xda ? "txa" : "tya"}\npha\nlda saved_p\npha\nlda saved_a\nplp`;
  if (op === 0xfa || op === 0x7a)
    return `sta saved_a\npla\n${op === 0xfa ? "tax" : "tay"}\nphp\nlda saved_a\nplp`;
  throw new Error(`Unsupported 65C02 replacement ${hex(op)} at ${hex(node.pc)}`);
}

export function lowerToNmos(image, roots, extraPatches = new Map(), relocatableOperands = new Set()) {
  const nodes = reachableCode(image, roots), entries = new Set(roots), references = new Set();
  for (const node of nodes.values()) {
    if (node.op === 0x20 || node.op === 0x4c || branches.has(node.op) || node.op === 0x80)
      entries.add(node.target);
    else if (node.size === 3) references.add(node.target);
  }
  const patches = [], claimed = new Set();
  const needsReplacement = [...nodes.values()].filter(node => !NMOS_OPCODES.has(node.op) || extraPatches.has(node.pc));
  for (const node of needsReplacement.sort((a, b) => a.pc - b.pc)) {
    if (claimed.has(node.pc)) continue;
    const findCandidates = latestStart => {
      const candidates = [];
      for (const start of [...nodes.keys()].filter(pc => pc <= latestStart && pc >= node.pc - 12)) {
        let end = start;
        const block = [];
        while (end < node.pc + node.size || end - start < 3) {
          const current = nodes.get(end);
          if (!current || claimed.has(end)) break;
          block.push(current); end += current.size;
        }
        if (end < node.pc + node.size || end - start < 3) continue;
        if ([...entries].some(address => address > start && address < end)
            || [...references].some(address => address >= start && address < end
              && !relocatableOperands.has(address))) continue;
        if ([...nodes.values()].some(other => other.pc < start && other.pc + other.size > start)) continue;
        if (Array.from({ length: end - start }, (_, n) => start + n).some(address => claimed.has(address))) continue;
        candidates.push({ start, end, block });
      }
      return candidates.sort((a, b) => (a.end - a.start) - (b.end - b.start) || b.start - a.start);
    };
    let candidates = findCandidates(node.pc);
    if (!candidates.length) {
      const previous = patches.findLast(patch => patch.end <= node.pc && patch.start >= node.pc - 12);
      if (previous) {
        for (let pc = previous.start; pc < previous.end; pc++) claimed.delete(pc);
        patches.splice(patches.indexOf(previous), 1);
        candidates = findCandidates(previous.start);
      }
    }
    if (!candidates.length) throw new Error(`No safe NMOS patch boundary for ${hex(node.pc)}`);
    const patch = candidates[0];
    patches.push(patch);
    for (let pc = patch.start; pc < patch.end; pc++) claimed.add(pc);
  }
  const pool = [], segments = [], operandLocations = new Map();
  for (const patch of patches) {
    const address = 0xd000 + pool.length;
    const instructions = patch.block.map((node, index) =>
      (extraPatches.get(node.pc) || "") + "\n" + emitInstruction(node, index));
    const assembled = assemble(`.org ${hex(address)}\n${instructions.join("\n")}\njmp ${hex(patch.end)}\nsaved_a: .byte 0\nsaved_p: .byte 0\n`);
    for (const row of assembled.listing)
      if (row.kind === "instruction" && !NMOS_OPCODES.has(row.bytes[0]))
        throw new Error(`Generated non-NMOS instruction at ${hex(row.pc)}`);
    pool.push(...assembled.bytes);
    for (const node of patch.block) {
      const operand = assembled.symbols[`OPERAND_${node.pc}`];
      if (operand !== undefined) for (let n = 1; n < node.size; n++)
        operandLocations.set(node.pc + n, operand + n);
    }
    image[patch.start] = 0x4c;
    putWord(image, patch.start + 1, address);
    image.fill(0xea, patch.start + 3, patch.end);
    patch.target = address;
    segments.push(...assembled.listing.filter(row => row.kind === "instruction").map(row => ({ pc: row.pc, bytes: row.bytes })));
  }
  if (pool.length > 0x2800) throw new Error("NMOS expansion stubs overlap the retained Apple monitor");
  const bytes = Uint8Array.from(pool);
  for (const node of nodes.values()) {
    if (node.size !== 3 || [0x20, 0x4c].includes(node.op)) continue;
    const destination = operandLocations.get(node.target);
    if (destination === undefined) continue;
    if (!relocatableOperands.has(node.target)) throw new Error("Unexpected relocated self-modifying operand");
    const location = operandLocations.get(node.pc + 1) ?? node.pc + 1;
    if (location >= 0xd000) putWord(bytes, location - 0xd000, destination);
    else putWord(image, location, destination);
  }
  return { bytes, patches, segments, originalNodes: nodes.size };
}

function buildAppleProgram(image, entry, stubLength, irqEntry) {
  const packed = packQuarxImage(image);
  const declarations = `PACKED_END = ${hex(0x803 + packed.length - 1)}\nENTRY = ${hex(entry)}\nIRQ_ENTRY = ${hex(irqEntry)}\nSTUB_PAGES = ${Math.ceil(stubLength / 256)}\n`;
  const source = fs.readFileSync(path.join(root, "codegen", "patches", "quarx-apple2-loader.s"), "utf8");
  const loader = assemble(declarations + source);
  if (loader.bytes.length <= 256 || loader.bytes.length > 0x1f0)
    throw new Error("Apple II loader must fit below the monitor's page-three vectors");
  const launcher = assemble(`
        .org ${hex(0x803 + packed.length)}
        ldx #0
copy:
        lda loader_bytes,x
        sta $0200,x
        cpx #${loader.bytes.length - 256}
        bcs first_page_only
        lda loader_bytes+256,x
        sta $0300,x
first_page_only:
        inx
        bne copy
        jmp $0200
loader_bytes:
        .byte ${Array.from(loader.bytes, hex).join(",")}
`);
  for (const part of [loader, launcher]) for (const row of part.listing)
    if (row.kind === "instruction" && !NMOS_OPCODES.has(row.bytes[0]))
      throw new Error(`Apple II loader emitted a non-NMOS opcode at ${hex(row.pc)}`);
  const prg = new Uint8Array(3 + packed.length + launcher.bytes.length);
  prg[0] = 0x4c; putWord(prg, 1, launcher.org);
  prg.set(packed, 3); prg.set(launcher.bytes, packed.length + 3);
  return { prg, loader };
}

export function buildQuarxApple2(input) {
  const base = buildQuarx(input), image = Uint8Array.from(base.image);
  if (sha256(base.woz) !== BASE_3RIC_SHA256)
    throw new Error("The 3RIC base port changed; revalidate the Apple II companion before generating an image");
  for (const { address, original } of base.keyboardPatches) image.set(original, address);
  patchPlatform(image, base.symbols);
  const lowered = lowerToNmos(image, [0x800, base.symbols.MUSIC_IRQ],
    new Map([[base.symbols.MUSIC_PLAY, "cld"]]),
    new Set([base.symbols.FONT_READ + 1, base.symbols.FONT_READ + 2]));
  const irq = assemble(`
        .org ${hex(0xd000 + lowered.bytes.length)}
        sta $45
        pla
        pha
        and #$10
        beq music
        jmp $03C0
music:
        jmp ${hex(base.symbols.MUSIC_IRQ)}
`);
  const combined = new Uint8Array(lowered.bytes.length + irq.bytes.length);
  combined.set(lowered.bytes); combined.set(irq.bytes, lowered.bytes.length);
  lowered.bytes = combined;
  if (lowered.bytes.length > 0x2800) throw new Error("IRQ veneer overlaps the retained Apple monitor");
  image.set(lowered.bytes, 0x2000);
  const { prg, loader } = buildAppleProgram(image, base.symbols.INIT, lowered.bytes.length, irq.org);
  if (loader.symbols.IRQ_RESTORE !== 0x3c0) throw new Error("IRQ restore trampoline moved");
  const mapped = new Uint8Array(65536);
  mapped.set(image); mapped.set(lowered.bytes, 0xd000); mapped.set(loader.bytes, loader.org);
  for (const instruction of reachableCode(mapped, [0x800, irq.org, loader.symbols.RESET_ENTRY, loader.symbols.SOFT_RESET]).values())
    if (!NMOS_OPCODES.has(instruction.op)) throw new Error(`Remaining non-NMOS opcode at ${hex(instruction.pc)}`);
  const woz = buildBootableWoz(prg, 0x800);
  return { image, prg, woz, symbols: { ...base.symbols, MUSIC_PERIOD: 16667, APPLE_IRQ_ENTRY: irq.org },
    lowered, loader, inputSha256: INPUT_SHA256 };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 4)
      throw new Error("Usage: node codegen\\tools\\port-quarx-apple2.mjs <a2quarx-sw.po> <output.woz>");
    const input = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
    if (!/\.woz$/i.test(output)) throw new Error("Output must have a .woz extension");
    if (fs.existsSync(output)) throw new Error("Output already exists; choose a different filename");
    const result = buildQuarxApple2(fs.readFileSync(input));
    fs.writeFileSync(output, result.woz, { flag: "wx" });
    console.log(`Created ${output}\nApple II+ / 64 KiB / NMOS 6502; original keyboard controls and slot-4 Mockingboard.\n`
      + `${result.lowered.patches.length} NMOS patches, ${result.lowered.bytes.length} language-card bytes.\n`
      + `SHA-256: ${sha256(result.woz)}`);
  } catch (error) { console.error(`port-quarx-apple2: ${error.message}`); process.exitCode = 1; }
}
