import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildWozFromDsk } from "./wozgen.mjs";
import { sha256 } from "./wozedit.mjs";

export const INPUT_SHA256 = "cf399cc69ea391774ea64057975b6402978569332e23951721fb1d618fe3366c";
export const ROM_SHA256 = "fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hex = value => `$${value.toString(16)}`;
const physical = logical => logical === 15 ? 15 : logical * 13 % 15;
const logical = sector => sector === 15 ? 15 : sector * 7 % 15;

export function readDosFiles(input) {
  const disk = Buffer.from(input);
  if (disk.length !== 143360) throw new Error("Expected a 143360-byte, 35-track DOS-order disk");
  const sector = (track, number) => {
    if (!Number.isInteger(track) || track < 0 || track >= 35 ||
        !Number.isInteger(number) || number < 0 || number >= 16)
      throw new Error(`Invalid DOS sector ${track}/${number}`);
    return disk.subarray((track * 16 + number) * 256, (track * 16 + number + 1) * 256);
  };
  const vtoc = sector(17, 0);
  if (vtoc[0x34] !== 35 || vtoc[0x35] !== 16 || vtoc.readUInt16LE(0x36) !== 256)
    throw new Error("Unsupported DOS disk geometry");
  const occupied = new Set(["17/0"]);
  const claim = (track, number) => {
    const data = sector(track, number), key = `${track}/${number}`;
    if (occupied.has(key)) throw new Error(`Repeated or overlapping DOS sector ${key}`);
    occupied.add(key);
    return data;
  };
  const files = new Map();
  let track = vtoc[1], number = vtoc[2];
  while (track !== 0) {
    const catalog = claim(track, number);
    for (let offset = 11; offset < 256; offset += 35) {
      if (catalog[offset] === 0 || catalog[offset] === 255) continue;
      const filename = Array.from(catalog.subarray(offset + 3, offset + 33),
        byte => String.fromCharCode(byte & 127)).join("").trimEnd();
      if (!filename || files.has(filename)) throw new Error(`Invalid or duplicate DOS filename: ${filename}`);
      let listTrack = catalog[offset], listSector = catalog[offset + 1], listCount = 0;
      const sectors = [], chunks = [];
      while (listTrack !== 0) {
        const list = claim(listTrack, listSector);
        if (list.readUInt16LE(5) !== sectors.length)
          throw new Error(`Non-contiguous DOS sector list for ${filename}`);
        let ended = false;
        for (let entry = 12; entry < 256; entry += 2) {
          if (list[entry] === 0) {
            if (list[entry + 1] !== 0) throw new Error(`Invalid empty DOS sector in ${filename}`);
            ended = true;
            continue;
          }
          if (ended) throw new Error(`Sparse DOS file is unsupported: ${filename}`);
          sectors.push({ track: list[entry], sector: list[entry + 1] });
          chunks.push(claim(list[entry], list[entry + 1]));
        }
        listCount++;
        listTrack = list[1];
        listSector = list[2];
      }
      if (sectors.length + listCount !== catalog.readUInt16LE(offset + 33))
        throw new Error(`DOS sector count mismatch for ${filename}`);
      files.set(filename, { type: catalog[offset + 2] & 127, sectors, bytes: Buffer.concat(chunks) });
    }
    track = catalog[1];
    number = catalog[2];
  }
  if (files.size === 0) throw new Error("DOS catalog contains no files");
  return files;
}

const assets = [
  ["TITLE", "P", 0x2000, 0x2000, 0x2000],
  ["MUSIC", "MUSIC", 0x8500, 0x02ed, 0x8500],
  ["MINUET", "MINUET", 0x4000, 0x0900, 0x4000],
  ["UNPACK", "RP", 0x1f70, 0x0090, 0x1f70],
  ["SOUND", "SO", 0x0800, 0x022d, 0x1300],
  ["ANIMATION", "P.ANM", 0x6cc8, 0x2938, 0x6cc8],
  ["PICTURE_1", "P1.PAK", 0x6000, 0x1079, 0x6000],
  ["PICTURE_2", "P2.PAK", 0x6000, 0x0b39, 0x6000],
  ["PICTURE_3", "P3.PAK", 0x6000, 0x13bf, 0x6000],
  ["ENGINE_1", "P.OB1", 0x0800, 0x0b77, 0x6000],
  ["ENGINE_2", "P.OB2", 0x0800, 0x0c14, 0x6000],
  ["ENGINE_3", "P.OB3", 0x0800, 0x0bcb, 0x6000],
];

export function buildPayload(files) {
  const constants = [], descriptors = [];
  for (const [index, [id, name, origin, length, destination]] of assets.entries()) {
    const file = files.get(name);
    if (!file || file.type !== 4 || file.bytes.length < 4 ||
        file.bytes.readUInt16LE(0) !== origin || file.bytes.readUInt16LE(2) !== length ||
        length + 4 > file.bytes.length || file.sectors.length !== Math.ceil((length + 4) / 256))
      throw new Error(`Unexpected DOS binary header/length for ${name}`);
    if (file.sectors.some(position => position.track === 0))
      throw new Error(`Game file overlaps replacement boot track: ${name}`);
    constants.push(`FILE_${id} = ${index}`);
    const coordinates = file.sectors.flatMap(position => [position.track, physical(position.sector)]);
    if (coordinates.length + 4 > 255) throw new Error(`File descriptor too large: ${name}`);
    descriptors.push(`file_${index}:\n .word ${hex(destination)},${hex(length)}\n .byte ${coordinates.map(hex).join(",")}`);
  }
  const source = fs.readFileSync(path.join(root, "codegen", "patches", "popeye-3ric.s"), "utf8");
  const payload = assemble(constants.join("\n") + "\n" + source +
    "\nfile_table:\n .word " + assets.map((_, index) => `file_${index}`).join(",") +
    "\n" + descriptors.join("\n"));
  const pages = Math.ceil(payload.bytes.length / 256);
  if (payload.org !== 0xa000 || pages > 15)
    throw new Error("Popeye supervisor exceeds its 15-sector boot-track reservation");
  const boot = assemble(`
        .org $0800
        .byte 1
        jmp install
install:
        sei
        cld
        bit $C007
        lda #<${hex(payload.symbols.START)}
        sta $0802
        lda #>${hex(payload.symbols.START)}
        sta $0803
        lda #${pages + 1}
        sta $0800
        lda #1
        sta $3D
        stz $26
        stz $41
        lda #$A0
        sta $27
        ldx $2B
        jmp $C65C
`);
  if (boot.bytes.length > 256) throw new Error("Popeye bootstrap exceeds one sector");
  return { ...payload, boot: boot.bytes, pages };
}

export function patchPopeye(input, rom) {
  if (sha256(input) !== INPUT_SHA256)
    throw new Error(`Unsupported Popeye disk; expected SHA-256 ${INPUT_SHA256}`);
  if (sha256(rom) !== ROM_SHA256)
    throw new Error(`Unsupported 3ric ROM; expected SHA-256 ${ROM_SHA256}`);
  const files = readDosFiles(input);
  const payload = buildPayload(files), s = payload.symbols;
  const disk = Buffer.from(input), patches = [];
  const edit = (name, address, before, after, origin) => {
    const file = files.get(name);
    const offset = address - origin + 4;
    const expected = Buffer.from(before), replacement = Buffer.from(after);
    if (offset < 4 || offset + expected.length > file.bytes.readUInt16LE(2) + 4 ||
        expected.length !== replacement.length || !file.bytes.subarray(offset, offset + expected.length).equals(expected))
      throw new Error(`Unexpected ${name} bytes at ${hex(address)}`);
    for (let i = 0; i < replacement.length; i++) {
      const position = file.sectors[(offset + i) >> 8];
      disk[(position.track * 16 + position.sector) * 256 + ((offset + i) & 255)] = replacement[i];
    }
    patches.push({ file: name, address, before: expected.toString("hex"), after: replacement.toString("hex") });
  };
  const instruction = (opcode, address) => [opcode, address & 255, address >> 8];
  const profiles = [
    ["P.OB1", 0x619a, 0x636d, [0x6356, 0x6704, 0x6754, 0x6801, 0x681a, 0x6833, 0x684c, 0x6a55, 0x6a79, 0x6ada, 0x6afe]],
    ["P.OB2", 0x621b, 0x63ec, [0x63d5, 0x679a, 0x67ea, 0x6897, 0x68b0, 0x68c9, 0x68e2, 0x6af0, 0x6b14, 0x6b75, 0x6b99]],
    ["P.OB3", 0x6168, 0x6326, [0x630f, 0x6741, 0x6794, 0x6850, 0x6869, 0x6882, 0x689b, 0x6aa9, 0x6acd, 0x6b2e, 0x6b52]],
  ];
  for (const [name, fire, axes, random] of profiles) {
    edit(name, fire, [0xad, 0x61, 0xc0], instruction(0x20, s.READ_FIRE), 0x6000);
    edit(name, axes, [0xa2, 0, 0x8e], instruction(0x4c, s.READ_AXES), 0x6000);
    for (const address of random)
      edit(name, address, [0x20, 0xae, 0xef], instruction(0x20, s.RANDOM_BYTE), 0x6000);
  }
  // Poll the original music driver's real VIA timer without an Apple IRQ stack.
  edit("MUSIC", 0x8675, [0x40], [0x60], 0x8500);
  edit("MUSIC", 0x879e, [0x58], [0x78], 0x8500);
  disk.fill(0, 0, 4096);
  disk.set(payload.boot, 0);
  for (let page = 0; page < payload.pages; page++)
    disk.set(payload.bytes.subarray(page * 256, (page + 1) * 256), logical(page + 1) * 256);
  return { woz: Buffer.from(buildWozFromDsk(disk)), disk, payload, patches };
}

export function writePopeye(inputPath, outputPath) {
  const input = fs.readFileSync(inputPath);
  const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
  const result = patchPopeye(input, rom);
  fs.writeFileSync(outputPath, result.woz, { flag: "wx" });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: node patch-popeye.mjs <original.do> <new.woz>");
    const result = writePopeye(process.argv[2], process.argv[3]);
    console.log(`Created ${process.argv[3]} (${result.woz.length} bytes)`);
    console.log(`SHA-256 ${sha256(result.woz)}`);
    console.log("Insert the WOZ, enter MON if needed, then C600G. Press a key or Start.");
    console.log("WASD/arrows move (X stops), Space punches; SNES D-pad + B/A/X; Q/Esc exits.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
