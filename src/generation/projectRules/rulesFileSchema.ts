// The format of .commitmgrc.json, the project rules file for repositories
// without a commitlint config, and its checks. The file comes from the
// repository, so it is treated as untrusted input: it is parsed as JSON and
// never executed, and every value is checked strictly before any of it
// reaches the prompt, the validation, or a file-path comparison. A file
// with any problem is rejected as a whole, with every problem listed, so a
// typo can never be silently ignored. No file access here: the settings
// webview bundles this module to run the same checks on an edit.

import { SCOPE_POLICIES, type CommitlintLimits, type ScopePolicy } from "../types";

export const RULES_FILE = ".commitmgrc.json";

// A rules file larger than this is not a hand-written rules file.
export const RULES_FILE_MAX_BYTES = 256 * 1024;

// The limits a rules file may set: the band the prompt's GOOD/WRONG length
// examples cover, so every allowed limit is taught correctly.
export const RULES_LIMIT_MIN = 52;
export const RULES_LIMIT_MAX = 102;

export const MAX_TYPES = 30;
const MAX_SCOPES = 200;
const MAX_FILES_PER_SCOPE = 50;
export const MAX_NAME_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_PATH_LENGTH = 260;

const TYPE_PATTERN = /^[a-z][a-z0-9-]*$/;
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;
// Every setting of the file, in the order it is written.
export const RULES_FILE_KEYS = ["$schema", "types", "headerMaxLength", "bodyMaxLineLength", "scopePolicy", "scopes"] as const;
const KNOWN_KEYS = new Set<string>(RULES_FILE_KEYS);
const KNOWN_SCOPE_KEYS = new Set(["name", "description", "files"]);

export function isValidTypeName(type: unknown): type is string {
  return typeof type === "string" && type.length <= MAX_NAME_LENGTH && TYPE_PATTERN.test(type);
}

export interface RulesFileScope {
  name: string;
  description: string;
  // Repository-relative files or directory prefixes (trailing "/").
  files: string[];
}

// The validated content. A missing setting is null (types, scopes) or
// absent (limits), so the caller applies its own default.
export interface RulesFileData {
  types: string[] | null;
  limits: Partial<CommitlintLimits>;
  scopePolicy: ScopePolicy | null;
  scopes: RulesFileScope[] | null;
}

export type RulesFileParse = { ok: true; data: RulesFileData } | { ok: false; problems: string[] };

// Validates the text of a rules file. Never throws.
export function parseRulesFile(text: string): RulesFileParse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [`it is not valid JSON (${error instanceof Error ? error.message : String(error)})`] };
  }
  if (!isPlainObject(value)) {
    return { ok: false, problems: ["it must be a JSON object"] };
  }

  const problems: string[] = [];
  for (const key of Object.keys(value)) {
    if (!KNOWN_KEYS.has(key)) {
      problems.push(`"${key}" is not a known setting`);
    }
  }
  if ("$schema" in value && typeof value.$schema !== "string") {
    problems.push(`"$schema" must be a string`);
  }

  const types = "types" in value ? readTypes(value.types, problems) : null;
  const limits: Partial<CommitlintLimits> = {};
  if ("headerMaxLength" in value) {
    const header = readLimit("headerMaxLength", value.headerMaxLength, problems);
    if (header !== null) {
      limits.header = header;
    }
  }
  if ("bodyMaxLineLength" in value) {
    const body = readLimit("bodyMaxLineLength", value.bodyMaxLineLength, problems);
    if (body !== null) {
      limits.body = body;
    }
  }
  const scopePolicy = "scopePolicy" in value ? readScopePolicy(value.scopePolicy, problems) : null;
  const scopes = "scopes" in value ? readScopes(value.scopes, problems) : null;
  if (scopePolicy === "none" && scopes && scopes.length > 0) {
    problems.push(`"scopePolicy" is "none", so "scopes" must be empty`);
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, data: { types, limits, scopePolicy, scopes } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTypes(value: unknown, problems: string[]): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TYPES) {
    problems.push(`"types" must be a list of 1 to ${MAX_TYPES} names`);
    return null;
  }
  const seen = new Set<string>();
  for (const type of value) {
    if (!isValidTypeName(type)) {
      problems.push(`"types" entry ${JSON.stringify(type)} must be a lowercase name of letters, digits, and hyphens, starting with a letter`);
    } else if (seen.has(type)) {
      problems.push(`"types" lists "${type}" twice`);
    } else {
      seen.add(type);
    }
  }
  return [...seen];
}

function readLimit(key: string, value: unknown, problems: string[]): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < RULES_LIMIT_MIN || value > RULES_LIMIT_MAX) {
    problems.push(`"${key}" must be a whole number from ${RULES_LIMIT_MIN} to ${RULES_LIMIT_MAX}`);
    return null;
  }
  return value;
}

function readScopePolicy(value: unknown, problems: string[]): ScopePolicy | null {
  if (typeof value !== "string" || !(SCOPE_POLICIES as readonly string[]).includes(value)) {
    problems.push(`"scopePolicy" must be one of: ${SCOPE_POLICIES.join(", ")}`);
    return null;
  }
  return value as ScopePolicy;
}

function readScopes(value: unknown, problems: string[]): RulesFileScope[] | null {
  if (!Array.isArray(value) || value.length > MAX_SCOPES) {
    problems.push(`"scopes" must be a list of at most ${MAX_SCOPES} scopes`);
    return null;
  }
  const scopes: RulesFileScope[] = [];
  const seen = new Set<string>();
  value.forEach((entry: unknown, index) => {
    const where = `"scopes" entry ${index + 1}`;
    if (!isPlainObject(entry)) {
      problems.push(`${where} must be an object with a "name"`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!KNOWN_SCOPE_KEYS.has(key)) {
        problems.push(`${where} has an unknown setting "${key}"`);
      }
    }

    const name = entry.name;
    if (typeof name !== "string" || name.length > MAX_NAME_LENGTH || !SCOPE_PATTERN.test(name)) {
      problems.push(`${where} needs a "name" of up to ${MAX_NAME_LENGTH} lowercase letters, digits, dots, slashes, and hyphens`);
      return;
    }
    if (seen.has(name)) {
      problems.push(`scope "${name}" is listed twice`);
      return;
    }
    seen.add(name);

    const description = entry.description ?? "";
    if (typeof description !== "string" || description.length > MAX_DESCRIPTION_LENGTH || /[\r\n]/.test(description)) {
      problems.push(`scope "${name}" needs a "description" of one line, at most ${MAX_DESCRIPTION_LENGTH} characters`);
      return;
    }
    const files = readFiles(name, entry.files ?? [], problems);
    if (files.length > 0 && description.trim() === "") {
      problems.push(`scope "${name}" maps files, so it needs a "description" the model can choose by`);
    }
    scopes.push({ name, description: description.trim(), files });
  });
  return scopes;
}

// Every path must stay inside the repository: relative, forward slashes,
// no "." or ".." segment, no drive letter, no control characters.
function readFiles(scope: string, value: unknown, problems: string[]): string[] {
  if (!Array.isArray(value) || value.length > MAX_FILES_PER_SCOPE) {
    problems.push(`scope "${scope}" needs "files" as a list of at most ${MAX_FILES_PER_SCOPE} paths`);
    return [];
  }
  const files: string[] = [];
  for (const file of value) {
    if (typeof file !== "string" || !isSafeRelativePath(file)) {
      problems.push(`scope "${scope}" has an invalid path ${JSON.stringify(file)}: use a repository-relative path with forward slashes`);
    } else {
      files.push(file);
    }
  }
  return files;
}

function isSafeRelativePath(file: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (file === "" || file.length > MAX_PATH_LENGTH || file.startsWith("/") || file.includes("\\") || /^[a-zA-Z]:/.test(file) || /[\u0000-\u001f]/.test(file)) {
    return false;
  }
  const segments = file.endsWith("/") ? file.slice(0, -1).split("/") : file.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
