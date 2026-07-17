const fs = require("fs");
const path = require("path");
const createBadgerVM = require("./badger6502.js");
const { buildSourceListing, parseCa65Debug } = require("./debugger.js");

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

  const Module = await createBadgerVM();
  const vm = new Module.WebVM();
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

  vm.poke(0x0900, 0xCB); // WAI
  vm.poke(0x0901, 0xEA); // NOP after the interrupt wakes the CPU
  vm.setPC(0x0900);
  vm.step();
  vm.addBreakpoint(0x0901);
  const waitCycles = vm.runCycles(20);
  check("dormant WAI PC does not retrigger breakpoint",
    waitCycles >= 20 && vm.waiting() && vm.pc() === 0x0901 && !vm.breakpointHit(),
    `cycles=${waitCycles} pc=${vm.pc().toString(16)}`);

  vm.delete();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
