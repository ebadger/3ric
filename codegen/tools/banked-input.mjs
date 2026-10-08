import fs from "node:fs";
import { fileURLToPath } from "node:url";

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

export function bankedInputSource() {
  return fs.readFileSync(fileURLToPath(new URL("../patches/banked-input.s", import.meta.url)), "utf8");
}

export function snesPollSource() {
  return fs.readFileSync(fileURLToPath(new URL("../patches/snes-poll.s", import.meta.url)), "utf8");
}
