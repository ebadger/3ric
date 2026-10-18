// Build the 3RIC SD-card edition of M.U.L.E. (Ozark Softscape / Electronic
// Arts, 1983) from the Atari 8-bit disk image.
//
//   node codegen/tools/port-mule.mjs <mule.atr> <output-dir> [--players 1|2]
//        [--level beginner|standard|tournament]
//
// Writes <output-dir>/MULE/: the loader MULE.PRG and the pieces it loads.
// Copy the folder to the card, then at the ROM DOS prompt: CD MULE,
// BRUN MULE.PRG 2000.
//
// What the port is (docs/porting-logs/mule.md has the full story): the main
// game (disk sectors 400-720, $1000-$B07F) runs on the 3RIC's 65C02 at its
// Atari addresses. Its $2000-$3FFF block moves to language-card RAM at
// $E000 so that $2000 can be the hi-res page; every absolute reference and
// every pointer source into that block (found by static disassembly and by
// tracing where pointer high bytes come from) is relocated. Hardware stores
// land in a register file of language-card RAM; the few hardware reads are
// patched to a runtime (rt.s) that supplies joysticks, console keys,
// RANDOM, VCOUNT and collisions; POKEY becomes the two AY chips; a renderer
// (render.s) redraws the Atari display list on the hi-res page; fp.s stands
// in for the Atari floating-point ROM and font.mjs for the ROM font.
//
// <handoff.bin> is $0000-$0FFF as the game's intro program leaves it for the
// main game (configuration and data at $0900-$0FFF). The intro is not yet
// ported; see the porting log.
//
// The disk image and the generated folder contain the copyrighted game;
// keep them local - this repository holds only the tool and the glue code.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildFont } from "../patches/mule/font.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const patchDir = path.join(root, "codegen", "patches", "mule");

export const FOLDER = "MULE";
export const ATR_SECTORS = 720;
export const MAIN_FIRST = 400, MAIN_LAST = 720;      // sectors of the main game
export const MAIN_ORG = 0x1000, MAIN_END = 0xb080;   // where they load
export const WIN_LO = 0x2000, WIN_HI = 0x4000, WIN_TO = 0xe000;
export const KNOWN_MAIN_SHA256 = "3004f125a75ec717b31b8183852502953c3d482b6c4327de2a23280b5e41ddcb";

// Runtime layout.
export const LAYOUT = {
  FONT: 0xc800,       // RAM2: 1 KB font in Atari character order
  RT_RAM2: 0xcc00,    // RAM2: interrupt entry, read helpers, boot stage
  RT_B2: 0xd500,      // bank 2: pads, sound, collisions
  RENDER: 0xd500,     // bank 1: renderer
  FPW: 0xd4c0,        // bank 2: floating-point scratch (40 bytes)
  RG: 0x0300,         // GTIA read mirror (32), POKEY (16), PIA (4)
  RP: 0x0320,
  RA: 0x0330,
  RTVARS: 0x0340,     // runtime variables (114 bytes)
  SPRITES: 0x0600,    // reserved for player save-unders
  T2TAB: 0x0800,      // 8 -> 7 pixel table for 40-column text
  CFG_STASH: 0x3000,  // loader staging (inside the hi-res page)
  RENDER_EVERY: 3,    // redraw every third 60 Hz tick
  TIMER_LATCH: 26222, // 1,573,437.5 Hz / 60 - 2
};

const hexList = (s) => s.trim().split(/\s+/).map((h) => parseInt(h, 16));

// Instructions whose absolute operand points into $2000-$3FFF (static
// disassembly from every traced instruction): high byte += $C0.
export const RELOC_ABS = hexList(`
2529 2532 2535 2538 253B 2546 254B 254E 2560 2569 2570 2578 257F 2587 258E 2599 25A1 25A4 25A9 25AC 25B1 25B4 25B7 25BA
25BE 25C3 25C6 25CD 25E2 25E9 25EC 25EF 25F2 25F5 25FC 2602 2608 2610 261F 2626 2629 262C 262F 2632 2635 2638 263B 263E
2643 2646 264B 2666 266C 2672 267A 2689 2690 2693 2696 2699 269C 269F 26A2 26A5 26A8 26AD 26B0 26B5 26D0 26D6 26DC 26E4
26F3 26FA 26FD 2700 2703 2706 2709 270C 270F 2712 2717 271A 271F 2743 2746 2749 274C 274F 2752 2755 2758 275D 2760 2766
276B 276E 2771 2778 277D 2782 2785 2788 2790 2793 2796 2799 279C 27A2 27A9 27AC 27B1 27B4 27BA 27BF 27C2 27C5 27CC 27D1
27D6 27D9 27DC 27E4 27E7 27EA 27ED 27F0 27F6 27F9 2800 2803 2808 280B 2811 2816 2819 281C 2823 2828 282D 2830 2833 283B
283E 2841 2844 2847 284D 2854 2857 285C 285F 2865 286A 286D 2870 2877 287C 2881 2884 2887 288F 2892 2895 2898 289B 28A1
28A8 28AE 2D03 2D08 2D0B 2D10 2D15 2D1B 2D29 2D2E 2D40 2DBC 2DDD 2E1F 2E49 2E6E 2E82 2E91 2EA0 2F52 2F75 2F7D 3004 3018
303B 304F 305F 3098 30B6 30C2 30C5 30CC 316D 326B 3270 330C 330F 331D 3325 332C 335D 3360 33E4 33E7 3445 3453 347F 34E3
34E8 34EF 34F2 34F7 3510 3552 355A 3576 35BF 3610 3629 36FF 3752 376B 3775 37CE 37D1 37E0 381D 3856 3860 3865 38D4 38DB
38DE 38E1 38E9 390E 392E 3933 3938 3963 39B1 39B9 39BC 4531 478C 4803 480F 483F 486B 4C3C 4C4E 4E8B 4EA2 4ED8 4EE4 4FCA
5A54 5A5A 5D3A 5E0A 5F91 600B 6010 6057 6387 638C 656D 66FA 672D 67D3 67E3 6AD4 6F43 6F54 6F5D 6F62 7086 71E1 7CF6 7E07
80B7 80BC 8179 8A75 8D00 8D05 8D08 8D0D 920D 9212 9269 92CD 931A 936A 936F 9461 9466 946B 946E 9474 9479 947E 9484 9489
9C2E 9C35 9C51 9C58 9E18 9EBD 9F0A A532 A8BB AD12`);

// Bytes that become the high byte of a pointer into $2000-$3FFF (string,
// table and display-list-interrupt addresses, the screen writer's base,
// which the game rewrites in its own code, and two entries of the VBI's
// jump table at $5D7E): += $C0.
export const RELOC_PTR = hexList(`
256F 257E 258D 2598 265F 26C9 2733 2CE6 2CEE 2CF6 2CFE 3083 45E5 4761 4774 4783 47AE 47F6 4864 4A3C 4AA5 4BD9 4C03 4C0F
4EF2 4EFC 5020 505D 514D 5345 58B7 59F9 59FF 5B0D 5B2E 5FDD 6045 6064 6101 6551 65C1 65ED 6670 66A1 66B4 66BB 68C5 69CC
6A4C 6A7A 6ABB 6AC7 6EB9 6EDB 6F05 6F32 71C3 7231 7240 76D7 76F6 770A 7906 7A75 7A7F 7C15 7C1F 7CA0 7CB0 8AC8 8C8E 8CBF
8D27 944B 96DF 9903 9EC5 A57A
5D83 5D9F`);

// Hardware reads (and CONSOL stores) the runtime has to answer.
export const HW_SITES = hexList(`
119A 1266 2F64 2F67 30D4 30D7 311E 3531 371C 38B9 396B 435C 436B 4391 43A5 43E2 4405 4AEB 5837 5840 5848 5BFB 5C34 5C3C
5C4B 5C66 5CA9 5CB0 5DDA 5DF5 5DF8 5E03 5E1B 5E22 6C49 6E7B 7244 728A 7655 7667 766C 7C84 80A1 8BD6 8BE1 8C11 8CE0 8CF1
8CF9 A43D A4D6 AC57 ACDF ADAD AE1E AE3B`);

export const FONT_READS = [[0x59b3, 0xbd, 0xe000], [0x5a95, 0xb9, 0xe028]]; // LDA $E000,X / LDA $E028,Y
export const SETVBV_CALL = 0x42f5;                                             // JSR $E45C
// Strings (high-bit characters, the last one with bit 7 clear) that start in
// the moved block but end past $3FFF: copied whole and repointed. Each entry
// is the LDY #high operand of an "LDA #low / LDY #high" pair.
export const MOVED_STRINGS = [0x8c8e];

/** Sector n (1-based) of an ATR image. */
export function readAtr(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] !== 0x96 || b[1] !== 0x02) throw new Error("not an ATR disk image");
  const secSize = b[4] | (b[5] << 8);
  if (secSize !== 128) throw new Error(`unsupported ATR sector size ${secSize}`);
  const paras = b[2] | (b[3] << 8) | (b[6] << 16);
  const sectors = (paras * 16) / 128;
  if (sectors < ATR_SECTORS || b.length < 16 + ATR_SECTORS * 128) throw new Error(`ATR too small (${sectors} sectors)`);
  return (n) => b.subarray(16 + (n - 1) * 128, 16 + n * 128);
}

/** The main game as the intro's loader leaves it at $1000-$B07F. */
export function mainImage(atrBytes) {
  const sector = readAtr(atrBytes);
  const mem = new Uint8Array(0x10000);
  for (let s = MAIN_FIRST; s <= MAIN_LAST; s++) mem.set(sector(s), MAIN_ORG + (s - MAIN_FIRST) * 128);
  return mem;
}

const sha256 = (u8) => crypto.createHash("sha256").update(u8).digest("hex");
const h4 = (v) => "$" + v.toString(16).toUpperCase().padStart(4, "0");

/** Assemble sources into a 64 KB image, returning symbols and touched ranges. */
export function assembleInto(mem, source, label) {
  let r;
  try { r = assemble(source); } catch (e) { throw new Error(`${label}: ${e.message}`); }
  const used = [];
  for (const L of r.listing) {
    for (let k = 0; k < L.bytes.length; k++) mem[(L.pc + k) & 0xffff] = L.bytes[k] & 0xff;
    if (L.bytes.length) used.push([L.pc, L.pc + L.bytes.length]);
  }
  return { symbols: r.symbols, used };
}

const equ = (o) => Object.entries(o).map(([k, v]) => `${k} = ${v}`).join("\n") + "\n";
const src = (name) => fs.readFileSync(path.join(patchDir, name), "utf8");

/** 8 Atari pixels -> 7 hi-res pixels (bit 0 leftmost); the last two merge. */
export function t2Table() {
  const t = new Uint8Array(256);
  for (let g = 0; g < 256; g++) {
    let v = 0;
    for (let k = 0; k < 6; k++) if (g & (0x80 >> k)) v |= 1 << k;
    if (g & 0x03) v |= 0x40;
    t[g] = v;
  }
  return t;
}

/** Assemble the runtime: bank 2, bank 1, RAM2 and the low pages. */
export function buildRuntime() {
  const L = LAYOUT;
  const b2 = new Uint8Array(0x10000), b1 = new Uint8Array(0x10000), shared = new Uint8Array(0x10000);
  // rt.s spans RAM2 (shared) and bank 2: assemble once, split by address.
  const rtEq = equ({ RT_RAM2: L.RT_RAM2, RT_B2: L.RT_B2, FONT: L.FONT, RENDER: L.RENDER, RENDER_EVERY: L.RENDER_EVERY,
    TIMER_LATCH: L.TIMER_LATCH, RG: L.RG, RP: L.RP, RA: L.RA, RTVARS: L.RTVARS, CFG_STASH: L.CFG_STASH });
  const tmp = new Uint8Array(0x10000);
  const rt = assembleInto(tmp, rtEq + src("rt.s"), "rt.s");
  const S = rt.symbols;
  shared.set(tmp.subarray(L.RT_RAM2, 0xd000), L.RT_RAM2);
  b2.set(tmp.subarray(L.RT_B2, 0xe000), L.RT_B2);
  if (S.RT_RAM2_END > 0xd000) throw new Error(`rt.s RAM2 part overflows (${h4(S.RT_RAM2_END)})`);
  if (S.RT_B2_END > 0xd8e6) throw new Error(`rt.s bank-2 part runs into the FP stubs (${h4(S.RT_B2_END)})`);
  if (S.RTVARS_END > L.SPRITES - 0x200 + 0x100 && S.RTVARS_END > 0x0400) throw new Error("runtime variables overflow page 3");
  const fp = assembleInto(b2, equ({ FPW: L.FPW }) + src("fp.s"), "fp.s");
  const F = fp.symbols;
  for (const [a, e, lim, name] of [[F.FP_A, F.FP_A_END, 0xdd89, "A"], [F.FP_B, F.FP_END, 0xdfff, "B"], [F.FP_C, F.FP_C_END, 0xd200, "C"],
    [F.FP_D, F.FP_D_END, 0xda60, "D"], [F.FP_E, F.FP_E_END, 0xd9aa, "E"]]) {
    if (e > lim) throw new Error(`fp.s chunk ${name} ${h4(a)}-${h4(e)} passes ${h4(lim)}`);
  }
  const rd = assembleInto(b1, equ({ RENDER: L.RENDER, FONT: L.FONT, T2TAB: L.T2TAB, SPRITES: L.SPRITES, SNAP_G: S.SNAP_G, SNAP_A: S.SNAP_A,
    VC_FAKE: S.VC_FAKE }) + src("render.s"), "render.s");
  if (rd.symbols.RENDER_END > 0xdfff) throw new Error(`render.s overflows bank 1 (${h4(rd.symbols.RENDER_END)})`);
  b1[0xdfff] = 0xa5;                 // bank signatures
  b2[0xdfff] = 0x5a;
  shared.set(buildFont(), L.FONT);
  shared.set(t2Table(), L.T2TAB);
  // static read-mirror values: POT0-7 = 228 (no paddles), SKSTAT idle,
  // PAL = NTSC, triggers up, sticks centred, console keys up
  for (let i = 0; i < 8; i++) shared[L.RP + i] = 228;
  shared[L.RP + 0x0f] = 0xff;
  shared[L.RG + 0x14] = 0x0f;
  for (let i = 0x10; i < 0x14; i++) shared[L.RG + i] = 1;
  shared[L.RG + 0x1f] = 0x07;
  shared[L.RA] = 0xff;
  shared[L.RA + 1] = 0xff;
  return { b1, b2, shared, rt: S, fp: F, render: rd.symbols };
}

/**
 * Patch and relocate the main game. Returns the 64 KB image with the window
 * already copied to $E000 (and cleared at $2000).
 */
export function buildGame(mem0, rt, { allowUnknown = false, strArea = 0, strLimit = 0 } = {}) {
  const mem = new Uint8Array(mem0);
  const hash = sha256(mem.subarray(MAIN_ORG, MAIN_END));
  const known = hash === KNOWN_MAIN_SHA256;
  if (!known && !allowUnknown) throw new Error(`unrecognised M.U.L.E. release (main image SHA-256 ${hash})`);
  const L = LAYOUT;
  const expect = (a, bytes, what) => {
    for (let i = 0; i < bytes.length; i++)
      if (bytes[i] !== null && mem[a + i] !== bytes[i]) throw new Error(`${what} at ${h4(a)}: unexpected bytes`);
  };
  const inWin = (v) => v >= WIN_LO >> 8 && v < WIN_HI >> 8;
  for (const a of RELOC_ABS) {
    if (!inWin(mem[a + 2])) throw new Error(`relocation ${h4(a)}: operand not in $2000-$3FFF`);
    mem[a + 2] += (WIN_TO - WIN_LO) >> 8;
  }
  for (const a of RELOC_PTR) {
    if (!inWin(mem[a])) throw new Error(`pointer source ${h4(a)}: not a $20-$3F high byte`);
    mem[a] += (WIN_TO - WIN_LO) >> 8;
  }
  // strings that run past the end of the block get a contiguous copy
  const moved = [];
  let sp = strArea;
  for (const a of MOVED_STRINGS) {
    if (mem[a - 3] !== 0xa9 || mem[a - 1] !== 0xa0) throw new Error(`moved string ${h4(a)}: not LDA #lo / LDY #hi`);
    const start = ((mem[a] - ((WIN_TO - WIN_LO) >> 8)) << 8) | mem[a - 2];
    let end = start;
    while (mem[end] & 0x80) end++;
    if (start >= WIN_HI || end < WIN_HI) throw new Error(`moved string ${h4(a)}: does not cross ${h4(WIN_HI)}`);
    const bytes = mem.slice(start, end + 1);
    if (sp + bytes.length > strLimit) throw new Error("no room for moved strings");
    moved.push({ addr: sp, bytes });
    mem[a - 2] = sp & 0xff; mem[a] = sp >> 8;
    mem.fill(0, start, WIN_HI);       // its old start is free (the vectors go there)
    sp += bytes.length;
  }
  const jsr = (a, target) => { mem[a] = 0x20; mem[a + 1] = target & 0xff; mem[a + 2] = target >> 8; };
  const retarget = (a, target) => { mem[a + 1] = target & 0xff; mem[a + 2] = target >> 8; };
  for (const a of HW_SITES) {
    const op = mem[a], t = mem[a + 1] | (mem[a + 2] << 8);
    if (t === 0xd20a) {
      const h = { 0xad: rt.RND_A, 0xac: rt.RND_Y, 0x2c: rt.RND_BIT, 0x2d: rt.RND_AND }[op];
      if (!h) throw new Error(`RANDOM read at ${h4(a)}: opcode $${op.toString(16)}`);
      jsr(a, h);
    } else if (t === 0xd40b) {
      const h = { 0xad: rt.VC_LDA, 0xac: rt.VC_LDY, 0xcd: rt.VC_CMP, 0xcc: rt.VC_CPY }[op];
      if (!h) throw new Error(`VCOUNT read at ${h4(a)}: opcode $${op.toString(16)}`);
      jsr(a, h);
    } else if (t === 0xd01f && (op === 0x8d || op === 0x8e)) {
      jsr(a, op === 0x8d ? rt.SPK_A : rt.SPK_X);
    } else if (![0xad, 0xbd, 0xb9].includes(op)) {
      throw new Error(`hardware read at ${h4(a)}: opcode $${op.toString(16)}`);
    } else if (t >= 0xd000 && t < 0xd020) {
      retarget(a, L.RG + (t & 0x1f));
    } else if (t === 0xd2fc && op === 0xb9) {
      retarget(a, L.RA - 4);         // LDA $D2FC,Y with Y = 4/5: PORTA/PORTB
    } else if (t >= 0xd200 && t < 0xd210) {
      retarget(a, L.RP + (t & 0x0f));
    } else if (t >= 0xd300 && t < 0xd304) {
      retarget(a, L.RA + (t & 0x03));
    } else {
      throw new Error(`hardware read at ${h4(a)}: ${h4(t)}`);
    }
  }
  for (const [a, op, t] of FONT_READS) {
    expect(a, [op, t & 0xff, t >> 8], "font read");
    retarget(a, L.FONT + (t - 0xe000));
  }
  expect(SETVBV_CALL, [0x20, 0x5c, 0xe4], "SETVBV call");
  retarget(SETVBV_CALL, rt.SETVBV);
  // the window moves; $2000-$3FFF becomes the hi-res page
  mem.copyWithin(WIN_TO, WIN_LO, WIN_HI);
  mem.fill(0, WIN_LO, WIN_HI);
  for (const [off, v] of [[0xfffa, rt.NMI_ENTRY], [0xfffc, rt.RESET_ENTRY], [0xfffe, rt.IRQ_ENTRY]]) {
    if (mem[off] | mem[off + 1]) throw new Error(`vector ${h4(off)} would overwrite game data`);
    mem[off] = v & 0xff; mem[off + 1] = v >> 8;
  }
  return { mem, known, hash, moved };
}

const PIECES = [
  // name, file contents, staging/load address
  ["WIN.BIN", (g) => g.mem.subarray(0xe000, 0x10000), 0x4000],
  ["RTB2.BIN", (g, r) => r.b2.subarray(0xd000, 0xe000), 0x4000],
  ["RTB1.BIN", (g, r) => r.b1.subarray(0xd000, 0xe000), 0x4000],
  ["RAM2.BIN", (g, r) => r.shared.subarray(0xc800, 0xd000), 0x2400],
  ["LOW.BIN", (g, r) => Uint8Array.from([...r.shared.subarray(0x0300, 0x0400), ...r.shared.subarray(0x0600, 0x0900)]), 0x2c00],
  ["CFG.BIN", (g, r, cfg) => cfg, LAYOUT.CFG_STASH],
  ["G1.BIN", (g) => g.mem.subarray(0x1000, 0x2000), 0x1000],
  ["G2.BIN", (g) => g.mem.subarray(0x4000, MAIN_END), 0x4000],
];

/** Assemble the loader with its FLOAD table. */
export function buildLoader(files, rt) {
  let cmds = "", offs = [], los = [], his = [], vals = [];
  for (const { name, data, addr } of files) {
    offs.push(cmds.length);
    const end = data.length - 1;
    cmds += `FLOAD ${name} ${addr.toString(16).toUpperCase().padStart(4, "0")} 0000 ${end.toString(16).toUpperCase().padStart(4, "0")}\0`;
    const last = addr + end;
    los.push(last & 0xff); his.push(last >> 8); vals.push(data[end]);
  }
  const bytes = (a) => a.map((v) => "$" + v.toString(16).padStart(2, "0")).join(",");
  const tables = `NPIECES = ${files.length}\n` +
    `cmd_off: .byte ${bytes(offs)}\nlast_lo: .byte ${bytes(los)}\nlast_hi: .byte ${bytes(his)}\nlast_val: .byte ${bytes(vals)}\n` +
    `cmds: .byte ${bytes([...cmds].map((c) => c.charCodeAt(0)))}\n`;
  const mem = new Uint8Array(0x10000);
  const r = assembleInto(mem, `BOOT_FINAL = ${rt.BOOT_FINAL}\n` + src("loader.s") + tables, "loader.s");
  const end = Math.max(...r.used.map(([, e]) => e));
  if (end > 0x2400) throw new Error(`loader runs into its staging area (${h4(end)})`);
  return mem.slice(0x2000, end);
}

/** Convert: returns { files: {name: Uint8Array}, known, hash }. */
export function convert(atrBytes, handoff, opts = {}) {
  if (!handoff || handoff.length !== 0x1000) throw new Error("handoff image must be 4096 bytes ($0000-$0FFF)");
  const rt = buildRuntime();
  const game = buildGame(mainImage(atrBytes), rt.rt, { ...opts, strArea: rt.rt.RT_RAM2_END, strLimit: 0xd000 });
  for (const m of game.moved) rt.shared.set(m.bytes, m.addr);
  const files = PIECES.map(([name, f, addr]) => ({ name, data: new Uint8Array(f(game, rt, handoff)), addr }));
  const loader = buildLoader(files, rt.rt);
  const out = { "MULE.PRG": loader };
  for (const f of files) out[f.name] = f.data;
  return { files: out, known: game.known, hash: game.hash, rt };
}

async function main(argv) {
  const opts = { players: 2, level: "BEGINNER", handoff: null };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--players") opts.players = +argv[++i];
    else if (argv[i] === "--level") opts.level = String(argv[++i]).toUpperCase();
    else if (argv[i] === "--handoff") opts.handoff = argv[++i];
    else pos.push(argv[i]);
  }
  if (pos.length !== 2) {
    console.error("usage: node codegen/tools/port-mule.mjs <mule.atr> <output-dir> [--players 1|2] [--level beginner|standard|tournament]");
    process.exit(2);
  }
  const [atrPath, outDir] = pos;
  const atr = fs.readFileSync(atrPath);
  let handoff;
  if (opts.handoff) handoff = fs.readFileSync(opts.handoff);
  else {
    const { runIntro } = await import("./mule-intro.mjs");
    console.log(`running the intro: ${opts.players} player(s), ${opts.level}`);
    handoff = runIntro(atr, { players: opts.players, level: opts.level });
  }
  const r = convert(atr, handoff);
  if (!r.known) console.warn(`warning: unrecognised release (SHA-256 ${r.hash})`);
  const dir = path.join(outDir, FOLDER);
  if (fs.existsSync(dir)) { console.error(`${dir} exists; remove it first`); process.exit(1); }
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(r.files)) fs.writeFileSync(path.join(dir, name), data);
  console.log(`wrote ${dir}: ${Object.keys(r.files).join(", ")}`);
  console.log(`then on the 3RIC: CD ${FOLDER}, BRUN MULE.PRG 2000`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
