// M.U.L.E. for 3RIC - a small NMOS 6502 core for the tests
// (port-mule.test.mjs runs the floating-point package, fp.s, on it).
// Documented opcodes only; others stop the run.

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
export class Cpu {
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
