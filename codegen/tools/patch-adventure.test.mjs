import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildWozFromDsk } from "./wozgen.mjs";
import { patchWozSectors, readWozSectors, sha256 } from "./wozedit.mjs";
import {
  APPLESOFT_TOKEN_MAP,
  buildPayload,
  DBG_SHA256,
  INPUT_DSK_SHA256,
  INPUT_WOZ_SHA256,
  patchAdventure,
  retokenizeApplesoft,
  ROM_SHA256,
} from "./patch-adventure.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const dbgText = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.dbg"), "utf8");
const coordinates = Array.from({ length: 560 }, (_, i) => ({ track: i >> 4, sector: i & 15 }));
export const payload = buildPayload(rom, dbgText);
export const symbols = payload.symbols;

const SCREEN_ROWS = [
  0x0400, 0x0480, 0x0500, 0x0580, 0x0600, 0x0680, 0x0700, 0x0780,
  0x0428, 0x04a8, 0x0528, 0x05a8, 0x0628, 0x06a8, 0x0728, 0x07a8,
  0x0450, 0x04d0, 0x0550, 0x05d0, 0x0650, 0x06d0, 0x0750, 0x07d0,
];

function dumpScreen(vm) {
  return SCREEN_ROWS.map(base => {
    let s = "";
    for (let c = 0; c < 40; c++) {
      const ch = vm.peek(base + c) & 0x7f;
      s += ch >= 0x20 && ch < 0x7f ? String.fromCharCode(ch) : " ";
    }
    return s.trimEnd();
  }).filter(Boolean).join("\n");
}

export function type(vm, text) {
  for (const ch of text) {
    for (let i = 0; i < 200 && (vm.peek(0xc000) & 0x80); i++) vm.runCycles(10000);
    assert.equal(vm.peek(0xc000) & 0x80, 0, "Previous keyboard strobe was not consumed");
    vm.keyDown(ch.charCodeAt(0));
    vm.runCycles(300000);
  }
}

function sendLine(vm, str) {
  type(vm, `${str}\r`);
}

function waitUntil(vm, predicate, maxSteps = 120) {
  for (let i = 0; i < maxSteps; i++) {
    vm.runCycles(2000000);
    const pc = vm.pc();
    const atKeyin = pc === 0xfd1b || pc === 0xfd1d || pc === 0xfd21 || pc === 0xfd24;
    const curlin = vm.peek(0x78) | (vm.peek(0x79) << 8);
    const screen = dumpScreen(vm);
    if (predicate({ pc, atKeyin, curlin, screen })) return { pc, atKeyin, curlin, screen };
  }
  assert.fail(`Timed out waiting for condition; last screen:\n${dumpScreen(vm)}`);
}

function testSyntheticPayloadAndRetokenizer() {
  assert.equal(sha256(rom), ROM_SHA256);
  assert.equal(sha256(Buffer.from(dbgText.replace(/\r\n/g, "\n"))), DBG_SHA256);

  // Verify KIM-1 FMULT ROR RESULT+2 fix at $D5C7 (offset $15C7 in relocated LC BASIC).
  assert.equal(payload.lc[0x15c7], 0x66, "FMULT at $D5C7 must use ROR zp ($66), not RMB6 ($67)");
  assert.equal(payload.lc[0x15c8], 0x67);

  // Verify stage1a/stage1b/stage2 and extension bounds.
  assert(payload.stage1a.bytes.length <= 20, "stage1a exceeds $BFC8..$BFDB");
  assert(payload.stage1b.bytes.length <= 16, "stage1b exceeds $BFA8..$BFB7");
  assert(payload.stage2.bytes.length <= 256, "stage2 exceeds 1 sector");
  assert(payload.ext.org === 0xee10 && payload.ext.org + payload.ext.bytes.length <= 0xefbb);

  // Verify Applesoft-to-3ric token translation leaves string literals and REM bodies intact.
  const syntheticLine = Buffer.from([
    0x16, 0x08, // next line pointer
    0x0a, 0x00, // line 10
    0xba,       // Applesoft PRINT ($BA -> $96)
    0x22, 0xba, 0xc9, 0x22, // quoted string containing raw bytes $BA, $C9 (must not change)
    0x3a,       // ':'
    0xb2,       // Applesoft REM ($B2 -> $83)
    0xba, 0xc9, // REM comment bytes (must not change)
    0x00,       // end of line
    0x00, 0x00, // end of program
  ]);
  const retok = retokenizeApplesoft(syntheticLine);
  assert.equal(retok[4], APPLESOFT_TOKEN_MAP.get(0xba));
  assert.equal(retok[6], 0xba, "Bytes inside quotes must not be retokenized");
  assert.equal(retok[7], 0xc9, "Bytes inside quotes must not be retokenized");
  assert.equal(retok[10], 0x83, "Applesoft REM ($B2) must map to 3ric REM ($83)");
  assert.equal(retok[11], 0xba, "Bytes after REM must not be retokenized");
  assert.equal(retok[12], 0xc9, "Bytes after REM must not be retokenized");
  console.log("PASS synthetic MSBASIC relocation, FMULT fix, bounds, and Applesoft retokenizer");
}

async function bootDisk(woz, firmware = rom) {
  const create = require(path.join(root, "web", "badger6502.js"));
  const module = await create();
  const vm = new module.WebVM();
  try {
    vm.loadData(0, firmware.subarray(0, 65536));
    vm.seedBasicRom();
    vm.loadFont(fs.readFileSync(path.join(root, "emulator", "Data", "fontrom.dat")));
    vm.reset();
    vm.runCycles(5000000);
    assert(vm.insertDisk(0, woz), "Disk was not inserted");
    sendLine(vm, "MON");
    assert.match(vm.drainOutput(), /\*/, "MON did not enter the monitor");
    sendLine(vm, "C600G");
    return vm;
  } catch (error) {
    vm.delete();
    throw error;
  }
}

async function testImage(input) {
  const hash = sha256(input);
  assert(
    hash === INPUT_DSK_SHA256 || hash === INPUT_WOZ_SHA256,
    `Unexpected input SHA-256 ${hash}`
  );
  const result = patchAdventure(input, rom, dbgText);
  if (input.length === 143360) {
    const fromWoz = patchAdventure(Buffer.from(buildWozFromDsk(input)), rom, dbgText);
    assert.deepEqual(result.woz, fromWoz.woz, "DSK and WOZ inputs must produce identical output");
  }
  assert.deepEqual(
    result.baseWoz,
    patchWozSectors(
      result.woz,
      result.patches.map(patch => ({ ...patch, before: patch.after, after: patch.before }))
    ),
    "Reversing sector patches must reproduce base WOZ image byte-for-byte"
  );
  assert.equal(readWozSectors(result.woz, coordinates).length, 560);

  const wrongInput = Buffer.from(input);
  wrongInput[0] ^= 1;
  assert.throws(() => patchAdventure(wrongInput, rom, dbgText), /Unsupported Adventure image/);

  const wrongRom = Buffer.from(rom);
  wrongRom[0xb500] ^= 1;
  assert.throws(() => buildPayload(wrongRom, dbgText), /Unsupported 3ric ROM/);
  assert.throws(() => buildPayload(rom, dbgText + "\n"), /Unsupported 3ric DBG/);
  console.log("PASS exact-image guards, all 560 sectors, and reversible full-image patch");

  // Verify on-machine ROM ABI mismatch rejection.
  const romMismatch = await bootDisk(result.woz, wrongRom);
  try {
    romMismatch.runCycles(50000000);
    const message = "3RIC ROM MISMATCH - RESET";
    const topLine = Buffer.from(
      Array.from({ length: message.length }, (_, i) => romMismatch.peek(0x0400 + i) & 0x7f)
    ).toString();
    assert.equal(topLine, message);
    assert.equal(romMismatch.textMode(), 1);
    console.log("PASS on-machine ROM mismatch rejection");
  } finally {
    romMismatch.delete();
  }

  // Verify full cold boot, CHAIN into PART TWO, lo-res title, LC NMI safety, gameplay, and SAVE error handling.
  const vm = await bootDisk(result.woz);
  try {
    // 1. Wait for the hi-res title screen ("AN EXERCISE IN FANTASY").
    waitUntil(vm, ({ screen }) => screen.includes("AN EXERCISE IN FANTASY"));
    assert.equal(vm.textMode(), 0, "Title screen should use graphics mode");
    assert.equal(vm.lores(), 0, "Title screen should use hi-res graphics mode ($2000)");
    assert.equal(vm.romVisible(0xd000), false, "Language Card RAM must be active at $D000..$FFFF");
    assert.equal(vm.peekMapped(0xfffa) | (vm.peekMapped(0xfffb) << 8), symbols.LC_NMI);

    // 2. Wait for the "SAVED ON DISK?" prompt in ADVENTURE.
    waitUntil(vm, ({ atKeyin, screen }) => atKeyin && screen.includes("SAVED ON DISK?"));
    assert.equal(vm.textMode(), 1, "Prompt after title screen should return to text mode");

    // 3. Trigger a real hardware NMI via VIA1 Timer 1 ($C20E/$C204/$C205) while Language Card RAM is active
    //    and verify ROM is mapped inside nmi_banked ($B6A9) and LC RAM is restored on RTI.
    const savedA = vm.regA();
    const savedX = vm.regX();
    const savedY = vm.regY();
    const savedSP = vm.sp();
    vm.writeBus(0xc20d, 0x7f); // Clear any pending VIA1 IFR flags so NMI edge can fire
    vm.writeBus(0xc20e, 0xc0); // Enable VIA1 Timer 1 NMI
    vm.writeBus(0xc204, 0x10); // T1C_L = 16 cycles
    vm.writeBus(0xc205, 0x00); // T1C_H = 0 (starts countdown)
    assert(vm.addBreakpoint(0xb6a9));
    vm.runCycles(50000);
    vm.removeBreakpoint(0xb6a9);
    assert(vm.breakpointHit(), "VIA1 Timer 1 NMI did not vector through LC_NMI to $B6A9");
    assert.equal(vm.romVisible(0x9000), true, "Banked ROM must be visible at $9000 during NMI");
    assert.equal(vm.romVisible(0xd000), true, "Main ROM must be visible at $D000 during NMI");
    assert(vm.addBreakpoint(0xbfb1)); // nmi_resume
    vm.runCycles(50000);
    vm.removeBreakpoint(0xbfb1);
    assert(vm.breakpointHit(), "NMI did not return through nmi_resume ($BFB1)");
    for (let i = 0; i < 6; i++) vm.step(); // bit $C080, jmp lc_resume, ply, bra nmi_more, lda $C20D, bmi, pla, rti
    while (vm.sp() !== savedSP) vm.step();
    vm.writeBus(0xc20e, 0x40); // Disable VIA1 Timer 1 NMI
    assert.equal(vm.romVisible(0x9000), false, "$9000 RAM must be restored after NMI");
    assert.equal(vm.romVisible(0xd000), false, "Language Card RAM must be restored after NMI");
    assert.equal(vm.regA(), savedA);
    assert.equal(vm.regX(), savedX);
    assert.equal(vm.regY(), savedY);
    assert.equal(vm.sp(), savedSP);
    console.log("PASS hardware NMI through LC_NMI and nmi_resume preserves registers and LC RAM mapping");

    // 4. Answer "N" to "SAVED ON DISK?", wait for CHAIN into PART TWO ("INSTRUCTIONS ?"), answer "N".
    sendLine(vm, "N");
    waitUntil(vm, ({ atKeyin, screen }) => atKeyin && screen.includes("INSTRUCTIONS ?"));
    sendLine(vm, "N");
    waitUntil(vm, ({ atKeyin, curlin, screen }) =>
      atKeyin && curlin === 2320 && screen.includes("STANDING AT THE END OF A ROAD"));

    // 5. Walk above ground, unlock grate, descend underground, capture bird, check SCORE, and test SAVE + RESTORE.
    const steps = [
      ["EAST", /INSIDE A BUILDING/i],
      ["TAKE KEYS", /\bOK\b/i],
      ["TAKE LAMP", /\bOK\b/i],
      ["WEST", /END OF A ROAD|AT END OF ROAD/i],
      ["SOUTH", /VALLEY/i],
      ["SOUTH", /2-INCH SLIT/i],
      ["SOUTH", /STEEL GRATE|OUTSIDE GRATE/i],
      ["UNLOCK GRATE", /GRATE IS NOW UNLOCKED/i],
      ["DOWN", /SMALL CHAMBER BENEATH|BELOW THE GRATE/i],
      ["LAMP ON", /LAMP IS NOW ON/i],
      ["WEST", /COBBLE/i],
      ["TAKE CAGE", /\bOK\b/i],
      ["WEST", /DEBRIS ROOM/i],
      ["TAKE ROD", /\bOK\b/i],
      ["WEST", /AWKWARD SLOPING/i],
      ["WEST", /SPLENDID CHAMBER|BIRD CHAMBER/i],
      ["DROP ROD", /\bOK\b/i],
      ["TAKE BIRD", /\bOK\b|CATCHABLE/i],
      ["TAKE ROD", /\bOK\b/i],
      ["INVENTORY", /LITTLE BIRD IN CAGE/i],
    ];
    for (const [cmd, expected] of steps) {
      sendLine(vm, cmd);
      const { screen } = waitUntil(vm, ({ atKeyin, curlin }) => {
        if (atKeyin && curlin === 1018) {
          type(vm, " ");
          return false;
        }
        return atKeyin && curlin === 2320;
      });
      assert.match(screen, expected, `Unexpected screen after ${cmd}:\n${screen}`);
    }

    // Check SCORE ("SCORE:", "350", "WISH TO QUIT NOW?" -> "N").
    sendLine(vm, "PR#1");
    const prState = waitUntil(vm, ({ atKeyin, curlin }) => atKeyin && curlin === 2320);
    assert.match(prState.screen, /NO PRINTER AVAILABLE/i);

    sendLine(vm, "SCORE");
    const scoreState = waitUntil(vm, ({ atKeyin, curlin }) => atKeyin && curlin === 1050);
    assert.match(scoreState.screen, /350/);
    sendLine(vm, "N");
    waitUntil(vm, ({ atKeyin, curlin }) => atKeyin && curlin === 2320);

    // Check SAVE (exercises VERIFY error 6 -> ONERR GOTO 9000 -> PEEK(222)=6 -> GOTO 6020 -> NEW : END)
    // and RUN ADVENTURE restart + restore ONERR GOTO 5000 handling.
    sendLine(vm, "SAVE");
    waitUntil(vm, ({ atKeyin, curlin }) => atKeyin && curlin === 6005);
    sendLine(vm, "TEST");
    waitUntil(vm, ({ atKeyin, curlin }) => atKeyin && curlin === 6011);
    type(vm, "\r");
    const saveState = waitUntil(vm, ({ atKeyin, curlin }) => atKeyin && (curlin === 6060 || curlin === 65280));
    assert.match(saveState.screen, /SAVING 'ADGMTEST'\.\.\./i);
    sendLine(vm, "RUN ADVENTURE");
    waitUntil(vm, ({ atKeyin, screen }) => atKeyin && screen.includes("SAVED ON DISK?"));
    console.log("PASS cold boot, CHAIN, hi-res title, underground traversal, bird capture, POP, SCORE, SAVE ONERR, and RUN ADVENTURE");
  } finally {
    vm.delete();
  }
}

async function main(args) {
  assert(
    args.length === 0 || (args.length === 2 && (args[0] === "--dsk" || args[0] === "--woz")),
    "Usage: node codegen\\tools\\patch-adventure.test.mjs [--dsk <adventure.dsk> | --woz <adventure.woz>]"
  );
  testSyntheticPayloadAndRetokenizer();
  if (args.length) await testImage(fs.readFileSync(args[1]));
  else console.log("SKIP owner-supplied disk integration (pass --dsk <adventure.dsk> or --woz <adventure.woz>)");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
