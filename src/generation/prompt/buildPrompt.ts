// Assembles the system prompt (rules) and the user prompt (data).

import { truncateDiff } from "../changes";
import { DEFAULT_LIMITS, type CommitlintLimits, type CommitStyle, type ScopeMapEntry } from "../types";
import {
  assertExamplesValid,
  BODY_EXAMPLES,
  HEADER_EXAMPLES,
  midWordBreakExample,
  missingIndentExample,
  noBlankLineExample,
  selectExample,
  WRAP_SENTENCE_WORDS,
  wrapBullet,
} from "./examples";
import { typeSectionText } from "./typeGuide";

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

  const systemPrompt = `${coreRules}${bodyRules[style]}${outputSection}`;

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
