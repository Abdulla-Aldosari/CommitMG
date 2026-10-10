// Prompt preview: builds the exact prompts for a repository without
// contacting any provider.

import { getChanges } from "./changes";
import { evidenceForChanges } from "./evidence";
import { readAcceptedScopes, readCommitlintLimits, readScopeMap } from "./projectRules/commitlintRules";
import { resolveScopesForFiles } from "./projectRules/scopeMap";
import { buildPrompt } from "./prompt/buildPrompt";
import { assertExamplesValid } from "./prompt/examples";
import { COMMIT_STYLES, type CommitStyle } from "./types";

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
    "# Commit MG - Prompt Preview (This section is not sent to the AI model)",
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
