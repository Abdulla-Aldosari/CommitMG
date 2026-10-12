// Shared types and constants of the generation engine.

import { DEFAULT_EMOJI_POSITION, type EmojiPosition } from "./format/typeEmoji";

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

// Whether a header carries a scope: always ("required"), when one fits
// ("optional"), or never ("none"). A project rule (commitlint scope-empty,
// or scopePolicy in .commitmgrc.json).
export const SCOPE_POLICIES = ["required", "optional", "none"] as const;
export type ScopePolicy = (typeof SCOPE_POLICIES)[number];
export const DEFAULT_SCOPE_POLICY: ScopePolicy = "optional";

// How body bullets are separated: by one blank line ("blank") or not at
// all ("compact"). A personal preference, kept in the VS Code settings.
export const BULLET_SPACINGS = ["blank", "compact"] as const;
export type BulletSpacing = (typeof BULLET_SPACINGS)[number];
export const DEFAULT_BULLET_SPACING: BulletSpacing = "blank";

// The header convention: "conventional" is type(scope): subject; "basic"
// is a plain summary line with no type and no scope ("Add login page"),
// for projects that do not follow Conventional Commits. A user preference.
export const CONVENTIONS = ["conventional", "basic"] as const;
export type Convention = (typeof CONVENTIONS)[number];
export const DEFAULT_CONVENTION: Convention = "conventional";

// The most characters of extra instructions a user can add to the prompt.
export const MAX_ADDITIONAL_INSTRUCTIONS_LENGTH = 1000;

// The message layout one run asks for and checks: whether the header has a
// scope (a project rule), how bullets are spaced, and the user's own extra
// instructions (user preferences).
export interface MessageFormat {
  // Basic ignores the type and scope rules: its header has neither.
  convention: Convention;
  scopePolicy: ScopePolicy;
  bulletSpacing: BulletSpacing;
  // Free text from the user, already normalized; "" adds nothing.
  additionalInstructions: string;
  // Where the type emoji is added to the finished header, or "off".
  emojiPosition: EmojiPosition;
}

export const DEFAULT_MESSAGE_FORMAT: Readonly<MessageFormat> = {
  convention: DEFAULT_CONVENTION,
  scopePolicy: DEFAULT_SCOPE_POLICY,
  bulletSpacing: DEFAULT_BULLET_SPACING,
  additionalInstructions: "",
  emojiPosition: DEFAULT_EMOJI_POSITION,
};

// One entry of the project's scope map: a scope name, what it covers, and
// the repo-relative files or directory prefixes (trailing "/") that map to
// it deterministically.
export interface ScopeMapEntry {
  scope: string;
  description: string;
  files: readonly string[];
}
