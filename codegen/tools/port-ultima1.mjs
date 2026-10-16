// Build the 3RIC SD-card edition of Ultima I from the Apple II ProDOS disk.
//
//   node codegen/tools/port-ultima1.mjs <ultima1.dsk> <output-dir>
//
// Writes <output-dir>/U1/: the loader U1.PRG plus every game file under an
// 8-character key. Copy the U1 folder to the root of the 3RIC micro-SD card,
// then at the ROM DOS prompt:  CD U1   then   BRUN U1.PRG 0800
//
// Only ProDOS is replaced (codegen/patches/ultima1/prodos.s); U1.SYSTEM,
// Origin's file layer and the game run unmodified except one verified patch
// to STUPH. The disk image and the generated folder contain Origin's
// copyrighted game; keep them local - this repository holds only the tool
// and the glue code.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { readProdosImage } from "./ultima5/prodos.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const patchDir = path.join(root, "codegen", "patches", "ultima1");

export const VOLUME = "U1";
const LOADER_ORG = 0x0800, MLI_IMAGE = 0x0a00, MLI_ORG = 0xbb00, MLI_END = 0xc000;

// The stand-in emulates exactly the MLI calls this U1.SYSTEM (and the file
// layer it relocates to $B700) makes, so other builds are refused.
export const U1_SYSTEM_SHA256 = "a51bbe1a2f64d99643bf185e4011d927219f3c30d514a7fb60e8200c9251296a";

// The character save: /U1.PLAYER/U1.VARS on the floppy "player disk".
// The ROM's OWRITE can only rewrite an existing file, so the tool creates it.
export const SAVE_FILE = { name: "U1.VARS", type: 0x06, aux: 0x7e6d, eof: 0x01ca };

// Files the ProDOS stand-in never serves: the real ProDOS kernel.
const SKIP = new Set(["PRODOS"]);

// Each patch: file, load address, original bytes, replacement bytes, reason.
export const PATCHES = [
  {
    file: "STUPH", address: 0x178c, before: [0xa2, 0xc7], after: [0x80, 0x2d],
    why: "Skip the mouse-card probe (LDX #$C7 -> BRA $17BB). 3RIC has no mouse card; the probe reads $Cn0C/$Cn11/$CnFB of every slot, including live ACIA and VIA registers.",
  },
];

/** ProDOS name -> 8-character SD key (prodos.s computes the same). */
export function sdKey(name) {
  return name.replace(/\./g, "").toUpperCase().slice(0, 8);
}

export function applyPatches(files) {
  for (const p of PATCHES) {
    const file = files.find((f) => f.name === p.file);
    if (!file) throw new Error(`patch target ${p.file} not found`);
    const offset = p.address - file.aux;
    const actual = Array.from(file.data.subarray(offset, offset + p.before.length));
    if (actual.join() !== p.before.join()) {
      if (actual.join() === p.after.join()) continue;
      throw new Error(`${p.file} at $${p.address.toString(16)}: unexpected bytes (different release?)`);
    }
    file.data.set(p.after, offset);
  }
}

function tableAsm(files) {
  const bytes = [];
  for (const f of files) {
    if (f.eof > 0xffff) throw new Error(`${f.name}: ${f.eof} bytes is too large`);
    bytes.push(...Buffer.from(sdKey(f.name).padEnd(8, " "), "ascii"), f.type, f.aux & 255, f.aux >> 8, f.eof & 255, f.eof >> 8);
  }
  bytes.push(0);
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16)
    lines.push("        .byte " + bytes.slice(i, i + 16).map((b) => "$" + b.toString(16).padStart(2, "0")).join(","));
  return lines.join("\n");
}

/** Assemble the ProDOS stand-in (with the file table) and the loader into U1.PRG. */
export function buildLoader(files) {
  const mliSrc = fs.readFileSync(path.join(patchDir, "prodos.s"), "utf8")
    .replace(/^filetab:.*$/m, `filetab:\n${tableAsm(files)}\nfiletab_end:`);
  const mli = assemble(mliSrc);
  const s = mli.symbols;
  if (mli.org !== MLI_ORG || mli.org + mli.bytes.length !== MLI_END) throw new Error("stand-in must fill $BB00-$BFFF");
  if (s.FILETAB_END > 0xbf00) throw new Error(`stand-in code and file table overflow into the global page ($${s.FILETAB_END.toString(16)})`);
  if (s.NODEV !== 0xbf4a || s.ROMCSW !== 0xbfa0 || s.ZSAVE !== 0xbfc0 || s.CMDTAB !== 0xbf70 || s.JMPTAB !== 0xbfd0 || s.GP_END !== 0xc000) throw new Error("global page layout drifted");

  const loader = assemble(`MLI_IMAGE = $${MLI_IMAGE.toString(16)}\nROMCSW = $${s.ROMCSW.toString(16)}\n`
    + `IRQ_RETURN = $${s.IRQ_RETURN.toString(16)}\n`
    + fs.readFileSync(path.join(patchDir, "loader.s"), "utf8"));
  if (loader.org !== LOADER_ORG || loader.org + loader.bytes.length > MLI_IMAGE) throw new Error("loader overlaps the stand-in image");

  const prg = new Uint8Array(MLI_IMAGE + (MLI_END - MLI_ORG) - LOADER_ORG);
  prg.set(loader.bytes, 0);
  prg.set(mli.bytes, MLI_IMAGE - LOADER_ORG);
  return { prg, mli, loader };
}

/** files: [{ name, type, aux, eof, data }] as on the ProDOS volume.
 *  Returns { "U1.PRG": bytes, KEY: bytes, ... }. */
export function buildFromFiles(files) {
  const served = files.filter((f) => !SKIP.has(f.name));
  if (!served.some((f) => f.name === SAVE_FILE.name))
    served.push({ ...SAVE_FILE, data: new Uint8Array(SAVE_FILE.eof) });
  const keys = new Map();
  for (const f of served) {
    const key = sdKey(f.name);
    if (keys.has(key)) throw new Error(`SD key ${key} is shared by ${keys.get(key)} and ${f.name}`);
    if (key === "U1") throw new Error(`${f.name}: key collides with U1.PRG`);
    keys.set(key, f.name);
  }
  const { prg } = buildLoader(served);
  const tree = { "U1.PRG": prg };
  for (const f of served) tree[sdKey(f.name)] = f.data;
  return tree;
}

/** Read the owner's disk, check it is the expected release, patch, build. */
export function buildTree(diskPath) {
  const image = readProdosImage(new Uint8Array(fs.readFileSync(diskPath)));
  if (image.volume !== VOLUME) throw new Error(`expected ProDOS volume /${VOLUME}, found /${image.volume}`);
  const system = image.files.find((f) => f.name === "U1.SYSTEM");
  if (!system) throw new Error("U1.SYSTEM not found on the disk");
  const sha = crypto.createHash("sha256").update(system.data).digest("hex");
  if (sha !== U1_SYSTEM_SHA256) throw new Error(`U1.SYSTEM is a different release (sha256 ${sha})`);
  for (const name of ["U1.INTRO", "MI.U1", "STUPH", "GEN"])
    if (!image.files.some((f) => f.name === name)) throw new Error(`${name} not found on the disk`);
  applyPatches(image.files);
  return buildFromFiles(image.files);
}

/** Write the tree. An existing save (U1VARS) is kept, so re-running the
 *  tool over a folder that was copied back from the card loses nothing. */
export function writeTree(tree, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const kept = [];
  for (const [name, value] of Object.entries(tree)) {
    const target = path.join(outDir, name);
    if (name === sdKey(SAVE_FILE.name) && fs.existsSync(target) && fs.statSync(target).size === SAVE_FILE.eof) {
      kept.push(name);
      continue;
    }
    fs.writeFileSync(target, value);
  }
  return kept;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [disk, outDir] = process.argv.slice(2);
  if (!disk || !outDir) {
    console.error("usage: node codegen/tools/port-ultima1.mjs <ultima1.dsk> <output-dir>");
    process.exit(2);
  }
  const target = path.join(outDir, "U1");
  const kept = writeTree(buildTree(disk), target);
  if (kept.length) console.log(`kept the existing save ${path.join(target, kept[0])}`);
  console.log(`wrote ${target}: copy the U1 folder to the SD card root, then CD U1 and BRUN U1.PRG 0800`);
}
