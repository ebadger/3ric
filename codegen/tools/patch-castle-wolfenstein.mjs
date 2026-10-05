import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildWozFromDsk } from "./wozgen.mjs";
import { sha256 } from "./wozedit.mjs";

export const INPUT_SHA256 = "82f12169a75fbb26472df750a8b31883bd73ef6d68df58a0f81e5ac569ac7239";
export const ROM_SHA256 = "fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Offsets address the checked DOS-order image, not WOZ physical-sector numbers.
export const PATCHES = Object.freeze([
  { offset: 0x0ce7, before: "6c5c9d", after: "4cea9d",
    purpose: "DOS $9DE7: initialize DOS instead of entering BASIC" },
  { offset: 0x0d42, before: "06", after: "34",
    purpose: "DOS $9E42: BRUN rather than RUN the startup file" },
  { offset: 0x1975, before: "dec8c5cccccf", after: "c0c9cec9d4a0",
    purpose: "DOS $AA75: @INIT rather than the ^HELLO BASIC greeting" },
  { offset: 0xc502, before: "eb16", after: "ee16",
    purpose: "@WOLF: load three more bytes, ending at $1EFD below the $1F00 input driver" },
  { offset: 0xafec, before: "4c00e0ffffff", after: "9c00c04c59ff",
    purpose: "@WOLF $1EF8: acknowledge Escape, then initialize the monitor" },
  { offset: 0xd602, before: "4c00e0", after: "4c59ff",
    purpose: "@INIT $0B7E: return to the monitor if BRUN returns" },
].map(patch => Object.freeze(patch)));

export function patchCastleWolfenstein(input, rom) {
  if (sha256(rom) !== ROM_SHA256)
    throw new Error(`Unsupported 3ric ROM; expected SHA-256 ${ROM_SHA256}`);
  if (input.length !== 143360 || sha256(input) !== INPUT_SHA256)
    throw new Error(`Unsupported Castle Wolfenstein DOS-order image; expected SHA-256 ${INPUT_SHA256}`);
  const dsk = Buffer.from(input);
  for (const patch of PATCHES) {
    const before = Buffer.from(patch.before, "hex");
    const after = Buffer.from(patch.after, "hex");
    if (before.length !== after.length
        || !dsk.subarray(patch.offset, patch.offset + before.length).equals(before))
      throw new Error(`Unexpected bytes at DOS image offset $${patch.offset.toString(16)}`);
    dsk.set(after, patch.offset);
  }
  return { dsk, woz: Buffer.from(buildWozFromDsk(dsk)) };
}

function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node codegen\\tools\\patch-castle-wolfenstein.mjs <original.do> <new.woz>");
    return;
  }
  if (args.length !== 2)
    throw new Error("Usage: node codegen\\tools\\patch-castle-wolfenstein.mjs <original.do> <new.woz>");
  const [input, output] = args.map(name => path.resolve(name));
  if (input.toLowerCase() === output.toLowerCase()) throw new Error("Refusing to overwrite the input");
  if (path.extname(output).toLowerCase() !== ".woz") throw new Error("Output must have a .woz extension");
  const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
  const result = patchCastleWolfenstein(fs.readFileSync(input), rom);
  fs.writeFileSync(output, result.woz, { flag: "wx" });
  console.log(`Created ${output}\nSHA-256: ${sha256(result.woz)}\n`
    + "Boot with C600G from the monitor. Press Return at the title, then K for keyboard.\n"
    + "Experimental hardware-trial image; physical-board confirmation is still required.\n"
    + "The current Disk II emulator ignores writes: saves and new castles do not persist.");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`patch-castle-wolfenstein: ${error.message}`); process.exitCode = 1; }
}
