import fs from "node:fs";
import { assemble } from "./asm6502.mjs";

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

export function assembleBankedInput(source) {
  const nmi = fs.readFileSync(new URL("../patches/banked-input-nmi.s", import.meta.url), "utf8");
  const resident = assemble(`${source}\n${nmi}`);
  if (resident.org !== 0xcc00 || resident.symbols.ADAPTER_END > 0xce00
      || resident.symbols.NMI_END > 0xd000)
    throw new Error("Banked input adapter exceeds its reserved RAM");
  return resident;
}
