// harness.cjs — shared boot/load/run/capture harness for 3ric programs.
//
// Wraps the project's WebAssembly emulator (web/badger6502.js) with the exact
// boot recipe the browser + existing web/test_*.cjs use, then loads a raw .PRG
// image at an address and runs it the way `BRUN file.prg <org>` would on real
// hardware (load bytes at org, jump to org).
//
// It runs the CPU in chunks, capturing:
//   - serial output (ACIA $C100 writes + COUT, via drainOutput)
//   - the 40x24 text screen (decoded from video RAM)
//   - final CPU registers
//   - a stable halt reason (brk-monitor / wai / idle / timeout)
//
// Halt detection mirrors what a human sees at the console:
//   * brk-monitor : a BRK (or return to monitor) prints the register dump
//                   "PPPP-  A=.. X=.. Y=.. P=.. S=.." + bell + "*" prompt.
//   * wai         : the CPU executed WAI/STP (waiting() is true).
//   * idle        : PC stopped moving and no new serial output (infinite loop).
//   * timeout     : the cycle budget was exhausted.
//
// Exports async boot(opts) -> Session with load()/run()/serial helpers.

const fs = require("fs");
const path = require("path");

const WEB_DIR = process.env.BADGER_WEB_DIR || path.resolve(__dirname, "..", "..", "web");
const DATA_DIR = path.join(WEB_DIR, "data");

// Interleaved base offsets of the 24 text rows inside the $400 text page.
const TEXT_SCANLINES = [
  0x0000, 0x0080, 0x0100, 0x0180, 0x0200, 0x0280, 0x0300, 0x0380,
  0x0028, 0x00a8, 0x0128, 0x01a8, 0x0228, 0x02a8, 0x0328, 0x03a8,
  0x0050, 0x00d0, 0x0150, 0x01d0, 0x0250, 0x02d0, 0x0350, 0x03d0,
];

// The register dump the monitor prints on BRK / on return to the "*" prompt.
const MONITOR_DUMP =
  /([0-9A-F]{4})-\s+A=([0-9A-F]{2}) X=([0-9A-F]{2}) Y=([0-9A-F]{2}) P=([0-9A-F]{2}) S=([0-9A-F]{2})/;

function readData(name) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) throw new Error(`missing emulator data file: ${p} (build web/ first via web/build.ps1)`);
  return fs.readFileSync(p);
}

// Boot the emulator into the monitor and return a Session wrapper.
//   opts.sd   : optional Buffer/Uint8Array FAT32 sparse image to mount
//   opts.warmupChunks / opts.warmupCycles : monitor settle budget
async function boot(opts = {}) {
  const jsPath = path.join(WEB_DIR, "badger6502.js");
  if (!fs.existsSync(jsPath)) throw new Error(`missing ${jsPath} — build the emulator first (web/build.ps1)`);
  const createBadgerVM = require(jsPath);
  const rom = readData("badger6502.bin");
  const font = readData("fontrom.dat");

  const Module = await createBadgerVM();
  const vm = new Module.WebVM();
  vm.loadData(0x0000, new Uint8Array(rom.subarray(0, 0x10000)));
  vm.seedBasicRom();
  vm.loadFont(new Uint8Array(font));
  if (opts.sd) vm.loadSD(new Uint8Array(opts.sd));
  vm.reset();

  // Settle into the "*" monitor so COUT's output vector ($36/$37) is live.
  const warmChunks = opts.warmupChunks || 25;
  const warmCycles = opts.warmupCycles || 50000;
  for (let i = 0; i < warmChunks; i++) vm.run(warmCycles);
  vm.drainOutput(); // discard the banner

  return new Session(vm, Module);
}

class Session {
  constructor(vm, Module) {
    this.vm = vm;
    this.Module = Module;
    this._org = null;
  }

  // Load a raw image at org (the way BRUN loads a .PRG). Does not jump yet.
  load(bytes, org) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.vm.loadData(org & 0xffff, u8);
    this._org = org & 0xffff;
    return this;
  }

  peek(addr) { return this.vm.peek(addr & 0xffff) & 0xff; }
  poke(addr, v) { this.vm.poke(addr & 0xffff, v & 0xff); }
  regs() {
    const vm = this.vm;
    return { pc: vm.pc(), sp: vm.sp(), a: vm.regA(), x: vm.regX(), y: vm.regY(), status: vm.status() };
  }

  // Decode the 40x24 text screen to an array of 24 strings.
  textScreen() {
    const rows = [];
    for (let r = 0; r < 24; r++) {
      const base = 0x400 + TEXT_SCANLINES[r];
      let line = "";
      for (let c = 0; c < 40; c++) {
        const b = this.vm.peek(base + c) & 0x7f;
        line += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : " ";
      }
      rows.push(line.replace(/\s+$/, ""));
    }
    return rows;
  }

  // Jump to the loaded org (or an explicit addr) and run until a halt.
  //   opts.org          : entry address (defaults to the loaded org)
  //   opts.maxCycles    : total cycle budget (default 20,000,000)
  //   opts.chunk        : cycles per step (default 100,000)
  //   opts.idleChunks   : PC-still + silent chunks that count as "idle" (default 8)
  // Returns { halt, cycles, serial, registers, dump, text }.
  run(opts = {}) {
    const vm = this.vm;
    const org = opts.org != null ? (opts.org & 0xffff) : this._org;
    if (org == null) throw new Error("run(): no entry org — call load(bytes, org) first or pass opts.org");

    const maxCycles = opts.maxCycles || 20_000_000;
    const chunk = opts.chunk || 100_000;
    const idleChunks = opts.idleChunks || 8;

    vm.drainOutput();
    vm.setPC(org);

    let serial = "";
    let cycles = 0;
    let lastPC = -1;
    let stillCount = 0;
    let halt = "timeout";
    let dump = null;

    while (cycles < maxCycles) {
      cycles += vm.run(chunk);
      const chunkOut = vm.drainOutput();
      if (chunkOut) serial += chunkOut;

      if (vm.waiting()) { halt = "wai"; break; }

      const m = serial.match(MONITOR_DUMP);
      if (m) {
        halt = "brk-monitor";
        dump = { pc: parseInt(m[1], 16), a: parseInt(m[2], 16), x: parseInt(m[3], 16),
                 y: parseInt(m[4], 16), status: parseInt(m[5], 16), sp: parseInt(m[6], 16) };
        break;
      }

      const pc = vm.pc();
      if (pc === lastPC && !chunkOut) {
        if (++stillCount >= idleChunks) { halt = "idle"; break; }
      } else {
        stillCount = 0;
      }
      lastPC = pc;
    }

    return { halt, cycles, serial, registers: this.regs(), dump, text: this.textScreen() };
  }
}

module.exports = { boot, Session, TEXT_SCANLINES, MONITOR_DUMP, WEB_DIR, DATA_DIR };
