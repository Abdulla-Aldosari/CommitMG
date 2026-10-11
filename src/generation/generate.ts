// Generation entry point: builds the prompts, calls the AI client, and
// validates the result with a single correction retry.

import type { AiClient } from "../ai/aiClient";
import { getChanges } from "./changes";
import { evidenceForChanges } from "./evidence";
import { loadProjectRules } from "./projectRules/projectRules";
import { resolveScopesForFiles } from "./projectRules/scopeMap";
import { buildPrompt } from "./prompt/buildPrompt";
import { COMMIT_STYLES, NO_CHANGES_ERROR, type CommitStyle } from "./types";
import { validateCommitMessage, validateHeaderMeta } from "./validation";

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

  const { acceptedScopes, limits, scopeMap } = await loadProjectRules(repoRoot);
  const { stat, diff, files } = getChanges(repoRoot);

  // Check for an empty change set before the evidence step, which runs
  // several git commands per changed file.
  if (!diff || diff.trim() === "") {
    throw new Error(NO_CHANGES_ERROR);
  }

  const resolvedScopes = resolveScopesForFiles(scopeMap ?? [], files);
  const evidence = evidenceForChanges(repoRoot, files);

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
    const violationList = problems.map((problem) => `- ${problem}`).join("\n");
    const correctedSystemPrompt = `${systemPrompt}

=== CORRECTION REQUIRED ===
Your previous output was:

${commitMessage}

It violates these rules:
${violationList}
Fix ONLY the listed issues. Keep everything else byte-for-byte identical.
Output ONLY the corrected commit message.`;

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
