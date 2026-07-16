import { assemble } from "./asm6502.mjs";

let fails = 0;
function eqBytes(name, got, expected) {
  const g = Array.from(got).map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const e = expected.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const ok = g === e;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) { console.log("   got     :", g); console.log("   expected:", e); }
}
function eqJson(name, got, expected) {
  const g = JSON.stringify(got);
  const e = JSON.stringify(expected);
  const ok = g === e;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) { console.log("   got     :", g); console.log("   expected:", e); }
}

// 1) The full "HI via COUT" loop — verifies labels, abs,X, branches, .byte string.
const hi = `
        .org $0800
        COUT = $FDED
        ldx #0
loop:   lda msg,x
        beq done
        jsr COUT
        inx
        bne loop
done:   brk
msg:    .byte "HI", $8D, 0
`;
const hiResult = assemble(hi);
eqBytes("HI loop", hiResult.bytes,
  [0xA2,0x00, 0xBD,0x0E,0x08, 0xF0,0x06, 0x20,0xED,0xFD, 0xE8, 0xD0,0xF5, 0x00, 0x48,0x49,0x8D,0x00]);
eqJson("source listing metadata",
  hiResult.listing.map(({ pc, line, kind }) => ({ pc, line, kind })),
  [
    { pc:0x0800, line:4, kind:"instruction" },
    { pc:0x0802, line:5, kind:"instruction" },
    { pc:0x0805, line:6, kind:"instruction" },
    { pc:0x0807, line:7, kind:"instruction" },
    { pc:0x080A, line:8, kind:"instruction" },
    { pc:0x080B, line:9, kind:"instruction" },
    { pc:0x080D, line:10, kind:"instruction" },
    { pc:0x080E, line:11, kind:"data" },
  ]);

// 2) Addressing-mode coverage.
const modes = `
        .org $0800
        lda #$80
        lda $fe
        lda $fe,x
        ldx $fe,y
        lda $2000
        lda $2000,x
        lda $2000,y
        lda ($fe)
        lda ($fe,x)
        lda ($fe),y
        sta $c100
        stz $2000
        jmp ($2000)
        jmp ($2000,x)
        inc a
        dec a
        asl a
        ror
        phx
        wai
`;
eqBytes("modes", assemble(modes).bytes, [
  0xA9,0x80,
  0xA5,0xFE,
  0xB5,0xFE,
  0xB6,0xFE,
  0xAD,0x00,0x20,
  0xBD,0x00,0x20,
  0xB9,0x00,0x20,
  0xB2,0xFE,
  0xA1,0xFE,
  0xB1,0xFE,
  0x8D,0x00,0xC1,
  0x9C,0x00,0x20,
  0x6C,0x00,0x20,
  0x7C,0x00,0x20,
  0x1A,
  0x3A,
  0x0A,
  0x6A,
  0xDA,
  0xCB,
]);

// 3) < and > byte selectors + .word + forward ref sizing.
const sel = `
        .org $0800
        lda #<target
        lda #>target
        .word target
target: rts
`;
// target = $0800 + 2 + 2 + 2 = $0806
eqBytes("selectors+word", assemble(sel).bytes,
  [0xA9,0x06, 0xA9,0x08, 0x06,0x08, 0x60]);

// 4) forced zp/abs.
const forced = `
        .org $0800
        lda a:$00fe
        lda z:label
label:  rts
`;
// lda a:$00fe -> abs AD FE 00 ; label = $0805 ; lda z:label -> A5 05
eqBytes("forced zp/abs", assemble(forced).bytes,
  [0xAD,0xFE,0x00, 0xA5,0x05, 0x60]);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
