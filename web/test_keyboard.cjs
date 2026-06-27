// Milestone 4 (headless) — keyboard input via the memory-mapped $C000 path.
//
// Boots into the monitor, then "types" a line by setting $C000 = key|0x80 only
// when the previous strobe has been consumed (bit 7 cleared via $C010). Confirms
// the typed characters echo back over the console (serial + text RAM), proving
// the keyboard path works end to end.

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

  // Boot into the monitor prompt.
  for (let c = 0; c < 20; c++) vm.run(50000);
  vm.drainOutput(); // discard boot banner

  // Type a classic monitor command: examine memory at $D000 (start of ROM).
  // "D000" + Enter.  Each key is delivered once the strobe is clear.
  function type(str) {
    for (const ch of str) {
      let code = ch === "\n" ? 0x0d : ch.charCodeAt(0);
      // wait for the keyboard strobe to be clear
      for (let t = 0; t < 200 && (vm.peek(0xc000) & 0x80) !== 0; t++) vm.run(2000);
      vm.keyDown(code);
      // let the monitor read + echo it
      for (let t = 0; t < 20; t++) vm.run(4000);
    }
  }

  type("D000\n");

  const echo = vm.drainOutput();
  console.log("--- console echo while typing 'D000<CR>' ---");
  console.log(JSON.stringify(echo));

  // The monitor echoes the typed address and prints the byte at $D000.
  // $D000 holds the first ROM byte; show it for reference.
  console.log("byte @ $D000 =", "$" + vm.peek(0xd000).toString(16).toUpperCase().padStart(2, "0"));

  const ok = echo.includes("D000") || /D\s*0\s*0\s*0/.test(echo);
  console.log(ok ? "\nPASS (typed chars echoed)" : "\nFAIL (no echo)");
  process.exit(ok ? 0 : 1);
});
