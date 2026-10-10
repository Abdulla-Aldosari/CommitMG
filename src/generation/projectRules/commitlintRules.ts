// Reads the project's commitlint configuration: accepted scopes, length
// limits, and the scope-to-files map.

import * as fs from "fs";
import * as path from "path";
import { DEFAULT_LIMITS, type CommitlintLimits, type ScopeMapEntry } from "../types";

// ===================== COMMITLINT SCOPES =====================

// Exported for unit tests.
// Reads the authoritative scope list from the scope-enum rule of the
// project's commitlint.config.js (the same source of truth commitlint
// enforces at commit time). Returns null when the project has no
// commitlint.config.js, in which case the scope is unrestricted.
export function readAcceptedScopes(repoRoot: string): string[] | null {
  const configPath = path.join(repoRoot, "commitlint.config.js");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  // The original script ran in a fresh process per invocation, so it always
  // read the current file content. Drop the require cache entry first so
  // edits to the config are picked up without reloading the window.
  /* eslint-disable @typescript-eslint/no-require-imports -- mirrors the original script's require() of the user's config */
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath) as { rules?: Record<string, unknown> };
  /* eslint-enable @typescript-eslint/no-require-imports */
  const rule = config && config.rules && config.rules["scope-enum"];

  if (!Array.isArray(rule) || !Array.isArray(rule[2])) {
    throw new Error('"scope-enum" in commitlint.config.js is missing or malformed');
  }

  return rule[2] as string[];
}

// ===================== COMMITLINT LIMITS =====================

// Exported for unit tests.
// Reads the authoritative length limits from the project's commitlint
// config: rules["header-max-length"] and rules["body-max-line-length"] (the
// same source of truth commitlint enforces at commit time). Falls back to
// DEFAULT_LIMITS when the project has no commitlint.config.js or when a
// rule is missing or malformed, so generation keeps working on projects
// without commitlint.
export function readCommitlintLimits(repoRoot: string): CommitlintLimits {
  const configPath = path.join(repoRoot, "commitlint.config.js");
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_LIMITS };
  }

  /* eslint-disable @typescript-eslint/no-require-imports -- mirrors readAcceptedScopes()'s require of the user's config */
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath) as { rules?: Record<string, unknown> };
  /* eslint-enable @typescript-eslint/no-require-imports */

  const readNumber = (ruleName: string, fallback: number): number => {
    const rule = config && config.rules && config.rules[ruleName];
    const value = Array.isArray(rule) ? rule[2] : undefined;
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };

  return {
    header: readNumber("header-max-length", DEFAULT_LIMITS.header),
    body: readNumber("body-max-line-length", DEFAULT_LIMITS.body),
  };
}

// ===================== SCOPE MAP =====================

// Exported for unit tests.
// Reads the scope map from the project's commitlint.config.js. The preferred
// source is the exported baseScopes triples ([name, description, files]);
// configs in the older commented format ("scope", // files: description) are
// parsed as a fallback. Returns null when the project has no commitlint
// config or no parseable scope information.
export function readScopeMap(repoRoot: string): ScopeMapEntry[] | null {
  const configPath = path.join(repoRoot, "commitlint.config.js");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  /* eslint-disable @typescript-eslint/no-require-imports -- mirrors readAcceptedScopes()'s require of the user's config */
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath) as { baseScopes?: unknown };
  /* eslint-enable @typescript-eslint/no-require-imports */

  if (Array.isArray(config.baseScopes)) {
    const structured = config.baseScopes
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
  for (const line of fs.readFileSync(configPath, "utf8").split(/\r?\n/)) {
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
