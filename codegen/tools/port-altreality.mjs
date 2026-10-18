// Build the 3RIC SD-card edition of Alternate Reality: The City (Datasoft /
// Paradise Programming, 1985) and Alternate Reality: The Dungeon (Datasoft,
// 1987) from Apple II disk images.
//
//   node codegen/tools/port-altreality.mjs <output-dir> <image>...
//
// Images may be .nib (232,960 bytes; the volume number in the address fields
// names the side and the contents must agree), DOS-order .dsk / .do (143,360 bytes), or either
// gzipped. Give the City's two sides and/or the Dungeon's three sides (disk 1
// side 1 original or cracked, side 2, disk 2 side 1); character disks are
// optional - initialized empty ones are generated otherwise. Writes
// <output-dir>/AR/ with CITY.PRG + CITY1.DSK CITY2.DSK CITYCHR.DSK and/or
// DUNGEON.PRG + DUNGEON1.DSK DUNGEON2.DSK DUNGEON3.DSK DUNCHR.DSK. Copy the
// folder to the card, then at the ROM DOS prompt: CD AR, BRUN CITY.PRG 6000
// (or BRUN DUNGEON.PRG 6000). One folder holds both games so the Dungeon's
// "transfer a City character" finds CITYCHR.DSK.
//
// The disk images and the generated folder contain the copyrighted games;
// keep them local - this repository holds only the tool and the glue code.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const patchDir = path.join(root, "codegen", "patches", "altreality");

export const FOLDER = "AR";
export const DSK_BYTES = 143360, NIB_BYTES = 232960, NIB_TRACK = 6656;
export const LOADER_ORG = 0x6000;
export const CITY_SHIM = 0x0d00, DUNGEON_SHIM = 0x4517, DUNGEON_PROTECT = 0x49fd;

// Every side, the volume number the game asks for it by, and its file.
export const SIDES = {
  city1: { vol: 2, file: "CITY1.DSK", what: "City side 1" },
  city2: { vol: 3, file: "CITY2.DSK", what: "City side 2" },
  citychr: { vol: 253, file: "CITYCHR.DSK", what: "City character disk" },
  dun1: { vol: 16, file: "DUNGEON1.DSK", what: "Dungeon disk 1 side 1" },
  dun2: { vol: 17, file: "DUNGEON2.DSK", what: "Dungeon disk 1 side 2" },
  dun3: { vol: 18, file: "DUNGEON3.DSK", what: "Dungeon disk 2 side 1" },
  dunchr: { vol: 20, file: "DUNCHR.DSK", what: "Dungeon character disk" },
};
const BY_VOL = Object.fromEntries(Object.entries(SIDES).map(([k, v]) => [v.vol, k]));

// Images each loader locates, in order: image 0 boots and starts in drive 1;
// image `drive2` starts in drive 2 (the character disk).
export const GAMES = {
  city: { prg: "CITY.PRG", files: ["city1", "city2", "citychr"], drive2: 2, xor: 0x00, boot: "boot-city.s", front: "city.s" },
  dungeon: { prg: "DUNGEON.PRG", files: ["dun1", "dun2", "dun3", "dunchr", "citychr"], drive2: 3, xor: 0x87, boot: "boot-dungeon.s", front: "dungeon.s" },
};

// SHA-256 of the DOS-order sides this port was built and tested on. The
// Dungeon's disk 1 side 1 exists as an original dump and as a crack that
// differs in three track-0 sectors; both are known.
export const KNOWN_SHA256 = {
  city1: ["033b7cac253b311b27839eb2cccd9acacdd070e2373d923be3149af917d51795"],
  city2: ["aa04ac0a5730d10ce61f425d88ccfc62192383a03d0a6e42839d09e32c9a396b"],
  dun1: ["6d11463a3aa41d570dff2d58022b8346876b23927a3a529b110410216ffde21b",
    "16def47d967961329e7484403f905b71e9cfb73bdc9be23afa7193145b858691"],
  dun2: ["b189c9663f25a8c7028959b3269e2e94d0696fff0c0049daf3ef65d4e8f97cbb"],
  dun3: ["cb8916d86fc77a66b7522208fffcf7101515ab95b77d97075fd93aac9a9c3a7f"],
};

export function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
const gunzip = (b) => (b[0] === 0x1f && b[1] === 0x8b ? new Uint8Array(zlib.gunzipSync(b)) : b);
const sectorAt = (t, s) => (t * 16 + s) * 256;

// ---------------------------------------------------------------------------
// .nib -> DOS-order .dsk (standard 16-sector 6-and-2), keeping the volume.

const SIX_AND_TWO = [
  0x96, 0x97, 0x9a, 0x9b, 0x9d, 0x9e, 0x9f, 0xa6, 0xa7, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb2, 0xb3,
  0xb4, 0xb5, 0xb6, 0xb7, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf, 0xcb, 0xcd, 0xce, 0xcf, 0xd3,
  0xd6, 0xd7, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe5, 0xe6, 0xe7, 0xe9, 0xea, 0xeb, 0xec,
  0xed, 0xee, 0xef, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff];
const UNSIX = new Int16Array(256).fill(-1);
SIX_AND_TWO.forEach((n, i) => { UNSIX[n] = i; });
/** physical sector -> DOS 3.3 logical sector (.dsk order) */
export const PHYS_TO_DOS = [0, 7, 14, 6, 13, 5, 12, 4, 11, 3, 10, 2, 9, 1, 8, 15];

/** Decode one 6-and-2 data field (343 nibbles); null on a bad nibble or checksum. */
export function decodeDataField(nibs) {
  const v = new Uint8Array(343);
  let acc = 0;
  for (let i = 0; i < 343; i++) {
    const x = UNSIX[nibs[i]];
    if (x < 0) return null;
    acc ^= x;
    v[i] = acc;
  }
  if (acc !== 0) return null;          // the last nibble is the running checksum
  const out = new Uint8Array(256);
  for (let k = 0; k < 256; k++) {
    const a = v[k % 86] >> (2 * Math.floor(k / 86));
    out[k] = ((v[86 + k] << 2) | ((a & 1) << 1) | ((a >> 1) & 1)) & 255;
  }
  return out;
}

/** Decode a .nib to { dsk, vol }; every track must yield all 16 sectors. */
export function nibToDsk(nib) {
  if (nib.length !== NIB_BYTES) throw new Error(`not a 35-track .nib (${nib.length} bytes)`);
  const dsk = new Uint8Array(DSK_BYTES);
  const vols = new Set();
  for (let t = 0; t < 35; t++) {
    const tr = new Uint8Array(NIB_TRACK + 512);
    tr.set(nib.subarray(t * NIB_TRACK, (t + 1) * NIB_TRACK));
    tr.set(nib.subarray(t * NIB_TRACK, t * NIB_TRACK + 512), NIB_TRACK);
    const got = new Set();
    for (let i = 0; i < NIB_TRACK; i++) {
      if (tr[i] !== 0xd5 || tr[i + 1] !== 0xaa || tr[i + 2] !== 0x96) continue;
      const oe = (k) => ((tr[i + 3 + k] << 1) | 1) & tr[i + 4 + k];
      const vol = oe(0), trk = oe(2), sec = oe(4);
      if (trk !== t || sec > 15 || got.has(sec)) continue;
      let j = i + 11;
      const limit = i + 11 + 64;
      while (j < limit && !(tr[j] === 0xd5 && tr[j + 1] === 0xaa && tr[j + 2] === 0xad)) j++;
      if (j >= limit) continue;
      const data = decodeDataField(tr.subarray(j + 3, j + 3 + 343));
      if (!data) continue;
      dsk.set(data, sectorAt(t, PHYS_TO_DOS[sec]));
      got.add(sec);
      vols.add(vol);
    }
    if (got.size !== 16) throw new Error(`.nib track ${t}: ${got.size} of 16 sectors readable`);
  }
  if (vols.size !== 1) throw new Error(`.nib: mixed volume numbers ${[...vols].join(",")}`);
  return { dsk, vol: [...vols][0] };
}

/** Read an image file's bytes to { dsk, vol } (vol null for .dsk). */
export function readImage(bytes) {
  const b = gunzip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (b.length === NIB_BYTES) return nibToDsk(b);
  if (b.length === DSK_BYTES) return { dsk: Uint8Array.from(b), vol: null };
  throw new Error(`not a 140 KB .dsk or a 35-track .nib (${b.length} bytes)`);
}

// ---------------------------------------------------------------------------
// Identification.

function hasText(buf, text, mask = 0) {
  const t = Buffer.from(text, "latin1");
  const plain = Buffer.from(Uint8Array.from(buf, (b) => (b ^ mask) & 0x7f));
  return plain.indexOf(t) >= 0;
}
const bytesAt = (dsk, t, s, off, n) => Array.from(dsk.subarray(sectorAt(t, s) + off, sectorAt(t, s) + off + n));
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Which side an image is: a .nib's volume must agree with its contents
 *  (known SHA-256 or the side's markers); a .dsk is named by its contents. */
export function identify({ dsk, vol }) {
  const byContent = contentRole(dsk);
  if (vol != null) {
    const role = BY_VOL[vol];
    if (!role) throw new Error(`.nib volume ${vol} is not an Alternate Reality disk`);
    if (byContent !== role)
      throw new Error(`.nib volume ${vol} names the ${SIDES[role].what}, but its contents ${byContent ? `are the ${SIDES[byContent].what}` : "are not a known release of it"}`);
    return role;
  }
  return byContent;
}

function contentRole(dsk) {
  const h = sha256(dsk);
  for (const [role, hashes] of Object.entries(KNOWN_SHA256)) if (hashes.includes(h)) return role;
  if (eq(bytesAt(dsk, 0, 5, 0, 6), [0x84, 0x48, 0x85, 0x49, 0xa0, 0x02]) && hasText(dsk.subarray(sectorAt(23, 0), sectorAt(24, 0)), "Hit I to initialize a character disk")) return "city1";
  if (hasText(dsk.subarray(0, 256), "THIS IS THE CITY DISK SIDE 2")) return "city2";
  if (eq(bytesAt(dsk, 0, 12, 0x83, 5), [0x08, 0x78, 0x20, 0x17, 0x45])) return "dun1";
  if (hasText(dsk.subarray(0, 256), "NO D.O.S. ON THIS DISK", 0x87)) return "dun2";
  if (hasText(dsk.subarray(sectorAt(0, 1), sectorAt(0, 1) + 12), "AR CHAR DISK")) return "citychr";
  if (hasText(dsk.subarray(sectorAt(0, 15), sectorAt(0, 15) + 8), "AR CHAR", 0x87)) return "dunchr";
  return null;
}

// ---------------------------------------------------------------------------
// Where game addresses come from on disk.

/** City side 1: memory address -> [track, sector, offset] for the regions
 *  the patches touch, following the loads the boot and game make. */
export function cityAddr(a) {
  const page = a >> 8, off = a & 255;
  if (page >= 0x08 && page <= 0x15) return [0, page - 0x08, off];      // boot: T0 S0-13 -> $0800
  if (page >= 0x40 && page <= 0x7e) {                                    // boot: 63 sectors from T20 S1 -> $4000
    const p = page - 0x40;
    if (p < 2) return [20, 1 - p, off];
    return [21 + ((p - 2) >> 4), 15 - ((p - 2) & 15), off];
  }
  if (page >= 0x80 && page <= 0xbf) {                                    // game: 128 sectors from T12 S15 down to $4000
    const i = 0xbf - page;
    return [12 - (i >> 4), 15 - (i & 15), off];
  }
  throw new Error(`no City disk mapping for $${a.toString(16)}`);
}

/** Dungeon disk 1 side 1 track 0: sector s -> page $4F-s (and S0 -> $0800). */
export function dungeonAddr(a) {
  const page = a >> 8;
  if (page < 0x40 || page > 0x4f) throw new Error(`no Dungeon disk mapping for $${a.toString(16)}`);
  return [0, 0x4f - page, a & 255];
}

function put(dsk, map, a, bytes, before, why) {
  bytes.forEach((b, i) => {
    const [t, s, o] = map(a + i);
    const at = sectorAt(t, s) + o;
    if (before && dsk[at] !== before[i])
      throw new Error(`$${(a + i).toString(16)} (T${t} S${s}+$${o.toString(16)}): unexpected byte $${dsk[at].toString(16)} - ${why} (different release?)`);
    dsk[at] = b;
  });
}

// ---------------------------------------------------------------------------
// Glue.

const hex = (n) => "$" + n.toString(16);
const src = (name) => fs.readFileSync(path.join(patchDir, name), "utf8");
function asmText(bytes) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16)
    lines.push("        .byte " + Array.from(bytes.slice(i, i + 16), (b) => "$" + b.toString(16).padStart(2, "0")).join(","));
  return lines.join("\n");
}

/** Sum of the ROM bytes $E141-$E279 (the SD byte and sector routines). */
export function sdRoutineSum(rom) {
  let sum = 0;
  for (let a = 0xe141; a <= 0xe279; a++) sum = (sum + rom[a]) & 0xffff;
  return sum;
}

export function buildResident() {
  const resident = assemble(src("resident.s"));
  const r = resident.symbols;
  if (resident.org !== 0xcf00 || r.RESIDENT_END > r.PORT_VOL || r.PORT_VOL !== 0xcfe0 || r.PORT_CUR !== 0xcfe5
    || r.PORT_N !== 0xcfe7 || r.PORT_BASE !== 0xcfe8 || r.PORT_END > 0xd000 || (r.NMI_ENTRY >> 8) !== 0xcf)
    throw new Error("resident overlaps the port state at $CFE0");
  return resident;
}

/** Assemble a game's RWTS replacement (front end + SD core). */
export function buildShim(game) {
  const g = GAMES[game];
  const shim = assemble(`XORV = ${hex(g.xor)}\n` + src(g.front) + "\n" + src("sdcore.s"));
  const org = game === "city" ? CITY_SHIM : DUNGEON_SHIM;
  const limit = game === "city" ? 0x1000 : DUNGEON_PROTECT;
  if (shim.org !== org || shim.symbols.RWTS !== org || org + shim.bytes.length > limit)
    throw new Error(`${game} shim at $${org.toString(16)} (+${shim.bytes.length}) exceeds $${limit.toString(16)}`);
  return shim;
}

export function buildLoader(game, rom, resident) {
  const g = GAMES[game];
  const r = resident.symbols;
  const resLen = r.RESIDENT_END - 0xcf00;
  const names = g.files.map((k) => `"${SIDES[k].file}",0`).join(",");
  const loader = assemble(`SDSUM = ${hex(sdRoutineSum(rom))}\nSETVEC = ${hex(r.SETVEC)}\nRES_LEN = ${resLen}\nNFILES = ${g.files.length}\n`
    + src("loader.s") + "\n" + src(g.boot)
    + `\nnames: .byte ${names}\nf_vols: .byte ${g.files.map((k) => SIDES[k].vol).join(",")}\ncur_init: .byte 0,${g.drive2}\n`
    + `res_image:\n${asmText(resident.bytes.slice(0, resLen))}\nloader_end:\n`);
  if (loader.org !== LOADER_ORG || loader.symbols.LOADER_END > 0x7000) throw new Error("loader overlaps its $7000 scratch pages");
  return loader;
}

export function buildGlue(rom) {
  const resident = buildResident();
  return {
    resident,
    city: { shim: buildShim("city"), loader: buildLoader("city", rom, resident) },
    dungeon: { shim: buildShim("dungeon"), loader: buildLoader("dungeon", rom, resident) },
  };
}

// ---------------------------------------------------------------------------
// Patches.

const NOP3 = [0xea, 0xea, 0xea];
const BACKUP_LINE = "Hit B for backup program";

export function cityPatches(glue) {
  const fix = glue.resident.symbols.FIXVEC;
  return [
    { at: 0x103e, before: [0x8d, 0xfd, 0xff], after: NOP3, why: "module loader: keep the ROM reset vector (RESET returns to 3RIC)" },
    { at: 0x1043, before: [0x8d, 0xfc, 0xff], after: NOP3, why: "module loader: keep the ROM reset vector" },
    { at: 0x68e3, before: [0x2c, 0x83, 0xc0, 0x2c, 0x83, 0xc0], after: [0x20, fix & 255, fix >> 8, ...NOP3],
      why: "after the title's ROM copy into bank 2: point NMI/IRQ at the resident again" },
    { at: 0x6905, before: [0xae, 0x6c, 0x10], after: [0x4c, 0x18, 0x69],
      why: "random seed timed from the spinning disk: no disk on the card, skip the wait" },
    { at: 0x6948, before: [0x09], after: [0x07], why: "title menu: drop B (raw-disk Backup program) from the keys" },
    { at: 0x7400, before: [0x8d, 0x34, 0x68], after: [0x18, 0x60, 0xea],
      why: "character-disk initializer's raw 'disk has data?' probe: always warn before erasing" },
    { at: 0x77ae, before: [0x45, 0x00, 0xcd, 0x6d], after: [0xad, 0x6d, 0x10, 0x60],
      why: "title menu: after a disk error, do not probe the other drive's hardware" },
    { at: 0x8c70, before: [0x4d, 0x89, 0x46, 0xcd], after: [0xad, 0x6d, 0x10, 0x60],
      why: "in play: after a disk error, do not probe the other drive's hardware" },
  ];
}

/** City side 1 as it goes on the card: SD shim over the RWTS, patches. */
export function patchCity1(side1, glue) {
  const out = Uint8Array.from(side1);
  put(out, cityAddr, CITY_SHIM, [0x84, 0x48, 0x85, 0x49, 0xa0, 0x02], [0x84, 0x48, 0x85, 0x49, 0xa0, 0x02], "RWTS entry");
  put(out, cityAddr, CITY_SHIM, Array.from(glue.city.shim.bytes), null, "");
  for (const p of cityPatches(glue)) put(out, cityAddr, p.at, p.after, p.before, p.why);
  // Blank the menu line for the dropped Backup key (its last character
  // carries the string terminator bit).
  const s = sectorAt(23, 1);
  const at = Buffer.from(out.subarray(s, s + 256)).indexOf(Buffer.from(BACKUP_LINE, "latin1"));
  if (at < 0 || out[s + at + BACKUP_LINE.length] !== 0xae) throw new Error("City side 1: Backup menu line not found (different release?)");
  out.fill(0x20, s + at, s + at + BACKUP_LINE.length);
  out[s + at + BACKUP_LINE.length] = 0xa0;
  return out;
}

/** Dungeon disk 1 side 1 as it goes on the card. */
export function patchDungeon1(side1, glue) {
  const out = Uint8Array.from(side1);
  put(out, dungeonAddr, 0x4383, [0x08, 0x78, 0x20, 0x17, 0x45, 0xb0, 0x04, 0x28], [0x08, 0x78, 0x20, 0x17, 0x45, 0xb0, 0x04, 0x28], "RWTS wrapper");
  put(out, dungeonAddr, DUNGEON_SHIM, [0xa9, 0x01, 0x8d, 0xdc, 0x1b], [0xa9, 0x01, 0x8d, 0xdc, 0x1b], "RWTS core");
  put(out, dungeonAddr, DUNGEON_SHIM, Array.from(glue.dungeon.shim.bytes), null, "");
  put(out, dungeonAddr, DUNGEON_PROTECT, [0x18, 0x60, 0xea], [0x20, 0x0b, 0x4a],
    "copy-protection nibble check (seeks and times the drive): report it passed");
  return out;
}

// ---------------------------------------------------------------------------
// Character disks.

/** An initialized, empty City character disk: what the game's initializer
 *  writes (boot stub T0 S0 from $7340, directory T0 S1 from $732C). */
export function blankCityChar(side1) {
  const out = new Uint8Array(DSK_BYTES);
  const page = (a) => { const r = new Uint8Array(256); for (let i = 0; i < 256; i++) { const [t, s, o] = cityAddr(a + i); r[i] = side1[sectorAt(t, s) + o]; } return r; };
  out.set(page(0x7340), sectorAt(0, 0));
  out.set(page(0x732c), sectorAt(0, 1));
  if (!hasText(out.subarray(sectorAt(0, 1), sectorAt(0, 1) + 12), "AR CHAR DISK")) throw new Error("City side 1: character disk template not found");
  return out;
}

/** An initialized, empty Dungeon character disk: "AR CHAR!" in T0 S15, the
 *  rest empty (an empty sector reads back as $00 through the XOR $87). */
export function blankDungeonChar() {
  const out = new Uint8Array(DSK_BYTES);
  const id = [0x41, 0x52, 0x20, 0x43, 0x48, 0x41, 0x52, 0x21];
  for (let i = 0; i < 256; i++) out[sectorAt(0, 15) + i] = (i < id.length ? id[i] : 0) ^ 0x87;
  return out;
}

// ---------------------------------------------------------------------------

/** From a list of { dsk, vol } images: { files, games, notes }. */
export function buildFolder(images, rom) {
  const sides = {};
  const notes = [];
  for (const im of images) {
    const role = identify(im);
    if (!role) throw new Error("an image is not a recognised Alternate Reality disk side");
    if (sides[role]) throw new Error(`two images are the ${SIDES[role].what}`);
    sides[role] = im.dsk;
    const known = KNOWN_SHA256[role];
    if (known && !known.includes(sha256(im.dsk)))
      notes.push(`WARNING: the ${SIDES[role].what} is not the release this port was built on; the patch sites matched, but this conversion is untested.`);
  }
  const glue = buildGlue(rom);
  const files = {};
  const games = [];
  if (sides.city1 || sides.city2) {
    if (!sides.city1 || !sides.city2) throw new Error("The City needs both sides");
    files[GAMES.city.prg] = glue.city.loader.bytes;
    files[SIDES.city1.file] = patchCity1(sides.city1, glue);
    files[SIDES.city2.file] = Uint8Array.from(sides.city2);
    games.push("city");
  }
  if (sides.dun1 || sides.dun2 || sides.dun3) {
    if (!sides.dun1 || !sides.dun2 || !sides.dun3) throw new Error("The Dungeon needs disk 1 side 1, disk 1 side 2 and disk 2 side 1");
    files[GAMES.dungeon.prg] = glue.dungeon.loader.bytes;
    files[SIDES.dun1.file] = patchDungeon1(sides.dun1, glue);
    files[SIDES.dun2.file] = Uint8Array.from(sides.dun2);
    files[SIDES.dun3.file] = Uint8Array.from(sides.dun3);
    files[SIDES.dunchr.file] = sides.dunchr ? Uint8Array.from(sides.dunchr) : blankDungeonChar();
    games.push("dungeon");
  }
  if (!games.length) throw new Error("no game sides given");
  if (sides.citychr) files[SIDES.citychr.file] = Uint8Array.from(sides.citychr);
  else if (sides.city1) files[SIDES.citychr.file] = blankCityChar(sides.city1);
  else {
    files[SIDES.citychr.file] = new Uint8Array(DSK_BYTES);
    notes.push("No City disks or character disk given: CITYCHR.DSK is blank (the Dungeon's City transfer will find no characters).");
  }
  return { files, games, glue, notes };
}

export function readRom() {
  return new Uint8Array(fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"))).subarray(0, 0x10000);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [outDir, ...inputs] = process.argv.slice(2);
  if (!outDir || !inputs.length) {
    console.error("usage: node codegen/tools/port-altreality.mjs <output-dir> <image.nib|.dsk[.gz]>...");
    process.exit(2);
  }
  const target = path.join(outDir, FOLDER);
  if (fs.existsSync(target)) {
    console.error(`${target} already exists - its character disks may hold your characters; move it aside first`);
    process.exit(1);
  }
  const images = inputs.map((p) => {
    try { return readImage(fs.readFileSync(p)); } catch (e) { throw new Error(`${p}: ${e.message}`); }
  });
  const { files, games, notes } = buildFolder(images, readRom());
  fs.mkdirSync(target, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(target, name), bytes);
  for (const n of notes) console.warn(n);
  const runs = games.map((g) => `BRUN ${GAMES[g].prg} ${LOADER_ORG.toString(16).toUpperCase()}`).join(" or ");
  console.log(`wrote ${target}: copy the ${FOLDER} folder to the SD card root, then CD ${FOLDER} and ${runs}`);
}
