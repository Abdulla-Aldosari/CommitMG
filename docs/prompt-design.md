# CommitMG Prompt Design - Comprehensive Documentation

This document describes how the commit message generation engine currently
works: how the prompt is built, the concepts and systems embedded in it, the
data shapes it uses, what a project can provide in its commitlint config or
its `.commitmgrc.json` for maximum benefit, the model settings, and an
in-depth explanation of every numeric variable in the code.

---

## 1. Overview

The engine (in `src/generation/`) turns git changes into a Conventional
Commits message through an AI provider, following one central philosophy:

> **Everything that can be computed deterministically is computed in code;
> the model receives ready facts, general rules, and complete evidence, then
> decides on its own.**

The engine is **silent and free of VS Code**: it prints nothing and opens no
files; errors are thrown and the UI shows them.

The project rules come from **exactly one active source**, never a mix:

1. the project's **commitlint config** (any JavaScript or JSON format), the
   same rules commitlint enforces at commit time, so the prompt never
   drifts from what the project actually allows;
2. else **`.commitmgrc.json`** in the repository root, for projects without
   commitlint;
3. else the **built-in defaults**.

Both files are optional; the engine works without either. While a
commitlint config exists, `.commitmgrc.json` is ignored and the Rules tab
says so.

---

## 2. The full generation flow

1. **Style selection**: one of four styles - `lengthy` (thorough body) or
   `medium` (2–4 bullets) or `short` (one sentence, ≤ 10 words) or `titleOnly`
   (header only).
2. **Reading the project rules** - optional: `loadProjectRules()` picks the
   one active source (section 1) once per run. A commitlint config is
   loaded, with its `extends` chain, in an isolated process (section 6.4);
   `.commitmgrc.json` is parsed and strictly validated (section 6.5). Each
   rule degrades gracefully when it is absent:
   - `typesFrom()` → the allowed types from `type-enum` (missing →
     `DEFAULT_COMMIT_TYPES`, the eleven standard types).
   - `scopePolicyFrom()` → required / optional / none from `scope-empty`
     (missing → optional).
   - `acceptedScopesFrom()` → the allowed scopes from the `scope-enum` rule
     (no rule → scopes unrestricted).
   - `limitsFrom()` → the two length limits from `header-max-length` and
     `body-max-line-length` (missing → `DEFAULT_LIMITS`).
   - `scopeMapFrom()` → the scope map (missing → no deterministic matching,
     see section 6).
     The result names its source (`RulesSource`), which the Rules tab and the
     developer session record show.
3. **Reading the user's Speed & Context settings**: the context preset (or
   the Custom values), the diff filters, and the model parameters become
   the run's `GenerationOptions` and `GenerationParams` (section 7). The
   engine reads options only through `normalizeOptions()`, so a malformed
   value falls back to a safe default.
4. **Collecting changes** `getChanges()`: staged files first
   (`git diff --cached`), falling back to unstaged working-tree files when
   nothing is staged, and appending untracked (new) files - so the engine
   always has material to describe. The diff uses the chosen context lines
   (`--unified=N`), optionally ignores whitespace-only edits
   (`--ignore-all-space`), and leaves out files matching the exclude
   patterns. The summary and the file list always name every changed file.
   When the filters would leave no patch at all, they are relaxed step by
   step (whitespace first, then the exclusions), so a real change never
   reaches the model as an empty diff.
5. **Building the prompt** `buildPrompt()`: system (rules) and user (data) -
   details in section 3.
6. **Sending the prompt**: the prompt is sent to the model as-is - no
   confirmation step and no intermediate UI. The progress notification shows
   each stage and can cancel the run; a request that runs past the timeout
   is aborted. A reply cut off at the output limit is rejected (section 5).
   The result is placed directly into the commit input box.
7. **Deterministic post-generation validation**: `validateCommitMessage()`
   (lengths and layout) and `validateHeaderMeta()` (header shape, type, and
   scope), or `validateBasicHeader()` for the Basic convention. Any
   violations are collected into one list. The type emoji, when enabled,
   is then added to the header by code (section 5.1).
8. **A single correction attempt**: if violations exist and automatic
   correction is on (the default), the prompt is re-sent with a correction
   prompt embedding the previous message and the violations verbatim,
   ordered to "fix only these and keep everything else as is". There is no
   second attempt - the message is shown for review regardless. With
   automatic correction off, the first message is inserted and a warning
   lists its violations.
9. **Insertion**: the final text is placed into the commit input box of the
   Source Control UI.

---

## 3. Prompt structure

### 3.1 The system prompt (rules) - sections separated by `=== X ===`

The order is fixed and deliberate, and OUTPUT always comes **last** because
models treat the closing section as the strongest instruction:

| Section                     | Content                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Introduction                | "You are a git commit message generator. Follow Conventional Commits 1.0.0."                                                                                                                                    |
| `=== FORMAT ===`            | `<type>(<scope>): <subject>` + the project's real limit as context + GOOD/WRONG examples from the ladder                                                                                                        |
| `=== TYPE ===`              | `Accepted <type>` list (the project's allowed types) + "How to Determine the Right Type" + one entry per allowed type the guide knows: a full explanation (≥ 600 chars) or a one-line compact one (section 4.3) |
| `=== SCOPE ===`             | Scope-selection guidance - see 3.3                                                                                                                                                                              |
| `=== SUBJECT ===`           | lowercase start, imperative mood, brief and specific with no word counting, no trailing period, no vague words                                                                                                  |
| `=== BODY ===`              | Body rules per style (present for every style except titleOnly)                                                                                                                                                 |
| `=== LINE WRAP RULE ===`    | Line-length limit + 2-space wrap rule + bullet spacing (blank line or consecutive, per `commitmg.format.bulletSpacing`) + labeled GOOD/WRONG examples                                                           |
| `=== USER INSTRUCTIONS ===` | Only when `commitmg.format.additionalInstructions` is set: the user's text inside `<commitmg_user_instructions>`, with a line saying the rules above win on a conflict                                          |
| `=== OUTPUT ===`            | "Output ONLY the raw commit message text. No markdown fences, no explanations."                                                                                                                                 |

With the **Basic** convention (`commitmg.format.convention`), the
introduction drops "Follow Conventional Commits", `=== FORMAT ===` asks for
a plain summary with no type, scope, or prefix and takes its GOOD/WRONG
examples from `BASIC_HEADER_EXAMPLES`, `=== TYPE ===` and `=== SCOPE ===`
are left out, and `=== SUBJECT ===` becomes `=== SUMMARY ===` (capital
first letter, imperative, no trailing period). The body sections are the
same.

The **type emoji** (`commitmg.format.emojiPosition`) is never in the
prompt: the model writes a plain Conventional message and the code adds
the emoji afterwards (section 5.1).

### 3.2 The user prompt (data) - XML tags with closing pairs

Data sections are wrapped in `<commitmg_*>` tags with **explicit closing
tags**, because file contents may contain anything - even patterns that look
like separators - and the closing tag settles the boundary definitively:

```
Generate a commit message for the following changes. Each data section is
wrapped in tags; its content ends at the matching closing tag. In the
<commitmg_old_file> tag, the changed_lines attribute lists the 1-based line
numbers this change touched - inspect those lines inside the old content
first.

<commitmg_summary>
... (git diff --stat) ...
</commitmg_summary>

<commitmg_diff>
... (the diff, capped by the diff budget) ...
... (then the old-file evidence inside the same tag) ...
</commitmg_diff>
```

Precise notes:

- The introduction line explicitly explains the meaning of the `changed_lines`
  attribute (the 1-based line numbers this change touched inside the old
  content - so the model starts there).
- New untracked files have their contents included in a dedicated section
  bounded by the `untrackedMaxFiles` and `untrackedMaxBytes` options. New
  files that match an exclude pattern are named in the summary, but their
  content is not sent (unless nothing else would be sent at all).
- The old-file evidence is left out entirely when the preset (or the Custom
  setting) turns it off; the introduction line still mentions the tag.

### 3.3 The SCOPE section

The scope policy (section 6) decides the section first:

- **None**: the section only says the project uses no scopes and every
  header is `<type>: <subject>`; it adds that the header examples carry a
  scope only to show the length. No scope list is shown.
- **Required**: the section opens with "Required. Every header must have a
  scope." Without a scope list, it asks for a short scope derived from the
  changed file and never offers to omit it.
- **Optional** (the default): without a scope list, the scope is optional
  and unrestricted, and the model may omit it when nothing fits.

With a scope list (required or optional), three cases follow:

1. **Single match**: the changed files map to exactly one scope in the
   project map → the guidance is settled: "The changed files map to exactly
   one scope in the project map - use it, do not guess".
2. **Multiple matches**: the candidates are listed with their descriptions
   for the model to pick the most specific.
3. **No match**: the general guidance (match the file name + examples) + the
   full accepted scope list, minus the scopes the user excluded with
   `commitmg.rules.excludedScopes` (section 7.3).

---

## 4. Built-in teaching systems

### 4.1 The examples ladder

**The idea**: models learn length by imitation, not by counting. The model is
therefore never asked to count characters - it receives two selected examples
from a hand-written ladder of exact-length strings.

- `EXAMPLE_LENGTHS` = `[50, 54, 58, 62, 66, 70, 74, 78, 82, 86, 88, 92, 96,
100, 104]` - fifteen rungs: steps of 4 up to 86, then multiples of 4 from
  88, so the 100-character limits of `@commitlint/config-conventional` are
  taught with 96 (GOOD) and 104 (WRONG).
- `HEADER_EXAMPLES` - fifteen complete commit headers at exactly those
  lengths, in the same order.
- `BODY_EXAMPLES` - fifteen complete body bullets with naturally-ending
  sentences, at the same lengths and order.

**Selection** `selectExample()`: for a limit `L`, the GOOD example = the
largest example ≤ `L − 2`, and the WRONG example = the smallest example ≥
`L + 2`. The result is precise boundary teaching: just under the limit versus
just over it.

**Fully-supported range**: for correct boundary teaching the limit must fall
inside `[52, 102]` - outside it, selection clamps to the nearest rung (the
default limits 55/55 sit safely inside the range). A test checks every
limit in the range for both ladders, and `.commitmgrc.json` only accepts
limits inside it.

### 4.2 Wrap examples (LINE WRAP)

The LINE WRAP RULE section carries examples labeled with the rule they show or
the violation they warn against, all derived from the same ladder material and
one fixed complete sentence that ends with a full stop:

- **GOOD (single line)**: a short bullet under the limit.
- **GOOD (wrapped)**: a long fixed sentence wrapped automatically at word
  boundaries with a 2-space indent.
- **WRONG (line exceeds the limit)**: a bullet over the limit, labeled.
- **WRONG (bullet spacing)**: two bullets in the spacing the user did not
  choose: glued together under "blank", separated by a blank line under
  "compact" (`bulletPairExample()`).
- **WRONG (continuation missing the 2-space indent)**: the wrapped sentence
  without the indent.
- **WRONG (break inside a word)**: the sentence split mid-word.

### 4.3 The TYPE guide

The TYPE section comes in two versions, chosen by the `prompt.typeGuide`
setting (or the preset):

- **Full** (`TYPE_EXPLANATIONS`): for each of the eleven types, a
  **general** explanation paragraph (applicable to any case) of **at least
  600 characters** (`MIN_TYPE_EXPLANATION`) explaining when to choose the
  type and when not to. The paragraphs are deliberately generic - no
  special cases.
- **Compact** (`COMPACT_TYPE_EXPLANATIONS`): the same types in the same
  order, each reduced to one line: its deciding question and its most
  common boundary. It is about a quarter of the full guide and saves
  roughly 1,500 tokens per request, at some cost in type accuracy on
  borderline changes.

Both versions list the project's allowed types (section 6) in the
project's order and explain only those: a type the project forbids is never
taught, and a type of the project's own (such as `i18n`) is listed without
an explanation. When no allowed type has an explanation, the "How to
Determine the Right Type" block is left out.

Tests check that the compact guide covers the same types in the same
order as the full one, gives each a real explanation, and saves at least
1,500 tokens.

### 4.4 Old-file evidence

The diff only shows the new side around each change; the **old version** of
each changed file is the evidence that reveals the structure surrounding the
change (what was there before, what surrounds it). Therefore:

- For each tracked file, its old content is fetched from git
  (`git show HEAD:<file>`).
- It is sent wrapped in a tag:
  `<commitmg_old_file path="..." changed_lines="X-Y"> ... </commitmg_old_file>`
- Binary files are excluded (raw bytes are never sent to a text model).
- New untracked files have no old version - their content already comes from
  the untracked section.
- Distribution over the budget is described in section 8.6 (the evidence
  budget). The whole evidence section can be turned off (section 7).

---

## 5. Deterministic validation (post-generation layers)

| Layer                                                      | What it checks                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assertExamplesValid(limits)`                              | The ladder itself: every example matches its declared length, selection respects (GOOD ≤ limit, WRONG > limit) inside the range, wrap lines ≤ limit, and every TYPE paragraph ≥ 600 chars - any drift fails loudly **before** any send                                                                                                           |
| `validateCommitMessage(msg, style, limits, spacing)`       | Header length, every body line length, bullet spacing (blank: a blank line before every bullet; compact: no blank line between bullets; both: a blank line after the header), and a cap of 4 bullets for medium only                                                                                                                             |
| `validateHeaderMeta(msg, scopes, resolved, types, policy)` | The first line is shaped `type(scope): subject` or `type: subject` (a code fence, an explanation, or leaked reasoning is a violation); type within the project's allowed types; a scope present under required and absent under none; scope within the accepted list, and when the scope map resolved deterministically: the scope must equal it |
| `validateBasicHeader(msg)`                                 | Basic only, in place of `validateHeaderMeta`: the first line is a plain summary (no `type:` or `type(scope):` prefix, no code fence, not empty), starts with a capital letter, and has no trailing period. Types and scopes are not checked                                                                                                      |

Violations are phrased as messages ready to paste into the correction prompt,
so the single retry fixes them.

### 5.1 The type emoji

With `commitmg.format.emojiPosition` set to `beforeType` or
`beforeSubject`, `applyTypeEmoji()` adds the emoji of the header's type to
the finished message: `✨ feat(auth): add login` or `feat(auth): ✨ add
login`. The scope is untouched. Only `beforeSubject` passes
`@commitlint/config-conventional` (measured: the emoji before the type
breaks its header parser).

- **The model never picks the emoji.** It chooses the type; `TYPE_EMOJIS`
  maps each standard type to its gitmoji emoji (feat ✨, fix 🐛, docs 📝,
  style 🎨, refactor ♻️, perf ⚡️, test ✅, build 📦️, ci 👷, chore 🔧,
  revert ⏪️). A project type with no emoji gets none.
- **Length.** commitlint counts UTF-16 code units, and some emojis are 3
  units long (`📦️`). The header limit the model writes to is the real
  limit minus the longest emoji of the allowed types plus its space
  (`emojiReserve()`), so the finished header still fits the real limit.
- **Correction.** The model's own text is checked against that reduced
  limit, and the correction prompt quotes it without the emoji, so the
  model is never asked to fix an emoji it did not write.
- **Basic** headers have no type, so they never get an emoji.

Before any of these checks, the provider client rejects a reply that
stopped at the output limit (Gemini `MAX_TOKENS`, Anthropic `max_tokens`,
Cohere `MAX_TOKENS`, OpenAI-style `length`, Mistral `length` or
`model_length`). Such a reply ends mid-message, often inside the model's
reasoning, so it is never validated or inserted; the error names the
reason and suggests raising Maximum output or lowering Reasoning.

---

## 6. Project integration: what a commitlint config can provide

The config is **optional** - the engine generates messages without it
(section 6.3 lists the fallbacks). It is found the way commitlint finds
it, in the same order: the `commitlint` field of `package.json`,
`.commitlintrc`, `.commitlintrc.json`, `.commitlintrc.js/.cjs/.mjs`, then
`commitlint.config.js/.cjs/.mjs`. TypeScript and YAML configs would need a
library the extension does not ship; they are reported as an unsupported
format and the built-in rules apply.

Rules the project file does not write are read from its `extends` chain,
as commitlint does: short names get the `commitlint-config-` prefix, each
entry resolves from the config that names it, shared configs may extend
others, and later configs win (the project file last). Only packages
installed in the project are loaded; a missing one is named on the Rules
tab instead of failing the run.

To get the most out of the engine, a project can provide five pieces of
information - all read from the same rules commitlint enforces at commit
time, so no drift is possible:

1. **The allowed types** via `type-enum` (`never` removes types from the
   defaults; a disabled rule allows the defaults).
2. **The scope policy** via `scope-empty`: `never` = required, `always` =
   none, missing or disabled = optional.
3. **The scope list** via the `scope-enum` rule (a flat array of names).
4. **The two length limits** via `header-max-length` and
   `body-max-line-length`.
5. **The scope map** via an exported `baseScopes` in the triple structure.

### 6.1 The required triple structure

Every `baseScopes` element is a triple: `[name, description, files]`

| Element       | Meaning                                           | Rules                                                                                                                                                           |
| ------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | The literal scope name allowed in headers         | Unique, usually lowercase                                                                                                                                       |
| `description` | What the scope covers                             | Injected into the prompt and guides the choice when several candidates match                                                                                    |
| `files`       | The paths that deterministically assign the scope | An exact literal path (`src/app.ts`) or a **directory prefix ending in `/`** (`src/tools/`); an empty array = no single home file, the description alone guides |

**Deterministic matching rules** `resolveScopesForFiles()`:

- **An exact path beats a directory prefix**: `src/tools/engine.ts` maps to
  the scope with the exact path even when a scope with the `src/tools/`
  prefix exists.
- Multiple candidates (a file claimed by several scopes) are all presented
  for choice by description.
- No match → the general guidance.

**Excluded scopes**: `commitmg.rules.excludedScopes` is a list of regular
expressions matched against the names of the listed scopes (the accepted
scope list). A listed scope that matches one is left out of the prompt, is
rejected by the validation, and is hidden from the Rules tab table. It is
empty by default, so nothing is excluded. A scope that has files mapped to
it is never excluded, and the scopes resolved from the changed files
(`resolvedScopes`) are never filtered: a changed file that maps to a scope
decides that scope.

### 6.2 Complete example (generic)

```js
// @ts-check
"use strict";

// 1. Defining the Project's Core Scopes
// Each entry is a triple: [name, description, files].
const baseScopes = [
  ["app", "the main application logic", ["src/app.ts", "src/main.ts"]],
  ["tools", "built-in tool commands", ["src/tools/"]],
  ["ui", "general visual/UX change not confined to a single file", []],
  ["deps", "adding, removing, or bumping a dependency", ["package.json", "package-lock.json"]],
];

// 2. Append a negative variant of every base scope prefixed with "-".
// Only the first element (name) of each triple is mapped here.
const allowedScopes = [...baseScopes.map(([name]) => name), ...baseScopes.map(([name]) => `-${name}`)];

/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  // Exported for the commit-message generator so it can map changed files
  // to scopes deterministically; commitlint ignores unknown keys.
  baseScopes,
  rules: {
    "scope-empty": [2, "never"],
    "header-max-length": [2, "always", 72],
    "body-max-line-length": [2, "always", 72],
    "type-enum": [2, "always", ["feat", "fix", "perf", "style", "refactor", "docs", "test", "chore", "build", "ci", "revert"]],
    "scope-enum": [2, "always", allowedScopes],
  },
};
```

### 6.3 Behavior per absence case

When the file or any of its pieces is absent, the engine degrades gracefully:

| Case                                                  | Behavior                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| No commitlint config                                  | `.commitmgrc.json` when it exists (section 6.5), else the built-in rules           |
| A TypeScript or YAML config                           | The built-in rules; the Rules tab names the unsupported file                       |
| A shared config in `extends` not installed            | Its rules are absent; the explicit rules apply and the Rules tab names the package |
| The file exists but no `baseScopes` is exported       | Safe fallback: parsing the old commented format (`"scope", // files: description`) |
| Length rules missing                                  | Per-rule fallback to the default (55)                                              |
| `type-enum` missing                                   | The eleven default types                                                           |
| `scope-empty` missing                                 | Optional scope                                                                     |
| `scope-enum` missing                                  | Unrestricted scopes (common when the config only extends a shared preset)          |
| `type-enum`, `scope-empty`, or `scope-enum` malformed | An explicit error naming the file is shown to the user (no silent generation)      |
| The config throws or runs over 10 s                   | An explicit error naming the config is shown to the user                           |

### 6.4 Workspace trust and isolated loading

`commitlint.config.js` is JavaScript: reading it means executing code from
the repository. Two rules keep that safe:

1. **Trusted workspaces only.** The extension does not declare support for
   untrusted workspaces (`capabilities.untrustedWorkspaces` is absent from
   `package.json`), so VS Code keeps it disabled in Restricted Mode. The
   config is therefore only ever executed in a folder the user trusts, the
   same trust a commit hook relies on when it runs the same file.
2. **Isolated process.** `loadCommitlintConfig()` runs the config in a
   child Node process (the editor's own runtime with
   `ELECTRON_RUN_AS_NODE=1`), never inside the extension host:
   - a 10 second timeout stops a config that hangs;
   - the config path and its format are passed as arguments, never spliced
     into code;
   - only the merged `rules`, `baseScopes`, and the names of missing shared
     configs come back, as JSON, after a marker that anything the config
     prints cannot fake;
   - CommonJS configs load with `require()`, ES module configs (`.mjs`, or
     a `.js` file in a `"type": "module"` package) with `import()`; JSON
     configs are parsed, never run;
   - the `extends` chain resolves inside the same process, from the
     project's own `node_modules`, at most ten levels deep;
   - nothing is left in the extension host's module cache.

### 6.5 `.commitmgrc.json`: rules without commitlint

A project without commitlint sets its rules in `.commitmgrc.json` in the
repository root. commitlint is never required: without either file the
built-in rules apply. The Rules tab creates the file from a template
(Conventional, the built-in rules, or Angular: the ten types of
`@commitlint/config-angular` and a 72-character header) and edits it; it
can also be written by hand and committed to share the rules.

```json
{
  "types": ["feat", "fix", "docs", "i18n"],
  "headerMaxLength": 72,
  "bodyMaxLineLength": 72,
  "scopePolicy": "optional",
  "scopes": [{ "name": "auth", "description": "login and sessions", "files": ["src/auth/"] }, { "name": "docs" }]
}
```

Every key is optional; a missing one takes its default. Listing scopes
restricts the header to them; a scope with `files` maps changed files to
it, like `baseScopes`.

The file comes from the repository, so it is untrusted input. It is parsed
as JSON and never run, and every value is checked before any of it reaches
the prompt or a path comparison (`rulesFileSchema.ts`): unknown keys, bad
type or scope names, duplicates, descriptions over 200 characters or longer
than one line, limits outside 52..102, `none` with listed scopes, and any
path that is absolute, uses `\`, or has a `.` or `..` segment. A file with
any problem is rejected as a whole, with every problem listed. The Rules
tab runs the same checks before it sends an edit, and the host runs them
again before it writes.

All git commands run through `runGit()`, which passes an argument array to
`execFileSync` and never uses a shell, so file names from the repository
reach git byte for byte. File lists are read with `-z`, which keeps
non-ASCII names intact.

---

## 7. Model and provider settings

### 7.1 Provider, model, and key

The provider, the model, and the API key are chosen in the **CommitMG
Settings** panel; nothing about them is hard-coded in the engine. The engine
only receives a ready `AiClient` and calls `complete(systemPrompt,
userPrompt)`. Routing, configuration, and key storage are documented in
`docs/ai-provider-system.md`:

| Setting                              | Where it lives                                    | Explanation                                                                                     |
| ------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Pathway (`commitmg.aiPathway`)       | VS Code user settings                             | `direct` (a provider's HTTP API) or `vscode` (a model from GitHub Copilot Chat via `vscode.lm`) |
| Provider (`commitmg.aiProviderName`) | VS Code user settings                             | One of the eight fixed providers or `custom` (any OpenAI-compatible endpoint)                   |
| Model (`commitmg.aiModelId`)         | VS Code user settings                             | Picked from the provider's live model list; empty means the provider's default model            |
| API key                              | VS Code secret storage (`commitmg.apiKey.<name>`) | **Never written to any settings file**; it stays in the operating system's credential manager   |

Thinking models spend part of the output budget on internal reasoning
before answering (section 7.4), so a fast non-thinking model usually gives
the quickest result for commit messages.

### 7.2 Context size: the preset and the settings it controls

The Speed & Context tab of the settings panel trades prompt size (speed and
cost) against how much of the change the model sees. Every setting below is
`scope: window`: one value, read from the workspace settings when they
define it, else from the user settings. The tab writes an edit to the layer
the value comes from.

`commitmg.context.preset` picks a named set of five values, or `custom`:

| Preset             | Old file content | Evidence budget | Diff budget | Context lines | Type guide |
| ------------------ | ---------------- | --------------- | ----------- | ------------- | ---------- |
| Fast               | off              | (16,000)        | 12,000      | 1             | compact    |
| Balanced (default) | on               | 16,000          | 24,000      | 3             | compact    |
| Thorough           | on               | 48,000          | 40,000      | 3             | full       |

Fast sends no old-file content, so its evidence budget is unused. Thorough
is exactly the behavior from before the presets existed. Measured
on one 40-file change (medium style, o200k tokens): Fast 5,339, Balanced
11,997, Thorough 25,775.

Under a named preset the individual settings are ignored: the preset's
values apply, and settings.json keeps only the preset name. Choosing
`custom`, or editing one of the five values in the tab, copies the current
preset's values into the individual settings, writes the edit, and sets
the preset to `custom` last. The individual settings:

| Setting                             | Range                 | Effect                                                |
| ----------------------------------- | --------------------- | ----------------------------------------------------- |
| `commitmg.context.includeEvidence`  | true / false          | Send the old-file evidence (section 4.4)              |
| `commitmg.context.evidenceBudget`   | 2,000 - 200,000 chars | The evidence budget (section 8.6)                     |
| `commitmg.context.diffBudget`       | 4,000 - 200,000 chars | The diff budget (section 8.5)                         |
| `commitmg.context.diffContextLines` | 0, 1, 2, 3, 5, 10     | Unchanged lines around each change (`git diff -U<n>`) |
| `commitmg.prompt.typeGuide`         | full / compact        | The TYPE guide version (section 4.3)                  |

The tab shows the size of the prompt the current settings build for the
workspace repository's current changes, in tokens and characters (medium
style, counted locally, nothing sent).

### 7.3 Settings outside the preset

| Setting                              | Default                        | Effect                                                                                                                                      |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `commitmg.context.ignoreWhitespace`  | false                          | Leave whitespace-only edits out of the diff (`--ignore-all-space`); a whitespace-only change is still sent                                  |
| `commitmg.context.excludePatterns`   | lockfiles, `*.min.js`, `*.map` | Glob patterns of files whose diff is not sent; they stay in the summary. Up to 50, relative to the repository root, no `..`, no leading `:` |
| `commitmg.rules.excludedScopes`      | empty                          | Up to 20 regular expressions; a listed scope whose name matches one, and that has no files mapped, is left out of the prompt (section 6.1)  |
| `commitmg.context.untrackedMaxFiles` | 20 (1 - 200)                   | New files whose content is sent when nothing is staged (section 8.4)                                                                        |
| `commitmg.context.untrackedMaxBytes` | 10,000 (1,000 - 200,000)       | Total size of that content (section 8.4)                                                                                                    |
| `commitmg.generation.autoCorrect`    | true                           | Send the single correction request when the message breaks a rule                                                                           |
| `commitmg.generation.timeoutSeconds` | 120 (15 - 600)                 | How long each request may take before it is aborted                                                                                         |

### 7.3a Message Format settings (personal preferences)

These live in the VS Code settings, never in the project, and are edited
on the Message Format tab:

| Setting                                  | Default      | Effect                                                                                                                                             |
| ---------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commitmg.format.convention`             | conventional | `basic` writes a plain summary with no type and no scope (section 3.1)                                                                             |
| `commitmg.format.emojiPosition`          | off          | `beforeType` / `beforeSubject` adds the type's emoji (section 5.1)                                                                                 |
| `commitmg.format.bulletSpacing`          | blank        | `compact` puts body bullets on consecutive lines                                                                                                   |
| `commitmg.format.defaultDetail`          | ask          | The style the Source Control button generates with; with one chosen, "Generate Commit Message with Another Style" shows the picker for one message |
| `commitmg.format.additionalInstructions` | empty        | Up to 1,000 characters added to the prompt after the rules; cleaned of control characters and trimmed                                              |

View Examples on that tab shows one sample message per detail level in the
current settings and the project's limits and types, built by code without
a model request (`formatExamples()`).

### 7.4 Model parameters: reasoning, temperature, output cap

Three settings, one value for every model, applied to direct providers only
(the VS Code Language Model pathway has no such options):

| Setting                          | Values                            | Auto means                              |
| -------------------------------- | --------------------------------- | --------------------------------------- |
| `commitmg.model.reasoning`       | auto, off, low, medium, high, max | The provider default (Gemini: medium)   |
| `commitmg.model.temperature`     | 0 - 2, or empty                   | 0.2, except Anthropic and Cohere (none) |
| `commitmg.model.maxOutputTokens` | 256 - 65,536, or empty            | 8192 (Cohere: none)                     |

Each model's profile (measured by the capability probe) decides what is
actually sent; a value the model rejects is dropped, never sent. The tab
offers only the reasoning levels the selected model has, and marks a stored
value the model ignores. The native fields per provider are listed in
`docs/ai-provider-system.md` section 8.

Why these defaults:

- **Temperature 0.2**: the message is a factual task; low randomness keeps
  the wording stable. 0 can make outputs rigid; 0.7+ invites wording that
  breaks the formal rules. Gemini 3 never receives a temperature (Google
  advises against changing it), and neither does any model whose profile
  rejects it, or accepts it only while reasoning is off and is reasoning.
- **Output cap 8192**: covers the message in any style with headroom for
  reasoning (section 8.1).
- **Reasoning on Auto**: each model's own default, except Gemini, which
  gets "medium" (a 4096-token budget on 2.5, `thinkingLevel: "medium"` on 3) so its reasoning leaves room for the message.

**The trade-off of reasoning**: on thinking models, reasoning counts
**against the output cap itself**. A higher level can choose types and
scopes better, but it takes longer, and with a small cap it can use up the
whole budget before the message is written. That reply is cut off and
rejected (section 5). Raise Maximum output when you raise Reasoning.

---

## 8. Numeric variables - the in-depth explanation

For every variable: what it means, the effect of lowering it, the effect of
raising it, the cautions, and the recommendation with its reasoning.
Variables that became user settings (section 7) keep their entry here, with
the setting name and the default each preset gives it.

### 8.1 `DEFAULT_MAX_OUTPUT_TOKENS` = 8192 (setting `commitmg.model.maxOutputTokens`)

**What it is**: the output-token cap a request carries when Maximum output
is on Auto (every provider except Cohere) - it covers the message text
itself and (for thinking providers) the internal reasoning that consumes
from the same budget. Anthropic requires a cap on every request, so it
always gets one.

**Lowering**: below ~2000 with a thinking model → risk of a truncated
message (the thinking eats the budget before answering). With a non-thinking
model, 1024 is enough for short/titleOnly styles but tight for lengthy.

**Raising**: more headroom, but it does not actually raise message quality
(the longest realistic message is under 1000 tokens) - only higher cost and a
chance of rambling if the model runs loose.

**Cautions**: with thinking models the real budget available for the message
is the cap minus the thinking. A high Reasoning level with Gemini Flash
spent the whole 8192 on reasoning in a test run: the reply was cut off
mid-thought. Such a reply is now rejected with a clear error instead of
being inserted (section 5).

**Recommendation**: keep 8192 - comfortable for every style and the
correction attempt, prevents rambling, and with a thinking model leaves
~6K tokens for the message after deducting the thinking.

### 8.2 `DEFAULT_LIMITS` = { header: 55, body: 55 }

**What it is**: the fallback limits for header length and body line length -
used only when the project does not define the two length rules in
commitlint. Any project that defines them overrides these values entirely
(the engine reads `header-max-length` and `body-max-line-length`).

**Relation to the examples ladder**: for full boundary teaching the limit
must fall inside `[52, 102]` - and 55/55 sits inside the safe range.

**Lowering**: below 52 → no ladder example qualifies as "good" (the smallest
example is 50) → selection clamps to the nearest rung and may actually
exceed the limit. A 50-character header is practically unusable anyway.

**Raising**: above 102 → no ladder example exceeds the limit → boundary
teaching loses its upper edge.

**Recommendation**: keep 55/55 - inside the range, and common commit
conventions start at 50.

### 8.3 `EXAMPLE_LENGTHS` = [50, 54, ..., 86, 88, 92, 96, 100, 104]

**What it is**: the ladder of example lengths - fifteen rungs: steps of 4
from 50 to 86, then multiples of 4 from 88 to 104, so the 100-character
limits of `@commitlint/config-conventional` get 96 and 104. The
header examples (`HEADER_EXAMPLES`) and body examples (`BODY_EXAMPLES`) are
hand-written at exactly these lengths, and selection picks the good one at
`L−2` and the wrong one at `L+2`.

**Lowering** (starting at 40, say): serves smaller limits, but very short
header examples become feeble with no teaching value, and any change requires
**writing twenty new examples at exact lengths** - a large maintenance cost.

**Raising** (past 104): serves larger limits, but long examples teach
verbosity against the spirit of "brief headers", and enlarge the prompt.
Only the two selected examples ever reach the prompt, so the extra rungs up
to 104 cost nothing for projects with smaller limits.

**Cautions**: editing the array without editing the matching examples blows
up `assertExamplesValid` immediately - the guard is designed for exactly
that.

**Recommendation**: keep it as is - the 50-104 range covers all practical
commit conventions, including the common 100-character default.

### 8.4 `untrackedMaxFiles` = 20 and `untrackedMaxBytes` = 10000 (settings `commitmg.context.untrackedMaxFiles` / `untrackedMaxBytes`)

**What they are**: two caps for the untracked (new) files section of the
prompt: a maximum number of files whose contents are included (20), and a
maximum total byte count for them (10KB) - **whichever is reached first
stops the inclusion** and adds a "… more untracked files omitted" line.

**Lowering**: stronger quota protection in mass-add scenarios, but the model
loses the context of important new files above the cap.

**Raising**: fuller context for large new files (one huge new file alone can
exceed the byte cap), at the cost of a larger prompt.

**Cautions**: binary files are excluded at another level (the null-byte
check) - unrelated to these two caps. And the two caps work together, not
as an either/or choice.

**Recommendation**: keep 20 / 10000 - new files are usually small and
numerous, and the caps prevent an explosion in mass-add scenarios.

### 8.5 Diff budget (setting `commitmg.context.diffBudget`): Fast 12000, Balanced 24000, Thorough 40000

**What it is**: the character cap for the diff sent inside `<commitmg_diff>`.
The budget is **shared fairly across the files** (`truncateDiff()` /
`shareBudget()`): each file section (and the untracked-files block) that
fits its fair share stays whole, and what the small sections leave unused
goes to the larger ones. A section over its share is cut at a line
boundary with a "... diff truncated (N characters omitted)" line, so one
huge file can never push every other file out of the prompt.

**Lowering**: stronger quota protection for wide changes; every file keeps
its beginning, but large files lose their tails.

**Raising**: fuller details for one wide change, at a cost - and in mass
formats (hundreds of files) truncation remains a fact no matter how high you
raise the number.

**Cautions**: the stat in `<commitmg_summary>` always stays complete - in a
mass change, the full file list still reaches the model even when the diff is
cut, and that is enough to judge the nature of a wide change. Fewer context
lines (section 7.2) and the exclude patterns (section 7.3) shrink the diff
before the budget is applied.

**Recommendation**: the Balanced 24000 - together with its evidence budget
it keeps a large change near 12K tokens.

### 8.6 Evidence budget (setting `commitmg.context.evidenceBudget`): Balanced 16000, Thorough 48000

**What it is**: the total budget for the old-file evidence - distributed
over the files **ascending by size** (smallest first), so the largest number
of files gets its full context before the budget runs out.

**Lowering** (toward the 2000 minimum): real quota savings - fewer files get
their evidence, and larger files fall to partial windows or no evidence.
Suitable for tight quotas.

**Raising** (up to the 200000 maximum): a wider view - more complete old
files, better decision quality for the model, at a higher input cost.

**Cautions**: together with the diff budget it must not exceed the
provider's input window (the Thorough worst case is ~94K chars ≈ 25K
tokens). It is the primary "quality versus quota" knob; Fast turns the
evidence off entirely.

**Recommendation**: the Balanced 16000 for everyday changes; Thorough's
48000 when a change needs the full surrounding files.

### 8.7 `MIN_PARTIAL` = 1500

**What it is**: the minimum remaining budget worth sending a "window" of a
file - below it, no extra evidence is sent for that file (the diff alone
remains).

**Lowering**: allows smaller windows - but a 300-character window around a
change carries no useful context and spends tokens with no return.

**Raising**: saves quota - feeble windows are not sent, and evidence is kept
for the files that really deserve it (full or a decent window).

**Recommendation**: keep 1500 - the balance point between "no crumbs" and
"no wasted context".

### 8.8 `MAX_WINDOW` = 6000

**What it is**: the maximum size of the partial window for one file whose
size does not allow sending it in full - a window that grows symmetrically
around the changed lines (computed from the diff, 1-based).

**Lowering**: a narrower window - less local context, suitable for huge
files where the change's surroundings suffice.

**Raising**: a wider window - approaching the full file for medium files
(i.e., shifting more of the budget to one file at the expense of others).

**Cautions**: the window grows around the center of the change - if the
changes are scattered across a giant file, the window covers the middle only
and misses the edges.

**Recommendation**: keep 6000 - generous local context without monopolizing
the budget.

### 8.9 `MIN_TYPE_EXPLANATION` = 600

**What it is**: the minimum length of each type's explanation paragraph in
the TYPE guide (`TYPE_EXPLANATIONS`) - enforced by `assertExamplesValid`.

**Lowering**: feebler paragraphs - descriptions return to one-liners without
decision guidance, which is what previously weakened type-selection accuracy.

**Raising**: deeper paragraphs - better teaching, but it enlarges the system
prompt (every +100 chars × 11 types = +1100 chars ≈ +300 tokens in every
call that uses the full guide). The compact guide (section 4.3) is not
bound by this minimum.

**Recommendation**: keep 600 - the minimum that guarantees real decision
guidance without bloat.

---

## 9. The governing principles

1. **One active source of truth**: every rule (types, scope policy,
   scopes, limits, map) is read from one source - the commitlint config
   that commitlint enforces, else `.commitmgrc.json`, else safe defaults -
   never a mix of two. Personal preferences (bullet spacing, prompt size)
   stay in the VS Code settings.
2. **Deterministic for code, decision for the model**: everything computable
   (file-to-scope matching, lengths, example integrity) is computed by the
   code and handed over as facts; the model decides the wording and the
   meaning within general rules and complete evidence.
3. **Explicit data bounds**: every text input is capped by a known number -
   the prompt can never break the input window nor drain the quota without
   a governor. The user picks the bounds (section 7), always inside fixed
   ranges, and a malformed value falls back to a safe default.
4. **Presets first, knobs second**: a named preset sets every size knob at
   once, measured on real changes; the individual knobs are for users who
   choose Custom. The settings tab shows the prompt size the current
   settings produce, so the trade-off is visible.
5. **Never send what a model rejects, never insert what a model did not
   finish**: model parameters pass through a measured profile, and a reply
   cut off at the output limit or without a conventional header never
   passes as a valid message.
6. **Immediate guards**: any drift in the teaching material (example
   lengths, paragraph lengths) fails loudly before any send.
7. **One-press delivery**: pressing the generate button produces the
   message and places it in the commit input box directly, with no
   intermediate steps for the user. The run can be cancelled at any stage.
