import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT, ROOT, getChallengeBaseline } from "./challenge-baseline.mjs";
import { readEntries } from "./tts-entry.mjs";

export const escapeHtml = (text) => String(text).replace(/[&<>"']/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function inline(text) {
  const token = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let html = "", cursor = 0;
  for (const match of text.matchAll(token)) {
    html += escapeHtml(text.slice(cursor, match.index));
    if (match[1]) html += `<code>${escapeHtml(match[1])}</code>`;
    else if (match[2]) {
      const href = match[3];
      if (!/^https:\/\//.test(href)) throw new Error(`Unsupported prompt link: ${href}`);
      html += `<a href="${escapeHtml(href)}">${escapeHtml(match[2])}</a>`;
    } else html += `<strong>${escapeHtml(match[4])}</strong>`;
    cursor = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(cursor));
}

// Only the document constructs used by our canonical brief are supported; HTML is data.
export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      if (i === lines.length) throw new Error("Unclosed Markdown code fence.");
      i++;
      output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    } else if (/^#{1,3} /.test(line)) {
      const [, hashes, title] = /^(#{1,3}) (.+)$/.exec(line);
      const level = Math.min(4, hashes.length + 1);
      output.push(`<h${level}>${inline(title)}</h${level}>`);
      i++;
    } else if (/^(?:- |\d+\. )/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const prefix = ordered ? /^\d+\. / : /^- /;
      const items = [];
      while (i < lines.length && prefix.test(lines[i])) {
        let text = lines[i++].replace(prefix, "");
        while (i < lines.length && /^ {2,}\S/.test(lines[i])) text += ` ${lines[i++].trim()}`;
        items.push(`<li>${inline(text)}</li>`);
      }
      const tag = ordered ? "ol" : "ul";
      output.push(`<${tag}>${items.join("\n")}</${tag}>`);
    } else {
      const paragraph = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(?:#|```|- |\d+\. )/.test(lines[i])) {
        paragraph.push(lines[i++]);
      }
      output.push(`<p>${inline(paragraph.join(" "))}</p>`);
    }
  }
  return output.join("\n");
}

function substitute(text, values) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (token, key) => {
    if (!(key in values)) throw new Error(`Unresolved publication token ${token}`);
    return values[key];
  });
}

export function buildChallenges({ root = ROOT, preview = false } = {}) {
  const baseline = getChallengeBaseline({ root, preview });
  const canonical = join(root, CONTRACT);
  const web = join(root, "web");
  const destination = join(web, "challenges", "tts");
  const versionDir = join(destination, "v1");
  const config = JSON.parse(readFileSync(join(canonical, "challenge.json"), "utf8"));
  if (config.id !== "tts-v1" || config.version !== 1 || config.status !== "open") {
    throw new Error("Unsupported TTS challenge metadata.");
  }
  const entries = readEntries({ submissionsDir: join(canonical, "submissions"), baseline });
  if (!baseline && entries.length) throw new Error("Cannot publish entries against an uncommitted baseline.");
  const label = baseline ?? "UNCOMMITTED PREVIEW - not a launch baseline";
  const sourceRoot = `https://github.com/ebadger/3ric/blob/${baseline ?? "main"}`;
  const values = { BASELINE: label, SOURCE: sourceRoot };
  const prompt = substitute(readFileSync(join(canonical, "prompt.md"), "utf8"), values);
  const guide = substitute(readFileSync(join(canonical, "SUBMITTING.md"), "utf8"), values);
  const template = readFileSync(join(destination, "index.template.html"), "utf8");
  const kickoff = baseline
    ? `Implement 3RIC Talks v1 at https://ebadger.github.io/3ric/challenges/tts/v1/ . Read the full prompt and submission guide. Start from ebadger/3ric commit ${baseline} in an isolated feature branch or worktree. Build an original engine in your own submission directory, run the checks, commit it and open an independent PR to ebadger/3ric. Do not modify shared platform/checks or another entry. Do not self-merge. Return the PR link, evaluated commit and honest results, limitations and hardware status.`
    : "LOCAL PREVIEW ONLY. No committed launch baseline exists yet. Do not start official model runs from this preview.";
  const state = baseline ? "Open for submissions" : "Local preview - not yet released";
  mkdirSync(versionDir, { recursive: true });
  const entryOutput = join(versionDir, "entries");
  // This ignored subtree belongs exclusively to the generator.
  rmSync(entryOutput, { recursive: true, force: true });
  mkdirSync(entryOutput, { recursive: true });
  const programs = join(web, "programs");
  mkdirSync(programs, { recursive: true });
  for (const name of readdirSync(programs)) {
    if (/^tts-v1-[a-z0-9]+(?:-[a-z0-9]+)*\.s$/.test(name)) rmSync(join(programs, name));
  }
  const cards = [];
  for (const entry of entries) {
    const { metadata, assembly, source, directory } = entry;
    const id = metadata.id;
    const output = join(entryOutput, id);
    mkdirSync(output);
    writeFileSync(join(programs, `tts-v1-${id}.s`), source);
    copyFileSync(join(directory, "tts.s"), join(output, "tts.s"));
    copyFileSync(join(directory, "README.md"), join(output, "README.md"));
    copyFileSync(join(directory, "entry.json"), join(output, "entry.json"));
    writeFileSync(join(output, "tts.prg"), assembly.bytes);
    const reportFile = join(root, "codegen", "out", "tts-v1", id, "report.json");
    const recordings = [];
    if (existsSync(reportFile)) {
      const report = JSON.parse(readFileSync(reportFile, "utf8"));
      if (report.status !== "passed" || report.sourceSha256 !== createHash("sha256").update(source).digest("hex") ||
          report.entryId !== id) {
        throw new Error(`Stale or failing audio report for ${id}; rerun check-tts before publishing.`);
      }
      copyFileSync(reportFile, join(output, "report.json"));
      for (const artifact of report.artifacts ?? []) {
        if (artifact.kind !== "audio") continue;
        if (!/^sentence-[1-4]\.wav$/.test(artifact.file)) throw new Error("Unexpected recording filename.");
        copyFileSync(join(root, "codegen", "out", "tts-v1", id, artifact.file), join(output, artifact.file));
        recordings.push({ file: artifact.file, text: artifact.text });
      }
    }
    const revision = execFileSync("git", ["log", "-1", "--format=%H", "--",
      `${CONTRACT}/submissions/${id}`], { cwd: root, encoding: "utf8" }).trim();
    cards.push({ metadata, recordings, revision });
  }
  const entryHtml = (prefix, siteRoot) => cards.length ? cards.map(({ metadata: m, recordings, revision }) => {
    const assets = `${prefix}entries/${m.id}/`;
    const sourceUrl = revision ? `https://github.com/ebadger/3ric/tree/${revision}/${CONTRACT}/submissions/${m.id}` : `${assets}tts.s`;
    const audio = recordings.map((clip) => `<p>${escapeHtml(clip.text)}</p><audio controls preload="none" src="${assets}${clip.file}"><a href="${assets}${clip.file}">Download recording</a></audio>`).join("\n");
    return `<article class="card"><h3>${escapeHtml(m.title)}</h3>
<p>${escapeHtml(m.description)}</p><p class="note">By ${escapeHtml(m.author)} / model: ${escapeHtml(m.model)}</p>
<p>Limitations (entrant-reported): ${escapeHtml(m.limitations)}</p>
<div class="actions"><a class="button" href="${siteRoot}index.html?src=programs/tts-v1-${m.id}.s">Try in workbench</a>
<a class="button" href="${sourceUrl}">Inspect source</a><a class="button" href="${assets}README.md">Notes / evidence</a>
${revision ? `<a class="button" href="https://github.com/ebadger/3ric/commit/${revision}">Commit / review history</a>` : ""}
<a class="button" href="${assets}tts.prg" download="${m.id}.prg">Download PRG</a></div>
${recordings.length ? `<p class="note">Emulator PCM capture, not a speech-quality or physical-hardware certification. <a href="${assets}report.json">Check report</a></p>${audio}` : '<p class="note">No published recording yet. Listening and physical hardware are not verified here.</p>'}
</article>`;
  }).join("\n") : '<div class="card"><h3>No voices submitted yet.</h3><p>The first engines will appear after their source is reviewed and merged. Until then, explore the brief or build your own entry.</p></div>';
  for (const versioned of [false, true]) {
    const siteRoot = versioned ? "../../../" : "../../";
    const prefix = versioned ? "./" : "v1/";
    const html = substitute(template, {
      ROOT: siteRoot, VERSION_ROOT: prefix,
      PAGE_URL: `https://ebadger.github.io/3ric/challenges/tts/${versioned ? "v1/" : ""}`,
      BASELINE: escapeHtml(label), STATE: state, KICKOFF: escapeHtml(kickoff),
      PROMPT_HTML: renderMarkdown(prompt), GUIDE_HTML: renderMarkdown(guide),
      ENTRIES_HTML: entryHtml(prefix, siteRoot),
    });
    writeFileSync(join(versioned ? versionDir : destination, "index.html"), html);
  }
  writeFileSync(join(versionDir, "prompt.md"), prompt);
  writeFileSync(join(versionDir, "SUBMITTING.md"), guide);
  writeFileSync(join(versionDir, "challenge.json"), JSON.stringify({
    ...config, status: baseline ? config.status : "preview", baseline,
    promptSha256: createHash("sha256").update(prompt).digest("hex"),
    entries: cards.map(({ metadata, revision }) => ({ id: metadata.id, revision: revision || null })),
  }, null, 2) + "\n");
  return { baseline, entries: entries.length, destination };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => !["--preview", "--print-baseline"].includes(arg))) throw new Error("Usage: build-challenges.mjs [--preview] [--print-baseline]");
    if (args.includes("--print-baseline")) console.log(getChallengeBaseline());
    else {
      const result = buildChallenges({ preview: args.includes("--preview") });
      console.log(`Staged 3RIC Talks: ${result.entries} entries; baseline ${result.baseline ?? "UNCOMMITTED PREVIEW"}`);
    }
  } catch (error) {
    console.error(`Challenge publication failed: ${error.message}`);
    process.exitCode = 1;
  }
}
