// Tests for the exclude-list input check in the settings webview.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { MAX_EXCLUDE_PATTERNS } from "../src/generation/options";
import { addPatternProblem } from "../src/webview/excludePatterns";

describe("addPatternProblem", () => {
  it("accepts a new usable pattern", () => {
    assert.equal(addPatternProblem("**/*.snap", ["*.lock"]), null);
  });

  it("rejects a duplicate, even with surrounding spaces", () => {
    assert.equal(addPatternProblem(" *.lock ", ["*.lock"]), "This pattern is already in the list.");
  });

  it("rejects a pattern the host would refuse", () => {
    assert.equal(addPatternProblem(":(top)x", []), "A pattern cannot start with ':'.");
  });

  it("stops at the list limit", () => {
    const full = Array.from({ length: MAX_EXCLUDE_PATTERNS }, (_, i) => `p${i}`);
    assert.equal(addPatternProblem("new", full), `The list holds at most ${MAX_EXCLUDE_PATTERNS} patterns.`);
  });
});
