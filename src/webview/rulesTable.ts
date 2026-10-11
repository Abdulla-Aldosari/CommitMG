// Converts between the Rules tab's scope table and the scopes of
// .commitmgrc.json, and checks a table or a type before the tab sends it.
// The checks are the very ones a generation reads the file with
// (rulesFileSchema.ts), so the tab can never send what the host rejects.

import { isValidTypeName, MAX_NAME_LENGTH, MAX_TYPES, parseRulesFile, type RulesFileScope } from "../generation/projectRules/rulesFileSchema";

// One table row: every cell is text. files is a comma-separated list.
export interface ScopeRow {
  name: string;
  description: string;
  files: string;
}

export function scopesToRows(scopes: readonly RulesFileScope[]): ScopeRow[] {
  return scopes.map((scope) => ({ name: scope.name, description: scope.description, files: scope.files.join(", ") }));
}

export function rowsToScopes(rows: readonly ScopeRow[]): RulesFileScope[] {
  return rows.map((row) => ({
    name: row.name.trim(),
    description: row.description.trim(),
    files: row.files
      .split(",")
      .map((file) => file.trim())
      .filter((file) => file !== ""),
  }));
}

// Every problem of a table, worded as the rules file check words it.
export function scopeRowsProblems(rows: readonly ScopeRow[]): string[] {
  const parsed = parseRulesFile(JSON.stringify({ scopes: rowsToScopes(rows) }));
  return parsed.ok ? [] : parsed.problems;
}

// Why a type cannot be added to the list, or null when it can.
export function addTypeProblem(type: string, existing: readonly string[]): string | null {
  const name = type.trim();
  if (!isValidTypeName(name)) {
    return `Use a lowercase name of up to ${MAX_NAME_LENGTH} letters, digits, and hyphens, starting with a letter.`;
  }
  if (existing.includes(name)) {
    return "This type is already in the list.";
  }
  if (existing.length >= MAX_TYPES) {
    return `The list holds at most ${MAX_TYPES} types.`;
  }
  return null;
}
