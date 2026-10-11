// Collects the git changes to describe: staged changes first, otherwise
// unstaged changes plus untracked files, and caps the diff size.

import * as fs from "fs";
import * as path from "path";
import { runGit, runGitPathList } from "./git";
import type { GenerationOptions } from "./options";

// Caps that keep the untracked-files section from bloating the AI prompt.
export type UntrackedLimits = Pick<GenerationOptions, "untrackedMaxFiles" | "untrackedMaxBytes">;

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
  const files = runGitPathList(repoRoot, ["diff", "--cached", "--name-only"]);
  return { stat, diff, files };
}

function getUntrackedFiles(repoRoot: string): string[] {
  return runGitPathList(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
}

function readUntrackedContent(repoRoot: string, files: readonly string[], limits: UntrackedLimits): string {
  const parts: string[] = [];
  let totalBytes = 0;

  for (const file of files) {
    if (parts.length >= limits.untrackedMaxFiles || totalBytes >= limits.untrackedMaxBytes) {
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
export function getChanges(repoRoot: string, limits: UntrackedLimits): Changes {
  const staged = getStagedChanges(repoRoot);
  if (staged.diff.trim() !== "") {
    return staged;
  }

  let stat = runGit(repoRoot, ["diff", "--stat"]);
  let diff = runGit(repoRoot, ["diff"]);
  let files = runGitPathList(repoRoot, ["diff", "--name-only"]);

  const untracked = getUntrackedFiles(repoRoot);
  if (untracked.length > 0) {
    const untrackedDiff = `=== UNTRACKED (NEW) FILES ===\n${readUntrackedContent(repoRoot, untracked, limits)}`;
    diff = diff.trim() === "" ? untrackedDiff : `${diff}\n\n${untrackedDiff}`;

    const listed = untracked
      .slice(0, limits.untrackedMaxFiles)
      .map((file) => ` ${file}`)
      .join("\n");
    const tail = untracked.length > limits.untrackedMaxFiles ? "\n ..." : "";
    const untrackedStat = `Untracked files (${untracked.length}):\n${listed}${tail}`;
    stat = stat.trim() === "" ? untrackedStat : `${stat.trim()}\n${untrackedStat}`;

    files = [...files, ...untracked];
  }

  return { stat, diff, files };
}

// ===================== DIFF CAP =====================

// The diff budget caps the combined diff text (mass reformats can be
// enormous), so the prompt can never outgrow the model's input window or
// the user's token quota. The budget is shared across files, so one huge
// file can never push every other file out of the prompt.

// A file section starts at a "diff --git" header; the untracked-files block
// is one more section. Text before the first header is its own section.
const SECTION_START = /^(diff --git |=== UNTRACKED \(NEW\) FILES ===)/;

// Splits the diff at the start of every file section. Joining the result
// gives back the exact input.
export function splitDiffSections(diff: string): string[] {
  const sections: string[] = [];
  let start = 0;
  let lineStart = 0;
  while (lineStart < diff.length) {
    const lineEnd = diff.indexOf("\n", lineStart);
    const next = lineEnd < 0 ? diff.length : lineEnd + 1;
    if (lineStart > start && SECTION_START.test(diff.slice(lineStart, next))) {
      sections.push(diff.slice(start, lineStart));
      start = lineStart;
    }
    lineStart = next;
  }
  if (start < diff.length) {
    sections.push(diff.slice(start));
  }
  return sections;
}

// Cuts one section to at most maxChars at a line boundary, so no line is
// left half-sent, and says how much was left out.
function cutSection(section: string, maxChars: number, isLast: boolean): string {
  const cut = section.slice(0, maxChars);
  const lastNewline = cut.lastIndexOf("\n");
  const head = lastNewline > 0 ? cut.slice(0, lastNewline) : cut;
  const marker = `... diff truncated (${section.length - head.length} characters omitted)`;
  return isLast ? `${head}\n${marker}` : `${head}\n${marker}\n`;
}

// How many characters each section may keep: sections that fit their fair
// share stay whole, and what they leave unused is shared by the larger ones.
export function shareBudget(lengths: readonly number[], budget: number): number[] {
  const shares = lengths.map(() => 0);
  const order = lengths.map((_, index) => index).sort((a, b) => lengths[a] - lengths[b]);
  let remaining = budget;
  order.forEach((index, position) => {
    const fair = Math.floor(remaining / (order.length - position));
    shares[index] = Math.min(lengths[index], fair);
    remaining -= shares[index];
  });
  return shares;
}

// Fits the diff into maxChars of content. Each cut section adds one short
// marker line on top of its share.
export function truncateDiff(diff: string, maxChars: number): string {
  if (diff.length <= maxChars) {
    return diff;
  }
  const sections = splitDiffSections(diff);
  const shares = shareBudget(
    sections.map((section) => section.length),
    maxChars,
  );
  return sections.map((section, index) => (shares[index] >= section.length ? section : cutSection(section, shares[index], index === sections.length - 1))).join("");
}
