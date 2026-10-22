// Build the 3RIC SD-card edition of Dirt Bike from its Apple II disk.
//
//   node codegen/tools/port-dirtbike.mjs <DIRTBIKE.dsk> <output-dir>
//
// <DIRTBIKE.dsk> is the 140 KB DOS 3.3 image (DOS order) of Verhille Arnaud's
// Apple II port ("DIRTBIKE - APPLE II+ 48K"): HELLO, DIRTBIKE, TITLE, DIRTHOF
// (hall of fame) and the tracks T01-T30. Writes <output-dir>/DIRTBIKE/:
// DIRTBIKE.PRG plus TITLE, T01-T30 and DIRTHOF. Copy the DIRTBIKE folder to
// the root of the 3RIC micro-SD card, then at the ROM DOS prompt:
//     CD DIRTBIKE    then    BRUN DIRTBIKE.PRG 0800
//
// The game reads its files sector by sector through DOS 3.3's RWTS, from
// track/sector tables built into it, loading each file's raw sectors (DOS
// header included) at a page boundary. Each card file therefore holds the
// file's raw data sectors, and the resident (codegen/patches/dirtbike/
// resident.s) turns the game's three disk routines into ROM DOS FLOAD /
// OWRITE commands on them; the loader (loader.s) stands in for HELLO. An
// existing DIRTHOF in the output folder is kept: it holds the records.
// The disk and the generated folder contain the game; keep them local -
// this repository holds only the tool and the glue code.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const patchDir = path.join(root, "codegen", "patches", "dirtbike");

export const DSK_SIZE = 143360;
export const GAME_ORG = 0x6000;
// SHA-256 of the DIRTBIKE and TITLE file bodies this port was written
// against: every patch address below belongs to this release.
export const GAME_SHA256 = "296fa338efabd5fa72402fcd3d9d500bfc26c5080880fbefdc654b057df3424f";
export const TITLE_SHA256 = "3167fb0e9275e405494db47d1f7d58d22daf03d876ce2b2ddbab8bde460ad7bf";
export const LOAD_ADDR = 0x9600;          // TITLE and the tracks: raw sectors here
export const HOF_ADDR = 0xb500;           // DIRTHOF's two sectors
export const RES_ORG = 0xb704;            // the resident: DOS 3.3's old RWTS space
const RES_END = 0xc000;
const LOADER_ORG = 0x0800;
const LOADER_MAX = 0x0200;                // loader code at $0800-$09FF
export const TRACKS = 30;
export const PAD_CENTER = 0x40;           // resident.s PAD_CENTER
// 3RIC runs the 65C02 at 25.175 MHz / 16; the Apple II at 14.31818 MHz / 14.
export const CLOCK_RATIO = (25_175_000 / 16) / (14_318_180 / 14);
// Cycles wait_apple adds around its WAIT calls (with the Mockingboard timer).
const WAIT_OVERHEAD = 300;
const WAIT = 0xfca8;                      // monitor WAIT

// The game's own track/sector tables (addresses in the $6000 image).
const TRACK_TSL_T = 0x917f, TRACK_TSL_S = 0x919d;   // T/S list of T01-T30
const TITLE_TSL = 0x91c2;                            // TITLE's T/S list (t, s)
const HOF_SECTORS = 0x91bc;                          // t0 t1 s0 s1

const sector = (img, t, s) => img.subarray((t * 16 + s) * 256, (t * 16 + s) * 256 + 256);

/** Read a DOS 3.3 catalog: [{ name, type, tsl: [t, s], sectors: [[t, s]...], raw }]
 *  raw is the file's data sectors in T/S-list order up to the first empty
 *  entry - what the game's own loader reads (it follows one T/S list). */
export function readCatalog(img) {
  if (img.length !== DSK_SIZE) throw new Error(`not a 140 KB DOS-order image (${img.length} bytes)`);
  const vtoc = sector(img, 17, 0);
  if (vtoc[1] === 0 || vtoc[1] > 34 || vtoc[2] > 15) throw new Error("no DOS 3.3 catalog at track 17");
  const files = [];
  const seen = new Set();
  let t = vtoc[1], s = vtoc[2];
  while (t !== 0) {
    if (t > 34 || s > 15 || seen.has(t * 16 + s)) throw new Error("broken catalog chain");
    seen.add(t * 16 + s);
    const cat = sector(img, t, s);
    for (let i = 0; i < 7; i++) {
      const e = cat.subarray(0x0b + i * 35, 0x0b + i * 35 + 35);
      if (e[0] === 0 || e[0] === 0xff) continue;          // unused / deleted
      const name = String.fromCharCode(...Array.from(e.subarray(3, 33), (b) => b & 0x7f)).replace(/ +$/, "");
      if (e[0] > 34 || e[1] > 15) throw new Error(`${name}: bad T/S list location`);
      const list = sector(img, e[0], e[1]);
      const sectors = [];
      for (let k = 0; k < 122; k++) {
        const dt = list[0x0c + 2 * k], ds = list[0x0d + 2 * k];
        if (dt === 0) break;
        if (dt > 34 || ds > 15) throw new Error(`${name}: bad data sector ${dt}/${ds}`);
        sectors.push([dt, ds]);
      }
      const raw = new Uint8Array(sectors.length * 256);
      sectors.forEach(([dt, ds], n) => raw.set(sector(img, dt, ds), n * 256));
      files.push({ name, type: e[2] & 0x7f, tsl: [e[0], e[1]], sectors, raw });
    }
    t = cat[1]; s = cat[2];
  }
  return files;
}

/** A binary file's header: { addr, len, body } (body = what BLOAD stores). */
export function binary(file) {
  if (file.type !== 4) throw new Error(`${file.name} is not a binary (B) file`);
  const addr = file.raw[0] | (file.raw[1] << 8), len = file.raw[2] | (file.raw[3] << 8);
  if (len + 4 > file.raw.length) throw new Error(`${file.name}: length ${len} exceeds its sectors`);
  return { addr, len, body: file.raw.slice(4, 4 + len) };
}

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** Patch sites. at = runtime address; before = original bytes (all checked).
 *  timing: false leaves out the Apple II speed patches (for comparisons). */
export function gamePatches(r, { timing = true } = {}) {
  const lo = (v) => v & 255, hi = (v) => v >> 8;
  const jmp = (v) => [0x4c, lo(v), hi(v)], jsr = (v) => [0x20, lo(v), hi(v)];
  const io = [
    // File I/O through the resident's ROM DOS commands.
    { at: 0x84d1, before: [0xa9, 0x00, 0x8d], after: jmp(r.LOAD_FILE), why: "load a file by its T/S list" },
    { at: 0x76bc, before: [0xa2, 0x00, 0x20, 0xcf, 0x76], after: jmp(r.HOF_READ), why: "read the hall of fame" },
    { at: 0x76a9, before: [0xa2, 0x00, 0x20, 0xcf, 0x76], after: jmp(r.HOF_WRITE), why: "write the hall of fame" },
    // The RWTS sector entries (write $8516, read $8519) now fail: SEC / RTS.
    { at: 0x8516, before: [0xa9, 0x02, 0x2c, 0xa9, 0x01], after: [0x38, 0x60, 0x2c, 0x38, 0x60], why: "RWTS sector I/O fails" },
    // Joystick mode on the SNES pads.
    { at: 0x815c, before: [0xa2, 0x00, 0xa0, 0x00, 0xa9, 0xff], after: jmp(r.PADDLES), why: "paddle read" },
    { at: 0x60ce, before: [0xad, 0x62, 0xc0], after: jsr(r.BUTTON1), why: "button 1 (brake)" },
    { at: 0x60d6, before: [0xad, 0x61, 0xc0], after: [0xad, lo(r.BTN0), hi(r.BTN0)], why: "button 0 (gas)" },
    { at: 0x610c, before: [0xad, 0x61, 0xc0, 0x0d, 0x62, 0xc0], after: [...jsr(r.BUTTONS), 0xea, 0xea, 0xea], why: "button press" },
    { at: 0x6119, before: [0xad, 0x61, 0xc0, 0x0d, 0x62, 0xc0, 0x30, 0xf8], after: [...jsr(r.BUTTONS), 0x30, 0xfb, 0xea, 0xea, 0xea], why: "button release wait" },
    { at: 0x921b, before: [0xa5, 0x71, 0x85, 0x73, 0xa5, 0x72, 0x85, 0x74], after: [0xa9, PAD_CENTER, 0x85, 0x73, 0x85, 0x74, 0xea, 0xea], why: "joystick centre" },
  ];
  // Apple II speed: frame pacing, speaker sounds and WAIT pauses.
  const speed = [
    { at: 0x7d95, before: jsr(0x803a), after: jsr(r.PACE), why: "frame pacing before the page flip" },
    { at: 0x7f6b, before: jmp(0x6003), after: jmp(r.TONE), why: "sound effect" },
    { at: 0x7b90, before: jsr(0x6003), after: jsr(r.TONE), why: "music note" },
    ...[0x7604, 0x7779, 0x785f, 0x7d35].map((at) => ({ at, before: jsr(WAIT), after: jsr(r.WAIT_APPLE), why: "WAIT" })),
    { at: 0x7bc4, before: jmp(WAIT), after: jmp(r.WAIT_APPLE), why: "WAIT (music rest)" },
  ];
  return timing ? [...io, ...speed] : io;
}

export function titlePatches(r, { timing = true } = {}) {
  const io = [
    // Menu item 5 rebooted the floppy (JMP $C600) so HELLO could say BYE.
    { at: 0x9d01, before: [0x4c, 0x00, 0xc6], after: [0x4c, r.QUIT & 255, r.QUIT >> 8], why: "quit to the ROM DOS" },
    { at: 0x9db9, before: [..."BASIC"].map((c) => c.charCodeAt(0)), after: [..."DOS  "].map((c) => c.charCodeAt(0)), why: "menu: QUIT TO DOS" },
  ];
  const speed = [
    { at: 0x9d60, before: [0x20, WAIT & 255, WAIT >> 8], after: [0x20, r.WAIT_APPLE & 255, r.WAIT_APPLE >> 8], why: "WAIT (menu)" },
  ];
  return timing ? [...io, ...speed] : io;
}

/** Cycles of JSR WAIT with A = a (0 = 256), the monitor's routine. */
export const waitCycles = (a) => { const n = a || 256; return 2.5 * n * n + 13.5 * n + 13; };

/** wtab[a]: the second WAIT that makes WAIT(a) last as long as on the Apple
 *  (0 = none). */
export function waitTable() {
  const tab = new Uint8Array(256);
  for (let a = 0; a < 256; a++) {
    const want = (CLOCK_RATIO - 1) * waitCycles(a) - WAIT_OVERHEAD;
    let best = 0, err = Math.abs(want);
    for (let b = 1; b < 256; b++) {
      const e = Math.abs(waitCycles(b) - want);
      if (e < err) { best = b; err = e; }
    }
    tab[a] = best;
  }
  return tab;
}

/** Apply byte-verified patches to bytes loaded at base. */
export function applyPatches(bytes, base, patches) {
  const out = bytes.slice();
  for (const p of patches) {
    const at = p.at - base;
    if (p.after.length > p.before.length) throw new Error(`patch at $${p.at.toString(16)} grows`);
    const have = Array.from(out.subarray(at, at + p.before.length));
    if (at < 0 || have.length !== p.before.length || have.join() !== p.before.join())
      throw new Error(`unexpected bytes at $${p.at.toString(16).toUpperCase()} (${p.why}): different release?`);
    out.set(p.after, at);
  }
  return out;
}

const hexb = (v) => "$" + v.toString(16).toUpperCase().padStart(2, "0");

/** asm6502 folds symbol case and lets a later definition win silently:
 *  refuse a source where two equates/labels differ only in case. */
export function checkSymbols(src) {
  const seen = new Map();
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_.][A-Za-z0-9_.]*)\s*(:|=)/) || line.match(/^([A-Za-z_.][A-Za-z0-9_.]*)\s+\./);
    if (!m) continue;
    const key = m[1].toUpperCase();
    if (seen.has(key)) throw new Error(`symbol ${m[1]} collides with ${seen.get(key)} (asm6502 ignores case)`);
    seen.set(key, m[1]);
  }
  return src;
}

/** Resident source with the file table. entries: [{ name, t, s, raw }],
 *  the hall of fame last (t = s = $FF: never matched by T/S list). */
export function residentSource(entries) {
  const names = [];
  let off = 0;
  const nameOffsets = entries.map((e) => { const o = off; names.push(e.name); off += e.name.length + 1; return o; });
  if (off > 256) throw new Error("file names exceed 256 bytes");
  const col = (f) => "        .byte " + entries.map(f).map(hexb).join(",");
  const table = [
    "ftab_t:", col((e) => e.t), "ftab_s:", col((e) => e.s),
    "ftab_lo:", col((e) => (e.raw.length - 1) & 255), "ftab_hi:", col((e) => (e.raw.length - 1) >> 8),
    "ftab_h0:", col((e) => e.raw[0]), "ftab_h1:", col((e) => e.raw[1]),
    "ftab_h2:", col((e) => e.raw[2]), "ftab_h3:", col((e) => e.raw[3]),
    "ftab_name:", "        .byte " + nameOffsets.join(","),
    "names:", ...names.map((n) => `        .asciiz "${n}"`),
    "wtab:", ...Array.from({ length: 16 }, (_, i) => "        .byte " + Array.from(waitTable().subarray(i * 16, i * 16 + 16)).map(hexb).join(",")),
    "resident_end:",
  ].join("\n");
  return `NLOAD = ${entries.length - 1}\nHOF = ${entries.length - 1}\n`
    + fs.readFileSync(path.join(patchDir, "resident.s"), "utf8") + "\n" + table + "\n";
}

export function buildResident(entries) {
  for (const e of entries) {
    if (!/^[A-Z][A-Z0-9]{0,7}$/.test(e.name)) throw new Error(`not a card file name: ${e.name}`);
    if (e.raw.length < 4 || e.raw.length > 0x10000) throw new Error(`${e.name}: bad size`);
  }
  const keys = entries.slice(0, -1).map((e) => e.t * 256 + e.s);
  if (new Set(keys).size !== keys.length) throw new Error("two files share a T/S list location");
  const res = assemble(checkSymbols(residentSource(entries)));
  if (res.org !== RES_ORG || res.symbols.RESIDENT_END > RES_END)
    throw new Error(`resident exceeds $${RES_ORG.toString(16).toUpperCase()}-$BFFF (ends at $${res.symbols.RESIDENT_END.toString(16).toUpperCase()})`);
  // tone's cycle counts assume no branch crosses a page (+1 cycle each).
  if (res.symbols.TN_CLICK >> 8 !== res.symbols.TONE_END >> 8) throw new Error("tone's delay loops cross a page");
  return res;
}

/** DIRTBIKE.PRG: loader at $0800, then the resident and game images. */
export function buildPrg(game, resident) {
  const pageUp = (n) => (n + 255) & ~255;
  const resImage = LOADER_ORG + LOADER_MAX;
  const gameImage = resImage + pageUp(resident.bytes.length);
  const src = `RES_IMAGE = $${resImage.toString(16)}\nRES_SIZE = ${resident.bytes.length}\n`
    + `GAME_IMAGE = $${gameImage.toString(16)}\nGAME_SIZE = ${game.length}\n`
    + `ROMCSW = $${resident.symbols.ROMCSW.toString(16)}\n`
    + `TIMER_INIT = $${resident.symbols.TIMER_INIT.toString(16)}\n`
    + fs.readFileSync(path.join(patchDir, "loader.s"), "utf8");
  const loader = assemble(checkSymbols(src));
  if (loader.org !== LOADER_ORG || loader.bytes.length > LOADER_MAX) throw new Error("loader exceeds $0800-$09FF");
  if (gameImage + game.length > GAME_ORG) throw new Error("PRG would overlap the game's own address");
  const prg = new Uint8Array(gameImage + game.length - LOADER_ORG);
  prg.set(loader.bytes, 0);
  prg.set(resident.bytes, resImage - LOADER_ORG);
  prg.set(game, gameImage - LOADER_ORG);
  return { prg, loader };
}

const find = (files, name) => {
  const f = files.filter((x) => x.name === name);
  if (f.length !== 1) throw new Error(`expected one file named ${name} on the disk, found ${f.length}`);
  return f[0];
};

/** Convert the disk image. Returns { tree, notes, resident } (tree: card file
 *  name -> bytes). opts.timing = false omits the Apple II speed patches. */
export function convert(dsk, opts = {}) {
  const files = readCatalog(dsk);
  const notes = [];
  const game = binary(find(files, "DIRTBIKE"));
  if (game.addr !== GAME_ORG || sha256(game.body) !== GAME_SHA256)
    throw new Error("DIRTBIKE is not the release this port supports (address or SHA-256 differs)");
  const title = find(files, "TITLE");
  if (sha256(binary(title).body) !== TITLE_SHA256)
    throw new Error("TITLE is not the release this port supports (SHA-256 differs)");
  const g = (a) => game.body[a - GAME_ORG];

  // The game finds files by its own T/S tables: map those to card names,
  // with the data taken from the catalog by name.
  const entries = [];
  const want = (name, t, s, addr) => {
    const f = find(files, name);
    const b = binary(f);
    if (b.addr !== addr) throw new Error(`${name}: load address $${b.addr.toString(16)}, expected $${addr.toString(16)}`);
    if (f.tsl[0] !== t || f.tsl[1] !== s)
      notes.push(`${name}: catalog T/S list ${f.tsl.join("/")}, game table ${t}/${s} (the game's table is used)`);
    return { name, t, s, raw: f.raw };
  };
  entries.push(want("TITLE", g(TITLE_TSL), g(TITLE_TSL + 1), LOAD_ADDR));
  for (let i = 0; i < TRACKS; i++) {
    const name = "T" + String(i + 1).padStart(2, "0");
    entries.push(want(name, g(TRACK_TSL_T + i), g(TRACK_TSL_S + i), LOAD_ADDR));
  }
  for (const e of entries)
    if (LOAD_ADDR + e.raw.length > HOF_ADDR) throw new Error(`${e.name} would load over the hall of fame`);
  const hof = find(files, "DIRTHOF");
  if (binary(hof).addr !== HOF_ADDR || hof.raw.length !== 512) throw new Error("DIRTHOF: expected two sectors loaded at $B500");
  const hofTs = [[g(HOF_SECTORS), g(HOF_SECTORS + 2)], [g(HOF_SECTORS + 1), g(HOF_SECTORS + 3)]];
  if (hof.sectors.join() !== hofTs.join())
    notes.push(`DIRTHOF: catalog sectors ${hof.sectors.join(" ")}, game table ${hofTs.join(" ")} (the catalog is used)`);
  entries.push({ name: "DIRTHOF", t: 0xff, s: 0xff, raw: hof.raw });

  const resident = buildResident(entries);
  const r = resident.symbols;
  const patched = applyPatches(game.body, GAME_ORG, gamePatches(r, opts));
  const titleRaw = applyPatches(title.raw, LOAD_ADDR, titlePatches(r, opts));
  const { prg } = buildPrg(patched, resident);
  const tree = { "DIRTBIKE.PRG": prg };
  for (const e of entries) tree[e.name] = e.name === "TITLE" ? titleRaw : e.raw;
  return { tree, notes, resident };
}

/** Write the folder; an existing DIRTHOF (the player's records) is kept. */
export function writeTree(tree, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const kept = [];
  for (const [name, bytes] of Object.entries(tree)) {
    const target = path.join(outDir, name);
    if (name === "DIRTHOF" && fs.existsSync(target)) { kept.push(name); continue; }
    fs.writeFileSync(target, bytes);
  }
  return kept;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [dskPath, outDir] = process.argv.slice(2);
  if (!dskPath || !outDir) {
    console.error("usage: node codegen/tools/port-dirtbike.mjs <DIRTBIKE.dsk> <output-dir>");
    process.exit(2);
  }
  const { tree, notes } = convert(new Uint8Array(fs.readFileSync(dskPath)));
  for (const n of notes) console.log("note: " + n);
  const dir = path.join(outDir, "DIRTBIKE");
  const kept = writeTree(tree, dir);
  if (kept.length) console.log(`kept the existing ${kept.join(", ")} (records)`);
  console.log(`wrote ${dir} (${Object.keys(tree).length} files): copy the DIRTBIKE folder to the SD card root, then CD DIRTBIKE and BRUN DIRTBIKE.PRG 0800`);
}
