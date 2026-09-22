# Submitting a 3RIC Talks entry

Read the [complete v1 prompt](https://ebadger.github.io/3ric/challenges/tts/v1/prompt.md)
before implementing. Challenge ID: `tts-v1`. Baseline commit: `{{BASELINE}}`.
The baseline is the commit that first added this version's prompt, not the latest main.
Official entrants receive the same prompt, baseline, tools and host-specified limits.
Community remixes are welcome; disclose their derivation and assistance.

## Start from the shared baseline

Use a separate clone/worktree or a dedicated session starting at `{{BASELINE}}`.
Create a feature branch unless the session already supplies one. Never switch a shared
working tree underneath another session. Do not read another entrant's implementation
as a shortcut for an official same-prompt run.

For a new private working directory:

```text
git clone https://github.com/ebadger/3ric.git 3ric-tts
cd 3ric-tts
git switch -c challenge/tts-your-entry {{BASELINE}}
```

Install/use Emscripten 6.0.1 as described in the
[web instructions]({{SOURCE}}/web/README.md). Node 22 or newer runs the tools.
From the repository root, build the shared runtime:

```text
pwsh -File web\build.ps1
```

## Your entry directory

Choose a lowercase, hyphenated ID of at most 60 characters, such as `my-voice-run-1`.
Create only your own directory under `codegen\challenges\tts\v1\submissions\`.
Do not edit shared manifests, the gallery, platform code, this brief or the common checks.

```text
codegen\challenges\tts\v1\submissions\my-voice-run-1\
  tts.s
  entry.json
  README.md
  test.mjs       (optional additional tests)
  generate.mjs   (if you generate original tables)
```

The assembly must contain the common `TTS_INIT`, `TTS_SPEAK` and `TTS_INPUT` symbols
specified in the prompt. Your README is the entry's implementation record: controls,
callable ABI, memory/bank map, hardware loading, synthesis design, references,
licenses, test commands and known shortcomings.

Start `entry.json` with this shape, replacing all example values with actual facts:

```json
{
  "schemaVersion": 1,
  "challenge": "tts-v1",
  "id": "my-voice-run-1",
  "title": "My original voice",
  "author": "your-name",
  "model": "exact model ID/settings, or explicitly unknown",
  "agent": "coding agent and tools used",
  "baseline": "{{BASELINE}}",
  "description": "What this engine does.",
  "assistance": "None, or a description of human/other-model help.",
  "license": "License for new source and original data; preserve reused notices.",
  "memory": "Actual regions, scratch and bank mappings.",
  "limitations": "Known gaps and what has not been verified."
}
```

All these fields are required. Do not put credentials or private transcripts in metadata.
Do not add self-awarded verification badges. Tests/recordings are evidence with a scope,
not certification of originality, intelligibility or physical compatibility.

## Run the common checks

```text
node codegen\tools\check-tts.mjs --entry my-voice-run-1
```

This validates metadata and assembly, calls your guest engine in the unchanged WASM VM
with bounded execution, and writes PRG/WAV/report artifacts to
`codegen\out\tts-v1\my-voice-run-1\`. Use `--validate-only` for a fast metadata/assembly
check, not as a substitute for runtime checks. `--all` checks all entries.

The common checker does not run entrant-supplied JavaScript. Run and describe your
own tests separately. It cannot certify the interactive application, bank loading
through physical SD/ROM, AY-only sound, speech intelligibility or real hardware.
List those results independently, and mark untested areas honestly.

To try the entry in the workbench, regenerate the challenge staging:

```text
node codegen\tools\build-challenges.mjs
pwsh -File web\serve.ps1 -Port 8011
```

Open `http://localhost:8011/index.html?src=programs/tts-v1-my-voice-run-1.s`.
Use 1x speed and a pointer/key gesture to enable audio. The normal editor supplies
source inspection and PRG/WOZ export; WOZ is not evidence of Apple II compatibility.

## Open an independent PR

Commit your source/metadata/README and any reproducible generators/tests. Do not commit
toolchains or `codegen\out` artifacts. Follow the existing PR template and review rules;
include challenge/entry ID, model/run information, evaluated commit, commands/results,
audio evidence and physical-hardware status.

Check any existing PR's state before pushing. Never self-merge. If push permission is
missing, provide a local commit/patch for the owner and say what remains blocked.
The owner may need to approve Actions for a first-time contributor's fork.

The PR workflow uploads build/recording reports without production credentials.
It does not publish an open PR to Pages. The owner reviews and merges before the
entry appears on the public site. A failing entry stays inspectable in its PR.

Preserve the candidate commit used in the episode. If a reviewer, person or different
model improves it, disclose that later edition rather than silently changing the
claimed original result. Keep award/listening records attached to the evaluated revision.

## Publication and judging

Merged entries get source, workbench and metadata links. The site does not infer speech
quality or hardware success from a check result. The host will add listening/episode
and People's Choice information when there are real entries and a ballot.

No submission fee, account requirement for playing, cloud synthesis service or automated
model ranking is introduced by this challenge.
