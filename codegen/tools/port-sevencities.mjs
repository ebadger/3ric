// Build the 3RIC SD-card edition of Seven Cities of Gold (Electronic Arts /
// Ozark Softscape, 1984) from the two Apple II disk images.
//
//   node codegen/tools/port-sevencities.mjs <program.dsk> <map.dsk> <output-dir>
//
// Writes <output-dir>/7CITIES/: the loader 7CITIES.PRG, GAME.BIN (the game as
// Electronic Arts' boot loader leaves it in memory, decrypted and patched),
// PROGRAM.DSK (the program disk, two signature bytes changed) and MAP.DSK
// (the map disk, unchanged; the game writes saves into it). Copy the folder
// to the card, then at the ROM DOS prompt: CD 7CITIES, BRUN 7CITIES.PRG 0800.
// Gzipped images (.dsk.gz) are accepted.
//
// The disk images and the generated folder contain the copyrighted game;
// keep them local - this repository holds only the tool and the glue code.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const patchDir = path.join(root, "codegen", "patches", "sevencities");

export const FOLDER = "7CITIES";
export const DSK_BYTES = 143360;
export const GAME_START = 0x0800, GAME_END = 0xc000;       // GAME.BIN = $0800-$BFFF
export const GAME_SHIM = 0x8b82, GAME_IOB = 0x8ce4;         // runtime addresses
export const GAME_RD_PAGE = 0x8b5f, GAME_WR_PAGE = 0x8a57;  // RWTS loop operand high bytes
export const RWTS_ENTRY = 0x8eef;
export const BTN_LDA = 0x8a00, BTN_BIT = 0x8a0a;            // button-scan helpers (runtime)
// BTN_LDA: BIT $C070, NOP x3 (the scan NMI runs), LDA $C061, RTS; BTN_BIT the same with BIT $C061.
export const BTN_HELPERS = [0x2c, 0x70, 0xc0, 0xea, 0xea, 0xea, 0xad, 0x61, 0xc0, 0x60, 0x2c, 0x70, 0xc0, 0xea, 0xea, 0xea, 0x2c, 0x61, 0xc0, 0x60];
// The World Maker (73 sectors from program-disk T21 S9, loaded at $0850)
// carries the same RWTS $7900 lower.
export const WM_LOAD = 0x0850, WM_FIRST = 21 * 16 + 9, WM_SECTORS = 0x49;
export const WM_SHIM = 0x1282, WM_IOB = 0x13e4, WM_RD_PAGE = 0x125f, WM_WR_PAGE = 0x1157, WM_ENTRY = 0x15ef;
export const SIG_BANK1 = 0xa5, SIG_BANK2 = 0x5a;

// SHA-256 of the decrypted, unpatched $0800-$BFFF image built from the
// program disk this port was developed against. Other dumps are accepted
// only if every patch site still holds the expected bytes.
export const KNOWN_IMAGE_SHA256 = "bf1251aa0901481395d7b3f2e19b6f00b099c16d04bea705117dd83d9a4cc7c4";

/** Read a .dsk / .do image, gunzipping if needed. */
export function readDisk(bytes) {
  let b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0x1f && b[1] === 0x8b) b = new Uint8Array(zlib.gunzipSync(b));
  if (b.length !== DSK_BYTES) throw new Error(`not a 140 KB DOS-order disk image (${b.length} bytes)`);
  return b;
}

const ascii = (s) => Buffer.from(s, "latin1");
function contains(hay, text) {
  const needle = ascii(text);
  const hi = Uint8Array.from(needle, (c) => c | 0x80);
  return Buffer.from(hay).indexOf(needle) >= 0 || Buffer.from(hay).indexOf(hi) >= 0;
}

/** "program", "map" or null, from the boot track. */
export function identifyDisk(dsk) {
  const t0 = dsk.subarray(0, 4096);
  if (dsk[0] === 0x0b && contains(t0, "NO LANGUAGE CARD INSTALLED")) return "program";
  if (contains(t0, "MAP DISK COPY PROGRAM")) return "map";
  return null;
}

/** A track as the boot loader's whole-track reader stores it: page n holds
 *  DOS-order sector 15-n (its interleave table and the .dsk skew combined). */
export function trackAsLoaded(dsk, track) {
  const out = new Uint8Array(4096);
  for (let page = 0; page < 16; page++) {
    const s = 15 - page;
    out.set(dsk.subarray(track * 4096 + s * 256, track * 4096 + s * 256 + 256), page * 256);
  }
  return out;
}

// [track, destination page], in the order the loader reads them; later loads
// overwrite earlier ones (track 12 lands over the top of track 11, 14 over 13).
export const BOOT_LOADS = [[1, 0xa0], [2, 0xb0], [7, 0x40], [8, 0x50], [9, 0x60], [10, 0x70],
  [11, 0x80], [12, 0x86], [13, 0x08], [14, 0x10], [15, 0x20], [16, 0x30]];

/** Rebuild memory as the boot loader leaves it at JMP $4000. Its obfuscated
 *  bytecode XORs every other byte of $4000-$67FF with runs 1..n, n = 5, 6, ... */
export function buildBootImage(program) {
  const mem = new Uint8Array(0x10000);
  for (const [track, page] of BOOT_LOADS) mem.set(trackAsLoaded(program, track), page * 256);
  let run = 5, key = 1;
  for (let a = 0x4000; a < 0x6800; a += 2) {
    mem[a] ^= key;
    if (++key > run) { key = 1; run++; }
  }
  const entry = [0xad, 0x50, 0xc0, 0xad, 0x52, 0xc0, 0xad, 0x57, 0xc0];
  if (Array.from(mem.subarray(0x4000, 0x4009)).join() !== entry.join())
    throw new Error("program disk: $4000 does not decrypt to the expected entry code (different release?)");
  return mem;
}

/** The game's first act at $4000 moves blocks into place. Simulate it and
 *  return [runtime memory, origin] where origin[a] is the image address that
 *  supplied runtime address a. */
export function relocate(mem) {
  const rt = Uint8Array.from(mem);
  const origin = Int32Array.from({ length: 0x10000 }, (_, i) => i);
  const copy = (src, dst) => { rt[dst] = rt[src]; origin[dst] = origin[src]; };
  for (let dp = 0xb7; dp >= 0x70; dp--)                 // $4E00-$95FF -> $7000-$B7FF
    for (let y = 0xff; y >= 0; y--) copy(((dp - 0x22) << 8) | y, (dp << 8) | y);
  for (let p = 0x10; p < 0x20; p++)                     // $1000-$1FFF -> $6000-$6FFF
    for (let y = 0; y < 256; y++) copy((p << 8) | y, ((p + 0x50) << 8) | y);
  for (let y = 0x1f; y >= 0; y--) copy(0x4d00 | y, 0x6500 | y);   // $4900-$4D1F -> $6100-$651F
  for (let dp = 0x64; dp >= 0x61; dp--)
    for (let y = 0xff; y >= 0; y--) copy(((dp - 0x18) << 8) | y, (dp << 8) | y);
  return [rt, origin];
}

function asmText(bytes) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16)
    lines.push("        .byte " + Array.from(bytes.slice(i, i + 16), (b) => "$" + b.toString(16).padStart(2, "0")).join(","));
  return lines.join("\n");
}
const hex = (n) => "$" + n.toString(16);
const src = (name) => fs.readFileSync(path.join(patchDir, name), "utf8");

/** Sum of the ROM bytes $E141-$E279 (the SD byte and sector routines). */
export function sdRoutineSum(rom) {
  let sum = 0;
  for (let a = 0xe141; a <= 0xe279; a++) sum = (sum + rom[a]) & 0xffff;
  return sum;
}

/** Assemble resident, game shim, final stage and loader. */
export function buildGlue(rom) {
  const resident = assemble(src("resident.s"));
  const r = resident.symbols;
  if (resident.org !== 0xcf00 || r.RESIDENT_END > r.PORT_BASE0 || r.PORT_BASE0 !== 0xcff0 || r.PORT_DISK !== 0xcff8)
    throw new Error("resident overlaps the port state at $CFF0");

  const shimFor = (org, iob, rd, wr, extra = "") => {
    const a = assemble(`SHIM_ORG = ${hex(org)}\nIOB = ${hex(iob)}\nRD_PAGE = ${hex(rd)}\nWR_PAGE = ${hex(wr)}\n` + src("shim.s") + extra);
    if (a.symbols.SHIM_ENTRY !== org || org + a.bytes.length > iob)
      throw new Error(`shim at $${org.toString(16)} (+${a.bytes.length}) overlaps the IOB at $${iob.toString(16)}`);
    return a;
  };
  const shim = shimFor(GAME_SHIM, GAME_IOB, GAME_RD_PAGE, GAME_WR_PAGE, "\n" + src("progload.s"));
  const wmShim = shimFor(WM_SHIM, WM_IOB, WM_RD_PAGE, WM_WR_PAGE);

  const final = assemble(src("final.s"));
  if (final.org !== 0xca00 || final.symbols.FINAL_END > 0xcac0) throw new Error("final stage exceeds $CA00-$CABF");

  const resLen = r.RESIDENT_END - 0xcf00;
  const loader = assemble(`SDSUM = ${hex(sdRoutineSum(rom))}\nNMI_ENTRY = ${hex(r.NMI_ENTRY)}\nIRQ_ENTRY = ${hex(r.IRQ_ENTRY)}\n`
    + `FINAL_BASE = ${hex(final.symbols.GAME_LBA)}\nRES_LEN = ${resLen}\nFINAL_LEN = ${final.bytes.length}\n`
    + src("loader.s")
    + `\nres_image:\n${asmText(resident.bytes.slice(0, resLen))}\nfinal_image:\n${asmText(final.bytes)}\nloader_end:\n`);
  if (loader.org !== 0x0800 || loader.symbols.LOADER_END > 0x2000) throw new Error("loader overlaps its $2000 scratch pages");
  return { resident, shim, wmShim, final, loader, prg: loader.bytes };
}

function patchesFor(glue) {
  const s = glue.shim.symbols, r = glue.resident.symbols;
  const jsrProg = [0x20, s.PROG_LOAD & 255, s.PROG_LOAD >> 8];
  return [
    { at: RWTS_ENTRY, before: [0x08, 0x78, 0x20, 0xfc, 0x8e], after: [0x4c, GAME_SHIM & 255, GAME_SHIM >> 8, 0xfc, 0x8e],
      why: "RWTS entry (PHP/SEI) -> SD shim" },
    // The title menu's copy-protection check seeks track 5 and runs an
    // obfuscated bytecode that times raw nibbles. There is no disk to time;
    // keep only what a passed check leaves ($03 = 0, $650A = 0). The check's
    // code at $6100 is reused as data later in play, so bypass the call.
    { at: 0x6862, before: [0xa9, 0x05, 0x8d, 0xe8, 0x8c, 0xa9, 0x00, 0x8d, 0xe9, 0x8c, 0x8d, 0xf0, 0x8c, 0x20, 0x3e, 0x91, 0x20, 0xf3, 0x76, 0x20, 0x00, 0x61],
      after: [0xa9, 0x00, 0x85, 0x03, 0x8d, 0x0a, 0x65, 0x4c, 0x94, 0x69, ...new Array(12).fill(0xea)],
      why: "copy-protection check: skip it, as passed" },
    // 3RIC's $C061/$C062 are refreshed by the ROM's joystick scan, which a
    // $C070 access starts (an NMI); the Apple II buttons were live. Two
    // "press button" waits poll only the buttons, so give every button test
    // a scan first. The helpers sit in the RWTS's dead write routine, which
    // nothing writes during play.
    { at: BTN_LDA, before: [0x38, 0x86, 0xa3, 0xbd, 0x8d, 0xc0, 0xbd, 0x8e, 0xc0, 0x10, 0x03, 0x4c, 0x8f, 0x8a, 0xad, 0x00, 0x8e, 0x85, 0xaf, 0xa9],
      after: BTN_HELPERS,
      why: "button helpers: BIT $C070, let the scan NMI run, then LDA / BIT $C061" },
    { at: 0x774d, before: [0xad, 0x61, 0xc0], after: [0x20, BTN_LDA & 255, BTN_LDA >> 8], why: "endless 'press button' wait" },
    { at: 0x84f3, before: [0xad, 0x61, 0xc0], after: [0x20, BTN_LDA & 255, BTN_LDA >> 8], why: "timed 'press button to continue' wait" },
    { at: 0x88e8, before: [0x2c, 0x61, 0xc0], after: [0x20, BTN_BIT & 255, BTN_BIT >> 8], why: "in-play button test" },
    { at: 0x4071, before: [0x20, 0xbd, 0x76], after: jsrProg, why: "language-card load (bank 1) reads the program disk" },
    { at: 0x408a, before: [0x20, 0xbd, 0x76], after: jsrProg, why: "language-card load (bank 2, $E000) reads the program disk" },
    { at: 0x6a0c, before: [0x20, 0xbd, 0x76], after: [0x20, s.PROG_STAY & 255, s.PROG_STAY >> 8],
      why: "World Maker load reads the program disk, which stays in the drive" },
    { at: 0x40af, before: [0x8d, 0xfc, 0xff], after: [0xea, 0xea, 0xea], why: "keep the ROM reset vector in LC RAM" },
    { at: 0x40b2, before: [0xa9, 0x00, 0x8d, 0xfe, 0xff], after: [0xa9, r.IRQ_ENTRY & 255, 0x8d, 0xfe, 0xff], why: "IRQ/BRK -> resident (was the RESTART stub)" },
    { at: 0x40bc, before: [0x8d, 0xfd, 0xff], after: [0xea, 0xea, 0xea], why: "keep the ROM reset vector in LC RAM" },
    { at: 0x40c4, before: [0xa9, 0x03, 0x8d, 0xff, 0xff], after: [0xa9, r.IRQ_ENTRY >> 8, 0x8d, 0xff, 0xff], why: "IRQ/BRK -> resident (was the RESTART stub)" },
  ];
}

// Program-disk bytes: the bank signatures land at $DFFF of each language-card
// bank when the game loads it (bank 1 from T29S1-T30S0, bank 2 from T26S2-T27S1).
export const DISK_PATCHES = [
  { track: 30, sector: 0, offset: 0xff, before: 0x00, after: SIG_BANK1, why: "bank 1 $DFFF signature" },
  { track: 27, sector: 1, offset: 0xff, before: 0x00, after: SIG_BANK2, why: "bank 2 $DFFF signature" },
];

export function patchProgramDisk(program, glue) {
  const out = Uint8Array.from(program);
  for (const p of DISK_PATCHES) {
    const at = p.track * 4096 + p.sector * 256 + p.offset;
    if (out[at] !== p.before) throw new Error(`program disk T${p.track} S${p.sector}+$${p.offset.toString(16)}: unexpected byte (different release?)`);
    out[at] = p.after;
  }
  if (glue) patchWorldMaker(out, glue);
  return out;
}

/** Disk offset of World Maker address a: its loader copies sector j of the
 *  run starting at T21 S9 to $0850 + j*256. */
export function wmOffset(a) {
  if (a < WM_LOAD || a >= WM_LOAD + WM_SECTORS * 256) throw new Error(`$${a.toString(16)} is outside the World Maker`);
  return (WM_FIRST + ((a - WM_LOAD) >> 8)) * 256 + ((a - WM_LOAD) & 255);
}

// What the World Maker's RWTS must look like before its shim goes in: the
// PHP/SEI entry, the IOB (slot 6, drive 1) and the buffer-page operands.
const WM_PREIMAGE = [
  [WM_ENTRY, [0x08, 0x78, 0x20, 0xfc, 0x15]],
  [WM_IOB, [0x01, 0x60, 0x01]],
  [WM_RD_PAGE - 2, [0x99, 0x00]],
  [WM_WR_PAGE - 2, [0x59, 0x00]],
];

export function patchWorldMaker(disk, glue) {
  for (const [a, bytes] of WM_PREIMAGE) bytes.forEach((b, i) => {
    if (disk[wmOffset(a + i)] !== b) throw new Error(`World Maker $${(a + i).toString(16)}: unexpected byte (different release?)`);
  });
  const put = (a, bytes) => bytes.forEach((b, i) => { disk[wmOffset(a + i)] = b; });
  put(WM_SHIM, glue.wmShim.bytes);
  put(WM_ENTRY, [0x4c, WM_SHIM & 255, WM_SHIM >> 8]);
  return disk;
}

/** Apply the game patches to the image at the addresses that relocation
 *  moves into place, then check the relocated result. */
export function patchImage(image, glue) {
  const mem = Uint8Array.from(image);
  const [, origin] = relocate(mem);
  const put = (rtAddr, bytes, before) => bytes.forEach((b, i) => {
    const at = origin[rtAddr + i];
    if (before && mem[at] !== before[i])
      throw new Error(`game $${(rtAddr + i).toString(16)} (image $${at.toString(16)}): unexpected byte (different release?)`);
    mem[at] = b;
  });
  const patches = patchesFor(glue);
  for (const p of patches) put(p.at, p.after, p.before);
  put(GAME_SHIM, glue.shim.bytes);
  const [rt] = relocate(mem);
  for (const p of patches) if (Array.from(rt.subarray(p.at, p.at + p.after.length)).join() !== p.after.join())
    throw new Error(`patch at $${p.at.toString(16)} did not survive relocation`);
  if (Array.from(rt.subarray(GAME_SHIM, GAME_SHIM + glue.shim.bytes.length)).join() !== Array.from(glue.shim.bytes).join())
    throw new Error("game shim did not survive relocation");
  return mem;
}

export function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

/** Produce { "7CITIES.PRG", "GAME.BIN", "PROGRAM.DSK", "MAP.DSK" } and info. */
export function buildFolder(program, map, rom, { requireKnown = false } = {}) {
  if (identifyDisk(program) !== "program") throw new Error("first image is not the Seven Cities of Gold program disk");
  if (identifyDisk(map) !== "map") throw new Error("second image is not a Seven Cities of Gold map disk");
  const image = buildBootImage(program);
  const imageSha = sha256(image.subarray(GAME_START, GAME_END));
  if (requireKnown && imageSha !== KNOWN_IMAGE_SHA256) throw new Error(`unrecognized program disk release (image ${imageSha})`);
  const glue = buildGlue(rom);
  const patched = patchImage(image, glue);
  return {
    files: {
      "7CITIES.PRG": glue.prg,
      "GAME.BIN": patched.slice(GAME_START, GAME_END),
      "PROGRAM.DSK": patchProgramDisk(program, glue),
      "MAP.DSK": Uint8Array.from(map),
    },
    glue, imageSha, knownRelease: imageSha === KNOWN_IMAGE_SHA256,
  };
}

export function readRom() {
  return new Uint8Array(fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"))).subarray(0, 0x10000);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [programPath, mapPath, outDir] = process.argv.slice(2);
  if (!programPath || !mapPath || !outDir) {
    console.error("usage: node codegen/tools/port-sevencities.mjs <program.dsk> <map.dsk> <output-dir>");
    process.exit(2);
  }
  const program = readDisk(fs.readFileSync(programPath));
  const map = readDisk(fs.readFileSync(mapPath));
  const target = path.join(outDir, FOLDER);
  if (fs.existsSync(target)) {
    console.error(`${target} already exists - its MAP.DSK may hold saved games; move it aside first`);
    process.exit(1);
  }
  const { files, knownRelease, imageSha } = buildFolder(program, map, readRom());
  fs.mkdirSync(target, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(target, name), bytes);
  if (!knownRelease) console.warn(`WARNING: program image ${imageSha} is not the release this port was built on. The patch sites matched, but the code the two shims replace was not checked: this conversion is untested and may crash.`);
  console.log(`wrote ${target}: copy the ${FOLDER} folder to the SD card root, then CD ${FOLDER} and BRUN 7CITIES.PRG 0800`);
}
