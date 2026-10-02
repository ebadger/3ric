import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildQuarx, readQuarxDisk, decodeLzsa2, encodeLzsa2, convertDhrRow,
  buildPhysicalProgram, sha256 } from "./port-quarx.mjs";

let passed = 0;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
check("LZSA2 independent literal and back-reference vectors", () => {
  assert.equal(Buffer.from(decodeLzsa2(Uint8Array.from([0x5f, 0x0f, 65, 66, 67, 0, 232]))).toString(), "ABC");
  assert.equal(Buffer.from(decodeLzsa2(Uint8Array.from([8, 65, 255, 0x47, 0, 232]))).toString(), "AAA");
});
check("LZSA2 lengths, distances, repeated offsets, and incompressible bytes", () => {
  let seed = 0x12345678;
  const random = Uint8Array.from({ length: 16384 }, () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return seed & 255;
  });
  for (const size of [0, 1, 2, 3, 17, 18, 23, 24, 255, 256, 8192]) {
    for (const bytes of [random.subarray(0, size), new Uint8Array(size).fill(37)])
      assert.deepEqual(decodeLzsa2(encodeLzsa2(bytes)), bytes);
  }
  for (const distance of [2, 31, 32, 33, 511, 512, 513, 8192, 8704, 8705]) {
    const data = random.slice(0, distance + 600);
    data.copyWithin(distance, 0, 600);
    assert.deepEqual(decodeLzsa2(encodeLzsa2(data)), data);
  }
});
check("Malformed streams and unsupported disk revisions fail explicitly", () => {
  assert.throws(() => decodeLzsa2(Uint8Array.from([0x5f])), /Truncated/);
  assert.throws(() => decodeLzsa2(Uint8Array.from([0, 0xf0])), /back-reference/);
  assert.throws(() => decodeLzsa2(encodeLzsa2(new Uint8Array(100)), 99), /exceeds/);
  assert.throws(() => readQuarxDisk(new Uint8Array(143360)), /Unsupported Quarx disk/);
  assert.throws(() => buildPhysicalProgram(new Uint8Array(100), 0x800), /48 KiB/);
});
check("Double-hi-res conversion preserves black/white and rejects partial byte pairs", () => {
  assert.deepEqual(convertDhrRow(new Uint8Array(40), new Uint8Array(40)), new Uint8Array(40));
  assert.deepEqual(convertDhrRow(new Uint8Array(40).fill(127), new Uint8Array(40).fill(127)),
    new Uint8Array(40).fill(127));
  const green = Uint8Array.from({ length: 80 }, (_, n) => {
    let value = 0;
    for (let bit = 0; bit < 7; bit++) value |= ((2 >> ((n * 7 + bit) & 3)) & 1) << bit;
    return value;
  });
  const aux = Uint8Array.from({ length: 40 }, (_, n) => green[n * 2]);
  const main = Uint8Array.from({ length: 40 }, (_, n) => green[n * 2 + 1]);
  assert(convertDhrRow(aux, main).every(byte => byte & 127), "Dark green logo contours must not disappear");
  assert.throws(() => convertDhrRow(new Uint8Array(1), new Uint8Array(1)), /even/);
});

const diskIndex = process.argv.indexOf("--disk");
if (diskIndex >= 0) {
  assert(process.argv[diskIndex + 1], "--disk needs a local shareware .po path");
  const input = fs.readFileSync(process.argv[diskIndex + 1]), before = sha256(input);
  const port = buildQuarx(input), files = readQuarxDisk(input);
  check("Builder preserves its source and fits the existing physical WOZ loader", () => {
    assert.equal(sha256(input), before);
    assert(port.prg.length <= 34560);
    assert.equal(port.woz.length, 234496);
    for (const name of ["DATA/TITLE1.LZ", "DATA/TITLE2.LZ", "DATA/BACKGROUND1.LZ", "DATA/BACKGROUND2.LZ"])
      assert.equal(decodeLzsa2(files.get(name)).length, 8192);
    assert.throws(() => buildQuarx(input, new Uint8Array(524288)), /Unsupported 3RIC ROM/);
  });

  const require = createRequire(import.meta.url), { boot } = require("./harness.cjs");
  const session = await boot(), { vm } = session;
  const menuKey = port.symbols.MENU + 0xa6, menuBlockset = port.symbols.MENU + 0x478;
  const seek = (target, budget = 5_000_000) => {
    vm.clearBreakpoints(); vm.addBreakpoint(target); vm.runCycles(budget);
    assert.equal(vm.pc(), target, `Expected $${target.toString(16)}, stopped at $${vm.pc().toString(16)}`);
    vm.clearBreakpoints();
  };
  const key = (code, target = 0x118d) => {
    vm.keyDown(code); vm.step(); seek(target);
  };
  const bytes = (start, length) => Uint8Array.from({ length }, (_, n) => vm.peek(start + n));
  const call = address => {
    vm.loadData(0x300, Uint8Array.from([0x20, address & 255, address >> 8, 0xea]));
    vm.setPC(0x300); seek(0x303);
  };
  vm.addBreakpoint(port.symbols.INIT);
  assert(vm.insertDisk(0, port.woz));
  for (const char of "MON\rC600G\r") { vm.keyDown(char.charCodeAt(0)); vm.run(50000); }
  vm.runCycles(100_000_000);
  check("Disk II boots the generated WOZ and expands every byte into real lower RAM", () => {
    assert.equal(vm.pc(), port.symbols.INIT);
    assert.deepEqual(bytes(0x900, 0xb700), port.image.subarray(0x900));
    assert(vm.romVisible(0xfffa));
  });
  seek(port.symbols.NOTICE_KEY, 20_000_000);
  check("Shareware notice and countdown are retained", () => {
    assert(session.textScreen().join("\n").includes("QUARX SHAREWARE VERSION"));
    assert(session.textScreen().join("\n").includes("WWW.THE8BITGUY.COM"));
    assert.equal(String.fromCharCode(...bytes(0x7ec, 3).map(b => b & 127)), "000");
  });
  key(32, menuKey);
  check("Relocated original menu displays the converted title", () => {
    assert.equal(vm.textMode(), 0);
    assert.equal(vm.lores(), 0);
    assert.equal(vm.peek(menuBlockset), 0);
    assert.equal(vm.peek(0x1a), 5);
    assert(bytes(0x4000, 8192).some(b => b));
    assert.deepEqual(bytes(0x2000, 8192), port.title);
  });
  check("Original title music produces stereo PCM at its Apple II cadence on 3RIC's clock", () => {
    assert(vm.enableAudio(44100));
    const ticks = () => vm.peek(port.symbols.MUSIC_TICKS) | vm.peek(port.symbols.MUSIC_TICKS + 1) << 8;
    const beforeTicks = ticks(), energy = [0, 0];
    let cycles = 0, frames = 0, peak = 0;
    for (let n = 0; n < 600; n++) {
      cycles += vm.runCycles(26224);
      const audio = vm.drainAudio();
      frames += audio.length / 2;
      for (let i = 0; i < audio.length; i++) {
        energy[i & 1] += audio[i] ** 2;
        peak = Math.max(peak, Math.abs(audio[i]));
      }
    }
    assert(Math.abs(((ticks() - beforeTicks) & 65535) - cycles / port.symbols.MUSIC_PERIOD) < 2);
    assert(Math.abs(frames - cycles * 44100 / 1573437.5) < 2);
    assert(energy[0] > 10 && energy[1] > 10 && peak < 1);
    vm.disableAudio();
  });
  seek(menuKey);
  key(10, menuKey);
  key(13, menuKey);
  check("Original shareware blockset menu selects only its two sets", () => {
    assert.equal(vm.peek(menuBlockset), 1);
    assert.equal(vm.peek(port.symbols.TILE_BANK), 12);
  });
  key(13, menuKey);
  assert.equal(vm.peek(menuBlockset), 0);
  key(10, menuKey);
  for (const expected of [6, 4, 5]) {
    key(13, menuKey); assert.equal(vm.peek(0x1a), expected);
  }
  key(10, menuKey);
  key(13);
  check("Unmodified game rules initialize a five-column board", () => {
    assert.equal(vm.peek(0x142e), 2);
    assert.equal(vm.peek(0x142f), 0);
    assert(bytes(0x8eb, 65).every(b => b === 255));
  });
  for (let n = 0; n < 6; n++) key(8);
  assert.equal(vm.peek(0x142e), 0);
  for (let n = 0; n < 6; n++) key(21);
  check("Keyboard movement respects both original walls", () => assert.equal(vm.peek(0x142e), 4));
  const pieces = bytes(0x136b, 3);
  key(32);
  check("Keyboard rotation uses the original three-piece permutation", () =>
    assert.deepEqual(bytes(0x136b, 3), Uint8Array.from([pieces[2], pieces[0], pieces[1]])));
  key(27, 0x1215);
  const paused = bytes(0x8eb, 65), pausedY = vm.peek(0x142f);
  vm.runCycles(2_000_000);
  check("Escape pause freezes the board and falling column", () => {
    assert.deepEqual(bytes(0x8eb, 65), paused);
    assert.equal(vm.peek(0x142f), pausedY);
  });
  key(27);

  vm.addBreakpoint(0x1ac5);
  vm.runCycles(150_000_000);
  check("An uninterrupted game reaches the original game-over screen and can restart", () => {
    assert.equal(vm.pc(), 0x1ac5);
    vm.clearBreakpoints();
    key(32, menuKey);
    assert.equal(vm.peek(port.symbols.SELECTED_SONG), 1);
    key(13);
    assert.equal(vm.peek(0x971), 0);
    assert.equal(vm.peek(0x142e), 2);
  });

  check("Original matching, removal, and score routines remain executable", () => {
    call(0x14a5); call(0x14b0);
    for (const index of [5, 6, 7]) vm.poke(0x8eb + index, 2);
    vm.poke(0x1682, 0); vm.poke(0x1683, 0);
    call(0x174f); call(0x17dd); call(0x185b); call(0x1903);
    assert.equal(vm.peek(0x1682), 1);
    for (const index of [5, 6, 7]) assert.equal(vm.peek(0x92c + index), 1);
    call(0x14e9);
    for (const index of [5, 6, 7]) assert.equal(vm.peek(0x8eb + index), 255);
    assert.equal(vm.peek(0x1683), 3);
    call(0x157c);
    assert(vm.peek(0x803) || vm.peek(0x804));
  });
  check("Relocated high-score entry retains the original score and keyboard editing", () => {
    vm.poke(0x803, 0x06); vm.poke(0x804, 0x12);
    vm.loadData(0x300, Uint8Array.from([0x20, port.symbols.HIGH_SCORES & 255,
      port.symbols.HIGH_SCORES >> 8, 0xea]));
    vm.setPC(0x300);
    const highScoreKey = port.symbols.HIGH_SCORES + 0xa766 - 0xa6fa;
    seek(highScoreKey);
    for (const code of [81, 85, 65, 82, 88]) key(code, highScoreKey);
    key(13, 0x303);
    assert.equal(Buffer.from(bytes(port.symbols.MENU + 0x12, 5)).toString("ascii"), "QUARX");
    assert.equal(Buffer.from(bytes(port.symbols.MENU + 0x19, 4)).toString("ascii"), " 612");
  });
  check("Original level progression switches between both supplied gameplay songs", () => {
    for (const expected of [1, 2, 2, 1]) {
      call(0x125a);
      assert.equal(vm.peek(port.symbols.SELECTED_SONG), expected);
    }
    const expected = decodeLzsa2(files.get("MUSIC/SONG2.LZ"));
    assert.deepEqual(bytes(port.symbols.SONG_BUFFER, expected.length), expected);
  });
  check("Runtime keeps the original ROM interrupt vector visible", () => {
    assert(vm.romVisible(0xfffa));
    assert.equal(vm.peekMapped(0xfffa) | vm.peekMapped(0xfffb) << 8, 0xf1bb);
    assert.equal(vm.peek(0xce00), 0);
  });
  const reference = await boot(), originalPlayer = decodeLzsa2(files.get("MUSIC/PLAYER.LZ"));
  const originalCall = (machine, address) => {
    machine.loadData(0x300, Uint8Array.from([0x78, 0x20, address & 255, address >> 8, 0xea]));
    machine.setPC(0x300); machine.clearBreakpoints(); machine.addBreakpoint(0x304);
    const cycles = machine.runCycles(100_000);
    assert.equal(machine.pc(), 0x304, `Tracker call $${address.toString(16)}`);
    machine.clearBreakpoints();
    return cycles;
  };
  const ayRegisters = machine => {
    const registers = [];
    for (let reg = 0; reg < 14; reg++) {
      machine.writeBus(0xc401, reg); machine.writeBus(0xc400, 7); machine.writeBus(0xc400, 4);
      machine.writeBus(0xc403, 0); machine.writeBus(0xc400, 5);
      registers.push(machine.readBus(0xc401));
      machine.writeBus(0xc400, 4); machine.writeBus(0xc403, 255);
    }
    return registers;
  };
  originalCall(vm, port.symbols.MUSIC_STOP);
  for (let song = 1; song <= 3; song++) {
    const track = decodeLzsa2(files.get(`MUSIC/SONG${song}.LZ`)), ref = reference.vm;
    ref.readBus(0xc007);
    ref.loadData(0xf00, originalPlayer);
    for (const address of [0x17fd, 0x1cb8]) ref.poke(address, 0x60);
    ref.loadData(0xb000, track);
    ref.poke(0x6f, 0); ref.poke(0x6b, 1);
    originalCall(ref, 0x1d7e); originalCall(ref, 0x1d8d); originalCall(ref, 0x1b44);
    vm.loadData(port.symbols.SONG_BUFFER, track);
    vm.poke(0x6f, 0); vm.poke(0x6b, 1);
    originalCall(vm, port.symbols.MUSIC + 0xe7e);
    originalCall(vm, port.symbols.MUSIC + 0xe8d);
    originalCall(vm, port.symbols.MUSIC + 0xc44);
    const ticks = track[101] * 64 * track[100] + 64;
    let maxFrameCycles = 0;
    check(`Song ${song}: complete tracker loop matches original registers with hardware-clock correction`, () => {
      for (let tick = 0; tick < ticks; tick++) {
        originalCall(ref, 0x167d);
        maxFrameCycles = Math.max(maxFrameCycles, originalCall(vm, port.symbols.MUSIC + 0x77d));
        const expected = ayRegisters(ref), actual = ayRegisters(vm);
        for (const low of [0, 2, 4, 11]) {
          const max = low === 11 ? 65535 : 4095;
          const rawPeriod = expected[low] | expected[low + 1] << 8;
          const scaled = Math.min(max, Math.floor((rawPeriod * 20 + 6) / 13));
          expected[low] = scaled & 255; expected[low + 1] = scaled >> 8;
        }
        expected[6] = Math.min(31, Math.floor((expected[6] * 20 + 6) / 13));
        assert.deepEqual(actual, expected, `Song ${song} tick ${tick}`);
        assert.equal(vm.peek(0x70), ref.peek(0x70), "Loop-end state");
      }
      assert(maxFrameCycles < 25000, `Music frame exceeded the 25,642-cycle timer budget: ${maxFrameCycles}`);
    });
  }
  reference.vm.delete();
  vm.delete();

  for (const mode of ["wrong-rom", "speaker-only"]) {
    const alternate = await boot();
    try {
      const machine = alternate.vm;
      machine.loadData(0x800, port.prg); machine.setPC(0x800);
      if (mode === "wrong-rom") {
        machine.poke(0xfa87, 0x46);
        machine.addBreakpoint(port.symbols.ROM_HALTED);
        machine.runCycles(5_000_000);
        check("Guest rejects a different ROM interrupt ABI with an explicit on-screen error", () => {
          assert.equal(machine.pc(), port.symbols.ROM_HALTED);
          assert(alternate.textScreen().join("\n").includes("3RIC ROM MISMATCH - RESET"));
        });
      } else {
        machine.addBreakpoint(port.symbols.NOTICE_KEY);
        machine.runCycles(30_000_000);
        assert.equal(machine.pc(), port.symbols.NOTICE_KEY);
        machine.clearBreakpoints(); machine.keyDown(27);
        machine.addBreakpoint(menuKey); machine.runCycles(5_000_000);
        assert.equal(machine.pc(), menuKey);
        machine.clearBreakpoints(); machine.keyDown(13);
        machine.addBreakpoint(0x118d); machine.runCycles(5_000_000);
        check("Escape at the shareware notice permits speaker-only gameplay", () => {
          assert.equal(machine.pc(), 0x118d);
          assert.equal(machine.peek(0) & 1, 0);
          assert.equal(machine.readBus(0xc40e) & 127, 0);
          assert.equal(machine.peek(port.symbols.MUSIC_TICKS), 0);
        });
      }
    } finally { alternate.vm.delete(); }
  }

  const sd = await boot({ sd: fs.readFileSync(path.join(root, "web", "data", "sd.sparse")) });
  try {
    const machine = sd.vm;
    const type = text => {
      machine.drainOutput();
      for (const char of text) {
        let budget = 5_000_000;
        while (machine.peek(0xc000) & 128) {
          budget -= machine.runCycles(10000);
          assert(budget > 0, "ROM did not consume SD command input");
        }
        machine.keyDown(char.charCodeAt(0));
        machine.runCycles(10000);
      }
    };
    machine.loadData(0x800, port.prg);
    type(`BSAVE QXTEST.PRG 0800 ${port.prg.length.toString(16).toUpperCase()}\r`);
    let output = "";
    for (let n = 0; n < 40 && !output.includes(">"); n++) {
      machine.runCycles(10_000_000);
      output += machine.drainOutput();
    }
    assert(output.includes(">"), "ROM BSAVE did not return to the DOS prompt");
    const reads = machine.sdReadCount();
    machine.loadData(0x800, new Uint8Array(port.prg.length));
    machine.addBreakpoint(port.symbols.INIT);
    type("BRUN QXTEST.PRG 0800\r");
    machine.runCycles(100_000_000);
    check("ROM BSAVE/BRUN round-trip loads the packed PRG through real FAT32 and SPI", () => {
      assert.equal(machine.pc(), port.symbols.INIT);
      assert(machine.sdReadCount() > reads);
      assert.deepEqual(Uint8Array.from({ length: 0xb700 }, (_, n) => machine.peek(0x900 + n)),
        port.image.subarray(0x900));
    });
  } finally { sd.vm.delete(); }

  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "3ric-quarx-cli-"));
  const outputPrefix = path.join(outputDirectory, "QUARX");
  const generated = [".prg", ".woz", ".json"].map(extension => outputPrefix + extension);
  try {
    const args = [path.join(root, "codegen", "tools", "port-quarx.mjs"),
      path.resolve(process.argv[diskIndex + 1]), outputPrefix];
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    if (first.error) throw first.error;
    assert.equal(first.status, 0, first.stderr);
    check("CLI emits reproducible PRG/WOZ artifacts and refuses to overwrite them", () => {
      assert.deepEqual(fs.readFileSync(generated[0]), Buffer.from(port.prg));
      assert.deepEqual(fs.readFileSync(generated[1]), Buffer.from(port.woz));
      const report = JSON.parse(fs.readFileSync(generated[2], "utf8"));
      assert.equal(report.prgSha256, sha256(port.prg));
      assert.equal(report.wozSha256, sha256(port.woz));
      assert.equal(report.physicalBoardVerified, false);
      const second = spawnSync(process.execPath, args, { encoding: "utf8" });
      assert.equal(second.status, 1);
      assert.match(second.stderr, /already exist/);
      assert.equal(sha256(fs.readFileSync(generated[0])), report.prgSha256);
      assert.equal(sha256(fs.readFileSync(process.argv[diskIndex + 1])), before);
    });
  } finally {
    for (const file of generated) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(outputDirectory);
  }

  const nativeIndex = process.argv.indexOf("--native");
  if (nativeIndex >= 0) {
    const executable = process.argv[nativeIndex + 1];
    assert(executable, "--native needs a compiled harness path");
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "3ric-quarx-"));
    const disk = path.join(temporary, "quarx.woz");
    try {
      fs.writeFileSync(disk, port.woz);
      const run = spawnSync(executable, [path.join(root, "emulator", "Data", "badger6502.bin"), disk,
        port.symbols.INIT.toString(16), port.symbols.NOTICE_KEY.toString(16),
        menuKey.toString(16)], { encoding: "utf8" });
      process.stdout.write(run.stdout || ""); process.stderr.write(run.stderr || "");
      if (run.error) throw run.error;
      assert.equal(run.status, 0, "Native physical-keyboard integration");
      passed++;
    } finally {
      if (fs.existsSync(disk)) fs.unlinkSync(disk);
      fs.rmdirSync(temporary);
    }
  }
} else {
  console.log("Game integration NOT RUN: supply --disk <local a2quarx-sw.po> after web\\build.ps1.");
}
console.log(`${passed} Quarx checks passed.`);
