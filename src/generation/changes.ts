// Collects the git changes to describe: staged changes first, otherwise
// unstaged changes plus untracked files, and caps the diff size.

import * as fs from "fs";
import * as path from "path";
import { runGit, runGitPathList } from "./git";
import type { GenerationOptions } from "./options";

// The options that shape what git reports: the diff format and the caps
// that keep the untracked-files section from bloating the AI prompt.
export type ChangeOptions = Pick<GenerationOptions, "diffContextLines" | "ignoreWhitespace" | "excludePatterns" | "untrackedMaxFiles" | "untrackedMaxBytes">;

// The pathspec that keeps excluded files out of the patch: "." for every
// file, then one exclude entry per pattern. Patterns are validated by
// normalizeOptions() before they get here, and every git call passes its
// arguments without a shell.
function excludePathspec(options: ChangeOptions): string[] {
  if (options.excludePatterns.length === 0) {
    return [];
  }
  return ["--", ".", ...options.excludePatterns.map((pattern) => `:(exclude,glob)${pattern}`)];
}
type UntrackedLimits = Pick<ChangeOptions, "untrackedMaxFiles" | "untrackedMaxBytes">;

// The flags that decide which changes count: shared by the diff and the
// summary, so both always describe the same change.
function contentFlags(options: ChangeOptions): string[] {
  return options.ignoreWhitespace ? ["--ignore-all-space"] : [];
}

// The flags that shape the patch text only. They never go to --stat:
// git prints the full patch next to the summary when --stat is combined
// with --unified.
function patchFlags(options: ChangeOptions): string[] {
  return [`--unified=${options.diffContextLines}`];
}

// ===================== GIT CHANGES =====================
// All git commands run with cwd set to the repository root passed in by the
// command handler; the extension host's own working directory is irrelevant.

export interface Changes {
  stat: string;
  diff: string;
  files: string[];
}

// Reads one side of the change (staged or working tree). Which files
// changed, and the summary, never use the exclude patterns or the
// whitespace flag, so every changed file is still named. Only the patch
// text drops excluded files and whitespace-only edits. When that leaves no
// patch at all, the flags are relaxed step by step (whitespace first, then
// the exclusions), so the model never gets an empty diff for a real change.
function readDiff(repoRoot: string, base: readonly string[], options: ChangeOptions): Changes {
  const files = runGitPathList(repoRoot, [...base, "--name-only"]);
  if (files.length === 0) {
    return { stat: "", diff: "", files };
  }
  const patch = patchFlags(options);
  const content = contentFlags(options);
  const exclude = excludePathspec(options);
  const attempts = [[...content, ...patch, ...exclude], [...patch, ...exclude], [...patch]];
  let diff = "";
  for (const flags of attempts) {
    diff = runGit(repoRoot, [...base, ...flags]);
    if (diff.trim() !== "") {
      break;
    }
  }
  return { stat: runGit(repoRoot, [...base, "--stat"]), diff, files };
}

// The new files whose content may be sent: every untracked file the
// exclude patterns do not match, as decided by git itself.
function sendableUntrackedFiles(repoRoot: string, options: ChangeOptions): string[] {
  const exclude = excludePathspec(options);
  return exclude.length === 0 ? getUntrackedFiles(repoRoot) : runGitPathList(repoRoot, ["ls-files", "--others", "--exclude-standard", ...exclude]);
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
export function getChanges(repoRoot: string, options: ChangeOptions): Changes {
  const limits: UntrackedLimits = options;
  const staged = readDiff(repoRoot, ["diff", "--cached"], options);
  if (staged.files.length > 0) {
    return staged;
  }

  let { stat, diff, files } = readDiff(repoRoot, ["diff"], options);

  const untracked = getUntrackedFiles(repoRoot);
  if (untracked.length > 0) {
    // Excluded new files are listed in the summary below but their content
    // is not sent, unless nothing else would be sent at all.
    const sendable = sendableUntrackedFiles(repoRoot, options);
    const contentFiles = sendable.length > 0 || diff.trim() !== "" ? sendable : untracked;
    if (contentFiles.length > 0) {
      const untrackedDiff = `=== UNTRACKED (NEW) FILES ===\n${readUntrackedContent(repoRoot, contentFiles, limits)}`;
      diff = diff.trim() === "" ? untrackedDiff : `${diff}\n\n${untrackedDiff}`;
    }

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
