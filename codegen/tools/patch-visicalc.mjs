import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { assembleBankedInput, bankedChecksum } from "./banked-input.mjs";
import { buildWozFromDsk, crc32 } from "./wozgen.mjs";
import { sha256 } from "./wozedit.mjs";

export const INPUT_SHA256 = "3805dbc99c4ebaf2f117c9e720f793dabbd10ef93f921eae7708853b2fd2a72e";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sectorOffset = (track, sector) => track * 4096 + sector * 256;
const hex = value => `$${value.toString(16)}`;
const byteList = bytes => Array.from(bytes, hex).join(",");

export function buildPayload(rom) {
  const resident = assembleBankedInput(
    fs.readFileSync(new URL("../patches/visicalc-3ric.s", import.meta.url), "utf8"), rom, "normalize_key");
  const s = resident.symbols;
  if (resident.org !== 0xc800 || s.ADAPTER_END > 0xc900
      || s.NMI_ENTRY !== 0xcf00 || s.NMI_END > 0xd000)
    throw new Error("VisiCalc resident exceeds its reserved RAM");
  const adapter = Buffer.alloc(256), nmi = Buffer.alloc(256);
  adapter.set(resident.bytes.subarray(0, s.ADAPTER_END - resident.org));
  nmi.set(resident.bytes.subarray(s.NMI_ENTRY - resident.org));
  const checksum = bankedChecksum(rom);
  const installer = assemble(`
        .org $3500
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
        lda adapter_bytes,x
        sta $C800,x
        lda nmi_bytes,x
        sta $CF00,x
        inx
        bne copy
        lda #3
        sta ${hex(s.RAM_MODE)}
        bit $C081
        bit $C081
        lda #<${hex(s.NMI_ENTRY)}
        sta $FFFA
        lda #>${hex(s.NMI_ENTRY)}
        sta $FFFB
        bit $C082
        ply
        plx
        pla
        plp
        jmp $183B
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
adapter_bytes:
        .byte ${byteList(adapter)}
nmi_bytes:
        .byte ${byteList(nmi)}
`);
  const pages = Math.ceil(installer.bytes.length / 256);
  if (pages > 4) throw new Error("VisiCalc installer exceeds its $3500-$38FF staging area");
  return { resident, installer, pages };
}

function fileSectors(dsk, track, sector, count) {
  const list = dsk.subarray(sectorOffset(track, sector), sectorOffset(track, sector) + 256);
  if (list[1] || list[2] || list[5] || list[6] || list[12 + count * 2] || list[13 + count * 2])
    throw new Error("Unexpected VisiCalc track/sector list");
  return Array.from({ length: count }, (_, i) => {
    const t = list[12 + i * 2], s = list[13 + i * 2];
    if (!t || t >= 35 || s >= 16) throw new Error("Invalid VisiCalc file sector");
    return sectorOffset(t, s);
  });
}

export function patchVisicalc(input, rom) {
  if (input.length !== 143360 || sha256(input) !== INPUT_SHA256)
    throw new Error(`Unsupported VisiCalc image; expected 143360-byte DOS-order DSK with SHA-256 ${INPUT_SHA256}. No output written.`);
  const payload = buildPayload(rom);
  const dsk = Buffer.from(input);
  const first = fileSectors(dsk, 18, 15, 45);
  const second = fileSectors(dsk, 20, 1, 111);
  const edits = [];
  const edit = (offset, before, after) => {
    const expected = Buffer.from(before), replacement = Buffer.from(after);
    if (expected.length !== replacement.length || offset < 0 || offset + expected.length > dsk.length
        || !dsk.subarray(offset, offset + expected.length).equals(expected))
      throw new Error(`Unexpected VisiCalc bytes at DSK offset ${hex(offset)}`);
    edits.push({ offset, before: expected, after: replacement });
    dsk.set(replacement, offset);
  };
  const installation = Buffer.alloc(payload.pages * 256);
  installation.set(payload.installer.bytes);
  const allocation = sectorOffset(17, 0) + 0x38 + 3 * 4;
  const originalBitmap = dsk.subarray(allocation, allocation + 4);
  let bitmap = dsk.readUInt32BE(allocation);
  const sectors = [];
  for (let i = 0; i < payload.pages; ++i) {
    const mask = 1 << (16 + i);
    if (!(bitmap & mask)) throw new Error(`VisiCalc adapter sector 3/${i} is not free`);
    bitmap = (bitmap & ~mask) >>> 0;
    const offset = sectorOffset(3, i);
    edit(offset, dsk.subarray(offset, offset + 256), installation.subarray(i * 256, (i + 1) * 256));
    sectors.push(3, i);
  }
  const newBitmap = Buffer.alloc(4);
  newBitmap.writeUInt32BE(bitmap);
  edit(allocation, originalBitmap, newBitmap);
  edit(sectorOffset(18, 15) + 12 + 45 * 2, Buffer.alloc(sectors.length), sectors);
  edit(sectorOffset(17, 15) + 11 + 33, [46, 0], [46 + payload.pages, 0]);
  edit(first[0] + 0xdf, [0x4c, 0, 0x18], [0x4c, 0, 0x35]);
  // File 2's relocation places file offset $7CE at the live bank selector $08CE.
  edit(second[7] + 0xce, [0xbd, 0x83, 0xc0, 0xbd, 0x83, 0xc0],
    [0x20, payload.resident.symbols.SELECT_RAM & 255, payload.resident.symbols.SELECT_RAM >> 8, 0xea, 0xea, 0xea]);
  const woz = Buffer.from(buildWozFromDsk(dsk));
  woz[22] = 1;
  woz.writeUInt32LE(crc32(woz, 12, woz.length), 8);
  return { woz, dsk, edits, payload };
}

function main(args) {
  if (args.length !== 2)
    throw new Error("Usage: node codegen\\tools\\patch-visicalc.mjs <VISICALC.DSK> <VISICALC-3RIC.woz>");
  const [input, output] = args.map(name => path.resolve(name));
  if (process.platform === "win32" ? input.toLowerCase() === output.toLowerCase() : input === output)
    throw new Error("Input and output must be different files");
  if (!output.toLowerCase().endsWith(".woz")) throw new Error("Output must have a .woz extension");
  const result = patchVisicalc(fs.readFileSync(input),
    fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin")));
  fs.writeFileSync(output, result.woz, { flag: "wx" });
  console.log(`Created ${output}\nVisiCalc / 3ric: 40 columns, write-protected; hardware verification required.\n`
    + `Emulator disk saving is not supported.\nSHA-256: ${sha256(result.woz)}`);
}

if (typeof process !== "undefined" && process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`patch-visicalc: ${error.message}`); process.exitCode = 1; }
}
