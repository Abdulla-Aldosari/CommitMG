// Unit tests for the pure helpers in src/ai/providersConfig.ts beyond the
// filtering pipeline (covered in modelFiltering.test.ts): getDefaultModelId,
// the single source the gateway uses when no model was chosen.
// Runs via mocha + ts-node (see .mocharc.json).

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { getDefaultModelId } from "../src/ai/providersConfig";

describe("getDefaultModelId", () => {
  it("returns the configured default model for openai", () => {
    assert.equal(getDefaultModelId("openai"), "gpt-4o-mini");
  });

  it("returns the configured default model for gemini", () => {
    assert.equal(getDefaultModelId("gemini"), "gemini-flash-latest");
  });

  it("returns the configured default model for anthropic", () => {
    assert.equal(getDefaultModelId("anthropic"), "claude-3-5-haiku-latest");
  });

  it("returns the configured default model for mistral", () => {
    assert.equal(getDefaultModelId("mistral"), "mistral-small-latest");
  });
});
