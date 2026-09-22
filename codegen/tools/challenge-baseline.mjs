import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONTRACT = "codegen/challenges/tts/v1";
const FILES = ["prompt.md", "SUBMITTING.md", "challenge.json"];

export function getChallengeBaseline({ preview = false, root = ROOT } = {}) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (git("rev-parse", "--is-shallow-repository") === "true") {
    throw new Error("Challenge publication needs full Git history (checkout fetch-depth: 0).");
  }
  const additions = git("log", "--diff-filter=A", "--format=%H", "--", `${CONTRACT}/prompt.md`)
    .split(/\s+/).filter(Boolean);
  if (!additions.length) {
    if (preview) return null;
    throw new Error("No committed TTS v1 baseline. Use --preview only for local draft inspection.");
  }
  if (additions.length !== 1) throw new Error("Ambiguous TTS v1 history; do not delete/re-add a frozen brief.");
  const baseline = additions[0];
  for (const file of FILES) {
    const committed = execFileSync("git", ["show", `${baseline}:${CONTRACT}/${file}`],
      { cwd: root, encoding: "utf8" });
    const working = readFileSync(join(root, CONTRACT, file), "utf8");
    if (committed.replace(/\r\n/g, "\n") !== working.replace(/\r\n/g, "\n")) {
      throw new Error(`Frozen TTS v1 contract changed: ${file}. Publish a new version instead.`);
    }
  }
  return baseline;
}
