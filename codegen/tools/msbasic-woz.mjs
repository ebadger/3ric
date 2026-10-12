// msbasic-woz.mjs — build a bootable 5.25" WOZ that loads a 3ric ROM's own Microsoft
// BASIC into the 12 KiB RAM under the $9000-$BFFF overlay and starts it, so BASIC runs
// even when that RAM was never seeded (as at a physical power-on). Before BASIC starts,
// the disk waits out the picodisk's spin-down and resyncs the ROM's PS/2 decoder. The copy
// also repairs the line breaks in BASIC's messages, so its prompt is a bare "]", and reads
// Shift+= as "+", which the ROM's PS/2 decoder never produces.
// Contract: specs/ROM-SOFTWARE.md ("MS-BASIC boot disk").
//
// The output embeds the ROM's third-party BASIC interpreter. It is a local artifact for
// your own machine, not a repository asset (see NOTICE); codegen/out/ is git-ignored.
//
// Usage: node codegen/tools/msbasic-woz.mjs codegen/out/basic.woz [--rom <badger6502.bin>]
// Then on 3ric: MON (if the DOS shell shows ">"), C600G, and Return at MEMORY SIZE?

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildWozFromDsk, placeSector } from "./wozgen.mjs";

export const BASIC_START = 0x9000;
export const BASIC_END = 0xc000;
export const BASIC_PAGES = (BASIC_END - BASIC_START) >> 8;
export const BASIC_ENTRY = 0xe000; // ROM vector: JMP COLD_START
export const GUARD_START = 0xd000; // upper ROM that must match the generating ROM
export const MISMATCH_TEXT = "BASIC DISK/ROM MISMATCH";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_ROM = path.join(root, "emulator", "Data", "badger6502.bin");

const hex = (value, digits = 4) => "$" + value.toString(16).toUpperCase().padStart(digits, "0");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// BASIC's MEMORY SIZE probe from generic msbasic init.s (CONFIG_2), at label L40D7:
//   INC LINNUM / BNE L40DD / INC LINNUM+1 / L40DD: LDA #$55 / STA (LINNUM),Y /
//   CMP (LINNUM),Y / BNE L40FA / ASL A / STA (LINNUM),Y / CMP (LINNUM),Y / BNE L40FA /
//   BEQ L40D7
// It writes test patterns upward until a write fails. With the interpreter in RAM at
// $9000, nothing fails until the I/O page, so the probe would overwrite BASIC itself.
const LINNUM = 0x53;
const PROBE = [
  0xe6, LINNUM, 0xd0, 0x02, 0xe6, LINNUM + 1, 0xa9, 0x55, 0x91, LINNUM, 0xd1, LINNUM,
  0xd0, null, 0x0a, 0x91, LINNUM, 0xd1, LINNUM, 0xd0, null, 0xf0, 0xe9,
];
const PROBE_PAGE_STEP = 2; // "BNE L40DD / INC LINNUM+1": 4 bytes, replaced by JSR + NOP
// L40FA starts "LDA LINNUM / LDY LINNUM+1", then stores MEMSIZ and FRETOP.
const SET_TOP = [0xa5, LINNUM, 0xa4, LINNUM + 1];

// The messages BASIC prints, as the shipped ROM assembles them. message.s and init.s name
// CR and LF, which resolve to the merged Apple monitor's labels CR ($FC62) and LF ($FC66),
// so the strings hold $62/$66. OUTDO calls the monitor's CR for $62 and then prints the
// byte too: the stray character before every "]". $0D is a newline through COUT; $80 is
// the null CRDO sends after each newline (CRLF_2).
const ascii = text => [...text].map(char => char.charCodeAt(0));
const MESSAGE_FIXES = [
  { name: "QT_OK", bytes: [0x62, 0x00, 0x00, 0x4b, 0x62, 0x66, 0x00], offset: 0, after: [0x0d] },
  { name: "QT_BREAK", bytes: [0x62, 0x66, ...ascii("BREAK"), 0x00], offset: 0, after: [0x0d, 0x80] },
  { // the credit "A" prints at MEMORY SIZE?, in high-bit ASCII
    name: "QT_WRITTEN_BY", bytes: [...ascii("COPYRIGHT 1977 BY MICROSOFT CO").map(c => c | 0x80), 0x62, 0x00],
    offset: 30, after: [0x0d],
  },
];

// RESTART, which runs before every prompt: LSR Z14 / LDA #<QT_OK / LDY #>QT_OK /
// JSR GOSTROUT / JSR INLIN. Its first four bytes become JSR KEYHOOK + NOP.
const Z14 = 0x17, GOSTROUT = 0x03;
const restartCode = qtOk => [0x46, Z14, 0xa9, qtOk & 0xff, 0xa0, qtOk >> 8, 0x20, GOSTROUT, 0x00, 0x20, null, null];
const RESTART_STEP = 4;
// The monitor's RDKEY ends "JMP (KSWL)"; KEYIN follows, the routine reset's SETKBD puts in
// KSW. It expects RDKEY's A (character under the cursor) and Y (CH), and returns the key.
const KSWL = 0x38;
const RDKEY_KEYIN = [
  0x6c, KSWL, 0x00, 0xe6, 0x4e, 0xd0, 0x02, 0xe6, 0x4f, 0x2c, 0x00, 0xc0, 0x10, 0xf5, 0x91, 0x28,
  0xad, 0x00, 0xc0, 0x9c, 0x00, 0xc0, 0x60,
];
// The ROM's shifted PS/2 table gives "=" for Shift+= and no key gives "+". Disk BASIC reads
// "=" as "+" while either Shift key (scan code) is down in the decoder's key states.
export const SHIFT_KEYS = [0x12, 0x59];

// Disk position of payload page i: T0 S1-15 follow the loader, then whole tracks.
export function sectorForPage(page) {
  if (page < 15) return { track: 0, sector: page + 1 };
  return { track: 1 + ((page - 15) >> 4), sector: (page - 15) & 15 };
}

// The picodisk Disk II emulator freezes the CPU (READY) whenever 500 cycles pass without a
// disk access while its drive model runs, which lasts 1,023,000 cycles after motor-off.
// The ROM decodes PS/2 one clock edge per NMI, so a stall can misread or lose an edge and
// leave its decoder misaligned until reset. Wait out the spin-down (8 x WAIT($FF), about
// 1.33M cycles), then put the decoder back at a frame boundary.
export const SPINDOWN_WAITS = 8;
export const PS2_DECODER = {
  KBSTATE: 0xce00, // frame state; 0 waits for a start bit
  KBEXTEND: 0xce03, // $E0 prefix seen
  KBKEYUP: 0xce04, // $F0 prefix seen
  KBTOGGLE: 0xce18, // lock key waiting for its release
  KBMODIFIER: 0xce19, // frame was Shift/Ctrl
  KEYSTATE: 0xcb00, // per-scan-code key-down flags
};
// The ROM's reset handler clears those variables; the resync repeats that subset.
const RESET_CLEARS = [
  [0x8d, 0x00, 0xce], [0x8d, 0x03, 0xce], [0x8d, 0x04, 0xce], // STA KBSTATE/KBEXTEND/KBKEYUP
  [0x9d, 0x00, 0xcb], [0x9d, 0x00, 0xce], [0x8d, 0x00, 0xc0], // STA KEYSTATE,X / $CE00,X / KBD
];

// Fletcher-16 with end-around carry (sums modulo 255), exactly as the loader computes it.
export function fletcher16(bytes) {
  let first = 0, second = 0;
  for (const byte of bytes) {
    let sum = first + byte;
    first = (sum & 255) + (sum >> 8);
    sum = second + first;
    second = (sum & 255) + (sum >> 8);
  }
  return [first, second];
}

function findPattern(bytes, pattern) {
  const hits = [];
  next: for (let i = 0; i + pattern.length <= bytes.length; i++) {
    for (let j = 0; j < pattern.length; j++)
      if (pattern[j] !== null && bytes[i + j] !== pattern[j]) continue next;
    hits.push(i);
  }
  return hits;
}

function residentSource(org, { setTop, qtOk, keyIn }) {
  const d = PS2_DECODER;
  return `
LINNUM  = ${hex(LINNUM, 2)}
TOPHI   = ${hex(BASIC_START >> 8, 2)}       ; the interpreter starts at $9000
SETTOP  = ${hex(setTop)}     ; L40FA: store MEMSIZ/FRETOP
BASICGO = ${hex(BASIC_ENTRY)}     ; ROM BASIC entry: JMP COLD_START
WAIT    = $FCA8       ; monitor delay; preserves X and Y
SPINDOWN = ${SPINDOWN_WAITS}
VIAPA   = $C20F       ; VIA1 port A without handshake: no flag side effects
PS2CLK  = $40         ; keyboard clock on PA6
KBD     = $C000
KBSTATE = ${hex(d.KBSTATE)}
KBEXTEND = ${hex(d.KBEXTEND)}
KBKEYUP = ${hex(d.KBKEYUP)}
KBTOGGLE = ${hex(d.KBTOGGLE)}
KBMODIFIER = ${hex(d.KBMODIFIER)}
KEYSTATE = ${hex(d.KEYSTATE)}
SHIFTL  = ${hex(d.KEYSTATE + SHIFT_KEYS[0])}       ; left Shift down
SHIFTR  = ${hex(d.KEYSTATE + SHIFT_KEYS[1])}       ; right Shift down
KEYIN   = ${hex(keyIn)}       ; monitor KEYIN
KSWL    = ${hex(KSWL, 2)}         ; KSW: RDKEY's input routine
Z14     = ${hex(Z14, 2)}         ; BASIC's output-suppress flag
OKLO    = ${hex(qtOk & 0xff, 2)}         ; low byte of QT_OK
EQUALSKEY = $BD
PLUSKEY = $AB

        .org ${hex(org)}
; The loader jumps here once every page is in RAM and the drive motor is off.
postload:
        ldx #SPINDOWN       ; let the picodisk's drive model stop and its READY stalls end
spinwait:
        lda #$FF
        jsr WAIT
        dex
        bne spinwait
resync:
        jsr quiet           ; no PS/2 frame in flight
        stz KBSTATE         ; restart the ROM decoder at a frame boundary
        stz KBEXTEND
        stz KBKEYUP
        stz KBTOGGLE
        stz KBMODIFIER
        ldx #0
release:
        stz KEYSTATE,x      ; no key (or Shift/Ctrl) held
        inx
        bne release
        stz KBD             ; drop a key misdecoded during the boot
        jsr quiet
        lda KBSTATE         ; a frame that overlapped the reset leaves these set
        ora KBEXTEND
        ora KBKEYUP
        bne resync
        jmp BASICGO

; Return once the PS/2 clock has read high for 512 consecutive samples (about 4 ms).
quiet:
        ldy #2
        ldx #0
quietloop:
        lda VIAPA
        and #PS2CLK
        beq quiet
        dex
        bne quietloop
        dey
        bne quietloop
        rts

; Called in place of "BNE L40DD / INC LINNUM+1"; JSR preserves INC LINNUM's Z flag.
probepage:
        bne probeok
        inc LINNUM+1
        lda LINNUM+1
        cmp #TOPHI
        bcc probeok
        pla                 ; stop probing at $9000: drop our return address
        pla
        jmp SETTOP
probeok:
        rts
; Called in place of "LDA LINNUM / LDY LINNUM+1"; returns min(LINNUM, $9000) in A/Y.
clamptop:
        lda LINNUM
        ldy LINNUM+1
        cpy #TOPHI
        bcc clampok
        lda #0
        ldy #TOPHI
clampok:
        rts

; Called in place of RESTART's "LSR Z14 / LDA #<QT_OK", so before every prompt. While KSW
; is the ROM's KEYIN, point it at shiftkey; leave any other input routine alone. Then run
; the replaced instructions, which also leave the flags as they did.
keyhook:
        lda KSWL+1
        cmp #>KEYIN
        bne keyhookdone
        lda KSWL
        cmp #<KEYIN
        bne keyhookdone
        lda #<shiftkey
        sta KSWL
        lda #>shiftkey
        sta KSWL+1
keyhookdone:
        lsr Z14
        lda #OKLO
        rts
; RDKEY input routine: KEYIN, except that "=" read while a Shift key is down is "+".
shiftkey:
        jsr KEYIN           ; with RDKEY's A and Y
        cmp #EQUALSKEY
        bne shiftdone
        lda SHIFTL
        ora SHIFTR
        beq shiftnone
        lda #PLUSKEY
        rts
shiftnone:
        lda #EQUALSKEY
shiftdone:
        rts
`;
}

function loaderSource(guard, postload) {
  return `
NPAGES  = ${BASIC_PAGES}
LOADHI  = ${hex(BASIC_START >> 8, 2)}
READSEC = $C65C       ; Disk II PROM ReadSector, re-entered once per batch
WAIT    = $FCA8       ; monitor delay; preserves X and Y
COUT    = $FDED
ROMREAD = $C082       ; language card: read upper ROM, no write
RAM9000 = $C007       ; expose RAM at $9000-$BFFF (BASIC ROM overlay off)
POSTLOAD = ${hex(postload)}     ; spin-down wait + PS/2 resync, then BASIC (in the image)
SUMONE  = ${hex(guard[0], 2)}
SUMTWO  = ${hex(guard[1], 2)}

        .org $0800
count:  .byte 1             ; the PROM reads sectors below this number, then JMP $0801
        jmp start           ; operand becomes "resume" before the first batch

; The RAM interpreter and the ROM's OS/NMI code call each other at fixed addresses,
; so refuse to load unless upper ROM matches the ROM this disk was built from.
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
        ldx $2b
        lda $C088,x         ; drive motor off
        ldx #0
msgloop:
        lda message,x
        beq msgdone
        ora #$80
        jsr COUT
        inx
        bne msgloop
msgdone:
        brk

romok:
        lda RAM9000         ; writes to $9000-$BFFF now reach RAM
        lda #<resume
        sta $0802
        lda #>resume
        sta $0803
        lda #NPAGES
        sta $06             ; pages left
        lda #LOADHI
        sta $07             ; destination page
        stz $08             ; track
        stz $0b             ; head position in half-tracks
        lda #1
        sta $09             ; next sector; sector 0 is this loader
batch:
        sec
        lda #16
        sbc $09             ; sectors left on this track
        cmp $06
        bcc batchsize
        lda $06
batchsize:
        sta $0a
        clc
        adc $09
        sta count
        lda $09
        sta $3d             ; PROM: first sector
        stz $26             ; PROM: destination
        lda $07
        sta $27
        lda $08
        sta $41             ; PROM: track
        ldx $2b             ; PROM: slot * 16
        jmp READSEC         ; reads the batch straight into place, then JMP $0801

resume:
        sec
        lda $06
        sbc $0a
        sta $06
        beq loaded
        clc
        lda $07
        adc $0a
        sta $07
        inc $08
        stz $09
        jsr stepin
        jmp batch

loaded:
        ldx $2b
        lda $C088,x         ; drive motor off
        jmp POSTLOAD

; Move the head in one track: two half-steps, one phase energised at a time.
stepin:
        ldx #2
halfstep:
        lda $0b
        and #3
        asl
        ora $2b
        tay
        lda $C080,y         ; current phase off
        inc $0b
        lda $0b
        and #3
        asl
        ora #1
        ora $2b
        tay
        lda $C080,y         ; next phase on
        lda #$FF
        jsr WAIT
        dex
        bne halfstep
        rts

message:
        .byte $0D, "${MISMATCH_TEXT}", $0D, 0
`;
}

/**
 * Build the MS-BASIC boot disk from a 3ric ROM image (the first 64 KiB is the mapped
 * address space). Throws if the ROM's BASIC layout is not the one this tool adapts.
 */
export function buildMsBasicWoz(romBytes) {
  const rom = Uint8Array.from(romBytes);
  if (rom.length < 0x10000) throw new Error("ROM image must contain the 64 KiB mapped address space");

  if (rom[BASIC_ENTRY] !== 0x4c) throw new Error(`no JMP COLD_START at ${hex(BASIC_ENTRY)}`);
  const coldStart = rom[BASIC_ENTRY + 1] | (rom[BASIC_ENTRY + 2] << 8);
  if (coldStart < BASIC_START || coldStart >= BASIC_END)
    throw new Error(`${hex(BASIC_ENTRY)} jumps to ${hex(coldStart)}, outside BASIC ${hex(BASIC_START)}-${hex(BASIC_END - 1)}`);

  const image = rom.slice(BASIC_START, BASIC_END);
  const probes = findPattern(image, PROBE);
  if (probes.length !== 1)
    throw new Error(`expected one MEMORY SIZE probe in BASIC, found ${probes.length}`);
  const probe = probes[0];
  const branchTarget = at => at + 2 + ((image[at + 1] << 24) >> 24);
  const setTop = branchTarget(probe + 12);
  if (branchTarget(probe + 19) !== setTop || findPattern(image.subarray(setTop, setTop + 4), SET_TOP)[0] !== 0)
    throw new Error("unrecognized MEMORY SIZE exit (L40FA)");
  const messages = MESSAGE_FIXES.map(({ name, bytes, offset, after }) => {
    const hits = findPattern(image, bytes);
    if (hits.length !== 1) throw new Error(`expected one ${name} message in BASIC, found ${hits.length}`);
    return { name, site: BASIC_START + hits[0] + offset, before: bytes.slice(offset, offset + after.length), after };
  });
  const qtOk = messages.find(({ name }) => name === "QT_OK").site;
  const restarts = findPattern(image, restartCode(qtOk));
  if (restarts.length !== 1) throw new Error(`expected one RESTART prompt loop in BASIC, found ${restarts.length}`);
  const restart = restarts[0];
  const rdkeys = findPattern(rom.subarray(GUARD_START, 0x10000), RDKEY_KEYIN);
  if (rdkeys.length !== 1) throw new Error(`expected one monitor RDKEY/KEYIN in upper ROM, found ${rdkeys.length}`);
  const keyIn = GUARD_START + rdkeys[0] + 3;

  const reset = rom[0xfffc] | (rom[0xfffd] << 8);
  const resetCode = rom.subarray(reset, Math.min(reset + 0x100, 0x10000));
  if (RESET_CLEARS.some(store => findPattern(resetCode, store).length === 0))
    throw new Error(`the reset handler at ${hex(reset)} does not clear the PS/2 decoder state this disk resyncs`);

  const resident = { setTop: BASIC_START + setTop, qtOk, keyIn };
  const draft = assemble(residentSource(BASIC_END - 0x100, resident));
  const hooksOrg = BASIC_END - draft.bytes.length;
  const hooks = assemble(residentSource(hooksOrg, resident));
  if (hooks.bytes.length !== draft.bytes.length) throw new Error("hook size changed with its origin");
  const hookAt = hooksOrg - BASIC_START;
  if (image.subarray(hookAt).some(byte => byte !== 0))
    throw new Error(`${hex(hooksOrg)}-${hex(BASIC_END - 1)} is not unused (zero-filled) in this ROM`);
  if (hookAt <= Math.max(probe + PROBE.length, setTop + SET_TOP.length, restart + RESTART_STEP))
    throw new Error("hooks would overlap the patched code");

  const jsrNop = target => [0x20, target & 0xff, target >> 8, 0xea];
  const probeSite = BASIC_START + probe + PROBE_PAGE_STEP;
  const topSite = BASIC_START + setTop;
  image.set(hooks.bytes, hookAt);
  image.set(jsrNop(hooks.symbols.PROBEPAGE), probeSite - BASIC_START);
  image.set(jsrNop(hooks.symbols.CLAMPTOP), topSite - BASIC_START);
  image.set(jsrNop(hooks.symbols.KEYHOOK), restart);
  for (const { site, after } of messages) image.set(after, site - BASIC_START);

  const guard = fletcher16(rom.subarray(GUARD_START, 0x10000));
  const loaded = assemble(loaderSource(guard, hooks.symbols.POSTLOAD), { org: 0x0800 });
  if (loaded.bytes.length > 256) throw new Error(`boot loader is ${loaded.bytes.length} bytes (> 256)`);
  const loader = new Uint8Array(256);
  loader.set(loaded.bytes);

  const dsk = new Uint8Array(35 * 16 * 256);
  placeSector(dsk, 0, 0, loader);
  for (let page = 0; page < BASIC_PAGES; page++) {
    const { track, sector } = sectorForPage(page);
    placeSector(dsk, track, sector, image.subarray(page * 256, (page + 1) * 256));
  }

  const s = hooks.symbols;
  return {
    woz: buildWozFromDsk(dsk),
    image,
    loader,
    loaderSymbols: loaded.symbols,
    coldStart,
    guard,
    hooks: {
      start: hooksOrg, end: BASIC_END, postload: s.POSTLOAD, resync: s.RESYNC, quiet: s.QUIET,
      probePage: s.PROBEPAGE, clampTop: s.CLAMPTOP, keyHook: s.KEYHOOK, shiftKey: s.SHIFTKEY, keyIn,
    },
    patches: [
      { name: "probe", site: probeSite, before: [0xd0, 0x02, 0xe6, LINNUM + 1], after: jsrNop(s.PROBEPAGE) },
      { name: "top", site: topSite, before: SET_TOP, after: jsrNop(s.CLAMPTOP) },
      {
        name: "RESTART", site: BASIC_START + restart, before: restartCode(qtOk).slice(0, RESTART_STEP),
        after: jsrNop(s.KEYHOOK),
      },
      ...messages,
    ],
  };
}

function main(args) {
  const usage = "Usage: node codegen/tools/msbasic-woz.mjs <output.woz> [--rom <badger6502.bin>]";
  let romPath = DEFAULT_ROM, output = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rom" && i + 1 < args.length) romPath = args[++i];
    else if (output === null && !args[i].startsWith("--")) output = args[i];
    else throw new Error(usage);
  }
  if (output === null) throw new Error(usage);
  output = path.resolve(output);

  const rom = fs.readFileSync(romPath);
  const disk = buildMsBasicWoz(rom);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  try {
    fs.writeFileSync(output, disk.woz, { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`${output} already exists; delete it or choose another name`);
    throw error;
  }
  console.log([
    `Created ${output}`,
    `ROM ${path.resolve(romPath)} (SHA-256 ${sha256(rom)})`,
    `BASIC ${hex(BASIC_START)}-${hex(BASIC_END - 1)}, COLD_START ${hex(disk.coldStart)}, resident start-up, probe and key code ${hex(disk.hooks.start)}-${hex(BASIC_END - 1)}`,
    `Disk SHA-256 ${sha256(disk.woz)}`,
    "Contains the ROM's Microsoft BASIC: keep it local (see NOTICE).",
    'Boot on the machine running that ROM: MON (if the shell shows ">"), C600G, Return at MEMORY SIZE?',
  ].join("\n"));
}

if (typeof process !== "undefined" && process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`msbasic-woz: ${error.message}`); process.exitCode = 1; }
}
