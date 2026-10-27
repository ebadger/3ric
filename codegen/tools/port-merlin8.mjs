// Build the 3RIC SD-card edition of Merlin-8 2.58 (ProDOS) from the
// owner's two Merlin-8 ProDOS disk images.
//
//   node codegen/tools/port-merlin8.mjs <merlin-disk1.dsk> [<merlin-disk2.dsk>] <output-dir>
//
// Writes <output-dir>/MERLIN8/: the loader MERLIN.PRG, the patched
// MERLIN.SYSTEM (MERLIN.SYS), PARMS, ED and the disks' sample sources. Copy
// the MERLIN8 folder to the 3RIC micro-SD card, then at the ROM DOS prompt:
//     CD MERLIN8    then    BRUN MERLIN.PRG 0800
//
// ProDOS is replaced by a FAT32 file layer (codegen/patches/merlin8/prodos.s),
// so Merlin loads, saves, catalogs, renames and deletes real files on the
// card. Merlin-8 2.58 wants a 128 KB Apple IIe; 3RIC has 64 KB plus the
// language card, so byte-verified patches (PATCHES below) move its
// auxiliary-memory workspace into main RAM and keep it to 40 columns. The
// disk images and the generated folder contain Roger Wagner Publishing's
// copyrighted program; keep them local - this repository holds only the
// tool and the glue code.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const patchDir = path.join(root, "codegen", "patches", "merlin8");

export const FOLDER = "MERLIN8";
export const VOLUME = "MERLIN.8";
export const MERLIN_SYSTEM_SHA256 = "19f8102aa632426c111868c82ce069751d019cdd3d23347c90dec98aca1c0d39";
export const ED_SHA256 = "0e45a543e1ed32d4a4dca0a6833a6df02c475f0c1808091ae30b5731b567ec27";
export const ED_ORG = 0x9db6;

// Main-RAM layout (pages). Merlin's source runs from $0901 to SRC_LIMIT;
// its "auxiliary" workspace (symbol table from SYM, object buffer from OBJ,
// both below TOP) and the stand-in follow; ED stays at $9DB6.
export const LAYOUT = { SRC_LIMIT: 0x58, SYM: 0x58, OBJ: 0x70, TOP: 0x85, STANDIN: 0x8500 };

const LOADER_ORG = 0x0800, IMG_SA = 0x0c00, RES_ORG = 0xcf00;

// The ROM code the stand-in, resident and loader depend on: [first, last].
export const ROM_RANGES = [
  [0xe1b9, 0xe204], // sd_readsector
  [0xe21c, 0xe279], // sd_writesector
  [0xe332, 0xe3e8], // fat32_init: FAT/data start, root, sectors per cluster/FAT, FAT count
  [0xe5d3, 0xe5ff], // fat32_openroot: current directory cluster $CC20
  [0xed32, 0xed48], // setup_cout_hook
  [0xede7, 0xedf9], // newprompt
  [0xf1bb, 0xf1d0], // NMI proxy (the resident shares its PS/2 receiver state)
  [0xfded, 0xfdff], // COUT, COUT1
  [0xfe2c, 0xfe35], // MOVE
  [0xfe89, 0xfead], // SETKBD, SETVID, IOPRT
];

/** ProDOS name -> FAT 8.3 the way prodos.s maps it (the part before the
 *  last dot without dots, 8 characters; up to 3 after it). */
export function to83(name) {
  const n = name.toUpperCase();
  const dot = n.lastIndexOf(".");
  const base = (dot < 0 ? n : n.slice(0, dot)).replace(/\./g, "").slice(0, 8);
  const ext = dot < 0 ? "" : n.slice(dot + 1, dot + 4);
  return ext ? `${base}.${ext}` : base;
}

// ---------------------------------------------------------------------------
// ProDOS volume reader (140 KB images, DOS or ProDOS order, subdirectories).

const DOS_FIRST = [0, 13, 11, 9, 7, 5, 3, 1], DOS_SECOND = [14, 12, 10, 8, 6, 4, 2, 15];
const word = (b, o) => b[o] | (b[o + 1] << 8);

export function readProdosVolume(image) {
  if (image.length !== 143360) throw new Error(`expected a 143360-byte 5.25" image, got ${image.length}`);
  let read = null;
  for (const order of ["do", "po"]) {
    const r = (block) => {
      if (block < 0 || block >= 280) throw new Error(`ProDOS block ${block} out of range`);
      if (order === "po") return image.subarray(block * 512, block * 512 + 512);
      const t = block >> 3, h = block & 7, out = new Uint8Array(512);
      out.set(image.subarray(t * 4096 + DOS_FIRST[h] * 256, t * 4096 + DOS_FIRST[h] * 256 + 256), 0);
      out.set(image.subarray(t * 4096 + DOS_SECOND[h] * 256, t * 4096 + DOS_SECOND[h] * 256 + 256), 256);
      return out;
    };
    const b = r(2);
    if (word(b, 0) === 0 && (b[4] >> 4) === 0xf && b[0x23] === 0x27 && b[0x24] === 0x0d) { read = r; break; }
  }
  if (!read) throw new Error("not a ProDOS volume");
  const hdr = read(2);
  const volume = String.fromCharCode(...hdr.subarray(5, 5 + (hdr[4] & 15)));
  const files = [], dirs = [];
  const walk = (block, prefix, depth) => {
    if (depth > 4) throw new Error("directories nested too deeply");
    for (let first = true, guard = 0; block; first = false) {
      if (++guard > 64) throw new Error("directory chain too long");
      const b = read(block);
      for (let i = first ? 1 : 0; i < 13; i++) {
        const e = b.subarray(4 + i * 39, 43 + i * 39);
        const storage = e[0] >> 4;
        if (!storage) continue;
        const name = String.fromCharCode(...e.subarray(1, 1 + (e[0] & 15)));
        const key = word(e, 0x11), eof = e[0x15] | (e[0x16] << 8) | (e[0x17] << 16);
        if (storage === 13) { dirs.push(prefix + name); walk(key, prefix + name + "/", depth + 1); continue; }
        const data = new Uint8Array(eof);
        if (storage === 1) data.set(read(key).subarray(0, eof));
        else if (storage === 2) {
          const index = read(key);
          for (let n = 0; n * 512 < eof; n++) {
            const ptr = index[n] | (index[256 + n] << 8);
            if (ptr) data.set(read(ptr).subarray(0, Math.min(512, eof - n * 512)), n * 512);
          }
        } else throw new Error(`${prefix}${name}: unsupported storage type ${storage}`);
        files.push({ path: prefix + name, name, type: e[0x10], aux: word(e, 0x1f), eof, data });
      }
      block = word(b, 2);
    }
  };
  walk(2, "", 0);
  return { volume, files, dirs };
}

// ---------------------------------------------------------------------------
// Patches. Addresses are where MERLIN.SYSTEM holds the bytes while it runs
// at $2000: its main-memory part ($B200-$BEFF) at $23C4, language-card bank
// 1 ($D000-$DFFF) at $30C4 and bank 2 ($D000-$F877) at $40C4.

const MAIN = (a) => a - 0xb200 + 0x23c4;
const BANK1 = (a) => a - 0xd000 + 0x30c4;
const BANK2 = (a) => a - 0xd000 + 0x40c4;
const NOP = 0xea;
const lo = (v) => v & 255, hi = (v) => v >> 8;

const uppercaseUiTextPatch = (at, text, why, spacesHighBit = true) => {
  const before = Array.from(text, (char) => {
    const code = char.charCodeAt(0);
    return code === 0x20 && !spacesHighBit ? code : code | 0x80;
  });
  const after = before.map((byte) => {
    const code = byte & 0x7f;
    return code >= 0x61 && code <= 0x7a ? byte - 0x20 : byte;
  });
  return { at, before, after, why };
};

/** Byte patches to the MERLIN.SYSTEM image; glue = the stand-in's symbols. */
export function systemPatches(glue) {
  const { SRC_LIMIT, SYM, OBJ, TOP } = LAYOUT;
  const jsr = (a) => [0x20, lo(a), hi(a)];
  return [
    { at: 0x2076, before: [0x8d, 0x73, 0xc0], after: [NOP, NOP, NOP], why: "Drop the RamWorks bank store (STA $C073): 3RIC has no aux banks, and the $C07x page is the paddle/pad trigger." },
    { at: MAIN(0xb6eb), before: [0x8d, 0x73, 0xc0], after: [NOP, NOP, NOP], why: "The same RamWorks store on Merlin's restart path." },
    { at: 0x2088, before: [0xa9, 0x03], after: [0xa9, 0x00], why: "PR#0, not PR#3: 3RIC has no 80-column firmware at $C300 (that page is the ROM disk)." },
    { at: BANK2(0xe0d3), before: [0xad, 0x09, 0xe0], after: [0xa9, 0x00, NOP], why: "Editor video setup always selects 40 columns (VID cannot reach $C300)." },
    { at: 0x20ca, before: [0xd0, 0x9d], after: [NOP, NOP], why: "Accept a 64 KB machine (MACHID): the auxiliary memory Merlin wants is provided in main RAM by the patches below." },
    { at: 0x20ea, before: [0xa9, 0xaa], after: [0xa9, SRC_LIMIT], why: "HIMEM: source ends at the workspace." },
    { at: MAIN(0xba14), before: [0xc4, 0x0c, 0xe5, 0x0d], after: [...jsr(glue.EDCHK), NOP], why: "BLOAD range check: loads must end below the source limit, except ED at its own $9DB6-$A9FF." },
    { at: 0x2248, before: [0x20, 0x2c, 0xfe], after: jsr(glue.FIXUP), why: "After copying the monitor into the language card, point its NMI vector at the resident (PS/2 keyboard NMIs while Merlin runs from that RAM)." },
    { at: BANK2(0xe666), before: [0x8e, 0x00, 0x10], after: [0x8e, 0x00, SYM], why: "Symbol table: empty-table marker at its new base." },
    { at: BANK2(0xe678), before: [0xa9, 0xc0, 0x85, 0xc8, 0x85, 0x83, 0x86, 0xe2, 0x0a, 0x85, 0xe3], after: [...jsr(glue.BOUNDS), NOP, NOP, NOP, NOP, NOP, NOP, NOP, NOP], why: "Workspace top and object buffer base (bounds in the stand-in)." },
    { at: BANK2(0xe6bd), before: [0xa9, 0x10], after: [0xa9, SYM], why: "Symbol table base ($7B/$7C)." },
    { at: BANK2(0xecb2), before: [0xa9, 0x10], after: [0xa9, SYM], why: "Symbol table scan base (listing)." },
    { at: BANK2(0xf650), before: [0xa9, 0x10], after: [0xa9, SYM], why: "Symbol table scan base." },
    { at: BANK1(0xd80c), before: [0xa9, 0x10], after: [0xa9, SYM], why: "Symbol lookup base." },
    { at: BANK2(0xeb34), before: [0xc0, 0x40], after: [0xc0, OBJ], why: "OBJ directive: lowest buffer page." },
    { at: BANK2(0xeb38), before: [0xc0, 0xbf], after: [0xc0, TOP - 1], why: "OBJ directive: highest buffer page." },
    { at: BANK2(0xec94), before: [0x49, 0xc0], after: [0x49, TOP], why: "End of the downward list (workspace top)." },
    { at: BANK1(0xd014), before: [0xa9, 0x10], after: [0xa9, SYM], why: "Linker workspace base." },
    { at: BANK1(0xd23f), before: [0xc9, 0xbe], after: [0xc9, TOP - 2], why: "Linker workspace limit." },
    { at: BANK1(0xd267), before: [0xa9, 0x10], after: [0xa9, SYM], why: "Linker move base." },
    { at: BANK1(0xd2c0), before: [0xa9, 0x0f], after: [0xa9, SYM - 1], why: "Linker scan base." },
    { at: BANK1(0xd333), before: [0xa9, 0x0f], after: [0xa9, SYM - 1], why: "Linker scan base." },
    { at: BANK2(0xf7ef), before: [0xa9, 0x0f], after: [0xa9, SYM - 1], why: "Linker entry-point list base." },
    { at: BANK1(0xd280), before: [0x20, 0x11, 0xc3], after: jsr(glue.AMOVE), why: "AUXMOVE ($C311, IIe firmware) is a plain MOVE when aux memory is main memory." },
    { at: BANK2(0xd592), before: [0x20, 0x11, 0xc3], after: jsr(glue.AMOVE), why: "AUXMOVE, as above." },
    uppercaseUiTextPatch(0x2347, "version", "Startup version label."),
    uppercaseUiTextPatch(0x235c, "by Glen E. Bredon", "Startup author credit."),
    uppercaseUiTextPatch(0x2375, "Copyright (C)  1987", "Startup copyright line."),
    uppercaseUiTextPatch(0x238a, "Roger Wagner Publishing, Inc.", "Startup publisher credit."),
    uppercaseUiTextPatch(0x244f, "Insert", "Insert prompt."),
    uppercaseUiTextPatch(0x255d, "Name", "Catalog heading."),
    uppercaseUiTextPatch(0x2567, "Type", "Catalog heading."),
    uppercaseUiTextPatch(0x256d, "Blocks", "Catalog heading."),
    uppercaseUiTextPatch(0x2575, "Modified", "Catalog heading."),
    uppercaseUiTextPatch(0x2585, "Created", "Catalog heading."),
    uppercaseUiTextPatch(0x2592, "Length Subtype", "Catalog heading."),
    uppercaseUiTextPatch(0x26aa, "Blocks free:", "Catalog summary."),
    uppercaseUiTextPatch(0x26cb, "Blocks used:", "Catalog summary."),
    uppercaseUiTextPatch(0x26e8, "Total blocks:", "Catalog summary."),
    uppercaseUiTextPatch(0x278c, "[no date]", "Catalog date placeholder."),
    uppercaseUiTextPatch(0x304b, "Copyright (C) 1984 by Glen E. Bredon & RWP, Santee, CA", "Parameter-module copyright line."),
    uppercaseUiTextPatch(0x3086, "Copyright (C) 1984  by Glen E. Bredon & RWP, Santee, Calif.", "Parameter-module copyright line."),
    uppercaseUiTextPatch(0x3255, "Constraint error:", "Linker diagnostic."),
    uppercaseUiTextPatch(0x3360, "Externals:", "Linker output heading."),
    uppercaseUiTextPatch(0x3421, "duplicate", "Linker diagnostic."),
    uppercaseUiTextPatch(0x34c0, "resolved", "Linker diagnostic."),
    uppercaseUiTextPatch(0x3b9f, "in line:", "Assembler diagnostic."),
    uppercaseUiTextPatch(0x3cc3, "Give value for", "Assembler prompt."),
    uppercaseUiTextPatch(0x4d80, "Extra command characters", "Assembler diagnostic."),
    uppercaseUiTextPatch(0x4d9b, "Format", "Assembler diagnostic."),
    uppercaseUiTextPatch(0x4da4, "Overflow", "Assembler diagnostic."),
    uppercaseUiTextPatch(0x4daf, "Memory full", "Assembler diagnostic."),
    uppercaseUiTextPatch(0x4dbd, "Range", "Assembler diagnostic."),
    uppercaseUiTextPatch(0x4dc3, "Bytes used", "Assembler summary.", false),
    uppercaseUiTextPatch(0x4dce, "Bytes left", "Assembler summary.", false),
    uppercaseUiTextPatch(0x4dd9, "All or some (A/S)?", "Assembler prompt."),
    uppercaseUiTextPatch(0x4dec, "Update source (Y/N)?", "Assembler prompt."),
    uppercaseUiTextPatch(0x4e01, "Assembling", "Assembler status."),
    uppercaseUiTextPatch(0x4e7a, "By Glen Bredon", "Main-menu author credit."),
    uppercaseUiTextPatch(0x4e8b, "C :Catalog", "Main-menu option."),
    uppercaseUiTextPatch(0x4e96, "L :Load source", "Main-menu option."),
    uppercaseUiTextPatch(0x4ea5, "S :Save source", "Main-menu option."),
    uppercaseUiTextPatch(0x4eb4, "A :Append file", "Main-menu option."),
    uppercaseUiTextPatch(0x4ec3, "D :Disk command", "Main-menu option."),
    uppercaseUiTextPatch(0x4ed3, "E :Enter ED/ASM", "Main-menu option."),
    uppercaseUiTextPatch(0x4ee3, "O :Save object code", "Main-menu option."),
    uppercaseUiTextPatch(0x4ef7, "@ :Set date", "Main-menu option."),
    uppercaseUiTextPatch(0x4f03, "Q :Quit", "Main-menu option."),
    uppercaseUiTextPatch(0x4f12, "Source:", "Main-menu source label."),
    uppercaseUiTextPatch(0x4f46, "Object:", "Main-menu object label."),
    uppercaseUiTextPatch(0x4f58, "Prefix:", "Main-menu prefix label."),
    uppercaseUiTextPatch(0x52e2, "Disk command:", "Disk-command prompt."),
    uppercaseUiTextPatch(0x5308, "Pathname:", "Disk-command prompt."),
    uppercaseUiTextPatch(0x534e, "Load:", "Load prompt."),
    uppercaseUiTextPatch(0x53d2, "Editor", "Editor prompt."),
    uppercaseUiTextPatch(0x53e3, "Append:", "Append prompt."),
    uppercaseUiTextPatch(0x5406, "Save:", "Save prompt."),
    uppercaseUiTextPatch(0x542b, "Quit?", "Quit prompt."),
    uppercaseUiTextPatch(0x5451, "Object saved as", "Object-save message."),
    uppercaseUiTextPatch(0x5493, "Object:", "Object prompt."),
    uppercaseUiTextPatch(0x5567, "Hit a key", "Key prompt."),
    uppercaseUiTextPatch(0x55c6, "Date:", "Date prompt."),
    uppercaseUiTextPatch(0x6673, "bytes, Errors:", "Assembler summary."),
    uppercaseUiTextPatch(0x6693, "--End assembly,", "Assembler summary."),
    uppercaseUiTextPatch(0x66e8, "alphabet", "Symbol-table sort label."),
    uppercaseUiTextPatch(0x66f4, "ical order:", "Symbol-table sort label."),
    uppercaseUiTextPatch(0x672f, "numer", "Symbol-table sort label."),
    uppercaseUiTextPatch(0x67cd, "Symbol table -", "Symbol-table heading."),
    uppercaseUiTextPatch(0x689c, "Entry addresses:", "Symbol-table heading."),
  ];
}

export function edPatches(glue) {
  return [
    { at: 0x9ddf, before: [0xa9, 0x9e], after: [0xa9, LAYOUT.SRC_LIMIT], why: "HIMEM: source ends at the workspace." },
    { at: 0x9e03, before: [0xbf, 0xa0], after: [lo(glue.OAKEY), hi(glue.OAKEY)], why: "ED's key vector: Ctrl-A then a key is Open-Apple + key (3RIC has no Apple keys)." },
    { at: 0x9ee3, before: [0x2c, 0x61, 0xc0], after: [0x2c, lo(glue.OAFLAG), hi(glue.OAFLAG)], why: "ED's Open-Apple test reads the Ctrl-A flag." },
    { at: 0xa389, before: [0x2c, 0x61, 0xc0], after: [0x2c, lo(glue.OAFLAG), hi(glue.OAFLAG)], why: "ED's Open-Apple command dispatch reads the Ctrl-A flag." },
    { at: 0xa429, before: [0xad, 0x61, 0xc0], after: [0xad, lo(glue.OAFLAG), hi(glue.OAFLAG)], why: "ED's type-ahead pauses while the Ctrl-A flag is set." },
    uppercaseUiTextPatch(0xa0b2, "Hit a key", "ED key prompt."),
    uppercaseUiTextPatch(0xa523, "Out of memory!", "ED diagnostic."),
    uppercaseUiTextPatch(0xa6d6, "Change:", "ED prompt."),
    uppercaseUiTextPatch(0xa6e2, "To:", "ED prompt."),
    uppercaseUiTextPatch(0xa799, "Text to FIND", "ED prompt."),
    uppercaseUiTextPatch(0xa7d1, "LABEL to go to", "ED prompt."),
    uppercaseUiTextPatch(0xa9c9, "Free:", "ED status label."),
    uppercaseUiTextPatch(0xa9e4, "Used:", "ED status label."),
  ];
}

export function parmsPatches() {
  return [
    { at: 4, before: [0x83], after: [0x00], why: "40 columns, Merlin and ProDOS in main memory." },
    { at: 7, before: [0x00, 0xaa], after: [0x00, LAYOUT.SRC_LIMIT], why: "Source limit." },
  ];
}

/** Apply patches to a copy of data loaded at base; refuses other releases. */
export function applyPatches(data, base, patches, what) {
  const out = Uint8Array.from(data);
  for (const p of patches) {
    const o = p.at - base;
    const actual = Array.from(out.subarray(o, o + p.before.length));
    if (actual.join() === p.after.join()) continue;
    if (actual.join() !== p.before.join())
      throw new Error(`${what} at $${p.at.toString(16)}: unexpected bytes (different release?)`);
    out.set(p.after, o);
  }
  return out;
}

/** Fletcher-style sums (mod 256) of ROM code ranges, as loader.s checks them. */
export function romSums(rom) {
  return ROM_RANGES.map(([a, b]) => {
    let s1 = 0, s2 = 0;
    for (let i = a; i <= b; i++) { s1 = (s1 + rom[i]) & 255; s2 = (s2 + s1) & 255; }
    return [a, b, s1, s2];
  });
}

const hex = (v) => "$" + v.toString(16).toUpperCase();
const asmBytes = (bytes) => {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 12) lines.push("        .byte " + bytes.slice(i, i + 12).map((b) => hex(b)).join(","));
  return lines.join("\n");
};

/** Assemble the resident, the stand-in and the loader into MERLIN.PRG. */
export function buildLoader(rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"))) {
  const resident = assemble(fs.readFileSync(path.join(patchDir, "resident.s"), "utf8"));
  if (resident.org !== RES_ORG || resident.bytes.length > 0x100) throw new Error("resident must fit $CF00-$CFFF");
  const r = resident.symbols;
  const sa = assemble([
    `STANDIN = ${hex(LAYOUT.STANDIN)}`, `NMI_ENTRY = ${hex(r.NMI_ENTRY)}`, `LC_MODE = ${hex(r.LC_MODE)}`,
    `WS_TOP = ${hex(LAYOUT.TOP)}`, `OBJ_PAGE = ${hex(LAYOUT.OBJ)}`, `ED_ORG = ${hex(ED_ORG)}`,
    fs.readFileSync(path.join(patchDir, "prodos.s"), "utf8"),
  ].join("\n"));
  const s = sa.symbols;
  if (sa.org !== LAYOUT.STANDIN || s.GP_END !== 0xc000) throw new Error("stand-in layout drifted");
  if (s.VARS_END > ED_ORG) throw new Error(`stand-in overruns ED (${hex(s.VARS_END)})`);
  if (s.NODEV !== 0xbf4a) throw new Error("global page layout drifted");
  if (s.CBUF !== 0xae00 || s.FBUF !== 0xb000) throw new Error("cache buffers moved");
  const code = sa.bytes.subarray(0, s.CODE_END - LAYOUT.STANDIN);
  const gp = sa.bytes.subarray(0xbf00 - LAYOUT.STANDIN, 0xc000 - LAYOUT.STANDIN);
  const IMG_GP = (IMG_SA + code.length + 255) & ~255, IMG_RES = IMG_GP + 0x100;

  const sums = romSums(rom).flatMap(([a, b, s1, s2]) => [lo(a), hi(a), lo(b), hi(b), s1, s2]);
  const equates = [
    `IMG_SA = ${hex(IMG_SA)}`, `IMG_GP = ${hex(IMG_GP)}`, `IMG_RES = ${hex(IMG_RES)}`,
    `RES_SIZE = ${resident.bytes.length}`, `ED_ORG = ${hex(ED_ORG)}`,
    ...Object.entries(s).filter(([k]) => /^[A-Z_][A-Z0-9_]*$/.test(k)).map(([k, v]) => `S_${k} = ${hex(v & 0xffff)}`),
  ].join("\n");
  const loaderSrc = fs.readFileSync(path.join(patchDir, "loader.s"), "utf8")
    .replace(/^rom_sums:.*$/m, `rom_sums:\n${asmBytes(sums)}\n        .byte 0,0`);
  const loader = assemble(equates + "\n" + loaderSrc);
  if (loader.org !== LOADER_ORG || loader.org + loader.bytes.length > IMG_SA) throw new Error("loader overlaps the stand-in image");

  const prg = new Uint8Array(IMG_RES + resident.bytes.length - LOADER_ORG);
  prg.set(loader.bytes, 0);
  prg.set(code, IMG_SA - LOADER_ORG);
  prg.set(gp, IMG_GP - LOADER_ORG);
  prg.set(resident.bytes, IMG_RES - LOADER_ORG);
  return { prg, standin: sa, loader, resident };
}

const sha = (d) => crypto.createHash("sha256").update(d).digest("hex");

const SYSTEM_ERROR_TEXT_RANGE = {
  at: 0x60a4,
  length: 0x12b,
  beforeSha256: "ab25bc072fa621777b4c2032cd32ca2fdbae367eb37dad2e046eb79c2de0da1a",
  afterSha256: "c6e45153baa9afae37474420fc0c0115b437527080cdf274b82ac07b92554e4a",
};

/** Uppercase a release-guarded range of text while preserving Apple II bit 7. */
export function uppercaseAsciiRange(data, base, range, what) {
  const offset = range.at - base;
  const end = offset + range.length;
  if (!Number.isInteger(offset) || !Number.isInteger(range.length) || offset < 0 || range.length < 0 || end > data.length)
    throw new Error(`${what}: text range is outside the image`);

  const digest = sha(data.subarray(offset, end));
  if (digest === range.afterSha256) return Uint8Array.from(data);
  if (digest !== range.beforeSha256)
    throw new Error(`${what} at $${range.at.toString(16)}: unexpected text bytes (different release?)`);

  const out = Uint8Array.from(data);
  for (let i = offset; i < end; i++) {
    const byte = out[i], code = byte & 0x7f;
    if (code >= 0x61 && code <= 0x7a) out[i] = (byte & 0x80) | (code - 0x20);
  }
  if (sha(out.subarray(offset, end)) !== range.afterSha256)
    throw new Error(`${what} at $${range.at.toString(16)}: uppercase patch did not match the release`);
  return out;
}

/** The folder tree for the card: { NAME: Uint8Array | subtree }. */
export function buildTree(disk1, disk2 = null, opts = {}) {
  const vol = readProdosVolume(disk1);
  if (vol.volume !== VOLUME) throw new Error(`expected ProDOS volume /${VOLUME}, found /${vol.volume}`);
  const get = (p) => {
    const f = vol.files.find((x) => x.path === p);
    if (!f) throw new Error(`${p} not found on the Merlin disk`);
    return f;
  };
  const system = get("MERLIN.SYSTEM"), ed = get("ED"), parms = get("PARMS");
  if (!opts.skipHashes) {
    if (sha(system.data) !== MERLIN_SYSTEM_SHA256) throw new Error(`MERLIN.SYSTEM is a different release (sha256 ${sha(system.data)})`);
    if (sha(ed.data) !== ED_SHA256) throw new Error(`ED is a different release (sha256 ${sha(ed.data)})`);
  }
  if (ed.aux !== ED_ORG) throw new Error("ED does not load at $9DB6");
  const { prg, standin } = buildLoader(opts.rom);
  const glue = standin.symbols;
  const patchedSystem = applyPatches(system.data, 0x2000, systemPatches(glue), "MERLIN.SYSTEM");
  const uppercaseSystem = uppercaseAsciiRange(patchedSystem, 0x2000, SYSTEM_ERROR_TEXT_RANGE, "MERLIN.SYSTEM error table");
  const tree = {
    "MERLIN.PRG": prg,
    "MERLIN.SYS": uppercaseSystem,
    PARMS: applyPatches(parms.data, 0, parmsPatches(), "PARMS"),
    ED: applyPatches(ed.data, ED_ORG, edPatches(glue), "ED"),
  };
  // Sample sources. SOURCEROR and UTILITIES load at fixed addresses inside
  // the relocated workspace or the stand-in, so they are left out.
  const add = (node, rel, data, where) => {
    const key = to83(rel);
    if (key in node) throw new Error(`${where}: two files map to ${key}`);
    node[key] = data;
  };
  for (const f of vol.files) {
    const [dir, name, more] = f.path.split("/");
    if (!name || more || !["SOURCE", "LIBRARY", "PI"].includes(dir)) continue;
    const node = (tree[to83(dir)] ||= {});
    add(node, name, f.data, dir);
  }
  if (disk2) {
    const v2 = readProdosVolume(disk2);
    const node = (tree[to83(v2.volume)] ||= {});
    for (const f of v2.files) if (!f.path.includes("/")) add(node, f.name, f.data, v2.volume);
  }
  return tree;
}

/** Write the tree to outDir (nested folders). */
export function writeTree(tree, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, value] of Object.entries(tree)) {
    const target = path.join(outDir, name);
    if (value instanceof Uint8Array) fs.writeFileSync(target, value);
    else writeTree(value, target);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length > 3) {
    console.error("usage: node codegen/tools/port-merlin8.mjs <merlin-disk1.dsk> [<merlin-disk2.dsk>] <output-dir>");
    process.exit(2);
  }
  const outDir = args[args.length - 1];
  const disk1 = new Uint8Array(fs.readFileSync(args[0]));
  const disk2 = args.length === 3 ? new Uint8Array(fs.readFileSync(args[1])) : null;
  const target = path.join(outDir, FOLDER);
  writeTree(buildTree(disk1, disk2), target);
  console.log(`wrote ${target}: copy the ${FOLDER} folder to the SD card, then CD ${FOLDER} and BRUN MERLIN.PRG 0800`);
}
