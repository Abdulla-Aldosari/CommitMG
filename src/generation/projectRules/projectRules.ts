// Resolves the project rules one generation runs with: accepted scopes,
// length limits, and the scope map. The commitlint config is loaded once per
// run; without it the built-in defaults apply (unrestricted scopes,
// DEFAULT_LIMITS, no scope map).

import { DEFAULT_LIMITS, type CommitlintLimits, type ScopeMapEntry } from "../types";
import { loadCommitlintConfig } from "./commitlintLoader";
import { acceptedScopesFrom, limitsFrom, scopeMapFrom } from "./commitlintRules";

export interface ProjectRules {
  acceptedScopes: string[] | null;
  limits: CommitlintLimits;
  scopeMap: ScopeMapEntry[] | null;
}

export async function loadProjectRules(repoRoot: string): Promise<ProjectRules> {
  const config = await loadCommitlintConfig(repoRoot);
  if (!config) {
    return { acceptedScopes: null, limits: { ...DEFAULT_LIMITS }, scopeMap: null };
  }
  return {
    acceptedScopes: acceptedScopesFrom(config.data),
    limits: limitsFrom(config.data),
    scopeMap: scopeMapFrom(config.data, config.text),
  };
}
