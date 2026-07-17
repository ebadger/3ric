const fs = require("fs");
const path = require("path");
const createBadgerVM = require("./badger6502.js");
const {
  bindSourceMappings,
  buildSourceListing,
  isSourceRowActive,
  lookupRomLocation,
  parseCa65Debug,
  stepOverTarget,
} = require("./debugger.js");

let failures = 0;
function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `: ${detail}`}`);
}

(async () => {
  const { assemble } = await import("../codegen/tools/asm6502.mjs");
  const source = [
    ".org $0800",
    "start: lda #1",
    "       jsr sub",
    "       sta $2000",
    "       brk",
    "sub:   inx",
    "       rts",
  ].join("\n");
  const assembled = assemble(source);
  const listing = buildSourceListing(source, assembled.listing);
  check("source listing maps line to PC",
    listing[1].address === 0x0802 && listing[1].line === 3 && listing[1].source.includes("jsr sub"));
  check("source listing marks executable rows",
    listing.every((row) => row.kind === "instruction"));
  check("source listing starts unbound",
    listing.every((row) => row.mapping === null));

  const debugText = fs.readFileSync(
    path.join(__dirname, "..", "emulator", "Data", "badger6502.dbg"), "utf8");
  const romDebug = parseCa65Debug(debugText);
  const cout = romDebug.lookup(0xFDED);
  check("ROM debug resolves COUT symbol",
    cout && cout.symbol && cout.symbol.name === "COUT",
    JSON.stringify(cout));
  check("ROM debug resolves COUT source coordinate",
    cout && cout.symbol && cout.symbol.file === "apple2rom.s" && cout.symbol.line === 1058,
    JSON.stringify(cout));
  check("ROM debug excludes RAM symbols", romDebug.lookup(0x0800) === null);
  check("ROM debug excludes zero-page source", romDebug.lookup(0x0036) === null);
  check("ROM debug excludes device equates", romDebug.lookup(0xC100) === null);

  const Module = await createBadgerVM();
  const vm = new Module.WebVM();
  bindSourceMappings(listing, (address) => vm.memoryMapping(address));
  check("source listing binds loaded memory mapping",
    isSourceRowActive(listing[0], vm.memoryMapping(listing[0].address)));
  bindSourceMappings(listing, () => null);
  check("source listing unbinds when its image is replaced",
    !isSourceRowActive(listing[0], vm.memoryMapping(listing[0].address)));

  vm.poke(0x9000, 0x20);
  vm.seedBasicRom();
  vm.poke(0x9000, 0xEA);
  vm.writeBus(0xC006, 0);
  check("mapped peek sees BASIC ROM opcode",
    vm.peek(0x9000) === 0xEA && vm.peekMapped(0x9000) === 0x20);
  check("step-over recognizes BASIC ROM JSR",
    stepOverTarget(0x9000, vm.peekMapped(0x9000)) === 0x9003);
  check("ROM correlation follows visible BASIC bank",
    vm.romVisible(0x9000) && lookupRomLocation(romDebug, 0x9000, vm.romVisible(0x9000)));

  vm.writeBus(0xC007, 0);
  const basicProgramMapping = vm.memoryMapping(0x9000);
  check("mapped peek sees BASIC RAM opcode",
    vm.peekMapped(0x9000) === 0xEA && !vm.romVisible(0x9000));
  check("ROM correlation hides banked BASIC RAM",
    lookupRomLocation(romDebug, 0x9000, vm.romVisible(0x9000)) === null);

  vm.clearBreakpoints();
  check("rejects invalid mapped breakpoint",
    !vm.addMappedBreakpoint(0x9000, -1));
  check("adds mapping-qualified breakpoint",
    vm.addMappedBreakpoint(0x9000, basicProgramMapping));
  vm.writeBus(0xC006, 0);
  vm.setPC(0x9000);
  const aliasedBasicCycles = vm.run(1);
  check("source breakpoint ignores aliased BASIC ROM",
    aliasedBasicCycles > 0 && !vm.breakpointHit());
  check("source highlighting ignores aliased BASIC ROM",
    !isSourceRowActive({ mapping: basicProgramMapping }, vm.memoryMapping(0x9000)));
  vm.addBreakpoint(0x9000);
  vm.setPC(0x9000);
  const manualBasicCycles = vm.run(1);
  check("manual breakpoint remains unconditional over source qualifier",
    manualBasicCycles === 0 && vm.breakpointHit());
  vm.removeBreakpoint(0x9000);
  vm.addMappedBreakpoint(0x9000, basicProgramMapping);
  vm.writeBus(0xC007, 0);
  vm.setPC(0x9000);
  const primaryBasicCycles = vm.run(1);
  check("source breakpoint returns with BASIC RAM",
    primaryBasicCycles === 0 && vm.breakpointHit());
  vm.clearBreakpoints();

  vm.poke(0xD000, 0xEA);
  vm.writeBus(0xC083, 0);
  vm.writeBus(0xC083, 0);
  vm.writeBus(0xD000, 0x20);
  check("mapped peek sees language-card RAM opcode",
    vm.peek(0xD000) === 0xEA && vm.peekMapped(0xD000) === 0x20);
  check("step-over recognizes language-card RAM JSR",
    stepOverTarget(0xD000, vm.peekMapped(0xD000)) === 0xD003);
  check("ROM correlation hides language-card RAM",
    !vm.romVisible(0xD000)
      && lookupRomLocation(romDebug, 0xD000, vm.romVisible(0xD000)) === null);

  vm.writeBus(0xC082, 0);
  const upperProgramMapping = vm.memoryMapping(0xD000);
  check("mapped peek restores upper ROM opcode",
    vm.peekMapped(0xD000) === 0xEA && vm.romVisible(0xD000));
  check("ROM correlation follows visible upper ROM",
    lookupRomLocation(romDebug, 0xD000, vm.romVisible(0xD000)) !== null);

  vm.addMappedBreakpoint(0xD000, upperProgramMapping);
  vm.writeBus(0xC080, 0);
  vm.setPC(0xD000);
  const aliasedUpperCycles = vm.run(1);
  check("source breakpoint ignores aliased language-card RAM",
    aliasedUpperCycles > 0 && !vm.breakpointHit());
  vm.writeBus(0xC082, 0);
  vm.setPC(0xD000);
  const primaryUpperCycles = vm.run(1);
  check("source breakpoint returns with upper image",
    primaryUpperCycles === 0 && vm.breakpointHit());
  vm.clearBreakpoints();

  vm.loadData(assembled.org, assembled.bytes);
  vm.poke(0xFFFC, 0x00);
  vm.poke(0xFFFD, 0x08);
  vm.reset();

  check("rejects invalid breakpoint", vm.addBreakpoint(-1) === false);
  check("adds instruction breakpoint", vm.addBreakpoint(0x0802) && vm.hasBreakpoint(0x0802));
  const firstCycles = vm.run(20);
  check("run stops before breakpoint",
    firstCycles > 0 && vm.breakpointHit() && vm.pc() === 0x0802,
    `cycles=${firstCycles} pc=${vm.pc().toString(16)}`);

  vm.step();
  check("step executes through current breakpoint", !vm.breakpointHit() && vm.pc() === 0x0809);

  vm.addBreakpoint(0x0805);
  const overCycles = vm.run(20);
  check("temporary return breakpoint supports step-over",
    overCycles > 0 && vm.breakpointHit() && vm.pc() === 0x0805,
    `cycles=${overCycles} pc=${vm.pc().toString(16)}`);

  vm.removeBreakpoint(0x0805);
  vm.step();
  check("memory inspection sees program write", vm.peek(0x2000) === 1);

  vm.addBreakpoint(0x0808);
  const stoppedCycles = vm.runCycles(100);
  check("cycle runner reports immediate breakpoint",
    stoppedCycles === 0 && vm.breakpointHit() && vm.pc() === 0x0808);

  vm.clearBreakpoints();
  check("clear removes all breakpoints",
    !vm.hasBreakpoint(0x0802) && !vm.hasBreakpoint(0x0808) && !vm.breakpointHit());

  vm.reset();
  vm.poke(0x0900, 0xCB); // WAI
  vm.poke(0x0901, 0xEE); // INC $2001 after the interrupt wakes the CPU
  vm.poke(0x0902, 0x01);
  vm.poke(0x0903, 0x20);
  vm.poke(0x2001, 0);
  vm.setPC(0x0900);
  vm.step();
  vm.addBreakpoint(0x0901);
  const waitCycles = vm.runCycles(20);
  check("dormant WAI PC does not retrigger breakpoint",
    waitCycles >= 20 && vm.waiting() && vm.pc() === 0x0901 && !vm.breakpointHit(),
    `cycles=${waitCycles} pc=${vm.pc().toString(16)}`);

  vm.writeBus(0xC40E, 0xC0); // Enable Mockingboard VIA Timer 1 IRQ.
  vm.writeBus(0xC404, 1);
  vm.writeBus(0xC405, 0);
  const wakeCycles = vm.runCycles(20);
  check("masked IRQ wakes WAI into breakpoint before instruction",
    wakeCycles < 20 && vm.waiting() && vm.breakpointHit()
      && vm.pc() === 0x0901 && vm.peek(0x2001) === 0,
    `cycles=${wakeCycles} pc=${vm.pc().toString(16)} value=${vm.peek(0x2001)}`);

  vm.step();
  check("step executes instruction after masked-IRQ breakpoint",
    !vm.waiting() && !vm.breakpointHit() && vm.pc() === 0x0904 && vm.peek(0x2001) === 1);

  vm.delete();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
