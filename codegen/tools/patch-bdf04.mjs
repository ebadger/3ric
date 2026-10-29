// Patch the owner-supplied Boulder Dash BDF04 raw PRG for 3RIC's SNES D-pad.
// The game image itself stays outside the repository.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const patchSource = path.join(root, "codegen", "patches", "bdf04", "controller.s");

export const LOAD_ADDR = 0x0f04;
export const PRG_SIZE = 0x79fc;
export const PRG_SHA256 = "bca7fa26bded86753165d5ca435277553d38faeb5d88f45d28fa70b4ea2ac0d0";
export const DECODER_ADDR = 0x2284;
export const DECODER_RUNTIME_ADDR = 0x0284;
export const DECODER_SIZE = 0x1e;
export const DECODER_OFFSET = DECODER_ADDR - LOAD_ADDR;
export const DECODER_BEFORE = Object.freeze([
  0xa5, 0x3e, 0xf0, 0x0a, 0x10, 0x04, 0xa9, 0x01, 0xd0, 0x12,
  0xa9, 0x02, 0xd0, 0x0e, 0xa5, 0x3f, 0xf0, 0x0a, 0x10, 0x04,
  0xa9, 0x03, 0xd0, 0x04, 0xa9, 0x04, 0xd0, 0x00, 0x85, 0x0f,
]);

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

export function buildControllerPatch() {
  const assembled = assemble(fs.readFileSync(patchSource, "utf8"));
  if (assembled.org !== DECODER_RUNTIME_ADDR || assembled.bytes.length !== DECODER_SIZE)
    throw new Error(`BDF04 controller patch must be ${DECODER_SIZE} bytes at $${DECODER_RUNTIME_ADDR.toString(16)}`);
  return Uint8Array.from(assembled.bytes);
}

/** Replace the decoder in a fixture or verified image, checking its exact site bytes. */
export function replaceDecoder(image, replacement = buildControllerPatch()) {
  if (!(image instanceof Uint8Array)) throw new TypeError("BDF04 image must be a Uint8Array");
  if (image.length !== PRG_SIZE) throw new Error(`unexpected BDF04 image size (${image.length} bytes)`);
  if (!(replacement instanceof Uint8Array) || replacement.length !== DECODER_SIZE)
    throw new Error(`BDF04 replacement must be ${DECODER_SIZE} bytes`);

  const offset = DECODER_OFFSET;
  for (let i = 0; i < DECODER_BEFORE.length; i++) {
    if (image[offset + i] !== DECODER_BEFORE[i])
      throw new Error(`unexpected bytes at $${DECODER_ADDR.toString(16).toUpperCase()} (BDF04 direction decoder): different release?`);
  }

  const out = Uint8Array.from(image);
  out.set(replacement, offset);
  return out;
}

/** Apply the patch only to the verified BDF04 release. */
export function patchBdf04(image) {
  if (!(image instanceof Uint8Array)) throw new TypeError("BDF04 image must be a Uint8Array");
  if (image.length !== PRG_SIZE) throw new Error(`unexpected BDF04 image size (${image.length} bytes)`);
  const actual = sha256(image);
  if (actual !== PRG_SHA256)
    throw new Error(`unsupported BDF04 image (SHA-256 ${actual}); expected the verified release`);
  return replaceDecoder(image);
}

function isWithinRepository(candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function main(args) {
  if (args.length !== 2) {
    console.error("usage: node codegen/tools/patch-bdf04.mjs <original.prg> <output.prg>");
    process.exitCode = 2;
    return;
  }

  const inputPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1]);
  if (path.relative(inputPath, outputPath) === "")
    throw new Error("refusing to overwrite the input game image");
  if (isWithinRepository(inputPath))
    throw new Error("keep the original game image outside the repository");
  if (isWithinRepository(outputPath))
    throw new Error("keep the patched game image outside the repository");

  const patched = patchBdf04(new Uint8Array(fs.readFileSync(inputPath)));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, patched, { flag: "wx" });
  console.log(`wrote ${outputPath}`);
  console.log(`copy it to the 3RIC FAT32 card and run: BRUN ${path.basename(outputPath)} 0F04`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
