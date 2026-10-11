// Tests that the compact type guide stays in step with the full one.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { countPromptTokens } from "../src/ai/estimatePromptCost";
import { COMPACT_TYPE_EXPLANATIONS, TYPE_EXPLANATIONS, typeSectionText } from "../src/generation/prompt/typeGuide";

describe("compact type guide", () => {
  it("explains the same types in the same order as the full guide", () => {
    assert.deepEqual(
      COMPACT_TYPE_EXPLANATIONS.map(([type]) => type),
      TYPE_EXPLANATIONS.map(([type]) => type),
    );
  });

  it("gives every type a real one-line explanation", () => {
    for (const [type, explanation] of COMPACT_TYPE_EXPLANATIONS) {
      assert.ok(explanation.length >= 60 && explanation.length <= 200, `${type}: ${explanation.length} chars`);
      assert.ok(!explanation.includes("\n"), `${type} spans several lines`);
    }
  });

  it("saves at least 1,500 tokens over the full guide", () => {
    const saved = countPromptTokens(typeSectionText("full")) - countPromptTokens(typeSectionText("compact"));
    assert.ok(saved >= 1500, `saves only ${saved} tokens`);
  });
});
