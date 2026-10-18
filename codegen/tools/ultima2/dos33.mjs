// Minimal Apple DOS 3.3 disk-image reader (140 KB, DOS-order .dsk/.do).
//
// Returns the catalog's files; binary (B) files carry the load address and
// length from their 4-byte header. Ultima II's disks hold only B files.

const SECTOR = 256;
const TRACKS = 35;
const SECTORS = 16;

/** image: Uint8Array of 143360 bytes. Returns { volume, files: [{ name, type, locked, addr, len, data }] }. */
export function readDos33Image(image) {
  if (image.length !== TRACKS * SECTORS * SECTOR) throw new Error(`not a 140 KB DOS-order image (${image.length} bytes)`);
  const sector = (t, s) => {
    if (t >= TRACKS || s >= SECTORS) throw new Error(`track/sector ${t}/${s} out of range`);
    const o = (t * SECTORS + s) * SECTOR;
    return image.subarray(o, o + SECTOR);
  };
  const vtoc = sector(17, 0);
  // Origin's disks fill the VTOC with $FF apart from the catalog pointer,
  // so only that pointer is checked.
  if (vtoc[1] === 0 || vtoc[1] >= TRACKS || vtoc[2] >= SECTORS)
    throw new Error("no DOS 3.3 catalog pointer at track 17 sector 0");

  const files = [];
  const seenCat = new Set();
  let t = vtoc[1], s = vtoc[2];
  while (t !== 0 && !seenCat.has(t * 16 + s)) {
    seenCat.add(t * 16 + s);
    const cat = sector(t, s);
    for (let i = 0; i < 7; i++) {
      const e = cat.subarray(0x0b + i * 35, 0x0b + i * 35 + 35);
      if (e[0] === 0 || e[0] === 0xff) continue;           // never used / deleted
      const name = String.fromCharCode(...Array.from(e.subarray(3, 33), (b) => b & 0x7f)).replace(/ +$/, "");
      const type = e[2] & 0x7f;
      const chunks = [];
      const seenTs = new Set();
      let tt = e[0], ts = e[1];
      while (tt !== 0 && !seenTs.has(tt * 16 + ts)) {
        seenTs.add(tt * 16 + ts);
        const list = sector(tt, ts);
        for (let k = 0; k < 122; k++) {
          const dt = list[0x0c + 2 * k], ds = list[0x0d + 2 * k];
          chunks.push(dt === 0 && ds === 0 ? new Uint8Array(SECTOR) : sector(dt, ds));
        }
        tt = list[1]; ts = list[2];
      }
      const raw = new Uint8Array(chunks.length * SECTOR);
      chunks.forEach((c, n) => raw.set(c, n * SECTOR));
      const file = { name, type, locked: (e[2] & 0x80) !== 0 };
      if (type === 4) {                                    // B: address, length, data
        file.addr = raw[0] | (raw[1] << 8);
        file.len = raw[2] | (raw[3] << 8);
        if (file.len + 4 > raw.length) throw new Error(`${name}: length ${file.len} exceeds its sectors`);
        file.data = raw.slice(4, 4 + file.len);
      } else {
        file.data = raw;
      }
      files.push(file);
    }
    t = cat[1]; s = cat[2];
  }
  return { volume: vtoc[6], files };
}
