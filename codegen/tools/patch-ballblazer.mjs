import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { assembleBankedInput, bankedChecksum, ROM_SHA256 } from "./banked-input.mjs";
import { buildBootableWoz } from "./wozgen.mjs";
import { sha256 } from "./wozedit.mjs";

export const INPUT_SHA256 = "5e0cc7aa1fd0832ceccb24e3a24f4921534e200cadc57ea96e576d02c60b0aeb";
export { ROM_SHA256 };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DISK_BYTES = 143360;
const PROGRAM_ORIGIN = 0x07fd;
const PROGRAM_LENGTH = 27043;
const INSTALL_ORIGIN = 0x7200;
const hex = value => `$${value.toString(16)}`;
const byteList = bytes => Array.from(bytes, hex).join(",");
const jump = (opcode, address, count = 3) =>
  [opcode, address & 255, address >> 8, ...Array(count - 3).fill(0xea)];

export function readDisk(input) {
  const bytes = Buffer.from(input);
  const disk = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? gunzipSync(bytes, { maxOutputLength: DISK_BYTES }) : bytes;
  if (disk.length !== DISK_BYTES || sha256(disk) !== INPUT_SHA256)
    throw new Error(`Unsupported Ballblazer disk; expected uncompressed SHA-256 ${INPUT_SHA256}. No output written.`);
  return disk;
}

export function extractProgram(disk) {
  if (disk.length !== DISK_BYTES) throw new Error("Expected a 35-track DOS-order disk");
  const sector = (track, number) => {
    if (!Number.isInteger(track) || !Number.isInteger(number)
        || track < 0 || track >= 35 || number < 0 || number >= 16)
      throw new Error(`Invalid DOS sector ${track}:${number}`);
    const offset = track * 4096 + number * 256;
    return disk.subarray(offset, offset + 256);
  };
  const vtoc = sector(17, 0);
  if (vtoc[3] !== 3 || vtoc[0x34] !== 35 || vtoc[0x35] !== 16 || vtoc.readUInt16LE(0x36) !== 256)
    throw new Error("Unexpected DOS 3.3 volume geometry");
  let track = vtoc[1], number = vtoc[2], found = null;
  const catalogs = new Set();
  while (track) {
    const key = `${track}:${number}`;
    if (catalogs.has(key)) throw new Error("Cyclic DOS catalog");
    catalogs.add(key);
    const catalog = sector(track, number);
    for (let index = 0; index < 7; index++) {
      const entry = catalog.subarray(11 + index * 35, 46 + index * 35);
      if (!entry[0] || entry[0] === 255) continue;
      const name = Buffer.from(entry.subarray(3, 33).map(value => value & 127)).toString("ascii").trim();
      if (name !== "BALLBLAZER") continue;
      if (found || (entry[2] & 127) !== 4) throw new Error("Ambiguous or non-binary BALLBLAZER");
      found = entry;
    }
    track = catalog[1];
    number = catalog[2];
  }
  if (!found) throw new Error("BALLBLAZER binary not found");
  track = found[0];
  number = found[1];
  const occupied = new Set(), chunks = [];
  while (track) {
    const key = `${track}:${number}`;
    if (occupied.has(key) || catalogs.has(key)) throw new Error("Overlapping DOS sector chain");
    occupied.add(key);
    const list = sector(track, number);
    if (list.readUInt16LE(5) !== chunks.length) throw new Error("Non-contiguous DOS sector list");
    for (let offset = 12; offset < 256; offset += 2) {
      const t = list[offset], s = list[offset + 1];
      if (!t && !s) break;
      const dataKey = `${t}:${s}`;
      if (occupied.has(dataKey) || catalogs.has(dataKey) || dataKey === "17:0")
        throw new Error("Overlapping DOS data sector");
      occupied.add(dataKey);
      chunks.push(sector(t, s));
    }
    track = list[1];
    number = list[2];
  }
  if (occupied.size !== found.readUInt16LE(33)) throw new Error("DOS file sector count mismatch");
  const binary = Buffer.concat(chunks);
  if (binary.length < 4 || binary.readUInt16LE(0) !== PROGRAM_ORIGIN
      || binary.readUInt16LE(2) !== PROGRAM_LENGTH || binary.length < PROGRAM_LENGTH + 4)
    throw new Error("Unexpected BALLBLAZER load address or length");
  const program = binary.subarray(4, PROGRAM_LENGTH + 4);
  if (!program.subarray(0, 3).equals(Buffer.from([0x4c, 0x66, 0x24])))
    throw new Error("Unexpected BALLBLAZER entry jump");
  return program;
}

export function buildPayload(rom) {
  if (sha256(rom) !== ROM_SHA256) throw new Error(`Unsupported 3ric ROM; expected SHA-256 ${ROM_SHA256}`);
  const resident = assembleBankedInput(path.join(root, "codegen", "patches", "ballblazer-3ric.s"));
  const s = resident.symbols;
  if (resident.org !== 0xc800 || s.POLL_END > 0xca00 || s.ADAPTER_END > 0xce00 || s.NMI_END > 0xcff0)
    throw new Error("Ballblazer adapter exceeds its reserved RAM");
  const patches = [];
  const add = (address, before, after) => {
    if (before.length !== after.length) throw new Error("Patch extent mismatch");
    const source = address >= 0x0400 && address < 0x0800 ? address + 0x1c00
      : address >= 0x6000 ? address - 0x3b00 : address;
    patches.push({ address, source, before, after });
  };
  add(0x0400, [0xd8, 0xa2, 0xff], jump(0x4c, s.GAME_RESET));
  add(0x0890, [0x20, 0x32, 0x09], jump(0x20, s.NEW_ROUND));
  for (const address of [0x248b, 0x2493])
    add(address, [0xad, 0x10, 0xc0], jump(0x20, s.ACK_KEY));
  for (const address of [0x248e, 0x975a, 0xa20d])
    add(address, [0xad, 0, 0xc0], jump(0x20, s.READ_KEY));
  for (const address of [0x9764, 0xa231])
    add(address, [0x8d, 0x10, 0xc0], jump(0x20, s.ACK_KEY));
  add(0x972c, [0xad, 0x86, 2, 0x85, 0x16, 0xad, 0x98, 2, 0x85, 0x17],
    jump(0x20, s.PREPARE_FIRE, 10));
  add(0x9752, [0xa5, 0x9e, 0x85, 0x14, 0xa5, 0xaf, 0x85, 0x15],
    jump(0x20, s.PREPARE_DIRECTION, 8));
  add(0x978b, [0xa0, 0, 0xad], jump(0x4c, s.APPLY_PADS));
  add(0x9da2, [0xad, 0x82, 0xc0], [0xad, 0x83, 0xc0]);
  const table = patches.flatMap(patch =>
    [patch.source & 255, patch.source >> 8, patch.before.length, ...patch.before, ...patch.after]);
  if (table.length > 255) throw new Error("Patch table exceeds its byte index");
  const poll = Buffer.alloc(512), game = Buffer.alloc(512), nmi = Buffer.alloc(256);
  poll.set(resident.bytes.subarray(0, s.POLL_END - 0xc800));
  game.set(resident.bytes.subarray(0x400, s.ADAPTER_END - 0xc800));
  nmi.set(resident.bytes.subarray(0x700));
  const checksum = bankedChecksum(rom);
  const installer = assemble(`
        .org ${hex(INSTALL_ORIGIN)}
install:
        php
        sei
        cld
        bit $C082
        bit $C007
        ldx #26
check_proxy:
        lda $F1BB,x
        cmp expected_proxy,x
        beq proxy_ok
        jmp rom_failed
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
        bne rom_failed
        lda $CFF1
        cmp #${hex(checksum[1])}
        bne rom_failed
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
        lda patches,x
        sta patch_size
        inx
        ldy #0
check_loop:
        lda patches,x
        inx
check_byte:
        cmp $FFFF,y
        bne game_failed
        iny
        cpy patch_size
        bne check_loop
        ldy #0
write_loop:
        lda patches,x
        inx
write_byte:
        sta $FFFF,y
        iny
        cpy patch_size
        bne write_loop
        cpx #${table.length}
        bne next_patch
        jmp install_input
rom_failed:
        ldx #0
        bra show_error
game_failed:
        ldx #40
show_error:
        bit $C082
        bit $C007
        bit $C051
        bit $C054
        bit $C052
        ldy #0
        lda #$A0
clear_screen:
        sta $0400,y
        sta $0500,y
        sta $0600,y
        sta $0700,y
        iny
        bne clear_screen
show_message:
        lda messages,x
        beq halted
        sta $0400,y
        inx
        iny
        bra show_message
halted:
        jmp halted
install_input:
        ldx #0
copy_adapter:
        lda poll_bytes,x
        sta $C800,x
        lda poll_bytes+256,x
        sta $C900,x
        lda game_bytes,x
        sta $CC00,x
        lda game_bytes+256,x
        sta $CD00,x
        lda nmi_bytes,x
        sta $CF00,x
        inx
        bne copy_adapter
        lda #$78
        sta $C20E
        sta $C20D
        lda $C202
        and #$CF
        ora #$C0
        sta $C202
        lda $C20B
        and #$7F
        sta $C20B
        lda $C200
        and #$0F
        sta ${hex(s.PORT_BASE)}
        bit $C081
        bit $C081
        ldx #0
        ldy #32
copy_noise:
noise_read:
        lda $E000,x
noise_write:
        sta $E000,x
        inx
        bne copy_noise
        inc noise_read+2
        inc noise_write+2
        dey
        bne copy_noise
        lda #3
        sta ${hex(s.RAM_MODE)}
        lda #<${hex(s.NMI_ENTRY)}
        sta $FFFA
        lda #>${hex(s.NMI_ENTRY)}
        sta $FFFB
        jsr ${hex(s.SELECT_RAM)}
        plp
        jmp $2466
patch_size:
        .byte 0
messages:
        .byte ${byteList(Buffer.from("3RIC ROM MISMATCH - RESET".padEnd(39, " ")).map(v => v | 128))},0
        .byte ${byteList(Buffer.from("BALLBLAZER PATCH MISMATCH - RESET").map(v => v | 128))},0
expected_proxy:
        .byte ${byteList(rom.subarray(0xf1bb, 0xf1d6))}
patches:
        .byte ${byteList(table)}
poll_bytes:
        .byte ${byteList(poll)}
game_bytes:
        .byte ${byteList(game)}
nmi_bytes:
        .byte ${byteList(nmi)}
install_end:
`);
  if (installer.symbols.INSTALL_END > 0x8f00) throw new Error("Installer exceeds WOZ staging capacity");
  return { resident, patches, installer, checksum };
}

export function createBootImage(program, payload) {
  if (program.length !== PROGRAM_LENGTH) throw new Error("Unexpected game extent");
  const image = Buffer.alloc(payload.installer.symbols.INSTALL_END - 0x0800);
  image.set(program.subarray(3));
  image.set(payload.installer.bytes, INSTALL_ORIGIN - 0x0800);
  return { image, woz: buildBootableWoz(image, 0x0800, INSTALL_ORIGIN) };
}

export function patchBallblazer(input, rom) {
  const disk = readDisk(input);
  const program = extractProgram(disk);
  const payload = buildPayload(rom);
  for (const patch of payload.patches) {
    const offset = patch.source - PROGRAM_ORIGIN;
    if (!program.subarray(offset, offset + patch.before.length).equals(Buffer.from(patch.before)))
      throw new Error(`Unexpected game bytes at ${hex(patch.source)}`);
  }
  return { ...createBootImage(program, payload), payload, programSha256: sha256(program) };
}

function main(args) {
  if (args.length !== 2)
    throw new Error("Usage: node codegen\\tools\\patch-ballblazer.mjs <input.dsk[.gz]> <output.woz>");
  const [input, output] = args.map(name => path.resolve(name));
  if (process.platform === "win32" ? input.toLowerCase() === output.toLowerCase() : input === output)
    throw new Error("Input and output must be different files");
  const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
  const result = patchBallblazer(fs.readFileSync(input), rom);
  fs.writeFileSync(output, result.woz, { flag: "wx" });
  console.log(`Created ${output}\nBallblazer / 3ric keyboard and two-SNES compatibility candidate; physical-board confirmation required.\n`
    + `SHA-256: ${sha256(result.woz)}`);
}

if (typeof process !== "undefined" && process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`patch-ballblazer: ${error.message}`); process.exitCode = 1; }
}
