import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { bankedChecksum, bankedInputSource, ROM_SHA256, snesPollSource } from "./banked-input.mjs";
import { sha256 } from "./wozedit.mjs";
import { buildWozFromDsk } from "./wozgen.mjs";

export const INPUT_SHA256 = "2f159310ef2ea2107f4d9ac66ed2025de0f4a5e75ff702da2df127e499da8b6f";
export { ROM_SHA256 };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hex = value => `$${value.toString(16)}`;
const byteList = bytes => Array.from(bytes, hex).join(",");
const instruction = (opcode, address) => [opcode, address & 255, address >> 8];
const messageBytes = text => byteList(Buffer.from(text).map(value => value | 0x80)) + ",0";
const firmwareCalls = [
  [0x03e19, 0xff58], [0x03e72, 0xfded], [0x03e9c, 0xff58],
  [0x14f19, 0xff58], [0x14f72, 0xfded], [0x14f9c, 0xff58],
  [0x11990, 0xff58], [0x119a1, 0xfded],
  [0x117e7, 0xfded], [0x117ee, 0xfded], [0x117f2, 0xfded], [0x117f7, 0xfded],
  [0x117fa, 0xff2d], [0x117ff, 0xfded], [0x11604, 0xfded], [0x1160b, 0xf941],
  [0x11277, 0xfd9e], [0x112a4, 0xfde3], [0x112aa, 0xfc58], [0x112be, 0xfc9c],
  [0x11126, 0xfd35], [0x1112b, 0xfded], [0x11198, 0xfb1e], [0x111e1, 0xfb39],
  [0x111fd, 0xfd8e], [0x12f0d, 0xfc20], [0x12f3c, 0xfded], [0x12f41, 0xfded],
  [0x12e32, 0xfded], [0x12e36, 0xfded], [0x12e72, 0xfded], [0x12e8b, 0xfd8e],
  [0x12e9c, 0xfd8e], [0x12ea4, 0xfded], [0x12ea7, 0xfd8e], [0x12eac, 0xfded],
  [0x12ecc, 0xfd35], [0x12eec, 0xfded], [0x12d20, 0xfc9c], [0x12d23, 0xfd8e],
  [0x12d3e, 0xff2d], [0x12d43, 0xfded], [0x12d48, 0xfded], [0x12d4b, 0xfd8e],
  [0x12d52, 0xfd6a], [0x12c3e, 0xf864], [0x12c4f, 0xfb40], [0x12c5c, 0xf871],
  [0x12cb1, 0xf800], [0x12cc2, 0xf819], [0x12ccf, 0xf828],
  [0x12cd5, 0xfe95], [0x12cdb, 0xfe8b],
  [0x0d92f, 0xf832], [0x0c8bb, 0xfcb4], [0x0c8be, 0xfcb4], [0x0c207, 0xfcb4],
  [0x0bb24, 0xfe2c], [0x0b507, 0xfe93], [0x0b50a, 0xfe89], [0x09321, 0xfe2c],
];

export function buildPayload(rom) {
  if (sha256(rom) !== ROM_SHA256)
    throw new Error(`Unsupported 3ric ROM; expected SHA-256 ${ROM_SHA256}`);
  const firmwareTargets = [...new Set(firmwareCalls.map(([, address]) => address))]
    .filter(address => address !== 0xff58 && address !== 0xfd35);
  const wrappers = firmwareTargets.map(address => `
firmware_${address.toString(16)}:
        php
        bit $C081
        plp
        jsr ${hex(address)}
        jmp ram_resume
`).join("");
  const resident = assemble(fs.readFileSync(path.join(root, "codegen", "patches", "silent-service-3ric.s"), "utf8")
    .replace("; @shared-snes-poll", snesPollSource())
    + "\n.org $CC90\n" + wrappers + "\nfirmware_end:\n" + bankedInputSource());
  const s = resident.symbols;
  if (resident.org !== 0xc800 || s.STARTUP_END > 0xc880 || s.GAME_PADDLE_END > 0xc900
      || s.POLL_END > 0xca00 || s.BANKING_END > 0xcc70
      || s.DOS_BANKS_END > 0xcc90 || s.FIRMWARE_END > 0xce00 || s.NMI_END > 0xd000
      || s.DOS_ROM !== 0xcc81 || s.DOS_BANK2 !== 0xcc83 || s.DOS_BANK1 !== 0xcc8b)
    throw new Error("Silent Service resident exceeds its reserved RAM or bank-operand ABI");
  const pages = [0xc800, 0xc900, 0xcc00, 0xcd00, 0xcf00].map(address => {
    const page = Buffer.alloc(256);
    page.set(resident.bytes.subarray(address - resident.org, address - resident.org + 256));
    return page;
  });
  const checksum = bankedChecksum(rom);
  const installer = assemble(`
        .org $6000
install:
        php
        pha
        phx
        phy
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
        lda startup_bytes,x
        sta $C800,x
        lda banking_bytes,x
        sta $C900,x
        lda dos_bank_bytes,x
        sta $CC00,x
        lda firmware_bytes,x
        sta $CD00,x
        lda nmi_bytes,x
        sta $CF00,x
        inx
        bne copy
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
        .byte ${messageBytes("3RIC ROM MISMATCH - RESET")}
expected_proxy:
        .byte ${byteList(rom.subarray(0xf1bb, 0xf1d6))}
startup_bytes:
        .byte ${byteList(pages[0])}
banking_bytes:
        .byte ${byteList(pages[1])}
dos_bank_bytes:
        .byte ${byteList(pages[2])}
firmware_bytes:
        .byte ${byteList(pages[3])}
nmi_bytes:
        .byte ${byteList(pages[4])}
`);
  const sectorCount = Math.ceil(installer.bytes.length / 256);
  if (sectorCount > 12) throw new Error("Silent Service installer exceeds the free track-4 sectors");
  const stub = assemble(`
        .org $9B90
bootstrap:
        php
        pha
        phx
        phy
        lda #4
        sta $B7EC
        lda #${sectorCount - 1}
        sta $B7ED
        lda #${hex(0x60 + sectorCount - 1)}
        sta $B7F1
        stz $B7F0
        stz $B7EB
        lda #1
        sta $B7F4
        lda #${sectorCount}
        sta remaining
read_page:
        lda $B7E5
        ldy $B7E4
        jsr $B7B5
        bcs failed
        dec $B7ED
        dec $B7F1
        dec remaining
        bne read_page
        jsr $6000
        ply
        plx
        pla
        plp
        inc $03F4
        rts
failed:
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
        .byte ${messageBytes("SILENT SERVICE DISK ERROR - RESET")}
remaining:
        .byte 0
`);
  if (stub.bytes.length > 0xf0) throw new Error("Silent Service bootstrap overlaps existing DOS data");
  return { resident, installer, stub, sectorCount };
}

export function patchSilentService(input, rom) {
  if (input.length !== 143360 || sha256(input) !== INPUT_SHA256)
    throw new Error(`Unsupported Silent Service image; expected SHA-256 ${INPUT_SHA256}. No output written.`);
  const payload = buildPayload(rom);
  const s = payload.resident.symbols;
  const dsk = Buffer.from(input);
  const patches = [];
  const touched = new Set();
  const edit = (offset, before, after) => {
    const expected = typeof before === "string" ? Buffer.from(before, "hex") : Buffer.from(before);
    const replacement = Buffer.from(after);
    if (offset < 0 || offset + expected.length > dsk.length || expected.length !== replacement.length
        || !dsk.subarray(offset, offset + expected.length).equals(expected))
      throw new Error(`Unexpected Silent Service bytes at ${hex(offset)}`);
    for (let i = offset; i < offset + replacement.length; i++) {
      if (touched.has(i)) throw new Error(`Overlapping Silent Service patch at ${hex(i)}`);
      touched.add(i);
    }
    dsk.set(replacement, offset);
    patches.push({ offset, before: expected.toString("hex"), after: replacement.toString("hex") });
  };

  edit(0x0a00, "eef403", instruction(0x20, payload.stub.org));
  edit(0x0a90, Buffer.alloc(payload.stub.bytes.length), payload.stub.bytes);
  const bitmapOffset = 17 * 4096 + 0x38 + 4 * 4;
  const bitmap = dsk.readUInt32BE(bitmapOffset);
  const allocated = ((1 << payload.sectorCount) - 1) << 16;
  if ((bitmap & allocated) !== allocated) throw new Error("Silent Service adapter sectors are not free");
  const reserved = Buffer.alloc(4);
  reserved.writeUInt32BE((bitmap & ~allocated) >>> 0);
  edit(bitmapOffset, input.subarray(bitmapOffset, bitmapOffset + 4), reserved);
  const installation = Buffer.alloc(payload.sectorCount * 256);
  installation.set(payload.installer.bytes);
  edit(4 * 4096, input.subarray(4 * 4096, 4 * 4096 + installation.length), installation);

  edit(0x271e, "4c00e0", instruction(0x4c, s.COLD_START));
  // The greeting constructs its successful STROUT target by XORing its first NOP.
  edit(0x592f, [0xd0], [(s.STRING_OUT & 255) ^ 0xea]);
  for (const offset of [0x59a2, 0x59aa, 0x59b8]) edit(offset, [0xdb], [s.STRING_OUT >> 8]);
  edit(0x59ca, "203adb", instruction(0x20, s.STRING_OUT));
  edit(0x1cf0b, "4c3adb", instruction(0x4c, s.STRING_OUT));

  edit(0x14b7, "8d80c0", instruction(0x20, s.RAM2_READ_STORE));
  for (const offset of [0x255b, 0x2589, 0x258c, 0x2665, 0x2668, 0x5917,
    0x0b50d, 0x0b510, 0x0f42a, 0x0f42d])
    edit(offset, "ad83c0", instruction(0x20, s.RAM2_WRITE_LDA));
  for (const offset of [0x2785, 0x2788, 0x2791, 0x2794, 0x12cfa, 0x12cfd])
    edit(offset, "2c83c0", instruction(0x20, s.RAM2_WRITE_BIT));
  for (const offset of [0x0f423, 0x0f426, 0x10f04, 0x10f07])
    edit(offset, "ad8bc0", instruction(0x20, s.RAM1_WRITE_LDA));
  for (const offset of [0x274c, 0x274f])
    edit(offset, "2c83c0", instruction(0x20, s.DOS_BANK2));
  edit(0x27a7, "8d81c0", instruction(0x20, s.DOS_ROM));
  for (const offset of [0x2736, 0x12b20])
    edit(offset, "8d81c0", instruction(0x20, s.RAM_RESUME));
  for (const offset of [0x0f431, 0x0f434, 0x10f2e])
    edit(offset, "ad81c0", instruction(0x20, s.RAM2_WRITE_LDA));
  for (const offset of [0x0b54c, 0x0b559])
    edit(offset, "8dffff", instruction(0x20, s.FINISH_IRQ_VECTOR));
  for (const [offset, address] of firmwareCalls) {
    const entry = address === 0xff58 ? s.RETURN_ADDRESS : address === 0xfd35
      ? s.READ_KEY : s[`FIRMWARE_${address.toString(16).toUpperCase()}`];
    if (offset === 0x117ff) {
      // G's next file sector is the preceding DOS-order disk sector.
      edit(offset, [0x20], [0x20]);
      edit(0x11600, instruction(0x20, address).slice(1), instruction(0x20, entry).slice(1));
    } else {
      edit(offset, instruction(0x20, address), instruction(0x20, entry));
    }
  }
  edit(0x0933d, "4c2cfe", instruction(0x4c, s.FIRMWARE_FE2C));
  edit(0x111f3, "6cba00", instruction(0x4c, s.MACHINE_CALL));
  edit(0x12fac, "bae0ff", instruction(0x4c, s.NEXT_LOOP));
  for (const offset of [0x03e22, 0x14f22])
    edit(offset, "7dff00", instruction(0x6d, s.CAPTURED_LOW));
  for (const offset of [0x03e28, 0x14f28])
    edit(offset, "7d0001", instruction(0x6d, s.CAPTURED_HIGH));
  for (const offset of [0x03ea1, 0x14fa1])
    edit(offset, "bdff00", instruction(0xad, s.CAPTURED_LOW));
  for (const offset of [0x03ea8, 0x14fa8, 0x11994])
    edit(offset, "bd0001", instruction(0xad, s.CAPTURED_HIGH));
  edit(0x0eca6, "8ee2a4", instruction(0x4c, s.GAME_PADDLE));

  return { dsk, woz: Buffer.from(buildWozFromDsk(dsk)), patches, payload };
}

function main(args) {
  if (args.length !== 2)
    throw new Error("Usage: node codegen\\tools\\patch-silent-service.mjs <input.dsk> <output.woz|output.dsk>");
  const [input, output] = args.map(name => path.resolve(name));
  if (process.platform === "win32" ? input.toLowerCase() === output.toLowerCase() : input === output)
    throw new Error("Input and output must be different files");
  const extension = path.extname(output).toLowerCase();
  if (![".woz", ".dsk"].includes(extension)) throw new Error("Output must have a .woz or .dsk extension");
  const result = patchSilentService(fs.readFileSync(input),
    fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin")));
  const bytes = extension === ".woz" ? result.woz : result.dsk;
  fs.writeFileSync(output, bytes, { flag: "wx" });
  console.log(`Created ${output}\nExperimental Silent Service / 3ric adapter; hardware verification required.\n`
    + `Known limit: fastest PS/2 timing during ROM calls; see docs\\porting-logs\\silent-service.md.\n`
    + `Reserved track-4 sectors: ${result.payload.sectorCount}\nSHA-256: ${sha256(bytes)}`);
}

if (typeof process !== "undefined" && process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`patch-silent-service: ${error.message}`); process.exitCode = 1; }
}
