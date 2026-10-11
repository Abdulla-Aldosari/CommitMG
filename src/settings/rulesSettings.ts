// The Rules tab's view of the project rules and the edits it makes to
// .commitmgrc.json. vscode-free, so it is tested directly; the settings
// panel does the messaging.
//
// The tab shows the rules from the one active source (see
// projectRules.ts). Only the rules file is edited here: a commitlint config
// is code or a shared package, so it is shown read-only with a way to open
// it, and the built-in defaults are turned into a rules file on request.

import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_COMMIT_TYPES,
  findCommitlintConfig,
  loadProjectRules,
  loadRulesFile,
  parseRulesFile,
  readRulesFileText,
  RULES_FILE,
  RULES_LIMIT_MAX,
  RULES_LIMIT_MIN,
  type CommitlintLimits,
  type RulesFileScope,
  type RulesSource,
} from "../generation";
import { RULES_FILE_KEYS, type RulesFileData } from "../generation/projectRules/rulesFileSchema";
import { DEFAULT_LIMITS, DEFAULT_SCOPE_POLICY, type ScopePolicy } from "../generation/types";

// The rules file settings the tab edits.
export const RULES_FIELDS = ["types", "headerMaxLength", "bodyMaxLineLength", "scopePolicy", "scopes"] as const;
export type RulesField = (typeof RULES_FIELDS)[number];

export function isRulesField(field: unknown): field is RulesField {
  return typeof field === "string" && (RULES_FIELDS as readonly string[]).includes(field);
}

export interface RulesView {
  // The repository the rules belong to; null when none is open.
  repoName: string | null;
  // "error" when the active source could not be read (an invalid rules
  // file, a commitlint config that fails); error says why.
  status: "noRepo" | "ok" | "error";
  error: string | null;
  // Whether a rules file or commitlint config exists to open.
  openable: boolean;
  source: RulesSource | null;
  // True only when the rules come from .commitmgrc.json.
  editable: boolean;
  types: string[];
  limits: CommitlintLimits;
  scopePolicy: ScopePolicy;
  scopes: RulesFileScope[];
  // The fields the rules file sets; the others show their defaults.
  setFields: RulesField[];
  defaults: { types: string[]; limits: CommitlintLimits; scopePolicy: ScopePolicy };
  limitRange: { min: number; max: number };
}

function baseView(repoRoot: string | undefined): RulesView {
  return {
    repoName: repoRoot ? path.basename(repoRoot) : null,
    status: repoRoot ? "ok" : "noRepo",
    error: null,
    openable: repoRoot ? rulesSourceFile(repoRoot) !== null : false,
    source: null,
    editable: false,
    types: [...DEFAULT_COMMIT_TYPES],
    limits: { ...DEFAULT_LIMITS },
    scopePolicy: DEFAULT_SCOPE_POLICY,
    scopes: [],
    setFields: [],
    defaults: { types: [...DEFAULT_COMMIT_TYPES], limits: { ...DEFAULT_LIMITS }, scopePolicy: DEFAULT_SCOPE_POLICY },
    limitRange: { min: RULES_LIMIT_MIN, max: RULES_LIMIT_MAX },
  };
}

// Reads the rules of a repository for the tab. Never throws: a source that
// cannot be read becomes an "error" view.
export async function readRulesView(repoRoot: string | undefined): Promise<RulesView> {
  const view = baseView(repoRoot);
  if (!repoRoot) {
    return view;
  }
  try {
    const rules = await loadProjectRules(repoRoot);
    view.source = rules.source;
    view.types = rules.types;
    view.limits = rules.limits;
    view.scopePolicy = rules.scopePolicy;
    if (rules.source.kind === "rulesFile") {
      const file = loadRulesFile(repoRoot);
      view.editable = true;
      view.scopes = file?.scopes ?? [];
      view.setFields = file ? setFieldsOf(file) : [];
    } else {
      const described = new Map((rules.scopeMap ?? []).map((entry) => [entry.scope, entry]));
      const names = rules.acceptedScopes ?? (rules.scopeMap ?? []).map((entry) => entry.scope);
      view.scopes = names.map((name) => ({ name, description: described.get(name)?.description ?? "", files: [...(described.get(name)?.files ?? [])] }));
    }
  } catch (error) {
    view.status = "error";
    view.error = error instanceof Error ? error.message : String(error);
  }
  return view;
}

function setFieldsOf(file: RulesFileData): RulesField[] {
  const set: Record<RulesField, boolean> = {
    types: file.types !== null,
    headerMaxLength: file.limits.header !== undefined,
    bodyMaxLineLength: file.limits.body !== undefined,
    scopePolicy: file.scopePolicy !== null,
    scopes: file.scopes !== null,
  };
  return RULES_FIELDS.filter((field) => set[field]);
}

// The file behind the active rules: the commitlint config when there is
// one, else the rules file when it exists.
export function rulesSourceFile(repoRoot: string): string | null {
  const commitlint = findCommitlintConfig(repoRoot);
  if (commitlint) {
    return path.join(repoRoot, commitlint.file);
  }
  const rulesFile = path.join(repoRoot, RULES_FILE);
  return fs.existsSync(rulesFile) ? rulesFile : null;
}

export type RulesFileEdit = { ok: true; text: string } | { ok: false; problems: string[] };

// The new text of the rules file after one edit. null removes the setting,
// so its default applies. The whole result is checked with the same rules
// a generation reads the file with, and the settings are written in their
// fixed order.
export function planRulesFileEdit(text: string, field: RulesField, value: unknown): RulesFileEdit {
  const current = parseRulesFile(text);
  if (!current.ok) {
    return { ok: false, problems: [`fix ${RULES_FILE} first: ${current.problems.join("; ")}`] };
  }
  const settings = JSON.parse(text) as Record<string, unknown>;
  if (value === null) {
    delete settings[field];
  } else {
    settings[field] = value;
  }
  return formatRulesFile(settings);
}

function formatRulesFile(settings: Record<string, unknown>): RulesFileEdit {
  const ordered: Record<string, unknown> = {};
  for (const key of RULES_FILE_KEYS) {
    if (key in settings) {
      ordered[key] = settings[key];
    }
  }
  const text = `${JSON.stringify(ordered, null, 2)}\n`;
  const check = parseRulesFile(text);
  return check.ok ? { ok: true, text } : { ok: false, problems: check.problems };
}

// The first rules file: the defaults written out, so every setting is
// visible and editable from the start.
export function initialRulesFileText(): string {
  const edit = formatRulesFile({
    types: [...DEFAULT_COMMIT_TYPES],
    headerMaxLength: DEFAULT_LIMITS.header,
    bodyMaxLineLength: DEFAULT_LIMITS.body,
    scopePolicy: DEFAULT_SCOPE_POLICY,
    scopes: [],
  });
  if (!edit.ok) {
    throw new Error(`The default rules are invalid: ${edit.problems.join("; ")}`);
  }
  return edit.text;
}

// Creates the rules file. Refused while a commitlint config exists (it
// would be ignored) and when the file already exists (never overwritten).
export function createRulesFile(repoRoot: string): void {
  if (findCommitlintConfig(repoRoot)) {
    throw new Error(`this repository has a commitlint config, so ${RULES_FILE} would be ignored.`);
  }
  // "wx" fails when the file exists, so a file made in the meantime is
  // never overwritten.
  fs.writeFileSync(path.join(repoRoot, RULES_FILE), initialRulesFileText(), { encoding: "utf8", flag: "wx" });
}

// Applies one edit from the tab to the rules file. The tab is a trust
// boundary: the field is checked against the known list and the value by
// the same checks a generation reads the file with.
export function writeRulesField(repoRoot: string, field: unknown, value: unknown): void {
  if (!isRulesField(field)) {
    throw new Error(`Rejected an edit of unknown rules setting "${String(field)}".`);
  }
  if (findCommitlintConfig(repoRoot)) {
    throw new Error(`the rules come from commitlint, so ${RULES_FILE} is not edited.`);
  }
  const text = readRulesFileText(repoRoot);
  if (text === null) {
    throw new Error(`${RULES_FILE} does not exist; create it first.`);
  }
  const edit = planRulesFileEdit(text, field, value);
  if (!edit.ok) {
    throw new Error(`Rejected the edit: ${edit.problems.join("; ")}`);
  }
  fs.writeFileSync(path.join(repoRoot, RULES_FILE), edit.text, "utf8");
}
