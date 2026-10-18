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
const MUDR_NOTE_LO = 21, MUDR_NOTES = 96;  // MUDR period table: MIDI notes 21..116

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

/** Tables the player needs, from MUDR (aux $6E00); periods for MIDI notes
 *  noteLo..noteHi (the songs use 26-99). */
export function driverTables(mudr, noteLo = MUDR_NOTE_LO, noteHi = MUDR_NOTE_LO + MUDR_NOTES - 1) {
  const at = (addr) => addr - 0x6e00;
  if (mudr.length < at(0x7ed8)) throw new Error("MUDR is too short (different release?)");
  for (let i = 0; i < 256; i++)
    if (mudr[at(0x7d00) + i] !== Math.floor(((i >> 4) * (i & 15) + 7) / 15))
      throw new Error("MUDR volume table is not round(a*b/15) (different release?)");
  const perl = [], perh = [];
  for (let i = 0; i < MUDR_NOTES; i++) {
    const period = (mudr[at(0x7e60) + i] << 8 | mudr[at(0x7e00) + i]) >> 1;   // halved for a Mockingboard
    const p = Math.min(0xfff, Math.round(period * CLOCK_SCALE));
    perl.push(p & 255); perh.push(p >> 8);
  }
  if ((perh[0] << 8 | perl[0]) !== Math.round((0x121f >> 1) * CLOCK_SCALE)) throw new Error("MUDR period table moved (different release?)");
  if (noteLo < MUDR_NOTE_LO || noteHi >= MUDR_NOTE_LO + MUDR_NOTES) throw new Error(`note range ${noteLo}-${noteHi}`);
  const range = (t) => t.slice(noteLo - MUDR_NOTE_LO, noteHi - MUDR_NOTE_LO + 1);
  const durtab = Array.from(mudr.subarray(at(0x7ec0), at(0x7ec0) + 24));
  if (durtab[2] !== 48) throw new Error("MUDR duration table moved (different release?)");
  const noise = Array.from({ length: 32 }, (_, r) => Math.min(31, Math.round(r * CLOCK_SCALE)));
  return { perl: range(perl), perh: range(perh), durtab, noise, defLatch: scaleLatch(DEFAULT_LATCH), noteLo, notes: noteHi - noteLo + 1 };
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

// ---------------------------------------------------------------------------
// Repacking. Each song becomes one file the player reads in place:
//
//   +0 voices played, +1 entries, +2 six voice start pointers,
//   +14 entries x pointer (Origin's tracks keep their numbers, the phrase
//   subroutines below follow), then the event streams.
//
// Events are Origin's except: $32 (tempo) carries the scaled T1 latch,
// $34 (instrument) the record offset in INSTAB, $38/$3F are dropped, and two
// player commands are added for phrases: $39 n calls entry n and $3A returns,
// both keeping the pitch and duration registers (Origin's $3C/$3D reset
// them). To fit the 64 KB machine the tool re-encodes durations with the
// fewest bytes and moves repeated phrases into subroutines, then replays
// every voice of the result against the original (playEvents) before
// writing it. A song larger than the main buffer continues in a second
// region (the shim's block buffer, see music.s); no event stream crosses
// from one region to the other.

export const KCALL = 0x39, KRET = 0x3a;
export const STACK_LEVELS = 3;          // calls of either kind in progress per voice
const cmd = (c) => (c << 2) | 3;
const isTerminal = (ev) => ev[0] === cmd(0x3d) || ev[0] === cmd(0x3e);

/** Origin's events -> player events (byte arrays), before compression. */
function translate(events, instOff) {
  const out = [];
  for (const e of events) {
    if (e.c === 0x38 || e.c === 0x3f) continue;
    if (e.c === 0x32) { const l = scaleLatch(tempoLatch(e.ops[0])); out.push([e.b, l & 255, l >> 8]); }
    else if (e.c === 0x34) out.push([e.b, instOff.get(e.ops[0])]);
    else out.push([e.b, ...e.ops]);
  }
  return out;
}

/** Cheapest duration encoding for one track: a note names register A, B or
 *  an explicit index; registers are set by commands and reset to 3/4 at the
 *  track start and after each $3C call. Dynamic programming over (A, B). */
function reencodeDurations(events) {
  const out = [];
  let seg = [], A = 3, B = 4;
  const flush = () => {
    let states = new Map([["3,4", { A: 3, B: 4, cost: 0, path: null }]]);
    for (const it of seg) {
      const next = new Map();
      const put = (a, b, cost, prev, emit) => {
        const k = a * 32 + b, cur = next.get(k);
        if (!cur || cur.cost > cost) next.set(k, { A: a, B: b, cost, path: { prev, emit } });
      };
      for (const s of states.values()) {
        if (it.other) { put(s.A, s.B, s.cost + it.other.length, s.path, [it.other]); continue; }
        const { nb, d } = it;
        if (d === s.A) put(s.A, s.B, s.cost + 1, s.path, [[nb]]);
        else if (d === s.B) put(s.A, s.B, s.cost + 1, s.path, [[nb | 2]]);
        else {
          put(s.A, s.B, s.cost + 2, s.path, [[nb | 1, d]]);
          put(d, s.B, s.cost + 2, s.path, [[cmd(d)], [nb]]);
          put(s.A, d, s.cost + 2, s.path, [[cmd(d + 0x18)], [nb | 2]]);
        }
      }
      states = next;
    }
    let best = null;
    for (const s of states.values()) if (!best || s.cost < best.cost) best = s;
    const chunks = [];
    for (let p = best.path; p; p = p.prev) chunks.push(p.emit);
    for (let i = chunks.length - 1; i >= 0; i--) out.push(...chunks[i]);
    seg = [];
  };
  for (const e of events) {
    const b = e[0];
    if ((b & 3) !== 3) {
      seg.push({ nb: b & 0xfc, d: (b & 3) === 0 ? A : (b & 3) === 2 ? B : e[1] });
      continue;
    }
    const c = b >> 2;
    if (c < 0x18) { A = c; continue; }
    if (c < 0x30) { B = c - 0x18; continue; }
    seg.push({ other: e });
    if (c === 0x3c) { flush(); A = 3; B = 4; }
  }
  flush();
  return out;
}

/** Greedy grammar compression: repeatedly turn the repeated phrase that
 *  saves the most bytes into a subroutine (call 2 bytes; subroutine body +
 *  return + pointer). tracks: Map index -> events. Returns sequences of
 *  symbols: an event (byte array) or { rule: r }. */
function factorPhrases(tracks, voiceTracks, maxLen = 64) {
  const ids = [...tracks.keys()];
  let seqs = ids.map((t) => tracks.get(t).slice());
  let rules = [];
  const keyOf = (s) => (s.rule !== undefined ? "R" + s.rule : s.join("."));
  const size = (s) => (s.rule !== undefined ? 2 : s.length);
  const stackDepth = () => {
    const memo = new Map();
    const depthOfSeq = (key, seq) => {
      if (memo.has(key)) return memo.get(key);
      memo.set(key, Infinity);                       // no recursion possible
      let d = 0;
      for (const s of seq) {
        if (s.rule !== undefined) d = Math.max(d, 1 + depthOfSeq("r" + s.rule, rules[s.rule]));
        else if (s[0] === cmd(0x3c)) d = Math.max(d, 1 + depthOfSeq("t" + s[1], seqs[ids.indexOf(s[1])]));
      }
      memo.set(key, d);
      return d;
    };
    return Math.max(0, ...voiceTracks.map((t) => depthOfSeq("t" + t, seqs[ids.indexOf(t)])));
  };
  for (;;) {
    const cand = new Map();
    const all = seqs.concat(rules);
    all.forEach((q, si) => {
      for (let i = 0; i < q.length; i++) {
        let key = "", bytes = 0;
        for (let L = 1; L <= maxLen && i + L <= q.length; L++) {
          const s = q[i + L - 1];
          if (s.rule === undefined && isTerminal(s)) break;
          key += (L > 1 ? "|" : "") + keyOf(s);
          bytes += size(s);
          if (L < 2) continue;
          let c = cand.get(key);
          if (!c) { c = { k: 0, si: -1, end: 0, L, bytes, syms: null, at: [si, i] }; cand.set(key, c); }
          if (c.si !== si || i >= c.end) { c.k++; c.si = si; c.end = i + L; }
        }
      }
    });
    const ranked = [];
    for (const c of cand.values()) {
      const saving = c.k * c.bytes - (c.k * 2 + c.bytes + 1 + 2);
      if (c.k >= 2 && saving > 0) ranked.push({ c, saving });
    }
    ranked.sort((a, b) => b.saving - a.saving);
    let accepted = false;
    for (const { c } of ranked) {
      const [si, i] = c.at;
      const body = all[si].slice(i, i + c.L);
      const r = rules.length;
      const same = (q, j) => { for (let k = 0; k < c.L; k++) if (keyOf(q[j + k]) !== keyOf(body[k])) return false; return true; };
      const replace = (q) => {
        const out = [];
        for (let j = 0; j < q.length;) {
          if (j + c.L <= q.length && same(q, j)) { out.push({ rule: r }); j += c.L; } else out.push(q[j++]);
        }
        return out;
      };
      const oldSeqs = seqs, oldRules = rules;
      seqs = seqs.map(replace);
      rules = rules.map(replace).concat([body]);
      if (stackDepth() <= STACK_LEVELS) { accepted = true; break; }
      seqs = oldSeqs; rules = oldRules;
    }
    if (!accepted) break;
  }
  return { ids, seqs, rules };
}

/** Replay one voice and list what the player would do: notes and rests
 *  (pitch register, duration index, tie), transposes, levels, instruments,
 *  tempo latches, the end. Two streams that list the same play the same. */
function playEvents(read, start, entry, kind, instOf) {
  const out = [], stack = [];
  let p = start, pitch = 0x3c, A = 3, B = 4, maxDepth = 0, trans = 0, lo = 255, hi = 0;
  const rd = () => read(p++);
  for (let steps = 0; ; steps++) {
    if (steps > 1e6) throw new Error("voice does not end");
    const b = rd();
    if ((b & 3) !== 3) {
      const idx = (b & 3) === 0 ? A : (b & 3) === 2 ? B : rd();
      const iv = (b >> 2) & 31;
      if (iv === 0) out.push(`R${pitch}/${idx}`);
      else {
        pitch = (pitch + iv - 16) & 255;
        out.push(`N${pitch}/${idx}/${b >> 7}`);
        const note = (pitch + trans) & 255;
        lo = Math.min(lo, note); hi = Math.max(hi, note);
      }
      continue;
    }
    const c = b >> 2;
    if (c < 0x18) { A = c; continue; }
    if (c < 0x30) { B = c - 0x18; continue; }
    switch (c) {
      case 0x30: pitch = rd(); break;
      case 0x31: trans = rd(); out.push(`T${trans}`); break;
      case 0x32: out.push(`M${kind === "origin" ? scaleLatch(tempoLatch(rd())) : rd() | rd() << 8}`); break;
      case 0x33: out.push(`L${rd()}`); break;
      case 0x34: out.push(`I${instOf(rd())}`); break;
      case 0x38: if (kind !== "origin") throw new Error("sync byte"); rd(); rd(); break;
      case 0x3f: if (kind !== "origin") throw new Error("no-op"); break;
      case 0x3c: case KCALL: {
        const t = rd();
        stack.push(p);
        maxDepth = Math.max(maxDepth, stack.length);
        p = entry(t);
        if (c === 0x3c) { pitch = 0x3c; A = 3; B = 4; }
        break;
      }
      case 0x3d: case KRET:
        if (!stack.length) { if (c === KRET) throw new Error("return at depth 0"); out.push("E"); return { out, maxDepth, lo, hi }; }
        p = stack.pop();
        if (c === 0x3d) { pitch = 0x3c; A = 3; B = 4; }
        break;
      case 0x3e: out.push("E"); return { out, maxDepth, lo, hi };
      default: throw new Error(`command $${c.toString(16)}`);
    }
  }
}

/** Song n -> { bytes, insts, partA }. regions: { base, capB, baseA, capA }.
 *  bytes = the file: the main-buffer image (padded to capB when the song
 *  continues in region A) followed by the region-A image. */
export function repackSong(muff, n, regions, instOff) {
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
  if (!instOff) return { insts };

  const prepared = new Map();
  for (const [t, d] of [...decoded].sort((a, b) => a[0] - b[0])) prepared.set(t, reencodeDurations(translate(d.events, instOff)));
  const voiceTracks = [...new Set(trackmap.slice(0, nplay))];
  const { ids, seqs, rules } = factorPhrases(prepared, voiceTracks);
  const firstRule = tracks.length;
  const nentries = firstRule + rules.length;
  if (nentries > 127) throw new Error(`song ${n}: ${nentries} entries`);
  const flat = (seq) => seq.flatMap((s) => (s.rule !== undefined ? [cmd(KCALL), firstRule + s.rule] : s));
  const items = [
    ...ids.map((t, i) => ({ entry: t, bytes: flat(seqs[i]) })),
    ...rules.map((r, i) => ({ entry: firstRule + i, bytes: [...flat(r), cmd(KRET)] })),
  ];

  // Layout: everything in the main buffer if it fits, else largest first
  // into whichever region still has room.
  const hdr = 2 + 2 * MAX_VOICES + 2 * nentries;
  const total = hdr + items.reduce((s, it) => s + it.bytes.length, 0);
  let usedB = hdr, usedA = 0;
  const order = total <= regions.capB ? items : [...items].sort((a, b) => b.bytes.length - a.bytes.length);
  for (const it of order) {
    if (usedB + it.bytes.length <= regions.capB) { it.addr = regions.base + usedB; usedB += it.bytes.length; }
    else if (usedA + it.bytes.length <= regions.capA) { it.addr = regions.baseA + usedA; usedA += it.bytes.length; }
    else throw new Error(`${total} bytes, buffers hold ${regions.capB} + ${regions.capA}`);
  }
  const imgB = new Uint8Array(usedA ? regions.capB : usedB), imgA = new Uint8Array(usedA);
  const entryAddr = new Map(items.map((it) => [it.entry, it.addr]));
  imgB[0] = nplay; imgB[1] = nentries;
  const word = (o, w) => { imgB[o] = w & 255; imgB[o + 1] = w >> 8; };
  for (let v = 0; v < MAX_VOICES; v++) word(2 + 2 * v, v < nplay ? entryAddr.get(trackmap[v]) : 0);
  for (let e = 0; e < nentries; e++) word(14 + 2 * e, entryAddr.get(e) || 0);
  for (const it of items) {
    if (it.addr >= regions.baseA && it.addr < regions.baseA + regions.capA) imgA.set(it.bytes, it.addr - regions.baseA);
    else imgB.set(it.bytes, it.addr - regions.base);
  }

  // Replay every voice from the bytes the player will see.
  const read = (a) => {
    if (a >= regions.base && a < regions.base + imgB.length) return imgB[a - regions.base];
    if (a >= regions.baseA && a < regions.baseA + imgA.length) return imgA[a - regions.baseA];
    throw new Error(`song ${n}: read outside the song at $${a.toString(16)}`);
  };
  const instOf = new Map([...instOff].map(([k, v]) => [v, k]));
  let noteLo = 255, noteHi = 0;
  for (let v = 0; v < nplay; v++) {
    const want = playEvents((a) => muff[a], tracks[trackmap[v]], (t) => tracks[t], "origin", (x) => x).out;
    const got = playEvents(read, imgB[2 + 2 * v] | imgB[3 + 2 * v] << 8,
      (e) => imgB[14 + 2 * e] | imgB[15 + 2 * e] << 8, "player", (x) => instOf.get(x));
    if (got.maxDepth > STACK_LEVELS) throw new Error(`song ${n}: voice ${v} nests ${got.maxDepth} calls`);
    if (got.out.join() !== want.join()) throw new Error(`song ${n}: voice ${v} repacks differently`);
    noteLo = Math.min(noteLo, got.lo); noteHi = Math.max(noteHi, got.hi);
  }
  const bytes = new Uint8Array(imgB.length + imgA.length);
  bytes.set(imgB); bytes.set(imgA, imgB.length);
  return { bytes, insts, partA: usedA, noteLo, noteHi };
}

/** Everything the player needs. regions as for repackSong; songs that do
 *  not fit even with region A are left out (the player stays silent). */
export function buildMusic({ muff, muin, mudr }, regions) {
  driverTables(mudr);                        // checks the release before any work
  const count = songCount(muff);
  const skipped = [], kept = [];
  for (let n = 1; n <= count; n++) {
    try { kept.push({ n, insts: repackSong(muff, n, regions).insts }); }
    catch (e) { skipped.push({ n, why: e.message }); }
  }
  // Instrument records for the kept songs, then a zero record (the
  // driver's state before a voice selects an instrument).
  const used = [...new Set(kept.flatMap((c) => [...c.insts]))].sort((a, b) => a - b);
  const instab = [], instOff = new Map();
  for (const i of used) { instOff.set(i, instab.length); instab.push(...instrumentRecord(muin, i)); }
  const zeroInst = instab.length;
  instab.push(...new Array(INST_SIZE).fill(0));
  const songs = new Map(), partA = new Map();
  let noteLo = 255, noteHi = 0;
  for (const { n } of kept) {
    try {
      const r = repackSong(muff, n, regions, instOff);
      songs.set(n, r.bytes);
      if (r.partA) partA.set(n, r.partA);
      noteLo = Math.min(noteLo, r.noteLo); noteHi = Math.max(noteHi, r.noteHi);
    } catch (e) { skipped.push({ n, why: e.message }); }
  }
  skipped.sort((a, b) => a.n - b.n);
  const tables = noteHi < noteLo ? driverTables(mudr, 21, 21) : driverTables(mudr, noteLo, noteHi);
  return { ...tables, instab
, zeroInst, songs, partA, skipped };
}
