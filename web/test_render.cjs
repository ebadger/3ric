// Milestone 2 (headless) — validate the ported video renderer without a browser.
//
// Boots the ROM, renders one frame via the bridge, then prints a coarse 40x24
// "cell map" (# = any lit pixel in that 8x16 text cell) plus a non-black pixel
// count, so we can confirm the framebuffer actually contains the monitor screen
// before wiring it to a <canvas>.

const fs = require("fs");
const path = require("path");
const createBadgerVM = require("./badger6502.js");

const DATA = path.join(__dirname, "data");
const rom = fs.readFileSync(path.join(DATA, "badger6502.bin"));
const font = fs.readFileSync(path.join(DATA, "fontrom.dat"));

createBadgerVM().then((Module) => {
  const vm = new Module.WebVM();
  vm.loadData(0x0000, new Uint8Array(rom.subarray(0, 0x10000)));
  vm.seedBasicRom();
  vm.loadFont(new Uint8Array(font));
  vm.reset();

  // Let it boot into the monitor.
  for (let c = 0; c < 40; c++) vm.run(50000);

  const W = vm.frameWidth();
  const H = vm.frameHeight();
  const fb = vm.renderFrame(); // Uint8Array RGBA view, length W*H*4

  let nonBlack = 0;
  for (let i = 0; i < W * H; i++) {
    const r = fb[i * 4], g = fb[i * 4 + 1], b = fb[i * 4 + 2];
    if (r !== 0 || g !== 0 || b !== 0) nonBlack++;
  }

  // 40x24 cell map (each cell 8x16).
  console.log(`frame ${W}x${H}, non-black pixels = ${nonBlack}`);
  console.log("cell map (# = lit):");
  const cols = W / 8, rows = H / 16;
  for (let cy = 0; cy < rows; cy++) {
    let line = "";
    for (let cx = 0; cx < cols; cx++) {
      let lit = false;
      for (let yy = 0; yy < 16 && !lit; yy++) {
        for (let xx = 0; xx < 8; xx++) {
          const px = (cx * 8 + xx) + (cy * 16 + yy) * W;
          const r = fb[px * 4], g = fb[px * 4 + 1], b = fb[px * 4 + 2];
          if (r !== 0 || g !== 0 || b !== 0) { lit = true; break; }
        }
      }
      line += lit ? "#" : ".";
    }
    console.log(line);
  }

  const ok = nonBlack > 0;
  console.log(ok ? "\nPASS" : "\nFAIL");
  process.exit(ok ? 0 : 1);
});
