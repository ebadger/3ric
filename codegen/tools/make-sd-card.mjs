// Build the micro-SD card the 3RIC emulators ship with: emulator/Data/sd.zip.
//
//   node codegen/tools/make-sd-card.mjs <DIRTBIKE.dsk> [out.zip]
//
// The card holds one folder, DIRTBIKE: Dirt Bike by Arnaud Verhille
// (habib256), free software under the GNU GPL v3, as port-dirtbike.mjs
// converts it for 3RIC, plus the notices in emulator/Data/sd-card/DIRTBIKE/
// (README.TXT, LICENSE.TXT). <DIRTBIKE.dsk> must be dist/DIRTBIKE.dsk from
// https://github.com/habib256/pom2games at commit 8140d9ffca77 (DSK_SHA256);
// the card is then the one in the repository, byte for byte (IMAGE_SHA256).
// The image is a 64 MB FAT32 card (ultima5/fat32.mjs), stored in the zip as
// sd.001: web/build.ps1 turns it into web/data/sd.v2.sparse, and the WinUI
// host unpacks it. See emulator/Data/sd-card/README.md.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { convert } from "./port-dirtbike.mjs";
import { buildFat32Image } from "./ultima5/fat32.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CARD_ZIP = path.join(root, "emulator", "Data", "sd.zip");
export const NOTICE_DIR = path.join(root, "emulator", "Data", "sd-card", "DIRTBIKE");
export const NOTICES = ["README.TXT", "LICENSE.TXT"];
export const IMAGE_NAME = "sd.001";
export const CARD_SECTORS = 131072;                 // 64 MB
export const CARD_LABEL = "3RIC";
// dist/DIRTBIKE.dsk at habib256/pom2games commit 8140d9ffca77 (git blob d8e050b3).
export const DSK_SHA256 = "ea40bda3dd58a31674af742736fd900dcbfd264ad4ef04eab09b6d59e247096e";
// The card image (sd.001) built from it: update when the card changes.
export const IMAGE_SHA256 = "4fa16d2ea32126227e8e3588ea2b39243a5467c08b610c0ed8fc271161d80f85";

export const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** The card's tree: { DIRTBIKE: { name: bytes } }. The program and the
 *  notices come last, so they stay on screen after a DIR. */
export function cardTree(dsk) {
  if (sha256(dsk) !== DSK_SHA256) throw new Error("not the DIRTBIKE.dsk this card is built from (SHA-256 differs)");
  const { tree, notes } = convert(dsk);
  if (notes.length) throw new Error("unexpected converter notes: " + notes.join("; "));
  const { "DIRTBIKE.PRG": prg, ...files } = tree;
  const folder = { ...files, "DIRTBIKE.PRG": prg };
  for (const name of NOTICES) folder[name] = new Uint8Array(fs.readFileSync(path.join(NOTICE_DIR, name)));
  return { DIRTBIKE: folder };
}

export const buildCardImage = (tree) => buildFat32Image(tree, { totalSectors: CARD_SECTORS, label: CARD_LABEL });

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
export function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

// One deflated entry with a fixed date (2026-10-22): the same bytes for the
// same image and zlib.
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 22;
export function zipImage(image, name = IMAGE_NAME) {
  const data = zlib.deflateRawSync(image, { level: 9 });
  const nameBytes = Buffer.from(name, "ascii"), crc = crc32(image);
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(image.length, 22); local.writeUInt16LE(nameBytes.length, 26);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(image.length, 24); central.writeUInt16LE(nameBytes.length, 28);
  const centralAt = local.length + nameBytes.length + data.length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12); end.writeUInt32LE(centralAt, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
}

/** One entry of a zip archive (stored or deflated), size- and CRC-checked. */
export function unzipEntry(zip, name = IMAGE_NAME) {
  const z = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip archive");
  let p = z.readUInt32LE(eocd + 16);
  for (let i = 0; i < z.readUInt16LE(eocd + 10); i++) {
    if (z.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = z.readUInt16LE(p + 10), crc = z.readUInt32LE(p + 16), csize = z.readUInt32LE(p + 20);
    const size = z.readUInt32LE(p + 24), nlen = z.readUInt16LE(p + 28), at = z.readUInt32LE(p + 42);
    if (z.toString("latin1", p + 46, p + 46 + nlen) === name) {
      const start = at + 30 + z.readUInt16LE(at + 26) + z.readUInt16LE(at + 28);
      const raw = z.subarray(start, start + csize);
      if (method !== 0 && method !== 8) throw new Error(`${name}: zip method ${method} is not supported`);
      const out = method === 8 ? zlib.inflateRawSync(raw) : raw;
      if (out.length !== size || crc32(out) !== crc) throw new Error(`${name}: bad size or CRC`);
      return new Uint8Array(out.buffer, out.byteOffset, out.length);
    }
    p += 46 + nlen + z.readUInt16LE(p + 30) + z.readUInt16LE(p + 32);
  }
  throw new Error(`${name} is not in the zip`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [dskPath, out = CARD_ZIP] = process.argv.slice(2);
  if (!dskPath) {
    console.error("usage: node codegen/tools/make-sd-card.mjs <DIRTBIKE.dsk> [out.zip]");
    process.exit(2);
  }
  const tree = cardTree(new Uint8Array(fs.readFileSync(dskPath)));
  const image = buildCardImage(tree);
  fs.writeFileSync(out, zipImage(image));
  const hash = sha256(image);
  console.log(`wrote ${out}: ${IMAGE_NAME}, ${image.length} bytes, SHA-256 ${hash}; DIRTBIKE/ holds ${Object.keys(tree.DIRTBIKE).length} files`);
  if (hash !== IMAGE_SHA256) console.log("the card changed: set IMAGE_SHA256 in make-sd-card.mjs and emulator/Data/sd-card/README.md");
}
