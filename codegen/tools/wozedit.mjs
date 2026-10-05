// Node-only sector editing; retain a supplied disk's surrounding bitstream.
import { createHash } from "node:crypto";
import { crc32, decode6and2, encode6and2 } from "./wozgen.mjs";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function chunksIn(woz) {
  if (woz.length < 12 || !woz.subarray(0, 8).equals(Buffer.from("574f5a32ff0a0d0a", "hex")))
    throw new Error("Expected a WOZ2 image");
  if (woz.readUInt32LE(8) !== crc32(woz, 12, woz.length))
    throw new Error("WOZ CRC mismatch");
  const chunks = new Map();
  for (let at = 12; at < woz.length;) {
    if (at + 8 > woz.length) throw new Error("Truncated WOZ chunk header");
    const id = woz.toString("ascii", at, at + 4);
    const size = woz.readUInt32LE(at + 4);
    if (size > woz.length - at - 8) throw new Error(`Truncated ${id} chunk`);
    if (chunks.has(id)) throw new Error(`Duplicate ${id} chunk`);
    chunks.set(id, { start: at + 8, size });
    at += 8 + size;
  }
  const info = chunks.get("INFO");
  if (!info || info.size < 60 || woz[info.start] !== 2 || woz[info.start + 1] !== 1)
    throw new Error("Expected 5.25-inch WOZ2 INFO version 2");
  if (chunks.get("TMAP")?.size !== 160 || (chunks.get("TRKS")?.size ?? 0) < 1280)
    throw new Error("Missing or invalid TMAP/TRKS");
  return chunks;
}

function validSector(track, sector) {
  return Number.isInteger(track) && track >= 0 && track <= 39
    && Number.isInteger(sector) && sector >= 0 && sector <= 15;
}

function readSector(woz, chunks, track, sector) {
  const index = woz[chunks.get("TMAP").start + track * 4];
  if (index >= 160) throw new Error(`Unmapped track ${track}`);
  const trks = chunks.get("TRKS");
  const descriptor = trks.start + index * 8;
  const start = woz.readUInt16LE(descriptor) * 512;
  const size = woz.readUInt16LE(descriptor + 2) * 512;
  const bits = woz.readUInt32LE(descriptor + 4);
  if (start < trks.start + 1280 || start + size > trks.start + trks.size
      || bits === 0 || bits > size * 8)
    throw new Error(`Invalid track ${track} bounds`);
  const bit = pos => (woz[start + ((pos % bits) >> 3)] >> (7 - (pos % bits & 7))) & 1;
  const byte = pos => {
    let value = 0;
    for (let i = 0; i < 8; i++) value = (value << 1) | bit(pos + i);
    return value;
  };
  const marker = (pos, last) => byte(pos) === 0xd5 && byte(pos + 8) === 0xaa && byte(pos + 16) === last;
  let found;
  let window = 0;
  for (let p = 0; p < bits + 23; p++) {
    window = ((window << 1) | bit(p)) & 0xffffff;
    if (p < 23 || window !== 0xd5aa96) continue;
    const address = [];
    for (let i = 0; i < 4; i++) {
      const a = byte(p + 1 + i * 16), b = byte(p + 9 + i * 16);
      if ((a & 0xaa) !== 0xaa || (b & 0xaa) !== 0xaa)
        throw new Error("Invalid 4-and-4 address field");
      address.push(((a << 1) | 1) & b);
    }
    const [volume, addressTrack, addressSector, checksum] = address;
    if ((volume ^ addressTrack ^ addressSector) !== checksum)
      throw new Error("Sector address checksum mismatch");
    if (addressTrack !== track || addressSector !== sector) continue;
    if (found) throw new Error(`Duplicate sector ${track}/${sector}`);
    if (byte(p + 65) !== 0xde || byte(p + 73) !== 0xaa || byte(p + 81) !== 0xeb)
      throw new Error("Invalid address epilogue");
    let dataBit = -1;
    for (let q = p + 89; q < p + 89 + 1024; q++) {
      if (marker(q, 0x96)) break;
      if (marker(q, 0xad)) { dataBit = q + 24; break; }
    }
    if (dataBit < 0) throw new Error(`Missing data field ${track}/${sector}`);
    const encoded = Uint8Array.from({ length: 343 }, (_, i) => byte(dataBit + i * 8));
    const end = dataBit + encoded.length * 8;
    if (byte(end) !== 0xde || byte(end + 8) !== 0xaa || byte(end + 16) !== 0xeb)
      throw new Error("Invalid data epilogue");
    const data = decode6and2(encoded);
    const canonical = new Uint8Array(343);
    encode6and2(canonical, data, 0);
    if (!canonical.every((value, i) => value === encoded[i]))
      throw new Error("Unsupported noncanonical sector encoding");
    found = { start, bits, dataBit, data, edited: new Set() };
  }
  if (!found) throw new Error(`Missing sector ${track}/${sector}`);
  return found;
}

export function readWozSectors(input, coordinates) {
  const original = Buffer.from(input);
  const chunks = chunksIn(original);
  return coordinates.map(({ track, sector }) => {
    if (!validSector(track, sector)) throw new Error("Invalid sector address");
    return { track, sector, data: Buffer.from(readSector(original, chunks, track, sector).data) };
  });
}

export function patchWozSectors(input, patches) {
  const original = Buffer.from(input);
  const chunks = chunksIn(original);
  const sectors = new Map();
  for (const patch of patches) {
    const { track, sector, offset, before, after } = patch;
    if (!validSector(track, sector) || !Number.isInteger(offset) || offset < 0
        || !/^(?:[0-9a-f]{2})+$/i.test(before) || !/^(?:[0-9a-f]{2})+$/i.test(after)
        || before.length !== after.length || offset + before.length / 2 > 256)
      throw new Error("Invalid sector patch");
    const key = `${track}/${sector}`;
    if (!sectors.has(key)) sectors.set(key, readSector(original, chunks, track, sector));
    const field = sectors.get(key);
    const expected = Buffer.from(before, "hex");
    if (!Buffer.from(field.data.subarray(offset, offset + expected.length)).equals(expected))
      throw new Error(`Unexpected bytes at sector ${key} +${offset.toString(16)}`);
    for (let i = offset; i < offset + expected.length; i++) {
      if (field.edited.has(i)) throw new Error(`Overlapping patches at sector ${key}`);
      field.edited.add(i);
    }
    field.data.set(Buffer.from(after, "hex"), offset);
  }
  const output = Buffer.from(original);
  for (const field of sectors.values()) {
    const encoded = new Uint8Array(343);
    encode6and2(encoded, field.data, 0);
    for (let i = 0; i < encoded.length * 8; i++) {
      const pos = (field.dataBit + i) % field.bits;
      const address = field.start + (pos >> 3);
      const mask = 0x80 >> (pos & 7);
      output[address] = (output[address] & ~mask)
        | ((encoded[i >> 3] & (0x80 >> (i & 7))) ? mask : 0);
    }
  }
  output.writeUInt32LE(crc32(output, 12, output.length), 8);
  return output;
}
