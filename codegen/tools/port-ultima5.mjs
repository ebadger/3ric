// Build the 3RIC SD-card edition of Ultima V from the eight Apple II disks.
//
//   node codegen/tools/port-ultima5.mjs <disk-images-dir> <output-dir>
//
// Writes <output-dir>/U5/: the loader U5.PRG plus one directory per disk.
// Copy the U5 folder to the root of the 3RIC micro-SD card, then at the ROM
// DOS prompt:  CD U5   then   BRUN U5.PRG 0800
//
// The game files are copied unchanged except one verified patch to STARTUP.
// The disk images and the generated folder contain Origin's copyrighted game;
// keep them local - this repository holds only the tool and the glue code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { readProdosImage } from "./ultima5/prodos.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const patchDir = path.join(root, "codegen", "patches", "ultima5");

// ProDOS volume -> SD directory (FAT 8.3), in the order the shim indexes them.
export const VOLUMES = [
  ["ULTIMA5", "ULTIMA5"], ["BRITANNIA", "BRITANIA"], ["UNDERWORLD", "UNDRWRLD"],
  ["TOWNE", "TOWNE"], ["DWELLING", "DWELLING"], ["CASTLE", "CASTLE"],
  ["KEEP", "KEEP"], ["DUNGEON", "DUNGEON"],
];
export const BANKSIG_VALUE = 0xa5;
const RAW_BLOCKS = 8;                // RAW00-RAW22: 8 ProDOS blocks (4 KB) each
const LOADER_ORG = 0x0800, RES_SRC = 0x0b00, SHIM_SRC = 0x0c00;

/** ProDOS name -> 8-character SD key (the shim computes the same). */
export function sdKey(name) {
  return name.replace(/\./g, "").toUpperCase().slice(0, 8);
}

// Each patch: file, load address, original bytes, replacement bytes, reason.
const PATCHES = [
  {
    volume: "ULTIMA5", file: "STARTUP", address: 0x8169,
    before: [0x8d, 0x08, 0xc0, 0xa9, 0x00, 0x8d, 0x05, 0xc0, 0x8d, 0x7e, 0x03, 0x8d, 0x04, 0xc0, 0x85, 0xb1, 0x8d, 0x73, 0xc0],
    after: [0xea, 0xea, 0xea, 0xa9, 0x00, 0xea, 0xea, 0xea, 0x8d, 0x7e, 0x03, 0xea, 0xea, 0xea, 0x85, 0xb1, 0xea, 0xea, 0xea],
    why: "Apple IIe aux-memory/RamWorks resets ($C008/$C005/$C004/$C073); 3RIC has no aux bank and its $C00x decode is not specified for these.",
  },
];

function loadVolumes(diskDir) {
  const found = new Map();
  for (const entry of fs.readdirSync(diskDir)) {
    const full = path.join(diskDir, entry);
    if (!fs.statSync(full).isFile()) continue;
    let image;
    try { image = readProdosImage(new Uint8Array(fs.readFileSync(full))); } catch { continue; }
    if (!VOLUMES.some(([v]) => v === image.volume)) continue;
    if (found.has(image.volume)) throw new Error(`two images hold volume /${image.volume}`);
    found.set(image.volume, image);
  }
  const missing = VOLUMES.map(([v]) => v).filter((v) => !found.has(v));
  if (missing.length) throw new Error(`missing Ultima V disk(s): ${missing.map((v) => "/" + v).join(", ")}`);
  return found;
}

export function applyPatches(volumes) {
  for (const p of PATCHES) {
    const file = volumes.get(p.volume).files.find((f) => f.name === p.file);
    if (!file) throw new Error(`patch target ${p.volume}/${p.file} not found`);
    const offset = p.address - file.aux;
    const actual = Array.from(file.data.subarray(offset, offset + p.before.length));
    if (actual.join() !== p.before.join()) {
      if (actual.join() === p.after.join()) continue;
      throw new Error(`${p.volume}/${p.file} at $${p.address.toString(16)}: unexpected bytes (different release?)`);
    }
    file.data.set(p.after, offset);
  }
}

function fileTable(volumes) {
  // One entry per distinct (key, aux, eof); volmask bit n = present on VOLUMES[n].
  const table = new Map();
  VOLUMES.forEach(([volume], index) => {
    for (const f of volumes.get(volume).files) {
      const key = sdKey(f.name);
      for (const other of volumes.get(volume).files)
        if (other !== f && sdKey(other.name) === key) throw new Error(`/${volume}: ${f.name} and ${other.name} share SD key ${key}`);
      const id = `${key}/${f.aux}/${f.eof}`;
      const prev = table.get(id);
      if (prev && prev.name !== f.name) throw new Error(`SD key ${key} is shared by ${prev.name} and ${f.name}`);
      if (f.eof === 0 || f.eof > 0xffff) throw new Error(`${f.name}: unsupported size ${f.eof}`);
      if (prev) prev.volmask |= 1 << index;
      else table.set(id, { key, name: f.name, aux: f.aux, eof: f.eof, volmask: 1 << index });
    }
  });
  return [...table.values()];
}

function asmText(bytes) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) lines.push("        .byte " + Array.from(bytes.slice(i, i + 16), (b) => "$" + b.toString(16).padStart(2, "0")).join(","));
  return lines.join("\n");
}

/** Assemble resident, shim and loader into U5.PRG. */
export function buildLoader(table) {
  const resSrc = fs.readFileSync(path.join(patchDir, "resident.s"), "utf8");
  const resident = assemble(`BANKSIG_VALUE = $${BANKSIG_VALUE.toString(16)}\n${resSrc}`);
  const r = resident.symbols;
  if (resident.org !== 0xcf00 || resident.bytes.length > 0x100) throw new Error("resident exceeds $CF00-$CFFF");

  const tab = [];
  for (const e of [...table].sort((a, b) => a.key.localeCompare(b.key) || a.volmask - b.volmask)) {
    tab.push(...Buffer.from(e.key.padEnd(8, " "), "ascii"), e.aux & 255, e.aux >> 8, e.eof & 255, e.eof >> 8, e.volmask);
  }
  tab.push(0);
  const vol = [];
  for (const [name, dir] of VOLUMES) {
    const n = Buffer.alloc(11); n.write(name, "ascii");
    vol.push(...n, ...Buffer.from(dir.padEnd(8, " "), "ascii"));
  }
  vol.push(0);
  const shimSrc = `ROM_SEND = $${r.ROM_SEND.toString(16)}\nCMDBUF = $${r.CMDBUF.toString(16)}\n`
    + fs.readFileSync(path.join(patchDir, "shim.s"), "utf8")
    + `\nfiletab:\n${asmText(tab)}\nvoltab:\n${asmText(vol)}\nshim_end:\n`;
  const shim = assemble(shimSrc);
  const s = shim.symbols;
  if (shim.org !== 0xd000 || s.CODE_END > 0xd600) throw new Error("shim code overlaps the $D600 block buffer");
  if (s.SHIM_END > 0xdfff) throw new Error("shim tables overlap the bank signature at $DFFF");
  const shimImage = new Uint8Array(0x1000);
  shimImage.set(shim.bytes);
  shimImage[0xfff] = BANKSIG_VALUE;

  const loader = assemble(`ROMCSW_SRC = $${(SHIM_SRC + s.ROMCSW - 0xd000).toString(16)}\n`
    + `NMI_ENTRY = $${r.NMI_ENTRY.toString(16)}\nIRQ_ENTRY = $${r.IRQ_ENTRY.toString(16)}\n`
    + `RES_ORG = $${resident.org.toString(16)}\n`
    + fs.readFileSync(path.join(patchDir, "loader.s"), "utf8"));
  if (loader.org !== LOADER_ORG || loader.org + loader.bytes.length > RES_SRC) throw new Error("loader overlaps its payload");

  const prg = new Uint8Array(SHIM_SRC + 0x1000 - LOADER_ORG);
  prg.set(loader.bytes, 0);
  prg.set(resident.bytes, RES_SRC - LOADER_ORG);
  prg.set(shimImage, SHIM_SRC - LOADER_ORG);
  return { prg, resident, shim, loader };
}

/** Produce { "U5.PRG": bytes, ULTIMA5: { KEY: bytes, RAW00: ... }, ... }. */
export function buildTree(diskDir) {
  const volumes = loadVolumes(diskDir);
  applyPatches(volumes);
  return buildFromVolumes(volumes);
}

/** volumes: Map of volume name -> { files: [{ name, aux, eof, data }], blocks }.
 *  info (optional) receives the resident's NMI entry for tests. */
export function buildFromVolumes(volumes, info = {}) {
  const htxt = volumes.get("ULTIMA5").files.find((f) => f.name === "HTXT");
  if (!htxt || htxt.eof !== 2048 || htxt.data[0x7ff] === BANKSIG_VALUE)
    throw new Error("HTXT (copied to bank 2 $D800-$DFFF) would match the bank-1 signature");
  const table = fileTable(volumes);
  const { prg, resident } = buildLoader(table);
  info.nmiEntry = resident.symbols.NMI_ENTRY;
  const tree = { "U5.PRG": prg };
  for (const [name, dir] of VOLUMES) {
    const image = volumes.get(name);
    const files = {};
    for (const f of image.files) files[sdKey(f.name)] = f.data;
    for (let n = 0; n * RAW_BLOCKS * 512 < image.blocks.length; n++) {
      const raw = image.blocks.subarray(n * RAW_BLOCKS * 512, (n + 1) * RAW_BLOCKS * 512);
      const rawName = "RAW" + n.toString(16).toUpperCase().padStart(2, "0");
      if (files[rawName]) throw new Error(`${name}: a game file already uses the name ${rawName}`);
      files[rawName] = raw;
    }
    tree[dir] = files;
  }
  return tree;
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
    console.error("usage: node codegen/tools/port-ultima5.mjs <disk-images-dir> <output-dir>");
    process.exit(2);
  }
  const tree = buildTree(diskDir);
  writeTree({ U5: tree }, outDir);
  console.log(`wrote ${path.join(outDir, "U5")}: copy the U5 folder to the SD card root, then CD U5 and BRUN U5.PRG 0800`);
}
