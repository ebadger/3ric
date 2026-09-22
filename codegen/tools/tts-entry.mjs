import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assemble } from "./asm6502.mjs";

export const ENTRY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA = /^[a-f0-9]{40}$/i;
const MAX_SOURCE = 1024 * 1024;
const fields = {
  id: 60, title: 160, author: 240, model: 240, agent: 240, baseline: 40,
  description: 4000, assistance: 4000, license: 240, memory: 4000, limitations: 4000,
};

export function validateId(id) {
  if (typeof id !== "string" || id.length > 60 || !ENTRY_ID.test(id))
    throw new Error("entry id must be 1–60 lowercase letters/digits with single hyphen separators");
  return id;
}

function realDirectory(directory) {
  const resolved = path.resolve(directory);
  const root = path.parse(resolved).root;
  let current = root;
  for (const part of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error(`entry path must contain only real directories (no symlinks): ${current}`);
  }
  return resolved;
}

function readRegular(directory, name, limit) {
  const filename = path.join(directory, name);
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`${name} must be a regular file, not a symlink`);
  if (stat.size > limit) throw new Error(`${name} exceeds its ${limit}-byte limit`);
  const bytes = fs.readFileSync(filename);
  if (bytes.length > limit) throw new Error(`${name} exceeds its ${limit}-byte limit`);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!text.trim()) throw new Error(`${name} must not be empty`);
  return text;
}

function boundedAssembly(source) {
  // Isolate the existing assembler's allocation and execution limits. Entrant JS is
  // never loaded; stdin contains assembly text, not JavaScript.
  const result = spawnSync(process.execPath,
    ["--max-old-space-size=96", fileURLToPath(import.meta.url), "--assemble-worker"], {
      input: source, encoding: "utf8", timeout: 10_000, maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
  if (result.error || result.status !== 0)
    throw new Error(`assembly failed: ${result.error?.message || result.stderr.trim().slice(0, 2000) || `worker ${result.signal || result.status}`}`);
  const assembly = JSON.parse(result.stdout);
  assembly.bytes = Uint8Array.from(assembly.bytes);
  return assembly;
}

function validateAssembly(assembly) {
  const { org, bytes, symbols, listing } = assembly;
  if (org !== 0x0800) throw new Error("tts.s must assemble at $0800");
  if (!bytes.length || org + bytes.length > 0xc000)
    throw new Error("raw image must be nonempty and end at or below $C000");
  const occupied = new Uint8Array(0xc000);
  for (const record of listing) {
    if (record.pc < org || record.pc + record.bytes.length > 0xc000)
      throw new Error("all emitted assembly must be in $0800..$BFFF (caller $0300..$031F is reserved)");
    for (let i = 0; i < record.bytes.length; i++) {
      if (occupied[record.pc + i]) throw new Error("overlapping assembly records are not supported");
      occupied[record.pc + i] = record.kind === "instruction" ? 2 : 1;
    }
  }
  for (const name of ["TTS_INIT", "TTS_SPEAK"]) {
    const address = symbols[name];
    if (!Number.isInteger(address) || address < org || address >= 0x9000 ||
        !listing.some(r => r.pc === address && r.kind === "instruction" &&
          r.bytes.length && r.pc + r.bytes.length <= 0x9000))
      throw new Error(`${name} must name an instruction in the always-mapped program image ($0800..$8FFF)`);
  }
  const input = symbols.TTS_INPUT;
  if (!Number.isInteger(input) || input < org || input + 122 > 0x9000)
    throw new Error("TTS_INPUT must reserve 122 bytes in $0800..$8FFF");
  for (let i = 0; i < 122; i++) {
    if (occupied[input + i] !== 1)
      throw new Error("TTS_INPUT must reserve 122 data bytes, without overlapping instructions/routines or unallocated gaps");
  }
}

export function validateEntry(directory, { baseline } = {}) {
  directory = realDirectory(directory);
  const id = validateId(path.basename(directory));
  if (typeof baseline !== "string" || !SHA.test(baseline))
    throw new Error("a resolved 40-hex challenge baseline is required to validate entries");
  let metadata;
  try { metadata = JSON.parse(readRegular(directory, "entry.json", 64 * 1024)); }
  catch (error) { throw new Error(`${id}/entry.json: ${error.message}`); }
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object")
    throw new Error(`${id}: entry.json must be an object`);
  const allowed = new Set(["schemaVersion", "challenge", ...Object.keys(fields)]);
  for (const key of Object.keys(metadata))
    if (!allowed.has(key)) throw new Error(`${id}: unsupported metadata field ${key}`);
  if (metadata.schemaVersion !== 1 || metadata.challenge !== "tts-v1")
    throw new Error(`${id}: schemaVersion must be 1 and challenge must be tts-v1`);
  for (const [key, limit] of Object.entries(fields)) {
    if (typeof metadata[key] !== "string" || !metadata[key].trim() ||
        metadata[key].length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(metadata[key]))
      throw new Error(`${id}: ${key} must be nonempty text of at most ${limit} characters without control characters`);
  }
  validateId(metadata.id);
  if (metadata.id !== id) throw new Error(`${id}: metadata id must match the directory basename`);
  if (!SHA.test(metadata.baseline) || metadata.baseline.toLowerCase() !== baseline.toLowerCase())
    throw new Error(`${id}: metadata baseline does not match the challenge launch SHA`);
  readRegular(directory, "README.md", MAX_SOURCE);
  const source = readRegular(directory, "tts.s", MAX_SOURCE);
  const assembly = boundedAssembly(source);
  validateAssembly(assembly);
  return { metadata, source, assembly, directory };
}

export function readEntries({ submissionsDir, baseline } = {}) {
  const directory = realDirectory(submissionsDir);
  const entries = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const filename = path.join(directory, name);
    const stat = fs.lstatSync(filename);
    if (name === "README.md" && stat.isFile() && !stat.isSymbolicLink()) continue;
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error(`unexpected submission child ${name}: only entry directories and regular README.md are allowed; no symlinks`);
    try { entries.push(validateEntry(filename, { baseline })); }
    catch (error) { error.entryId = name; throw error; }
  }
  return entries;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
    process.argv[2] === "--assemble-worker") {
  try {
    // The unmodified assembler allocates .res and raw-image arrays from expressions.
    // Cap these before allocation, including malicious multi-gigabyte .org/.res values.
    const bounded = Type => new Proxy(Type, {
      construct(target, args, newTarget) {
        if (typeof args[0] === "number" &&
            (!Number.isInteger(args[0]) || args[0] < 0 || args[0] > 0x10000))
          throw new Error("assembly allocation exceeds the 64 KiB address space");
        return Reflect.construct(target, args, newTarget);
      },
    });
    globalThis.Array = bounded(Array);
    globalThis.Uint8Array = bounded(Uint8Array);
    const source = fs.readFileSync(0, "utf8");
    if (Buffer.byteLength(source) > MAX_SOURCE) throw new Error("source exceeds 1 MiB");
    const result = assemble(source);
    process.stdout.write(JSON.stringify({ ...result, bytes: [...result.bytes] }));
  } catch (error) {
    process.stderr.write(error.message);
    process.exitCode = 1;
  }
}
