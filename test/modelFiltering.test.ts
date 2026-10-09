// Unit tests for the centralized live-model filtering pipeline
// (filterProviderModels in src/ai/providersConfig.ts). The tests lock in the
// full behavior: keyword exclusion, deduplication, exact-ID exclusion, and
// dated/versioned model removal.
// Runs via mocha + ts-node (see .mocharc.json).

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import type { ModelListEntry } from "../src/ai/aiClient";
import { filterProviderModels } from "../src/ai/providersConfig";

function entry(modelId: string): ModelListEntry {
  return { modelId, modelLabel: modelId };
}

describe("filterProviderModels", () => {
  it("removes models whose ID contains an excluded keyword (Step 0)", () => {
    const raw = [entry("gpt-4o"), entry("whisper-1"), entry("tts-1"), entry("dall-e-3"), entry("text-embedding-3-small")];
    const result = filterProviderModels("openai", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["gpt-4o"],
    );
  });

  it("drops exact duplicate IDs, keeping the first occurrence (Step 1)", () => {
    const raw = [entry("gpt-4o"), entry("gpt-4o"), entry("gpt-4.1")];
    const result = filterProviderModels("openai", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["gpt-4o", "gpt-4.1"],
    );
  });

  it("removes IDs listed in modelIdExcludeExact (Step 2)", () => {
    const raw = [entry("mistral-medium-3-5"), entry("mistral-medium-3.5"), entry("mistral-medium-latest"), entry("mistral-medium")];
    const result = filterProviderModels("mistral", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["mistral-medium-3-5", "mistral-medium-latest"],
    );
  });

  it("removes a dated model when its clean alias exists (Step 3)", () => {
    const raw = [entry("gpt-4o"), entry("gpt-4o-2024-11-20")];
    const result = filterProviderModels("openai", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["gpt-4o"],
    );
  });

  it("keeps a dated model when no clean alias exists (Step 3)", () => {
    const raw = [entry("gpt-4o-2024-11-20")];
    const result = filterProviderModels("openai", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["gpt-4o-2024-11-20"],
    );
  });

  it("removes a dated model when a -latest alias exists (Step 3)", () => {
    // "codestral-latest" covers "codestral-2508".
    const raw = [entry("codestral-latest"), entry("codestral-2508")];
    const result = filterProviderModels("mistral", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["codestral-latest"],
    );
  });

  it("removes short versioned suffixes when a bare name exists (Step 3)", () => {
    // "gemini-2.0-flash" covers "gemini-2.0-flash-001".
    const raw = [entry("gemini-2.0-flash"), entry("gemini-2.0-flash-001")];
    const result = filterProviderModels("gemini", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["gemini-2.0-flash"],
    );
  });
});
