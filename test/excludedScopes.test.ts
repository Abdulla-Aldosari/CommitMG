// Tests for the excluded scopes setting: how a pattern is checked, which
// scopes it hides, and that it reaches the prompt, the validation, and the
// Rules tab without ever touching scopes that have files mapped to them.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { buildPrompt, normalizeOptions, validateHeaderMeta, type ScopeMapEntry } from "../src/generation";
import { applyExcludedScopes, createScopeFilter, excludedScopePatternProblem, MAX_EXCLUDED_SCOPES } from "../src/generation/excludedScopes";
import { isValidUserSettingValue, optionsFromSettings, USER_SETTING_DEFAULTS } from "../src/settings/userSettings";
import { addExcludedScopeProblem, scopesNote } from "../src/webview/excludedScopes";

const STAT = " src/app.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)";
const DIFF = "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-a\n+b";

describe("excludedScopePatternProblem", () => {
  it("accepts ordinary regular expressions", () => {
    assert.equal(excludedScopePatternProblem("^-"), null);
    assert.equal(excludedScopePatternProblem("^(wip|tmp)$"), null);
    assert.equal(excludedScopePatternProblem("-internal$"), null);
  });

  it("explains why a pattern cannot be used", () => {
    assert.equal(excludedScopePatternProblem("  "), "Enter a pattern.");
    assert.equal(excludedScopePatternProblem("x".repeat(101)), "Keep a pattern under 100 characters.");
    assert.equal(excludedScopePatternProblem("a\nb"), "A pattern cannot contain control characters.");
    assert.equal(excludedScopePatternProblem("(unclosed"), "This is not a valid regular expression.");
  });

  it("refuses a repeated group that can take exponential time", () => {
    assert.equal(excludedScopePatternProblem("(a+)+$"), "A repeated group cannot contain another repeat or an alternative.");
    assert.equal(excludedScopePatternProblem("(a|b)*"), "A repeated group cannot contain another repeat or an alternative.");
  });
});

describe("createScopeFilter", () => {
  const filter = createScopeFilter(["^-"]);

  it("hides a matching scope that has no files", () => {
    assert.equal(filter("-auth", false), "hidden");
  });

  it("keeps a matching scope that has files mapped", () => {
    assert.equal(filter("-auth", true), "kept");
  });

  it("leaves a scope that matches nothing visible", () => {
    assert.equal(filter("auth", false), "visible");
    assert.equal(createScopeFilter([])("-auth", false), "visible");
  });

  it("ignores a pattern that does not compile", () => {
    assert.equal(createScopeFilter(["(unclosed"])("auth", false), "visible");
  });
});

describe("applyExcludedScopes", () => {
  const map: ScopeMapEntry[] = [
    { scope: "auth", description: "login", files: ["src/auth/"] },
    { scope: "release", description: "releases", files: [] },
  ];

  it("returns the list untouched without patterns", () => {
    const accepted = ["auth", "-auth"];
    assert.equal(applyExcludedScopes(accepted, map, []), accepted);
    assert.equal(applyExcludedScopes(null, map, ["^-"]), null);
  });

  it("drops the hidden scopes from the list", () => {
    assert.deepEqual(applyExcludedScopes(["auth", "release", "-auth", "-release"], map, ["^-"]), ["auth", "release"]);
  });

  it("never drops a scope that has files mapped", () => {
    assert.deepEqual(applyExcludedScopes(["auth", "release"], map, ["^auth$", "^release$"]), ["auth"]);
  });

  it("treats a list whose scopes are all hidden as unrestricted", () => {
    assert.equal(applyExcludedScopes(["-a", "-b"], null, ["^-"]), null);
  });
});

describe("excluded scopes in the options", () => {
  it("keeps only usable, distinct patterns, up to the limit", () => {
    assert.deepEqual(normalizeOptions({ excludedScopes: [" ^- ", "^-", "", "(bad", "(a+)+"] }).excludedScopes, ["^-"]);
    assert.equal(normalizeOptions({ excludedScopes: Array.from({ length: 40 }, (_, i) => `^s${i}$`) }).excludedScopes.length, MAX_EXCLUDED_SCOPES);
    assert.deepEqual(normalizeOptions({ excludedScopes: "^-" as unknown as string[] }).excludedScopes, []);
  });

  it("is empty by default, so no scope is ever left out", () => {
    assert.deepEqual(normalizeOptions().excludedScopes, []);
    assert.deepEqual(USER_SETTING_DEFAULTS["rules.excludedScopes"], []);
  });

  it("is read from the stored setting", () => {
    assert.deepEqual(optionsFromSettings({ "rules.excludedScopes": ["^-"] }).excludedScopes, ["^-"]);
  });

  it("checks what the webview asks to store", () => {
    assert.equal(isValidUserSettingValue("rules.excludedScopes", ["^-", "^wip$"]), true);
    assert.equal(isValidUserSettingValue("rules.excludedScopes", []), true);
    assert.equal(isValidUserSettingValue("rules.excludedScopes", ["^-", "^-"]), false);
    assert.equal(isValidUserSettingValue("rules.excludedScopes", ["(bad"]), false);
    assert.equal(isValidUserSettingValue("rules.excludedScopes", "^-"), false);
    assert.equal(
      isValidUserSettingValue(
        "rules.excludedScopes",
        Array.from({ length: 21 }, (_, i) => `^s${i}$`),
      ),
      false,
    );
  });
});

describe("excluded scopes in the validation", () => {
  it("rejects a header that uses a scope the list no longer holds", () => {
    const accepted = applyExcludedScopes(["auth", "-auth"], null, ["^-"]);

    assert.deepEqual(validateHeaderMeta("fix(auth): subject", accepted, []), []);
    assert.deepEqual(validateHeaderMeta("fix(-auth): subject", accepted, []), ['scope "-auth" is not in the accepted scope list']);
  });
});

describe("the prompt without a pattern", () => {
  it("lists every accepted scope and mentions no exclusion rule", () => {
    const { systemPrompt } = buildPrompt("medium", ["extension", "-extension", "test"], STAT, DIFF);

    assert.ok(systemPrompt.includes("Accepted scopes:\nextension, -extension, test"));
    assert.ok(!systemPrompt.includes("internal-only"));
  });
});

describe("excluded scopes webview checks", () => {
  it("accepts a new pattern and rejects a duplicate, a bad one, and a full list", () => {
    assert.equal(addExcludedScopeProblem("^-", []), null);
    assert.equal(addExcludedScopeProblem("^-", ["^-"]), "This pattern is already in the list.");
    assert.equal(addExcludedScopeProblem("(bad", []), "This is not a valid regular expression.");
    assert.equal(
      addExcludedScopeProblem(
        "^new$",
        Array.from({ length: MAX_EXCLUDED_SCOPES }, (_, i) => `^s${i}$`),
      ),
      "The list holds at most 20 patterns.",
    );
  });

  it("words the note under the table", () => {
    assert.equal(scopesNote(0, []), null);
    assert.equal(scopesNote(1, []), "1 scope is hidden here and left out of the prompt by the excluded scopes setting.");
    assert.equal(scopesNote(3, []), "3 scopes are hidden here and left out of the prompt by the excluded scopes setting.");
    assert.equal(scopesNote(0, ["app"]), "app matches a pattern but has files mapped, so it stays available.");
    assert.equal(scopesNote(0, ["app", "docs"]), "app, docs match a pattern but have files mapped, so they stay available.");
  });
});
