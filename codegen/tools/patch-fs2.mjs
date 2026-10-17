// Flight Simulator II (subLOGIC, Apple II, 1983) -> 3RIC compatibility disk.
//
//   node codegen\tools\patch-fs2.mjs <FlightSimulator2.dsk> <output.woz>
//
// Takes the owner-supplied 143,360-byte DOS-order image (checked by SHA-256),
// applies byte-verified patches and writes a separate bootable WOZ2. The game
// stays local; this repository holds the adapter and patch list only.
// See docs/porting-logs/flight-simulator-ii.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildWozFromDsk } from "./wozgen.mjs";
import { sha256 } from "./wozedit.mjs";

export const INPUT_SHA256 = "533c25dd24ed0cdb3e29a83ec42df126583771f4dbfc1aed83848bdab67768d2";
export const ROM_SHA256 = "fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435";
export const DSK_SIZE = 143360;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hex = value => `$${value.toString(16)}`;

// The resident travels in a sector that is zero-filled on the original disk.
// Boot0 is taught to load it as a fourth page, at $2000 (the $1D00 stage
// overwrites that page later), then copies it to $CF00 before JMP $1D00.
export const RESIDENT_TRACK = 0;
export const RESIDENT_SECTOR = 14;             // DOS logical sector
const physicalSector = logical => logical === 15 ? 15 : logical * 13 % 15;

export function buildResident() {
  const resident = assemble(fs.readFileSync(path.join(root, "codegen", "patches", "fs2", "resident.s"), "utf8"));
  if (resident.org !== 0xcf00 || resident.bytes.length > 0xff)
    throw new Error("FS2 resident exceeds $CF00-$CFFE");
  return resident;
}

/** Every edit: [track, logical sector, offset, before, after, why]. */
export function buildPatches(resident) {
  const s = resident.symbols;
  const lo = v => v & 255, hi = v => v >> 8;
  const hook = assemble(`
        .org $08B9
        ldy #0
copy:
        lda $2000,y
        sta $CF00,y
        iny
        bne copy
        jsr ${hex(s.BOOT_INIT)}
        ldx $2B
        jmp $1D00
`);
  if (hook.bytes.length > 0x08f0 - 0x08b9) throw new Error("Boot hook overlaps boot0 data");
  const page = Buffer.alloc(256);
  page.set(resident.bytes);
  return [
    // Boot0 ($0800): one more page; physical sector of T0 L14 into $2000.
    [0, 0, 0x51, [0x07], [physicalSector(RESIDENT_SECTOR)], "boot0 sector table[3]"],
    [0, 0, 0xff, [0x02], [0x03], "boot0 page count"],
    [0, 0, 0x9e, [0x4c, 0x00, 0x1d], [0x4c, lo(0x08b9), hi(0x08b9)], "boot0 exit -> hook"],
    [0, 0, 0xb9, Buffer.alloc(hook.bytes.length), hook.bytes, "boot hook (zero slack)"],
    [RESIDENT_TRACK, RESIDENT_SECTOR, 0, Buffer.alloc(256), page, "resident page"],
    // Game code at $AC00-$ADFF loads from T9 L12-L13 starting $20 bytes in
    // (memory $xxNN <- sector offset NN+$20).
    // $AC9A: LDA $C083 / LDA $C083 -> JSR lc_on (RAM NMI vector set first).
    [9, 12, 0xba, [0xad, 0x83, 0xc0, 0xad, 0x83, 0xc0],
      [0x20, lo(s.LC_ON), hi(s.LC_ON), 0xea, 0xea, 0xea], "LC enable"],
    // $AD17: STA $FFFA / STX $FFFB -> JSR set_nmi; RESET/IRQ stay $A7E2.
    [9, 13, 0x37, [0x8d, 0xfa, 0xff, 0x8e, 0xfb, 0xff],
      [0x20, lo(s.SET_NMI), hi(s.SET_NMI), 0xea, 0xea, 0xea], "vector setup"],
  ];
}

/** Apply verified edits to a DOS-order image copy; throws on any preimage mismatch. */
export function applyPatches(input, patches) {
  const dsk = Buffer.from(input);
  for (const [track, sector, offset, before, after, why] of patches) {
    const at = (track * 16 + sector) * 256 + offset;
    const expected = Buffer.from(before);
    if (expected.length !== after.length || offset + expected.length > 256
        || !dsk.subarray(at, at + expected.length).equals(expected))
      throw new Error(`Unexpected Flight Simulator II bytes at T${track} S${sector}+${offset.toString(16)} (${why})`);
    dsk.set(after, at);
  }
  return dsk;
}

export function patchFs2(input, rom) {
  if (input.length !== DSK_SIZE || sha256(input) !== INPUT_SHA256)
    throw new Error(`Unsupported Flight Simulator II image; expected a ${DSK_SIZE}-byte DOS-order .dsk `
      + `with SHA-256 ${INPUT_SHA256}. No output written.`);
  if (sha256(rom) !== ROM_SHA256)
    throw new Error(`Unsupported 3ric ROM; expected SHA-256 ${ROM_SHA256}`);
  const resident = buildResident();
  const patches = buildPatches(resident);
  const dsk = applyPatches(input, patches);
  const woz = Buffer.from(buildWozFromDsk(new Uint8Array(dsk)));
  return { dsk, woz, patches, resident };
}

function main(args) {
  if (args.length !== 2)
    throw new Error("Usage: node codegen\\tools\\patch-fs2.mjs <FlightSimulator2.dsk> <output.woz>");
  const [input, output] = args.map(name => path.resolve(name));
  if ((process.platform === "win32" ? input.toLowerCase() === output.toLowerCase() : input === output))
    throw new Error("Input and output must be different files");
  const result = patchFs2(fs.readFileSync(input), fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin")));
  fs.writeFileSync(output, result.woz, { flag: "wx" });
  console.log(`Created ${output}\nFlight Simulator II / 3ric adapter; hardware verification required.\n`
    + `Patched sites: ${result.patches.length}\nSHA-256: ${sha256(result.woz)}`);
}

if (typeof process !== "undefined" && process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`patch-fs2: ${error.message}`); process.exitCode = 1; }
}
