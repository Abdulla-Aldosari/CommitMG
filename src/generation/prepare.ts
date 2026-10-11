// Everything a generation needs before the first model request: the project
// rules, the changes, the resolved scopes, the evidence, and the prompts.
// Shared by generation and the prompt preview, so the preview always shows
// exactly what generation would send.

import { getChanges } from "./changes";
import { emojiReserve } from "./format/typeEmoji";
import { evidenceForChanges } from "./evidence";
import { normalizeOptions, type GenerationOptions } from "./options";
import { loadProjectRules, type RulesSource } from "./projectRules/projectRules";
import { resolveScopesForFiles } from "./projectRules/scopeMap";
import { buildPrompt } from "./prompt/buildPrompt";
import { COMMIT_STYLES, NO_CHANGES_ERROR, type CommitlintLimits, type CommitStyle, type MessageFormat, type ScopeMapEntry } from "./types";

export interface PreparedGeneration {
  systemPrompt: string;
  userPrompt: string;
  rulesSource: RulesSource;
  types: readonly string[];
  format: MessageFormat;
  acceptedScopes: readonly string[] | null;
  // The project's real limits, which the finished message is checked
  // against.
  limits: CommitlintLimits;
  // The limits the model writes to: the header limit shrinks by the space
  // the type emoji takes once it is added, so the finished header still
  // fits the real limit.
  modelLimits: CommitlintLimits;
  resolvedScopes: readonly ScopeMapEntry[];
}

export function assertKnownStyle(style: CommitStyle): void {
  if (!COMMIT_STYLES.includes(style)) {
    throw new Error(`Unknown style: ${String(style)}. Valid values are: ${COMMIT_STYLES.join(", ")}.`);
  }
}

// Throws for an unknown style or when there are no changes to describe.
// `beforeChanges` runs between loading the rules and reading git, so a
// caller can stop a cancelled run before the git work starts.
export async function prepareGeneration(
  repoRoot: string,
  style: CommitStyle,
  options: Partial<GenerationOptions> = {},
  beforeChanges: () => void = () => {},
): Promise<PreparedGeneration> {
  assertKnownStyle(style);
  const settings = normalizeOptions(options);

  const { source: rulesSource, types, scopePolicy, acceptedScopes, limits, scopeMap } = await loadProjectRules(repoRoot);
  // A Basic header has no type, so it has no type emoji either.
  const format: MessageFormat = {
    convention: settings.convention,
    scopePolicy,
    bulletSpacing: settings.bulletSpacing,
    additionalInstructions: settings.additionalInstructions,
    emojiPosition: settings.convention === "basic" ? "off" : settings.emojiPosition,
  };
  const modelLimits: CommitlintLimits = { header: limits.header - emojiReserve(types, format.emojiPosition), body: limits.body };
  beforeChanges();
  const { stat, diff, files } = getChanges(repoRoot, settings);

  // Check for an empty change set before the evidence step, which runs
  // several git commands per changed file.
  if (!diff || diff.trim() === "") {
    throw new Error(NO_CHANGES_ERROR);
  }

  const resolvedScopes = resolveScopesForFiles(scopeMap ?? [], files);
  const evidence = settings.includeEvidence ? evidenceForChanges(repoRoot, files, settings.evidenceBudget) : "";
  const { systemPrompt, userPrompt } = buildPrompt(
    style,
    acceptedScopes,
    stat,
    diff,
    modelLimits,
    resolvedScopes,
    evidence,
    settings.diffBudget,
    settings.typeGuide,
    types,
    format,
  );

  return { systemPrompt, userPrompt, rulesSource, types, format, acceptedScopes, limits, modelLimits, resolvedScopes };
}
