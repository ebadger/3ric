// node codegen/tools/make-sd-card.test.mjs   (no WASM build needed)
//
// Checks the micro-SD card the emulators ship with (emulator/Data/sd.zip)
// against the sources it is built from: the card's layout and files, its
// notices, and that DIRTBIKE.PRG and TITLE are the upstream release (by
// SHA-256) plus exactly the converter's patches, with the loader and the
// resident that the committed sources assemble. Set DIRTBIKE_DSK to the
// upstream dist/DIRTBIKE.dsk to also rebuild the card and compare it byte
// for byte.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CARD_ZIP, NOTICE_DIR, NOTICES, IMAGE_NAME, CARD_SECTORS, CARD_LABEL, IMAGE_SHA256,
  sha256, crc32, cardTree, buildCardImage, zipImage, unzipEntry,
} from "./make-sd-card.mjs";
import { readFat32 } from "./ultima5/fat32.mjs";
import {
  buildResident, buildPrg, gamePatches, titlePatches, tsTable,
  GAME_ORG, GAME_SIZE, GAME_SHA256, TITLE_SHA256, LOAD_ADDR, TRACKS,
} from "./port-dirtbike.mjs";

// The GNU GPL v3 text as published by the FSF (gpl-3.0.txt; git blob f288702d).
const GPL3_SHA256 = "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986";

// The zip helpers.
assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
const sample = Uint8Array.from({ length: 70000 }, (_, i) => (i % 1000 < 3 ? i : 0) & 255);
assert.deepEqual(Buffer.from(unzipEntry(zipImage(sample))), Buffer.from(sample));
assert.throws(() => unzipEntry(zipImage(sample), "other"), /not in the zip/);
const broken = Buffer.from(zipImage(sample));
broken[40] ^= 1;
assert.throws(() => unzipEntry(broken), /CRC|invalid/);
assert.throws(() => cardTree(new Uint8Array(143360)), /SHA-256 differs/);
console.log("PASS zip writer/reader (CRC, sizes), wrong disk refused");

// The card: one folder, Dirt Bike's files, then the program and the notices.
const image = unzipEntry(fs.readFileSync(CARD_ZIP), IMAGE_NAME);
assert.equal(image.length, CARD_SECTORS * 512, "a 64 MB card");
assert.equal(sha256(image), IMAGE_SHA256, "the card make-sd-card.mjs last built (IMAGE_SHA256)");
const card = readFat32(image);
assert.deepEqual([card.label, card.partLba, card.sectorsPerCluster, card.fats, card.rootCluster],
  [CARD_LABEL, 2048, 1, 2, 2], "MBR, partition at LBA 2048, 512-byte clusters, 2 FATs, root at cluster 2");
assert.deepEqual(Object.keys(card.tree), ["DIRTBIKE"], "the card holds Dirt Bike and nothing else");
const files = card.tree.DIRTBIKE;
const tracks = Array.from({ length: TRACKS }, (_, i) => "T" + String(i + 1).padStart(2, "0"));
assert.deepEqual(Object.keys(files), ["TITLE", ...tracks, "DIRTHOF", "DIRTBIKE.PRG", ...NOTICES]);
console.log(`PASS card layout: ${CARD_LABEL}, DIRTBIKE/ with ${Object.keys(files).length} files`);

// The notices: the repository's files, the licence verbatim, the README for the 3RIC screen.
for (const name of NOTICES)
  assert.deepEqual(Buffer.from(files[name]), fs.readFileSync(path.join(NOTICE_DIR, name)), `${name} is emulator/Data/sd-card/DIRTBIKE/${name}`);
assert.equal(sha256(files["LICENSE.TXT"]), GPL3_SHA256, "LICENSE.TXT is the GNU GPL v3, verbatim");
const readme = Buffer.from(files["README.TXT"]).toString("latin1");
assert.ok(readme.endsWith("\r") && !readme.includes("\n"), "README.TXT: CR line ends, as the ROM DOS prints text");
for (const line of readme.slice(0, -1).split("\r"))
  assert.ok(line.length <= 39 && !/[a-z]/.test(line), `README.TXT fits the 40-column upper-case screen: "${line}"`);
for (const want of [/ARNAUD VERHILLE/, /GNU GENERAL\rPUBLIC LICENSE, VERSION 3/, /LICENSE\.TXT/, /NO WARRANTY/,
  /MODIFIED FOR 3RIC ON 2026-10-22/, /COMMIT 8140D9FFCA77/, /GITHUB\.COM\/HABIB256\/POM2GAMES/,
  /GITHUB\.COM\/EBADGER\/3RIC/, /CODEGEN\/TOOLS\/PORT-DIRTBIKE\.MJS/, /CODEGEN\/PATCHES\/DIRTBIKE\//,
  /CD DIRTBIKE\r +BRUN DIRTBIKE\.PRG 0800/])
  assert.match(readme, want);
console.log("PASS notices: README.TXT (author, GPL v3, modified 2026-10-22, sources) and LICENSE.TXT (GPL v3 verbatim)");

// DIRTBIKE.PRG and TITLE: the release plus the converter's patches, built by the committed glue.
const prg = files["DIRTBIKE.PRG"];
const game = prg.subarray(prg.length - GAME_SIZE);
const entries = [...tsTable(game).map(([name, t, s]) => ({ name, t, s, raw: files[name] })),
  { name: "DIRTHOF", t: 0xff, s: 0xff, raw: files.DIRTHOF }];
const resident = buildResident(entries);
assert.deepEqual(Buffer.from(buildPrg(game, resident).prg), Buffer.from(prg),
  "DIRTBIKE.PRG is the loader, resident and game image the committed sources build");
const unpatch = (bytes, base, patches) => {
  const out = bytes.slice();
  for (const p of patches) {
    const at = p.at - base;
    assert.deepEqual(Array.from(out.subarray(at, at + p.after.length)), p.after, `patch at $${p.at.toString(16).toUpperCase()} (${p.why})`);
    out.set(p.before, at);
  }
  return out;
};
assert.equal(sha256(unpatch(game, GAME_ORG, gamePatches(resident.symbols))), GAME_SHA256,
  "the game is the upstream release plus exactly the converter's patches");
const title = unpatch(files.TITLE, LOAD_ADDR, titlePatches(resident.symbols));
assert.equal(title[0] | (title[1] << 8), LOAD_ADDR);
assert.equal(sha256(title.subarray(4, 4 + (title[2] | (title[3] << 8)))), TITLE_SHA256, "TITLE likewise");
console.log("PASS DIRTBIKE.PRG and TITLE: the upstream release + the converter's patches, loader and resident from the committed sources");

if (process.env.DIRTBIKE_DSK) {
  const rebuilt = buildCardImage(cardTree(new Uint8Array(fs.readFileSync(process.env.DIRTBIKE_DSK))));
  assert.ok(Buffer.from(rebuilt).equals(Buffer.from(image)), "make-sd-card.mjs rebuilds the committed card byte for byte");
  console.log("PASS rebuilt from DIRTBIKE_DSK: the committed card, byte for byte");
} else {
  console.log("SKIP rebuild (set DIRTBIKE_DSK to the upstream dist/DIRTBIKE.dsk)");
}
