// Tests for the message format: the scope policy (a project rule, from
// commitlint scope-empty or .commitmgrc.json) and the bullet spacing (a
// user setting), through the prompt and the validation.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { buildPrompt, parseRulesFile, validateCommitMessage, validateHeaderMeta, type CommitlintConfigData } from "../src/generation";
import { scopePolicyFrom } from "../src/generation/projectRules/commitlintRules";
import { DEFAULT_COMMIT_TYPES, DEFAULT_MESSAGE_FORMAT } from "../src/generation/types";

const STAT = " src/a.ts | 2 +-";
const DIFF = "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-foo\n+bar";
const LIMITS = { header: 72, body: 72 };

describe("scopePolicyFrom", () => {
  const data = (rule?: unknown): CommitlintConfigData => ({ rules: rule === undefined ? {} : { "scope-empty": rule }, baseScopes: undefined, missingExtends: [] });

  it("reads scope-empty the way commitlint applies it", () => {
    assert.equal(scopePolicyFrom(data()), "optional");
    assert.equal(scopePolicyFrom(data([2, "never"])), "required");
    assert.equal(scopePolicyFrom(data([1, "always"])), "none");
    assert.equal(scopePolicyFrom(data([2])), "none");
    assert.equal(scopePolicyFrom(data([0, "never"])), "optional");
  });

  it("reports a malformed rule", () => {
    assert.throws(() => scopePolicyFrom(data("never")), /"scope-empty" in commitlint\.config\.js is malformed/);
    assert.throws(() => scopePolicyFrom(data([2, "sometimes"]), ".commitlintrc.json"), /"scope-empty" in \.commitlintrc\.json is malformed/);
  });
});

describe("scopePolicy in .commitmgrc.json", () => {
  it("accepts the three policies", () => {
    for (const policy of ["required", "optional", "none"]) {
      const parsed = parseRulesFile(JSON.stringify({ scopePolicy: policy }));
      assert.ok(parsed.ok && parsed.data.scopePolicy === policy, policy);
    }
  });

  it("rejects an unknown policy and scopes listed under none", () => {
    assert.deepEqual(parseRulesFile(JSON.stringify({ scopePolicy: "always" })), { ok: false, problems: ['"scopePolicy" must be one of: required, optional, none'] });
    assert.deepEqual(parseRulesFile(JSON.stringify({ scopePolicy: "none", scopes: [{ name: "a" }] })), {
      ok: false,
      problems: ['"scopePolicy" is "none", so "scopes" must be empty'],
    });
  });
});

describe("validateHeaderMeta scope policy", () => {
  const check = (message: string, policy: "required" | "optional" | "none"): string[] => validateHeaderMeta(message, null, [], DEFAULT_COMMIT_TYPES, policy);

  it("requires a scope under required", () => {
    assert.deepEqual(check("fix: subject", "required"), ['the header needs a scope: "type(scope): subject"']);
    assert.deepEqual(check("fix(auth): subject", "required"), []);
  });

  it("forbids a scope under none, ignoring the scope lists", () => {
    assert.deepEqual(validateHeaderMeta("fix(auth): subject", ["docs"], [], DEFAULT_COMMIT_TYPES, "none"), ['the header must not have a scope: "type: subject"']);
    assert.deepEqual(check("fix: subject", "none"), []);
  });

  it("allows both under optional", () => {
    assert.deepEqual(check("fix: subject", "optional"), []);
    assert.deepEqual(check("fix(auth): subject", "optional"), []);
  });
});

describe("validateCommitMessage bullet spacing", () => {
  const blank = ["fix(a): subject", "", "- first point", "", "- second point"].join("\n");
  const compact = ["fix(a): subject", "", "- first point", "- second point"].join("\n");
  const wrappedCompact = ["fix(a): subject", "", "- first point that wraps", "  onto a second line", "- second point"].join("\n");
  const wrappedGap = ["fix(a): subject", "", "- first point that wraps", "  onto a second line", "", "- second point"].join("\n");

  it("keeps the blank-line check by default", () => {
    assert.deepEqual(validateCommitMessage(blank, "lengthy", LIMITS), []);
    assert.deepEqual(validateCommitMessage(compact, "lengthy", LIMITS), ["bullet on line 4 is not preceded by a blank line"]);
  });

  it("asks for consecutive bullets under compact", () => {
    assert.deepEqual(validateCommitMessage(compact, "lengthy", LIMITS, "compact"), []);
    assert.deepEqual(validateCommitMessage(wrappedCompact, "lengthy", LIMITS, "compact"), []);
    assert.deepEqual(validateCommitMessage(blank, "lengthy", LIMITS, "compact"), ["bullet on line 5 is separated from the previous bullet by a blank line"]);
    assert.deepEqual(validateCommitMessage(wrappedGap, "lengthy", LIMITS, "compact"), ["bullet on line 6 is separated from the previous bullet by a blank line"]);
  });

  it("still needs the blank line after the header under compact", () => {
    assert.deepEqual(validateCommitMessage("fix(a): subject\n- point", "lengthy", LIMITS, "compact"), ["bullet on line 2 is not preceded by a blank line"]);
  });

  it("lets a paragraph lead into bullets under compact", () => {
    assert.deepEqual(validateCommitMessage(["fix(a): subject", "", "Why it changed:", "- first", "- second"].join("\n"), "lengthy", LIMITS, "compact"), []);
  });
});

describe("buildPrompt message format", () => {
  const promptFor = (format: Partial<typeof DEFAULT_MESSAGE_FORMAT>, scopes: string[] | null = null): string =>
    buildPrompt("medium", scopes, STAT, DIFF, LIMITS, [], "", undefined, "compact", DEFAULT_COMMIT_TYPES, { ...DEFAULT_MESSAGE_FORMAT, ...format }).systemPrompt;

  it("tells the model to leave out the scope under none", () => {
    const prompt = promptFor({ scopePolicy: "none" }, ["auth"]);

    assert.ok(prompt.includes("None. This project does not use scopes: write every header as <type>: <subject>."));
    assert.ok(!prompt.includes("Accepted scopes:"));
  });

  it("requires a scope, with or without a scope list", () => {
    assert.ok(promptFor({ scopePolicy: "required" }, ["auth", "docs"]).includes("=== SCOPE ===\nRequired. Every header must have a scope.\n"));
    const unlisted = promptFor({ scopePolicy: "required" });
    assert.ok(unlisted.includes("Required. Every header must have a scope.\nThis project has no fixed scope list."));
    assert.ok(!unlisted.includes("omit the scope"));
  });

  it("teaches compact bullets with the blank-line pair as the WRONG example", () => {
    const prompt = promptFor({ bulletSpacing: "compact" });

    assert.ok(prompt.includes("Put bullet points on consecutive lines, with no blank line between them."));
    assert.ok(prompt.includes("WRONG example (blank line between the two bullets):"));
    assert.ok(!prompt.includes("Separate every bullet point from the next with one blank line."));
  });

  it("keeps the blank-line rules by default", () => {
    const prompt = promptFor({});

    assert.ok(prompt.includes("Separate every bullet point from the next with one blank line."));
    assert.ok(prompt.includes("WRONG example (no blank line between the two bullets):"));
  });
});
