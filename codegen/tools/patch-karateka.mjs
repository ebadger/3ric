import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildWozFromDsk } from "./wozgen.mjs";
import { sha256 } from "./wozedit.mjs";

export const INPUT_SHA256 = "4399db1c5469299f6a519abd890456ba1bbba70596d72096f1db4a84e5669370";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hex = value => `$${value.toString(16)}`;
const instruction = (opcode, address) => [opcode, address & 255, address >> 8];

export function buildPayload() {
  const player = assemble(fs.readFileSync(path.join(root, "codegen", "patches", "karateka-music.s"), "utf8"));
  const s = player.symbols;
  if (player.org !== 0xc800 || s.PLAYER_END > 0xca00 || s.SCORE_END > 0xce00 || s.ADAPTER_END > 0xd000)
    throw new Error("Karateka music exceeds its reserved RAM");
  const installer = assemble(`
        .org $8000
        ldx #0
copy:
        lda $8100,x
        sta $C800,x
        lda $8200,x
        sta $C900,x
        lda $8300,x
        sta $CC00,x
        lda $8400,x
        sta $CD00,x
        lda $8500,x
        sta $CF00,x
        inx
        bne copy
        jmp ${hex(s.MUSIC_INIT)}
`);
  if (installer.bytes.length > 256) throw new Error("Karateka installer exceeds one sector");
  const pages = Buffer.alloc(6 * 256);
  pages.set(installer.bytes);
  for (const [page, address] of [[1, 0xc800], [2, 0xc900], [3, 0xcc00], [4, 0xcd00], [5, 0xcf00]])
    pages.set(player.bytes.subarray(address - player.org, address - player.org + 256), page * 256);

  const stub = assemble(`
        .org $B676
        php
        pha
        phx
        phy
        lda #33
        sta $B7EC
        lda #0
        sta $B7ED
        sta $B7F0
        lda #$80
        sta $B7F1
read_page:
        lda #$B7
        ldy #$E8
        jsr $B7B5
        bcs failed
        inc $B7F1
        inc $B7ED
        lda $B7ED
        cmp #6
        bne read_page
        jsr $8000
        ply
        plx
        pla
        plp
        lda #1
        sta $B7EC
        rts
failed:
        bit $C051
        bit $C054
        ldx #0
show_error:
        lda error_text,x
        beq halted
        sta $0400,x
        inx
        bne show_error
halted:
        jmp halted
error_text:
        .byte ${Array.from(Buffer.from("MUSIC DISK READ ERROR - RESET"), v => v | 128).join(",")},0
`);
  if (stub.org + stub.bytes.length > 0xb6fe) throw new Error("Karateka bootstrap overlaps boot metadata");
  return { player, installer, pages, stub };
}

export function patchKarateka(input) {
  if (input.length !== 143360 || sha256(input) !== INPUT_SHA256)
    throw new Error(`Unsupported Karateka DSK; expected 143360 bytes and SHA-256 ${INPUT_SHA256}. No output written.`);
  const payload = buildPayload();
  const s = payload.player.symbols;
  const dsk = Buffer.from(input);
  const patches = [];
  const edit = (offset, before, after, name) => {
    before = Buffer.from(before);
    after = Buffer.from(after);
    if (before.length !== after.length || offset < 0 || offset + before.length > dsk.length
        || !dsk.subarray(offset, offset + before.length).equals(before))
      throw new Error(`Unexpected Karateka bytes for ${name} at ${hex(offset)}`);
    if (patches.some(p => offset < p.offset + p.before.length / 2 && p.offset < offset + before.length))
      throw new Error(`Overlapping Karateka patch: ${name}`);
    dsk.set(after, offset);
    patches.push({ name, offset, before: before.toString("hex"), after: after.toString("hex") });
  };
  const copies = (pattern, count, callback) => {
    const needle = Buffer.from(pattern, "hex");
    const offsets = [];
    for (let at = input.indexOf(needle); at >= 0; at = input.indexOf(needle, at + 1)) offsets.push(at);
    if (offsets.length !== count) throw new Error(`Expected ${count} copies of ${pattern}; found ${offsets.length}`);
    for (const offset of offsets) callback(offset);
  };
  edit(0x115, [0xa9, 1, 0x8d, 0xec, 0xb7],
    [...instruction(0x20, payload.stub.org), 0xea, 0xea], "bootstrap entry");
  edit(0x76, input.subarray(0x76, 0x76 + payload.stub.bytes.length), payload.stub.bytes, "bootstrap");
  edit(33 * 4096, Buffer.alloc(payload.pages.length), payload.pages, "original player and score");

  copies("4c0f194c421a4c4b1a4c5b1c4c641c", 6, offset => {
    for (const [delta, address, target] of [
      [3, 0x1a42, s.DRAW_FORWARD], [6, 0x1a4b, s.DRAW_FORWARD_FLIP],
      [9, 0x1c5b, s.DRAW_REVERSE], [12, 0x1c64, s.DRAW_REVERSE_FLIP],
    ]) edit(offset + delta, instruction(0x4c, address), instruction(0x4c, target), "sprite clock");
  });
  copies("e601a501291fd0f1", 6, offset =>
    edit(offset, [0xe6, 1, 0xa5, 1], [...instruction(0x20, s.CLEAR_PAGE), 0xea], "clear clock"));
  for (const offset of [0xa238, 0xa289])
    edit(offset, [0xca, 0xe0, 0xc0], instruction(0x20, s.FILL_ROW), "fill clock");
  edit(0x4f58, instruction(0x20, 0x7761), instruction(0x20, s.COPY_COLUMN), "copy clock");
  edit(0x4e00, instruction(0x4c, 0x7628), instruction(0x4c, s.GAME_FRAME), "gameplay music");
  for (const [index, target] of [0x0c55, 0x0c64, 0x0c74, 0x0c84, 0x0c92, 0x0ca0, 0x0cb0].entries())
    edit(0xa440 + index * 3, instruction(0x4c, target), instruction(0x4c, s[`EFFECT_${index + 1}`]), "speaker transport");
  for (const [offset, target] of [[0x4f8e, s.GAME_PAUSE], [0x4fe3, s.GAME_WAIT]])
    edit(offset, [0x8d, 0x10, 0xc0], instruction(0x4c, target), "pause music");
  copies("a000b1f78d5e0dc8b1f78d880d", 6, offset =>
    edit(offset, [0xa0, 0, 0xb1, 0xf7], [...instruction(0x4c, s.GAME_CUE), 0xea], "original music cue"));
  copies("4c0c024c5e024ca2024c3702", 6, offset => {
    for (const [delta, address, target] of [
      [0, 0x020c, s.LOAD_GAME], [3, 0x025e, s.WAIT_GAME],
      [6, 0x02a2, s.RESTART_GAME], [9, 0x0237, s.NEXT_GAME],
    ]) edit(offset + delta, instruction(0x4c, address), instruction(0x4c, target), "loading music");
  });
  return { dsk, patches, payload };
}

function main(args) {
  if (args.length !== 2)
    throw new Error("Usage: node codegen\\tools\\patch-karateka.mjs <original.dsk> <new.dsk|new.woz>");
  const [input, output] = args.map(name => path.resolve(name));
  const same = process.platform === "win32" ? input.toLowerCase() === output.toLowerCase() : input === output;
  if (same) throw new Error("Input and output must be different files");
  const extension = path.extname(output).toLowerCase();
  if (extension !== ".dsk" && extension !== ".woz") throw new Error("Output must end in .dsk or .woz");
  const result = patchKarateka(fs.readFileSync(input));
  const bytes = extension === ".woz" ? buildWozFromDsk(result.dsk) : result.dsk;
  fs.writeFileSync(output, bytes, { flag: "wx" });
  console.log(`Created ${output}\nOriginal Mockingboard gameplay score for 3ric; keep game images local.\n`
    + `SHA-256: ${sha256(bytes)}\nPhysical hardware and complete-playthrough approval are separate.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`patch-karateka: ${error.message}`); process.exitCode = 1; }
}
