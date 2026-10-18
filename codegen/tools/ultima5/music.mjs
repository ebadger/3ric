// Ultima V music data for the 3RIC compact player (codegen/patches/ultima5/
// music.s): repacks songs from the 128K edition's Mockingboard driver files
// on the user's disk (MUFF songs, MUIN instruments, MUDR driver tables).
// Nothing copyrighted is stored in the repository - every table is derived
// from those files at build time.

// 3RIC's Mockingboard (VIA timer and AY clock) runs at 25.175 MHz / 16;
// Origin's numbers are for an Apple II's 1.0227 MHz.
export const CLOCK_SCALE = 1573437.5 / 1022727;
const DEFAULT_LATCH = 0x429a;            // driver's T1 latch before a tempo command
const TEMPO_DIVIDEND = 0x26edaa;
export const MAX_VOICES = 6;             // two AY-3-8910s
export const INST_SIZE = 23;             // player instrument record (see music.s)
export const NOTE_LO = 21, NOTES = 96;   // MUDR period table: MIDI notes 21..116

/** T1 latch for `latch` Apple II cycles, keeping the period (latch + 2) in time. */
export function scaleLatch(latch) {
  const v = Math.round((latch + 2) * CLOCK_SCALE) - 2;
  if (v > 0xffff) throw new Error(`timer latch $${latch.toString(16)} does not scale to 16 bits`);
  return v;
}

/** The driver's tempo command: 16-bit long division TEMPO_DIVIDEND / tempo
 *  (the previous latch is shifted out completely). */
export function tempoLatch(tempo) {
  let rem = TEMPO_DIVIDEND, d = tempo << 16, q = 0;
  for (let i = 0; i < 16; i++) {
    d >>>= 1;
    const bit = rem >= d ? 1 : 0;
    if (bit) rem -= d;
    q = ((q << 1) | bit) & 0xffff;
  }
  return q;
}

/** Tables the player needs, from MUDR (aux $6E00). */
export function driverTables(mudr) {
  const at = (addr) => addr - 0x6e00;
  if (mudr.length < at(0x7ed8)) throw new Error("MUDR is too short (different release?)");
  for (let i = 0; i < 256; i++)
    if (mudr[at(0x7d00) + i] !== Math.floor(((i >> 4) * (i & 15) + 7) / 15))
      throw new Error("MUDR volume table is not round(a*b/15) (different release?)");
  const perl = [], perh = [];
  for (let i = 0; i < NOTES; i++) {
    const period = (mudr[at(0x7e60) + i] << 8 | mudr[at(0x7e00) + i]) >> 1;   // halved for a Mockingboard
    const p = Math.min(0xfff, Math.round(period * CLOCK_SCALE));
    perl.push(p & 255); perh.push(p >> 8);
  }
  if ((perh[0] << 8 | perl[0]) !== Math.round((0x121f >> 1) * CLOCK_SCALE)) throw new Error("MUDR period table moved (different release?)");
  const durtab = Array.from(mudr.subarray(at(0x7ec0), at(0x7ec0) + 24));
  if (durtab[2] !== 48) throw new Error("MUDR duration table moved (different release?)");
  const noise = Array.from({ length: 32 }, (_, r) => Math.min(31, Math.round(r * CLOCK_SCALE)));
  return { perl, perh, durtab, noise, defLatch: scaleLatch(DEFAULT_LATCH) };
}

/** MUIN instrument n -> player record (volume envelope, R_time, pitch
 *  envelope, PR_time, flags). Offsets match music.s. */
export function instrumentRecord(muin, n) {
  const raw = muin.subarray(n * 32, n * 32 + 32);
  if (raw.length < 29) throw new Error(`MUIN has no instrument ${n}`);
  const w = (k) => raw[2 * k] | raw[2 * k + 1] << 8;
  if (w(13) !== 0) throw new Error(`instrument ${n} detunes (unsupported)`);
  const rec = [];
  for (let k = 0; k < 5; k++) rec.push(w(k) & 255, w(k) >> 8);
  rec.push(w(5) & 255);
  for (let k = 6; k < 11; k++) rec.push(w(k) & 255, w(k) >> 8);
  rec.push(w(11) & 255, raw[28]);
  return rec;
}

function songHeader(muff, n) {
  const skip = muff[0], count = muff[1 + skip], base = 2 + skip;
  if (n < 1 || n > count) throw new Error(`no song ${n}`);
  const off = muff[base + 2 * (n - 1)] << 8 | muff[base + 2 * (n - 1) + 1];
  let p = off;
  p += 1 + muff[p];
  const nv = muff[p++];
  const trackmap = Array.from(muff.subarray(p, p + nv)); p += nv;
  const ntracks = muff[p++];
  const tracks = [];
  for (let t = 0; t < ntracks; t++, p += 2) {
    const s = off + (muff[p] << 8 | muff[p + 1]);
    tracks.push(s + 1 + muff[s]);            // past the track's skip header
  }
  return { count, nv, trackmap, tracks };
}

export function songCount(muff) { return muff[1 + muff[0]]; }

// Operand bytes of commands $30-$3F in the original stream.
const OPERANDS = { 0x30: 1, 0x31: 1, 0x32: 1, 0x33: 1, 0x34: 1, 0x38: 2, 0x3c: 1, 0x3d: 0, 0x3e: 0, 0x3f: 0 };

/** Decode one track into events: { bytes, calls, tempo, insts, end }. */
function readTrack(muff, start) {
  const out = [], calls = [], insts = [];
  let q = start, tempo = false;
  for (;;) {
    if (q >= muff.length) throw new Error("track runs past MUFF");
    const b = muff[q++];
    if ((b & 3) !== 3) {
      if ((b & 3) === 1) {
        const idx = muff[q++];
        if (idx > 23) throw new Error(`duration index ${idx}`);
        out.push({ b, ops: [idx] });
      } else out.push({ b, ops: [] });
      continue;
    }
    const c = b >> 2;
    if (c < 0x30) { out.push({ b, ops: [] }); continue; }
    if (!(c in OPERANDS)) throw new Error(`command $${c.toString(16)} (unsupported)`);
    const ops = Array.from(muff.subarray(q, q + OPERANDS[c])); q += OPERANDS[c];
    if (c === 0x32) tempo = true;
    if (c === 0x34) insts.push(ops[0]);
    if (c === 0x3c) calls.push(ops[0]);
    out.push({ b, c, ops });
    if (c === 0x3d || c === 0x3e) return { events: out, calls, tempo, insts };
  }
}

/** Song n -> { bytes (for SONGBUF at `base`), insts }. instOff maps an MUIN
 *  instrument number to its record offset in INSTAB. */
export function repackSong(muff, n, base, instOff) {
  const { nv, trackmap, tracks } = songHeader(muff, n);
  const nplay = Math.min(nv, MAX_VOICES);
  const decoded = new Map();
  const owners = new Map();                   // track -> voices reaching it
  const visit = (t, voice, depth) => {
    if (t >= tracks.length) throw new Error(`song ${n}: call to track ${t} of ${tracks.length}`);
    if (depth > 1) throw new Error(`song ${n}: nested call (unsupported)`);
    if (!decoded.has(t)) decoded.set(t, readTrack(muff, tracks[t]));
    if (!owners.has(t)) owners.set(t, new Set());
    owners.get(t).add(voice);
    for (const c of decoded.get(t).calls) visit(c, voice, depth + 1);
  };
  for (let v = 0; v < nplay; v++) visit(trackmap[v], v, 0);
  const insts = new Set();
  for (const [t, d] of decoded) {
    if (d.tempo && [...owners.get(t)].some((v) => v !== 0)) throw new Error(`song ${n}: tempo change outside voice 0`);
    d.insts.forEach((i) => insts.add(i));
  }

  const hdr = 2 + 2 * MAX_VOICES + 2 * tracks.length;
  const body = [], start = new Map();
  for (const [t, d] of [...decoded].sort((a, b) => a[0] - b[0])) {
    start.set(t, base + hdr + body.length);
    for (const e of d.events) {
      if (e.c === 0x38 || e.c === 0x3f) continue;           // sync byte / no-op
      if (e.c === 0x32) {
        const l = scaleLatch(tempoLatch(e.ops[0]));
        body.push(e.b, l & 255, l >> 8);
      } else if (e.c === 0x34) {
        if (!instOff.has(e.ops[0])) throw new Error(`song ${n}: instrument ${e.ops[0]} missing`);
        body.push(e.b, instOff.get(e.ops[0]));
      } else body.push(e.b, ...e.ops);
    }
  }
  const bytes = [nplay, tracks.length];
  const word = (w) => bytes.push(w & 255, w >> 8);
  for (let v = 0; v < MAX_VOICES; v++) word(v < nplay ? start.get(trackmap[v]) : 0);
  for (let t = 0; t < tracks.length; t++) word(start.get(t) || 0);
  bytes.push(...body);
  return { bytes: Uint8Array.from(bytes), insts };
}

/** Everything the player needs. capacity = SONGBUF size; songs that do not
 *  fit are left out (the player stays silent for them). */
export function buildMusic({ muff, muin, mudr }, base, capacity) {
  const tables = driverTables(mudr);
  const count = songCount(muff);
  const skipped = [];
  const kept = [];
  const anyInst = { has: () => true, get: () => 0 };
  for (let n = 1; n <= count; n++) {
    try {
      const { bytes, insts } = repackSong(muff, n, base, anyInst);
      if (bytes.length <= capacity) kept.push({ n, insts });
      else skipped.push({ n, why: `${bytes.length} bytes, buffer holds ${capacity}` });
    } catch (e) { skipped.push({ n, why: e.message }); }
  }
  // Instrument records for the kept songs, then a zero record (the
  // driver's state before a voice selects an instrument).
  const used = [...new Set(kept.flatMap((c) => [...c.insts]))].sort((a, b) => a - b);
  const instab = [], instOff = new Map();
  for (const i of used) { instOff.set(i, instab.length); instab.push(...instrumentRecord(muin, i)); }
  const zeroInst = instab.length;
  instab.push(...new Array(INST_SIZE).fill(0));
  const songs = new Map();
  for (const { n } of kept) songs.set(n, repackSong(muff, n, base, instOff).bytes);
  return { ...tables, instab, zeroInst, songs, skipped };
}
