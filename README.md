<a href="https://github.com/Abdulla-Aldosari/CommitMG"><img src="icons/icon.png" width="128" alt="Commit MG logo"></a>

# Commit MG

A tiny VS Code extension that adds a single button to the Source Control **Changes** toolbar to generate commit message.

![generating commit message](docs/images/hero-screenshot.jpg)

## How it works

Press the sparkle button in the Source Control toolbar, pick a detail
level (Lengthy, Medium, Short, or Title only), and the message lands in
the commit box. Commit MG reads your staged changes (or, when nothing is
staged, your unstaged and new files), sends them to the model you chose,
and checks the reply before you see it: header and line lengths, the
allowed types and scopes, and the layout. A message that breaks a rule is
sent back once for a fix.

Set a default detail level and the button generates right away; any other
level stays one click away under **Generate Commit Message with Another
Style** in the Source Control menu.

## Models

Open **Commit MG: Open Settings** and choose one of:

- **A provider's API**: Google Gemini, OpenAI, Anthropic Claude, DeepSeek,
  Groq, Mistral, Cohere, StepFun, or any OpenAI-compatible server (such as
  a local Ollama). The API key is kept in VS Code's secret storage, never
  in your settings files.
- **VS Code's language models** (GitHub Copilot Chat), with no key.

The AI Settings tab can check the connection, show the rate limits a
provider reports, and estimate what each request costs.

## Settings

The settings panel has four tabs:

- **AI Settings**: the provider, the model, and the API key.
- **Speed & Context**: how much of the change the model sees. Fast,
  Balanced, and Thorough set every size at once, and the tab shows how
  large a request is on your current changes. Also the reasoning level,
  temperature, output cap, and request timeout.
- **Message Format**: your own preferences for every repository:
  - the header form: Conventional (`feat(auth): add login`) or Basic
    (`Add login page`, with no type and no scope);
  - a type emoji, chosen from the type: `feat(auth): ✨ add login`;
  - the space between bullet points, the default detail level, and extra
    instructions for the model.

  **View Examples** shows a sample of each detail level.

- **Rules**: the project's rules, which every message follows.

## Project rules

The rules (allowed types, header and body line lengths, whether a header
has a scope, and the list of scopes) come from one place:

1. the project's **commitlint** config, when it has one, so the messages
   pass the same checks commitlint runs at commit time;
2. else **`.commitmgrc.json`** in the repository root;
3. else the built-in rules.

commitlint is not needed. Without it, create `.commitmgrc.json` from the
Rules tab, starting from the Conventional or Angular rules, and edit it
there or by hand. Commit it to share the rules with your team:

```json
{
  "types": ["feat", "fix", "docs", "refactor", "test", "chore"],
  "headerMaxLength": 72,
  "bodyMaxLineLength": 72,
  "scopePolicy": "optional",
  "scopes": [
    { "name": "auth", "description": "login and sessions", "files": ["src/auth/"] },
    { "name": "docs", "description": "documentation", "files": ["docs/"] }
  ]
}
```

A scope with `files` is chosen for you when the changed files fall under
it. Every key is optional, and a file with a mistake is reported in full,
never silently ignored.

## Workspace Trust

Commit MG runs only in trusted workspaces. In
[Restricted Mode](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust)
VS Code keeps the extension disabled, so the Generate button does not
appear until you trust the folder.

This is deliberate. When a project has a commitlint config, Commit MG
reads its rules from it, and a JavaScript config is code: reading it means
running it, so it is only ever done in a folder you trust (the same trust
a commit hook relies on when it runs the same file). Even then, the config
runs in a separate process with a 10 second time limit, so a broken or
slow config cannot freeze or crash the editor. `.commitmgrc.json` is plain
JSON and is never run.

To use Commit MG in a folder, trust it from the Restricted Mode banner or
with the **Workspaces: Manage Workspace Trust** command.

## Development

```bash
npm install
npm run compile   # or: npm run watch
```

Press `F5` to launch the Extension Development Host and try the extension.
