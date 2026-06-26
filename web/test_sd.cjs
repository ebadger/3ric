// Milestone — micro-SD card: verify the bit-banged SPI SD emulation works by
// mounting the FAT32 image and listing its root directory through the ROM's
// own DOS shell.
//
// Flow (matches how a user drives the real machine from the monitor):
//   1. Boot the ROM into the "*" monitor.
//   2. Type "EC5CG"+CR -> "G"o to $EC5C (the `dos` routine), which mounts the
//      card (fat32_start) and shows the ">" shell prompt.
//   3. Type "DIR"+CR -> the FAT32 directory listing is printed.
//
// Proof points:
//   - SD sector reads actually happened (sdReadCount > 0) -> the SPI path +
//     sparse image are wired correctly.
//   - The directory listing contains real FAT32 entries (<DIR> folders and
//     "PRG" files) read out of data/sd.sparse.
//
// Run with emsdk's bundled node:
//   C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe web\test_sd.cjs

const fs = require("fs");
const path = require("path");
const createBadgerVM = require("./badger6502.js");

const DATA = path.join(__dirname, "data");
const rom = fs.readFileSync(path.join(DATA, "badger6502.bin"));
const font = fs.readFileSync(path.join(DATA, "fontrom.dat"));
const sd = fs.readFileSync(path.join(DATA, "sd.sparse"));

createBadgerVM().then((Module) => {
  const vm = new Module.WebVM();

  // Standard ROM load recipe + the SD sparse image.
  vm.loadData(0x0000, new Uint8Array(rom.subarray(0, 0x10000)));
  vm.seedBasicRom();
  vm.loadFont(new Uint8Array(font));
  const sdLoaded = vm.loadSD(new Uint8Array(sd));
  vm.reset();

  // Settle into the monitor.
  for (let i = 0; i < 20; i++) vm.run(50000);

  // Type a string of ASCII (CR = 0x0D), letting the ROM consume each key.
  function type(s) {
    for (const ch of s) {
      vm.keyDown(ch === "\r" ? 0x0d : ch.charCodeAt(0));
      for (let i = 0; i < 8; i++) vm.run(20000);
    }
    for (let i = 0; i < 120; i++) vm.run(50000);
  }

  // Enter the DOS shell ($EC5C = `dos`): mounts the SD and prints ">".
  vm.drainOutput();
  type("EC5CG\r");
  const mountReads = vm.sdReadCount();
  const promptOut = vm.drainOutput();

  // List the root directory.
  type("DIR\r");
  const dirOut = vm.drainOutput();
  const dirReads = vm.sdReadCount();

  console.log("--- SD micro-SD card test ---");
  console.log("sparse image loaded     :", sdLoaded);
  console.log("entered shell (prompt)  :", JSON.stringify(promptOut.slice(-4)));
  console.log("sector reads after mount:", mountReads);
  console.log("sector reads after DIR  :", dirReads);
  console.log("\n--- DIR output (first 600 chars) ---");
  console.log(dirOut.slice(0, 600));

  const gotPrompt = promptOut.includes(">");
  const hasDirEntries = /<DIR>/.test(dirOut);
  const hasPrgFiles = /PRG/.test(dirOut);
  const readsHappened = mountReads > 0 && dirReads > mountReads;

  console.log("\n--- checks ---");
  console.log("sparse image loaded     :", sdLoaded);
  console.log("DOS shell prompt '>'    :", gotPrompt);
  console.log("SD sector reads occurred:", readsHappened);
  console.log("listing has <DIR> dirs  :", hasDirEntries);
  console.log("listing has PRG files   :", hasPrgFiles);

  const ok = sdLoaded && gotPrompt && readsHappened && hasDirEntries && hasPrgFiles;
  console.log(ok ? "\nPASS" : "\nFAIL");
  process.exit(ok ? 0 : 1);
});
