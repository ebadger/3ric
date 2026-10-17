// Build the 3RIC SD-card edition of Wizardry I from the Apple II boot and
// scenario disks.
//
//   node codegen/tools/port-wizardry1.mjs <disk-images-dir> <output-dir>
//
// The directory must hold the two 140 KB disk images (.dsk/.do/.po, either
// sector order, optionally gzip-compressed). Writes <output-dir>/WIZ1/: the
// loader WIZ1.PRG and WIZ1.VOL, one Pascal volume holding both disks.
// Copy the WIZ1 folder to the 3RIC micro-SD card, then at the ROM DOS
// prompt:  CD WIZ1   then   BRUN WIZ1.PRG 0800
//
// The disk images and the generated folder contain Sir-Tech's copyrighted
// game; keep them local - this repository holds only the tool and the glue.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { BLOCK, VOLUME_BLOCKS, codeSegments, readPascalImage } from "./wizardry1/pascal.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const patchDir = path.join(root, "codegen", "patches", "wizardry1");

export const BANKSIG_VALUE = 0xa5;   // $DFFF in language-card bank 1
export const BANK2SIG_VALUE = 0x5a;  // $DFFF in bank 2
export const RT_PAGES = 45;          // RTSTRP.APPLE pages the boot block loads at $9200
const LOADER_ORG = 0x0800, VOLBUF = 0x4000;
const BOOT_FILES = ["RTSTRP.APPLE", "SYSTEM.PASCAL", "SYSTEM.STARTUP", "WIZARDRY.CODE"];
const SCENARIO_FILES = ["WIZARDRY.CODE", "SCENARIO.DATA", "SCENARIO.MESGS"];

// p-code patches, located through the code file's segment dictionary.
// Each replaces exactly the bytes in `before` (which include context).
export const PATCHES = [
  {
    file: "SYSTEM.STARTUP", segment: "WIZBOOT", offset: 0x4c,
    // proc 4 after copying the serial: "l2 := 1" -> UJP to its EXIT(WIZBOOT, 4)
    before: [0x01, 0xcc, 0x02, 0x05, 0xcc, 0x81, 0x0a],
    after: [0xb9, 0x5f, 0xd7, 0x05, 0xcc, 0x81, 0x0a],
    target: { offset: 0xad, bytes: [0x01, 0x04, 0x9e, 0x04] },
    why: "skip the five-pass Disk II timing check (a 6502 routine that times tracks 10-13 on the hardware)",
  },
  {
    file: "WIZARDRY.CODE", segment: "SPECIALS", offset: 0x806,
    // proc 9: CLP 15 (read the serial) ; CLP 16 -> NOP NOP
    before: [0xce, 0x0f, 0xce, 0x10, 0xb6, 0x03, 0x03],
    after: [0xce, 0x0f, 0xd7, 0xd7, 0xb6, 0x03, 0x03],
    why: "skip the scenario's Disk II timing check (JMP $2002 into code read from SCENARIO.DATA)",
  },
  {
    file: "WIZARDRY.CODE", segment: "CASTLE", offset: 0x1583,
    // proc 1: IF byte[$0479] <> 10 THEN wipe memory  ->  IF byte AND 0 ...
    before: [0xbe, 0x0a, 0xcb, 0xa1, 0x05, 0x46, 0x00, 0xcd, 0x01, 0x1f],
    after: [0xbe, 0x00, 0x84, 0xa1, 0x05, 0x46, 0x00, 0xcd, 0x01, 0x1f],
    why: "the timing routine's seek leaves $0479 = 10; CASTLE wipes memory without that watermark",
  },
  {
    file: "WIZARDRY.CODE", segment: "CASTLE", offset: 0x195,
    // proc 4 (the castle banner): the same watermark check
    before: [0xbe, 0x0a, 0xcb, 0xa1, 0x05, 0x46, 0x00, 0xcd, 0x01, 0x1f],
    after: [0xbe, 0x00, 0x84, 0xa1, 0x05, 0x46, 0x00, 0xcd, 0x01, 0x1f],
    why: "second copy of the $0479 watermark check",
  },
];

function maybeGunzip(bytes) {
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? new Uint8Array(zlib.gunzipSync(bytes)) : bytes;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileOf = (vol, name) => vol.files.find((f) => f.name === name);
const fileBytes = (vol, f) => vol.blocks.subarray(f.first * BLOCK, f.next * BLOCK);

/** Find the boot and scenario volumes among the images in a directory. */
export function loadDisks(diskDir) {
  let boot = null, scenario = null;
  for (const entry of fs.readdirSync(diskDir).sort()) {
    const full = path.join(diskDir, entry);
    if (!fs.statSync(full).isFile()) continue;
    let vol;
    try { vol = readPascalImage(maybeGunzip(new Uint8Array(fs.readFileSync(full)))); } catch { continue; }
    vol.source = entry;
    const has = (names) => names.every((n) => fileOf(vol, n));
    if (has(BOOT_FILES)) {
      if (boot) throw new Error(`two boot disks: ${boot.source}, ${entry}`);
      boot = vol;
    } else if (has(SCENARIO_FILES)) {
      if (scenario) throw new Error(`two scenario disks: ${scenario.source}, ${entry}`);
      scenario = vol;
    }
  }
  if (!boot) throw new Error("no Wizardry boot disk (RTSTRP.APPLE, SYSTEM.PASCAL, SYSTEM.STARTUP, WIZARDRY.CODE)");
  if (!scenario) throw new Error("no Wizardry scenario disk (WIZARDRY.CODE, SCENARIO.DATA, SCENARIO.MESGS)");
  return { boot, scenario };
}

/**
 * One volume holding both disks: the scenario's blocks 0-279 (boot area,
 * the serial in block 5, WIZARDRY.CODE, SCENARIO.DATA/MESGS) followed by the
 * boot disk's system files, moved up as one run. The directory keeps the boot
 * disk's header (the system volume the runtime booted from) with the new
 * size and both disks' files.
 */
export function combineVolumes(boot, scenario) {
  const bWiz = fileOf(boot, "WIZARDRY.CODE"), sWiz = fileOf(scenario, "WIZARDRY.CODE");
  if (bWiz.first !== sWiz.first || bWiz.next !== sWiz.next
      || sha256(fileBytes(boot, bWiz)) !== sha256(fileBytes(scenario, sWiz)))
    throw new Error("the two disks' WIZARDRY.CODE differ (different releases?)");
  const moved = boot.files.filter((f) => f.name !== "WIZARDRY.CODE");
  const from = Math.min(...moved.map((f) => f.first)), to = Math.max(...moved.map((f) => f.next));
  if (from < bWiz.next) throw new Error("boot disk files precede WIZARDRY.CODE");
  const base = Math.max(...scenario.files.map((f) => f.next));
  const total = base + (to - from), shift = base - from;
  const blocks = new Uint8Array(total * BLOCK);
  blocks.set(scenario.blocks.subarray(0, base * BLOCK));
  blocks.set(boot.blocks.subarray(from * BLOCK, to * BLOCK), base * BLOCK);

  const entries = scenario.files.map((f) => f.entry.slice());
  for (const f of moved) {
    const e = f.entry.slice();
    e[0] = (f.first + shift) & 255; e[1] = (f.first + shift) >> 8;
    e[2] = (f.next + shift) & 255; e[3] = (f.next + shift) >> 8;
    entries.push(e);
  }
  entries.sort((a, b) => (a[0] | (a[1] << 8)) - (b[0] | (b[1] << 8)));
  const names = entries.map((e) => String.fromCharCode(...e.subarray(7, 7 + e[6])));
  if (new Set(names).size !== names.length) throw new Error(`duplicate file names: ${names.join(", ")}`);
  const header = boot.header.slice();
  header[14] = total & 255; header[15] = total >> 8;
  header[16] = entries.length; header[17] = 0;
  blocks.set(header, 2 * BLOCK);
  entries.forEach((e, i) => blocks.set(e, 2 * BLOCK + (i + 1) * 26));

  const files = entries.map((e, i) => ({ name: names[i], first: e[0] | (e[1] << 8), next: e[2] | (e[3] << 8) }));
  return { blocks, total, files, shift, base };
}

export function applyPatches(vol) {
  const applied = [];
  for (const p of PATCHES) {
    const f = vol.files.find((x) => x.name === p.file);
    if (!f) throw new Error(`patch target ${p.file} not found`);
    const seg = codeSegments(vol.blocks, f.first).find((s) => s.name === p.segment);
    if (!seg) throw new Error(`${p.file} has no segment ${p.segment}`);
    const at = seg.block * BLOCK + p.offset;
    const actual = Array.from(vol.blocks.subarray(at, at + p.before.length));
    if (p.target) {
      const t = seg.block * BLOCK + p.target.offset;
      if (Array.from(vol.blocks.subarray(t, t + p.target.bytes.length)).join() !== p.target.bytes.join())
        throw new Error(`${p.file}/${p.segment}: unexpected jump target bytes (different release?)`);
    }
    if (actual.join() === p.after.join()) { applied.push(p); continue; }
    if (actual.join() !== p.before.join())
      throw new Error(`${p.file}/${p.segment}+$${p.offset.toString(16)}: unexpected bytes (different release?)`);
    vol.blocks.set(p.after, at);
    applied.push(p);
  }
  return applied;
}

// ROM ranges the glue depends on, checked by the loader with Fletcher sums
// computed from the repository ROM: the SPI byte/command primitives with
// sd_readsector and sd_writesector; fat32_seekcluster, whose FAT-sector and
// cluster->LBA arithmetic defines $CC00 (FAT LBA), $CC04 (data LBA) and
// $CC32 (sectors per cluster); fat32_opendirent, which leaves a file's
// first cluster in $CC18 and defines the current-directory ($CC20) and root ($CC08) clusters; and the NMI proxy whose receiver state the
// resident's PS/2 path shares.
export const ROM_RANGES = [[0xe141, 0xe294], [0xe3eb, 0xe4f5], [0xe7b4, 0xe83a], [0xf1bb, 0xf1d6]];
const ROM_PATH = path.join(root, "emulator", "Data", "badger6502.bin");

export function fletcher(bytes) {
  let s1 = 0, s2 = 0;
  const add = (a, b) => { const r = a + b; return r > 255 ? (r & 255) + 1 : r; };
  for (const b of bytes) { s1 = add(s1, b); s2 = add(s2, s1); }
  return [s1, s2];
}

export function romFingerprints(rom = new Uint8Array(fs.readFileSync(ROM_PATH))) {
  return ROM_RANGES.map(([a, b]) => [a, b, ...fletcher(rom.subarray(a, b))]);
}

/** Writable blocks: everything that came from the scenario disk except its boot blocks. */
export function writableRange(vol) {
  return [2, vol.base];
}

function asmBytes(bytes) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16)
    lines.push("        .byte " + Array.from(bytes.slice(i, i + 16), (b) => "$" + b.toString(16).padStart(2, "0")).join(","));
  return lines.join("\n");
}

const CLTAB = 0xf000;           // cluster table in language-card high RAM

/** Assemble resident, shim and loader into WIZ1.PRG. */
export function buildLoader({ volBlocks, rtBlock, wrFirst, wrEnd, dirSig, fingerprints = romFingerprints() }) {
  if (!dirSig || dirSig.length < 1 || dirSig.length > 26) throw new Error("dirSig: the first bytes of block 2 (volume header)");
  const sym = (name, v) => `${name} = $${v.toString(16)}\n`;
  const resident = assemble(sym("BANKSIG_VALUE", BANKSIG_VALUE) + sym("SHIM_DISK", 0xe000)
    + fs.readFileSync(path.join(patchDir, "resident.s"), "utf8"));
  const r = resident.symbols;
  if (resident.org !== 0xcf00 || resident.bytes.length > 0x100) throw new Error("resident exceeds $CF00-$CFFF");
  if ((r.NMI_ENTRY & 255) === 0xbb) throw new Error("resident NMI entry low byte matches the ROM vector");

  const shim = assemble(sym("ROM_SD", r.ROM_SD) + sym("SD_VEC", r.SD_VEC) + sym("DISK_ERR", r.DISK_ERR)
    + sym("VOL_BLOCKS", volBlocks) + sym("WR_FIRST", wrFirst) + sym("WR_END", wrEnd) + sym("CLTAB", CLTAB)
    + fs.readFileSync(path.join(patchDir, "shim.s"), "utf8") + "\nshim_end:\n");
  const s = shim.symbols;
  if (shim.org !== 0xe000 || s.SHIM_END > CLTAB) throw new Error("shim overlaps the cluster table");
  if (CLTAB + 4 * volBlocks > 0xff00) throw new Error("cluster table could overlap the vectors");
  const shimPages = Math.ceil(shim.bytes.length / 256);

  const fp = [];
  for (const [a, b, s1, s2] of fingerprints) fp.push(a & 255, a >> 8, b & 255, b >> 8, s1, s2);
  const loaderSrc = (resSrc) => {
    const shimSrc = resSrc + 0x100;
    return sym("RES_SRC", resSrc) + sym("SHIM_SRC", shimSrc) + sym("SHIM_END_SRC", shimSrc + shimPages * 256)
      + sym("CLSHIFT_SRC", shimSrc + s.CLSHIFT - 0xe000) + sym("CLMASK_SRC", shimSrc + s.CLMASK - 0xe000)
      + sym("NMI_ENTRY", r.NMI_ENTRY) + sym("IRQ_ENTRY", r.IRQ_ENTRY) + sym("DISK_ENTRY", r.DISK_ENTRY)
      + sym("BANKSIG_VALUE", BANKSIG_VALUE) + sym("BANK2SIG_VALUE", BANK2SIG_VALUE)
      + sym("RT_BLOCK", rtBlock) + sym("VOL_BLOCKS", volBlocks) + sym("CLTAB", CLTAB) + sym("FP_BYTES", fp.length)
      + sym("DIRSIG_LEN", dirSig.length)
      + fs.readFileSync(path.join(patchDir, "loader.s"), "utf8") + `\nfptab:\n${asmBytes(fp)}\ndirsig:\n${asmBytes(dirSig)}\n`
      + `vol_bytes:\n${asmBytes([0, 1, 2, 3].map((i) => ((volBlocks * BLOCK) >>> (8 * i)) & 255))}\nloader_end:\n`;
  };
  const sized = assemble(loaderSrc(0x1000));
  const resSrc = (LOADER_ORG + sized.bytes.length + 255) & ~255;
  const loader = assemble(loaderSrc(resSrc));
  if (loader.org !== LOADER_ORG || loader.bytes.length !== sized.bytes.length) throw new Error("loader layout changed");
  if (resSrc + 0x100 + shimPages * 256 > VOLBUF) throw new Error("WIZ1.PRG would overlap its buffers at $4000");

  const prg = new Uint8Array(resSrc + 0x100 + shimPages * 256 - LOADER_ORG);
  prg.set(loader.bytes, 0);
  prg.set(resident.bytes, resSrc - LOADER_ORG);
  prg.set(shim.bytes, resSrc + 0x100 - LOADER_ORG);
  return { prg, resident, shim, loader };
}

/** From the two volumes to { "WIZ1.PRG": bytes, "WIZ1.VOL": bytes }. info gets layout details. */
export function buildFromDisks({ boot, scenario }, info = {}) {
  const vol = combineVolumes(boot, scenario);
  info.patches = applyPatches(vol);
  checkScenarioWindows(vol);
  const rt = vol.files.find((f) => f.name === "RTSTRP.APPLE");
  if (!rt || rt.next - rt.first < Math.ceil(RT_PAGES / 2)) throw new Error("RTSTRP.APPLE is shorter than the boot block loads");
  const [wrFirst, wrEnd] = writableRange(vol);
  const { prg, resident, shim, loader } = buildLoader({ volBlocks: vol.total, rtBlock: rt.first, wrFirst, wrEnd, dirSig: vol.blocks.slice(2 * BLOCK, 2 * BLOCK + 14) });
  Object.assign(info, { vol, resident: resident.symbols, shim: shim.symbols, loader: loader.symbols, rtBlock: rt.first, wrFirst, wrEnd });
  return { "WIZ1.PRG": prg, "WIZ1.VOL": vol.blocks };
}

/**
 * The game reads and writes SCENARIO.DATA in 1 KB windows at even offsets
 * from its first block. Writes are whole blocks to the scenario's blocks,
 * so this is a sanity check that the file is the expected layout.
 */
function checkScenarioWindows(vol) {
  const data = vol.files.find((f) => f.name === "SCENARIO.DATA");
  if (!data || data.next > vol.base) throw new Error("unexpected SCENARIO.DATA position");
  const header = vol.blocks.subarray(data.first * BLOCK, data.first * BLOCK + 106);
  for (let i = 0; i < 8; i++)
    if ((header[90 + 2 * i] | (header[91 + 2 * i] << 8)) >= data.next - data.first)
      throw new Error("SCENARIO.DATA header points outside the file (different release?)");
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
    console.error("usage: node codegen/tools/port-wizardry1.mjs <disk-images-dir> <output-dir>");
    process.exit(2);
  }
  const disks = loadDisks(diskDir);
  const info = {};
  const tree = buildFromDisks(disks, info);
  writeTree({ WIZ1: tree }, outDir);
  for (const v of [disks.boot, disks.scenario])
    console.log(`${v.source}: /${v.volume} (${v.order === "do" ? "DOS" : "ProDOS"} order)`);
  for (const p of info.patches) console.log(`patched ${p.file}/${p.segment}+$${p.offset.toString(16)}: ${p.why}`);
  console.log(`WIZ1.VOL: ${info.vol.total} blocks (writable ${info.wrFirst}-${info.wrEnd - 1}); WIZ1.PRG: ${tree["WIZ1.PRG"].length} bytes`);
  console.log(`wrote ${path.join(outDir, "WIZ1")}: copy the WIZ1 folder to the SD card root, then CD WIZ1 and BRUN WIZ1.PRG 0800`);
}
