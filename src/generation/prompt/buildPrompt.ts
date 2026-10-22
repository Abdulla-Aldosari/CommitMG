// Assembles the system prompt (rules) and the user prompt (data).

import { truncateDiff } from "../changes";
import { DEFAULT_GENERATION_OPTIONS } from "../options";
import { DEFAULT_COMMIT_TYPES, DEFAULT_LIMITS, DEFAULT_MESSAGE_FORMAT, type CommitlintLimits, type CommitStyle, type MessageFormat, type ScopeMapEntry } from "../types";
import {
  assertExamplesValid,
  BASIC_HEADER_EXAMPLES,
  BODY_EXAMPLES,
  bulletPairExample,
  HEADER_EXAMPLES,
  midWordBreakExample,
  missingIndentExample,
  selectExample,
  WRAP_SENTENCE_WORDS,
  wrapBullet,
} from "./examples";
import { typeSectionText, type TypeGuide } from "./typeGuide";

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
  diffBudget: number = DEFAULT_GENERATION_OPTIONS.diffBudget,
  typeGuide: TypeGuide = DEFAULT_GENERATION_OPTIONS.typeGuide,
  types: readonly string[] = DEFAULT_COMMIT_TYPES,
  format: MessageFormat = DEFAULT_MESSAGE_FORMAT,
): { systemPrompt: string; userPrompt: string } {
  assertExamplesValid(limits);
  const compact = format.bulletSpacing === "compact";

  // Read from the same source of truth commitlint enforces at commit time, so
  // the scope list injected into the prompt can never drift. When the project
  // has no commitlint.config.js, the scope is unrestricted.
  const listedScopes = acceptedScopes && acceptedScopes.length > 0 ? acceptedScopes : null;

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

  // The scope policy decides the section: no scope at all, a required
  // scope, or an optional one (the default, unchanged from before the
  // policy existed).
  const requiredLine = "Required. Every header must have a scope.\n";
  const scopeSection =
    format.scopePolicy === "none"
      ? `=== SCOPE ===
None. This project does not use scopes: write every header as <type>: <subject>.
The header examples include a scope only to show the length - never add one.`
      : listedScopes
        ? `=== SCOPE ===
${format.scopePolicy === "required" ? requiredLine : ""}${scopeGuidance}

Accepted scopes:
${listedScopes.join(", ")}`
        : format.scopePolicy === "required"
          ? `=== SCOPE ===
${requiredLine}This project has no fixed scope list.
Keep the scope short (1-3 words), lowercase, and derived from the changed file or feature.`
          : `=== SCOPE ===
Optional. This project has no fixed scope list.
Accepted scopes: unrestricted.
If you use a scope, keep it short (1-3 words), lowercase, and derived from the changed file or feature.
When nothing fits, omit the scope entirely: <type>: <subject>`;

  // Basic: a plain summary line with no type and no scope, so the TYPE and
  // SCOPE sections and the Conventional subject rules do not apply. The
  // length teaching is the same, with header examples that match the form.
  const basicRules = `You are a git commit message generator.

=== FORMAT ===
<summary>

- The first line is a plain summary of the change: no type, no scope, no prefix of any kind, no colon before the text.
- Header line: the project limit is ${limits.header} characters. Stay clearly under it.
- Match the length of the GOOD example below; never reach the WRONG example.
- When in doubt, prefer a shorter summary.

- GOOD example:
  ${selectExample(BASIC_HEADER_EXAMPLES, limits.header, "good")}

- WRONG example:
  ${selectExample(BASIC_HEADER_EXAMPLES, limits.header, "bad")}

=== SUMMARY ===
- Capital first letter
- Imperative mood: Add, Fix, Remove, Replace, Extract (not: Added, Fixes)
- Describe the change briefly: specific enough to identify it, short enough to stay under the header limit.
- Lead with the main change when several things are touched.
- No trailing period
- No vague words: update, improve, change, misc, tweak`;

  // Core rules shared by every style. The header rule states the project's
  // real limit as a fact and lets the GOOD/WRONG examples teach the safe
  // length; the model is never asked to count characters (the exact limit
  // is enforced deterministically by validateCommitMessage() afterwards).
  const conventionalRules = `You are a git commit message generator. Follow Conventional Commits 1.0.0.

=== FORMAT ===
<type>(<scope>): <subject>

- Header line: the project limit is ${limits.header} characters. Stay clearly under it.
- Match the length of the GOOD example below; never reach the WRONG example.
- When in doubt, prefer a shorter subject.

- GOOD example:
  ${selectExample(HEADER_EXAMPLES, limits.header, "good")}

- WRONG example:
  ${selectExample(HEADER_EXAMPLES, limits.header, "bad")}

${typeSectionText(typeGuide, types)}

${scopeSection}

=== SUBJECT ===
- Lowercase start
- Imperative mood: add, fix, remove, replace, extract (not: added, fixes)
- Describe the change briefly: specific enough to identify it, short enough to stay under the header limit.
- Lead with the main change when several things are touched.
- No trailing period
- No vague words: update, improve, change, misc, tweak`;

  const coreRules = format.convention === "basic" ? basicRules : conventionalRules;

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
${compact ? "Put bullet points on consecutive lines, with no blank line between them." : "Separate every bullet point from the next with one blank line."}

GOOD example (short bullet fits on one line):
${selectExample(BODY_EXAMPLES, limits.body, "good")}

GOOD example (long bullet wrapped at a word boundary):
${wrapBullet(WRAP_SENTENCE_WORDS, limits.body - 2)}

WRONG example (line exceeds the limit):
${selectExample(BODY_EXAMPLES, limits.body, "bad")}

${
  compact
    ? `WRONG example (blank line between the two bullets):
${bulletPairExample(limits.body, "\n\n")}`
    : `WRONG example (no blank line between the two bullets):
${bulletPairExample(limits.body, "\n")}`
}

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

  // The user's own instructions come after every rule and before OUTPUT.
  // They are wrapped in a tag, so their text can never pose as a section of
  // the rules, and they are told to yield to the rules above: a project
  // limit or the allowed types always win over a personal preference.
  const instructionsSection =
    format.additionalInstructions === ""
      ? ""
      : `

=== USER INSTRUCTIONS ===
Follow these extra instructions from the user when they do not conflict with the rules above. When they conflict, the rules above win.
<commitmg_user_instructions>
${format.additionalInstructions.replaceAll("</commitmg_user_instructions>", "")}
</commitmg_user_instructions>`;

  const systemPrompt = `${coreRules}${bodyRules[style]}${instructionsSection}${outputSection}`;

  const userPrompt = `Generate a commit message for the following changes. Each data section is
wrapped in tags; its content ends at the matching closing tag. In the
'commitmg_old_file' tag, the changed_lines attribute lists the 1-based line
numbers this change touched - inspect those lines inside the old content
first.

<commitmg_summary>
${stat}
</commitmg_summary>

<commitmg_diff>
${truncateDiff(diff, diffBudget)}${evidence}
</commitmg_diff>`;

  return { systemPrompt, userPrompt };
}
