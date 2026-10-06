// Silent, vscode-free commit message generator, ported from the shared
// commit-msg.js script (Shared-Scripts). Generates a Conventional Commit
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

// For (HEADER_MAX_LENGTH / BODY_MAX_LENGTH) The prompt examples are not
// hardcoded: the example generators (see the EXAMPLE GENERATORS section)
// build them from these limits, so they can never conflict with the values
// specified here.
//
// These limits are enforced twice: softly in the prompt (word counts and
// good/bad examples, since models cannot count characters reliably) and
// deterministically after generation by validateCommitMessage(), which
// triggers a corrective retry when the output violates a limit.
const HEADER_MAX_LENGTH = 55;
const BODY_MAX_LENGTH = 55;

// The GOOD/WRONG header examples are sized as a ratio of HEADER_MAX_LENGTH:
// GOOD ~90% (realistic yet guaranteed under the limit), WRONG ~110%
// (slightly over, to teach the boundary).
const GOOD_HEADER_RATIO = 0.9;
const BAD_HEADER_RATIO = 1.1;

// Caps that keep the untracked-files section from bloating the AI prompt.
const UNTRACKED_MAX_FILES = 20;
const UNTRACKED_MAX_BYTES = 10000;

// ===================== EXAMPLE GENERATORS =====================
// The prompt's GOOD/WRONG examples are generated from the length limits
// instead of being hardcoded, so they can never drift out of sync when the
// limits change (a hardcoded example once exceeded the very limit it was
// demonstrating). Each generator is sized to guarantee its own validity,
// and assertExamplesValid() re-checks that guarantee before every
// generation, throwing instead of letting a broken example reach the model.

// Commit-vocabulary words packed into the GOOD/WRONG header subjects. The
// pool reads as a natural phrase when packed, so generated examples stay
// realistic rather than word-salad.
const HEADER_SUBJECT_WORDS: readonly string[] = [
  "classify",
  "raw",
  "command",
  "output",
  "by",
  "stream",
  "and",
  "exit",
  "code",
  "for",
  "release",
  "log",
  "lines",
  "with",
  "no",
  "guessing",
  "every",
  "time",
  "reliably",
  "clean",
];

// Vocabulary for the bullet wrap example. Packed in order it reads as one
// plausible log-classification sentence, so the wrapped example looks like
// a real commit message bullet.
const BULLET_WORDS: readonly string[] = [
  "raw",
  "command",
  "output",
  "lines",
  "are",
  "classified",
  "from",
  "their",
  "stream",
  "and",
  "exit",
  "code",
  "never",
  "guessed",
  "from",
  "free",
  "text",
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

// Packs words from wordPool (starting at an optional offset index, cycling
// when the pool ends) until adding another word would exceed targetLength.
// Returns the packed text and the number of words consumed, so a
// continuation line can pick up exactly where the previous one left off.
function packWords(targetLength: number, wordPool: readonly string[], offset: number): { text: string; count: number } {
  const words: string[] = [];
  let length = 0;
  for (let i = 0; length < targetLength; i++) {
    const word = wordPool[(offset + i) % wordPool.length];
    const addition = length === 0 ? word.length : 1 + word.length;
    if (length + addition > targetLength) break;
    words.push(word);
    length += addition;
  }
  return { text: words.join(" "), count: words.length };
}

// A realistically-typed GOOD header whose generated subject is sized to
// ~90% of HEADER_MAX_LENGTH: natural and full-length, yet always fits.
function exampleGoodHeader(): string {
  const prefix = "feat(edit-command): ";
  const subjectBudget = Math.round(HEADER_MAX_LENGTH * GOOD_HEADER_RATIO) - prefix.length;
  return prefix + packWords(subjectBudget, HEADER_SUBJECT_WORDS, 0).text;
}

// The matching WRONG header, sized to ~110% of HEADER_MAX_LENGTH: slightly
// over, teaching that even a small overflow breaks the rule.
function exampleBadHeader(): string {
  const prefix = "refactor(release): ";
  const subjectBudget = Math.round(HEADER_MAX_LENGTH * BAD_HEADER_RATIO) - prefix.length;
  return prefix + packWords(subjectBudget, HEADER_SUBJECT_WORDS, 0).text;
}

// A short natural bullet that must never exceed BODY_MAX_LENGTH; when the
// limit is set absurdly small it falls back to a generated filler.
function exampleShortBullet(): string {
  const natural = "- Short bullets fit in one line.";
  return natural.length <= BODY_MAX_LENGTH ? natural : "- " + packWords(BODY_MAX_LENGTH - 2, BULLET_WORDS, 0).text;
}

// The wrap example: a short bullet, a blank line, then a bullet whose first
// line is filled almost to BODY_MAX_LENGTH and continues on the next line
// with a 2-space indent - the continuation literally picks up the sentence
// where the first line broke it. Demonstrates word-boundary wrapping and
// the blank-line rule with every line guaranteed within the limit.
function bulletWrapExample(): string {
  const first = packWords(BODY_MAX_LENGTH - 2, BULLET_WORDS, 0);
  const cont = packWords(BODY_MAX_LENGTH - 2, BULLET_WORDS, first.count);
  return `${exampleShortBullet()}\n\n- ${first.text}\n  ${cont.text}`;
}

// Exported for unit tests.
// Self-check for the guarantees above: GOOD under the limit, WRONG over it,
// and every example line within the body limit. A violated example would
// silently teach the model the wrong rule, so this fails loudly.
export function assertExamplesValid(): void {
  const goodHeader = exampleGoodHeader();
  const badHeader = exampleBadHeader();

  if (goodHeader.length > HEADER_MAX_LENGTH) {
    throw new Error(`Generated GOOD header example (${goodHeader.length} chars) exceeds HEADER_MAX_LENGTH (${HEADER_MAX_LENGTH}): "${goodHeader}"`);
  }
  if (badHeader.length <= HEADER_MAX_LENGTH) {
    throw new Error(`Generated WRONG header example (${badHeader.length} chars) does not exceed HEADER_MAX_LENGTH (${HEADER_MAX_LENGTH}): "${badHeader}"`);
  }
  for (const line of bulletWrapExample().split("\n")) {
    if (line.length > BODY_MAX_LENGTH) {
      throw new Error(`Generated bullet example line (${line.length} chars) exceeds BODY_MAX_LENGTH (${BODY_MAX_LENGTH}): "${line}"`);
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

// ===================== GIT CHANGES =====================
// All git commands run with cwd set to the repository root passed in by the
// command handler; the extension host's own working directory is irrelevant.

interface Changes {
  stat: string;
  diff: string;
}

function getStagedChanges(repoRoot: string): Changes {
  const stat = execSync("git diff --cached --stat", { encoding: "utf8", cwd: repoRoot });
  const diff = execSync("git diff --cached", { encoding: "utf8", cwd: repoRoot });
  return { stat, diff };
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
  }

  return { stat, diff };
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
export function buildPrompt(style: CommitStyle, acceptedScopes: readonly string[] | null, stat: string, diff: string): { systemPrompt: string; userPrompt: string } {
  // Read from the same source of truth commitlint enforces at commit time, so
  // the scope list injected into the prompt can never drift. When the project
  // has no commitlint.config.js, the scope is unrestricted.
  const scopeSection =
    acceptedScopes && acceptedScopes.length > 0
      ? `=== SCOPE ===
Use the exact name from the accepted list below if it matches the changed file.
NEVER use a parent directory name (e.g. modals, tabs, providers, ai) as the scope.

Examples:
  media/modals/edit-command.js  -> scope: edit-command
  media/tabs/commands.js        -> scope: commands
  lib/ai/providers/gemini.js    -> scope: gemini

Accepted scopes:
${acceptedScopes.join(", ")}`
      : `=== SCOPE ===
Optional. This project has no commitlint scope-enum rule.
Accepted scopes: unrestricted.
If you use a scope, keep it short (1-3 words), lowercase, and derived from the changed file or feature.
When nothing fits, omit the scope entirely: <type>: <subject>`;

  // Core rules shared by every style. Header guidance uses word counts and
  // GOOD/WRONG examples instead of asking the model to count characters
  // (models cannot do that reliably); the actual character limits are
  // enforced deterministically by validateCommitMessage() afterwards.
  const coreRules = `You are a git commit message generator. Follow Conventional Commits 1.0.0.

=== FORMAT ===
<type>(<scope>): <subject>

- Header line: max ${HEADER_MAX_LENGTH} characters total (type + scope + subject combined).
- Keep the subject between 3 and 8 words - word count is reliable, character counting is not.
- When in doubt, prefer a shorter subject: a header clearly UNDER the limit is always safe.

- GOOD example:
  ${exampleGoodHeader()}

- WRONG example:
  ${exampleBadHeader()}

=== TYPE ===
Choose exactly one: feat | fix | perf | style | refactor | docs | test | chore | build | ci | revert

${scopeSection}

=== SUBJECT ===
- Lowercase start
- Imperative mood: add, fix, remove, replace, extract (not: added, fixes)
- No trailing period
- No vague words: update, improve, change, misc, tweak

=== OUTPUT ===
Output ONLY the raw commit message text.
No markdown fences, no explanations, no alternatives, no prefixes.`;

  // Shared wrapping/blank-line rules appended to every style that has a
  // body (titleOnly has none). The example is auto-generated from
  // BODY_MAX_LENGTH and deliberately shows a blank line between the two
  // bullets: models copy an example's layout, so showing bullets glued
  // together taught the old, wrong format.
  const lineWrapRule = `
=== LINE WRAP RULE ===
Every line in the body must not exceed ${BODY_MAX_LENGTH} characters.
If a sentence or bullet would exceed that limit, break it at a word boundary
and continue on the next line with a 2-space indent.
Separate every bullet point from the next with one blank line.

Example (note the blank line between the two bullets):
${bulletWrapExample()}`;

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

  const systemPrompt = coreRules + bodyRules[style];

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

  assertExamplesValid();

  const acceptedScopes = readAcceptedScopes(repoRoot);
  const { stat, diff } = getChanges(repoRoot);

  if (!diff || diff.trim() === "") {
    throw new Error("No changes found (neither staged nor unstaged).");
  }

  return buildPrompt(style, acceptedScopes, stat, diff);
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
//   1. Header length <= HEADER_MAX_LENGTH.
//   2. Every body line (including 2-space continuation lines) <= BODY_MAX_LENGTH.
//   3. Every bullet point is preceded by a blank line (this also enforces
//      the blank line required between the header and the first bullet).
//   4. medium style produces at most 4 bullets, matching the "2 to 4"
//      instruction in its body rules.
// The problems are phrased for the correction prompt: each entry is fed
// back to the model verbatim so it knows exactly what to fix on the retry.
export function validateCommitMessage(message: string, style: CommitStyle): string[] {
  const problems: string[] = [];
  // Split the message into its header (first line) and body (the rest).
  const lines = message.split(/\r?\n/);
  const header = lines[0] || "";
  const body = lines.slice(1);

  // Check 1: the header (type + scope + subject) must fit the limit.
  if (header.length > HEADER_MAX_LENGTH) {
    problems.push(`header is ${header.length} chars (max ${HEADER_MAX_LENGTH})`);
  }

  // Check 2: no body line may exceed the limit. Line numbers are reported
  // as they appear in the file (header is line 1, body starts at line 2).
  body.forEach((line, i) => {
    if (line.length > BODY_MAX_LENGTH) {
      problems.push(`body line ${i + 2} is ${line.length} chars (max ${BODY_MAX_LENGTH})`);
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

  let systemPrompt: string;
  let userPrompt: string;

  if (prebuiltPrompts) {
    // The prompts were already reviewed by the user; send exactly what was
    // previewed rather than rebuilding (the working tree may have changed
    // between preview and approval).
    ({ systemPrompt, userPrompt } = prebuiltPrompts);
  } else {
    assertExamplesValid();

    const acceptedScopes = readAcceptedScopes(repoRoot);
    const { stat, diff } = getChanges(repoRoot);

    if (!diff || diff.trim() === "") {
      throw new Error("No changes found (neither staged nor unstaged).");
    }

    ({ systemPrompt, userPrompt } = buildPrompt(style, acceptedScopes, stat, diff));
  }

  const apiKey = readApiKey();

  // Generate, then verify the result against the enforced rules before the
  // user ever sees it.
  let commitMessage = await invokeProvider(systemPrompt, userPrompt, apiKey);
  const problems = validateCommitMessage(commitMessage, style);
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
    observer?.onCorrection?.(validateCommitMessage(commitMessage, style));
  }

  return commitMessage;
}
