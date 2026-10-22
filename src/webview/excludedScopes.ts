// Checks a pattern the user types into the excluded scopes list before it is
// added. The rules match the host's own check (src/generation/excludedScopes.ts),
// which runs again before anything is stored.

import { excludedScopePatternProblem, MAX_EXCLUDED_SCOPES } from "../generation/excludedScopes";

// The note under the scopes table: how many listed scopes the excluded
// scopes setting hides, and which matching scopes stay because files map to
// them. null when there is nothing to say.
export function scopesNote(hiddenCount: number, keptNames: readonly string[]): string | null {
  const parts: string[] = [];
  if (hiddenCount > 0) {
    parts.push(`${hiddenCount} ${hiddenCount === 1 ? "scope is" : "scopes are"} hidden here and left out of the prompt by the excluded scopes setting.`);
  }
  if (keptNames.length > 0) {
    parts.push(
      `${keptNames.join(", ")} match${keptNames.length === 1 ? "es" : ""} a pattern but ${keptNames.length === 1 ? "has" : "have"} files mapped, so ${keptNames.length === 1 ? "it stays" : "they stay"} available.`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

export function addExcludedScopeProblem(pattern: string, existing: readonly string[]): string | null {
  const problem = excludedScopePatternProblem(pattern);
  if (problem) {
    return problem;
  }
  if (existing.includes(pattern.trim())) {
    return "This pattern is already in the list.";
  }
  if (existing.length >= MAX_EXCLUDED_SCOPES) {
    return `The list holds at most ${MAX_EXCLUDED_SCOPES} patterns.`;
  }
  return null;
}
