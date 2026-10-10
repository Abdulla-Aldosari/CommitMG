// Collects the git changes to describe: staged changes first, otherwise
// unstaged changes plus untracked files, and caps the diff size.

import * as fs from "fs";
import * as path from "path";
import { runGit } from "./git";

// Caps that keep the untracked-files section from bloating the AI prompt.
const UNTRACKED_MAX_FILES = 20;
const UNTRACKED_MAX_BYTES = 10000;

// ===================== GIT CHANGES =====================
// All git commands run with cwd set to the repository root passed in by the
// command handler; the extension host's own working directory is irrelevant.

export interface Changes {
  stat: string;
  diff: string;
  files: string[];
}

function getStagedChanges(repoRoot: string): Changes {
  const stat = runGit(repoRoot, ["diff", "--cached", "--stat"]);
  const diff = runGit(repoRoot, ["diff", "--cached"]);
  const files = runGit(repoRoot, ["diff", "--cached", "--name-only"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { stat, diff, files };
}

function getUntrackedFiles(repoRoot: string): string[] {
  const out = runGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]).trim();
  return out ? out.split("\0").filter(Boolean) : [];
}

function readUntrackedContent(repoRoot: string, files: readonly string[]): string {
  const parts: string[] = [];
  let totalBytes = 0;

  for (const file of files) {
    if (parts.length >= UNTRACKED_MAX_FILES || totalBytes >= UNTRACKED_MAX_BYTES) {
      parts.push(`... (${files.length - parts.length} more untracked files omitted)`);
      break;
    }

    const buffer = fs.readFileSync(path.join(repoRoot, file));

    if (buffer.includes(0)) {
      parts.push(`--- ${file} (new file, binary content skipped) ---`);
      continue;
    }

    const text = buffer.toString("utf8");
    totalBytes += Buffer.byteLength(text, "utf8");
    parts.push(`--- ${file} (new file) ---\n${text}`);
  }

  return parts.join("\n\n");
}

// Prefers staged changes. When nothing is staged, falls back to the unstaged
// working-tree changes and appends untracked (new) files, so the generator
// always has material to describe.
export function getChanges(repoRoot: string): Changes {
  const staged = getStagedChanges(repoRoot);
  if (staged.diff.trim() !== "") {
    return staged;
  }

  let stat = runGit(repoRoot, ["diff", "--stat"]);
  let diff = runGit(repoRoot, ["diff"]);
  let files = runGit(repoRoot, ["diff", "--name-only"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const untracked = getUntrackedFiles(repoRoot);
  if (untracked.length > 0) {
    const untrackedDiff = `=== UNTRACKED (NEW) FILES ===\n${readUntrackedContent(repoRoot, untracked)}`;
    diff = diff.trim() === "" ? untrackedDiff : `${diff}\n\n${untrackedDiff}`;

    const listed = untracked
      .slice(0, UNTRACKED_MAX_FILES)
      .map((file) => ` ${file}`)
      .join("\n");
    const tail = untracked.length > UNTRACKED_MAX_FILES ? "\n ..." : "";
    const untrackedStat = `Untracked files (${untracked.length}):\n${listed}${tail}`;
    stat = stat.trim() === "" ? untrackedStat : `${stat.trim()}\n${untrackedStat}`;

    files = [...files, ...untracked];
  }

  return { stat, diff, files };
}

// ===================== DIFF CAP =====================

// DIFF_MAX caps the combined diff text (mass reformats can be enormous), so
// the prompt can never outgrow the model's input window or the user's
// token quota.
const DIFF_MAX = 40000;

// Caps the diff at DIFF_MAX chars, cutting at a line boundary so the last
// line is never left half-sent.
export function truncateDiff(diff: string): string {
  if (diff.length <= DIFF_MAX) {
    return diff;
  }
  const cut = diff.slice(0, DIFF_MAX);
  const lastNewline = cut.lastIndexOf("\n");
  const head = lastNewline > 0 ? cut.slice(0, lastNewline) : cut;
  return `${head}\n... diff truncated (${diff.length - head.length} characters omitted)`;
}
