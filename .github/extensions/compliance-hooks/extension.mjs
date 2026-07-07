import { joinSession } from "@github/copilot-sdk/extension";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";

// =====================================================================
// compliance-hooks — governance-as-code for an AI-run project.
//
// This extension injects the right checklist at the right moment and
// mechanically blocks the two most expensive mistakes (self-merging, and
// pushing to an already-merged PR branch). It reads its prompts from
// .github/instructions/*.md so the wording stays editable without code
// changes. See .github/extensions/compliance-hooks/README.md.
//
// CUSTOMIZE: tune SPEC_PATTERNS below to your repo's layer directories.
// =====================================================================

function getRepoRoot(workingDirectory) {
    return workingDirectory || process.cwd();
}

async function loadInstruction(workingDirectory, filename) {
    const root = getRepoRoot(workingDirectory);
    const path = join(root, ".github", "instructions", filename);
    try {
        return await readFile(path, "utf-8");
    } catch (err) {
        console.error(
            `[compliance-hooks] WARNING: Could not load ${filename}: ${err.message}`
        );
        return null;
    }
}

// Check the current branch's PR state via gh (null if none / gh unavailable).
function checkPrState(workingDirectory) {
    const cwd = getRepoRoot(workingDirectory);
    try {
        const result = execSync(
            'gh pr view --json state,number --jq "{state: .state, number: .number}"',
            { cwd, encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
        );
        return JSON.parse(result.trim());
    } catch (err) {
        // No PR exists for this branch, or gh CLI not available
        return null;
    }
}

// Patterns for detecting spec/layer file edits that warrant a cross-layer check.
// Tuned to 3RIC's layout: the shared VM core, ROMs, hardware, and web build are the
// places where a change can silently break the hardware/host/web consistency invariant.
const SPEC_PATTERNS = [
    /specs\//,
    /(^|\/)emulator\//i,   // shared C++ VM core + WinUI host + tests + disk libs
    /(^|\/)web\//i,        // Emscripten/WASM build + bridge
    /(^|\/)romgen\//i,     // ROM generators (font / video timing)
    /(^|\/)kicad\//i,      // hardware schematic / PCB
    /(^|\/)logisim\//i,    // logic simulation
    /(^|\/)22v10\//,       // 22V10 GAL / PLD equations
    /(^|\/)diylayout\//i,  // DIYLC layout
    /badger6502\.bin/i,    // the shared ROM image (cross-layer contract)
    /fontrom\.dat/i,       // the shared character ROM
];

function isSpecOrLayerFile(path) {
    return SPEC_PATTERNS.some((p) => p.test(path));
}

// Track whether the cross-layer check fired this turn to reduce fatigue.
let crossLayerFiredThisTurn = false;

await joinSession({
    hooks: {
        // =================================================================
        // Session Start — inject core rules and mandatory reading list
        // =================================================================
        onSessionStart: async (input) => {
            crossLayerFiredThisTurn = false;
            const instructions = await loadInstruction(
                input.workingDirectory,
                "onsessionstart.md"
            );
            if (instructions) {
                return { additionalContext: instructions };
            }
        },

        // =================================================================
        // User Prompt Submitted — "which layers?" nudge for feature requests
        // =================================================================
        onUserPromptSubmitted: async (input) => {
            crossLayerFiredThisTurn = false; // reset per-turn tracker
            const msg = input.userPrompt?.toLowerCase() || "";
            const featureKeywords =
                /\b(add|create|implement|build|new feature|endpoint|page|table|column|field)\b/;
            if (featureKeywords.test(msg)) {
                return {
                    additionalContext:
                        "💡 Before starting: which layers does this touch? (Hardware / ROMs / VM core / Host+Web / Disk) — trace all affected layers before editing.",
                };
            }
        },

        // =================================================================
        // Pre-Tool Use — commit, push, PR creation, and MERGE interception
        // =================================================================
        onPreToolUse: async (input) => {
            const cmd = input.toolArgs?.command;
            const isShell = input.toolName === "powershell" || input.toolName === "bash" || input.toolName === "shell";
            const cmdStr = isShell && typeof cmd === "string" ? cmd : "";

            // ─── P0: HARD STOP on gh pr merge ───────────────────────────
            if (isShell && /gh\s+pr\s+merge/.test(cmdStr)) {
                // Only the markdown-only auto-merge path is exempt (docs/learnings/).
                const isLearningsException =
                    /docs\/learnings\//.test(cmdStr) || /learnings/.test(cmdStr);

                if (!isLearningsException) {
                    return {
                        additionalContext:
                            "🛑 **HARD STOP — NEVER SELF-MERGE** 🛑\n\n" +
                            "You are about to run `gh pr merge`. This is FORBIDDEN per LEARNINGS.md §5.\n\n" +
                            "**You MUST NOT proceed with this command.**\n\n" +
                            "Instead:\n" +
                            "1. Provide ebadger with the PR link\n" +
                            "2. Wait for ebadger to merge\n\n" +
                            "The ONLY exception is the `docs/learnings/` markdown auto-merge (see LEARNINGS.md §5).\n\n" +
                            "⛔ DO NOT EXECUTE THIS COMMAND. Cancel it now.",
                    };
                }
            }

            // ─── Git commit — short one-liner checklist ─────────────────
            if (isShell && /git\s+(commit|add\s+-A\s+&&\s+git\s+commit)/.test(cmdStr)) {
                return {
                    additionalContext:
                        "✅ Commit check: layers consistent? specs updated? tests pass? no secrets?",
                };
            }

            // ─── create_pull_request — full PR checklist ────────────────
            if (input.toolName === "create_pull_request") {
                const checklist = await loadInstruction(
                    input.workingDirectory,
                    "pr-checklist.md"
                );
                if (checklist) {
                    return {
                        additionalContext: `⚠️ PR COMPLIANCE — verify before creating:\n\n${checklist}`,
                    };
                }
            }

            // ─── Git push — HARD BLOCK if PR is merged/closed ────────────
            if (isShell && /git\s+push/.test(cmdStr)) {
                const prInfo = checkPrState(input.workingDirectory);
                if (prInfo && prInfo.state === "MERGED") {
                    return {
                        permissionDecision: "deny",
                        permissionDecisionReason:
                            `🛑 PUSH BLOCKED — PR #${prInfo.number} is already MERGED. ` +
                            `Create a new branch from origin/<default-branch> and open a fresh PR. ` +
                            `See LEARNINGS.md §6.`,
                    };
                }
                if (prInfo && prInfo.state === "CLOSED") {
                    return {
                        permissionDecision: "deny",
                        permissionDecisionReason:
                            `🛑 PUSH BLOCKED — PR #${prInfo.number} is CLOSED. ` +
                            `Ask ebadger how to proceed or create a new branch from origin/<default-branch>.`,
                    };
                }
                const pushChecklist = await loadInstruction(
                    input.workingDirectory,
                    "git-push.md"
                );
                if (pushChecklist) {
                    return {
                        additionalContext: `⚠️ PUSH COMPLIANCE — verify before pushing:\n\n${pushChecklist}`,
                    };
                }
                return {
                    additionalContext:
                        "⚠️ Push check: PR is OPEN (verified). Proceed with push.",
                };
            }
        },

        // =================================================================
        // Post-Tool Use — cross-layer check + post-fetch re-read reminder
        // =================================================================
        onPostToolUse: async (input) => {
            const cmd = input.toolArgs?.command;
            const isShell = input.toolName === "powershell" || input.toolName === "bash" || input.toolName === "shell";
            const cmdStr = isShell && typeof cmd === "string" ? cmd : "";

            // ─── After git fetch/pull/reset — re-read reminder ──────────
            if (isShell && /git\s+(fetch|pull|reset\s+--hard)/.test(cmdStr)) {
                return {
                    additionalContext:
                        "📖 You just fetched/pulled/reset. Per LEARNINGS.md §5: re-read `docs/LEARNINGS.md`, `docs/MISSION.md`, and `.github/copilot-instructions.md` if they may have changed.",
                };
            }

            // ─── Cross-layer check (once per turn to reduce fatigue) ────
            if (
                (input.toolName === "edit" || input.toolName === "create") &&
                typeof input.toolArgs?.path === "string" &&
                isSpecOrLayerFile(input.toolArgs.path)
            ) {
                if (!crossLayerFiredThisTurn) {
                    crossLayerFiredThisTurn = true;
                    const instructions = await loadInstruction(
                        input.workingDirectory,
                        "onposttooluse.md"
                    );
                    if (instructions) {
                        return {
                            additionalContext: `⚠️ CROSS-LAYER CHECK: You modified a system layer file.\n\n${instructions}`,
                        };
                    }
                } else {
                    return {
                        additionalContext:
                            "↩️ Cross-layer reminder: verify other layers still consistent.",
                    };
                }
            }
        },

        // =================================================================
        // Post-Tool Use Failure — catch failed push (merged branch?)
        // =================================================================
        onPostToolUseFailure: async (input) => {
            const cmd = input.toolArgs?.command;
            const isShell = input.toolName === "powershell" || input.toolName === "bash" || input.toolName === "shell";
            const cmdStr = isShell && typeof cmd === "string" ? cmd : "";

            if (isShell && /git\s+push/.test(cmdStr)) {
                return {
                    additionalContext:
                        "⚠️ Push failed! Common cause: the PR branch was already merged.\n\n" +
                        "Check with: `gh pr view <N> --json state`\n" +
                        "If MERGED: create a new branch from `origin/<default-branch>`, cherry-pick your commits, and open a fresh PR.\n" +
                        "Do NOT force-push or retry without investigating.",
                };
            }
        },
    },
});
