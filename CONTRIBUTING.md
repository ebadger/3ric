# Contributing to 3ric

3ric is a from-scratch, Apple-II-class 65C02 computer with a browser emulator
(<https://ebadger.github.io/3ric/>). The easiest way to contribute is to add a **program** to
the [Community Gallery](https://ebadger.github.io/3ric/gallery.html) — and you can have an AI
coding tool write it for you in a couple of minutes. No C++, no toolchain, no local build.

## TL;DR

1. Ask your AI tool (GitHub Copilot, Cursor, ChatGPT, Claude, …) to write a 65C02 program,
   pointing it at **<https://ebadger.github.io/3ric/llms.txt>** (copy-paste prompt below).
2. Test it in the browser: paste the source at <https://ebadger.github.io/3ric/> and press
   **Assemble & Run**.
3. Submit it with a one-file pull request to `web/gallery.json`.

---

## 1. Have an AI write your program

Paste this into GitHub Copilot Chat (or any AI assistant) — edit the last line to describe
what you want:

> Read <https://ebadger.github.io/3ric/llms.txt> and the platform reference it links.
> Following that dialect and its entry/exit rules, write ONE self-contained 65C02 assembly
> program for the 3ric computer. It must start with `.org $0800`, end with `BRK`, and print
> output with `COUT` ($FDED). Return only the assembly source in a single code block.
> I want it to: **draw a bouncing ball in text mode.**

`llms.txt` is the machine-readable brief: it contains a quickstart (the assembler dialect,
entry/exit rules, the case-insensitive-symbol gotcha, and a worked example) plus links to the
full [platform reference](codegen/platform/platform-ref.md) and
[code-generation guide](codegen/platform/prompt-system.md). Point any AI tool at that URL and
it has everything it needs.

## 2. Test it in the browser (no install)

1. Open the [live editor](https://ebadger.github.io/3ric/).
2. Paste the source into the **Assembler** panel and press **Assemble & Run** (Ctrl+Enter).
3. If it does not assemble, paste the `line N: …` error back to your AI tool and ask it to fix
   it. Iterate until it runs.
4. If your source has no `.org`, set the **org $** field (e.g. `0800`).

## 3. Submit it to the gallery

Pick whichever is easier. Both are a single pull request; the gallery updates automatically.

### Option A — zero-file, browser only (recommended)

1. With your program running, press **Share**. The address bar now holds a
   `…index.html?code=<LONG>` link.
2. Copy the value after `code=` (up to any `&`).
3. Edit [`web/gallery.json`](web/gallery.json) on GitHub — the **➕ Add your program** card in
   the gallery links straight to it — and add one object to the `entries` array:

```json
{
  "title": "Bouncing Ball",
  "author": "your-github-handle",
  "mode": "Text",
  "description": "A ball that bounces around the text screen.",
  "code": "PASTE_THE_CODE_VALUE_HERE"
}
```

Add `"org": "0800"` **only** if your source has no `.org` line. Open the pull request — done.

### Option B — source file

1. Add your program as `codegen/programs/NAME.s`.
2. Add an entry to [`web/gallery.json`](web/gallery.json) that references it:

```json
{
  "title": "Bouncing Ball",
  "author": "your-github-handle",
  "mode": "Text",
  "description": "A ball that bounces around the text screen.",
  "src": "programs/NAME.s"
}
```

3. Open the pull request. The build copies `programs/NAME.s` to the site automatically.

### gallery.json fields

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | Shown as the card heading. |
| `author` | yes | Your name or GitHub handle. |
| `description` | recommended | One or two sentences. |
| `mode` | optional | Badge: `Hi-res`, `Lo-res`, `Text`, or `Serial`. |
| `code` | one of `code`/`src` | Inline program from the **Share** link (the `?code=` value). |
| `src` | one of `code`/`src` | Path like `programs/NAME.s` (Option B). |
| `org` | optional | Hex load address (e.g. `0800`) — only if the source has no `.org`. |
| `tags` | optional | Array of short strings shown as `#tags`. |
| `authorUrl` | optional | `https://…` link for your name. |

Keep entries valid JSON (no trailing commas). That is the whole review bar for a program PR.

---

## Contributing to the machine itself

Changes to the emulator core, ROM, hardware, or tooling follow a stricter workflow —
specs-first, atomic commits, and a two-model code review. Start with
[`docs/LEARNINGS.md`](docs/LEARNINGS.md) and [`specs/SYSTEM.md`](specs/SYSTEM.md), then open a
pull request; the maintainer merges. Please don't self-merge.

## Code of conduct

Be excellent to each other. This is a hobbyist project meant to be welcoming to people
learning 6502 assembly and retro computing for the first time.
