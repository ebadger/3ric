// msbasic-prg.mjs — build BASIC.PRG, the 3RIC DOS port of the MS-BASIC boot disk
// (msbasic-woz.mjs). `BRUN BASIC.PRG 0800` from the DOS shell copies the ROM's own
// Microsoft BASIC, with the boot disk's RAM-resident adaptations, into the RAM under the
// $9000-$BFFF overlay and starts it. Its LOAD "NAME" and SAVE "NAME" read and write
// programs in the DOS's current directory through the ROM's FAT32 routines.
// Contract: specs/ROM-SOFTWARE.md ("MS-BASIC for 3RIC DOS").
//
// The output embeds the ROM's third-party BASIC interpreter. It is a local artifact for
// your own machine, not a repository asset (see NOTICE); codegen/out/ is git-ignored.
//
// Usage: node codegen/tools/msbasic-prg.mjs codegen/out/BASIC.PRG [--rom <bin>] [--dbg <dbg>]
// Then copy BASIC.PRG to the SD card and, at the DOS ">" prompt: BRUN BASIC.PRG 0800

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import {
  BASIC_END, BASIC_ENTRY, BASIC_PAGES, BASIC_START, DEFAULT_ROM, GUARD_START, buildMsBasicImage, fletcher16,
} from "./msbasic-woz.mjs";

export const PRG_ORG = 0x0800; // BRUN BASIC.PRG 0800
export const COPY_ORG = PRG_ORG + 0x100; // the glue, then the interpreter, follow the one-page loader
export const MISMATCH_TEXT = "BASIC.PRG/ROM MISMATCH";
export const DEFAULT_DBG = DEFAULT_ROM.replace(/\.bin$/i, ".dbg");
// The ROM's FAT32 library keeps its pointers in $B0-$BF, where BASIC's CHRGET/TXTPTR
// live once the interpreter runs; LOAD/SAVE save and restore this range around it.
export const ZP_SAVE = { start: 0xb0, length: 0x20 };
export const MESSAGES = {
  notFound: "FILE NOT FOUND",
  typeMismatch: "FILE TYPE MISMATCH",
  io: "I/O",
  badName: "BAD FILE NAME",
};
// Characters a FAT short name may not contain (besides control characters and space).
export const BAD_NAME_CHARS = '"*+,/:;<=>?[\\]|';

const hex = (value, digits = 4) => "$" + value.toString(16).toUpperCase().padStart(digits, "0");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// Every ROM address the glue uses comes from the ROM's debug symbols and is checked
// against the bytes the shipped sources assemble to (null = any byte), so a ROM/dbg pair
// that does not match, or a ROM whose routines changed, is refused.
const ROUTINES = {
  // BASIC (copied into the RAM image)
  FRMEVL: [0xa6, 0xb9, 0xd0, 0x02, 0xc6, 0xba, 0xc6, 0xb9], // LDX TXTPTR / BNE / DEC TXTPTR+1
  FRESTR: [0x20, null, null, 0xa5, 0xa3, 0xa4, 0xa4, 0x85, 0x61, 0x84, 0x62], // ... STA INDEX / STY INDEX+1
  FIX_LINKS: [0x20, null, null, 0x20, null, null, 0x4c], // JSR SETPTRS / JSR LE33D / JMP L2351
  SCRTCH: [0xa9, 0x00, 0xa8, 0x91, 0x6a, 0xc8, 0x91, 0x6a], // zero the end marker at (TXTTAB)
  ERROR: [0x46, 0x17, 0x20, null, null, 0x20, null, null, 0xbd], // LSR Z14 / JSR CRDO / JSR OUTQUES
  CRDO: [0xa9, 0x8d, 0x85, 0x50],
  OUTQUES: [0xa9, 0x3f, 0x24, 0x17],
  STROUT: [0x20, null, null, 0x20, null, null, 0xaa, 0xa0, 0x00],
  STKINI: [0xa2, 0x58, 0x86, 0x55, 0x68, 0xa8, 0x68, 0xa2, 0xf8, 0x9a],
  QT_ERROR: [0x20, 0x45, 0x52, 0x52], // " ERR"
  PRINT_ERROR_LINNUM: [0x20, null, null, 0xa4, 0x79, 0xc8, 0xf0], // JSR STROUT / LDY CURLIN+1 / INY / BEQ
  // ROM DOS / FAT32 library (upper ROM, fingerprinted again by the loader at run time)
  fat32_open_cd: [0x48, 0xda, 0x5a, 0xad, 0x20, 0xcc], // ... LDA zp_sd_cd_cluster
  fat32_finddirent: [0xad, 0x3b, 0xcc, 0x48, 0xad, 0x3c, 0xcc, 0x48, 0x9c, 0x3b, 0xcc],
  fat32_opendirent: [0xa0, 0x1c, 0xb1, 0xb8, 0x8d, 0x10, 0xcc], // size -> fat32_bytesremaining
  fat32_file_readbyte: [0x38, 0xad, 0x10, 0xcc, 0x0d, 0x11, 0xcc, 0x0d, 0x12, 0xcc, 0x0d, 0x13, 0xcc],
  fat32_deletefile: [0x20, null, null, 0x9c, 0x14, 0xcc, 0x9c, 0x15, 0xcc],
  fat32_allocatefile: [0xa9, 0x00, 0x8d, 0x14, 0xcc, 0x8d, 0x15, 0xcc, 0x8d, 0x16, 0xcc, 0x8d, 0x17, 0xcc],
  fat32_writedirent: [0x18, 0xa5, 0xb8, 0x69, 0x20, 0x85, 0xb8, 0xa5, 0xb9, 0x69, 0x00, 0x85, 0xb9],
  fat32_file_write: [0xad, 0x18, 0xcc, 0x8d, 0x0c, 0xcc, 0xad, 0x19, 0xcc, 0x8d, 0x0d, 0xcc],
  fat32_prep_fileparam: [0x48, 0x5a, 0xa0, 0x0a, 0xa9, 0x20, 0x99, 0x70, 0xcd, 0x88, 0x10, 0xfa], // -> dos_file_param
  fat32_set_readbuffer: [0xa9, 0x00, 0x8d, 0x30, 0xcc, 0xa9, 0xc8, 0x8d, 0x31, 0xcc],
  fat32_set_target: [0xad, 0x30, 0xcc, 0x85, 0xb8, 0xad, 0x31, 0xcc, 0x85, 0xb9],
};
// Data and zero page the glue addresses directly; the signatures above pin most of them.
const VARIABLES = {
  TXTTAB: 0x6a, VARTAB: 0x6c, MEMSIZ: 0x76, INDEX: 0x61, TXTPTR: 0xb9, CHRGET: 0xb2,
  ERR_SYNTAX: null, ERR_MEMFULL: null, ERROR_MESSAGES: null,
  dos_command: 0xcd00, dos_file_param: 0xcd70, fat32_filenamepointer: 0xba, fat32_bytesremaining: 0xcc10,
  fat32_address: 0xcc30, zp_sd_address: 0xb8,
};
// The cassette LOAD/SAVE this port replaces: JSR L0F42 / JSR $FECD (tape write) ... and
// JSR L0F42 / JSR $FEFD (tape read) ...; their first three bytes become JMPs to the glue.
const SAVE_CODE = [0x20, null, null, 0x20, 0xcd, 0xfe, 0x20, null, null, 0x4c, 0xcd, 0xfe];
const LOAD_CODE = [0x20, null, null, 0x20, 0xfd, 0xfe, 0x20, null, null, 0x20, 0xfd, 0xfe];

function findPattern(bytes, pattern) {
  const hits = [];
  next: for (let i = 0; i + pattern.length <= bytes.length; i++) {
    for (let j = 0; j < pattern.length; j++)
      if (pattern[j] !== null && bytes[i + j] !== pattern[j]) continue next;
    hits.push(i);
  }
  return hits;
}

export function readDbgSymbols(dbgText) {
  const symbols = {};
  for (const [, name, value] of dbgText.matchAll(/^sym\s.*?name="([^"]+)",.*?val=0x([0-9A-F]+)/gm))
    if (!(name in symbols)) symbols[name] = parseInt(value, 16);
  const segments = {};
  for (const [, name, start, size] of dbgText.matchAll(/^seg\s.*?name="([^"]+)",start=0x([0-9A-F]+),size=0x([0-9A-F]+)/gm))
    segments[name] = { start: parseInt(start, 16), size: parseInt(size, 16) };
  return { symbols, segments };
}

// Resolve and verify every address the glue needs.
export function resolveRom(rom, dbgText) {
  const { symbols, segments } = readDbgSymbols(dbgText);
  const at = {};
  const need = name => {
    if (!(name in symbols)) throw new Error(`${name} is not in the debug symbols`);
    return symbols[name];
  };
  for (const [name, signature] of Object.entries(ROUTINES)) {
    const address = need(name);
    if (signature.some((byte, i) => byte !== null && rom[address + i] !== byte))
      throw new Error(`${name} at ${hex(address)} is not the routine this port calls (ROM/dbg mismatch?)`);
    at[name] = address;
  }
  for (const [name, expected] of Object.entries(VARIABLES)) {
    const value = need(name);
    if (expected !== null && value !== expected) throw new Error(`${name} is ${hex(value)}, expected ${hex(expected)}`);
    at[name] = value;
  }
  const errorText = (code, text) => {
    const bytes = rom.subarray(at.ERROR_MESSAGES + code, at.ERROR_MESSAGES + code + text.length);
    return [...text].every((char, i) => (bytes[i] & 0x7f) === char.charCodeAt(0));
  };
  if (!errorText(at.ERR_SYNTAX, "SYNTAX") || !errorText(at.ERR_MEMFULL, "OUT OF MEMORY"))
    throw new Error("ERR_SYNTAX/ERR_MEMFULL do not index their messages");
  const chrget = segments.CHRGET;
  if (!chrget) throw new Error("no CHRGET segment in the debug symbols");
  const chrgetCode = [0xe6, at.TXTPTR, 0xd0, 0x02, 0xe6, at.TXTPTR + 1, 0xad];
  if (chrgetCode.some((byte, i) => rom[chrget.start + i] !== byte) || at.TXTPTR !== at.CHRGET + 7)
    throw new Error("CHRGET is not INC TXTPTR / ... / CHRGOT: LDA (TXTPTR)");
  at.CHRGOT = at.CHRGET + 6;
  if (at.CHRGET < ZP_SAVE.start || at.CHRGET + chrget.size > ZP_SAVE.start + ZP_SAVE.length)
    throw new Error(`CHRGET ${hex(at.CHRGET, 2)}+${chrget.size} lies outside the saved zero page`);
  return at;
}

function glueSource(org, a) {
  const d = (name, value, digits = 4) => `${name.padEnd(10)}= ${hex(value, digits)}\n`;
  const text = string => [...string].map(char => hex(char.charCodeAt(0), 2)).join(",") + ",0";
  return `
; ---- 3RIC DOS LOAD/SAVE (msbasic-prg.mjs), just below the interpreter and MEMSIZ ----
${d("DTXTTAB", a.TXTTAB, 2)}${d("DVARTAB", a.VARTAB, 2)}${d("DMEMSIZ", a.MEMSIZ, 2)}${d("DINDEX", a.INDEX, 2)}\
${d("DCHRGOT", a.CHRGOT, 2)}${d("DZ14", 0x17, 2)}${d("DFRMEVL", a.FRMEVL)}${d("DFRESTR", a.FRESTR)}\
${d("DFIXLINKS", a.FIX_LINKS)}${d("DSCRTCH", a.SCRTCH)}${d("DERROR", a.ERROR)}${d("DERRSYN", a.ERR_SYNTAX, 2)}\
${d("DERRMEM", a.ERR_MEMFULL, 2)}${d("DCRDO", a.CRDO)}${d("DOUTQUES", a.OUTQUES)}${d("DSTROUT", a.STROUT)}\
${d("DSTKINI", a.STKINI)}${d("DQTERROR", a.QT_ERROR)}${d("DPRERRLN", a.PRINT_ERROR_LINNUM)}\
${d("DOSCMD", a.dos_command)}${d("DOSFILE", a.dos_file_param)}${d("DFNPTR", a.fat32_filenamepointer, 2)}\
${d("DSDADDR", a.zp_sd_address, 2)}${d("DBYTES", a.fat32_bytesremaining)}${d("DF32ADDR", a.fat32_address)}\
${d("FOPENCD", a.fat32_open_cd)}${d("FFIND", a.fat32_finddirent)}${d("FOPEN", a.fat32_opendirent)}\
${d("FREADB", a.fat32_file_readbyte)}${d("FDELETE", a.fat32_deletefile)}${d("FALLOC", a.fat32_allocatefile)}\
${d("FWRITEDIR", a.fat32_writedirent)}${d("FWRITE", a.fat32_file_write)}${d("FPREP", a.fat32_prep_fileparam)}\
${d("FSETBUF", a.fat32_set_readbuffer)}${d("FSETTGT", a.fat32_set_target)}\
${d("DZPBASE", ZP_SAVE.start, 2)}${d("DZPLEN", ZP_SAVE.length, 2)}${d("DBADLEN", BAD_NAME_CHARS.length, 2)}
        .org ${hex(org)}
; SAVE "NAME": replace NAME in the current directory with the program (TXTTAB..VARTAB).
dossave:
        jsr dsname
        jsr dsopen
        jsr dsfind
        bcs dsnew
        jsr dsisdir
        beq dsdelete
        jmp dstypezp        ; never delete a directory
dsdelete:
        jsr FDELETE
dsnew:
        jsr dssize
        jsr FALLOC
        lda #<DOSFILE
        sta DFNPTR
        lda #>DOSFILE
        sta DFNPTR+1
        jsr FOPENCD
        jsr dssize
        jsr FWRITEDIR
        bcs dssaveio
        jsr dssize
        lda DTXTTAB
        sta DF32ADDR
        lda DTXTTAB+1
        sta DF32ADDR+1
        jsr FWRITE
        bcs dssaveio
        jsr FOPENCD
        jmp dszprest        ; RTS to NEWSTT with CHRGET/TXTPTR restored
dssaveio:
        jmp dsiozp

; Evaluate the string argument; copy it to the DOS command line as an upper-case 8.3 name.
dsname:
        jsr DFRMEVL
        jsr DCHRGOT
        beq dsnend
        ldx #DERRSYN        ; nothing may follow the name
        jmp DERROR
dsnend:
        jsr DFRESTR         ; A = length, (DINDEX) = characters
        cmp #13
        bcs dsbadname
        tax
        beq dsbadname
        ldy #0
        sty dsdot
        sty dsrun
dsnloop:
        lda (DINDEX),y
        cmp #'a'
        bcc dsnupper
        cmp #$7B            ; past 'z'
        bcs dsnupper
        and #$DF
dsnupper:
        cmp #'.'
        bne dsnchar
        lda dsdot
        bne dsbadname       ; one extension only
        lda dsrun
        beq dsbadname       ; no empty base name (and no . or ..)
        cmp #9
        bcs dsbadname
        inc dsdot
        stz dsrun
        lda #'.'
        bra dsnstore
dsnchar:
        cmp #$21
        bcc dsbadname       ; space or control character
        cmp #$7F
        bcs dsbadname
        phx
        ldx #DBADLEN-1
dsnbad:
        cmp dsbadchars,x
        beq dsnbadx
        dex
        bpl dsnbad
        plx
        inc dsrun
dsnstore:
        sta DOSCMD,y
        iny
        dex
        bne dsnloop
        lda #0
        sta DOSCMD,y
        lda dsrun
        beq dsbadname       ; nothing after the '.'
        ldx dsdot
        beq dsnbase
        cmp #4
        bcs dsbadname       ; extension of 1-3 characters
        rts
dsnbase:
        cmp #9
        bcs dsbadname       ; base name of 1-8 characters
        rts
dsnbadx:
        plx
        bra dsbadname

dsbadname:
        lda #<dsmname
        ldy #>dsmname
; Print ?<message> ERR (and IN <line> when running) and return to the prompt, as ERROR.
dserr:
        pha
        phy
        lsr DZ14
        jsr DCRDO
        jsr DOUTQUES
        ply
        pla
        jsr DSTROUT
        jsr DSTKINI
        lda #<DQTERROR
        ldy #>DQTERROR
        jmp DPRERRLN

dsioprog:
        jsr DSCRTCH
        bra dsio
dsbadprog:
        jsr DSCRTCH         ; the partial or foreign bytes are not a program: NEW
        bra dstype
dsnotfzp:
        jsr dszprest
        lda #<dsmnotf
        ldy #>dsmnotf
        bra dserr
dstypezp:
        jsr dszprest
dstype:
        lda #<dsmtype
        ldy #>dsmtype
        bra dserr
dsiozp:
        jsr dszprest
dsio:
        lda #<dsmio
        ldy #>dsmio
        bra dserr
dsmemzp:
        jsr dszprest
        ldx #DERRMEM
        jmp DERROR
; LOAD "NAME": read NAME from the current directory as the program, then relink it.
dosload:
        jsr dsname
        jsr dsopen
        jsr dsfind
        bcc dsfound
        jmp dsnotfzp
dsfound:
        jsr dsisdir
        beq dsfile
        jmp dstypezp
dsfile:
        jsr FOPEN
        lda DBYTES+2
        ora DBYTES+3
        bne dsmemzp
        lda DBYTES+1
        bne dssizeok
        lda DBYTES
        cmp #2              ; at least the 00 00 end marker
        bcc dstypezp
dssizeok:
        clc
        lda DTXTTAB
        adc DBYTES
        sta dsend
        lda DTXTTAB+1
        adc DBYTES+1
        sta dsend+1
        bcs dsmemzp
        lda dsend
        cmp DMEMSIZ
        lda dsend+1
        sbc DMEMSIZ+1
        bcs dsmemzp         ; the program must end below MEMSIZ
        lda DTXTTAB
        sta DINDEX
        lda DTXTTAB+1
        sta DINDEX+1
dsread:
        jsr FREADB
        bcs dsreaddone
        sta (DINDEX)
        inc DINDEX
        bne dsread
        inc DINDEX+1
        bra dsread
dsreaddone:
        jsr FOPENCD
        jsr dszprest
        lda DINDEX
        cmp dsend
        bne dsshort         ; short read
        lda DINDEX+1
        cmp dsend+1
        bne dsshort
        sta DVARTAB+1
        lda dsend
        sta DVARTAB
        jsr dscheck
        bcs dsforeign
        jmp DFIXLINKS       ; clear variables, relink, back to the prompt
dsshort:
        jmp dsioprog
dsforeign:
        jmp dsbadprog

; Save the FAT32 library's zero page (BASIC's CHRGET), then convert the name for it.
dsopen:
        ldx #DZPLEN-1
dszps:
        lda DZPBASE,x
        sta dszpbuf,x
        dex
        bpl dszps
        lda #<DOSCMD
        sta DFNPTR
        lda #>DOSCMD
        sta DFNPTR+1
        jmp FPREP           ; -> DOSFILE (11 bytes, space padded)

; Restore it; preserves A and Y.
dszprest:
        pha
        ldx #DZPLEN-1
dszpr:
        lda dszpbuf,x
        sta DZPBASE,x
        dex
        bpl dszpr
        pla
        rts

; Look the name up in the current directory, as the shell's DEL does. C set = not found;
; otherwise DSDADDR points at its directory entry.
dsfind:
        jsr FSETBUF
        jsr FSETTGT
        jsr FOPENCD
        jmp FFIND

dsisdir:
        ldy #11
        lda (DSDADDR),y
        and #$10            ; Z clear for a directory
        rts

dssize:
        sec
        lda DVARTAB
        sbc DTXTTAB
        sta DBYTES
        lda DVARTAB+1
        sbc DTXTTAB+1
        sta DBYTES+1
        stz DBYTES+2
        stz DBYTES+3
        rts

; Walk the loaded lines exactly as FIX_LINKS will. C clear when every line has a nonzero
; link high byte and a terminating 0 within 255 bytes, and the walk lands on 00 00 at
; VARTAB-2; then FIX_LINKS only rewrites links inside the program.
dscheck:
        sec
        lda dsend
        sbc #2
        sta dsstop
        lda dsend+1
        sbc #0
        sta dsstop+1
        lda DTXTTAB
        sta DINDEX
        lda DTXTTAB+1
        sta DINDEX+1
dschkline:
        lda DINDEX
        cmp dsstop
        lda DINDEX+1
        sbc dsstop+1
        bcs dschkend
        ldy #1
        lda (DINDEX),y
        beq dschkbad
        ldy #4
dschkscan:
        iny
        beq dschkbad
        lda (DINDEX),y
        bne dschkscan
        tya
        sec
        adc DINDEX
        sta DINDEX
        bcc dschkline
        inc DINDEX+1
        bra dschkline
dschkend:
        lda DINDEX
        cmp dsstop
        bne dschkbad
        lda DINDEX+1
        cmp dsstop+1
        bne dschkbad
        lda (DINDEX)
        ldy #1
        ora (DINDEX),y
        bne dschkbad
        clc
        rts
dschkbad:
        sec
        rts

dsmnotf: .byte ${text(MESSAGES.notFound)}
dsmtype: .byte ${text(MESSAGES.typeMismatch)}
dsmio:   .byte ${text(MESSAGES.io)}
dsmname: .byte ${text(MESSAGES.badName)}
dsbadchars: .byte ${[...BAD_NAME_CHARS].map(char => hex(char.charCodeAt(0), 2)).join(",")}
dsend:   .word 0
dsstop:  .word 0
dsdot:   .byte 0
dsrun:   .byte 0
dszpbuf: .res DZPLEN, 0
`;
}

function loaderSource(guard, glueOrg) {
  return `
NPAGES  = ${(BASIC_END - glueOrg) >> 8}       ; glue + interpreter
IMAGEHI = ${hex(COPY_ORG >> 8, 2)}
LOADHI  = ${hex(glueOrg >> 8, 2)}
BASICGO = ${hex(BASIC_ENTRY)}     ; ROM vector: JMP COLD_START
COUT    = $FDED
ROMREAD = $C082       ; language card: read upper ROM, no write
RAM9000 = $C007       ; expose RAM at $9000-$BFFF (BASIC ROM overlay off)
SUMONE  = ${hex(guard[0], 2)}
SUMTWO  = ${hex(guard[1], 2)}

        .org ${hex(PRG_ORG)}
; BRUN jumps here. The RAM interpreter calls the ROM's OS, FAT32 and NMI code at fixed
; addresses, so refuse to start unless upper ROM matches the ROM this file was built from.
start:
        lda ROMREAD
        stz $06
        lda #>${hex(GUARD_START)}
        sta $07
        stz $08
        stz $09
        ldy #0
sumloop:
        lda ($06),y
        clc
        adc $08
        adc #0
        sta $08
        clc
        adc $09
        adc #0
        sta $09
        iny
        bne sumloop
        inc $07
        bne sumloop
        lda $08
        cmp #SUMONE
        bne mismatch
        lda $09
        cmp #SUMTWO
        beq romok
mismatch:
        ldx #0
msgloop:
        lda message,x
        beq msgdone
        ora #$80
        jsr COUT
        inx
        bne msgloop
msgdone:
        rts                 ; back to the DOS prompt, overlay RAM untouched

romok:
        lda RAM9000         ; writes to $9000-$BFFF now reach RAM
        ; copy the glue and the interpreter, contiguous in this file and in memory
        stz $06
        lda #IMAGEHI
        sta $07
        stz $08
        lda #LOADHI
        sta $09
        ldx #NPAGES
        ldy #0
copy:
        lda ($06),y
        sta ($08),y
        iny
        bne copy
        inc $07
        inc $09
        dex
        bne copy
        jmp BASICGO

message:
        .byte $0D, "${MISMATCH_TEXT}", $0D, 0
`;
}

/**
 * Build BASIC.PRG from a 3ric ROM image and its ca65 debug symbols. Throws if the ROM's
 * BASIC layout or any routine the glue calls is not the one this tool adapts.
 */
export function buildMsBasicPrg(romBytes, dbgText) {
  const rom = Uint8Array.from(romBytes);
  if (rom.length < 0x10000) throw new Error("ROM image must contain the 64 KiB mapped address space");
  const at = resolveRom(rom, dbgText);
  const site = (name, pattern) => {
    const hits = findPattern(rom.subarray(BASIC_START, BASIC_END), pattern);
    if (hits.length !== 1) throw new Error(`expected one cassette ${name} in BASIC, found ${hits.length}`);
    return BASIC_START + hits[0];
  };
  const saveSite = site("SAVE", SAVE_CODE), loadSite = site("LOAD", LOAD_CODE);
  const jmp = target => [0x4c, target & 0xff, target >> 8];

  // The glue occupies whole pages just below the interpreter; BASIC's memory top moves
  // down to it, so programs and strings never reach it.
  const draft = assemble(glueSource(0x8000, at));
  const glueOrg = BASIC_START - (Math.ceil(draft.bytes.length / 256) << 8);
  const glue = assemble(glueSource(glueOrg, at));
  if (glue.bytes.length !== draft.bytes.length) throw new Error("glue size changed with its origin");
  const gluePage = new Uint8Array(BASIC_START - glueOrg);
  gluePage.set(glue.bytes);
  const g = glue.symbols;
  const built = buildMsBasicImage(rom, {
    memTop: glueOrg,
    extraPatches: ({ image }) => [
      { name: "SAVE", site: saveSite, before: [...image.subarray(saveSite - BASIC_START, saveSite - BASIC_START + 3)], after: jmp(g.DOSSAVE) },
      { name: "LOAD", site: loadSite, before: [...image.subarray(loadSite - BASIC_START, loadSite - BASIC_START + 3)], after: jmp(g.DOSLOAD) },
    ],
  });

  const guard = fletcher16(rom.subarray(GUARD_START, 0x10000));
  const loaded = assemble(loaderSource(guard, glueOrg), { org: PRG_ORG });
  if (loaded.bytes.length > COPY_ORG - PRG_ORG) throw new Error(`loader is ${loaded.bytes.length} bytes (> 256)`);
  const prg = new Uint8Array(COPY_ORG - PRG_ORG + gluePage.length + built.image.length);
  prg.set(loaded.bytes);
  prg.set(gluePage, COPY_ORG - PRG_ORG);
  prg.set(built.image, COPY_ORG - PRG_ORG + gluePage.length);

  return {
    prg,
    image: built.image,
    glue: gluePage,
    glueOrg,
    coldStart: built.coldStart,
    guard,
    rom: at,
    loaderSymbols: loaded.symbols,
    glueSymbols: g,
    symbols: built.symbols,
    hooks: { ...built.hooks, save: g.DOSSAVE, load: g.DOSLOAD, zpBuffer: g.DSZPBUF },
    patches: built.patches,
  };
}

function main(args) {
  const usage = "Usage: node codegen/tools/msbasic-prg.mjs <BASIC.PRG> [--rom <badger6502.bin>] [--dbg <badger6502.dbg>]";
  let romPath = DEFAULT_ROM, dbgPath = null, output = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rom" && i + 1 < args.length) romPath = args[++i];
    else if (args[i] === "--dbg" && i + 1 < args.length) dbgPath = args[++i];
    else if (output === null && !args[i].startsWith("--")) output = args[i];
    else throw new Error(usage);
  }
  if (output === null) throw new Error(usage);
  output = path.resolve(output);
  dbgPath ??= romPath === DEFAULT_ROM ? DEFAULT_DBG : romPath.replace(/\.bin$/i, ".dbg");

  const rom = fs.readFileSync(romPath);
  const built = buildMsBasicPrg(rom, fs.readFileSync(dbgPath, "utf8"));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  try {
    fs.writeFileSync(output, built.prg, { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`${output} already exists; delete it or choose another name`);
    throw error;
  }
  console.log([
    `Created ${output} (${built.prg.length} bytes)`,
    `ROM ${path.resolve(romPath)} (SHA-256 ${sha256(rom)})`,
    `BASIC ${hex(BASIC_START)}-${hex(BASIC_END - 1)} (resident code from ${hex(built.hooks.start)}), DOS LOAD/SAVE ${hex(built.glueOrg)}-${hex(BASIC_START - 1)} (BASIC's memory top)`,
    `PRG SHA-256 ${sha256(built.prg)}`,
    "Contains the ROM's Microsoft BASIC: keep it local (see NOTICE).",
    `Copy it to the SD card; at the DOS prompt: BRUN ${path.basename(output).toUpperCase()} ${PRG_ORG.toString(16).padStart(4, "0")}`,
    'In BASIC: SAVE "NAME" and LOAD "NAME" use the DOS current directory.',
  ].join("\n"));
}

if (typeof process !== "undefined" && process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`msbasic-prg: ${error.message}`); process.exitCode = 1; }
}
