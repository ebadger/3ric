import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildWozFromDsk } from "./wozgen.mjs";
import { sha256 } from "./wozedit.mjs";

export const INPUT_SHA256 = "3b80cb92955436524ae99584f543e3ac641bf7fe4aa4fb040c48ce9a330ea33d";
export const ROM_SHA256 = "fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const prodosSectors = [0, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 15];
const hex = value => `$${value.toString(16)}`;
const instruction = (opcode, address) => Buffer.from([opcode, address & 255, address >> 8]);
const blockOffsets = block => [0, 1].map(part =>
  (block >> 3) * 4096 + prodosSectors[(block & 7) * 2 + part] * 256);

export function readBlock(disk, block) {
  if (disk.length !== 143360 || !Number.isInteger(block) || block < 0 || block >= 280)
    throw new Error("Invalid 140K ProDOS block");
  return Buffer.concat(blockOffsets(block).map(offset => disk.subarray(offset, offset + 256)));
}

function writeBlock(disk, block, bytes) {
  if (bytes.length !== 512) throw new Error("A ProDOS block must have 512 bytes");
  readBlock(disk, block);
  for (const [part, offset] of blockOffsets(block).entries())
    bytes.copy(disk, offset, part * 256, (part + 1) * 256);
}

export function readCatalog(disk) {
  const volume = readBlock(disk, 2);
  if (volume[4] >> 4 !== 15 || volume[0x23] !== 39 || volume[0x24] !== 13
      || volume.readUInt16LE(0x27) !== 6 || volume.readUInt16LE(0x29) !== 280)
    throw new Error("Unsupported ProDOS volume header");
  const bitmap = readBlock(disk, 6);
  const allocated = new Set([0, 1, 6]);
  const claim = block => {
    if (block < 2 || block >= 280 || allocated.has(block)
        || (bitmap[block >> 3] & (128 >> (block & 7))))
      throw new Error(`Invalid or overlapping allocated block ${block}`);
    allocated.add(block);
  };
  const files = new Map();
  let previous = 0;
  for (let directoryBlock = 2; directoryBlock;) {
    claim(directoryBlock);
    const directory = readBlock(disk, directoryBlock);
    if (directory.readUInt16LE(0) !== previous) throw new Error("Broken ProDOS directory chain");
    for (let offset = directoryBlock === 2 ? 43 : 4; offset + 39 <= 512; offset += 39) {
      const entry = directory.subarray(offset, offset + 39);
      if (!entry[0]) continue;
      if (entry[0] >> 4 !== 2) throw new Error("Expected a sapling file");
      const name = entry.subarray(1, 1 + (entry[0] & 15)).toString("ascii");
      if (!name || files.has(name)) throw new Error("Invalid or duplicate filename");
      const key = entry.readUInt16LE(17), size = entry.readUIntLE(21, 3);
      if (!size || size > 131072 || entry.readUInt16LE(19) !== Math.ceil(size / 512) + 1)
        throw new Error(`Invalid file size: ${name}`);
      claim(key);
      const index = readBlock(disk, key);
      const blocks = Array.from({ length: Math.ceil(size / 512) }, (_, i) => index[i] | index[i + 256] << 8);
      blocks.forEach(claim);
      files.set(name, { name, key, size, blocks, directoryBlock, offset,
        org: entry.readUInt16LE(31),
        data: Buffer.concat(blocks.map(block => readBlock(disk, block))).subarray(0, size) });
    }
    previous = directoryBlock;
    directoryBlock = directory.readUInt16LE(2);
  }
  if (files.size !== volume.readUInt16LE(0x25)) throw new Error("ProDOS file count mismatch");
  return files;
}

export function buildPayload(rom) {
  if (sha256(rom) !== ROM_SHA256)
    throw new Error(`Unsupported 3ric ROM; expected SHA-256 ${ROM_SHA256}`);
  const resident = assemble(fs.readFileSync(path.join(root, "codegen", "patches", "ultima-3ric.s"), "utf8"));
  if (resident.org !== 0xcc00 || resident.symbols.RESIDENT_END > 0xce00)
    throw new Error("Ultima adapter exceeds $CC00-$CDFF");
  const padded = Buffer.alloc(512);
  padded.set(resident.bytes);
  const installer = assemble(`
        .org $5A00
install:
        ldx #26
check_rom:
        lda $F1BB,x
        cmp expected_rom,x
        bne failed
        dex
        bpl check_rom
        ldx #0
copy:
        lda resident_bytes,x
        sta $CC00,x
        lda resident_bytes+256,x
        sta $CD00,x
        inx
        bne copy
        jsr ${hex(resident.symbols.IO_LOCK)}
        lda $43
        sta $21FE
        jmp $2005
failed:
        bit $C051
        bit $C054
        ldx #0
message:
        lda error_message,x
        beq halted
        sta $0400,x
        inx
        bne message
halted:
        jmp halted
error_message:
        .byte ${Array.from(Buffer.from("3RIC ROM MISMATCH - RESET"), b => hex(b | 128)).join(",")},0
expected_rom:
        .byte ${Array.from(rom.subarray(0xf1bb, 0xf1d6), hex).join(",")}
resident_bytes:
        .byte ${Array.from(padded, hex).join(",")}
`);
  return { resident, installer };
}

export function patchUltima(input, rom) {
  if (sha256(input) !== INPUT_SHA256)
    throw new Error(`Unsupported Ultima image; expected SHA-256 ${INPUT_SHA256}`);
  const files = readCatalog(input);
  const disk = Buffer.from(input);
  const payload = buildPayload(rom), s = payload.resident.symbols;
  const patches = [];
  const replace = (name, offset, before, after) => {
    const file = files.get(name);
    before = Buffer.isBuffer(before) ? before : Buffer.from(before);
    after = Buffer.isBuffer(after) ? after : Buffer.from(after);
    if (!file || offset < 0 || offset + before.length > file.size || before.length !== after.length
        || !file.data.subarray(offset, offset + before.length).equals(before))
      throw new Error(`Unexpected ${name} bytes at ${hex(offset)}`);
    patches.push({ file: name, offset, before: before.toString("hex"), after: after.toString("hex") });
    after.copy(file.data, offset);
  };
  const message = (name, before, after) => {
    const file = files.get(name);
    const offset = file.data.indexOf(before);
    if (offset < 0 || file.data.indexOf(before, offset + 1) !== -1 || after.length > before.length)
      throw new Error(`Unexpected message in ${name}: ${before}`);
    replace(name, offset, before, after.padEnd(before.length));
  };
  replace("PRODOS", 0, [0xa5, 0x43, 0x8d, 0xfe, 0x21],
    [...instruction(0x4c, payload.installer.org), 0xea, 0xea]);
  replace("PRODOS", 0x2e00, [0x4c, 0xb7, 0xbf], instruction(0x4c, s.MLI));
  replace("U1.SYSTEM", 0, [0x4c, 0x88, 0x20], instruction(0x4c, s.STARTUP));
  replace("GEN", 0x8a15 - 0x8956, [0x20, 0x21, 0xb7], instruction(0x20, s.LOAD_CHARACTER));
  replace("GEN", 0x8f23 - 0x8956, [0x20, 0x24, 0xb7], instruction(0x20, s.SAVE_CHARACTER));
  replace("OUT", 0x92d7 - 0x8956, [0x20, 0x24, 0xb7], instruction(0x20, s.SAVE_CHARACTER));
  replace("OUT", 0x92ef - 0x8956, [0x4c, 0x98, 0x15], instruction(0x4c, s.RETURN_MENU));
  message("GEN", "from darkest", "RAM ONLY");
  message("GEN", "dungeons, to", "RESET LOSES");
  message("GEN", "deepest space!", "YOUR PROGRESS!");
  message("GEN", "Please put in the Player disk.", "No RAM save. Create one first.");
  message("GEN", "Save this character?", "RAM save character?");
  message("MI.U1", "Quit- saving game..", "Quit- RAM save....");
  message("OUT", "saved.", "RAM OK");

  const prodos = files.get("PRODOS");
  if (prodos.size !== 0x3a00) throw new Error("Unexpected ProDOS staging size");
  prodos.data = Buffer.concat([prodos.data, Buffer.from(payload.installer.bytes)]);
  const newSize = prodos.data.length;
  const extraBlocks = Math.ceil(newSize / 512) - prodos.blocks.length;
  const bitmap = readBlock(disk, 6);
  const index = readBlock(disk, prodos.key);
  for (let i = 0; i < extraBlocks; i++) {
    const block = 259 + i;
    if (block >= 264 || !(bitmap[block >> 3] & (128 >> (block & 7)))
        || readBlock(input, block).some(byte => byte !== 0))
      throw new Error("Adapter allocation would overwrite existing disk data");
    const slot = prodos.blocks.length;
    index[slot] = block & 255;
    index[slot + 256] = block >> 8;
    bitmap[block >> 3] &= ~(128 >> (block & 7));
    prodos.blocks.push(block);
  }
  writeBlock(disk, 6, bitmap);
  writeBlock(disk, prodos.key, index);
  const directory = readBlock(disk, prodos.directoryBlock);
  directory.writeUInt16LE(prodos.blocks.length + 1, prodos.offset + 19);
  directory.writeUIntLE(newSize, prodos.offset + 21, 3);
  writeBlock(disk, prodos.directoryBlock, directory);
  for (const file of files.values()) {
    for (const [i, block] of file.blocks.entries()) {
      const bytes = readBlock(disk, block);
      file.data.copy(bytes, 0, i * 512, Math.min(file.data.length, (i + 1) * 512));
      writeBlock(disk, block, bytes);
    }
  }
  readCatalog(disk);
  return { disk, woz: Buffer.from(buildWozFromDsk(disk)), payload, patches };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: node patch-ultima.mjs input.dsk output-prefix");
    const inputPath = path.resolve(process.argv[2]), prefix = path.resolve(process.argv[3]);
    const outputs = [prefix + ".dsk", prefix + ".woz"];
    if (outputs.some(output => fs.existsSync(output))) throw new Error("Output already exists; refusing overwrite");
    const result = patchUltima(fs.readFileSync(inputPath),
      fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin")));
    fs.writeFileSync(outputs[0], result.disk, { flag: "wx" });
    try {
      fs.writeFileSync(outputs[1], result.woz, { flag: "wx" });
    } catch (error) {
      fs.unlinkSync(outputs[0]);
      throw error;
    }
    console.log(JSON.stringify({ dsk: outputs[0], woz: outputs[1],
      dskSha256: sha256(result.disk), wozSha256: sha256(result.woz),
      saves: "RAM ONLY: reset or power-off loses progress" }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
