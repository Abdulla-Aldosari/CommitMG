// @ts-check
"use strict";

// 1. Defining the Project's Core Scope
const baseScopes = [
  // Core extension
  "extension", // src/extension.ts: activate()/deactivate(), command registration, Git API integration
  "commitMessage", // src/commitMessage.ts: pure commit message generation logic

  // test/
  "test", // test/*.test.ts: Mocha unit tests and test infrastructure

  // General / cross-cutting
  "ui", // general visual/UX change not confined to a single file listed above
  "deps", // adding, removing, or bumping a dependency in package.json/package-lock.json
  "config", // a config file with no dedicated scope of its own, e.g. .gitignore or .vscodeignore
  "eslint", // eslint.config.js: linting rules and configuration
  "tsconfig", // tsconfig.json: TypeScript compiler configuration
  "commitlint", // commitlint.config.js: commit type/scope rules for this project
  "mocharc", // .mocharc.json: Mocha test runner configuration
  "husky", // .husky/commit-msg or .husky/pre-commit: git hook scripts
  "vscode", // .vscode/launch.json or .vscode/tasks.json: editor/debugger configuration
  "workflows", // .github/workflows/*.yml: CI pipelines for lint, test, audit, and CodeQL
  "assets", // icons/ or docs/ images used for documentation
  "readme", // changes to the text/content of README.md itself
  "license", // changes to the LICENSE file
  "changelog", // CHANGELOG.md content or cliff.toml changelog-generation configuration
  "package", // package.json metadata, scripts, or dependencies
];

// 2. Append a negative variant of every base scope prefixed with "-" (e.g. "-extension").
// Negative scopes are reserved for small internal feat/fix/perf commits that must be
// excluded from the auto-generated CHANGELOG by git-cliff. The skip rule that performs
// the exclusion lives in "cliff.toml" -> commit_parsers, in the project root.
const allowedScopes = [...baseScopes, ...baseScopes.map((scope) => `-${scope}`)];

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
  rules: {
    // `2` means "error" (refuse to commit).
    // `never` means the scope is never allowed to be empty (required).
    "scope-empty": [2, "never"],

    // Header (type + scope + subject) must not exceed 60 characters.
    "header-max-length": [2, "always", 60],

    // Each line in the commit body must not exceed 60 characters.
    "body-max-line-length": [2, "always", 60],

    // Allowed commit types (fixed, do not change).
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "perf", "style", "refactor", "docs", "test", "chore", "build", "ci", "revert"],
    ],

    // CommitMG project scopes using the dynamically generated list.
    "scope-enum": [2, "always", allowedScopes],

    // Negative scopes are reserved for small internal feat/fix/perf commits.
    "negative-scope-types": [2, "always"],
  },
};
