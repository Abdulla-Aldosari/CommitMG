// Deterministic mapping from changed files to scope map entries.

import type { ScopeMapEntry } from "../types";

// Exported for unit tests.
// Maps the changed files to scope entries. Exact file paths win over
// directory prefixes, so a file matched exactly is never shadowed by a
// broader prefix scope (src/tools/release/engine.ts -> engine, not
// release). Returns [] when nothing maps.
export function resolveScopesForFiles(scopeMap: readonly ScopeMapEntry[], files: readonly string[]): ScopeMapEntry[] {
  const resolved = new Map<string, ScopeMapEntry>();

  for (const file of files) {
    const matches: ScopeMapEntry[] = [];
    for (const entry of scopeMap) {
      if (entry.files.includes(file)) {
        matches.push(entry);
      }
    }
    if (matches.length === 0) {
      for (const entry of scopeMap) {
        if (entry.files.some((candidate) => candidate.endsWith("/") && file.startsWith(candidate))) {
          matches.push(entry);
        }
      }
    }
    for (const match of matches) {
      resolved.set(match.scope, match);
    }
  }

  return [...resolved.values()];
}
