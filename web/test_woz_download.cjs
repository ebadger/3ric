// Milestone — bootable .woz download: verify that a .woz produced by wozgen.mjs
// (the "Download .woz" button on the assembler page) actually boots the assembled
// program through the real $C600 Disk II boot PROM, exactly as a user would with
// "C600G" from the monitor.
//
// Three cases, all proven by RAM peeks (mode-independent) so the assertions are
// robust:
//   1. single-track program (1 page): boots, paints a sentinel string into text
//      RAM, and writes a marker byte — proves the boot loader + copier work.
//   2. multi-track program (~17 pages / 2 tracks): same, plus a sentinel byte at
//      the very end of the payload (on track 1) — proves the loader seeks inward,
//      reads a second track, and relocates the whole image correctly.
//   3. the real staged `swarm` sample (multi-track hi-res): boots without trapping
//      to $0000 and paints a hi-res screen — proves a real-world program works.
//
// Requires web/build.ps1 to have produced badger6502.js/.wasm and staged
// asm6502.mjs + wozgen.mjs + programs/ into web/.
//
// Run with emsdk's bundled node:
//   C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe web\test_woz_download.cjs

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const createBadgerVM = require("./badger6502.js");

const DATA = path.join(__dirname, "data");
const rom = fs.readFileSync(path.join(DATA, "badger6502.bin"));
const font = fs.readFileSync(path.join(DATA, "fontrom.dat"));

const textScanlines = [
  0x0000, 0x0080, 0x0100, 0x0180, 0x0200, 0x0280, 0x0300, 0x0380,
  0x0028, 0x00a8, 0x0128, 0x01a8, 0x0228, 0x02a8, 0x0328, 0x03a8,
  0x0050, 0x00d0, 0x0150, 0x01d0, 0x0250, 0x02d0, 0x0350, 0x03d0,
];
function screenText(vm) {
  let out = "";
  for (let row = 0; row < 24; row++) {
    const base = 0x400 + textScanlines[row];
    for (let col = 0; col < 40; col++) {
      const b = vm.peek(base + col) & 0x7f;
      out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : " ";
    }
    out += "\n";
  }
  return out;
}
function litPixels(vm) {
  const fb = vm.renderFrame();
  let n = 0;
  for (let i = 0; i < fb.length; i += 4) if (fb[i] || fb[i + 1] || fb[i + 2]) n++;
  return n;
}

// Single-page sentinel program: write "WOZBOOT1" to text row 0, marker $A5 -> $1F00.
const SRC_SINGLE = `
        .org $0800
        ldx #0
copy:   lda msg,x
        beq done
        ora #$80
        sta $0400,x
        inx
        bne copy
done:   lda #$a5
        sta $1f00
spin:   jmp spin
msg:    .byte "WOZBOOT1", 0
`;

// Multi-track sentinel program: same, plus a run of filler that pushes the image
// past one track and a known last byte ($5A) at the very end of the payload.
const SRC_MULTI = `
        .org $0800
        ldx #0
copy:   lda msg,x
        beq done
        ora #$80
        sta $0400,x
        inx
        bne copy
done:   lda #$a5
        sta $1f00
spin:   jmp spin
msg:    .byte "WOZMULTI", 0
        .res $1000, $ea
tail:   .byte $5a
`;

function type(vm, s) {
  for (const ch of s) {
    for (let t = 0; t < 200 && (vm.peek(0xc000) & 0x80) !== 0; t++) vm.run(2000);
    vm.keyDown(ch === "\r" ? 0x0d : ch.charCodeAt(0));
    for (let t = 0; t < 20; t++) vm.run(4000);
  }
}

function freshVM(Module) {
  const vm = new Module.WebVM();
  vm.loadData(0x0000, new Uint8Array(rom.subarray(0, 0x10000)));
  vm.seedBasicRom();
  vm.loadFont(new Uint8Array(font));
  vm.reset();
  for (let i = 0; i < 20; i++) vm.run(50000); // settle into the monitor
  return vm;
}

// Boot a .woz and run for a while, watching for a $0000 trap.
function boot(vm, woz) {
  const inserted = vm.insertDisk(0, new Uint8Array(woz));
  const present = vm.diskPresent(0);
  type(vm, "C600G\r");
  let trapped = false;
  for (let chunk = 0; chunk < 120; chunk++) {
    for (let i = 0; i < 50; i++) {
      vm.run(2000);
      if (vm.pc() < 0x0200) trapped = true;
    }
  }
  return { inserted, present, trapped };
}

// Boot a .woz, then poll the text page until every needle string has appeared
// (breaking as soon as it has) — robust to a HUD that is cleared+redrawn every
// frame, unlike a single fixed-cycle sample. Tracks $0000 traps throughout.
function bootAndPoll(vm, woz, needles, maxChunks) {
  const inserted = vm.insertDisk(0, new Uint8Array(woz));
  const present = vm.diskPresent(0);
  type(vm, "C600G\r");
  let trapped = false;
  let seen = false;
  for (let chunk = 0; chunk < maxChunks && !seen; chunk++) {
    for (let i = 0; i < 50; i++) {
      vm.run(2000);
      if (vm.pc() < 0x0200) trapped = true;
    }
    const t = screenText(vm).replace(/\s+/g, "");
    if (needles.every((n) => t.includes(n))) seen = true;
  }
  return { inserted, present, trapped, seen };
}

(async () => {
  const asm = await import(pathToFileURL(path.join(__dirname, "asm6502.mjs")).href);
  const { buildBootableWoz } = await import(pathToFileURL(path.join(__dirname, "wozgen.mjs")).href);
  const hasOrg = (s) => /^\s*(\.org\b|\*=)/mi.test(s);
  const assembleSrc = (s) => (hasOrg(s) ? asm.assemble(s) : asm.assemble(s, { org: 0x0800 }));

  const Module = await createBadgerVM();
  const results = [];

  // --- Case 1: single-track sentinel ---
  {
    const { bytes, org } = assembleSrc(SRC_SINGLE);
    const woz = buildBootableWoz(bytes, org, org);
    const vm = freshVM(Module);
    const b = boot(vm, woz);
    const marker = vm.peek(0x1f00) & 0xff;
    const text = screenText(vm).replace(/\s+/g, "");
    const ok = b.inserted && b.present && !b.trapped && marker === 0xa5 && /WOZBOOT1/.test(text);
    console.log("--- Case 1: single-track (1 page) ---");
    console.log("  pages:", Math.ceil(bytes.length / 256), " woz bytes:", woz.length);
    console.log("  inserted/present:", b.inserted, "/", b.present, " trapped:", b.trapped);
    console.log("  marker $1F00:", "0x" + marker.toString(16), " text has WOZBOOT1:", /WOZBOOT1/.test(text));
    console.log("  =>", ok ? "PASS" : "FAIL");
    results.push(ok);
  }

  // --- Case 2: multi-track sentinel with end-of-payload byte ---
  {
    const { bytes, org } = assembleSrc(SRC_MULTI);
    const woz = buildBootableWoz(bytes, org, org);
    const vm = freshVM(Module);
    const b = boot(vm, woz);
    const marker = vm.peek(0x1f00) & 0xff;
    const lastAddr = org + bytes.length - 1;
    const lastByte = vm.peek(lastAddr) & 0xff;
    const text = screenText(vm).replace(/\s+/g, "");
    const ok = b.inserted && b.present && !b.trapped && marker === 0xa5 &&
               lastByte === 0x5a && /WOZMULTI/.test(text);
    console.log("--- Case 2: multi-track (~17 pages / 2 tracks) ---");
    console.log("  pages:", Math.ceil(bytes.length / 256), " woz bytes:", woz.length);
    console.log("  inserted/present:", b.inserted, "/", b.present, " trapped:", b.trapped);
    console.log("  marker $1F00:", "0x" + marker.toString(16),
                " last byte @$" + lastAddr.toString(16) + ":", "0x" + lastByte.toString(16),
                " text has WOZMULTI:", /WOZMULTI/.test(text));
    console.log("  =>", ok ? "PASS" : "FAIL");
    results.push(ok);
  }

  // --- Case 3: real staged swarm sample (multi-track hi-res) ---
  {
    const swarmPath = path.join(__dirname, "programs", "swarm.s");
    if (fs.existsSync(swarmPath)) {
      const src = fs.readFileSync(swarmPath, "utf8");
      const { bytes, org } = assembleSrc(src);
      const woz = buildBootableWoz(bytes, org, org);
      const vm = freshVM(Module);
      // swarm boots into an animated attract screen whose HUD is cleared+redrawn
      // every frame, so poll until the full title has painted at least once.
      const b = bootAndPoll(vm, woz, ["STARSWARM", "PRESSSPACE"], 400);
      const mode = vm.textMode() ? "TEXT" : (vm.lores() ? "LORES" : "HIRES");
      const lit = litPixels(vm);
      // Strongest proof the multi-track load is byte-perfect: the whole program
      // image in RAM equals the assembled bytes (swarm keeps its vars at $6000+,
      // so its $0800.. image region is untouched while it runs).
      let mism = 0;
      for (let i = 0; i < bytes.length; i++)
        if ((vm.peek(org + i) & 0xff) !== bytes[i]) mism++;
      const ok = b.inserted && b.present && !b.trapped && mode === "HIRES" &&
                 b.seen && mism === 0;
      console.log("--- Case 3: swarm.s (real multi-track hi-res) ---");
      console.log("  pages:", Math.ceil(bytes.length / 256), " org: $" + org.toString(16), " woz bytes:", woz.length);
      console.log("  inserted/present:", b.inserted, "/", b.present, " trapped:", b.trapped);
      console.log("  mode:", mode, " lit px:", lit, " attract painted:", b.seen, " RAM image mismatches:", mism);
      console.log("  =>", ok ? "PASS" : "FAIL");
      results.push(ok);
    } else {
      console.log("--- Case 3: swarm.s SKIPPED (not staged; run web/build.ps1) ---");
    }
  }

  const allOk = results.length > 0 && results.every(Boolean);
  console.log("\n" + (allOk ? "PASS" : "FAIL") + ` (${results.filter(Boolean).length}/${results.length} cases)`);
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
