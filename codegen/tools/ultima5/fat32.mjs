// Build a small FAT32 micro-SD image in the web emulator's sparse format.
//
// Test-only helper: lets the headless harness boot a generated folder tree
// through the real ROM DOS and SPI SD emulation. Layout mirrors the shipped
// card: MBR, one type-0x0C partition at LBA 2048, 512-byte clusters, 2 FATs.
// Names must already be FAT 8.3 (upper case, NAME or NAME.EXT).
// Test options for other card layouts: sectorsPerCluster (a power of two;
// larger clusters need a larger totalSectors to stay FAT32) and fragment, a
// list of file names whose cluster chain gets a one-cluster gap halfway.

const SEC = 512;
const PART_LBA = 2048;
const RESERVED = 32;
const EOC = 0x0fffffff;

function shortName(name) {
  const [base, ext = ""] = name.split(".");
  if (!/^[A-Z0-9_$~!#%&'(){}@^`-]{1,8}$/.test(base) || !/^[A-Z0-9_$~!#%&'(){}@^`-]{0,3}$/.test(ext))
    throw new Error(`not a FAT 8.3 name: ${name}`);
  return Buffer.from(base.padEnd(8, " ") + ext.padEnd(3, " "), "ascii");
}

/** tree: { NAME: Uint8Array | tree }. Returns the "SDSP" sparse image bytes. */
export function buildSparseFat32(tree, { totalSectors = 131072, label = "3RIC U5", sectorsPerCluster = 1, fragment = [] } = {}) {
  const SPC = sectorsPerCluster, CL = SEC * SPC;
  const fragmented = new Set(fragment);
  const sectors = new Map();
  const sector = (lba) => {
    let s = sectors.get(lba);
    if (!s) { s = new Uint8Array(SEC); sectors.set(lba, s); }
    return s;
  };
  const partSectors = totalSectors - PART_LBA;
  // Solve for FAT size: clusters = data sectors, 128 entries per FAT sector.
  let fatSectors = 1;
  for (;;) {
    const clusters = Math.floor((partSectors - RESERVED - 2 * fatSectors) / SPC);
    const need = Math.ceil((clusters + 2) / 128);
    if (need <= fatSectors) break;
    fatSectors = need;
  }
  const clusterCount = Math.floor((partSectors - RESERVED - 2 * fatSectors) / SPC);
  if (clusterCount < 65525) throw new Error("image too small for FAT32");
  const fatLba = PART_LBA + RESERVED;
  const dataLba = fatLba + 2 * fatSectors;
  const fat = new Map([[0, 0x0ffffff8], [1, EOC]]);
  let nextFree = 2;
  const clusterLba = (c) => dataLba + (c - 2) * SPC;

  function allocChain(count, gap = false) {
    const chain = [];
    for (let i = 0; i < Math.max(1, count); i++) {
      if (gap && i === Math.floor(count / 2)) nextFree++;
      chain.push(nextFree++);
    }
    if (nextFree - 2 > clusterCount) throw new Error("image full");
    chain.forEach((c, i) => fat.set(c, i + 1 < chain.length ? chain[i + 1] : EOC));
    return chain;
  }
  function writeData(chain, data) {
    chain.forEach((c, i) => {
      for (let k = 0; k < SPC; k++) sector(clusterLba(c) + k).set(data.subarray(i * CL + k * SEC, i * CL + k * SEC + SEC));
    });
  }
  function dirEntry(name, attr, cluster, size) {
    const e = new Uint8Array(32);
    e.set(typeof name === "string" ? shortName(name) : name, 0);
    e[11] = attr;
    e[20] = (cluster >> 16) & 255; e[21] = cluster >> 24;
    e[26] = cluster & 255; e[27] = (cluster >> 8) & 255;
    new DataView(e.buffer).setUint32(28, size, true);
    return e;
  }
  // Writes a directory; returns its first cluster. parent 0 = root.
  function writeDir(node, self, parent) {
    const entries = [];
    if (self !== null) {
      entries.push(dirEntry(Buffer.from(".          ", "ascii"), 0x10, 0, 0));
      entries.push(dirEntry(Buffer.from("..         ", "ascii"), 0x10, parent, 0));
    } else {
      const v = Buffer.alloc(11, 0x20); v.write(label.toUpperCase(), "ascii");
      entries.push(dirEntry(v, 0x08, 0, 0));
    }
    const names = Object.keys(node);
    const chain = allocChain(Math.ceil((entries.length + names.length + 1) * 32 / CL));
    const first = chain[0];
    if (self !== null) {
      entries[0][26] = first & 255; entries[0][27] = (first >> 8) & 255;
      entries[0][20] = (first >> 16) & 255; entries[0][21] = first >> 24;
    }
    for (const name of names) {
      const value = node[name];
      if (value instanceof Uint8Array) {
        const c = value.length ? allocChain(Math.ceil(value.length / CL), fragmented.has(name)) : null;
        if (c) writeData(c, value);
        entries.push(dirEntry(name, 0x20, c ? c[0] : 0, value.length));
      } else {
        entries.push(dirEntry(name, 0x10, writeDir(value, 0, self === null ? 0 : first), 0));
      }
    }
    const bytes = new Uint8Array(chain.length * CL);
    entries.forEach((e, i) => bytes.set(e, i * 32));
    writeData(chain, bytes);
    return first;
  }
  // FAT32 rule: a ".." entry that refers to the root directory holds 0.
  const rootCluster = writeDir(tree, null, 0);
  if (rootCluster !== 2) throw new Error("root directory must start at cluster 2");

  // MBR
  const mbr = sector(0);
  mbr[0x1be + 4] = 0x0c;
  new DataView(mbr.buffer).setUint32(0x1be + 8, PART_LBA, true);
  new DataView(mbr.buffer).setUint32(0x1be + 12, partSectors, true);
  mbr[510] = 0x55; mbr[511] = 0xaa;
  // Boot sector (+ backup at 6) and FSInfo
  for (const at of [0, 6]) {
    const bs = sector(PART_LBA + at), dv = new DataView(bs.buffer);
    bs.set([0xeb, 0x58, 0x90], 0); bs.set(Buffer.from("MSWIN4.1"), 3);
    dv.setUint16(11, SEC, true); bs[13] = SPC; dv.setUint16(14, RESERVED, true); bs[16] = 2;
    bs[21] = 0xf8; dv.setUint16(24, 32, true); dv.setUint16(26, 64, true);
    dv.setUint32(28, PART_LBA, true); dv.setUint32(32, partSectors, true);
    dv.setUint32(36, fatSectors, true); dv.setUint32(44, 2, true); dv.setUint16(48, 1, true); dv.setUint16(50, 6, true);
    bs[64] = 0x80; bs[66] = 0x29; dv.setUint32(67, 0x35553352, true);
    bs.set(Buffer.from(label.toUpperCase().padEnd(11, " ")), 71); bs.set(Buffer.from("FAT32   "), 82);
    bs[510] = 0x55; bs[511] = 0xaa;
  }
  const fsinfo = sector(PART_LBA + 1), fv = new DataView(fsinfo.buffer);
  fv.setUint32(0, 0x41615252, true); fv.setUint32(484, 0x61417272, true);
  fv.setUint32(488, clusterCount - (nextFree - 2), true); fv.setUint32(492, nextFree, true);
  fsinfo[510] = 0x55; fsinfo[511] = 0xaa;
  // FATs
  for (const [c, v] of fat) {
    for (const copy of [0, 1]) {
      const s = sector(fatLba + copy * fatSectors + Math.floor(c / 128));
      new DataView(s.buffer).setUint32((c % 128) * 4, v, true);
    }
  }

  const lbas = [...sectors.keys()].sort((a, b) => a - b);
  const out = new Uint8Array(16 + lbas.length * (4 + SEC));
  const dv = new DataView(out.buffer);
  out.set(Buffer.from("SDSP"), 0);
  dv.setUint32(4, SEC, true); dv.setUint32(8, totalSectors, true); dv.setUint32(12, lbas.length, true);
  lbas.forEach((lba, i) => { dv.setUint32(16 + i * (4 + SEC), lba, true); out.set(sectors.get(lba), 20 + i * (4 + SEC)); });
  return out;
}
