(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BadgerGamepads = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const AXIS_DEADZONE = 0.5;
  const SNES = Object.freeze({
    B: 1 << 0,
    Y: 1 << 1,
    SELECT: 1 << 2,
    START: 1 << 3,
    UP: 1 << 4,
    DOWN: 1 << 5,
    LEFT: 1 << 6,
    RIGHT: 1 << 7,
    A: 1 << 8,
    X: 1 << 9,
    L: 1 << 10,
    R: 1 << 11,
  });

  function buttonPressed(gamepad, index) {
    const button = gamepad.buttons && gamepad.buttons[index];
    return !!button && (button.pressed || button.value >= 0.5);
  }

  function axisValue(gamepad, index) {
    if (!gamepad.axes || index >= gamepad.axes.length) return 0;
    const value = Number(gamepad.axes[index]);
    return Number.isFinite(value) ? value : 0;
  }

  function mapGamepad(gamepad) {
    if (!gamepad || gamepad.connected === false) return 0;

    let state = 0;
    if (buttonPressed(gamepad, 0)) state |= SNES.B;
    if (buttonPressed(gamepad, 1)) state |= SNES.A;
    if (buttonPressed(gamepad, 2)) state |= SNES.Y;
    if (buttonPressed(gamepad, 3)) state |= SNES.X;
    if (buttonPressed(gamepad, 8)) state |= SNES.SELECT;
    if (buttonPressed(gamepad, 9)) state |= SNES.START;
    if (buttonPressed(gamepad, 4) || buttonPressed(gamepad, 6)) state |= SNES.L;
    if (buttonPressed(gamepad, 5) || buttonPressed(gamepad, 7)) state |= SNES.R;

    const horizontal = axisValue(gamepad, 0);
    const vertical = axisValue(gamepad, 1);
    if (buttonPressed(gamepad, 12) || vertical <= -AXIS_DEADZONE) state |= SNES.UP;
    if (buttonPressed(gamepad, 13) || vertical >= AXIS_DEADZONE) state |= SNES.DOWN;
    if (buttonPressed(gamepad, 14) || horizontal <= -AXIS_DEADZONE) state |= SNES.LEFT;
    if (buttonPressed(gamepad, 15) || horizontal >= AXIS_DEADZONE) state |= SNES.RIGHT;

    return state;
  }

  class GamepadManager {
    constructor() {
      this._slots = [null, null];
    }

    poll(gamepads) {
      const connected = new Map();
      for (let i = 0; gamepads && i < gamepads.length; i++) {
        const gamepad = gamepads[i];
        if (gamepad && gamepad.connected !== false) connected.set(gamepad.index, gamepad);
      }

      for (let slot = 0; slot < this._slots.length; slot++) {
        if (!connected.has(this._slots[slot])) this._slots[slot] = null;
      }

      for (const gamepad of connected.values()) {
        if (this._slots.includes(gamepad.index)) continue;
        const free = this._slots.indexOf(null);
        if (free < 0) break;
        this._slots[free] = gamepad.index;
      }

      return this._slots.map((index) => {
        const gamepad = connected.get(index);
        return gamepad
          ? { index, id: gamepad.id || `Gamepad ${index}`, mask: mapGamepad(gamepad) }
          : null;
      });
    }
  }

  return { AXIS_DEADZONE, SNES, GamepadManager, mapGamepad };
});
