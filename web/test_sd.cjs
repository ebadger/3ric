// Micro-SD card: boot the card the emulators ship with (data/sd.v2.sparse,
// staged by build.ps1 from emulator/Data/sd.zip) through the bit-banged SPI
// emulation and the ROM's own DOS, the way the page does: the card goes in
// before reset, and the ROM mounts it at reset and starts its DOS shell (">").
//
//   1. The current ROM mounts a card only at reset: one loaded after reset
//      is not listed (why the page powers on with the card, and why Mount SD
//      and ?brun= restart the machine).
//   2. DIR lists the root: the volume label and the DIRTBIKE folder only.
//   3. BSAVE, BLOAD and DEL round-trip a new file: the ROM writes the card.
//   4. CD DIRTBIKE + DIR lists the game's files, the program and the
//      notices; CAT README.TXT prints the licence notice.
//   5. BRUN DIRTBIKE.PRG 0800 loads Dirt Bike to its hi-res title.
//
// Run with emsdk's bundled node:
//   C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe web\test_sd.cjs

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const createBadgerVM = require("./badger6502.js");

const DATA = path.join(__dirname, "data");
const rom = fs.readFileSync(path.join(DATA, "badger6502.bin"));
const font = fs.readFileSync(path.join(DATA, "fontrom.dat"));
const sd = fs.readFileSync(path.join(DATA, "sd.v2.sparse"));
const TRACKS = Array.from({ length: 30 }, (_, i) => "T" + String(i + 1).padStart(2, "0"));
const CPU_HZ = 25_175_000 / 16;

// DIR lines: "<DIR> NAME     EXT $size     $cluster" -> "<DIR> NAME" / "NAME.EXT size".
function listing(out) {
  return out.split("\r")
    .map((line) => /^(<DIR>| {5}) (.{8}) (.{3}) \$([0-9A-F]{8}) \$([0-9A-F]{8})$/.exec(line))
    .filter(Boolean)
    .map(([, kind, base, ext, size]) => {
      const name = base.trim() + (ext.trim() ? "." + ext.trim() : "");
      return kind === "<DIR>" ? `<DIR> ${name}` : `${name} ${parseInt(size, 16)}`;
    });
}

createBadgerVM().then((Module) => {
  const vm = new Module.WebVM();
  vm.loadData(0x0000, new Uint8Array(rom.subarray(0, 0x10000)));
  vm.seedBasicRom();
  vm.loadFont(new Uint8Array(font));

  const settle = (n = 25) => { for (let i = 0; i < n; i++) vm.run(50000); };
  // Type ASCII (CR = 0x0D), letting the ROM take each key; returns the output.
  const type = (s, n = 40) => {
    for (const ch of s) {
      vm.keyDown(ch === "\r" ? 0x0d : ch.charCodeAt(0));
      for (let i = 0; i < 8; i++) vm.run(20000);
    }
    settle(n);
    return vm.drainOutput();
  };

  // 1. A card loaded after reset is mounted by the next reset.
  vm.reset();
  settle();
  assert.equal(vm.loadSD(new Uint8Array(sd)), true, "the sparse image loads");
  vm.drainOutput();
  assert.doesNotMatch(type("DIR\r"), /DIRTBIKE/,
    "the ROM mounted no card at reset (if this fails, the ROM now mounts cards later: update WEB-CLIENT.md)");
  vm.reset();
  settle();
  assert.match(vm.drainOutput(), /3RIC 6502 OS\/3[^]*>$/, "reset: the DOS shell prompt");
  console.log("PASS the ROM mounts the card at reset");

  // 2. The root: Dirt Bike and nothing else.
  assert.deepEqual(listing(type("DIR\r")), ["3RIC 0", "<DIR> DIRTBIKE"], "volume 3RIC holds the DIRTBIKE folder only");
  console.log("PASS DIR lists the root: 3RIC, <DIR> DIRTBIKE");

  // 3. The ROM's FAT32 code writes the card: a new file, read back, deleted.
  const block = Uint8Array.from({ length: 256 }, (_, i) => (i * 7 + 3) & 255);
  vm.loadData(0x2000, block);
  type("BSAVE TEST.BIN 2000 0100\r", 120);
  assert.deepEqual(listing(type("DIR\r")), ["3RIC 0", "<DIR> DIRTBIKE", "TEST.BIN 256"], "BSAVE added a file");
  vm.loadData(0x3000, new Uint8Array(256));
  type("BLOAD TEST.BIN 3000\r", 120);
  assert.deepEqual(Array.from({ length: 256 }, (_, i) => vm.peek(0x3000 + i)), Array.from(block), "BLOAD read it back");
  type("DEL TEST.BIN\r", 120);
  assert.deepEqual(listing(type("DIR\r")), ["3RIC 0", "<DIR> DIRTBIKE"], "DEL removed it");
  console.log("PASS BSAVE, BLOAD and DEL round-trip a file on the card");

  // 4. The DIRTBIKE folder and its notice.
  assert.match(type("CD DIRTBIKE\r"), /CD DIRTBIKE\rOK\r/);
  const folder = listing(type("DIR\r"));
  assert.deepEqual(folder.map((e) => e.replace(/ \d+$/, "")),
    ["<DIR> .", "<DIR> ..", "TITLE", ...TRACKS, "DIRTHOF", "DIRTBIKE.PRG", "README.TXT", "LICENSE.TXT"]);
  const notice = type("CAT README.TXT\r");
  for (const want of [/ARNAUD VERHILLE/, /GNU GENERAL\rPUBLIC LICENSE, VERSION 3/, /MODIFIED FOR 3RIC ON 2026-10-22/,
    /GITHUB\.COM\/HABIB256\/POM2GAMES/, /GITHUB\.COM\/EBADGER\/3RIC/])
    assert.match(notice, want);
  console.log(`PASS CD DIRTBIKE + DIR lists ${folder.length - 2} files; CAT README.TXT prints the licence notice`);

  // 5. BRUN Dirt Bike from the card to its hi-res title.
  type("BRUN DIRTBIKE.PRG 0800\r", 0);
  let serial = "", cycles = 0;
  while (!/FLOAD TITLE/.test(serial) && cycles < 40e6) { cycles += vm.runCycles(100000); serial += vm.drainOutput(); }
  settle(120);
  assert.match(serial, /FLOAD DIRTHOF B500 0000 01FF\rFLOAD TITLE 9600 0000 10FF\r/, "the game loads its hall of fame and title");
  assert.ok(!vm.textMode(), "the hi-res title screen");
  assert.ok(vm.pc() >= 0x6000 && vm.pc() < 0xc000, `the game is running (PC $${vm.pc().toString(16)})`);
  console.log(`PASS BRUN DIRTBIKE.PRG 0800 reaches the title in ${(cycles / CPU_HZ).toFixed(1)} s (emulated)`);
  console.log("\nPASS");
}).catch((error) => {
  console.error(error);
  console.log("\nFAIL");
  process.exit(1);
});
