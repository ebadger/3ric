// Combined-audio contract test for the $C030 system speaker and Mockingboard.
//
// Run with:
//   C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe web\test_system_speaker.cjs

const assert = require("node:assert/strict");
const createBadgerVM = require("./badger6502.js");

const CPU_CLOCK_HZ = 25_175_000 / 16;
const SAMPLE_RATE = 48_000;
const HALF_PERIOD_CYCLES = 787;
const TOGGLES = 400;
const SPEAKER = 0xc030;
const MOCKINGBOARD = 0xc400;
const VIA = {
  ORB: 0,
  ORA: 1,
  DDRB: 2,
  DDRA: 3,
};

function prepareIdleLoop(vm) {
  vm.poke(0x0800, 0x4c); // JMP $0800
  vm.poke(0x0801, 0x00);
  vm.poke(0x0802, 0x08);
  vm.setPC(0x0800);
}

function writeAY(vm, reg, data) {
  vm.writeBus(MOCKINGBOARD + VIA.ORA, reg);
  vm.writeBus(MOCKINGBOARD + VIA.ORB, 0x07);
  vm.writeBus(MOCKINGBOARD + VIA.ORB, 0x04);
  vm.writeBus(MOCKINGBOARD + VIA.ORA, data);
  vm.writeBus(MOCKINGBOARD + VIA.ORB, 0x06);
  vm.writeBus(MOCKINGBOARD + VIA.ORB, 0x04);
}

function programLeftTone(vm) {
  vm.writeBus(MOCKINGBOARD + VIA.DDRA, 0xff);
  vm.writeBus(MOCKINGBOARD + VIA.DDRB, 0x07);
  vm.writeBus(MOCKINGBOARD + VIA.ORB, 0x04);
  writeAY(vm, 0, 100);
  writeAY(vm, 1, 0);
  writeAY(vm, 7, 0x3e);
  writeAY(vm, 8, 0x0f);
}

function channelEnergy(samples, channel) {
  let energy = 0;
  for (let i = channel; i < samples.length; i += 2) {
    energy += Math.abs(samples[i]);
  }
  return energy;
}

createBadgerVM().then((Module) => {
  const vm = new Module.WebVM();
  vm.reset();
  prepareIdleLoop(vm);
  assert.equal(vm.enableAudio(SAMPLE_RATE), true);

  vm.readBus(SPEAKER);
  vm.runCycles(20_000);
  const afterRead = vm.drainAudio();
  let positivePeak = 0;
  for (let i = 0; i + 1 < afterRead.length; i += 2) {
    positivePeak = Math.max(positivePeak, afterRead[i]);
    assert.equal(afterRead[i], afterRead[i + 1]);
  }
  assert.ok(positivePeak > 0.20, "read access did not raise the speaker");

  vm.writeBus(SPEAKER, 0);
  vm.runCycles(1_000);
  const afterWrite = vm.drainAudio();
  let negativePeak = 0;
  for (let i = 0; i < afterWrite.length; i += 2) {
    negativePeak = Math.min(negativePeak, afterWrite[i]);
  }
  assert.ok(negativePeak < -0.20, "write access did not lower the speaker");

  vm.readBus(SPEAKER);
  vm.reset();
  prepareIdleLoop(vm);
  vm.runCycles(2_000);
  assert.ok(
    vm.drainAudio().every((sample) => sample === 0),
    "reset did not clear the speaker latch and filter");

  programLeftTone(vm);
  let executedCycles = 0;
  for (let toggle = 0; toggle < TOGGLES; toggle++) {
    if ((toggle & 1) === 0) vm.readBus(SPEAKER);
    else vm.writeBus(SPEAKER, 0);
    executedCycles += vm.runCycles(HALF_PERIOD_CYCLES);
  }

  const mixed = vm.drainAudio();
  const speakerEnergy = channelEnergy(mixed, 1);
  let mockingboardEnergy = 0;
  let risingEdges = 0;
  let previous = mixed.length >= 2 ? mixed[1] : 0;
  for (let i = 0; i + 1 < mixed.length; i += 2) {
    mockingboardEnergy += Math.abs(mixed[i] - mixed[i + 1]);
    if (previous <= 0 && mixed[i + 1] > 0) risingEdges++;
    previous = mixed[i + 1];
  }

  const frames = mixed.length / 2;
  const measuredFrequency = risingEdges * SAMPLE_RATE / frames;
  const averageHalfPeriod = executedCycles / TOGGLES;
  const expectedFrequency = CPU_CLOCK_HZ / (2 * averageHalfPeriod);
  assert.ok(speakerEnergy > 50, "centered speaker is missing from the mix");
  assert.ok(mockingboardEnergy > 10, "left AY is missing from the mix");
  assert.ok(
    Math.abs(measuredFrequency - expectedFrequency) / expectedFrequency < 0.03,
    `speaker frequency ${measuredFrequency} did not match ${expectedFrequency}`);

  vm.disableAudio();
  vm.delete();
  console.log(
    `PASS: $C030 speaker ${measuredFrequency.toFixed(1)} Hz mixed with Mockingboard stereo`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
