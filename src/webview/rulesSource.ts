// The banner at the top of the Rules tab: where the active rules come
// from, worded for the user, and the action it offers. Pure, so every case
// is tested; the tab only draws the result.

// The part of the host's rules view this module reads. Mirrors RulesView
// in src/settings/rulesSettings.ts without importing host code.
export interface RulesSourceInput {
  repoName: string | null;
  status: "noRepo" | "ok" | "error";
  error: string | null;
  openable: boolean;
  source:
    | { kind: "commitlint"; file: string; missingExtends: string[]; rulesFileIgnored: boolean }
    | { kind: "unsupportedCommitlint"; file: string; rulesFileIgnored: boolean }
    | { kind: "rulesFile"; file: string }
    | { kind: "defaults" }
    | null;
}

export interface RulesSourceView {
  kind: "info" | "warning" | "error";
  message: string;
  // What the tab offers: open the file behind the rules (a banner button),
  // or create the rules file from a template (a row under the banner).
  // null offers nothing.
  action: "open" | "create" | null;
}

const IGNORED_NOTE = " .commitmgrc.json is ignored while commitlint is set up.";

export function rulesSourceView(view: RulesSourceInput): RulesSourceView {
  if (view.status === "noRepo") {
    return { kind: "info", message: "Open a Git repository to see and edit its commit rules.", action: null };
  }
  if (view.status === "error") {
    return { kind: "error", message: `The rules could not be read: ${view.error || "unknown error"}`, action: view.openable ? "open" : null };
  }
  const repo = view.repoName ? ` in ${view.repoName}` : "";
  const source = view.source;
  switch (source?.kind) {
    case "commitlint": {
      const missing = source.missingExtends.length > 0 ? ` Not installed, so their rules are missing: ${source.missingExtends.join(", ")}. Run npm install to read them.` : "";
      return {
        kind: missing ? "warning" : "info",
        message: `Rules come from ${source.file}${repo}, the same rules commitlint checks at commit time. Edit them in that file.${missing}${source.rulesFileIgnored ? IGNORED_NOTE : ""}`,
        action: "open",
      };
    }
    case "unsupportedCommitlint":
      return {
        kind: "warning",
        message: `${source.file}${repo} is a format CommitMG cannot read (TypeScript or YAML), so the built-in rules apply. Use a .js, .cjs, .mjs, or .json commitlint config instead.${source.rulesFileIgnored ? IGNORED_NOTE : ""}`,
        action: "open",
      };
    case "rulesFile":
      return { kind: "info", message: `Rules come from ${source.file}${repo}. Changes here are saved to that file, so commit it to share them.`, action: "open" };
    default:
      return {
        kind: "info",
        message: `No commit rules found${repo}, so the built-in rules apply. Create .commitmgrc.json below to set your own; commitlint is not needed.`,
        action: "create",
      };
  }
}
