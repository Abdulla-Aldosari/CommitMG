// Tests for the Rules tab's host side: the rules view of a repository and
// the edits it writes to .commitmgrc.json.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import { DEFAULT_COMMIT_TYPES, parseRulesFile, RULES_FILE } from "../src/generation";
import { createRulesFile, initialRulesFileText, planRulesFileEdit, readRulesView, RULES_TEMPLATES, rulesSourceFile, writeRulesField } from "../src/settings/rulesSettings";

describe("rules settings", () => {
  let repoRoot: string;

  const write = (file: string, text: string): void => {
    fs.writeFileSync(path.join(repoRoot, file), text, "utf8");
  };
  const rulesFileText = (): string => fs.readFileSync(path.join(repoRoot, RULES_FILE), "utf8");

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-rules-tab-"));
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("shows nothing to edit without a repository", async () => {
    const view = await readRulesView(undefined);

    assert.equal(view.status, "noRepo");
    assert.equal(view.editable, false);
  });

  it("shows the built-in rules without either file", async () => {
    const view = await readRulesView(repoRoot);

    assert.deepEqual(view.source, { kind: "defaults" });
    assert.equal(view.editable, false);
    assert.equal(view.openable, false);
    assert.deepEqual(view.types, [...DEFAULT_COMMIT_TYPES]);
  });

  it("creates the rules file with the defaults and never overwrites it", async () => {
    createRulesFile(repoRoot);

    assert.equal(rulesFileText(), initialRulesFileText());
    assert.equal(parseRulesFile(rulesFileText()).ok, true);
    const view = await readRulesView(repoRoot);
    assert.equal(view.editable, true);
    assert.deepEqual(view.setFields, ["types", "headerMaxLength", "bodyMaxLineLength", "scopePolicy", "scopes"]);
    assert.throws(() => createRulesFile(repoRoot), /EEXIST/);
  });

  it("creates the rules file from the Angular template", async () => {
    createRulesFile(repoRoot, "angular");

    const view = await readRulesView(repoRoot);
    assert.deepEqual(view.types, ["build", "ci", "docs", "feat", "fix", "perf", "refactor", "revert", "style", "test"]);
    assert.deepEqual(view.limits, { header: 72, body: 55 });
  });

  it("writes every template as a valid rules file", () => {
    for (const template of RULES_TEMPLATES) {
      assert.equal(parseRulesFile(initialRulesFileText(template)).ok, true, template);
    }
  });

  it("rejects an unknown template without writing a file", () => {
    assert.throws(() => createRulesFile(repoRoot, "gitmoji"), /unknown rules template "gitmoji"/);
    assert.equal(fs.existsSync(path.join(repoRoot, RULES_FILE)), false);
  });

  it("refuses a rules file while commitlint is set up", () => {
    write("commitlint.config.js", "module.exports = { rules: {} };\n");

    assert.throws(() => createRulesFile(repoRoot), /has a commitlint config/);
    assert.equal(fs.existsSync(path.join(repoRoot, RULES_FILE)), false);
  });

  it("writes one edit and keeps the settings in their fixed order", async () => {
    write(RULES_FILE, JSON.stringify({ scopes: [], types: ["feat"] }));

    writeRulesField(repoRoot, "headerMaxLength", 72);

    assert.deepEqual(Object.keys(JSON.parse(rulesFileText())), ["types", "headerMaxLength", "scopes"]);
    assert.deepEqual((await readRulesView(repoRoot)).limits, { header: 72, body: 55 });
  });

  it("removes a setting on reset, so its default applies", async () => {
    write(RULES_FILE, JSON.stringify({ types: ["feat"], headerMaxLength: 72 }));

    writeRulesField(repoRoot, "types", null);

    const view = await readRulesView(repoRoot);
    assert.deepEqual(view.types, [...DEFAULT_COMMIT_TYPES]);
    assert.deepEqual(view.setFields, ["headerMaxLength"]);
  });

  it("rejects unknown fields and invalid values without touching the file", () => {
    write(RULES_FILE, "{}");

    assert.throws(() => writeRulesField(repoRoot, "$schema", "x"), /unknown rules setting/);
    assert.throws(() => writeRulesField(repoRoot, "headerMaxLength", 500), /"headerMaxLength" must be a whole number/);
    assert.throws(() => writeRulesField(repoRoot, "scopes", [{ name: "a", files: ["../x"] }]), /invalid path/);
    assert.equal(rulesFileText(), "{}");
  });

  it("does not edit the rules file while commitlint is set up", () => {
    write(RULES_FILE, "{}");
    write("commitlint.config.js", "module.exports = { rules: {} };\n");

    assert.throws(() => writeRulesField(repoRoot, "headerMaxLength", 72), /rules come from commitlint/);
  });

  it("asks to fix an invalid file before editing it", () => {
    assert.deepEqual(planRulesFileEdit('{ "headerMaxLength": 9 }', "types", ["feat"]), {
      ok: false,
      problems: ['fix .commitmgrc.json first: "headerMaxLength" must be a whole number from 52 to 102'],
    });
  });

  it("shows commitlint scopes read-only, with their descriptions", async () => {
    write("commitlint.config.js", 'module.exports = { baseScopes: [["auth", "login", ["src/auth/"]]], rules: { "scope-enum": [2, "always", ["auth", "docs"]] } };\n');

    const view = await readRulesView(repoRoot);

    assert.equal(view.editable, false);
    assert.deepEqual(view.scopes, [
      { name: "auth", description: "login", files: ["src/auth/"] },
      { name: "docs", description: "", files: [] },
    ]);
    assert.equal(rulesSourceFile(repoRoot), path.join(repoRoot, "commitlint.config.js"));
  });

  it("turns an invalid rules file into an error view", async () => {
    write(RULES_FILE, "{ broken");

    const view = await readRulesView(repoRoot);

    assert.equal(view.status, "error");
    assert.match(view.error ?? "", /\.commitmgrc\.json is invalid: it is not valid JSON/);
    assert.equal(view.openable, true);
  });
});
