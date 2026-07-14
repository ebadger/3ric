// gen_platform_ref.mjs — build the 3ric platform reference that the code
// generator reads before writing a program.
//
// Sources of truth:
//   emulator/Badger6502VMLib/vm.h   -> MM_* memory-map / soft-switch enum
//   emulator/Data/badger6502.dbg    -> ca65 symbol table (ROM entry points)
//
// Emits:
//   codegen/platform/platform-ref.json  (full: memoryMap, softSwitches, all
//                                         symbols, curated entryPoints, zeroPage)
//   codegen/platform/platform-ref.md    (curated, human/prompt-friendly)
//
// Run:  node gen_platform_ref.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const VM_H = path.join(ROOT, "emulator", "Badger6502VMLib", "vm.h");
const DBG = path.join(ROOT, "emulator", "Data", "badger6502.dbg");
const OUT_DIR = path.join(ROOT, "codegen", "platform");

const hex = (n, w = 4) => "$" + (n & 0xffffff).toString(16).toUpperCase().padStart(w, "0");

// --- parse the MM_* enum from vm.h ----------------------------------------
function parseMemoryMap(src) {
  const map = {};
  const re = /^\s*(MM_[A-Z0-9_]+)\s*=\s*0x([0-9A-Fa-f]+)\s*,?/gm;
  let m;
  while ((m = re.exec(src))) map[m[1]] = parseInt(m[2], 16);
  return map;
}

// --- parse ca65 .dbg symbols ----------------------------------------------
function parseSymbols(src) {
  const syms = {};
  const re = /^sym\s+.*$/gm;
  let m;
  while ((m = re.exec(src))) {
    const line = m[0];
    const name = /name="([^"]+)"/.exec(line)?.[1];
    const valM = /val=0x([0-9A-Fa-f]+)/.exec(line);
    const type = /type=(\w+)/.exec(line)?.[1];
    if (!name || !valM) continue;
    // keep the first (or lowest-id) definition per name
    if (!(name in syms)) syms[name] = { addr: parseInt(valM[1], 16), type };
  }
  return syms;
}

// Curated ROM entry points, resolved against the .dbg so addresses stay true.
const ENTRY_POINTS = [
  ["Text output", [
    ["COUT",    "Print A (ASCII, high bit set) via the output vector — screen + serial"],
    ["COUT1",   "Print A directly to the screen (bypasses the $36/$37 vector)"],
    ["CROUT",   "Print a carriage return"],
    ["PRBYTE",  "Print A as two hex digits"],
    ["PRHEX",   "Print low nibble of A as one hex digit"],
    ["HOME",    "Clear the text screen and home the cursor"],
    ["CLREOL",  "Clear from the cursor to the end of the line"],
    ["CLREOP",  "Clear from the cursor to the end of the page"],
    ["BELL",    "Emit a bell ($07)"],
    ["BASCALC", "Recompute BASL/BASH for the row in A"],
    ["SETVID",  "Route COUT output to the screen"],
    ["SETKBD",  "Route RDKEY input to the keyboard"],
  ]],
  ["Input", [
    ["RDKEY",   "Wait for and return a key in A (high bit set)"],
    ["KEYIN",   "Low-level keyboard read (used by RDKEY)"],
    ["GETLNZ",  "Read a line of input into the input buffer ($200)"],
  ]],
  ["DOS shell / SD file I/O", [
    ["dos",              "Enter the DOS shell (mounts the SD card, shows '>' prompt)"],
    ["fat32_start",      "Mount the FAT32 card"],
    ["cmd_brun",         "BRUN: load a raw .PRG at an address and JMP to it"],
    ["cmd_bload",        "BLOAD: load a raw .PRG at an address (no jump)"],
    ["cmd_bsave",        "BSAVE: write a memory range to a .PRG file"],
    ["cmd_fload",        "FLOAD helper"],
    ["fat32_file_write", "Low-level FAT32 file write"],
  ]],
];

// Standard Apple-II zero-page / monitor RAM the code generator can rely on.
// (Confirmed live by the serial spike: COUT dispatches through $36/$37.)
const ZERO_PAGE = [
  ["$24", "CH",    "Cursor horizontal position (column)"],
  ["$25", "CV",    "Cursor vertical position (row)"],
  ["$28", "BASL",  "Text line base address, low"],
  ["$29", "BASH",  "Text line base address, high"],
  ["$32", "INVFLG","Inverse/normal video mask ($FF normal, $3F inverse)"],
  ["$33", "PROMPT","Prompt character"],
  ["$36", "CSWL",  "Character-output vector low (COUT jumps here)"],
  ["$37", "CSWH",  "Character-output vector high"],
  ["$38", "KSWL",  "Keyboard-input vector low"],
  ["$39", "KSWH",  "Keyboard-input vector high"],
];

// High-level regions + key soft switches to surface in the MD (from the enum).
const REGION_KEYS = [
  ["MM_RAM_START", "MM_RAM_END", "RAM (zero page, stack, program & data)"],
  ["MM_VIDEO_START", "MM_VIDEO_END", "Hi-res video pages (page 1 $2000, page 2 $4000)"],
  ["MM_BASIC_START", "MM_BASIC_END", "BASIC ROM"],
  ["MM_DEVICES_START", "MM_SS_END", "Device / soft-switch page"],
  ["MM_ACIA_START", "MM_ACIA_END", "ACIA serial port"],
  ["MM_VIA1_START", "MM_VIA1_END", "VIA #1 (timers, I/O)"],
  ["MM_ROM_START", "MM_ROM_END", "Monitor / OS ROM"],
];
const SOFTSWITCH_KEYS = [
  ["MM_SS_KEYBOARD", "Keyboard data (bit7 = key-ready strobe)"],
  ["MM_SS_KEYBD_STROBE", "Clear the keyboard strobe"],
  ["MM_SS_SPEAKER", "Toggle the system speaker (any read or write access)"],
  ["MM_SS_GRAPHICS", "Switch to graphics"],
  ["MM_SS_TEXT", "Switch to text"],
  ["MM_SS_FULLSCREEN", "Full-screen (clear mixed)"],
  ["MM_SS_SPLITSCREEN", "Mixed text/graphics"],
  ["MM_SS_DISPLAY1", "Display page 1"],
  ["MM_SS_DISPLAY2", "Display page 2"],
  ["MM_SS_LORES", "Lo-res graphics"],
  ["MM_SS_HIRES", "Hi-res graphics"],
];

function main() {
  const vmSrc = fs.readFileSync(VM_H, "utf8");
  const dbgSrc = fs.readFileSync(DBG, "utf8");
  const mm = parseMemoryMap(vmSrc);
  const syms = parseSymbols(dbgSrc);

  // Resolve curated entry points.
  const entryPoints = {};
  const entryGroups = ENTRY_POINTS.map(([group, items]) => [
    group,
    items.map(([name, desc]) => {
      const s = syms[name];
      if (s) entryPoints[name] = s.addr;
      return { name, addr: s ? s.addr : null, desc };
    }),
  ]);

  const json = {
    generatedFrom: ["emulator/Badger6502VMLib/vm.h", "emulator/Data/badger6502.dbg"],
    note: "Text/lo-res video page 1 is $0400-$07FF (page 2 $0800-$0BFF); hi-res page 1 $2000, page 2 $4000. Load user programs into free RAM, e.g. $0800 or $6000. Return to the monitor with BRK.",
    memoryMap: mm,
    regions: REGION_KEYS.filter(([s, e]) => mm[s] != null && mm[e] != null)
      .map(([s, e, desc]) => ({ start: mm[s], end: mm[e], desc })),
    softSwitches: SOFTSWITCH_KEYS.filter(([k]) => mm[k] != null)
      .map(([k, desc]) => ({ name: k.replace(/^MM_SS_/, ""), addr: mm[k], desc })),
    zeroPage: ZERO_PAGE.map(([addr, name, desc]) => ({ addr, name, desc })),
    entryPoints,
    symbols: Object.fromEntries(Object.entries(syms).map(([k, v]) => [k, v.addr])),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "platform-ref.json"), JSON.stringify(json, null, 2));

  // --- Markdown ---
  let md = "";
  md += "# 3ric platform reference\n\n";
  md += "_Auto-generated by `codegen/tools/gen_platform_ref.mjs` from `vm.h` and `badger6502.dbg`. Do not edit by hand._\n\n";
  md += json.note + "\n\n";

  md += "## Memory regions\n\n| Range | Region |\n| --- | --- |\n";
  for (const r of json.regions) md += `| ${hex(r.start)}–${hex(r.end)} | ${r.desc} |\n`;
  md += "\n";

  md += "## Soft switches (touch to select; read or write any access)\n\n| Address | Switch | Effect |\n| --- | --- | --- |\n";
  for (const s of json.softSwitches) md += `| ${hex(s.addr)} | ${s.name} | ${s.desc} |\n`;
  md += "\n";

  md += "## Zero-page / monitor RAM\n\n| Address | Name | Use |\n| --- | --- | --- |\n";
  for (const z of json.zeroPage) md += `| ${z.addr} | ${z.name} | ${z.desc} |\n`;
  md += "\n";

  md += "## ROM entry points\n\n";
  for (const [group, items] of entryGroups) {
    md += `### ${group}\n\n| Symbol | Address | Description |\n| --- | --- | --- |\n`;
    for (const it of items) md += `| ${it.name} | ${it.addr != null ? hex(it.addr) : "—"} | ${it.desc} |\n`;
    md += "\n";
  }

  md += "## Conventions\n\n";
  md += "- **Entry:** a `.PRG` is a raw memory image with no header. `BRUN FILE.PRG <addr>` loads it at `<addr>` and `JMP`s to `<addr>`, so the load address is the entry point.\n";
  md += "- **Exit:** end with `BRK` to fall back to the monitor `*` prompt (the test harness's halt sentinel). `RTS` is unsafe unless you set up the stack yourself.\n";
  md += "- **Text:** `COUT` expects ASCII with the **high bit set** (e.g. `'A'|$80 = $C1`). `$8D` is carriage return.\n";
  md += "- **Serial:** `COUT` output is mirrored to the ACIA at " + (mm.MM_ACIA_START != null ? hex(mm.MM_ACIA_START) : "$C100") + "; the harness captures it. You may also write bytes straight to that port.\n";
  md += `- **Symbols:** ${Object.keys(syms).length} ROM symbols are available in \`platform-ref.json\` under \`symbols\` for lookup.\n`;

  fs.writeFileSync(path.join(OUT_DIR, "platform-ref.md"), md);

  console.log(`wrote platform-ref.json (${Object.keys(syms).length} symbols) and platform-ref.md`);
  const missing = [];
  for (const [, items] of ENTRY_POINTS) for (const [name] of items) if (!(name in syms)) missing.push(name);
  if (missing.length) console.log("note: curated symbols not found in .dbg:", missing.join(", "));
}

main();
