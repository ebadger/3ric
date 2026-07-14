const assert = require("node:assert/strict");
const createBadgerVM = require("./badger6502.js");
const { EmulationClock } = require("./emulation-clock.js");

const CPU_CLOCK_HZ = 25_175_000 / 16;
const SAMPLE_RATE = 48000;
const RUN_CYCLE_BATCH = 4096;

function prepareIdleLoop(vm) {
  vm.poke(0x0800, 0x4c); // JMP $0800
  vm.poke(0x0801, 0x00);
  vm.poke(0x0802, 0x08);
  vm.setPC(0x0800);
}

async function measure(Module, refreshHz, seconds) {
  const vm = new Module.WebVM();
  const clock = new EmulationClock(CPU_CLOCK_HZ);
  let framesProduced = 0;

  vm.reset();
  prepareIdleLoop(vm);
  assert.equal(vm.enableAudio(SAMPLE_RATE), true);
  clock.advance(0, 1);

  for (let frame = 1; frame <= refreshHz * seconds; frame++) {
    let cyclesDue = clock.advance(frame * 1000 / refreshHz, 1);
    while (cyclesDue > 0) {
      const cycles = vm.runCycles(Math.min(cyclesDue, RUN_CYCLE_BATCH));
      clock.consume(cycles);
      cyclesDue = clock.cyclesDue();
    }
    framesProduced += vm.drainAudio().length / 2;
  }

  vm.disableAudio();
  vm.delete();
  return framesProduced;
}

createBadgerVM().then(async (Module) => {
  const seconds = 2;
  const expectedFrames = SAMPLE_RATE * seconds;

  for (const refreshHz of [60, 144]) {
    const frames = await measure(Module, refreshHz, seconds);
    assert.ok(
      Math.abs(frames - expectedFrames) <= 1,
      `${refreshHz} Hz display produced ${frames} frames; expected ${expectedFrames}`);
    console.log(`${refreshHz} Hz display: ${frames} PCM frames`);
  }

  console.log("PASS: WASM audio production follows elapsed time");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
