// Checks a pattern the user types into the exclude list before it is
// added. The rules match the host's own check (src/generation/options.ts),
// which runs again before anything is stored.

import { excludePatternProblem, MAX_EXCLUDE_PATTERNS } from "../generation/options";

export function addPatternProblem(pattern: string, existing: readonly string[]): string | null {
  const problem = excludePatternProblem(pattern);
  if (problem) {
    return problem;
  }
  if (existing.includes(pattern.trim())) {
    return "This pattern is already in the list.";
  }
  if (existing.length >= MAX_EXCLUDE_PATTERNS) {
    return `The list holds at most ${MAX_EXCLUDE_PATTERNS} patterns.`;
  }
  return null;
}
