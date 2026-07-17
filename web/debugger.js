(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BadgerDebugger = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function buildSourceListing(source, listing) {
    const sourceLines = String(source).split(/\r?\n/);
    return listing.map((record) => ({
      address: record.pc & 0xFFFF,
      bytes: Array.from(record.bytes),
      line: record.line,
      kind: record.kind,
      source: sourceLines[record.line - 1] || "",
    }));
  }

  function parsePairs(text) {
    const pairs = Object.create(null);
    const pattern = /([A-Za-z][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[2];
      pairs[match[1]] = raw[0] === '"' ? raw.slice(1, -1) : raw;
    }
    return pairs;
  }

  function decimal(value) {
    return value == null || value === "" ? null : parseInt(value, 10);
  }

  function hexadecimal(value) {
    return value == null || value === "" ? null : parseInt(value, 16);
  }

  function sourcePriority(line, file) {
    if (!file || file.startsWith("/share/")) return 0;
    return line.type == null ? 2 : 1;
  }

  function symbolPriority(symbol) {
    let score = symbol.type === "lab" ? 4 : 1;
    if (symbol.def != null) score += 2;
    if (/^L[0-9A-F]+$/i.test(symbol.name)) score -= 6;
    if (/^__/.test(symbol.name)) score -= 2;
    return score;
  }

  function parseCa65Debug(text) {
    const files = new Map();
    const segments = new Map();
    const spans = new Map();
    const lines = new Map();
    const rawSymbols = [];

    for (const rawLine of String(text).split(/\r?\n/)) {
      const tab = rawLine.indexOf("\t");
      if (tab < 0) continue;
      const tag = rawLine.slice(0, tab);
      const fields = parsePairs(rawLine.slice(tab + 1));

      if (tag === "file") {
        files.set(decimal(fields.id), fields.name);
      } else if (tag === "seg") {
        segments.set(decimal(fields.id), {
          start: hexadecimal(fields.start),
          size: hexadecimal(fields.size) || 0,
          romBacked: fields.type === "ro" && Boolean(fields.oname),
        });
      } else if (tag === "span") {
        spans.set(decimal(fields.id), {
          segment: decimal(fields.seg),
          start: decimal(fields.start),
          size: decimal(fields.size) || 1,
        });
      } else if (tag === "line") {
        lines.set(decimal(fields.id), {
          file: decimal(fields.file),
          line: decimal(fields.line),
          type: decimal(fields.type),
          spans: fields.span
            ? fields.span.split("+").map((id) => parseInt(id, 10))
            : [],
        });
      } else if (tag === "sym" && fields.val && fields.name) {
        rawSymbols.push({
          address: hexadecimal(fields.val),
          name: fields.name,
          type: fields.type,
          def: decimal(fields.def),
        });
      }
    }

    const romAddresses = new Uint8Array(0x10000);
    for (const segment of segments.values()) {
      if (!segment.romBacked || segment.start == null || segment.size <= 0) continue;
      const end = Math.min(segment.start + segment.size, 0x10000);
      for (let address = Math.max(segment.start, 0); address < end; address++) {
        romAddresses[address] = 1;
      }
    }

    const locations = new Array(0x10000);
    for (const line of lines.values()) {
      const file = files.get(line.file) || null;
      const priority = sourcePriority(line, file);
      for (const spanId of line.spans) {
        const span = spans.get(spanId);
        const segment = span && segments.get(span.segment);
        if (!span || !segment || !segment.romBacked || segment.start == null) continue;
        const start = segment.start + span.start;
        const location = { file, line: line.line };
        for (let offset = 0; offset < span.size; offset++) {
          const address = start + offset;
          if (address < 0 || address > 0xFFFF || !romAddresses[address]) continue;
          const current = locations[address];
          if (!current || priority > current.priority) {
            locations[address] = { ...location, priority };
          }
        }
      }
    }

    const symbols = new Array(0x10000);
    for (const raw of rawSymbols) {
      if (raw.address == null || raw.address < 0 || raw.address > 0xFFFF
          || !romAddresses[raw.address]) continue;
      const definition = raw.def == null ? null : lines.get(raw.def);
      const symbol = {
        address: raw.address,
        name: raw.name,
        file: definition ? (files.get(definition.file) || null) : null,
        line: definition ? definition.line : null,
        priority: symbolPriority(raw),
      };
      const current = symbols[raw.address];
      if (!current || symbol.priority > current.priority) symbols[raw.address] = symbol;
    }

    function lookup(address) {
      if (!Number.isInteger(address) || address < 0 || address > 0xFFFF
          || !romAddresses[address]) return null;
      const location = locations[address];
      const symbol = symbols[address];
      return {
        address,
        location: location ? { file: location.file, line: location.line } : null,
        symbol: symbol ? {
          name: symbol.name,
          file: symbol.file,
          line: symbol.line,
        } : null,
      };
    }

    return { lookup };
  }

  return { buildSourceListing, parseCa65Debug };
});
