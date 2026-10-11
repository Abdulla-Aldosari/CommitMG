// Shared types and constants of the generation engine.

export type CommitStyle = "lengthy" | "medium" | "short" | "titleOnly";

export const COMMIT_STYLES: readonly CommitStyle[] = ["lengthy", "medium", "short", "titleOnly"];

// Thrown when generation is requested with an empty working tree (nothing
// staged, unstaged, or untracked). Exported so callers (e.g. the settings
// panel's Estimate Cost flow) can detect it and add context-specific
// guidance without string matching.
export const NO_CHANGES_ERROR = "No changes found (neither staged nor unstaged).";

// The authoritative length limits come from the project's commitlint
// config (readCommitlintLimits() in projectRules/commitlintRules.ts), so the
// prompt and the deterministic validation can never drift from the rule
// commitlint enforces at commit time. DEFAULT_LIMITS applies only when the
// project has no commitlint.config.js, or its config does not define the
// rules.
export interface CommitlintLimits {
  header: number;
  body: number;
}

export const DEFAULT_LIMITS: CommitlintLimits = { header: 55, body: 55 };

// The commit types allowed when the project rules do not list their own
// (no type-enum rule). The type guide explains each one.
export const DEFAULT_COMMIT_TYPES: readonly string[] = ["feat", "fix", "perf", "style", "refactor", "docs", "test", "chore", "build", "ci", "revert"];

// One entry of the project's scope map: a scope name, what it covers, and
// the repo-relative files or directory prefixes (trailing "/") that map to
// it deterministically.
export interface ScopeMapEntry {
  scope: string;
  description: string;
  files: readonly string[];
}
