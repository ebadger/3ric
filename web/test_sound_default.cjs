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
  /if \(!event \|\| event\.isTrusted !== true\) return false;\s+if \(event\.type === "keydown" && event\.key === "Escape"\) return false;/,
  "synthetic and non-activating key events must not consume default activation",
);
assert.match(
  inlineScript,
  /async function activateDefaultSound\(event\) \{\s+if \(soundButton\.contains\(event\.target\) \|\| !isDefaultSoundActivation\(event\)\) return;\s+if \(await activateSound\(\)\) disarmDefaultSoundActivation\(\);\s+\}/,
  "default activation must disarm only after sound starts",
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
  /if \(soundRequested\) \{\s+soundRequested = false;\s+audioError = null;\s+disarmDefaultSoundActivation\(\);\s+syncAudioForSpeed\(\);/,
  "the sound control must opt out before or after activation",
);
assert.match(
  inlineScript,
  /if \(audioError\) \{[\s\S]*?soundButton\.textContent = soundRequested \? "Sound Waiting" : "Retry Sound";[\s\S]*?return;\s+\}/,
  "audio errors must survive unrelated button refreshes and remain retryable",
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
    if (!listeners.includes(listener)) listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  async dispatch(type, target = this, overrides = {}) {
    const event = {
      isTrusted: true,
      key: "",
      target,
      type,
      ...overrides,
    };
    const results = [...(this.listeners.get(type) || [])]
      .map((listener) => listener(event));
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

function mountPage(options = {}) {
  const document = new FakeDocument();
  let deferredResume = null;
  let deferredResumeUsed = false;
  let moduleFailures = options.moduleFailures || 0;
  let resumeFailures = options.resumeFailures || 0;
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
      this.state = "suspended";
      this.audioWorklet = {
        addModule: async (url) => {
          assert.equal(url.href, "https://example.test/audio-worklet.js");
          metrics.moduleLoads++;
          if (moduleFailures > 0) {
            moduleFailures--;
            throw new Error("worklet load failed");
          }
        },
      };
      this.destination = {};
      this.sampleRate = 48000;
    }

    async resume() {
      metrics.resumes++;
      if (options.deferResume && !deferredResumeUsed) {
        deferredResumeUsed = true;
        await new Promise((resolve, reject) => {
          deferredResume = (error) => error ? reject(error) : resolve();
        });
      }
      if (resumeFailures > 0) {
        resumeFailures--;
        const error = new Error("user activation required");
        error.name = "NotAllowedError";
        throw error;
      }
      this.state = "running";
    }

    async close() {
      this.state = "closed";
    }
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
    "console",
    inlineScript,
  );
  executePage(
    {
      AudioContext: FakeAudioContext,
      navigator: { userActivation: { isActive: true } },
    },
    document,
    { search: "" },
    { EmulationClock: class {} },
    { GamepadManager: class {} },
    () => new Promise(() => {}),
    FakeAudioWorkletNode,
    { error() {} },
  );

  return {
    document,
    metrics,
    settleResume(error = null) {
      assert(deferredResume, "deferred resume must be pending");
      deferredResume(error);
    },
  };
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

  const ignored = mountPage();
  const ignoredScreen = ignored.document.getElementById("screen");
  await ignored.document.dispatch("keydown", ignoredScreen, { key: "Escape" });
  await ignored.document.dispatch("keydown", ignoredScreen, {
    isTrusted: false,
    key: "A",
  });
  assert.equal(ignored.metrics.contexts, 0);
  assert.equal(ignored.document.listenerCount("click"), 1);
  assert.equal(ignored.document.listenerCount("keydown"), 1);
  await ignored.document.dispatch("click", ignoredScreen);
  assert.equal(ignored.metrics.contexts, 1);

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

  const blocked = mountPage({ resumeFailures: 1 });
  const blockedButton = blocked.document.getElementById("sound");
  const blockedScreen = blocked.document.getElementById("screen");
  await blocked.document.dispatch("click", blockedScreen);
  assert.equal(blockedButton.getAttribute("aria-pressed"), "true");
  assert.equal(blockedButton.textContent, "Sound Waiting");
  assert.equal(blocked.document.listenerCount("click"), 1);
  await blocked.document.dispatch("click", blockedScreen);
  assert.equal(blocked.metrics.contexts, 2);
  assert.equal(blocked.metrics.nodes, 1);
  assert.equal(blockedButton.textContent, "Disable Sound");
  assert.equal(blocked.document.listenerCount("click"), 0);

  const cancelled = mountPage({ deferResume: true });
  const cancelledButton = cancelled.document.getElementById("sound");
  const cancelledActivation = cancelled.document.dispatch(
    "click",
    cancelled.document.getElementById("screen"),
  );
  await cancelledButton.dispatch("click");
  const cancelledError = new Error("user activation required");
  cancelledError.name = "NotAllowedError";
  cancelled.settleResume(cancelledError);
  await cancelledActivation;
  assert.equal(cancelledButton.getAttribute("aria-pressed"), "false");
  assert.equal(cancelledButton.textContent, "Enable Sound");
  assert.equal(cancelled.document.listenerCount("click"), 0);
  assert.doesNotMatch(cancelledButton.title, /retry/i);

  const failed = mountPage({ moduleFailures: 1 });
  const failedButton = failed.document.getElementById("sound");
  await failed.document.dispatch(
    "click",
    failed.document.getElementById("screen"),
  );
  assert.equal(failedButton.getAttribute("aria-pressed"), "false");
  assert.equal(failedButton.textContent, "Retry Sound");
  assert.match(failedButton.title, /worklet load failed/);
  await failedButton.dispatch("click");
  assert.equal(failed.metrics.contexts, 2);
  assert.equal(failed.metrics.nodes, 1);
  assert.equal(failedButton.getAttribute("aria-pressed"), "true");
  assert.equal(failedButton.textContent, "Disable Sound");
  assert.equal(
    failed.document.getElementById("status").textContent,
    "loading wasm\u2026",
  );

  console.log("PASS: browser sound defaults on and unlocks on first interaction");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
