# CommitMG Security Model

This document lists what CommitMG treats as untrusted, what it sends where,
and the guard on each boundary. Every guard named here is in the code and
covered by tests.

## 1. What leaves the machine

A generation sends one request (two when a correction is needed) to the
model the user chose:

- the system prompt: the rules, the project's types, scopes, and scope
  descriptions, and the user's extra instructions;
- the user prompt: the `git diff --stat` summary, the diff (capped by the
  diff budget, with excluded files left out), the content of new untracked
  files (capped by count and bytes), and, when enabled, the committed
  version of each changed file (capped by the evidence budget).

Nothing is sent before the user presses the button. The prompt size line
on the Speed & Context tab and Estimate Cost build the prompt locally and
send nothing. Binary file content is never sent: an old version that
contains a NUL byte is skipped.

## 2. Secrets

- API keys live in VS Code's secret storage (`context.secrets`, key
  `commitmg.apiKey.<provider>`), never in settings files, so they are
  neither synced nor committed.
- The webview never receives a key: it gets only a key-present flag per
  provider.
- Every provider sends the key in a request header (`x-goog-api-key` for
  Gemini, `x-api-key` for Anthropic, `Authorization: Bearer` for the rest),
  never in the URL.
- URLs in error messages have their query string removed (`redactUrl()`),
  and the developer session record keeps only the origin and path of a
  custom base URL. No key is ever written to a log or a session file.
- A custom base URL over plain `http` to another machine shows a warning
  while typing and a notification on save, since the key and the code
  would travel unencrypted. `localhost`, `*.localhost`, and loopback
  addresses are allowed without a warning.

## 3. Untrusted input from the repository

The repository is untrusted: it may come from anyone.

| Input                          | Risk                                                           | Guard                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File names                     | Shell injection, broken parsing                                | Every git command runs through `execFileSync("git", args)` with an argument array, never a shell. File lists are read with `-z`, so any name, including non-ASCII, reaches git byte for byte                                                                                                                                                                                                   |
| Exclude patterns               | Pathspec magic, paths outside the repository                   | Checked before use: no control characters, no leading `:`, no absolute path, no `..`                                                                                                                                                                                                                                                                                                           |
| commitlint config (JavaScript) | Running repository code                                        | See section 4                                                                                                                                                                                                                                                                                                                                                                                  |
| `.commitmgrc.json`             | Prompt injection, paths outside the repository, malformed data | Parsed as JSON and never run, at most 256 KB. Strictly validated before any value is used: unknown keys rejected, names checked against fixed patterns, descriptions at most 200 characters and one line, limits within 52..102, paths repository-relative with no `.` or `..` segment, no `\`, and no drive letter. A file with any problem is rejected as a whole, with every problem listed |
| Diff and file content          | Text that imitates prompt sections                             | Every data block is wrapped in a `<commitmg_...>` tag with a closing pair, and the prompt states that each block ends at its closing tag                                                                                                                                                                                                                                                       |

## 4. Running a commitlint config

A JavaScript commitlint config is code; reading it means running it.

- **Trusted workspaces only.** The extension does not declare support for
  untrusted workspaces, so VS Code keeps it disabled in Restricted Mode.
  A config is only ever run in a folder the user trusts, the same trust a
  commit hook relies on when it runs the same file.
- **Isolated process.** The config runs in a child Node process (the
  editor's own runtime with `ELECTRON_RUN_AS_NODE=1`), never in the
  extension host. A 10 second timeout stops a config that hangs; the
  config path and format are passed as arguments, never spliced into
  code; only the merged rules, `baseScopes`, and the names of missing
  shared configs come back, as JSON after a marker that the config's own
  output cannot fake.
- **`extends`** is resolved inside that same process, only from the
  project's own `node_modules`, at most ten levels deep. A package that is
  not installed is reported, never fetched.
- JSON configs (`.commitlintrc`, `.commitlintrc.json`, the `commitlint`
  field of `package.json`) are parsed, never run. TypeScript and YAML
  configs are not read at all.

commitlint itself is optional: without any config, no repository code is
run.

## 5. The settings webview

The webview is a separate, less trusted context. Every message it sends is
checked by the host before anything is stored or run.

- **Content Security Policy:** `default-src 'none'`; scripts only with a
  per-load nonce; styles and images only from the extension (plus inline
  styles and `data:` images).
- **Settings:** a key outside the known list is rejected, and every value
  is checked for type and range (`isValidUserSettingValue`) before it is
  written. Extra instructions are accepted only when already clean (no
  control characters, trimmed, at most 1,000 characters).
- **Rules file edits:** the field must be a known one, the template a
  known one, and the whole edited file must pass the same checks a
  generation reads it with. The file is never edited while a commitlint
  config exists, and creating it never overwrites an existing file.
- **External links:** only plain `https` URLs without credentials are
  opened.
- **Rendering:** text that reaches the page is escaped or set through
  `textContent`; the only HTML built from data is assembled locally from
  escaped values.

## 6. The user's own text in the prompt

The extra instructions (`commitmg.format.additionalInstructions`) are the
user's own text, so they are trusted as an instruction but kept in their
place:

- they go into their own tagged section after every rule, and the prompt
  says the rules win when the two conflict;
- the text cannot close its own tag;
- control characters are removed and the length is capped.

The setting has `window` scope, so a repository's
`.vscode/settings.json` can set it only for that workspace, and only once
the workspace is trusted.

## 7. What the model's reply can do

The reply is text placed in the commit input box; it is never run. Before
it is placed:

- a reply cut off at the output limit is rejected;
- a first line that is not a commit header (a code fence, an explanation,
  leaked reasoning) is a violation;
- lengths, types, scopes, and layout are checked, and one correction is
  requested at most. The user always reviews the message before
  committing.

## 8. Developer diagnostics

`commitmg.developer.enabled` is off by default. When on, each generation
writes its prompts, request bodies, replies, and outcome to the extension's
global storage. These files contain the code changes that were sent, but
never an API key. The probe command (developer only) sends test requests
to measure which parameters each model accepts.
