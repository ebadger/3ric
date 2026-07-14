const assert = require("assert");
const {
  KEY_ROWS,
  eventToByte,
  keyByte,
} = require("./virtual-keyboard.js");

const keys = KEY_ROWS.flat();
const findValue = (value) => keys.find((key) => key.value === value);
const findModifier = (name) => keys.find((key) => key.modifier === name);
const findAriaLabel = (label) => keys.find((key) => key.ariaLabel === label);

const emitted = new Set();
for (const key of keys) {
  const plain = keyByte(key, false, false);
  const shifted = keyByte(key, true, false);
  if (plain !== null) emitted.add(plain);
  if (shifted !== null) emitted.add(shifted);
}

const expectedPrintable = [];
for (let code = 0x20; code <= 0x60; code++) expectedPrintable.push(code);
for (let code = 0x7b; code <= 0x7e; code++) expectedPrintable.push(code);
assert.deepStrictEqual(
  expectedPrintable.filter((code) => !emitted.has(code)),
  [],
  "layout must expose every printable byte supported by the uppercase emulator keyboard",
);

assert.strictEqual(keyByte(findValue("A"), false, true), 0x01);
assert.strictEqual(keyByte(findValue("2"), true, true), 0x00);
assert.strictEqual(keyByte(findValue("["), false, true), 0x1b);
assert.strictEqual(keyByte(findValue("/"), true, true), 0x7f);
assert.strictEqual(keyByte(findModifier("shift"), false, false), null);
assert.strictEqual(keyByte(findAriaLabel("Escape"), false, false), 0x1b);
assert.strictEqual(keyByte(findAriaLabel("Tab"), false, false), 0x09);
assert.strictEqual(keyByte(findAriaLabel("Backspace"), false, false), 0x08);
assert.strictEqual(keyByte(findAriaLabel("Return"), false, false), 0x0d);
assert.strictEqual(keyByte(findAriaLabel("Up arrow"), false, false), 0x0b);
assert.strictEqual(keyByte(findAriaLabel("Down arrow"), false, false), 0x0a);
assert.strictEqual(keyByte(findAriaLabel("Right arrow"), false, false), 0x15);

assert.strictEqual(eventToByte({ key: "Enter" }), 0x0d);
assert.strictEqual(eventToByte({ key: "ArrowRight" }), 0x15);
assert.strictEqual(eventToByte({ key: "a" }), 0x61);
assert.strictEqual(eventToByte({ key: "F1" }), null);

console.log("PASS (virtual keyboard layout and byte mappings)");
