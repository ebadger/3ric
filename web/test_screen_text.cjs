// Decode the Apple-II text screen ($400 page 1) to readable ASCII after a short
// monitor session, to confirm the canvas (video RAM) reflects typed input.

const fs = require("fs");
const path = require("path");
const createBadgerVM = require("./badger6502.js");

const DATA = path.join(__dirname, "data");
const rom = fs.readFileSync(path.join(DATA, "badger6502.bin"));
const romdisk = fs.readFileSync(path.join(DATA, "loderun.bin"));
const font = fs.readFileSync(path.join(DATA, "fontrom.dat"));

// Text row base offsets within the text page (interleaved), 24 rows.
const textScanlines = [
  0x0000, 0x0080, 0x0100, 0x0180, 0x0200, 0x0280, 0x0300, 0x0380,
  0x0028, 0x00a8, 0x0128, 0x01a8, 0x0228, 0x02a8, 0x0328, 0x03a8,
  0x0050, 0x00d0, 0x0150, 0x01d0, 0x0250, 0x02d0, 0x0350, 0x03d0,
];

createBadgerVM().then((Module) => {
  const vm = new Module.WebVM();
  vm.loadData(0x0000, new Uint8Array(rom.subarray(0, 0x10000)));
  vm.seedBasicRom();
  vm.loadRomDisk(new Uint8Array(romdisk));
  vm.loadFont(new Uint8Array(font));
  vm.reset();

  for (let c = 0; c < 20; c++) vm.run(50000);

  function type(str) {
    for (const ch of str) {
      const code = ch === "\n" ? 0x0d : ch.charCodeAt(0);
      for (let t = 0; t < 200 && (vm.peek(0xc000) & 0x80) !== 0; t++) vm.run(2000);
      vm.keyDown(code);
      for (let t = 0; t < 20; t++) vm.run(4000);
    }
  }

  // A couple of monitor commands so multiple lines populate the screen.
  type("D000.D00F\n"); // dump 16 bytes
  type("FF00.FF0F\n");

  console.log("--- decoded text screen (page 1) ---");
  for (let row = 0; row < 24; row++) {
    const base = 0x400 + textScanlines[row];
    let line = "";
    for (let col = 0; col < 40; col++) {
      const b = vm.peek(base + col) & 0x7f;
      line += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
    }
    console.log(String(row).padStart(2, " ") + "| " + line);
  }
  process.exit(0);
});
