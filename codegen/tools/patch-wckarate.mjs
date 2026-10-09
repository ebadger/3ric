import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { assembleBankedInput, bankedChecksum, ROM_SHA256 } from "./banked-input.mjs";
import { buildWozFromDsk } from "./wozgen.mjs";
import { sha256 } from "./wozedit.mjs";

export const INPUT_SHA256 = "6d3892128898de49c24d8cebc975dd822b3880bb8536a26b8d688d321644a2ca";
export { ROM_SHA256 };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hex = value => `$${value.toString(16)}`;
const byteList = bytes => Array.from(bytes, hex).join(",");
const instruction = (opcode, address) => [opcode, address & 255, address >> 8];
const prodosToDos = [0, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 15];

function blockOffset(block, half) {
  const sector = block * 2 + half;
  return ((sector >> 4) * 16 + prodosToDos[sector & 15]) * 256;
}

export function buildPayload(rom) {
  if (sha256(rom) !== ROM_SHA256)
    throw new Error(`Unsupported 3ric ROM; expected SHA-256 ${ROM_SHA256}`);
  const resident = assembleBankedInput(fs.readFileSync(new URL("../patches/wckarate-3ric.s", import.meta.url), "utf8"));
  const s = resident.symbols;
  const adapterPages = Buffer.alloc(512);
  adapterPages.set(resident.bytes.subarray(0, s.ADAPTER_END - 0xcc00));
  const nmiPage = Buffer.alloc(256);
  nmiPage.set(resident.bytes.subarray(0x300));
  const checksum = bankedChecksum(rom);
  const installer = assemble(`
        .org $5A00
install:
        php
        pha
        phx
        phy
        sei
        cld
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
        lda $D000,x
        sta $C800,x
        lda adapter_bytes,x
        sta $CC00,x
        lda adapter_bytes+256,x
        sta $CD00,x
        lda nmi_bytes,x
        sta $CF00,x
        inx
        bne copy
        bit $C081
        bit $C081
        ldx #7
copy_vectors:
        lda $FFF8,x
        sta $FFF8,x
        dex
        bpl copy_vectors
        lda #${hex(s.NMI_ENTRY & 255)}
        sta $FFFA
        lda #${hex(s.NMI_ENTRY >> 8)}
        sta $FFFB
        bit $C082
        lda #$60
        sta $C20E
        sta $C20D
        ply
        plx
        pla
        plp
        jmp $FE84
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
        .byte ${byteList(adapterPages)}
nmi_bytes:
        .byte ${byteList(nmiPage)}
`);
  if (installer.org + installer.bytes.length > 0x6000)
    throw new Error("Karate installer exceeds its title-picture staging area");

  // The last eight bytes are unused hi-res holes, already reserved for vectors
  // by the original game. Keep them valid even during a scenery-cache refill.
  const copyBackground = assemble(`
        .org $8551
        sei
        ldy #0
        sty $00
        sty $02
        lda #$20
        sta $03
        lda #$E0
        sta $01
        ldx #31
copy_page:
        lda ($02),y
        sta ($00),y
        iny
        bne copy_page
        inc $03
        inc $01
        dex
        bne copy_page
copy_tail:
        lda ($02),y
        sta ($00),y
        iny
        cpy #$F8
        bne copy_tail
        sei
        rts
`);
  if (copyBackground.org + copyBackground.bytes.length > 0x8589)
    throw new Error("Karate scenery copier exceeds the original routine");
  return { resident, installer, adapterPages, nmiPage, copyBackground };
}

export function patchWcKarate(input, rom) {
  if (input.length !== 143360 || sha256(input) !== INPUT_SHA256)
    throw new Error(`Unsupported World Karate Championship disk; expected SHA-256 ${INPUT_SHA256}. No output written.`);
  const payload = buildPayload(rom);
  const readBlock = block => Buffer.concat([0, 1].map(half => {
    const offset = blockOffset(block, half);
    return input.subarray(offset, offset + 256);
  }));
  const entry = readBlock(2).subarray(43, 82);
  if (entry[0] !== 0x26 || entry.subarray(1, 7).toString() !== "KARATE"
      || entry[16] !== 0xff || entry.readUInt16LE(17) !== 8
      || entry.readUInt16LE(19) !== 80 || entry.readUIntLE(21, 3) !== 0x9e00
      || entry.readUInt16LE(31) !== 0x2000)
    throw new Error("Unexpected KARATE system-file directory entry");
  const index = readBlock(8);
  const blocks = Array.from({ length: 79 }, (_, i) => index[i] | index[i + 256] << 8);
  if (blocks.some(block => block < 7 || block >= 280 || block === 8)
      || new Set(blocks).size !== blocks.length || blocks.at(-1) !== 86)
    throw new Error("Unexpected KARATE system-file allocation");
  const game = Buffer.concat(blocks.map(readBlock));
  const dsk = Buffer.from(input), patches = [];
  const edit = (address, before, after) => {
    const offset = address - 0x2000;
    const expected = Buffer.from(before), replacement = Buffer.from(after);
    if (offset < 0 || offset + expected.length > game.length
        || expected.length !== replacement.length
        || !game.subarray(offset, offset + expected.length).equals(expected))
      throw new Error(`Unexpected KARATE bytes at ${hex(address)}`);
    for (let i = 0; i < replacement.length; i++) {
      const position = offset + i;
      const diskOffset = blockOffset(blocks[position >> 9], (position >> 8) & 1) + (position & 255);
      if (dsk[diskOffset] !== expected[i]) throw new Error(`Overlapping KARATE patch at ${hex(address + i)}`);
      dsk[diskOffset] = replacement[i];
    }
    patches.push({ address, before: expected.toString("hex"), after: replacement.toString("hex") });
  };
  const s = payload.resident.symbols;
  edit(0x200a, [0x20, 0x84, 0xfe], instruction(0x20, payload.installer.org));
  edit(0x5a00, game.subarray(0x3a00, 0x3a00 + payload.installer.bytes.length), payload.installer.bytes);
  edit(0xba65, [0x60], [Math.floor(blocks.at(-1) / 8) * 2]);
  for (const address of [0x6051, 0x6054, 0x6242, 0x6245, 0x6ec5, 0x6ec8, 0x94c6, 0x94dd])
    edit(address, [0x2c, 0x83, 0xc0], instruction(0x20, s.RAM2_WRITE));
  for (const address of [0x94c0, 0x94d7])
    edit(address, [0x2c, 0x8b, 0xc0], instruction(0x20, s.RAM1_WRITE));
  for (const address of [0x622f, 0x6eba])
    edit(address, [0x2c, 0x82, 0xc0], instruction(0x20, s.RAM2_WRITE));
  edit(0x6232, [0xbd, 0x00, 0xd0], [0xbd, 0x00, 0xc8]);
  for (const address of [0x623c, 0x6ebf])
    edit(address, [0x20, 0xa8, 0xfc], instruction(0x20, s.WAIT));
  edit(0x6d76, [0xee, 0x59, 0x03], instruction(0x4c, s.RANDOM));
  edit(0x6b3f, [0xad, 0x70, 0xc0], instruction(0x4c, s.PAD1));
  edit(0x6a35, [0x20, 0xeb, 0x6b], instruction(0x20, s.PAD2));
  edit(0x607c, [0x20, 0xbb, 0x6d], instruction(0x20, s.FRAME_INPUT));
  edit(0x752c, [0x2c, 0x61, 0xc0], instruction(0x20, s.BUTTON1));
  const copy = Buffer.alloc(0x8589 - 0x8551, 0xea);
  copy.set(payload.copyBackground.bytes);
  edit(0x8551, Buffer.from("78a00084008402a9208503a9e08501a220b1029100c8d0f9e603e601cad0f22c81c02c81c0a207bdf8ff9df8ffca10f72c83c02c83c05860", "hex"), copy);
  return { dsk, woz: Buffer.from(buildWozFromDsk(dsk)), patches, payload };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || path.extname(args[1]).toLowerCase() !== ".woz")
      throw new Error("Usage: node codegen\\tools\\patch-wckarate.mjs <original.dsk> <new-output.woz>");
    const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
    const result = patchWcKarate(fs.readFileSync(args[0]), rom);
    fs.writeFileSync(args[1], result.woz, { flag: "wx" });
    console.log(`Created ${path.resolve(args[1])}`);
    console.log(`SHA-256 ${sha256(result.woz)}`);
    console.log("Boot with C600G. Experimental 3ric port; physical-board confirmation remains open.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
