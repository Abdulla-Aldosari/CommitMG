// Resolves the project rules one generation runs with: accepted scopes,
// length limits, and the scope map. The rules always come from exactly one
// active source, so the prompt, the validation, and the settings tab can
// never mix two files: the project's commitlint config when it has one,
// else the built-in defaults (unrestricted scopes, DEFAULT_LIMITS, no scope
// map). The source is reported with the rules, for the settings tab and the
// developer session record.

import { DEFAULT_LIMITS, type CommitlintLimits, type ScopeMapEntry } from "../types";
import { loadCommitlintConfig } from "./commitlintLoader";
import { acceptedScopesFrom, limitsFrom, scopeMapFrom } from "./commitlintRules";

// Where the active rules come from. file is the repository-relative name of
// the file the rules were read from.
export type RulesSource = { kind: "commitlint"; file: string } | { kind: "defaults" };

export interface ProjectRules {
  source: RulesSource;
  acceptedScopes: string[] | null;
  limits: CommitlintLimits;
  scopeMap: ScopeMapEntry[] | null;
}

export async function loadProjectRules(repoRoot: string): Promise<ProjectRules> {
  const config = await loadCommitlintConfig(repoRoot);
  if (!config) {
    return { source: { kind: "defaults" }, acceptedScopes: null, limits: { ...DEFAULT_LIMITS }, scopeMap: null };
  }
  return {
    source: { kind: "commitlint", file: config.file },
    acceptedScopes: acceptedScopesFrom(config.data),
    limits: limitsFrom(config.data),
    scopeMap: scopeMapFrom(config.data, config.text),
  };
}
