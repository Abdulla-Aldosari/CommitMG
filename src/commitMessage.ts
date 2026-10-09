// Silent, vscode-free commit message generator. Generates a Conventional Commit
// message from the staged changes using an AI provider API and returns the
// text; the caller (extension.ts) is responsible for inserting it into the
// Source Control input box. buildPromptForRepo() lets callers (e.g. the
// prompt preview command) build the exact prompts without sending. When
// nothing is staged, it falls back to the
// unstaged working-tree changes and appends untracked (new) files, so it
// still has material to describe. When the current project has a
// commitlint.config.js, the authoritative scope list is read from the
// scope-enum rule so the prompt never drifts from the enforced rule;
// without it the scope is unrestricted.
//
// The module is intentionally silent: it never prints to the console and
// never opens files. Failures are reported by throwing; the command handler
// in extension.ts shows them through the VS Code API.
//
// Provider, model and transport selection are entirely the caller's
// responsibility: generateCommitMessage() takes a pre-built AiClient (see
// src/ai/aiClient.ts) and only ever calls its complete(systemPrompt,
// userPrompt) method. This file never imports vscode and never reads an API
// key itself.

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { AiClient } from "./ai/aiClient";

export type CommitStyle = "lengthy" | "medium" | "short" | "titleOnly";

export const COMMIT_STYLES: readonly CommitStyle[] = ["lengthy", "medium", "short", "titleOnly"];

// Thrown when generation is requested with an empty working tree (nothing
// staged, unstaged, or untracked). Exported so callers (e.g. the settings
// panel's Estimate Cost flow) can detect it and add context-specific
// guidance without string matching.
export const NO_CHANGES_ERROR = "No changes found (neither staged nor unstaged).";

// ===================== CONFIGURATION ==========================

// The authoritative length limits come from the project's commitlint
// config (readCommitlintLimits() below), so the prompt and the
// deterministic validation can never drift from the rule commitlint
// enforces at commit time. DEFAULT_LIMITS applies only when the project
// has no commitlint.config.js, or its config does not define the rules.
export interface CommitlintLimits {
  header: number;
  body: number;
}

const DEFAULT_LIMITS: CommitlintLimits = { header: 55, body: 55 };

// The GOOD/WRONG examples come from hand-written ladders of exact-length
// strings (see the EXAMPLE GENERATORS section), sized 50 to 86 characters
// in steps of 4. Every entry length is verified before each generation.
const EXAMPLE_LENGTHS: readonly number[] = [50, 54, 58, 62, 66, 70, 74, 78, 82, 86];

// Caps that keep the untracked-files section from bloating the AI prompt.
const UNTRACKED_MAX_FILES = 20;
const UNTRACKED_MAX_BYTES = 10000;

// ===================== EXAMPLE GENERATORS =====================
// The prompt's GOOD/WRONG examples come from hand-written ladders of
// exact-length strings: 10 complete headers and 10 complete body bullets,
// sized 50 to 86 characters in steps of 4 (EXAMPLE_LENGTHS). A selection
// function picks the GOOD example just UNDER the project limit (limit - 2)
// and the WRONG example just OVER it (limit + 2), so the examples teach
// the boundary without asking the model to count characters. Every entry
// length is verified by assertExamplesValid() before every generation, so
// an edited example that drifts from its declared length fails loudly
// instead of silently teaching a wrong length.

// Ladder of complete Conventional Commit headers, one per EXAMPLE_LENGTHS
// entry, in the same order. Each subject follows the SUBJECT rules below.
const HEADER_EXAMPLES: readonly string[] = [
  "fix(auth): refresh expired tokens quietly at login",
  "feat(api): paginate query results without losing order",
  "perf(query): drop redundant joins in repeated metric loads",
  "feat(edit-command): classify raw command output by stream type",
  "chore(deps): upgrade parser libraries to the latest stable release",
  "fix(webview): close panels first before switching the active workspace",
  "feat(settings): remember panel collapse states across every editor session",
  "docs(readme): explain setup steps and the required environment variables fully",
  "fix(webview): close all opened panels before switching the active workspace screen",
  "chore(deps): upgrade core parser packages towards the very latest stable release train",
];

// Ladder of complete single-line body bullets, same lengths and order.
const BODY_EXAMPLES: readonly string[] = [
  "- group duplicate imports under the same namespace",
  "- reorder the panels so the output stays visible above",
  "- keep the dialog open after a failed submit attempt fails",
  "- normalize provider names before comparing their result lists",
  "- wait for the workspace scan to end before drawing the tree views",
  "- cache the parsed settings so repeated reads skip the disk completely",
  "- restore the previous selection after the list gets rebuilt quietly again",
  "- throttle save requests so bursts of rapid edits collapse into one final save",
  "- release the old document handles completely as soon as the next document reopens",
  "- prefer the user-defined template over the fallback defaults in every real usage case",
];

// The fixed complete sentence behind the wrap examples. Long enough (~180
// chars) to wrap for any limit inside the ladder band, and it ends with a
// full stop so no example ever ends mid-sentence.
const WRAP_SENTENCE_WORDS: readonly string[] = [
  "every",
  "raw",
  "command",
  "output",
  "line",
  "is",
  "classified",
  "from",
  "the",
  "stream",
  "and",
  "exit",
  "code",
  "it",
  "actually",
  "carries",
  "so",
  "a",
  "passing",
  "test",
  "with",
  "the",
  "word",
  "failure",
  "in",
  "its",
  "title",
  "stays",
  "reliably",
  "normal",
  "and",
  "clean",
];

// Greedy word-boundary wrap of words into lines of at most budget chars.
function wrapWords(words: readonly string[], budget: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length > budget) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== "") {
    lines.push(current);
  }
  return lines;
}

// Wraps the sentence as a bullet: "- " on the first line and a 2-space
// indent on every continuation line.
function wrapBullet(words: readonly string[], budget: number): string {
  return wrapWords(words, budget)
    .map((line, i) => (i === 0 ? `- ${line}` : `  ${line}`))
    .join("\n");
}

// Picks the example for a limit: GOOD = the largest ladder entry that fits
// under limit - 2, BAD = the smallest ladder entry that exceeds limit + 2.
// Out-of-band limits clamp to the nearest ladder entry (settings will clamp
// limits into the band later).
function selectExample(examples: readonly string[], limit: number, mode: "good" | "bad"): string {
  if (mode === "good") {
    for (let i = examples.length - 1; i >= 0; i--) {
      if (examples[i].length <= limit - 2) {
        return examples[i];
      }
    }
    return examples[0];
  }
  for (const example of examples) {
    if (example.length >= limit + 2) {
      return example;
    }
  }
  return examples[examples.length - 1];
}

// The index of the GOOD body bullet for a limit (the largest ladder entry
// that fits under limit - 2); shared by the no-blank-line WRONG example.
function goodBodyIndex(limit: number): number {
  for (let i = BODY_EXAMPLES.length - 1; i >= 0; i--) {
    if (BODY_EXAMPLES[i].length <= limit - 2) {
      return i;
    }
  }
  return 0;
}

// Two in-band ladder bullets glued together without the required blank
// line, demonstrating that exact violation.
function noBlankLineExample(limit: number): string {
  const goodIndex = goodBodyIndex(limit);
  const secondIndex = goodIndex > 0 ? goodIndex - 1 : 0;
  return `${BODY_EXAMPLES[goodIndex]}\n${BODY_EXAMPLES[secondIndex]}`;
}

// The wrapped sentence with the continuation indent removed, demonstrating
// that exact violation.
function missingIndentExample(limit: number): string {
  return wrapBullet(WRAP_SENTENCE_WORDS, limit - 2).replace(/\n {2}/g, "\n");
}

// The wrapped sentence with the last word of its first line split
// mid-word, demonstrating that exact violation.
function midWordBreakExample(limit: number): string {
  const firstLine = wrapWords(WRAP_SENTENCE_WORDS, limit - 2)[0];
  const firstLineWords = firstLine.split(" ");
  const lastWord = firstLineWords[firstLineWords.length - 1];
  const splitAt = Math.max(1, Math.floor(lastWord.length / 2));
  const head = firstLineWords.slice(0, -1).join(" ");
  const tailWords = [lastWord.slice(splitAt), ...WRAP_SENTENCE_WORDS.slice(firstLineWords.length)];
  const tail = wrapWords(tailWords, limit - 2)
    .map((line) => `  ${line}`)
    .join("\n");
  return `- ${head} ${lastWord.slice(0, splitAt)}\n${tail}`;
}

// Exported for unit tests.
// Self-check for the guarantees above: every ladder entry matches its
// declared length, the selected GOOD example fits the limit and the WRONG
// example exceeds it (when the limit falls inside the ladder band), and
// every wrapped line stays within the body limit.
export function assertExamplesValid(limits: CommitlintLimits = DEFAULT_LIMITS): void {
  for (const [type, explanation] of TYPE_EXPLANATIONS) {
    if (explanation.length < MIN_TYPE_EXPLANATION) {
      throw new Error(`TYPE_EXPLANATIONS entry "${type}" is ${explanation.length} chars, minimum is ${MIN_TYPE_EXPLANATION}`);
    }
  }

  HEADER_EXAMPLES.forEach((example, i) => {
    if (example.length !== EXAMPLE_LENGTHS[i]) {
      throw new Error(`HEADER_EXAMPLES[${i}] is ${example.length} chars, expected ${EXAMPLE_LENGTHS[i]}: "${example}"`);
    }
  });
  BODY_EXAMPLES.forEach((example, i) => {
    if (example.length !== EXAMPLE_LENGTHS[i]) {
      throw new Error(`BODY_EXAMPLES[${i}] is ${example.length} chars, expected ${EXAMPLE_LENGTHS[i]}: "${example}"`);
    }
  });

  const bandMin = EXAMPLE_LENGTHS[0] + 2;
  const bandMax = EXAMPLE_LENGTHS[EXAMPLE_LENGTHS.length - 1] - 2;

  const goodHeader = selectExample(HEADER_EXAMPLES, limits.header, "good");
  if (limits.header >= bandMin && goodHeader.length > limits.header) {
    throw new Error(`Selected GOOD header example (${goodHeader.length} chars) exceeds limit ${limits.header}: "${goodHeader}"`);
  }
  const badHeader = selectExample(HEADER_EXAMPLES, limits.header, "bad");
  if (limits.header <= bandMax && badHeader.length <= limits.header) {
    throw new Error(`Selected WRONG header example (${badHeader.length} chars) does not exceed limit ${limits.header}: "${badHeader}"`);
  }

  const goodBody = selectExample(BODY_EXAMPLES, limits.body, "good");
  if (limits.body >= bandMin && goodBody.length > limits.body) {
    throw new Error(`Selected GOOD body example (${goodBody.length} chars) exceeds limit ${limits.body}: "${goodBody}"`);
  }
  const badBody = selectExample(BODY_EXAMPLES, limits.body, "bad");
  if (limits.body <= bandMax && badBody.length <= limits.body) {
    throw new Error(`Selected WRONG body example (${badBody.length} chars) does not exceed limit ${limits.body}: "${badBody}"`);
  }

  for (const line of wrapBullet(WRAP_SENTENCE_WORDS, limits.body - 2).split("\n")) {
    if (line.length > limits.body) {
      throw new Error(`Wrapped example line (${line.length} chars) exceeds limit ${limits.body}: "${line}"`);
    }
  }
}

// ===================== COMMITLINT SCOPES =====================

// Exported for unit tests.
// Reads the authoritative scope list from the scope-enum rule of the
// project's commitlint.config.js (the same source of truth commitlint
// enforces at commit time). Returns null when the project has no
// commitlint.config.js, in which case the scope is unrestricted.
export function readAcceptedScopes(repoRoot: string): string[] | null {
  const configPath = path.join(repoRoot, "commitlint.config.js");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  // The original script ran in a fresh process per invocation, so it always
  // read the current file content. Drop the require cache entry first so
  // edits to the config are picked up without reloading the window.
  /* eslint-disable @typescript-eslint/no-require-imports -- mirrors the original script's require() of the user's config */
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath) as { rules?: Record<string, unknown> };
  /* eslint-enable @typescript-eslint/no-require-imports */
  const rule = config && config.rules && config.rules["scope-enum"];

  if (!Array.isArray(rule) || !Array.isArray(rule[2])) {
    throw new Error('"scope-enum" in commitlint.config.js is missing or malformed');
  }

  return rule[2] as string[];
}

// ===================== COMMITLINT LIMITS =====================

// Exported for unit tests.
// Reads the authoritative length limits from the project's commitlint
// config: rules["header-max-length"] and rules["body-max-line-length"] (the
// same source of truth commitlint enforces at commit time). Falls back to
// DEFAULT_LIMITS when the project has no commitlint.config.js or when a
// rule is missing or malformed, so generation keeps working on projects
// without commitlint.
export function readCommitlintLimits(repoRoot: string): CommitlintLimits {
  const configPath = path.join(repoRoot, "commitlint.config.js");
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_LIMITS };
  }

  /* eslint-disable @typescript-eslint/no-require-imports -- mirrors readAcceptedScopes()'s require of the user's config */
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath) as { rules?: Record<string, unknown> };
  /* eslint-enable @typescript-eslint/no-require-imports */

  const readNumber = (ruleName: string, fallback: number): number => {
    const rule = config && config.rules && config.rules[ruleName];
    const value = Array.isArray(rule) ? rule[2] : undefined;
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };

  return {
    header: readNumber("header-max-length", DEFAULT_LIMITS.header),
    body: readNumber("body-max-line-length", DEFAULT_LIMITS.body),
  };
}

// ===================== SCOPE MAP =====================

export interface ScopeMapEntry {
  scope: string;
  description: string;
  files: readonly string[];
}

// The allowed commit types, mirrored from the fixed type-enum rule of the
// project's commitlint config.
const ALLOWED_TYPES: readonly string[] = ["feat", "fix", "perf", "style", "refactor", "docs", "test", "chore", "build", "ci", "revert"];

// Exported for unit tests.
// Reads the scope map from the project's commitlint.config.js. The preferred
// source is the exported baseScopes triples ([name, description, files]);
// configs in the older commented format ("scope", // files: description) are
// parsed as a fallback. Returns null when the project has no commitlint
// config or no parseable scope information.
export function readScopeMap(repoRoot: string): ScopeMapEntry[] | null {
  const configPath = path.join(repoRoot, "commitlint.config.js");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  /* eslint-disable @typescript-eslint/no-require-imports -- mirrors readAcceptedScopes()'s require of the user's config */
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath) as { baseScopes?: unknown };
  /* eslint-enable @typescript-eslint/no-require-imports */

  if (Array.isArray(config.baseScopes)) {
    const structured = config.baseScopes
      .filter((entry): entry is [string, string, unknown] => Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === "string" && typeof entry[1] === "string")
      .map((entry) => ({
        scope: entry[0],
        description: entry[1],
        files: Array.isArray(entry[2]) ? entry[2].filter((file): file is string => typeof file === "string") : [],
      }));
    if (structured.length > 0) {
      return structured;
    }
  }

  // Fallback: configs that only carry the scope list as commented lines.
  const commented: ScopeMapEntry[] = [];
  for (const line of fs.readFileSync(configPath, "utf8").split(/\r?\n/)) {
    const match = /^\s*"([^"]+)",\s*\/\/\s*(.+?)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const [, scope, comment] = match;
    const colon = comment.indexOf(": ");
    if (colon === -1) {
      commented.push({ scope, description: comment, files: [] });
      continue;
    }
    const files = comment
      .slice(0, colon)
      .split(/\s+\+\s+|\s+or\s+|,\s*/)
      .map((file) => file.trim().replace(/\/\*$/, "").replace(/\/$/, "/"))
      .filter((file) => file.length > 0);
    commented.push({ scope, description: comment.slice(colon + 2), files });
  }
  return commented.length > 0 ? commented : null;
}

// Exported for unit tests.
// Maps the changed files to scope entries. Exact file paths win over
// directory prefixes, so a file matched exactly is never shadowed by a
// broader prefix scope (src/tools/release/engine.ts -> engine, not
// release). Returns [] when nothing maps.
export function resolveScopesForFiles(scopeMap: readonly ScopeMapEntry[], files: readonly string[]): ScopeMapEntry[] {
  const resolved = new Map<string, ScopeMapEntry>();

  for (const file of files) {
    const matches: ScopeMapEntry[] = [];
    for (const entry of scopeMap) {
      if (entry.files.includes(file)) {
        matches.push(entry);
      }
    }
    if (matches.length === 0) {
      for (const entry of scopeMap) {
        if (entry.files.some((candidate) => candidate.endsWith("/") && file.startsWith(candidate))) {
          matches.push(entry);
        }
      }
    }
    for (const match of matches) {
      resolved.set(match.scope, match);
    }
  }

  return [...resolved.values()];
}

// Exported for unit tests.
// Deterministic header-metadata checks: the type must be in the allowed
// list, the scope must be in the accepted list, and when the scope map
// resolved the changed files deterministically, the header must use one of
// the resolved scopes. Problems are phrased for the correction prompt, so
// the single retry can fix them verbatim.
export function validateHeaderMeta(message: string, acceptedScopes: readonly string[] | null, resolved: readonly ScopeMapEntry[]): string[] {
  const problems: string[] = [];
  const header = message.split(/\r?\n/, 1)[0] || "";
  const match = /^([a-z]+)(?:\(([^)]+)\))?!?:\s/.exec(header);
  if (!match) {
    return problems; // not shaped like a conventional header; commitlint decides
  }

  const [, type, scope] = match;
  if (!ALLOWED_TYPES.includes(type)) {
    problems.push(`type "${type}" is not allowed (allowed: ${ALLOWED_TYPES.join(", ")})`);
  }
  if (scope !== undefined && acceptedScopes && !acceptedScopes.includes(scope)) {
    problems.push(`scope "${scope}" is not in the accepted scope list`);
  }
  if (scope !== undefined && resolved.length > 0 && !resolved.some((entry) => entry.scope === scope)) {
    const expected = resolved.map((entry) => entry.scope).join(" | ");
    problems.push(`scope should be "${expected}" - the changed files map to it`);
  }

  return problems;
}

// ===================== GIT CHANGES =====================
// All git commands run with cwd set to the repository root passed in by the
// command handler; the extension host's own working directory is irrelevant.

interface Changes {
  stat: string;
  diff: string;
  files: string[];
}

function getStagedChanges(repoRoot: string): Changes {
  const stat = execSync("git diff --cached --stat", { encoding: "utf8", cwd: repoRoot });
  const diff = execSync("git diff --cached", { encoding: "utf8", cwd: repoRoot });
  const files = execSync("git diff --cached --name-only", { encoding: "utf8", cwd: repoRoot })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { stat, diff, files };
}

function getUntrackedFiles(repoRoot: string): string[] {
  const out = execSync("git ls-files --others --exclude-standard -z", {
    encoding: "utf8",
    cwd: repoRoot,
  }).trim();
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
function getChanges(repoRoot: string): Changes {
  const staged = getStagedChanges(repoRoot);
  if (staged.diff.trim() !== "") {
    return staged;
  }

  let stat = execSync("git diff --stat", { encoding: "utf8", cwd: repoRoot });
  let diff = execSync("git diff", { encoding: "utf8", cwd: repoRoot });
  let files = execSync("git diff --name-only", { encoding: "utf8", cwd: repoRoot })
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

// ===================== CHANGE EVIDENCE =====================

// The user prompt carries two kinds of change evidence: the diff itself and
// "old file" evidence (the committed version of each changed file, which the
// diff does not show). Both are capped so the prompt can never outgrow the
// model's input window or the user's token quota:
// - DIFF_MAX caps the combined diff text (mass reformats can be enormous).
// - EVIDENCE_BUDGET caps the total old-file evidence across all files.
// - MIN_PARTIAL skips evidence entirely once too little budget remains.
// - MAX_WINDOW caps the partial window a single oversized file may get.
// These are the knobs that trade generation quality against token quota;
// the settings work planned later will expose them to the user.
const DIFF_MAX = 40000;
const EVIDENCE_BUDGET = 48000;
const MIN_PARTIAL = 1500;
const MAX_WINDOW = 6000;

// Caps the diff at DIFF_MAX chars, cutting at a line boundary so the last
// line is never left half-sent.
function truncateDiff(diff: string): string {
  if (diff.length <= DIFF_MAX) {
    return diff;
  }
  const cut = diff.slice(0, DIFF_MAX);
  const lastNewline = cut.lastIndexOf("\n");
  const head = lastNewline > 0 ? cut.slice(0, lastNewline) : cut;
  return `${head}\n... diff truncated (${diff.length - head.length} characters omitted)`;
}

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
      const oldContent = execSync(`git show "HEAD:${file}"`, { encoding: "utf8", cwd: repoRoot });
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
  for (const command of [`git diff --cached --unified=0 -- "${file}"`, `git diff --unified=0 -- "${file}"`]) {
    try {
      const unified = execSync(command, { encoding: "utf8", cwd: repoRoot });
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
function evidenceForChanges(repoRoot: string, files: readonly string[]): string {
  return buildEvidenceSections(collectEvidenceFiles(repoRoot, files), EVIDENCE_BUDGET, MIN_PARTIAL, MAX_WINDOW)
    .map((section) => section.content)
    .join("");
}

// ===================== PROMPT =====================

// ===================== TYPE GUIDE =====================
// The fixed commit types with a full explanation paragraph for each one.
// Every paragraph must stay above MIN_TYPE_EXPLANATION chars (enforced by
// assertExamplesValid), so the model always receives a detailed, general
// decision guide instead of one-line hints. The explanations are generic
// on purpose: they apply to any project, with no special cases.
const MIN_TYPE_EXPLANATION = 600;

const TYPE_EXPLANATIONS: readonly (readonly [string, string])[] = [
  [
    "feat",
    "A new capability that users of the software can observe or use. Choose feat whenever the change adds something that did not exist before: a new command, a new option, a new panel, a new setting, a new function exposed through an interface, or a new behavior that end users can trigger. The key question is whether a user can notice the addition from outside the code - if a user can see, click, call, or configure something new, it is a feat. Small additions count as feat too, as long as they are user-visible; the size of the change does not matter, only its nature. Do not choose feat for changes that only move code around, only adjust formatting, only touch internals that users cannot perceive, or only modify documentation or tests. When the change combines a new capability with other kinds of work, lead with feat because the new capability is the headline of the commit, and describe the supporting work in the body rather than splitting the commit into several types.",
  ],
  [
    "fix",
    "Choose fix when the change repairs something that was not working correctly. The malfunction can be any deviation between what the code is supposed to do and what it actually does: a crash, an incorrect result, a missing output, a broken interaction, a regression, a case where the code never worked as intended, or a situation where existing behavior stopped happening because of some earlier mistake. The deciding question is whether the change makes something work that previously did not work - if yes, it is a fix, regardless of how small the change is or where the fault came from. Fix also covers restoring behavior that was accidentally lost or disabled. Do not choose fix for adding new behavior that never existed, for reorganizing code that already works, for pure formatting, or for documentation and test-only changes. When a change both repairs something and adds something new, ask which of the two is the main point of the change; if the repair is the reason the change exists, fix is the correct type.",
  ],
  [
    "perf",
    "Choose perf when the change makes existing behavior faster, lighter, or cheaper without altering what the behavior does. The improvement can show up as shorter execution time, lower memory usage, fewer network or disk operations, smaller bundle or artifact size, or reduced startup cost. The key question is whether the observable result of the code stays the same while the resources it consumes go down - if yes, it is perf, even when the gain is small. Perf changes often look like rewrites, and they usually do not add or remove features; the same inputs produce the same outputs, only more efficiently. Do not choose perf for a change that primarily adds a feature, repairs a bug, or cleans up code structure, even if it happens to run marginally faster as a side effect; judge the intent of the change, not its side effects. When an optimization is the stated goal of the change, perf is the type that communicates that goal to readers and to the changelog.",
  ],
  [
    "style",
    "Choose style when the change affects only the appearance or presentation of the code without changing what it does. Style covers formatting, indentation, spacing, line breaks, quotation style, comment decoration, renaming of identifiers to better names, sorting of imports or properties, and any cosmetic alignment with a style guide or a formatter. The deciding question is whether a reader of the code, or the running program, can detect any difference in behavior - if the behavior is byte-for-byte identical and only the written form changed, it is style. Style is the right type for the output of formatters and linters that only reorder or reformat, and for commits whose purpose is readability and consistency. Do not choose style when the change fixes a mistake, adds a capability, alters control flow, changes a value or a condition, or re-activates anything that had stopped working; those are functional changes with their own types, no matter how small they look.",
  ],
  [
    "refactor",
    "Choose refactor when the change reorganizes the internal structure of the code without changing its observable behavior. Refactors move code between files or functions, extract helpers, inline redundant layers, rename internals, replace data structures with equivalent ones, reduce duplication, or restructure control flow into a clearer shape. The key question is whether the software still does exactly the same things after the change - if a user or a test cannot tell the difference, it is a refactor. The motivation of a refactor is internal quality: readability, maintainability, testability, or preparation for future work. Do not choose refactor when the reorganization is a side effect of adding a feature or fixing a bug; lead with the functional type instead. Also do not use refactor for pure formatting (that is style) or for performance-motivated rewrites (that is perf). When behavior changes even slightly, the change is not a refactor.",
  ],
  [
    "docs",
    "Choose docs when the change touches documentation and nothing else: README files, user guides, project documentation, code comments that explain concepts to humans, changelog entries, and any text whose purpose is to inform people rather than to run. The deciding question is whether the change modifies how the software behaves - if the only thing that changed is text meant for humans, docs is the right type. This includes fixing typos in documentation, expanding explanations, adding examples or diagrams, and updating written descriptions to match the current behavior of the code. Do not choose docs for changes to code files that merely happen to adjust comments alongside functional edits; in that case the functional type wins. Also do not use docs for documentation files that are actually configuration, or for test files that happen to contain many comments.",
  ],
  [
    "test",
    "Choose test when the change is confined to tests and test infrastructure: adding, updating, removing, or fixing test cases, fixtures, snapshots, test helpers, test configuration, and anything else that exists only to verify the software. The deciding question is whether the change is executed as part of verification rather than as part of the product - if the change only affects how the software is checked, test is the right type. Test includes adding coverage for existing behavior, adjusting expectations after an intentional behavior change, and repairing tests that fail for reasons of their own. Do not choose test when the change also alters product code; if product code and its tests change together, lead with the type that describes the product change and mention the test updates in the body, because the product change is the headline of the commit.",
  ],
  [
    "chore",
    "Choose chore for routine maintenance that does not change product behavior, is not documentation, and is not part of the build or CI systems. Typical chores are updating or pinning dependencies, adjusting configuration files, housekeeping in the repository, tooling updates that have no user-visible effect, removing dead files, and small administrative changes. The deciding question is whether the change is worth recording but does not fit any of the functional or structural types - if it is necessary maintenance that users cannot perceive, chore is the right type. Chore is the honest label for work that keeps the project healthy without changing what the software does. Do not choose chore when the change adds a feature, fixes a bug, or modifies documentation, tests, build output, or pipeline behavior; those each have a more specific type that communicates more to readers and to the changelog. When in doubt between chore and a more specific type, prefer the specific type.",
  ],
  [
    "build",
    "Choose build when the change affects the build system itself: build scripts, bundlers, compiler configuration, module resolution, package scripts that produce the distributable artifact, and any tooling that turns source code into the shipped output. The deciding question is whether the change alters how the software is assembled rather than how it behaves - if the change is about producing, packaging, or compiling, build is the right type. This includes upgrading a bundler, adjusting compiler options, adding or removing build steps, and fixing packaging problems. Do not choose build for changes to the source code that the build then compiles; those use their functional types. Also do not use build for dependencies that the application consumes at runtime, or for pipeline automation that runs builds in the cloud (that is ci).",
  ],
  [
    "ci",
    "Choose ci when the change affects continuous integration or delivery automation: workflow files, pipeline definitions, job configuration, deployment scripts, and anything that runs on the automation platform rather than on a developer's machine. The deciding question is whether the change alters how the project is checked, built, or released automatically - if the change lives in the automation layer, ci is the right type. This includes adding or adjusting jobs, changing triggers, fixing pipeline failures, updating action versions, and modifying release automation. Do not choose ci for the code the pipeline tests or builds (those use their functional types), for local build configuration (that is build), or for repository documentation that describes the pipeline (that is docs). When a change touches both the automation and the product, lead with the product type and mention the automation in the body.",
  ],
  [
    "revert",
    "Choose revert when the change undoes a previous commit, restoring the codebase to the state it had before that commit. The message should name the commit being reverted and, in the body, explain why the undo was necessary. The deciding question is whether the change is primarily an undo of earlier work - if the intent is to take something back, revert is the right type. Reverts can be partial: a revert may restore some parts of a previous change while keeping others, as long as the dominant intent is undoing. Do not choose revert for a fresh fix that happens to remove code added earlier, for a rewrite that reimplements something differently, or for deletions that stand on their own merits; those have their own types. When a revert is combined with new work, separate the undo from the new work, or lead with revert and describe the new work in the body so the history stays readable.",
  ],
];

// Renders the full TYPE section: the accepted list, then one detailed
// paragraph per type.
function typeSectionText(): string {
  const accepted = TYPE_EXPLANATIONS.map(([type]) => type).join(", ");
  const entries = TYPE_EXPLANATIONS.map(([type, explanation]) => `- ${type}:\n${explanation}`).join("\n\n");
  return `=== TYPE ===

Accepted <type>:
${accepted}

How to Determine the Right Type:

${entries}`;
}

// ===================== PROMPT =====================

// Exported for unit tests.
// Builds the system and user prompts for one style. The accepted scopes come
// from readAcceptedScopes(); when they are null the scope is unrestricted.
export function buildPrompt(
  style: CommitStyle,
  acceptedScopes: readonly string[] | null,
  stat: string,
  diff: string,
  limits: CommitlintLimits = DEFAULT_LIMITS,
  resolvedScopes: readonly ScopeMapEntry[] = [],
  evidence: string = "",
): { systemPrompt: string; userPrompt: string } {
  assertExamplesValid(limits);

  // Read from the same source of truth commitlint enforces at commit time, so
  // the scope list injected into the prompt can never drift. When the project
  // has no commitlint.config.js, the scope is unrestricted.
  // Negative scopes (leading "-") are reserved for small internal
  // changelog-excluded commits; the generated message never uses them, so
  // they are filtered out of the list and only mentioned as a rule below.
  const positiveScopes = acceptedScopes && acceptedScopes.length > 0 ? acceptedScopes.filter((scope) => !scope.startsWith("-")) : null;

  // When the scope map resolved the changed files deterministically, the
  // resolved scopes REPLACE the guess-work guidance: the model is told the
  // exact scope instead of being left to infer it from the file name.
  const resolvedBlock =
    resolvedScopes.length === 1
      ? `
The changed files map to exactly one scope in the project map - use it, do not guess from the file name or the diff text:
  ${resolvedScopes[0].scope} (${resolvedScopes[0].description})`
      : resolvedScopes.length > 1
        ? `
The changed files map to several scopes - pick the most specific one by its description:
${resolvedScopes.map((entry) => `  ${entry.scope} (${entry.description})`).join("\n")}`
        : "";

  const scopeGuidance =
    resolvedBlock !== ""
      ? resolvedBlock
      : `Use the exact name from the accepted list below if it matches the changed file.
NEVER use a parent directory name (e.g. modals, tabs, providers, ai) as the scope.

Examples:
  media/modals/edit-command.js  -> scope: edit-command
  media/tabs/commands.js        -> scope: commands
  lib/ai/providers/gemini.js    -> scope: gemini`;

  const scopeSection =
    positiveScopes && positiveScopes.length > 0
      ? `=== SCOPE ===
${scopeGuidance}

Accepted scopes:
${positiveScopes.join(", ")}

Scopes with a leading '-' are internal-only (excluded from the changelog) - never use them for this message.`
      : `=== SCOPE ===
Optional. This project has no commitlint scope-enum rule.
Accepted scopes: unrestricted.
If you use a scope, keep it short (1-3 words), lowercase, and derived from the changed file or feature.
When nothing fits, omit the scope entirely: <type>: <subject>`;

  // Core rules shared by every style. The header rule states the project's
  // real limit as a fact and lets the GOOD/WRONG examples teach the safe
  // length; the model is never asked to count characters (the exact limit
  // is enforced deterministically by validateCommitMessage() afterwards).
  const coreRules = `You are a git commit message generator. Follow Conventional Commits 1.0.0.

=== FORMAT ===
<type>(<scope>): <subject>

- Header line: the project limit is ${limits.header} characters. Stay clearly under it.
- Match the length of the GOOD example below; never reach the WRONG example.
- When in doubt, prefer a shorter subject.

- GOOD example:
  ${selectExample(HEADER_EXAMPLES, limits.header, "good")}

- WRONG example:
  ${selectExample(HEADER_EXAMPLES, limits.header, "bad")}

${typeSectionText()}

${scopeSection}

=== SUBJECT ===
- Lowercase start
- Imperative mood: add, fix, remove, replace, extract (not: added, fixes)
- Describe the change briefly: specific enough to identify it, short enough to stay under the header limit.
- Lead with the main change when several things are touched.
- No trailing period
- No vague words: update, improve, change, misc, tweak`;

  // Shared wrapping/blank-line rules appended to every style that has a
  // body (titleOnly has none). Each GOOD example demonstrates one rule,
  // and each WRONG example is labeled with the exact violation it shows;
  // models copy an example's layout, so wrong layouts must be clearly
  // marked wrong.
  const lineWrapRule = `
  
=== LINE WRAP RULE ===
Every line in the body must not exceed ${limits.body} characters.
If a sentence or bullet would exceed that limit, break it at a word boundary
and continue on the next line with a 2-space indent.
Separate every bullet point from the next with one blank line.

GOOD example (short bullet fits on one line):
${selectExample(BODY_EXAMPLES, limits.body, "good")}

GOOD example (long bullet wrapped at a word boundary):
${wrapBullet(WRAP_SENTENCE_WORDS, limits.body - 2)}

WRONG example (line exceeds the limit):
${selectExample(BODY_EXAMPLES, limits.body, "bad")}

WRONG example (no blank line between the two bullets):
${noBlankLineExample(limits.body)}

WRONG example (continuation missing the 2-space indent):
${missingIndentExample(limits.body)}

WRONG example (break inside a word):
${midWordBreakExample(limits.body)}`;

  // Style-specific body rules. Every style that has a body appends the
  // shared lineWrapRule above; titleOnly is the only style without one.
  const bodyRules: Record<CommitStyle, string> = {
    lengthy: `

=== BODY ===
REQUIRED. Separate from header with one blank line.
Explains WHY, not WHAT.
Use bullet points (-) when there is more than one distinct point.
Use a single prose paragraph when there is only one point.
Write a thorough explanation - cover all aspects of the change.
One bullet per logical change, not per file - group related files (documentation,
test updates) into single bullets.
Multiple paragraphs or bullets are allowed.${lineWrapRule}`,

    medium: `

=== BODY ===
REQUIRED. Separate from header with one blank line.
Explains WHY, not WHAT.
Use bullet points (-) when there is more than one distinct point.
Use a single prose paragraph when there is only one point.
Write 2 to 4 bullet points, one per logical change - not one per file.
Group documentation updates into one bullet and test updates into one bullet.
Be informative but not exhaustive.${lineWrapRule}`,

    short: `

=== BODY ===
REQUIRED. Separate from header with one blank line.
Explains WHY, not WHAT.
Write exactly one sentence. Maximum 10 words total. No more.
Use prose only - no bullet points.${lineWrapRule}`,

    titleOnly: `

=== BODY ===
OMIT ENTIRELY. Output the header line only. Nothing after the header.`,
  };

  // OUTPUT comes LAST on purpose: models treat the closing section as the
  // strongest instruction, and placing it before the body rules made some
  // of them ignore the body rules entirely.
  const outputSection = `

=== OUTPUT ===
Output ONLY the raw commit message text.
No markdown fences, no explanations, no alternatives, no prefixes.`;

  const systemPrompt = coreRules + bodyRules[style] + outputSection;

  const userPrompt = `Generate a commit message for the following changes. Each data section is
wrapped in tags; its content ends at the matching closing tag. In the
'commitmg_old_file' tag, the changed_lines attribute lists the 1-based line
numbers this change touched - inspect those lines inside the old content
first.

<commitmg_summary>
${stat}
</commitmg_summary>

<commitmg_diff>
${truncateDiff(diff)}${evidence}
</commitmg_diff>`;

  return { systemPrompt, userPrompt };
}

// ===================== PROMPT PREVIEW =====================

// Builds the exact system and user prompts that would be sent for the given
// repository, without contacting any provider. Used by the standalone prompt
// preview command (a read-only developer tool); generation itself always
// builds fresh prompts internally. Throws for the same reasons generation
// would fail early: unknown style or no changes to describe.
export function buildPromptForRepo(repoRoot: string, style: CommitStyle): { systemPrompt: string; userPrompt: string } {
  if (!COMMIT_STYLES.includes(style)) {
    throw new Error(`Unknown style: ${String(style)}. Valid values are: ${COMMIT_STYLES.join(", ")}.`);
  }

  const acceptedScopes = readAcceptedScopes(repoRoot);
  const limits = readCommitlintLimits(repoRoot);
  const scopeMap = readScopeMap(repoRoot);
  const { stat, diff, files } = getChanges(repoRoot);

  assertExamplesValid(limits);

  if (!diff || diff.trim() === "") {
    throw new Error("No changes found (neither staged nor unstaged).");
  }

  const resolvedScopes = resolveScopesForFiles(scopeMap ?? [], files);
  const evidence = evidenceForChanges(repoRoot, files);

  return buildPrompt(style, acceptedScopes, stat, diff, limits, resolvedScopes, evidence);
}

// Renders both prompts into one human-readable document for the preview
// tab. Pure text formatting; no VS Code involvement. Markdown headings are
// emitted so the preview reads nicely in an untitled editor tab.
export function formatPromptPreview(style: CommitStyle, systemPrompt: string, userPrompt: string): string {
  return [
    "# Commit MG — Prompt Preview (This section is not sent to the AI model)",
    "",
    `Style: ${style}`,
    `System prompt: ${systemPrompt.length} characters`,
    `User prompt: ${userPrompt.length} characters`,
    "",
    "## System Prompt",
    "",
    systemPrompt,
    "",
    "## User Prompt",
    "",
    userPrompt,
    "",
  ].join("\n");
}

// ===================== VALIDATION =====================

// Exported for unit tests.
// Deterministic post-generation checks. AI models cannot count characters
// reliably, so the enforced limits are verified here in code instead of
// being left to the model's judgement. Returns a list of human-readable
// problems describing every violated rule; an empty list means the message
// passes every check. Four rules are checked:
//   1. Header length <= limits.header.
//   2. Every body line (including 2-space continuation lines) <= limits.body.
//   3. Every bullet point is preceded by a blank line (this also enforces
//      the blank line required between the header and the first bullet).
//   4. medium style produces at most 4 bullets, matching the "2 to 4"
//      instruction in its body rules.
// The problems are phrased for the correction prompt: each entry is fed
// back to the model verbatim so it knows exactly what to fix on the retry.
export function validateCommitMessage(message: string, style: CommitStyle, limits: CommitlintLimits = DEFAULT_LIMITS): string[] {
  const problems: string[] = [];
  // Split the message into its header (first line) and body (the rest).
  const lines = message.split(/\r?\n/);
  const header = lines[0] || "";
  const body = lines.slice(1);

  // Check 1: the header (type + scope + subject) must fit the limit.
  if (header.length > limits.header) {
    problems.push(`header is ${header.length} chars (max ${limits.header})`);
  }

  // Check 2: no body line may exceed the limit. Line numbers are reported
  // as they appear in the file (header is line 1, body starts at line 2).
  body.forEach((line, i) => {
    if (line.length > limits.body) {
      problems.push(`body line ${i + 2} is ${line.length} chars (max ${limits.body})`);
    }
  });

  // Check 3: blank line before every bullet. body[i] sits on overall line
  // i + 2, so its predecessor is lines[i] - except for the very first body
  // line, whose predecessor is the header itself.
  body.forEach((line, i) => {
    if (!line.startsWith("- ")) return;
    const prev = i === 0 ? header : lines[i];
    if (prev.trim() !== "") {
      problems.push(`bullet on line ${i + 2} is not preceded by a blank line`);
    }
  });

  // Check 4: cap the bullet count for medium only. lengthy is intentionally
  // uncapped (it promises a thorough explanation) and short/titleOnly do
  // not use bullets at all, so only medium carries this limit.
  const bulletCount = body.filter((line) => line.startsWith("- ")).length;
  if (style === "medium" && bulletCount > 4) {
    problems.push(`medium style allows at most 4 bullets, found ${bulletCount}`);
  }

  return problems;
}

// ===================== ENTRY POINT =====================

// Optional lifecycle hooks the caller can use to surface progress and
// results through its own UI or tooling. The module itself stays silent.
export interface CommitMessageObserver {
  // Called right after the prompts are built, with the exact text that is
  // about to be sent to the model.
  onPromptsBuilt?: (prompts: { systemPrompt: string; userPrompt: string }) => void;
  // Called right after the first model response is validated, before any
  // correction retry. An empty violations array means the response passes
  // every check.
  onFirstAttempt?: (message: string, violations: readonly string[]) => void;
  // Called after the single correction retry with the corrected message and
  // the violations that remain. An empty array means the corrected message
  // passes every check. Invoked only when a retry happened.
  onCorrection?: (message: string, remainingViolations: readonly string[]) => void;
  // Called with the final message right before it is returned to the caller.
  onCompleted?: (message: string) => void;
}

// Generates the message end to end and returns it as text. The caller
// (extension.ts) inserts the returned text into the Source Control input
// box; nothing here touches VS Code, the console, or any other file than
// the git/commitlint input it reads. The prompts are always built fresh
// from the repository state. aiClient is the caller-built transport (see
// src/ai/aiClientFactory.ts createAiClient()); this function only ever
// calls its complete(systemPrompt, userPrompt) method and never looks at
// which provider, model, or pathway produced it.
export async function generateCommitMessage(repoRoot: string, style: CommitStyle, aiClient: AiClient, observer?: CommitMessageObserver): Promise<string> {
  if (!COMMIT_STYLES.includes(style)) {
    throw new Error(`Unknown style: ${String(style)}. Valid values are: ${COMMIT_STYLES.join(", ")}.`);
  }

  const acceptedScopes = readAcceptedScopes(repoRoot);
  const limits = readCommitlintLimits(repoRoot);
  const scopeMap = readScopeMap(repoRoot);
  const { stat, diff, files } = getChanges(repoRoot);
  const resolvedScopes = resolveScopesForFiles(scopeMap ?? [], files);
  const evidence = evidenceForChanges(repoRoot, files);

  if (!diff || diff.trim() === "") {
    throw new Error(NO_CHANGES_ERROR);
  }

  const { systemPrompt, userPrompt } = buildPrompt(style, acceptedScopes, stat, diff, limits, resolvedScopes, evidence);
  observer?.onPromptsBuilt?.({ systemPrompt, userPrompt });

  // Generate, then verify the result against the enforced rules before the
  // user ever sees it.
  let commitMessage = await aiClient.complete(systemPrompt, userPrompt);
  const problems = [...validateCommitMessage(commitMessage, style, limits), ...validateHeaderMeta(commitMessage, acceptedScopes, resolvedScopes)];
  observer?.onFirstAttempt?.(commitMessage, problems);

  // Retry exactly once when the output violates the rules. The correction
  // prompt embeds the PREVIOUS message verbatim together with the violation
  // list, and instructs the model to fix only the listed issues while
  // keeping everything else identical - a targeted edit instead of a full
  // regeneration, which previously lost whatever the first attempt got right.
  if (problems.length > 0) {
    const correctedSystemPrompt =
      `${systemPrompt}\n\n` +
      `=== CORRECTION REQUIRED ===\n` +
      `Your previous output was:\n\n${commitMessage}\n\n` +
      `It violates these rules:\n` +
      problems.map((problem) => `- ${problem}`).join("\n") +
      `\nFix ONLY the listed issues. Keep everything else byte-for-byte identical.\n` +
      `Output ONLY the corrected commit message.`;

    commitMessage = await aiClient.complete(correctedSystemPrompt, userPrompt);
    // Re-validate so the caller can surface what (if anything) still
    // violates the rules. Deliberately no second retry: one correction pass
    // is enough in practice, and looping could stall the extension. The
    // message is returned for review anyway, so the user can apply the last
    // touches by hand.
    observer?.onCorrection?.(commitMessage, [...validateCommitMessage(commitMessage, style, limits), ...validateHeaderMeta(commitMessage, acceptedScopes, resolvedScopes)]);
  }

  observer?.onCompleted?.(commitMessage);
  return commitMessage;
}
