import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildWozFromDsk } from "./wozgen.mjs";
import { sha256 } from "./wozedit.mjs";

export const INPUT_SHA256 = "f86cc6ddb805077e1d41eec8274694a250bb619e297e3f35ca828fc54ade80a8";

export function patchHalley(input) {
  if (input.length !== 143360 || sha256(input) !== INPUT_SHA256)
    throw new Error(`Unsupported Halley Project DSK; expected SHA-256 ${INPUT_SHA256}. No output written.`);
  const disk = Buffer.from(input);
  const patches = [
    ...[0x1a19, 0x3543, 0xbf31].map(offset => ({
      offset, before: "ad19c030fb", after: "eaeaeaeaea",
      reason: "Remove unsupported Apple IIe vertical-blank polling",
    })),
    ...[0x356c, 0xbf5a].map(offset => ({
      offset, before: "201a0e", after: "20b90d",
      reason: "Refresh paddles and keyboard together during hyperspace",
    })),
  ];
  for (const { offset, before, after } of patches) {
    const expected = Buffer.from(before, "hex");
    const replacement = Buffer.from(after, "hex");
    if (expected.length !== replacement.length ||
        !disk.subarray(offset, offset + expected.length).equals(expected))
      throw new Error(`Unexpected Halley Project bytes at DSK offset $${offset.toString(16)}`);
    disk.set(replacement, offset);
  }
  return { woz: Buffer.from(buildWozFromDsk(disk)), patches };
}

function main() {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length)
    throw new Error("Usage: node codegen\\tools\\patch-halley.mjs <original.dsk> <new.woz>");
  const result = patchHalley(fs.readFileSync(input));
  fs.writeFileSync(output, result.woz, { flag: "wx" });
  console.log(`Created ${output} (${result.woz.length} bytes; ${result.patches.length} guarded patches)`);
  console.log(`SHA-256 ${sha256(result.woz)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
