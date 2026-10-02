import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";
import { buildBootableWoz } from "./wozgen.mjs";

export const INPUT_SHA256 = "9ecfe3eb8780f78d91e1460fac471b3d13d85788274a5281f92162a9605f586c";
export const ROM_SHA256 = "fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const hex = value => "$" + value.toString(16);

export function readQuarxDisk(input) {
  if (input.length !== 143360 || sha256(input) !== INPUT_SHA256)
    throw new Error(`Unsupported Quarx disk; expected the v1.00 shareware .po, SHA-256 ${INPUT_SHA256}`);
  const disk = Buffer.from(input), files = new Map();
  function directory(first, prefix = "") {
    const seen = new Set();
    for (let block = first; block; block = disk.readUInt16LE(block * 512 + 2)) {
      if (block >= 280 || seen.has(block)) throw new Error("Invalid ProDOS directory chain");
      seen.add(block);
      for (let offset = 4; offset + 39 <= 512; offset += 39) {
        const p = block * 512 + offset, storage = disk[p] >> 4;
        if (!storage || storage >= 14) continue;
        const name = prefix + disk.toString("ascii", p + 1, p + 1 + (disk[p] & 15));
        const key = disk.readUInt16LE(p + 17), size = disk.readUIntLE(p + 21, 3);
        if (storage === 13) { directory(key, name + "/"); continue; }
        if (storage !== 1 && storage !== 2) throw new Error(`Unsupported ProDOS storage for ${name}`);
        const contents = Buffer.alloc(size);
        for (let n = 0; n < Math.ceil(size / 512); n++) {
          const data = storage === 1 ? key : disk[key * 512 + n] | disk[key * 512 + 256 + n] << 8;
          if (data >= 280) throw new Error(`Invalid ProDOS block in ${name}`);
          if (data) disk.copy(contents, n * 512, data * 512, Math.min(data * 512 + 512, data * 512 + size - n * 512));
        }
        files.set(name, contents);
      }
    }
  }
  directory(2);
  return files;
}

// Raw LZSA2 format: https://github.com/emmanuel-marty/lzsa/blob/master/BlockFormat_LZSA2.md
export function decodeLzsa2(input, limit = 65536) {
  let pos = 0, pending = -1, offset;
  const output = [];
  const byte = () => {
    if (pos >= input.length) throw new Error("Truncated LZSA2 stream");
    return input[pos++];
  };
  const nibble = () => {
    if (pending >= 0) { const result = pending; pending = -1; return result; }
    const value = byte(); pending = value & 15; return value >> 4;
  };
  const length = (base, extension, endMarker) => {
    if (base !== extension) return base;
    const extra = nibble();
    if (extra !== 15) return base + extra;
    const value = byte(), sum = base + 15 + value;
    if (sum < 256) return sum;
    if (endMarker && sum === 256) return -1;
    if (sum !== 257) throw new Error("Invalid LZSA2 extended length");
    return byte() | byte() << 8;
  };
  const append = value => {
    if (output.length >= limit) throw new Error("LZSA2 output exceeds its destination");
    output.push(value);
  };
  while (true) {
    const token = byte(), literals = length((token >> 3) & 3, 3, false);
    for (let n = 0; n < literals; n++) append(byte());
    const inverted = (token & 0x20) ? 0 : 1;
    switch (token >> 6) {
      case 0: offset = 0xffe0 | nibble() << 1 | inverted; break;
      case 1: offset = 0xfe00 | inverted << 8 | byte(); break;
      case 2: offset = ((0xe000 | nibble() << 9 | inverted << 8 | byte()) - 512) & 65535; break;
      case 3: if (!(token & 0x20)) offset = byte() << 8 | byte(); break;
    }
    const count = length((token & 7) + 2, 9, true);
    if (count === -1) {
      if (pos !== input.length) throw new Error("Trailing bytes after LZSA2 end marker");
      return Uint8Array.from(output);
    }
    if (offset === undefined || offset < 0x8000 || output.length + offset - 65536 < 0)
      throw new Error("Invalid LZSA2 back-reference");
    for (let n = 0; n < count; n++) append(output[output.length + offset - 65536]);
  }
}

export function encodeLzsa2(bytes) {
  const out = [], positions = new Map();
  let nibblePosition = -1, anchor = 0, pos = 0, lastDistance = 0;
  const nibble = value => {
    if (nibblePosition < 0) { nibblePosition = out.length; out.push(value << 4); }
    else { out[nibblePosition] |= value; nibblePosition = -1; }
  };
  const extraLength = (value, base) => {
    if (value < base) return;
    nibble(Math.min(15, value - base));
    if (value < base + 15) return;
    if (value < 256) out.push(value - base - 15);
    else out.push(257 - base - 15, value & 255, value >> 8);
  };
  const key = p => bytes[p] | bytes[p + 1] << 8 | bytes[p + 2] << 16;
  const remember = p => {
    if (p + 2 >= bytes.length) return;
    const k = key(p), list = positions.get(k) || [];
    list.push(p);
    if (list.length > 64) list.shift();
    positions.set(k, list);
  };
  const emit = (end, distance, match) => {
    const literals = end - anchor;
    const offset = 65536 - distance;
    let mode = 0x40;
    if (match) {
      if (distance === lastDistance) mode = 0xe0;
      else if (distance <= 32) mode = ((~offset) & 1) << 5;
      else if (distance <= 512) mode = 0x40 | ((~(offset >> 8)) & 1) << 5;
      else if (distance <= 8704) mode = 0x80 | ((~((offset + 512) >> 8)) & 1) << 5;
      else mode = 0xc0;
    }
    out.push(mode | Math.min(literals, 3) << 3 | (match ? Math.min(match - 2, 7) : 7));
    extraLength(literals, 3);
    for (let p = anchor; p < end; p++) out.push(bytes[p]);
    if (match) {
      if (mode < 0x40) nibble((offset >> 1) & 15);
      else if (mode < 0x80) out.push(offset & 255);
      else if (mode < 0xc0) { nibble(((offset + 512) >> 9) & 15); out.push(offset & 255); }
      else if (mode === 0xc0) out.push(offset >> 8, offset & 255);
      lastDistance = distance;
      extraLength(match, 9);
    } else { out.push(0); nibble(15); out.push(232); }
  };
  while (pos + 3 < bytes.length) {
    let best = 0, distance = 0;
    const candidates = positions.get(key(pos)) || [];
    for (let i = candidates.length - 1; i >= 0; i--) {
      const previous = candidates[i], d = pos - previous;
      if (d > 32768) continue;
      let count = 0;
      while (pos + count < bytes.length && bytes[previous + count] === bytes[pos + count]) count++;
      if (count > best) { best = count; distance = d; }
      if (pos + best === bytes.length) break;
    }
    if (best >= 4 || (best >= 3 && distance <= 8704)) {
      emit(pos, distance, best);
      const end = pos + best;
      while (pos < end) remember(pos++);
      anchor = pos;
    } else remember(pos++);
  }
  emit(bytes.length, 0, 0);
  return Uint8Array.from(out);
}

const DHR_RGB = [
  [0, 0, 0], [0, 0, 153], [0, 119, 34], [34, 85, 255],
  [136, 85, 0], [85, 85, 85], [17, 221, 0], [0, 238, 153],
  [221, 0, 51], [221, 34, 221], [170, 170, 170], [102, 170, 255],
  [255, 102, 0], [255, 153, 170], [255, 238, 0], [255, 255, 255],
];
const HGR_RGB = [
  [[0, 0, 0], [255, 61, 255], [67, 255, 0], [255, 255, 255]],
  [[0, 0, 0], [16, 255, 255], [255, 93, 21], [255, 255, 255]],
];
const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const nearest = DHR_RGB.map(rgb => HGR_RGB.map(palette => {
  const errors = palette.map(color => distance(rgb, color));
  // Preserve dark green contours instead of erasing them against the black field.
  if (rgb[1] > rgb[0] && rgb[1] > rgb[2]) errors[0] = Infinity;
  return { bits: errors.indexOf(Math.min(...errors)), error: Math.min(...errors) };
}));

export function convertDhrRow(aux, main) {
  if (aux.length !== main.length || aux.length % 2) throw new Error("DHR rows must contain an even number of byte pairs");
  const colors = [], bits = [];
  for (let i = 0; i < aux.length; i++) for (const value of [aux[i], main[i]])
    for (let n = 0; n < 7; n++) bits.push((value >> n) & 1);
  for (let n = 0; n < bits.length; n += 4)
    colors.push(bits[n] | bits[n + 1] << 1 | bits[n + 2] << 2 | bits[n + 3] << 3);
  const result = new Uint8Array(main.length);
  for (let col = 0; col < result.length; col++) {
    const alternatives = [0, 1].map(phase => {
      let error = 0, value = phase << 7;
      for (let bit = 0; bit < 7; bit++) {
        const x = col * 7 + bit, color = nearest[colors[x >> 1]][phase];
        error += color.error;
        value |= ((color.bits >> (x & 1)) & 1) << bit;
      }
      return { error, value };
    });
    result[col] = alternatives[1].error < alternatives[0].error ? alternatives[1].value : alternatives[0].value;
  }
  return result;
}

export const scanline = y => (y & 7) * 1024 + ((y >> 3) & 7) * 128 + (y >> 6) * 40;
function convertScreen(aux, main) {
  const result = new Uint8Array(8192);
  for (let y = 0; y < 192; y++) {
    const p = scanline(y);
    result.set(convertDhrRow(aux.subarray(p, p + 40), main.subarray(p, p + 40)), p);
  }
  return result;
}

function patchWord(bytes, p, value) { bytes[p] = value & 255; bytes[p + 1] = value >> 8; }

export function buildPhysicalProgram(image, entry) {
  if (image.length !== 0xc000) throw new Error("Expected the complete 48 KiB lower-memory image");
  const packed = [];
  let pos = 0x900;
  const runLength = p => {
    let count = 1;
    while (count < 130 && p + count < image.length && image[p + count] === image[p]) count++;
    return count;
  };
  while (pos < image.length) {
    const run = runLength(pos);
    if (run >= 3) { packed.push(image[pos], 0x80 | (run - 3)); pos += run; }
    else {
      const start = pos++;
      while (pos < image.length && pos - start < 128 && runLength(pos) < 3) pos++;
      for (let p = start; p < pos; p++) packed.push(image[p]);
      packed.push(pos - start - 1);
    }
  }
  let source = packed.length - 1, destination = 0xbfff;
  while (source >= 0) {
    const control = packed[source--], repeat = (control & 128) !== 0;
    const count = repeat ? (control & 127) + 3 : control + 1;
    if (repeat) source--;
    for (let n = 0; n < count; n++) {
      if (!repeat) source--;
      if (destination >= 0x803 && destination <= 0x803 + source)
        throw new Error("Packed program would overwrite unread loader input");
      destination--;
    }
  }
  if (destination !== 0x8ff || source !== -1) throw new Error("Invalid packed program geometry");
  const decoder = assemble(`
        .org $0200
        sei
        cld
        ldx #$FF
        txs
        bit $C007
        bit $C082
        lda #${hex((0x803 + packed.length - 1) & 255)}
        sta $50
        lda #${hex((0x803 + packed.length - 1) >> 8)}
        sta $51
        lda #$FF
        sta $52
        lda #$BF
        sta $53
packet:
        jsr read_byte
        bmi repeat
        tax
        inx
literal:
        jsr read_byte
        jsr write_byte
        dex
        bne literal
        bra next_packet
repeat:
        and #$7F
        clc
        adc #3
        tax
        jsr read_byte
        sta $54
repeat_byte:
        lda $54
        jsr write_byte
        dex
        bne repeat_byte
next_packet:
        lda $53
        cmp #9
        bcs packet
        ldx #0
        lda #0
clear_header:
        sta $0800,x
        inx
        bne clear_header
        lda #$4C
        sta $0800
        lda #${hex(entry & 255)}
        sta $0801
        lda #${hex(entry >> 8)}
        sta $0802
        jmp ${hex(entry)}
read_byte:
        lda ($50)
        ldy $50
        bne read_low
        dec $51
read_low:
        dec $50
        ora #0
        rts
write_byte:
        sta ($52)
        ldy $52
        bne write_low
        dec $53
write_low:
        dec $52
        rts
`);
  if (decoder.bytes.length > 256) throw new Error("Physical decoder exceeds its temporary page");
  const launcher = assemble(`
        .org ${hex(0x803 + packed.length)}
        ldx #${decoder.bytes.length - 1}
copy:
        lda decoder,x
        sta $0200,x
        dex
        cpx #$FF
        bne copy
        jmp $0200
decoder:
        .byte ${Array.from(decoder.bytes, hex).join(",")}
`);
  const program = new Uint8Array(3 + packed.length + launcher.bytes.length);
  program[0] = 0x4c; patchWord(program, 1, launcher.org);
  program.set(packed, 3); program.set(launcher.bytes, 3 + packed.length);
  return program;
}

function replaceCalls(bytes, org, replacements) {
  const changes = [];
  for (let p = 0; p + 2 < bytes.length; p++) {
    if (bytes[p] !== 0x20 && bytes[p] !== 0x4c) continue;
    const before = bytes[p + 1] | bytes[p + 2] << 8;
    if (!replacements.has(before)) continue;
    const after = replacements.get(before);
    patchWord(bytes, p + 1, after);
    changes.push({ address: org + p, before, after });
    p += 2;
  }
  return changes;
}

const instructionSizes = new Map([
  ["00 08 0a 18 1a 28 2a 38 3a 40 48 4a 58 5a 60 68 6a 78 7a 88 8a 98 9a a8 aa b8 ba c8 ca cb d8 da db e8 ea f8 fa", 1],
  ["01 04 05 06 09 10 11 12 14 15 16 21 24 25 26 29 30 31 32 34 35 36 41 45 46 49 50 51 52 55 56 61 64 65 66 69 70 71 72 74 75 76 80 81 84 85 86 89 90 91 92 94 95 96 a0 a1 a2 a4 a5 a6 a9 b0 b1 b2 b4 b5 b6 c0 c1 c4 c5 c6 c9 d0 d1 d2 d5 d6 e0 e1 e4 e5 e6 e9 f0 f1 f2 f5 f6", 2],
  ["0c 0d 0e 19 1c 1d 1e 20 2c 2d 2e 39 3c 3d 3e 4c 4d 4e 59 5d 5e 6c 6d 6e 79 7c 7d 7e 8c 8d 8e 99 9c 9d 9e ac ad ae b9 bc bd be cc cd ce d9 dd de ec ed ee f9 fd fe", 3],
].flatMap(([codes, size]) => codes.split(" ").map(code => [parseInt(code, 16), size])));

function walkInstructions(bytes, ranges, visit) {
  for (const [start, end] of ranges) {
    for (let p = start; p < end;) {
      const size = instructionSizes.get(bytes[p]);
      if (!size || p + size > end) throw new Error(`Unexpected instruction boundary at +${hex(p)}`);
      visit(p, size);
      p += size;
    }
  }
}

function relocateMenu(menu, symbols) {
  const delta = symbols.MENU - 0xda00;
  walkInstructions(menu, [[0, 15], [0x5a, 0x435]], (p, size) => {
    if (size !== 3) return;
    const address = menu[p + 1] | menu[p + 2] << 8;
    if (address >= 0xda00 && address < 0xe000) patchWord(menu, p + 1, address + delta);
    else if (address >= 0xf7ff && address < 0xf980) patchWord(menu, p + 1, address + symbols.ROW_LO - 0xf800);
    if (address === 0xc005 || address === 0xc004) menu.fill(0xea, p, p + 3);
  });
  for (const p of [0x1d8, 0x1eb, 0x1fe]) {
    if (menu[p] !== 0xde) throw new Error("Unexpected menu string pointer");
    menu[p] = (0xde00 + delta) >> 8;
  }
  for (const [low, high, count] of [[0x493, 0x498, 5], [0x49d, 0x4a2, 5], [0x5dd, 0x5e3, 6], [0x5e9, 0x5ef, 6]]) {
    for (let n = 0; n < count; n++) {
      const address = (menu[low + n] | menu[high + n] << 8) + delta;
      menu[low + n] = address & 255; menu[high + n] = address >> 8;
    }
  }
}

function relocatePlayer(original, symbols) {
  const player = original.slice(0, 0xee0), delta = symbols.MUSIC - 0x0f00;
  walkInstructions(player, [[0x1da, 0xa84], [0xc44, 0xe06], [0xe7e, 0xee0]], (p, size) => {
    if (size !== 3) return;
    const address = player[p + 1] | player[p + 2] << 8;
    if (address >= 0xf00 && address < 0x1de0) patchWord(player, p + 1, address + delta);
    else if (address >= 0xb000 && address < 0xb100)
      patchWord(player, p + 1, address + symbols.SONG_BUFFER - 0xb000);
  });
  for (const address of [0x1bce, 0x1bf2, 0x1c35, 0x1cdf]) player[address - 0xf00] += delta >> 8;
  for (const address of [0x10ee, 0x111c, 0x15cf, 0x15db, 0x15e9, 0x15f7])
    player[address - 0xf00] = symbols.SONG_BUFFER >> 8;
  for (const address of [0x17fd, 0x1cb8]) {
    player[address - 0xf00] = 0x60;
    player.fill(0xea, address - 0xeff, address - 0xefd);
  }
  player[0x17ce - 0xf00] = 0x20;
  patchWord(player, 0x17cf - 0xf00, symbols.MUSIC_WRITE);
  return player;
}

export function buildQuarx(input, rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"))) {
  const files = readQuarxDisk(input);
  if (sha256(rom) !== ROM_SHA256) throw new Error(`Unsupported 3RIC ROM; expected SHA-256 ${ROM_SHA256}`);
  const raw = name => decodeLzsa2(files.get(name));
  const game = raw("A2QUARX.LZ"), menu = Uint8Array.from(files.get("MAINMENU"));
  const font = raw("DATA/FONT.LZ"), shapes = raw("DATA/SHAPES1.LZ"), shapes2 = raw("DATA/SHAPES2.LZ");
  const title = convertScreen(raw("DATA/TITLE1.LZ"), raw("DATA/TITLE2.LZ"));
  const background = convertScreen(raw("DATA/BACKGROUND1.LZ"), raw("DATA/BACKGROUND2.LZ"));
  const titlePacked = encodeLzsa2(title), backgroundPacked = encodeLzsa2(background);
  const image = new Uint8Array(0xc000);
  const symbols = {
    MUSIC: 0x6600, TITLE_DATA: 0x7500, MENU: 0x8b00, ROW_LO: 0x9100,
    ROW_HI: 0x91c0, FONT: 0x9300, TILES: 0x9680, HIGH_SCORES: 0x9a70,
    BACKGROUND_DATA: 0x9b80, SONG1: 0xa5d0, SONG_BUFFER: 0xb100,
    DECOMP: 0x1d00, SHAREWARE: 0x1e00, MUSIC_PERIOD: 25642,
  };
  const songs = [1, 2, 3].map(n => files.get(`MUSIC/SONG${n}.LZ`));
  symbols.SONG2 = symbols.SONG1 + songs[0].length;
  symbols.SONG3 = symbols.SONG2 + songs[1].length;
  if (titlePacked.length > symbols.MENU - symbols.TITLE_DATA
      || backgroundPacked.length > symbols.SONG1 - symbols.BACKGROUND_DATA
      || symbols.SONG3 + songs[2].length > symbols.SONG_BUFFER
      || songs.some(song => decodeLzsa2(song).length > 0xc000 - symbols.SONG_BUFFER))
    throw new Error("Converted assets exceed the physical RAM reservations");
  image.set(font.subarray(0, 384), symbols.ROW_LO);
  for (let c = 32; c <= 110; c++) for (let row = 0; row < 7; row++) {
    const aux = font[0x36d + c + row * 79] & 127, main = font[0x596 + c + row * 79] & 127;
    const bits = aux | main << 7;
    let value = 0;
    for (let x = 0; x < 7; x++) if ((bits >> (x * 2)) & 3) value |= 1 << x;
    image[symbols.FONT + row * 128 + c] = value;
  }
  const tiles = [];
  for (let n = 0; n < 18; n++) {
    const source = n < 12 ? shapes : shapes2;
    const p = n < 12 ? (shapes[n] | shapes[24 + n] << 8) - 0x400 : 0x6c + (n - 12) * 112;
    const tile = new Uint8Array(56);
    for (let row = 0; row < 14; row++)
      tile.set(convertDhrRow(source.subarray(p + 56 + row * 4, p + 60 + row * 4),
        source.subarray(p + row * 4, p + 4 + row * 4)), row * 4);
    tiles.push(tile);
    image.set(tile, symbols.TILES + n * 56);
  }
  const declarations = Object.entries(symbols).map(([name, value]) => `${name} = ${hex(value)}`).join("\n");
  const source = fs.readFileSync(path.join(root, "codegen", "patches", "quarx-3ric.s"), "utf8")
    + `\nexpected_irq: .byte ${Array.from(rom.subarray(0xfa86, 0xfa92), hex).join(",")}`
    + `\nexpected_nmi: .byte ${Array.from(rom.subarray(0xf1bb, 0xf1d6), hex).join(",")}\n`;
  const engine = assemble(declarations + "\n" + source);
  if (engine.org !== 0x6000 || engine.org + engine.bytes.length > symbols.MUSIC)
    throw new Error(`Quarx adapter exceeds its $6000-$65FF reservation (${engine.bytes.length} bytes)`);
  const s = engine.symbols;
  const calls = new Map([
    [0x0300, s.SELECT_TILES], [0x0328, s.DRAW_TILE], [0x0332, s.COPY_SCREEN], [0x0385, s.COPY_SPAN],
    [0xf980, s.PRINT_STRING], [0xf997, s.PRINT_CHAR], [0xf99d, s.FONT_ROWS],
    [0xf200, s.ERASE_CHAR], [0xf203, s.PRINT_ANIMATED], [0xf21e, s.DRAW_PREVIEW],
    [0xf2c3, s.RETURN], [0xf30a, s.RESTORE_TITLE],
    [0x0200, s.MUSIC_PREPARE], [0x0203, s.MUSIC_START], [0x0209, s.MUSIC_STOP],
    [0xa6fa, s.HIGH_SCORES],
  ]);
  const patches = replaceCalls(game, 0x800, new Map([...calls, [0xda00, s.MENU], [0xda03, s.MENU + 3]]));
  relocateMenu(menu, symbols);
  patches.push(...replaceCalls(menu, s.MENU, calls));
  game[0x183] = 0x4c;
  patchWord(game, 0x184, s.START_GAME);
  walkInstructions(game, [[0x1afa - 0x800, 0x1bb4 - 0x800]], (p, size) => {
    if (size !== 3) return;
    const address = game[p + 1] | game[p + 2] << 8;
    if (address >= 0xf800 && address < 0xf980)
      patchWord(game, p + 1, address + s.ROW_LO - 0xf800);
  });
  game.fill(0xea, 0x1acd - 0x800, 0x1ad0 - 0x800);
  game.fill(0xea, 0x1237 - 0x800, 0x123a - 0x800);
  const highScores = raw("DATA/HSTBL.LZ");
  walkInstructions(highScores, [[0, 0xf3]], (p, size) => {
    if (size !== 3) return;
    const address = highScores[p + 1] | highScores[p + 2] << 8;
    if (address >= 0xda00 && address < 0xe000) patchWord(highScores, p + 1, address + s.MENU - 0xda00);
    else if (address >= 0xa6fa && address < 0xa800) patchWord(highScores, p + 1, address + s.HIGH_SCORES - 0xa6fa);
  });
  highScores[0xa75b - 0xa6fa] = s.MENU >> 8;
  menu[0x3b0] = 0x4c; patchWord(menu, 0x3b1, s.LOAD_TITLE);
  const decompressor = Uint8Array.from(files.get("DECOMP"));
  for (let p = 0; p + 2 < decompressor.length; p++) {
    if (![0x20, 0x4c, 0xad, 0x8d, 0x8e, 0x6d, 0xee].includes(decompressor[p])) continue;
    const address = decompressor[p + 1] | decompressor[p + 2] << 8;
    if (address >= 0xd800 && address < 0xd900) patchWord(decompressor, p + 1, address - 0xbb00);
  }
  image.set(game, 0x800); image.set(decompressor, 0x1d00);
  image.set(files.get("A2QUARX.SYSTEM").subarray(0x608, 0x7ce), symbols.SHAREWARE);
  image.set(engine.bytes, engine.org); image.set(titlePacked, symbols.TITLE_DATA);
  image.set(menu, symbols.MENU); image.set(highScores, symbols.HIGH_SCORES);
  image.set(backgroundPacked, symbols.BACKGROUND_DATA);
  image.set(relocatePlayer(raw("MUSIC/PLAYER.LZ"), s), s.MUSIC);
  songs.forEach((song, n) => image.set(song, s[`SONG${n + 1}`]));
  const keyboardPatches = [
    ...[0x11b2, 0x1212, 0x121e, 0x1ac2, 0x1aca].map(address => ({ address, original: [0x8d, 0x10, 0xc0] })),
    ...[s.MENU + 0xa0, s.MENU + 0x113, s.HIGH_SCORES + 0x66]
      .map(address => ({ address, original: [0x8d, 0x10, 0xc0] })),
  ];
  for (const { address, original } of keyboardPatches) {
    if (!original.every((byte, index) => image[address + index] === byte))
      throw new Error(`Unexpected keyboard acknowledgement at ${hex(address)}`);
    image[address] = 0x20;
    patchWord(image, address + 1, s.ACK_KEY);
  }
  for (const row of engine.listing)
    if (row.kind === "instruction" && row.bytes[0] === 0x20
        && (row.bytes[1] | row.bytes[2] << 8) === s.ACK_KEY)
      keyboardPatches.push({ address: row.pc, original: [0x2c, 0x10, 0xc0] });
  if (keyboardPatches.length !== 10) throw new Error("Unexpected keyboard acknowledgement count");
  image[0x800] = 0x4c; patchWord(image, 0x801, s.INIT);
  const prg = buildPhysicalProgram(image, s.INIT), woz = buildBootableWoz(prg, 0x800);
  return { image, prg, woz, symbols: s, patches, keyboardPatches, title, background, tiles,
    sizes: { engine: engine.bytes.length, title: titlePacked.length, background: backgroundPacked.length } };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: node codegen\\tools\\port-quarx.mjs <a2quarx-sw.po> <output-prefix>");
    const input = path.resolve(process.argv[2]), prefix = path.resolve(process.argv[3]);
    if (!/^[a-z0-9_]{1,8}$/i.test(path.basename(prefix)))
      throw new Error("Use a 1-8 character alphanumeric/underscore output name for the ROM's FAT32 loader");
    const outputs = [prefix + ".prg", prefix + ".woz", prefix + ".json"];
    if (outputs.some(name => fs.existsSync(name))) throw new Error("Output files already exist; choose a new prefix");
    const result = buildQuarx(fs.readFileSync(input));
    const report = {
      inputSha256: INPUT_SHA256, romSha256: ROM_SHA256,
      prgSha256: sha256(result.prg), wozSha256: sha256(result.woz),
      loadAddress: "0800", command: `BRUN ${path.basename(prefix)}.prg 0800`,
      sizes: { ...result.sizes, prg: result.prg.length, woz: result.woz.length },
      graphics: "Converted standard hi-res; no auxiliary RAM or double-hi-res required.",
      music: "All three original shareware songs, original tracker, slot-4 Mockingboard at 61.362 Hz; AY periods scaled 20/13.",
      physicalBoardVerified: false,
    };
    const data = [result.prg, result.woz, JSON.stringify(report, null, 2) + "\n"], created = [];
    try {
      for (let n = 0; n < outputs.length; n++) {
        fs.writeFileSync(outputs[n], data[n], { flag: "wx" });
        created.push(outputs[n]);
      }
    } catch (error) {
      for (const name of created) fs.unlinkSync(name);
      throw error;
    }
    console.log(`Created ${outputs[0]}\nCreated ${outputs[1]}\n${report.command}\nWOZ SHA-256: ${report.wozSha256}`);
  } catch (error) { console.error(`port-quarx: ${error.message}`); process.exitCode = 1; }
}
