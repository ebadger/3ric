(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BadgerVirtualKeyboard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function printable(value, shifted) {
    return Object.freeze({ value, shifted });
  }

  function special(label, code, className, ariaLabel) {
    return Object.freeze({ label, code, className: className || "", ariaLabel: ariaLabel || label });
  }

  function modifier(label, name) {
    return Object.freeze({ label, modifier: name, className: "wide" });
  }

  const KEY_ROWS = Object.freeze([
    Object.freeze([
      special("Esc", 0x1b, "wide", "Escape"),
      printable("1", "!"),
      printable("2", "@"),
      printable("3", "#"),
      printable("4", "$"),
      printable("5", "%"),
      printable("6", "^"),
      printable("7", "&"),
      printable("8", "*"),
      printable("9", "("),
      printable("0", ")"),
      special("Back", 0x08, "wide", "Backspace"),
    ]),
    Object.freeze([
      special("Tab", 0x09, "wide"),
      printable("Q"),
      printable("W"),
      printable("E"),
      printable("R"),
      printable("T"),
      printable("Y"),
      printable("U"),
      printable("I"),
      printable("O"),
      printable("P"),
      special("Return", 0x0d, "wide"),
    ]),
    Object.freeze([
      modifier("Ctrl", "control"),
      printable("A"),
      printable("S"),
      printable("D"),
      printable("F"),
      printable("G"),
      printable("H"),
      printable("J"),
      printable("K"),
      printable("L"),
      printable(";", ":"),
      printable("'", "\""),
    ]),
    Object.freeze([
      modifier("Shift", "shift"),
      printable("Z"),
      printable("X"),
      printable("C"),
      printable("V"),
      printable("B"),
      printable("N"),
      printable("M"),
      printable(",", "<"),
      printable(".", ">"),
      printable("/", "?"),
    ]),
    Object.freeze([
      printable("`", "~"),
      printable("-", "_"),
      printable("=", "+"),
      printable("[", "{"),
      printable("]", "}"),
      printable("\\", "|"),
      special("\u2190", 0x08, "", "Left arrow"),
      special("\u2191", 0x0b, "", "Up arrow"),
      special("\u2193", 0x0a, "", "Down arrow"),
      special("\u2192", 0x15, "", "Right arrow"),
    ]),
    Object.freeze([
      special("Space", 0x20, "space"),
    ]),
  ]);

  function keyByte(key, shifted, controlled) {
    if (!key || key.modifier) return null;

    let value;
    if (typeof key.code === "number") {
      value = key.code;
    } else {
      value = shifted && typeof key.shifted === "string" ? key.shifted : key.value;
    }

    let byte = typeof value === "number" ? value : value.charCodeAt(0);
    if (controlled && typeof value === "string") {
      const upper = value.toUpperCase().charCodeAt(0);
      if (upper >= 0x40 && upper <= 0x5f) byte = upper & 0x1f;
      else if (value === "?") byte = 0x7f;
    }
    return byte & 0x7f;
  }

  function eventToByte(event) {
    if (!event || typeof event.key !== "string") return null;
    switch (event.key) {
      case "Enter":      return 0x0d;
      case "Backspace":  return 0x08;
      case "Tab":        return 0x09;
      case "Escape":     return 0x1b;
      case "ArrowLeft":  return 0x08;
      case "ArrowRight": return 0x15;
      case "ArrowUp":    return 0x0b;
      case "ArrowDown":  return 0x0a;
    }
    return event.key.length === 1 ? event.key.charCodeAt(0) & 0x7f : null;
  }

  function mount(element, onByte, focusTarget) {
    if (!element || !element.ownerDocument) {
      throw new TypeError("virtual keyboard mount point must be a DOM element");
    }
    if (typeof onByte !== "function") {
      throw new TypeError("virtual keyboard requires an onByte callback");
    }

    const document = element.ownerDocument;
    const fragment = document.createDocumentFragment();
    const modifierButtons = {};
    let shiftActive = false;
    let controlActive = false;

    function updateModifiers() {
      element.classList.toggle("vk-shift-active", shiftActive);
      element.classList.toggle("vk-control-active", controlActive);
      if (modifierButtons.shift) {
        modifierButtons.shift.classList.toggle("is-active", shiftActive);
        modifierButtons.shift.setAttribute("aria-pressed", String(shiftActive));
      }
      if (modifierButtons.control) {
        modifierButtons.control.classList.toggle("is-active", controlActive);
        modifierButtons.control.setAttribute("aria-pressed", String(controlActive));
      }
    }

    function press(key) {
      if (key.modifier === "shift") {
        shiftActive = !shiftActive;
        updateModifiers();
        return;
      }
      if (key.modifier === "control") {
        controlActive = !controlActive;
        updateModifiers();
        return;
      }

      onByte(keyByte(key, shiftActive, controlActive));
      shiftActive = false;
      controlActive = false;
      updateModifiers();
      if (focusTarget && typeof focusTarget.focus === "function") {
        focusTarget.focus({ preventScroll: true });
      }
    }

    for (let rowIndex = 0; rowIndex < KEY_ROWS.length; rowIndex++) {
      const keys = KEY_ROWS[rowIndex];
      const row = document.createElement("div");
      row.className = `vk-row vk-row-${rowIndex}`;
      for (const key of keys) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "vk-key" + (key.className ? ` ${key.className}` : "");

        if (key.modifier) {
          button.textContent = key.label;
          button.setAttribute("aria-label", key.label);
          button.setAttribute("aria-pressed", "false");
          modifierButtons[key.modifier] = button;
        } else if (typeof key.shifted === "string") {
          const shiftedLabel = document.createElement("span");
          shiftedLabel.className = "vk-shifted";
          shiftedLabel.textContent = key.shifted;
          const primaryLabel = document.createElement("span");
          primaryLabel.className = "vk-primary";
          primaryLabel.textContent = key.value;
          button.append(shiftedLabel, primaryLabel);
          button.setAttribute("aria-label", `${key.value}; Shift ${key.shifted}`);
        } else {
          button.textContent = key.label || key.value;
          button.setAttribute("aria-label", key.ariaLabel || key.label || key.value);
        }

        button.addEventListener("click", () => press(key));
        row.appendChild(button);
      }
      fragment.appendChild(row);
    }

    element.replaceChildren(fragment);
    updateModifiers();
  }

  return { KEY_ROWS, eventToByte, keyByte, mount };
});
