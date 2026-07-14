(function (root) {
  class EmulationClock {
    constructor(clockHz, maximumElapsedMs = 100) {
      if (!Number.isFinite(clockHz) || clockHz <= 0) {
        throw new RangeError("clockHz must be positive");
      }
      if (!Number.isFinite(maximumElapsedMs) || maximumElapsedMs <= 0) {
        throw new RangeError("maximumElapsedMs must be positive");
      }

      this.clockHz = clockHz;
      this.maximumElapsedMs = maximumElapsedMs;
      this.reset();
    }

    reset() {
      this.lastTimestamp = null;
      this.cycleDebt = 0;
    }

    advance(timestamp, speed) {
      if (!Number.isFinite(timestamp)) {
        throw new RangeError("timestamp must be finite");
      }
      if (!Number.isFinite(speed) || speed < 0) {
        throw new RangeError("speed must be finite and non-negative");
      }

      if (this.lastTimestamp === null) {
        this.lastTimestamp = timestamp;
        return 0;
      }

      const elapsedMs = Math.min(
        Math.max(timestamp - this.lastTimestamp, 0),
        this.maximumElapsedMs);
      this.lastTimestamp = timestamp;

      const maximumDebt =
        this.clockHz * speed * this.maximumElapsedMs / 1000;
      this.cycleDebt = Math.min(
        this.cycleDebt + this.clockHz * speed * elapsedMs / 1000,
        maximumDebt);
      return this.cyclesDue();
    }

    consume(cycles) {
      if (!Number.isFinite(cycles) || cycles < 0) {
        throw new RangeError("cycles must be finite and non-negative");
      }
      this.cycleDebt -= cycles;
    }

    cyclesDue() {
      return Math.max(0, Math.floor(this.cycleDebt));
    }
  }

  const api = { EmulationClock };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.BadgerEmulationClock = api;
})(typeof globalThis === "object" ? globalThis : this);
