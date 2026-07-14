const assert = require("assert");
const {
  KEY_ROWS,
  eventToByte,
  isPointerActivation,
  keyByte,
  mount,
} = require("./virtual-keyboard.js");

class FakeClassList {
  constructor() {
    this.names = new Set();
  }

  toggle(name, force) {
    if (force) this.names.add(name);
    else this.names.delete(name);
  }

  contains(name) {
    return this.names.has(name);
  }
}

class FakeElement {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.classList = new FakeClassList();
    this.listeners = {};
    this.attributes = {};
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  replaceChildren(fragment) {
    this.children = [...fragment.children];
  }

  activate(detail) {
    for (const listener of this.listeners.click || []) listener({ detail });
  }
}

class FakeDocument {
  createDocumentFragment() {
    return new FakeElement(this);
  }

  createElement() {
    return new FakeElement(this);
  }
}

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
assert.strictEqual(isPointerActivation({ detail: 1 }), true);
assert.strictEqual(isPointerActivation({ detail: 0 }), false);

const document = new FakeDocument();
const mountPoint = new FakeElement(document);
const emittedBytes = [];
let focusCount = 0;
mount(mountPoint, (byte) => emittedBytes.push(byte), {
  focus(options) {
    assert.deepStrictEqual(options, { preventScroll: true });
    focusCount++;
  },
});

const mountedButtons = mountPoint.children.flatMap((row) => row.children);
const button = (label) =>
  mountedButtons.find((candidate) => candidate.getAttribute("aria-label") === label);

button("Shift").activate(1);
assert.strictEqual(focusCount, 1, "pointer modifier activation should restore canvas focus");
assert.strictEqual(button("Shift").getAttribute("aria-pressed"), "true");
button("A").activate(0);
button("S").activate(0);
assert.deepStrictEqual(emittedBytes, [0x41, 0x53]);
assert.strictEqual(focusCount, 1, "keyboard activation should retain virtual-key focus");
assert.strictEqual(button("Shift").getAttribute("aria-pressed"), "false");
button("D").activate(1);
assert.strictEqual(focusCount, 2, "pointer character activation should restore canvas focus");

console.log("PASS (virtual keyboard layout and byte mappings)");
