# CommitMG Settings Reference

Every setting CommitMG reads, where it is stored, and where it is edited.
There are two kinds:

- **VS Code settings** (`commitmg.*`): personal preferences that follow the
  user across repositories. Edited in the settings panel or in
  `settings.json`. The panel writes an edit to the workspace when the
  workspace sets any setting the edit touches (a preset switch touches
  six), and to the user settings otherwise. A value that only repeats the
  default is removed from the user settings instead of stored. Every
  setting shows a source badge: Workspace (set in the workspace, even to
  the default), User (set in the user settings to a value that differs from
  the default), or Default (set nowhere). Reset shows only for Workspace
  and User, and removes the value from that layer. Clicking the User or
  Default badge sets the setting in this workspace only, to the value the
  control shows (for a preset knob, the value the active preset puts in
  effect), and leaves the user settings untouched, so other workspaces are
  not affected. Without a folder or workspace open the badges stay plain
  text. The AI settings in section 1 are never copied to a workspace.
- **Project rules**: the rules a repository's messages follow, stored in
  the repository (section 5).

A malformed or out-of-range value in `settings.json` never breaks a
generation: the engine falls back to the default for that value.

## 1. AI Settings tab

Set by the tab; all in the user settings.

| Setting                    | Default  | Values                                                                      |
| -------------------------- | -------- | --------------------------------------------------------------------------- |
| `commitmg.aiPathway`       | `direct` | `direct` (a provider's API) or `vscode` (VS Code's language models)         |
| `commitmg.aiProviderName`  | `gemini` | gemini, openai, anthropic, deepseek, groq, mistral, cohere, stepfun, custom |
| `commitmg.aiModelId`       | empty    | The model of the direct provider; empty uses the provider's default         |
| `commitmg.aiCustomBaseUrl` | empty    | The OpenAI-compatible server for `custom`                                   |
| `commitmg.aiVsCodeModelId` | empty    | The VS Code language model; empty uses the first one available              |

API keys are not settings: they are kept in VS Code's secret storage.

## 2. Speed & Context tab

All have `window` scope.

| Setting                              | Default                        | Range or values                                                              |
| ------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------- |
| `commitmg.context.preset`            | `balanced`                     | fast, balanced, thorough, custom                                             |
| `commitmg.context.includeEvidence`   | true                           | Custom only                                                                  |
| `commitmg.context.evidenceBudget`    | 16,000                         | 2,000 - 200,000 characters; Custom only                                      |
| `commitmg.context.diffBudget`        | 24,000                         | 4,000 - 200,000 characters; Custom only                                      |
| `commitmg.context.diffContextLines`  | 3                              | 0, 1, 2, 3, 5, 10; Custom only                                               |
| `commitmg.prompt.typeGuide`          | `compact`                      | full, compact; Custom only                                                   |
| `commitmg.context.ignoreWhitespace`  | false                          |                                                                              |
| `commitmg.context.excludePatterns`   | lockfiles, `*.min.js`, `*.map` | Up to 50 glob patterns                                                       |
| `commitmg.context.untrackedMaxFiles` | 20                             | 1 - 200                                                                      |
| `commitmg.context.untrackedMaxBytes` | 10,000                         | 1,000 - 200,000                                                              |
| `commitmg.generation.autoCorrect`    | true                           |                                                                              |
| `commitmg.generation.timeoutSeconds` | 120                            | 15 - 600                                                                     |
| `commitmg.model.reasoning`           | `auto`                         | auto, off, low, medium, high, max; only the levels the model offers are sent |
| `commitmg.model.temperature`         | empty (model default)          | 0 - 2; never sent to a model that rejects it                                 |
| `commitmg.model.maxOutputTokens`     | empty (8,192)                  | 256 - 65,536                                                                 |

A named preset sets the five Custom-only values at once. Editing one of
them switches the preset to Custom and keeps the others as they were.

## 3. Message Format tab

All have `window` scope.

| Setting                                  | Default        | Values                                                                                     |
| ---------------------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `commitmg.format.convention`             | `conventional` | `conventional` (`feat(auth): add login`), `basic` (`Add login page`, no type and no scope) |
| `commitmg.format.emojiPosition`          | `off`          | `off`, `beforeType`, `beforeSubject`; ignored under Basic                                  |
| `commitmg.format.bulletSpacing`          | `blank`        | `blank`, `compact`                                                                         |
| `commitmg.format.defaultDetail`          | `ask`          | `ask`, `lengthy`, `medium`, `short`, `titleOnly`                                           |
| `commitmg.format.additionalInstructions` | empty          | Up to 1,000 characters                                                                     |

## 4. Developer

| Setting                      | Default | Effect                                                                                              |
| ---------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `commitmg.developer.enabled` | false   | Records every generation session under the extension's global storage and enables the probe command |

## 5. Project rules (Rules tab)

The rules come from one source, in this order:

1. a commitlint config, found the way commitlint finds it: the `commitlint`
   field of `package.json`, `.commitlintrc`, `.commitlintrc.json`,
   `.commitlintrc.js/.cjs/.mjs`, `commitlint.config.js/.cjs/.mjs`. Rules
   it does not set are read from its `extends` chain when those packages
   are installed;
2. else `.commitmgrc.json` in the repository root;
3. else the built-in rules.

While a commitlint config exists, `.commitmgrc.json` is ignored and the
Rules tab says so. commitlint is never required.

| Rule                         | commitlint rule                                     | `.commitmgrc.json` key                   | Built-in                                                               |
| ---------------------------- | --------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| Allowed types                | `type-enum`                                         | `types` (1 - 30 names)                   | feat, fix, perf, style, refactor, docs, test, chore, build, ci, revert |
| Header length                | `header-max-length`                                 | `headerMaxLength` (52 - 102)             | 55                                                                     |
| Body line length             | `body-max-line-length`                              | `bodyMaxLineLength` (52 - 102)           | 55                                                                     |
| Scope in the header          | `scope-empty` (`never` = required, `always` = none) | `scopePolicy`: required, optional, none  | optional                                                               |
| Accepted scopes              | `scope-enum`                                        | `scopes[].name`                          | any scope                                                              |
| Scope descriptions and files | exported `baseScopes` triples                       | `scopes[].description`, `scopes[].files` | none                                                                   |

The Rules tab edits only `.commitmgrc.json`. It creates the file from a
template: Conventional (the built-in rules) or Angular (the ten types of
`@commitlint/config-angular` and a 72-character header). A commitlint
config is shown read-only, with a button that opens it.

### Excluded scopes

`commitmg.rules.excludedScopes` (a VS Code setting, empty by default) holds
up to 20 regular expressions of at most 100 characters, matched against
scope names. A listed scope that matches one and has no files mapped is left
out of the prompt, rejected by the validation, and hidden from the Rules tab
table; a note under the table says how many are hidden. A scope that has
files mapped is never excluded, and the scopes resolved from the changed
files are always sent. Editing the table never removes a hidden scope from
`.commitmgrc.json`. Example: `^-` excludes every scope that starts with a
hyphen.

The Basic convention ignores the types, the scope policy, and the scopes:
its header has neither a type nor a scope. The length limits still apply.
