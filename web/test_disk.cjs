// Milestone — Disk II (5.25") floppy emulation: verify a real WOZ disk image
// boots through the standard Disk II boot ROM at $C600 and paints a hi-res
// screen, exactly the way a user drives the machine ("C600G" from the monitor).
//
// Flow:
//   1. Execute the actual page's loadRom/typeString/bootDisk functions.
//   2. Cold boot into DOS, queue MON then C600G, and deliver keys one per
//      frame only when the keyboard strobe is clear.
//   3. The Disk II boot PROM reads track 0 over $C0E0-$C0EF and chains the
//      game's own loader, both without SD and with an already-mounted card.
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
const assert = require("node:assert/strict");
const { runInNewContext } = require("node:vm");
const createBadgerVM = require("./badger6502.js");

const DATA = path.join(__dirname, "data");
const rom = fs.readFileSync(path.join(DATA, "badger6502.bin"));
const font = fs.readFileSync(path.join(DATA, "fontrom.dat"));
const sd = fs.readFileSync(path.join(DATA, "sd.sparse"));
const page = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
function pageFunction(name) {
  const match = page.match(new RegExp(`^    (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"));
  assert(match, `Missing page function ${name}`);
  return match[0];
}
const diskStartup = ["typeString", "loadRom", "bootDisk"].map(pageFunction).join("\n");

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

async function testDisk(Module, withSD) {
  const vm = new Module.WebVM();
  try {
    if (withSD) assert(vm.loadSD(new Uint8Array(sd)), "SD card was not mounted");
    if (withSD) assert(vm.enableAudio(48000), "Audio collection was not enabled");
    const inputQueue = [0x58, 0x59, 0x5a];
    const statusEl = { textContent: "" };
    const events = [];
    let suspended = false;
    vm.addBreakpoint(0xe06f);
    const bootDisk = runInNewContext(`${diskStartup}\nbootDisk;`, {
      vm, inputQueue, statusEl, audioGenerating: withSD,
      fetchBytes: async name => {
        if (name === "data/badger6502.bin") return new Uint8Array(rom);
        if (name === "data/fontrom.dat") return new Uint8Array(font);
        throw new Error(`Unexpected asset ${name}`);
      },
      emulationClock: { reset() {} },
      clearAudioQueue() {},
      canvas: { focus() { events.push("focus"); } },
      debuggerController: {
        setProgram(source, listing) {
          assert.equal(source, "");
          assert.equal(listing.length, 0);
          events.push("clear source");
        },
        beginProgramLoad() {
          suspended = true;
          vm.clearBreakpoints();
          events.push("begin");
        },
        onMachineReset() {
          assert(suspended, "ROM reset must not reinstate startup breakpoints");
          events.push("reset");
        },
        endProgramLoad() {
          suspended = false;
          vm.addBreakpoint(0xe06f);
          events.push("end");
        },
      },
    });
    await bootDisk(new Uint8Array(woz), path.basename(wozPath));
    assert.deepEqual(events, ["clear source", "begin", "reset", "focus", "end"]);
    assert(vm.hasBreakpoint(0xe06f), "User breakpoints were not restored");
    assert(vm.diskPresent(0), "Disk was not inserted");
    assert.equal(String.fromCharCode(...inputQueue), "MON\rC600G\r");
    assert.match(statusEl.textContent, /^booting /);
    assert.equal(vm.drainAudio().length, 0, "ROM warmup left stale audio queued");

    let trappedToZero = false;
    for (let frame = 0; frame < 2400; frame++) {
      if (inputQueue.length && (vm.peek(0xc000) & 0x80) === 0)
        vm.keyDown(inputQueue.shift());
      vm.runCycles(frame === 0 ? 0 : 26224);
      if (vm.pc() < 0x0200) trappedToZero = true;
    }
    const serial = vm.drainOutput();
    assert.equal(inputQueue.length, 0, "Boot command was not consumed");
    assert.match(serial, />MON\r/, "First queued key was lost during ROM initialization");
    assert.match(serial, /\*C600G\r/, "Disk command did not reach the monitor");
    assert.doesNotMatch(serial, /EH\?/, "Boot command was sent to DOS instead of the monitor");
    assert(!trappedToZero, "Disk boot trapped into zero page");
    assert.equal(vm.textMode(), 0);
    assert.equal(vm.lores(), 0);
    assert(litPixels(vm) > 5000, "Disk did not paint a hi-res screen");
    assert.match(screenText(vm).replace(/\s+/g, ""), /PRESENTS/, "Dino Eggs title banner missing");
    console.log(`PASS actual browser disk startup ${withSD ? "with" : "without"} mounted SD, keyboard queue and hi-res title`);

    inputQueue.push(0x58);
    events.length = 0;
    await bootDisk(new Uint8Array(12), "invalid");
    assert.equal(statusEl.textContent, "not a valid .woz image");
    assert.equal(inputQueue.length, 0, "Invalid image queued boot commands");
    assert.deepEqual(events, ["clear source", "begin", "reset", "end"]);
    assert(vm.hasBreakpoint(0xe06f), "Invalid image left the debugger suspended");
    console.log("PASS invalid disk status, cleared input and debugger restoration");
  } finally {
    vm.delete();
  }
}

createBadgerVM().then(async Module => {
  await testDisk(Module, false);
  await testDisk(Module, true);
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
