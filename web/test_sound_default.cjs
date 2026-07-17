const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageHtml = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const inlineScript = pageHtml.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];

assert(inlineScript, "page must include the emulator script");
assert.doesNotThrow(
  () => new Function(inlineScript),
  "emulator script must remain valid JavaScript",
);
assert.match(
  pageHtml,
  /<button id="sound" type="button" aria-pressed="true"\s+title="[^"]+">Disable Sound<\/button>/,
  "sound control must render enabled by default",
);
assert.match(
  inlineScript,
  /let soundRequested = true;/,
  "runtime sound state must default to enabled",
);
assert.match(
  inlineScript,
  /const shouldGenerate = soundRequested && speedMul === 1 && audioNode !== null;/,
  "PCM generation must wait until browser audio finishes unlocking",
);
assert.match(
  inlineScript,
  /function activateDefaultSound\(event\) \{\s+if \(soundButton\.contains\(event\.target\)\) return;\s+disarmDefaultSoundActivation\(\);\s+void activateSound\(\);\s+\}/,
  "the first non-toggle interaction must activate default sound",
);
assert.match(
  inlineScript,
  /document\.addEventListener\("click", activateDefaultSound, true\);\s+document\.addEventListener\("keydown", activateDefaultSound, true\);/,
  "pointer and keyboard gestures must unlock browser audio",
);
assert.match(
  inlineScript,
  /soundButton\.addEventListener\("click", toggleSound\);\s+updateSoundButton\(\);\s+armDefaultSoundActivation\(\);/,
  "default activation must be armed after the sound control is wired",
);
const soundWiringIndex = inlineScript.indexOf(
  'soundButton.addEventListener("click", toggleSound);',
);
assert(
  soundWiringIndex < inlineScript.indexOf("createBadgerVM({"),
  "sound controls must work while the emulator is loading",
);
assert.match(
  inlineScript,
  /if \(audioContext && !audioActivation && soundRequested\) syncAudioForSpeed\(\);/,
  "boot must connect audio that unlocked before the VM was ready",
);
assert.match(
  inlineScript,
  /if \(soundRequested\) \{\s+soundRequested = false;\s+disarmDefaultSoundActivation\(\);\s+syncAudioForSpeed\(\);/,
  "the sound control must opt out before or after activation",
);

class FakeElement {
  constructor(id) {
    this.id = id;
    this.attributes = {};
    this.disabled = false;
    this.listeners = new Map();
    this.textContent = "";
    this.title = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  async dispatch(type, target = this) {
    const results = [...(this.listeners.get(type) || [])]
      .map((listener) => listener({ type, target }));
    await Promise.all(results.filter((result) => result instanceof Promise));
  }

  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  contains(target) {
    return target === this;
  }

  getContext() {
    return {};
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super("document");
    this.baseURI = "https://example.test/";
    this.elements = new Map();
  }

  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new FakeElement(id));
    return this.elements.get(id);
  }
}

function mountPage() {
  const document = new FakeDocument();
  const metrics = {
    connections: 0,
    contexts: 0,
    moduleLoads: 0,
    nodes: 0,
    resumes: 0,
  };

  class FakeAudioContext {
    constructor() {
      metrics.contexts++;
      this.audioWorklet = {
        addModule: async (url) => {
          assert.equal(url.href, "https://example.test/audio-worklet.js");
          metrics.moduleLoads++;
        },
      };
      this.destination = {};
      this.sampleRate = 48000;
    }

    async resume() {
      metrics.resumes++;
    }

    async close() {}
  }

  class FakeAudioWorkletNode {
    constructor() {
      metrics.nodes++;
      this.port = { postMessage() {} };
    }

    connect() {
      metrics.connections++;
    }
  }

  const executePage = new Function(
    "window",
    "document",
    "location",
    "BadgerEmulationClock",
    "BadgerGamepads",
    "createBadgerVM",
    "AudioWorkletNode",
    inlineScript,
  );
  executePage(
    { AudioContext: FakeAudioContext },
    document,
    { search: "" },
    { EmulationClock: class {} },
    { GamepadManager: class {} },
    () => new Promise(() => {}),
    FakeAudioWorkletNode,
  );

  return { document, metrics };
}

async function main() {
  const optedOut = mountPage();
  const optOutButton = optedOut.document.getElementById("sound");
  assert.equal(optOutButton.getAttribute("aria-pressed"), "true");
  assert.equal(optOutButton.textContent, "Disable Sound");
  await optedOut.document.dispatch("click", optOutButton);
  assert.equal(optedOut.metrics.contexts, 0, "the opt-out click must not start audio");
  await optOutButton.dispatch("click");
  assert.equal(optedOut.metrics.contexts, 0, "opting out must not create an audio context");
  assert.equal(optOutButton.getAttribute("aria-pressed"), "false");
  assert.equal(optOutButton.textContent, "Enable Sound");
  assert.equal(optedOut.document.listenerCount("click"), 0);
  assert.equal(optedOut.document.listenerCount("keydown"), 0);

  const activated = mountPage();
  const activatedButton = activated.document.getElementById("sound");
  await activated.document.dispatch(
    "click",
    activated.document.getElementById("screen"),
  );
  await new Promise(setImmediate);
  assert.deepEqual(activated.metrics, {
    connections: 1,
    contexts: 1,
    moduleLoads: 1,
    nodes: 1,
    resumes: 1,
  });
  assert.equal(activated.document.listenerCount("click"), 0);
  assert.equal(activated.document.listenerCount("keydown"), 0);
  assert.equal(activatedButton.getAttribute("aria-pressed"), "true");
  assert.equal(activatedButton.textContent, "Disable Sound");

  await activatedButton.dispatch("click");
  assert.equal(activatedButton.getAttribute("aria-pressed"), "false");
  assert.equal(activatedButton.textContent, "Enable Sound");
  await activatedButton.dispatch("click");
  assert.equal(activated.metrics.contexts, 1, "re-enabling must reuse the audio context");
  assert.equal(activated.metrics.resumes, 2);
  assert.equal(activatedButton.getAttribute("aria-pressed"), "true");
  assert.equal(activatedButton.textContent, "Disable Sound");

  const keyboardActivated = mountPage();
  await keyboardActivated.document.dispatch(
    "keydown",
    keyboardActivated.document.getElementById("screen"),
  );
  await new Promise(setImmediate);
  assert.equal(keyboardActivated.metrics.contexts, 1);
  assert.equal(keyboardActivated.metrics.nodes, 1);

  console.log("PASS: browser sound defaults on and unlocks on first interaction");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
