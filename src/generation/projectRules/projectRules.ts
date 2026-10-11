// Resolves the project rules one generation runs with: allowed types,
// accepted scopes, length limits, and the scope map. The rules always come
// from exactly one active source, so the prompt, the validation, and the
// settings tab can never mix two files:
//   1. the project's commitlint config, the rules enforced at commit time;
//   2. else .commitmgrc.json, the rules file for projects without
//      commitlint;
//   3. else the built-in defaults (default types, unrestricted scopes,
//      DEFAULT_LIMITS, no scope map).
// While a commitlint config exists, even one in a format that cannot be
// read, the rules file is ignored and the source says so: commitlint keeps
// enforcing its own rules at commit time, and a second set would only
// produce messages it rejects. The source is reported with the rules, for
// the settings tab and the developer session record.

import * as fs from "fs";
import * as path from "path";
import { DEFAULT_COMMIT_TYPES, DEFAULT_LIMITS, type CommitlintLimits, type ScopeMapEntry } from "../types";
import { loadCommitlintConfig } from "./commitlintLoader";
import { acceptedScopesFrom, limitsFrom, scopeMapFrom, typesFrom } from "./commitlintRules";
import { loadRulesFile } from "./rulesFile";
import { RULES_FILE, type RulesFileData } from "./rulesFileSchema";

// Where the active rules come from. file is the repository-relative name of
// the file the rules were read from; missingExtends names the shared
// configs it extends that are not installed, so their rules are absent;
// rulesFileIgnored is true when a .commitmgrc.json exists but commitlint
// takes precedence. "unsupportedCommitlint" is a commitlint config in a
// format this extension cannot read (TypeScript, YAML): the defaults apply,
// and the settings tab says why.
export type RulesSource =
  | { kind: "commitlint"; file: string; missingExtends: string[]; rulesFileIgnored: boolean }
  | { kind: "unsupportedCommitlint"; file: string; rulesFileIgnored: boolean }
  | { kind: "rulesFile"; file: string }
  | { kind: "defaults" };

export interface ProjectRules {
  source: RulesSource;
  // The commit types the header may use.
  types: string[];
  acceptedScopes: string[] | null;
  limits: CommitlintLimits;
  scopeMap: ScopeMapEntry[] | null;
}

export async function loadProjectRules(repoRoot: string): Promise<ProjectRules> {
  const config = await loadCommitlintConfig(repoRoot);
  if (config) {
    const rulesFileIgnored = fs.existsSync(path.join(repoRoot, RULES_FILE));
    if (config.status === "unsupported") {
      return defaultRules({ kind: "unsupportedCommitlint", file: config.file, rulesFileIgnored });
    }
    return {
      source: { kind: "commitlint", file: config.file, missingExtends: config.data.missingExtends, rulesFileIgnored },
      types: typesFrom(config.data, config.file),
      acceptedScopes: acceptedScopesFrom(config.data, config.file),
      limits: limitsFrom(config.data),
      scopeMap: scopeMapFrom(config.data, config.text),
    };
  }

  const rulesFile = loadRulesFile(repoRoot);
  return rulesFile ? rulesFromFile(rulesFile) : defaultRules({ kind: "defaults" });
}

function defaultRules(source: RulesSource): ProjectRules {
  return { source, types: [...DEFAULT_COMMIT_TYPES], acceptedScopes: null, limits: { ...DEFAULT_LIMITS }, scopeMap: null };
}

// A setting the rules file leaves out takes its default. Listing scopes
// restricts the header to them; mapping files to a scope lets the changed
// files decide it.
function rulesFromFile(data: RulesFileData): ProjectRules {
  const mapped = (data.scopes ?? []).filter((scope) => scope.files.length > 0);
  return {
    source: { kind: "rulesFile", file: RULES_FILE },
    types: data.types ?? [...DEFAULT_COMMIT_TYPES],
    acceptedScopes: data.scopes && data.scopes.length > 0 ? data.scopes.map((scope) => scope.name) : null,
    limits: { ...DEFAULT_LIMITS, ...data.limits },
    scopeMap: mapped.length > 0 ? mapped.map((scope) => ({ scope: scope.name, description: scope.description, files: scope.files })) : null,
  };
}
