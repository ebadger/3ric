import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CONTRACT, ROOT, getChallengeBaseline } from "./challenge-baseline.mjs";
import { buildChallenges, renderMarkdown } from "./build-challenges.mjs";

assert.equal(renderMarkdown("# Title\n\nA **bold** `word`."), "<h2>Title</h2>\n<p>A <strong>bold</strong> <code>word</code>.</p>");
assert.match(renderMarkdown("- A\n  continuation\n- B"), /<li>A continuation<\/li>\n<li>B<\/li>/);
assert.match(renderMarkdown("1. First\n2. Second"), /<ol><li>First<\/li>/);
assert.match(renderMarkdown("```asm\nlda #'< '\n```"), /&lt;/);
assert.match(renderMarkdown("<script>alert(1)</script>"), /&lt;script&gt;/);
assert.throws(() => renderMarkdown("[bad](javascript:alert)"), /Unsupported prompt link/);
assert.throws(() => renderMarkdown("```\nunfinished"), /Unclosed/);

const root = mkdtempSync(join(tmpdir(), "3ric-challenge-publication-"));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
};
const commit = (message) => {
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "core.hooksPath=", "commit", "-qm",
    `${message}\n\nCo-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`);
  return git("rev-parse", "HEAD");
};
try {
  git("init", "-q");
  write(join(root, "README.md"), "Temporary test repository.\n");
  commit("Initial fixture");
  for (const file of ["prompt.md", "SUBMITTING.md", "challenge.json", "submissions/README.md"]) {
    const target = join(root, CONTRACT, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(ROOT, CONTRACT, file), target);
  }
  const template = join(root, "web", "challenges", "tts", "index.template.html");
  mkdirSync(dirname(template), { recursive: true });
  copyFileSync(join(ROOT, "web", "challenges", "tts", "index.template.html"), template);
  assert.throws(() => getChallengeBaseline({ root }), /No committed/);
  assert.equal(getChallengeBaseline({ root, preview: true }), null);
  const draft = buildChallenges({ root, preview: true });
  assert.equal(draft.entries, 0);
  assert.match(readFileSync(join(draft.destination, "index.html"), "utf8"), /LOCAL PREVIEW ONLY/);
  // Do not include preview build output in this miniature repository's launch commit.
  write(join(root, ".gitignore"), "web/challenges/tts/index.html\nweb/challenges/tts/v1/\nweb/programs/\ncodegen/out/\n");
  const baseline = commit("Add frozen v1 contract");
  assert.equal(getChallengeBaseline({ root }), baseline);
  const first = buildChallenges({ root });
  const metadata = JSON.parse(readFileSync(join(first.destination, "v1", "challenge.json"), "utf8"));
  const prompt = readFileSync(join(first.destination, "v1", "prompt.md"), "utf8");
  assert.equal(metadata.baseline, baseline);
  assert.equal(metadata.promptSha256, createHash("sha256").update(prompt).digest("hex"));
  assert.ok(prompt.includes(`/blob/${baseline}/codegen/platform/platform-ref.md`));
  assert.ok(!prompt.includes("{{"));
  assert.match(readFileSync(join(first.destination, "index.html"), "utf8"), /No voices submitted yet/);

  const entryDir = join(root, CONTRACT, "submissions", "test-voice");
  write(join(entryDir, "tts.s"), `.org $0800
  jmp start
TTS_INIT: rts
TTS_SPEAK: lda #0
  rts
TTS_INPUT: .res 122
start: brk
`);
  const entry = {
    schemaVersion: 1, challenge: "tts-v1", id: "test-voice",
    title: "<img src=x onerror=alert(1)>", author: "Test", model: "No model",
    agent: "Tooling fixture", baseline, description: "Not a speech engine.",
    assistance: "Fixture only", license: "MIT", memory: "Always-mapped RAM",
    limitations: "No speech; publication test only.",
  };
  write(join(entryDir, "entry.json"), JSON.stringify(entry));
  write(join(entryDir, "README.md"), "# Tooling-only fixture\nNot a submission.\n");
  const entryRevision = commit("Add tooling fixture");
  assert.notEqual(entryRevision, baseline);
  assert.equal(getChallengeBaseline({ root }), baseline, "later entries cannot move the starting point");
  write(join(root, "web", "programs", "tts-v1-stale.s"), "stale generated source");
  const populated = buildChallenges({ root });
  assert.equal(populated.entries, 1);
  assert.ok(!existsSync(join(root, "web", "programs", "tts-v1-stale.s")));
  const html = readFileSync(join(populated.destination, "v1", "index.html"), "utf8");
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes(`${entryRevision}/${CONTRACT}/submissions/test-voice`));
  assert.match(html, /\.\.\/\.\.\/\.\.\/index.html\?src=programs\/tts-v1-test-voice.s/);
  assert.ok(existsSync(join(populated.destination, "v1", "entries", "test-voice", "tts.prg")));
  assert.match(html, /No published recording yet/);

  const reportPath = join(root, "codegen", "out", "tts-v1", "test-voice", "report.json");
  write(reportPath, JSON.stringify({ entryId: "test-voice", status: "passed", sourceSha256: "stale" }));
  assert.throws(() => buildChallenges({ root }), /Stale or failing audio report/);
  rmSync(reportPath);
  write(join(root, CONTRACT, "prompt.md"), "Silently changed rules.\n");
  assert.throws(() => getChallengeBaseline({ root }), /Frozen TTS v1 contract changed/);
  assert.throws(() => getChallengeBaseline({ root, preview: true }), /Frozen TTS v1 contract changed/);
  console.log("PASS Markdown safety, preview/frozen baseline, later entries, provenance, staging and stale-report rejection");
} finally {
  rmSync(root, { recursive: true, force: true });
}
