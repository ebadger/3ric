const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const createBadgerVM = require("./badger6502.js");

async function main() {
  const { buildBootableWoz, crc32 } = await import(pathToFileURL(
    path.join(__dirname, "..", "codegen", "tools", "wozgen.mjs")));
  const Module = await createBadgerVM({ print() {}, printErr() {} });
  const limit = Module.MAX_WOZ_FILE_SIZE;
  assert.equal(limit, 8 * 1024 * 1024);
  const image = Buffer.from(buildBootableWoz(Uint8Array.of(0x4c, 0, 8), 0x0800));
  const vm = new Module.WebVM();
  const insert = bytes => vm.insertDisk(0, new Uint8Array(bytes));
  assert(insert(image), "the canonical exporter must pass native CRC and structural validation");
  assert(insert(fs.readFileSync(path.join(__dirname, "data", "disk.woz"))),
    "the bundled third-party WOZ2 must still load");

  const cases = [
    ["WOZ1", bytes => { bytes[3] = 0x31; }],
    ["bad header", bytes => { bytes[7] = 0; }],
    ["huge chunk size", bytes => bytes.writeUInt32LE(0xffffffff, 16)],
    ["missing INFO", bytes => bytes.write("SKIP", 12)],
    ["missing TMAP", bytes => bytes.write("SKIP", 80)],
    ["missing TRKS", bytes => bytes.write("SKIP", 248)],
    ["short INFO", bytes => bytes.writeUInt32LE(0, 16)],
    ["long INFO", bytes => bytes.writeUInt32LE(61, 16)],
    ["short TMAP", bytes => bytes.writeUInt32LE(159, 84)],
    ["short TRKS table", bytes => bytes.writeUInt32LE(1279, 252)],
    ["unsupported INFO version", bytes => { bytes[20] = 1; }],
    ["3.5-inch disk", bytes => { bytes[21] = 2; }],
    ["two-sided disk", bytes => { bytes[57] = 2; }],
    ["flux track", bytes => { bytes[20] = 3; bytes.writeUInt16LE(3, 66); bytes.writeUInt16LE(1, 68); }],
    ["zero largest track", bytes => bytes.writeUInt16LE(0, 64)],
    ["huge largest track", bytes => bytes.writeUInt16LE(0xffff, 64)],
    ["invalid TMAP index", bytes => { bytes[88] = 254; }],
    ["unallocated mapped track", bytes => { bytes[88] = 159; }],
    ["track points at header", bytes => bytes.writeUInt16LE(1, 256)],
    ["track points past file", bytes => bytes.writeUInt16LE(0xffff, 256)],
    ["track has no blocks", bytes => bytes.writeUInt16LE(0, 258)],
    ["track exceeds Largest Track", bytes => bytes.writeUInt16LE(bytes.readUInt16LE(64) + 1, 258)],
    ["track has no bits", bytes => bytes.writeUInt32LE(0, 260)],
    ["bits exceed allocated blocks", bytes => bytes.writeUInt32LE(bytes.readUInt16LE(258) * 4096 + 1, 260)],
    ["invalid unused descriptor", bytes => bytes.writeUInt32LE(1, 256 + 159 * 8 + 4)],
  ];
  let rejected = 0;
  function reject(bytes, label) {
    vm.removeDisk(0);
    assert.equal(insert(bytes), false, label);
    assert.equal(vm.diskPresent(0), false, `${label}: no partial image may remain active`);
    vm.loadData(0x0800, Uint8Array.of(0xea, 0x4c, 0, 8));
    vm.setPC(0x0800);
    assert(vm.runCycles(32) >= 32, `${label}: rejection must not abort the WASM VM`);
    assert(insert(image), `${label}: a valid replacement must still load`);
    rejected++;
  }
  for (const [label, mutate] of cases) {
    const bytes = Buffer.from(image);
    bytes.writeUInt32LE(0, 8); // Exercise the structure checks independently of CRC.
    mutate(bytes);
    reject(bytes, label);
  }
  for (const size of [12, 16, image.length - 1]) {
    const bytes = Buffer.from(image.subarray(0, size));
    bytes.writeUInt32LE(0, 8);
    reject(bytes, `truncated file (${size} bytes)`);
  }
  for (const [id, size] of [["INFO", 60], ["TMAP", 160], ["TRKS", 1280], ["FLUX", 160]]) {
    const bytes = Buffer.concat([image, Buffer.alloc(8 + size)]);
    bytes.writeUInt32LE(0, 8);
    bytes.write(id, image.length);
    bytes.writeUInt32LE(size, image.length + 4);
    reject(bytes, `duplicate or unsupported ${id} chunk`);
  }
  const badCrc = Buffer.from(image);
  badCrc[badCrc.length - 1] ^= 1;
  reject(badCrc, "CRC mismatch");

  const noCrc = Buffer.from(image);
  noCrc.writeUInt32LE(0, 8);
  assert(insert(noCrc), "zero CRC is an allowed omission, not a mismatch");
  const version3 = Buffer.from(noCrc);
  version3[20] = 3;
  assert(insert(version3), "INFO version 3 without flux retains the WOZ2 bitstream layout");
  const unmapped = Buffer.from(noCrc);
  unmapped.fill(0xff, 88, 248);
  assert(insert(unmapped), "unmapped tracks remain supported");

  const maximum = Buffer.alloc(limit);
  image.copy(maximum);
  maximum.write("META", image.length);
  maximum.writeUInt32LE(limit - image.length - 8, image.length + 4);
  maximum.writeUInt32LE(crc32(maximum, 12, maximum.length), 8);
  assert(insert(maximum), "the exact 8 MiB maximum, including optional metadata, must load");
  reject(Buffer.concat([maximum, Buffer.of(0)]), "one byte over 8 MiB");
  vm.delete();
  console.log(`PASS: ${rejected} malformed/unsupported/oversized WOZ cases reject without aborting or poisoning the VM`);
  console.log("PASS: exporter/demo images, optional CRC, INFO v3 bitstreams, unmapped tracks, and the exact size limit");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
