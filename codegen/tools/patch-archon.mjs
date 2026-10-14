import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { bankedChecksum, bankedInputSource, ROM_SHA256, snesPollSource } from "./banked-input.mjs";
import { patchWozSectors, readWozSectors, sha256 } from "./wozedit.mjs";

export const INPUT_SHA256 = "a7722abdfc42ef7372b5183283b6f55464c3817b1c855256186cb5c30e600c8d";
export { bankedChecksum, ROM_SHA256 };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hex = value => `$${value.toString(16)}`;
const byteList = bytes => Array.from(bytes, hex).join(",");
const instruction = (opcode, address) => [opcode, address & 255, address >> 8];
const physicalSector = logical => logical === 15 ? 15 : logical * 13 % 15;

export function buildPayload(rom) {
  if (sha256(rom) !== ROM_SHA256)
    throw new Error(`Unsupported 3ric ROM; expected SHA-256 ${ROM_SHA256}`);
  const resident = assemble(fs.readFileSync(path.join(root, "codegen", "patches", "archon-3ric.s"), "utf8")
    .replace("; @shared-snes-poll", snesPollSource())
    + "\n" + bankedInputSource());
  const s = resident.symbols;
  if (resident.org !== 0xcc00 || s.ADAPTER_END > 0xce00 || s.NMI_END > 0xd000)
    throw new Error("Archon resident exceeds its reserved RAM");
  const gamePatches = [];
  const addGame = (address, before, after) => {
    if (before.length !== 3 || after.length !== 3) throw new Error("Invalid runtime patch");
    gamePatches.push({ address, before, after });
  };
  for (const [address, mode] of [
    [0x0800, 3], [0x0803, 3], [0x0834, 11], [0x0848, 3],
    [0x6a47, 11], [0x6a55, 3], [0x89d9, 3], [0x89dc, 3],
    [0x8a57, 3], [0x8a64, 11], [0x8a9d, 3], [0x8aa0, 3],
    [0x9189, 11], [0x918f, 3],
  ]) {
    addGame(address, [0x2c, 0x80 + mode, 0xc0],
      instruction(0x20, mode === 3 ? s.RAM2_WRITE : s.RAM1_WRITE));
  }
  addGame(0x1ea4, [0xa9, 0, 0xa2], instruction(0x4c, s.GAME_PAD));
  addGame(0x6cdd, [0x2c, 0x10, 0xc0], [0x9c, 0, 0xc0]);
  // $2000-$4EFF is copied to $D100-$FFFF by the game's own startup.
  addGame(0x4efa, [0x0d, 0x05, 0xcd], [s.NMI_ENTRY & 255, s.NMI_ENTRY >> 8, 0xcd]);
  const table = gamePatches.flatMap(patch =>
    [patch.address & 255, patch.address >> 8, ...patch.before, ...patch.after]);
  if (table.length >= 256) throw new Error("Runtime patch table exceeds its index");
  const game = assemble(`
        .org $C800
game_init:
        php
        pha
        phx
        phy
        cld
        ldx #0
next_patch:
        lda patches,x
        sta check_byte+1
        sta write_byte+1
        inx
        lda patches,x
        sta check_byte+2
        sta write_byte+2
        inx
        ldy #0
check_loop:
        lda patches,x
        inx
check_byte:
        cmp $FFFF,y
        bne failed
        iny
        cpy #3
        bne check_loop
        ldy #0
write_loop:
        lda patches,x
        inx
write_byte:
        sta $FFFF,y
        iny
        cpy #3
        bne write_loop
        cpx #${table.length}
        bne next_patch
        ply
        plx
        pla
        plp
        jmp $0800
failed:
        bit $C082
        bit $C007
        bit $C051
        bit $C054
        bit $C052
        ldx #0
show_error:
        lda error_message,x
        beq halted
        sta $0400,x
        inx
        bne show_error
halted:
        jmp halted
error_message:
        .byte ${byteList(Buffer.from("ARCHON PATCH MISMATCH - RESET").map(v => v | 0x80))},0
patches:
        .byte ${byteList(table)}
`);
  if (game.bytes.length > 512) throw new Error("Game installer exceeds $C800-$C9FF");
  const gamePages = Buffer.alloc(512);
  gamePages.set(game.bytes);
  const adapterPages = Buffer.alloc(512);
  adapterPages.set(resident.bytes.subarray(0, s.ADAPTER_END - 0xcc00));
  const nmiPage = Buffer.alloc(256);
  nmiPage.set(resident.bytes.subarray(0x300));
  const checksum = bankedChecksum(rom);
  const installer = assemble(`
        .org $8000
install:
        php
        pha
        phx
        phy
        sei
        cld
        bit $C082
        ldx #26
check_proxy:
        lda $F1BB,x
        cmp expected_proxy,x
        beq proxy_ok
        jmp failed
proxy_ok:
        dex
        bpl check_proxy
        inc $CAFE
        bit $C006
        stz $CFF0
        stz $CFF1
        ldx #0
        ldy #9
checksum_byte:
        lda $B500,x
        clc
        adc $CFF0
        adc #0
        sta $CFF0
        clc
        adc $CFF1
        adc #0
        sta $CFF1
        inx
        bne checksum_byte
        inc checksum_byte+2
        dey
        bne checksum_byte
        dec $CAFE
        bit $C007
        lda $CFF0
        cmp #${hex(checksum[0])}
        bne failed
        lda $CFF1
        cmp #${hex(checksum[1])}
        bne failed
        ldx #0
copy:
        lda game_bytes,x
        sta $C800,x
        lda game_bytes+256,x
        sta $C900,x
        lda adapter_bytes,x
        sta $CC00,x
        lda adapter_bytes+256,x
        sta $CD00,x
        lda nmi_bytes,x
        sta $CF00,x
        inx
        bne copy
        lda #$60
        sta $C20E
        sta $C20D
        lda #0
        jsr ${hex(s.PREPARE_RAM)}
        ply
        plx
        pla
        plp
        rts
failed:
        bit $C082
        bit $C007
        bit $C051
        bit $C054
        bit $C052
        lda #$A0
        ldx #0
clear:
        sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne clear
        ldx #0
show_error:
        lda error_message,x
        beq halted
        sta $0400,x
        inx
        bne show_error
halted:
        jmp halted
error_message:
        .byte ${byteList(Buffer.from("3RIC ROM MISMATCH - RESET").map(v => v | 0x80))},0
expected_proxy:
        .byte ${byteList(rom.subarray(0xf1bb, 0xf1d6))}
game_bytes:
        .byte ${byteList(gamePages)}
adapter_bytes:
        .byte ${byteList(adapterPages)}
nmi_bytes:
        .byte ${byteList(nmiPage)}
`);
  const pages = Math.ceil(installer.bytes.length / 256);
  if (pages > 8) throw new Error("Archon bootstrap exceeds its $8000-$87FF staging area");
  const stub = assemble(`
        .org $B6A8
        php
        pha
        phx
        phy
        lda #3
        sta $B7EC
        lda #${pages - 1}
        sta $B7ED
        lda #${hex(0x80 + pages - 1)}
        sta $B7F1
        stz $B7F0
        lda #${pages}
        sta $B7E4
        jsr $B7C0
        jsr $8000
        ply
        plx
        pla
        plp
        lda #$20
        sta $B7EC
        rts
`);
  if (stub.bytes.length > 0x4a) throw new Error("Bootstrap stub overlaps boot metadata");
  return { resident, game, gamePatches, gamePages, adapterPages, nmiPage, installer, stub, pages, checksum };
}

export function patchArchon(input, rom) {
  if (sha256(input) !== INPUT_SHA256)
    throw new Error(`Unsupported Archon image; expected SHA-256 ${INPUT_SHA256}. No output written.`);
  const payload = buildPayload(rom);
  const s = payload.resident.symbols;
  const coordinates = Array.from({ length: 560 }, (_, i) => ({ track: i >> 4, sector: i & 15 }));
  const sectors = readWozSectors(input, coordinates);
  const data = new Map(sectors.map(sector => [`${sector.track}/${sector.sector}`, Buffer.from(sector.data)]));
  const changed = new Map();
  const edit = (track, sector, offset, before, after) => {
    const key = `${track}/${sector}`;
    const bytes = data.get(key);
    const expected = Buffer.from(before);
    if (!bytes || expected.length !== after.length || offset + expected.length > 256
        || !bytes.subarray(offset, offset + expected.length).equals(expected))
      throw new Error(`Unexpected Archon bytes at ${key}+${offset.toString(16)}`);
    if (!changed.has(key)) changed.set(key, Buffer.from(bytes));
    bytes.set(after, offset);
  };
  const hook = (track, sector, offset, opcode, low, entry) =>
    edit(track, sector, offset, [opcode, low, 0xc0], instruction(0x20, entry));
  const ack = (track, sector, offset) =>
    edit(track, sector, offset, [0x2c, 0x10, 0xc0], [0x9c, 0, 0xc0]);
  edit(0, 13, 0x31, [0xa9, 0x20, 0x8d, 0xec, 0xb7], [0x20, 0xa8, 0xb6, 0xea, 0xea]);
  edit(0, 0, 0xa8, data.get("0/0").subarray(0xa8, 0xa8 + payload.stub.bytes.length), payload.stub.bytes);
  const installation = Buffer.alloc(payload.pages * 256);
  installation.set(payload.installer.bytes);
  for (let page = 0; page < payload.pages; page++) {
    edit(3, physicalSector(page), 0, Buffer.alloc(256), installation.subarray(page * 256, (page + 1) * 256));
  }
  for (const offset of [0x51, 0x54, 0x57])
    hook(32, 13, offset, 0xad, 0x83, s.RAM2_WRITE_LDA);
  hook(32, 13, 0x68, 0xad, 0x80, s.RAM2_READ_LDA);
  for (const [track, sector, offsets, mode] of [
    [17, 7, [0xb0, 0xb3, 0xe7, 0xea], 11],
    [18, 7, [0x48, 0x4b], 3],
    [19, 9, [0xeb, 0xee], 3], [20, 8, [0xeb, 0xee], 3],
    [19, 11, [0x22, 0x25], 3], [20, 10, [0x22, 0x25], 3],
    [20, 5, [0x7e], 0], [20, 9, [0x0b, 0x0e], 3],
  ]) {
    for (const offset of offsets)
      hook(track, sector, offset, 0x2c, 0x80 + mode,
        mode === 0 ? s.RAM2_READ : mode === 3 ? s.RAM2_WRITE : s.RAM1_WRITE);
  }
  // Interactive menu drawing stays behind our register-preserving NMI entry.
  // Loader/reset paths retain their explicit ROM selections.
  for (const [track, sector, offsets] of [
    [17, 7, [0xe1]], [17, 9, [0x18]], [18, 7, [0x64]],
    [19, 11, [0x18]], [20, 10, [0x18]],
    [20, 5, [0xab, 0xf7]], [20, 9, [0x3a]],
  ]) {
    for (const offset of offsets) hook(track, sector, offset, 0x2c, 0x81, s.RAM2_WRITE);
  }
  edit(20, 3, 0x11, [0x20, 0xa8, 0xfc], [0x20, 0x4e, 0x32]);
  for (const [track, sector] of [[19, 7], [20, 6]])
    edit(track, sector, 0xb4, [0xa9, 0, 0xa2], instruction(0x4c, s.MENU_PAD));
  for (const [track, sector, offsets] of [
    [0, 13, [0x90, 0x9b]], [17, 2, [0xd3, 0xe5]], [17, 9, [0x34]],
    [17, 11, [0x34]], [18, 15, [0x7b, 0x83]],
    [18, 0, [0x06, 0x82, 0xc7]], [19, 6, [0xfa]],
    [19, 9, [0x46]], [20, 8, [0x46]],
  ]) {
    for (const offset of offsets) ack(track, sector, offset);
  }
  edit(17, 13, 0xa8, [0x2c, 0x10, 0xc0], instruction(0x20, s.MENU_ENTER));
  edit(17, 0, 0x15, [0x2c, 0x81, 0xc0], instruction(0x20, s.MENU_LAUNCH));
  edit(18, 6, 0x94, [0x4c, 0, 8], instruction(0x4c, payload.game.symbols.GAME_INIT));
  const patches = [...changed].map(([key, before]) => {
    const [track, sector] = key.split("/").map(Number);
    return { track, sector, offset: 0, before: before.toString("hex"), after: data.get(key).toString("hex") };
  });
  const woz = patchWozSectors(input, patches);
  return { woz, patches, payload };
}

function main(args) {
  if (args.length !== 2)
    throw new Error("Usage: node codegen\\tools\\patch-archon.mjs <input.woz> <output.woz>");
  const [input, output] = args.map(name => path.resolve(name));
  if ((process.platform === "win32" ? input.toLowerCase() === output.toLowerCase() : input === output))
    throw new Error("Input and output must be different files");
  const result = patchArchon(fs.readFileSync(input), fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin")));
  fs.writeFileSync(output, result.woz, { flag: "wx" });
  console.log(`Created ${output}\nExperimental Archon / 3ric adapter; hardware verification required.\n`
    + `Changed sectors: ${result.patches.length}\nSHA-256: ${sha256(result.woz)}`);
}

if (typeof process !== "undefined" && process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`patch-archon: ${error.message}`); process.exitCode = 1; }
}
