// Build the 3RIC SD-card edition of Ultima III from its two Apple II disks.
//
//   node codegen/tools/port-ultima3.mjs <disk-images-dir> <output-dir>
//
// <disk-images-dir> holds the two 140 KB DOS-order images (.dsk/.do) of the
// release this tool knows: side 1 boots a memory image that carries the
// game's own resident DOS (a COUT-hook BLOAD/BRUN/BSAVE parser with a
// 96-entry track/sector file table); side 2 is the player disk.
// Writes <output-dir>/U3/: U3.PRG plus every game file under its own name.
// Copy the U3 folder to the root of the 3RIC micro-SD card, then at the ROM
// DOS prompt:  CD U3   then   BRUN U3.PRG 0800
//
// The game files are copied unchanged except MBS, the Mockingboard music,
// whose timer and note periods are rescaled for the 3RIC clock and whose IRQ
// handler is chained behind the gamepad tick. U3.PRG
// carries the game's DOS image
// (taken from side 1) with its DOS 3.3 RWTS replaced by SD-card FLOAD /
// OWRITE commands (codegen/patches/ultima3/shim.s). The disk images and the
// generated folder contain Origin's copyrighted game; keep them local - this
// repository holds only the tool and the glue code.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const patchDir = path.join(root, "codegen", "patches", "ultima3");

const DSK_SIZE = 143360;
export const DOS_START = 0xaf80;          // file table, then the DOS code
export const DOS_HOOK_PAGE = 0xb4;        // parser / loader code page
// SHA-256 of the resident DOS ($AF80-$BFFF, RWTS included) this port was
// written against. The game checks bytes of this DOS, so a different DOS is
// a different port.
export const DOS_SHA256 = "8ca1a78f8e8c30edb10c9e3643254cbc85a5801d9af6b9490b1eb3f07b572288";
const LOADER_ORG = 0x0800, IMG_SRC = 0x0a00, IMG_BASE = 0xaf00, IMG_END = 0xc000;
const RWTS = 0xbd00;
const RWTS_BYTES = [0x84, 0x48, 0x85, 0x49];    // DOS 3.3 RWTS: STY $48 / STA $49
const SHIM_ORG = 0xbe40;                        // above the RWTS byte count at $BE3D
// Files the game writes with BSAVE: they must exist on the card (the ROM's
// OWRITE of a missing file falls back to BSAVE code in the BASIC bank).
export const SAVE_FILES = ["ROST", "PLRS", "PRTY", "SOSA", "SOSM"];

// 3RIC clocks the CPU, the Mockingboard VIAs and the AY chips at
// 25.175 MHz / 16; the Apple II at 14.31818 MHz / 14. MBS (Kenneth Arnold's
// Mockingboard driver and score, loaded at $9A00) runs its music from a VIA
// T1 interrupt and plays notes from a 96-entry AY period table, so both are
// scaled to keep the Apple's tempo and pitch.
export const CLOCK_RATIO = (25_175_000 / 16) / (14_318_180 / 14);
const MBS_ADDR = 0x9a00;
const MBS_T1 = { at: 0x9a59, before: [0xa9, 0x1a, 0x91, 0xb4, 0xa0, 0x05, 0xa9, 0x41] };
const MBS_NOTES = { lo: 0x9e40, hi: 0x9ea0, count: 96,
  sha256: "d4c929032ae830c5fea5c612fe83620ba1fa584ef99ac083766ff2b368c94e6a" };
// MBS init writes its IRQ handler to the Apple vector ($03FE/$03FF). The
// gamepad tick (gamepad.s) owns that vector, so MBS's handler goes into the
// tick's next_irq link instead.
const MBS_VECTOR = [
  { at: 0x9a3c, before: [0x8d, 0xfe, 0x03], offset: 0 },   // STA $03FE
  { at: 0x9a41, before: [0x8d, 0xff, 0x03], offset: 1 },   // STA $03FF
];
// The gamepad tick: second Mockingboard VIA Timer 1, ~61 Hz like the music.
export const PAD_LATCH = Math.round(25_175_000 / 16 / 61.36) - 2;

/** Retime MBS for the 3RIC clock (VIA T1 latch and AY note periods) and
 *  chain its IRQ handler behind the gamepad tick at nextIrq. */
export function patchMbs(mbs, nextIrq) {
  const t1 = MBS_T1.at - MBS_ADDR;
  if (Array.from(mbs.subarray(t1, t1 + 8)).join() !== MBS_T1.before.join())
    throw new Error("MBS: unexpected music timer set-up at $9A59 (different release?)");
  for (const v of MBS_VECTOR) {
    const at = v.at - MBS_ADDR;
    if (Array.from(mbs.subarray(at, at + 3)).join() !== v.before.join())
      throw new Error(`MBS: unexpected IRQ vector store at $${v.at.toString(16).toUpperCase()} (different release?)`);
  }
  const lo = MBS_NOTES.lo - MBS_ADDR, hi = MBS_NOTES.hi - MBS_ADDR, n = MBS_NOTES.count;
  const table = mbs.subarray(lo, hi + n);
  if (crypto.createHash("sha256").update(table).digest("hex") !== MBS_NOTES.sha256)
    throw new Error("MBS: unexpected note period table at $9E40 (different release?)");
  // T1 free-runs with a period of latch + 2 cycles.
  const latch = Math.round((((MBS_T1.before[7] << 8) | MBS_T1.before[1]) + 2) * CLOCK_RATIO) - 2;
  mbs[t1 + 1] = latch & 255;
  mbs[t1 + 7] = latch >> 8;
  for (let i = 0; i < n; i++) {
    const period = Math.round((mbs[lo + i] | (mbs[hi + i] << 8)) * CLOCK_RATIO);
    if (period > 0xfff) throw new Error("MBS: scaled note period exceeds 12 bits");
    mbs[lo + i] = period & 255;
    mbs[hi + i] = period >> 8;
  }
  for (const v of MBS_VECTOR) {
    const at = v.at - MBS_ADDR, target = nextIrq + v.offset;
    mbs[at + 1] = target & 255;
    mbs[at + 2] = target >> 8;
  }
  return mbs;
}

const sector = (img, t, s) => img.subarray((t * 16 + s) * 256, (t * 16 + s) * 256 + 256);

/** Rebuild what side 1's boot leaves in memory at $AF00-$BFFF, or null. */
export function bootDos(img) {
  if (img.length !== DSK_SIZE) return null;
  const b1 = sector(img, 0, 1);          // boot stage 1 at $B700
  // LDA #track / STA $B7EC / LDA #sector / STA $B7ED and JMP $8F00
  if (b1[0x14] !== 0xa9 || b1[0x16] !== 0x8d || b1[0x19] !== 0xa9 || b1[0x1b] !== 0x8d) return null;
  if (b1[0x47] !== 0x4c || b1[0x48] !== 0x00 || b1[0x49] !== 0x8f) return null;
  let t = b1[0x15], s = b1[0x1a];
  const count = b1[0xe0], top = b1[0xe7];
  const mem = new Uint8Array(0x10000);
  for (let i = 0, page = top - 1; i < count; i++, page--) {
    if (t < 0 || t > 34 || s < 0 || s > 15 || page < 0) return null;
    mem.set(sector(img, t, s), page * 256);
    if (--s < 0) { s = 15; t--; }
  }
  // The memory image's entry ($8F00) moves $2900 to $B700; stage 0 loaded
  // track 0 sectors 2-9 at $B800-$BFFF.
  mem.copyWithin(0xb700, 0x2900, 0x2a00);
  for (let n = 2; n <= 9; n++) mem.set(sector(img, 0, n), (0xb6 + n) * 256);
  return mem;
}

export const dosHash = (mem) => crypto.createHash("sha256").update(mem.subarray(DOS_START, 0xc000)).digest("hex");

/** Parse the DOS file table. */
export function fileTable(mem) {
  const count = mem[0xb413], ptr = mem[0xb414] | (mem[0xb415] << 8);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const e = mem.subarray(ptr + i * 12, ptr + i * 12 + 12);
    const name = String.fromCharCode(...[e[3], e[2], e[1], e[0]].map((c) => c & 0x7f)).trim();
    const part = e[9], pages = e[10];
    entries.push({
      name, side: e[4] & 0x0f, track: e[5], sector: e[6],
      top: e[7] | (e[8] << 8), part, pages,
      start: e[7] | ((e[8] - pages) << 8), length: pages * 256 + part,
    });
  }
  return entries;
}

/** Read one file the way the DOS does: partial top page, then pages downward. */
export function readFile(img, e) {
  const data = new Uint8Array(e.length);
  let t = e.track, s = e.sector;
  if (t > 34 || s > 15) throw new Error(`${e.name}: track/sector ${t}/${s} out of range`);
  if (e.part) data.set(sector(img, t, s).subarray(0, e.part), e.pages * 256);
  for (let p = e.pages - 1; p >= 0; p--) {
    if (--s < 0) { s = 15; t--; }
    if (t < 0) throw new Error(`${e.name}: runs off track 0`);
    data.set(sector(img, t, s), p * 256);
  }
  return data;
}

function loadDisks(diskDir) {
  const images = [];
  for (const entry of fs.readdirSync(diskDir)) {
    const full = path.join(diskDir, entry);
    if (!fs.statSync(full).isFile() || !/\.(dsk|do)$/i.test(entry)) continue;
    const img = new Uint8Array(fs.readFileSync(full));
    if (img.length === DSK_SIZE) images.push({ entry, img });
  }
  const side1 = images.filter((d) => bootDos(d.img));
  if (side1.length !== 1) throw new Error(`expected exactly one Ultima III side-1 image in ${diskDir}, found ${side1.length}`);
  const side2 = images.filter((d) => d !== side1[0]);
  if (side2.length !== 1) throw new Error(`expected exactly one side-2 (player) image in ${diskDir}, found ${side2.length}`);
  return { side1: side1[0].img, side2: side2[0].img };
}

function asmText(bytes) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) lines.push("        .byte " + Array.from(bytes.slice(i, i + 16), (b) => "$" + b.toString(16).padStart(2, "0")).join(","));
  return lines.join("\n");
}

/** Assemble the shim, gamepad tick and loader around a DOS memory image -> U3.PRG. */
export function buildLoader(mem) {
  const shim = assemble(fs.readFileSync(path.join(patchDir, "shim.s"), "utf8"));
  const s = shim.symbols;
  if (shim.org !== SHIM_ORG || s.SHIM_END > IMG_END) throw new Error("shim exceeds $BE40-$BFFF");
  const image = mem.slice(IMG_BASE, IMG_END);
  image.fill(0, 0, DOS_START - IMG_BASE);
  const at = RWTS - IMG_BASE;
  if (Array.from(image.subarray(at, at + 4)).join() !== RWTS_BYTES.join())
    throw new Error("unexpected RWTS entry at $BD00");
  image.set([0x4c, s.RWTS & 255, s.RWTS >> 8], at);
  image.set(shim.bytes, SHIM_ORG - IMG_BASE);
  // The gamepad tick fills the dead RWTS code after the new JMP, below the
  // $BE3D byte count the DOS still writes.
  const gamepad = assemble(fs.readFileSync(path.join(patchDir, "gamepad.s"), "utf8"));
  const g = gamepad.symbols;
  if (gamepad.org !== RWTS + 3 || g.GAMEPAD_END > 0xbe3d) throw new Error("gamepad tick exceeds $BD03-$BE3C");
  image.set(gamepad.bytes, gamepad.org - IMG_BASE);

  const loader = assemble(`ROMCSW = $${s.ROMCSW.toString(16)}\nPAD_IRQ = $${g.PAD_IRQ.toString(16)}\n`
    + `PAD_LATCH = $${PAD_LATCH.toString(16)}\n` + fs.readFileSync(path.join(patchDir, "loader.s"), "utf8"));
  if (loader.org !== LOADER_ORG || loader.org + loader.bytes.length > IMG_SRC) throw new Error("loader overlaps its payload");
  const prg = new Uint8Array(IMG_SRC - LOADER_ORG + image.length);
  prg.set(loader.bytes, 0);
  prg.set(image, IMG_SRC - LOADER_ORG);
  return { prg, shim, gamepad, loader };
}

/** mem: DOS memory image; sides: { 1: img, 2: img }. Returns the U3 tree. */
export function buildFromImages(mem, sides, { checkHash = true } = {}) {
  if (checkHash && dosHash(mem) !== DOS_SHA256)
    throw new Error("side 1 boots a different DOS than the release this port supports (DOS hash mismatch)");
  const entries = fileTable(mem);
  const tree = {};
  for (const e of entries) {
    if (!/^[A-Z0-9]{1,4}$/.test(e.name)) throw new Error(`unexpected file name "${e.name}"`);
    if (tree[e.name]) throw new Error(`file ${e.name} listed twice`);
    if (!sides[e.side]) throw new Error(`${e.name}: unknown side ${e.side}`);
    if (e.length === 0 || e.start < 0 || e.start + e.length > DOS_START) throw new Error(`${e.name}: bad range`);
    tree[e.name] = readFile(sides[e.side], e);
  }
  for (const f of SAVE_FILES) if (!tree[f]) throw new Error(`save file ${f} missing from the table`);
  if (!tree.MBS) throw new Error("MBS missing from the table");
  if (tree["U3.PRG"]) throw new Error("a game file is called U3.PRG");
  const { prg, gamepad } = buildLoader(mem);
  patchMbs(tree.MBS, gamepad.symbols.NEXT_IRQ);
  return { "U3.PRG": prg, ...tree };
}

export function buildTree(diskDir) {
  const { side1, side2 } = loadDisks(diskDir);
  return buildFromImages(bootDos(side1), { 1: side1, 2: side2 });
}

export function writeTree(tree, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, value] of Object.entries(tree)) {
    const target = path.join(outDir, name);
    if (value instanceof Uint8Array) fs.writeFileSync(target, value);
    else writeTree(value, target);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [diskDir, outDir] = process.argv.slice(2);
  if (!diskDir || !outDir) {
    console.error("usage: node codegen/tools/port-ultima3.mjs <disk-images-dir> <output-dir>");
    process.exit(2);
  }
  const tree = buildTree(diskDir);
  writeTree({ U3: tree }, outDir);
  console.log(`wrote ${path.join(outDir, "U3")} (${Object.keys(tree).length} files): copy the U3 folder to the SD card root, then CD U3 and BRUN U3.PRG 0800`);
}
