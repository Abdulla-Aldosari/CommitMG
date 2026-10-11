// Golden snapshot tests for the generated prompts. They lock the exact
// system and user prompt text produced for a fixed set of inputs, so any
// refactor of the generation engine that changes a single character of
// what is sent to the model fails loudly. Intentional prompt changes are
// recorded by running the suite with UPDATE_GOLDEN=1, then reviewing the
// fixture diff before committing it.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import { buildPrompt, buildPromptForRepo, COMMIT_STYLES, type ScopeMapEntry } from "../src/generation";

const GOLDEN_DIR = path.join(__dirname, "fixtures", "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const STAT = " src/auth/session.ts | 12 ++++++------\n 1 file changed, 6 insertions(+), 6 deletions(-)";
const DIFF = [
  "diff --git a/src/auth/session.ts b/src/auth/session.ts",
  "index 1111111..2222222 100644",
  "--- a/src/auth/session.ts",
  "+++ b/src/auth/session.ts",
  "@@ -10,3 +10,3 @@ export function refresh(token: Token) {",
  "-  if (token.expiresAt < Date.now()) {",
  "+  if (token.expiresAt <= Date.now() + SKEW_MS) {",
  "     return renew(token);",
  "   }",
].join("\n");
const EVIDENCE = `\n<commitmg_old_file path="src/auth/session.ts" changed_lines="10-10">\nexport function refresh(token: Token) {\n  if (token.expiresAt < Date.now()) {\n    return renew(token);\n  }\n}\n</commitmg_old_file>`;

const SCOPES = ["auth", "api", "docs", "-auth", "-api"];
const SINGLE_RESOLVED: ScopeMapEntry[] = [{ scope: "auth", description: "login, session, and token handling", files: ["src/auth/"] }];
const MULTI_RESOLVED: ScopeMapEntry[] = [
  { scope: "auth", description: "login, session, and token handling", files: ["src/auth/"] },
  { scope: "api", description: "REST endpoints and request validation", files: ["src/api/"] },
];

function render(prompts: { systemPrompt: string; userPrompt: string }): string {
  return `===== SYSTEM =====\n${prompts.systemPrompt}\n===== USER =====\n${prompts.userPrompt}\n`;
}

function assertGolden(name: string, actual: string): void {
  const file = path.join(GOLDEN_DIR, `${name}.txt`);
  if (UPDATE) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, actual, "utf8");
    return;
  }
  assert.ok(fs.existsSync(file), `Missing golden fixture ${name}.txt - run the tests with UPDATE_GOLDEN=1 to create it`);
  assert.equal(actual, fs.readFileSync(file, "utf8"), `Prompt drifted from golden fixture ${name}.txt`);
}

describe("golden prompts (buildPrompt)", () => {
  for (const style of COMMIT_STYLES) {
    it(`matches the unrestricted-scope prompt for ${style}`, () => {
      assertGolden(`unrestricted-${style}`, render(buildPrompt(style, null, STAT, DIFF)));
    });
  }

  it("matches the prompt with accepted scopes, custom limits, one resolved scope and evidence", () => {
    assertGolden("scoped-medium", render(buildPrompt("medium", SCOPES, STAT, DIFF, { header: 72, body: 72 }, SINGLE_RESOLVED, EVIDENCE)));
  });

  it("matches the prompt with several resolved scopes and asymmetric limits", () => {
    assertGolden("multi-resolved-lengthy", render(buildPrompt("lengthy", SCOPES, STAT, DIFF, { header: 60, body: 64 }, MULTI_RESOLVED)));
  });

  it("matches the prompt with the compact type guide", () => {
    assertGolden("compact-types-medium", render(buildPrompt("medium", null, STAT, DIFF, undefined, [], "", undefined, "compact")));
  });

  it("matches the prompt with an oversized diff that gets truncated", () => {
    const hugeDiff = Array.from({ length: 3000 }, (_, i) => `+const line${i} = ${i}; // padding to exceed the diff cap`).join("\n");
    assertGolden("truncated-short", render(buildPrompt("short", null, STAT, hugeDiff)));
  });
});

describe("golden prompts (buildPromptForRepo)", () => {
  let repoRoot: string;

  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
  };

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-golden-"));
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "core.autocrlf", "false");
    fs.mkdirSync(path.join(repoRoot, "src", "auth"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "commitlint.config.js"),
      [
        'const baseScopes = [["auth", "login, session, and token handling", ["src/auth/"]], ["docs", "project documentation", ["docs/"]]];',
        "module.exports = {",
        "  baseScopes,",
        "  rules: {",
        '    "header-max-length": [2, "always", 64],',
        '    "body-max-line-length": [2, "always", 68],',
        '    "scope-enum": [2, "always", baseScopes.map(([name]) => name)],',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(repoRoot, "src", "auth", "session.ts"),
      "export function refresh(token) {\n  if (token.expiresAt < Date.now()) {\n    return renew(token);\n  }\n}\n",
      "utf8",
    );
    git("add", ".");
    git("commit", "-q", "-m", "chore: initial commit");
    fs.writeFileSync(
      path.join(repoRoot, "src", "auth", "session.ts"),
      "export function refresh(token) {\n  if (token.expiresAt <= Date.now() + SKEW_MS) {\n    return renew(token);\n  }\n}\n",
      "utf8",
    );
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("matches the prompt built from staged changes with evidence and a resolved scope", async () => {
    git("add", ".");
    assertGolden("repo-staged-medium", render(await buildPromptForRepo(repoRoot, "medium")));
  });

  it("matches the prompt built from unstaged changes plus an untracked file", async () => {
    fs.writeFileSync(path.join(repoRoot, "src", "auth", "skew.ts"), "export const SKEW_MS = 30000;\n", "utf8");
    assertGolden("repo-unstaged-untracked-short", render(await buildPromptForRepo(repoRoot, "short")));
  });
});
