// wozgen.mjs — dependency-free, dual-use (Node + browser) bootable-.woz generator.
//
// Packages an assembled 65C02 program into a standard 5.25" DOS-3.3-layout WOZ2
// disk image that boots on a real Apple II (and in the 3ric emulator via C600G).
//
// The nibbliser (6-and-2 encode, 4-and-4 address fields, WOZ2 INFO/TMAP/TRKS and
// CRC32) is a faithful JS port of emulator/dsk2woz2/dsk2woz2.cpp. Track 0 sector 0
// carries a small hand-written boot loader (assembled here with asm6502.mjs) that
// the $C600 P5 boot PROM auto-loads; the loader re-enters the ROM's ReadSector to
// pull the program off successive tracks into a page-aligned staging buffer, then
// relocates a position-independent copier and moves the program to its load address.
//
// Usage:  import { buildBootableWoz } from "./wozgen.mjs";
//         const woz = buildBootableWoz(bytes, 0x0800);   // Uint8Array

import { assemble } from "./asm6502.mjs";

// ---------------------------------------------------------------------------
// CRC32 (exactly the polynomial/table advocated by the WOZ specification).
// ---------------------------------------------------------------------------
const CRC32_TAB = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, start, end) {
  let crc = 0xFFFFFFFF;
  for (let i = start; i < end; i++) crc = (CRC32_TAB[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  return (~crc) >>> 0;
}

// ---------------------------------------------------------------------------
// 6-and-2 sector encoder (256 raw bytes -> 343 disk nibbles).
// ---------------------------------------------------------------------------
const SIX_AND_TWO = [
  0x96, 0x97, 0x9a, 0x9b, 0x9d, 0x9e, 0x9f, 0xa6,
  0xa7, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb2, 0xb3,
  0xb4, 0xb5, 0xb6, 0xb7, 0xb9, 0xba, 0xbb, 0xbc,
  0xbd, 0xbe, 0xbf, 0xcb, 0xcd, 0xce, 0xcf, 0xd3,
  0xd6, 0xd7, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde,
  0xdf, 0xe5, 0xe6, 0xe7, 0xe9, 0xea, 0xeb, 0xec,
  0xed, 0xee, 0xef, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6,
  0xf7, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff,
];
const BIT_REVERSE = [0, 2, 1, 3];

function encode6and2(dest, src, srcOff) {
  for (let c = 0; c < 84; c++) {
    dest[c] =
      BIT_REVERSE[src[srcOff + c] & 3] |
      (BIT_REVERSE[src[srcOff + c + 86] & 3] << 2) |
      (BIT_REVERSE[src[srcOff + c + 172] & 3] << 4);
  }
  dest[84] = BIT_REVERSE[src[srcOff + 84] & 3] | (BIT_REVERSE[src[srcOff + 170] & 3] << 2);
  dest[85] = BIT_REVERSE[src[srcOff + 85] & 3] | (BIT_REVERSE[src[srcOff + 171] & 3] << 2);
  for (let c = 0; c < 256; c++) dest[86 + c] = src[srcOff + c] >> 2;
  dest[342] = dest[341];
  let loc = 342;
  while (loc > 1) { loc--; dest[loc] ^= dest[loc - 1]; }
  for (let c = 0; c < 343; c++) dest[c] = SIX_AND_TWO[dest[c]];
}

// ---------------------------------------------------------------------------
// Bit-level writers into a track buffer (position is measured in bits).
// ---------------------------------------------------------------------------
function writeBit(buf, pos, value) {
  buf[pos >> 3] |= (value ? 0x80 : 0x00) >> (pos & 7);
  return pos + 1;
}
function writeByte(buf, pos, value) {
  const shift = pos & 7;
  const bp = pos >> 3;
  buf[bp] |= (value >> shift) & 0xFF;
  if (shift) buf[bp + 1] |= (value << (8 - shift)) & 0xFF;
  return pos + 8;
}
function write4and4(buf, pos, value) {
  pos = writeByte(buf, pos, (value >> 1) | 0xAA);
  pos = writeByte(buf, pos, value | 0xAA);
  return pos;
}
function writeSync(buf, pos) {
  pos = writeByte(buf, pos, 0xFF);
  return pos + 2; // two 0 bits
}

// logical<-physical sector interleave (DOS 3.3 order), matching dsk2woz2.
function logicalSector(physical) {
  return physical === 15 ? 15 : (physical * 7) % 15;
}

// Serialise one 4096-byte DSK track (16 x 256 logical sectors) into a WOZ bitstream.
function serialiseTrack(dest, dsk, trackOff, trackNumber) {
  let pos = 0; // bits
  for (let c = 0; c < 16; c++) pos = writeSync(dest, pos); // gap 1

  for (let sector = 0; sector < 16; sector++) {
    // Address field.
    pos = writeByte(dest, pos, 0xD5);
    pos = writeByte(dest, pos, 0xAA);
    pos = writeByte(dest, pos, 0x96);
    pos = write4and4(dest, pos, 254);          // volume
    pos = write4and4(dest, pos, trackNumber);
    pos = write4and4(dest, pos, sector);
    pos = write4and4(dest, pos, 254 ^ trackNumber ^ sector);
    pos = writeByte(dest, pos, 0xDE);
    pos = writeByte(dest, pos, 0xAA);
    pos = writeByte(dest, pos, 0xEB);

    for (let c = 0; c < 7; c++) pos = writeSync(dest, pos); // gap 2

    // Data field.
    pos = writeByte(dest, pos, 0xD5);
    pos = writeByte(dest, pos, 0xAA);
    pos = writeByte(dest, pos, 0xAD);
    const logical = logicalSector(sector);
    const contents = new Uint8Array(343);
    encode6and2(contents, dsk, trackOff + logical * 256);
    for (let c = 0; c < 343; c++) pos = writeByte(dest, pos, contents[c]);
    pos = writeByte(dest, pos, 0xDE);
    pos = writeByte(dest, pos, 0xAA);
    pos = writeByte(dest, pos, 0xEB);

    for (let c = 0; c < 16; c++) pos = writeSync(dest, pos); // gap 3
  }
}

// ---------------------------------------------------------------------------
// Assemble the WOZ2 container around a 143,360-byte DSK image.
// ---------------------------------------------------------------------------
function buildWozFromDsk(dsk) {
  const woz = new Uint8Array(512 * 3 + 512 * 35 * 13);
  const setStr = (off, s) => { for (let i = 0; i < s.length; i++) woz[off + i] = s.charCodeAt(i) & 0xFF; };
  const set16 = (off, v) => { woz[off] = v & 0xFF; woz[off + 1] = (v >> 8) & 0xFF; };
  const set32 = (off, v) => { woz[off] = v & 0xFF; woz[off + 1] = (v >> 8) & 0xFF; woz[off + 2] = (v >> 16) & 0xFF; woz[off + 3] = (v >>> 24) & 0xFF; };

  // Header.
  setStr(0, "WOZ2");
  woz[4] = 0xFF; woz[5] = 0x0A; woz[6] = 0x0D; woz[7] = 0x0A;

  // INFO chunk.
  setStr(12, "INFO");
  set32(16, 60);
  woz[20] = 2;  // INFO version 2
  woz[21] = 1;  // 5.25"
  woz[22] = 0;  // write protect off
  woz[23] = 0;  // not cross-track synchronised
  woz[24] = 1;  // fake bits removed
  setStr(25, "3ric wozgen (dsk2woz2 port)".padEnd(32, " ").slice(0, 32));
  woz[57] = 1;  // one side
  woz[58] = 0;  // boot sector format unknown
  woz[59] = 32; // optimal bit timing (4us)
  set16(60, 0); // compatible hardware unknown
  set16(62, 0); // required RAM unknown
  set16(64, 13); // largest track (blocks)

  // TMAP chunk.
  setStr(80, "TMAP");
  set32(84, 160);
  woz.fill(0xFF, 88, 88 + 160);
  for (let c = 0; c < 35; c++) {
    const tp = 88 + (c << 2);
    if (c > 0) woz[tp - 1] = c;
    woz[tp] = c;
    woz[tp + 1] = c;
  }

  // TRKS chunk.
  setStr(248, "TRKS");
  set32(252, 1280 + 35 * 13 * 512);
  for (let c = 0; c < 35; c++) {
    const tp = 256 + (c << 3);
    set16(tp, 3 + c * 13); // starting block
    set16(tp + 2, 13);     // block count
    set32(tp + 4, 50304);  // bit count
  }

  // Track bitstreams.
  let out = 512 * 3;
  for (let c = 0; c < 35; c++) {
    const trk = new Uint8Array(6646);
    serialiseTrack(trk, dsk, c * 16 * 256, c);
    woz.set(trk, out);
    out += 512 * 13;
  }

  // CRC over everything after the CRC field.
  set32(8, crc32(woz, 12, woz.length));
  return woz;
}

// ---------------------------------------------------------------------------
// Multi-track boot loader (track 0 sector 0). Assembled at $0800.
//
// The $C600 boot PROM loads sector 0 (count byte = 1) to $0800 then JMP $0801.
// We re-enter the ROM's ReadSector ($C65C) once per track to stream the payload
// into a page-aligned staging area, phase-step the head inward between tracks,
// then relocate a position-independent copier to $0200 and move staging -> load.
//
// ZP usage (avoids the ROM read ZP $26/$27/$2B/$3C/$3D/$40/$41 and the page-3
// nibble table/scratch): driver $06-$0B, copier $0C-$12.
// ---------------------------------------------------------------------------
function assembleLoader(nPages, loadHi, stageHi, entryLo, entryHi) {
  const hex = (v) => "$" + (v & 0xFF).toString(16).padStart(2, "0");
  const src = `
NPAGES  = ${hex(nPages)}
STAGEHI = ${hex(stageHi)}
LOADHI  = ${hex(loadHi)}
ENTRYLO = ${hex(entryLo)}
ENTRYHI = ${hex(entryHi)}
READSEC = $C65C
WAIT    = $FCA8

        .org $0800
count:  .byte 1              ; $0800 ROM sector count -> load loader only
        jmp init            ; $0801 (operand patched to 'jmp resume')

init:
        lda #<resume
        sta $0802
        lda #>resume
        sta $0803
        lda #NPAGES
        sta $06             ; pagesLeft
        lda #STAGEHI
        sta $07             ; stageHi
        lda #0
        sta $08             ; curTrack
        sta $0b             ; half-track counter
        lda #1
        sta $09             ; nextSec (skip loader sector 0)

doBatch:
        sec
        lda #16
        sbc $09             ; avail = 16 - nextSec
        cmp $06
        bcc gotread         ; avail < pagesLeft -> toRead = avail
        lda $06             ; else toRead = pagesLeft
gotread:
        sta $0a             ; toRead
        clc
        adc $09             ; nextSec + toRead
        sta count           ; $0800 = last wanted sector + 1
        lda $09
        sta $3d             ; ROM wanted sector
        lda #0
        sta $26             ; ROM buffer lo
        lda $07
        sta $27             ; ROM buffer hi = stageHi
        lda $08
        sta $41             ; ROM wanted track
        ldx $2b
        jmp READSEC         ; reads batch, then JMP $0801 -> resume

resume:
        sec
        lda $06
        sbc $0a
        sta $06             ; pagesLeft -= toRead
        beq finish
        lda $07
        clc
        adc $0a
        sta $07             ; stageHi += toRead
        inc $08             ; curTrack++
        lda #0
        sta $09             ; nextSec = 0 for whole tracks
        jsr stepin
        jmp doBatch

finish:
        lda #ENTRYLO
        sta $10             ; entry vector lo
        lda #ENTRYHI
        sta $11             ; entry vector hi
        lda #0
        sta $0c             ; src lo
        sta $0e             ; dst lo
        lda #STAGEHI
        sta $0d             ; src hi (staging)
        lda #LOADHI
        sta $0f             ; dst hi (load address)
        lda #NPAGES
        sta $12             ; page count
        ldx #copend-copier
cpr:
        lda copier-1,x
        sta $01ff,x
        dex
        bne cpr
        jmp $0200

; move the head inward one full track (two half-steps), holding one phase at a
; time exactly like the ROM's recalibrate but ascending.
stepin:
        ldx #2
sistep:
        lda $0b
        and #3
        asl
        ora $2b
        tay
        lda $c080,y         ; phase (half&3) OFF
        inc $0b
        lda $0b
        and #3
        asl
        ora #1
        ora $2b
        tay
        lda $c080,y         ; phase (half&3) ON
        jsr swait
        dex
        bne sistep
        rts

swait:
        lda #$ff
        jsr WAIT
        rts

; position-independent page copier (runs at $0200): copies $12 pages from
; ($0c) to ($0e) then jumps through the entry vector at $10/$11.
copier:
        ldy #0
cpl:
        lda ($0c),y
        sta ($0e),y
        iny
        bne cpl
        inc $0d
        inc $0f
        dec $12
        bne copier
        jmp ($10)
copend:
`;
  const { bytes, symbols } = assemble(src, { org: 0x0800 });
  const copLen = (symbols.COPEND - symbols.COPIER) & 0xFFFF;
  if (copLen !== 20) throw new Error(`wozgen: copier length changed (${copLen} != 20)`);
  if (bytes.length > 256) throw new Error(`wozgen: boot loader is ${bytes.length} bytes (> 256)`);
  const sector = new Uint8Array(256);
  sector.set(bytes);
  return sector;
}

function placeSector(dsk, track, physical, data) {
  dsk.set(data, (track * 16 + logicalSector(physical)) * 256);
}

/**
 * Build a bootable 5.25" WOZ2 image that loads `programBytes` at `loadAddr` and
 * jumps to `entryAddr` (defaults to `loadAddr`).
 *
 * @param {Uint8Array|number[]} programBytes  Raw program bytes.
 * @param {number} loadAddr   Load address; must be page-aligned and >= $0800.
 * @param {number} [entryAddr] Entry address (defaults to loadAddr).
 * @returns {Uint8Array} The .woz image.
 */
export function buildBootableWoz(programBytes, loadAddr, entryAddr = loadAddr) {
  const bytes = programBytes instanceof Uint8Array ? programBytes : Uint8Array.from(programBytes);
  if (!Number.isInteger(loadAddr) || (loadAddr & 0xFF) !== 0)
    throw new Error("wozgen: load address must be page-aligned (low byte $00)");
  if (loadAddr < 0x0800)
    throw new Error("wozgen: load address must be >= $0800 (below is boot/ZP/stack/text)");
  if (!Number.isInteger(entryAddr) || entryAddr < 0 || entryAddr > 0xFFFF)
    throw new Error("wozgen: entry address must be an integer in $0000..$FFFF");
  if (bytes.length === 0) throw new Error("wozgen: program is empty");

  const nPages = Math.ceil(bytes.length / 256);
  if (loadAddr + 2 * nPages * 256 > 0x9000)
    throw new Error(`wozgen: program too large — load + 2*${nPages} pages exceeds $9000 (RAM top)`);
  const capacityPages = 15 + 34 * 16; // track 0 gives 15 payload sectors; tracks 1-34 give 16
  if (nPages > capacityPages) throw new Error("wozgen: program exceeds one 5.25\" disk");

  const loadHi = (loadAddr >> 8) & 0xFF;
  const stageHi = loadHi + nPages;
  const loader = assembleLoader(nPages, loadHi, stageHi, entryAddr & 0xFF, (entryAddr >> 8) & 0xFF);

  const dsk = new Uint8Array(35 * 16 * 256);
  placeSector(dsk, 0, 0, loader);

  const payload = new Uint8Array(nPages * 256);
  payload.set(bytes);
  for (let i = 0; i < nPages; i++) {
    let track, physical;
    if (i < 15) { track = 0; physical = i + 1; }
    else { const j = i - 15; track = 1 + ((j / 16) | 0); physical = j % 16; }
    placeSector(dsk, track, physical, payload.subarray(i * 256, i * 256 + 256));
  }

  return buildWozFromDsk(dsk);
}

export { buildWozFromDsk, assembleLoader };
