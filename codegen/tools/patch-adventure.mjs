import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildWozFromDsk } from "./wozgen.mjs";
import { patchWozSectors, readWozSectors, sha256 } from "./wozedit.mjs";

export const INPUT_DSK_SHA256 = "7d429cfd7d1999db3b42d1f4f149efdb16fda67685b282e68208ee4131b37e1d";
export const INPUT_WOZ_SHA256 = "426af3b3e925d6c53d98ff239cb5e15b4246de439c61d6bba4960a36da17e075";
export const ROM_SHA256 = "fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435";
export const DBG_SHA256 = "995e7558dc0c8657e1c98cf115a5e776b1b2f29f5100936643bd796c31d936a3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hex = value => `$${value.toString(16)}`;
const byteList = bytes => Array.from(bytes, hex).join(",");
const physicalSector = logical => logical === 15 ? 15 : (logical * 13) % 15;

// Applesoft BASIC -> 3ric MSBASIC token translation table ($80..$EA).
export const APPLESOFT_TOKEN_MAP = new Map([
  [0x80, 0x80], [0x81, 0x81], [0x82, 0x82], [0x83, 0x83], [0x84, 0x84],
  [0x86, 0x85], [0x87, 0x86], [0x89, 0x8e], [0x8c, 0x87], [0x96, 0x89],
  [0x97, 0x8b], [0xa1, 0x8f], [0xa2, 0x91], [0xa3, 0x92], [0xa5, 0x93],
  [0xa6, 0x97], [0xa9, 0x98], [0xab, 0x88], [0xad, 0x8a], [0xb0, 0x8c],
  [0xb1, 0x8d], [0xb2, 0x83], [0xb4, 0x90], [0xb8, 0x94], [0xb9, 0x95],
  [0xba, 0x96], [0xbd, 0x99], [0xbe, 0x9a], [0xbf, 0x9b],
]);
for (let b = 0xc0; b <= 0xc4; b++) APPLESOFT_TOKEN_MAP.set(b, b - 0x24);
for (let b = 0xc6; b <= 0xd6; b++) APPLESOFT_TOKEN_MAP.set(b, b - 0x25);
for (let b = 0xd9; b <= 0xea; b++) APPLESOFT_TOKEN_MAP.set(b, b - 0x27);

export function bankedChecksum(rom) {
  let first = 0, second = 0;
  for (const byte of rom.subarray(0xb500, 0xbe00)) {
    let sum = first + byte;
    first = (sum & 255) + (sum >> 8);
    sum = second + first;
    second = (sum & 255) + (sum >> 8);
  }
  return [first, second];
}

export function retokenizeApplesoft(prog) {
  const out = Buffer.from(prog);
  let pos = 0;
  while (pos + 4 <= out.length) {
    const nextPtr = out.readUInt16LE(pos);
    if (nextPtr === 0) break;
    let p = pos + 4;
    let inQuotes = false, inRem = false;
    while (p < out.length && out[p] !== 0) {
      const b = out[p];
      if (b === 0x22 && !inRem) {
        inQuotes = !inQuotes;
      } else if (!inQuotes && !inRem && b >= 0x80) {
        if (b === 0xb2 || b === 0x83) inRem = true;
        const mapped = APPLESOFT_TOKEN_MAP.get(b);
        if (mapped === undefined) throw new Error(`Unmapped Applesoft token 0x${b.toString(16)}`);
        out[p] = mapped;
      }
      p++;
    }
    pos = p + 1;
  }
  return out;
}

export function relocateBasic(rom, dbgText) {
  if (sha256(rom) !== ROM_SHA256)
    throw new Error(`Unsupported 3ric ROM; expected SHA-256 ${ROM_SHA256}`);
  if (sha256(Buffer.from(dbgText.replace(/\r\n/g, "\n"))) !== DBG_SHA256)
    throw new Error(`Unsupported 3ric DBG metadata; expected SHA-256 ${DBG_SHA256}`);

  const segs = new Map(), spans = new Map(), rawLines = new Map(), syms = [];
  for (const raw of dbgText.split(/\r?\n/)) {
    const m = raw.match(/^(\w+)\t(.*)$/);
    if (!m) continue;
    const [, type, rest] = m;
    const kv = Object.fromEntries(rest.split(",").map(p => p.split("=")));
    if (type === "seg") segs.set(kv.id, { name: kv.name?.replace(/"/g, ""), start: parseInt(kv.start, 16), size: parseInt(kv.size, 16) });
    else if (type === "span") spans.set(kv.id, { id: kv.id, segId: kv.seg, start: parseInt(kv.start, 10), size: parseInt(kv.size, 10) });
    else if (type === "line") { if (kv.span) rawLines.set(kv.id, kv.span.split("+")); }
    else if (type === "sym") syms.push({ name: kv.name?.replace(/"/g, ""), val: parseInt(kv.val, 16), refs: kv.ref ? kv.ref.split("+") : [], seg: kv.seg });
  }
  for (const sp of spans.values()) {
    const seg = segs.get(sp.segId);
    if (seg) { sp.addr = seg.start + sp.start; sp.seg = seg.name; }
  }

  const relocatedOffsets = new Set();
  const branchOps = new Set([0x10, 0x30, 0x50, 0x70, 0x80, 0x90, 0xb0, 0xd0, 0xf0]);
  for (const sym of syms) {
    if (!(sym.val >= 0x9000 && sym.val < 0xb100)) continue;
    for (const lid of sym.refs) {
      for (const sid of (rawLines.get(lid) || [])) {
        const sp = spans.get(sid);
        if (!sp || sp.addr < 0x9000 || sp.addr >= 0xb03f) continue;
        if (sp.size === 3) {
          const target = rom[sp.addr + 1] | (rom[sp.addr + 2] << 8);
          if (target >= 0x8f00 && target < 0xb100) relocatedOffsets.add(sp.addr + 2);
        } else if (sp.size === 2) {
          const op = rom[sp.addr];
          if (sp.seg === "VECTORS" || (sp.addr >= 0xacfa && sp.addr < 0xb03f)) {
            const word = rom[sp.addr] | (rom[sp.addr + 1] << 8);
            if (word >= 0x8f00 && word < 0xb100) relocatedOffsets.add(sp.addr + 1);
          } else if (!branchOps.has(op)) {
            const imm = rom[sp.addr + 1];
            const hi = sym.val >> 8;
            if (imm === hi || imm === ((sym.val - 1) >> 8)) relocatedOffsets.add(sp.addr + 1);
          }
        } else if (sp.size === 5 && rom[sp.addr + 2] === 0x4c) {
          const target = rom[sp.addr + 3] | (rom[sp.addr + 4] << 8);
          if (target >= 0x8f00 && target < 0xb100) relocatedOffsets.add(sp.addr + 4);
        }
      }
    }
  }

  const lc = Buffer.from(rom.subarray(0x9000, 0xb100));
  for (const off of relocatedOffsets) lc[off - 0x9000] = (lc[off - 0x9000] + 0x40) & 0xff;
  rom.subarray(0xb120, 0xb210).copy(lc, 0x1d00);
  rom.subarray(0xb210, 0xb22d).copy(lc, 0x1df0);

  const ext = assemble(`
        .org $EE10
inlin2:
        jsr $FD6A
        cpx #$EF
        bcc inlin2_ok
        ldx #$EF
inlin2_ok:
        lda #0
        sta $0200,x
        txa
        beq inlin2_done
        dex
inlin2_strip:
        lda $0200,x
        and #$7F
        sta $0200,x
        dex
        bpl inlin2_strip
inlin2_done:
        ldx #$FF
        ldy #$01
        rts

cold_start:
        ldx #$FF
        stx $79
        txs
        jsr $FB2F
        jsr $FE84
        lda #$11
        ldy #$DD
        sta $06
        sty $07
        lda #$E4
        ldy #$DE
        sta $08
        sty $09
        lda #$4C
        sta $00
        sta $03
        sta $93
        sta $0A
        lda #$28
        sta $51
        lda #$0E
        sta $52
        lda #$03
        sta $92
        lda #$00
        sta $A7
        sta $57
        sta $17
        sta $16
        sta $69
        sta $D8
        pha
        ldx #$1C
copy_chrget:
        lda $EDF0,x
        sta $B2,x
        dex
        bpl copy_chrget
        stz $76
        stz $72
        lda #$96
        sta $77
        sta $73
        stz $0800
        stz $0801
        stz $0802
        lda #$01
        sta $6A
        lda #$08
        sta $6B
        jsr $D2BD
        jmp $D0EF

stmt_call:
        jsr $D992
        jsr $E349
        jmp ($0053)

stmt_htab:
        jsr $E2EF
        dex
        stx $24
        stx $50
        rts

stmt_vtab:
        jsr $E2EF
        txa
        dec
        sta $25
        jmp $FC22

stmt_himem:
        jsr $D992
        jsr $E349
        lda $53
        sta $76
        sta $72
        lda $54
        sta $77
        sta $73
        rts

stmt_speed:
        jmp $E2EF

stmt_pop:
        lda #$FF
        sta $88
        jsr $D01B
        txs
        cmp #$8C
        bne pop_err
        pla
        pla
        pla
        pla
        pla
        rts
pop_err:
        jmp $D582

stmt_onerr:
        lda #$88
        jsr $DADA
        jsr $D60D
        lda $53
        sta $DC
        lda $54
        sta $DD
        lda #$80
        sta $D8
        rts

stmt_resume:
        jsr $D2F0
        lda #$00
        sta $D9
        lda $DA
        sta $53
        lda $DB
        sta $54
        jsr $D55E
        jmp $D40D

onerr_entry:
        bit $D8
        bmi onerr_active
        lsr $17
        jsr $D70E
        jmp $D0CD
onerr_active:
        stx $DE
        jsr $D2F0
        lda #$00
        sta $17
        sta $D9
        lda $78
        sta $DA
        lda $79
        sta $DB
        lda $DC
        sta $53
        lda $DD
        sta $54
        jsr $D55E
        jmp $D40D

peek_hook:
        ldy $54
        bne peek_not_zp
        lda $53
        cmp #$6B
        bne peek_chk_6c
        lda $6E
        rts
peek_chk_6c:
        cmp #$6C
        bne peek_normal
        lda $6F
        rts
peek_not_zp:
        cpy #$C0
        bne peek_normal
        lda $53
        cmp #$10
        bne peek_normal
        lda $C000
        stz $C000
        rts
peek_normal:
        ldy #$00
        lda ($53),y
        rts

poke_hook:
        lda $54
        cmp #$C0
        bne poke_normal
        lda $53
        cmp #$10
        bne poke_normal
        stz $C000
        rts
poke_normal:
        txa
        ldy #$00
        sta ($53),y
        rts

chain_bltu2:
        sec
        lda $96
        sbc $9B
        sta $61
        tay
        lda $97
        sbc $9C
        tax
        inx
        tya
        beq bltu2_adj
        lda $96
        sec
        sbc $61
        sta $96
        bcs bltu2_subdst
        dec $97
        sec
bltu2_subdst:
        lda $94
        sbc $61
        sta $94
        bcs bltu2_loop
        dec $95
        bcc bltu2_loop
bltu2_byte:
        lda ($96),y
        sta ($94),y
bltu2_loop:
        dey
        bne bltu2_byte
        lda ($96),y
        sta ($94),y
bltu2_adj:
        dec $97
        dec $95
        dex
        bne bltu2_loop
        rts
`);
  if (ext.org !== 0xee10 || ext.bytes.length > 0xefbb - 0xee10)
    throw new Error(`Applesoft runtime extension exceeds $EE10..$EFBA (${ext.bytes.length} bytes)`);
  Buffer.from(ext.bytes).copy(lc, 0x1e10);

  const nmiHandler = assemble(`
        .org $F040
lc_nmi:
        pha
nmi_dispatch:
        lda $C20D
        lsr a
        bcs ps2_edge
        and #$08
        beq nmi_rom
        bra cb1_clear
ps2_edge:
        lda $CE00
        beq ps2_start
        dec a
        beq ps2_data
        dec a
        bne ps2_stop
        inc $CE00
        lda $CE01
        cmp #$12
        beq ps2_mod
        cmp #$59
        beq ps2_mod
        cmp #$14
        bne ps2_done
ps2_mod:
        sta $CE19
        bra ps2_done
ps2_data:
        lda $C20F
        asl a
        ror $CE01
        bcc ps2_done
        bra ps2_next
ps2_start:
        lda #$80
        sta $CE01
ps2_next:
        inc $CE00
ps2_done:
        lda #$01
        bra nmi_ack
ps2_stop:
        lda $C20D
        and #$10
        beq nmi_rom
cb1_clear:
        lda $C000
        and #$7F
        sta $C000
        lda #$10
nmi_ack:
        sta $C20D
nmi_more:
        lda $C20D
        bmi nmi_dispatch
        pla
        rti
nmi_rom:
        phy
        lda #$BF
        pha
        lda #$B1
        pha
        lda #$04
        pha
        jmp $B78D
lc_resume:
        ply
        bra nmi_more
`);
  if (nmiHandler.org !== 0xf040 || nmiHandler.bytes.length > 0xf100 - 0xf040)
    throw new Error(`LC NMI handler exceeds $F040..$F0FF (${nmiHandler.bytes.length} bytes)`);
  Buffer.from(nmiHandler.bytes).copy(lc, 0x2040);
  const s = { ...ext.symbols, ...nmiHandler.symbols };

  const patchLc = (addr, bytes) => Buffer.from(bytes).copy(lc, addr - 0xd000);
  patchLc(0xd0c8, [0x4c, s.ONERR_ENTRY & 0xff, s.ONERR_ENTRY >> 8, 0xea, 0xea]);
  patchLc(0xd0d0, [0xbd, 0x00, 0xed]);
  patchLc(0xd0f1, [0x20, 0x0e, 0xd7, 0xea, 0xea, 0xea, 0xea]);
  patchLc(0xd1a5, [0x4c, 0xef, 0xd0]);
  patchLc(0xd1d9, [0x20, s.INLIN2 & 0xff, s.INLIN2 >> 8, 0x60]);
  patchLc(0xd703, [0xea, 0xea, 0xea]);
  patchLc(0xd709, [0x4c, 0xd3, 0xd6, 0xea, 0xea]);
  patchLc(0xd715, [0xa9, 0x00, 0x85, 0x50, 0xea]);
  patchLc(0xdfbb, [0x20, 0x23, 0xe9]);
  patchLc(0xdfc0, [0xea, 0xea, 0xea, 0xea]);
  patchLc(0xe923, [
    0xa0, 0x00, 0x24, 0xa5, 0x10, 0x08, 0xa9, 0x2d,
    0x85, 0xa5, 0xc8, 0x99, 0xff, 0x00, 0xea,
  ]);
  patchLc(0xd77b, [0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea]);
  patchLc(0xd7d9, [0xd0, 0x0e]);
  patchLc(0xd7e6, [
    0x4c, 0xec, 0xd7,
    0x20, 0x74, 0xd7,
    0x20, 0xf7, 0xde,
    0xa9, 0x2c,
    0x8d, 0xff, 0x01,
    0xa2, 0x80,
    0x20, 0xd7, 0xd1,
    0x4c, 0x08, 0xd8,
  ]);
  patchLc(0xdaaf, [
    0xa5, 0xa0, 0xf0, 0x04, 0xa9, 0x00, 0xf0, 0x02, 0xa9, 0x01, 0x4c, 0x82, 0xe7, 0xea, 0xea,
  ]);
  patchLc(0xdb52, [
    0xa0, 0x01, 0x2c, 0xa0, 0x00, 0x84, 0x0f,
    0xa5, 0xa0, 0xf0, 0x02, 0xa9, 0x01, 0x85, 0x0e,
    0x20, 0x42, 0xe7,
    0xa5, 0xa0, 0xf0, 0x02, 0xa9, 0x01,
    0xa4, 0x0f, 0xd0, 0x05,
    0x25, 0x0e, 0x4c, 0x82, 0xe7,
    0x05, 0x0e, 0x4c, 0x82, 0xe7,
  ]);
  patchLc(0xdbe6, [0x01]);
  if (lc[0x15c7] !== 0x67 || lc[0x15c8] !== 0x67)
    throw new Error("Unexpected bytes at MSBASIC FMULT ($A5C7)");
  patchLc(0xe5c7, [0x66]);
  patchLc(0xddbe, [0xa2, 0x05]);
  patchLc(0xe362, [0x20, s.PEEK_HOOK & 0xff, s.PEEK_HOOK >> 8, 0xea]);
  patchLc(0xe36d, [0x4c, s.POKE_HOOK & 0xff, s.POKE_HOOK >> 8, 0xea, 0xea]);

  const setTokenAddr = (tok, target) => {
    const w = target - 1;
    patchLc(0xefbb + (tok - 0x80) * 2, [w & 0xff, w >> 8]);
  };
  setTokenAddr(0x87, s.STMT_CALL);
  setTokenAddr(0x89, s.STMT_HTAB);
  setTokenAddr(0x8b, 0xfc58);
  setTokenAddr(0x8f, s.STMT_POP);
  setTokenAddr(0x91, s.STMT_VTAB);
  setTokenAddr(0x92, s.STMT_HIMEM);
  setTokenAddr(0x93, s.STMT_ONERR);
  setTokenAddr(0x97, s.STMT_RESUME);
  setTokenAddr(0x98, s.STMT_SPEED);

  return { lc, ext, symbols: s };
}

export function buildPayload(rom, dbgText) {
  const basic = relocateBasic(rom, dbgText);
  const s = basic.symbols;
  const checksum = bankedChecksum(rom);

  const stage1a = assemble(`
        .org $BFC8
        lda #$05
        sta $B7EC
        lda #$01
        sta $B7ED
        sta $B7E1
        lda #$08
        sta $B7F1
        bra $BFA8
`);
  const stage1b = assemble(`
        .org $BFA8
        stz $B7EB
        jsr $B793
        jmp $0800
nmi_resume:
        bit $C080
        jmp ${hex(s.LC_RESUME)}
`);
  const nmiEnter = assemble(`
        .org $B78D
        bit $C082
        jmp $F1BB
`);
  if (stage1a.bytes.length > 20) throw new Error("stage1a exceeds $BFC8..$BFDB");
  if (stage1b.bytes.length > 16) throw new Error("stage1b exceeds $BFA8..$BFB7");
  if (nmiEnter.bytes.length > 6) throw new Error("nmiEnter exceeds $B78D..$B792");

  const stage2 = assemble(`
        .org $0800
        jsr $FE93
        php
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
        stz $3C
        stz $3D
        ldx #0
        ldy #9
checksum_byte:
        lda $B500,x
        clc
        adc $3C
        adc #0
        sta $3C
        clc
        adc $3D
        adc #0
        sta $3D
        inx
        bne checksum_byte
        inc checksum_byte+2
        dey
        bne checksum_byte
        dec $CAFE
        bit $C007
        lda $3C
        cmp #${hex(checksum[0])}
        bne failed
        lda $3D
        cmp #${hex(checksum[1])}
        bne failed
        lda $C081
        lda $C081
        ldy #$F1
        sty $3D
        sty $43
        ldy #$00
        sty $3C
        sty $42
copy_f1:
        lda ($3C),y
        sta ($42),y
        iny
        bne copy_f1
        inc $3D
        inc $43
        bne copy_f1
        lda #${hex(s.LC_NMI & 0xff)}
        sta $FFFA
        lda #${hex(s.LC_NMI >> 8)}
        sta $FFFB
        lda #$05
        sta $B7EC
        stz $B7ED
        stz $B7EB
        lda #$F0
        sta $B7F1
        lda #$21
        sta $B7E1
        jsr $B793
        plp
        lda $C080
        jmp $B744
failed:
        stz $CAFE
        bit $C007
        bit $C082
        bit $C051
        bit $C054
        bit $C052
        jsr $FC58
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
`);
  if (stage2.bytes.length > 256) throw new Error("stage2 exceeds 256-byte sector budget");
  return { ...basic, checksum, stage1a, stage1b, nmiEnter, stage2 };
}

export function patchAdventure(input, rom, dbgText) {
  const inputHash = sha256(input);
  let baseWoz;
  if (input.length === 143360 && inputHash === INPUT_DSK_SHA256) {
    baseWoz = Buffer.from(buildWozFromDsk(input));
  } else if (inputHash === INPUT_WOZ_SHA256) {
    baseWoz = Buffer.from(input);
  } else {
    throw new Error(
      `Unsupported Adventure image; expected DSK SHA-256 ${INPUT_DSK_SHA256} or WOZ SHA-256 ${INPUT_WOZ_SHA256}. No output written.`
    );
  }
  if (sha256(baseWoz) !== INPUT_WOZ_SHA256)
    throw new Error(`Unexpected base WOZ SHA-256; expected ${INPUT_WOZ_SHA256}`);

  const payload = buildPayload(rom, dbgText);
  const coordinates = Array.from({ length: 560 }, (_, i) => ({ track: i >> 4, sector: i & 15 }));
  const sectors = readWozSectors(baseWoz, coordinates);
  const data = new Map(sectors.map(s => [`${s.track}/${s.sector}`, Buffer.from(s.data)]));
  const changed = new Map();

  const editLogical = (track, logicalSectorNum, offset, before, after) => {
    const phys = physicalSector(logicalSectorNum);
    const key = `${track}/${phys}`;
    const bytes = data.get(key);
    const expected = Buffer.from(before);
    const replacement = Buffer.from(after);
    if (!bytes || expected.length !== replacement.length || offset + expected.length > 256
        || !bytes.subarray(offset, offset + expected.length).equals(expected)) {
      throw new Error(`Unexpected Adventure bytes at T${track}S${logicalSectorNum} (phys ${phys}) +$${offset.toString(16)}`);
    }
    if (!changed.has(key)) changed.set(key, Buffer.from(bytes));
    bytes.set(replacement, offset);
  };

  const editDos = (ramAddr, after) => {
    const dskOff = ramAddr >= 0xb600 ? ramAddr - 0xb600 : ramAddr - 0x9300;
    const pageIndex = dskOff >> 8;
    const track = Math.floor(pageIndex / 16);
    const logical = pageIndex % 16;
    const offset = dskOff & 0xff;
    const phys = physicalSector(logical);
    const cur = data.get(`${track}/${phys}`).subarray(offset, offset + after.length);
    editLogical(track, logical, offset, cur, after);
  };

  // 1. Place the 33 sectors of relocated MSBASIC ($D000..$F0FF) on T3S0..T5S0
  //    and the 1-sector stage2 installer on T5S1.
  for (let i = 0; i < 33; i++) {
    const track = 3 + Math.floor(i / 16);
    const logical = i % 16;
    editLogical(track, logical, 0, Buffer.alloc(256), payload.lc.subarray(i * 256, (i + 1) * 256));
  }
  const stage2Sector = Buffer.alloc(256);
  stage2Sector.set(payload.stage2.bytes);
  editLogical(5, 1, 0, Buffer.alloc(256), stage2Sector);

  // 2. Mark Track 3, Track 4, and Track 5 (sectors 0 and 1) allocated in VTOC (T17S0).
  editLogical(17, 0, 0x38 + 3 * 4, [0xff, 0xff], [0x00, 0x00]);
  editLogical(17, 0, 0x38 + 4 * 4, [0xff, 0xff], [0x00, 0x00]);
  editLogical(17, 0, 0x38 + 5 * 4, [0xff, 0xff], [0xff, 0xfc]);

  // 3. Patch T0S9 ($BFA8..$BFB7 and $BFC8..$BFDA) and T0S1 ($B78D..$B792) with stage1a, stage1b, nmi_resume, and nmi_enter.
  editDos(0xbfc8, payload.stage1a.bytes);
  editDos(0xbfa8, payload.stage1b.bytes);
  editDos(0xb78d, payload.nmiEnter.bytes);

  // 4. Patch DOS 3.3 Applesoft ROM entry points and zero-page offsets to match relocated 3ric MSBASIC.
  const s = payload.symbols;
  const wordBytes = w => [w & 0xff, w >> 8];
  editDos(0x9d5a, wordBytes(0xd0c8));
  editDos(0x9d70, wordBytes(0xd0c8));
  editDos(0x9d5c, wordBytes(s.COLD_START));
  editDos(0x9d72, wordBytes(s.COLD_START));
  editDos(0x9d5e, wordBytes(0xd0ef));
  editDos(0x9d74, wordBytes(0xd0ef));
  editDos(0x9d60, wordBytes(0xd19f));
  editDos(0x9d76, wordBytes(0xd19f));
  editDos(0x9dcc, [0xa9, 0xb0]);
  editDos(0xa4fc, [0x20, 0xd2, 0xd2]);
  editDos(0xa503, [0x4c, 0x0d, 0xd4]);

  editDos(0xa3ab, [0xe5, 0x6a]);
  editDos(0xa3b0, [0xe5, 0x6b]);
  editDos(0xa3b5, [0xa5, 0x6b]);
  editDos(0xa3b7, [0xa4, 0x6a]);
  editDos(0xa431, [0x65, 0x6a]);
  editDos(0xa435, [0x65, 0x6b]);
  editDos(0xa437, [0xc5, 0x77]);
  editDos(0xa43d, [0x85, 0x6d]);
  editDos(0xa441, [0x86, 0x6c]);
  editDos(0xa443, [0xa6, 0x6a]);
  editDos(0xa445, [0xa4, 0x6b]);
  editDos(0xa664, [0xa6, 0x79]);
  editDos(0xa83c, [0x85, 0x77]);
  editDos(0xa83e, [0x85, 0x73]);
  editDos(0xa841, [0x85, 0x76]);
  editDos(0xa843, [0x85, 0x72]);

  // 5. Patch CHAIN binary (Track 6 Sectors 13 and 12) to call relocated 3ric MSBASIC routines and ZP pointers.
  const chainSectors = [[6, 13], [6, 12]];
  const chainOrig = chainSectors.map(([t, sc]) => Buffer.from(data.get(`${t}/${physicalSector(sc)}`)));
  const chainBuf = Buffer.concat(chainOrig);
  const patchChain = (ramAddr, bytes) => Buffer.from(bytes).copy(chainBuf, 4 + (ramAddr - 0x0208));
  patchChain(0x038a, [0xc9, 0xb0]);
  patchChain(0x03b8, [
    0xd2, 0xd2,
    0x0d, 0xd4,
    0x0e, 0xd7,
    0x76, 0xd7,
    0x77, 0xe0,
    s.CHAIN_BLTU2 & 0xff, s.CHAIN_BLTU2 >> 8,
  ]);
  for (const zpAddr of [0x0213, 0x0215, 0x021b, 0x021f, 0x0234, 0x0238, 0x02a4, 0x02ad, 0x02b0, 0x02b8, 0x02e9, 0x02ed, 0x02fa, 0x02fe, 0x0302, 0x0347, 0x034d, 0x0360, 0x0368, 0x037c, 0x0383]) {
    const idx = 4 + (zpAddr - 0x0208);
    chainBuf[idx] += 3;
  }
  patchChain(0x0298, [0x6d]);
  patchChain(0x0320, [0xb1, 0xb9]);
  editLogical(6, 13, 0, chainOrig[0], chainBuf.subarray(0, 256));
  editLogical(6, 12, 0, chainOrig[1], chainBuf.subarray(256, 512));

  // 6. Retokenize ADVENTURE and PART TWO on disk from Applesoft tokens to 3ric MSBASIC tokens.
  const catalogFiles = [
    { name: "ADVENTURE", tsTrack: 18, tsSector: 15 },
    { name: "PART TWO", tsTrack: 19, tsSector: 15 },
  ];
  for (const file of catalogFiles) {
    const tsSectorData = data.get(`${file.tsTrack}/${physicalSector(file.tsSector)}`);
    const pairs = [];
    for (let off = 0x0c; off < 256; off += 2) {
      const t = tsSectorData[off];
      const s = tsSectorData[off + 1];
      if (t === 0 && s === 0) break;
      pairs.push([t, s]);
    }
    const raw = Buffer.concat(pairs.map(([t, s]) => data.get(`${t}/${physicalSector(s)}`)));
    const len = raw[0] | (raw[1] << 8);
    const retok = retokenizeApplesoft(raw.subarray(2, 2 + len));
    const newRaw = Buffer.from(raw);
    retok.copy(newRaw, 2);
    for (let i = 0; i < pairs.length; i++) {
      const [t, s] = pairs[i];
      const origSector = data.get(`${t}/${physicalSector(s)}`);
      const updatedSector = newRaw.subarray(i * 256, (i + 1) * 256);
      if (!origSector.equals(updatedSector)) {
        editLogical(t, s, 0, origSector, updatedSector);
      }
    }
  }

  const patches = [...changed].map(([key, before]) => {
    const [track, sector] = key.split("/").map(Number);
    return { track, sector, offset: 0, before: before.toString("hex"), after: data.get(key).toString("hex") };
  });
  const woz = patchWozSectors(baseWoz, patches);
  return { woz, baseWoz, patches, payload };
}

function main(args) {
  if (args.length !== 2)
    throw new Error("Usage: node codegen\\tools\\patch-adventure.mjs <input.dsk|input.woz> <output.woz>");
  const [input, output] = args.map(name => path.resolve(name));
  if ((process.platform === "win32" ? input.toLowerCase() === output.toLowerCase() : input === output))
    throw new Error("Input and output must be different files");
  const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
  const dbgText = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.dbg"), "utf8");
  const result = patchAdventure(fs.readFileSync(input), rom, dbgText);
  fs.writeFileSync(output, result.woz, { flag: "wx" });
  console.log(
    `Created ${output}\nExperimental Adventure / 3ric adapter; hardware verification required.\n`
    + `Changed sectors: ${result.patches.length}\nSHA-256: ${sha256(result.woz)}`
  );
}

if (typeof process !== "undefined" && process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`patch-adventure: ${error.message}`); process.exitCode = 1; }
}
