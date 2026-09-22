import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { renderMarkdown } from "../codegen/tools/build-challenges.mjs";

const web = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(web, file), "utf8");
const prompt = read("challenges/tts/v1/prompt.md");
const guide = read("challenges/tts/v1/SUBMITTING.md");
const metadata = JSON.parse(read("challenges/tts/v1/challenge.json"));
assert.equal(metadata.id, "tts-v1");
assert.equal(metadata.promptSha256, createHash("sha256").update(prompt).digest("hex"));
assert.equal(metadata.status, metadata.baseline ? "open" : "preview");
for (const route of ["challenges.html", "challenges/tts/", "challenges/tts/v1/"]) {
  const file = route.endsWith("/") ? `${route}index.html` : route;
  const html = read(file);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /width=device-width, initial-scale=1/);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
  assert.doesNotMatch(html, /<audio[^>]*autoplay|badger6502\.js/);
  if (route.includes("/tts/")) {
    assert.ok(html.includes(renderMarkdown(prompt)), "complete prompt is present without client-side fetching");
    assert.ok(html.includes(renderMarkdown(guide)), "complete guide is present in HTML");
    if (!metadata.entries.length) {
      assert.match(html, /No voices submitted yet/);
      assert.doesNotMatch(html, /<audio\b|Download PRG/);
    }
  }
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const page = new URL(route, "https://ebadger.github.io/3ric/");
  for (const [, attribute, raw] of html.matchAll(/\s(href|src)="([^"]+)"/g)) {
    if (/^(?:https?:|\/\/)/.test(raw)) continue;
    assert(!raw.startsWith("/"), `project-root URL must be relative: ${raw}`);
    const url = new URL(raw.replace(/&amp;/g, "&"), page);
    assert.ok(url.pathname.startsWith("/3ric/"), `URL escaped project: ${raw}`);
    let target = join(web, decodeURIComponent(url.pathname.slice("/3ric/".length)));
    assert.ok(existsSync(target), `missing ${attribute} target ${target}`);
    if (statSync(target).isDirectory()) target = join(target, "index.html");
    assert.ok(existsSync(target));
    if (url.hash && target.endsWith(".html")) {
      assert.ok(readFileSync(target, "utf8").includes(`id="${url.hash.slice(1)}"`), `missing fragment ${raw}`);
    }
    if (url.searchParams.has("src")) assert.ok(existsSync(join(web, url.searchParams.get("src"))));
  }
}
for (const file of ["index.html", "gallery.html", "story.html", "tutorials.html", "hackaday.html"]) {
  assert.match(read(file), /href="challenges.html"/, `${file} exposes challenge navigation`);
}
assert.match(read("llms.txt"), /challenges\/tts\/v1\/prompt.md/);
assert.match(read("sitemap.xml"), /challenges\/tts\/v1\//);
assert.match(prompt, /48 KiB/);
assert.match(prompt, /language-card/i);
assert.match(prompt, /No SSI-263/);
assert.match(prompt, /Open an independent pull request/);

async function checkCopy(clipboard, expected) {
  let handler, selected = false, copied;
  const elements = {
    "copy-task": { hidden: true, addEventListener(type, value) { assert.equal(type, "click"); handler = value; } },
    "model-task": { value: "same task", focus() {}, select() { selected = true; } },
    "copy-status": { textContent: "" },
  };
  const navigator = clipboard === "allowed"
    ? { clipboard: { async writeText(value) { copied = value; } } }
    : clipboard === "denied"
      ? { clipboard: { async writeText() { throw new Error("Denied"); } } } : {};
  runInNewContext(read("challenge-copy.js"), { document: { getElementById: (id) => elements[id] }, navigator });
  assert.equal(elements["copy-task"].hidden, false);
  await handler();
  assert.match(elements["copy-status"].textContent, expected);
  assert.equal(selected, clipboard !== "allowed");
  if (clipboard === "allowed") assert.equal(copied, "same task");
}
await checkCopy("allowed", /Task copied/);
await checkCopy("denied", /Could not copy automatically: Denied/);
await checkCopy("unavailable", /copy it manually/);

// Exercise the actual workbench selection branch and filename expression with a new entry.
const index = read("index.html");
const start = index.indexOf("const m = /^programs\\/");
const end = index.indexOf("const srcOrg", start);
assert(start > 0 && end > start);
const sample = {
  value: "swarm", options: [{ value: "swarm" }],
  add(option) { this.options.push(option); },
};
const loadedRef = new Function("srcUrl", "srcEl", "sampleEl", "Option",
  `let loadedRef = null; ${index.slice(start, end)} return loadedRef;`)(
  "programs/tts-v1-test-voice.s", { value: "source" }, sample,
  function Option(text, value) { this.text = text; this.value = value; });
assert.equal(sample.value, "tts-v1-test-voice");
assert.equal(loadedRef.name, "tts-v1-test-voice");
const nameExpression = /lastPrg = \{ bytes: res\.bytes, org: res\.org, name: \(([^;]+)\) \};/.exec(index)?.[1];
assert.ok(nameExpression);
assert.equal(new Function("loadedRef", "sampleEl", `return ${nameExpression}`)(loadedRef, sample), "tts-v1-test-voice");
console.log("PASS full static brief, project-relative links, empty state, discovery, clipboard paths and entry download identity");
