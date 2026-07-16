// asm6502.mjs — a small, dependency-free 65C02 assembler for the 3ric toolchain.
//
// Supports: labels (`name:`), equates (`name = expr`), the full documented
// 6502 + common 65C02 instruction set and addressing modes, and the directives
// .org / *=, .byte/.db, .word/.dw, .res/.ds, .asciiz, .text/.asc.
//
// Operands accept: $hex, %bin, decimal, 'c' char literals, the current-PC `*`,
// label arithmetic (label+/-N), and the byte selectors <expr (low) / >expr (high).
//
// Zero-page vs absolute is decided per-instruction in pass 1 and frozen, so
// instruction sizes never shift between passes. Prefix an operand with `z:` to
// force zero page or `a:` to force absolute.
//
// Usage as a module:  import { assemble } from "./asm6502.mjs";
//   const { org, bytes, symbols, listing } = assemble(source, { org: 0x0800 });
// Usage as a CLI:      node asm6502.mjs in.s out.prg [--org 0x0800]

// --- opcode table: MNEMONIC -> { mode: opcodeByte } -----------------------
// modes: imp acc imm zp zpx zpy abs abx aby ind izx izy izp iax rel
const OPC = {
  ADC: { imm:0x69, zp:0x65, zpx:0x75, abs:0x6D, abx:0x7D, aby:0x79, izx:0x61, izy:0x71, izp:0x72 },
  AND: { imm:0x29, zp:0x25, zpx:0x35, abs:0x2D, abx:0x3D, aby:0x39, izx:0x21, izy:0x31, izp:0x32 },
  ASL: { acc:0x0A, zp:0x06, zpx:0x16, abs:0x0E, abx:0x1E },
  BCC: { rel:0x90 }, BCS: { rel:0xB0 }, BEQ: { rel:0xF0 }, BMI: { rel:0x30 },
  BNE: { rel:0xD0 }, BPL: { rel:0x10 }, BVC: { rel:0x50 }, BVS: { rel:0x70 },
  BRA: { rel:0x80 },
  BIT: { imm:0x89, zp:0x24, zpx:0x34, abs:0x2C, abx:0x3C },
  BRK: { imp:0x00 },
  CLC: { imp:0x18 }, CLD: { imp:0xD8 }, CLI: { imp:0x58 }, CLV: { imp:0xB8 },
  CMP: { imm:0xC9, zp:0xC5, zpx:0xD5, abs:0xCD, abx:0xDD, aby:0xD9, izx:0xC1, izy:0xD1, izp:0xD2 },
  CPX: { imm:0xE0, zp:0xE4, abs:0xEC },
  CPY: { imm:0xC0, zp:0xC4, abs:0xCC },
  DEC: { acc:0x3A, zp:0xC6, zpx:0xD6, abs:0xCE, abx:0xDE },
  DEX: { imp:0xCA }, DEY: { imp:0x88 },
  EOR: { imm:0x49, zp:0x45, zpx:0x55, abs:0x4D, abx:0x5D, aby:0x59, izx:0x41, izy:0x51, izp:0x52 },
  INC: { acc:0x1A, zp:0xE6, zpx:0xF6, abs:0xEE, abx:0xFE },
  INX: { imp:0xE8 }, INY: { imp:0xC8 },
  JMP: { abs:0x4C, ind:0x6C, iax:0x7C },
  JSR: { abs:0x20 },
  LDA: { imm:0xA9, zp:0xA5, zpx:0xB5, abs:0xAD, abx:0xBD, aby:0xB9, izx:0xA1, izy:0xB1, izp:0xB2 },
  LDX: { imm:0xA2, zp:0xA6, zpy:0xB6, abs:0xAE, aby:0xBE },
  LDY: { imm:0xA0, zp:0xA4, zpx:0xB4, abs:0xAC, abx:0xBC },
  LSR: { acc:0x4A, zp:0x46, zpx:0x56, abs:0x4E, abx:0x5E },
  NOP: { imp:0xEA },
  ORA: { imm:0x09, zp:0x05, zpx:0x15, abs:0x0D, abx:0x1D, aby:0x19, izx:0x01, izy:0x11, izp:0x12 },
  PHA: { imp:0x48 }, PHP: { imp:0x08 }, PHX: { imp:0xDA }, PHY: { imp:0x5A },
  PLA: { imp:0x68 }, PLP: { imp:0x28 }, PLX: { imp:0xFA }, PLY: { imp:0x7A },
  ROL: { acc:0x2A, zp:0x26, zpx:0x36, abs:0x2E, abx:0x3E },
  ROR: { acc:0x6A, zp:0x66, zpx:0x76, abs:0x6E, abx:0x7E },
  RTI: { imp:0x40 }, RTS: { imp:0x60 },
  SBC: { imm:0xE9, zp:0xE5, zpx:0xF5, abs:0xED, abx:0xFD, aby:0xF9, izx:0xE1, izy:0xF1, izp:0xF2 },
  SEC: { imp:0x38 }, SED: { imp:0xF8 }, SEI: { imp:0x78 },
  STA: { zp:0x85, zpx:0x95, abs:0x8D, abx:0x9D, aby:0x99, izx:0x81, izy:0x91, izp:0x92 },
  STX: { zp:0x86, zpy:0x96, abs:0x8E },
  STY: { zp:0x84, zpx:0x94, abs:0x8C },
  STZ: { zp:0x64, zpx:0x74, abs:0x9C, abx:0x9E },
  TAX: { imp:0xAA }, TAY: { imp:0xA8 }, TSX: { imp:0xBA },
  TXA: { imp:0x8A }, TXS: { imp:0x9A }, TYA: { imp:0x98 },
  TRB: { zp:0x14, abs:0x1C }, TSB: { zp:0x04, abs:0x0C },
  WAI: { imp:0xCB }, STP: { imp:0xDB },
};

const BRANCHES = new Set(["BCC","BCS","BEQ","BMI","BNE","BPL","BVC","BVS","BRA"]);

class AsmError extends Error {
  constructor(msg, line) { super(line != null ? `line ${line}: ${msg}` : msg); this.name = "AsmError"; }
}

// --- expression evaluator --------------------------------------------------
// Grammar (low precedence to high): term (('+'|'-') term)* ; unary '<'/'>' ;
// atom: number | 'c' | * | symbol. Undefined symbols throw (caught in pass 1
// to fall back to absolute sizing).
function evalExpr(expr, symbols, pc, lineNo) {
  let s = expr.trim();
  let i = 0;
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };

  function parseAtom() {
    skip();
    const ch = s[i];
    if (ch === "(") {
      i++; const v = parseSum(); skip();
      if (s[i] !== ")") throw new AsmError(`expected ) in "${expr}"`, lineNo);
      i++; return v;
    }
    if (ch === "*") { i++; return pc; }
    if (ch === "$") { i++; let j = i; while (i < s.length && /[0-9a-fA-F]/.test(s[i])) i++; if (i===j) throw new AsmError(`bad hex in "${expr}"`, lineNo); return parseInt(s.slice(j, i), 16); }
    if (ch === "%") { i++; let j = i; while (i < s.length && /[01]/.test(s[i])) i++; if (i===j) throw new AsmError(`bad binary in "${expr}"`, lineNo); return parseInt(s.slice(j, i), 2); }
    if (ch === "'") { const c = s[i+1]; if (s[i+2] !== "'") throw new AsmError(`bad char literal in "${expr}"`, lineNo); i += 3; return c.charCodeAt(0); }
    if (/[0-9]/.test(ch)) { let j = i; while (i < s.length && /[0-9]/.test(s[i])) i++; return parseInt(s.slice(j, i), 10); }
    if (/[A-Za-z_.]/.test(ch)) {
      let j = i; while (i < s.length && /[A-Za-z0-9_.]/.test(s[i])) i++;
      const name = s.slice(j, i);
      const key = name.toUpperCase();
      if (!(key in symbols)) throw new AsmError(`undefined symbol "${name}"`, lineNo);
      return symbols[key];
    }
    throw new AsmError(`cannot parse expression "${expr}"`, lineNo);
  }
  function parseUnary() {
    skip();
    if (s[i] === "<") { i++; return parseUnary() & 0xFF; }
    if (s[i] === ">") { i++; return (parseUnary() >> 8) & 0xFF; }
    if (s[i] === "-") { i++; return -parseUnary(); }
    if (s[i] === "+") { i++; return parseUnary(); }
    return parseAtom();
  }
  function parseSum() {
    let v = parseUnary();
    for (;;) {
      skip();
      if (s[i] === "+") { i++; v += parseUnary(); }
      else if (s[i] === "-") { i++; v -= parseUnary(); }
      else break;
    }
    return v;
  }
  const v = parseSum(); skip();
  if (i !== s.length) throw new AsmError(`trailing characters in "${expr}"`, lineNo);
  return v;
}

// --- operand parsing: returns { family, expr, force } ----------------------
// family is a mode *group*; concrete zp/abs is resolved later.
function parseOperand(raw) {
  let op = raw.trim();
  let force = null;                       // 'zp' | 'abs'
  const fp = op.match(/^([za]):(.*)$/i);
  if (fp) { force = fp[1].toLowerCase() === "z" ? "zp" : "abs"; op = fp[2].trim(); }

  if (op === "") return { family: "imp", force };
  if (/^[aA]$/.test(op)) return { family: "acc", force };
  if (op[0] === "#") return { family: "imm", expr: op.slice(1), force };

  let m;
  if ((m = op.match(/^\(\s*(.*?)\s*,\s*[xX]\s*\)$/))) return { family: "izx", expr: m[1], force };
  if ((m = op.match(/^\(\s*(.*?)\s*\)\s*,\s*[yY]$/))) return { family: "izy", expr: m[1], force };
  if ((m = op.match(/^\(\s*(.*?)\s*\)$/)))            return { family: "indparen", expr: m[1], force };
  if ((m = op.match(/^(.*?)\s*,\s*[xX]$/)))            return { family: "idxx", expr: m[1], force };
  if ((m = op.match(/^(.*?)\s*,\s*[yY]$/)))            return { family: "idxy", expr: m[1], force };
  return { family: "addr", expr: op, force };
}

// --- main assembler --------------------------------------------------------
export function assemble(source, opts = {}) {
  const lines = source.split(/\r?\n/);
  const symbols = Object.create(null);   // UPPERCASE name -> value
  let org = opts.org != null ? opts.org : null;
  let orgSeen = false;

  // Split a source line into { label, mnem, operand } (comments stripped).
  function splitLine(rawLine) {
    // strip comments (`;`) but not inside char/string literals
    let line = "";
    let inStr = null;
    for (let k = 0; k < rawLine.length; k++) {
      const c = rawLine[k];
      if (inStr) { line += c; if (c === inStr) inStr = null; continue; }
      if (c === '"' || c === "'") { inStr = c; line += c; continue; }
      if (c === ";") break;
      line += c;
    }
    line = line.replace(/\s+$/, "");
    if (line.trim() === "") return null;

    // equate: NAME = expr  (identifier immediately followed by '='; not '*=' / ':' label)
    const eqTop = line.match(/^\s*([A-Za-z_.][A-Za-z0-9_.]*)\s*=\s*(\S.*)$/);
    if (eqTop && eqTop[2][0] !== "=") return { label: null, equate: eqTop[1], expr: eqTop[2] };

    let label = null;
    const m = line.match(/^([A-Za-z_.][A-Za-z0-9_.]*):?\s*(.*)$/);
    let rest = line;
    if (/^\S/.test(line) && m) {
      const ident = m[1];
      const afterColon = line[m[1].length] === ":";
      const remainder = m[2];
      const looksMnemOrDir = OPC[ident.toUpperCase()] || ident[0] === ".";
      if (afterColon) { label = ident; rest = remainder; }
      else if (!looksMnemOrDir) { label = ident; rest = remainder; }
      else { rest = line.trim(); }
    } else {
      rest = line.trim();
    }

    rest = rest.trim();
    if (rest === "") return { label, mnem: null, operand: "" };
    const parts = rest.match(/^(\S+)\s*(.*)$/);
    return { label, mnem: parts[1], operand: parts[2] || "" };
  }

  // Parse a comma-separated argument list honoring quoted strings.
  function splitArgs(operand) {
    const out = []; let cur = ""; let inStr = null;
    for (let k = 0; k < operand.length; k++) {
      const c = operand[k];
      if (inStr) { cur += c; if (c === inStr) inStr = null; continue; }
      if (c === '"' || c === "'") { inStr = c; cur += c; continue; }
      if (c === ",") { out.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    if (cur.trim() !== "" || out.length) out.push(cur.trim());
    return out;
  }

  function parseString(tok, lineNo) {
    if (tok[0] !== '"' || tok[tok.length - 1] !== '"')
      throw new AsmError(`expected quoted string, got ${tok}`, lineNo);
    const body = tok.slice(1, -1);
    const bytes = [];
    for (let k = 0; k < body.length; k++) {
      let c = body[k];
      if (c === "\\") {
        const n = body[++k];
        c = n === "n" ? "\n" : n === "r" ? "\r" : n === "0" ? "\0" : n === "t" ? "\t" : n;
      }
      bytes.push(c.charCodeAt(0) & 0xFF);
    }
    return bytes;
  }

  // Emit records for pass 2, each with a length frozen in pass 1.
  const records = [];
  let pc = 0;

  function requireOrg(lineNo) {
    if (org == null) throw new AsmError("no .org / *= before code or data", lineNo);
    if (!orgSeen) { pc = org; orgSeen = true; }
  }

  // ---- PASS 1: assign addresses, freeze sizes ----
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const parsed = splitLine(rawLine);
    if (!parsed) return;

    // NOTE: symbol names are folded to UPPERCASE, so lookups are
    // case-INSENSITIVE. A constant and a variable that differ only in case
    // (e.g. `BOMBCD` and `bombcd`) collide into one symbol and the later
    // definition silently wins — corrupting `#CONSTANT` immediates with no
    // error. Keep constant names case-insensitively distinct from all labels.
    if (parsed.equate) {
      symbols[parsed.equate.toUpperCase()] = evalExpr(parsed.expr, symbols, pc, lineNo);
      return;
    }
    if (parsed.label) {
      requireOrg(lineNo);
      symbols[parsed.label.toUpperCase()] = pc;
    }
    if (!parsed.mnem) return;

    const mnem = parsed.mnem;
    const dir = mnem.toLowerCase();

    // .org / *=
    if (dir === ".org") {
      const v = evalExpr(parsed.operand, symbols, pc, lineNo);
      pc = v; orgSeen = true; if (org == null) org = v; return;
    }
    if (mnem === "*=" || mnem === "*") {
      const v = evalExpr(parsed.operand.replace(/^=/, ""), symbols, pc, lineNo);
      pc = v; orgSeen = true; if (org == null) org = v; return;
    }
    if (dir === ".byte" || dir === ".db" || dir === ".dc.b" || dir === ".text" || dir === ".asc") {
      requireOrg(lineNo);
      const args = splitArgs(parsed.operand);
      const startPc = pc;
      const items = args.map((a) => a[0] === '"' ? { str: a } : { expr: a });
      let len = 0;
      for (const it of items) len += it.str ? parseString(it.str, lineNo).length : 1;
      records.push({ pc: startPc, len, line: lineNo, kind: "data", gen: (sym) => {
        const b = [];
        for (const it of items) {
          if (it.str) b.push(...parseString(it.str, lineNo));
          else b.push(evalExpr(it.expr, sym, startPc, lineNo) & 0xFF);
        }
        return b;
      }});
      pc += len; return;
    }
    if (dir === ".asciiz") {
      requireOrg(lineNo);
      const args = splitArgs(parsed.operand);
      const startPc = pc;
      let len = 1;
      for (const a of args) len += a[0] === '"' ? parseString(a, lineNo).length : 1;
      records.push({ pc: startPc, len, line: lineNo, kind: "data", gen: (sym) => {
        const b = [];
        for (const a of args) b.push(...(a[0] === '"' ? parseString(a, lineNo) : [evalExpr(a, sym, startPc, lineNo) & 0xFF]));
        b.push(0); return b;
      }});
      pc += len; return;
    }
    if (dir === ".word" || dir === ".dw" || dir === ".dc.w") {
      requireOrg(lineNo);
      const args = splitArgs(parsed.operand);
      const startPc = pc;
      records.push({ pc: startPc, len: args.length * 2, line: lineNo, kind: "data", gen: (sym) => {
        const b = [];
        for (const a of args) { const v = evalExpr(a, sym, startPc, lineNo) & 0xFFFF; b.push(v & 0xFF, (v >> 8) & 0xFF); }
        return b;
      }});
      pc += args.length * 2; return;
    }
    if (dir === ".res" || dir === ".ds") {
      requireOrg(lineNo);
      const args = splitArgs(parsed.operand);
      const n = evalExpr(args[0], symbols, pc, lineNo);
      const fill = args.length > 1 ? evalExpr(args[1], symbols, pc, lineNo) & 0xFF : 0;
      records.push({ pc, len: n, line: lineNo, kind: "data", gen: () => new Array(n).fill(fill) });
      pc += n; return;
    }
    if (dir[0] === ".") throw new AsmError(`unknown directive "${mnem}"`, lineNo);

    // instruction
    const MN = mnem.toUpperCase();
    const table = OPC[MN];
    if (!table) throw new AsmError(`unknown mnemonic "${mnem}"`, lineNo);
    requireOrg(lineNo);

    const po = parseOperand(parsed.operand);
    let mode;
    const isBranch = BRANCHES.has(MN);

    function zpEligible() {
      if (po.force === "abs") return false;
      if (po.force === "zp") return true;
      try { const v = evalExpr(po.expr, symbols, pc, lineNo); return v >= 0 && v < 0x100; }
      catch { return false; }
    }

    switch (po.family) {
      case "imp": mode = table.imp ? "imp" : (table.acc ? "acc" : "imp"); break;
      case "acc": mode = "acc"; break;
      case "imm": mode = "imm"; break;
      case "izx": mode = (MN === "JMP") ? "iax" : "izx"; break;
      case "izy": mode = "izy"; break;
      case "indparen": mode = (MN === "JMP") ? "ind" : "izp"; break;
      case "idxx": mode = (table.zpx && zpEligible()) ? "zpx" : "abx"; break;
      case "idxy": mode = (table.zpy && zpEligible()) ? "zpy" : "aby"; break;
      case "addr":
        if (isBranch) mode = "rel";
        else if (table.zp && zpEligible()) mode = "zp";
        else mode = "abs";
        break;
    }
    if (!(mode in table)) throw new AsmError(`${mnem} does not support that addressing mode (${po.family}${po.force ? "/" + po.force : ""})`, lineNo);

    const size = ({ imp:1, acc:1, imm:2, zp:2, zpx:2, zpy:2, izx:2, izy:2, izp:2, rel:2, abs:3, abx:3, aby:3, ind:3, iax:3 })[mode];
    const opcode = table[mode];
    const startPc = pc;
    const expr = po.expr;
    records.push({ pc: startPc, len: size, line: lineNo, kind: "instruction", gen: (sym) => {
      if (mode === "imp" || mode === "acc") return [opcode];
      const v = evalExpr(expr, sym, startPc, lineNo);
      if (["imm","zp","zpx","zpy","izx","izy","izp"].includes(mode)) return [opcode, v & 0xFF];
      if (mode === "rel") {
        const off = (v & 0xFFFF) - ((startPc + 2) & 0xFFFF);
        if (off < -128 || off > 127) throw new AsmError(`branch out of range (${off}) to $${(v & 0xFFFF).toString(16)}`, lineNo);
        return [opcode, off & 0xFF];
      }
      return [opcode, v & 0xFF, (v >> 8) & 0xFF]; // abs family
    }});
    pc += size;
  });

  // ---- PASS 2: materialise bytes ----
  if (!orgSeen) return { org: 0, bytes: new Uint8Array(0), symbols, listing: [] };
  let minPc = Infinity, maxPc = -Infinity;
  for (const r of records) { minPc = Math.min(minPc, r.pc); maxPc = Math.max(maxPc, r.pc + r.len); }
  if (!isFinite(minPc)) return { org, bytes: new Uint8Array(0), symbols, listing: [] };
  const base = org;
  const out = new Uint8Array(maxPc - base);
  const listing = [];
  for (const r of records) {
    const bytes = r.gen(symbols);
    if (bytes.length !== r.len) throw new AsmError(`internal size mismatch at $${r.pc.toString(16)} (${bytes.length} != ${r.len})`);
    for (let k = 0; k < bytes.length; k++) out[r.pc - base + k] = bytes[k] & 0xFF;
    listing.push({ pc: r.pc, bytes, line: r.line, kind: r.kind });
  }
  return { org, bytes: out, symbols, listing };
}

// --- CLI (Node only) -------------------------------------------------------
// Guarded so this module is also safe to `import { assemble }` in a browser,
// where `process` is undefined and `node:*` specifiers do not resolve. Both the
// guard check and the node: imports are dynamic so nothing Node-specific is
// referenced at load time in the browser.
if (typeof process !== "undefined" && process.argv && process.versions?.node) {
  const { fileURLToPath } = await import("node:url");
  if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const fs = await import("node:fs");
    const args = process.argv.slice(2);
    const positional = args.filter((a) => !a.startsWith("--"));
    const orgIdx = args.findIndex((a) => a === "--org" || a.startsWith("--org="));
    const inFile = positional[0], outFile = positional[1];
    if (!inFile) { console.error("usage: node asm6502.mjs in.s [out.prg] [--org 0x0800]"); process.exit(2); }
    const src = fs.readFileSync(inFile, "utf8");
    let org;
    if (orgIdx >= 0) { const a = args[orgIdx]; org = Number(a.includes("=") ? a.split("=")[1] : args[orgIdx + 1]); }
    try {
      const { org: o, bytes, symbols } = assemble(src, org != null && !Number.isNaN(org) ? { org } : {});
      if (outFile) fs.writeFileSync(outFile, Buffer.from(bytes));
      console.error(`assembled ${bytes.length} bytes @ $${o.toString(16).toUpperCase().padStart(4, "0")}` + (outFile ? ` -> ${outFile}` : ""));
      console.error("symbols:", Object.fromEntries(Object.entries(symbols).map(([k, v]) => [k, "$" + (v & 0xFFFF).toString(16).toUpperCase().padStart(4, "0")])));
    } catch (e) {
      console.error(String(e.message || e)); process.exit(1);
    }
  }
}
