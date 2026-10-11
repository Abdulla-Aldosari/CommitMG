// Unit tests for the pure helpers in src/ai/providersConfig.ts beyond the
// filtering pipeline (covered in modelFiltering.test.ts): getDefaultModelId,
// the single source the gateway uses when no model was chosen.
// Runs via mocha + ts-node (see .mocharc.json).

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { resolveModelProfile } from "../src/ai/params/profileRules";
import { getDefaultModelId, getProvidersArray } from "../src/ai/providersConfig";

describe("getDefaultModelId", () => {
  it("returns the configured default model for openai", () => {
    assert.equal(getDefaultModelId("openai"), "gpt-4o-mini");
  });

  it("returns the configured default model for gemini", () => {
    assert.equal(getDefaultModelId("gemini"), "gemini-flash-latest");
  });

  it("returns the configured default model for anthropic", () => {
    assert.equal(getDefaultModelId("anthropic"), "claude-haiku-5-5");
  });

  it("gives every fixed provider a default that its profiles know", () => {
    for (const provider of getProvidersArray()) {
      const modelId = getDefaultModelId(provider.name);
      assert.ok(
        provider.models.some((model) => model.modelId === modelId),
        `${provider.name}: default ${modelId} is not in the built-in list`,
      );
      assert.equal(resolveModelProfile(provider.name, modelId).known, true, `${provider.name}: no profile for ${modelId}`);
    }
  });

  it("knows a profile for every built-in model", () => {
    for (const provider of getProvidersArray()) {
      for (const model of provider.models) {
        assert.equal(resolveModelProfile(provider.name, model.modelId).known, true, `${provider.name}: no profile for ${model.modelId}`);
      }
    }
  });

  it("returns the configured default model for mistral", () => {
    assert.equal(getDefaultModelId("mistral"), "mistral-small-latest");
  });
});
