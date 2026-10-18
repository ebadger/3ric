// Run after web/build.ps1: node codegen/tools/port-ultima2.test.mjs
//
// Proves the Ultima II SD-card glue (loader + resident DOS 3.3 command
// translator) on the real ROM DOS and SPI SD emulation using synthetic disks -
// no copyrighted game data. Set U2_DISKS to a folder holding the three
// original disk images to also play the real game: title, character
// creation and save, the overworld, and both patched space disk swaps.
import assert from "node:assert/strict";
import { assemble } from "./asm6502.mjs";
import harness from "./harness.cjs";
import { readDos33Image } from "./ultima2/dos33.mjs";
import { buildSparseFat32 } from "./ultima5/fat32.mjs";
import { DISKS, PATCHES, applyPatches, buildFromDisks, buildTree, sdKey } from "./port-ultima2.mjs";

// ---------------------------------------------------------------------------
// DOS 3.3 reader on a synthetic image with an Origin-style ($FF) VTOC.

function dos33Image(files) {
  const image = new Uint8Array(143360);
  const sec = (t, s) => image.subarray((t * 16 + s) * 256, (t * 16 + s + 1) * 256);
  sec(17, 0).fill(0xff);
  sec(17, 0).set([0x04, 17, 15], 0);
  let next = 3 * 16;                                   // free sectors from track 3
  const alloc = () => { const n = next++; return [n >> 4, n & 15]; };
  const cat = sec(17, 15);
  files.forEach((f, i) => {
    const body = new Uint8Array([f.addr & 255, f.addr >> 8, f.data.length & 255, f.data.length >> 8, ...f.data]);
    const [lt, ls] = alloc();
    const list = sec(lt, ls);
    for (let o = 0, k = 0; o < body.length; o += 256, k++) {
      const [dt, ds] = alloc();
      sec(dt, ds).set(body.subarray(o, o + 256));
      list[0x0c + 2 * k] = dt; list[0x0d + 2 * k] = ds;
    }
    const e = cat.subarray(0x0b + i * 35);
    e[0] = lt; e[1] = ls; e[2] = 0x84;
    e.set(Array.from(f.name.padEnd(30, " "), (c) => c.charCodeAt(0) | 0x80), 3);
  });
  return image;
}

{
  const big = Uint8Array.from({ length: 600 }, (_, i) => (i * 3) & 255);
  const v = readDos33Image(dos33Image([{ name: "MAP 00", addr: 0x1000, data: big }, { name: "TINY", addr: 0x0240, data: [1, 2, 3] }]));
  assert.deepEqual(v.files.map((f) => [f.name, f.type, f.locked, f.addr, f.len]), [["MAP 00", 4, true, 0x1000, 600], ["TINY", 4, true, 0x240, 3]]);
  assert.equal(v.files[0].data[599], big[599]);
  assert.throws(() => readDos33Image(new Uint8Array(1000)), /140 KB/);
  assert.equal(sdKey("ULTIMA II.OBJ"), "ULTIMAII");
  assert.equal(sdKey("MAP 21"), "MAP21");
  assert.equal(sdKey("TABLES.903C.OBJ"), "TABLES90");
  assert.equal(sdKey("MONSTERS!"), "MONSTERS");
  console.log("PASS DOS 3.3 reader ($FF VTOC) and SD key mapping");
}

// ---------------------------------------------------------------------------
// Disk-prompt patches: exact, idempotent, guarded.

{
  const disks = new Map(DISKS.map((d) => [d.n, { files: [] }]));
  const files = new Map();
  for (const p of PATCHES) {
    const id = `${p.disk}/${p.file}`;
    if (!files.has(id)) {
      const f = { name: p.file, addr: p.address & 0xf000, data: new Uint8Array(0x1100) };
      files.set(id, f);
      disks.get(p.disk).files.push(f);
    }
    files.get(id).data.set(p.before, p.address - files.get(id).addr);
  }
  applyPatches(disks);
  for (const p of PATCHES) {
    const f = files.get(`${p.disk}/${p.file}`);
    assert.deepEqual(Array.from(f.data.subarray(p.address - f.addr, p.address - f.addr + p.after.length)), p.after, p.why);
  }
  const main = files.get("1/ULTIMA II.OBJ");
  assert.equal(main.data[0x00d], 0x04, "prompt starts with Ctrl-D");
  assert.equal(String.fromCharCode(...main.data.subarray(0x00e, 0x014)), "DISK 2");
  assert.equal(main.data[0x020], 0x0d, "and ends with CR before the NUL");
  assert.equal(PATCHES.length, 14, "seven prompt sites (STARS.OBJ on two disks), each with its ESC wait");
  applyPatches(disks); // idempotent
  main.data[0x02a] = 0x00;
  assert.throws(() => applyPatches(disks), /unexpected bytes/);
  console.log("PASS disk-prompt patches are exact and guarded");
}

// ---------------------------------------------------------------------------
// Translator end to end on the ROM DOS with synthetic disks.

const RES = 0x0300;
const prelude = `
COUT = $FDED
RES = $${RES.toString(16)}
        .org $6000
        jmp start
pr:     pla                     ; inline string printer, like Ultima II's
        sta $FE
        pla
        sta $FF
pr_l:   inc $FE
        bne pr_c
        inc $FF
pr_c:   ldy #0
        lda ($FE),y
        beq pr_done
        ora #$80
        jsr COUT
        bra pr_l
pr_done:
        lda $FF
        pha
        lda $FE
        pha
        rts
start:
`;
const mainSrc = prelude + `
        jsr pr
        .byte "PORT TEST",$0D,0
        jsr pr
        .byte $04,"NOMON I,O,C",$0D,0
        ldx #$5A                ; registers survive COUT
        ldy #$A5
        lda #$C1
        jsr COUT
        sta RES+5
        stx RES+6
        sty RES+7
        lda #$EE
        sta $312C
        jsr pr
        .byte $04,"BLOAD DATA ONE",$0D,0
        lda $312C
        sta RES+0
        jsr pr
        .byte $04,"BLOAD DATA ONE,A$3400",$0D,0
        jsr pr
        .byte $04,"DISK 2",$0D,0
        jsr pr
        .byte $04,"BLOAD MAP 00",$0D,0
        lda $1000
        sta RES+1
        jsr pr
        .byte $04,"DISK 3",$0D,0
        jsr pr
        .byte $04,"BLOAD MAP 00",$0D,0
        lda $1000
        sta RES+2
        jsr pr
        .byte $04,"DISK 2",$0D,0
        ldx #63
fill:   txa
        eor #$5A
        sta $3800,x
        dex
        bpl fill
        jsr pr
        .byte $04,"BSAVE SAVE,A$3800,L$40",$0D,0
        jsr pr
        .byte $04,"BLOAD SAVE,A$3900",$0D,0
        ldx #63
        ldy #0
cmp1:   lda $3800,x
        cmp $3900,x
        beq cmp1ok
        iny
cmp1ok: dex
        bpl cmp1
        sty RES+3
        lda #$3C                ; BASIC ROM stays off: $9500 is RAM
        sta $9500
        lda $9500
        sta RES+4
        jsr pr
        .byte $04,"BRUN FINISH",$0D,0
        lda #$FF
        sta RES+31
hang:   jmp hang
`;
const finishSrc = `
        .org $5000
        lda #$AA
        sta $${(RES + 30).toString(16)}
done:   jmp done
`;
const errSrc = (cmds) => prelude + cmds.map((c) => `        jsr pr\n        .byte $04,"${c}",$0D,0\n`).join("") + `
        lda #$FF
        sta RES+31
hang:   jmp hang
`;

function synthDisks(helloSrc) {
  const file = (name, addr, bytes) => ({ name, type: 4, addr, len: bytes.length, data: new Uint8Array(bytes) });
  const data = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 255);
  const disks = new Map([
    [1, { files: [file("HELLO", 0x6000, assemble(helloSrc).bytes), file("DATA ONE", 0x3000, data)] }],
    [2, { files: [file("MAP 00", 0x1000, new Uint8Array(16).fill(0x22)), file("SAVE", 0x3800, new Uint8Array(64)),
      file("FINISH", 0x5000, assemble(finishSrc).bytes)] }],
    [3, { files: [file("MAP 00", 0x1000, new Uint8Array(16).fill(0x33))] }],
  ]);
  return { disks, data };
}

async function bootGame(tree) {
  const s = await harness.boot({ sd: buildSparseFat32({ U2: tree }, { label: "3RIC U2" }) });
  const vm = s.vm;
  for (const line of ["CD U2\r", "BRUN U2.PRG 0800\r"]) {
    for (const ch of line) {
      vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0));
      for (let i = 0; i < 8; i++) vm.run(20000);
    }
    for (let i = 0; i < 40; i++) vm.run(50000);
  }
  return s;
}

{
  const { disks, data } = synthDisks(mainSrc);
  const info = {};
  const tree = buildFromDisks(disks, info);
  assert.deepEqual(Object.keys(tree), ["U2.PRG", "PROGRAM", "PLAYER", "GALACTIC"]);
  assert.deepEqual(Object.keys(tree.PROGRAM), ["HELLO", "DATAONE"]);
  assert.notEqual(tree.PLAYER.MAP00[0], tree.GALACTIC.MAP00[0]);
  const s = await bootGame(tree);
  const vm = s.vm;
  let serial = "";
  let fload = null;                                  // CPU status at ROM FLOAD entry
  vm.addBreakpoint(0xef4e);
  for (let i = 0; i < 4000 && vm.peek(RES + 30) !== 0xaa && vm.peek(RES + 31) !== 0xff; i++) {
    vm.run(20000);
    serial += vm.drainOutput();
    if (vm.breakpointHit() && fload === null) { fload = vm.status(); vm.removeBreakpoint(0xef4e); }
  }
  vm.removeBreakpoint(0xef4e);
  serial += vm.drainOutput();
  assert.ok(fload !== null && (fload & 0x04), "ROM DOS commands run with IRQs masked (no pad scan mid-SD transfer)");
  const r = (n) => vm.peek(RES + n);
  assert.equal(r(30), 0xaa, `BRUN FINISH ran (results ${Array.from({ length: 8 }, (_, i) => r(i).toString(16))}, serial ${JSON.stringify(serial.slice(-300))})`);
  assert.equal(r(0), 0xee, "BLOAD stops exactly at EOF");
  for (let i = 0; i < 300; i++) assert.equal(vm.peek(0x3000 + i), data[i]);
  assert.equal(vm.peek(0x3400 + 299), data[299], ",A$ overrides the file's address");
  assert.equal(r(1), 0x22, "DISK 2: the player disk's MAP 00");
  assert.equal(r(2), 0x33, "DISK 3: the galactic disk's own MAP 00");
  assert.equal(r(3), 0, "BSAVE wrote the file in place and it reads back");
  assert.equal(r(4), 0x3c, "BASIC ROM overlay stays off");
  assert.deepEqual([r(5), r(6), r(7)], [0xc1, 0x5a, 0xa5], "COUT keeps A, X and Y");
  const screen = s.textScreen();
  const at = screen.findIndex((l) => l.startsWith("PORT TEST"));
  assert.ok(at >= 0 && screen[at + 1].startsWith("A"), `ordinary text reaches the screen: ${screen.join("|")}`);
  assert.ok(!screen.some((l) => /BLOAD|FLOAD|NOMON/.test(l)), "commands are not echoed");
  const R = info.resident.symbols;
  for (let a = R.FILETAB; a < 0x9600 + info.resident.bytes.length; a++) assert.equal(vm.peek(a), info.resident.bytes[a - 0x9600]);
  for (const cmd of ["CD PROGRAM\r", "FLOAD HELLO 6000 0000 ", "FLOAD DATAONE 3000 0000 012B\r", "FLOAD DATAONE 3400 0000 012B\r",
    "CD ..\rOK\rCD PLAYER\r", "FLOAD MAP00 1000 0000 000F\r", "CD GALACTIC\r", "OWRITE SAVE 3800 0040\r", "FLOAD SAVE 3900 0000 003F\r", "FLOAD FINISH 5000 0000 "])
    assert.ok(serial.includes(cmd), `ROM DOS saw ${JSON.stringify(cmd)}`);
  assert.doesNotMatch(serial, /NOMON|BLOAD|BSAVE|NOFIND|ERR\r/, "only ROM DOS verbs reach the ROM, and none failed");
  console.log("PASS translator on ROM DOS: BLOAD/BRUN/BSAVE, disk folders, exact lengths, text passthrough");
}

for (const [cmds, message] of [
  [["DISK 2", "BLOAD DATA ONE"], "FILE NOT ON THIS DISK"],
  [["DISK 2", "BSAVE SAVE,A$3800,L$20"], "BSAVE NOT A WHOLE FILE"],
  [["CATALOG"], "UNKNOWN DOS COMMAND"],
]) {
  const { disks } = synthDisks(errSrc(cmds));
  const s = await bootGame(buildFromDisks(disks));
  const vm = s.vm;
  let serial = "";
  for (let i = 0; i < 1500 && !harness.MONITOR_DUMP.test(serial) && vm.peek(RES + 31) !== 0xff; i++) { vm.run(20000); serial += vm.drainOutput(); }
  assert.notEqual(vm.peek(RES + 31), 0xff, `${cmds.at(-1)} must not succeed`);
  assert.match(serial, harness.MONITOR_DUMP, "stops in the monitor");
  assert.ok(s.textScreen().some((l) => l.includes(message)), `screen says ${message}: ${s.textScreen().join("|")}`);
  assert.ok(vm.textMode(), "text mode for the message");
  assert.equal(vm.readBus(0xc40e) & 0x40, 0, "the gamepad timer is off in the monitor");
  assert.doesNotMatch(serial, /OWRITE|FLOAD DATAONE/, "the ROM never saw the bad command");
}
console.log("PASS missing file, partial BSAVE and unknown commands stop in the monitor with a message");

// ---------------------------------------------------------------------------
// SNES gamepads -> keys, through the real ROM pad scan (setGamepadState feeds
// the VIA1 shift registers the ROM clocks).

const TICK = 52448;                                 // ~30 Hz Mockingboard T1 period
const runFor = (vm, n) => { let c = 0; while (c < n) c += vm.run(Math.min(20000, n - c)) || 1; };
const padSrc = prelude + `
KEYS = $3000
        jsr pr                  ; pads keep working after a ROM DOS command
        .byte $04,"DISK 2",$0D,$04,"BLOAD MAP 00",$0D,0
        ldx #$5A                ; X/Y must survive every pad IRQ
        ldy #$A5
loop:   lda #$3C                ; so must A and the flags
        sec
        bcc bad
        cmp #$3C
        bne bad
        cpx #$5A
        bne bad
        cpy #$A5
        bne bad
        lda RES+22              ; test can pause the consumer
        bne loop
        lda $C000
        bpl loop
        bit $C010
        phx
        ldx RES+20
        sta KEYS,x
        inc RES+20
        plx
        bra loop
bad:    lda #$EE
        sta RES+21
hang:   jmp hang
`;
{
  const { disks } = synthDisks(padSrc);
  const info = {};
  const s = await bootGame(buildFromDisks(disks, info));
  const vm = s.vm;
  const R = info.resident.symbols;
  runFor(vm, 4 * TICK);
  const keys = () => Array.from({ length: vm.peek(RES + 20) }, (_, i) => vm.peek(0x3000 + i));
  const clear = () => vm.poke(RES + 20, 0);
  const press = (pad, button, ticks) => { vm.setGamepadState(pad, 1 << button); runFor(vm, ticks * TICK); vm.setGamepadState(pad, 0); runFor(vm, 3 * TICK); };

  clear();
  for (let b = 0; b < 12; b++) press(b & 1, b, 2);  // odd buttons on pad 2
  //            B    Y    SEL  START UP   DOWN LEFT RIGHT A    X    L    R
  assert.deepEqual(keys(), [0xc5, 0xc7, 0x9b, 0xa0, 0x8d, 0xaf, 0x88, 0x95, 0xc1, 0xd4, 0xda, 0xc9], "each button on either pad types its key once");

  clear();
  press(0, 5, 30);                                   // D-pad down held ~1 s
  const downs = keys();
  assert.ok(downs.every((k) => k === 0xaf) && downs.length >= 5 && downs.length <= 8, `held D-pad repeats (${downs.length})`);
  clear();
  press(0, 8, 30);                                   // A held ~1 s
  assert.deepEqual(keys(), [0xc1], "other buttons do not repeat");

  clear();
  vm.poke(RES + 22, 1);                              // consumer paused
  runFor(vm, 2000);                                  // ...and parked in its pause loop
  vm.keyDown("Q".charCodeAt(0));                     // a typed key is pending
  vm.setGamepadState(1, 1 << 0);                     // B held meanwhile
  runFor(vm, 4 * TICK);
  assert.equal(vm.peek(0xc000), 0xd1, "a pending typed key is never overwritten");
  vm.poke(RES + 22, 0);
  runFor(vm, 3 * TICK);
  vm.setGamepadState(1, 0);
  runFor(vm, 3 * TICK);
  assert.deepEqual(keys(), [0xd1, 0xc5], "the pad key follows once the latch is free");
  assert.equal(vm.peek(RES + 21), 0, "A, X, Y and the flags survive the pad IRQ");

  let irqs = 0, scanNmis = 0, cycles = 0, inLoop = 0;
  vm.setGamepadState(0, 1 << 4);                     // a pressed pad: full IRQ path
  while (cycles < 30 * TICK) {
    const pc = vm.pc();
    if (pc === R.PAD_IRQ) irqs++;
    if (pc === 0xf1bb && (vm.readBus(0xc20d) & 0x68)) scanNmis++;   // CB2 scan, T1/T2 paddle timers (CB1 is our $C010)
    const c = vm.step();
    cycles += c;
    if (pc >= 0x6000 && pc < 0x6100) inLoop += c;
  }
  vm.setGamepadState(0, 0);
  assert.ok(irqs >= 29 && irqs <= 31, `~30 Hz poll (${irqs} ticks in 30 periods)`);
  assert.equal(scanNmis, 0, "polling raises no scan or paddle-timer NMIs (no $C070)");
  const overhead = 1 - inLoop / cycles;
  assert.ok(overhead < 0.03, `poller costs ${(overhead * 100).toFixed(1)}% of the CPU`);
  console.log(`PASS SNES pads: 12-button map on both pads, D-pad repeat, pending keys kept, registers safe, no scan NMIs, ${irqs} ticks/s, ${(overhead * 100).toFixed(1)}% CPU`);
}

{
  const { disks } = synthDisks(errSrc([]));
  const tree = buildFromDisks(disks);
  delete tree.PROGRAM.HELLO;                       // an incomplete card
  const s = await bootGame(tree);
  let serial = "";
  for (let i = 0; i < 300 && !harness.MONITOR_DUMP.test(serial); i++) { s.vm.run(20000); serial += s.vm.drainOutput(); }
  assert.match(serial, harness.MONITOR_DUMP, "a HELLO that did not load stops in the monitor");
  assert.ok(s.textScreen().some((l) => l.includes("HELLO DID NOT LOAD")), `instead of running stale memory: ${s.textScreen().join("|")}`);
  assert.equal(s.vm.readBus(0xc40e) & 0x40, 0, "with the gamepad timer off");
  console.log("PASS a card without HELLO stops with a message instead of running stale memory");
}

// ---------------------------------------------------------------------------
// Optional: the real game.

if (process.env.U2_DISKS) {
  const info = {};
  const tree = buildTree(process.env.U2_DISKS, info);
  const s = await bootGame(tree);
  const vm = s.vm;
  let serial = "";
  const run = (n) => { for (let i = 0; i < n; i++) { vm.run(50000); serial += vm.drainOutput(); } };
  const type = (str) => { for (const ch of str) { vm.keyDown(ch === "\r" ? 13 : ch.charCodeAt(0)); run(4); } };
  const until = (addr) => {
    vm.addBreakpoint(addr);
    let hit = false;
    for (let i = 0; i < 4000 && !hit; i++) { vm.run(5000); serial += vm.drainOutput(); hit = vm.breakpointHit(); }
    vm.removeBreakpoint(addr);
    return hit;
  };
  const same = (a, bytes) => bytes.every((b, i) => vm.peek(a + i) === b);
  run(900);
  assert.ok(s.textScreen().some((l) => l.includes("PLAY A GAME OF ULTIMA")), "title sequence reaches the menu");
  type("C"); run(300);
  type("15\r15\r15\r15\r15\r15\r"); type("M"); type("1"); type("1"); type("IOLO\r"); run(20);
  type("Y"); run(700);
  assert.match(serial, /CD PLAYER\rOK\rFLOAD PLAYER 4E00 0000 00FF\r[^]*OWRITE PLAYER 4E00 0100\r[^]*CD PROGRAM\r/, "creation saves on the player disk and returns");
  type("P"); run(500);
  assert.ok(!vm.textMode() && vm.mixed(), "overworld in mixed hi-res");
  assert.match(serial, /FLOAD ULTIMAII 5000 0000 38CE\r[^]*FLOAD MAP20 1000 0000 0FFF\r/, "game loads its first map");
  assert.equal(String.fromCharCode(...[0, 1, 2, 3].map((i) => vm.peek(0x4e00 + i) & 0x7f)), "IOLO");
  vm.setGamepadState(0, 1 << 5);                     // D-pad down on pad 1
  run(3);
  vm.setGamepadState(0, 0);
  run(40);
  assert.ok(s.textScreen().some((l) => l.startsWith("CMD: SOUTH")), `pad moves the party: ${s.textScreen().slice(20).join("|")}`);
  // The space-travel disk swaps, run in place in the patched STARS.OBJ.
  vm.loadData(0x8900, tree.PLAYER.STARSOBJ);
  vm.poke(0x4e37, 3);
  vm.setPC(0x9002);
  assert.ok(until(0x9032), "galactic swap returns without waiting for ESC");
  vm.setPC(0x6706);
  assert.ok(until(0x673e));
  assert.ok(same(0x1000, tree.GALACTIC.MAP30) && !same(0x1000, tree.PLAYER.MAP30), "planet map comes from the galactic disk");
  vm.setPC(0x8fd4);
  assert.ok(until(0x9001), "player swap returns without waiting for ESC");
  vm.poke(0x4e37, 0);
  vm.setPC(0x6706);
  assert.ok(until(0x673e));
  assert.ok(same(0x1000, tree.PLAYER.MAP40), "Earth map comes from the player disk");
  assert.doesNotMatch(serial, /NOFIND|ERR\r|ULTIMA II PORT/);
  console.log("PASS original Ultima II: title, creation + save, overworld, galactic/player disk swaps");
} else {
  console.log("SKIP real-disk play (set U2_DISKS to the folder with the three images)");
}
