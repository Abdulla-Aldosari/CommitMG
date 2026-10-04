// Pure (vscode-free) commit message generator based on the list of changed files.
// Produces a Conventional Commits message: `type(scope): summary` + optional body.

export type ChangeKind = "added" | "modified" | "deleted" | "renamed";

export interface FileChange {
  /** Path relative to the repository root, using forward slashes. */
  readonly path: string;
  readonly kind: ChangeKind;
}

const DOC_PATTERN = /(^|\/)(docs?\/|readme|changelog|license|contributing)|\.(md|mdx|txt|rst)$/i;
const TEST_PATTERN = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[^/]+$/i;
const CI_PATTERN = /^\.github\/|(^|\/)\.gitlab-ci\.yml$|(^|\/)azure-pipelines\.yml$/i;
const STYLE_PATTERN = /\.(css|scss|sass|less|styl)$/i;
const BUILD_PATTERN =
  /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig[^/]*\.json|\.vscodeignore|\.gitignore|\.npmignore|\.editorconfig|cliff\.toml|webpack[^/]*|esbuild[^/]*|vite\.config[^/]*)$|^\.vscode\//i;

const VERBS: Record<ChangeKind, string> = {
  added: "add",
  modified: "update",
  deleted: "remove",
  renamed: "rename",
};

function every(changes: readonly FileChange[], pattern: RegExp): boolean {
  return changes.every((change) => pattern.test(change.path));
}

function inferType(changes: readonly FileChange[]): string {
  if (every(changes, DOC_PATTERN)) {
    return "docs";
  }
  if (every(changes, TEST_PATTERN)) {
    return "test";
  }
  if (every(changes, CI_PATTERN)) {
    return "ci";
  }
  if (every(changes, STYLE_PATTERN)) {
    return "style";
  }
  if (every(changes, BUILD_PATTERN)) {
    return "chore";
  }

  const sourceChanges = changes.filter(
    (change) =>
      !DOC_PATTERN.test(change.path) &&
      !TEST_PATTERN.test(change.path) &&
      !CI_PATTERN.test(change.path) &&
      !BUILD_PATTERN.test(change.path),
  );

  if (sourceChanges.some((change) => change.kind === "added")) {
    return "feat";
  }
  if (sourceChanges.length > 0 && sourceChanges.every((change) => change.kind === "deleted")) {
    return "refactor";
  }
  return "fix";
}

function baseName(filePath: string): string {
  const segments = filePath.split("/");
  return segments[segments.length - 1];
}

function stripExtension(fileName: string): string {
  const dotIndex = fileName.indexOf(".", 1);
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

function inferScope(changes: readonly FileChange[]): string | undefined {
  if (changes.length === 1) {
    return stripExtension(baseName(changes[0].path)).toLowerCase() || undefined;
  }

  // Use the first directory below a generic root (e.g. `src/`) shared by every file.
  const genericRoots = new Set(["src", "lib", "app", "packages"]);
  const firstMeaningfulDir = (filePath: string): string | undefined => {
    const dirs = filePath.split("/").slice(0, -1);
    const meaningful = dirs.find((dir) => !genericRoots.has(dir.toLowerCase()));
    return meaningful ?? dirs[0];
  };

  const scopes = new Set(changes.map((change) => firstMeaningfulDir(change.path)));
  if (scopes.size !== 1) {
    return undefined;
  }

  const [scope] = scopes;
  return scope ? scope.replace(/^\./, "").toLowerCase() : undefined;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function inferSummary(changes: readonly FileChange[]): string {
  const kinds = new Set(changes.map((change) => change.kind));
  const verb = kinds.size === 1 ? VERBS[changes[0].kind] : "update";

  if (changes.length <= 3) {
    return `${verb} ${joinNames(changes.map((change) => baseName(change.path)))}`;
  }
  return `${verb} ${changes.length} files`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function generateCommitMessage(changes: readonly FileChange[]): string {
  if (changes.length === 0) {
    return "";
  }

  // De-duplicate paths (a file can appear in several change groups).
  const unique = [...new Map(changes.map((change) => [change.path, change])).values()];

  const type = inferType(unique);
  const scope = inferScope(unique);
  const header = `${type}${scope ? `(${scope})` : ""}: ${inferSummary(unique)}`;

  if (unique.length === 1) {
    return header;
  }

  const body = unique.map((change) => `- ${capitalize(VERBS[change.kind])} ${change.path}`).join("\n");

  return `${header}\n\n${body}`;
}
