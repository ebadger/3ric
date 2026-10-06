import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildWozFromDsk } from "./wozgen.mjs";
import { patchWozSectors, readWozSectors, sha256 } from "./wozedit.mjs";

export const INPUT_SHA256 = "82f12169a75fbb26472df750a8b31883bd73ef6d68df58a0f81e5ac569ac7239";
export const ENGLISH_SHA256 = "727335c08ffc39b470f95e6b1c89de28de6ca6c3be30b0191757ec9cfc474ad3";
export const ROM_SHA256 = "fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Offsets address the checked DOS-order image, not WOZ physical-sector numbers.
export const PATCHES = Object.freeze([
  { offset: 0x0ce7, before: "6c5c9d", after: "4cea9d",
    purpose: "DOS $9DE7: initialize DOS instead of entering BASIC" },
  { offset: 0x0d42, before: "06", after: "34",
    purpose: "DOS $9E42: BRUN rather than RUN the startup file" },
  { offset: 0x1975, before: "dec8c5cccccf", after: "c0c9cec9d4a0",
    purpose: "DOS $AA75: @INIT rather than the ^HELLO BASIC greeting" },
  { offset: 0xc502, before: "eb16", after: "ee16",
    purpose: "@WOLF: load three more bytes, ending at $1EFD below the $1F00 input driver" },
  { offset: 0xafec, before: "4c00e0ffffff", after: "9c00c04c59ff",
    purpose: "@WOLF $1EF8: acknowledge Escape, then initialize the monitor" },
  { offset: 0xd602, before: "4c00e0", after: "4c59ff",
    purpose: "@INIT $0B7E: return to the monitor if BRUN returns" },
].map(patch => Object.freeze(patch)));

export const FRENCH_PROFILE = Object.freeze({
  id: "french", sha256: INPUT_SHA256, size: 143360, sectorCount: 16,
  initList: 0xda00, initLength: 0x1243, wolfList: 0xc600,
  titleKey: 0x0c44, driverSource: 0x1a23, initExit: 0x0b7e, staging: 0x1b00,
  menuLabel: "TAPER K --> CLAVIER", replacementLabel: "START/K --> SNES+KB",
  extensionTrack: 4, bitmapShift: 16, emptyExtension: true,
  bootPatches: PATCHES.slice(0, 3),
});
export const ENGLISH_PROFILE = Object.freeze({
  id: "english", sha256: ENGLISH_SHA256, size: 234815, sectorCount: 13,
  initList: 0xba00, initLength: 0x12be, wolfList: 0x7400,
  titleKey: 0x0c56, driverSource: 0x1a9e, initExit: 0x0b8a, staging: 0x1b40,
  menuLabel: "PRESS K FOR KEYBOARD", replacementLabel: "START/K FOR SNES+KEY",
  extensionTrack: 12, bitmapShift: 19, emptyExtension: false,
  bootPatches: [
    { offset: 0x10d2, before: "6c5c1d", after: "4cd51d" },
    { offset: 0x1122, before: "4c7624", after: "4c2723" },
    { offset: 0x1cb8, before: "dec8c5cccccf", after: "c0c9cec9d4a0" },
  ],
});

export function detectCastleProfile(input) {
  const hash = sha256(input);
  const profile = [FRENCH_PROFILE, ENGLISH_PROFILE].find(p => p.sha256 === hash && p.size === input.length);
  if (!profile) throw new Error("Unsupported Castle Wolfenstein image; use one of the exact documented originals");
  return profile;
}

export function englishCoordinates() {
  const coordinates = [];
  for (let track = 0; track < 35; track++) {
    for (let logical = 0; logical < 13; logical++) {
      if ((track === 0 && logical === 10) || (track === 2 && logical === 12)) continue;
      coordinates.push({ track, sector: track < 3 ? logical : logical * 2, encoding: "5and3" });
    }
  }
  return coordinates;
}

export function decodeEnglishDisk(input) {
  // Normalized 16-slot tracks are internal only; absent/protected fields are never written.
  const dsk = Buffer.alloc(143360);
  for (const { track, sector, data } of readWozSectors(input, englishCoordinates())) {
    const logical = track < 3 ? sector : sector / 2;
    dsk.set(data, track * 4096 + logical * 256);
  }
  return dsk;
}

const instruction = (opcode, address) => Buffer.from([opcode, address & 255, address >> 8]);

function replace(bytes, offset, before, after) {
  before = Buffer.from(before);
  after = Buffer.from(after);
  if (before.length !== after.length || !bytes.subarray(offset, offset + before.length).equals(before))
    throw new Error(`Unexpected bytes at offset $${offset.toString(16)}`);
  bytes.set(after, offset);
}

export function buildControllerPayload(profile = FRENCH_PROFILE) {
  const resident = assemble(fs.readFileSync(path.join(root, "codegen", "patches", "castle-wolfenstein-snes.s"), "utf8"));
  if (resident.org !== 0xc800 || resident.symbols.RESIDENT_END > 0xcafe)
    throw new Error("SNES resident overlaps the ROM banking state");
  const source = profile.staging;
  const fullPages = Math.floor(resident.bytes.length / 256);
  const tail = resident.bytes.length % 256;
  const copy = Array.from({ length: fullPages }, (_, page) =>
    `lda $${(source + page * 256).toString(16)},x\nsta $${(resident.org + page * 256).toString(16)},x`).join("\n");
  const lastPage = tail ? `
        cpx #${tail}
        bcs copied
        lda $${(source + fullPages * 256).toString(16)},x
        sta $${(resident.org + fullPages * 256).toString(16)},x` : "";
  const proxy = Buffer.from("eefeca2c06c048da4ca9b6cefecad0032c07c0a97f8d0dc2fa6840", "hex");
  const byteList = bytes => Array.from(bytes, value => `$${value.toString(16)}`).join(",");
  const installer = assemble(`
        .org $${(Math.ceil((source + resident.bytes.length) / 16) * 16).toString(16)}
install:
        php
        pha
        phx
        phy
        bit $C081
        bit $C081
        ldx #${proxy.length - 1}
check_proxy:
        lda $F1BB,x
        cmp expected_proxy,x
        bne failed
        dex
        bpl check_proxy
        ldx #0
copy:
        ${copy}
        ${lastPage}
copied:
        inx
        bne copy
        jsr $${resident.symbols.INIT.toString(16)}
        ldx #0
copy_rom:
        lda $D000,x
write_rom:
        sta $D000,x
        inx
        bne copy_rom
        inc copy_rom+2
        inc write_rom+2
        bne copy_rom
        lda #$4C
        sta $F1CE
        lda #<$${resident.symbols.NMI_RESUME.toString(16)}
        sta $F1CF
        lda #>$${resident.symbols.NMI_RESUME.toString(16)}
        sta $F1D0
        lda #<$${resident.symbols.NMI_ENTRY.toString(16)}
        sta $FFFA
        lda #>$${resident.symbols.NMI_ENTRY.toString(16)}
        sta $FFFB
        bit $C080
        ply
        plx
        pla
        plp
        jmp $FB39
failed:
        bit $C082
        bit $C007
        bit $C051
        bit $C054
        bit $C052
        ldx #0
        lda #$A0
clear_error:
        sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne clear_error
show_error:
        lda error_text,x
        beq halted
        sta $0400,x
        inx
        bne show_error
halted:
        jmp halted
error_text:
        .byte ${byteList(Buffer.from("3RIC INPUT ROM MISMATCH - RESET").map(value => value | 0x80))},0
expected_proxy:
        .byte ${byteList(proxy)}
`);
  const end = installer.org + installer.bytes.length;
  if (end > 0x1f00) throw new Error("Input installer overlaps the original keyboard driver");
  return { resident, installer, source, end };
}

function readSingleListFile(dsk, list) {
  if (dsk[list + 1] || dsk[list + 2]) throw new Error("Unexpected chained DOS sector list");
  const positions = [];
  for (let i = 12; i < 256 && dsk[list + i]; i += 2) {
    const track = dsk[list + i], sector = dsk[list + i + 1];
    if (track >= 35 || sector >= 16) throw new Error("Invalid DOS file sector");
    positions.push(track * 4096 + sector * 256);
  }
  if (!positions.length || new Set(positions).size !== positions.length)
    throw new Error("Invalid DOS file allocation");
  const data = Buffer.concat(positions.map(offset => dsk.subarray(offset, offset + 256)));
  return { positions, data, org: data.readUInt16LE(0), length: data.readUInt16LE(2) };
}

function installController(dsk, payload, profile) {
  const { resident, installer, source, end } = payload;
  const s = resident.symbols;
  const list = profile.initList;
  const catalog = 0x11b74;
  const init = readSingleListFile(dsk, list);
  if (init.org !== 0x0880 || init.length !== profile.initLength || init.positions.length !== 19
      || dsk.readUInt16LE(catalog + 33) !== 20)
    throw new Error("Unexpected @INIT file layout");
  const length = end - init.org;
  const pages = Math.ceil((length + 4) / 256);
  const expanded = Buffer.alloc(pages * 256, 0xff);
  expanded.set(init.data);
  expanded.fill(0, init.length + 4, length + 4);
  expanded.writeUInt16LE(length, 2);
  expanded.set(resident.bytes, source - init.org + 4);
  expanded.set(installer.bytes, installer.org - init.org + 4);
  const editInit = (pc, before, after) => replace(expanded, pc - init.org + 4, before, after);
  editInit(0x0880, [0x20, 0x39, 0xfb], instruction(0x20, installer.org));
  editInit(profile.titleKey, [0xad, 0, 0xc0], instruction(0x20, s.READ_TITLE));
  editInit(0x0a4a, [0x20, 0x0c, 0xfd], instruction(0x20, s.WAIT_MENU));
  editInit(profile.driverSource, [0x4c, 0x0b, 0x1f, 0x4c, 0x0b, 0x1f, 0x4c, 0x8d, 0x1f],
    Buffer.concat([instruction(0x4c, s.GAME_INPUT), instruction(0x4c, s.GAME_INPUT), instruction(0x4c, s.GAME_FIRE)]));
  const high = text => Buffer.from(text).map(byte => byte | 128);
  editInit(0x09ae, high(profile.menuLabel), high(profile.replacementLabel));
  editInit(profile.initExit, [0x4c, 0, 0xe0], instruction(0x4c, s.EXIT_GAME));

  const added = pages - init.positions.length;
  const bitmap = 0x11038 + profile.extensionTrack * 4;
  let free = dsk.readUInt32BE(bitmap);
  for (let sector = 0; sector < added; sector++) {
    const offset = profile.extensionTrack * 4096 + sector * 256;
    const bit = 1 << (profile.bitmapShift + sector);
    if (!(free & bit) || (profile.emptyExtension && !dsk.subarray(offset, offset + 256).equals(Buffer.alloc(256))))
      throw new Error("SNES extension sector does not match its free-space contract");
    replace(dsk, list + 12 + init.positions.length * 2, [0, 0], [profile.extensionTrack, sector]);
    init.positions.push(offset);
    free = (free & ~bit) >>> 0;
  }
  dsk.writeUInt32BE(free, bitmap);
  dsk.writeUInt16LE(pages + 1, catalog + 33);
  init.positions.forEach((offset, page) => dsk.set(expanded.subarray(page * 256, (page + 1) * 256), offset));

  const wolf = readSingleListFile(dsk, profile.wolfList);
  if (wolf.org !== 0x0810 || wolf.length !== 0x16eb) throw new Error("Unexpected @WOLF file layout");
  const editWolf = (pc, before, after) => {
    const offset = pc - wolf.org + 4;
    replace(wolf.data, offset, before, after);
  };
  wolf.data.writeUInt16LE(wolf.length + 3, 2);
  editWolf(0x1ef8, [0x4c, 0, 0xe0, 0xff, 0xff, 0xff],
    Buffer.concat([Buffer.from([0x9c, 0, 0xc0]), instruction(0x4c, s.EXIT_GAME)]));
  editWolf(0x08ae, [0x20, 0x1b, 0xfd], instruction(0x20, s.WAIT_CONTINUE));
  editWolf(0x1301, [0xad, 0, 0xc0], instruction(0x20, s.READ_ACTION));
  wolf.positions.forEach((offset, page) => dsk.set(wolf.data.subarray(page * 256, (page + 1) * 256), offset));
  return { addedSectors: added, initLength: length };
}

export function patchCastleWolfenstein(input, rom) {
  if (sha256(rom) !== ROM_SHA256)
    throw new Error(`Unsupported 3ric ROM; expected SHA-256 ${ROM_SHA256}`);
  const profile = detectCastleProfile(input);
  const originalDisk = profile.id === "english" ? decodeEnglishDisk(input) : Buffer.from(input);
  const dsk = Buffer.from(originalDisk);
  for (const patch of profile.bootPatches) {
    replace(dsk, patch.offset, Buffer.from(patch.before, "hex"), Buffer.from(patch.after, "hex"));
  }
  const payload = buildControllerPayload(profile);
  const allocation = installController(dsk, payload, profile);
  const patches = [];
  for (let offset = 0; offset < dsk.length; offset += 256) {
    const before = originalDisk.subarray(offset, offset + 256);
    const after = dsk.subarray(offset, offset + 256);
    if (!before.equals(after)) patches.push({ offset, before: before.toString("hex"), after: after.toString("hex") });
  }
  const wozPatches = profile.id === "english" ? patches.map(patch => {
    const track = patch.offset >> 12, logical = (patch.offset >> 8) & 15;
    if (logical >= 13 || (track === 0 && logical === 10) || (track === 2 && logical === 12))
      throw new Error("Attempted to change an absent English disk field");
    return { track, sector: track < 3 ? logical : logical * 2, encoding: "5and3",
      offset: 0, before: patch.before, after: patch.after };
  }) : [];
  const woz = profile.id === "english" ? patchWozSectors(input, wozPatches) : Buffer.from(buildWozFromDsk(dsk));
  return { dsk, woz, patches, wozPatches, payload, profile, ...allocation };
}

function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node codegen\\tools\\patch-castle-wolfenstein.mjs <original.do|original.woz> <new.woz>");
    return;
  }
  if (args.length !== 2)
    throw new Error("Usage: node codegen\\tools\\patch-castle-wolfenstein.mjs <original.do|original.woz> <new.woz>");
  const [input, output] = args.map(name => path.resolve(name));
  if (input.toLowerCase() === output.toLowerCase()) throw new Error("Refusing to overwrite the input");
  if (path.extname(output).toLowerCase() !== ".woz") throw new Error("Output must have a .woz extension");
  const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
  const result = patchCastleWolfenstein(fs.readFileSync(input), rom);
  fs.writeFileSync(output, result.woz, { flag: "wx" });
  console.log(`Created ${output}\nProfile: ${result.profile.id}\nSHA-256: ${sha256(result.woz)}\n`
    + "Boot with C600G from the monitor. Press Start at the title and options, or Return then K.\n"
    + "Pad 1: D-pad moves; X/A/B/Y aim up/right/down/left; L fires; R searches.\n"
    + "Tap Select: inventory. Select+L: grenade; Select+R: use; Start+Select: exit.\n"
    + "Experimental hardware-trial image; physical-board confirmation is still required.\n"
    + "The current Disk II emulator ignores writes: saves and new castles do not persist.");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`patch-castle-wolfenstein: ${error.message}`); process.exitCode = 1; }
}
