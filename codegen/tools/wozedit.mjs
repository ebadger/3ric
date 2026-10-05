// Node-only sector editing; retain a supplied disk's surrounding bitstream.
import { createHash } from "node:crypto";
import { crc32, decode6and2, encode6and2 } from "./wozgen.mjs";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const GCR5 = [
  0xab, 0xad, 0xae, 0xaf, 0xb5, 0xb6, 0xb7, 0xba,
  0xbb, 0xbd, 0xbe, 0xbf, 0xd6, 0xd7, 0xda, 0xdb,
  0xdd, 0xde, 0xdf, 0xea, 0xeb, 0xed, 0xee, 0xef,
  0xf5, 0xf6, 0xf7, 0xfa, 0xfb, 0xfd, 0xfe, 0xff,
];

export function encode5and3(data) {
  if (data.length !== 256) throw new Error("A 5-and-3 sector must contain 256 bytes");
  const low = new Uint8Array(154), high = new Uint8Array(256);
  for (let group = 0; group < 51; group++) {
    const x = 50 - group, at = group * 5;
    for (let k = 0; k < 5; k++) high[x + k * 51] = data[at + k] >> 3;
    for (let k = 0; k < 3; k++)
      low[x + k * 51] = ((data[at + k] & 7) << 2)
        | (((data[at + 3] >> (2 - k)) & 1) << 1) | ((data[at + 4] >> (2 - k)) & 1);
  }
  high[255] = data[255] >> 3;
  low[153] = data[255] & 7;
  const encoded = new Uint8Array(411);
  let previous = 0;
  for (let i = 0; i < 410; i++) {
    const value = i < 154 ? low[153 - i] : high[i - 154];
    encoded[i] = GCR5[previous ^ value];
    previous = value;
  }
  encoded[410] = GCR5[previous];
  return encoded;
}

export function decode5and3(encoded) {
  if (encoded.length !== 411) throw new Error("A 5-and-3 field must contain 411 nibbles");
  const low = new Uint8Array(154), high = new Uint8Array(256);
  let previous = 0;
  for (let i = 0; i < encoded.length; i++) {
    const value = GCR5.indexOf(encoded[i]);
    if (value < 0) throw new Error(`Invalid 5-and-3 nibble at ${i}`);
    previous ^= value;
    if (i < 154) low[153 - i] = previous;
    else if (i < 410) high[i - 154] = previous;
  }
  if (previous !== 0) throw new Error("5-and-3 checksum mismatch");
  if (low[153] > 7) throw new Error("Noncanonical 5-and-3 last-byte padding");
  const data = new Uint8Array(256);
  for (let group = 0; group < 51; group++) {
    const x = 50 - group, at = group * 5;
    for (let k = 0; k < 3; k++) data[at + k] = (high[x + k * 51] << 3) | (low[x + k * 51] >> 2);
    data[at + 3] = (high[x + 153] << 3) | ((low[x] & 2) << 1)
      | (low[x + 51] & 2) | ((low[x + 102] >> 1) & 1);
    data[at + 4] = (high[x + 204] << 3) | ((low[x] & 1) << 2)
      | ((low[x + 51] & 1) << 1) | (low[x + 102] & 1);
  }
  data[255] = (high[255] << 3) | low[153];
  return data;
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

function validSector(track, sector, encoding) {
  if (encoding !== "6and2" && encoding !== "5and3") return false;
  return Number.isInteger(track) && track >= 0 && track <= 39
    && Number.isInteger(sector) && sector >= 0 && sector <= (encoding === "5and3" ? 255 : 15);
}

function readSector(woz, chunks, track, sector, encoding) {
  const five = encoding === "5and3";
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
  const nibble = pos => {
    let gap = 0;
    while (!bit(pos) && gap < 16) { pos++; gap++; }
    if (gap === 16) throw new Error("Invalid self-synchronizing nibble gap");
    return { value: byte(pos), pos, next: pos + 8 };
  };
  const marker = (pos, last) => byte(pos) === 0xd5 && byte(pos + 8) === 0xaa && byte(pos + 16) === last;
  let found;
  let window = 0;
  const headers = [];
  if (five) {
    for (let pos = 0; pos < bits + 24;) {
      if (!bit(pos)) { pos++; continue; }
      window = ((window << 8) | byte(pos)) & 0xffffff;
      pos += 8;
      if (window === 0xd5aab5 && pos - 1 < bits + 23) headers.push(pos - 1);
    }
  } else {
    for (let p = 0; p < bits + 23; p++) {
      window = ((window << 1) | bit(p)) & 0xffffff;
      if (p >= 23 && window === 0xd5aa96) headers.push(p);
    }
  }
  for (const p of headers) {
    const address = [];
    let cursor = p + 1;
    for (let i = 0; i < 4; i++) {
      let a, b;
      if (five) {
        const first = nibble(cursor), second = nibble(first.next);
        a = first.value; b = second.value; cursor = second.next;
      } else {
        a = byte(p + 1 + i * 16); b = byte(p + 9 + i * 16);
      }
      if ((a & 0xaa) !== 0xaa || (b & 0xaa) !== 0xaa)
        throw new Error("Invalid 4-and-4 address field");
      address.push(((a << 1) | 1) & b);
    }
    const [volume, addressTrack, addressSector, checksum] = address;
    if ((volume ^ addressTrack ^ addressSector) !== checksum)
      throw new Error("Sector address checksum mismatch");
    if (addressTrack !== track || addressSector !== sector) continue;
    if (found) throw new Error(`Duplicate sector ${track}/${sector}`);
    let addressEnd = p + 89;
    if (five) {
      const first = nibble(cursor), second = nibble(first.next);
      if (first.value !== 0xde || second.value !== 0xaa) throw new Error("Invalid address epilogue");
      addressEnd = second.next;
    } else if (byte(p + 65) !== 0xde || byte(p + 73) !== 0xaa || byte(p + 81) !== 0xeb) {
      throw new Error("Invalid address epilogue");
    }
    let dataBit = -1;
    for (let q = addressEnd; q < addressEnd + 1024; q++) {
      if (marker(q, 0x96) || (five && marker(q, 0xb5))) break;
      if (marker(q, 0xad)) { dataBit = q + 24; break; }
    }
    if (dataBit < 0) throw new Error(`Missing data field ${track}/${sector}`);
    cursor = dataBit;
    const positions = [];
    const encoded = Uint8Array.from({ length: five ? 411 : 343 }, (_, i) => {
      if (!five) { positions.push(dataBit + i * 8); return byte(dataBit + i * 8); }
      const current = nibble(cursor);
      positions.push(current.pos);
      cursor = current.next;
      return current.value;
    });
    if (five) {
      const first = nibble(cursor), second = nibble(first.next);
      if (first.value !== 0xde || second.value !== 0xaa) throw new Error("Invalid data epilogue");
    } else {
      const end = dataBit + encoded.length * 8;
      if (byte(end) !== 0xde || byte(end + 8) !== 0xaa || byte(end + 16) !== 0xeb)
        throw new Error("Invalid data epilogue");
    }
    const data = five ? decode5and3(encoded) : decode6and2(encoded);
    const canonical = five ? encode5and3(data) : new Uint8Array(343);
    if (!five) encode6and2(canonical, data, 0);
    if (!canonical.every((value, i) => value === encoded[i]))
      throw new Error("Unsupported noncanonical sector encoding");
    found = { start, bits, positions, data, encoding, edited: new Set() };
  }
  if (!found) throw new Error(`Missing sector ${track}/${sector}`);
  return found;
}

export function readWozSectors(input, coordinates) {
  const original = Buffer.from(input);
  const chunks = chunksIn(original);
  return coordinates.map(({ track, sector, encoding = "6and2" }) => {
    if (!validSector(track, sector, encoding)) throw new Error("Invalid sector address or encoding");
    return { track, sector, data: Buffer.from(readSector(original, chunks, track, sector, encoding).data) };
  });
}

export function patchWozSectors(input, patches) {
  const original = Buffer.from(input);
  const chunks = chunksIn(original);
  const sectors = new Map();
  for (const patch of patches) {
    const { track, sector, offset, before, after, encoding = "6and2" } = patch;
    if (!validSector(track, sector, encoding) || !Number.isInteger(offset) || offset < 0
        || !/^(?:[0-9a-f]{2})+$/i.test(before) || !/^(?:[0-9a-f]{2})+$/i.test(after)
        || before.length !== after.length || offset + before.length / 2 > 256)
      throw new Error("Invalid sector patch");
    const key = `${encoding}/${track}/${sector}`;
    if (!sectors.has(key)) sectors.set(key, readSector(original, chunks, track, sector, encoding));
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
    const encoded = field.encoding === "5and3" ? encode5and3(field.data) : new Uint8Array(343);
    if (field.encoding === "6and2") encode6and2(encoded, field.data, 0);
    for (let i = 0; i < encoded.length * 8; i++) {
      const pos = (field.positions[i >> 3] + (i & 7)) % field.bits;
      const address = field.start + (pos >> 3);
      const mask = 0x80 >> (pos & 7);
      output[address] = (output[address] & ~mask)
        | ((encoded[i >> 3] & (0x80 >> (i & 7))) ? mask : 0);
    }
  }
  output.writeUInt32LE(crc32(output, 12, output.length), 8);
  return output;
}
