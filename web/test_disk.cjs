// Milestone — Disk II (5.25") floppy emulation: verify a real WOZ disk image
// boots through the standard Disk II boot ROM at $C600 and paints a hi-res
// screen, exactly the way a user drives the machine ("C600G" from the monitor).
//
// Flow:
//   1. Boot the ROM into the "*" monitor.
//   2. insertDisk(0, <Dino Eggs .woz>)  -> drive 1 loaded.
//   3. Type "C600G"+CR -> "G"o to $C600, the Disk II boot PROM, which spins the
//      drive, reads track 0 over the $C0E0-$C0EF data registers (DriveEmulator)
//      and chains the game's own loader.
//
// Proof points (disk-agnostic, so the assertion is robust):
//   - The disk is present after insertDisk().
//   - Boot does NOT trap to $0000 (a failed boot jumps to zero page and BRKs).
//   - The machine switches into hi-res graphics and the framebuffer fills with
//     thousands of lit pixels read off the floppy.
//   - Dino Eggs prints a recognizable "PRESENTS" banner into text RAM.
//
// The demo disk (data/disk.woz) is staged by web/build.ps1 from the in-repo WOZ
// test images. This Apple-II clone has no Applesoft, so DOS-3.3 / Quick-DOS
// disks (which auto-run an Applesoft greeting) trap to $0000; self-booting
// machine-code game disks like this one run fine.
//
// Run with emsdk's bundled node:
//   C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe web\test_disk.cjs

const fs = require("fs");
const path = require("path");
const createBadgerVM = require("./badger6502.js");

const DATA = path.join(__dirname, "data");
const rom = fs.readFileSync(path.join(DATA, "badger6502.bin"));
const font = fs.readFileSync(path.join(DATA, "fontrom.dat"));

// Prefer the staged demo disk; fall back to the in-repo WOZ test image so the
// test runs even before build.ps1 has staged data/disk.woz.
const demo = path.join(DATA, "disk.woz");
const fallback = path.join(
  __dirname, "..", "emulator", "WozFileTestApp", "testdata",
  "WOZ 2.0", "Dino Eggs - Disk 1, Side A.woz");
const wozPath = fs.existsSync(demo) ? demo : fallback;
const woz = fs.readFileSync(wozPath);

const textScanlines = [
  0x0000, 0x0080, 0x0100, 0x0180, 0x0200, 0x0280, 0x0300, 0x0380,
  0x0028, 0x00a8, 0x0128, 0x01a8, 0x0228, 0x02a8, 0x0328, 0x03a8,
  0x0050, 0x00d0, 0x0150, 0x01d0, 0x0250, 0x02d0, 0x0350, 0x03d0,
];
function screenText(vm) {
  let out = "";
  for (let row = 0; row < 24; row++) {
    const base = 0x400 + textScanlines[row];
    for (let col = 0; col < 40; col++) {
      const b = vm.peek(base + col) & 0x7f;
      out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : " ";
    }
    out += "\n";
  }
  return out;
}
function litPixels(vm) {
  const fb = vm.renderFrame();
  let n = 0;
  for (let i = 0; i < fb.length; i += 4) if (fb[i] || fb[i + 1] || fb[i + 2]) n++;
  return n;
}

createBadgerVM().then((Module) => {
  const vm = new Module.WebVM();
  vm.loadData(0x0000, new Uint8Array(rom.subarray(0, 0x10000)));
  vm.seedBasicRom();
  vm.loadFont(new Uint8Array(font));
  vm.reset();
  for (let i = 0; i < 20; i++) vm.run(50000);

  const inserted = vm.insertDisk(0, new Uint8Array(woz));
  const present = vm.diskPresent(0);

  // Drive the real keyboard path: "C600G" + CR jumps to the Disk II boot ROM.
  function type(s) {
    for (const ch of s) {
      for (let t = 0; t < 200 && (vm.peek(0xc000) & 0x80) !== 0; t++) vm.run(2000);
      vm.keyDown(ch === "\r" ? 0x0d : ch.charCodeAt(0));
      for (let t = 0; t < 20; t++) vm.run(4000);
    }
  }
  type("C600G\r");

  // Let the loader spin the disk and paint the title (~12M cycles), watching
  // for a failed boot trapping into zero page.
  let trappedToZero = false;
  for (let chunk = 0; chunk < 120; chunk++) {
    for (let i = 0; i < 50; i++) {
      vm.run(2000);
      if (vm.pc() < 0x0200) trappedToZero = true;
    }
  }

  const mode = vm.textMode() ? "TEXT" : (vm.lores() ? "LORES" : "HIRES");
  const lit = litPixels(vm);
  const text = screenText(vm);

  console.log("--- Disk II floppy test ---");
  console.log("disk image          :", path.basename(wozPath));
  console.log("inserted / present  :", inserted, "/", present);
  console.log("display mode        :", mode);
  console.log("lit framebuffer px  :", lit);
  console.log("trapped to $0000    :", trappedToZero);
  console.log("\n--- text overlay (non-blank rows) ---");
  console.log(text.split("\n").filter((l) => l.trim()).join("\n"));

  const hiresPainted = mode === "HIRES" && lit > 5000;
  // The title is letter-spaced on screen ("P R E S E N T S"); collapse spaces.
  const hasBanner = /PRESENTS/.test(text.replace(/\s+/g, ""));

  console.log("\n--- checks ---");
  console.log("disk inserted+present :", inserted && present);
  console.log("booted (no $0000 trap):", !trappedToZero);
  console.log("hi-res screen painted :", hiresPainted);
  console.log("title banner visible  :", hasBanner);

  const ok = inserted && present && !trappedToZero && hiresPainted && hasBanner;
  console.log(ok ? "\nPASS" : "\nFAIL");
  process.exit(ok ? 0 : 1);
});
