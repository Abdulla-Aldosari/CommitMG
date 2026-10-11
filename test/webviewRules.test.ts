// Tests for the Rules tab's webview logic: the source banner, the scope
// table conversion and checks, and the type check.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { rulesSourceView, type RulesSourceInput } from "../src/webview/rulesSource";
import { addTypeProblem, rowsToScopes, scopeRowsProblems, scopesToRows } from "../src/webview/rulesTable";

const base: RulesSourceInput = { repoName: "app", status: "ok", error: null, openable: true, source: null };

describe("rulesSourceView", () => {
  it("asks for a repository when none is open", () => {
    assert.deepEqual(rulesSourceView({ ...base, status: "noRepo", openable: false }), {
      kind: "info",
      message: "Open a Git repository to see and edit its commit rules.",
      action: null,
    });
  });

  it("shows why the rules could not be read and offers the file", () => {
    const view = rulesSourceView({ ...base, status: "error", error: ".commitmgrc.json is invalid: x" });
    assert.equal(view.kind, "error");
    assert.match(view.message, /could not be read: \.commitmgrc\.json is invalid: x$/);
    assert.equal(view.action, "open");
  });

  it("names the commitlint file and notes an ignored rules file", () => {
    const view = rulesSourceView({ ...base, source: { kind: "commitlint", file: "commitlint.config.js", missingExtends: [], rulesFileIgnored: true } });
    assert.equal(view.kind, "info");
    assert.match(view.message, /^Rules come from commitlint\.config\.js in app,/);
    assert.match(view.message, /\.commitmgrc\.json is ignored while commitlint is set up\.$/);
    assert.equal(view.action, "open");
  });

  it("warns about shared configs that are not installed", () => {
    const view = rulesSourceView({ ...base, source: { kind: "commitlint", file: "package.json", missingExtends: ["@commitlint/config-conventional"], rulesFileIgnored: false } });
    assert.equal(view.kind, "warning");
    assert.match(view.message, /Not installed, so their rules are missing: @commitlint\/config-conventional\./);
  });

  it("explains an unsupported commitlint format", () => {
    const view = rulesSourceView({ ...base, source: { kind: "unsupportedCommitlint", file: "commitlint.config.ts", rulesFileIgnored: false } });
    assert.equal(view.kind, "warning");
    assert.match(view.message, /^commitlint\.config\.ts in app is a format CommitMG cannot read/);
  });

  it("says edits go to the rules file", () => {
    assert.deepEqual(rulesSourceView({ ...base, source: { kind: "rulesFile", file: ".commitmgrc.json" } }), {
      kind: "info",
      message: "Rules come from .commitmgrc.json in app. Changes here are saved to that file, so commit it to share them.",
      action: "open",
    });
  });

  it("offers to create the rules file when the defaults apply", () => {
    const view = rulesSourceView({ ...base, openable: false, source: { kind: "defaults" } });
    assert.equal(view.action, "create");
    assert.match(view.message, /^No commit rules found in app/);
  });
});

describe("scope table", () => {
  it("round-trips scopes through table rows", () => {
    const scopes = [{ name: "auth", description: "login", files: ["src/auth/", "src/login.ts"] }];
    assert.deepEqual(scopesToRows(scopes), [{ name: "auth", description: "login", files: "src/auth/, src/login.ts" }]);
    assert.deepEqual(rowsToScopes(scopesToRows(scopes)), scopes);
  });

  it("trims cells and drops empty file entries", () => {
    assert.deepEqual(rowsToScopes([{ name: " docs ", description: " guides ", files: " docs/ ,, " }]), [{ name: "docs", description: "guides", files: ["docs/"] }]);
  });

  it("reports the same problems the rules file check does", () => {
    assert.deepEqual(scopeRowsProblems([{ name: "auth", description: "login", files: "src/auth/" }]), []);
    assert.deepEqual(scopeRowsProblems([{ name: "a", description: "", files: "src/a/" }]), ['scope "a" maps files, so it needs a "description" the model can choose by']);
    assert.equal(scopeRowsProblems([{ name: "a", description: "d", files: "../x" }]).length, 1);
    assert.deepEqual(scopeRowsProblems([{ name: "", description: "d", files: "" }]).length, 1);
  });
});

describe("addTypeProblem", () => {
  it("accepts a new lowercase type", () => {
    assert.equal(addTypeProblem("i18n", ["feat"]), null);
  });

  it("rejects a bad name, a duplicate, and a full list", () => {
    assert.match(addTypeProblem("Feat", []) ?? "", /^Use a lowercase name/);
    assert.equal(addTypeProblem("feat", ["feat"]), "This type is already in the list.");
    assert.equal(
      addTypeProblem(
        "x",
        Array.from({ length: 30 }, (_, i) => `t${i}`),
      ),
      "The list holds at most 30 types.",
    );
  });
});
