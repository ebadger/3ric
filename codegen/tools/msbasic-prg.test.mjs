// msbasic-prg.test.mjs — BASIC.PRG, MS-BASIC for 3RIC DOS (specs/ROM-SOFTWARE.md): the
// image, glue and refusals, then WASM runs through the real ROM DOS and SPI SD emulation
// with the BASIC RAM scrubbed, as at a physical power-on: BRUN from a subdirectory,
// SAVE/LOAD in that directory, replacement, errors and the ROM guard.
// Build the emulator first: pwsh web/build.ps1
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import harness from "./harness.cjs";
import { buildSparseFat32 } from "./ultima5/fat32.mjs";
import { BASIC_END, BASIC_START, GUARD_START, buildMsBasicImage } from "./msbasic-woz.mjs";
import { COPY_ORG, MESSAGES, MISMATCH_TEXT, PRG_ORG, ZP_SAVE, buildMsBasicPrg, readDbgSymbols } from "./msbasic-prg.mjs";

const PRIMARY = 0, BASIC_ROM = 1; // MemoryReadMapping
const rom = readFileSync(join(harness.DATA_DIR, "badger6502.bin"));
const dbg = readFileSync(join(harness.DATA_DIR, "badger6502.dbg"), "utf8");
const { symbols } = readDbgSymbols(dbg);
const built = buildMsBasicPrg(rom, dbg);
const hex = value => "$" + value.toString(16).toUpperCase();

// --- the file ---------------------------------------------------------------------------
assert.equal(built.glueOrg, 0x8d00, "the LOAD/SAVE glue takes the three pages below the interpreter");
assert.equal(built.prg.length, COPY_ORG - PRG_ORG + (BASIC_END - built.glueOrg));
assert.deepEqual(built.prg.subarray(COPY_ORG - PRG_ORG, COPY_ORG - PRG_ORG + built.glue.length), built.glue);
assert.deepEqual(built.prg.subarray(COPY_ORG - PRG_ORG + built.glue.length), built.image);
const jmpTo = (site, target) => [...built.image.subarray(site - BASIC_START, site - BASIC_START + 3)].join() === [0x4c, target & 0xff, target >> 8].join();
assert.ok(jmpTo(symbols.SAVE, built.hooks.save), "SAVE jumps to the DOS glue");
assert.ok(jmpTo(symbols.LOAD, built.hooks.load), "LOAD jumps to the DOS glue");
// Apart from those six bytes, the interpreter is the boot disk's, with BASIC's memory top
// (in the resident probe/clamp code) moved down to the glue.
const disk = buildMsBasicImage(rom);
const resident = built.hooks.start;
assert.equal(resident, disk.hooks.start);
for (let address = BASIC_START; address < BASIC_END; address++) {
  const i = address - BASIC_START;
  if (built.image[i] === disk.image[i]) continue;
  const patched = address - symbols.SAVE < 3 || address - symbols.LOAD < 3;
  assert.ok(patched && address >= symbols.SAVE || address >= resident, `only SAVE, LOAD and the memory top differ (${hex(address)})`);
  if (address >= resident) assert.equal(built.image[i], built.glueOrg >> 8, "the resident differs only in its top page");
}
for (const [name, address] of Object.entries(built.rom))
  if (symbols[name] !== undefined) assert.equal(address, symbols[name], `${name} comes from the ROM's symbols`);
assert.ok(symbols.CHRGET >= ZP_SAVE.start && symbols.TXTPTR < ZP_SAVE.start + ZP_SAVE.length, "LOAD/SAVE save BASIC's CHRGET");
console.log("PASS BASIC.PRG = loader + glue + the boot disk's interpreter with SAVE/LOAD redirected");

const variant = edit => { const copy = Buffer.from(rom); edit(copy); return copy; };
assert.throws(() => buildMsBasicPrg(variant(r => { r[symbols.fat32_open_cd + 4] ^= 0xff; }), dbg), /fat32_open_cd/);
assert.throws(() => buildMsBasicPrg(variant(r => { r[symbols.SAVE + 4] = 0xea; }), dbg), /cassette SAVE/);
assert.throws(() => buildMsBasicPrg(rom, dbg.replace(/name="FRMEVL",(.*?)val=0x[0-9A-F]+/, 'name="FRMEVL",$1val=0x9993')), /FRMEVL/);
console.log("PASS ROMs or debug symbols this port does not recognize are refused");

// --- running it -------------------------------------------------------------------------
const README = Uint8Array.from("NOT A PROGRAM\r", char => char.charCodeAt(0));
const card = (prg = built.prg) => buildSparseFat32({
  "ROOT.TXT": README,
  PROGS: { "BASIC.PRG": prg, "README.TXT": README, "BIG.BIN": new Uint8Array(40000), DATA: { "X.TXT": README } },
});
const scrub = address => (address * 151 + 77) & 0xff;

async function bootCard(prg) {
  const session = await harness.boot({ sd: card(prg) });
  const { vm } = session;
  // As at power-on: nothing of BASIC in the RAM below or under the overlay.
  for (let address = built.glueOrg; address < BASIC_END; address++) vm.poke(address, scrub(address));
  return session;
}

function driver(session) {
  const { vm } = session;
  const rows = () => session.textScreen();
  const screen = () => rows().join("\n");
  const type = text => {
    for (const char of text) {
      for (let t = 0; t < 2000 && (vm.peek(0xc000) & 0x80); t++) vm.runCycles(2000);
      vm.keyDown(char === "\r" ? 13 : char.charCodeAt(0));
      vm.runCycles(25_000);
    }
  };
  const until = (done, what, budget = 80_000_000) => {
    for (let used = 0; used < budget; used += 100_000) {
      vm.runCycles(100_000);
      if (done()) return;
      if (vm.breakpointHit()) assert.fail(`breakpoint at ${hex(vm.pc())} while waiting for ${what}`);
    }
    assert.fail(`timed out waiting for ${what}:\n${screen()}`);
  };
  const lastRow = () => rows().filter(row => row.trim()).at(-1) ?? "";
  // Type a line at a prompt ("]" or the shell's ">") and wait for the next one; returns
  // the rows printed in between.
  const command = (line, prompt = "]") => {
    const echo = prompt + line.toUpperCase();
    type(`${line}\r`);
    const ready = new RegExp(`^\\${prompt}\`?$`);
    until(() => ready.test(lastRow()) && rows().some(row => row.startsWith(echo)), `${line} to finish`);
    const all = rows().filter(row => row.trim());
    const at = all.findLastIndex(row => row.startsWith(echo));
    return all.slice(at + 1, -1).join("\n");
  };
  return { vm, screen, type, until, command };
}

const ok = await bootCard();
try {
  const { vm, screen, type, until, command } = driver(ok);
  command("CD PROGS", ">");
  const cd = vm.peek(0xcc20) | (vm.peek(0xcc21) << 8);
  type("BRUN BASIC.PRG 0800\r");
  until(() => /MEMORY SIZE\?/.test(screen()), "MEMORY SIZE?");
  assert.equal(vm.memoryMapping(BASIC_START), PRIMARY);
  assert.ok(built.image.every((byte, i) => vm.peek(BASIC_START + i) === byte), "the interpreter is in overlay RAM");
  assert.ok(built.glue.every((byte, i) => vm.peek(built.glueOrg + i) === byte), "the glue is below it");
  type("\r");
  until(() => /BYTES FREE/.test(screen()), "the cold start");
  until(() => /^\]`?$/.test(screen().split("\n").filter(row => row.trim()).at(-1)), "the first prompt");
  assert.match(screen(), / 34047 BYTES FREE/);
  assert.equal(vm.peek(0x76) | (vm.peek(0x77) << 8), built.glueOrg, "MEMSIZ stops at the glue");
  console.log("PASS BRUN BASIC.PRG 0800 from a subdirectory starts BASIC from scrubbed RAM: 34047 BYTES FREE");

  // Any statement or prompt executed from the ROM overlay instead of RAM would stop here.
  for (const name of ["RESTART", "NEWSTT"]) vm.addMappedBreakpoint(symbols[name], BASIC_ROM);
  const listing = ["10 PRINT \"HELLO FROM SD\"", "20 FOR I=1 TO 3:PRINT I*I;:NEXT"];
  for (const line of listing) command(line);
  assert.equal(command("SAVE \"hello.bas\""), "", "SAVE (lower-case name) completes silently");
  assert.equal(command("NEW"), "");
  assert.equal(command("LIST"), "");
  assert.equal(command("LOAD \"HELLO.BAS\""), "");
  assert.equal(command("LIST"), listing.map(line => ` ${line}`).join("\n"));
  assert.equal(command("RUN"), "HELLO FROM SD\n 1  4  9");
  assert.equal(vm.peek(0xcc20) | (vm.peek(0xcc21) << 8), cd, "the DOS current directory is unchanged");
  console.log("PASS SAVE \"NAME\", NEW and LOAD \"NAME\" round-trip a program through the SD card");

  command("30 PRINT \"VERSION 2\"");
  command("SAVE \"HELLO.BAS\"");
  command("NEW");
  command("LOAD \"HELLO.BAS\"");
  assert.equal(command("RUN"), "HELLO FROM SD\n 1  4  9 VERSION 2", "SAVE replaced the file");
  command("NEW");
  for (const line of ["10 A$=\"P2\"", "20 SAVE A$:PRINT \"SAVED \";A$", "30 LOAD \"NOPE\"", "40 PRINT \"NOT REACHED\""]) command(line);
  assert.equal(command("RUN"), "SAVED P2\n?FILE NOT FOUND ERR IN  30",
    "SAVE takes a string expression; a running program continues after it and stops on a LOAD error");
  command("NEW");
  command("LOAD \"P2\"");
  assert.match(command("LIST"), /^ 10 A\$="P2"\n 20 SAVE A\$:PRINT "SAVED ";A\$/);
  console.log("PASS SAVE replaces a file; SAVE/LOAD work inside a running program, with errors IN <line>");

  for (const [line, expected] of [
    ["LOAD \"NOPE\"", `?${MESSAGES.notFound} ERR`],
    ["LOAD \"DATA\"", `?${MESSAGES.typeMismatch} ERR`],
    ["SAVE \"DATA\"", `?${MESSAGES.typeMismatch} ERR`],
    ["SAVE \"TWO WORDS\"", `?${MESSAGES.badName} ERR`],
    ["SAVE \"TOOLONGNAME\"", `?${MESSAGES.badName} ERR`],
    ["SAVE \"A.LONG\"", `?${MESSAGES.badName} ERR`],
    ["SAVE \"WILD*\"", `?${MESSAGES.badName} ERR`],
    ["SAVE \".X\"", `?${MESSAGES.badName} ERR`],
    ["SAVE \"\"", `?${MESSAGES.badName} ERR`],
    ["SAVE 5", "?TYPE MISMATCH ERR"],
    ["SAVE \"JUNK\" X", "?SYNTAX ERR"],
    ["LOAD \"BIG.BIN\"", "?OUT OF MEMORY ERR"],
  ]) assert.equal(command(line), expected, line);
  assert.match(command("LIST"), /^ 10 A\$="P2"/, "failed commands leave the program alone");
  assert.equal(command("LOAD \"JUNK\""), `?${MESSAGES.notFound} ERR`, "a SAVE followed by junk writes nothing");
  assert.equal(command("LOAD \"README.TXT\""), `?${MESSAGES.typeMismatch} ERR`);
  assert.equal(command("LIST"), "", "a file that is not a program is not kept");
  assert.equal(command("PRINT 6*7"), " 42", "BASIC is healthy after every error");
  console.log("PASS missing files, directories, bad names, non-programs and oversized files fail cleanly");
  vm.clearBreakpoints();

  vm.reset();
  until(() => /^>`?$/.test(screen().split("\n").filter(row => row.trim()).at(-1)), "the DOS prompt after reset");
  command("CD PROGS", ">");
  const dir = command("DIR", ">");
  for (const name of ["HELLO", "P2", "BASIC"]) assert.equal(dir.split(/\s+/).filter(word => word.startsWith(name)).length, 1, `${name} listed once:\n${dir}`);
  assert.ok(!/JUNK|TOOLONG|WILD/.test(dir), "rejected names were never created");
  command("CD ..", ">");
  assert.ok(!/HELLO|P2/.test(command("DIR", ">")), "the programs went to the current directory, not the root");
  console.log("PASS the DOS lists each saved program once, in the directory BASIC was started from");
} finally {
  ok.vm.delete();
}

const foreign = buildMsBasicPrg(variant(r => { r[GUARD_START + 0x123] ^= 0x5a; }), dbg);
assert.notDeepEqual(foreign.guard, built.guard);
const refused = await bootCard(foreign.prg);
try {
  const { vm, command } = driver(refused);
  command("CD PROGS", ">");
  assert.equal(command("BRUN BASIC.PRG 0800", ">"), MISMATCH_TEXT, "the loader reports the mismatch and returns to DOS");
  for (let address = built.glueOrg; address < BASIC_END; address++)
    assert.equal(vm.peek(address), scrub(address), "RAM under and below the overlay is untouched");
  console.log("PASS a BASIC.PRG built from a different ROM returns to the DOS prompt before loading");
} finally {
  refused.vm.delete();
}
