// M.U.L.E. for 3RIC - run the Atari intro program headlessly to get the
// hand-off the main game expects.
//
// M.U.L.E.'s first program (boot sectors 1-129) shows the title, asks for
// the level, the number of players, their controllers, colours and species,
// writes that configuration (and a fixed data block) to $0900-$0FFF, loads
// the main game and warm-starts it. The 3RIC port runs only the main game,
// so the converter runs the intro here, on a small 6502 and just enough of
// an Atari (ANTIC line timing and interrupts, POKEY RANDOM, joysticks and
// console keys, the OS disk, VBI and warm-start entry points), answers its
// questions with scripted joystick presses and keeps $0000-$0FFF at the
// warm start. No Atari ROM is involved: the few OS calls the intro makes
// are handled here.

import { readAtr } from "./port-mule.mjs";

const OPS = {};
{
  const T = `00 BRK 0 7|01 ORA 10 6|05 ORA 3 3|06 ASL 3 5|08 PHP 0 3|09 ORA 2 2|0A ASL 1 2|0D ORA 6 4|0E ASL 6 6|10 BPL 12 2|11 ORA 11 5
15 ORA 4 4|16 ASL 4 6|18 CLC 0 2|19 ORA 8 4|1D ORA 7 4|1E ASL 7 7|20 JSR 6 6|21 AND 10 6|24 BIT 3 3|25 AND 3 3|26 ROL 3 5|28 PLP 0 4
29 AND 2 2|2A ROL 1 2|2C BIT 6 4|2D AND 6 4|2E ROL 6 6|30 BMI 12 2|31 AND 11 5|35 AND 4 4|36 ROL 4 6|38 SEC 0 2|39 AND 8 4|3D AND 7 4
3E ROL 7 7|40 RTI 0 6|41 EOR 10 6|45 EOR 3 3|46 LSR 3 5|48 PHA 0 3|49 EOR 2 2|4A LSR 1 2|4C JMP 6 3|4D EOR 6 4|4E LSR 6 6|50 BVC 12 2
51 EOR 11 5|55 EOR 4 4|56 LSR 4 6|58 CLI 0 2|59 EOR 8 4|5D EOR 7 4|5E LSR 7 7|60 RTS 0 6|61 ADC 10 6|65 ADC 3 3|66 ROR 3 5|68 PLA 0 4
69 ADC 2 2|6A ROR 1 2|6C JMP 9 5|6D ADC 6 4|6E ROR 6 6|70 BVS 12 2|71 ADC 11 5|75 ADC 4 4|76 ROR 4 6|78 SEI 0 2|79 ADC 8 4|7D ADC 7 4
7E ROR 7 7|81 STA 10 6|84 STY 3 3|85 STA 3 3|86 STX 3 3|88 DEY 0 2|8A TXA 0 2|8C STY 6 4|8D STA 6 4|8E STX 6 4|90 BCC 12 2|91 STA 11 6
94 STY 4 4|95 STA 4 4|96 STX 5 4|98 TYA 0 2|99 STA 8 5|9A TXS 0 2|9D STA 7 5|A0 LDY 2 2|A1 LDA 10 6|A2 LDX 2 2|A4 LDY 3 3|A5 LDA 3 3
A6 LDX 3 3|A8 TAY 0 2|A9 LDA 2 2|AA TAX 0 2|AC LDY 6 4|AD LDA 6 4|AE LDX 6 4|B0 BCS 12 2|B1 LDA 11 5|B4 LDY 4 4|B5 LDA 4 4|B6 LDX 5 4
B8 CLV 0 2|B9 LDA 8 4|BA TSX 0 2|BC LDY 7 4|BD LDA 7 4|BE LDX 8 4|C0 CPY 2 2|C1 CMP 10 6|C4 CPY 3 3|C5 CMP 3 3|C6 DEC 3 5|C8 INY 0 2
C9 CMP 2 2|CA DEX 0 2|CC CPY 6 4|CD CMP 6 4|CE DEC 6 6|D0 BNE 12 2|D1 CMP 11 5|D5 CMP 4 4|D6 DEC 4 6|D8 CLD 0 2|D9 CMP 8 4|DD CMP 7 4
DE DEC 7 7|E0 CPX 2 2|E1 SBC 10 6|E4 CPX 3 3|E5 SBC 3 3|E6 INC 3 5|E8 INX 0 2|E9 SBC 2 2|EA NOP 0 2|EC CPX 6 4|ED SBC 6 4|EE INC 6 6
F0 BEQ 12 2|F1 SBC 11 5|F5 SBC 4 4|F6 INC 4 6|F8 SED 0 2|F9 SBC 8 4|FD SBC 7 4|FE INC 7 7`;
  for (const e of T.split(/[|\n]/)) { const [op, n, m, c] = e.trim().split(" "); OPS[parseInt(op, 16)] = [n, +m, +c]; }
}
const LEN = [1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 2, 2, 2];

/** NMOS 6502 core (documented opcodes; others stop the run). */
class Cpu {
  constructor(rd, wr) { Object.assign(this, { rd, wr, a: 0, x: 0, y: 0, s: 0xff, pc: 0, c: 0, z: 0, i: 1, d: 0, v: 0, n: 0 }); }
  p() { return (this.n << 7) | (this.v << 6) | 0x30 | (this.d << 3) | (this.i << 2) | (this.z << 1) | this.c; }
  setp(p) { this.n = (p >> 7) & 1; this.v = (p >> 6) & 1; this.d = (p >> 3) & 1; this.i = (p >> 2) & 1; this.z = (p >> 1) & 1; this.c = p & 1; }
  push(v) { this.wr(0x100 | this.s, v & 0xff); this.s = (this.s - 1) & 0xff; }
  pop() { this.s = (this.s + 1) & 0xff; return this.rd(0x100 | this.s); }
  nz(v) { this.n = v >> 7; this.z = v ? 0 : 1; return v; }
  adc(v) {
    if (this.d) {
      let lo = (this.a & 15) + (v & 15) + this.c, hi = (this.a & 0xf0) + (v & 0xf0);
      if (lo > 9) lo += 6;
      if (lo > 15) hi += 16;
      this.z = (this.a + v + this.c) & 0xff ? 0 : 1; this.n = (hi >> 7) & 1;
      this.v = ~(this.a ^ v) & (this.a ^ hi) & 0x80 ? 1 : 0;
      if (hi > 0x90) hi += 0x60;
      this.c = hi > 0xff ? 1 : 0; this.a = ((hi & 0xf0) | (lo & 15)) & 0xff;
    } else {
      const r = this.a + v + this.c;
      this.v = ~(this.a ^ v) & (this.a ^ r) & 0x80 ? 1 : 0; this.c = r > 0xff ? 1 : 0; this.a = this.nz(r & 0xff);
    }
  }
  sbc(v) {
    const r = this.a - v - (1 - this.c);
    if (this.d) {
      let lo = (this.a & 15) - (v & 15) - (1 - this.c), hi = (this.a & 0xf0) - (v & 0xf0);
      if (lo & 16) { lo -= 6; hi -= 16; }
      if (hi & 0x100) hi -= 0x60;
      this.v = (this.a ^ v) & (this.a ^ r) & 0x80 ? 1 : 0; this.c = r >= 0 ? 1 : 0; this.nz(r & 0xff);
      this.a = ((hi & 0xf0) | (lo & 15)) & 0xff;
    } else {
      this.v = (this.a ^ v) & (this.a ^ r) & 0x80 ? 1 : 0; this.c = r >= 0 ? 1 : 0; this.a = this.nz(r & 0xff);
    }
  }
  step() {
    const pc = this.pc, rd = this.rd, e = OPS[rd(pc)];
    if (!e) throw new Error(`intro: unsupported opcode $${rd(pc).toString(16)} at $${pc.toString(16)}`);
    const [name, mode, cyc] = e, b1 = rd((pc + 1) & 0xffff), w = b1 | (rd((pc + 2) & 0xffff) << 8);
    let ea = 0;
    switch (mode) {
      case 3: ea = b1; break; case 4: ea = (b1 + this.x) & 0xff; break; case 5: ea = (b1 + this.y) & 0xff; break;
      case 6: ea = w; break; case 7: ea = (w + this.x) & 0xffff; break; case 8: ea = (w + this.y) & 0xffff; break;
      case 9: ea = rd(w) | (rd((w & 0xff00) | ((w + 1) & 0xff)) << 8); break;
      case 10: { const p = (b1 + this.x) & 0xff; ea = rd(p) | (rd((p + 1) & 0xff) << 8); break; }
      case 11: ea = ((rd(b1) | (rd((b1 + 1) & 0xff) << 8)) + this.y) & 0xffff; break;
    }
    this.pc = (pc + LEN[mode]) & 0xffff;
    const ld = () => (mode === 2 ? b1 : rd(ea));
    const br = (c) => { if (c) this.pc = (this.pc + ((b1 << 24) >> 24)) & 0xffff; };
    const rmw = (f) => { if (mode === 1) this.a = f(this.a); else { const v = rd(ea); this.wr(ea, v); this.wr(ea, f(v)); } };
    const cmp = (r) => { const t = r - ld(); this.c = t >= 0 ? 1 : 0; this.nz(t & 0xff); };
    switch (name) {
      case "LDA": this.a = this.nz(ld()); break; case "LDX": this.x = this.nz(ld()); break; case "LDY": this.y = this.nz(ld()); break;
      case "STA": this.wr(ea, this.a); break; case "STX": this.wr(ea, this.x); break; case "STY": this.wr(ea, this.y); break;
      case "ADC": this.adc(ld()); break; case "SBC": this.sbc(ld()); break;
      case "AND": this.a = this.nz(this.a & ld()); break; case "ORA": this.a = this.nz(this.a | ld()); break;
      case "EOR": this.a = this.nz(this.a ^ ld()); break;
      case "CMP": cmp(this.a); break; case "CPX": cmp(this.x); break; case "CPY": cmp(this.y); break;
      case "BIT": { const v = ld(); this.z = this.a & v ? 0 : 1; this.n = v >> 7; this.v = (v >> 6) & 1; break; }
      case "ASL": rmw((v) => { this.c = v >> 7; return this.nz((v << 1) & 0xff); }); break;
      case "LSR": rmw((v) => { this.c = v & 1; return this.nz(v >> 1); }); break;
      case "ROL": rmw((v) => { const r = ((v << 1) | this.c) & 0xff; this.c = v >> 7; return this.nz(r); }); break;
      case "ROR": rmw((v) => { const r = (v >> 1) | (this.c << 7); this.c = v & 1; return this.nz(r); }); break;
      case "INC": rmw((v) => this.nz((v + 1) & 0xff)); break; case "DEC": rmw((v) => this.nz((v - 1) & 0xff)); break;
      case "INX": this.x = this.nz((this.x + 1) & 0xff); break; case "INY": this.y = this.nz((this.y + 1) & 0xff); break;
      case "DEX": this.x = this.nz((this.x - 1) & 0xff); break; case "DEY": this.y = this.nz((this.y - 1) & 0xff); break;
      case "TAX": this.x = this.nz(this.a); break; case "TAY": this.y = this.nz(this.a); break;
      case "TXA": this.a = this.nz(this.x); break; case "TYA": this.a = this.nz(this.y); break;
      case "TSX": this.x = this.nz(this.s); break; case "TXS": this.s = this.x; break;
      case "PHA": this.push(this.a); break; case "PHP": this.push(this.p()); break;
      case "PLA": this.a = this.nz(this.pop()); break; case "PLP": this.setp(this.pop()); break;
      case "BPL": br(!this.n); break; case "BMI": br(this.n); break; case "BVC": br(!this.v); break; case "BVS": br(this.v); break;
      case "BCC": br(!this.c); break; case "BCS": br(this.c); break; case "BNE": br(!this.z); break; case "BEQ": br(this.z); break;
      case "CLC": this.c = 0; break; case "SEC": this.c = 1; break; case "CLI": this.i = 0; break; case "SEI": this.i = 1; break;
      case "CLD": this.d = 0; break; case "SED": this.d = 1; break; case "CLV": this.v = 0; break; case "NOP": break;
      case "JMP": this.pc = ea; break;
      case "JSR": { const r = (this.pc - 1) & 0xffff; this.push(r >> 8); this.push(r); this.pc = ea; break; }
      case "RTS": { const lo = this.pop(); this.pc = (((this.pop() << 8) | lo) + 1) & 0xffff; break; }
      case "RTI": { this.setp(this.pop()); const lo = this.pop(); this.pc = (this.pop() << 8) | lo; break; }
      default: throw new Error(`intro: ${name} at $${pc.toString(16)}`);
    }
    return cyc;
  }
}

const HEIGHT = { 2: 8, 3: 10, 4: 8, 5: 16, 6: 8, 7: 16, 8: 8, 9: 4, 10: 4, 11: 2, 12: 1, 13: 2, 14: 1, 15: 1 };
const TRAP = { 0xe450: "init", 0xe453: "disk", 0xe459: "disk", 0xe45c: "setvbv", 0xe45f: "sysvbv", 0xe462: "xitvbv",
  0xe465: "init", 0xe474: "warm", 0xffa0: "nmi", 0xffb0: "rti", 0xffc0: "sysvbv", 0xffc8: "xitvbv" };

class Machine {
  constructor(sector) {
    this.sector = sector;
    this.m = new Uint8Array(0x10000);
    this.antic = new Uint8Array(16);
    this.stick = [15, 15, 15, 15]; this.trig = [1, 1, 1, 1]; this.consol = 7;
    this.rng = 0x1ffff; this.line = 0; this.lineCyc = 0; this.frame = 0; this.dl = 0; this.dlStart = 0; this.handoff = null;
    this.cpu = new Cpu((a) => this.read(a), (a, v) => this.write(a, v));
    const m = this.m, w16 = (a, v) => { m[a] = v & 0xff; m[a + 1] = v >> 8; };
    m[0xfffa] = 0xa0; m[0xfffb] = 0xff; m[0xfffe] = 0xb0; m[0xffff] = 0xff;
    w16(0x0222, 0xffc0); w16(0x0224, 0xffc8); w16(0x0200, 0xffb0); w16(0x0216, 0xffb0);
    m[0x022f] = 0x22; m[0x02f4] = 0xe0; m[0x02fc] = 0xff; m[0x6a] = 0xc0; m[0x02f3] = 0x02;
    this.antic[14] = 0x40;
  }
  read(a) {
    if (a < 0xd000 || a >= 0xd800) return this.m[a];
    const r = a & 0xff;
    switch (a & 0xff00) {
      case 0xd000:
        if ((r & 0x1f) >= 0x10 && (r & 0x1f) < 0x14) return this.trig[(r & 0x1f) - 0x10];
        if ((r & 0x1f) === 0x14) return 0x0f;
        if ((r & 0x1f) === 0x1f) return this.consol;
        return 0;
      case 0xd200:
        if ((r & 15) === 10) { this.rng = (this.rng >> 1) | (((this.rng ^ (this.rng >> 5)) & 1) << 16); return (this.rng ^ this.cyc) & 0xff; }
        return (r & 15) < 8 ? 228 : 0xff;
      case 0xd300: return (r & 3) === 0 ? this.stick[0] | (this.stick[1] << 4) : (r & 3) === 1 ? this.stick[2] | (this.stick[3] << 4) : 0xff;
      case 0xd400: return (r & 15) === 11 ? (((this.line + (this.lineCyc >= 97 ? 1 : 0)) % 262) >> 1) : 0xff;
    }
    return 0xff;
  }
  write(a, v) {
    if (a >= 0xd800) return;
    if (a >= 0xd000) {
      if ((a & 0xff00) === 0xd400) {
        const r = a & 15; this.antic[r] = v;
        if (r === 10) this.wsync = true;
        if (r === 2) this.dl = (this.dl & 0xff00) | v;
        if (r === 3) this.dl = (this.dl & 0xff) | (v << 8);
      }
      return;
    }
    this.m[a] = v;
  }
  nmi(kind) { const c = this.cpu; this.nmiKind = kind; c.push(c.pc >> 8); c.push(c.pc); c.push(c.p() & 0xef); c.i = 1; c.pc = 0xffa0; }
  call(addr) {
    const c = this.cpu; c.push(0xff); c.push(0xef); c.pc = addr;
    for (let n = 0; c.pc !== 0xfff0; n++) { if (n > 5e6) throw new Error("intro: subroutine did not return"); this.exec(); }
  }
  trap(t) {
    const c = this.cpu, m = this.m, rts = () => { const lo = c.pop(); c.pc = (((c.pop() << 8) | lo) + 1) & 0xffff; };
    switch (t) {
      case "init": rts(); break;
      case "disk": {
        const cmd = m[0x302], sec = m[0x30a] | (m[0x30b] << 8), buf = m[0x304] | (m[0x305] << 8);
        if (cmd === 0x52) { const d = this.sector(sec); for (let i = 0; i < 128; i++) this.write((buf + i) & 0xffff, d[i]); }
        m[0x303] = 1; c.y = 1; c.nz(1); rts(); break;
      }
      case "setvbv": { const base = c.a === 6 ? 0x222 : c.a === 7 ? 0x224 : 0x218 + (c.a - 1) * 2; m[base] = c.y; m[base + 1] = c.x; rts(); break; }
      case "warm": this.handoff = m.slice(0, 0x1000); throw new Done();
      case "nmi":
        c.push(c.a);
        if (this.nmiKind === "dli") { c.pop(); c.pc = m[0x200] | (m[0x201] << 8); } else { c.push(c.x); c.push(c.y); c.pc = m[0x222] | (m[0x223] << 8); }
        break;
      case "sysvbv": {
        m[0x14] = (m[0x14] + 1) & 0xff; if (!m[0x14]) m[0x13] = (m[0x13] + 1) & 0xff;
        this.antic[0] = m[0x22f]; this.dl = this.dlStart = m[0x230] | (m[0x231] << 8);
        for (let i = 0; i < 4; i++) {
          m[0x278 + i] = this.stick[i]; m[0x284 + i] = this.trig[i];
          m[0x27c + 2 * i] = (this.stick[i] >> 2) & 1; m[0x27d + 2 * i] = (this.stick[i] >> 3) & 1;
          m[0x270 + 2 * i] = 228; m[0x271 + 2 * i] = 228;
        }
        c.pc = m[0x224] | (m[0x225] << 8); break;
      }
      case "xitvbv": c.y = c.pop(); c.x = c.pop(); c.a = c.pop(); // fall through
      case "rti": { c.setp(c.pop()); const lo = c.pop(); c.pc = (c.pop() << 8) | lo; break; }
    }
  }
  exec() {
    const t = TRAP[this.cpu.pc];
    if (t) { this.trap(t); return 12; }
    if (this.cpu.pc >= 0xd800) throw new Error(`intro: call into the Atari ROM at $${this.cpu.pc.toString(16)}`);
    return this.cpu.step();
  }
  frameStep() {
    const A = this.antic, m = this.m;
    let remain = 0, cur = null, halted = false;
    for (this.line = 0; this.line < 262; this.line++) {
      if (this.line === 248 && (A[14] & 0x40)) this.nmi("vbi");
      let dli = false;
      if (this.line >= 8 && this.line < 248 && (A[0] & 0x20) && !halted) {
        if (!remain) {
          const ins = m[this.dl]; this.dl = (this.dl & 0xfc00) | ((this.dl + 1) & 0x3ff);
          const mode = ins & 15;
          if (mode === 0) remain = ((ins >> 4) & 7) + 1;
          else if (mode === 1) { this.dl = m[this.dl] | (m[(this.dl + 1) & 0xffff] << 8); remain = 1; if (ins & 0x40) halted = true; }
          else { remain = HEIGHT[mode]; if (ins & 0x40) this.dl = (this.dl + 2) & 0xffff; }
          cur = ins;
        }
        if (remain === 1 && (cur & 0x80)) dli = true;
        remain--;
      }
      if (dli && (A[14] & 0x80)) this.nmi("dli");
      this.wsync = false;
      for (this.lineCyc = 0; this.lineCyc < 105 && !this.wsync;) { const n = this.exec(); this.lineCyc += n; this.cyc = (this.cyc || 0) + n; }
    }
    this.frame++;
  }
  /** Screen text of ANTIC 2/6/7 lines (rough), to follow the intro. */
  text() {
    const m = this.m; let s = "", dl = this.dl0(), scan = 0;
    for (let g = 0; g < 60; g++) {
      const ins = m[dl]; dl = (dl + 1) & 0xffff; const mode = ins & 15;
      if (mode === 1) { if (ins & 0x40) break; dl = m[dl] | (m[dl + 1] << 8); continue; }
      if (!mode) continue;
      if (ins & 0x40) { scan = m[dl] | (m[dl + 1] << 8); dl += 2; }
      const nb = { 2: 40, 6: 20, 7: 20 }[mode];
      if (nb) for (let i = 0; i < nb; i++) { const c = m[scan + i] & (mode === 2 ? 0x7f : 0x3f); s += c < 64 ? String.fromCharCode(c + 32) : " "; }
      scan += { 2: 40, 3: 40, 4: 40, 5: 40, 6: 20, 7: 20, 8: 10, 9: 10, 10: 20, 11: 20, 12: 20, 13: 40, 14: 40, 15: 40 }[mode] || 0;
      s += " ";
    }
    return s.replace(/\s+/g, " ");
  }
  dl0() { return this.dlStart; }
}
class Done extends Error {}

export const LEVELS = ["BEGINNER", "STANDARD", "TOURNAMENT"];

/**
 * Run the intro with the given choices; returns $0000-$0FFF at the warm
 * start into the main game. Players 1-2 use joysticks 0-1 (the 3RIC's two
 * SNES pads); the others are played by the computer.
 */
export function runIntro(atrBytes, { players = 2, level = "BEGINNER", species = [0, 0, 0, 0] } = {}) {
  if (!(players >= 1 && players <= 2)) throw new Error("players must be 1 or 2 (the 3RIC has two pads)");
  if (!LEVELS.includes(level)) throw new Error(`level must be one of ${LEVELS.join(", ")}`);
  const sector = readAtr(atrBytes);
  const mc = new Machine(sector);
  const s1 = sector(1), n = s1[1], load = s1[2] | (s1[3] << 8);
  for (let i = 0; i < n; i++) mc.m.set(sector(i + 1), load + i * 128);
  mc.m[0x0c] = s1[4]; mc.m[0x0d] = s1[5]; mc.m[0x09] = 1;
  mc.call(load + 6);
  mc.call(mc.m[0x0c] | (mc.m[0x0d] << 8));
  mc.cpu.pc = mc.m[0x0a] | (mc.m[0x0b] << 8); mc.cpu.s = 0xff; mc.cpu.i = 0;
  const run = (f) => { for (let i = 0; i < f; i++) mc.frameStep(); };
  const log = process.env.MULE_INTRO_DEBUG ? (w) => console.log(`[intro f${mc.frame}] ${w}: ${mc.text().slice(0, 120)}`) : () => {};
  const waitFor = (re, max) => { for (let i = 0; i < max; i += 10) { if (re.test(mc.text())) return true; run(10); } return false; };
  const press = (set, f = 20) => { set(true); run(f); set(false); run(20); };
  try {
    if (!waitFor(/OZARK/, 3000)) throw new Error("intro: no title screen");
    log("title");
    run(300);
    press((d) => { mc.trig[0] = d ? 0 : 1; }, 30);
    if (!waitFor(/PRESS START/, 1500)) throw new Error("intro: no options screen");
    for (let k = 0; k < 8 && !new RegExp(`\\b${players} PLANETEER`).test(mc.text()); k++) press((d) => { mc.consol = d ? 5 : 7; }, 15);
    for (let k = 0; k < 4 && !mc.text().includes(level); k++) press((d) => { mc.consol = d ? 3 : 7; }, 15);
    log("options");
    if (!mc.text().includes(level) || !new RegExp(`\\b${players} PLANETEER`).test(mc.text())) throw new Error("intro: options not accepted");
    press((d) => { mc.consol = d ? 6 : 7; }, 20);
    run(300);
    log("controllers");
    for (let p = 0; p < players; p++) { press((d) => { mc.trig[p] = d ? 0 : 1; }); run(100); }
    for (let round = 0; round < 40; round++) {
      for (let p = 0; p < players; p++) {
        const moves = round === 0 ? (species[p] || 0) + 1 : 1;
        for (let k = 0; k < moves; k++) { mc.stick[p] = 7; run(30); mc.stick[p] = 15; run(20); }
        press((d) => { mc.trig[p] = d ? 0 : 1; }, 10);
        run(90);
        if (round < 4) log(`choice ${round}/${p}`);
      }
    }
    throw new Error("intro: the main game was never started");
  } catch (e) {
    if (!(e instanceof Done)) throw e;
  }
  return mc.handoff;
}
