// Browser mapping + shared VIA/SNES protocol + ROM gamepad-table integration.
//
// Run with:
//   C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe web\test_gamepad.cjs

const fs = require("fs");
const path = require("path");
const createBadgerVM = require("./badger6502.js");
const { GamepadManager, SNES, mapGamepad } = require("./gamepad.js");

const DATA = path.join(__dirname, "data");
const rom = fs.readFileSync(path.join(DATA, "badger6502.bin"));

function makeGamepad(index, pressed = [], axes = [0, 0], id = `Pad ${index}`) {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const button of pressed) buttons[button] = { pressed: true, value: 1 };
  return { axes, buttons, connected: true, id, index, mapping: "standard" };
}

function scanVIA(vm) {
  const result = [0, 0];
  vm.writeBus(0xc202, 0xc0); // PB6/PB7 are latch/clock outputs
  vm.writeBus(0xc200, 0x00);
  vm.writeBus(0xc200, 0x40); // latch both controllers

  for (let bit = 0; bit < 16; bit++) {
    vm.writeBus(0xc200, 0x00);
    const port = vm.readBus(0xc200);
    if ((port & 0x20) === 0) result[0] |= 1 << bit;
    if ((port & 0x10) === 0) result[1] |= 1 << bit;
    vm.writeBus(0xc200, 0x80);
  }
  return result;
}

function tableMatches(vm, base, mask) {
  for (let bit = 0; bit < 16; bit++) {
    const expected = (mask & (1 << bit)) !== 0 ? 1 : 0;
    if (vm.peek(base + bit) !== expected) return false;
  }
  return true;
}

async function main() {
  const allButtons = mapGamepad(
    makeGamepad(0, [0, 1, 2, 3, 4, 5, 8, 9, 12, 13, 14, 15]));
  const standardMapping = allButtons === 0x0fff;
  const analogMapping =
    mapGamepad(makeGamepad(0, [6, 7], [-0.75, 0.75])) ===
    (SNES.L | SNES.R | SNES.LEFT | SNES.DOWN);
  const deadzone =
    mapGamepad(makeGamepad(0, [], [0.49, -0.49])) === 0;

  const manager = new GamepadManager();
  const first = manager.poll([makeGamepad(3), makeGamepad(7)]);
  const disconnected = manager.poll([makeGamepad(7)]);
  const reconnected = manager.poll([makeGamepad(9), makeGamepad(7)]);
  const stableSlots =
    first[0].index === 3 && first[1].index === 7 &&
    disconnected[0] === null && disconnected[1].index === 7 &&
    reconnected[0].index === 9 && reconnected[1].index === 7;

  const Module = await createBadgerVM();
  const vm = new Module.WebVM();
  const pad1 = SNES.B | SNES.LEFT | SNES.A | SNES.L;
  const pad2 = SNES.Y | SNES.START | SNES.RIGHT | SNES.R;

  const acceptsControllers =
    vm.setGamepadState(0, pad1) &&
    vm.setGamepadState(1, pad2) &&
    !vm.setGamepadState(2, 1);
  const serial = scanVIA(vm);
  const viaProtocol = serial[0] === pad1 && serial[1] === pad2;

  vm.loadData(0, new Uint8Array(rom.subarray(0, 0x10000)));
  vm.seedBasicRom();
  vm.reset();
  for (let i = 0; i < 20; i++) vm.run(50000);

  vm.setGamepadState(0, pad1);
  vm.setGamepadState(1, pad2);
  vm.poke(0xce15, 0); // JOYSTICK_MODE = SNES pads
  for (let i = 0; i < 16; i++) {
    vm.poke(0xcee0 + i, 0xff);
    vm.poke(0xcef0 + i, 0xff);
  }
  vm.readBus(0xc070); // PTRIG -> VIA1 CB2 -> NMI -> ROM scan
  vm.run(5000);
  const romScan =
    tableMatches(vm, 0xcee0, pad1) &&
    tableMatches(vm, 0xcef0, pad2);

  console.log("--- browser gamepad test ---");
  console.log("standard button mapping :", standardMapping);
  console.log("analog/trigger mapping  :", analogMapping);
  console.log("analog deadzone         :", deadzone);
  console.log("stable player slots     :", stableSlots);
  console.log("bridge validation       :", acceptsControllers);
  console.log("VIA serial protocol     :", viaProtocol);
  console.log("ROM GAMEPAD1/2 scan     :", romScan);

  vm.delete();

  if (!standardMapping || !analogMapping || !deadzone || !stableSlots ||
      !acceptsControllers || !viaProtocol || !romScan) {
    console.error("\nFAIL");
    process.exit(1);
  }
  console.log("\nPASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
