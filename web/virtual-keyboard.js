(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BadgerVirtualKeyboard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function printable(value, shifted, units = 1) {
    return Object.freeze({ value, shifted, units });
  }

  function special(label, code, className, ariaLabel, units = 1) {
    return Object.freeze({
      label,
      code,
      units,
      className: className || "",
      ariaLabel: ariaLabel || label,
    });
  }

  function modifier(label, name, className, units = 1) {
    return Object.freeze({ label, modifier: name, className, units });
  }

  function disabledKey(label, className, ariaLabel, title, descriptionId, units = 1) {
    return Object.freeze({
      label,
      className,
      ariaLabel,
      title,
      descriptionId,
      units,
      disabled: true,
    });
  }

  function spacer(className, units = 1) {
    return Object.freeze({ spacer: true, className, units });
  }

  const KEY_ROWS = Object.freeze([
    Object.freeze([
      special("ESC", 0x1b, "", "Escape"),
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
      printable("-", "_"),
      printable("=", "+"),
      special("DELETE", 0x7f, "delete", "Delete", 1.58),
    ]),
    Object.freeze([
      special("TAB", 0x09, "tab", "Tab", 1.58),
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
      printable("[", "{"),
      printable("]", "}"),
      printable("\\", "|"),
    ]),
    Object.freeze([
      modifier("CONTROL", "control", "control", 1.86),
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
      special("RETURN", 0x0d, "return", "Return", 1.87),
    ]),
    Object.freeze([
      modifier("SHIFT", "shift", "shift", 2.48),
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
      modifier("SHIFT", "shift", "shift", 2.38),
    ]),
    Object.freeze([
      disabledKey(
        "CAPS LOCK",
        "caps",
        "Caps Lock",
        "3ric keyboard input is uppercase-only",
        "virtual-keyboard-caps-note",
      ),
      printable("`", "~"),
      spacer("case-gap"),
      spacer("apple-slot"),
      special("", 0x20, "space", "Space", 5.86),
      spacer("apple-slot"),
      special("\u2190", 0x08, "", "Left arrow"),
      special("\u2192", 0x15, "", "Right arrow"),
      special("\u2193", 0x0a, "", "Down arrow"),
      special("\u2191", 0x0b, "", "Up arrow"),
    ]),
  ]);

  function keyByte(key, shifted, controlled) {
    if (!key || key.modifier || key.disabled || key.spacer) return null;

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
      case "Delete":     return 0x7f;
      case "Tab":        return 0x09;
      case "Escape":     return 0x1b;
      case "ArrowLeft":  return 0x08;
      case "ArrowRight": return 0x15;
      case "ArrowUp":    return 0x0b;
      case "ArrowDown":  return 0x0a;
    }
    return event.key.length === 1 ? event.key.charCodeAt(0) & 0x7f : null;
  }

  function isPointerActivation(event) {
    return !!event && typeof event.detail === "number" && event.detail > 0;
  }

  function isFocusEscape(event) {
    return !!event && event.key === "Tab" && event.shiftKey === true;
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
      for (const button of modifierButtons.shift || []) {
        button.classList.toggle("is-active", shiftActive);
        button.setAttribute("aria-pressed", String(shiftActive));
      }
      for (const button of modifierButtons.control || []) {
        button.classList.toggle("is-active", controlActive);
        button.setAttribute("aria-pressed", String(controlActive));
      }
    }

    function restorePointerFocus(event) {
      if (isPointerActivation(event) &&
          focusTarget && typeof focusTarget.focus === "function") {
        focusTarget.focus({ preventScroll: true });
      }
    }

    function press(key, event) {
      if (key.modifier === "shift") {
        shiftActive = !shiftActive;
        updateModifiers();
        restorePointerFocus(event);
        return;
      }
      if (key.modifier === "control") {
        controlActive = !controlActive;
        updateModifiers();
        restorePointerFocus(event);
        return;
      }

      onByte(keyByte(key, shiftActive, controlActive));
      shiftActive = false;
      controlActive = false;
      updateModifiers();
      restorePointerFocus(event);
    }

    for (let rowIndex = 0; rowIndex < KEY_ROWS.length; rowIndex++) {
      const keys = KEY_ROWS[rowIndex];
      const row = document.createElement("div");
      row.className = `vk-row vk-row-${rowIndex}`;
      for (const key of keys) {
        if (key.spacer) {
          const gap = document.createElement("span");
          gap.className = "vk-spacer" + (key.className ? ` ${key.className}` : "");
          gap.style.flexGrow = String(key.units);
          gap.setAttribute("aria-hidden", "true");
          row.appendChild(gap);
          continue;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "vk-key" + (key.className ? ` ${key.className}` : "");
        button.style.flexGrow = String(key.units);

        if (key.disabled) {
          button.textContent = key.label;
          button.setAttribute("aria-label", key.ariaLabel);
          button.setAttribute("aria-disabled", "true");
          button.setAttribute("aria-describedby", key.descriptionId);
          button.title = key.title;
        } else if (key.modifier) {
          button.textContent = key.label;
          button.setAttribute("aria-label", key.label);
          button.setAttribute("aria-pressed", "false");
          if (!modifierButtons[key.modifier]) modifierButtons[key.modifier] = [];
          modifierButtons[key.modifier].push(button);
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
          button.textContent = key.label || key.value || "";
          button.setAttribute("aria-label", key.ariaLabel || key.label || key.value || "");
        }

        button.addEventListener("click", key.disabled
          ? restorePointerFocus
          : (event) => press(key, event));
        row.appendChild(button);
      }
      fragment.appendChild(row);
    }

    element.replaceChildren(fragment);
    updateModifiers();
  }

  return { KEY_ROWS, eventToByte, isFocusEscape, isPointerActivation, keyByte, mount };
});
