// @ts-check
"use strict";

// 1. Defining the Project's Core Scopes
// Each entry is a triple: [name, description, files].
// [description, files] (Used by AI tools to determine the correct scope).
// - name:        the exact scope string allowed in commit headers.
// - description: what the scope covers.
// - files:       repo-relative file paths or directory prefixes (trailing "/")
//                that deterministically map a changed file to this scope.
//                An empty array means the scope has no single home file.
const baseScopes = [
  // Core extension
  ["extension", "command registration, Git API integration; activate()/deactivate()", ["src/extension.ts"]],
  ["commitMessage", "pure commit message generation logic", ["src/commitMessage.ts"]],

  // test/
  ["test", "Mocha unit tests and test infrastructure", ["test/"]],

  // General / cross-cutting
  ["ui", "general visual/UX change not confined to a single file listed above", []],
  ["deps", "adding, removing, or bumping a dependency in package.json/package-lock.json", ["package.json", "package-lock.json"]],
  ["config", "a config file with no dedicated scope of its own", [".gitignore", ".vscodeignore", ".prettierrc", ".prettierignore"]],
  ["eslint", "linting rules and configuration", ["eslint.config.js"]],
  ["tsconfig", "TypeScript compiler configuration", ["tsconfig.json"]],
  ["commitlint", "commit type/scope rules for this project", ["commitlint.config.js"]],
  ["mocharc", "Mocha test runner configuration", [".mocharc.json"]],
  ["husky", "git hook scripts", [".husky/"]],
  ["vscode", "editor/debugger configuration", [".vscode/"]],
  ["workflows", "CI pipelines for lint, test, audit, and CodeQL", [".github/workflows/"]],
  ["assets", "icons/ or docs/ images used for documentation", ["icons/"]],
  ["readme", "changes to the text/content of README.md itself", ["README.md"]],
  ["license", "changes to the LICENSE file", ["LICENSE"]],
  ["changelog", "CHANGELOG.md content or cliff.toml changelog-generation configuration", ["CHANGELOG.md", "cliff.toml"]],
  ["package", "package.json metadata, scripts, or dependencies", ["package.json"]],
  ["release", "release commits: initial releases and version bumps", []],
];

// 2. Append a negative variant of every base scope prefixed with "-" (e.g. "-extension").
// Negative scopes are reserved for small internal feat/fix/perf commits that must be
// excluded from the auto-generated CHANGELOG by git-cliff. The skip rule that performs
// the exclusion lives in "cliff.toml" -> commit_parsers, in the project root.
// Only the first element (name) of each triple is mapped here; descriptions and
// file lists are consumed by the commit-message generator, not by commitlint.
const allowedScopes = [...baseScopes.map(([name]) => name), ...baseScopes.map(([name]) => `-${name}`)];

// 3. Custom rule: a negative scope (e.g. "-extension") is reserved for small
// internal commits and may only be used with feat, fix, or perf.
/** @type {import('@commitlint/types').Plugin} */
const negativeScopeTypesPlugin = {
  rules: {
    "negative-scope-types": (parsed) => {
      const type = parsed && parsed.type ? parsed.type : "";
      const scope = parsed && parsed.scope ? parsed.scope : "";

      if (scope.startsWith("-") && !["feat", "fix", "perf"].includes(type)) {
        return [false, `negative scope "${scope}" is only allowed with types feat, fix, or perf`];
      }

      return [true];
    },
  },
};

/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  plugins: [negativeScopeTypesPlugin],
  // Exported for the commit-message generator so it can map changed files
  // to scopes deterministically; commitlint ignores unknown keys.
  baseScopes,
  rules: {
    // `2` means "error" (refuse to commit).
    // `never` means the scope is never allowed to be empty (required).
    "scope-empty": [2, "never"],

    // Header (type + scope + subject) must not exceed 60 characters.
    "header-max-length": [2, "always", 60],

    // Each line in the commit body must not exceed 60 characters.
    "body-max-line-length": [2, "always", 60],

    // Allowed commit types (fixed, do not change).
    "type-enum": [2, "always", ["feat", "fix", "perf", "style", "refactor", "docs", "test", "chore", "build", "ci", "revert"]],

    // CommitMG project scopes using the dynamically generated list.
    "scope-enum": [2, "always", allowedScopes],

    // Negative scopes are reserved for small internal feat/fix/perf commits.
    "negative-scope-types": [2, "always"],
  },
};
