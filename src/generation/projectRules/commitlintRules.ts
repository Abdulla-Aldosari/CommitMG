// Extracts the engine's project rules from a loaded commitlint config:
// accepted scopes, length limits, and the scope-to-files map. Every function
// here is pure; loading lives in commitlintLoader.ts.

import { DEFAULT_LIMITS, type CommitlintLimits, type ScopeMapEntry } from "../types";
import type { CommitlintConfigData } from "./commitlintLoader";

// ===================== COMMITLINT SCOPES =====================

// Reads the authoritative scope list from the scope-enum rule (the same
// source of truth commitlint enforces at commit time). Returns null when the
// config defines no scope-enum rule: most configs only extend a shared
// preset, which leaves scopes unrestricted. A rule that is present but
// malformed is a real mistake in the config and is reported, never guessed.
export function acceptedScopesFrom(data: CommitlintConfigData, file: string = "commitlint.config.js"): string[] | null {
  if (!("scope-enum" in data.rules)) {
    return null;
  }

  const rule = data.rules["scope-enum"];
  if (!Array.isArray(rule) || !Array.isArray(rule[2])) {
    throw new Error(`"scope-enum" in ${file} is malformed`);
  }

  return rule[2] as string[];
}

// ===================== COMMITLINT LIMITS =====================

// Reads the length limits from rules["header-max-length"] and
// rules["body-max-line-length"]. Falls back to DEFAULT_LIMITS for a rule
// that is missing or malformed, so generation keeps working.
export function limitsFrom(data: CommitlintConfigData): CommitlintLimits {
  const readNumber = (ruleName: string, fallback: number): number => {
    const rule = data.rules[ruleName];
    const value = Array.isArray(rule) ? rule[2] : undefined;
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };

  return {
    header: readNumber("header-max-length", DEFAULT_LIMITS.header),
    body: readNumber("body-max-line-length", DEFAULT_LIMITS.body),
  };
}

// ===================== SCOPE MAP =====================

// Reads the scope map. The preferred source is the exported baseScopes
// triples ([name, description, files]); configs in the older commented
// format ("scope", // files: description) are parsed from the raw file text
// as a fallback. Returns null when there is no parseable scope information.
export function scopeMapFrom(data: CommitlintConfigData, text: string): ScopeMapEntry[] | null {
  if (Array.isArray(data.baseScopes)) {
    const structured = data.baseScopes
      .filter((entry): entry is [string, string, unknown] => Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === "string" && typeof entry[1] === "string")
      .map((entry) => ({
        scope: entry[0],
        description: entry[1],
        files: Array.isArray(entry[2]) ? entry[2].filter((file): file is string => typeof file === "string") : [],
      }));
    if (structured.length > 0) {
      return structured;
    }
  }

  // Fallback: configs that only carry the scope list as commented lines.
  const commented: ScopeMapEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*"([^"]+)",\s*\/\/\s*(.+?)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const [, scope, comment] = match;
    const colon = comment.indexOf(": ");
    if (colon === -1) {
      commented.push({ scope, description: comment, files: [] });
      continue;
    }
    const files = comment
      .slice(0, colon)
      .split(/\s+\+\s+|\s+or\s+|,\s*/)
      .map((file) => file.trim().replace(/\/\*$/, ""))
      .filter((file) => file.length > 0);
    commented.push({ scope, description: comment.slice(colon + 2), files });
  }
  return commented.length > 0 ? commented : null;
}
