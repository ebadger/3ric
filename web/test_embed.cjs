const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Script, createContext, constants } = require("node:vm");
const { pathToFileURL } = require("node:url");
const createBadgerVM = require("./badger6502.js");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const mainScript = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
const layoutScript = html.match(/<script data-player-layout>([\s\S]*?)<\/script>/)[1];
const markup = html.slice(0, html.indexOf('<script src="emulation-clock.js">'));
const elementIds = [...markup.matchAll(/<[a-z][\w-]*\b[^>]*\bid="([^"]+)"[^>]*>/gi)]
  .map(match => match[1]);
assert.equal(new Set(elementIds).size, elementIds.length, "page IDs must be unique");
const playerMarkup = markup.match(/<section id="emulator"[^>]*>([\s\S]*?)<\/section>/)[1];
for (const id of ["reset", "sound", "fullscreen", "screen", "virtual-keyboard", "status"]) {
  assert.match(playerMarkup, new RegExp(`\\bid="${id}"`), `${id} must live inside the fullscreen player`);
}
assert.match(playerMarkup, /<canvas id="screen" width="320" height="384" tabindex="0"/);
assert.match(playerMarkup, /id="status" role="status" aria-live="polite"/);
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, "");
function styleFor(selector) {
  const declarations = new Map();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match[1].split(",").map(part => part.trim()).includes(selector)) continue;
    for (const property of match[2].split(";")) {
      const at = property.indexOf(":");
      if (at !== -1) declarations.set(property.slice(0, at).trim(), property.slice(at + 1).replace(/\s/g, ""));
    }
  }
  return declarations;
}
for (const selector of ["html.embedded header", "html.embedded footer", "html.embedded #ide"]) {
  assert.equal(styleFor(selector).get("display"), "none", `${selector} must be hidden in embeds`);
}
for (const prefix of ["html.embedded", "#emulator:fullscreen"]) {
  assert.equal(styleFor(`${prefix} #screen`).get("width"), "min(100cqw,calc(100cqh*4/3))");
  assert.equal(styleFor(`${prefix} #screen`).get("height"), "min(100cqh,calc(100cqw*3/4))");
  assert.equal(styleFor(`${prefix} #screen-area`).get("container-type"), "size");
  assert.equal(styleFor(`${prefix} #screen-area`).get("min-height"), "0");
  assert.equal(styleFor(`${prefix} #virtual-keyboard`).get("flex-shrink"), "1",
    "short frames must shrink the keyboard instead of clipping controls/error status");
  assert.equal(styleFor(`${prefix} #virtual-keyboard`).get("overflow-y"), "auto");
}
assert.equal(styleFor("html.embedded body").get("height"), "100dvh");
assert.equal(styleFor("html.embedded body").get("overflow"), "hidden");
assert.equal(styleFor("#emulator:fullscreen").get("height"), "100%");
assert.equal(styleFor("#emulator:fullscreen").get("width"), "100%");
assert.equal(styleFor("#ide").get("display"), "flex", "the ordinary editor must remain visible");
assert.match(markup, /Swap \.woz&hellip;<input type="file" id="diskswap" accept="\.woz"/);
console.log("PASS: real player markup, control placement, workbench visibility, and aspect-preserving CSS");
const base = "https://player.example/3ric/index.html";
const rom = fs.readFileSync(path.join(__dirname, "data", "badger6502.bin"));
const font = fs.readFileSync(path.join(__dirname, "data", "fontrom.dat"));

class Element {
  constructor(document, id = "") {
    this.ownerDocument = document;
    this.id = id;
    this.listeners = new Map();
    this.attributes = new Map();
    this.children = [];
    this.textContent = "";
    this.value = "";
    this.style = {};
    this.disabled = false;
    this.open = false;
    this.options = [];
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
    };
  }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  async dispatch(name, data = {}) {
    const event = { target: this, detail: 1, preventDefault() {}, ...data };
    await Promise.all([...(this.listeners.get(name) || [])].map(fn => fn(event)));
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(fragment) { this.children = [...fragment.children]; }
  contains(target) { return target === this; }
  add(option) { this.options.push(option); }
  focus() { this.ownerDocument.focuses.push(this.id); }
  scrollIntoView() { this.ownerDocument.scrolls.push(this.id); }
  getContext() {
    return {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
    };
  }
}

class Document extends Element {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.baseURI = base;
    this.elements = new Map(elementIds.map(id => [id, new Element(this, id)]));
    this.documentElement = new Element(this);
    this.body = new Element(this);
    this.focuses = [];
    this.scrolls = [];
    this.fullscreenEnabled = true;
    this.fullscreenElement = null;
    this.fullscreenRequests = 0;
    this.getElementById("emulator").requestFullscreen = async () => {
      this.fullscreenRequests++;
      if (this.fullscreenError) throw this.fullscreenError;
      this.fullscreenElement = this.getElementById("emulator");
      await this.dispatch("fullscreenchange");
    };
    this.getElementById("ideaddr").value = "0800";
    this.getElementById("debugmemaddr").value = "0800";
    this.getElementById("sample").options = [{ value: "swarm", text: "STAR SWARM" }];
  }
  getElementById(id) {
    return this.elements.get(id) || null;
  }
  createElement() { return new Element(this); }
  createDocumentFragment() { return new Element(this); }
  async exitFullscreen() {
    this.fullscreenElement = null;
    await this.dispatch("fullscreenchange");
  }
}

function mountPage(Module, {
  search = "?embed=1", disk, diskError, diskResponse, saved = null, fastTimeout = false,
} = {}) {
  const document = new Document();
  const requests = [];
  const errors = [];
  const frames = [];
  const storage = [];
  const deadlines = [];
  const window = {};
  const location = new URL(search, base);
  let now = 0;
  const context = createContext({
    document, window, location, URL, URLSearchParams, TextEncoder, TextDecoder,
    Uint8Array, Uint8ClampedArray, ArrayBuffer, Blob, atob, btoa, AbortController, clearTimeout,
    setTimeout(fn, delay) {
      deadlines.push(delay);
      return setTimeout(fn, fastTimeout && delay === 30_000 ? 1 : delay);
    },
    performance: { now: () => now },
    console: { error: error => errors.push(error), log() {} },
    navigator: { getGamepads: () => [] },
    localStorage: {
      getItem(key) { storage.push(["get", key]); return key.endsWith(".src") ? saved : "0800"; },
      setItem(key, value) { storage.push(["set", key, value]); },
    },
    Option: function Option(text, value) { this.text = text; this.value = value; },
    BadgerEmulationClock: require("./emulation-clock.js"),
    BadgerGamepads: require("./gamepad.js"),
    BadgerVirtualKeyboard: require("./virtual-keyboard.js"),
    BadgerDebugger: require("./debugger.js"),
    createBadgerVM: async () => Module,
    requestAnimationFrame: fn => frames.push(fn),
    fetch: async (target, options = {}) => {
      const url = new URL(target, base);
      requests.push(url.href);
      let bytes;
      if (url.pathname.endsWith("/data/badger6502.bin")) bytes = rom;
      else if (url.pathname.endsWith("/data/fontrom.dat")) bytes = font;
      else if (url.pathname.endsWith("/data/sd.sparse")) {
        throw new Error("SD is not needed for this player test");
      } else if (url.pathname.endsWith("/programs/swarm.s")) {
        return new Response(".org $0800\nloop: jmp loop");
      } else if (url.pathname.endsWith("/programs/shared.s")) {
        return new Response(".org $0800\nlda #$51\nsta $0400\nloop: jmp loop");
      } else {
        if (diskError) throw diskError;
        if (diskResponse) return typeof diskResponse === "function" ? diskResponse(url, options) : diskResponse;
        assert(disk, `unexpected fetch: ${url.href}`);
        bytes = disk;
      }
      return new Response(Uint8Array.from(bytes));
    },
  });
  new Script(layoutScript).runInContext(context);
  const ready = new Script(mainScript, {
    filename: path.join(__dirname, "index.html"),
    importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  }).runInContext(context);
  return {
    document, window, ready, requests, errors, storage, deadlines,
    runFrames(count) {
      for (let i = 0; i < count; i++) {
        now += 1000 / 60;
        const pending = frames.splice(0);
        assert(pending.length, "the real frame loop must remain scheduled");
        for (const fn of pending) fn(now);
      }
    },
    dispose() { window.vm?.delete(); },
  };
}

function assertBooted(page, marker) {
  for (let i = 0; i < 1200 && page.window.vm.peek(0x0400) !== marker; i++) page.runFrames(1);
  const text = Array.from({ length: 0x400 }, (_, i) => {
    const byte = page.window.vm.peek(0x0400 + i) & 0x7f;
    return byte >= 32 && byte < 127 ? String.fromCharCode(byte) : " ";
  }).join("");
  assert.equal(page.window.vm.peek(0x0400), marker,
    `the URL disk must execute through the real C600G/frame/keyboard path (PC=$${page.window.vm.pc().toString(16)}): ${text}`);
}

async function pickSwap(page, file) {
  const target = { value: file ? file.name : "", files: file ? [file] : [] };
  await page.document.getElementById("diskswap").dispatch("change", { target });
  assert.equal(target.value, "", "the same disk must be selectable again");
}

function localDisk(bytes, name = "map.woz") {
  return { name, size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
}

async function testDiskSwaps(Module, disk, replacement, maximum, malformed, woz1, marker) {
  const page = mountPage(Module, { search: "?woz=boot.woz", disk });
  try {
    await page.ready;
    assertBooted(page, marker);
    const vm = page.window.vm;
    const control = page.document.getElementById("diskswap");
    assert.equal(control.disabled, false);
    await page.document.getElementById("debugpause").dispatch("click");
    page.document.getElementById("speed").value = "2";
    await page.document.getElementById("speed").dispatch("change");
    await page.document.getElementById("screen").dispatch("keydown", { key: "x" });
    await page.document.getElementById("screen").dispatch("keydown", { key: "y" });
    vm.readBus(0xc007);
    vm.readBus(0xc08b); vm.readBus(0xc08b);
    vm.writeBus(0xd000, 0x5a);
    assert(vm.enableAudio(48000));
    vm.runCycles(10000);
    assert(vm.addBreakpoint(vm.pc()));
    vm.runCycles(100);
    assert(vm.breakpointHit());
    const snapshot = () => ({
      registers: [vm.pc(), vm.regA(), vm.regX(), vm.regY(), vm.sp(), vm.status()],
      memory: Buffer.from(Array.from({ length: 65536 }, (_, address) => vm.peekMapped(address))),
      mappings: [vm.memoryMapping(0x9000), vm.memoryMapping(0xd000), vm.memoryMapping(0xe000)],
      breakpoint: [vm.breakpointHit(), vm.hasBreakpoint(vm.pc())],
      debugger: page.document.getElementById("debugstate").textContent,
      speed: page.document.getElementById("speed").value,
      sound: page.document.getElementById("sound").getAttribute("aria-pressed"),
    });
    const before = snapshot();
    await pickSwap(page, localDisk(replacement));
    assert(vm.diskPresent(0));
    assert.equal(page.document.getElementById("status").textContent, "inserted map.woz without reset");
    assert.deepEqual(snapshot(), before, "swapping must preserve live machine and UI state");
    assert(vm.drainAudio().length > 0, "swapping must not discard queued VM audio");
    assert.equal(page.document.focuses.at(-1), "screen");
    await pickSwap(page, localDisk(replacement));
    assert.deepEqual(snapshot(), before, "reselecting must not reset or run the CPU");
    const focuses = page.document.focuses.length;
    await pickSwap(page, null);
    assert.equal(page.document.focuses.length, focuses, "cancelling must not change focus");
    assert.equal(page.document.getElementById("status").textContent, "inserted map.woz without reset");
    await pickSwap(page, localDisk(maximum, "maximum.woz"));
    assert(vm.diskPresent(0), "an exactly 8 MiB disk must be accepted for swapping");

    let readOversized = false;
    const failures = [
      [{ name: "huge.woz", size: Module.MAX_WOZ_FILE_SIZE + 1, arrayBuffer: async () => { readOversized = true; } }, /8 MiB limit/, true],
      [{ name: "unreadable.woz", size: 1, arrayBuffer: async () => { throw new Error("read denied"); } }, /read denied/, true],
      [localDisk(new Uint8Array(8), "bad.woz"), /not a valid .woz/, true],
      [localDisk(woz1, "old.woz"), /WOZ1 is not supported/, true],
      [localDisk(malformed, "malformed.woz"), /invalid or unsupported WOZ2.*reinsert the previous disk/, false],
    ];
    for (const [file, message, present] of failures) {
      const errors = page.errors.length;
      await pickSwap(page, file);
      assert.match(page.document.getElementById("status").textContent, /^Disk swap failed:/);
      assert.match(page.document.getElementById("status").textContent, message);
      assert.equal(page.errors.length, errors + 1);
      assert.equal(vm.diskPresent(0), present);
      assert.deepEqual(snapshot(), before, "failed swaps must not reset or mutate machine state");
    }
    assert.equal(readOversized, false, "reject oversized files before reading them");
    await pickSwap(page, localDisk(replacement));
    assert(vm.diskPresent(0), "a failed insertion must allow a successful retry");
    assert.deepEqual(snapshot(), before);
    vm.clearBreakpoints();
    vm.readBus(0xc082);
    await page.document.getElementById("debugcontinue").dispatch("click");
    page.runFrames(1);
    assert.equal(vm.peek(0xc000), 0xd8, "swap must preserve the first queued key");
    vm.poke(0xc000, 0);
    page.runFrames(1);
    assert.equal(vm.peek(0xc000), 0xd9, "swap must preserve subsequent queued keys in order");

    // The replacement becomes readable media, but is never executed by the swap.
    vm.setPC(0xc600);
    assertBooted(page, 0xd6);
  } finally {
    page.dispose();
  }
  console.log("PASS: disk swap preserves CPU/RAM/banks/input/audio/debugger; replacement media, cancellation, limits, errors and retry");
}

async function testOverlappingActions(Module, disk, replacement, marker) {
  const controls = ["reset", "bootdisk", "diskfile", "diskswap", "mountsd", "prgfile", "assemble"];
  const assertDisabled = (page, disabled) => {
    for (const id of controls) assert.equal(page.document.getElementById(id).disabled, disabled, id);
  };
  const machineState = vm => ({
    pc: vm.pc(), sp: vm.sp(), a: vm.regA(), x: vm.regX(), y: vm.regY(), p: vm.status(),
    memory: Buffer.from(Array.from({ length: 65536 }, (_, address) => vm.peekMapped(address))),
  });
  for (const kind of ["diskswap", "diskfile", "prgfile", "bootdisk"]) {
    let release, reads = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const page = mountPage(Module, {
      search: "?woz=boot.woz", disk,
      diskResponse: url => {
        if (kind === "bootdisk" && url.pathname.endsWith("/data/disk.woz")) {
          reads++;
          return gate;
        }
        return new Response(disk);
      },
    });
    const bytes = kind === "prgfile"
      ? Uint8Array.of(0xa9, 0xd6, 0x8d, 0x00, 0x04, 0x4c, 0x05, 0x08) : replacement;
    const result = kind === "bootdisk" ? new Response(bytes) : Uint8Array.from(bytes).buffer;
    let pending;
    try {
      await page.ready;
      assertBooted(page, marker);
      const vm = page.window.vm;
      const before = machineState(vm);
      const target = {
        value: "pending",
        files: [{ name: "pending", size: bytes.length, arrayBuffer: () => { reads++; return gate; } }],
      };
      pending = kind === "bootdisk"
        ? page.document.getElementById(kind).dispatch("click")
        : page.document.getElementById(kind).dispatch("change", { target });
      assert.equal(reads, 1, `${kind} must reach its deferred read`);
      assertDisabled(page, true);
      const requestCount = page.requests.length;
      let rejectedReads = 0;
      const rejectedTarget = () => ({
        value: "rejected",
        files: [{ name: "rejected", size: disk.length, arrayBuffer: async () => {
          rejectedReads++;
          return Uint8Array.from(disk).buffer;
        } }],
      });
      for (const [id, event, detail] of [
        ["reset", "click", {}], ["bootdisk", "click", {}],
        ["diskfile", "change", { target: rejectedTarget() }],
        ["diskswap", "change", { target: rejectedTarget() }],
        ["prgfile", "change", { target: rejectedTarget() }],
        ["mountsd", "click", {}], ["assemble", "click", {}],
        ["src", "keydown", { ctrlKey: true, key: "Enter" }],
        ["src", "keydown", { metaKey: true, key: "Enter" }],
      ]) {
        const errors = page.errors.length;
        await page.document.getElementById(id).dispatch(event, detail);
        assert.match(page.document.getElementById("status").textContent, /Another machine action is in progress/);
        assert.equal(page.errors.length, errors + 1, "rejected actions must be reported");
        assertDisabled(page, true);
        assert.equal(page.requests.length, requestCount, "a rejected action started a download");
        assert.equal(rejectedReads, 0, "a rejected action read a file");
        assert.deepEqual(machineState(vm), before, "an overlapping action changed the VM");
      }
      release(result);
      await pending;
      assertDisabled(page, false);
      if (kind === "diskswap") {
        assert.deepEqual(machineState(vm), before);
        assert.equal(page.document.getElementById("status").textContent, "inserted pending without reset");
      } else {
        assertBooted(page, 0xd6);
      }
      await pickSwap(page, localDisk(disk));
      assert.equal(page.document.getElementById("status").textContent, "inserted map.woz without reset");
    } finally {
      release(result);
      await pending;
      page.dispose();
    }
  }

  const editor = mountPage(Module, { search: "?woz=boot.woz", disk });
  try {
    await editor.ready;
    assertBooted(editor, marker);
    editor.document.getElementById("src").value = ".org $0800\nlda #$D6\nsta $0400\nloop: jmp loop";
    const assembling = editor.document.getElementById("assemble").dispatch("click");
    const errors = editor.errors.length;
    await pickSwap(editor, localDisk(replacement));
    assert.equal(editor.errors.length, errors + 1, "assembly must also guard its asynchronous module/program load");
    await assembling;
    assertDisabled(editor, false);
    assertBooted(editor, 0xd6);
    await pickSwap(editor, { name: "bad-read.woz", size: 1, arrayBuffer: async () => { throw new Error("read failed"); } });
    assertDisabled(editor, false);
    await pickSwap(editor, localDisk(disk));
    assert.equal(editor.document.getElementById("status").textContent, "inserted map.woz without reset");
  } finally {
    editor.dispose();
  }
  console.log("PASS: deferred swap/insert/PRG/download actions exclude reset, disk, SD and assembly races; completion/failure releases the guard");
}

async function main() {
  const Module = await createBadgerVM({ print() {}, printErr() {} });
  const { buildBootableWoz } = await import(pathToFileURL(
    path.join(__dirname, "..", "codegen", "tools", "wozgen.mjs")));
  const marker = 0xc5;
  const program = Uint8Array.of(0xa9, marker, 0x8d, 0x00, 0x04, 0x4c, 0x05, 0x08);
  const disk = buildBootableWoz(program, 0x0800);
  const replacement = buildBootableWoz(Uint8Array.of(0xa9, 0xd6, ...program.subarray(2)), 0x0800);
  const limit = Module.MAX_WOZ_FILE_SIZE;
  assert.equal(limit, 8 * 1024 * 1024);
  const diskUrl = "https://disks.example/My Game.woz?revision=2&download=1";
  const query = "?embed=1&woz=" + encodeURIComponent(diskUrl) +
    "&assets=https%3A%2F%2Fcdn.example&src=ignored.s&prg=ignored.prg&code=ignored#ide";
  const player = mountPage(Module, { search: query, disk, saved: ".org $0800\nbrk" });
  assert.equal(player.document.getElementById("reset").disabled, true,
    "machine-changing controls wait for automatic startup");
  assert.equal(player.document.getElementById("diskswap").disabled, true);
  await player.ready;
  assert.deepEqual(player.errors, []);
  assert(player.document.documentElement.classList.contains("embedded"));
  assert.deepEqual(player.storage, [], "embeds never read or replace host-origin editor storage");
  assert.deepEqual(player.document.focuses, [], "auto-boot must not steal the host's keyboard focus");
  assert.deepEqual(player.document.scrolls, [], "an embedded #ide must not reveal hidden source");
  assert.equal(player.document.fullscreenRequests, 0, "fullscreen never starts without a click");
  assert.deepEqual(player.requests.sort(), [
    "https://cdn.example/data/badger6502.bin",
    "https://cdn.example/data/fontrom.dat",
    new URL(diskUrl).href,
  ].sort(), "only the requested disk and mandatory assets load; no SD, default sample, or competing target");
  assert.equal(player.document.getElementById("reset").disabled, false);
  assert.equal(player.document.getElementById("diskswap").disabled, false);
  assert.equal(player.document.getElementById("reset").textContent, "Restart");
  assertBooted(player, marker);
  assert.equal(player.window.vm.diskPresent(0), true);
  assert.deepEqual([...program], Array.from({ length: program.length }, (_, i) => player.window.vm.peek(0x0800 + i)));

  const beforeFullscreen = player.window.vm.pc();
  const fullscreen = player.document.getElementById("fullscreen");
  await fullscreen.dispatch("click");
  assert.equal(player.document.fullscreenElement.id, "emulator");
  assert.equal(fullscreen.textContent, "Exit Fullscreen");
  assert.equal(fullscreen.getAttribute("aria-pressed"), "true");
  assert.equal(player.window.vm.pc(), beforeFullscreen, "fullscreen does not reset the VM");
  await player.document.exitFullscreen(); // Browser Escape also dispatches fullscreenchange.
  assert.equal(fullscreen.textContent, "Fullscreen");
  assert.equal(fullscreen.getAttribute("aria-pressed"), "false");
  await fullscreen.dispatch("click");
  await fullscreen.dispatch("click");
  assert.equal(player.document.fullscreenElement, null, "the control can also exit fullscreen");
  player.document.fullscreenError = new Error("Permission denied");
  await fullscreen.dispatch("click");
  assert.match(player.document.getElementById("status").textContent, /Fullscreen failed: Permission denied/);
  player.document.fullscreenEnabled = false;
  await player.document.dispatch("fullscreenchange");
  assert.equal(fullscreen.disabled, true);
  assert.match(fullscreen.textContent, /unavailable/);

  const requestCount = player.requests.length;
  await pickSwap(player, localDisk(replacement));
  assert.equal(player.window.vm.peek(0x0400), marker, "swapping must not execute the replacement");
  player.window.vm.poke(0x0400, 0);
  const restarting = player.document.getElementById("reset").dispatch("click");
  assert.equal(player.document.getElementById("diskswap").disabled, true);
  const errorsBeforeOverlap = player.errors.length;
  await pickSwap(player, localDisk(replacement));
  assert.equal(player.errors.length, errorsBeforeOverlap + 1, "a swap cannot interrupt Restart");
  await restarting;
  assert.equal(player.document.getElementById("diskswap").disabled, false);
  assertBooted(player, marker);
  assert.notEqual(player.window.vm.peek(0x0400), 0xd6, "Restart must retain the original boot disk after a swap");
  assert.equal(player.requests.length, requestCount, "Restart reuses the disk, ROM, and font bytes");
  const screen = player.document.getElementById("screen");
  await screen.dispatch("keydown", { key: "x" });
  player.runFrames(1);
  assert.equal(player.window.vm.peek(0xc000), 0xd8, "player input still reaches the real uppercase keyboard latch");
  player.dispose();
  console.log("PASS: embedded URL disk boots on the real VM, respects focus/storage/assets, and restarts without a download");
  console.log("PASS: fullscreen entry, button/Escape exit, denial, and unchanged VM state");

  const malformed = Buffer.from(disk);
  malformed.writeUInt32LE(0, 8);
  malformed.writeUInt32LE(0xffffffff, 16);
  const woz1 = Buffer.from(disk);
  woz1[3] = 0x31;
  for (const [search, options, expected] of [
    ["?embed=1&woz=missing.woz", { diskResponse: { ok: false, status: 404 } }, /404/],
    ["?embed=1&woz=https://disks.example/blocked.woz", { diskError: new TypeError("Failed to fetch") }, /Failed to fetch.*CORS/],
    ["?embed=1&woz=bad.woz", { disk: new Uint8Array(8) }, /not a valid .woz/],
    ["?embed=1&woz=html.woz", { disk: new TextEncoder().encode("<html>not a disk</html>") }, /not a valid .woz/],
    ["?embed=1&woz=malformed.woz", { disk: malformed }, /invalid or unsupported WOZ2/],
    ["?embed=1&woz=old.woz", { disk: woz1 }, /WOZ1 is not supported/],
    ["?embed=1&woz=", {}, /needs a disk URL/],
    ["?embed=1&woz=javascript:alert(1)", {}, /must use HTTP or HTTPS/],
  ]) {
    const failed = mountPage(Module, { search, ...options });
    await failed.ready;
    assert.match(failed.document.getElementById("status").textContent, expected);
    assert.equal(failed.errors.length, 1, "failures must also reach the normal error log");
    assert.equal(failed.window.vm.diskPresent(0), false, "failed URLs never fall back to another disk");
    assert(!failed.requests.some(url => url.endsWith("/data/disk.woz")));
    assert.equal(failed.document.getElementById("reset").disabled, false, "Reset remains usable after a download failure");
    failed.dispose();
  }
  console.log("PASS: HTTP, CORS/network, malformed image, empty URL, and unsupported scheme failures stay visible");

  for (const phase of ["headers", "body"]) {
    let aborted = false;
    let attempts = 0;
    const stalled = mountPage(Module, {
      search: "?embed=1&woz=stalled.woz",
      fastTimeout: true,
      diskResponse: (_url, { signal }) => {
        if (++attempts > 1) return new Response(disk);
        if (phase === "headers") {
          return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
            aborted = true;
            reject(signal.reason);
          }, { once: true }));
        }
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(disk.subarray(0, 12));
            signal.addEventListener("abort", () => {
              aborted = true;
              controller.error(signal.reason);
            }, { once: true });
          },
        }));
      },
    });
    await stalled.ready;
    assert(aborted, `${phase} timeout must abort the underlying fetch/body`);
    assert(stalled.deadlines.length >= 3 && stalled.deadlines.every(delay => delay === 30_000),
      "the real production deadline must be exactly 30 seconds");
    assert.match(stalled.document.getElementById("status").textContent, /timed out after 30 seconds/);
    assert.equal(stalled.document.getElementById("reset").disabled, false);
    await stalled.document.getElementById("reset").dispatch("click");
    assert.equal(attempts, 2, "Restart retries a failed URL without a page reload");
    assertBooted(stalled, marker);
    stalled.dispose();
  }
  console.log("PASS: stalled headers and bodies abort at the configured deadline, unlock controls, and can be retried");

  const maximum = Buffer.alloc(limit);
  Buffer.from(disk).copy(maximum);
  maximum.writeUInt32LE(0, 8);
  maximum.write("META", disk.length);
  maximum.writeUInt32LE(limit - disk.length - 8, disk.length + 4);
  const atLimit = mountPage(Module, { search: "?embed=1&woz=maximum.woz", disk: maximum });
  await atLimit.ready;
  assert.deepEqual(atLimit.errors, []);
  assertBooted(atLimit, marker);
  atLimit.dispose();
  for (const response of [
    new Response(null, { headers: { "Content-Length": String(limit + 1) } }),
    new Response(Buffer.alloc(limit + 1)),
    new Response(Buffer.alloc(limit + 1), { headers: { "Content-Length": "1" } }),
  ]) {
    const oversized = mountPage(Module, { search: "?embed=1&woz=oversized.woz", diskResponse: response });
    await oversized.ready;
    assert.match(oversized.document.getElementById("status").textContent, /exceeds the 8 MiB limit/);
    assert.equal(oversized.window.vm.diskPresent(0), false);
    assert.equal(oversized.document.getElementById("reset").disabled, false);
    oversized.dispose();
  }
  console.log("PASS: exact 8 MiB download accepted; oversized declared, absent-length, and underreported bodies rejected");

  let fragment = 0;
  const fragmented = mountPage(Module, {
    search: "?embed=1&woz=fragmented.woz",
    diskResponse: new Response(new ReadableStream({
      pull(controller) {
        if (fragment === disk.length) controller.close();
        else controller.enqueue(disk.subarray(fragment, ++fragment));
      },
    })),
  });
  await fragmented.ready;
  assert.deepEqual(fragmented.errors, []);
  assertBooted(fragmented, marker);
  fragmented.dispose();
  assert.doesNotMatch(mainScript, /chunks\.push\(/, "download memory must not grow per network fragment");
  console.log("PASS: one-byte network fragments reconstruct the exact bootable disk without retaining a chunk list");

  await testDiskSwaps(Module, disk, replacement, maximum, malformed, woz1, marker);
  await testOverlappingActions(Module, disk, replacement, marker);

  const workbench = mountPage(Module, { search: "?woz=games/own.woz&src=ignored.s#ide", disk });
  await workbench.ready;
  assert(!workbench.document.documentElement.classList.contains("embedded"));
  assert(workbench.requests.includes("https://player.example/3ric/games/own.woz"),
    "relative disks resolve against the emulator page, not the embedding site or CDN");
  assert(workbench.requests.some(url => url.endsWith("/programs/swarm.s")), "ordinary editor initialization is preserved");
  assert(!workbench.requests.some(url => url.endsWith("/ignored.s")), "a source link cannot replace the selected disk");
  assert(workbench.document.focuses.includes("src"), "ordinary #ide navigation still focuses the editor");
  assertBooted(workbench, marker);
  let fileRead = false;
  await workbench.document.getElementById("diskfile").dispatch("change", {
    target: {
      value: "huge.woz",
      files: [{ name: "huge.woz", size: limit + 1, arrayBuffer: async () => { fileRead = true; } }],
    },
  });
  assert.equal(fileRead, false, "oversized local files must be rejected before arrayBuffer allocates them");
  assert.match(workbench.document.getElementById("status").textContent, /8 MiB limit/);
  await workbench.document.getElementById("reset").dispatch("click");
  workbench.runFrames(180);
  assert.notEqual(workbench.window.vm.peek(0x0400), marker, "ordinary Reset returns to the ROM instead of rebooting the disk");
  workbench.dispose();

  const inline = Buffer.from(".org $0800\nlda #$51\nsta $0400\nloop: jmp loop").toString("base64url");
  for (const search of ["?embed=1&src=programs/shared.s#ide", `?embed=1&code=${inline}#ide`]) {
    const source = mountPage(Module, { search, saved: "do not overwrite" });
    await source.ready;
    assert.deepEqual(source.errors, []);
    assertBooted(source, 0x51);
    assert.deepEqual(source.storage, []);
    assert.deepEqual(source.document.focuses, [], "embedded source auto-run must not steal focus either");
    assert(!source.requests.some(url => url.endsWith("/programs/swarm.s") || url.endsWith("/data/sd.sparse")));
    source.dispose();
  }

  const invalidCode = Buffer.from(".org $0800\nnot_an_instruction").toString("base64url");
  const invalidSource = mountPage(Module, { search: `?embed=1&code=${invalidCode}` });
  await invalidSource.ready;
  assert.equal(invalidSource.document.getElementById("asmout").className, "err");
  assert.equal(invalidSource.document.getElementById("status").textContent,
    invalidSource.document.getElementById("asmout").textContent,
    "errors from the hidden source editor must be visible in the player");
  invalidSource.dispose();

  const prg = mountPage(Module, { search: "?embed=1&prg=programs/own.prg", disk: program });
  await prg.ready;
  assert.deepEqual(prg.errors, []);
  assertBooted(prg, marker);
  assert.deepEqual(prg.document.focuses, []);
  prg.dispose();

  const empty = mountPage(Module, { search: "?embed=1" });
  await empty.ready;
  assert.equal(empty.requests.length, 2, "plain embeds boot only the ROM and font");
  assert.deepEqual(empty.storage, []);
  empty.dispose();
  console.log("PASS: normal editor/Reset behavior, relative WOZ paths, existing source/PRG embeds, and ROM-only embeds");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
