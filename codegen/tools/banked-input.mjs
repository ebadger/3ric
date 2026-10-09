import fs from "node:fs";
import { assemble } from "./asm6502.mjs";
import { sha256 } from "./wozedit.mjs";

export const ROM_SHA256 = "fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435";

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

export function assembleBankedInput(source, rom, resumeHook = "") {
  if (sha256(rom) !== ROM_SHA256)
    throw new Error(`Unsupported 3ric ROM; expected SHA-256 ${ROM_SHA256}`);
  let input = fs.readFileSync(new URL("../patches/banked-input-3ric.s", import.meta.url), "utf8");
  if (resumeHook) {
    if (!input.includes("nmi_resume:")) throw new Error("Missing banked-input resume hook");
    input = input.replace("nmi_resume:", `nmi_resume:\n        jsr ${resumeHook}`);
  }
  return assemble(`${source}\n${input}`);
}
