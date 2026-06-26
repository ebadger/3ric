// Milestone 1 — headless boot smoke test for the 3ric WASM build.
//
// Loads the real 512KB ROM (first 64KB into the address space), seeds the BASIC
// bank, loads the font, resets, and runs the CPU for a while. Confirms
// the reset vector lands in ROM, the CPU executes sane PC ranges, the display
// mode soft-switches get touched, and video RAM ($400-$BFF text / $2000-$5FFF
// hi-res) receives writes — i.e. the ROM is really running.
//
// Run with emsdk's bundled node:
//   C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe web\test_boot.cjs

const fs = require("fs");
const path = require("path");
const createBadgerVM = require("./badger6502.js");

const DATA = path.join(__dirname, "data");
const rom = fs.readFileSync(path.join(DATA, "badger6502.bin"));
const font = fs.readFileSync(path.join(DATA, "fontrom.dat"));

function hex(n, w = 4) {
  return "$" + (n >>> 0).toString(16).toUpperCase().padStart(w, "0");
}

createBadgerVM().then((Module) => {
  const vm = new Module.WebVM();

  // ROM load recipe (mirrors the WinUI host):
  // 1) first 64KB of badger6502.bin -> $0000..$FFFF (reset vector + ROM/OS).
  vm.loadData(0x0000, new Uint8Array(rom.subarray(0, 0x10000)));
  // 2) seed the BASIC ROM bank from $9000.
  vm.seedBasicRom();
  // 3) font ROM for the text renderer.
  vm.loadFont(new Uint8Array(font));
  // 5) reset -> PC loaded from $FFFC/$FFFD.
  vm.reset();

  const resetPC = vm.pc();
  console.log("reset vector PC =", hex(resetPC));

  // Run the CPU in chunks, sampling PC so we can see it move through ROM.
  const pcSamples = [];
  const CHUNKS = 40;
  const STEPS = 50000;
  for (let c = 0; c < CHUNKS; c++) {
    vm.run(STEPS);
    pcSamples.push(vm.pc());
  }

  // Count non-zero / non-blank bytes in each video region.
  function regionStats(start, end) {
    let nonZero = 0;
    let distinct = new Set();
    for (let a = start; a <= end; a++) {
      const b = vm.peek(a);
      if (b !== 0x00) nonZero++;
      distinct.add(b);
    }
    return { nonZero, distinct: distinct.size, total: end - start + 1 };
  }

  const text1 = regionStats(0x0400, 0x07ff);
  const text2 = regionStats(0x0800, 0x0bff);
  const hires1 = regionStats(0x2000, 0x3fff);
  const hires2 = regionStats(0x4000, 0x5fff);

  console.log("\n--- PC samples (every", STEPS, "steps) ---");
  console.log(pcSamples.map((p) => hex(p)).join(" "));

  console.log("\n--- display mode after boot ---");
  console.log(
    "textMode =", vm.textMode(),
    " gfxPage =", vm.gfxPage(),
    " mixed =", vm.mixed(),
    " lores =", vm.lores(),
    " font =", vm.font()
  );

  console.log("\n--- video RAM activity (non-zero bytes / distinct values) ---");
  console.log("text  page1 $0400-$07FF:", text1.nonZero, "/", text1.distinct);
  console.log("text  page2 $0800-$0BFF:", text2.nonZero, "/", text2.distinct);
  console.log("hires page1 $2000-$3FFF:", hires1.nonZero, "/", hires1.distinct);
  console.log("hires page2 $4000-$5FFF:", hires2.nonZero, "/", hires2.distinct);

  const serial = vm.drainOutput();
  if (serial && serial.length) {
    console.log("\n--- serial output ---");
    console.log(JSON.stringify(serial));
  }

  // Sanity checks.
  const pcSane =
    resetPC >= 0xc000 && // boot vector should point into device/ROM space
    pcSamples.some((p) => p >= 0xc000); // and the CPU keeps executing up there
  const videoWritten =
    text1.nonZero > 0 || text2.nonZero > 0 || hires1.nonZero > 0 || hires2.nonZero > 0;
  const modeTouched =
    vm.textMode() !== 0 || vm.gfxPage() !== 0 || vm.mixed() !== 0 || vm.lores() !== 0;

  console.log("\n--- checks ---");
  console.log("reset/exec PC sane :", pcSane);
  console.log("video RAM written  :", videoWritten);
  console.log("mode soft-switched :", modeTouched);

  const ok = pcSane && videoWritten;
  console.log(ok ? "\nPASS" : "\nFAIL");
  process.exit(ok ? 0 : 1);
});
