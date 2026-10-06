// Silent, vscode-free commit message generator. Generates a Conventional Commit
// message from the staged changes using an AI provider API and returns the
// text; the caller (extension.ts) is responsible for inserting it into the
// Source Control input box. buildPromptForRepo() lets the caller show the
// exact prompts alongside sending, and the same prompts can be passed back
// in so the displayed text is what reaches the model. When
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
// Provider, model and API-secret selection are pinned to constants for the
// first working run; moving them into extension settings is a separate,
// future plan.

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export type CommitStyle = "lengthy" | "medium" | "short" | "titleOnly";

export const COMMIT_STYLES: readonly CommitStyle[] = ["lengthy", "medium", "short", "titleOnly"];

// ===================== CONFIGURATION ==========================

// Name of the secret that holds this provider's API key in PowerShell
// SecretManagement. The key is never hardcoded in this file; it is read at
// runtime by readApiKey() below. When you switch PROVIDER, point this to the
// matching secret (e.g. "Groq-API-KEY-...", "OpenAI-API-KEY-...", etc.).
// KEY_NAME = "GEMINI_FREE_API_KEY"
// KEY_NAME = "DEEPSEEK_FREE_API_KEY"
const API_SECRET_KEY_NAME = "DEEPSEEK_FREE_API_KEY";

const MODEL = "deepseek-chat";

// Shared output budget for every provider: generous enough for a thorough
// message (and for thinking models, whose internal reasoning consumes part
// of it) without leaving the door wide open. A thinking model that burns
// the whole budget on reasoning is what caused truncated messages before.
const MAX_OUTPUT_TOKENS = 8192;

// Recommended non-thinking models per provider (switch MODEL together with
// PROVIDER). Prefer the non-thinking option; a thinking model spends part
// of MAX_OUTPUT_TOKENS on internal reasoning before answering:
//   gemini:    gemini-2.5-flash   (thinking model; invokeGemini's
//              thinkingConfig.thinkingBudget controls how much it thinks)
//   groq:      llama-3.3-70b-versatile
//   deepseek:  deepseek-chat      (AVOID deepseek-reasoner)
//   openai:    gpt-4o-mini        (avoid o-series / gpt-5 reasoning models)
//   anthropic: claude-3-5-haiku   (thinking is off unless explicitly enabled)
// Widened on purpose: the switch in invokeProvider() covers every provider,
// so TypeScript must not narrow the constant to its current literal value.
type ProviderName = "gemini" | "groq" | "deepseek" | "openai" | "anthropic";
const PROVIDER: ProviderName = "deepseek"; // gemini | groq | deepseek | openai | anthropic

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

// ===================== API KEY =====================

// Reads the API key from PowerShell SecretManagement instead of storing it in
// this file. It shells out to powershell.exe and captures the plain-text
// output of:
//   Get-Secret -Name <API_SECRET_KEY_NAME> -AsPlainText
//
// Requirements:
// - Microsoft.PowerShell.SecretManagement and SecretStore must be installed.
// - The secret must already exist (created once via Set-Secret).
// - The SecretStore vault must not demand an interactive password prompt;
//   -NoProfile -NonInteractive makes this call non-interactive and the timeout
//   prevents it from hanging. If the vault is locked, the call throws.
function readApiKey(): string {
  try {
    return execSync(`powershell -NoProfile -NonInteractive -Command "Get-Secret -Name ${API_SECRET_KEY_NAME} -AsPlainText"`, { encoding: "utf8", timeout: 10000 }).trim();
  } catch (err) {
    throw new Error(`Failed to retrieve ${PROVIDER} API key: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
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

// ===================== PROVIDERS =====================
// Note: this silent port drops the provider truncation warnings the
// original script logged; validateCommitMessage() still catches over-long
// lines, and the user reviews the final message before committing anyway.

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
  }>;
  promptFeedback?: { blockReason?: string };
}

interface OpenAICompatResponse {
  choices?: Array<{
    message?: { content?: unknown };
    finish_reason?: string;
  }>;
}

interface AnthropicResponse {
  content?: Array<{ type?: unknown; text?: unknown }>;
  stop_reason?: string;
}

async function fetchJson(url: string, options: RequestInit): Promise<unknown> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} from ${url}: ${body}`);
  }
  return response.json();
}

async function invokeGemini(systemPrompt: string, userPrompt: string, apiKey: string, model: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // gemini-2.5-flash is a thinking model whose internal reasoning tokens
      // count against maxOutputTokens. Disabling thinking keeps the whole
      // output budget for the commit message (also faster and cheaper).
      thinkingConfig: { thinkingBudget: 2048 }, // 4096 | 2048 | 1024 | 512
    },
  };

  const data = (await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as GeminiResponse;

  const candidate = data.candidates && data.candidates[0];

  if (!candidate || !candidate.content || !Array.isArray(candidate.content.parts)) {
    const blockReason = data.promptFeedback && data.promptFeedback.blockReason ? ` (blocked: ${data.promptFeedback.blockReason})` : "";
    throw new Error(`Gemini returned no usable content${blockReason}`);
  }

  // Join every non-thought text part: long responses can arrive split across
  // multiple parts, and thinking parts (thought: true) must be skipped.
  return candidate.content.parts
    .filter((part) => typeof part.text === "string" && !part.thought)
    .map((part) => part.text as string)
    .join("")
    .trim();
}

async function invokeGroq(systemPrompt: string, userPrompt: string, apiKey: string, model: string): Promise<string> {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: MAX_OUTPUT_TOKENS,
  };

  const data = (await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })) as OpenAICompatResponse;

  const choice = data.choices && data.choices[0];
  if (!choice || !choice.message || typeof choice.message.content !== "string") {
    const reason = choice && choice.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : "";
    throw new Error(`Groq returned no usable content${reason}`);
  }

  return choice.message.content.trim();
}

async function invokeOpenAICompat(url: string, systemPrompt: string, userPrompt: string, apiKey: string, model: string): Promise<string> {
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: MAX_OUTPUT_TOKENS,
  };

  const data = (await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })) as OpenAICompatResponse;

  const choice = data.choices && data.choices[0];
  if (!choice || !choice.message || typeof choice.message.content !== "string") {
    const reason = choice && choice.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : "";
    throw new Error(`Provider returned no usable content${reason}`);
  }

  return choice.message.content.trim();
}

async function invokeAnthropic(systemPrompt: string, userPrompt: string, apiKey: string, model: string): Promise<string> {
  const url = "https://api.anthropic.com/v1/messages";
  const body = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };

  const data = (await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  })) as AnthropicResponse;

  const blocks = data.content;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    const reason = data.stop_reason ? ` (stop_reason: ${data.stop_reason})` : "";
    throw new Error(`Anthropic returned no usable content${reason}`);
  }

  // Join every text block and skip thinking blocks: the answer can arrive
  // split across multiple blocks, and a thinking block must never be
  // mistaken for the message text.
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("")
    .trim();
}

// Dispatches to the configured provider and returns the trimmed message
// text. Extracted from generateCommitMessage() so the first generation and
// the corrective retry share one code path.
async function invokeProvider(systemPrompt: string, userPrompt: string, apiKey: string): Promise<string> {
  switch (PROVIDER) {
    case "gemini":
      return invokeGemini(systemPrompt, userPrompt, apiKey, MODEL);
    case "groq":
      return invokeGroq(systemPrompt, userPrompt, apiKey, MODEL);
    case "deepseek":
      // deepseek-chat (non-thinking) is recommended; deepseek-reasoner
      // burns part of MAX_OUTPUT_TOKENS on reasoning before answering.
      return invokeOpenAICompat("https://api.deepseek.com/v1/chat/completions", systemPrompt, userPrompt, apiKey, MODEL);
    case "openai":
      return invokeOpenAICompat("https://api.openai.com/v1/chat/completions", systemPrompt, userPrompt, apiKey, MODEL);
    case "anthropic":
      return invokeAnthropic(systemPrompt, userPrompt, apiKey, MODEL);
    default:
      throw new Error(`Unknown provider: ${PROVIDER}`);
  }
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

=== TYPE ===
Choose exactly one: feat | fix | perf | style | refactor | docs | test | chore | build | ci | revert
feat: a new feature for end users
fix: repairs broken behavior, including closing an unclosed comment that re-activates swallowed code
perf: a performance improvement
style: formatting only, with no behavior change (whitespace, punctuation, comment decoration)
refactor: restructuring without changing behavior
docs: documentation files only
test: tests only
chore: maintenance (config, tooling, dependencies)
build: build system changes
ci: CI pipeline changes
revert: reverts a previous commit

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

  const userPrompt = `Generate a commit message for the following changes.

=== CHANGES SUMMARY ===
${stat}

=== CHANGES DIFF ===
${diff}`;

  return { systemPrompt, userPrompt };
}

// ===================== PROMPT PREVIEW =====================

// Builds the exact system and user prompts that would be sent for the given
// repository, without contacting any provider. The caller (extension.ts)
// shows them in an editor tab and passes the same object straight into
// generateCommitMessage() through its prebuiltPrompts parameter, so the
// displayed text is byte-for-byte the text that reaches the model. Throws
// for the same reasons generation would fail early: unknown style or no
// changes to describe.
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

  return buildPrompt(style, acceptedScopes, stat, diff, limits, resolvedScopes);
}

// Renders both prompts into one human-readable document for the preview
// tab. Pure text formatting; no VS Code involvement. Markdown headings are
// emitted so the preview reads nicely in an untitled editor tab.
export function formatPromptPreview(style: CommitStyle, systemPrompt: string, userPrompt: string): string {
  return [
    "# Commit MG — Prompt Preview",
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

// Optional hooks the caller can use to surface the rule-check results
// through its own UI. The module itself stays silent.
export interface CommitMessageObserver {
  // Called right after the first model response is validated, before any
  // correction retry. An empty array means the response passes every check.
  onFirstAttempt?: (violations: readonly string[]) => void;
  // Called after the single correction retry with the violations that
  // remain. An empty array means the corrected message passes every check.
  // Invoked only when a retry happened.
  onCorrection?: (remainingViolations: readonly string[]) => void;
}

// Generates the message end to end and returns it as text. The caller
// (extension.ts) inserts the returned text into the Source Control input
// box; nothing here touches VS Code, the console, or any other file than
// the git/commitlint input it reads. When prebuiltPrompts is provided (the
// caller built them via buildPromptForRepo() to display alongside sending),
// exactly those prompts are sent instead of fresh ones, so the displayed
// text is what reaches the model.
export async function generateCommitMessage(
  repoRoot: string,
  style: CommitStyle,
  observer?: CommitMessageObserver,
  prebuiltPrompts?: { systemPrompt: string; userPrompt: string },
): Promise<string> {
  if (!COMMIT_STYLES.includes(style)) {
    throw new Error(`Unknown style: ${String(style)}. Valid values are: ${COMMIT_STYLES.join(", ")}.`);
  }

  const acceptedScopes = readAcceptedScopes(repoRoot);
  const limits = readCommitlintLimits(repoRoot);
  const scopeMap = readScopeMap(repoRoot);
  const { stat, diff, files } = getChanges(repoRoot);
  const resolvedScopes = resolveScopesForFiles(scopeMap ?? [], files);

  let systemPrompt: string;
  let userPrompt: string;

  if (prebuiltPrompts) {
    // The prompts were already reviewed by the user; send exactly what was
    // previewed rather than rebuilding (the working tree may have changed
    // between preview and approval).
    ({ systemPrompt, userPrompt } = prebuiltPrompts);
  } else {
    if (!diff || diff.trim() === "") {
      throw new Error("No changes found (neither staged nor unstaged).");
    }

    ({ systemPrompt, userPrompt } = buildPrompt(style, acceptedScopes, stat, diff, limits, resolvedScopes));
  }

  const apiKey = readApiKey();

  // Generate, then verify the result against the enforced rules before the
  // user ever sees it.
  let commitMessage = await invokeProvider(systemPrompt, userPrompt, apiKey);
  const problems = [...validateCommitMessage(commitMessage, style, limits), ...validateHeaderMeta(commitMessage, acceptedScopes, resolvedScopes)];
  observer?.onFirstAttempt?.(problems);

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

    commitMessage = await invokeProvider(correctedSystemPrompt, userPrompt, apiKey);
    // Re-validate so the caller can surface what (if anything) still
    // violates the rules. Deliberately no second retry: one correction pass
    // is enough in practice, and looping could stall the extension. The
    // message is returned for review anyway, so the user can apply the last
    // touches by hand.
    observer?.onCorrection?.([...validateCommitMessage(commitMessage, style, limits), ...validateHeaderMeta(commitMessage, acceptedScopes, resolvedScopes)]);
  }

  return commitMessage;
}
