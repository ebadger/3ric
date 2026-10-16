// Minimal read-only ProDOS reader for 140 KB 5.25" images (.dsk/.do/.po).
//
// Ultima V ships on eight ProDOS volumes. Each volume holds ordinary files
// plus a run of blocks that no file owns (overworld, towne, talk and dungeon
// data the game reads by block number). This module returns both.

const BLOCKS = 280;
const IMAGE_SIZE = BLOCKS * 512;
// DOS-order sector pair holding ProDOS block half (block % 8).
const DOS_FIRST = [0, 13, 11, 9, 7, 5, 3, 1];
const DOS_SECOND = [14, 12, 10, 8, 6, 4, 2, 15];

function blockReader(image, order) {
  return (block) => {
    if (block < 0 || block >= BLOCKS) throw new Error(`ProDOS block ${block} out of range`);
    if (order === "po") return image.subarray(block * 512, block * 512 + 512);
    const track = block >> 3, half = block & 7, out = new Uint8Array(512);
    out.set(image.subarray(track * 4096 + DOS_FIRST[half] * 256, track * 4096 + DOS_FIRST[half] * 256 + 256), 0);
    out.set(image.subarray(track * 4096 + DOS_SECOND[half] * 256, track * 4096 + DOS_SECOND[half] * 256 + 256), 256);
    return out;
  };
}

const word = (b, o) => b[o] | (b[o + 1] << 8);

function volumeHeader(read) {
  const b = read(2);
  if (word(b, 0) !== 0 || (b[4] >> 4) !== 0xf) return null;
  const nameLength = b[4] & 15;
  if (nameLength === 0 || b[0x23] !== 0x27 || b[0x24] !== 0x0d) return null;
  return { name: String.fromCharCode(...b.subarray(5, 5 + nameLength)), bitmap: word(b, 0x27) };
}

/** Parse a 143,360-byte ProDOS image in DOS or ProDOS sector order. */
export function readProdosImage(image) {
  if (image.length !== IMAGE_SIZE) throw new Error(`expected a ${IMAGE_SIZE}-byte 5.25" image, got ${image.length}`);
  let read = null, header = null, order = null;
  for (const candidate of ["do", "po"]) {
    const r = blockReader(image, candidate);
    const h = volumeHeader(r);
    if (h) { read = r; header = h; order = candidate; break; }
  }
  if (!header) throw new Error("not a ProDOS volume");

  const owned = new Set([0, 1, header.bitmap]);
  const files = [];
  for (let dirBlock = 2, first = true; dirBlock; first = false) {
    if (owned.has(dirBlock) && !first) throw new Error(`${header.name}: directory chain revisits block ${dirBlock}`);
    owned.add(dirBlock);
    const b = read(dirBlock);
    for (let i = first ? 1 : 0; i < 13; i++) {
      const e = b.subarray(4 + i * 39, 4 + i * 39 + 39);
      const storage = e[0] >> 4;
      if (storage === 0) continue;
      const name = String.fromCharCode(...e.subarray(1, 1 + (e[0] & 15)));
      const key = word(e, 0x11);
      const eof = e[0x15] | (e[0x16] << 8) | (e[0x17] << 16);
      const data = new Uint8Array(eof);
      owned.add(key);
      if (storage === 1) {
        data.set(read(key).subarray(0, eof));
      } else if (storage === 2) {
        const index = read(key);
        for (let n = 0; n * 512 < eof; n++) {
          const ptr = index[n] | (index[256 + n] << 8);
          if (ptr) { owned.add(ptr); data.set(read(ptr).subarray(0, Math.min(512, eof - n * 512)), n * 512); }
        }
      } else {
        throw new Error(`${header.name}/${name}: unsupported storage type ${storage}`);
      }
      files.push({ name, type: e[0x10], aux: word(e, 0x1f), eof, data });
    }
    dirBlock = word(b, 2);
  }

  const blocks = new Uint8Array(IMAGE_SIZE);
  for (let n = 0; n < BLOCKS; n++) blocks.set(read(n), n * 512);
  const unowned = [];
  for (let n = 0; n < BLOCKS; n++) if (!owned.has(n)) unowned.push(n);
  return { volume: header.name, order, files, blocks, unowned };
}
