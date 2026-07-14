const assert = require("node:assert/strict");
const { EmulationClock } = require("./emulation-clock.js");

const CPU_CLOCK_HZ = 25_175_000 / 16;

function simulate(refreshHz, seconds) {
  const clock = new EmulationClock(CPU_CLOCK_HZ);
  let executed = 0;
  let batch = 0;
  clock.advance(0, 1);

  for (let frame = 1; frame <= refreshHz * seconds; frame++) {
    let cyclesDue = clock.advance(frame * 1000 / refreshHz, 1);
    while (cyclesDue > 0) {
      const requested = Math.min(cyclesDue, 4096);
      const cycles = requested + (batch++ % 7);
      executed += cycles;
      clock.consume(cycles);
      cyclesDue = clock.cyclesDue();
    }
  }
  return executed;
}

for (const refreshHz of [60, 120, 144]) {
  const seconds = 10;
  const executed = simulate(refreshHz, seconds);
  const expected = CPU_CLOCK_HZ * seconds;
  assert.ok(
    Math.abs(executed - expected) <= 6,
    `${refreshHz} Hz display ran ${executed - expected} cycles off-speed`);
}

const stalled = new EmulationClock(CPU_CLOCK_HZ);
stalled.advance(0, 1);
const catchUp = stalled.advance(1000, 1);
assert.equal(catchUp, Math.floor(CPU_CLOCK_HZ / 10));

stalled.reset();
assert.equal(stalled.advance(5000, 1), 0);

console.log("PASS: elapsed-time CPU pacing is refresh-rate independent");
