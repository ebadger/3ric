import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";

export const ROM_SHA256 = "fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435";
const patches = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "patches");

export function assembleBankedInput(sourcePath) {
  return assemble(fs.readFileSync(sourcePath, "utf8") + "\n"
    + fs.readFileSync(path.join(patches, "banked-ps2.s"), "utf8"));
}

export function bankedChecksum(rom) {
  let first = 0, second = 0;
  for (const byte of rom.subarray(0xb500, 0xbe00)) {
    let sum = first + byte;
    first = (sum & 255) + (sum >> 8);
    sum = second + first;
    second = (sum & 255) + (sum >> 8);
  }
  return [first, second];
}
