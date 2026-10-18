// Build the 3RIC SD-card edition of Lode Runner (Broderbund, 1983) from an
// Apple II disk image of the game.
//
//   node codegen/tools/port-loderunner.mjs <lode_runner.dsk> <output-dir> [--update]
//
// Writes <output-dir>/LODERUN/:
//   LR.PRG    the loader (BRUN LR.PRG 0800)
//   GAME.BIN  the game's LODE RUNNER file, patched (see codegen/patches/loderunner)
//   MASTER/   the master disk's level area: HISCORE (T12 S15) and L00-L4F,
//             two level sectors per 512-byte file
//   DATA/     an empty Lode Runner data disk in the same layout
// Copy the folder to the card, then at the ROM DOS prompt: CD LODERUN,
// BRUN LR.PRG 0800. Gzipped images (.dsk.gz) are accepted. The tool refuses
// to overwrite an existing LODERUN folder (its HISCORE files and DATA levels
// are the player's); --update rewrites only LR.PRG and GAME.BIN.
//
// The disk image and the generated folder contain the copyrighted game; keep
// them local - this repository holds only the tool and the glue code.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const patchDir = path.join(root, "codegen", "patches", "loderunner");

export const FOLDER = "LODERUN";
export const DSK_BYTES = 143360;
export const FILE_NAME = "LODE RUNNER";
export const FILE_ADDR = 0x0800, FILE_LEN = 0x8100;
// SHA-256 of the 33,024-byte LODE RUNNER file this port was built and tested
// against (the "cr Reset Vector" release; identical to golden_source.bin of
// github.com/XekriRedmane/lode_runner_reveng, whose names are used below).
export const KNOWN_FILE_SHA256 = "a2e62f89abc8ae6aa763574fbf4db2b38cf7eb3f5b4fc0b68cbf339a12f9bd90";
export const RESIDENT = 0x9000, RESIDENT_END = 0x9b00;   // unused data in the image ($9B00: attract-mode demo moves)
export const RESIDENT2 = 0xbe00, RESIDENT2_END = 0xc000; // the replaced RWTS, above the variables at $BD00
export const LEVEL_FILES = 80;                           // Lnn: sectors 2nn, 2nn+1
export const HISCORE_LOC = 159;                          // T12 S15
export const MARKER = Buffer.from("LODE RUNNER", "latin1").map((c) => c | 0x80);

/** Read a .dsk / .do image, gunzipping if needed. */
export function readDisk(bytes) {
  let b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0x1f && b[1] === 0x8b) b = new Uint8Array(zlib.gunzipSync(b));
  if (b.length !== DSK_BYTES) throw new Error(`not a 140 KB DOS-order disk image (${b.length} bytes)`);
  return b;
}

export const sector = (dsk, t, s) => dsk.subarray((t * 16 + s) * 256, (t * 16 + s + 1) * 256);

/** The LODE RUNNER binary from the DOS 3.3 catalog (without its 4-byte header). */
export function readGameFile(dsk) {
  const vtoc = sector(dsk, 17, 0);
  let t = vtoc[1], s = vtoc[2], guard = 0;
  while (t && guard++ < 16) {
    const cat = sector(dsk, t, s);
    for (let i = 0; i < 7; i++) {
      const e = cat.subarray(11 + i * 35, 11 + i * 35 + 35);
      if (e[0] === 0 || e[0] === 0xff) continue;
      const name = String.fromCharCode(...e.subarray(3, 33).map((c) => c & 0x7f)).trimEnd();
      if (name !== FILE_NAME) continue;
      const data = [];
      let tt = e[0], ss = e[1], g2 = 0;
      while ((tt || ss) && g2++ < 40) {
        const ts = sector(dsk, tt, ss);
        for (let k = 0; k < 122; k++) {
          const dt = ts[12 + 2 * k], ds = ts[13 + 2 * k];
          if (!dt && !ds) break;
          data.push(...sector(dsk, dt, ds));
        }
        tt = ts[1]; ss = ts[2];
      }
      const addr = data[0] | (data[1] << 8), len = data[2] | (data[3] << 8);
      if (addr !== FILE_ADDR || len !== FILE_LEN || data.length < len + 4)
        throw new Error(`${FILE_NAME}: unexpected address/length $${addr.toString(16)}/$${len.toString(16)}`);
      return Uint8Array.from(data.slice(4, 4 + len));
    }
    t = cat[1]; s = cat[2];
  }
  throw new Error(`no "${FILE_NAME}" file in the disk's catalog`);
}

/** Memory after the game relocated itself: file $0000-$1FFF -> $0000-$1FFF,
 *  file $2000-$80FF -> $5F00-$BFFF. */
export function toRuntime(file) {
  const mem = new Uint8Array(0x10000);
  mem.set(file.subarray(0, 0x2000), 0);
  mem.set(file.subarray(0x2000), 0x5f00);
  return mem;
}
export function toFile(mem) {
  const file = new Uint8Array(FILE_LEN);
  file.set(mem.subarray(0, 0x2000), 0);
  file.set(mem.subarray(0x5f00, 0xc000), 0x2000);
  return file;
}
/** Where runtime address a sits once the file is loaded at $0800. */
export const loadAddress = (a) => (a < 0x2000 ? a + 0x0800 : a - 0x3700);

export function readRom() {
  return new Uint8Array(fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin")));
}

function asmText(bytes) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16)
    lines.push("        .byte " + Array.from(bytes.subarray(i, i + 16), (b) => "$" + b.toString(16).padStart(2, "0")).join(","));
  return lines.join("\n");
}

/** Assemble the resident (at $9000 and $BE00) and the two loader stages. */
export function buildGlue(gameSum = 0) {
  const resident = assemble(fs.readFileSync(path.join(patchDir, "resident.s"), "utf8"));
  const end1 = resident.symbols.RESIDENT_END, end2 = resident.symbols.RESIDENT2_END;
  if (resident.org !== RESIDENT || end1 > RESIDENT_END) throw new Error(`resident does not fit $9000-$9AFF (ends $${end1.toString(16)})`);
  if (end2 > RESIDENT2_END) throw new Error(`resident part 2 does not fit $BE00-$BFFF (ends $${end2.toString(16)})`);
  for (const r of resident.listing)
    if (r.bytes.length && !((r.pc >= RESIDENT && r.pc < end1) || (r.pc >= RESIDENT2 && r.pc < end2)))
      throw new Error(`resident byte outside its two regions at $${r.pc.toString(16)}`);
  resident.parts = [[RESIDENT, resident.bytes.subarray(0, end1 - RESIDENT)],
    [RESIDENT2, resident.bytes.subarray(RESIDENT2 - RESIDENT, end2 - RESIDENT)]];
  const romcswLoad = loadAddress(resident.symbols.ROMCSW);
  const s2src = `GAME_SUM = $${gameSum.toString(16)}\nROMCSW_LOAD = $${romcswLoad.toString(16)}\n` +
    fs.readFileSync(path.join(patchDir, "stage2.s"), "utf8");
  const stage2 = assemble(s2src);
  if (stage2.bytes.length > 0x200) throw new Error("loader stage 2 is over 512 bytes");
  const s2img = new Uint8Array(0x200);
  s2img.set(stage2.bytes);
  const loader = assemble(`S2_CSW = $${stage2.symbols.CSW.toString(16)}\n` +
    fs.readFileSync(path.join(patchDir, "loader.s"), "utf8") + "\nSTAGE2_IMAGE:\n" + asmText(s2img) + "\n");
  if (loader.org !== 0x0800 || 0x0800 + loader.bytes.length > 0x2800) throw new Error("loader image too large");
  return { resident, stage2, loader };
}

// Guarded patches on the runtime image: [address, original bytes, new bytes(sym)].
const J = (op, a) => [op, a & 255, a >> 8];
const NOP = (n) => new Array(n).fill(0xea);
export const PATCHES = [
  [0x5f7d, [0xad, 0x81, 0xc0, 0xad, 0x81, 0xc0], (s) => [...J(0x20, s.LR_INIT), ...NOP(3)], "MAIN: start-up glue"],
  [0x619f, [0xad, 0x62, 0xc0, 0x30, 0x5d, 0xad, 0x61, 0xc0], (s) => [...J(0x20, s.PAD_BTN), 0x30, 0x5d, ...J(0x4c, 0x61a9)], "title: pad buttons start a game"],
  [0x61a9, [0xad, 0x00, 0xc0], (s) => J(0x20, s.TITLE_KBD), "title: pads also polled in keyboard mode"],
  [0x61f6, [0x8d, 0x10, 0xc0], (s) => J(0x20, s.TITLE_KEY), "title: Ctrl-D swaps disks"],
  [0x6211, [0x4c, 0x84, 0x7b], (s) => J(0x4c, s.ED_ENTER), "Ctrl-E: editor on the data disk"],
  [0x612f, [0x20, 0x2a, 0x62, 0x20, 0x2a, 0x62, 0x20, 0x2a, 0x62], (s) => [...J(0x20, s.MB_TALLY), ...NOP(6)], "level clear: Mockingboard tally"],
  [0x69bd, [0xa5, 0x95, 0xc9, 0xcb, 0xf0, 0x13, 0xad, 0x62], (s) => [...J(0x20, s.PAD_BTN), 0x30, 0x0b, ...J(0x4c, 0x69d6)], "attract mode: pad interrupts the demo"],
  [0x6a22, [0xa5, 0x95, 0xc9, 0xcb, 0xf0, 0x2d], (s) => [...J(0x4c, s.NOKEY_HOOK), ...NOP(3)], "input: no key"],
  [0x6a49, [0xa5, 0x95, 0xc9, 0xca, 0xf0, 0xd9], (s) => [...J(0x4c, s.KEY_HOOK), ...NOP(3)], "input: a key"],
  [0x6a76, [0x20, 0xa8, 0x86], (s) => J(0x20, s.PAUSE_WAIT), "pause: Start resumes too"],
  [0x6ad0, [0xad, 0x62, 0xc0], (s) => J(0x4c, s.PAD_COMMAND), "READ_JOYSTICK_FOR_COMMAND: SNES pads"],
  [0x77b7, [0xa5, 0x95, 0xc9, 0xcb, 0xf0, 0x0a, 0xad, 0x62, 0xc0], (s) => [...J(0x20, s.PAD_BTN), 0x30, 0x1a, ...J(0x4c, 0x77c7)], "high-score pause: pad continues"],
  [0x799a, [0x8d, 0x55, 0xc0], (s) => J(0x20, s.HS_LABEL), "high scores: name the disk"],
  [0x7c1c, [0x20, 0xe0, 0x86, 0x8d, 0xc3, 0xcf, 0xcd, 0xcd, 0xc1, 0xce, 0xc4, 0xbe, 0x00], (s) => [...J(0x20, s.ED_PROMPT), ...NOP(10)], "editor prompt names the disk"],
  [0x7d1f, [0x20, 0x7f, 0x80], (s) => J(0x20, s.MOVE_SRC), "move level: master may be the source"],
  [0x823f, [0x20, 0x00, 0x87], (s) => J(0x20, s.ED_WAIT), "editor: Ctrl-D, Esc leaves"],
  [0x862c, [0x20, 0xb0, 0x82], (s) => J(0x20, s.FOLD2), "WAIT_FOR_KEY: upper case"],
  [0x8740, [0x20, 0xaa, 0x82], (s) => J(0x20, s.FOLD1), "WAIT_FOR_KEY page 1: upper case"],
  [0x86ce, [0xa0, 0xc0, 0xa2], (s) => J(0x4c, s.BEEP), "BEEP at Apple II pitch"],
  [0x876d, [0xa5, 0x95, 0xc9], (s) => J(0x4c, s.PAD_CHECK_DELAY), "CHECK_JOYSTICK_OR_DELAY: pads, pacing"],
  [0x87ba, [0x85, 0x0a, 0x86], (s) => J(0x4c, s.PLAY_NOTE), "PLAY_NOTE at Apple II pitch"],
  [0x8811, [0xa4, 0x54, 0xf0, 0x1d], (s) => [...J(0x4c, s.PS_HOOK), 0xea], "PLAY_SOUND: frame pacing"],
  [0x88b6, [0x20, 0xd7, 0x88], (s) => J(0x20, s.IRIS_STEP), "iris close: pacing"],
  [0x88cb, [0x20, 0xd7, 0x88], (s) => J(0x20, s.IRIS_STEP), "iris open: pacing"],
  [0x8d28, [0xee, 0x4b, 0x8d], (s) => J(0x20, s.ANIM_PACE), "game-over spin: pacing"],
  [0x8d2b, [0xa5, 0x95, 0xc9, 0xcb, 0xf0, 0x0a, 0xad, 0x62, 0xc0], (s) => [...J(0x20, s.PAD_BTN), 0x30, 0x11, ...J(0x4c, 0x8d3b)], "game-over spin: pad skips"],
  [0xb7b5, [0x08, 0x78, 0x20], (s) => J(0x4c, s.SHIM), "RWTS entry: SD shim"],
];

/** Apply every patch over the exact original bytes and install the resident. */
export function patchRuntime(mem, glue) {
  const out = Uint8Array.from(mem);
  const s = glue.resident.symbols;
  for (const [at, orig, make, what] of PATCHES) {
    const have = Array.from(out.subarray(at, at + orig.length));
    if (have.join() !== orig.join())
      throw new Error(`patch "${what}" at $${at.toString(16)}: unexpected bytes (different release?)`);
    const bytes = make(s);
    if (bytes.length > orig.length) throw new Error(`patch "${what}" is longer than the bytes it replaces`);
    out.set(bytes, at);
  }
  for (const [at, bytes] of glue.resident.parts) out.set(bytes, at);
  return out;
}

const sum16 = (b) => b.reduce((a, x) => (a + x) & 0xffff, 0);

/** The level area: 160 sectors from track 3. */
export function levelArea(dsk) {
  return Array.from({ length: 160 }, (_, loc) => sector(dsk, 3 + (loc >> 4), loc & 15));
}

export function levelFiles(area) {
  const files = {};
  for (let n = 0; n < LEVEL_FILES; n++) {
    const f = new Uint8Array(512);
    if (2 * n !== HISCORE_LOC) f.set(area[2 * n], 0);
    if (2 * n + 1 !== HISCORE_LOC) f.set(area[2 * n + 1], 256);
    files["L" + n.toString(16).toUpperCase().padStart(2, "0")] = f;
  }
  return files;
}

/** An empty data disk's high-score sector: no scores, the marker, flag 0. */
export function dataHiscore() {
  const h = new Uint8Array(256);
  h.set(MARKER, 244);
  return h;
}

export function checkMasterHiscore(h) {
  if (Buffer.from(h.subarray(244, 255)).compare(Buffer.from(MARKER)) !== 0 || h[255] === 0)
    throw new Error("master disk: T12 S15 is not a Lode Runner master high-score sector");
  if (h.subarray(80, 100).some((b) => b !== 0))
    throw new Error("master disk: high-score sector bytes 80-99 are in use");
}

/** Build the whole LODERUN tree: { name: bytes | subtree }. */
export function buildTree(dskBytes) {
  const dsk = readDisk(dskBytes);
  const file = readGameFile(dsk);
  const sha = crypto.createHash("sha256").update(file).digest("hex");
  if (sha !== KNOWN_FILE_SHA256)
    throw new Error(`${FILE_NAME} is not the release this port supports (SHA-256 ${sha})`);
  const area = levelArea(dsk);
  checkMasterHiscore(area[HISCORE_LOC]);
  const pre = buildGlue();
  const game = toFile(patchRuntime(toRuntime(file), pre));
  const glue = buildGlue(sum16(game));
  const empty = Array.from({ length: 160 }, () => new Uint8Array(256));
  return {
    glue,
    tree: {
      "LR.PRG": glue.loader.bytes,
      "GAME.BIN": game,
      MASTER: { HISCORE: Uint8Array.from(area[HISCORE_LOC]), ...levelFiles(area) },
      DATA: { HISCORE: dataHiscore(), ...levelFiles(empty) },
    },
  };
}

function writeTree(dir, tree, only = null) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, v] of Object.entries(tree)) {
    if (only && !only.includes(name)) continue;
    if (v instanceof Uint8Array) fs.writeFileSync(path.join(dir, name), v);
    else writeTree(path.join(dir, name), v);
  }
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith("--"));
  const update = argv.includes("--update");
  if (args.length !== 2) {
    console.error("usage: node codegen/tools/port-loderunner.mjs <lode_runner.dsk[.gz]> <output-dir> [--update]");
    process.exit(2);
  }
  const { tree } = buildTree(fs.readFileSync(args[0]));
  const out = path.join(args[1], FOLDER);
  if (fs.existsSync(out) && !update) {
    console.error(`${out} exists (its high scores and DATA levels are kept); use --update to rewrite LR.PRG and GAME.BIN only`);
    process.exit(1);
  }
  writeTree(out, tree, fs.existsSync(out) ? ["LR.PRG", "GAME.BIN"] : null);
  console.log(`wrote ${out}: copy it to the SD card, then CD ${FOLDER} and BRUN LR.PRG 0800`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));
