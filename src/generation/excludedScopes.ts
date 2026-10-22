// Scopes the user keeps out of the prompt. A scope is excluded when its name
// matches one of the user's regular expressions (commitmg.rules.excludedScopes).
// Only the listed scopes are filtered: a scope that has files mapped to it
// is never excluded, because a changed file that resolves to it decides the
// scope. Pure and vscode-free, so the settings webview bundles it to run the
// same checks the host runs.

import type { ScopeMapEntry } from "./types";

// The most regular expressions the excluded scopes list may hold. This
// counts patterns, not scopes: one pattern can match any number of scopes.
// The number is a generous practical limit (a pattern or two is the usual
// case), not a technical requirement. It also keeps the work per generation
// small, since every listed scope is tested against every pattern. The same
// number is declared as "maxItems" for commitmg.rules.excludedScopes in
// package.json and written in docs/settings.md; change them together.
export const MAX_EXCLUDED_SCOPES = 20;

// The longest a single pattern may be, in characters. A scope name is short
// (at most 40 characters), so a longer pattern is never needed; the limit
// also bounds how complex a pattern from a hand-edited settings file can be.
export const MAX_EXCLUDED_SCOPE_PATTERN_LENGTH = 100;

// A repeated group that holds another repeat or an alternative, such as
// "(a+)+" or "(a|b)*", can take exponential time to fail on a long name, so
// it is refused. A plain "(a|b)" and "(a)?" are fine.
const NESTED_REPETITION = /\([^)]*[+*{|][^)]*\)[+*{]/;

// Why a pattern cannot be used, or null when it can.
export function excludedScopePatternProblem(pattern: string): string | null {
  if (pattern.trim() === "") {
    return "Enter a pattern.";
  }
  if (pattern.length > MAX_EXCLUDED_SCOPE_PATTERN_LENGTH) {
    return `Keep a pattern under ${MAX_EXCLUDED_SCOPE_PATTERN_LENGTH} characters.`;
  }
  if ([...pattern].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
    return "A pattern cannot contain control characters.";
  }
  if (NESTED_REPETITION.test(pattern)) {
    return "A repeated group cannot contain another repeat or an alternative.";
  }
  try {
    new RegExp(pattern);
  } catch {
    return "This is not a valid regular expression.";
  }
  return null;
}

// Keeps the usable, distinct patterns, trimmed, up to the limit.
export function normalizeExcludedScopes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const patterns = value.filter((item): item is string => typeof item === "string").map((item) => item.trim());
  return [...new Set(patterns.filter((pattern) => excludedScopePatternProblem(pattern) === null))].slice(0, MAX_EXCLUDED_SCOPES);
}

// visible: no pattern matches. hidden: a pattern matches and no file maps to
// the scope. kept: a pattern matches, but files map to the scope, so it
// stays available.
export type ScopeVisibility = "visible" | "kept" | "hidden";

// A pattern is searched in the name (anchor it with ^ and $ to match the
// whole name). A pattern that does not compile is ignored.
export function createScopeFilter(patterns: readonly string[]): (name: string, hasFiles: boolean) => ScopeVisibility {
  const expressions = patterns.flatMap((pattern) => {
    try {
      return [new RegExp(pattern)];
    } catch {
      return [];
    }
  });
  return (name, hasFiles) => {
    if (!expressions.some((expression) => expression.test(name))) {
      return "visible";
    }
    return hasFiles ? "kept" : "hidden";
  };
}

// The accepted scope list the prompt and the validation use: the list
// without its hidden scopes. null stays null (scopes are unrestricted); a
// list whose scopes are all hidden becomes null too, so the prompt and the
// validation agree that nothing restricts the scope.
export function applyExcludedScopes(accepted: readonly string[] | null, scopeMap: readonly ScopeMapEntry[] | null, patterns: readonly string[]): readonly string[] | null {
  if (!accepted || patterns.length === 0) {
    return accepted;
  }
  const filter = createScopeFilter(patterns);
  const mapped = new Set((scopeMap ?? []).filter((entry) => entry.files.length > 0).map((entry) => entry.scope));
  const remaining = accepted.filter((name) => filter(name, mapped.has(name)) !== "hidden");
  return remaining.length > 0 ? remaining : null;
}
