class BadgerAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.chunkOffset = 0;
    this.bufferedFrames = 0;
    this.started = false;
    this.minimumBufferedFrames = Math.max(128, Math.floor(sampleRate / 20));
    this.maximumBufferedFrames = Math.floor(sampleRate / 2);

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "clear") {
        this.clear();
        return;
      }

      let chunk = event.data;
      if (!(chunk instanceof Float32Array) || chunk.length < 2 || (chunk.length & 1)) {
        return;
      }

      let frames = chunk.length / 2;
      if (frames > this.maximumBufferedFrames) {
        chunk = chunk.subarray(
          chunk.length - this.maximumBufferedFrames * 2);
        frames = this.maximumBufferedFrames;
      }
      const overflow =
        this.bufferedFrames + frames - this.maximumBufferedFrames;
      if (overflow > 0) {
        this.discardFrames(overflow);
      }
      this.chunks.push(chunk);
      this.bufferedFrames += frames;
    };
  }

  clear() {
    this.chunks.length = 0;
    this.chunkOffset = 0;
    this.bufferedFrames = 0;
    this.started = false;
  }

  discardFrames(frames) {
    let remaining = Math.min(frames, this.bufferedFrames);
    while (remaining > 0 && this.chunks.length) {
      const available = (this.chunks[0].length - this.chunkOffset) / 2;
      const discarded = Math.min(remaining, available);
      this.chunkOffset += discarded * 2;
      this.bufferedFrames -= discarded;
      remaining -= discarded;
      if (this.chunkOffset >= this.chunks[0].length) {
        this.chunks.shift();
        this.chunkOffset = 0;
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || !output.length) return true;

    const left = output[0];
    const right = output.length > 1 ? output[1] : null;
    if (!this.started) {
      if (this.bufferedFrames < this.minimumBufferedFrames) {
        left.fill(0);
        if (right) right.fill(0);
        return true;
      }
      this.started = true;
    }

    let frame = 0;
    while (frame < left.length) {
      while (this.chunks.length && this.chunkOffset >= this.chunks[0].length) {
        this.chunks.shift();
        this.chunkOffset = 0;
      }
      if (!this.chunks.length) {
        left.fill(0, frame);
        if (right) right.fill(0, frame);
        this.started = false;
        break;
      }

      const chunk = this.chunks[0];
      const available = (chunk.length - this.chunkOffset) / 2;
      const count = Math.min(left.length - frame, available);
      for (let i = 0; i < count; i++) {
        const offset = this.chunkOffset + i * 2;
        if (right) {
          left[frame + i] = chunk[offset];
          right[frame + i] = chunk[offset + 1];
        } else {
          left[frame + i] = (chunk[offset] + chunk[offset + 1]) * 0.5;
        }
      }
      this.chunkOffset += count * 2;
      this.bufferedFrames -= count;
      frame += count;
    }
    return true;
  }
}

registerProcessor("badger-audio", BadgerAudioProcessor);
