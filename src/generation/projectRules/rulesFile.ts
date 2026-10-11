// Reads .commitmgrc.json from the repository root. The checks live in
// rulesFileSchema.ts, which has no file access so the settings webview can
// run the very same checks before it sends an edit.

import * as fs from "fs";
import * as path from "path";
import { parseRulesFile, RULES_FILE, RULES_FILE_MAX_BYTES, type RulesFileData } from "./rulesFileSchema";

// The raw text of the rules file, or null when there is none. Throws when
// the path is not a regular file or is too large to be a rules file.
export function readRulesFileText(repoRoot: string): string | null {
  const file = path.join(repoRoot, RULES_FILE);
  if (!fs.existsSync(file)) {
    return null;
  }
  const stat = fs.statSync(file);
  if (!stat.isFile()) {
    throw new Error(`${RULES_FILE} is not a file`);
  }
  if (stat.size > RULES_FILE_MAX_BYTES) {
    throw new Error(`${RULES_FILE} is larger than ${RULES_FILE_MAX_BYTES / 1024} KB`);
  }
  return fs.readFileSync(file, "utf8");
}

// Reads the rules file of a repository. Returns null when there is none;
// throws a user-facing error listing every problem when it is invalid.
export function loadRulesFile(repoRoot: string): RulesFileData | null {
  const text = readRulesFileText(repoRoot);
  if (text === null) {
    return null;
  }
  const parsed = parseRulesFile(text);
  if (!parsed.ok) {
    throw new Error(`${RULES_FILE} is invalid: ${parsed.problems.join("; ")}`);
  }
  return parsed.data;
}
