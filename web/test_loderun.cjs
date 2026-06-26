// Milestone 5 — romdisk / disk path: verify loderun.bin boots and runs.
//
// Two checks:
//   A) The romdisk hardware window at $C300 returns the loaded image byte-for-
//      byte (write low/high/bank pointer to $C300/$C301/$C302, read $C300).
//   B) Launch Lode Runner the way the WinUI host's dev path does
//      (memcpy GetRomDisk()[0] -> GetData()[0x0800], then run from $0800, whose
//      first bytes are `4C 00 60` = JMP $6000). Confirm it switches into hi-res
//      and paints the screen ($2000-$5FFF).
//
// Run with emsdk's bundled node:
//   C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe web\test_loderun.cjs

const fs = require("fs");
const path = require("path");
const createBadgerVM = require("./badger6502.js");

const DATA = path.join(__dirname, "data");
const rom = fs.readFileSync(path.join(DATA, "badger6502.bin"));
const romdisk = fs.readFileSync(path.join(DATA, "loderun.bin"));
const font = fs.readFileSync(path.join(DATA, "fontrom.dat"));

function hex(n, w = 4) {
  return "$" + (n >>> 0).toString(16).toUpperCase().padStart(w, "0");
}

createBadgerVM().then((Module) => {
  const vm = new Module.WebVM();

  // Standard ROM load recipe.
  vm.loadData(0x0000, new Uint8Array(rom.subarray(0, 0x10000)));
  vm.seedBasicRom();
  vm.loadRomDisk(new Uint8Array(romdisk));
  vm.loadFont(new Uint8Array(font));
  vm.reset();

  // Let the ROM settle into the monitor.
  for (let i = 0; i < 10; i++) vm.run(50000);

  // ---- A) romdisk hardware readback through the $C300 window ---------------
  function rdRead(off) {
    vm.writeBus(0xc300, off & 0xff);
    vm.writeBus(0xc301, (off >> 8) & 0xff);
    vm.writeBus(0xc302, (off >> 16) & 3);
    return vm.readBus(0xc300);
  }

  const probes = [0, 1, 2, 0x100, 0x1000, 0x2000, 0x5800, 0x8000, romdisk.length - 1];
  let rdMatches = 0;
  console.log("--- romdisk $C300 window readback ---");
  for (const off of probes) {
    const got = rdRead(off);
    const want = romdisk[off];
    const ok = got === want;
    if (ok) rdMatches++;
    console.log(
      `  off ${hex(off, 5)}: bus=${hex(got, 2)} file=${hex(want, 2)} ${ok ? "ok" : "MISMATCH"}`
    );
  }
  const romdiskOk = rdMatches === probes.length;
  console.log(`  romdisk window: ${rdMatches}/${probes.length} match -> ${romdiskOk ? "OK" : "FAIL"}`);

  // ---- B) launch loderun: romdisk -> RAM $0800, run from $0800 -------------
  // Clear hi-res pages first so we only measure writes loderun makes.
  for (let a = 0x2000; a <= 0x5fff; a++) vm.poke(a, 0x00);

  // Mirror the host's dev shortcut (MainWindow.xaml.cpp ~1211):
  //   memcpy(&GetData()[0x800], &GetRomDisk()[0], 0xB600)
  vm.romDiskToRam(0x0800, 0x0000, romdisk.length);

  // Sanity: the entry vector landed in RAM.
  const entry = [vm.peek(0x0800), vm.peek(0x0801), vm.peek(0x0802)];
  console.log(
    `\n--- loderun loaded at $0800 (entry bytes: ${entry.map((b) => hex(b, 2)).join(" ")}) ---`
  );

  // Jump to the program entry and let it run.
  vm.setPC(0x0800);

  const pcSamples = [];
  const CHUNKS = 80;
  const STEPS = 50000;
  let minPC = 0xffff;
  let maxPC = 0x0000;
  for (let c = 0; c < CHUNKS; c++) {
    vm.run(STEPS);
    const p = vm.pc();
    pcSamples.push(p);
    if (p < minPC) minPC = p;
    if (p > maxPC) maxPC = p;
  }

  function regionStats(start, end) {
    let nonZero = 0;
    const distinct = new Set();
    for (let a = start; a <= end; a++) {
      const b = vm.peek(a);
      if (b !== 0x00) nonZero++;
      distinct.add(b);
    }
    return { nonZero, distinct: distinct.size, total: end - start + 1 };
  }

  const hires1 = regionStats(0x2000, 0x3fff);
  const hires2 = regionStats(0x4000, 0x5fff);

  console.log("\n--- PC samples (every", STEPS, "steps) ---");
  console.log(pcSamples.map((p) => hex(p)).join(" "));
  console.log(`PC range observed: ${hex(minPC)}..${hex(maxPC)}`);

  console.log("\n--- display mode after launch ---");
  console.log(
    "textMode =", vm.textMode(),
    " gfxPage =", vm.gfxPage(),
    " mixed =", vm.mixed(),
    " lores =", vm.lores(),
    " font =", vm.font()
  );

  console.log("\n--- hi-res video RAM activity (non-zero bytes / distinct) ---");
  console.log("hires page1 $2000-$3FFF:", hires1.nonZero, "/", hires1.distinct);
  console.log("hires page2 $4000-$5FFF:", hires2.nonZero, "/", hires2.distinct);

  // Render a frame and count lit pixels as an end-to-end check.
  const fb = vm.renderFrame();
  let litPixels = 0;
  for (let i = 0; i < fb.length; i += 4) {
    if (fb[i] !== 0 || fb[i + 1] !== 0 || fb[i + 2] !== 0) litPixels++;
  }
  console.log(
    `\nframebuffer ${vm.frameWidth()}x${vm.frameHeight()}: ${litPixels} lit pixels`
  );

  const drewHires = hires1.nonZero > 500 || hires2.nonZero > 500;
  const graphicsMode = vm.textMode() === 0;
  const ranInProgram = minPC < 0xc000; // executing loaded code, not stuck in I/O

  console.log("\n--- checks ---");
  console.log("romdisk $C300 readback :", romdiskOk);
  console.log("entry = JMP $6000      :", entry[0] === 0x4c && entry[1] === 0x00 && entry[2] === 0x60);
  console.log("drew hi-res graphics   :", drewHires);
  console.log("graphics mode active   :", graphicsMode);
  console.log("executed loaded program:", ranInProgram);

  const ok = romdiskOk && drewHires && graphicsMode;
  console.log(ok ? "\nPASS" : "\nFAIL");
  process.exit(ok ? 0 : 1);
});
