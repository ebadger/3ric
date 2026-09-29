import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assemble } from "./asm6502.mjs";

export const LOAD_ADDRESS = 0x07fd;
export const IMAGE_SIZE = 34307;
export const ORIGINAL_SHA256 = "8740e1181ed35b13b129a8f25aae977d95129e885cb4f7ccfaa9126264c93af3";

function replacement(org, length, source) {
  const result = assemble(source, { org });
  if (result.org !== org || result.bytes.length !== length) {
    throw new Error(`Spy Hunter patch at $${org.toString(16)} must occupy exactly ${length} bytes`);
  }
  return result;
}

export function createInputPatches() {
  const controls = replacement(0x0f86, 58, `
    ; The sole caller at $0ED0 clears $A7/$A8 before sampling input.
    LDA $C061
    ASL A
    ROL $A7
    LDA $C062
    ASL A
    ROL $A8

    LDX #$FF
    LDA $6E
x_bin:
    INX
    CMP $01F1,X
    BCS x_bin
    LDA $0FC0,X
    STA $A9

    LDX #$FF
    LDA $6F
y_bin:
    INX
    CMP $0201,X
    BCS y_bin
    LDA $0FD0,X
    STA $AA
    LDA $0FE0,X
    STA $AB
    RTS

scan_button:
    LDA $C070
    LDA $C061
    RTS
    NOP
    NOP
    NOP
  `);

  const timedWait = replacement(0x0e9f, 34, `
wait:
    LDY #$B4
scan:
    BIT $C070
poll:
    LDA $C000
    BMI done
    LDA $C061
    ORA $C062
    BMI button
    DEC $6E
    BNE poll
    DEY
    BNE scan
    DEX
    BNE wait
button:
    LDA #0
done:
    LDY $C010
    RTS
  `);

  const paddles = replacement(0x0ff0, 34, `
    LDA $C070
    LDX #$7F
    STZ $6E
    STZ $6F
sample:
    ; LDA/ASL A takes the same six cycles as ASL absolute without its write.
    LDA $C064
    ASL A
    LDA $6E
    ADC #0
    STA $6E
    LDA $C065
    ASL A
    LDA $6F
    ADC #0
    STA $6F
    NOP
    DEX
    BNE sample
    RTS
  `);

  const buttonReads = [0x0ec1, 0x0f24, 0x2805].map((org) =>
    replacement(org, 3, `JSR $${controls.symbols.SCAN_BUTTON.toString(16)}`));
  return [timedWait, controls, paddles, ...buttonReads].sort((a, b) => a.org - b.org);
}

export function patchSpyHunter(input) {
  if (!(input instanceof Uint8Array) || input.length !== IMAGE_SIZE) {
    throw new Error(`Expected the ${IMAGE_SIZE}-byte raw spyh07fd.prg image (load address $07FD)`);
  }
  const hash = createHash("sha256").update(input).digest("hex");
  if (hash !== ORIGINAL_SHA256) {
    throw new Error(`Unsupported or already modified Spy Hunter image: SHA-256 ${hash}`);
  }

  const output = new Uint8Array(input);
  let previousEnd = LOAD_ADDRESS;
  for (const patch of createInputPatches()) {
    if (patch.org < previousEnd || patch.org + patch.bytes.length > LOAD_ADDRESS + output.length) {
      throw new Error("Spy Hunter patch ranges overlap or extend outside the original image");
    }
    output.set(patch.bytes, patch.org - LOAD_ADDRESS);
    previousEnd = patch.org + patch.bytes.length;
  }
  return output;
}

function main() {
  const [inputPath, outputPath, ...extra] = process.argv.slice(2);
  if (!inputPath || !outputPath || extra.length) {
    throw new Error("Usage: node codegen\\tools\\patch-spyhunter.mjs <spyh07fd.prg> <new-output.prg>");
  }
  const output = patchSpyHunter(readFileSync(inputPath));
  writeFileSync(outputPath, output, { flag: "wx" });
  console.log(`Wrote ${output.length} bytes to ${outputPath}`);
  console.log(`Load on 3ric: BRUN ${basename(outputPath)} 07FD`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
