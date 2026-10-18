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
import { buildMusic, scaleLatch, INST_SIZE } from "./ultima5/music.mjs";

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
const LOADER_ORG = 0x0800, PAYLOAD = 0x0c00;

/** ProDOS name -> 8-character SD key (the shim computes the same). */
export function sdKey(name) {
  return name.replace(/\./g, "").toUpperCase().slice(0, 8);
}

/** 16-bit hash of a key (shim.s key_hash): rotate left 3, xor each byte. */
export function keyHash(key) {
  let h = 0;
  for (const c of Buffer.from(key.padEnd(8, " "), "ascii")) h = (((h << 3) | (h >>> 13)) & 0xffff) ^ c;
  return h;
}

// Shim jump-table slots after DINKEYDOS's $D000-$D027.
const SLOTS = { PAD_POLL: 0xd02a, MUS_TICK: 0xd02d, MUS_CTL_B1: 0xd030 };
const MUSIC_HI = 0xd800;             // player code after the $D600 block buffer
// ROM FAT32 routines the shim and loader call (the ones FLOAD, OWRITE and
// fat32_finddirent use); the loader checks their first bytes against the repository's ROM image.
const ROM_ROUTINES = {
  ROM_OPEN_CD: 0xecea, ROM_FINDDIRENT: 0xe9a0, ROM_OPENDIRENT: 0xe7b4,
  ROM_READ_PART: 0xeb69, ROM_FILE_WRITE: 0xebb5, ROM_READDIRENT: 0xe96d,
};
const ROM_IMAGE = path.join(root, "emulator", "Data", "badger6502.bin");
// RAM2 the ROM only uses at boot or from the DOS prompt (see ram2.inc):
// the player's tables live there to leave bank 1 room for a song.
const RAM2_TABLES = [
  { org: "MS_END", end: 0xcafe, labels: ["NOISE"] },
  { org: 0xcc3d, end: 0xcd00, labels: ["PERL", "PERH", "AUXL", "AUXH"] },
  { org: 0xcd00, end: 0xcd6c, labels: ["VOLTAB", "VPER", "VVOL", "VR6", "VMIX", "DURTAB"] },
  { org: 0xce24, end: 0xcee0, labels: ["INSTAB"] },
];
const BLOCKBUF = 0xd600;             // DINKEYDOS block buffer; the largest song borrows it
// Voice v -> AY register shadow index (AY0 regs 0-10, AY1 11-21): MUDI's
// two-chip map v0 AY0 A, v1 AY1 A, v2 AY0 B, v3 AY1 B, v4 AY1 C, v5 AY0 C.
const VOICE_CHIP = [0, 1, 0, 1, 1, 0], VOICE_CH = [0, 0, 1, 1, 2, 2];

const ram2Src = () => fs.readFileSync(path.join(patchDir, "ram2.inc"), "utf8");
const hex = (v) => "$" + v.toString(16);
const equates = (o) => Object.entries(o).map(([k, v]) => `${k} = ${hex(v)}\n`).join("");

/** RAM2 layout symbols (ram2.inc). */
export function ram2Symbols() { return assemble(ram2Src()).symbols; }

/** Assemble the $CF00 resident (independent of the file tables). */
export function assembleResident(src = fs.readFileSync(path.join(patchDir, "resident.s"), "utf8")) {
  const resident = assemble(ram2Src() + equates({ BANKSIG_VALUE, ...SLOTS }) + src);
  if (resident.org !== 0xcf00 || resident.bytes.length > 0x100) throw new Error("resident exceeds $CF00-$CFFF");
  return resident;
}

/** Assemble the $CD80 game-side music glue. */
export function assembleGlue(resident = assembleResident()) {
  const glue = assemble(ram2Src() + equates({ ...SLOTS, B1_CALL: resident.symbols.B1_CALL })
    + fs.readFileSync(path.join(patchDir, "glue.s"), "utf8"));
  if (glue.org !== 0xcd80 || glue.bytes.length > 0x80) throw new Error("glue exceeds $CD80-$CDFF");
  return glue;
}

/** Symbols the game patches call. */
export function patchSymbols() {
  const resident = assembleResident();
  const g = assembleGlue(resident).symbols;
  return { PAD_KEY: resident.symbols.PAD_KEY, MUS_IN: g.MUS_IN, MUS_OUT: g.MUS_OUT, MUS_SETX: g.MUS_SETX, MUS_CTL: g.MUS_CTL };
}

const jsr = (a) => [0x20, a & 255, a >> 8];
const LDA_KEYBOARD = [0xad, 0x00, 0xc0];
const STA_C009 = [0x8d, 0x09, 0xc0], STA_C008 = [0x8d, 0x08, 0xc0];
const MUSIC_GATE = [0xa5, 0xec, 0x4a, 0x90];      // LDA $EC / LSR / BCC: 128K music only

// 128K music site: open the gate (BCC -> NOPs) and map the driver's zero
// page with the glue instead of the aux-memory switches.
function musicSite(volume, file, gate, branch, mapIn, mapOut, why) {
  const out = [];
  if (gate) out.push({ volume, file, address: gate, before: [...MUSIC_GATE, branch], after: [...MUSIC_GATE.slice(0, 3), 0xea, 0xea], why, group: "music" });
  out.push({ volume, file, address: mapIn, before: STA_C009, after: (s) => jsr(s.MUS_IN), why, group: "music" });
  out.push({ volume, file, address: mapOut, before: STA_C008, after: (s) => jsr(s.MUS_OUT), why, group: "music" });
  return out;
}
const OUTDOORS = ["BRITANNIA", "UNDERWORLD"];

// Each patch: volume ("*" = every disk holding the file, or a list), file,
// load address, original bytes, replacement bytes (or a function of the
// patch symbols; default JSR pad_key), reason.
export const PATCHES = [
  {
    volume: "ULTIMA5", file: "STARTUP", address: 0x8169,
    before: [0x8d, 0x08, 0xc0, 0xa9, 0x00, 0x8d, 0x05, 0xc0, 0x8d, 0x7e, 0x03, 0x8d, 0x04, 0xc0, 0x85, 0xb1, 0x8d, 0x73, 0xc0],
    after: [0xea, 0xea, 0xea, 0xa9, 0x00, 0xea, 0xea, 0xea, 0x8d, 0x7e, 0x03, 0xea, 0xea, 0xea, 0x85, 0xb1, 0xea, 0xea, 0xea],
    why: "Apple IIe aux-memory/RamWorks resets ($C008/$C005/$C004/$C073); 3RIC has no aux bank and its $C00x decode is not specified for these.",
  },
  // SNES pads: the game's keyboard reads become JSR pad_key (same length).
  { volume: "ULTIMA5", file: "MAIN.SUBS", address: 0xefc2, before: LDA_KEYBOARD, why: "in-game scankey (all overlays use it)" },
  { volume: "ULTIMA5", file: "STARTUP", address: 0x8b77, before: LDA_KEYBOARD, why: "title-menu scankey" },
  { volume: "*", file: "VIEW", address: 0xa75a, before: LDA_KEYBOARD, why: "View / gem map: any key closes it" },
  // Mockingboard music (see glue.s / music.s).
  { volume: "ULTIMA5", file: "MAIN.SUBS", address: 0xee5a, before: [...MUSIC_GATE, 0x16], after: (s) => [...jsr(s.MUS_CTL), 0x80, 0x16], why: "pause/resume/stop dispatcher -> mus_ctl, then its exit", group: "music" },
  { volume: "ULTIMA5", file: "TEMP.SUBS", address: 0x1fa8, before: [...MUSIC_GATE, 0x16], after: (s) => [...jsr(s.MUS_SETX), 0x60, 0x16], why: "$15B9 play song X -> mus_setx", group: "music" },
  ...musicSite("ULTIMA5", "TEMP.SUBS", 0x1fdf, 0x0b, 0x1fe7, 0x1fec, "in-game volume keys"),
  ...musicSite("ULTIMA5", "STARTUP", 0x8f4a, 0x0b, 0x8f52, 0x8f57, "title volume keys"),
  ...musicSite("ULTIMA5", "STARTUP", 0x8f65, 0x15, 0x8f6a, 0x8f7c, "title next-song key"),
  ...musicSite(OUTDOORS, "MAIN.COMBAT", 0x85a0, 0x0a, 0x85a5, 0x85ac, "combat: chain to song 1"),
  ...musicSite(["DUNGEON"], "MAIN.COMBAT", 0x85b7, 0x0a, 0x85bc, 0x85c3, "combat: chain to song 1"),
  ...musicSite(OUTDOORS, "MAIN.OUT", 0x875b, 0x0a, 0x8760, 0x8767, "board ship"),
  ...musicSite(OUTDOORS, "MAIN.OUT", 0x8796, 0x0a, 0x879b, 0x87a2, "ship"),
  ...musicSite(OUTDOORS, "MAIN.OUT", 0x9313, 0x0a, 0x9318, 0x931f, "leave ship"),
  ...musicSite(OUTDOORS, "MAIN.OUT", 0x9379, 0x0a, 0x937e, 0x9385, "leave ship"),
  ...musicSite(OUTDOORS, "MAIN.OUT", 0x9398, 0x0a, 0x939d, 0x93a4, "leave ship"),
  ...musicSite("*", "MAIN.TWN", 0x88ed, 0x0a, 0x88f2, 0x88f9, "board ship"),
  ...musicSite("*", "MAIN.TWN", 0x9488, 0x0a, 0x948d, 0x9494, "leave ship"),
  ...musicSite("*", "END", 0xaca7, 0x0a, 0xacac, 0xacb3, "ending: chain to song 15"),
  ...musicSite("*", "VICTORY", 0x8080, 0x0a, 0x8085, 0x808c, "victory: chain to song 15"),
  ...musicSite("*", "EY", 0, 0, 0xa706, 0xa70b, "save the playing song (not gated)"),
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

export function applyPatches(volumes, syms = patchSymbols(), patches = PATCHES) {
  for (const p of patches) {
    const after = typeof p.after === "function" ? p.after(syms) : p.after || jsr(syms.PAD_KEY);
    const names = p.volume === "*" ? [...volumes.keys()] : [p.volume].flat();
    let found = 0;
    for (const volume of names) {
      const file = volumes.get(volume)?.files.find((f) => f.name === p.file);
      if (!file) continue;
      found++;
      const offset = p.address - file.aux;
      const actual = Array.from(file.data.subarray(offset, offset + p.before.length));
      if (actual.join() === after.join()) continue;
      if (actual.join() !== p.before.join())
        throw new Error(`${volume}/${p.file} at $${p.address.toString(16)}: unexpected bytes (different release?)`);
      file.data.set(after, offset);
    }
    if (!found) throw new Error(`patch target ${p.volume}/${p.file} not found`);
  }
}

function fileTable(volumes) {
  // One entry per distinct (key, aux, eof); volmask bit n = present on VOLUMES[n].
  const table = new Map();
  const keyNames = new Map();
  VOLUMES.forEach(([volume], index) => {
    for (const f of volumes.get(volume).files) {
      const key = sdKey(f.name);
      if (keyNames.has(key) && keyNames.get(key) !== f.name)
        throw new Error(`SD key ${key} is shared by ${keyNames.get(key)} and ${f.name}`);
      keyNames.set(key, f.name);
      const id = `${key}/${f.aux}/${f.eof}`;
      const prev = table.get(id);
      if (f.eof === 0 || f.eof > 0xffff) throw new Error(`${f.name}: unsupported size ${f.eof}`);
      if (prev) prev.volmask |= 1 << index;
      else table.set(id, { key, name: f.name, aux: f.aux, eof: f.eof, volmask: 1 << index });
    }
  });
  return [...table.values()];
}

/** Load addresses by file extension (shim.s aux_lookup): the distinct
 *  nonzero ProDOS aux types, letter A for the first. */
function auxTable(table) {
  const auxOf = new Map();
  for (const e of table) {
    if (auxOf.has(e.key) && auxOf.get(e.key) !== e.aux) throw new Error(`${e.name}: different load addresses on different disks`);
    auxOf.set(e.key, e.aux);
  }
  const values = [...new Set([...auxOf.values()].filter((a) => a))].sort((a, b) => a - b);
  if (values.length > 26) throw new Error(`${values.length} load addresses (letters A-Z)`);
  const name = (key) => (auxOf.get(key) ? `${key}.${String.fromCharCode(65 + values.indexOf(auxOf.get(key)))}` : key);
  return { values, name };
}

function asmText(bytes) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) lines.push("        .byte " + Array.from(bytes.slice(i, i + 16), (b) => "$" + b.toString(16).padStart(2, "0")).join(","));
  return lines.join("\n") || "";
}

/** The 128K edition's music driver files, or null (synthetic test disks). */
function musicFiles(volumes) {
  const get = (name) => volumes.get("ULTIMA5")?.files.find((f) => f.name === name)?.data;
  const muff = get("MUFF"), muin = get("MUIN"), mudr = get("MUDR");
  return muff && muin && mudr ? { muff, muin, mudr } : null;
}

/** Assemble resident, glue, RAM2 tables, shim + player and loader into
 *  U5.PRG; returns the songs (SONGnn files) too. */
export function buildLoader(table, music = null) {
  const resident = assembleResident();
  const glue = assembleGlue(resident);
  const ram2 = assemble(ram2Src()).symbols;
  const r = resident.symbols;

  // RAM2 table addresses: sizes depend on the music (note range, NAUX).
  const aux = auxTable(table);
  const layout = (notes) => {
    const sizes = { NOISE: 32, DURTAB: 24, PERL: notes, PERH: notes, AUXL: aux.values.length, AUXH: aux.values.length,
      VOLTAB: 48, VPER: 6, VVOL: 6, VR6: 6, VMIX: 6, INSTAB: 0 };
    const tabAddr = {};
    for (const region of RAM2_TABLES) {
      let a = typeof region.org === "string" ? ram2[region.org] : region.org;
      region.start = a;
      for (const l of region.labels) { tabAddr[l] = a; a += sizes[l]; }
    }
    return tabAddr;
  };
  const common = (m) => ram2Src() + equates({ ...ROM_ROUTINES, ...SLOTS, ROM_CALL: r.ROM_CALL, MUSIC_HI,
    NOTE_LO: m.noteLo, NOTES: m.notes, NAUX: aux.values.length, ...layout(m.notes) });
  const shimSrc = (m, consts) => common(m) + equates(consts)
    + fs.readFileSync(path.join(patchDir, "shim.s"), "utf8") + "shim_code_end:\n"
    + fs.readFileSync(path.join(patchDir, "music.s"), "utf8")
    + `\ncode_end:\nSONGBUF:\n`;
  const none = {
    noteLo: 21, notes: 1, perl: [0], perh: [0], durtab: new Array(24).fill(1),
    noise: new Array(32).fill(0), defLatch: scaleLatch(0x429a), instab: new Array(INST_SIZE).fill(0), zeroInst: 0,
    songs: new Map(), partA: new Map(), skipped: [],
  };
  const probe = assemble(shimSrc(none, { DEFLATCH: 0, SONG_CAP: 0, SONG_LIMIT: 0 }));
  const songbuf = probe.symbols.SONGBUF;
  const capacity = 0xdfff - songbuf;
  const regions = { base: songbuf, capB: capacity, baseA: BLOCKBUF, capA: 512 };
  const m = music ? buildMusic(music, regions) : none;
  const shim = assemble(shimSrc(m, { DEFLATCH: m.defLatch, SONG_CAP: capacity, SONG_LIMIT: capacity + regions.capA }));
  const s = shim.symbols;
  if (shim.org !== 0xd000 || s.MUSIC_LO_END > BLOCKBUF) throw new Error(`shim code ($${s.MUSIC_LO_END.toString(16)}) overlaps the $D600 block buffer`);
  if (s.MUS_TICK < MUSIC_HI || s.SONGBUF !== songbuf || capacity < 1 || s.BLOCKBUF !== BLOCKBUF) throw new Error("player layout");
  for (const [name, slot] of Object.entries(SLOTS))
    if (shim.bytes[slot - 0xd000] !== 0x4c || (shim.bytes[slot - 0xcfff] | shim.bytes[slot - 0xcffe] << 8) !== s[name.toUpperCase()])
      throw new Error(`${name} slot does not jump to ${name}`);
  const shimImage = new Uint8Array(0x1000);
  shimImage.set(shim.bytes);
  shimImage[0xfff] = BANKSIG_VALUE;

  // RAM2 tables.
  const data = {
    NOISE: m.noise, DURTAB: m.durtab, PERL: m.perl, PERH: m.perh, VOLTAB: [],
    VPER: VOICE_CHIP.map((c, v) => c * 11 + 2 * VOICE_CH[v]), VVOL: VOICE_CHIP.map((c, v) => c * 11 + 8 + VOICE_CH[v]),
    VR6: VOICE_CHIP.map((c) => c * 11 + 6), VMIX: VOICE_CH.map((ch) => 0x09 << ch), INSTAB: m.instab,
    AUXL: aux.values.map((a) => a & 255), AUXH: aux.values.map((a) => a >> 8),
  };
  for (const [name] of VOLUMES) { const h = keyHash(sdKey(name)); data.VOLTAB.push(h & 255, h >> 8, 0, 0, 0, 0); }
  if (new Set(VOLUMES.map(([name]) => keyHash(sdKey(name)))).size !== VOLUMES.length) throw new Error("volume key hashes collide");
  const segs = [{ dst: resident.org, bytes: resident.bytes, len: 256 }, { dst: glue.org, bytes: glue.bytes }];
  for (const region of RAM2_TABLES) {
    const bytes = region.labels.flatMap((l) => data[l]);
    if (region.start + bytes.length > region.end) throw new Error(`RAM2 tables ${region.labels} overflow $${region.end.toString(16)}`);
    segs.push({ dst: region.start, bytes });
  }

  // U5.PRG: loader, then the RAM2 segments, then the 4 KB bank-1 image.
  let src = PAYLOAD;
  for (const seg of segs) { seg.src = src; src += seg.len || seg.bytes.length; }
  const shimSrcAddr = (src + 0xff) & ~0xff;
  const shimPages = (songbuf - 0xd000 + 0xff) >> 8;   // the song buffer starts empty
  const romImage = fs.readFileSync(ROM_IMAGE);
  const romsig = Object.values(ROM_ROUTINES).flatMap((a) => [a & 255, a >> 8, ...romImage.subarray(a, a + 8)]);
  const segtab = segs.flatMap((g) => [g.dst & 255, g.dst >> 8, g.src & 255, g.src >> 8, (g.len || g.bytes.length) & 255]);
  const dirnames = VOLUMES.flatMap(([, dir]) => [...Buffer.from(dir.padEnd(8, " "), "ascii")]);
  const loader = assemble(common(m) + equates({
    SHIM_SRC: shimSrcAddr, SHIM_PAGES: shimPages, BANKSIG_VALUE, NMI_ENTRY: r.NMI_ENTRY, IRQ_ENTRY: r.IRQ_ENTRY, IRQ_MB_OP: r.IRQ_MB + 1,
    ZERO_INST: m.zeroInst, DEFLATCH: m.defLatch, EXTC: s.EXTC,
  }) + fs.readFileSync(path.join(patchDir, "loader.s"), "utf8")
    + `\nromsig:\n${asmText(romsig)}\n        .byte 0,0\nsegtab:\n${asmText(segtab)}\n        .byte 0,0\ndirnames:\n${asmText(dirnames)}\nloader_end:\n`);
  if (loader.org !== LOADER_ORG || loader.org + loader.bytes.length > PAYLOAD) throw new Error("loader overlaps its payload");

  const prg = new Uint8Array(shimSrcAddr + shimPages * 256 - LOADER_ORG);
  prg.set(loader.bytes, 0);
  for (const g of segs) prg.set(g.bytes, g.src - LOADER_ORG);
  prg.set(shimImage.subarray(0, shimPages * 256), shimSrcAddr - LOADER_ORG);
  return { prg, resident, glue, shim, shimImage, segs, loader, music: m, songs: m.songs, partA: m.partA, skipped: m.skipped, capacity, fileName: aux.name };
}

/** Produce { "U5.PRG": bytes, ULTIMA5: { "KEY.X": bytes, RAW00: ... }, ... }
 *  (file names: see auxTable). */
export function buildTree(diskDir, info = {}) {
  const volumes = loadVolumes(diskDir);
  applyPatches(volumes);
  return buildFromVolumes(volumes, info);
}

/** volumes: Map of volume name -> { files: [{ name, aux, eof, data }], blocks }.
 *  info (optional) receives the resident's NMI entry and the music build. */
export function buildFromVolumes(volumes, info = {}) {
  const htxt = volumes.get("ULTIMA5").files.find((f) => f.name === "HTXT");
  if (!htxt || htxt.eof !== 2048 || htxt.data[0x7ff] === BANKSIG_VALUE)
    throw new Error("HTXT (copied to bank 2 $D800-$DFFF) would match the bank-1 signature");
  const table = fileTable(volumes);
  const built = buildLoader(table, musicFiles(volumes));
  const { prg, resident, songs, fileName } = built;
  Object.assign(info, built, { nmiEntry: resident.symbols.NMI_ENTRY });
  const tree = { "U5.PRG": prg };
  for (const [name, dir] of VOLUMES) {
    const image = volumes.get(name);
    // Songs first: the ROM scans a directory in order, and they load mid-game.
    const files = {}, keys = new Set();
    for (const [n, bytes] of songs) { const k = "SONG" + String(n).padStart(2, "0"); keys.add(k); files[k] = bytes; }
    for (const f of image.files) {
      const k = sdKey(f.name);
      if (keys.has(k)) throw new Error(`${name}: ${f.name} clashes with a song file`);
      keys.add(k);
      files[fileName(k)] = f.data;
    }
    for (let n = 0; n * RAW_BLOCKS * 512 < image.blocks.length; n++) {
      const raw = image.blocks.subarray(n * RAW_BLOCKS * 512, (n + 1) * RAW_BLOCKS * 512);
      const rawName = "RAW" + n.toString(16).toUpperCase().padStart(2, "0");
      if (keys.has(rawName)) throw new Error(`${name}: a game file already uses the name ${rawName}`);
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
  const info = {};
  const tree = buildTree(diskDir, info);
  writeTree({ U5: tree }, outDir);
  console.log(`music: songs ${[...info.songs.keys()].join(", ")} (${info.capacity}-byte buffer`
    + `${info.partA.size ? `; ${[...info.partA].map(([n, a]) => `song ${n} borrows ${a} bytes of the block buffer`).join(", ")}` : ""})`);
  for (const { n, why } of info.skipped) console.log(`  song ${n} left out: ${why}`);
  console.log(`wrote ${path.join(outDir, "U5")}: copy the U5 folder to the SD card root, then CD U5 and BRUN U5.PRG 0800`);
}
