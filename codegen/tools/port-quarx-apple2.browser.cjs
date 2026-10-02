// Optional real-browser acceptance check; Playwright is external validation tooling.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

async function main() {
  const [input, outputParent, machine = "APPLE2P"] = process.argv.slice(2);
  if (!input || !["APPLE2P", "APPLE2EE"].includes(machine) || process.argv.length > 5)
    throw new Error("Usage: node port-quarx-apple2.browser.cjs <a2quarx-sw.po> [artifact-parent] [APPLE2P|APPLE2EE]");
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const { buildQuarxApple2 } = await import(pathToFileURL(path.join(__dirname, "port-quarx-apple2.mjs")));
  const { sha256 } = await import(pathToFileURL(path.join(__dirname, "port-quarx.mjs")));
  const port = buildQuarxApple2(fs.readFileSync(input));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "quarx-apple2-browser-"));
  const disk = path.join(temporary, "QUARX-APPLE2.woz");
  let artifacts;
  let browser, page;
  try {
    fs.writeFileSync(disk, port.woz, { flag: "wx" });
    if (outputParent) {
      fs.mkdirSync(path.resolve(outputParent), { recursive: true });
      artifacts = fs.mkdtempSync(path.join(path.resolve(outputParent), "apple2-check-"));
    }
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_EXE ? { executablePath: process.env.BROWSER_EXE } : {}),
    });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error("Browser error:", error.message); });
    page.on("console", message => {
      if (message.type() === "error") console.error("Browser console:", message.text());
    });
    await page.addInitScript(({ machine }) => {
      if (location.hostname !== "apple2ts.com") return;
      localStorage.setItem("machineName", JSON.stringify(machine));
      localStorage.setItem("slotConfig", JSON.stringify({
        1: "none", 2: "none", 3: machine === "APPLE2P" ? "none" : "aux",
        4: "mockingboard", 5: "none", 6: "disk2", 7: "none",
      }));
      localStorage.setItem("speedMode", JSON.stringify(5));
      const q = window.quarxTest = {
        workers: [], state: null, memory: null, sound: [], drives: [],
        illegal: machine === "APPLE2P" ? 0x10200 : 0x10100,
      };
      const NativeWorker = window.Worker;
      // Observe the existing app bridge; its CPU, ROM, devices and rendering are unchanged.
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          q.workers.push(this);
          this.addEventListener("message", ({ data }) => {
            if (data.msg === 0) q.state = data.payload;
            if (data.msg === 2) q.drives.push(data.payload);
            if (data.msg === 4) q.memory = data.payload;
            if (data.msg === 9 && q.sound.length < 5000) q.sound.push(data.payload);
          });
        }
      };
      const expression = { register: "", address: 0x300, operator: "==", value: 0x80 };
      const action = { action: "", register: "A", address: 0x300, value: 0 };
      q.breakpoint = (address, instruction = false) => ({
        address, instruction, watchpoint: false, disabled: false, hidden: false, once: false,
        memget: false, memset: true, expression1: { ...expression }, expression2: { ...expression },
        expressionOperator: "", hexvalue: -1, hitcount: 1, nhits: 0, memoryBank: "",
        action1: { ...action }, action2: { ...action }, halt: true, basic: false,
      });
    }, { machine });
    await page.goto("https://apple2ts.com", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.quarxTest?.state, null, { timeout: 30000 });
    const read = async (address, length) => {
      await page.evaluate(() => {
        window.quarxTest.memory = null;
        window.quarxTest.workers[0].postMessage({ msg: 13, payload: true });
      });
      await page.waitForFunction(() => window.quarxTest.memory);
      return page.evaluate(({ address, length }) =>
        Array.from(window.quarxTest.memory.slice(address, address + length)), { address, length });
    };
    const capture = async name => {
      if (artifacts) await page.screenshot({ path: path.join(artifacts, name + ".png") });
    };
    const arm = async target => page.evaluate(target => {
      const q = window.quarxTest;
      const points = new Map([[q.illegal, q.breakpoint(q.illegal, true)]]);
      if (target !== undefined) points.set(target, q.breakpoint(target));
      q.workers[0].postMessage({ msg: 8, payload: true });
      q.workers[0].postMessage({ msg: 5, payload: points });
    }, target);
    const waitStop = async (sequence, target) => {
      const handle = await page.waitForFunction(sequence => {
        const e = window.quarxTest.state.execution;
        return e.state === "paused" && e.executionSequence > sequence ? e : false;
      }, sequence, { timeout: 60000 });
      const stop = await handle.jsonValue();
      assert.equal(stop.PC, target, `Unexpected stop: ${JSON.stringify(stop)}`);
      return stop;
    };
    const advance = async (target, key) => {
      const sequence = await page.evaluate(() => window.quarxTest.state.execution.executionSequence);
      await arm(target);
      await page.evaluate(key => {
        const w = window.quarxTest.workers[0];
        if (key !== undefined) w.postMessage({ msg: 17, payload: { key, isDown: true, repeat: false } });
        w.postMessage({ msg: 29, payload: -1 });
      }, key);
      await waitStop(sequence, target);
      if (key !== undefined) await page.evaluate(key => window.quarxTest.workers[0].postMessage({
        msg: 17, payload: { key, isDown: false, repeat: false },
      }), key);
    };
    const runCycles = async cycles => {
      const before = await page.evaluate(() => ({
        cycles: window.quarxTest.state.s6502.cycleCount,
        sequence: window.quarxTest.state.execution.executionSequence,
      }));
      await arm();
      await page.evaluate(() => {
        const q = window.quarxTest;
        q.sound.length = 0;
        q.workers[0].postMessage({ msg: 36, payload: 0 });
        q.workers[0].postMessage({ msg: 29, payload: -1 });
      });
      await page.waitForFunction(({ before, cycles }) => {
        const q = window.quarxTest;
        return q.state.s6502.cycleCount - before.cycles >= cycles
          || (q.state.execution.state === "paused" && q.state.execution.executionSequence > before.sequence);
      }, { before, cycles }, { timeout: 30000 });
      const state = await page.evaluate(() => window.quarxTest.state.execution);
      assert.equal(state.state, "running", `Unexpected execution stop: ${JSON.stringify(state)}`);
      await page.evaluate(() => window.quarxTest.workers[0].postMessage({ msg: 29, payload: -2 }));
      await page.waitForFunction(() => window.quarxTest.state.execution.state === "paused");
      return page.evaluate(() => window.quarxTest.sound);
    };

    await arm(port.symbols.INIT);
    await page.locator('input[type="file"]').setInputFiles(disk);
    await page.waitForFunction(() => window.quarxTest.drives.some(data =>
      (data.props || data).filename === "QUARX-APPLE2.woz"));
    const beforeBoot = await page.evaluate(() => window.quarxTest.state.execution.executionSequence);
    await page.locator('button[title="Boot"]').click();
    const boot = await waitStop(beforeBoot, port.symbols.INIT);
    assert.equal(boot.machineName, machine);
    assert.equal(boot.memoryConfiguration.slot3Card, machine === "APPLE2P" ? "none" : "aux");
    const expanded = await read(0x900, 0xb700);
    const mismatch = expanded.findIndex((byte, index) => byte !== port.image[0x900 + index]);
    assert.equal(mismatch, -1, `Expanded image differs at $${(0x900 + mismatch).toString(16)}`);
    console.log(`PASS ${machine}: cold WOZ boot and byte-exact image expansion`);

    await advance(port.symbols.NOTICE_KEY);
    assert.deepEqual((await read(0x7ec, 3)).map(byte => byte & 127), [48, 48, 48]);
    await capture("notice");
    const menu = port.symbols.MENU + 0xa6;
    await advance(menu, 32);
    const title = await read(0x4000, 8192);
    const scanline = y => (y & 7) * 1024 + ((y >> 3) & 7) * 128 + (y >> 6) * 40;
    for (let row = 0; row < 7; row++) for (const [column, character] of [..."START GAME"].entries()) {
      const glyph = port.image[port.symbols.FONT + row * 128 + character.charCodeAt(0)];
      assert.equal(title[scanline(166 + row) + 5 + column], glyph ^ 127);
    }
    assert.equal((await read(0, 1))[0] & 1, 1, "Slot-4 music detection failed");
    await runCycles(300000);
    await advance(menu);
    await capture("title");
    for (const [key, song] of [[49, 1], [50, 2], [49, 1]]) {
      await advance(menu, key);
      assert.equal((await read(port.symbols.SELECTED_SONG, 1))[0], song);
    }
    await advance(menu, 10);
    await advance(menu, 13);
    assert.equal((await read(port.symbols.MENU + 0x478, 1))[0], 1);
    await advance(menu, 13);
    assert.equal((await read(port.symbols.MENU + 0x478, 1))[0], 0);
    await advance(menu, 10);
    for (const difficulty of [6, 4, 5]) {
      await advance(menu, 13);
      assert.equal((await read(0x1a, 1))[0], difficulty);
    }
    await advance(menu, 10);
    await advance(0x118d, 13);
    assert.equal((await read(0x142e, 1))[0], 2);
    await advance(0x118d, 8);
    assert.equal((await read(0x142e, 1))[0], 1);
    await advance(0x118d, 21);
    assert.equal((await read(0x142e, 1))[0], 2);
    const pieces = await read(0x136b, 3);
    await advance(0x118d, 32);
    assert.deepEqual(await read(0x136b, 3), [pieces[2], pieces[0], pieces[1]]);
    await advance(0x118d, 10);
    assert.equal((await read(0x142f, 1))[0], 1);
    await capture("game");
    console.log(`PASS ${machine}: original menu/song selection, blocksets, difficulty, movement, rotation and drop`);

    await advance(0x1215, 27);
    const pausedBoard = await read(0x8eb, 65), pausedRow = await read(0x142f, 1);
    const sound = await runCycles(2000000);
    assert.deepEqual(await read(0x8eb, 65), pausedBoard);
    assert.deepEqual(await read(0x142f, 1), pausedRow);
    assert(sound.length > 100, "Too few Mockingboard frames");
    assert(sound.every(frame => frame.slot === 4));
    assert(sound.some(frame => frame.params.slice(8, 11).some(volume => volume > 0)), "Silent soundtrack");
    const distinctFrames = new Set(sound.map(frame => JSON.stringify(frame.params))).size;
    assert(distinctFrames > 20);
    await advance(0x118d, 27);
    console.log(`PASS ${machine}: pause/resume and ${distinctFrames} distinct original music register frames`);

    await page.evaluate(() => window.quarxTest.workers[0].postMessage({ msg: 36, payload: 5 }));
    await advance(0x1ac5);
    await capture("gameover");
    await advance(menu, 32);
    await advance(0x118d, 13);
    assert.equal((await read(0x971, 1))[0], 0);
    assert.equal((await read(0x142e, 1))[0], 2);
    assert.deepEqual(await read(0xfffc, 2), [port.loader.symbols.RESET_ENTRY & 255, port.loader.symbols.RESET_ENTRY >> 8]);
    await arm();
    await page.evaluate(() => {
      const w = window.quarxTest.workers[0];
      w.postMessage({ msg: 36, payload: 0 });
      w.postMessage({ msg: 29, payload: -1 });
    });
    await page.waitForFunction(() => window.quarxTest.state.execution.state === "running");
    await page.locator('button[title="Reset"]').click();
    await page.waitForFunction(() => window.quarxTest.state.softSwitches.BSRREADRAM === false, null, { timeout: 15000 });
    await page.evaluate(() => window.quarxTest.workers[0].postMessage({ msg: 25, payload: "800\r" }));
    let monitor = "";
    for (let attempt = 0; attempt < 50 && !/0800-\s*4C/.test(monitor); attempt++) {
      const text = await read(0x400, 1024);
      monitor = Array.from({ length: 24 }, (_, row) => {
        const base = (row & 7) * 128 + (row >> 3) * 40;
        return String.fromCharCode(...text.slice(base, base + 40).map(byte => byte & 127));
      }).join("\n");
      if (!/0800-\s*4C/.test(monitor)) await page.waitForTimeout(100);
    }
    assert.match(monitor, /0800-\s*4C/, "Reset did not leave a usable ROM monitor");
    console.log(`PASS ${machine}: uninterrupted game-over, restart and usable Reset-to-monitor`);

    if (machine === "APPLE2P") {
      await page.evaluate(() => window.quarxTest.workers[0].postMessage({ msg: 29, payload: -2 }));
      await page.waitForFunction(() => window.quarxTest.state.execution.state === "paused");
      await arm();
      await page.evaluate(() => {
        const q = window.quarxTest, w = q.workers[0];
        // Resume skips the first breakpoint check; the initial NOP is intentional.
        w.postMessage({ msg: 30, payload: { address: 0x800, data: new Uint8Array([0xea, 0xda, 0xea]), run: false } });
        w.postMessage({ msg: 37, payload: { ...q.state.s6502, PC: 0x800 } });
        w.postMessage({ msg: 29, payload: -1 });
      });
      await page.waitForFunction(() => window.quarxTest.state.execution.state === "paused"
        && window.quarxTest.state.execution.PC === 0x801, null, { timeout: 15000 });
      const stop = await page.evaluate(() => window.quarxTest.state.execution);
      assert.equal(stop.breakpoint.breakpointId, "bp:66048");
      console.log("PASS illegal-6502 guard calibration: PHX traps on the Apple II+");
    }
    assert.deepEqual(errors, [], "Browser runtime errors");
    if (artifacts) fs.writeFileSync(path.join(artifacts, "result.json"), JSON.stringify({
      machine, inputSha256: port.inputSha256, wozSha256: sha256(port.woz), distinctMusicFrames: distinctFrames,
      site: "https://apple2ts.com", physicalBoardVerified: false,
    }, null, 2) + "\n", { flag: "wx" });
    console.log(`PASS ${machine}: ${sha256(port.woz)}${artifacts ? `; artifacts ${artifacts}` : ""}`);
  } catch (error) {
    if (page && !page.isClosed()) console.error("Browser failure state:", await page.evaluate(() => {
      const q = window.quarxTest;
      if (!q?.state) return { initialized: !!q };
      return {
        workers: q.workers.length, state: q.state.execution, registers: q.state.s6502,
        runMode: q.state.runMode, isDebugging: q.state.isDebugging,
      };
    }));
    throw error;
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      if (fs.existsSync(disk)) fs.unlinkSync(disk);
      fs.rmdirSync(temporary);
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
