// Old-file evidence: the committed version of each changed file, which the
// diff itself does not show, fitted into a fixed character budget.

import { runGit } from "./git";

// ===================== CHANGE EVIDENCE =====================

// The user prompt carries two kinds of change evidence: the diff itself and
// "old file" evidence (the committed version of each changed file, which the
// diff does not show). Both are capped so the prompt can never outgrow the
// model's input window or the user's token quota:
// - the evidence budget (a generation option) caps the total old-file
//   evidence across all files.
// - MIN_PARTIAL skips evidence entirely once too little budget remains.
// - MAX_WINDOW caps the partial window a single oversized file may get.
const MIN_PARTIAL = 1500;
const MAX_WINDOW = 6000;

export interface EvidenceFile {
  file: string;
  oldContent: string;
  // 1-based first/last changed lines in the OLD file; 0/0 when unknown.
  firstChangedLine: number;
  lastChangedLine: number;
}

// Extracts a text window of roughly target chars, growing symmetrically
// around the changed lines (1-based). Falls back to the head of the file
// when the change position is unknown. Never returns more than target chars.
function sliceWindow(oldContent: string, first: number, last: number, target: number): string {
  const lines = oldContent.split(/\r?\n/);
  if (lines.length === 0) {
    return "";
  }

  let result: string;
  if (first <= 0 || last <= 0 || last < first) {
    let chars = 0;
    let end = 0;
    while (end < lines.length && chars + lines[end].length + 1 <= target) {
      chars += lines[end].length + 1;
      end++;
    }
    result = lines.slice(0, end).join("\n");
  } else {
    const center = Math.floor((first + last) / 2) - 1;
    let from = center;
    let to = center + 1;
    let chars = lines[center] ? lines[center].length + 1 : 0;
    while (chars < target && (from > 0 || to < lines.length)) {
      if (from > 0 && (to >= lines.length || center - from <= to - center)) {
        from--;
        chars += lines[from].length + 1;
      } else if (to < lines.length) {
        chars += lines[to].length + 1;
        to++;
      } else {
        break;
      }
    }
    result = lines.slice(from, to).join("\n");
  }

  return result.length <= target ? result : result.slice(0, target);
}

// Exported for unit tests.
// Splits the evidence budget across the changed files, smallest first so the
// largest number of files gets full old-file context. Each file gets either
// its whole old content, a window around its changed lines, or nothing once
// the budget is exhausted. Pure: the caller supplies the fetched contents.
export function buildEvidenceSections(entries: readonly EvidenceFile[], budget: number, minPartial: number, maxWindow: number): { file: string; content: string }[] {
  const sorted = [...entries].sort((a, b) => a.oldContent.length - b.oldContent.length);
  const sections: { file: string; content: string }[] = [];
  let remaining = budget;

  for (const entry of sorted) {
    // XML-style opening/closing tags make the section boundaries
    // unambiguous: file contents may contain anything (including
    // "=====" banners), but the data ends exactly at </commitmg_old_file>.
    // changed_lines tells the model exactly which lines (1-based) this
    // change touched, so it inspects those first instead of trusting the
    // possibly misleading heading git adds to the diff hunks.
    const changedLines = entry.firstChangedLine > 0 ? ` changed_lines="${entry.firstChangedLine}-${entry.lastChangedLine}"` : "";
    const opening = `\n<commitmg_old_file path="${entry.file}"${changedLines}>\n`;
    const closing = `\n</commitmg_old_file>`;
    const frameCost = opening.length + closing.length;
    const wholeCost = entry.oldContent.length + frameCost;
    if (wholeCost <= remaining) {
      sections.push({ file: entry.file, content: `${opening}${entry.oldContent}${closing}` });
      remaining -= wholeCost;
      continue;
    }

    const windowBudget = Math.min(remaining - frameCost, maxWindow);
    if (windowBudget >= minPartial) {
      const window = sliceWindow(entry.oldContent, entry.firstChangedLine, entry.lastChangedLine, windowBudget);
      if (window.length > 0) {
        sections.push({ file: entry.file, content: `${opening}${window}${closing}` });
        remaining -= window.length + frameCost;
      }
    }
  }

  return sections;
}

// Fetches the old content and the changed-line range of each changed file
// from git. New (untracked) files have no committed version and are skipped
// - their full content is already carried by the untracked section of the
// diff. Binary contents and paths git cannot resolve are skipped silently.
function collectEvidenceFiles(repoRoot: string, files: readonly string[]): EvidenceFile[] {
  const entries: EvidenceFile[] = [];
  for (const file of files) {
    try {
      const oldContent = runGit(repoRoot, ["show", `HEAD:${file}`]);
      if (oldContent.includes("\0")) {
        continue; // binary: never show raw bytes to the model
      }
      entries.push({ file, oldContent, ...changedLineRange(repoRoot, file) });
    } catch {
      // New, renamed, or unresolved path: no committed text to show.
    }
  }
  return entries;
}

// The changed-line range of a file in the OLD version, taken from the
// unified=0 diff hunks (staged first, then unstaged). 0/0 when unknown.
function changedLineRange(repoRoot: string, file: string): { firstChangedLine: number; lastChangedLine: number } {
  let first = 0;
  let last = 0;
  for (const args of [
    ["diff", "--cached", "--unified=0", "--", file],
    ["diff", "--unified=0", "--", file],
  ]) {
    try {
      const unified = runGit(repoRoot, args);
      for (const line of unified.split(/\r?\n/)) {
        const match = /^@@ -(\d+)(?:,(\d+))? \+/.exec(line);
        if (!match) {
          continue;
        }
        const start = Number(match[1]);
        const end = start + Math.max(Number(match[2] ?? 1), 1) - 1;
        if (first === 0 || start < first) {
          first = start;
        }
        if (end > last) {
          last = end;
        }
      }
    } catch {
      // Fall through to the other command.
    }
  }
  return { firstChangedLine: first, lastChangedLine: last };
}

// The evidence string appended to the user prompt ("" when nothing fits).
export function evidenceForChanges(repoRoot: string, files: readonly string[], budget: number): string {
  return buildEvidenceSections(collectEvidenceFiles(repoRoot, files), budget, MIN_PARTIAL, MAX_WINDOW)
    .map((section) => section.content)
    .join("");
}
