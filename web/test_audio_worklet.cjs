const assert = require("node:assert/strict");

let Processor = null;
global.sampleRate = 48000;
global.AudioWorkletProcessor = class {
  constructor() {
    this.port = { onmessage: null };
  }
};
global.registerProcessor = (name, implementation) => {
  assert.equal(name, "badger-audio");
  Processor = implementation;
};

require("./audio-worklet.js");
assert.ok(Processor);

const processor = new Processor();
const output = () => [[new Float32Array(128), new Float32Array(128)]];

processor.process([], output());
assert.equal(processor.started, false);

const initial = new Float32Array(3000 * 2);
for (let frame = 0; frame < 3000; frame++) {
  initial[frame * 2] = 0.25;
  initial[frame * 2 + 1] = -0.5;
}
processor.port.onmessage({ data: initial });

const stereo = output();
processor.process([], stereo);
assert.equal(processor.started, true);
assert.equal(stereo[0][0][0], 0.25);
assert.equal(stereo[0][1][0], -0.5);

processor.clear();
const maximum = processor.maximumBufferedFrames;
processor.port.onmessage({ data: new Float32Array(maximum * 2) });
processor.port.onmessage({ data: new Float32Array(1000 * 2) });
assert.equal(processor.bufferedFrames, maximum);
assert.equal(processor.chunks.length, 2);

processor.port.onmessage({ data: { type: "clear" } });
assert.equal(processor.bufferedFrames, 0);
assert.equal(processor.started, false);

console.log("PASS: AudioWorklet prebuffer and bounded queue");
