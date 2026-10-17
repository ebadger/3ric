// Apple Pascal 1.1 volume reader for 5.25" images (DOS 3.3 or ProDOS order).
//
// A Pascal volume is 280 512-byte blocks; block n is DOS-order sectors
// SKEW[2*(n%8)] and SKEW[2*(n%8)+1] of track n/8. The directory occupies
// blocks 2-5: a 26-byte volume header, then 26-byte entries sorted by
// first block. Code files start with a segment dictionary block.

export const BLOCK = 512;
export const VOLUME_BLOCKS = 280;
const IMAGE_BYTES = VOLUME_BLOCKS * BLOCK;
const DOS_SECTOR = [0, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 15];

function toBlocks(image, order) {
  if (order === "po") return image.slice(0, IMAGE_BYTES);
  const out = new Uint8Array(IMAGE_BYTES);
  for (let b = 0; b < VOLUME_BLOCKS; b++) {
    const track = (b >> 3) * 4096;
    const i = b & 7;
    out.set(image.subarray(track + DOS_SECTOR[2 * i] * 256, track + DOS_SECTOR[2 * i] * 256 + 256), b * BLOCK);
    out.set(image.subarray(track + DOS_SECTOR[2 * i + 1] * 256, track + DOS_SECTOR[2 * i + 1] * 256 + 256), b * BLOCK + 256);
  }
  return out;
}

/** Parse the directory of a block-ordered volume, or return null if it is not Pascal. */
export function readDirectory(blocks) {
  const d = blocks.subarray(2 * BLOCK, 6 * BLOCK);
  const word = (o) => d[o] | (d[o + 1] << 8);
  const nameLen = d[6];
  if (word(0) !== 0 || word(2) !== 6 || word(4) !== 0 || nameLen < 1 || nameLen > 7) return null;
  const volume = String.fromCharCode(...d.subarray(7, 7 + nameLen));
  if (!/^[\x21-\x7e]+$/.test(volume)) return null;
  const eovblk = word(14), count = word(16);
  if (count > 77 || eovblk < 6 || eovblk * BLOCK > blocks.length) return null;
  const files = [];
  let prev = 6;
  for (let i = 1; i <= count; i++) {
    const o = i * 26;
    const len = d[o + 6];
    const first = word(o), next = word(o + 2);
    if (len < 1 || len > 15 || first < prev || next <= first || next > eovblk) return null;
    files.push({
      name: String.fromCharCode(...d.subarray(o + 7, o + 7 + len)),
      first, next, kind: word(o + 4) & 15, lastBytes: word(o + 22),
      entry: d.slice(o, o + 26),
    });
    prev = next;
  }
  return { volume, eovblk, header: d.slice(0, 26), files };
}

/** Read a 143,360-byte image in either sector order. */
export function readPascalImage(image) {
  if (image.length !== IMAGE_BYTES) throw new Error(`not a 140 KB 5.25" image (${image.length} bytes)`);
  for (const order of ["do", "po"]) {
    const blocks = toBlocks(image, order);
    const dir = readDirectory(blocks);
    if (dir) return { order, blocks, ...dir };
  }
  throw new Error("no Apple Pascal directory in either sector order");
}

/** Segment dictionary of the code file starting at block `first`. */
export function codeSegments(blocks, first) {
  const s = blocks.subarray(first * BLOCK, first * BLOCK + BLOCK);
  const segs = [];
  for (let i = 0; i < 16; i++) {
    const rel = s[i * 4] | (s[i * 4 + 1] << 8), length = s[i * 4 + 2] | (s[i * 4 + 3] << 8);
    if (!length) continue;
    segs.push({ name: String.fromCharCode(...s.subarray(64 + i * 8, 72 + i * 8)).trim(), block: first + rel, length });
  }
  return segs;
}
