// Tests that the excluded scopes setting reaches the prompt and the Rules
// tab view of a real repository, and that editing the scope table never
// deletes a hidden scope from the rules file.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import { buildPromptForRepo, RULES_FILE } from "../src/generation";
import { readRulesView, writeRulesField } from "../src/settings/rulesSettings";

describe("excluded scopes reach the prompt and the Rules tab", () => {
  let repoRoot: string;
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
  };

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-excluded-"));
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "core.autocrlf", "false");
    fs.mkdirSync(path.join(repoRoot, "src"));
    fs.writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const a = 1;\n", "utf8");
    fs.writeFileSync(
      path.join(repoRoot, "commitlint.config.js"),
      [
        'const baseScopes = [["app", "the application", ["src/"]], ["release", "release commits", []]];',
        "module.exports = {",
        "  baseScopes,",
        '  rules: { "scope-enum": [2, "always", [...baseScopes.map(([name]) => name), ...baseScopes.map(([name]) => `-${name}`)]] },',
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    git("add", ".");
    git("commit", "-q", "-m", "chore: initial commit");
    fs.writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const a = 2;\n", "utf8");
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("shows every scope when no pattern is set", async () => {
    const { systemPrompt } = await buildPromptForRepo(repoRoot, "titleOnly");

    assert.ok(systemPrompt.includes("-app"));
    assert.ok(systemPrompt.includes("-release"));
  });

  it("leaves matching scopes out of the prompt", async () => {
    const { systemPrompt } = await buildPromptForRepo(repoRoot, "titleOnly", { excludedScopes: ["^-"] });

    assert.ok(!systemPrompt.includes("-app") && !systemPrompt.includes("-release"));
    assert.ok(systemPrompt.includes("Accepted scopes:\napp, release"));
  });

  it("still sends the scope the changed files resolve to, even when a pattern matches it", async () => {
    const { systemPrompt } = await buildPromptForRepo(repoRoot, "titleOnly", { excludedScopes: ["^app$"] });

    assert.ok(systemPrompt.includes("app (the application)"));
    assert.ok(systemPrompt.includes("Accepted scopes:\napp, release, -app, -release"));
  });

  it("hides matching scopes from the Rules tab table and says so", async () => {
    const view = await readRulesView(repoRoot, ["^-"]);

    assert.deepEqual(
      view.scopes.map((scope) => scope.name),
      ["app", "release"],
    );
    assert.equal(view.hiddenScopes, 2);
    assert.deepEqual(view.keptScopes, []);
  });

  it("keeps a matching scope with files in the table and reports it", async () => {
    const view = await readRulesView(repoRoot, ["^app$"]);

    assert.ok(view.scopes.some((scope) => scope.name === "app"));
    assert.deepEqual(view.keptScopes, ["app"]);
    assert.equal(view.hiddenScopes, 0);
  });

  it("shows every scope in the table without a pattern", async () => {
    const view = await readRulesView(repoRoot);

    assert.equal(view.scopes.length, 4);
    assert.equal(view.hiddenScopes, 0);
  });
});

describe("editing the scope table", () => {
  let repoRoot: string;
  const fileScopes = (): Array<{ name: string }> => (JSON.parse(fs.readFileSync(path.join(repoRoot, RULES_FILE), "utf8")) as { scopes: Array<{ name: string }> }).scopes;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-excluded-edit-"));
    fs.writeFileSync(path.join(repoRoot, RULES_FILE), `${JSON.stringify({ scopes: [{ name: "auth" }, { name: "wip" }, { name: "docs" }] }, null, 2)}\n`, "utf8");
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("keeps a hidden scope of the file when the visible rows are saved", () => {
    writeRulesField(repoRoot, "scopes", [{ name: "auth", description: "", files: [] }], ["^wip$"]);

    assert.deepEqual(
      fileScopes().map((scope) => scope.name),
      ["auth", "wip"],
    );
  });

  it("saves the rows as they are without a pattern", () => {
    writeRulesField(repoRoot, "scopes", [{ name: "auth", description: "", files: [] }]);

    assert.deepEqual(
      fileScopes().map((scope) => scope.name),
      ["auth"],
    );
  });

  it("refuses a scope name that starts with a hyphen", () => {
    assert.throws(() => writeRulesField(repoRoot, "scopes", [{ name: "-auth", description: "", files: [] }]), /Rejected the edit/);
  });
});
