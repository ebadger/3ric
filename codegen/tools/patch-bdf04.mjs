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
export const MAPPER_RUNTIME_ADDR = 0x0290;
export const SWEEP_HELPER_RUNTIME_ADDR = DECODER_RUNTIME_ADDR;
export const DECODER_BEFORE = Object.freeze([
  0xa5, 0x3e, 0xf0, 0x0a, 0x10, 0x04, 0xa9, 0x01, 0xd0, 0x12,
  0xa9, 0x02, 0xd0, 0x0e, 0xa5, 0x3f, 0xf0, 0x0a, 0x10, 0x04,
  0xa9, 0x03, 0xd0, 0x04, 0xa9, 0x04, 0xd0, 0x00, 0x85, 0x0f,
]);
export const FRAME_DELAY_ADDR = 0x219a;
export const FRAME_DELAY_BEFORE = 0x1b;
export const FRAME_DELAY_AFTER = 0x86;
export const FRAME_DELAY_RUNTIME_ADDR = FRAME_DELAY_ADDR - 0x2000;
export const FIXED_TONE_DELAY_ADDR = 0x218c;
export const FIXED_TONE_DELAY_BEFORE = 0x0a;
export const FIXED_TONE_DELAY_AFTER = 0x0b;
export const FIXED_TONE_DELAY_RUNTIME_ADDR = FIXED_TONE_DELAY_ADDR - 0x2000;
export const DELAY_ROUTINE_ADDR = 0x23bf;
export const DELAY_ROUTINE_BEFORE = Object.freeze([
  0x38, 0x48, 0xe9, 0x01, 0xd0, 0xfc, 0x68, 0xe9, 0x01, 0xd0, 0xf6, 0x60,
]);
export const DELAY_ROUTINE_AFTER = Object.freeze([
  0x38, 0x48, 0x3a, 0x44, 0x00, 0xd0, 0xfb, 0x68, 0x3a, 0xd0, 0xf6, 0x60,
]);
export const DELAY_ROUTINE_RUNTIME_ADDR = DELAY_ROUTINE_ADDR - 0x2000;
export const SWEEP_BRANCH_OPERAND_ADDR = 0x2273;
export const SWEEP_BRANCH_OPERAND_BEFORE = 0x10;
export const SWEEP_BRANCH_OPERAND_AFTER = 0x1c;
export const SWEEP_BRANCH_RUNTIME_ADDR = SWEEP_BRANCH_OPERAND_ADDR - 0x2000;
export const SWEEP_DELAY_CALL_ADDR = 0x227a;
export const SWEEP_DELAY_CALL_BEFORE = Object.freeze([0x20, 0xbf, 0x03]);
export const SWEEP_DELAY_CALL_AFTER = Object.freeze([0x20, 0x84, 0x02]);
export const SWEEP_DELAY_CALL_RUNTIME_ADDR = SWEEP_DELAY_CALL_ADDR - 0x2000;
export const TITLE_MUSIC_E5_LOOP_ADDR = 0x3246;
export const TITLE_MUSIC_E5_LOOP_BEFORE = Object.freeze([
  0x88, 0xf0, 0x05, 0x4c, 0x4c, 0x92, 0xd0, 0xeb,
]);
export const TITLE_MUSIC_E5_LOOP_AFTER = Object.freeze([
  0x20, 0x8e, 0x02, 0x88, 0xf0, 0x02, 0xd0, 0xeb,
]);
export const TITLE_MUSIC_E5_LOOP_RUNTIME_ADDR = TITLE_MUSIC_E5_LOOP_ADDR + 0x6000;
export const TITLE_MUSIC_E5_BRIDGE_ADDR = 0x3243;
export const TITLE_MUSIC_E5_BRIDGE_BEFORE = Object.freeze([0x4c, 0x46, 0x92]);
export const TITLE_MUSIC_E5_BRIDGE_AFTER = Object.freeze([0x80, 0x00, 0xea]);
export const TITLE_MUSIC_E5_BRIDGE_RUNTIME_ADDR = TITLE_MUSIC_E5_BRIDGE_ADDR + 0x6000;
export const TITLE_MUSIC_E4_LOOP_ADDR = 0x3260;
export const TITLE_MUSIC_E4_LOOP_BEFORE = Object.freeze([
  0x88, 0xf0, 0xd1, 0x4c, 0x66, 0x92, 0xd0, 0xeb,
]);
export const TITLE_MUSIC_E4_LOOP_AFTER = Object.freeze([
  0x20, 0x8e, 0x02, 0x88, 0xf0, 0xce, 0xd0, 0xeb,
]);
export const TITLE_MUSIC_E4_LOOP_RUNTIME_ADDR = TITLE_MUSIC_E4_LOOP_ADDR + 0x6000;
export const TITLE_MUSIC_E4_BRIDGE_ADDR = 0x325d;
export const TITLE_MUSIC_E4_BRIDGE_BEFORE = Object.freeze([0x4c, 0x60, 0x92]);
export const TITLE_MUSIC_E4_BRIDGE_AFTER = Object.freeze([0x80, 0x00, 0xea]);
export const TITLE_MUSIC_E4_BRIDGE_RUNTIME_ADDR = TITLE_MUSIC_E4_BRIDGE_ADDR + 0x6000;
export const TITLE_MUSIC_DELAY_HELPER_RUNTIME_ADDR = 0x028e;
export const TITLE_MUSIC_DELAY_HELPER_BYTES = Object.freeze([0xea, 0x60]);

const TIMING_PATCHES = [
  {
    address: FRAME_DELAY_ADDR,
    offset: FRAME_DELAY_ADDR - LOAD_ADDR,
    before: [FRAME_DELAY_BEFORE],
    after: [FRAME_DELAY_AFTER],
    label: "frame delay",
  },
  {
    address: FIXED_TONE_DELAY_ADDR,
    offset: FIXED_TONE_DELAY_ADDR - LOAD_ADDR,
    before: [FIXED_TONE_DELAY_BEFORE],
    after: [FIXED_TONE_DELAY_AFTER],
    label: "fixed speaker delay",
  },
  {
    address: DELAY_ROUTINE_ADDR,
    offset: DELAY_ROUTINE_ADDR - LOAD_ADDR,
    before: DELAY_ROUTINE_BEFORE,
    after: DELAY_ROUTINE_AFTER,
    label: "shared delay routine",
  },
  {
    address: SWEEP_BRANCH_OPERAND_ADDR,
    offset: SWEEP_BRANCH_OPERAND_ADDR - LOAD_ADDR,
    before: [SWEEP_BRANCH_OPERAND_BEFORE],
    after: [SWEEP_BRANCH_OPERAND_AFTER],
    label: "speaker-sweep branch",
  },
  {
    address: SWEEP_DELAY_CALL_ADDR,
    offset: SWEEP_DELAY_CALL_ADDR - LOAD_ADDR,
    before: SWEEP_DELAY_CALL_BEFORE,
    after: SWEEP_DELAY_CALL_AFTER,
    label: "speaker-sweep delay call",
  },
  {
    address: TITLE_MUSIC_E5_LOOP_ADDR,
    offset: TITLE_MUSIC_E5_LOOP_ADDR - LOAD_ADDR,
    before: TITLE_MUSIC_E5_LOOP_BEFORE,
    after: TITLE_MUSIC_E5_LOOP_AFTER,
    label: "title-music E5 delay loop",
  },
  {
    address: TITLE_MUSIC_E4_LOOP_ADDR,
    offset: TITLE_MUSIC_E4_LOOP_ADDR - LOAD_ADDR,
    before: TITLE_MUSIC_E4_LOOP_BEFORE,
    after: TITLE_MUSIC_E4_LOOP_AFTER,
    label: "title-music E4 delay loop",
  },
  {
    address: TITLE_MUSIC_E5_BRIDGE_ADDR,
    offset: TITLE_MUSIC_E5_BRIDGE_ADDR - LOAD_ADDR,
    before: TITLE_MUSIC_E5_BRIDGE_BEFORE,
    after: TITLE_MUSIC_E5_BRIDGE_AFTER,
    label: "title-music E5 delay bridge",
  },
  {
    address: TITLE_MUSIC_E4_BRIDGE_ADDR,
    offset: TITLE_MUSIC_E4_BRIDGE_ADDR - LOAD_ADDR,
    before: TITLE_MUSIC_E4_BRIDGE_BEFORE,
    after: TITLE_MUSIC_E4_BRIDGE_AFTER,
    label: "title-music E4 delay bridge",
  },
];

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

export function buildControllerPatch() {
  const assembled = assemble(fs.readFileSync(patchSource, "utf8"));
  if (assembled.org !== DECODER_RUNTIME_ADDR || assembled.bytes.length !== DECODER_SIZE)
    throw new Error(`BDF04 in-place code patch must be ${DECODER_SIZE} bytes at $${DECODER_RUNTIME_ADDR.toString(16)}`);
  return Uint8Array.from(assembled.bytes);
}

function assertImage(image) {
  if (!(image instanceof Uint8Array)) throw new TypeError("BDF04 image must be a Uint8Array");
  if (image.length !== PRG_SIZE) throw new Error(`unexpected BDF04 image size (${image.length} bytes)`);
}

function assertReplacement(replacement) {
  if (!(replacement instanceof Uint8Array) || replacement.length !== DECODER_SIZE)
    throw new Error(`BDF04 replacement must be ${DECODER_SIZE} bytes`);
}

function assertSiteBytes(image, site) {
  for (let i = 0; i < site.before.length; i++) {
    if (image[site.offset + i] !== site.before[i]) {
      throw new Error(`unexpected bytes at $${site.address.toString(16).toUpperCase()} (BDF04 ${site.label}): different release?`);
    }
  }
}

/** Replace only the decoder in a fixture or verified image. */
export function replaceDecoder(image, replacement = buildControllerPatch()) {
  assertImage(image);
  assertReplacement(replacement);
  assertSiteBytes(image, {
    address: DECODER_ADDR,
    offset: DECODER_OFFSET,
    before: DECODER_BEFORE,
    label: "direction decoder",
  });

  const out = Uint8Array.from(image);
  out.set(replacement, DECODER_OFFSET);
  return out;
}

/** Apply all guarded BDF04 controller and timing edits to a fixture or verified image. */
export function replaceBdf04Sites(image, replacement = buildControllerPatch()) {
  assertImage(image);
  assertReplacement(replacement);
  assertSiteBytes(image, {
    address: DECODER_ADDR,
    offset: DECODER_OFFSET,
    before: DECODER_BEFORE,
    label: "direction decoder",
  });
  for (const site of TIMING_PATCHES) assertSiteBytes(image, site);

  const out = Uint8Array.from(image);
  out.set(replacement, DECODER_OFFSET);
  for (const site of TIMING_PATCHES) out.set(site.after, site.offset);
  return out;
}

/** Apply the patch only to the verified BDF04 release. */
export function patchBdf04(image) {
  if (!(image instanceof Uint8Array)) throw new TypeError("BDF04 image must be a Uint8Array");
  if (image.length !== PRG_SIZE) throw new Error(`unexpected BDF04 image size (${image.length} bytes)`);
  const actual = sha256(image);
  if (actual !== PRG_SHA256)
    throw new Error(`unsupported BDF04 image (SHA-256 ${actual}); expected the verified release`);
  return replaceBdf04Sites(image);
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
