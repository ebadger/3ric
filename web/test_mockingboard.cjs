// Hardware-contract test for the slot-4 3RIC Mockingboard.
//
// Run with:
//   C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe web\test_mockingboard.cjs

const assert = require("node:assert/strict");
const createBadgerVM = require("./badger6502.js");

const VIA = {
  ORB: 0,
  ORA: 1,
  DDRB: 2,
  DDRA: 3,
  T1CL: 4,
  T1CH: 5,
  T1LL: 6,
  T1LH: 7,
  T2CL: 8,
  T2CH: 9,
  ACR: 11,
  IFR: 13,
  IER: 14,
};

function prepareIdleLoop(vm) {
  vm.poke(0x0800, 0x4c); // JMP $0800
  vm.poke(0x0801, 0x00);
  vm.poke(0x0802, 0x08);
  vm.setPC(0x0800);
}

function readTimer(vm, base, lowRegister) {
  const low = vm.readBus(base + lowRegister);
  return low | (vm.readBus(base + lowRegister + 1) << 8);
}

function assertTimersQuiet(vm, base) {
  assert.equal(vm.readBus(base + VIA.IFR), 0, "unarmed timer set IFR");
  assert.equal(vm.irqAsserted(), false, "unarmed timer asserted IRQ");
}

function resetTimerContract(Module) {
  for (const base of [0xc400, 0xc480]) {
    const vm = new Module.WebVM();
    try {
      vm.reset();
      vm.writeBus(base + VIA.IER, 0xe0);
      vm.loadData(0x0800, new Uint8Array([0xea, 0xea, 0xea, 0xea]));
      let t1 = readTimer(vm, base, VIA.T1CL);
      let t2 = readTimer(vm, base, VIA.T2CL);
      let lowByteWrapped = false;
      for (let i = 0; i < 33; i++) {
        vm.setPC(0x0800);
        assert.equal(vm.run(4), 8);
        assertTimersQuiet(vm, base);
        const nextT1 = readTimer(vm, base, VIA.T1CL);
        const nextT2 = readTimer(vm, base, VIA.T2CL);
        assert.equal(nextT1, (t1 - 8) & 0xffff);
        assert.equal(nextT2, (t2 - 8) & 0xffff);
        lowByteWrapped ||= (nextT1 & 0xff) > (t1 & 0xff);
        t1 = nextT1;
        t2 = nextT2;
      }
      assert.ok(lowByteWrapped, "cold counter checks must cross a low-byte wrap");

      // Original synthetic detector: two indirect reads eight PHI2 cycles apart.
      // Align by elapsed cycles, never by programming a timer or assuming its seed.
      prepareIdleLoop(vm);
      vm.runCycles((vm.readBus(base + VIA.T1CL) - 6) & 0xff);
      vm.poke(0x20, base & 0xff);
      vm.poke(0x21, base >> 8);
      vm.loadData(0x0900, new Uint8Array([
        0xa0, 0x04,       // LDY #T1CL
        0xb1, 0x20,       // LDA ($20),Y
        0x85, 0x22,       // STA $22
        0xb1, 0x20,       // LDA ($20),Y
        0x38,             // SEC
        0xe5, 0x22,       // SBC $22
        0x85, 0x23,       // STA $23
        0xc9, 0xf8,       // CMP #$F8
      ]));
      vm.setPC(0x0900);
      assert.equal(vm.run(8), 25);
      assert.equal(vm.peek(0x23), 0xf8, "6502 cold VIA probe must measure -8");
      assert.ok(vm.status() & 0x02, "6502 probe comparison must set Z");
      assert.ok(vm.peek(0x22) < 8, "6502 probe must cross a low-byte wrap");
      assertTimersQuiet(vm, base);

      t1 = readTimer(vm, base, VIA.T1CL);
      t2 = readTimer(vm, base, VIA.T2CL);
      vm.reset();
      assert.equal(readTimer(vm, base, VIA.T1CL), t1);
      assert.equal(readTimer(vm, base, VIA.T2CL), t2);
      assert.equal(vm.readBus(base + VIA.IER), 0x80);
      assert.equal(vm.readBus(base + VIA.ACR), 0);
      assertTimersQuiet(vm, base);
      vm.writeBus(base + VIA.IER, 0xe0);
      prepareIdleLoop(vm);
      const cycles = vm.runCycles(0x10008);
      assertTimersQuiet(vm, base);
      assert.equal(readTimer(vm, base, VIA.T1CL), (t1 - cycles) & 0xffff);
      assert.equal(readTimer(vm, base, VIA.T2CL), (t2 - cycles) & 0xffff);

      // Only now program timers, then reset before either armed timeout expires.
      vm.writeBus(base + VIA.ACR, 0xc0);
      vm.writeBus(base + VIA.T1CL, 9);
      vm.writeBus(base + VIA.T1CH, 0);
      vm.writeBus(base + VIA.T2CL, 10);
      vm.writeBus(base + VIA.T2CH, 0);
      assert.equal(vm.run(1), 3);
      vm.writeBus(base + VIA.T1LL, 0x34);
      vm.writeBus(base + VIA.T1LH, 0x12);
      vm.writeBus(base + VIA.T2CL, 0x78);
      vm.reset();
      assert.equal(readTimer(vm, base, VIA.T1CL), 6);
      assert.equal(readTimer(vm, base, VIA.T2CL), 7);
      assert.equal(vm.readBus(base + VIA.T1LL), 0x34);
      assert.equal(vm.readBus(base + VIA.T1LH), 0x12);
      assertTimersQuiet(vm, base);
      vm.writeBus(base + VIA.IER, 0xe0);
      vm.writeBus(base + VIA.ACR, 0xc0);
      prepareIdleLoop(vm);
      assert.equal(vm.runCycles(9), 9);
      assertTimersQuiet(vm, base);
      assert.equal(readTimer(vm, base, VIA.T1CL), 0x1232);
      assert.equal(readTimer(vm, base, VIA.T2CL), 0xfffe);
      assert.equal(vm.readBus(base + VIA.ORB) & 0x80, 0x80);
      vm.writeBus(base + VIA.T2CH, 0);
      assert.equal(readTimer(vm, base, VIA.T2CL), 0x78);
    } finally {
      vm.delete();
    }
  }
  return true;
}

function prepareAY(vm, base) {
  vm.writeBus(base + VIA.DDRA, 0xff);
  vm.writeBus(base + VIA.DDRB, 0x07);
  vm.writeBus(base + VIA.ORB, 0x04);
}

function writeAY(vm, base, reg, data) {
  vm.writeBus(base + VIA.ORA, reg);
  vm.writeBus(base + VIA.ORB, 0x07);
  vm.writeBus(base + VIA.ORB, 0x04);
  vm.writeBus(base + VIA.ORA, data);
  vm.writeBus(base + VIA.ORB, 0x06);
  vm.writeBus(base + VIA.ORB, 0x04);
}

function programToneA(vm, base, period) {
  prepareAY(vm, base);
  writeAY(vm, base, 0, period & 0xff);
  writeAY(vm, base, 1, (period >> 8) & 0x0f);
  writeAY(vm, base, 7, 0x3e); // tone A on; all noise and B/C tones off
  writeAY(vm, base, 8, 0x0f);
}

function ayFallingEdgeLatch(vm, base) {
  prepareAY(vm, base);
  vm.writeBus(base + VIA.ORA, 0);
  vm.writeBus(base + VIA.ORB, 0x07);
  vm.writeBus(base + VIA.ORB, 0x04);
  vm.writeBus(base + VIA.ORA, 0x34);
  vm.writeBus(base + VIA.ORB, 0x06);
  vm.writeBus(base + VIA.ORB, 0x05);
  vm.writeBus(base + VIA.DDRA, 0);
  return vm.readBus(base + VIA.ORA) === 0x34;
}

function channelEnergy(samples, channel) {
  let total = 0;
  for (let i = channel; i < samples.length; i += 2) total += Math.abs(samples[i]);
  return total;
}

function measuredFrequency(samples, sampleRate, channel) {
  let risingEdges = 0;
  let previous = samples[channel];
  for (let i = channel + 2; i < samples.length; i += 2) {
    const current = samples[i];
    if (previous <= 0 && current > 0) risingEdges++;
    previous = current;
  }
  const frames = samples.length / 2;
  return risingEdges * sampleRate / frames;
}

function timerUsesProgrammedCadence(vm, latch) {
  vm.reset();
  prepareIdleLoop(vm);
  vm.writeBus(0xc400 + VIA.ACR, 0x40);
  vm.writeBus(0xc400 + VIA.T1CL, latch & 0xff);
  vm.writeBus(0xc400 + VIA.T1CH, latch >> 8);

  const period = latch + 1;
  const earlyCycles = Math.floor(period * 2 / 3);
  vm.runCycles(earlyCycles);
  const early = (vm.readBus(0xc400 + VIA.IFR) & 0x40) === 0;
  vm.runCycles(period - earlyCycles + 16);
  const onTime = (vm.readBus(0xc400 + VIA.IFR) & 0x40) === 0x40;
  return early && onTime;
}

function waiResumesAfterMaskedIRQ(vm) {
  vm.reset();
  vm.poke(0x0800, 0xcb); // WAI
  vm.poke(0x0801, 0xea); // NOP
  vm.poke(0x0802, 0x4c); // JMP $0802
  vm.poke(0x0803, 0x02);
  vm.poke(0x0804, 0x08);
  vm.setPC(0x0800);
  vm.writeBus(0xc400 + VIA.IER, 0xc0);
  vm.writeBus(0xc400 + VIA.T1CL, 1);
  vm.writeBus(0xc400 + VIA.T1CH, 0);

  vm.runCycles(3);
  const waitingAtNextInstruction = vm.waiting() && vm.pc() === 0x0801;
  vm.runCycles(2);
  return waitingAtNextInstruction && !vm.waiting() && vm.pc() === 0x0802;
}

createBadgerVM().then((Module) => {
  const resetTimers = resetTimerContract(Module);
  const vm = new Module.WebVM();
  const sampleRate = 48000;

  vm.reset();
  prepareIdleLoop(vm);
  const budgetedCycles = vm.runCycles(12345);
  const cycleBudget =
    budgetedCycles >= 12345 && budgetedCycles < 12361;

  // A4-A6 are ignored while A7 selects the two physical VIAs.
  vm.writeBus(0xc432, 0x07);
  vm.writeBus(0xc4b2, 0x05);
  const mirrors =
    vm.readBus(0xc402) === 0x07 &&
    vm.readBus(0xc482) === 0x05;

  vm.reset();
  const fallingEdgeLatch = ayFallingEdgeLatch(vm, 0xc400);

  vm.reset();
  prepareIdleLoop(vm);
  vm.writeBus(0xc400 + VIA.ACR, 0x80);
  vm.writeBus(0xc400 + VIA.T1CL, 1);
  vm.writeBus(0xc400 + VIA.T1CH, 0);
  const pb7StartsLow = (vm.readBus(0xc400 + VIA.ORB) & 0x80) === 0;
  vm.runCycles(16);
  const pb7FinishesHigh = (vm.readBus(0xc400 + VIA.ORB) & 0x80) === 0x80;
  const timerPB7Output = pb7StartsLow && pb7FinishesHigh;

  vm.reset();
  prepareIdleLoop(vm);
  if (!vm.enableAudio(sampleRate)) throw new Error("audio sample rate rejected");
  programToneA(vm, 0xc400, 100);
  vm.run(50000);
  const leftSamples = vm.drainAudio();
  const leftEnergy = channelEnergy(leftSamples, 0);
  const leftLeak = channelEnergy(leftSamples, 1);
  const frequency = measuredFrequency(leftSamples, sampleRate, 0);
  const expectedFrequency = 25175000 / 16 / (16 * 100);
  const clockMatch = Math.abs(frequency - expectedFrequency) / expectedFrequency < 0.03;

  vm.reset();
  prepareIdleLoop(vm);
  programToneA(vm, 0xc480, 100);
  vm.run(50000);
  const rightSamples = vm.drainAudio();
  const rightLeak = channelEnergy(rightSamples, 0);
  const rightEnergy = channelEnergy(rightSamples, 1);

  vm.reset();
  prepareIdleLoop(vm);
  vm.writeBus(0xc480 + VIA.IER, 0xc0);
  vm.writeBus(0xc480 + VIA.T1CL, 1);
  vm.writeBus(0xc480 + VIA.T1CH, 0);
  vm.run(1);
  const timerIRQ =
    vm.irqAsserted() &&
    (vm.readBus(0xc480 + VIA.IFR) & 0xc0) === 0xc0;
  const ultimaTimerCadence =
    [0x6682, 0x8b06, 0x9c67, 0xa6d4]
      .every((latch) => timerUsesProgrammedCadence(vm, latch));
  const waiResume = waiResumesAfterMaskedIRQ(vm);

  const stereo =
    leftEnergy > 10 &&
    leftLeak < 0.001 &&
    rightEnergy > 10 &&
    rightLeak < 0.001;

  console.log("--- 3RIC Mockingboard test ---");
  console.log("cold VIA probes/reset :", resetTimers);
  console.log("cycle-budget runner    :", cycleBudget);
  console.log("address mirrors       :", mirrors);
  console.log("AY falling-edge latch :", fallingEdgeLatch);
  console.log("VIA Timer 1 PB7       :", timerPB7Output);
  console.log("stereo separation     :", stereo);
  console.log("left/right samples    :", leftSamples.length, "/", rightSamples.length);
  console.log("tone frequency        :", frequency.toFixed(1), "Hz");
  console.log("expected @ 3RIC PHI2  :", expectedFrequency.toFixed(1), "Hz");
  console.log("hardware clock match  :", clockMatch);
  console.log("VIA Timer 1 IRQ       :", timerIRQ);
  console.log("Ultima timer cadence  :", ultimaTimerCadence);
  console.log("WAI resumes after IRQ :", waiResume);

  vm.disableAudio();
  vm.delete();

  if (!resetTimers || !cycleBudget || !mirrors || !fallingEdgeLatch || !timerPB7Output ||
      !stereo || !clockMatch ||
      !timerIRQ || !ultimaTimerCadence || !waiResume) {
    console.error("\nFAIL");
    process.exit(1);
  }
  console.log("\nPASS");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
