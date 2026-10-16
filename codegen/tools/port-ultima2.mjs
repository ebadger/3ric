// Build the 3RIC SD-card edition of Ultima II from its three Apple II disks.
//
//   node codegen/tools/port-ultima2.mjs <disk-images-dir> <output-dir>
//
// Reads the program, player-master and galactic DOS 3.3 images (.dsk/.do,
// any names) and writes <output-dir>/U2/: the loader U2.PRG plus one folder
// per disk (PROGRAM, PLAYER, GALACTIC). Copy the U2 folder to the root of the
// 3RIC micro-SD card, then at the ROM DOS prompt:  CD U2   BRUN U2.PRG 0800
//
// Ultima II talks to DOS 3.3 only through Ctrl-D text commands, so the game
// binaries are kept; a resident translator replaces DOS 3.3 underneath them
// (codegen/patches/ultima2/resident.s). Five byte-verified patches turn the
// "insert disk" prompts into folder switches. The disk images and the
// generated folder contain Origin's copyrighted game; keep them local -
// this repository holds only the tool and the glue code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { readDos33Image } from "./ultima2/dos33.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const patchDir = path.join(root, "codegen", "patches", "ultima2");

// Disk number (the translator's DISK n) -> SD folder, and how each disk is recognised.
export const DISKS = [
  { n: 1, dir: "PROGRAM", marker: "ULTIMA II.OBJ", what: "program disk" },
  { n: 2, dir: "PLAYER", marker: "MAP 00", what: "player master disk" },
  { n: 3, dir: "GALACTIC", marker: "MAP 50", what: "galactic disk" },
];
const LOADER_ORG = 0x0800, RES_SRC = 0x0900, RES_ORG = 0x9600, RES_LIMIT = 0xb000;

/** DOS 3.3 name -> SD key: its first eight letters and digits (the translator does the same). */
export function sdKey(name) {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

const hi = (s) => Array.from(s, (c) => c.charCodeAt(0) | 0x80);

// An "insert disk" prompt printed by JSR $402C/$65BA (bytes up to the NUL),
// followed by a wait for ESC whose BNE is at waitBne. The prompt becomes
// Ctrl-D "DISK n" (the print routine sets bit 7), padded, ending in CR; the
// wait falls through.
function prompt(disk, file, address, text, tail, waitBne, waitBefore, n) {
  const before = [...hi(text), ...tail];
  const cmd = [0x04, ...Buffer.from(`DISK ${n}`, "ascii")];
  if (cmd.length + 1 > before.length) throw new Error("prompt too short for DISK command");
  const after = [...cmd, ...Array(before.length - cmd.length - 1).fill(0x20), 0x0d];
  return [
    { disk, file, address, before: [...before, 0x00], after: [...after, 0x00], why: `"${text}" -> select disk ${n}` },
    { disk, file, address: waitBne, before: waitBefore, after: [0xea, 0xea], why: "no wait for ESC after the disk swap" },
  ];
}

export const PATCHES = [
  ...prompt(1, "ULTIMA II.OBJ", 0x500d, "(INSERT PLAYER DISK)", [], 0x502a, [0xd0, 0xf9], 2),
  ...prompt(1, "CREATE", 0x600d, "(INSERT A BLANK PLAYER DISK)", [0x0d], 0x6030, [0xd0, 0xf9], 2),
  ...prompt(1, "CREATE", 0x6586, "INSERT PROGRAM MASTER", [], 0x65a1, [0xd0, 0xf9], 1),
  ...[2, 3].flatMap((disk) => [
    ...prompt(disk, "STARS.OBJ", 0x8fd7, "(INSERT PLAYER DISK)", [0x8d], 0x8ff5, [0xd0, 0xf6], 2),
    ...prompt(disk, "STARS.OBJ", 0x9005, "(INSERT GALACTIC DISK)", [0x8d], 0x9025, [0xd0, 0xf6], 3),
  ]),
];
for (const p of PATCHES) if (p.before.length !== p.after.length) throw new Error("patch length mismatch");

/** Read every DOS 3.3 image in diskDir and assign the three Ultima II disks. */
export function loadDisks(diskDir) {
  const found = new Map();
  for (const entry of fs.readdirSync(diskDir)) {
    const full = path.join(diskDir, entry);
    if (!fs.statSync(full).isFile()) continue;
    let image;
    try { image = readDos33Image(new Uint8Array(fs.readFileSync(full))); } catch { continue; }
    for (const d of DISKS) {
      if (!image.files.some((f) => f.name === d.marker)) continue;
      if (found.has(d.n)) throw new Error(`two images look like the ${d.what}: ${found.get(d.n).source} and ${entry}`);
      found.set(d.n, { ...image, source: entry });
    }
  }
  const missing = DISKS.filter((d) => !found.has(d.n));
  if (missing.length) throw new Error(`missing Ultima II ${missing.map((d) => d.what).join(", ")} (DOS 3.3 .dsk/.do)`);
  return found;
}

export function applyPatches(disks) {
  for (const p of PATCHES) {
    const file = disks.get(p.disk).files.find((f) => f.name === p.file);
    if (!file) throw new Error(`patch target ${p.file} not found on disk ${p.disk}`);
    const offset = p.address - file.addr;
    const actual = Array.from(file.data.subarray(offset, offset + p.before.length));
    if (actual.join() === p.after.join()) continue;
    if (actual.join() !== p.before.join())
      throw new Error(`${p.file} at $${p.address.toString(16)}: unexpected bytes (different release?)`);
    file.data.set(p.after, offset);
  }
}

/** One entry per distinct (key, address, length); mask bit n-1 = present on disk n. */
export function fileTable(disks) {
  const table = new Map();
  for (const d of DISKS) {
    const keys = new Map();
    for (const f of disks.get(d.n).files) {
      if (f.type !== 4) throw new Error(`${d.dir}/${f.name}: not a binary file`);
      const key = sdKey(f.name);
      if (!key) throw new Error(`${f.name}: no letters or digits for an SD name`);
      if (keys.has(key)) throw new Error(`${d.dir}: ${keys.get(key)} and ${f.name} share the SD name ${key}`);
      keys.set(key, f.name);
      const id = `${key}/${f.addr}/${f.len}`;
      const prev = table.get(id);
      if (prev) prev.mask |= 1 << (d.n - 1);
      else table.set(id, { key, addr: f.addr, len: f.len, mask: 1 << (d.n - 1) });
    }
  }
  return [...table.values()].sort((a, b) => a.key.localeCompare(b.key) || a.mask - b.mask);
}

function asmBytes(bytes) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16)
    lines.push("        .byte " + Array.from(bytes.slice(i, i + 16), (b) => "$" + b.toString(16).padStart(2, "0")).join(","));
  return lines.join("\n");
}

/** Assemble the resident translator (with its file table) and the loader into U2.PRG. */
export function buildLoader(table) {
  const tab = [];
  for (const e of table) tab.push(...Buffer.from(e.key.padEnd(8, " "), "ascii"), e.mask, e.addr & 255, e.addr >> 8, e.len & 255, e.len >> 8);
  tab.push(0);
  const resident = assemble(fs.readFileSync(path.join(patchDir, "resident.s"), "utf8") + "\n" + asmBytes(tab) + "\nresident_end:\n");
  const r = resident.symbols;
  if (resident.org !== RES_ORG) throw new Error("resident must assemble at $9600");
  if (RES_ORG + resident.bytes.length > RES_LIMIT) throw new Error(`resident and file table overrun $${RES_LIMIT.toString(16)}`);
  const pages = Math.ceil(resident.bytes.length / 256);
  const loader = assemble(`RES_ORG = $${RES_ORG.toString(16)}\nRES_PAGES = ${pages}\n`
    + `RES_ROMCSW = $${r.ROMCSW.toString(16)}\nRES_ORIGCSW = $${r.ORIGCSW.toString(16)}\n`
    + fs.readFileSync(path.join(patchDir, "loader.s"), "utf8"));
  if (loader.org !== LOADER_ORG || loader.org + loader.bytes.length > RES_SRC) throw new Error("loader overlaps the resident image");
  const prg = new Uint8Array(RES_SRC - LOADER_ORG + pages * 256);
  prg.set(loader.bytes, 0);
  prg.set(resident.bytes, RES_SRC - LOADER_ORG);
  return { prg, resident, loader };
}

/** disks: Map n -> { files: [{ name, type, addr, len, data }] } (patched). */
export function buildFromDisks(disks, info = {}) {
  const table = fileTable(disks);
  const { prg, resident } = buildLoader(table);
  info.resident = resident;
  info.table = table;
  const tree = { "U2.PRG": prg };
  for (const d of DISKS) {
    const files = {};
    for (const f of disks.get(d.n).files) files[sdKey(f.name)] = f.data;
    tree[d.dir] = files;
  }
  return tree;
}

export function buildTree(diskDir, info) {
  const disks = loadDisks(diskDir);
  applyPatches(disks);
  return buildFromDisks(disks, info);
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
    console.error("usage: node codegen/tools/port-ultima2.mjs <disk-images-dir> <output-dir>");
    process.exit(2);
  }
  const tree = buildTree(diskDir);
  writeTree({ U2: tree }, outDir);
  console.log(`wrote ${path.join(outDir, "U2")}: copy the U2 folder to the SD card root, then CD U2 and BRUN U2.PRG 0800`);
}
